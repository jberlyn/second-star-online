import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemClock } from "../src/clock.ts";
import { createGame } from "../src/game.ts";
import { type Gateway, startGateway } from "../src/gateway/server.ts";
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
