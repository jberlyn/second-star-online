/**
 * Monster definitions (issue #31): what the monster tables decide for one monster
 * (`monsters.definitions`), compiled by the store into exact rows for it, as an item definition is
 * (#30, content/definitions.ts). #22's rule: "a definition from the editor compiles into exact-name
 * rows that take priority in every table".
 *
 * The compile, for each definition and each table it covers:
 * - the pack's rows that matched the monster there (as the game tests it) leave it out (`except`),
 *   so only the definition decides, in every kind of table (any match, first match, every match);
 * - the definition's rows go in where the monster's first matching row was (else first), named
 *   exactly for it, so the order other monsters' rows meet in is the pack's, and the definitions'
 *   own order never matters (each names only its own monster);
 * - its kill skill cap goes on a compiled-only list by species (`skillCaps.bySpecies`), which the
 *   kill path reads ahead of the by-body rows; a definition with no cap gets the default;
 * - its list toggles put it on, or take it off, the editor lists.
 *
 * `seedMonsterDefinition` is the inverse: what a monster plays now (the resolver's answer) as a
 * definition, so a definition saved unchanged plays identically (monster-definitions.test.ts proves
 * it for every Classic monster and NPC).
 *
 * Pure: the server and the client compile the same store from the same data.
 */
import type { MonsterDefinition, MonstersData } from "@secondstaronline/data";

import { lingoEq } from "../rules/core/lingo.ts";
import {
  isMonsterTable,
  matchAllTables,
  type NameRow,
  nameTables,
  SKILL_CAP_TABLE,
  type TableHit,
} from "./name-tables.ts";
import type { ContentData } from "./store.ts";

type Obj = Record<string, unknown>;

/** A definition's yes/no fields, each with the table it compiles into. */
export const MONSTER_FLAG_TABLES = [
  ["sea", "monsters rules.sea"],
  ["footprint", "monsters rules.footprint"],
  ["hostile", "monsters rules.hostile"],
  ["officer", "monsters rules.officer"],
  ["sparesInnocent", "monsters rules.sparesInnocent"],
  ["clearsBlock", "monsters rules.clearsBlock"],
  ["namesSelf", "monsters rules.namesSelf"],
  ["noQuests", "monsters rules.noQuests"],
  ["neverCasts", "monsters casting.neverCasts"],
] as const;

/** The tables a monster definition covers (its name-matched tables). */
export const MONSTER_DEFINITION_TABLES = [
  ...MONSTER_FLAG_TABLES.map(([, key]) => key),
  "monsters rules.killXp",
  "monsters rules.killBroadcasts",
  "monsters meleeAffinities",
] as const;
export type MonsterDefinitionTable = (typeof MONSTER_DEFINITION_TABLES)[number];

/** The editor lists a definition toggles, by its `lists` field. */
const LISTS = [
  ["worldEditorMonsters", "worldEditor", "monsters"],
  ["worldEditorNpcs", "worldEditor", "npcs"],
  ["npcEditorMonsters", "npcEditor", "monsters"],
  ["npcEditorNpcs", "npcEditor", "npcs"],
] as const;

/** A definition's own rows for a table, before they are named for it. */
export function monsterDefinitionRows(def: MonsterDefinition, key: MonsterDefinitionTable): Obj[] {
  for (const [field, table] of MONSTER_FLAG_TABLES) {
    if (table === key) {
      return def[field] ? [{}] : [];
    }
  }
  if (key === "monsters rules.killXp") {
    return def.killXp === undefined ? [] : [{ xp: def.killXp }];
  }
  if (key === "monsters rules.killBroadcasts") {
    return def.killBroadcast === undefined ? [] : [{ text: def.killBroadcast }];
  }
  return (def.affinities ?? []).map((a) => ({ ...a }));
}

