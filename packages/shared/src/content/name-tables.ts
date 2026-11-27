/**
 * The content's name tables: every list of `{ match, pattern }` rows (and the single name tests),
 * what each decides, and which of its matching rows decide (`wins`). Found by walking the data, so
 * a table added later can't be missed (the content report's test checks each one is described).
 *
 * `resolveItem` answers "what does this item play now": every item table's rows that match the
 * name, in table order, and which of them decide. The content report prints it; the item editor
 * (#30) seeds its form from it.
 */

import { isEngineFixture } from "../rules/core/fixtures.ts";
import { lingoEq } from "../rules/core/lingo.ts";
import { excepted, type PatternRow, ruleMatches } from "../rules/core/patterns.ts";
import { weaponIs } from "../rules/crafting/masterwork.ts";
import { behaviourName, behaviourTest } from "../rules/inventory/behaviours.ts";
import { lookName } from "../rules/inventory/paperdoll.ts";
import { type ContentData, content, type DatasetId } from "./store.ts";

type Obj = Record<string, unknown>;

/**
 * Which match decides the answer when several rows of a table match. `rolls`: every matching row
 * rolls, in table order, and the last roll stands (so every one of them draws).
 */
export type Wins = "first" | "last" | "any" | "adds" | "order" | "rolls";

export interface TableInfo {
  /** What the table decides, in play terms. */
  decides: string;
  wins: Wins;
  /** A row-level condition the report can't evaluate (the slot a row tests, a trigger…). */
  note?: string;
  /**
   * "last" decided separately for each value of this row field: each worn slot's last row
   * (`swing.cooldowns`), each spell's (`spByBody`).
   */
  per?: "slot" | "subject";
}

