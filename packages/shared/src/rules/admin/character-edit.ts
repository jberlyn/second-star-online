/**
 * The player hub's character editor (issue #26): what an admin may change on a character, the
 * game's own limits for each value, and the edit log's before and after values that undo works
 * from. 1.6 had no editor: staff changed a character's text file by hand, with nothing checked or
 * logged. Pure.
 *
 * - **One shape for live and saved:** an edit reads the character as the hub does (`CharacterSheet`)
 *   and flattens it to `EditableCharacter`, so an online and an offline edit are checked alike.
 * - **Hard game limits:** every value must be one the game could hold (`editErrors`). Values the
 *   game works out from others are recalculated, not typed (`deriveEdit`): a level change sets the
 *   experience needed and moves HP and SP max by the levels gained or lost, as a level-up does.
 * - **Wear rules:** worn gear must fit its slot, be strong enough to wear and not clash with a
 *   two-handed weapon. Breaking that needs an explicit override, which the log records
 *   (`wearBreaks`).
 * - **Undo refuses on conflict:** an edit is undone only while every field it changed still holds
 *   the value it set (`undoConflicts`).
 */

import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { content } from "../../content/store.ts";
import {
  type Equipment,
  findSkillIndex,
  NOTHING,
  type SkillValues,
  skillDisplay,
} from "../core/fighter.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";
import { checkEquip, EQUIP_TEXT } from "../inventory/equip.ts";
import {
  BAG_SLOTS,
  CURRENCY,
  displayName,
  EQUIP_FIELD,
  EQUIP_SLOTS,
  isGoldName,
  isUniqueContainer,
} from "../inventory/inventory.ts";
import { HEADS_BY_SEX, type Sex, STAT_MAX, STAT_MIN } from "../progression/creation.ts";
import type { StatKey } from "../progression/stats.ts";
import type { CharacterSheet } from "./characters.ts";

/** A map tile, by map name. */
export interface EditPoint {
  map: string;
  x: number;
  y: number;
}

export interface EditBagLine {
  item: string;
  qty: number;
}

/** A character as the editor sees it: the hub's sheet, flattened. */
export interface EditableCharacter {
  classCode: number;
  level: number;
  exp: number;
  /** Derived from the level. */
  expNeeded: number;
  hp: number;
  /** Derived: moves with the level. */
  hpMax: number;
  sp: number;
  /** Derived: moves with the level. */
  spMax: number;
  str: number;
  sta: number;
  dex: number;
  int: number;
  wis: number;
  /**
   * Every skill the content lists, by skill key. An edit's change names only the skills it moved,
   * so it (and its undo) never touches a skill added or removed since.
   */
  skills: SkillValues;
  hunger: number;
  /** 0 none, 1 Mage, 2 Warrior, 3 Adventurer. */
  faction: number;
  factionCount: number;
  wanted: boolean;
  /** Null only when its map was deleted (the fallback point is used then). */
  respawn: EditPoint | null;
  gold: number;
  /** Null with no bank account yet. */
  bank: number | null;
  /** 15 lines; null is an empty line. */
  bag: (EditBagLine | null)[];
  /** Worn gear by slot field; "NOTHING" when empty. */
  equip: Equipment;
  vault: string[];
  spellbook: string[];
  position: EditPoint;
  sex: number;
  head: number;
}

export type EditField = keyof EditableCharacter;

/** The fields the game works out from others: never sent by the editor, always recalculated. */
export const DERIVED_FIELDS = ["expNeeded", "hpMax", "spMax"] as const satisfies EditField[];

export const STAT_FIELDS = ["str", "sta", "dex", "int", "wis"] as const satisfies (EditField &
  StatKey)[];

/** The fields that move what a character carries or keeps: refused while they trade or gamble. */
export const ITEM_FIELDS = ["gold", "bank", "bag", "equip", "vault"] as const satisfies EditField[];

