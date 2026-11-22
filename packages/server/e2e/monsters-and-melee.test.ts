/**
 * Bot script: an administrator sets the roster, a Slime spawns, a fighter kills it bare-handed for XP, a
 * Slime kills a second bot, everyone sees the death line, the victim respawns, and after a relog
 * and a server restart the XP, the vitals and a damaged monster are all still there.
 *
 * The RNG is the script's: a size with nothing queued answers `n`, which matches only
 * `random(1)` (no spawn, no move, no monster attack, no hunger loss).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CreateMsg, DeltaEvent, ServerMsg, VitalsView } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import type { Db } from "../src/persistence/database.ts";
import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, face, settle, startTestServer, type TestServer } from "./harness.ts";

const NOW = "2026-11-05T00:00:00.000Z";
type Chat = Extract<ServerMsg, { t: "chat" }>;

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

/** Per-size answer queues; empty → `n`. */
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

const chatTexts = (bot: Bot) =>
  bot.inbox.filter((m): m is Chat => m.t === "chat").map((m) => m.text);
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const lastVitals = (bot: Bot): VitalsView | undefined =>
  bot.inbox.filter((m) => m.t === "vitals").at(-1)?.vitals as VitalsView | undefined;

describe("monsters, melee and XP", () => {
  const dbPath = join(tmpdir(), `sso-slice3-${process.pid}-${Date.now()}.sqlite`);
  let server: TestServer;
  let gm: Bot;
  let fighter: Bot;
  let victim: Bot;

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
    server = startTestServer({ rng, dbPath });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Gm", "Fighter", "Victim"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const acc = server.db.query<{ id: string }, [string]>(
      "SELECT id FROM accounts WHERE username = ?",
    );
    setRole(server.db, acc.get("Gm")?.id ?? "", "administrator", NOW);
    place(server.db, "Gm", 2, 11);
    place(server.db, "Fighter", 6, 4); // the test turns it north after login (face)
    place(server.db, "Victim", 14, 11);
  });
  afterAll(async () => {
    await server.stop();
    await Bun.file(dbPath).delete();
  });

  test("an administrator lists and sets the roster; a player's /roster is an unknown command", async () => {
    gm = await login("Gm");
    fighter = await login("Fighter");
    face(server, "Fighter", "N"); // staging: 1.6 logs in facing south
    gm.send({ t: "chat", text: "/roster" });
    gm.send({ t: "chat", text: "/roster 1 slime" });
    await settle();
    expect(chatTexts(gm).slice(-2)).toEqual([
      "Roster of x1000y992: 1 Slime, 2 (empty), 3 (empty), 4 (empty)",
      "Roster slot 1 is now Slime.",
    ]);
    fighter.send({ t: "chat", text: "/roster 1 clear" });
    await settle();
    expect(chatTexts(fighter).at(-1)).toBe('Unknown command "/roster".');
  });

  test("after the 45-frame entry wait a Slime spawns where the rolls say, for everyone", async () => {
    await tick(50);
    gm.clear();
    fighter.clear();
    // Two players on the map: the gate is 1/120. Then tile (6,3) just north of
    // the fighter, random(5) = 1, facing random(4) = 2 (S).
    queue(120, 1);
    queue(17, 6);
    queue(12, 3);
    queue(5, 1);
    queue(4, 2);
    await tick(1);
    const spawn = deltas(fighter).find((e) => e.e === "mspawn");
    expect(spawn).toMatchObject({
      e: "mspawn",
      monster: { slot: 1, name: "Slime", body: 30, x: 6, y: 3, facing: "S" },
    });
    expect(deltas(gm).some((e) => e.e === "mspawn")).toBe(true);
  });

  test("design change: no power bar: waiting adds nothing; holding swings every 14 frames for 2; the 14 HP Slime dies on the 8th hit for 23 XP", async () => {
    fighter.clear();
    gm.clear();
    fighter.send({ t: "attack", seq: 1, held: true });
    await tick(8 * 15);
    fighter.send({ t: "attack", seq: 2, held: false });
    await tick(1);
    const swings = deltas(fighter).filter((e) => e.e === "swing");
    const hits = deltas(fighter).filter((e) => e.e === "mhit");
    expect(swings.length).toBe(9); // every 14 frames over 120 frames
    // 51 frames since login: 1.6's bar would have added +5 to the first swing; SSO adds nothing.
    expect(swings[0]).toMatchObject({ sound: "swordswing", atDelay: 14 });
    expect(swings.every((s) => s.e === "swing" && !("bonus" in s))).toBe(true);
    // AttPower 1 + STR tiers 2 + Thrust 1 = 4, less Defense 2, on every swing: 14 HP goes below 0
    // on the 8th (1.6's +5 first swing killed it on the 5th).
    expect(hits.map((h) => (h.e === "mhit" ? h.dmg : 0))).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect(hits.at(-1)).toMatchObject({ kill: true });
    expect(deltas(gm).filter((e) => e.e === "mhit")).toHaveLength(8);
    expect(lastVitals(fighter)).toMatchObject({ exp: 23, level: 1 });
    // No line for a kill or for XP.
    expect(chatTexts(fighter)).toEqual([]);
  });

  test("a Slime kills the second bot; everyone online sees the death line; it respawns", async () => {
    victim = await login("Victim");
    await tick(50);
    for (const b of [gm, fighter, victim]) {
      b.clear();
    }
    // Three players: the gate is 1/230. A Slime spawns on the victim's east side.
    queue(230, 1);
    queue(17, 15);
    queue(12, 11);
    queue(5, 1);
    queue(4, 3);
    await tick(1);
    expect(deltas(victim).some((e) => e.e === "mspawn")).toBe(true);
    // Hits of 1 + 3 = 4 (parry and block draws at their maximum), 40 frames of i-frames apart.
    // The monster rolls random(10) once per player, in login order: Gm, Fighter, Victim.
    // Regen gives 1 HP back 148 frames after login, so the sixth hit kills: 20 → 0.
    for (let i = 0; i < 6; i++) {
      queue(10, 10, 10, 1);
      queue(3, 3);
      await tick(40);
    }
    const floaties = deltas(victim).filter((e) => e.e === "phit");
    expect(floaties.map((e) => (e.e === "phit" ? e.text : ""))).toEqual([
      "4",
      "4",
      "4",
      "4",
      "4",
      "4",
    ]);
    expect(floaties[0]).toMatchObject({ color: 6 });
    await tick(30);
    const line = "*** Victim was just killed by a Slime.";
    for (const b of [gm, fighter, victim]) {
      expect(chatTexts(b)).toContain(line);
    }
    const snap = victim.inbox.filter((m) => m.t === "snapshot").at(-1);
    // Back at its respawn point: the starting map's tile, where it was created.
    expect(snap).toMatchObject({ t: "snapshot", self: { x: 6, y: 4, facing: "S" } });
    // HP and SP were set to 1; regen keeps running through the death lock.
    const v = lastVitals(victim);
    expect(v).toMatchObject({ hpMax: 20, spMax: 20 });
    expect(v?.hp).toBeLessThanOrEqual(2);
    victim.send({ t: "mapReady" });
    await tick(1);
  });

  test("a relog keeps XP and vitals; a restart keeps the damaged monster", async () => {
    fighter.close();
    victim.close();
    gm.close();
    await settle(60);
    const slot = server.db
      .query<{ live_name: string | null; hp: number }, []>(
        "SELECT live_name, hp FROM map_slots WHERE slot = 1",
      )
      .get();
    expect(slot).toMatchObject({ live_name: "Slime", hp: 14 });
    server.db.run("UPDATE map_slots SET hp = 6 WHERE slot = 1");
    await server.stop();
    server = startTestServer({ rng, dbPath });
    fighter = await login("Fighter");
    face(server, "Fighter", "N"); // staging: 1.6 logs in facing south
    await tick(1);
    expect(lastVitals(fighter)).toMatchObject({ exp: 23, level: 1 });
    const snap = fighter.inbox.find((m) => m.t === "snapshot");
    expect(snap).toMatchObject({ monsters: [{ slot: 1, name: "Slime", x: 15, y: 11 }] });
    fighter.close();
    await settle(60);
  });
});
