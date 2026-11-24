/**
 * Issue #31, stage 0: the safety net for the monster editor. Every Classic monster and NPC name
 * (the species records, every editor list, every name a monster table names, and two names no row
 * knows) goes through the game's own readers:
 *
 * - every monster rule table's answer (sea, footprint, hostile and leaning, officer, spares the
 *   innocent, clears its block, names itself, no quests, never casts, the kill-XP override and
 *   broadcast), the NPC and monster lists, the body and defense a live name is drawn and hit with;
 * - melee damage from every weapon family the affinity rows name (and a plain sword and bare hands)
 *   at a low and a high attack power, rolled low and high, with every draw;
 * - the kill skill cap at each Intelligence tier, and melee kill XP with and without the Ring of
 *   Experience;
 * - the monster spells each species casts, by player count, provoked or not, on a fight and a
 *   no-fight map, rolled low (each spell it casts, with its draws) and high (the draws only); and
 *   every spell kind cast by a species that may cast and by one that never does;
 * - the loot each species drops for every line it could draw, and the draws;
 * - the spawn and move ladders, a spawn pass with a faction swap, an NPC and a sea creature (on a
 *   dry map and on an all-water one, where it spawns), the mover pass as the tick runs it (each slot
 *   picked, and past the roster, by players), and a walk's authoring for a leaning, a wandering and
 *   a still species;
 * - every name in the raw spellings a live name can come in (another case, spaces, a suffix).
 *
 * The result must equal the golden recorded before the monster rules changed shape:
 * `fixtures/monster-golden.json`. Write it afresh with
 * `MONSTER_GOLDEN=write bun test tests/monster-golden.test.ts` only for a deliberate change to how
 * Classic's monsters play, then `bunx biome format --write` the file.
 */
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { content, rollLoot } from "@secondstaronline/shared";

import { authorPath, moveLadder, moverPass } from "../src/systems/monsters/ai.ts";
import { npcFileNamed, setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { spawnLadder, spawnPass } from "../src/systems/monsters/spawn.ts";
import { monsterSpells } from "../src/systems/spells/monsterspells.ts";
import type { Room } from "../src/systems/world/world.ts";
import { names, plays, recorder, spellings } from "./helpers/monster-plays.ts";
import { ARCHIVE_NPCS, player, testMap } from "./helpers/sim.ts";

const GOLDEN = join(import.meta.dir, "fixtures", "monster-golden.json");

function slotWith(name: string): MonsterSlot {
  return {
    slot: 1,
    species: name,
    live: {
      name,
      hp: 10,
      x: 9,
      y: 6,
      facing: "S",
      anim: 0,
      fromX: 9,
      fromY: 6,
      queue: [],
      hitCountb: 0,
    },
    pause: 0,
    dirty: false,
  };
}

/** The spells a species casts: each case's cast messages (rolled low) and draws (low and high). */
function casts(name: string, npcs = ARCHIVE_NPCS): Record<string, string> | null {
  if ((npcFileNamed(npcs, name)?.spells ?? []).length === 0) {
    return null;
  }
  const out: Record<string, string> = {};
  // Every tier of each spell's ladder (1 … 7 players) and one past it.
  for (const players of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const provoked of [false, true]) {
      for (const noFight of [false, true]) {
        for (const at of ["low", "high"] as const) {
          const map = testMap("x1000y992");
          map.flags.canFight = noFight ? "O" : "";
          map.slots[0] = slotWith(name);
          const ps = Array.from({ length: players }, (_, i) =>
            player(`P${i}`, map, 3 + i, 9 + (i % 2)),
          );
          const p = ps[0] as (typeof ps)[number];
          p.npcAttackFlag = provoked;
          const room: Room = { map, npcs, players: ps, fx: [], fxQueue: [], doorLock: 0 };
          const rng = recorder(at);
          monsterSpells(room, p, rng);
          const sent = room.fxQueue.map(
            (c) => `${c.owner}:${c.name}@${c.casterH},${c.casterV}>${c.h},${c.v}*${c.power}`,
          );
          out[
            `${players}|${provoked ? "provoked" : "calm"}|${noFight ? "nofight" : "fight"}|${at}`
          ] = `${sent.join(";")}|${rng.draws.join(",")}`;
        }
      }
    }
  }
  return out;
}

