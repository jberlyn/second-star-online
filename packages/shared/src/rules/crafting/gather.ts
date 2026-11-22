/**
 * Gathering: the tools, their hit counters, the tile changes, what each success drops, fishing,
 * seeds, watering, regrowth and the skill handlers. Pure: the server applies the results; tables
 * come from the content store's `gather`, gathering and skill-gain data.
 */
import type { GatherTool, SkillGainRule } from "@secondstaronline/data";

import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { type ContentStore, onContent } from "../../content/store.ts";
import { lingoContains, lingoEq, lingoWord, type Rng } from "../core/lingo.ts";
import type { Facing } from "../movement/movement.ts";

let G: ContentStore["gather"]["gathering"];

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

// ---- tools and counters -----------------------------------------------------------------------

export type CounterName = GatherTool["counter"];
/** Hits left per tool, by the tool's name (each hammer has its own); a missing tool starts fresh. */
export type GatherCounters = Record<string, number>;

/** No tool has been swung yet: each one's first hit loads its count. */
export function newGatherCounters(): GatherCounters {
  return {};
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
 * One hit on a tool's counter: an empty counter loads the skill table's count, each hit takes one,
 * and the hit that empties it succeeds. Every success takes exactly the table's number of hits.
 * Each tool keeps its own count; one table serves them all.
 */
export function hitCounter(counters: GatherCounters, tool: string, skill: number): boolean {
  let c = counters[tool] ?? 0;
  if (c < 1) {
    c = gtCascade(G.counterTable, skill, 1) ?? 1;
  }
  c -= 1;
  counters[tool] = c;
  return c === 0;
}

/**
 * The shovel's ground test: the layer-1 tile under the dug tile must be one of the diggable
 * grounds (`*G1*H1*O1`), on every row. Off the map nothing is diggable.
 */
export function shovelLayer1Ok(layer1: readonly string[], x: number, y: number): boolean {
  const code = tileAt(layer1, x, y);
  return code !== "" && G.shovelLayer1.test.split("*").some((c) => c !== "" && lingoEq(c, code));
}

// ---- drops ----------------------------------------------------------------------------------

/** Logs: `random(3) = 1` on every fell, at any Lumberjacking. */
export function rollLogs(_skill: number, rng: Rng): string | null {
  return rng.random(G.logs.chance) === 1 ? G.logs.item : null;
}

/**
 * The Iron pool for a Mining skill: the first (tightest) "below N" row the skill is under, so the
 * odds improve as the skill rises; from the last row's bound up, the last row's pool.
 */
export function orePool(skill: number): number {
  const rows = G.mining.ore.base;
  const hit = rows.find((r) => skill < r.lt) ?? rows[rows.length - 1];
  return hit?.value ?? 0;
}

/**
 * A broken rock, in the original's roll order: the crystal count and the colour, each a cascade
 * whose every true line draws (the last draw kept), then the three ore rolls (each overriding the
 * last: Iron from the skill's pool, Steel from it plus 30, Star from that plus 100), then the
 * one-in-five find. Returns the item to drop, or null. Works at any Mining skill.
 */
export function rollMiningFind(skill: number, rng: Rng): string | null {
  const m = G.mining;
  const count = gtRoll(m.count, skill, m.countDefault, rng);
  const roll = gtRoll(m.colourPool, skill, m.colourDefault, rng);
  let item = `${count} ${m.colours[roll - 1] ?? "Blue"} Crystal`;
  const base = orePool(skill);
  const steel = base + m.ore.steelAdd; // the Steel pool: the base pool plus 30
  const star = steel + m.ore.starAdd; // the Star pool: the Steel pool plus 100
  if (rng.random(base) === 1) {
    item = m.ore.items[0];
  }
  if (rng.random(steel) === 1) {
    item = m.ore.items[1];
  }
  if (rng.random(star) === 1) {
    item = m.ore.items[2];
  }
  return rng.random(m.findChance) === 1 ? item : null;
}

/** The Ice and Fire Hammers: their chunk on `random(130) = 1`, at any Mining skill. */
export function rollChunk(tool: string, _skill: number, rng: Rng): string | null {
  const c = G.mining.chunks.find((k) => lingoEq(k.tool, tool));
  if (!c) {
    return null;
  }
  return rng.random(c.chance) === 1 ? c.item : null;
}

// ---- fishing ---------------------------------------------------------------------------------

/** Fishing requires the left-hand item name to contain "Fishing", ignoring case. */
export function isFishingPole(weapon: string): boolean {
  return lingoContains(weapon, G.fishing.tool);
}

/** A tile code is fishing water: W1, N1, D2 or I2. */
export function isFishingWater(code: string): boolean {
  return G.fishing.waterTiles.some((w) => lingoEq(w, code));
}

/** The map layers fishing reads: water drawn on any of them can be fished. */
export let FISHING_LAYERS: readonly (1 | 2)[];

export let FISHING_AT_DELAY: typeof G.fishing.atDelay;

/** The Fishing FX's offset from sprite 112. */
export function fishingOffset(facing: Facing): readonly [number, number] {
  return G.fishing.fxOffsets[facing] ?? [0, 0];
}

/** The catches one tile allows before you must fish from another. */
export let ANTI_MACRO_START: typeof G.fishing.antiMacroStart;

/** Told when a cast finds its tile's allowance spent. */
export let FISHING_STOPPED_TEXT: typeof G.fishing.stoppedText;

/** The tile a fisher's allowance belongs to, and the catches it has left. */
export interface FishingSpot {
  mapId: string;
  x: number;
  y: number;
  left: number;
}

/**
 * The allowance for a cast from (mapId, x, y): the remembered spot's when it is that same tile,
 * otherwise a full one for the new tile. Only fishing from another tile refills it (a design change
 * from 1.6, which refilled it on any arrow press, a turn included).
 */
export function fishingSpot(
  prev: FishingSpot | undefined,
  mapId: string,
  x: number,
  y: number,
): FishingSpot {
  if (prev && prev.mapId === mapId && prev.x === x && prev.y === y) {
    return prev;
  }
  return { mapId, x, y, left: ANTI_MACRO_START };
}

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

/** The bite chance for a Fishing skill: `random(n) = 1`; skill 0 uses the first row's odds. */
export function fishCheck(skill: number): number {
  const rows = G.fishing.fishCheck;
  return gtCascade(rows, skill, rows[0]?.value ?? 1) ?? 1;
}

/**
 * The fish-drop routine and its fishing helper. Returns the fish caught (or null) and whether the
 * skill rose. Only a catch spends the anti-macro counter, and the skill roll runs while it lasts.
 * A cast mid-step catches like any other.
 */
export function castLine(
  skill: number,
  antiMacro: number,
  rng: Rng,
): { fish: string | null; gained: boolean; antiMacro: number } {
  const bite = rng.random(fishCheck(skill)) === 1;
  let left = antiMacro;
  let fish: string | null = null;
  if (left > 0 && bite) {
    fish = fishFor(skill);
    left -= 1;
  }
  const gained = left > 0 && rollSkillGain("Fishing", skill, rng);
  return { fish, gained, antiMacro: left };
}

// ---- farming ---------------------------------------------------------------------------------

/** What a seed item plants, or null when the item is not a seed. */
export function seedTile(item: string): string | null {
  return G.farming.seeds.find((s) => lingoEq(s.item, item))?.plants ?? null;
}

/** The faced tile is tilled soil (`SL`); off the map nothing can be planted. */
export function canPlant(code: string): boolean {
  return code !== "" && G.farming.seedTest.split("*").some((c) => c !== "" && lingoEq(c, code));
}

export let SEED_PAUSE: typeof G.farming.seedPause;

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

export let SPRINKLE_FX: typeof G.sprinkle.fx;

export let GATHER_TEXT: typeof G.texts;

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
 * One map's frame of world ticks: `random(600)`, then each check whose threshold it is above
 * samples one tile (`random(17)`, `random(12)`). Each check reads the tile once, so it makes at
 * most one change. The server runs one frame per map per tick, however many players are there.
 */
export function regrowthFrame(hooks: RegrowthHooks, rng: Rng): void {
  const R = G.regrowth;
  const r = rng.random(R.roll);
  for (const c of R.checks) {
    if (r >= c.below) {
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

/**
 * The most frames of regrowth an empty map catches up on when someone arrives: one hour at 20
 * frames a second.
 */
export const REGROWTH_CATCH_UP_FRAMES = 72_000;

// ---- treasure --------------------------------------------------------------------------------

export let TREASURE: typeof G.treasure;

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
 * The chat line asks about treasure: it starts with the word "treasure" or the words "the
 * treasure", or it contains "any treasure", "treasure anywhere" or "rumor".
 */
export function asksAboutTreasure(text: string): boolean {
  const first = lingoWord(text, 1);
  return (
    lingoEq(first, "treasure") ||
    (lingoEq(first, "the") && lingoEq(lingoWord(text, 2), "treasure")) ||
    ["any treasure", "treasure anywhere", "rumor"].some((k) => lingoContains(text, k))
  );
}

/** The NPCs the treasure hint answers for. */
export let RUMOUR_NPCS: readonly string[];

/** A rumour NPC's line naming the treasure map's header, by `random(2)`. */
export function rumourLine(npc: string, header: string, roll: number): string {
  return roll === 1
    ? `${npc} says "Word has it that some treasure was buried near ${header}."`
    : `${npc} says "A man came in here earlier and said he heard some treasure was near ${header}."`;
}

// ---- skill gain ------------------------------------------------------------------------------

let RULES: readonly SkillGainRule[];

/** The skill handler for a skill. */
export function skillGainRule(skill: string): SkillGainRule | null {
  return RULES.find((r) => lingoEq(r.skill, skill)) ?? null;
}

/**
 * One handler's roll: only while `min <= skill < below` (0 to 99), then `random(chance) = 1`. The
 * caller adds the point and prints `rule.text`.
 */
export function rollSkillGain(skill: string, value: number, rng: Rng): boolean {
  const r = skillGainRule(skill);
  if (!r || value < r.min || value >= r.below) {
    return false;
  }
  return rng.random(r.chance) === 1;
}

onContent((c) => {
  G = c.gather.gathering;
  RULES = c.gather.skillGain;
  FISHING_LAYERS = G.fishing.layers;
  FISHING_AT_DELAY = G.fishing.atDelay;
  ANTI_MACRO_START = G.fishing.antiMacroStart;
  FISHING_STOPPED_TEXT = G.fishing.stoppedText;
  SEED_PAUSE = G.farming.seedPause;
  SPRINKLE_FX = G.sprinkle.fx;
  GATHER_TEXT = G.texts;
  TREASURE = G.treasure;
  RUMOUR_NPCS = G.treasure.rumourNpcs;
});