/** Every field, in the order the log lists them. */
export const EDIT_FIELDS: readonly EditField[] = [
  "classCode",
  "level",
  "exp",
  "expNeeded",
  "hp",
  "hpMax",
  "sp",
  "spMax",
  ...STAT_FIELDS,
  "skills",
  "hunger",
  "faction",
  "factionCount",
  "wanted",
  "respawn",
  "gold",
  "bank",
  "bag",
  "equip",
  "vault",
  "spellbook",
  "position",
  "sex",
  "head",
];

/** A field the editor may send: every field but the derived ones. */
export type SettableField = Exclude<EditField, (typeof DERIVED_FIELDS)[number]>;

export const SETTABLE_FIELDS: readonly SettableField[] = EDIT_FIELDS.filter(
  (f): f is SettableField => !(DERIVED_FIELDS as readonly string[]).includes(f),
);

export const FIELD_LABELS: Record<EditField, string> = {
  classCode: "Class",
  level: "Level",
  exp: "Experience",
  expNeeded: "Experience needed",
  hp: "HP",
  hpMax: "HP max",
  sp: "SP",
  spMax: "SP max",
  str: "Strength",
  sta: "Stamina",
  // The game labels Dexterity "Mysticism" on the stats panel and the creation screen.
  dex: "Mysticism (dex)",
  int: "Intelligence",
  wis: "Wisdom",
  skills: "Skills",
  hunger: "Hunger",
  faction: "Faction",
  factionCount: "Faction time",
  wanted: "Wanted",
  respawn: "Respawn point",
  gold: "Gold",
  bank: "Bank",
  bag: "Bag",
  equip: "Worn gear",
  vault: "Vault",
  spellbook: "Spellbook",
  position: "Position",
  sex: "Sex",
  head: "Head",
};

/**
 * The limits. Where the game itself has no ceiling (level, gold, a stack, faction time) the cap
 * is the largest whole number the NPC files accept, so nothing typed can overflow.
 */
export const EDIT_LIMITS = {
  /** The game raises levels without end; this only keeps the numbers sane. */
  levelMax: 10_000,
  /** The highest skill cap any faction reaches (skillgain.ts). */
  skillMax: 100,
  skillMin: 1,
  /** A new character starts with the most hunger the game gives (50000); a death sets 40000. */
  get hungerMax(): number {
    return Math.max(40_000, content().classes.creation.otherFields.hunger);
  },
  intMax: 2_000_000_000,
  /** The personal vault's lines (systems/economy/vault.ts `VAULT_CAPACITY`). */
  vaultMax: 15,
} as const;

/** Experience needed for the next level at `level`: 30 at level 1, 400 at 2, then 400 + 2·level. */
export function expNeededAt(level: number): number {
  if (level <= 1) {
    return 30;
  }
  return level === 2 ? 400 : 400 + level + level;
}

/** The sheet as the editor sees it. */
export function editableOf(s: CharacterSheet): EditableCharacter {
  return {
    classCode: s.classCode,
    level: s.level,
    exp: s.exp,
    expNeeded: s.expNeeded,
    hp: s.hp,
    hpMax: s.hpMax,
    sp: s.sp,
    spMax: s.spMax,
    ...s.stats,
    skills: { ...s.skills },
    hunger: s.hunger,
    faction: s.faction,
    factionCount: s.factionCount,
    wanted: s.wanted,
    respawn: s.respawn ? { ...s.respawn } : null,
    gold: s.gold,
    bank: s.bank,
    bag: s.bag.map((l) => (l ? { item: l.item, qty: l.qty } : null)),
    equip: {
      weapon: s.equip.weapon ?? NOTHING,
      offHand: s.equip.offHand ?? NOTHING,
      head: s.equip.head ?? NOTHING,
      body: s.equip.body ?? NOTHING,
      feet: s.equip.feet ?? NOTHING,
      ring: s.equip.ring ?? NOTHING,
    },
    vault: [...s.vault],
    spellbook: [...s.spellbook],
    position: { map: s.position.map, x: s.position.x, y: s.position.y },
    sex: s.sex,
    head: s.head,
  };
}

