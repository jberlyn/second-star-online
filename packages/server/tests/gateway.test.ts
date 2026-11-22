import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemClock } from "../src/clock.ts";
import { createGame } from "../src/game.ts";
import { type Gateway, mergePackArt, startGateway } from "../src/gateway/server.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { scriptedRng } from "../src/rng.ts";

describe("gateway prebuilt production and development serving", () => {
  let root = "";
  let clientDir = "";
  let outsideFile = "";
  let assetsDir = "";
  let gateway: Gateway;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "sso-gw-test-"));
    clientDir = join(root, "client");
    assetsDir = join(root, "assets");
    outsideFile = join(root, "secret.txt");
    mkdirSync(join(clientDir, "sub"), { recursive: true });
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(
      join(clientDir, "index.html"),
      '<!doctype html><html><head><title>Test</title></head><body><script src="/app-123.js"></script></body></html>',
    );
    writeFileSync(join(clientDir, "app-123.js"), "console.log('ok');\n");
    writeFileSync(join(clientDir, "styles.css"), "body { color: #000; }\n");
    writeFileSync(join(clientDir, "sub", "icon.png"), new Uint8Array([137, 80, 78, 71]));
    writeFileSync(join(assetsDir, "ui.png"), new Uint8Array([137, 80, 78, 71]));
    writeFileSync(outsideFile, "top-secret");
    symlinkSync(outsideFile, join(clientDir, "escape.txt"));

    const db = openDatabase(":memory:");
    migrate(db);
    const game = createGame({
      db,
      send: () => {},
      isoNow: () => "2026-11-14T00:00:00.000Z",
      rng: scriptedRng([1]),
      kick: () => {},
      dropOtherSessions: () => {},
    });
    gateway = startGateway({
      port: 0,
      development: false,
      game,
      clock: systemClock,
      assetsDir,
      clientDir,
    });
  });

  afterAll(async () => {
    await gateway.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test("serves /, /index.html, JS, CSS, PNG and /assets/ with MIME types and security headers", async () => {
    for (const [path, mime, needle] of [
      ["/", "text/html", "<title>Test</title>"],
      ["/index.html", "text/html", "<title>Test</title>"],
      ["/app-123.js", "text/javascript", "console.log('ok')"],
      ["/styles.css", "text/css", "body { color: #000; }"],
      ["/sub/icon.png", "image/png", null],
      ["/assets/ui.png", "image/png", null],
    ] as const) {
      const res = await fetch(new URL(path, gateway.url));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(mime);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
      const body = await res.text();
      if (needle) {
        expect(body).toContain(needle);
      } else {
        expect(body.length).toBeGreaterThan(0);
      }
    }
  });

  test("HEAD returns GET headers with an empty body", async () => {
    const getRes = await fetch(new URL("/app-123.js", gateway.url));
    const headRes = await fetch(new URL("/app-123.js", gateway.url), { method: "HEAD" });
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("content-type")).toBe(getRes.headers.get("content-type"));
    expect(headRes.headers.get("content-length")).toBe(getRes.headers.get("content-length"));
    expect(headRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await headRes.text()).toBe("");
  });

  test("rejects unknown paths, directory requests, traversal and symlink escapes with 404", async () => {
    for (const bad of [
      "/missing",
      "/sub",
      "/sub/",
      "/..%2fsecret.txt",
      "/%2e%2e%2fsecret.txt",
      "/sub%2f..%2f..%2fsecret.txt",
      "/escape.txt",
      "/assets/..%2f..%2fsecret.txt",
      "/%00",
    ]) {
      const res = await fetch(new URL(bad, gateway.url));
      expect(res.status).toBe(404);
    }

    // Raw un-normalized request line (bypasses URL parser dot-segment normalization).
    const url = new URL(gateway.url);
    const rawStatus = await new Promise<string>((resolve, reject) => {
      let buf = "";
      Bun.connect({
        hostname: url.hostname,
        port: Number(url.port),
        socket: {
          open(socket) {
            socket.write(
              `GET /../secret.txt HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`,
            );
          },
          data(_socket, chunk) {
            buf += Buffer.from(chunk).toString("utf8");
          },
          close() {
            resolve(buf.split("\r\n")[0] ?? "");
          },
          error(_socket, err) {
            reject(err);
          },
        },
      }).catch(reject);
    });
    expect(rawStatus).toContain("404");
  });

  test("fails startup with a build instruction when the prebuilt client directory is missing", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const game = createGame({
      db,
      send: () => {},
      isoNow: () => "2026-11-14T00:00:00.000Z",
      rng: scriptedRng([1]),
      kick: () => {},
      dropOtherSessions: () => {},
    });
    expect(() =>
      startGateway({
        port: 0,
        development: false,
        game,
        clock: systemClock,
        assetsDir,
        clientDir: join(root, "does-not-exist"),
      }),
    ).toThrow(/bun run build/);
  });

  test("development mode starts and serves the HTML entry without a prebuilt clientDir", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const game = createGame({
      db,
      send: () => {},
      isoNow: () => "2026-11-14T00:00:00.000Z",
      rng: scriptedRng([1]),
      kick: () => {},
      dropOtherSessions: () => {},
    });
    const devGw = startGateway({
      port: 0,
      development: true,
      game,
      clock: systemClock,
      assetsDir,
    });
    try {
      const res = await fetch(devGw.url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("<title>Second Star Online</title>");
    } finally {
      await devGw.stop();
    }
  });
});

