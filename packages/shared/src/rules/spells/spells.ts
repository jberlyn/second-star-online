/**
 * Spells: the cast checks, SP cost, spell power, direction, skill gain on cast, books and the
 * effect formulas. Pure functions; the server sim calls them in the original order and the client
 * reads the texts.
 *
 * Mirrors the original's routines:
 * - The cast handler; the power calculation and the schools; the Fireball and Ice Wave direction.
 * - The skill gain on cast (`spellImp`).
 * - Book use.
 * - Spell collisions; the monster hit effects; the monster death check; the radar; the
 *   experience-band text; Create Food.
 */
import type { Spell, SpellFx, SpellSummon } from "@secondstaronline/data";

import { content, onContent } from "../../content/store.ts";
import { slotItem } from "../combat/armour.ts";
import { gearBonus } from "../combat/gear.ts";
import {
  boundSkillIndex,
  boundSkillValue,
  type Equipment,
  type Faction,
  findSkillIndex,
  skillIndex,
  skillValue,
} from "../core/fighter.ts";
import { lingoContains, lingoEq, type Rng } from "../core/lingo.ts";
import { firstMatch, lastMatch, ruleMatches } from "../core/patterns.ts";
import { crystalColour } from "../inventory/inventory.ts";
import type { Facing } from "../movement/movement.ts";
import { mageSkillCap } from "../progression/skillgain.ts";
import { PLAYFIELD_RECT } from "./spellfx.ts";

export interface SpellTable {
  byName(name: string): Spell | null;
  castEffect(spell: string): string;
  fxRun(member: string): SpellFx | null;
  fxEffect(name: string): string;
  fxForEffect(spell: string, effectFx: string): string;
}

/**
 * Pure index over `spells` rows (the module's default: the installed store's `spells.spells`), resolving spell names,
 * `effect` mappings, and FX runs case-insensitively. For every 1.6 row `effect` equals the
 * row's name and each run's `effect` equals its `member`, so `fxEffect` and `fxForEffect`
 * return their input unchanged.
 */
export function spellTable(rows: readonly Spell[]): SpellTable {
  const byNameMap = new Map<string, Spell>();
  const byFxMember = new Map<string, SpellFx>();
  for (const s of rows) {
    byNameMap.set(s.name.toLowerCase(), s);
    for (const f of s.fx) {
      byFxMember.set(f.member.toLowerCase(), f);
    }
  }
  const byName = (name: string): Spell | null => byNameMap.get(name.toLowerCase()) ?? null;
  const castEffect = (spell: string): string => byName(spell)?.effect ?? spell;
  const fxRun = (member: string): SpellFx | null => byFxMember.get(member.toLowerCase()) ?? null;
  const fxEffect = (name: string): string => {
    const f = byFxMember.get(name.toLowerCase());
    if (!f || lingoEq(f.effect, f.member)) {
      return name;
    }
    return f.effect;
  };
  const fxForEffect = (spell: string, effectFx: string): string => {
    const s = byName(spell);
    if (!s) {
      return effectFx;
    }
    const f = s.fx.find((r) => lingoEq(r.effect, effectFx));
    if (!f || lingoEq(f.effect, f.member)) {
      return effectFx;
    }
    return f.member;
  };
  return { byName, castEffect, fxRun, fxEffect, fxForEffect };
}

/** The table over the installed store's spells, rebuilt on every install. */
let defaultTable: SpellTable;

/** A spell by any case of its name, or null. */
export const spellByName = (name: string): Spell | null => defaultTable.byName(name);
/** The 1.6 spell whose effect code `spell` runs (unknown names: `spell` unchanged). */
export const castEffect = (spell: string): string => defaultTable.castEffect(spell);
/** An FX run by any case of its member base, or null. */
export const fxRun = (member: string): SpellFx | null => defaultTable.fxRun(member);
/** The 1.6 FX run member that `name` behaves as (1.6 runs, arrows, hazards: `name` unchanged). */
export const fxEffect = (name: string): string => defaultTable.fxEffect(name);
/** The art FX member for `spell` corresponding to 1.6 FX run `effectFx`. */
export const fxForEffect = (spell: string, effectFx: string): string =>
  defaultTable.fxForEffect(spell, effectFx);

