/**
 * Bot script: an administrator Alice spawns a roster monster that never moves (Illusionary Spikes, body
 * 90) in front of her and holds the arrow toward it: she stays and faces it. Then a Web in slot 2
 * (which her client was shown) still leaves the Spikes blocking, and she can walk onto the Web.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg } from "@secondstaronline/shared";

import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

const make = (name: string): CreateMsg => ({
  t: "create",
  name,
  password: "secret",
  sex: 1,
  head: 1,
  classCode: 2,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
});

const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

describe("monster blocking", () => {
  let server: TestServer;
  let alice: Bot;
  let seq = 0;

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const say = async (text: string) => {
    alice.send({ t: "chat", text });
    await settle();
  };
  const turn = (dir: "L" | "R" | "U" | "D") =>
    alice.send({ t: "step", seq: ++seq, dir, turn: true });
  const hold = (dir: "L" | "R" | "U" | "D" | null) =>
    alice.send({ t: "move", seq: ++seq, held: dir, turn: false });
  const aliceTile = (): { x: number; y: number } => {
    const p = [...server.game.world.players.values()].find((o) => o.name === "Alice");
    if (!p) {
      throw new Error("Alice is not in the world");
    }
    return { x: p.x, y: p.y };
  };

  beforeAll(async () => {
    server = startTestServer({
      rng,
      prepare: (db) => {
        db.run(
          `INSERT OR REPLACE INTO map_slots (map_id, slot, species, live_name, hp, x, y, facing, home_x, home_y, updated_at)
           SELECT id, 1, 'Illusionary Spikes', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-08T00:00:00.000Z' FROM maps WHERE mx = 1000 AND my = 992 AND slot = 0`,
        );
        db.run(
          `INSERT OR REPLACE INTO map_slots (map_id, slot, species, live_name, hp, x, y, facing, home_x, home_y, updated_at)
           SELECT id, 2, 'Web', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-11-08T00:00:00.000Z' FROM maps WHERE mx = 1000 AND my = 992 AND slot = 0`,
        );
      },
    });
    const bot = await connectBot(server.wsUrl);
    bot.send(make("Alice"));
    await bot.waitFor((m) => m.t === "created");
    bot.close();
    server.db.run(
      "UPDATE accounts SET role = 'administrator' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
  });
  afterAll(async () => {
    await server.stop();
  });

  test("a spawned Spikes in front blocks Alice: held 40 ticks, she stays and faces it", async () => {
    alice = await connectBot(server.wsUrl);
    alice.send({ t: "login", name: "Alice", password: "secret" });
    await alice.waitFor((m) => m.t === "snapshot");
    alice.send({ t: "mapReady" });
    await settle();
    await tick(2);
    turn("R");
    await tick(2);
    await say("/spawn 1");
    await tick(1);
    alice.clear();
    hold("R");
    await tick(40);
    hold(null);
    await tick(1);
    expect(aliceTile()).toEqual({ x: 6, y: 6 });
    expect(alice.inbox.some((m) => m.t === "chat")).toBe(false);
  });

  test("bug fixed: a Web in slot 2 does not clear the Spikes' block; Alice walks onto the Web", async () => {
    turn("U");
    await tick(2);
    await say("/spawn 2");
    await tick(1);
    const web = server.game.world.rooms.get("x1000y992")?.map.slots[1]?.live;
    expect(web).toMatchObject({ name: "Web", x: 6, y: 5 });
    hold("R");
    await tick(3);
    hold(null);
    await tick(1);
    expect(aliceTile()).toEqual({ x: 6, y: 6 });
    hold("U");
    await tick(3);
    hold(null);
    await tick(1);
    expect(aliceTile()).toEqual({ x: 6, y: 5 });
  });
});
