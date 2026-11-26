/**
 * Gathering: the tools, their hit counters, the tile changes, what each success drops, fishing,
 * seeds, watering, regrowth and the skill handlers. Pure: the server applies the results; tables
 * come from the content store's `gather`, gathering and skill-gain data.
 */
import type { HarvestNode, YieldTable } from "@secondstaronline/data";

import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { type ContentStore, content, onContent } from "../../content/store.ts";
import { boundSkillIndex, SKILL_KEYS, skillNorm } from "../core/fighter.ts";
import { lingoContains, lingoEq, lingoWord, type Rng } from "../core/lingo.ts";
import { ruleMatches } from "../core/patterns.ts";
import type { Facing } from "../movement/movement.ts";
import { oddsAt, rollChance } from "./odds.ts";

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

/** What a tool can do: an engine kind of gathering (`item-rules.json` `tools`). */
export type ToolCan = ContentStore["itemRules"]["tools"][number]["can"] & string;

/** One thing a weapon can do, from one `tools` row. */
export interface ToolUse {
  can: ToolCan;
  /** The row's tier, 1 when it gives none. */
  tier: number;
  /**
   * The hit counter it advances: the row's `counter`, else its pattern, so an Axe and a Gold Axe
   * share one.
   */
  counter: string;
}

/** Hits left per counter (each hammer has its own); a missing counter starts fresh. */
export type GatherCounters = Record<string, number>;

/** No tool has been swung yet: each one's first hit loads its count. */
export function newGatherCounters(): GatherCounters {
  // No prototype: a counter an operator names `constructor` or `__proto__` is a counter like any.
  return Object.create(null) as GatherCounters;
}

/** Everything a weapon can do, one entry per matching `tools` row with a `can`, in table order. */
export function toolUses(weapon: string): ToolUse[] {
  const out: ToolUse[] = [];
  for (const r of content().itemRules.tools) {
    if (r.can !== undefined && ruleMatches(weapon, r)) {
      out.push({ can: r.can, tier: r.tier ?? 1, counter: r.counter ?? r.pattern });
    }
  }
  return out;
}

/** The first thing a weapon can do of one kind, or null when it cannot. */
export function toolCan(weapon: string, can: ToolCan): ToolUse | null {
  return toolUses(weapon).find((u) => u.can === can) ?? null;
}

/** The harvest nodes on a layer-2 tile, in table order. */
export function harvestNodes(tile: string): HarvestNode[] {
  if (tile === "") {
    return [];
  }
  return content().gather.harvest.filter((n) => lingoEq(n.tile, tile));
}

/** The first harvest node on a tile, or null. */
export function harvestNode(tile: string): HarvestNode | null {
  return harvestNodes(tile)[0] ?? null;
}

/**
 * The node a weapon works on a tile, and how: the first node on the tile the weapon can work and
 * whose ground test `ground` passes (so nodes may share a tile, each for its own tools or its own
 * ground beneath), or null.
 */
export function workedNode(
  weapon: string,
  tile: string,
  ground: (node: HarvestNode) => boolean = () => true,
): { node: HarvestNode; use: ToolUse } | null {
  for (const node of harvestNodes(tile)) {
    const use = nodeTool(weapon, node);
    if (use && ground(node)) {
      return { node, use };
    }
  }
  return null;
}

/**
 * How a weapon works a node, or null when it cannot: a use of the node's kind, by one of the node's
 * `tools` when it names them. The tier is the caller's to check, so a low tier can say so.
 */
export function nodeTool(weapon: string, node: HarvestNode): ToolUse | null {
  if (node.tools && !node.tools.some((t) => lingoEq(t, weapon))) {
    return null;
  }
  const uses = toolUses(weapon).filter((u) => u.can === node.can);
  // The best tier the weapon has for the kind.
  return uses.reduce<ToolUse | null>((best, u) => (best && best.tier >= u.tier ? best : u), null);
}

/** The node's lowest tool tier. */
export function nodeTier(node: HarvestNode): number {
  return node.tier ?? 1;
}

/** Told when a tool's tier is below a node's. */
export function tierText(node: HarvestNode): string {
  return `You need a better tool to ${node.can.toLowerCase()} this.`;
}

/**
 * One hit on a tool's counter: an empty counter loads the skill table's count, each hit takes one,
 * and the hit that empties it succeeds. Every success takes exactly the table's number of hits.
 * Each counter keeps its own count; one table serves them all.
 */