// ---- the cast ---------------------------------------------------------------------

/** The action delay, 20 frames, shared with melee. */
export const CAST_DELAY = 20;

/**
 * A cast click must fall on the playfield (a bug fixed: 1.6 took `8 < H < 580`, `5 < V < 420`, a
 * margin around it).
 */
export function inCastBounds(h: number, v: number): boolean {
  const r = PLAYFIELD_RECT;
  return h >= r.left && v >= r.top && h < r.right && v < r.bottom;
}

/** In the harmful set, read from the spell row. */
export function isHarmful(spell: string): boolean {
  return spellByName(spell)?.harmful ?? false;
}

/**
 * The spells 1.6 listed, priced and taught but gave no effect: the cast handler places no FX and
 * nothing reads them (Haste's flag and Replenish's heal sat in a handler nothing called).
 */
const INERT_EFFECTS = [
  "Identify",
  "Poison Dart",
  "Weaken",
  "Bless",
  "Haste",
  "Replenish",
  "Holy Weapon",
];

/** True for a spell with no effect: SSO refuses it before anything is spent. */
export function isInert(spell: string): boolean {
  const eff = castEffect(spell);
  return INERT_EFFECTS.some((n) => lingoEq(eff, n));
}

export const CAST_TEXT = {
  harmful: "You cannot cast harmful spells here!",
  sp: (n: number) => `You need ${n} spell points to cast this!`,
  crystals: (spell: string) => `You don't have the required crystals to cast ${spell}!`,
  portal: "You cannot cast this close to another person.",
  /** SSO: a spell with no effect (`isInert`). */
  inert: "This spell has no power.",
  /** SSO: Portal with no destination whose map exists. */
  portalClosed: "The portal will not open.",
  summon: "You cannot summon here!",
} as const;

/**
 * The SP required: the table's cost by exact name, with Smoke Bomb's by body armour (25, Ninja
 * Outfit 17, Royal Ninja Uniform 13). 0 means the cast exits silently.
 */
export function spCost(spell: string, bodyE: string): number {
  const s = spellByName(spell);
  if (!s) {
    return 0;
  }
  if (s.spByBody) {
    const m = lastMatch(s.spByBody, bodyE);
    if (m) {
      return m.sp;
    }
  }
  return s.sp ?? 0;
}

/** The crystals a spell asks for, or null for none. */
export function crystalsFor(spell: string): { colour: string; count: number } | null {
  return spellByName(spell)?.crystals ?? null;
}

/** The summoned species config, or null for non-summon spells. */
export function summonFor(spell: string): SpellSummon | null {
  return spellByName(spell)?.summon ?? null;
}

/**
 * The crystal loader: the bag line (0-based) holding that colour's crystal, the **last** such line
 * of lines 1-16, or -1. (1.6 took any line containing "<Colour> Cry", so a renamed "Blue Crystal
 * Ring" would have been spent; SSO takes the crystal by its exact name.)
 */
export function crystalLine(bag: readonly ({ item: string } | null)[], colour: string): number {
  let found = -1;
  bag.forEach((l, i) => {
    if (l && i < 16 && lingoEq(crystalColour(l.item) ?? "", colour)) {
      found = i;
    }
  });
  return found;
}

/** What the spell power reads about the caster. */
export interface Caster {
  skills: readonly number[];
  equip: Equipment;
  faction: Faction;
}

const skill = (c: Caster, name: string) => skillValue(c.skills, name);

/** The base power, starting from 1. */
export function basePower(c: Caster): number {
  let p = 1;
  const magery = boundSkillValue(c.skills, "magery");
  for (const t of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    if (magery > t) {
      p += 1;
    }
  }
  if (c.faction.id === 1) {
    p += c.faction.f1Bonus;
  }
  p += gearBonus(c.equip, "spell");
  return p;
}