/** Two field values are the same (plain JSON values; map names compare ignoring case). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}

function normal(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(normal);
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [
          k,
          k === "map" && typeof o[k] === "string" ? o[k].toLowerCase() : normal(o[k]),
        ]),
    );
  }
  return v;
}

/** One field an edit changed. */
export interface EditChange {
  field: EditField;
  before: unknown;
  after: unknown;
}

/** The fields whose values differ, in `EDIT_FIELDS` order. */
export function diffEdit(before: EditableCharacter, after: EditableCharacter): EditChange[] {
  return EDIT_FIELDS.filter((f) => !sameValue(before[f], after[f])).map((f) =>
    f === "skills"
      ? { field: f, ...movedSkills(before.skills, after.skills) }
      : { field: f, before: structuredClone(before[f]), after: structuredClone(after[f]) },
  );
}

/** The skills whose values differ, before and after, keyed by skill key. */
function movedSkills(
  before: Readonly<SkillValues>,
  after: Readonly<SkillValues>,
): { before: SkillValues; after: SkillValues } {
  const out = { before: {} as SkillValues, after: {} as SkillValues };
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] !== after[k]) {
      out.before[k] = before[k] as number;
      out.after[k] = after[k] as number;
    }
  }
  return out;
}

/**
 * `current` with `changes` applied and the derived values worked out again. A level change sets
 * the experience needed for the new level and moves HP and SP max by the levels gained or lost,
 * as a level-up does; HP, SP and experience not typed in are brought within their new limits.
 */
export function deriveEdit(
  current: EditableCharacter,
  changes: Partial<EditableCharacter>,
): EditableCharacter {
  const after: EditableCharacter = structuredClone({ ...current, ...changes });
  // Skills typed in are laid over the current ones: an edit may name only some.
  after.skills = { ...current.skills, ...(changes.skills ?? {}) };
  for (const f of DERIVED_FIELDS) {
    after[f] = current[f];
  }
  if (after.level !== current.level && Number.isInteger(after.level)) {
    const d = after.level - current.level;
    after.expNeeded = expNeededAt(after.level);
    after.hpMax = Math.max(1, current.hpMax + d);
    after.spMax = Math.max(0, current.spMax + d);
    if (changes.exp === undefined) {
      after.exp = Math.min(after.exp, after.expNeeded - 1);
    }
  }
  if (changes.hp === undefined) {
    after.hp = Math.min(after.hp, after.hpMax);
  }
  if (changes.sp === undefined) {
    after.sp = Math.min(after.sp, after.spMax);
  }
  return after;
}

const isInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/**
 * An item an admin may create: a catalogue name or spelling, or an Inventory fixture. A retired
 * item is not one: copies already held stay, but no more can be made (issue #28).
 */
export function knownItem(name: string): boolean {
  const n = displayName(name);
  return (
    content().items.items.some(
      (i) => !i.retired && (lingoEq(i.name, n) || (i.variants ?? []).some((v) => lingoEq(v, n))),
    ) || content().items.fixtures.some((f) => lingoEq(f, n))
  );
}

/** Gold in any spelling: a pile (`5 Gold`, which adds to the purse) or the bare catalogue name. */
const isGold = (name: string): boolean =>
  isGoldName(name) || (CURRENCY !== null && lingoEq(displayName(name), CURRENCY));

/** A container with storage of its own, which the vault refuses (vault.ts `depositVault`). */
const isStorage = (name: string): boolean =>
  ["Cabinet", "Crate", "Cauldron"].some((c) => lingoContains(name, c));

/** A spell the game knows, by its exact listed name. */
export function knownSpell(name: string): boolean {
  return content().spells.spells.some((s) => s.name === name);
}

