/**
 * Retime goldens: 1.6 gives every `actorList` object two `stepFrame` calls per drawn frame,
 * frame-script counters one (measured in the running 1.6). The tick runs the actor phase
 * `STEPFRAMES_PER_FRAME` times; every counter keeps the script's value.
 */
import { describe, expect, test } from "bun:test";

import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";
import { loadSettingOverrides, saveSettingOverride } from "../src/persistence/settings.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { species } from "../src/systems/monsters/slots.ts";
import { setHeld } from "../src/systems/movement/movement.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

/** Ticks (1-based) on which the player's HP changes while its HP is kept low. */
function regenTicks(adventurerBonus: number | null, ticks: number): number[] {
  const map = testMap("x1");
  const { join, run } = setup([map], undefined, rngByN());
  const a = player("a", map, 5, 5);
  if (adventurerBonus !== null) {
    a.char.faction = { key: "adventurer", tier: adventurerBonus };
  }
  a.char.vitals.hpMax = 1000;
  a.char.vitals.spMax = 1000;
  join(a);
  const at: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    a.char.vitals.hp = 10;
    a.char.vitals.sp = 10;
    a.char.hunger = 1000;
    run(1);
    if (a.char.vitals.hp !== 10) {
      at.push(t);
    }
  }
  return at;
}

describe("the timer sprite", () => {
  test("regen every 74 frames at target 149", () => {
    expect(regenTicks(null, 230)).toEqual([74, 148, 222]);
  });
  test("an Adventurer with bonus 0 (target 144) regens 72, 71, 72 frames apart", () => {
    // Odd calls alternate: fires on calls 143, 286, 429, 572 = ticks 72, 143, 215, 286.
    expect(regenTicks(0, 300)).toEqual([72, 143, 215, 286]);
  });
});

describe("the player sprite", () => {
  test("hit flicker lasts 20 frames", () => {
    const map = testMap("x1");
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    a.flicker = 40;
    run(19);
    expect(a.flicker).toBe(2);
    run(1);
    expect(a.flicker).toBe(0);
  });

  test("a held arrow walks a tile every 8 frames", () => {
    const map = testMap("x1");
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 3, 5);
    join(a);
    setHeld(a, "R", false);
    const xs: number[] = [];
    for (let t = 0; t < 17; t++) {
      run(1);
      xs.push(a.x);
    }
    expect(xs).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6]);
  });
});

describe("monsters", () => {
  test("a monster's attack rolls random(10) twice per frame", () => {
    const map = testMap("x1");
    const rng = rngByN();
    const { join, run } = setup([map], undefined, rng);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    join(a);
    const s = map.slots[0] as MonsterSlot;
    s.species = "Slime";
    s.pause = 10_000;
    s.live = {
      name: "Slime",
      hp: species("Slime")?.hp ?? 1,
      x: 5,
      y: 6,
      facing: "N",
      anim: 0,
      fromX: 5,
      fromY: 6,
      queue: [],
      hitCountb: 0,
    };
    rng.calls.length = 0;
    run(1);
    expect(rng.calls.filter((n) => n === 10)).toHaveLength(2);
  });

  test("Pause is a frame-script counter and still lasts 90 frames", () => {
    const map = testMap("x1");
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    const s = map.slots[0] as MonsterSlot;
    s.pause = 90;
    run(89);
    expect(s.pause).toBe(1);
    run(1);
    expect(s.pause).toBe(0);
  });
});

describe("walk speed is not a setting", () => {
  test("the migration removes a stored stepFrames row and leaves the others", () => {
    const db: Db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    const mine = all.filter((m) => m.name.includes("drop_step_frames"));
    expect(mine).toHaveLength(1);
    runMigrations(
      db,
      all.filter((m) => !mine.includes(m)),
    );
    saveSettingOverride(db, "stepFrames", 8, "2026-11-08T00:00:00Z");
    saveSettingOverride(db, "chatMaxChars", 150, "2026-11-08T00:00:00Z");
    expect(loadSettingOverrides(db).has("stepFrames")).toBe(true);
    runMigrations(db, mine);
    // (The jail point and the bell map are rows every server gets, from migration 59, and the
    // start and fallback points from migration 66.)
    expect([...loadSettingOverrides(db).keys()].sort()).toEqual([
      "bellMap",
      "chatMaxChars",
      "fallbackPoint",
      "jailPoint",
      "startPoint",
    ]);
  });
});
