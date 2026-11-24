/**
 * Creating a world (issue #37 stage 7): a new database is seeded from the pack the operator chose
 * (`SSO_CONTENT`, Classic by default). The choice is read only when the server creates the
 * database. From then on the world's maps and points are the operator's, and the variable does
 * nothing (a line says so when it disagrees with the world).
 *
 * The migrations still make a new database what a Classic world was before packs carried worlds
 * (its pack, the old seed, jail and church maps, the seed map's roster and the four points), as they
 * always have, so an upgrade replays them unchanged. Every new world then replaces all of that with
 * its pack's world seed, in one transaction, before anything else reads the database: for Classic,
 * 1.6's distributed maps (#43).
 */
import { NO_FOG, parseMapName } from "@secondstaronline/shared";

import { insertPack, installedPacks } from "../persistence/content.ts";
import type { Db } from "../persistence/database.ts";
import { insertGround } from "../persistence/ground.ts";
import { saveMap } from "../persistence/maps.ts";
import { saveSlots } from "../persistence/monsters.ts";
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
 * Where a database stands: `new` (nothing applied yet: the server would create a world in it),
 * `creating` (the server chose a pack but the seed is not in yet: a crash interrupted it) or
 * `established` (the world exists: its maps and points are the operator's).
 */
export type WorldState = "new" | "creating" | "established";

/** Where `db` stands (see `WorldState`). Reads only. */
export function worldState(db: Db): WorldState {
  if (hasInitTable(db)) {
    const row = db.query<{ done: number }, []>(`SELECT done FROM ${INIT_TABLE}`).get();
    return row && row.done === 0 ? "creating" : "established";
  }
  return hasMigrations(db) ? "established" : "new";
}

/**
 * Before the migrations run: the pack a world still being created starts from, or null for an
 * established world. A database with no migrations applied is new, so the choice (`SSO_CONTENT`,
 * checked here and only here) is recorded first; a creation a crash interrupted (the migrations or
 * the seed did not finish) resumes with the pack it chose, whatever the variable now says. Throws
 * on an unknown pack for a new world. The check and the record are one write transaction, so two
 * servers started on one new file record one choice.
 */
export function worldToCreate(
  db: Db,
  raw: string | undefined,
  releasePacks: Readonly<Record<string, string>>,
): string | null {
  return db
    .transaction((): string | null => {
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
      db.run(`CREATE TABLE ${INIT_TABLE} (pack TEXT NOT NULL, done INTEGER NOT NULL)`);
      db.query(`INSERT INTO ${INIT_TABLE} (pack, done) VALUES (?, 0)`).run(choice.pack);
      return choice.pack;
    })
    .immediate();
}

/**
 * Seeds a database the server has just created with `pack`'s world, and records the world as
 * created in the same transaction. What the migrations made goes (the pack entry, maps, rosters,
 * ground items and points), and the pack, its maps with their rosters and placed items, and its
 * points come in. Throws when the pack brings no world seed (a world needs its points' maps).
 *
 * The write transaction checks the record again first: when another process finished creating the
 * world in the meantime, nothing changes, so a world people have started editing is never seeded
 * over.
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
    if (worldState(db) === "established" && hasInitTable(db)) {
      return;
    }
    // What the migrations seeded for a Classic world: nothing else is in a new database.
    db.run("DELETE FROM map_slots");
    db.run("DELETE FROM ground_items");
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
      const id = saveMap(
        db,
        {
          mx: at.mx,
          my: at.my,
          title: m.title,
          layers: m.layers,
          flags: {
            canFight: m.flags?.canFight ?? "X",
            fctSpwn: m.flags?.fctSpwn ?? "",
            isIndoors: m.flags?.isIndoors ?? "X",
            canPvp: m.flags?.canPvp ?? "X",
          },
          exit1: m.exit1 ?? null,
          exit2: m.exit2 ?? null,
          signs: m.signs ?? ["", "", ""],
          fog: m.fog ?? { ...NO_FOG },
        },
        now,
      );
      // The roster as the World Editor places it: the species and its home tile, nothing live yet
      // (spawning fills the slots).
      if (m.roster && m.roster.length > 0) {
        saveSlots(
          db,
          id,
          m.roster.map((r) => ({
            slot: r.slot,
            species: r.species,
            live: null,
            home: { x: r.x, y: r.y },
          })),
          now,
        );
      }
      // Placed items, as the editor saves them: never decaying, the editor's own.
      for (const it of m.items ?? []) {
        insertGround(
          db,
          {
            id: Bun.randomUUIDv7(),
            mapId: id,
            x: it.x,
            y: it.y,
            item: it.item,
            // A counted pile as the editor saves one: the count in `qty` (see seedItemProblem).
            qty: it.qty ?? 1,
            kind: "admin",
            expiresAt: null,
          },
          now,
        );
      }
    }
    saveSettingOverride(db, "startPoint", world.startPoint, now);
    saveSettingOverride(db, "fallbackPoint", world.fallbackPoint, now);
    saveSettingOverride(db, "jailPoint", world.jailPoint, now);
    saveSettingOverride(db, "bellMap", world.bellMap, now);
    done();
  }).immediate();
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