const pointError = (label: string, p: unknown): string | null => {
  const q = p as EditPoint | null;
  if (!q || typeof q.map !== "string" || q.map.trim() === "") {
    return `${label}: give a map.`;
  }
  if (!isInt(q.x, 1, MAP_WIDTH) || !isInt(q.y, 1, MAP_HEIGHT)) {
    return `${label}: the tile must be within 1-${MAP_WIDTH} across and 1-${MAP_HEIGHT} down.`;
  }
  return null;
};

/**
 * Why `after` is not a state the game could hold, one line per problem; empty when it is. Only
 * the fields that changed from `before` are checked item by item, so an old item still in a bag
 * does not block an unrelated edit. Map names are checked by the caller, which knows the maps.
 */
export function editErrors(
  before: EditableCharacter,
  after: EditableCharacter,
  opts: { restore?: boolean } = {},
): string[] {
  const errors: string[] = [];
  // An undo puts back values the character really held, so only the checks that tie fields
  // together (experience, HP and SP within their limits) apply to it.
  const changed = (f: EditField) => !opts.restore && !sameValue(before[f], after[f]);
  // Exact names the character already holds: one may move between lines whether or not the
  // catalogue still lists it (a painting, a retired item).
  const held = new Set([
    ...before.bag.flatMap((l) => (l ? [l.item] : [])),
    ...Object.values(before.equip),
    ...before.vault,
  ]);
  const L = EDIT_LIMITS;
  if (changed("classCode") && !content().classes.classes.some((c) => c.code === after.classCode)) {
    errors.push("Class: there is no such class.");
  }
  if (!isInt(after.level, 1, L.levelMax)) {
    errors.push(`Level: a whole number from 1 to ${L.levelMax}.`);
  }
  if (!isInt(after.exp, 0, Math.max(0, after.expNeeded - 1))) {
    errors.push(
      `Experience: a whole number from 0 to ${Math.max(0, after.expNeeded - 1)} (one less than the ${after.expNeeded} needed).`,
    );
  }
  if (!isInt(after.hp, 1, after.hpMax)) {
    errors.push(`HP: a whole number from 1 to ${after.hpMax}.`);
  }
  if (!isInt(after.sp, 0, after.spMax)) {
    errors.push(`SP: a whole number from 0 to ${after.spMax}.`);
  }
  for (const f of STAT_FIELDS) {
    if (changed(f) && !isInt(after[f], STAT_MIN, STAT_MAX)) {
      errors.push(`${FIELD_LABELS[f]}: a whole number from ${STAT_MIN} to ${STAT_MAX}.`);
    }
  }
  if (changed("skills")) {
    for (const [k, v] of Object.entries(after.skills)) {
      if (v === before.skills[k]) {
        continue;
      }
      // Exactly a key the sheet lists: another spelling would be logged under a name its undo
      // could not find.
      if (!(k in before.skills) || findSkillIndex(k) === undefined) {
        errors.push(`Skills: there is no skill ${k}.`);
      } else if (!isInt(v, L.skillMin, L.skillMax)) {
        errors.push(`${skillDisplay(k)}: a whole number from ${L.skillMin} to ${L.skillMax}.`);
      }
    }
  }
  if (changed("hunger") && !isInt(after.hunger, 0, L.hungerMax)) {
    errors.push(`Hunger: a whole number from 0 to ${L.hungerMax}.`);
  }
  if (changed("faction") && !isInt(after.faction, 0, 3)) {
    errors.push("Faction: none, Mage, Warrior or Adventurer.");
  }
  if (changed("factionCount") && !isInt(after.factionCount, 0, L.intMax)) {
    errors.push(`Faction time: a whole number from 0 to ${L.intMax}.`);
  }
  if (changed("wanted") && typeof after.wanted !== "boolean") {
    errors.push("Wanted: yes or no.");
  }
  if (changed("respawn")) {
    const e = pointError("Respawn point", after.respawn);
    if (e) {
      errors.push(e);
    }
  }
  if (changed("position")) {
    const e = pointError("Position", after.position);
    if (e) {
      errors.push(e);
    }
  }
  if (changed("gold") && !isInt(after.gold, 0, L.intMax)) {
    errors.push(`Gold: a whole number from 0 to ${L.intMax}.`);
  }
  if (changed("bank")) {
    if (before.bank === null) {
      errors.push("Bank: they have no bank account yet.");
    } else if (!isInt(after.bank, 0, L.intMax)) {
      errors.push(`Bank: a whole number from 0 to ${L.intMax}.`);
    }
  }
  if (changed("bag")) {
    if (after.bag.length !== BAG_SLOTS) {
      errors.push(`Bag: there are ${BAG_SLOTS} lines.`);
    } else {
      after.bag.forEach((l, i) => {
        if (!l || sameValue(l, before.bag[i])) {
          return;
        }
        const at = `Bag line ${i + 1}`;
        if (isGold(l.item)) {
          errors.push(`${at}: gold is not a bag item; change the gold instead.`);
        } else if (l.item.includes("#") && l.qty !== 1) {
          errors.push(`${at}: ${displayName(l.item)} has its own id, so it never stacks.`);
        } else if (!held.has(l.item) && !knownItem(l.item)) {
          errors.push(`${at}: there is no item called ${l.item}.`);
        } else if (!isInt(l.qty, 1, L.intMax)) {
          errors.push(`${at}: the quantity is a whole number from 1 to ${L.intMax}.`);
        } else if (isUniqueContainer(displayName(l.item)) && l.qty !== 1) {
          errors.push(`${at}: a ${displayName(l.item)} has its own storage, so it never stacks.`);
        }
      });
    }
  }
  if (changed("equip")) {
    for (const s of EQUIP_SLOTS) {
      const f = EQUIP_FIELD[s];
      const v = after.equip[f];
      if (v !== before.equip[f] && v !== NOTHING && v.includes("#")) {
        errors.push(`Worn ${WORN_LABELS[f] ?? f}: ${displayName(v)} can't be worn.`);
      } else if (v !== before.equip[f] && v !== NOTHING && !knownItem(v)) {
        errors.push(`Worn ${WORN_LABELS[f] ?? f}: there is no item called ${String(v)}.`);
      }
    }
  }
  if (changed("vault")) {
    if (after.vault.length > L.vaultMax) {
      errors.push(`Vault: at most ${L.vaultMax} lines.`);
    }
    after.vault.forEach((v, i) => {
      if (v === before.vault[i]) {
        return;
      }
      if (isGold(v)) {
        errors.push(`Vault line ${i + 1}: gold is not a vault item.`);
      } else if (isStorage(v)) {
        // As a deposit is refused: a container can't be stored in the vault.
        errors.push(`Vault line ${i + 1}: a container can't be stored in the vault.`);
      } else if (!held.has(v) && !knownItem(v)) {
        errors.push(`Vault line ${i + 1}: there is no item called ${v}.`);
      }
    });
  }
  if (!opts.restore && (changed("bag") || changed("equip") || changed("vault"))) {
    errors.push(...storageIdErrors(before, after));
    errors.push(...unmakeableErrors(before, after));
  }
  if (changed("spellbook")) {
    const seen = new Set<string>();
    for (const s of after.spellbook) {
      if (!knownSpell(s)) {
        errors.push(`Spellbook: there is no spell called ${s}.`);
      } else if (seen.has(s)) {
        errors.push(`Spellbook: ${s} is listed twice.`);
      }
      seen.add(s);
    }
  }
  if (changed("sex") || changed("head")) {
    if (after.sex !== 1 && after.sex !== 2) {
      errors.push("Sex: male or female.");
    } else if (!HEADS_BY_SEX[after.sex as Sex].includes(after.head)) {
      errors.push(
        `Head: a ${after.sex === 2 ? "female" : "male"} head is one of ${HEADS_BY_SEX[after.sex as Sex].join(", ")}.`,
      );
    }
  }
  return errors;
}

