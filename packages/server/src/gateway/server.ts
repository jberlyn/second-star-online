/**
 * The gateway: the only module that owns sockets. One Bun process serves the client page, the
 * generated assets and the game WebSocket from the same origin.
 *
 * - Every inbound frame is size-capped and parsed with a strict Zod schema; bad frames are
 *   dropped and counted, and a connection that keeps sending them is closed.
 * - Each connection has a token bucket, so a flood is cut off. The game's own cadence (one step per
 *   16 ticks) is enforced by the sim, not here.
 * - Sessions: a login issues a resume token. When a connection drops, the character leaves the map
 *   at once and is saved; for `reconnectGrace` (`SSO_RECONNECT_GRACE`) the token lets the client reconnect without a
 *   password, which counts as a resumed session, not a login.
 * - A second login to the same account replaces the first.
 */
import { realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, posix, relative, resolve } from "node:path";
import type { ServerWebSocket } from "bun";

import { ASSET_INDEX_FILE, type AssetIndex, type PackArtIndex } from "@secondstaronline/data";
import {
  CLOSE,
  type ClientMsg,
  EDITOR_MESSAGE_BYTES,
  inGameSchema,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  preAuthSchema,
  type ServerMsg,
  TEXT,
  UPLOAD_MESSAGE_BYTES,
} from "@secondstaronline/shared";

import type { Clock } from "../clock.ts";
import type { ClientCopy } from "../content/service.ts";
import type { Game } from "../game.ts";
import { ipKey } from "../systems/admin/login-limits.ts";

export const WS_PATH = "/ws";
export const ASSETS_PATH = "/assets/";
/** Where a pack's art is served, under `/assets/`: `packs/<id>/<file>`. */
const PACK_ART_PREFIX = "packs/";

/**
 * The asset index clients load: the engine's own art (the UI files and its sounds) with each
 * installed pack's atlases and sounds merged in, in load order. A pack's files are named under
 * `packs/<id>/`; a later pack's sprite or sound of the same name wins.
 */
export function mergePackArt(
  engine: AssetIndex,
  packs: readonly { id: string; art: PackArtIndex }[],
): AssetIndex {
  const atlases = structuredClone(engine.atlases);
  const sounds = { ...engine.sounds };
  for (const { id, art } of packs) {
    for (const [group, atlas] of Object.entries(art.atlases) as [
      keyof AssetIndex["atlases"],
      AssetIndex["atlases"][keyof AssetIndex["atlases"]],
    ][]) {
      const into = atlases[group] ?? { sheets: [], sprites: {} };
      const offset = into.sheets.length;
      into.sheets.push(...atlas.sheets.map((f) => `${PACK_ART_PREFIX}${id}/${f}`));
      for (const [name, sprite] of Object.entries(atlas.sprites)) {
        const [sheet, ...rest] = sprite;
        into.sprites[name] = [sheet + offset, ...rest] as typeof sprite;
      }
      atlases[group] = into;
    }
    for (const [name, file] of Object.entries(art.sounds)) {
      sounds[name] = `${PACK_ART_PREFIX}${id}/${file}`;
    }
  }
  return { ...engine, atlases, sounds };
}

/** Where the content store is served (`current.json`, `<hash>.json`). */
export const CONTENT_PATH = "/content/";

/** Token bucket: up to 60 messages at once, refilled at 60 per second. */
const BUCKET_CAPACITY = 60;
const BUCKET_REFILL_PER_MS = 60 / 1000;
/** Malformed messages tolerated before the connection is closed. */
const MAX_BAD_MESSAGES = 50;