/** Every spell kind, cast by a species that may cast and by one that never does (Cow). */
function everyKind(): Record<string, Record<string, string> | null> {
  const npcs = new Map(ARCHIVE_NPCS);
  const tags = content()
    .monsters.casting.spells.map((s) => `SPL|${s.tag}`)
    .join("\r");
  const out: Record<string, Record<string, string> | null> = {};
  for (const name of ["Golden Caster", "Cow"]) {
    setNpcFile(npcs, name, `${tags}\r`);
    out[name] = casts(name, npcs);
  }
  return out;
}

/** The loot for each line a species could draw (and a failed roll), with the draws. */
function loot(name: string): string[] | null {
  const lines = npcFileNamed(ARCHIVE_NPCS, name)?.loot ?? [];
  if (lines.length === 0) {
    return null;
  }
  const out: string[] = [];
  for (let k = 1; k <= lines.length; k++) {
    for (const roll of ["hit", "miss"] as const) {
      const rng = recorder((n, i) => (i === 0 ? k : roll === "hit" ? 1 : n));
      out.push(`${k}|${roll}|${rollLoot(lines, rng) ?? "-"}|${rng.draws.join(",")}`);
    }
  }
  return out;
}

/** The spawn pass and the walk authoring, with their draws. */
function spawning() {
  const map = testMap("x1");
  map.flags.fctSpwn = "warrior";
  const roster = ["Slime", "Trimble", "Squid", "Orc"];
  map.slots.forEach((s, i) => {
    s.species = roster[i] ?? null;
  });
  const passes: string[] = [];
  for (const players of [1, 3, 7, 9]) {
    for (const at of ["low", "high"] as const) {
      for (const s of map.slots) {
        s.live = null;
        s.pause = 0;
      }
      const rng = recorder(at);
      const spawned = spawnPass(map, { rng, players, minute: 30 });
      passes.push(
        `${players}|${at}|${spawned.map((s) => `${s.slot}:${s.live?.name}@${s.live?.x},${s.live?.y}${s.live?.facing}`).join(";")}|${rng.draws.join(",")}`,
      );
    }
  }
  // The faction swap's slot pick, each value of it.
  const swaps: string[] = [];
  for (let k = 1; k <= 6; k++) {
    for (const s of map.slots) {
      s.live = null;
      s.pause = 0;
    }
    const rng = recorder((n, i) => (i === 0 ? k : 1));
    const spawned = spawnPass(map, { rng, players: 1, minute: 30 });
    swaps.push(`${k}|${spawned.map((s) => s.live?.name).join(";")}|${rng.draws.join(",")}`);
  }
  // A sea creature spawning: an all-water map, where only the Squid's slot can fill.
  const sea = testMap("x3", [], () => "W1");
  sea.slots.forEach((s, i) => {
    s.species = roster[i] ?? null;
  });
  const seaPasses: string[] = [];
  for (const at of ["low", "high"] as const) {
    for (const s of sea.slots) {
      s.live = null;
      s.pause = 0;
    }
    const rng = recorder(at);
    const spawned = spawnPass(sea, { rng, players: 1, minute: 30 });
    seaPasses.push(
      `${at}|${spawned.map((s) => `${s.slot}:${s.live?.name}@${s.live?.x},${s.live?.y}${s.live?.facing}`).join(";")}|${rng.draws.join(",")}`,
    );
  }
  // The mover as the tick runs it: the pick (each slot, and past the roster), then the walk.
  const moves: string[] = [];
  const mmap = testMap("x4");
  const mover = player("Bo", mmap, 3, 3);
  const live = ["Orc", "Cow", "Slime", "Trimble"];
  for (const players of [1, 2, 8, 9]) {
    for (let k = 1; k <= 5; k++) {
      for (const at of ["low", "high"] as const) {
        mmap.slots.forEach((s, i) => {
          const fresh = slotWith(live[i] as string);
          s.species = fresh.species;
          s.live = fresh.live
            ? { ...fresh.live, x: 6 + i * 2, y: 6, fromX: 6 + i * 2, fromY: 6 }
            : null;
          s.pause = 0;
        });
        const rng = recorder((n, i) => (i === 0 ? Math.min(k, n) : at === "low" ? 1 : n));
        const ev = moverPass(ARCHIVE_NPCS, mmap, mover, players, rng, [mover]);
        moves.push(
          `${players}|${k}|${at}|${ev ? `${ev.slot.slot}:${ev.fromX},${ev.fromY}>${ev.slot.live?.x},${ev.slot.live?.y}` : "null"}|${mmap.slots.map((s) => `${s.pause}:${s.live?.queue.join("") ?? ""}`).join(";")}|${rng.draws.join(",")}`,
        );
      }
    }
  }
  const walks: string[] = [];
  const wmap = testMap("x2");
  const author = player("Ann", wmap, 5, 5);
  for (const name of ["Orc", "Cow", "Spikes", "Slime", "Trimble", "Nobody Knows This One"]) {
    for (const at of ["low", "high"] as const) {
      const rng = recorder(at);
      const live = slotWith(name).live;
      const plan = live ? authorPath(ARCHIVE_NPCS, live, author, rng) : null;
      walks.push(
        `${name}|${at}|${plan ? `${plan.queue.join("")}:${plan.chase ? plan.chase.steps : "-"}` : "null"}|${rng.draws.join(",")}`,
      );
    }
  }
  return {
    moveLadder: Array.from({ length: 10 }, (_, i) => moveLadder(i + 1)),
    spawnLadder: Array.from({ length: 9 }, (_, i) => spawnLadder(i + 1)),
    passes,
    swaps,
    seaPasses,
    moves,
    walks,
  };
}