export function hitCounter(counters: GatherCounters, counter: string, skill: number): boolean {
  // Only the counter's own count (never an inherited property, should `counters` have a prototype).
  let c = Object.hasOwn(counters, counter) ? (counters[counter] ?? 0) : 0;
  if (c < 1) {
    c = hitsPerSuccess(G.counterTable, skill);
  }
  c -= 1;
  Object.defineProperty(counters, counter, {
    value: c,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return c === 0;
}

/**
 * The chance a swing at a node harvests, for a node with `odds` (null for one that counts hits):
 * its odds at the skill, plus `tierBonus` points for each tier the tool is above the node's.
 */
export function nodeChance(
  node: Pick<HarvestNode, "odds" | "tierBonus" | "tier">,
  toolTier: number,
  skill: number,
): number | null {
  if (!node.odds) {
    return null;
  }
  const above = Math.max(0, toolTier - (node.tier ?? 1));
  return Math.min(1, oddsAt(node.odds, skill) + ((node.tierBonus ?? 0) * above) / 100);
}

/**
 * One swing at a node the tool can work: a node with `odds` harvests on its chance; any other
 * advances the tool's hit counter, and the hit that empties it harvests (1.6).
 */
export function swingHarvests(
  node: HarvestNode,
  use: ToolUse,
  counters: GatherCounters,
  skill: number,
  rng: Rng,
): boolean {
  const chance = nodeChance(node, use.tier, skill);
  return chance === null ? hitCounter(counters, use.counter, skill) : rollChance(chance, rng);
}

/**
 * A harvest uses the node up (its tile turns into `becomes`): 1 time in `depletes`, rolled after
 * the harvest; always when it has none (1.6), with no dice.
 */
export function harvestUsesUp(node: Pick<HarvestNode, "depletes">, rng: Rng): boolean {
  const n = node.depletes ?? 1;
  return n <= 1 || rng.random(n) === 1;
}

/**
 * A node's ground test: the layer-1 tile under the worked tile must be one of the node's `under`
 * tiles (the shovel's diggable grounds). Off the map nothing passes; a node with no `under` always
 * does.
 */
export function underOk(
  node: HarvestNode,
  layer1: readonly string[],
  x: number,
  y: number,
): boolean {
  if (!node.under) {
    return true;
  }
  const code = tileAt(layer1, x, y);
  return code !== "" && node.under.some((c) => lingoEq(c, code));
}

// ---- drops ----------------------------------------------------------------------------------

/**
 * The Iron pool for a Mining skill: the first (tightest) "below N" row the skill is under, so the
 * odds improve as the skill rises; from the last row's bound up, the last row's pool.
 */
export function orePool(skill: number): number {
  const rows = G.mining?.ore.base ?? [];
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
  if (!m) {
    // No mining section: no table can be an ore strike (the schema refuses one), so nothing drops.
    return null;
  }
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

/**
 * A success's drop from a `yields` table, or null: a `chance` table drops its item on
 * `random(chance) = 1` (Logs 1 in 3, a Chunk of Ice 1 in 130, at any skill), with the chance from
 * the last `bySkill` row the skill is above when it has them; `ore` is the mining strike. A table
 * the store does not have drops nothing and draws nothing.
 */
export function rollYield(name: string | undefined, skill: number, rng: Rng): string | null {
  const yields = content().gather.yields;
  const t: YieldTable | undefined =
    name !== undefined && Object.hasOwn(yields, name) ? yields[name] : undefined;
  if (!t) {
    return null;
  }
  if (t.kind === "ore") {
    return rollMiningFind(skill, rng);
  }
  return rng.random(yieldOdds(t, skill)) === 1 ? t.item : null;
}

/**
 * The `n` of a chance table's `random(n) = 1` at a skill: the last `bySkill` row the skill is above,
 * else its `chance`. Shared with the Gathering page's preview (issue #38).
 */
export function yieldOdds(t: Extract<YieldTable, { kind: "chance" }>, skill: number): number {
  return t.bySkill ? (gtCascade(t.bySkill, skill, t.chance) ?? t.chance) : t.chance;
}

/**
 * The count a tool's empty counter loads at a skill (`hitCounter`): the hits each success takes.
 * Below 1, the counter never empties, so the tool never succeeds.
 */
export function hitsPerSuccess(counterTable: readonly GtRow[], skill: number): number {
  return gtCascade(counterTable, skill, 1) ?? 1;
}

// ---- fishing ---------------------------------------------------------------------------------

/** The weapon can fish (a `tools` row gives it `Fish`). */
export function isFishingPole(weapon: string): boolean {
  return toolCan(weapon, "Fish") !== null;
}

/** The weapon waters seeded soil and sprinkles on every swing (a `tools` row gives it `Water`). */
export function isWateringTool(weapon: string): boolean {
  return toolCan(weapon, "Water") !== null;
}

/** A tile code is fishing water: W1, N1, D2 or I2. */
export function isFishingWater(code: string): boolean {
  return G.fishing?.waterTiles.some((w) => lingoEq(w, code)) ?? false;
}

/** The map layers fishing reads: water drawn on any of them can be fished. */
export let FISHING_LAYERS: readonly (1 | 2)[];

/** The Fishing FX's offset from sprite 112. */
export function fishingOffset(facing: Facing): readonly [number, number] {
  return G.fishing?.fxOffsets[facing] ?? [0, 0];
}

/** What a cast into water shows and plays (`fishing.castFx`, `castSound`): null for none. */
export function fishingCast(): {
  fx: { fx: string; frames: number } | null;
  sound: { name: string; ch: number } | null;
} {
  return { fx: G.fishing?.castFx ?? null, sound: G.fishing?.castSound ?? null };
}

/** The catches one tile allows before you must fish from another. */
export let ANTI_MACRO_START: number;

/** Told when a cast finds its tile's allowance spent. */
export let FISHING_STOPPED_TEXT: string;

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

/** One fish of the catch pool (`fishing.catches`). */
export interface FishCatch {
  fish: string;
  from: number;
  below?: number | undefined;
  weight: number;
  xp?: number | undefined;
  /** Only these fishing tools catch it (exact names); any does when left out. */
  tools?: readonly string[] | undefined;
}

/**
 * The fish a Fishing skill can catch: those whose range holds it, in the pool's order, and, with
 * a `tool`, that the tool may catch. Without one, every fish in range (the page's preview).
 */
export function catchesFor(
  skill: number,
  pool: readonly FishCatch[] = G.fishing?.catches ?? [],
  tool?: string,
): FishCatch[] {
  return pool.filter(
    (c) =>
      c.from <= skill &&
      (c.below === undefined || skill < c.below) &&
      (tool === undefined || !c.tools || c.tools.some((t) => lingoEq(t, tool))),
  );
}

/**
 * The fish a bite catches, picked by weight from those in range: `random(total)` lands in one
 * fish's share, in the pool's order. With one fish in range nothing is rolled (1.6's one fish per
 * skill band), and with none the bite catches nothing.
 */
export function pickCatch(
  skill: number,
  rng: Rng,
  pool: readonly FishCatch[] = G.fishing?.catches ?? [],
  tool?: string,
): FishCatch | null {
  const open = catchesFor(skill, pool, tool);
  if (open.length <= 1) {
    return open[0] ?? null;
  }
  let roll = rng.random(open.reduce((n, c) => n + c.weight, 0));
  for (const c of open) {
    roll -= c.weight;
    if (roll <= 0) {
      return c;
    }
  }
  return open[open.length - 1] ?? null;
}

/** Each fish's chance of being the one a bite catches at a Fishing skill (its weight's share). */
export function catchShares(
  skill: number,
  pool: readonly FishCatch[] = G.fishing?.catches ?? [],
  tool?: string,
): { fish: string; share: number; xp?: number | undefined }[] {
  const open = catchesFor(skill, pool, tool);
  const total = open.reduce((n, c) => n + c.weight, 0);
  return open.map((c) => ({ fish: c.fish, share: c.weight / total, xp: c.xp }));
}

/** The bite chance for a Fishing skill: `random(n) = 1`; skill 0 uses the first row's odds. */
export function fishCheck(
  skill: number,
  rows: readonly GtRow[] = G.fishing?.fishCheck ?? [],
): number {
  return gtCascade(rows, skill, rows[0]?.value ?? 1) ?? 1;
}

/** What a cast trains: every cast (1.6), every catch, or both (`fishing.trains`). */
export function fishingTrains(): { cast: boolean; catch: boolean } {
  return G.fishing?.trains ?? { cast: true, catch: false };
}

/**
 * The fish-drop routine and its fishing helper. Returns the fish caught (or null), the XP its row
 * gives an `xp` skill, and what the cast trains (the caller trains it next, the `gather` source, as
 * 1.6 rolled the gain last): `trainsCast` while the tile's allowance lasts after the cast (1.6's
 * every-cast roll), `trainsCatch` when a fish is caught, each as `fishing.trains` allows. Only a
 * catch spends the anti-macro counter. A cast mid-step catches like any other.
 */
export function castLine(
  skill: number,
  antiMacro: number,
  rng: Rng,
  /** The fishing tool cast: a fish that names its tools bites only on one of them. */
  tool?: string,
): {
  fish: string | null;
  catchXp: number | undefined;
  trainsCast: boolean;
  trainsCatch: boolean;
  antiMacro: number;
} {
  const bite = rng.random(fishCheck(skill)) === 1;
  let left = antiMacro;
  let caught: FishCatch | null = null;
  if (left > 0 && bite) {
    caught = pickCatch(skill, rng, G.fishing?.catches ?? [], tool);
    left -= 1;
  }
  const bound = boundSkillIndex("fishing") !== undefined;
  const trains = fishingTrains();
  return {
    fish: caught?.fish ?? null,
    catchXp: caught?.xp,
    trainsCast: trains.cast && left > 0 && bound,
    trainsCatch: trains.catch && caught !== null && bound,
    antiMacro: left,
  };
}

// ---- farming ---------------------------------------------------------------------------------

/** What a seed item plants, or null when the item is not a seed. */
export function seedTile(item: string): string | null {
  return G.farming?.seeds.find((s) => lingoEq(s.item, item))?.plants ?? null;
}

/** The faced tile is tilled soil (`SL`); off the map nothing can be planted. */
export function canPlant(code: string): boolean {
  const test = G.farming?.seedTest ?? "";
  return code !== "" && test.split("*").some((c) => c !== "" && lingoEq(c, code));
}

export let SEED_PAUSE: number;

/** The skill whose counter table a Water tool's hits read. */
export let WATERING_SKILL: string;

/** The watering routine: the watered form, or null (a wasted success). */
export function wateredTile(code: string): string | null {
  return G.farming?.watering.find((w) => lingoEq(w.from, code))?.to ?? null;
}

/** The sprinkle FX's offset from sprite 112, or null facing north. */
export function sprinkleOffset(facing: Facing): readonly [number, number] | null {
  if (!G.sprinkle || facing === G.sprinkle.notFacing) {
    return null;
  }
  return G.sprinkle.offsets[facing as "E" | "W" | "S"] ?? null;
}

/** The sprinkle FX's name; empty when the world has no sprinkle. */
export let SPRINKLE_FX: string;

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
    if (!isProduceCheck(c)) {
      const pair = c.tiles.find((t) => lingoEq(t.from, code));
      if (pair) {
        hooks.setTile(x, y, pair.to);
      }
      continue;
    }
    const grown = G.farming?.produce.find((p) => lingoEq(p.tile, code));
    if (grown && !hooks.hasGround(x, y)) {
      hooks.produce(x, y, grown.item);
    }
  }
}

/**
 * A regrowth check drops farming produce (rather than changing tiles): its `produce` flag, or,
 * left out, no tiles of its own (Classic's `DoVeg`). The Gathering page never adds a harvest
 * node's tile pair to one (issue #38).
 */
export function isProduceCheck(c: { tiles: readonly unknown[]; produce?: boolean | undefined }) {
  return c.produce ?? c.tiles.length === 0;
}

/**
 * The most frames of regrowth an empty map catches up on when someone arrives: one hour at 20
 * frames a second.
 */
export const REGROWTH_CATCH_UP_FRAMES = 72_000;

// ---- treasure --------------------------------------------------------------------------------

/** The treasure hunt, or undefined when the world has none (no buried treasure, no rumours). */
export let TREASURE: typeof G.treasure;

/** The treasure list build: its last pass decides; null when no map is set. */
export function buildTreasure(
  maps: readonly string[],
  rng: Rng,
): { map: string; item: string } | null {
  const items = G.treasure?.items;
  if (maps.length === 0 || !items) {
    return null;
  }
  let pick: { map: string; item: string } | null = null;
  for (let i = 0; i < 70; i++) {
    const item = items[rng.random(items.length) - 1] ?? "";
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

onContent((c) => {
  G = c.gather.gathering;
  // A section the world leaves out turns its mechanic off: no water can be fished, no seed planted,
  // no sprinkle shown, no treasure buried.
  FISHING_LAYERS = G.fishing?.layers ?? [];
  ANTI_MACRO_START = G.fishing?.antiMacroStart ?? 0;
  FISHING_STOPPED_TEXT = G.fishing?.stoppedText ?? "";
  SEED_PAUSE = G.farming?.seedPause ?? 0;
  WATERING_SKILL = G.farming?.wateringSkill ?? "";
  SPRINKLE_FX = G.sprinkle?.fx ?? "";
  GATHER_TEXT = G.texts;
  TREASURE = G.treasure;
  RUMOUR_NPCS = G.treasure?.rumourNpcs ?? [];
});
