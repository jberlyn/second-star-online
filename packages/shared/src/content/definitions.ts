/**
 * Item definitions (issue #30): one record of an item's rules (`items.definitions`), compiled by the
 * store into exact rows for that item in the rule tables a definition covers. #22's rule: "a
 * definition from the editor compiles into exact-name rows that take priority in every table".
 *
 * The compile, for each definition and each table it covers:
 * - the pack's rows that matched the item there (as the game tests it) leave it out (`except`), so
 *   only the definition decides, in every kind of table (last match, first match, every match);
 * - the definition's rows go in where the item's first matching row was (else at the end), named
 *   exactly for it, so the order other items' rows meet in is the pack's.
 *
 * The tables keep their shape and the engine keeps reading them. `seedDefinition` is the inverse:
 * what an item plays now (the resolver's answer) as a definition, so a definition saved unchanged
 * plays identically (item-definitions.test.ts proves it for every Classic item).
 *
 * Pure: the server and the client compile the same store from the same data.
 */
import type { ItemDefinition } from "@secondstaronline/data";

import { lingoEq } from "../rules/core/lingo.ts";
import { behaviourName, behaviourTest } from "../rules/inventory/behaviours.ts";
import {
  exactPatternFor,
  ITEM_DATASETS,
  matchAllTables,
  type NameRow,
  nameTables,
  type TableHit,
  testedName,
} from "./name-tables.ts";
import { type ContentData, type DatasetId, setDefinitionCompiler } from "./store.ts";

type Obj = Record<string, unknown>;

/** The tables an item definition covers, by `<dataset> <path>` (the resolver's keys). */
export const DEFINITION_TABLES = [
  "itemRules equip.slots",
  "itemRules equip.strength",
  "itemRules equip.twoHanded",
  "itemRules behaviours",
  "attPower attPower.base",
  "attPower attPower.exactOverrides",
  "attPower attPower.skillBlocks",
  "itemRules armour.rows",
  "itemRules armour.elemental",
  "itemRules armour.spell.rows",
  "itemRules gear",
  "itemRules swing.cooldowns",
  "itemRules swing.sounds",
  "itemRules use.usable",
  "itemRules use.silent",
  "itemRules use.effects",
  "itemRules use.messages",
  "itemRules use.refusals",
  "classes skillGain.weaponSkills",
] as const;

export type DefinitionTable = (typeof DEFINITION_TABLES)[number];

/** Tables whose exact rows also take the masterworks made from the named weapon (`weaponIs`). */
const MASTERWORK_TABLES = new Set<string>([
  "attPower attPower.skillBlocks",
  "classes skillGain.weaponSkills",
]);

/**
 * Whether a definition of `name` decides its behaviours: not a masterwork-style `+N` name, whose
 * behaviour rows test its base item's name (`Knight's Sword +1` has the Knight's Sword's).
 */
export function definesBehaviours(name: string): boolean {
  return lingoEq(behaviourName(name), name);
}

/** The tables a definition of `name` covers. */
export function definitionTables(name: string): DefinitionTable[] {
  return DEFINITION_TABLES.filter((k) => k !== "itemRules behaviours" || definesBehaviours(name));
}

/** A row's own fields, without its name test or a compile's `except`. */
function fields(raw: Obj, drop: readonly string[] = []): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k !== "match" && k !== "pattern" && k !== "except" && !drop.includes(k)) {
      out[k] = v;
    }
  }
  return out;
}