export interface GatewayOptions {
  /** 0 picks a free port (tests, bot E2E). */
  port: number;
  hostname?: string;
  /** Live reload and unminified client bundle. */
  development: boolean;
  game: Game;
  /**
   * The published content store as clients receive it, served at `/content/<hash>.json` (and
   * its hash at `/content/current.json`). Absent: no content is served (tests of the gateway alone).
   */
  content?: () => ClientCopy;
  /** A recent published store by hash, so a client that asked just before a publish gets it. */
  contentFor?: (hash: string) => ClientCopy | undefined;
  /**
   * The installed packs' art folders, in load order. Each pack's atlases and sounds are served
   * under `/assets/packs/<id>/`, and `/assets/index.json` is the engine's own art (the UI files and
   * the interface's sounds) with every installed pack's art merged in. A pack that is not
   * installed sends nothing, so a server without the Classic pack never sends 1.6 art. Absent:
   * `/assets/` serves the asset folder as it is (tests of the gateway alone).
   */
  packArt?: () => readonly { id: string; artDir: string | null }[];
  clock: Clock;
  /** Folder of generated assets (packages/data/assets). */
  assetsDir: string;
  /** Reverse proxies in front (`SSO_PROXY_HOPS`): 0 = the socket's address. */
  proxyHops?: number;
  /** CSP `frame-ancestors` value (`SSO_FRAME_ANCESTORS`); unset adds none. */
  frameAncestors?: string;
  /** Prebuilt client directory (`dist/client` by default in production). */
  clientDir?: string;
  /**
   * Bytes waiting to be sent on a socket (default `ws.getBufferedAmount`). A test makes one socket
   * look behind with it.
   */
  backlogOf?(ws: ServerWebSocket<ConnData>): number;
}

/**
 * A game socket with more than this waiting to be sent is closed with `CLOSE.behind`. About 70 s of
 * a 40-player map's traffic at the 15 KB/s the spike measured.
 */
export const MAX_BACKLOG_BYTES = 1 << 20;

/**
 * Traffic since the last `takeStats`. Bytes are the JSON string's length: ASCII except player text,
 * close enough for a count and free to take.
 */
export interface GatewayStats {
  messagesOut: number;
  bytesOut: number;
  messagesIn: number;
  bytesIn: number;
  /** The largest unsent backlog seen on any socket since the last read. */
  maxBacklog: number;
  /** Game sockets that were closed for falling behind. */
  closedBehind: number;
  /** Time spent in `JSON.stringify` and in `ws.send` (ms), to tell encoding from the socket. */
  encodeMs: number;
  sendMs: number;
  /** The slowest single `ws.send` since the last read (ms). */
  maxSendMs: number;
  /** Open game sockets now. */
  online: number;
}

export interface ConnData {
  phase: "pre" | "game" | "closed";
  characterId: string | null;
  token: string | null;
  bad: number;
  tokens: number;
  lastRefill: number;
  /** Closed by the server for a reason that already handled the character. */
  handled: boolean;
  busy: boolean;
  /** The client's IP address (the socket's, or the proxy header's: `SSO_PROXY_HOPS`). */
  ip: string;
  /** Counts toward `socketsPerIp` (`SSO_SOCKETS_PER_IP`) until a role that bypasses login limits logs in. */
  counted: boolean;
  /** Closed with `CLOSE.behind`: later sends to it are skipped. */
  behind?: boolean;
}

interface Session {
  characterId: string;
  name: string;
  /** null while a connection holds it; else when it expires (clock ms). */
  expiresAt: number | null;
}

export interface Gateway {
  url: URL;
  /** Sends to a player's live connection, if any (the game's `Send`). */
  send(playerId: string, msg: ServerMsg): void;
  /**
   * Disconnects a player (`/kick`, `/ban`): the alert, the close, the character leaves the map and
   * is saved, and its resume tokens end.
   */
  kick(playerId: string, text: string): void;
  /** Ends every resume token of a character except its live connection's (`Password=`). */
  dropOtherSessions(characterId: string): void;
  /** Open game connections now. */
  online(): number;
  /** Returns the traffic counters since the last call, and resets them. */
  takeStats(): GatewayStats;
  stop(): Promise<void>;
}

type Ws = ServerWebSocket<ConnData>;

type Traffic = Omit<GatewayStats, "online">;
const emptyTraffic = (): Traffic => ({
  messagesOut: 0,
  bytesOut: 0,
  messagesIn: 0,
  bytesIn: 0,
  maxBacklog: 0,
  closedBehind: 0,
  encodeMs: 0,
  sendMs: 0,
  maxSendMs: 0,
});