/** A row named exactly for `name`, in the table's own shape. */
function exactRow(key: string, name: string, row: Obj): Obj {
  if (key === "monsters meleeAffinities") {
    return {
      weapon: row.weapon,
      weaponMatch: "contains",
      monster: name,
      monsterMatch: "exact",
      delta: row.delta,
      randomN: row.randomN,
    };
  }
  return { match: "exact", pattern: name, ...row };
}

/**
 * What a monster plays now, as a definition: the resolver's answer (`resolveMonster`) over the
 * tables a definition covers, its kill skill cap, and the editor lists it is on (by whole entry).
 */
export function seedMonsterDefinition(
  name: string,
  hits: readonly TableHit[],
  monsters?: Pick<MonstersData, "editorLists">,
): MonsterDefinition {
  const def: MonsterDefinition = { name };
  const by = new Map(hits.map((h) => [h.key, h]));
  for (const [field, key] of MONSTER_FLAG_TABLES) {
    if ((by.get(key)?.deciding.length ?? 0) > 0) {
      def[field] = true;
    }
  }
  const xp = by.get("monsters rules.killXp")?.deciding[0]?.raw.xp;
  if (typeof xp === "number") {
    def.killXp = xp;
  }
  const text = by.get("monsters rules.killBroadcasts")?.deciding[0]?.raw.text;
  if (typeof text === "string") {
    def.killBroadcast = text;
  }
  const aff = by.get("monsters meleeAffinities")?.deciding ?? [];
  if (aff.length > 0) {
    def.affinities = aff.map((r) => ({
      weapon: r.raw.weapon as string,
      delta: r.raw.delta as number,
      randomN: r.raw.randomN as number,
    }));
  }
  const cap = by.get(SKILL_CAP_TABLE)?.deciding.at(-1)?.raw.skillCap;
  if (typeof cap === "number") {
    def.skillCap = cap;
  }
  if (monsters) {
    const lists: NonNullable<MonsterDefinition["lists"]> = {};
    for (const [field, editor, list] of LISTS) {
      if (monsters.editorLists[editor][list].some((n) => lingoEq(n, name))) {
        lists[field] = true;
      }
    }
    if (Object.keys(lists).length > 0) {
      def.lists = lists;
    }
  }
  return def;
}

/** Reads and writes the array at a monster table's path (`monsters rules.sea`). */
function tableAt(root: Obj, key: string): { get(): Obj[]; set(v: Obj[]): void } {
  const parts = (key.split(" ")[1] as string).split(".");
  return {
    get() {
      let o = root as Obj;
      for (const p of parts) {
        o = o?.[p] as Obj;
      }
      return Array.isArray(o) ? (o as Obj[]) : [];
    },
    set(v) {
      // Copies each object on the path, so the input data is never changed.
      let o = root;
      for (const p of parts.slice(0, -1)) {
        o[p] = { ...(o[p] as Obj) };
        o = o[p] as Obj;
      }
      o[parts.at(-1) as string] = v;
    },
  };
}

/** Compiled monster datasets, by the dataset they were compiled from. */
const compiled = new WeakMap<object, MonstersData>();
/** The monster datasets a compile produced (data holding one is compiled already). */
const produced = new WeakSet<object>();
/** The monster tables of a monster dataset, indexed once per dataset object. */
const indexes = new WeakMap<object, Map<string, NameRow[]>>();

function monsterTables(monsters: MonstersData): Map<string, NameRow[]> {
  const known = indexes.get(monsters);
  if (known) {
    return known;
  }
  const covered = new Set<string>(MONSTER_DEFINITION_TABLES);
  const out = new Map<string, NameRow[]>();
  for (const [key, rows] of nameTables({ monsters })) {
    if (isMonsterTable(key) && covered.has(key)) {
      out.set(key, rows);
    }
  }
  indexes.set(monsters, out);
  return out;
}

/**
 * The data with every monster definition compiled into the monster tables (see the module comment).
 * Data with no monster definitions comes back as it is.
 */
