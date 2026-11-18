/**
 * What a fixed, seeded 20-player crowd costs in traffic and writes, pinned so a later change that
 * multiplies either fails here. In-process with the manual clock and a seeded RNG, so the counts
 * repeat run to run; the wall-clock numbers stay in `bun run perf`.
 *
 * The pin is a ceiling at 120 % of the numbers recorded when the pin was recorded: a
 * fix that lowers traffic passes, and its author lowers the pin in the same change.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { emptyBag, NO_EQUIPMENT } from "@secondstaronline/shared";

import { saveInventory } from "../src/persistence/inventory.ts";
import { saveSpellbook } from "../src/persistence/spells.ts";
import { seededRng } from "../src/rng.ts";
import {
  connectBot,
  idOf,
  login,
  make,
  place,
  settle,
  startTestServer,
  type TestServer,
  tick,
} from "./harness.ts";

/**
 * Recorded when the pin was set (2026-11-10, this host: 4,671-4,691 messages, 1.145 MB, 43 rows
 * over three runs); a run may use up to 120 % of each. Re-recorded 2026-11-18 (4,814-4,834
 * messages, 1.135 MB, 64 rows): a walk off the seed map's edge is now refused instead of warping
 * to the start point, so bots no longer sit out the 100-tick load lock and keep fighting, which
 * saves more kills and skill gains.
 */
const RECORDED = { messages: 4830, bytes: 1136000, rows: 64 };
const CEILING = 1.2;

const BOTS = 20;
const TICKS = 200;
const BLOCK = 10;

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let server: TestServer | undefined;
afterAll(async () => {
  await server?.stop();
});

describe("traffic pin", () => {
  test("a 20-player crowd for 200 ticks stays under its pinned traffic", async () => {
    server = startTestServer({ rng: seededRng(8) });
    const names = Array.from({ length: BOTS }, (_, i) =>
      `Crowd${String.fromCharCode(97 + i)}`.replace(/\d/g, ""),
    );
    for (const [i, name] of names.entries()) {
      const b = await connectBot(server.wsUrl);
      b.send(make(name, i < 2 ? 2 : 1));
      await b.waitFor((m) => m.t === "created");
      b.close();
    }
    // Kits: the first two cast Fireball, the next four swing a Knife. Placed on spread tiles.
    for (const [i, name] of names.entries()) {
      const id = idOf(server.db, name);
      place(server.db, name, "x1000y992", 2 + (i % 5) * 3, 2 + Math.floor(i / 5) * 2);
      const bag = emptyBag();
      const equip = { ...NO_EQUIPMENT };
      if (i < 2) {
        server.db.run("UPDATE characters SET dex = 20, sp = 200, sp_max = 200 WHERE id = ?", [id]);
        saveSpellbook(server.db, id, ["Fireball"]);
        bag[0] = { item: "Red Crystals", qty: 500 };
      } else if (i < 6) {
        equip.weapon = "Knife";
      }
      saveInventory(server.db, id, { gold: 0, bag, equip }, "2026-11-04T00:00:00.000Z");
    }
    const bots = [];
    for (const name of names) {
      bots.push(await login(server, name));
    }
    server.stats(); // start counting here
    const db = server.db;
    const changes = () =>
      Number((db.query("SELECT total_changes() AS n").get() as { n: number }).n);
    const rowsBefore = changes();
    const rand = seeded(8);
    const dirs = ["L", "R", "U", "D", null] as const;
    let seq = 0;
    for (let t = 0; t < TICKS; t += BLOCK) {
      for (const [i, bot] of bots.entries()) {
        bot.send({
          t: "move",
          seq: ++seq,
          held: dirs[Math.floor(rand() * dirs.length)] ?? null,
          turn: false,
        });
        if (i >= 2 && i < 6) {
          bot.send({ t: "attack", seq: ++seq, held: (t / BLOCK) % 2 === 0 });
        }
        if (i < 2 && (t / BLOCK) % 3 === 0) {
          bot.send({ t: "cast", spell: "Fireball", x: 8 * 32 + 14, y: 6 * 32 + 15 });
        }
        if (t % 40 === 0) {
          bot.send({ t: "chat", text: `line ${t} from ${i}` });
        }
      }
      await tick(server, BLOCK);
    }
    await settle();
    const { gateway, droppedTicks } = server.stats();
    const rows = changes() - rowsBefore;
    const got = { messages: gateway.messagesOut, bytes: gateway.bytesOut, rows };
    const report = `recorded: ${JSON.stringify(RECORDED)}; this run: ${JSON.stringify(got)}`;
    expect(droppedTicks).toBe(0);
    expect(server.faults).toEqual([]);
    // Not a silent no-op: the crowd really moved and talked.
    expect(got.messages, report).toBeGreaterThan(2000);
    if (RECORDED.messages > 0) {
      expect(got.messages, report).toBeLessThanOrEqual(RECORDED.messages * CEILING);
      expect(got.bytes, report).toBeLessThanOrEqual(RECORDED.bytes * CEILING);
      expect(got.rows, report).toBeLessThanOrEqual(RECORDED.rows * CEILING);
    } else {
      console.log(`traffic pin not recorded yet: ${report}`);
    }
  }, 60000);
});