/** The Wrath, Blessing and Illusion bonuses: +2 at > 0, then +1 per tier. */
function tiered(v: number): number {
  let p = v > 0 ? 2 : 0;
  for (const t of [10, 20, 30, 50, 70, 80, 90, 97]) {
    if (v > t) {
      p += 1;
    }
  }
  return p;
}

/** The Black Arts bonus. */
function blackArts(c: Caster): number {
  let p = 0;
  for (const t of [10, 20, 30, 70, 90]) {
    if (skill(c, "BlackArts") > t) {
      p += 1;
    }
  }
  p += gearBonus(c.equip, "blackArts");
  return p;
}

/**
 * The Water, Earth, Fire and Wind bonuses: for the matching elemental mage class, +1 per
 * element-bonus tier over 10, 20 … 190, which adds nothing in 1.6 since nothing sends an element
 * bonus (read as 0); then the skill: +2, +1, +1, +1, +1, +1, +2, +4.
 */
function elemental(c: Caster, skillName: string): number {
  let p = 0;
  const v = skill(c, skillName);
  const steps: [number, number][] = [
    [0, 2],
    [10, 1],
    [20, 1],
    [30, 1],
    [50, 1],
    [70, 1],
    [80, 2],
    [97, 4],
  ];
  for (const [t, add] of steps) {
    if (v > t) {
      p += add;
    }
  }
  return p;
}

/** The Martial Arts bonus: replaces the power; the last true row wins. */
function martialArts(c: Caster): number {
  const ma = skill(c, "MartialArts");
  let p = 1;
  const rows: [number, number][] = [
    [101, 500],
    [90, 350],
    [80, 200],
    [70, 100],
    [60, 70],
    [50, 60],
    [40, 55],
    [30, 45],
    [20, 35],
    [10, 25],
  ];
  for (const [lt, v] of rows) {
    if (ma < lt) {
      p = v;
    }
  }
  p += gearBonus(c.equip, "martialArts");
  return p;
}

/**
 * The spell power for `spell` by its base name ("Fireball", "Wind Wave", "Bolt"). The caller works
 * it out before renaming the spell to its directional form (a bug fixed: 1.6 renamed Fireball and
 * Wind Wave first, so they never matched their school).
 */
export function spellPower(spell: string, c: Caster): number {
  let p = basePower(c);
  const is = (n: string) => lingoEq(spell, n);
  if (is("Minor Heal")) {
    p += tiered(skill(c, "Blessing"));
  }
  if (is("Smoke Bomb")) {
    p = martialArts(c);
  }
  for (const n of ["Major Heal", "Bless", "Haste", "Diminish Hunger"]) {
    if (is(n)) {
      p += tiered(skill(c, "Blessing"));
    }
  }
  for (const n of ["Meteor", "Radar", "Bolt", "Magic Shield"]) {
    if (is(n)) {
      p += tiered(skill(c, "Wrath"));
    }
  }
  for (const n of ["Morph", "Illusionary Spikes"]) {
    if (is(n)) {
      p += tiered(skill(c, "Illusion"));
    }
  }
  if (is("Splash")) {
    p += elemental(c, "Water");
  }
  for (const n of ["Crush", "Stone Skin"]) {
    if (is(n)) {
      p += elemental(c, "Earth");
    }
  }
  for (const n of ["Fireball", "Firesword", "Firebolt"]) {
    if (is(n)) {
      p += elemental(c, "Fire");
    }
  }
  for (const n of ["Whirlwind", "wind wave"]) {
    if (is(n)) {
      p += elemental(c, "Wind");
    }
  }
  for (const n of ["Hold", "Raise Dead", "Weaken"]) {
    if (is(n)) {
      p += blackArts(c);
    }
  }
  return p;
}

