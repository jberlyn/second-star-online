/**
 * Bot script: the server serves the 37 sounds 1.6 plays; the sounds the server drives
 * reach everyone on the map: Alice's swing (`swordswing`), her hit and kill on a Slime (`mhit`, the
 * client's `hitsound` and `fx`) and her PvP hit on Bob (the `hitsound` floatie); and an unequip
 * during Ctrl's pause is refused,, as the boxes' own test does, which is also what keeps their
 * click silent.
 *
 * The RNG is the script's: a size with nothing queued answers `n`, which matches only
 * `random(1)` (no spawn, no move, no monster attack, no hunger loss, no parry).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { CreateMsg, DeltaEvent, InventoryView } from "@secondstaronline/shared";

import { buildAssets } from "../../data/build/assets.ts";
import { SOUNDS } from "../../data/build/assets-lib/select.ts";
import type { Db } from "../src/persistence/database.ts";
import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, face, settle, startTestServer, type TestServer } from "./harness.ts";

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

const queues: Record<number, number[]> = {};
const rng: Rng = {
  random(n) {
    if (!(n >= 1)) {
      return 0;
    }
    const q = queues[n];
    return q && q.length > 0 ? (q.shift() as number) : n;
  },
};
const queue = (n: number, ...answers: number[]) => {
  queues[n] = [...(queues[n] ?? []), ...answers];
};

function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const lastInv = (bot: Bot): InventoryView | undefined =>
  bot.inbox.filter((m) => m.t === "inv").at(-1)?.inv as InventoryView | undefined;

describe("sound effects", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };

  beforeAll(async () => {
    buildAssets(); // skipped when the inputs are unchanged
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    place(server.db, "Alice", 6, 4); // the test turns it north after login (face)
    place(server.db, "Bob", 5, 4); // west of Alice
    alice = await login("Alice");
    face(server, "Alice", "N"); // staging: 1.6 logs in facing south
    bob = await login("Bob");
    await tick(1);
  }, 120_000);
  afterAll(async () => {
    alice?.close();
    bob?.close();
    await settle(60);
    await server.stop();
  });

  test("the server serves the 37 sounds 1.6 plays (plus any added); the church bell is its MP3", async () => {
    const index = (await (
      await fetch(new URL("/assets/index.json", server.url))
    ).json()) as AssetIndex;
    expect(SOUNDS).toHaveLength(37);
    for (const name of SOUNDS) {
      expect(index.sounds[name.toLowerCase()], name).toBeDefined();
    }
    const files = Object.values(index.sounds);
    for (const file of files) {
      const res = await fetch(new URL(`/assets/${file}`, server.url));
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
    const bell = new Uint8Array(
      await (await fetch(new URL(`/assets/${index.sounds.churchy}`, server.url))).arrayBuffer(),
    );
    expect(index.sounds.churchy?.endsWith(".mp3")).toBe(true);
    expect(bell.byteLength).toBe(195_187);
  });

  test("Alice's swing and her kill reach both players with their sounds", async () => {
    await tick(50);
    // Two players: spawn gate 1/120; tile (6,3) north of Alice; random(5) = 1; facing S.
    queue(120, 1);
    queue(17, 6);
    queue(12, 3);
    queue(5, 1);
    queue(4, 2);
    await tick(1);
    expect(deltas(alice).some((e) => e.e === "mspawn")).toBe(true);
    alice.clear();
    bob.clear();
    queue(4, 1); // the loot line
    alice.send({ t: "attack", seq: 1, held: true });
    for (let i = 0; i < 20 && !deltas(alice).some((e) => e.e === "mhit" && e.kill); i++) {
      await tick(15);
    }
    alice.send({ t: "attack", seq: 2, held: false });
    await tick(1);
    for (const bot of [alice, bob]) {
      const events = deltas(bot);
      expect(events).toContainEqual(expect.objectContaining({ e: "swing", sound: "swordswing" }));
      expect(events).toContainEqual(expect.objectContaining({ e: "mhit", kill: false }));
      expect(events).toContainEqual(expect.objectContaining({ e: "mhit", kill: true }));
    }
  });

  test("Alice's PvP hit gives Bob the splat that carries hitsound", async () => {
    alice.send({ t: "step", seq: 3, dir: "L", turn: true });
    await tick(30);
    alice.clear();
    bob.clear();
    alice.send({ t: "attack", seq: 4, held: true });
    await tick(1);
    alice.send({ t: "attack", seq: 5, held: false });
    await tick(1);
    for (const bot of [alice, bob]) {
      expect(deltas(bot)).toContainEqual(
        expect.objectContaining({ e: "phit", splat: true, color: 6 }),
      );
    }
  });

  test("an unequip during Ctrl's 40-frame pause is refused; after it, it goes", async () => {
    alice.send({ t: "equip", slot: 2 }); // the starting Knife
    await settle();
    expect(lastInv(alice)?.equip.weapon).toBe("Knife");
    await tick(1);
    alice.send({ t: "action" }); // Ctrl on an empty tile still starts the pause
    await settle();
    alice.send({ t: "unequip", slot: "LeftHand" });
    await settle();
    await tick(1);
    expect(lastInv(alice)?.equip.weapon).toBe("Knife");
    await tick(40);
    alice.send({ t: "unequip", slot: "LeftHand" });
    await settle();
    await tick(1);
    expect(lastInv(alice)?.equip.weapon).toBe("NOTHING");
  });
});
