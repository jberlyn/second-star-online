/**
 * Pins for ledger entries in docs/differences-from-fso.md that had no test of their own: the audit
 * log's exceptions, /setclass, the World Editor's exit and text checks, the server's armour-break
 * roll on a monster hit, and a bow's cadence.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { classes: classesData } = classicData;

import {
  ADMIN_TEXT,
  blankMap,
  breakOdds,
  damagedForm,
  exitFromFields,
  HEADER_MAX,
  type ServerMsg,
  SIGN_MAX,
  shattersText,
  swingCooldowns,
} from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import type { Rng } from "../src/rng.ts";
import { saveError } from "../src/systems/admin/worldedit.ts";
import { setAttackHeld } from "../src/systems/combat/melee.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { type Player, statsOf } from "../src/systems/world/world.ts";
import { NEVER_PUSH, player, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const texts = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));

describe("admin commands in the game (real SQLite)", () => {
  let db: Db;
  const sent: Out = [];
  const NOW = "2026-11-06T00:00:00.000Z";

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
  });

  async function start() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
      kick: () => {},
    });
    const make = async (name: string, role?: "administrator") => {
      await game.create({
        t: "create",
        name,
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      });
      const l = await game.login(name, "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, NOW);
      }
      game.enter(l.characterId, false, "10.0.0.1");
      return l;
    };
    return { game, make };
  }

  test("SSO: /inventory, /location, /banlist and an offline /iplookup are not audited; an online /iplookup is", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "administrator");
    const bob = await make("Bob");
    const say = (text: string) => game.intent(alice.characterId, { t: "chat", text });
    say("/Inventory");
    say("/Location");
    say("/banlist");
    say("/banlist Bob");
    game.leave(bob.characterId);
    say("/IPlookup Bob");
    expect(recentAudit(db, 50)).toEqual([]);
    await make("Bob");
    say("/IPlookup Bob");
    expect(recentAudit(db, 50).map((r) => `${r.actor} ${r.command} ${r.target}`)).toEqual([
      "Alice /iplookup Bob",
    ]);
  });

  test("SSO: /setclass takes all 26 classes in any case, records before and after, and leaves skills alone", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "administrator");
    const bob = await make("Bob");
    const live = game.world.players.get(bob.characterId) as Player;
    live.char.skills = live.char.skills.map((_, i) => i % 7);
    const skills = [...live.char.skills];
    expect(classesData.classes).toHaveLength(26);
    for (const [i, c] of classesData.classes.entries()) {
      const typed = i % 2 === 0 ? c.name.toUpperCase() : c.name.toLowerCase();
      sent.length = 0;
      game.intent(alice.characterId, { t: "chat", text: `/setclass Bob ${typed}` });
      expect(texts(sent, alice.characterId)).toEqual([ADMIN_TEXT.classSet("Bob", c.name)]);
      expect(live.char.classCode).toBe(c.code);
      const row = db
        .query<{ class_code: number }, [string]>("SELECT class_code FROM characters WHERE id = ?")
        .get(bob.characterId);
      expect(row?.class_code).toBe(c.code);
    }
    expect(live.char.skills).toEqual(skills);
    const last = recentAudit(db, 1)[0];
    expect([last?.command, last?.target, last?.before, last?.after]).toEqual([
      "/setclass",
      "Bob",
      "25",
      "26",
    ]);
  });
});

describe("World Editor exits and texts", () => {
  test("SSO: an exit needs whole-number map coordinates and a tile on the map, or matching H1/H2 prefixes", () => {
    const m = blankMap(1000, 992);
    expect(saveError(m)).toBeNull();
    m.exit1 = exitFromFields(["1001", "992", "17", "12"]);
    expect(saveError(m)).toBeNull();
    m.exit1 = exitFromFields(["1", "1", "1", "1"]);
    expect(saveError(m)).toBeNull();
    for (const bad of [
      ["1001.5", "992", "5", "5"],
      ["1001", "x", "5", "5"],
      ["1001", "992", "0", "5"],
      ["1001", "992", "18", "5"],
      ["1001", "992", "5", "13"],
      ["1001", "992", "2.5", "5"],
      // Prefixes must match: H1 with H2 is no house.
      ["H1001", "H2992", "5", "5"],
      ["H11001", "H2992", "5", "5"],
    ] as const) {
      m.exit1 = exitFromFields([...bad]);
      expect(saveError(m)).not.toBeNull();
    }
    m.exit1 = exitFromFields(["H15", "H17", "5", "11"]);
    expect(m.exit1).toEqual({ mx: 5, my: 7, x: 5, y: 11, house: 1 });
    expect(saveError(m)).toBeNull();
    m.exit2 = exitFromFields(["h2-3", "H24", "1", "1"]);
    expect(m.exit2).toEqual({ mx: -3, my: 4, x: 1, y: 1, house: 2 });
    expect(saveError(m)).toBeNull();
    // An empty exit is no exit.
    expect(exitFromFields(["", "", "", ""])).toBeNull();
  });

  test("SSO: signs hold at most 1,000 characters and the header 200", () => {
    expect([SIGN_MAX, HEADER_MAX]).toEqual([1000, 200]);
    const m = blankMap(1000, 992);
    m.signs = ["x".repeat(1000), "", "y".repeat(1000)];
    m.header = "h".repeat(200);
    expect(saveError(m)).toBeNull();
    m.signs[1] = "z".repeat(1001);
    expect(saveError(m)).toBe("A header or sign is too long.");
    m.signs[1] = "";
    m.header = "h".repeat(201);
    expect(saveError(m)).toBe("A header or sign is too long.");
  });

  test("SSO: tiles off the palette and monsters off the editor's lists are refused", () => {
    const m = blankMap(1000, 992);
    m.layers[2][3] = m.layers[2][3]?.replace("G3", "QQ") ?? "";
    expect(saveError(m)).not.toBeNull();
    const mob = blankMap(1000, 992);
    mob.mobs[1] = { name: "Pirate King", x: 4, y: 4 };
    expect(saveError(mob)).not.toBeNull();
    mob.mobs[1] = { name: "orc", x: 4, y: 4 };
    expect(saveError(mob)).toBeNull();
  });
});

describe("the server rolls equipment breaks", () => {
  /** An Orc next to `a` that hits on the first `random(10)`; `odds` answers the break draw. */
  function orcHit(breakDraw: number) {
    const map = testMap("x1000y992");
    let odds = 0;
    const calls: number[] = [];
    const rng: Rng = {
      random(n) {
        calls.push(n);
        if (n === 10 || n === 3) {
          return 1;
        }
        return n === odds ? breakDraw : n;
      },
    };
    const { join, run } = setup([map], undefined, rng);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    a.char.equip.body = "Chain Armor";
    join(a);
    odds = breakOdds(statsOf(a).sta, a.char.hunger, 600);
    const slot = map.slots[0] as MonsterSlot;
    slot.species = "Orc";
    slot.pause = 10_000;
    slot.live = {
      name: "Orc",
      hp: 500,
      x: 5,
      y: 6,
      facing: "N",
      anim: 0,
      fromX: 5,
      fromY: 6,
      queue: [],
      hitCountb: 0,
    };
    const out = run(1);
    return { a, out, calls, odds };
  }

  test("SSO: a monster's hit rolls the armour break on the server with the original odds", () => {
    const hit = orcHit(1);
    expect(hit.a.char.vitals.hp).toBeLessThan(20);
    expect(hit.calls).toContain(hit.odds);
    expect(texts(hit.out, "a")).toContain(shattersText("Chain Armor"));
    expect(hit.a.char.equip.body).toBe(damagedForm("Chain Armor"));
    // Any other draw of the same odds breaks nothing.
    const miss = orcHit(2);
    expect(miss.calls).toContain(miss.odds);
    expect(miss.a.char.equip.body).toBe("Chain Armor");
    expect(texts(miss.out, "a")).not.toContain(shattersText("Chain Armor"));
  });
});