/**
 * The body number of a monster member name (`"<body>-<frame>-<facing>"`). The original tested the
 * member name for text such as `"45-"`, so a Shark (body 445) took Firebolt and Fireball as a
 * Ghoul (body 45) does; SSO compares the number (a bug fixed).
 */
export function memberBody(member: string): number {
  return Number.parseInt(member, 10);
}

/**
 * What a spell effect does to a monster, in the original's monster hit check: the cascade of
 * independent `if`s on the effect's member name, where the last true branch wins, so a later branch
 * overwrites an earlier one. `member` is the FX member name, `body` the monster's body member name,
 * `defense` its defense (`defenseOf`), `P` the FX's power. Draws in source order. Returns the
 * amount, whether it heals, and whether the splat shows; null when no branch hit.
 */
export function spellHitOnMonster(
  member: string,
  body: string,
  defense: number,
  P: number,
  rng: Rng,
): { n: number; heal: boolean; splat: boolean } | null {
  const is = (n: string) => lingoEq(member, n);
  const r = rng;
  let hit: { n: number; heal: boolean; splat: boolean } | null = null;
  if (lingoContains(member, " Arrows")) {
    let n = P - defense;
    if (n < 1) {
      n = r.random(2);
    }
    hit = { n, heal: false, splat: true };
  }
  const undead = memberBody(body) === 61;
  if (is("minor heal-3")) {
    hit = undead
      ? { n: 1 + P + r.random(2), heal: false, splat: true }
      : { n: 3 + P + r.random(5), heal: true, splat: false };
  }
  if (is("major heal-3")) {
    hit = undead
      ? { n: 5 + P + r.random(5), heal: false, splat: true }
      : { n: 15 + P + r.random(10), heal: true, splat: false };
  }
  for (const n of ["meteor-13", "BoltL-1", "BoltR-1", "BoltU-1", "BoltD-1", "meteor-19"]) {
    if (is(n)) {
      hit = { n: 15 + P + r.random(3), heal: false, splat: true };
    }
  }
  if (memberBody(body) === 90 && is("Dispel Illusions-8")) {
    hit = { n: 2000, heal: false, splat: true };
  }
  if (is("splash-18")) {
    hit =
      memberBody(body) === 36
        ? { n: 10 + P + r.random(5), heal: true, splat: true }
        : { n: 20 + P + r.random(3), heal: false, splat: true };
  }
  if (is("crush-18")) {
    hit =
      memberBody(body) === 47
        ? { n: 8 + P + r.random(3), heal: true, splat: true }
        : { n: 6 + P + r.random(3), heal: false, splat: true };
  }
  if (is("Firebolt-12")) {
    hit =
      memberBody(body) === 45
        ? { n: 6 + P + r.random(3), heal: true, splat: true }
        : { n: 6 + P + r.random(3), heal: false, splat: true };
  }
  for (const n of ["FireballL-1", "FireballR-1", "FireballU-1", "FireballD-1"]) {
    if (is(n)) {
      let dmg = 4 + P + r.random(3);
      if (memberBody(body) === 45) {
        dmg = r.random(3);
      }
      hit = { n: dmg, heal: false, splat: true };
    }
  }
  for (const n of ["Wind waveL-1", "wind waveR-1", "wind waveU-1", "wind waveD-1"]) {
    if (is(n)) {
      hit = { n: 2 + P + r.random(5), heal: false, splat: true };
    }
  }
  return hit;
}

/** The branches of the spell collision that deal or heal an amount to a player. */
export type PlayerSpellBranch =
  | "Arrows"
  | "crush"
  | "firebolt"
  | "Splash"
  | "meteor"
  | "Fireball"
  | "Bolt"
  | "wind wave"
  | "major heal"
  | "minor heal";

/** What the spell-defense lookup reads about the player a spell hits. */
export interface SpellTarget {
  equip: Equipment;
  /** The Magic Shield counter is running. */
  magicShield: boolean;
}

