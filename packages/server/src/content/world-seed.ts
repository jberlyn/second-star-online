/**
 * Creating a world (issue #37 stage 7): a new database is seeded from the pack the operator chose
 * (`SSO_CONTENT`, Classic by default). The choice is read only when the server creates the
 * database. From then on the world's maps and points are the operator's, and the variable does
 * nothing (a line says so when it disagrees with the world).
 *
 * The migrations still make a new database a Classic world (its pack, the seed, jail and church
 * maps, the seed map's roster and the four points), as they always have. Choosing another pack
 * replaces all of that with the chosen pack's world seed, in one transaction, before anything else
 * reads the database. Classic's own seed moves into its pack with #43.
 */
import { NO_FOG, parseMapName } from "@secondstaronline/shared";

import { insertPack, installedPacks } from "../persistence/content.ts";
import type { Db } from "../persistence/database.ts";
import { saveMap } from "../persistence/maps.ts";
import { saveSettingOverride } from "../persistence/settings.ts";
import { readPackDir } from "./packs.ts";

/** An `SSO_CONTENT` no release ships, given while a world is being created. */
export class ContentChoiceError extends Error {}

/** The pack a new world is created with when `SSO_CONTENT` is unset. */
export const DEFAULT_CONTENT = "classic";

/** The settings a world seed holds. */
const SEED_SETTINGS = ["startPoint", "fallbackPoint", "jailPoint", "bellMap"] as const;

/**
 * `SSO_CONTENT`: the id of a pack the release ships (`classic`, `minimal`), case ignored, or the
 * default when unset or empty. Anything else is an error naming the choices.
 */
export function readContentChoice(
  raw: string | undefined,
  releasePacks: Readonly<Record<string, string>>,
): { ok: true; pack: string } | { ok: false; error: string } {
  const want = (raw ?? "").trim().toLowerCase();
  if (want === "") {
    return { ok: true, pack: DEFAULT_CONTENT };
  }
  if (!Object.hasOwn(releasePacks, want)) {
    return {
      ok: false,
      error: `SSO_CONTENT must be one of ${Object.keys(releasePacks).join(", ")}, got "${raw}"`,
    };
  }
  return { ok: true, pack: want };
}

/** The table that records a world being created: the chosen pack, and whether its seed is in. */
const INIT_TABLE = "_world_init";

const hasInitTable = (db: Db): boolean =>
  db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(INIT_TABLE)?.n === 1;

const hasMigrations = (db: Db): boolean =>
  db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
    )
    .get()?.n === 1 &&
  (db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM _migrations").get()?.n ?? 0) > 0;

/**
 * Before the migrations run: the pack a world still being created starts from, or null for an
 * established world. A database with no migrations applied is new, so the choice (`SSO_CONTENT`,
 * checked here and only here) is recorded first; a creation a crash interrupted (the migrations or
 * the seed did not finish) resumes with the pack it chose, whatever the variable now says. Throws
 * on an unknown pack for a new world.
 */
export function worldToCreate(
  db: Db,
  raw: string | undefined,
  releasePacks: Readonly<Record<string, string>>,
): string | null {
  if (hasInitTable(db)) {
    const row = db
      .query<{ pack: string; done: number }, []>(`SELECT pack, done FROM ${INIT_TABLE}`)
      .get();
    return row && row.done === 0 ? row.pack : null;
  }
  if (hasMigrations(db)) {
    return null;
  }
  const choice = readContentChoice(raw, releasePacks);
  if (!choice.ok) {
    throw new ContentChoiceError(choice.error);
  }
  db.transaction(() => {
    db.run(`CREATE TABLE ${INIT_TABLE} (pack TEXT NOT NULL, done INTEGER NOT NULL)`);
    db.query(`INSERT INTO ${INIT_TABLE} (pack, done) VALUES (?, 0)`).run(choice.pack);
  })();
  return choice.pack;
}

/**
 * Seeds a database the server has just created with `pack`'s world, and records the world as
 * created in the same transaction. Classic's world is what the
 * migrations made, so it is kept as it is. Another pack takes its place: the Classic pack's entry,
 * maps, rosters and points go, and the pack, its maps and its points come in. Throws when the pack
 * brings no world seed (a world needs its points' maps).
 */
export function seedNewWorld(
  db: Db,
  pack: string,
  releasePacks: Readonly<Record<string, string>>,
  now: string,
): void {
  const done = () => {
    if (hasInitTable(db)) {
      db.run(`UPDATE ${INIT_TABLE} SET done = 1`);
    }
  };
  if (pack === DEFAULT_CONTENT) {
    done();
    return;
  }
  const dir = releasePacks[pack];
  if (!dir) {
    throw new Error(`content pack ${pack} is not shipped in this release`);
  }
  const loaded = readPackDir(dir);
  const world = loaded.world;
  if (!world) {
    throw new Error(`content pack ${pack} has no world seed, so a world cannot start from it`);
  }
  db.transaction(() => {
    // What the migrations seeded for a Classic world: nothing else is in a new database.
    db.run("DELETE FROM map_slots");
    db.run("DELETE FROM maps");
    db.run("DELETE FROM content_packs");
    for (const key of SEED_SETTINGS) {
      db.query("DELETE FROM settings WHERE key = ?").run(key);
    }
    insertPack(
      db,
      {
        id: loaded.manifest.id,
        name: loaded.manifest.name,
        version: loaded.manifest.version,
        source: "release",
        data: null,
      },
      now,
    );
    for (const m of world.maps) {
      const at = parseMapName(m.map);
      if (!at) {
        throw new Error(`content pack ${pack}: ${m.map} is not a grid map`);
      }
      saveMap(
        db,
        {
          mx: at.mx,
          my: at.my,
          title: m.title,
          layers: m.layers,
          flags: {
            canFight: m.flags?.canFight ?? "X",
            fctSpwn: "",
            isIndoors: m.flags?.isIndoors ?? "X",
            canPvp: m.flags?.canPvp ?? "X",
          },
          exit1: null,
          exit2: null,
          signs: ["", "", ""],
          fog: { ...NO_FOG },
        },
        now,
      );
    }
    saveSettingOverride(db, "startPoint", world.startPoint, now);
    saveSettingOverride(db, "fallbackPoint", world.fallbackPoint, now);
    saveSettingOverride(db, "jailPoint", world.jailPoint, now);
    saveSettingOverride(db, "bellMap", world.bellMap, now);
    done();
  })();
}

/**
 * The line for an established world `SSO_CONTENT` disagrees with (another pack, or one no release
 * ships): the variable is read only when the world is created. Null when it agrees or is unset.
 */
export function ignoredChoiceLine(db: Db, raw: string | undefined): string | null {
  const want = (raw ?? "").trim().toLowerCase();
  if (want === "") {
    return null;
  }
  const installed = installedPacks(db).map((p) => p.id);
  if (installed.includes(want)) {
    return null;
  }
  return `SSO_CONTENT=${raw} ignored: this world was created with ${installed.join(", ") || "no pack"} (the variable is read only when the server creates its database; see docs/running-a-server.md)`;
}
