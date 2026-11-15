/**
 * A load bot: plays through the real protocol with the real client model, so
 * a snap-back is counted exactly as a player would see it. The model is fed every `snapshot`,
 * `delta` and `you` as `packages/client/src/app.ts` does, a 50 ms timer runs `clientTick` and
 * sends `move` and `step` when the held arrow changes, and a role decides what to hold, swing,
 * cast or say, with seeded think-time between actions. Runs in its own process, so its CPU is
 * not the server's.
 */
import {
  applyDelta,
  applySnapshot,
  applyYou,
  clientTick,
  createModel,
  type Intent,
  type Model,
  onDeath,
  onRespawnDrawn,
} from "@secondstaronline/client/src/model.ts";
import type { ClientMsg, ServerMsg } from "@secondstaronline/shared";

import { seeded } from "./relay.ts";

export type Role = "walker" | "fighter" | "caster" | "pvp" | "gatherer" | "trader";
export type DirKey = "L" | "R" | "U" | "D";

export interface BotOptions {
  /** The game socket (the relay's, or the server's). */
  url: string;
  name: string;
  password: string;
  role: Role;
  seed: number;
  /** pvp: 0 or 1; a bot attacks players of the other team. */
  team?: number;
  /** trader: the name of the one it trades with; the lower name starts the trade. */
  partner?: string;
  /** gatherer: the way to face (the tree is that way). */
  faceDir?: DirKey;
  /** caster: the spell to cast. */
  spell?: string;
}

/** What a bot saw in one reporting window. */
export interface BotWindow {
  name: string;
  role: Role;
  messagesIn: number;
  bytesIn: number;
  messagesOut: number;
  /** Walker moved to another tile under the server's `you`, with predicted steps in flight. */
  snapsPredicting: number;
  /** The server moved a walker with nothing predicted (pushes, warps, map changes). */
  snapsServer: number;
  /** A predicted step went unconfirmed for the model's timeout. */
  snapsTimeout: number;
  /** Ticks with an arrow held. */
  walkTicks: number;
  /** Intent-to-answer delays (ms) for predicted steps, in the window. */
  delays: number[];
  closes: Record<string, number>;
  logins: number;
  denied: number;
  deaths: number;
  chatIn: number;
  /** What the bot did and saw: attack, cast, pickup, chat, tradeOpen, tradeAccept, and `seen:` events. */
  actions: Record<string, number>;
}

export interface Bot {
  readonly model: Model;
  /** The window since the last call, then reset. */
  takeWindow(): BotWindow;
  /** Logs out and comes back after `ms` (soak: sessions and resume tokens churn). */
  leaveFor(ms: number): void;
  /** The newest inventory the bot has seen (soak: compared after a kill -9). */
  inventory(): unknown;
  stop(): void;
}

const FINAL = new Set([4001, 4002, 4003, 4004, 4005, 4006]);
const TICK_MS = 50;

const FACING_OF: Record<DirKey, "N" | "S" | "E" | "W"> = { L: "W", R: "E", U: "N", D: "S" };
const dirKeyToward = (dx: number, dy: number): DirKey =>
  Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U";

/** The stage pixel the original's cast target uses for a tile (`centre` in the E2E tests). */
export const tilePixel = (x: number, y: number) => ({ x: x * 32 + 14, y: y * 32 + 15 });

const emptyWindow = (name: string, role: Role): BotWindow => ({
  name,
  role,
  messagesIn: 0,
  bytesIn: 0,
  messagesOut: 0,
  snapsPredicting: 0,
  snapsServer: 0,
  snapsTimeout: 0,
  walkTicks: 0,
  delays: [],
  closes: {},
  logins: 0,
  denied: 0,
  deaths: 0,
  chatIn: 0,
  actions: {},
});

const SAYINGS = [
  "hello",
  "anyone about?",
  "nice day",
  "lag?",
  "brb",
  "over here",
  "careful!",
  "gg",
];