/**
 * 1.6's spell-defense lookup (`GetSpellDef`): each worn item's row adds to the damage (metal adds,
 * robes take off), Magic Shield takes off 5, then a positive amount gains `random(3)` and anything
 * below 1 becomes `random(3)`. Exactly one draw. A bug fixed: 1.6 changed only a by-value copy,
 * so armour and Magic Shield never touched spell damage.
 */
export function spellDefense(n: number, t: SpellTarget, rng: Rng): number {
  const def = content().itemRules.armour.spell;
  let p = n;
  for (const r of def.rows) {
    if (ruleMatches(slotItem(t.equip, r.slot), r)) {
      p += r.delta;
    }
  }
  if (t.magicShield) {
    p += def.magicShield;
  }
  if (p > 0) {
    return p + rng.random(3);
  }
  return rng.random(3);
}

/**
 * The amount one branch of the spell collision deals or heals, drawing in source order. The
 * branches 1.6 sent through the spell-defense lookup (arrows, Crush, Meteor, Fireball, Bolt and
 * Wind Wave, not Firebolt or Splash) pass the amount through `spellDefense`. The guards, exits and
 * state changes stay with the caller.
 */
export function playerSpellAmount(
  branch: PlayerSpellBranch,
  P: number,
  target: SpellTarget,
  rng: Rng,
): number {
  const r = rng;
  const def = (n: number) => spellDefense(n, target, r);
  switch (branch) {
    case "Arrows":
      return def(P + r.random(2));
    case "crush":
      return def(6 + P + r.random(3));
    case "firebolt":
      return 8 + P + r.random(3);
    case "Splash":
      return 20 + P + r.random(3);
    case "meteor":
      return def(15 + P + r.random(3));
    case "Fireball":
      return def(9 + P + r.random(3));
    case "Bolt":
      return def(18 + P + r.random(8));
    case "wind wave":
      return def(2 + P + r.random(5));
    case "major heal":
      return 15 + P + r.random(5);
    case "minor heal":
      return 2 + P + r.random(2);
  }
}

/**
 * The Fireball and Ice Wave direction: from the caster's sprite to the mouse; the larger of |dx|
 * and |dy| picks the axis, LEFT and UP by default, and an exact tie keeps the name, which becomes
 * the R form. Wind's names are "Wind waveL" etc.
 */
export function directional(
  base: "Fireball" | "Wind wave",
  casterH: number,
  casterV: number,
  mouseH: number,
  mouseV: number,
): string {
  const lr = mouseH > casterH ? "RIGHT" : "LEFT";
  const ud = mouseV > casterV ? "DOWN" : "UP";
  const fLR = lr === "LEFT" ? casterH - mouseH : mouseH - casterH;
  const fUD = ud === "UP" ? casterV - mouseV : mouseV - casterV;
  if (fLR > fUD) {
    return `${base}${lr === "LEFT" ? "L" : "R"}`;
  }
  if (fLR < fUD) {
    return `${base}${ud === "UP" ? "U" : "D"}`;
  }
  return `${base}R`;
}

/** Bolt's form by the caster's facing. */
export function boltForm(facing: Facing): string {
  return { E: "BoltR", W: "BoltL", N: "BoltU", S: "BoltD" }[facing];
}

/** Fire Staff and Firesword fireballs: the name from `Facing`. */
export function fireballForm(facing: Facing): string {
  return { E: "FireballR", W: "FireballL", N: "FireballU", S: "FireballD" }[facing];
}

// ---- skill gain on your own cast ------------------------------------------------

/** Spell names the cast skill gain leaves at once. */
const IMP_EXITS = [
  "Cannon",
  "Arrow",
  "Fishing",
  "sprinkle",
  "Machine",
  "slot",
  "Blackjack",
  "cards",
  "xSmoke",
  "BSmith",
  "Smith",
];

/** The Mage skill cap in the cast skill gain: the same table as the kill path (`mageSkillCap`). */
export function castMageCap(f: Faction): number {
  return mageSkillCap(f);
}