/** How many of each `#id` name a character holds across the bag, worn gear and vault. */
function idCounts(c: EditableCharacter): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string) => {
    if (name.includes("#")) {
      out.set(name, (out.get(name) ?? 0) + 1);
    }
  };
  for (const l of c.bag) {
    if (l) {
      for (let i = 0; i < Math.max(1, l.qty); i++) {
        add(l.item);
      }
    }
  }
  for (const v of Object.values(c.equip)) {
    add(v);
  }
  c.vault.forEach(add);
  return out;
}

/**
 * An item with an `#id` (a Crate's or Cauldron's own storage, a painting) may only be moved within
 * the character, never typed in or copied: a copy would open the same storage as the original.
 * A new one is added by its bare name and given its own id.
 */
function storageIdErrors(before: EditableCharacter, after: EditableCharacter): string[] {
  const had = idCounts(before);
  const errors: string[] = [];
  for (const [name, n] of idCounts(after)) {
    if (n > (had.get(name) ?? 0)) {
      errors.push(
        had.has(name)
          ? `${name} is listed more than once: it has its own storage, so it can't be copied.`
          : `${name}: add it by its bare name (${displayName(name)}); a new one gets its own storage.`,
      );
    }
  }
  return errors;
}

/**
 * The worn gear in `after` that the wear rules would refuse, one line each: an item in the wrong
 * slot, one the character is not strong enough for, an off-hand item with a two-handed weapon,
 * or a murder weapon worn while not wanted. `str` is the strength played with (class and medal
 * points included). Only slots the edit changed count, so gear already worn stays legal (a wear
 * rule change keeps worn gear on).
 */