function monsterNow() {
  const byName: Record<string, unknown> = {};
  for (const name of names()) {
    byName[name] = { ...plays(name), casts: casts(name), loot: loot(name) };
  }
  for (const name of names().filter((n) => n !== "")) {
    for (const raw of spellings(name)) {
      byName[`raw:${raw}`] = plays(raw);
    }
  }
  return { byName, everyKind: everyKind(), spawning: spawning() };
}

test("every Classic monster plays as recorded before the monster editor (#31 stage 0)", () => {
  const now = JSON.parse(JSON.stringify(monsterNow()));
  if (process.env.MONSTER_GOLDEN === "write") {
    writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  expect(now).toEqual(golden);
});

test("the golden covers what the editor moves", () => {
  const g = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const byName = g.byName as Record<string, { rules: Record<string, unknown>; damage?: unknown }>;
  // Sword of Hope's random rows are crossed, and every rule table answers yes somewhere.
  const hope = Object.values(byName).flatMap((v) =>
    Object.entries((v.damage ?? {}) as Record<string, string>).filter(
      ([k, d]) => k.includes("Hope") && d.split("|")[2]?.includes("6"),
    ),
  );
  expect(hope.length).toBeGreaterThan(0);
  for (const rule of [
    "sea",
    "footprint",
    "hostile",
    "officer",
    "sparesInnocent",
    "clearsBlock",
    "namesSelf",
    "noQuests",
    "neverCasts",
  ]) {
    expect(Object.values(byName).some((v) => v.rules[rule] === true)).toBe(true);
  }
  expect(Object.values(byName).some((v) => v.rules.killXp !== null)).toBe(true);
  expect(Object.values(byName).some((v) => v.rules.killBroadcast !== null)).toBe(true);
  // A sea creature spawns, and the mover picks (and walks) every slot.
  expect(g.spawning.seaPasses.some((p: string) => p.includes(":Squid@"))).toBe(true);
  // (A picked slot takes a pause; some walk, as the Orc and Slime do.)
  for (const k of [1, 2, 3, 4]) {
    const picked = (m: string) => Number(m.split("|")[4]?.split(";")[k - 1]?.split(":")[0]) > 0;
    expect(g.spawning.moves.some(picked)).toBe(true);
  }
  expect(g.spawning.moves.some((m: string) => m.split("|")[3] !== "null")).toBe(true);
  // Every tier of a spell ladder is asked.
  expect(Object.keys(g.everyKind["Golden Caster"]).some((k) => k.startsWith("7|"))).toBe(true);
  // Every spell kind casts at least once.
  const kinds = new Set(content().monsters.casting.spells.map((s) => s.name));
  const sent = JSON.stringify(g.everyKind["Golden Caster"]);
  for (const k of kinds) {
    expect(sent).toContain(`:${k}`);
  }
});