/**
 * The school rows after Magery, matched against the base spell name (`baseSpell`), the match, the
 * skill, its cap and the line.
 */
const SCHOOL_ROWS: { spell: string; match: "=" | "contains"; skill: string; text: string }[] = [
  { spell: "Minor Heal", match: "=", skill: "Blessing", text: "blessing" },
  { spell: "Major Heal", match: "=", skill: "Blessing", text: "blessing" },
  { spell: "Replenish", match: "=", skill: "Blessing", text: "blessing" },
  { spell: "Diminish Hunger", match: "=", skill: "Blessing", text: "blessing" },
  { spell: "Smoke Bomb", match: "=", skill: "MartialArts", text: "Martial Arts" },
  { spell: "Radar", match: "=", skill: "Wrath", text: "Wrath" },
  { spell: "Meteor", match: "=", skill: "Wrath", text: "Wrath" },
  { spell: "Magic Shield", match: "=", skill: "Wrath", text: "Wrath" },
  { spell: "Bolt", match: "=", skill: "Wrath", text: "Wrath" },
  { spell: "Morph", match: "=", skill: "Illusion", text: "illusion" },
  { spell: "Web", match: "=", skill: "Wizardry", text: "Wizardry" },
  { spell: "Illusionary Spikes", match: "=", skill: "Illusion", text: "illusion" },
  { spell: "Firesword", match: "contains", skill: "Fire", text: "Fire" },
  { spell: "Fireball", match: "contains", skill: "Fire", text: "Fire" },
  { spell: "Firebolt", match: "=", skill: "Fire", text: "Fire" },
  { spell: "Splash", match: "=", skill: "Water", text: "Water" },
  { spell: "Earth Shift", match: "=", skill: "Earth", text: "Earth" },
  { spell: "Raise Dead", match: "=", skill: "BlackArts", text: "" },
  { spell: "Hold", match: "=", skill: "BlackArts", text: "" },
  { spell: "Summon Creature", match: "=", skill: "Sorcery", text: "Sorcery" },
  { spell: "Holy Shield", match: "=", skill: "Blessing", text: "Blessing" },
  { spell: "Dispel Illusions", match: "=", skill: "Wizardry", text: "Wizardry" },
  { spell: "Stone Skin", match: "=", skill: "Earth", text: "Earth" },
  { spell: "Crush", match: "=", skill: "Earth", text: "Earth" },
  { spell: "Wind Wave", match: "=", skill: "Wind", text: "Wind" },
  { spell: "Whirlwind", match: "=", skill: "Wind", text: "Wind" },
];

/** The advance line for a school row. Black Arts reads "in the Black Arts!" */
function impText(row: { skill: string; text: string }): string {
  return row.skill === "BlackArts"
    ? "You have advanced in the Black Arts!"
    : `You have advanced in the art of ${row.text}!`;
}

/**
 * The base spell of a directional cast name: "FireballL", "BoltR" and "Wind waveU" read as
 * "Fireball", "Bolt" and "Wind Wave"; any other name is unchanged.
 */
export function baseSpell(name: string): string {
  const m = /^(fireball|bolt|wind wave)[lrud]$/i.exec(name);
  if (!m) {
    return name;
  }
  const base = (m[1] ?? "").toLowerCase();
  return base === "fireball" ? "Fireball" : base === "bolt" ? "Bolt" : "Wind Wave";
}

/**
 * The cast skill gain for your own cast: Magery `random(Magery) = 1` while 0 < Magery < the Mage
 * skill cap, then each matching school row the same way (Martial Arts up to 100). Raises the skills
 * in place and returns the lines, in order. A directional name trains its base spell's school (a
 * bug fixed: 1.6 compared "BoltR" and "Wind waveR" with "Bolt" and "Wind Wave", so they never
 * trained). The "Music" row (Musicianship) is not built: only the unreachable composer sends a
 * "Music" cast, so Musicianship never rises in 1.6.
 */