/** A definition's rows for one table, without their name test, in order. */
export function definitionRows(def: ItemDefinition, key: DefinitionTable): Obj[] {
  switch (key) {
    case "itemRules equip.slots":
      return def.slot === undefined ? [] : [{ slot: def.slot }];
    case "itemRules equip.strength":
      return def.strength === undefined ? [] : [{ strength: def.strength }];
    case "itemRules equip.twoHanded":
      return def.twoHanded ? [{}] : [];
    case "itemRules behaviours":
      return (def.behaviours ?? []).map((behaviour) => ({ behaviour }));
    case "attPower attPower.base":
      return (def.attack?.base ?? []).map((r) => ({ ...r }));
    case "attPower attPower.exactOverrides":
      return (def.attack?.overrides ?? []).map((r) => ({ ...r }));
    case "attPower attPower.skillBlocks":
      return (def.attack?.blocks ?? []).map((b) => ({ tiers: b.tiers }));
    case "itemRules armour.rows":
      return (def.armour ?? []).map((r) => ({ ...r }));
    case "itemRules armour.elemental":
      return (def.elemental ?? []).map((r) => ({ ...r }));
    case "itemRules armour.spell.rows":
      return (def.spellDefense ?? []).map((r) => ({ ...r }));
    case "itemRules gear":
      return (def.gear ?? []).map((r) => ({ ...r }));
    case "itemRules swing.cooldowns":
      return (def.cooldowns ?? []).map((r) => ({ ...r }));
    case "itemRules swing.sounds":
      return def.sound === undefined ? [] : [{ sound: def.sound }];
    case "itemRules use.usable":
      return def.use?.usable ? [{}] : [];
    case "itemRules use.silent":
      return def.use?.silent ? [{}] : [];
    case "itemRules use.effects":
      return (def.use?.effects ?? []).map((r) => ({ ...r }));
    case "itemRules use.messages":
      // A definition's line is the item's meal line, whatever its behaviours.
      return def.use?.message === undefined ? [] : [{ text: def.use.message, read: false }];
    case "itemRules use.refusals":
      return def.use?.refusal === undefined ? [] : [{ text: def.use.refusal }];
    case "classes skillGain.weaponSkills":
      return def.trains ? [{ skills: def.trains }] : [];
  }
}

/** One of a definition's rows as a table row naming the item exactly (`except`: its masterworks). */
function exactRow(key: string, name: string, row: Obj, masterworks: readonly string[]): Obj {
  const pattern = exactPatternFor(key, name);
  const out: Obj =
    key === "attPower attPower.skillBlocks"
      ? { weaponMatch: "exact", pattern, ...row }
      : key === "classes skillGain.weaponSkills"
        ? { match: "exact", weapon: pattern, ...row }
        : { match: "exact", pattern, ...row };
  // An exact weapon row also takes the masterworks made from the item; the definition is the
  // item's alone, so they keep the pack's rows (or their own definitions).
  if (MASTERWORK_TABLES.has(key) && masterworks.length > 0) {
    out.except = masterworks;
  }
  return out;
}

/** The masterworks made from `name` (craft `smith.masterwork`). */
function masterworksOf(name: string, craft: ContentData["craft"] | undefined): string[] {
  return (craft?.stations.smith?.masterwork ?? [])
    .filter((m) => lingoEq(m.item, name))
    .flatMap((m) => m.outcomes.map((o) => o.result));
}

/**
 * What an item plays now, as a definition: the resolver's deciding rows for each table a definition
 * covers. Saved unchanged, it plays identically.
 */
export function seedDefinition(name: string, hits: readonly TableHit[]): ItemDefinition {
  const def: ItemDefinition = { name };
  const covered = new Set<string>(definitionTables(name));
  const attack: NonNullable<ItemDefinition["attack"]> = {};
  const use: NonNullable<ItemDefinition["use"]> = {};
  for (const h of hits) {
    if (!covered.has(h.key) || h.deciding.length === 0) {
      continue;
    }
    const rows = h.deciding.map((r: NameRow) => r.raw);
    const first = rows[0] as Obj;
    const list = <T>(drop: readonly string[] = []) => rows.map((r) => fields(r, drop) as T);
    switch (h.key as DefinitionTable) {
      case "itemRules equip.slots":
        def.slot = first.slot as ItemDefinition["slot"];
        break;
      case "itemRules equip.strength":
        def.strength = first.strength as number;
        break;
      case "itemRules equip.twoHanded":
        def.twoHanded = true;
        break;
      case "itemRules behaviours":
        def.behaviours = [
          ...new Set(rows.map((r) => r.behaviour as NonNullable<ItemDefinition["behaviours"]>[0])),
        ];
        break;
      case "attPower attPower.base":
        attack.base = list();
        break;
      case "attPower attPower.exactOverrides":
        attack.overrides = list();
        break;
      case "attPower attPower.skillBlocks":
        attack.blocks = list(["weaponMatch"]);
        break;
      case "itemRules armour.rows":
        def.armour = list();
        break;
      case "itemRules armour.elemental":
        def.elemental = list();
        break;
      case "itemRules armour.spell.rows":
        def.spellDefense = list();
        break;
      case "itemRules gear":
        def.gear = list();
        break;
      case "itemRules swing.cooldowns":
        def.cooldowns = list();
        break;
      case "itemRules swing.sounds":
        def.sound = first.sound as string | null;
        break;
      case "itemRules use.usable":
        use.usable = true;
        break;
      case "itemRules use.silent":
        use.silent = true;
        break;
      case "itemRules use.effects":
        use.effects = list();
        break;
      case "itemRules use.messages":
        use.message = first.text as string;
        // (`read` is the compile's, not the definition's.)
        break;
      case "itemRules use.refusals":
        use.refusal = first.text as string;
        break;
      case "classes skillGain.weaponSkills":
        def.trains = first.skills as string[];
        break;
    }
  }
  if (Object.keys(attack).length > 0) {
    def.attack = attack;
  }
  if (Object.keys(use).length > 0) {
    def.use = use;
  }
  return def;
}

