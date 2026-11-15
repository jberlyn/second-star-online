/**
 * Gathering: the tools, their hit counters, the tile changes, what each success drops, fishing,
 * seeds, watering, regrowth and the skill handlers. Pure: the server applies the results; tables
 * come from `gatherData`, the generated gathering and skill-gain data.
 */
import { type GatherTool, gatherData, type SkillGainRule } from "@secondstaronline/data";

import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { lingoContains, lingoEq, lingoWord, type Rng } from "../core/lingo.ts";
import type { Facing } from "../movement/movement.ts";

const G = gatherData.gathering;

// ---- map tiles -----------------------------------------------------------------------------

/**
 * column X of row Y of a layer's 12 rows. Off the map it is EMPTY (""), which no tool's code
 * equals but which `contains` tests match.
 */
export function tileAt(rows: readonly string[], x: number, y: number): string {
  if (x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return "";
  }
  return lingoWord(rows[y - 1] ?? "", x);
}

/** The rows with tile (x, y) replaced, or null when (x, y) is off the map. */
export function withTile(
  rows: readonly string[],
  x: number,
  y: number,
  code: string,
): string[] | null {
  if (x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return null;
  }
  const words = (rows[y - 1] ?? "").trim().split(/\s+/);
  if (words.length < x) {
    return null;
  }
  words[x - 1] = code;
  const out = [...rows];
  out[y - 1] = words.join(" ");
  return out;
}

// ---- tables ----------------------------------------------------------------------------------

type GtRow = { gt: number; value: number };
type LtRow = { lt: number; value: number };

/** Check every row whose threshold is below the skill; the last match wins, or `fallback`. */
export function gtCascade(rows: readonly GtRow[], skill: number, fallback: number | null) {
  let v = fallback;
  for (const r of rows) {
    if (skill > r.gt) {
      v = r.value;
    }
  }
  return v;
}

/**
 * Each row whose threshold is below the skill draws a value, in order, and the
 * last draw is kept; `fallback` (no draw) when none is true.
 */
function gtRoll(rows: readonly GtRow[], skill: number, fallback: number, rng: Rng): number {
  let v = fallback;
  for (const r of rows) {
    if (skill > r.gt) {
      v = rng.random(r.value);
    }
  }
  return v;
}

/** Check every row whose threshold exceeds the skill; the last match wins, or null. */
export function ltCascade(rows: readonly LtRow[], skill: number): number | null {
  let v: number | null = null;
  for (const r of rows) {
    if (skill < r.lt) {
      v = r.value;
    }
  }
  return v;
}

/**
 * Tests whether the draw is one. An unset bound consumes one draw and the test returns false.
 */
function one(rng: Rng, n: number | null): boolean {
  return rng.random(n ?? 0) === 1;
}

// ---- tools and counters -----------------------------------------------------------------------

export type CounterName = GatherTool["counter"];
export type GatherCounters = Record<CounterName, number>;

/** The client globals start unset, which the `< 1` test reloads. */
export function newGatherCounters(): GatherCounters {
  return { Chop: 0, Dig: 0, Farm: 0, Watering: 0, Mine: 0 };
}

/** The tool a swing's weapon is: names containing "Axe", exact matches for the rest. */
export function gatherTool(weapon: string): GatherTool | null {
  for (const t of G.tools) {
    if (t.match === "contains" ? lingoContains(weapon, t.tool) : lingoEq(weapon, t.tool)) {
      return t;
    }
  }
  return null;
}

/**
 * One hit on the tool's counter: reload from the skill table when below 1, take one, and succeed
 * when it is exactly 1. One table serves every counter.
 */
export function hitCounter(counters: GatherCounters, name: CounterName, skill: number): boolean {
  let c = counters[name];
  if (c < 1) {
    c = gtCascade(G.counterTable, skill, c) ?? c;
  }
  c -= 1;
  counters[name] = c;
  return c === 1;
}

/**
 * The shovel's layer-1 test: column X of row Y of the one-line map data. For y ≥ 2 that line is
 * EMPTY, which the test contains; for y = 1 it is the whole map, so words 1-16 are row 1 and word
 * 17 spans the `#` join into row 2 and never matches.
 */
export function shovelLayer1Ok(layer1: readonly string[], x: number, y: number): boolean {
  if (y !== 1) {
    return true;
  }
  const word =
    x >= 1 && x <= 16
      ? lingoWord(layer1[0] ?? "", x)
      : `${lingoWord(layer1[0] ?? "", 17)}#${lingoWord(layer1[1] ?? "", 1)}`;
  return lingoContains(G.shovelLayer1.test, word);
}

// ---- drops ----------------------------------------------------------------------------------