export function spellImp(
  spellName: string,
  skills: number[],
  faction: Faction,
  rng: Rng,
): string[] {
  const eff = baseSpell(fxEffect(spellName));
  if (IMP_EXITS.some((x) => lingoContains(eff, x))) {
    return [];
  }
  const lines: string[] = [];
  const cap = castMageCap(faction);
  // A skill the world does not have (or a Magery it does not bind) is never rolled.
  const roll = (i: number | undefined, max: number, text: string) => {
    if (i === undefined) {
      return;
    }
    const v = skills[i] ?? 0;
    if (v > 0 && v < max && rng.random(v) === 1) {
      lines.push(text);
      skills[i] = v + 1;
    }
  };
  roll(boundSkillIndex("magery"), cap, "You have advanced in the art of magery!");
  for (const row of SCHOOL_ROWS) {
    const hit = row.match === "=" ? lingoEq(eff, row.spell) : lingoContains(eff, row.spell);
    if (hit) {
      roll(findSkillIndex(row.skill), row.skill === "MartialArts" ? 100 : cap, impText(row));
    }
  }
  return lines;
}

// ---- books ---------------------------------------------

export const BOOK_TEXT = {
  dex: "Your mysticism is not high enough to learn this spell.",
  read: "You read the book...",
  known: "You already know this spell.",
  learned: (spell: string) => `You have learned the spell of ${spell}.`,
  advanced: (skill: string) => `You have advanced in the art of ${skill}!`,
  nothingMore: "There is nothing more you can learn from this book.",
} as const;

/** The required Dexterity: 1, then each `use.books` row that matches (the last true wins). */
export function bookDex(item: string): number {
  return lastMatch(content().itemRules.use.books, item)?.mysticism ?? 1;
}

/**
 * The book's spell rows are `content().spells.spells` in 1.6's file order: the last match wins. Only
 * Bolt and Firebolt overlap ("Firebolt Book" contains both).
 */
let BOOK_ROWS: (NonNullable<Spell["book"]> & { name: string })[];

export type BookResult =
  | { kind: "skill"; skill: string; lines: string[] }
  | { kind: "spell"; spell: string; lines: string[] }
  | { kind: "none"; lines: string[] };

/** A combat book teaches only below this skill, and never takes the skill past it. */
export const SKILL_BOOK_CAP = 77;

/**
 * Reading a book: a combat book below 77 adds `1 + random(5)`, stopping at 77 (a bug fixed: 1.6
 * let the last read reach 82); a spell book appends its spell unless an exact line already holds
 * it. `skills` and `spellbook` change in place. Only a `skill` or `spell` result teaches anything,
 * and only then is the book used up.
 */
export function runBook(book: string, skills: number[], spellbook: string[], rng: Rng): BookResult {
  const skillBook = firstMatch(content().itemRules.use.skillBooks, book);
  if (skillBook) {
    const i = skillIndex(skillBook.skill);
    if ((skills[i] ?? 0) < SKILL_BOOK_CAP) {
      skills[i] = Math.min(SKILL_BOOK_CAP, (skills[i] ?? 0) + 1 + rng.random(5));
      return {
        kind: "skill",
        skill: skillBook.shown,
        lines: [BOOK_TEXT.advanced(skillBook.shown)],
      };
    }
    return { kind: "none", lines: [BOOK_TEXT.nothingMore] };
  }
  const spell = lastMatch(BOOK_ROWS, book)?.name ?? null;
  if (!spell) {
    return { kind: "none", lines: [] };
  }
  if (spellbook.some((l) => l === spell)) {
    return { kind: "none", lines: [BOOK_TEXT.known] };
  }
  spellbook.push(spell);
  return { kind: "spell", spell, lines: [BOOK_TEXT.learned(spell)] };
}

/**
 * What is saved of a spellbook: every line that names a spell, Identify included, however many
 * there are (a bug fixed: 1.6 saved at most 29 lines as encode ids, and Identify had none).
 */