/** The datasets an item's tables live in. */
const DEFINITION_DATASETS: readonly DatasetId[] = [...ITEM_DATASETS, "classes"];

/** The datasets the resolver reads for items (the craft data gives the masterworks). */
function itemSubset(data: Partial<ContentData>): Partial<ContentData> {
  const out: Partial<ContentData> = {};
  for (const id of DEFINITION_DATASETS) {
    if (data[id] !== undefined) {
      (out as Record<string, unknown>)[id] = data[id];
    }
  }
  return out;
}

/**
 * The tables a definition covers, indexed once per data object: the item tables named by their
 * rows, with the book rows of the meal-line table already left out (a read line is never a meal's).
 * Resolving 300 items (the Items list, a compile) reads this index rather than rebuilding it each
 * time.
 */
interface DefinitionIndex {
  tables: Map<string, NameRow[]>;
}
/** By data object, by the tables asked for ("" for every covered table). */
const indexes = new WeakMap<object, Map<string, DefinitionIndex>>();
const COVERED = new Set<string>(DEFINITION_TABLES);

function definitionIndex(
  data: Partial<ContentData>,
  only?: readonly DefinitionTable[],
): DefinitionIndex {
  const which = only ? [...only].sort().join("|") : "";
  const byTables = indexes.get(data) ?? new Map<string, DefinitionIndex>();
  indexes.set(data, byTables);
  const known = byTables.get(which);
  if (known) {
    return known;
  }
  const wanted = only ? new Set<string>(only) : COVERED;
  const subset = itemSubset(data);
  const isBook = data.itemRules ? behaviourTest(data.itemRules.behaviours) : null;
  const tables = new Map<string, NameRow[]>();
  for (const [key, rows] of nameTables(subset)) {
    if (!wanted.has(key)) {
      continue;
    }
    tables.set(
      key,
      key === "itemRules use.messages" && isBook
        ? rows.filter((r) => !((r.raw.read as boolean | undefined) ?? isBook(r.pattern, "book")))
        : rows,
    );
  }
  const out = { tables };
  byTables.set(which, out);
  return out;
}

/**
 * What `name` plays in `data`'s tables (as `resolveItem`, over data that may hold no store); with
 * `only`, in just those tables (the Items list's kinds read four).
 */
export function resolveIn(
  name: string,
  data: Partial<ContentData>,
  only?: readonly DefinitionTable[],
): TableHit[] {
  return matchAllTables(name, {}, data.craft, definitionIndex(data, only).tables, null);
}

/** Reads and writes the array at a table's path (`itemRules equip.slots`). */
function tableAt(root: Obj, key: string): { get(): Obj[]; set(v: Obj[]): void } {
  const [ds, path] = key.split(" ") as [string, string];
  const parts = path.split(".");
  return {
    get() {
      let o = root[ds] as Obj;
      for (const p of parts) {
        o = o?.[p] as Obj;
      }
      return Array.isArray(o) ? (o as Obj[]) : [];
    },
    set(v) {
      // Copies each object on the path, so the input data is never changed.
      root[ds] = { ...(root[ds] as Obj) };
      let o = root[ds] as Obj;
      for (const p of parts.slice(0, -1)) {
        o[p] = { ...(o[p] as Obj) };
        o = o[p] as Obj;
      }
      o[parts.at(-1) as string] = v;
    },
  };
}

/**
 * The data with every item definition compiled into its tables (see the module comment). Data with
 * no definitions comes back as it is.
 */