export function wearBreaks(
  before: EditableCharacter,
  after: EditableCharacter,
  str: number,
): string[] {
  const out: string[] = [];
  const equip = {
    weapon: after.equip.weapon ?? NOTHING,
    offHand: after.equip.offHand ?? NOTHING,
    head: after.equip.head ?? NOTHING,
    body: after.equip.body ?? NOTHING,
    feet: after.equip.feet ?? NOTHING,
    ring: after.equip.ring ?? NOTHING,
  };
  for (const s of EQUIP_SLOTS) {
    const f = EQUIP_FIELD[s];
    const item = equip[f];
    if (item === NOTHING) {
      continue;
    }
    if (item === before.equip[f]) {
      // Gear already worn stays legal; only clearing the wanted flag can break it (murder gear).
      if (before.wanted && !after.wanted) {
        const check = checkEquip(item, { str, wanted: false, equip: { ...equip, [f]: NOTHING } });
        if (!check.ok && check.text === EQUIP_TEXT.vile) {
          out.push(`${displayName(item)}: ${check.text}`);
        }
      }
      continue;
    }
    // The other hand as it stands, so a two-handed weapon and a shield clash either way round.
    const check = checkEquip(item, {
      str,
      wanted: after.wanted,
      equip: { ...equip, [f]: NOTHING },
    });
    if (!check.ok) {
      out.push(`${displayName(item)}: ${check.text}`);
    } else if (check.slot !== s) {
      out.push(
        `${displayName(item)} is worn in the ${WORN_LABELS[EQUIP_FIELD[check.slot]]} slot, not the ${WORN_LABELS[f]}.`,
      );
    }
  }
  return out;
}

/**
 * The fields a change to `set` also reads: a level change brings experience, HP and SP within
 * their new limits, so the hub's values for those must still be current too.
 */
export function staleCheckFields(set: Partial<EditableCharacter>): EditField[] {
  const fields = Object.keys(set) as EditField[];
  if ("level" in set) {
    for (const f of ["exp", "hp", "sp"] as const) {
      if (!fields.includes(f)) {
        fields.push(f);
      }
    }
  }
  return fields;
}

