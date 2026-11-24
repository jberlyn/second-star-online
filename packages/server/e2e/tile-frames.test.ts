/**
 * Bot script (issue #29, stage 6): an administrator's tile change is one WebSocket frame, and the
 * page splits a big tileset into changes that each fit the editor frame allowance
 * (`EDITOR_MESSAGE_BYTES`). The largest chunk `chunkNewTiles` makes reaches the server and is
 * answered, not dropped by the gateway.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  type ClientMsg,
  type CreateMsg,
  chunkNewTiles,
  EDITOR_MESSAGE_BYTES,
} from "@secondstaronline/shared";

import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

const make = (name: string): CreateMsg => ({
  t: "create",
  name,
  password: "secret",
  sex: 1,
  head: 1,
  classCode: 1,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
});

describe("tile changes on the wire", () => {
  let server: TestServer;
  let alice: Bot;

  beforeAll(async () => {
    server = startTestServer();
    const bot = await connectBot(server.wsUrl);
    bot.send(make("Alice"));
    await bot.waitFor((m) => m.t === "created");
    bot.close();
    server.db.run(
      "UPDATE accounts SET role = 'administrator' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    alice = await connectBot(server.wsUrl);
    alice.send({ t: "login", name: "Alice", password: "secret" });
    await alice.waitFor((m) => m.t === "snapshot");
    alice.send({ t: "mapReady" });
    await settle();
  });
  afterAll(async () => {
    await server.stop();
  });

  test("the largest chunk of a big tileset reaches the server and is answered", async () => {
    // A 768×512 tileset (384 cells), every tile named with the longest name in 3-byte characters.
    const tiles = Array.from({ length: 384 }, (_, i) => ({
      file: (i % 10).toString().repeat(64),
      walkable: true,
      name: "雪".repeat(80),
    }));
    const chunks = chunkNewTiles(tiles);
    expect(chunks.length).toBeGreaterThan(1);
    const biggest = chunks.reduce((a, b) =>
      JSON.stringify(a).length >= JSON.stringify(b).length ? a : b,
    );
    const msg: ClientMsg = {
      t: "contentTile",
      seq: 2 ** 31,
      change: { op: "add", transparency: "alpha", tiles: biggest },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(msg)).length;
    expect(bytes).toBeLessThanOrEqual(EDITOR_MESSAGE_BYTES);
    // Most of the allowance is used: the check is near the limit.
    expect(bytes).toBeGreaterThan(EDITOR_MESSAGE_BYTES / 2);
    alice.clear();
    alice.send(msg);
    // The files were never uploaded, so the server refuses it: the point is that it answers.
    const reply = await alice.waitFor((m) => m.t === "contentResult");
    expect(reply).toMatchObject({ t: "contentResult", seq: 2 ** 31, ok: false });
  });
});