export function compileDefinitions(data: ContentData): ContentData {
  const defs = data.items.definitions ?? [];
  if (defs.length === 0) {
    return data;
  }
  // The same data is compiled again and again through one publish (its checks, the art checks, the
  // trial install, the rebuild): the answer is kept per data object, which is never changed.
  const known = compiled.get(data);
  if (known) {
    return known;
  }
  const out = compileUncached(data, defs);
  compiled.set(data, out);
  // A compiled store is never compiled again.
  compiled.set(out, out);
  return out;
}

/** Compiled data, by the data it was compiled from. */
const compiled = new WeakMap<ContentData, ContentData>();

function compileUncached(
  data: ContentData,
  defs: NonNullable<ContentData["items"]["definitions"]>,
): ContentData {
  const isBook = data.itemRules ? behaviourTest(data.itemRules.behaviours) : null;
  const { tables } = definitionIndex(data);
  /** By table: the names each pack row (by 1-based index) leaves out, and the rows to put in. */
  const excepts = new Map<string, Map<number, string[]>>();
  const inserts = new Map<string, { at: number; rows: Obj[] }[]>();
  for (const def of defs) {
    const name = def.name;
    const hits = new Map(matchAllTables(name, {}, data.craft, tables, null).map((h) => [h.key, h]));
    const masterworks = masterworksOf(name, data.craft);
    for (const key of definitionTables(name)) {
      const hit = hits.get(key);
      const left = excepts.get(key) ?? new Map<number, string[]>();
      for (const r of hit?.rows ?? []) {
        const names = left.get(r.index);
        if (names) {
          names.push(testedName(key, name));
        } else {
          left.set(r.index, [testedName(key, name)]);
        }
      }
      excepts.set(key, left);
      const own = definitionRows(def, key);
      const list = inserts.get(key) ?? [];
      if (key === "itemRules swing.cooldowns") {
        // The cooldown table's last matching row wins across every worn slot (a ring's row after
        // a sword's sets both delays), so each row goes where the item's deciding row for its slot
        // was: a seed saved unchanged keeps the loadout's winner.
        for (const r of own) {
          const same = (hit?.rows ?? []).filter((h) => (h.raw as Obj).slot === r.slot);
          const at = same.length > 0 ? Math.max(...same.map((h) => h.index)) : Infinity;
          list.push({ at, rows: [exactRow(key, name, r, masterworks)] });
        }
      } else {
        const rows = own.map((r) => exactRow(key, name, r, masterworks));
        const at =
          hit && hit.rows.length > 0 ? Math.min(...hit.rows.map((r) => r.index)) : Infinity;
        list.push({ at, rows });
      }
      inserts.set(key, list);
    }
  }
  const out = { ...data } as unknown as Obj;
  // Every message row says whether it is a read line, decided by the uncompiled behaviours: a
  // definition giving the item Potion the book behaviour must not turn a shared meal row whose
  // pattern is "Potion" into a read line for Red Potion.
  if (isBook) {
    const msgs = tableAt(out, "itemRules use.messages");
    msgs.set(
      msgs.get().map((m) => ({
        ...m,
        read: (m.read as boolean | undefined) ?? isBook(m.pattern as string, "book"),
      })),
    );
  }
  for (const key of DEFINITION_TABLES) {
    const left = excepts.get(key);
    const put = inserts.get(key);
    if (!left && !put) {
      continue;
    }
    const t = tableAt(out, key);
    const orig = t.get();
    // The rows to put in, by the place they go (in the order they were added).
    const at = new Map<number, Obj[]>();
    for (const p of put ?? []) {
      const list = at.get(p.at);
      if (list) {
        list.push(...p.rows);
      } else {
        at.set(p.at, [...p.rows]);
      }
    }
    const next: Obj[] = [];
    orig.forEach((row, i) => {
      next.push(...(at.get(i + 1) ?? []));
      const names = left?.get(i + 1);
      next.push(
        names
          ? { ...row, except: [...((row.except as string[] | undefined) ?? []), ...names] }
          : row,
      );
    });
    for (const [where, rows] of at) {
      if (where > orig.length) {
        next.push(...rows);
      }
    }
    t.set(next);
  }
  return out as unknown as ContentData;
}

setDefinitionCompiler(compileDefinitions);
