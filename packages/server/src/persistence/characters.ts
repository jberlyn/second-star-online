/**
 * Characters. All SQL for characters, their skills and their bag lines lives here. Callers own
 * transactions.
 */
import {
  type Facing,
  SKILL_KEYS,
  type SkillValues,
  type StartingCharacter,
  skillsFromKeys,
  type Vehicle,
} from "@secondstaronline/shared";

import type { Db } from "./database.ts";

export interface Position {
  mapId: string;
  x: number;
  y: number;
  facing: Facing;
}

/** The vitals line of the character file (line 2). */
export interface StoredVitals {
  level: number;
  hp: number;
  hpMax: number;
  sp: number;
  spMax: number;
  exp: number;
  expNeeded: number;
}

/** Line 3: the stats. */
export interface StoredStats {
  str: number;
  sta: number;
  dex: number;
  int: number;
  wis: number;
}

/** What the world needs to put a character on a map. */
export interface CharacterRecord {
  id: string;
  accountId: string;
  name: string;
  sex: number;
  head: number;
  classCode: number;
  vitals: StoredVitals;
  stats: StoredStats;
  hunger: number;
  position: Position;
  /**
   * Where a death or jail release sends the character: the creation position, replaced on entering
   * an O-O-O map. Null only when its map was deleted (the fallback point is used then).
   */
  respawn: { mapId: string; x: number; y: number } | null;
  /** `Fctnme:Fctcnt`, sheet item 5. */
  faction: StoredFaction;
  /** `gnL`, sheet item 8. */
  wanted: boolean;
  /** Sheet item 6. */
  profile: string;
  /** What the character is riding. */
  vehicle: Vehicle | null;
  /** Aboard: the vehicle's hull; null on foot, or a rider saved before hulls (a full hull). */
  hull: number | null;
}

/** `Fctnme` (1.6's 0-3, now a faction key) and `Fctcnt` in frames. */
export interface StoredFaction {
  /** The faction's key (`social.json` `factions[].key`), or null for none. */
  key: string | null;
  count: number;
}

interface CharacterRow {
  id: string;
  account_id: string;
  name: string;
  sex: number;
  head: number;
  class_code: number;
  level: number;
  hp: number;
  hp_max: number;
  sp: number;
  sp_max: number;
  exp: number;
  exp_needed: number;
  str: number;
  sta: number;
  dex: number;
  int: number;
  wis: number;
  hunger: number;
  map_id: string;
  x: number;
  y: number;
  facing: Facing;
  respawn_map_id: string | null;
  respawn_x: number | null;
  respawn_y: number | null;
  faction: string | null;
  faction_count: number;
  wanted: number;
  profile: string;
  vehicle: Vehicle | null;
  hull: number | null;
}

const COLUMNS =
  "id, account_id, name, sex, head, class_code, level, hp, hp_max, sp, sp_max, exp, exp_needed, " +
  "str, sta, dex, int, wis, hunger, map_id, x, y, facing, respawn_map_id, respawn_x, respawn_y, " +
  "faction, faction_count, wanted, profile, vehicle, hull";

/**
 * Inserts a new character with one row per skill and starting bag. Its first respawn point is
 * where it is created. Synchronous: wrap it in the same transaction as the account it belongs to.
 */