export function compileMonsterDefinitions(data: ContentData): ContentData {
  const defs = data.monsters.definitions ?? [];
  if (defs.length === 0 || produced.has(data.monsters)) {
    return data;
  }
  let monsters = compiled.get(data.monsters);
  if (!monsters) {
    monsters = compileUncached(data.monsters, defs);
    compiled.set(data.monsters, monsters);
    produced.add(monsters);
  }
  return { ...data, monsters };
}

function compileUncached(monsters: MonstersData, defs: readonly MonsterDefinition[]): MonstersData {
  const tables = monsterTables(monsters);
  /** By table: the names each pack row (by 1-based index) leaves out, and the rows to put in. */
  const excepts = new Map<string, Map<number, string[]>>();
  const inserts = new Map<string, Map<number, Obj[]>>();
  for (const def of defs) {
    const name = def.name;
    const hits = new Map(matchAllTables(name, {}, undefined, tables, null).map((h) => [h.key, h]));
    for (const key of MONSTER_DEFINITION_TABLES) {
      const hit = hits.get(key);
      const left = excepts.get(key) ?? new Map<number, string[]>();
      for (const r of hit?.rows ?? []) {
        const names = left.get(r.index);
        if (names) {
          names.push(name);
        } else {
          left.set(r.index, [name]);
        }
      }
      excepts.set(key, left);
      const own = monsterDefinitionRows(def, key).map((r) => exactRow(key, name, r));
      if (own.length === 0) {
        continue;
      }
      // Where the monster's first row was, else first: ahead of every pack row it could meet.
      const at = hit && hit.rows.length > 0 ? Math.min(...hit.rows.map((r) => r.index)) : 1;
      const put = inserts.get(key) ?? new Map<number, Obj[]>();
      const list = put.get(at);
      if (list) {
        list.push(...own);
      } else {
        put.set(at, [...own]);
      }
      inserts.set(key, put);
    }
  }
  const out = { ...monsters } as unknown as Obj;
  for (const key of MONSTER_DEFINITION_TABLES) {
    const left = excepts.get(key);
    const put = inserts.get(key);
    if ((!left || left.size === 0) && !put) {
      continue;
    }
    const t = tableAt(out, key);
    const orig = t.get();
    const next: Obj[] = [];
    orig.forEach((row, i) => {
      next.push(...(put?.get(i + 1) ?? []));
      const names = left?.get(i + 1);
      next.push(
        names
          ? { ...row, except: [...((row.except as string[] | undefined) ?? []), ...names] }
          : row,
      );
    });
    for (const [where, rows] of put ?? []) {
      if (where > orig.length) {
        next.push(...rows);
      }
    }
    t.set(next);
  }
  // The kill skill cap by species: the kill path reads it ahead of the by-body rows.
  out.skillCaps = {
    ...monsters.skillCaps,
    bySpecies: defs.map((d) => ({ name: d.name, skillCap: d.skillCap ?? null })),
  };
  out.editorLists = compileLists(monsters.editorLists, defs);
  return out as unknown as MonstersData;
}

/**
 * The editor lists a definition toggles: a monster it puts on a list it is not on goes at the end,
 * one it leaves off comes off (every spelling of it); a list it is already on is left as it is.
 */
function compileLists(
  lists: MonstersData["editorLists"],
  defs: readonly MonsterDefinition[],
): MonstersData["editorLists"] {
  const out = {
    worldEditor: { ...lists.worldEditor },
    npcEditor: { ...lists.npcEditor },
  };
  for (const [field, editor, list] of LISTS) {
    let next = [...lists[editor][list]];
    for (const d of defs) {
      const on = d.lists?.[field] === true;
      const has = next.some((n) => lingoEq(n, d.name));
      if (on && !has) {
        next.push(d.name);
      } else if (!on && has) {
        next = next.filter((n) => !lingoEq(n, d.name));
      }
    }
    out[editor][list] = next;
  }
  return out;
}