/**
 * Headers on every response we build: no sniffing, and a CSP that allows only our own scripts, no
 * plugins and no `<base>`; `frame-ancestors` when the operator sets it.
 */
export function securityHeaders(frameAncestors?: string): Record<string, string> {
  const csp = ["script-src 'self'", "object-src 'none'", "base-uri 'none'"];
  if (frameAncestors) {
    csp.push(`frame-ancestors ${frameAncestors}`);
  }
  return { "x-content-type-options": "nosniff", "content-security-policy": csp.join("; ") };
}

const DEFAULT_CLIENT_DIR = join(import.meta.dir, "..", "..", "..", "..", "dist", "client");

const utf8 = (mime: string): string => `${mime};charset=utf-8`;

const MIME_TYPES: Record<string, string> = {
  ".html": utf8("text/html"),
  ".js": utf8("text/javascript"),
  ".mjs": utf8("text/javascript"),
  ".css": utf8("text/css"),
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function isInsideDir(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

interface StaticFile {
  path: string;
  size: number;
  type: string;
}

/**
 * Resolves a request path to a regular file strictly inside `rootDir` without following symlinks
 * outside it. Maps `/` and `/index.html` to `index.html`.
 */
function resolveStaticFile(rootDir: string, pathname: string): StaticFile | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  const rel = decoded === "/" || decoded === "/index.html" ? "index.html" : decoded.slice(1);
  if (rel === "" || rel.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    return null;
  }
  const candidate = resolve(rootDir, rel);
  if (!isInsideDir(rootDir, candidate)) {
    return null;
  }
  try {
    const realPath = realpathSync(candidate);
    if (!isInsideDir(rootDir, realPath)) {
      return null;
    }
    const st = statSync(realPath);
    if (!st.isFile()) {
      return null;
    }
    return { path: realPath, size: st.size, type: mimeTypeFor(realPath) };
  } catch {
    return null;
  }
}

/** Validates that `clientDir` exists and contains a regular `index.html` inside it. */
function validateClientDir(clientDir: string): string {
  const requested = resolve(clientDir);
  let realRoot: string;
  try {
    realRoot = realpathSync(requested);
    if (!statSync(realRoot).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new Error(
      `Prebuilt client directory not found at ${requested}. Run \`bun run build\` first.`,
    );
  }
  const indexFile = resolveStaticFile(realRoot, "/index.html");
  if (!indexFile) {
    throw new Error(
      `Prebuilt client index.html missing at ${join(realRoot, "index.html")}. Run \`bun run build\` first.`,
    );
  }
  return realRoot;
}

export function startGateway(options: GatewayOptions): Gateway {
  const { game, clock } = options;
  const live = new Map<string, Ws>(); // characterId -> connection
  const sessions = new Map<string, Session>(); // token -> session
  const headers = securityHeaders(options.frameAncestors);
  const proxyHops = options.proxyHops ?? 0;
  const prodClientDir = options.development
    ? null
    : validateClientDir(options.clientDir ?? DEFAULT_CLIENT_DIR);
  const devRoutes = options.development
    ? { "/": (require("./dev-client.ts") as { default: unknown }).default }
    : {};
  /** Open sockets per address key (`socketsPerIp`). */
  const socketsByIp = new Map<string, number>();
  const uncount = (d: ConnData) => {
    if (!d.counted) {
      return;
    }
    d.counted = false;
    const k = ipKey(d.ip);
    const n = (socketsByIp.get(k) ?? 1) - 1;
    if (n <= 0) {
      socketsByIp.delete(k);
    } else {
      socketsByIp.set(k, n);
    }
  };
  const respond = (body: BodyInit | null, init: ResponseInit = {}) =>
    new Response(body, { ...init, headers: { ...headers, ...(init.headers as object) } });

  /**
   * `current.json` is the published hash (never cached); `<hash>.json` is that store, cached for
   * good, since a hash names one store. The published store and the few before it (`contentFor`) are served.
   */
  const contentResponse = (req: Request, file: string, current: ClientCopy): Response => {
    let copy = current;
    if (file === "current.json") {
      return respond(JSON.stringify({ hash: copy.hash }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    const wanted = /^([0-9a-f]{16})\.json$/.exec(file)?.[1];
    const found = wanted === copy.hash ? copy : wanted ? options.contentFor?.(wanted) : undefined;
    if (!found) {
      return respond("Not found", { status: 404 });
    }
    copy = found;
    const gzip = /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
    const body = gzip ? copy.gzip : copy.json;
    return respond(req.method === "HEAD" ? null : body, {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=31536000, immutable",
        vary: "accept-encoding",
        ...(gzip ? { "content-encoding": "gzip" } : {}),
      },
    });
  };

  const backlogOf = options.backlogOf ?? ((ws: Ws) => ws.getBufferedAmount());
  let traffic = emptyTraffic();
  const sendWs = (ws: Ws, msg: ServerMsg) => {
    if (ws.readyState !== 1 || ws.data.behind) {
      return;
    }
    const t0 = performance.now();
    const json = JSON.stringify(msg);
    const t1 = performance.now();
    const result = ws.send(json);
    traffic.encodeMs += t1 - t0;
    const sent = performance.now() - t1;
    traffic.sendMs += sent;
    if (sent > traffic.maxSendMs) {
      traffic.maxSendMs = sent;
    }
    traffic.messagesOut += 1;
    traffic.bytesOut += json.length;
    // 0 is a dropped message (past Bun's `backpressureLimit`); -1 is queued.
    const backlog = backlogOf(ws);
    if (backlog > traffic.maxBacklog) {
      traffic.maxBacklog = backlog;
    }
    if (ws.data.phase === "game" && (result === 0 || backlog > MAX_BACKLOG_BYTES)) {
      // Too far behind to catch up: close so the client resumes with a fresh snapshot, instead
      // of showing minutes-old maps and losing messages once Bun's buffer fills.
      ws.data.behind = true;
      traffic.closedBehind += 1;
      ws.close(CLOSE.behind.code, CLOSE.behind.reason);
    }
  };

  const purgeSessions = () => {
    const now = clock.now();
    for (const [token, s] of sessions) {
      if (s.expiresAt !== null && s.expiresAt <= now) {
        sessions.delete(token);
      }
    }
  };

  /** Puts `ws` in game as `characterId`, replacing any connection that already has it. */
  const admit = (ws: Ws, characterId: string, name: string, token: string, resumed: boolean) => {
    const old = live.get(characterId);
    if (old && old !== ws) {
      old.data.handled = true;
      sendWs(old, { t: "kicked", text: TEXT.replaced });
      old.close(CLOSE.replaced.code, CLOSE.replaced.reason);
    }
    // A password login ends every other resume token of the character, a live connection or not (a
    // changed password must end a stolen session).
    if (!resumed) {
      dropSessions(characterId, token);
    } else if (old && old !== ws) {
      dropSessions(characterId, token);
    }
    if (game.canModerate(characterId)) {
      uncount(ws.data);
    }
    if (game.isOnline(characterId)) {
      game.leave(characterId);
    }
    live.set(characterId, ws);
    sessions.set(token, { characterId, name, expiresAt: null });
    ws.data.phase = "game";
    ws.data.characterId = characterId;
    ws.data.token = token;
    sendWs(ws, {
      t: "welcome",
      protocol: PROTOCOL_VERSION,
      id: characterId,
      name,
      token,
      resumed,
      rules: { chatMaxChars: game.settings.chatMaxChars },
      ...(options.content ? { content: options.content().hash } : {}),
    });
    if (!game.enter(characterId, resumed, ws.data.ip)) {
      live.delete(characterId);
      sessions.delete(token);
      ws.data.handled = true;
      sendWs(ws, { t: "kicked", text: "Your character could not be loaded." });
      ws.close(CLOSE.logout.code, CLOSE.logout.reason);
    }
  };

  const handlePreAuth = async (ws: Ws, msg: ClientMsg) => {
    switch (msg.t) {
      case "login": {
        const r = await game.login(msg.name, msg.password, ws.data.ip);
        if (ws.data.phase !== "pre") {
          return;
        }
        if (!r.ok) {
          return sendWs(ws, { t: "denied", text: r.text });
        }
        purgeSessions();
        return admit(ws, r.characterId, r.name, crypto.randomUUID(), false);
      }
      case "create": {
        const r = await game.create(msg, ws.data.ip);
        if (ws.data.phase !== "pre") {
          return;
        }
        return sendWs(
          ws,
          r.ok ? { t: "created", text: TEXT.created } : { t: "denied", text: r.text },
        );
      }
      case "resume": {
        purgeSessions();
        const s = sessions.get(msg.token);
        if (!s) {
          return sendWs(ws, { t: "denied", text: TEXT.resumeFailed });
        }
        const refused = game.refusal(s.characterId, ws.data.ip);
        if (refused) {
          sessions.delete(msg.token);
          return sendWs(ws, { t: "denied", text: refused });
        }
        return admit(ws, s.characterId, s.name, msg.token, true);
      }
    }
  };

  const takeToken = (ws: Ws): boolean => {
    const now = clock.now();
    const d = ws.data;
    d.tokens = Math.min(BUCKET_CAPACITY, d.tokens + (now - d.lastRefill) * BUCKET_REFILL_PER_MS);
    d.lastRefill = now;
    if (d.tokens < 1) {
      return false;
    }
    d.tokens -= 1;
    return true;
  };

  const strike = (ws: Ws) => {
    ws.data.bad += 1;
    if (ws.data.bad > MAX_BAD_MESSAGES) {
      // The cheat log: the honest client never sends a malformed frame.
      game.cheat(ws.data.characterId, ws.data.ip, "Sending bad messages");
      ws.close(CLOSE.badMessage.code, CLOSE.badMessage.reason);
    }
  };

  /** Ends every resume token of a character. */
  const dropSessions = (characterId: string, keep?: string) => {
    for (const [t, s] of sessions) {
      if (t !== keep && s.characterId === characterId) {
        sessions.delete(t);
      }
    }
  };

  const server = Bun.serve<ConnData>({
    port: options.port,
    hostname: options.hostname ?? "0.0.0.0",
    development: options.development ? { hmr: true, console: true } : false,
    // Development keeps Bun's HTML import (live reload, no CSP); production serves prebuilt files
    // in `fetch` so every response carries our headers.
    routes: devRoutes as Record<string, never>,
    async fetch(req, srv) {
      try {
        return await route(req, srv);
      } catch (err) {
        console.error("gateway: request failed", err);
        return respond("Server error", { status: 500 });
      }
    },
    websocket: {
      maxPayloadLength: EDITOR_MESSAGE_BYTES,
      // Bun's defaults (16 MB, then silent loss) would run before our check at `MAX_BACKLOG_BYTES`;
      // keep its limit well past ours and never let it close.
      backpressureLimit: 4 * MAX_BACKLOG_BYTES,
      closeOnBackpressureLimit: false,
      open(ws) {
        const limit = game.config.socketsPerIp;
        const k = ipKey(ws.data.ip);
        const n = socketsByIp.get(k) ?? 0;
        if (limit > 0 && n >= limit) {
          ws.data.phase = "closed";
          sendWs(ws, { t: "denied", text: TEXT.tooManyConnections });
          ws.close(CLOSE.tooManyConnections.code, CLOSE.tooManyConnections.reason);
          return;
        }
        ws.data.counted = true;
        socketsByIp.set(k, n + 1);
      },
      message(ws, raw) {
        traffic.messagesIn += 1;
        traffic.bytesIn += typeof raw === "string" ? raw.length : raw.byteLength;
        try {
          onMessage(ws, raw);
        } catch (err) {
          // Not reached by any message today (the game catches its own throws). A player in game is
          // logged out as for a server error, so the character leaves the map and is saved (marking
          // the socket handled here left it in the world for good).
          console.error("gateway: message failed", err);
          const id = ws.data.characterId;
          if (ws.data.phase === "game" && id && live.get(id) === ws) {
            kickPlayer(id, TEXT.serverError);
          } else {
            ws.close(CLOSE.badMessage.code, CLOSE.badMessage.reason);
          }
        }
      },
      close(ws) {
        uncount(ws.data);
        onClose(ws);
      },
    },
  });

  async function route(
    req: Request,
    srv: import("bun").Server<ConnData>,
  ): Promise<Response | undefined> {
    {
      const url = new URL(req.url);
      if (url.pathname === WS_PATH) {
        const data: ConnData = {
          ip: clientIp(req, srv.requestIP(req)?.address ?? "", proxyHops),
          counted: false,
          phase: "pre",
          characterId: null,
          token: null,
          bad: 0,
          tokens: BUCKET_CAPACITY,
          lastRefill: clock.now(),
          handled: false,
          busy: false,
        };
        if (srv.upgrade(req, { data })) {
          return undefined;
        }
        return respond("Expected a WebSocket upgrade", { status: 426 });
      }
      if (
        url.pathname.startsWith(CONTENT_PATH) &&
        options.content &&
        (req.method === "GET" || req.method === "HEAD")
      ) {
        return contentResponse(req, url.pathname.slice(CONTENT_PATH.length), options.content());
      }
      if (url.pathname.startsWith(ASSETS_PATH) && (req.method === "GET" || req.method === "HEAD")) {
        let rel: string;
        try {
          rel = decodeURIComponent(url.pathname.slice(ASSETS_PATH.length));
        } catch {
          return respond("Not found", { status: 404 });
        }
        if (!/^[\w ./'()+,&-]+$/.test(rel) || rel.includes("..")) {
          return respond("Not found", { status: 404 });
        }
        // `./index.json` is the index: one spelling per file, so none skips the merge below.
        rel = posix.normalize(rel);
        let base = options.assetsDir;
        if (options.packArt && rel.startsWith(PACK_ART_PREFIX)) {
          // A pack's art: served only while the pack is installed.
          const [id = "", ...rest] = rel.slice(PACK_ART_PREFIX.length).split("/");
          const pack = options.packArt().find((p) => p.id === id && p.artDir);
          if (!pack?.artDir || rest.length === 0) {
            return respond("Not found", { status: 404 });
          }
          base = pack.artDir;
          rel = rest.join("/");
        }
        const file = Bun.file(normalize(join(base, rel)));
        if (!(await file.exists())) {
          return respond("Not found", { status: 404 });
        }
        if (options.packArt && base === options.assetsDir && rel === ASSET_INDEX_FILE) {
          const index = mergePackArt(
            (await file.json()) as AssetIndex,
            await Promise.all(
              options
                .packArt()
                .filter((p): p is { id: string; artDir: string } => p.artDir !== null)
                .map(async (p) => ({
                  id: p.id,
                  art: (await Bun.file(join(p.artDir, ASSET_INDEX_FILE)).json()) as PackArtIndex,
                })),
            ),
          );
          return respond(req.method === "HEAD" ? null : JSON.stringify(index), {
            headers: { "cache-control": "no-cache", "content-type": "application/json" },
          });
        }
        const assetHeaders = {
          "cache-control": "no-cache",
          "content-type": mimeTypeFor(file.name ?? rel),
          "content-length": String(file.size),
        };
        return respond(req.method === "HEAD" ? null : file, { headers: assetHeaders });
      }
      if (prodClientDir && (req.method === "GET" || req.method === "HEAD")) {
        const f = resolveStaticFile(prodClientDir, url.pathname);
        if (f) {
          const fileHeaders = {
            "content-type": f.type,
            "content-length": String(f.size),
          };
          return respond(req.method === "HEAD" ? null : Bun.file(f.path), { headers: fileHeaders });
        }
      }
      return respond("Not found", { status: 404 });
    }
  }

  function onMessage(ws: Ws, raw: string | Buffer) {
    if (ws.data.phase === "closed") {
      return;
    }
    if (!takeToken(ws)) {
      game.cheat(ws.data.characterId, ws.data.ip, "Flooding");
      ws.close(CLOSE.rateLimited.code, CLOSE.rateLimited.reason);
      return;
    }
    if (typeof raw !== "string") {
      return strike(ws);
    }
    // Only a World or NPC Editor user in game may send an editor-sized frame (a map save), and only a player
    // holding an unspent canvas or film an art-sized one.
    if (raw.length > MAX_MESSAGE_BYTES) {
      const id = ws.data.characterId;
      const allowed =
        ws.data.phase === "game" &&
        !!id &&
        ((raw.length <= EDITOR_MESSAGE_BYTES && game.canEdit(id)) ||
          (raw.length <= UPLOAD_MESSAGE_BYTES && game.canUpload(id)));
      if (!allowed) {
        return strike(ws);
      }
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return strike(ws);
    }
    if (ws.data.phase === "pre") {
      const parsed = preAuthSchema.safeParse(json);
      if (!parsed.success) {
        return strike(ws);
      }
      // One login or create at a time per connection: they hash passwords.
      if (ws.data.busy) {
        return strike(ws);
      }
      ws.data.busy = true;
      handlePreAuth(ws, parsed.data)
        .catch((err) => {
          console.error("gateway: pre-auth failed", err);
          sendWs(ws, { t: "denied", text: "Something went wrong. Please try again." });
        })
        .finally(() => {
          ws.data.busy = false;
        });
      return;
    }
    const parsed = inGameSchema.safeParse(json);
    if (!parsed.success) {
      return strike(ws);
    }
    const characterId = ws.data.characterId;
    if (!characterId) {
      return;
    }
    if (parsed.data.t === "logout") {
      ws.data.handled = true;
      game.leave(characterId);
      live.delete(characterId);
      if (ws.data.token) {
        sessions.delete(ws.data.token);
      }
      ws.close(CLOSE.logout.code, CLOSE.logout.reason);
      return;
    }
    game.intent(characterId, parsed.data);
  }

  function onClose(ws: Ws) {
    const d = ws.data;
    const wasGame = d.phase === "game";
    d.phase = "closed";
    if (!wasGame || d.handled || !d.characterId) {
      return;
    }
    if (live.get(d.characterId) !== ws) {
      return;
    }
    live.delete(d.characterId);
    game.leave(d.characterId);
    const s = d.token ? sessions.get(d.token) : undefined;
    if (s) {
      s.expiresAt = clock.now() + game.config.reconnectGrace * 1000;
    }
  }

  function kickPlayer(playerId: string, text: string) {
    const ws = live.get(playerId);
    dropSessions(playerId);
    if (!ws) {
      return;
    }
    ws.data.handled = true;
    live.delete(playerId);
    sendWs(ws, { t: "kicked", text });
    ws.close(CLOSE.kicked.code, CLOSE.kicked.reason);
    game.leave(playerId);
  }

  return {
    url: server.url,
    kick: kickPlayer,
    send(playerId, msg) {
      const ws = live.get(playerId);
      if (ws) {
        sendWs(ws, msg);
      }
    },
    dropOtherSessions(characterId) {
      dropSessions(characterId, live.get(characterId)?.data.token ?? undefined);
    },
    online: () => live.size,
    takeStats() {
      const t = traffic;
      traffic = emptyTraffic();
      return { ...t, online: live.size };
    },
    stop: () => server.stop(true),
  };
}

/**
 * The client's address: the socket's, or with `hops` reverse proxies in front (`SSO_PROXY_HOPS`)
 * the `hops`-th entry from the right of `X-Forwarded-For` (1 = the right-most, which the proxy
 * nearest to us appended; entries further left are the client's to forge). Fewer entries than
 * hops falls back to the socket's address. An IPv4 client on an IPv6 socket reads as IPv4.
 */
export function clientIp(req: Request, socketIp: string, hops: number): string {
  let ip = socketIp;
  if (hops > 0) {
    const entries = (req.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e !== "");
    const pick = entries[entries.length - hops];
    if (pick) {
      ip = pick;
    }
  }
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}