describe("each installed pack's art is served under /assets/packs/<id>/", () => {
  let root = "";
  let gateway: Gateway;
  let classicInstalled = true;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "sso-gw-art-"));
    const engine = join(root, "engine");
    const art = join(root, "classic-art");
    mkdirSync(join(engine, "sounds"), { recursive: true });
    mkdirSync(join(art, "sounds"), { recursive: true });
    const none = { sheets: [], sprites: {} };
    writeFileSync(
      join(engine, "index.json"),
      JSON.stringify({
        version: 1,
        inputHash: "x",
        atlases: { tiles: none, bodies: none, paperdoll: none, fx: none, items: none },
        ui: { "internal:1": { file: "ui/internal-1.png", w: 1, h: 1, regX: 0, regY: 0 } },
        sounds: { clicksound: "sounds/clicksound.wav" },
      }),
    );
    const atlas = { sheets: ["tiles-0.png"], sprites: { g1: [0, 0, 0, 32, 32, 0, 0] } };
    writeFileSync(
      join(art, "index.json"),
      JSON.stringify({
        version: 1,
        inputHash: "x",
        atlases: { tiles: atlas, bodies: none, paperdoll: none, fx: none, items: none },
        sounds: { hitsound: "sounds/hitsound.wav" },
      }),
    );
    writeFileSync(join(art, "tiles-0.png"), new Uint8Array([137, 80, 78, 71]));
    writeFileSync(join(art, "sounds", "hitsound.wav"), new Uint8Array([82, 73, 70, 70]));
    const db = openDatabase(":memory:");
    migrate(db);
    gateway = startGateway({
      port: 0,
      development: false,
      game: createGame({
        db,
        send: () => {},
        isoNow: () => "2026-11-22T00:00:00.000Z",
        rng: scriptedRng([1]),
        kick: () => {},
        dropOtherSessions: () => {},
      }),
      clock: systemClock,
      assetsDir: engine,
      packArt: () => (classicInstalled ? [{ id: "classic", artDir: art }] : []),
    });
  });

  afterAll(async () => {
    await gateway.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const get = (path: string) => fetch(new URL(path, gateway.url));

  test("the index merges the pack's atlases and sounds into the engine's art", async () => {
    const index = await (await get("/assets/index.json")).json();
    expect(index.atlases.tiles.sheets).toEqual(["packs/classic/tiles-0.png"]);
    expect(index.atlases.tiles.sprites.g1[0]).toBe(0);
    expect(index.sounds).toEqual({
      clicksound: "sounds/clicksound.wav",
      hitsound: "packs/classic/sounds/hitsound.wav",
    });
    expect(index.ui["internal:1"]).toBeDefined();
    expect((await get("/assets/packs/classic/tiles-0.png")).status).toBe(200);
    expect((await get("/assets/packs/classic/sounds/hitsound.wav")).status).toBe(200);
    expect((await get("/assets/packs/classic/..%2f..%2fengine%2findex.json")).status).toBe(404);
    expect((await get("/assets/packs/other/tiles-0.png")).status).toBe(404);
  });

  test("without the pack installed, none of its art is sent", async () => {
    classicInstalled = false;
    try {
      const index = await (await get("/assets/index.json")).json();
      expect(index.atlases.tiles).toEqual({ sheets: [], sprites: {} });
      expect(index.sounds).toEqual({ clicksound: "sounds/clicksound.wav" });
      // The interface's own art is the engine's.
      expect(index.ui["internal:1"]).toBeDefined();
      expect((await get("/assets/packs/classic/tiles-0.png")).status).toBe(404);
    } finally {
      classicInstalled = true;
    }
  });
});

describe("merging pack art", () => {
  test("a later pack's sheets follow the earlier ones, and its sprites point at them", () => {
    const none = { sheets: [], sprites: {} };
    const atlases = (sheet: string, name: string) => ({
      tiles: {
        sheets: [sheet],
        sprites: {
          [name]: [0, 1, 2, 3, 4, 5, 6] as [number, number, number, number, number, number, number],
        },
      },
      bodies: none,
      paperdoll: none,
      fx: none,
      items: none,
    });
    const merged = mergePackArt(
      {
        version: 1,
        inputHash: "",
        atlases: { ...atlases("e.png", "e"), tiles: none },
        ui: {},
        sounds: {},
      },
      [
        {
          id: "a",
          art: {
            version: 1,
            inputHash: "",
            atlases: atlases("t.png", "x"),
            sounds: { s: "s.wav" },
          },
        },
        {
          id: "b",
          art: {
            version: 1,
            inputHash: "",
            atlases: atlases("t.png", "x"),
            sounds: { s: "s2.wav" },
          },
        },
      ],
    );
    expect(merged.atlases.tiles.sheets).toEqual(["packs/a/t.png", "packs/b/t.png"]);
    expect(merged.atlases.tiles.sprites.x?.[0]).toBe(1);
    expect(merged.sounds.s).toBe("packs/b/s2.wav");
  });
});