export function savedSpellbook(spellbook: readonly string[]): string[] {
  return spellbook.filter((s) => spellByName(s) !== null);
}

// ---- effects on players and their counters ----------------------------------

export const EFFECT_TEXT = {
  fireswordOn: "Your sword burns with a fiery fury.",
  fireswordNoSword: "You feel a warmth you haven't felt before, but feel it has not assisted you.",
  magicShield: "The magic shield pulses through your body, keeping harmful spells out.",
  hunger: "Your hunger has diminished.",
  stoneSkin: "You suddenly feel much stronger.",
  argon: "The power of argon flows through your body.",
  hold: "Your feet become heavy, you are unable to move!",
  stoneSkinEnds: "Your skin has turned back to normal.",
  argonEnds: "You no longer feel the power of Argon helping you in battle.",
  fireswordEnds: "The fire from your sword has died down.",
  magicShieldEnds: "The magic barrier that protects you has died down.",
} as const;

/** Morph: `N = 3 + P + random(5)`; the last threshold passed picks the body. */
export function morphBody(power: number, rng: Rng): number {
  const n = 3 + power + rng.random(5);
  let body = 0;
  const rows: [number, number][] = [
    [0, 30],
    [10, 32],
    [13, 31],
    [16, 33],
    [19, 37],
    [21, 34],
    [23, 41],
    [24, 40],
  ];
  for (const [gt, b] of rows) {
    if (n > gt) {
      body = b;
    }
  }
  return body;
}

/** The morph counter from a body change: unchanged at exactly 300. */
export function morphCounterFor(body: number, current: number): number {
  if (body < 300) {
    return 1300;
  }
  if (body > 300) {
    return 10_000_000_000;
  }
  return current;
}

/** `runradar`: one of three lines by `random(3)`. */
export function radarText(
  name: string,
  v: { gold: number; hp: number; sp: number },
  rng: Rng,
): string {
  const which = rng.random(3);
  if (which === 1) {
    return `*** ${name} is carrying ${v.gold} Gold.`;
  }
  if (which === 2) {
    return `*** ${name} has ${v.hp} Hit Points.`;
  }
  return `*** ${name} has ${v.sp} Spell Points.`;
}

/**
 * The experience-band text: the band for `ExpNeeded − exp`; at 10000 or more no band sets the band
 * text, so the line is the bare name (an unset local is empty).
 */
export function inxitionText(name: string, expNeeded: number, exp: number): string {
  const gap = expNeeded - exp;
  let t = "";
  const bands: [number, string][] = [
    [10000, " is extremely far from becoming more powerful."],
    [250, " is far from becoming more powerful."],
    [200, " still has much to learn before becoming more powerful."],
    [150, " has progressed well thus far, and will become more powerful in the coming battles."],
    [100, " is close to becoming more powerful."],
    [70, " will become more powerful very soon."],
    [30, " will become more powerful within only a few more fights."],
  ];
  for (const [lt, s] of bands) {
    if (gap < lt) {
      t = s;
    }
  }
  return `${name}${t}`;
}

/** Create Food: the item and its line. */
export function createFood(
  filledBagLines: number,
  rng: Rng,
): { item: string | null; text: string } {
  const food = ["Apple", "Pie", "Corn", "Fish", "Ale"][rng.random(5) - 1] ?? "Apple";
  if (filledBagLines > 14) {
    return {
      item: null,
      text: `The ${food} appears briefly but then vanishes because you're carrying too much.`,
    };
  }
  const text =
    food === "Apple"
      ? `Suddenly, an ${food} appears in your inventory.`
      : `Suddenly, ${food} appears in your inventory.`;
  return { item: food, text };
}

onContent((c) => {
  defaultTable = spellTable(c.spells.spells);
  BOOK_ROWS = c.spells.spells.flatMap((s) => (s.book ? [{ ...s.book, name: s.name }] : []));
});