/** Logs: `random(3) = 1` on every fell, dropped only when Lumberjacking > 0. */
export function rollLogs(skill: number, rng: Rng): string | null {
  const hit = rng.random(G.logs.chance) === 1;
  return hit && skill > 0 ? G.logs.item : null;
}

/**
 * A broken rock, in the original's roll order: the crystal count and the colour, each a cascade
 * whose every true line draws (the last draw kept), then the three ore rolls (each overriding the
 * last; at Mining ≥ 97 the base pool is unset and treated as zero when adding 30 or 130, so
 * Iron is impossible, Steel is 1/30 and Star is 1/130), then the one-in-five find. Returns the
 * item to drop, or null; Mining 0 rolls and drops nothing.
 */
export function rollMiningFind(skill: number, rng: Rng): string | null {
  const m = G.mining;
  const count = gtRoll(m.count, skill, m.countDefault, rng);
  const roll = gtRoll(m.colourPool, skill, m.colourDefault, rng);
  let item = `${count} ${m.colours[roll - 1] ?? "Blue"} Crystals`;
  const base = ltCascade(m.ore.base, skill);
  const steel = (base ?? 0) + m.ore.steelAdd; // the Steel pool: the base pool plus 30
  const star = steel + m.ore.starAdd; // the Star pool: the Steel pool plus 100
  if (rng.random(base ?? 0) === 1) {
    item = m.ore.items[0];
  }
  if (rng.random(steel) === 1) {
    item = m.ore.items[1];
  }
  if (rng.random(star) === 1) {
    item = m.ore.items[2];
  }
  const found = rng.random(m.findChance) === 1;
  return found && skill > 0 ? item : null;
}

/** The Ice and Fire Hammers: their chunk on `random(130) = 1`, with Mining > 0. */
export function rollChunk(tool: string, skill: number, rng: Rng): string | null {
  const c = G.mining.chunks.find((k) => lingoEq(k.tool, tool));
  if (!c) {
    return null;
  }
  const hit = rng.random(c.chance) === 1;
  return hit && skill > 0 ? c.item : null;
}

// ---- fishing ---------------------------------------------------------------------------------

/** Fishing requires the left-hand item name to contain "Fishing", ignoring case. */
export function isFishingPole(weapon: string): boolean {
  return lingoContains(weapon, G.fishing.tool);
}

/** The faced tile of the layer-1 field is water: W1, N1, D2 or I2. */
export function isFishingWater(code: string): boolean {
  return G.fishing.waterTiles.some((w) => lingoEq(w, code));
}

export const FISHING_AT_DELAY = G.fishing.atDelay;

/** The Fishing FX's offset from sprite 112. */
export function fishingOffset(facing: Facing): readonly [number, number] {
  return G.fishing.fxOffsets[facing] ?? [0, 0];
}

/** The anti-macro counter reset at login and after an arrow press. */
export const ANTI_MACRO_START = G.fishing.antiMacroStart;

/** The fish a skill catches: one kind per band. */
export function fishFor(skill: number): string | null {
  let fish: string | null = null;
  for (const b of G.fishing.bands) {
    if (skill < b.lt) {
      fish = b.fish;
    }
  }
  return fish;
}

/**
 * The fish-drop routine and its fishing helper. Returns the fish caught (or null) and whether the
 * skill rose; spends the anti-macro counter on each, in the original order.
 */
export function castLine(
  skill: number,
  antiMacro: number,
  midStep: boolean,
  rng: Rng,
): { fish: string | null; gained: boolean; antiMacro: number } {
  const check = gtCascade(G.fishing.fishCheck, skill, null);
  const bite = one(rng, check);
  let left = antiMacro;
  let fish: string | null = null;
  if (left > 0 && bite && !midStep) {
    fish = fishFor(skill);
    left -= 1;
  }
  let gained = false;
  if (left > 0) {
    gained = rollSkillGain("Fishing", skill, rng);
    if (gained) {
      left -= 1;
    }
  }
  return { fish, gained, antiMacro: left };
}

// ---- farming ---------------------------------------------------------------------------------

/** What a seed item plants, or null when the item is not a seed. */
export function seedTile(item: string): string | null {
  return G.farming.seeds.find((s) => lingoEq(s.item, item))?.plants ?? null;
}

/** `"*SL*" contains <tile>`: an off-map EMPTY tile passes. */
export function canPlant(code: string): boolean {
  return lingoContains(G.farming.seedTest, code);
}

export const SEED_PAUSE = G.farming.seedPause;

/** The watering routine: the watered form, or null (a wasted success). */
export function wateredTile(code: string): string | null {
  return G.farming.watering.find((w) => lingoEq(w.from, code))?.to ?? null;
}