/** One row of a name table: the matching rule, its text and its place in the table. */
export interface NameRow {
  match: string;
  pattern: string;
  /** 1-based place in its table (0 for a single name test). */
  index: number;
  /** The record the row belongs to (a spell, a skill block), for per-record tables. */
  subject?: string;
  /**
   * The name the row tested, when not the item's own: an `order` table's later row tests the name
   * an earlier row rewrote it to.
   */
  tested?: string;
  raw: Obj;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The `{ match, pattern }` of an object, if it is a name test (houses' fixtures name it `item`). */
export function nameTestOf(o: Obj): { match: string; pattern: string } | null {
  if (isStr(o.match) && isStr(o.pattern)) {
    return { match: o.match, pattern: o.pattern };
  }
  if (isStr(o.match) && isStr(o.item)) {
    return { match: o.match, pattern: o.item };
  }
  // A skill block's pattern may be null, which combat reads as "" (a `contains` block with no
  // pattern matches every weapon), so the resolver and the compile read it the same way.
  if (isStr(o.weaponMatch) && (isStr(o.pattern) || o.pattern === null) && o.weaponMatch !== "any") {
    return { match: o.weaponMatch, pattern: o.pattern ?? "" };
  }
  // A melee affinity row (monsters `meleeAffinities`): its monster side is the name it tests (its
  // weapon side tests the weapon swung, part of the row's condition).
  if (isStr(o.monsterMatch) && isStr(o.monster)) {
    return { match: o.monsterMatch, pattern: o.monster };
  }
  // A weapon-skill row (classes `skillGain.weaponSkills`).
  if (isStr(o.match) && isStr(o.weapon)) {
    return { match: o.match, pattern: o.weapon };
  }
  return null;
}

/**
 * Lists of `{ item }` rows with no `match`, which the game tests by exact name: the items that can
 * break (`breaks.armour.items`, in the row's slot, and `breaks.weapon.items`).
 */
const IMPLIED_EXACT = new Set(["itemRules breaks.armour.items", "itemRules breaks.weapon.items"]);

/** An `any` skill block tests no name: it applies to every weapon. */
const isAnyBlock = (o: Obj): boolean => o.weaponMatch === "any";

const subjectOf = (o: Obj): string | undefined =>
  isStr(o.name)
    ? o.name
    : isStr(o.monsterMatch) && isStr(o.weapon)
      ? `a weapon containing "${o.weapon}"`
      : isStr(o.weaponMatch)
        ? `${o.weaponMatch} "${o.pattern ?? ""}" weapon block`
        : undefined;

/** Whether an array is a name table: every element a name test (or an `any` skill block). */
export const isNameTable = (v: unknown[]): boolean =>
  v.length > 0 && v.every((o) => isObj(o) && (nameTestOf(o) !== null || isAnyBlock(o)));

/**
 * Every name table in a set of datasets, by `<dataset> <path>` (array indexes written `[]`): an
 * array whose elements are all name tests, or a single name test (`equip.murder`, a spell's
 * `book`). NPC files and rects hold no name tables.
 */
export function nameTables(data: Partial<ContentData>): Map<string, NameRow[]> {
  const out = new Map<string, NameRow[]>();
  const add = (key: string, o: Obj, index: number, subject: string | undefined) => {
    const t = nameTestOf(o);
    if (!t) {
      return;
    }
    const list = out.get(key) ?? [];
    list.push({ ...t, index, subject, raw: o });
    out.set(key, list);
  };
  const walk = (v: unknown, ds: string, path: string, subject: string | undefined) => {
    if (Array.isArray(v) && IMPLIED_EXACT.has(`${ds} ${path}`)) {
      const key = `${ds} ${path}`;
      v.forEach((o, i) => {
        if (isObj(o) && isStr(o.item)) {
          const list = out.get(key) ?? [];
          list.push({ match: "exact", pattern: o.item, index: i + 1, subject, raw: o });
          out.set(key, list);
        }
      });
      return;
    }
    if (Array.isArray(v)) {
      if (isNameTable(v)) {
        v.forEach((o, i) => {
          if (isAnyBlock(o as Obj)) {
            // A block with no test applies to every weapon: it is a row of every weapon's answer.
            const list = out.get(`${ds} ${path}`) ?? [];
            list.push({ match: "any", pattern: "", index: i + 1, subject, raw: o as Obj });
            out.set(`${ds} ${path}`, list);
          } else {
            add(`${ds} ${path}`, o as Obj, i + 1, subject);
          }
        });
        // Rows can hold tables of their own (a skill block's tiers).
        for (const o of v as Obj[]) {
          for (const [k, c] of Object.entries(o)) {
            walk(c, ds, `${path}[].${k}`, subjectOf(o) ?? subject);
          }
        }
        return;
      }
      for (const o of v) {
        walk(o, ds, `${path}[]`, isObj(o) ? (subjectOf(o) ?? subject) : subject);
      }
      return;
    }
    if (isObj(v)) {
      if (nameTestOf(v) !== null) {
        add(`${ds} ${path}`, v, 0, subject);
        return;
      }
      for (const [k, c] of Object.entries(v)) {
        walk(c, ds, path === "" ? k : `${path}.${k}`, subject);
      }
    }
  };
  for (const [id, d] of Object.entries(data)) {
    if (id !== "npcFiles" && id !== "rects" && isObj(d)) {
      walk(d, id, "", undefined);
    }
  }
  return out;
}

/**
 * What each table decides and how its rows combine, by `<dataset> <path>`. The `wins` values are
 * from the code that reads each table (the functions are named in the comment on the entry).
 */
export const NAME_TABLES: Record<string, TableInfo> = {
  // strengthRequirement, equipSlotFor, menuAction, useItem, bookDex, invAdd, swingCooldowns,
  // damagedForm
  "itemRules behaviours": {
    decides: "what an item does (a key, a bow, a chest, a crate…)",
    wins: "adds",
    note: "each matching row gives its behaviour; rows test the name without its #id or +N, and never an engine fixture's (Bob's Door)",
  },
  // toolUses, swingCooldowns
  "itemRules tools": {
    decides: "what a tool can do (chop, mine, dig, fish, farm, water) and its swing ladder",
    wins: "adds",
    note: "each matching row gives its can and tier; the last matching row with a ladder sets the swing speed",
  },
  // itemRequirementRefusal
  "itemRules requires": {
    decides: "the skill or level an item needs to be equipped or used",
    wins: "adds",
    note: "every matching row of its kind must be met; rows test the name without its #id or +N",
  },
  "itemRules equip.strength": { decides: "the Strength needed to equip", wins: "last" },
  "itemRules equip.classes": {
    decides: "the only classes that may equip an item",
    wins: "last",
    note: "rows test the name without its #id or +N",
  },
  "itemRules equip.slots": { decides: "which slot the item goes in", wins: "last" },
  "itemRules menu": {
    decides: "the item menu's button in place of Equip",
    wins: "last",
  },
  "itemRules use.books": { decides: "the Mysticism a spell book needs", wins: "last" },
  "itemRules use.messages": { decides: "the text Use shows for food", wins: "last" },
  "itemRules use.refusals": {
    decides: "the line Use shows for an item it refuses",
    wins: "last",
  },
  "itemRules containers.capacity": { decides: "lines a container holds", wins: "last" },
  "itemRules swing.cooldowns": {
    decides: "swing delays for a worn item",
    wins: "last",
    per: "slot",
    note: "the row's slot is the worn slot it tests; the last matching row of the worn slots decides",
  },
  "itemRules breaks.damaged": { decides: "what a broken item becomes", wins: "last" },
  // rollArmourBreak, rollWeaponBreak
  "itemRules breaks.armour.items": {
    decides: "armour that can break",
    wins: "any",
    note: "exact name; the row's slot is the worn slot it tests",
  },
  "itemRules breaks.weapon.items": { decides: "weapons that can break", wins: "any" },
  // checkEquip, useDeferred, useItem, blocksPlayer, invAdd
  "itemRules equip.twoHanded": { decides: "two-handed weapons", wins: "any" },
  "itemRules equip.murder": { decides: "items needing the murder flag", wins: "any" },
  "itemRules use.silent": { decides: "Use says and does nothing", wins: "any" },
  "itemRules use.whenFull": { decides: "usable even by a stuffed player", wins: "any" },
  "itemRules use.usable": { decides: "what Use accepts (food and potions)", wins: "any" },
  "itemRules ground.blocks": { decides: "ground items that stop a walker", wins: "any" },
  "itemRules ground.platforms": {
    decides: "blocks until a skill (or the level) reaches the row's threshold",
    wins: "any",
  },
  "itemRules ground.inUse": {
    decides: "ground items whose overlay animates only while a crafting player faces them",
    wins: "any",
  },
  "itemRules ground.tipless": {
    decides: "ground items the hover tip never names",
    wins: "any",
  },
  "itemRules containers.uniqueIds": {
    decides: "containers that get a #id in a bag",
    wins: "any",
  },
  // runBook, groundDrawOffset, ctrlGate, swingSound
  "itemRules use.skillBooks": { decides: "the combat-skill books", wins: "first" },
  "itemRules ground.overlays": {
    decides: "the animated overlay on a ground item",
    wins: "first",
  },
  "itemRules ground.layers": { decides: "the draw layer of a ground item", wins: "first" },
  "itemRules ground.offsets": {
    decides: "the pixel offset from the tile",
    wins: "first",
  },
  "itemRules ground.tipNames": {
    decides: "the hover tip's name for a ground item",
    wins: "first",
  },
  "itemRules pickup.ctrlTexts": {
    decides: "the one line Ctrl on a fixture says",
    wins: "first",
  },
  "itemRules swing.sounds": { decides: "the swing sound by weapon", wins: "first" },
  // useItem, gearBonus, elementalRows
  "itemRules use.effects": {
    decides: "what Use does to a food or potion",
    wins: "adds",
  },
  "itemRules gear": {
    decides: "power a worn item adds",
    wins: "adds",
    note: "the row's slot is the worn slot it tests",
  },
  "itemRules armour.rows": {
    decides: "armour mitigation",
    wins: "adds",
    note: "the row's slot is the worn slot it tests",
  },
  "itemRules armour.spell.rows": {
    decides: "spell damage a worn item adds or takes off",
    wins: "adds",
    note: "the row's slot is the worn slot it tests",
  },
  "itemRules armour.elemental": {
    decides: "elemental armour effects",
    wins: "adds",
    note: "applies in the row's handler, when the row's trigger item is the wielded weapon, from the row's slot",
  },
  // normaliseLook
  "itemRules paperdoll.aliases": {
    decides: "which picture a worn item is drawn with",
    wins: "order",
    note: "each row rewrites its own layer; a later row tests the rewritten name",
  },
  // attackPower, applyTier
  "attPower attPower.base": {
    decides: "weapon attack power",
    wins: "rolls",
    note: "every matching row rolls, in file order; the last one's roll stands",
  },
  "attPower attPower.exactOverrides": {
    decides: "weapons whose power replaces the base roll",
    wins: "rolls",
    note: "tested by exact name whatever the row's match says; every matching row rolls, the last one's roll stands",
  },
  "attPower attPower.skillBlocks": {
    decides: "the skill tiers added to a weapon's power",
    wins: "adds",
    note: "every matching block applies, in file order; a block with no test applies to every weapon; an item's answer keeps only the tiers whose own weapon test it passes",
  },
  // weaponSkillList
  "classes skillGain.weaponSkills": {
    decides: "the skills a kill with the weapon trains",
    wins: "last",
    note: "an exact row also covers the masterworks made from the weapon",
  },
  "attPower attPower.skillBlocks[].tiers[].subWeapon": {
    decides: "a skill tier that applies only to one exact weapon",
    wins: "any",
  },
  // meleeKillXp, smash in combat/melee.ts, the anyMatch callers in monsters/ and economy/
  "monsters rules.sea": {
    decides: "species that spawn and move only on sea tiles",
    wins: "any",
  },
  "monsters rules.footprint": { decides: "3x2 wide monsters", wins: "any" },
  "monsters rules.hostile": {
    decides: "species off the World page's monster list that walk toward players",
    wins: "any",
  },
  "monsters rules.officer": {
    decides: "attacks wanted players on no-fight maps",
    wins: "any",
  },
  "monsters rules.sparesInnocent": {
    decides: "never hits an innocent player",
    wins: "any",
  },
  "monsters rules.clearsBlock": {
    decides: "never blocks a player's step",
    wins: "any",
  },
  "monsters rules.killBroadcasts": {
    decides: "server broadcast on a melee kill",
    wins: "first",
  },
  "monsters rules.namesSelf": {
    decides: 'a click says "This is <name>." instead of opening the Bio',
    wins: "any",
  },
  "monsters rules.noQuests": { decides: "gives no quests", wins: "any" },
  "monsters casting.neverCasts": { decides: "never casts monster spells", wins: "any" },
  // meleeDamageVsMonster
  "monsters meleeAffinities": {
    decides: "melee damage added on a hit from a weapon family",
    wins: "adds",
    note: "each row also tests the weapon swung (contains its weapon text)",
  },
  // runBook, spCost
  "spells spells[].book": {
    decides: "which spell a book teaches",
    wins: "last",
    note: "tested over all spells in file order; the last matching spell wins",
  },
  "spells spells[].spByBody": {
    decides: "a spell's SP cost for a worn body armour",
    wins: "last",
    per: "subject",
    note: "last match wins within each spell",
  },
  // clickGate
  "houses clickFixtures": {
    decides: "what a click on a fixture does",
    wins: "first",
    note: "reached only after the click gate's own tests; only texts and switches are read",
  },
};

/**
 * The tables whose exact rows also take the masterworks made from the named weapon (shared
 * `weaponIs`), as the game reads them.
 */
const MASTERWORK_EXACT = new Set([
  "attPower attPower.skillBlocks",
  "classes skillGain.weaponSkills",
]);

/** Tables the game tests by exact name, whatever the row's `match` says. */
const ALWAYS_EXACT = new Set(["attPower attPower.exactOverrides", ...IMPLIED_EXACT]);

/** The ground tables test the name without a container's or picture's `#id`. */
const groundName = (name: string): string => (name.split("#")[0] ?? name).trim();

/**
 * The name each table's rows test, as the game reads it: behaviour and requirement rows without
 * the `#id` or `+N`, the paperdoll's aliases without the `+N`, the ground tables, the item menu and
 * a container's capacity without the `#id`.
 */
const TESTED_NAME: Record<string, (name: string) => string> = {
  "itemRules behaviours": behaviourName,
  "itemRules requires": behaviourName,
  "itemRules equip.classes": behaviourName,
  "itemRules paperdoll.aliases": lookName,
  "itemRules ground.tipless": groundName,
  "itemRules ground.tipNames": groundName,
  "itemRules menu": groundName,
  "itemRules containers.capacity": groundName,
  "itemRules ground.blocks": groundName,
  "itemRules ground.platforms": groundName,
  "itemRules ground.overlays": groundName,
  "itemRules ground.inUse": groundName,
  "itemRules ground.layers": groundName,
  "itemRules ground.offsets": groundName,
  "itemRules pickup.ctrlTexts": groundName,
};

/** The name table `key`'s rows test when the game reads them for item `name`. */
export function testedName(key: string, name: string): string {
  return TESTED_NAME[key]?.(name) ?? name;
}

/**
 * Whether a row of table `key` matches the name the table tests (`testedName`), as the game tests
 * it. `craft` gives the masterworks (default the installed store's).
 */
function rowTests(
  key: string,
  tested: string,
  r: { match: string; pattern: string },
  craft?: ContentData["craft"],
): boolean {
  if (r.match === "any") {
    return true;
  }
  if (ALWAYS_EXACT.has(key)) {
    return lingoEq(tested, r.pattern);
  }
  if (r.match === "exact" && MASTERWORK_EXACT.has(key)) {
    return weaponIs(tested, r.pattern, craft);
  }
  return ruleMatches(tested, r as PatternRow);
}

/** Whether a row of table `key` matches item `name`, as the game tests it. */
export function rowMatches(
  key: string,
  name: string,
  r: { match: string; pattern: string; raw?: Obj },
  craft?: ContentData["craft"],
): boolean {
  if (key === "itemRules behaviours" && isEngineFixture(name)) {
    // Never an engine fixture's (Bob's Door).
    return false;
  }
  const tested = testedName(key, name);
  // A pack row an item definition took the item from (the store's compile, issue #30).
  if (r.raw && excepted(r.raw as { except?: readonly string[] }, tested)) {
    return false;
  }
  return rowTests(key, tested, r, craft);
}

/**
 * The pattern an exact row of table `key` needs to name `name` alone: the name the table tests
 * (`testedName`).
 */
export function exactPatternFor(key: string, name: string): string {
  return testedName(key, name);
}

/**
 * A skill block as an item's answer: only the tiers whose own weapon test (`subWeapon`, an exact
 * name) the item passes.
 */
function blockFor(name: string, r: NameRow): NameRow {
  const tiers = Array.isArray(r.raw.tiers) ? (r.raw.tiers as Obj[]) : [];
  const kept = tiers.filter((t) => {
    const sub = t.subWeapon;
    return !isObj(sub) || !isStr(sub.pattern) || lingoEq(name, sub.pattern);
  });
  return { ...r, raw: { ...r.raw, tiers: kept } };
}

/** One table's answer for a name: every matching row in table order, and the rows that decide. */
export interface TableHit {
  key: string;
  info: TableInfo;
  rows: NameRow[];
  deciding: NameRow[];
}

/** Which rows of one table match `name`, and which of them decide. */
export function matchTable(
  name: string,
  key: string,
  all: readonly NameRow[],
  info: TableInfo,
  craft?: ContentData["craft"],
): TableHit | null {
  let rows = all.filter((r) => rowMatches(key, name, r, craft));
  if (info.wins === "order") {
    // Each row rewrites its own layer; a later row tests the rewritten name.
    const cur = new Map<string, string>();
    const start = testedName(key, name);
    rows = [];
    for (const r of all) {
      const layer = String(r.raw.layer ?? "");
      const text = cur.get(layer) ?? start;
      // A row an item definition took the name from (the store's compile) is skipped, as the
      // renderer skips it.
      if (!excepted(r.raw, text) && rowTests(key, text, r, craft)) {
        cur.set(layer, String(r.raw.becomes ?? text));
        rows.push(text === start ? r : { ...r, tested: text });
      }
    }
  }
  if (key === "attPower attPower.skillBlocks") {
    rows = rows.map((r) => blockFor(name, r));
  }
  if (rows.length === 0) {
    return null;
  }
  let deciding: NameRow[];
  if (info.wins === "first") {
    deciding = [rows[0] as NameRow];
  } else if (info.wins === "last") {
    // "last" over the table, or for each slot or record (`per`).
    const per = info.per;
    const group = (r: NameRow): unknown => (per === "slot" ? r.raw.slot : r.subject);
    deciding =
      per === undefined
        ? [rows.at(-1) as NameRow]
        : rows.filter((r, i) => !rows.slice(i + 1).some((l) => group(l) === group(r)));
  } else {
    deciding = rows;
  }
  return { key, info, rows, deciding };
}

/** Every described table's answer for `name` over a set of datasets. */
export function matchAllTables(
  name: string,
  data: Partial<ContentData>,
  craft: ContentData["craft"] | undefined = data.craft,
  /** `nameTables(data)`, when the caller has it already (the store's compile, for each item). */
  tables: Map<string, NameRow[]> = nameTables(data),
  /** `behaviourTest(data.itemRules.behaviours)`, likewise. */
  isBook: ((name: string, b: "book") => boolean) | null = data.itemRules
    ? behaviourTest(data.itemRules.behaviours)
    : null,
): TableHit[] {
  const hits: TableHit[] = [];
  // A meal's line never comes from a book's row (useItem): those rows are the read lines.
  for (const [key, rows] of tables) {
    const info = NAME_TABLES[key];
    const all =
      key === "itemRules use.messages" && isBook
        ? rows.filter((r) => !((r.raw.read as boolean | undefined) ?? isBook(r.pattern, "book")))
        : rows;
    const hit = info ? matchTable(name, key, all, info, craft ?? NO_CRAFT) : null;
    if (hit) {
      hits.push(hit);
    }
  }
  return hits;
}

/** Data with no masterworks, for a set of datasets that holds no craft data. */
const NO_CRAFT = { stations: {} } as unknown as ContentData["craft"];

/** The datasets whose tables decide what an item does, and the classes table of weapon skills. */
export const ITEM_DATASETS: readonly DatasetId[] = ["itemRules", "attPower"];
const ITEM_TABLE_EXTRA = new Set(["classes skillGain.weaponSkills"]);

/**
 * A skill tier's own weapon test: part of its block's answer (`blockFor`), not an answer of its
 * own.
 */
const FOLDED = new Set(["attPower attPower.skillBlocks[].tiers[].subWeapon"]);

/** Whether table `key` decides something about an item. */
export const isItemTable = (key: string): boolean =>
  !FOLDED.has(key) &&
  (ITEM_DATASETS.includes(key.split(" ")[0] as DatasetId) || ITEM_TABLE_EXTRA.has(key));

/**
 * What an item plays now: every item table's matching rows and the rows that decide, over the
 * published content (or `data`). An item with no row in a table is absent from it.
 */
export function resolveItem(name: string, data?: Partial<ContentData>): TableHit[] {
  const d = data ?? (content() as unknown as Partial<ContentData>);
  const items: Partial<ContentData> = {};
  for (const id of [...ITEM_DATASETS, "classes"] as DatasetId[]) {
    if (d[id] !== undefined) {
      (items as Record<string, unknown>)[id] = d[id];
    }
  }
  return matchAllTables(name, items, d.craft).filter((h) => isItemTable(h.key));
}

/** The monster tables: every name table of the monsters dataset (the rules, never-casts, affinities). */
export const isMonsterTable = (key: string): boolean => key.startsWith("monsters ");

/**
 * The kill skill cap by body (`skillCaps.byBody`, last match wins): a table keyed by the species'
 * body number, not its name. `resolveMonster` answers it for the species' body.
 */
export const SKILL_CAP_TABLE = "monsters skillCaps.byBody";
const SKILL_CAP_INFO: TableInfo = {
  decides: "the kill skill cap, by the species' body",
  wins: "last",
  note: "matched by the species' body number, not its name",
};

/**
 * What a monster plays now: every monster table's rows that match the name, in table order, and
 * which decide (as `resolveItem` for items), over the published content (or `data`). A live
 * monster's name is tested as it is. The kill skill cap's rows match the species' body.
 */
export function resolveMonster(name: string, data?: Partial<ContentData>): TableHit[] {
  const d = data ?? (content() as unknown as Partial<ContentData>);
  if (!d.monsters) {
    return [];
  }
  const hits = matchAllTables(name, { monsters: d.monsters }, NO_CRAFT).filter((h) =>
    isMonsterTable(h.key),
  );
  // As the kill path finds it (`content().monster`: the name, any case), and body 0 for a name no
  // species has, as a kill of one rolls.
  const lower = name.toLowerCase();
  const sp = d.monsters.monsters.find((m) => m.name.toLowerCase() === lower);
  const body = String(sp?.body ?? 0);
  const rows: NameRow[] = [];
  // A monster definition's cap by species (issue #31; compiled `skillCaps.bySpecies`) stands in for
  // the by-body rows: its own cap, or none (the default).
  const bySpecies = (d.monsters.skillCaps as { bySpecies?: { name: string; skillCap: unknown }[] })
    .bySpecies;
  const own = bySpecies?.findIndex((s) => s.name.toLowerCase() === lower) ?? -1;
  if (own >= 0) {
    const r = bySpecies?.[own] as Obj;
    if (typeof r.skillCap === "number") {
      rows.push({ match: "species", pattern: name, index: own + 1, raw: r });
    }
  } else {
    d.monsters.skillCaps.byBody.forEach((r, i) => {
      if (r.body === body) {
        rows.push({ match: "body", pattern: r.body, index: i + 1, raw: r as unknown as Obj });
      }
    });
  }
  if (rows.length > 0) {
    hits.push({
      key: SKILL_CAP_TABLE,
      info: SKILL_CAP_INFO,
      rows,
      deciding: [rows.at(-1) as NameRow],
    });
  }
  return hits;
}

/**
 * An item's answer as exact rows, by table: each deciding row rewritten to name the item alone
 * (`exactPatternFor`; an `order` table's later row names what it tested), in table order. A world
 * whose item tables hold only these rows plays the item as the tables did (the round trip in
 * item-resolver.test.ts); the item editor's definitions (#30 stage 2) compile to them.
 */
export function exactRowsFor(name: string, hits: readonly TableHit[]): Map<string, Obj[]> {
  const out = new Map<string, Obj[]>();
  for (const h of hits) {
    out.set(
      h.key,
      h.deciding.map((r) => {
        const pattern = r.tested ?? exactPatternFor(h.key, name);
        const row: Obj = { ...r.raw };
        if (h.key === "itemRules tools" && isStr(row.can) && !isStr(row.counter)) {
          // The swing keeps the hit counter it shared (an Axe's and a Gold Axe's).
          row.counter = r.pattern;
        }
        if (h.key === "itemRules ground.tipNames" && r.match !== "exact" && isStr(row.name)) {
          // A `contains` row replaces only the text it found: the exact row names the result.
          const at = pattern.toLowerCase().indexOf(r.pattern.toLowerCase());
          row.name = pattern.slice(0, at) + row.name + pattern.slice(at + r.pattern.length);
        }
        if (h.key === SKILL_CAP_TABLE) {
          // Keyed by body: the row stands as it is.
          return row;
        }
        if (isStr(row.monsterMatch)) {
          // An affinity row keeps its weapon test; its monster side names the species alone.
          row.monsterMatch = "exact";
          row.monster = pattern;
          return row;
        }
        if (IMPLIED_EXACT.has(h.key)) {
          row.item = pattern;
        } else if ("weaponMatch" in row) {
          row.weaponMatch = "exact";
          row.pattern = pattern;
        } else if (isStr(row.weapon)) {
          row.match = "exact";
          row.weapon = pattern;
        } else if (isStr(row.item) && !isStr(row.pattern)) {
          row.match = "exact";
          row.item = pattern;
        } else {
          row.match = "exact";
          row.pattern = pattern;
        }
        return row;
      }),
    );
  }
  return out;
}