describe("bow shots", () => {
  test("SSO: a bow spends its crystal in the tick it shoots, and its attack delay alone sets the cadence", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map]);
    const a = player("Ann", map, 5, 5);
    a.flicker = 0;
    a.facing = "E";
    a.char.equip = { ...a.char.equip, weapon: "Wooden Bow", offHand: "Blue Arrows" };
    a.char.bag[0] = { item: "Blue Crystal", qty: 10 };
    join(a);
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    const shots: number[] = [];
    const crystals: number[] = [];
    for (let t = 1; t <= 60; t++) {
      const out = run(1);
      const swung = out.some(
        (o) => o.to === "Ann" && o.msg.t === "delta" && o.msg.events.some((e) => e.e === "swing"),
      );
      if (swung) {
        shots.push(t);
        crystals.push(a.char.bag[0]?.qty ?? 0);
      }
    }
    expect(shots.length).toBeGreaterThan(2);
    // One crystal per shot, gone in the tick of the shot.
    expect(crystals).toEqual(crystals.map((_, i) => 9 - i));
    // The gap between shots is the bow's attack delay, as for any held swing: no 40-frame
    // item-action pause waiting on an inventory reply.
    const { atDelay } = swingCooldowns(a.char.equip, a.char.skills);
    const gaps = shots.slice(1).map((t, i) => t - (shots[i] as number));
    expect(gaps).toEqual(gaps.map(() => atDelay));
    expect(atDelay).toBeLessThan(40);
  });
});