/** The sprinkle FX's offset from sprite 112, or null facing north. */
export function sprinkleOffset(facing: Facing): readonly [number, number] | null {
  if (facing === G.sprinkle.notFacing) {
    return null;
  }
  return G.sprinkle.offsets[facing as "E" | "W" | "S"] ?? null;
}

export const SPRINKLE_FX = G.sprinkle.fx;

export const GATHER_TEXT = G.texts;

// ---- regrowth --------------------------------------------------------------------------------

/**
 * What a frame of world ticks changes, applied as each check runs (each sent its own tile update).
 */
export interface RegrowthHooks {
  /** The map's layer 2 as it is now. */
  layer2(): readonly string[];
  /** A ground item lies on (x, y): `DoVeg` drops nothing there. */
  hasGround(x: number, y: number): boolean;
  setTile(x: number, y: number, code: string): void;
  produce(x: number, y: number, item: string): void;
}

/**
 * One client's frame of world ticks: `random(600)`, then each check whose threshold it is above
 * samples one tile (`random(17)`, `random(12)`). The six `Check*` handlers stop while the roller's
 * the post-death respawn timer runs; `DoVeg` does not. Each check reads the tile once, so it makes
 * at most one change.
 */
export function regrowthFrame(stopped: boolean, hooks: RegrowthHooks, rng: Rng): void {
  const R = G.regrowth;
  const r = rng.random(R.roll);
  for (const c of R.checks) {
    if (r >= c.below || (c.deathGated && stopped)) {
      continue;
    }
    const x = rng.random(R.tileRoll[0]);
    const y = rng.random(R.tileRoll[1]);
    const code = tileAt(hooks.layer2(), x, y);
    if (c.tiles.length > 0) {
      const pair = c.tiles.find((t) => lingoEq(t.from, code));
      if (pair) {
        hooks.setTile(x, y, pair.to);
      }
      continue;
    }
    const grown = G.farming.produce.find((p) => lingoEq(p.tile, code));
    if (grown && !hooks.hasGround(x, y)) {
      hooks.produce(x, y, grown.item);
    }
  }
}

/** The post-death respawn timer is 400: set by a death and an exit warp. */
export const REGROWTH_STOP_FRAMES = 400;

// ---- treasure --------------------------------------------------------------------------------

export const TREASURE = G.treasure;

/** The treasure list build: its last pass decides; null when no map is set. */
export function buildTreasure(
  maps: readonly string[],
  rng: Rng,
): { map: string; item: string } | null {
  if (maps.length === 0) {
    return null;
  }
  let pick: { map: string; item: string } | null = null;
  for (let i = 0; i < 70; i++) {
    const item = G.treasure.items[rng.random(G.treasure.items.length) - 1] ?? "";
    const map = maps[rng.random(maps.length) - 1] ?? "";
    pick = { map, item };
  }
  return pick;
}

/**
 * The chat line asks about treasure (the original's treasure-text check): word 1 is "treasure", or
 * the line contains "any treasure", "treasure anywhere" or "rumor". The test for the first word
 * being "the treasure" can never match: the first word is a single word, while "the treasure" has
 * two words.
 */
export function asksAboutTreasure(text: string): boolean {
  return (
    lingoEq(lingoWord(text, 1), "treasure") ||
    ["any treasure", "treasure anywhere", "rumor"].some((k) => lingoContains(text, k))
  );
}

/** The NPCs the treasure hint answers for. */
export const RUMOUR_NPCS: readonly string[] = G.treasure.rumourNpcs;

/** A rumour NPC's line naming the treasure map's header, by `random(2)`. */
export function rumourLine(npc: string, header: string, roll: number): string {
  return roll === 1
    ? `${npc} says "Word has it that some treasure was buried near ${header}."`
    : `${npc} says "A man came in here earlier and said he heard some treasure was near ${header}."`;
}

// ---- skill gain ------------------------------------------------------------------------------

const RULES: readonly SkillGainRule[] = gatherData.skillGain;

/** The skill handler for a skill. */
export function skillGainRule(skill: string): SkillGainRule | null {
  return RULES.find((r) => lingoEq(r.skill, skill)) ?? null;
}

/**
 * One handler's roll: only while `min <= skill < below` (so a skill at 0 never rises), then
 * `random(chance) = 1`. The caller adds the point and prints `rule.text`.
 */
export function rollSkillGain(skill: string, value: number, rng: Rng): boolean {
  const r = skillGainRule(skill);
  if (!r || value < r.min || value >= r.below) {
    return false;
  }
  return rng.random(r.chance) === 1;
}