/** The fields whose current value is no longer the one `changes` set, so undo would lose it. */
export function undoConflicts(
  current: EditableCharacter,
  changes: readonly EditChange[],
): EditField[] {
  return changes
    .filter((c) =>
      // A skills change names only the skills it moved: those must still hold what it set.
      c.field === "skills" && c.after && typeof c.after === "object"
        ? Object.entries(c.after as SkillValues).some(([k, v]) => current.skills[k] !== v)
        : !sameValue(current[c.field], c.after),
    )
    .map((c) => c.field);
}

/** One row of a character's edit log, as the hub shows it. */
export interface CharacterEditRow {
  id: string;
  at: string;
  actorName: string;
  reason: string;
  changes: EditChange[];
  /** The wear rules were overridden. */
  override: boolean;
  /** This edit undid that one. */
  undoOf: string | null;
  /** That edit undid this one. */
  undoneBy: string | null;
}

/** How many of a character's newest edits the hub shows. */
export const HUB_EDITS = 50;

const WORN_LABELS: Record<string, string> = {
  head: "head",
  body: "body",
  weapon: "weapon",
  offHand: "off hand",
  feet: "feet",
  ring: "ring",
};

/** A field's value as the log shows it. */
export function editValueText(field: EditField, v: unknown): string {
  if (v === null || v === undefined) {
    return field === "bank" ? "no account" : field === "respawn" ? "the fallback point" : "—";
  }
  switch (field) {
    case "classCode":
      return content().classes.classes.find((c) => c.code === v)?.name ?? `Class ${String(v)}`;
    case "faction":
      return ["None", "Mage", "Warrior", "Adventurer"][v as number] ?? String(v);
    case "wanted":
      return v ? "yes" : "no";
    case "sex":
      return v === 2 ? "female" : "male";
    case "respawn":
    case "position": {
      const p = v as EditPoint;
      return `${p.map} (${p.x}, ${p.y})`;
    }
    case "skills":
      return Object.entries(v as SkillValues)
        .map(([k, n]) => `${skillDisplay(k)} ${n}`)
        .join(", ");
    case "bag": {
      const lines = (v as (EditBagLine | null)[]).flatMap((l, i) =>
        l ? [`${i + 1}: ${l.item}${l.qty === 1 ? "" : ` ×${l.qty}`}`] : [],
      );
      return lines.length === 0 ? "empty" : lines.join("; ");
    }
    case "equip": {
      const e = v as Record<string, string>;
      const worn = EQUIP_SLOTS.map((s) => EQUIP_FIELD[s])
        .filter((f) => e[f] && e[f] !== NOTHING)
        .map((f) => `${WORN_LABELS[f] ?? f}: ${e[f]}`);
      return worn.length === 0 ? "nothing" : worn.join("; ");
    }
    case "vault":
    case "spellbook": {
      const l = v as string[];
      return l.length === 0 ? "empty" : l.join("; ");
    }
    default:
      return typeof v === "number" ? v.toLocaleString("en") : String(v);
  }
}

/**
 * Fields older edits may name that are no longer saved: Agility and Speed were dropped. Their log
 * lines keep these labels; an undo passes over them.
 */
export const RETIRED_FIELD_LABELS: Readonly<Record<string, string>> = {
  agi: "Agility",
  spd: "Speed",
};

/**
 * A change as one line. Skills name only the skills that moved, and the bag only the lines that
 * changed, so a long list does not hide what the edit did.
 */