export function startBot(options: BotOptions): Bot {
  const rand = seeded(options.seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const model = createModel();
  const intent: Intent = { held: null, turn: false, pending: null };
  let win = emptyWindow(options.name, options.role);
  let ws: WebSocket | null = null;
  let token: string | null = null;
  let stopped = false;
  let seq = 0;
  let dead = false;
  let away = false;
  let lastInv: unknown = null;
  let lastTickAt = performance.now();
  /** Predicted step number -> when it was sent, for the intent-to-answer delay. */
  const sentAt = new Map<number, number>();

  const count = (what: string) => {
    win.actions[what] = (win.actions[what] ?? 0) + 1;
  };
  const send = (m: ClientMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(m));
      win.messagesOut += 1;
      if (
        m.t !== "move" &&
        m.t !== "step" &&
        m.t !== "mapReady" &&
        m.t !== "login" &&
        m.t !== "resume"
      ) {
        count(m.t === "attack" ? (m.held ? "attack" : "attackStop") : m.t);
      }
    }
  };

  // ---- the connection -------------------------------------------------------------------
  const connect = () => {
    if (stopped || away) {
      return;
    }
    const sock = new WebSocket(options.url);
    ws = sock;
    sock.addEventListener("open", () => {
      if (token) {
        send({ t: "resume", token });
      } else {
        send({ t: "login", name: options.name, password: options.password });
      }
    });
    sock.addEventListener("message", (e) => onMessage(String(e.data)));
    sock.addEventListener("close", (e) => {
      win.closes[String(e.code)] = (win.closes[String(e.code)] ?? 0) + 1;
      if (ws === sock) {
        ws = null;
      }
      held(null);
      if (stopped || away) {
        return;
      }
      if (FINAL.has(e.code)) {
        token = null;
      }
      setTimeout(connect, FINAL.has(e.code) || !token ? 5000 : 1000);
    });
    sock.addEventListener("error", () => {});
  };

  const onMessage = (raw: string) => {
    win.messagesIn += 1;
    win.bytesIn += raw.length;
    const msg = JSON.parse(raw) as ServerMsg;
    switch (msg.t) {
      case "welcome":
        token = msg.token;
        win.logins += 1;
        return;
      case "denied":
        win.denied += 1;
        token = null;
        return;
      case "snapshot":
        applySnapshot(model, msg);
        model.keyLock = false;
        sentAt.clear();
        dead = false;
        // The real client sends `mapReady` once the map is drawn.
        setTimeout(() => {
          model.loading = false;
          onRespawnDrawn(model);
          send({ t: "mapReady" });
        }, 40);
        return;
      case "death":
        onDeath(model);
        dead = true;
        win.deaths += 1;
        held(null);
        return;
      case "you": {
        const s = model.self;
        const before = s ? { x: s.x, y: s.y, predicting: s.predicted.size > 0 } : null;
        applyYou(model, msg.self);
        if (s && before && (s.x !== before.x || s.y !== before.y)) {
          if (before.predicting) {
            win.snapsPredicting += 1;
          } else {
            win.snapsServer += 1;
          }
          sentAt.clear();
        }
        // Answered steps: every step the server has now acted on.
        const now = performance.now();
        for (const [n, t] of sentAt) {
          if (n <= msg.self.n) {
            win.delays.push(now - t);
            sentAt.delete(n);
          }
        }
        return;
      }
      case "vitals":
        model.vitals = msg.vitals;
        return;
      case "delta":
        applyDelta(model, msg.events);
        for (const ev of msg.events) {
          if (ev.e === "mhit" || ev.e === "gadd" || ev.e === "fx" || ev.e === "phit") {
            count(`seen:${ev.e}`);
          }
          if (ev.e === "gadd") {
            nearGround.set(ev.item.id, ev.item);
          } else if (ev.e === "gdel") {
            nearGround.delete(ev.id);
          }
        }
        return;
      case "inv":
        model.inv = msg.inv;
        lastInv = msg.inv;
        return;
      case "chat":
        win.chatIn += 1;
        return;
      case "trade":
        onTrade(msg.trade);
        return;
      case "kicked":
        token = null;
        return;
      default:
        return;
    }
  };

  // ---- input, as the client sends it ------------------------------------------------------
  /** Holds an arrow (or releases with null): `step` for a new press, `move` on a change. */
  const held = (dir: DirKey | null, turn = false) => {
    if (intent.held === dir && intent.turn === turn) {
      return;
    }
    const pressed = dir !== null && dir !== intent.held;
    intent.held = dir;
    intent.turn = turn;
    if (pressed && dir) {
      intent.pending = { dir, turn, age: 0 };
      send({ t: "step", seq: ++seq, dir, turn });
    }
    send({ t: "move", seq: ++seq, held: dir, turn });
  };
  /** One tap in a direction (a blocked tap turns to face it). */
  const tap = (dir: DirKey) => {
    held(dir);
    pendingRelease = performance.now() + 120;
  };
  let pendingRelease = 0;
  let attacking = false;
  const attack = (on: boolean) => {
    if (attacking !== on) {
      attacking = on;
      send({ t: "attack", seq: ++seq, held: on });
    }
  };

  // ---- roles ---------------------------------------------------------------------------------
  const nearGround = new Map<string, { id: string; x: number; y: number; name: string }>();
  let nextChatAt = performance.now() + between(5000, 40000);
  let walk: { until: number; dir: DirKey | null; restUntil: number } = {
    until: 0,
    dir: null,
    restUntil: 0,
  };
  let swingUntil = 0;
  let restUntil = 0;
  let nextCastAt = 0;
  let faced = false;
  let tradeAt = performance.now() + between(15000, 40000);
  let tradeStep: "none" | "offered" = "none";
  let tradeStartedAt = 0;

  const wander = (now: number) => {
    if (walk.dir !== null) {
      if (now >= walk.until) {
        held(null);
        walk = { until: 0, dir: null, restUntil: now + between(1000, 6000) };
      }
      return;
    }
    if (now >= walk.restUntil) {
      const dirs: DirKey[] = ["L", "R", "U", "D"];
      const dir = dirs[Math.floor(rand() * 4)] ?? "R";
      walk = { until: now + between(1000, 4000), dir, restUntil: 0 };
      held(dir);
    }
  };

  const me = () => model.self;
  const dist = (x: number, y: number) => {
    const s = me();
    return s ? Math.abs(s.x - x) + Math.abs(s.y - y) : 99;
  };

  /** Walks at the nearest target and swings when it is next to you. */
  const chase = (targets: { x: number; y: number }[], now: number): boolean => {
    const s = me();
    if (!s) {
      return false;
    }
    let best: { x: number; y: number } | null = null;
    for (const t of targets) {
      if (!best || dist(t.x, t.y) < dist(best.x, best.y)) {
        best = t;
      }
    }
    if (!best) {
      attack(false);
      return false;
    }
    const dx = best.x - s.x;
    const dy = best.y - s.y;
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      const dir = dirKeyToward(dx, dy);
      if (s.facing !== FACING_OF[dir]) {
        held(null);
        attack(false);
        tap(dir); // a step into the blocked tile turns to face it
      } else {
        held(null);
        if (now >= swingUntil) {
          swingUntil = now + between(1500, 4000);
        }
        attack(true);
      }
      return true;
    }
    attack(false);
    held(dirKeyToward(dx, dy));
    return true;
  };

  const monsters = () => [...model.monsters.values()];
  const peers = () => [...model.peers.values()];
  const teamOf = (name: string) => (name.startsWith("Pvpb") ? 1 : 0);

  const act = (now: number) => {
    const s = me();
    if (!s || model.loading || dead) {
      return;
    }
    if (pendingRelease && now >= pendingRelease) {
      pendingRelease = 0;
      held(null);
    }
    if (pendingRelease) {
      return;
    }
    if (now >= nextChatAt) {
      nextChatAt = now + between(20000, 60000);
      send({ t: "chat", text: SAYINGS[Math.floor(rand() * SAYINGS.length)] ?? "hi" });
    }
    switch (options.role) {
      case "walker":
        wander(now);
        return;
      case "fighter":
        if (now < restUntil || !chase(monsters(), now)) {
          wander(now);
        }
        return;
      case "caster": {
        const target = monsters()
          .filter((m) => dist(m.x, m.y) <= 6)
          .sort((a, b) => dist(a.x, a.y) - dist(b.x, b.y))[0];
        if (target && options.spell) {
          held(null);
          if (now >= nextCastAt) {
            nextCastAt = now + between(1500, 3500);
            const at = tilePixel(target.x, target.y);
            send({ t: "cast", spell: options.spell, x: at.x, y: at.y });
          }
          return;
        }
        wander(now);
        return;
      }
      case "pvp": {
        const foes = peers().filter((p) => teamOf(p.name) !== (options.team ?? 0));
        if (!chase(foes, now)) {
          wander(now);
        }
        return;
      }
      case "gatherer": {
        if (!faced && options.faceDir) {
          faced = true;
          tap(options.faceDir);
          return;
        }
        const loot = [...nearGround.values()].find((g) => dist(g.x, g.y) <= 1);
        if (loot) {
          send({ t: "pickup", id: loot.id });
          nearGround.delete(loot.id);
        }
        if (now >= swingUntil) {
          attack(false);
          if (now >= restUntil) {
            swingUntil = now + between(2500, 4000);
            restUntil = swingUntil + between(500, 1200);
          }
        } else {
          attack(true);
        }
        return;
      }
      case "trader": {
        if (
          options.partner &&
          options.name < options.partner &&
          tradeStep === "none" &&
          now >= tradeAt
        ) {
          const them = peers().find((p) => p.name === options.partner);
          if (them) {
            tradeAt = now + between(20000, 45000);
            tradeStartedAt = now;
            tradeStep = "offered";
            send({ t: "tradeOpen", id: them.id });
          }
        }
        if (tradeStep === "offered" && now - tradeStartedAt > 8000) {
          send({ t: "tradeCancel" });
          tradeStep = "none";
        }
        if (tradeStep === "none") {
          wander(now);
        }
        return;
      }
    }
  };

  const onTrade = (
    trade: {
      mine: { gold: number } | null;
      theirs: { gold: number } | null;
    } | null,
  ) => {
    if (!trade) {
      tradeStep = "none";
      return;
    }
    if (!trade.mine) {
      send({ t: "tradeOffer", gold: options.name < (options.partner ?? "") ? 1 : 0, items: [] });
    } else if (trade.theirs && options.name < (options.partner ?? "")) {
      send({ t: "tradeAccept" });
    }
  };

  // ---- the 50 ms client tick -----------------------------------------------------------------
  const timer = setInterval(() => {
    const now = performance.now();
    let due = Math.min(4, Math.floor((now - lastTickAt) / TICK_MS));
    lastTickAt += due * TICK_MS;
    if (now - lastTickAt > 1000) {
      lastTickAt = now;
    }
    act(now);
    while (due-- > 0) {
      const s = me();
      const unconfirmed = s?.unconfirmedSince;
      const timedOut =
        s !== null &&
        unconfirmed !== null &&
        unconfirmed !== undefined &&
        model.tick + 1 - unconfirmed > 30;
      const nBefore = s?.n ?? 0;
      const xBefore = s?.x ?? 0;
      const yBefore = s?.y ?? 0;
      clientTick(model, intent);
      if (intent.held !== null) {
        win.walkTicks += 1;
      }
      if (s && timedOut && (s.x !== xBefore || s.y !== yBefore)) {
        win.snapsTimeout += 1;
        sentAt.clear();
      }
      if (s && s.n > nBefore) {
        for (let n = nBefore + 1; n <= s.n; n++) {
          sentAt.set(n, now);
        }
      }
    }
  }, TICK_MS);

  connect();

  return {
    model,
    takeWindow() {
      const w = win;
      win = emptyWindow(options.name, options.role);
      return w;
    },
    leaveFor(ms) {
      if (away || stopped) {
        return;
      }
      away = true;
      send({ t: "logout" });
      ws?.close();
      token = null;
      setTimeout(() => {
        away = false;
        connect();
      }, ms);
    },
    inventory: () => lastInv,
    stop() {
      stopped = true;
      clearInterval(timer);
      ws?.close();
    },
  };
}
