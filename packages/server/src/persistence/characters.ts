/**
 * Characters. All SQL for characters, their skills and their bag lines lives here. Callers own
 * transactions.
 */
import { classesData } from "@secondstaronline/data";
import {
  type Facing,
  NEW_SKILL_VALUE,
  type StartingCharacter,
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

/** Line 3: the eight stats. */
export interface StoredStats {
  str: number;
  sta: number;
  agi: number;
  dex: number;
  int: number;
  wis: number;
  spd: number;
  aim: number;
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
  /** The O-O-O respawn point, or null for the operator's respawnPoint setting. */
  respawn: { mapId: string; x: number; y: number } | null;
  /** `Fctnme:Fctcnt`, sheet item 5. */
  faction: StoredFaction;
  /** `gnL`, sheet item 8. */
  wanted: boolean;
  /** Sheet item 6. */
  profile: string;
  /** Sheet item 10, `id-id-…`. */
  medals: string;
  /** What the character is riding. */
  vehicle: Vehicle | null;
}

/** `Fctnme` (0 none, 1 Mage, 2 Warrior, 3 Adventurer) and `Fctcnt` in frames. */
export interface StoredFaction {
  id: number;
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
  agi: number;
  dex: number;
  int: number;
  wis: number;
  spd: number;
  aim: number;
  hunger: number;
  map_id: string;
  x: number;
  y: number;
  facing: Facing;
  respawn_map_id: string | null;
  respawn_x: number | null;
  respawn_y: number | null;
  faction: number;
  faction_count: number;
  wanted: number;
  profile: string;
  medals: string;
  vehicle: Vehicle | null;
}

const COLUMNS =
  "id, account_id, name, sex, head, class_code, level, hp, hp_max, sp, sp_max, exp, exp_needed, " +
  "str, sta, agi, dex, int, wis, spd, aim, hunger, map_id, x, y, facing, respawn_map_id, respawn_x, respawn_y, " +
  "faction, faction_count, wanted, profile, medals, vehicle";

/**
 * Inserts a new character with one row per skill and starting bag. Synchronous: wrap it in the
 * same transaction as the account it belongs to.
 */
export function insertCharacter(
  db: Db,
  input: { accountId: string; start: StartingCharacter; position: Position; now: string },
): string {
  const { start: c, position: p, now } = input;
  const id = Bun.randomUUIDv7();
  db.query(
    `INSERT INTO characters (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp, sp_max,
      exp, exp_needed, str, sta, agi, dex, int, wis, spd, aim, gold, profile, medals, hunger, break_count,
      map_id, x, y, facing, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    c.stats.agi,
    c.stats.dex,
    c.stats.int,
    c.stats.wis,
    c.stats.spd,
    c.stats.aim,
    c.gold,
    c.profile,
    c.medals,
    c.hunger,
    c.breakCount,
    p.mapId,
    p.x,
    p.y,
    p.facing,
    now,
    now,
  );
  const skill = db.prepare(
    "INSERT INTO character_skills (character_id, skill, value) VALUES (?, ?, ?)",
  );
  for (const [i, value] of c.skills.entries()) {
    skill.run(id, i + 1, value);
  }
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
 * and the stats and medals (the award check's points).
 */
export interface CharacterProgress {
  position: Position;
  vitals: StoredVitals;
  hunger: number;
  skills: readonly number[];
  respawn: { mapId: string; x: number; y: number } | null;
  faction: StoredFaction;
  wanted: boolean;
  stats: Omit<StoredStats, "aim">;
  medals: string;
  vehicle: Vehicle | null;
}

/** Writes a session's progress. Synchronous: callers batch it in one transaction. */
export function saveProgress(db: Db, id: string, c: CharacterProgress, now: string): void {
  const { position: p, vitals: v, respawn: r } = c;
  db.query(
    `UPDATE characters SET map_id = ?, x = ?, y = ?, facing = ?, level = ?, hp = ?, hp_max = ?,
      sp = ?, sp_max = ?, exp = ?, exp_needed = ?, hunger = ?, respawn_map_id = ?, respawn_x = ?,
      respawn_y = ?, faction = ?, faction_count = ?, wanted = ?, str = ?, sta = ?, agi = ?, dex = ?,
      int = ?, wis = ?, spd = ?, medals = ?, vehicle = ?, updated_at = ? WHERE id = ?`,
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
    c.faction.id,
    c.faction.count,
    c.wanted ? 1 : 0,
    c.stats.str,
    c.stats.sta,
    c.stats.agi,
    c.stats.dex,
    c.stats.int,
    c.stats.wis,
    c.stats.spd,
    c.medals,
    c.vehicle,
    now,
    id,
  );
  // A row for every skill the content lists (a longer list adds the missing rows); an
  // unchanged value is not rewritten.
  const skill = db.prepare(
    `INSERT INTO character_skills (character_id, skill, value) VALUES (?, ?, ?)
     ON CONFLICT (character_id, skill) DO UPDATE SET value = excluded.value
     WHERE character_skills.value <> excluded.value`,
  );
  for (const [i, value] of c.skills.entries()) {
    skill.run(id, i + 1, value);
  }
}

/**
 * A promotion: the class, the gold and the stat changes in one write, so a crash never leaves the
 * class without its charge. Skills are never touched: 1.6 undid a promotion's skill grants, so a
 * promotion changes only the class, the gold and the stat changes.
 */
export function savePromotion(
  db: Db,
  id: string,
  r: {
    classCode: number;
    gold: number;
    spMax: number;
    stats: Omit<StoredStats, "aim">;
  },
  now: string,
): void {
  db.query(
    `UPDATE characters SET class_code = ?, gold = ?, sp_max = ?, str = ?, sta = ?, agi = ?,
      dex = ?, int = ?, wis = ?, spd = ?, updated_at = ? WHERE id = ?`,
  ).run(
    r.classCode,
    r.gold,
    r.spMax,
    r.stats.str,
    r.stats.sta,
    r.stats.agi,
    r.stats.dex,
    r.stats.int,
    r.stats.wis,
    r.stats.spd,
    now,
    id,
  );
}

/**
 * Boarding or parking an Airship: the vehicle and the position written together, so a crash never
 * leaves a rider off the airship's tile. Callers batch it with the ground-item write.
 */
export function saveVehicle(
  db: Db,
  id: string,
  c: { vehicle: Vehicle | null; position: Position },
  now: string,
): void {
  const p = c.position;
  db.query(
    "UPDATE characters SET vehicle = ?, map_id = ?, x = ?, y = ?, facing = ?, updated_at = ? WHERE id = ?",
  ).run(c.vehicle, p.mapId, p.x, p.y, p.facing, now, id);
}

/** The saved profile, written at once. */
export function saveProfileText(db: Db, id: string, profile: string, now: string): void {
  db.query("UPDATE characters SET profile = ?, updated_at = ? WHERE id = ?").run(profile, now, id);
}

/**
 * Load a character's skills by skill number, padded to `count` with `NEW_SKILL_VALUE` (1).
 * A character saved before a skill was added gets 1, and the next save writes its row;
 * rows above `count` (a skill since removed from content) are ignored and kept.
 */
export function loadSkills(db: Db, id: string, count = classesData.skills.length): number[] {
  const skills = Array<number>(count).fill(NEW_SKILL_VALUE);
  const rows = db
    .query<{ skill: number; value: number }, [string]>(
      "SELECT skill, value FROM character_skills WHERE character_id = ? ORDER BY skill",
    )
    .all(id);
  for (const r of rows) {
    if (r.skill >= 1 && r.skill <= count) {
      skills[r.skill - 1] = r.value;
    }
  }
  return skills;
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
      agi: row.agi,
      dex: row.dex,
      int: row.int,
      wis: row.wis,
      spd: row.spd,
      aim: row.aim,
    },
    hunger: row.hunger,
    position: { mapId: row.map_id, x: row.x, y: row.y, facing: row.facing },
    respawn:
      row.respawn_map_id !== null && row.respawn_x !== null && row.respawn_y !== null
        ? { mapId: row.respawn_map_id, x: row.respawn_x, y: row.respawn_y }
        : null,
    faction: { id: row.faction, count: row.faction_count },
    wanted: row.wanted === 1,
    profile: row.profile,
    medals: row.medals,
    vehicle: row.vehicle,
  };
}