export function insertCharacter(
  db: Db,
  input: { accountId: string; start: StartingCharacter; position: Position; now: string },
): string {
  const { start: c, position: p, now } = input;
  const id = Bun.randomUUIDv7();
  db.query(
    `INSERT INTO characters (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp, sp_max,
      exp, exp_needed, str, sta, dex, int, wis, gold, profile, hunger, break_count,
      map_id, x, y, facing, respawn_map_id, respawn_x, respawn_y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.accountId,
    c.name,
    c.sex,
    c.head,
    c.classCode,
    c.level,
    c.hp,
    c.hpMax,
    c.sp,
    c.spMax,
    c.exp,
    c.expNeeded,
    c.stats.str,
    c.stats.sta,
    c.stats.dex,
    c.stats.int,
    c.stats.wis,
    c.gold,
    c.profile,
    c.hunger,
    c.breakCount,
    p.mapId,
    p.x,
    p.y,
    p.facing,
    p.mapId,
    p.x,
    p.y,
    now,
    now,
  );
  writeSkills(db, id, c.skills);
  const bag = db.prepare(
    "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [i, line] of c.bag.entries()) {
    bag.run(Bun.randomUUIDv7(), id, i + 1, line.item, line.qty);
  }
  return id;
}

export function findCharacterByAccount(db: Db, accountId: string): CharacterRecord | null {
  const row = db
    .query<CharacterRow, [string]>(
      `SELECT ${COLUMNS} FROM characters WHERE account_id = ? ORDER BY created_at LIMIT 1`,
    )
    .get(accountId);
  return row ? toRecord(row) : null;
}

export function findCharacterById(db: Db, id: string): CharacterRecord | null {
  const row = db
    .query<CharacterRow, [string]>(`SELECT ${COLUMNS} FROM characters WHERE id = ?`)
    .get(id);
  return row ? toRecord(row) : null;
}

export function savePosition(db: Db, id: string, p: Position, now: string): void {
  db.query(
    "UPDATE characters SET map_id = ?, x = ?, y = ?, facing = ?, updated_at = ? WHERE id = ?",
  ).run(p.mapId, p.x, p.y, p.facing, now, id);
}

/**
 * What a session changes: position, vitals, hunger, skills, the respawn point, faction and flag,
 * and the allocated stats.
 */
export interface CharacterProgress {
  position: Position;
  vitals: StoredVitals;
  hunger: number;
  skills: readonly number[];
  /** Each skill's running XP total; saved XP stays when absent. */
  skillXp?: readonly number[];
  respawn: { mapId: string; x: number; y: number } | null;
  faction: StoredFaction;
  wanted: boolean;
  stats: StoredStats;
  vehicle: Vehicle | null;
  hull: number | null;
}

/** Writes a session's progress. Synchronous: callers batch it in one transaction. */
export function saveProgress(db: Db, id: string, c: CharacterProgress, now: string): void {
  const { position: p, vitals: v, respawn: r } = c;
  db.query(
    `UPDATE characters SET map_id = ?, x = ?, y = ?, facing = ?, level = ?, hp = ?, hp_max = ?,
      sp = ?, sp_max = ?, exp = ?, exp_needed = ?, hunger = ?, respawn_map_id = ?, respawn_x = ?,
      respawn_y = ?, faction = ?, faction_count = ?, wanted = ?, str = ?, sta = ?, dex = ?,
      int = ?, wis = ?, vehicle = ?, hull = ?, updated_at = ? WHERE id = ?`,
  ).run(
    p.mapId,
    p.x,
    p.y,
    p.facing,
    v.level,
    v.hp,
    v.hpMax,
    v.sp,
    v.spMax,
    v.exp,
    v.expNeeded,
    c.hunger,
    r?.mapId ?? null,
    r?.x ?? null,
    r?.y ?? null,
    c.faction.key,
    c.faction.count,
    c.wanted ? 1 : 0,
    c.stats.str,
    c.stats.sta,
    c.stats.dex,
    c.stats.int,
    c.stats.wis,
    c.vehicle,
    c.vehicle ? c.hull : null,
    now,
    id,
  );
  writeSkills(db, id, c.skills, c.skillXp);
}

/**
 * Writes a character's skills, one row per skill the content lists, under each skill's key. A
 * skill new to the character gains its row; an unchanged value is not rewritten; rows of skills
 * the content no longer lists are left alone, so a skill that returns finds its values.
 */
export function writeSkills(
  db: Db,
  id: string,
  skills: readonly number[],
  /** Each skill's running XP total, by the same index; left as saved when absent. */
  xp?: readonly number[],
): void {
  const byKey = (list: readonly number[]) =>
    Object.fromEntries(
      list.flatMap((v, i) => (SKILL_KEYS[i] === undefined ? [] : [[SKILL_KEYS[i], v]])),
    );
  saveSkillValues(db, id, byKey(skills), xp === undefined ? undefined : byKey(xp));
}

/**
 * Writes skill values by key (an unchanged value is not rewritten), and their XP totals when given
 * (a skill without one keeps its saved XP). A row saved under another spelling of a written key (a
 * skill removed and added back spelled differently) goes, so a skill never has two rows to choose
 * between.
 */
export function saveSkillValues(
  db: Db,
  id: string,
  values: Readonly<SkillValues>,
  xp?: Readonly<SkillValues>,
): void {
  const keys = Object.keys(values);
  db.query(
    `DELETE FROM character_skills WHERE character_id = ?
     AND skill NOT IN (SELECT value FROM json_each(?))
     AND lower(replace(skill, ' ', '')) IN (SELECT value FROM json_each(?))`,
  ).run(
    id,
    JSON.stringify(keys),
    JSON.stringify(keys.map((k) => k.replace(/\s+/g, "").toLowerCase())),
  );
  if (keys.length === 0) {
    return;
  }
  const q = db.prepare(
    `INSERT INTO character_skills (character_id, skill, value, xp) VALUES (?, ?, ?, coalesce(?, 0))
     ON CONFLICT (character_id, skill) DO UPDATE SET value = excluded.value,
       xp = coalesce(?, character_skills.xp)
     WHERE character_skills.value <> excluded.value OR character_skills.xp <> coalesce(?, character_skills.xp)`,
  );
  for (const [key, value] of Object.entries(values)) {
    const x = xp?.[key] ?? null;
    q.run(id, key, value, x, x, x);
  }
}

/**
 * A promotion: the class, the gold, the HP and SP floors and the granted skills in one write, so a
 * crash never leaves the class without its charge (a path's items and spells follow with the
 * inventory write). The class's stat points are calculated, not stored.
 */
export function savePromotion(
  db: Db,
  id: string,
  r: {
    classCode: number;
    gold: number;
    hpMax: number;
    spMax: number;
    skills: readonly number[];
  },
  now: string,
): void {
  db.transaction(() => {
    db.query(
      "UPDATE characters SET class_code = ?, gold = ?, hp_max = ?, sp_max = ?, updated_at = ? WHERE id = ?",
    ).run(r.classCode, r.gold, r.hpMax, r.spMax, now, id);
    writeSkills(db, id, r.skills);
  })();
}

/**
 * Boarding or parking an Airship: the vehicle and the position written together, so a crash never
 * leaves a rider off the airship's tile. Callers batch it with the ground-item write.
 */
export function saveVehicle(
  db: Db,
  id: string,
  c: { vehicle: Vehicle | null; hull: number | null; position: Position },
  now: string,
): void {
  const p = c.position;
  db.query(
    "UPDATE characters SET vehicle = ?, hull = ?, map_id = ?, x = ?, y = ?, facing = ?, updated_at = ? WHERE id = ?",
  ).run(c.vehicle, c.vehicle ? c.hull : null, p.mapId, p.x, p.y, p.facing, now, id);
}

/** The saved profile, written at once. */
export function saveProfileText(db: Db, id: string, profile: string, now: string): void {
  db.query("UPDATE characters SET profile = ?, updated_at = ? WHERE id = ?").run(profile, now, id);
}

/** A character's saved skill values by skill key, including skills the content no longer lists. */
export function loadSkillValues(db: Db, id: string): SkillValues {
  const out: SkillValues = {};
  for (const r of db
    .query<{ skill: string; value: number }, [string]>(
      "SELECT skill, value FROM character_skills WHERE character_id = ?",
    )
    .all(id)) {
    out[r.skill] = r.value;
  }
  return out;
}

/**
 * Load a character's skills in the content's order (`SKILL_KEYS`), each by its key. A skill the
 * character has no row for (added to content since it was saved) starts at `NEW_SKILL_VALUE` (1),
 * and the next save writes its row; rows of skills since removed from content are kept, unread.
 */
export function loadSkills(db: Db, id: string): number[] {
  return skillsFromKeys(loadSkillValues(db, id));
}

/** A character's saved XP totals in the content's order; 0 for a skill with no row. */
export function loadSkillXp(db: Db, id: string): number[] {
  const out: SkillValues = {};
  for (const r of db
    .query<{ skill: string; xp: number }, [string]>(
      "SELECT skill, xp FROM character_skills WHERE character_id = ?",
    )
    .all(id)) {
    out[r.skill] = r.xp;
  }
  return skillsFromKeys(out, () => 0);
}

export function loadBag(db: Db, id: string): { slot: number; item: string; qty: number }[] {
  return db
    .query<{ slot: number; item: string; qty: number }, [string]>(
      "SELECT slot, item, qty FROM inventory WHERE character_id = ? ORDER BY slot",
    )
    .all(id);
}

function toRecord(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    sex: row.sex,
    head: row.head,
    classCode: row.class_code,
    vitals: {
      level: row.level,
      hp: row.hp,
      hpMax: row.hp_max,
      sp: row.sp,
      spMax: row.sp_max,
      exp: row.exp,
      expNeeded: row.exp_needed,
    },
    stats: {
      str: row.str,
      sta: row.sta,
      dex: row.dex,
      int: row.int,
      wis: row.wis,
    },
    hunger: row.hunger,
    position: { mapId: row.map_id, x: row.x, y: row.y, facing: row.facing },
    respawn:
      row.respawn_map_id !== null && row.respawn_x !== null && row.respawn_y !== null
        ? { mapId: row.respawn_map_id, x: row.respawn_x, y: row.respawn_y }
        : null,
    faction: { key: row.faction, count: row.faction_count },
    wanted: row.wanted === 1,
    profile: row.profile,
    vehicle: row.vehicle,
    hull: row.hull,
  };
}