export function changeText(c: EditChange): string {
  const label = FIELD_LABELS[c.field] ?? RETIRED_FIELD_LABELS[c.field] ?? c.field;
  if (c.field === "skills" && c.before && c.after && typeof c.after === "object") {
    const b = c.before as SkillValues;
    const moved = Object.entries(c.after as SkillValues).flatMap(([k, v]) =>
      v === b[k] ? [] : [`${skillDisplay(k)} ${b[k]} → ${v}`],
    );
    return `${label}: ${moved.join(", ")}`;
  }
  if (c.field === "bag" && Array.isArray(c.before) && Array.isArray(c.after)) {
    const a = c.after as (EditBagLine | null)[];
    const line = (l: EditBagLine | null | undefined) =>
      l ? `${l.item}${l.qty === 1 ? "" : ` ×${l.qty}`}` : "empty";
    const moved = (c.before as (EditBagLine | null)[]).flatMap((l, i) =>
      sameValue(l, a[i]) ? [] : [`line ${i + 1} ${line(l)} → ${line(a[i])}`],
    );
    return `${label}: ${moved.join(", ")}`;
  }
  return `${label}: ${editValueText(c.field, c.before)} → ${editValueText(c.field, c.after)}`;
}

export const EDIT_TEXT = {
  needReason: "Give a reason. It is kept in the character's edit log.",
  nothing: "Nothing changed.",
  wait: "Wait for the last change to this character to finish.",
  stale: (fields: readonly string[]) =>
    `${fields.join(", ")} changed since the hub was read. Refresh and make the edit again.`,
  wear: "The worn gear breaks the wear rules. Tick the override to save it anyway; the override is logged.",
  busy: (name: string) =>
    `${name} is trading or seated at a casino table. Edit their gold and items once they finish.`,
  editing: (name: string) =>
    `${name} is in an editor or the Control Panel. Move them once they are back in the game.`,
  jailed: (name: string) => `${name} is in jail. Release them before moving them.`,
  jailMap: "Only staff can be put on the jail map. Use Jail instead.",
  noMap: (map: string) => `There is no map called ${map}.`,
  saved: (name: string, n: number) =>
    `Saved ${n} change${n === 1 ? "" : "s"} to ${name}. Undo it from the Edits tab.`,
  undone: (name: string) => `Undid the edit to ${name}.`,
  noEdit: "That edit is not in this character's log.",
  alreadyUndone: "That edit has already been undone.",
  undoInvalid: "Can't undo: what it puts back no longer fits the character as they are now.",
  undoWear:
    "Can't undo: it would put back worn gear that breaks the wear rules. Make a new edit with the override instead.",
  undoConflict: (fields: readonly string[]) =>
    `Can't undo: ${fields.join(", ")} changed since. Make a new edit instead.`,
  /** A value the client could not have sent (a stray field, a derived value). */
  badField: (f: string) => `${f} cannot be edited.`,
} as const;

/** A requested change's fields, labelled. */
export const fieldLabels = (fields: readonly EditField[]): string[] =>
  fields.map((f) => FIELD_LABELS[f] ?? f);

/** Whether `name`'s bag item is one the edit must give its own storage id (a bare Crate). */
export const needsContainerId = (item: string): boolean =>
  !item.includes("#") && isUniqueContainer(item);

/** Every copy a character holds, by exact name: bag counts, worn gear and vault lines. */
function holdingCounts(c: EditableCharacter): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string, n: number) => out.set(name, (out.get(name) ?? 0) + n);
  for (const l of c.bag) {
    if (l) {
      add(l.item, l.qty);
    }
  }
  for (const v of Object.values(c.equip)) {
    if (v && v !== NOTHING) {
      add(v, 1);
    }
  }
  for (const v of c.vault) {
    add(v, 1);
  }
  return out;
}

/**
 * Something the game cannot create (a retired item, a painting) may move between a character's
 * lines, but the editor may not add copies of it: no more can be made (issue #28).
 */
function unmakeableErrors(before: EditableCharacter, after: EditableCharacter): string[] {
  const was = holdingCounts(before);
  const errors: string[] = [];
  for (const [name, n] of holdingCounts(after)) {
    // A name the character did not hold is refused line by line ("no item called ..."); this is
    // for more of one they did.
    const had = was.get(name) ?? 0;
    if (had > 0 && n > had && !knownItem(name) && !isGold(name)) {
      errors.push(`${displayName(name)}: no more can be made, so no copies can be added.`);
    }
  }
  return errors;
}
