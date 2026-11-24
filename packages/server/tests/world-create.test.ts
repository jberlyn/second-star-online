/**
 * Only the server creates a world (#43): operator commands refuse a database it has not created,
 * and two processes creating one world never seed it twice.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { content } from "@secondstaronline/shared";

import { auditReport } from "../src/cli/admin-audit.ts";
import { chatlogReport } from "../src/cli/admin-chatlog.ts";
import { listRoles, runSetRole } from "../src/cli/set-role.ts";
import { NoWorldError, openWorldDatabase } from "../src/cli/world-db.ts";
import { readPackDir } from "../src/content/packs.ts";
import { seedNewWorld, worldState, worldToCreate } from "../src/content/world-seed.ts";
import { startServer } from "../src/main.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { dropText } from "../src/systems/admin/drop.ts";

const NOW = "2026-11-24T00:00:00.000Z";
const ROOT = join(import.meta.dir, "..", "..", "..");
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "sso-world-create-"));
  dirs.push(d);
  writeFileSync(join(d, "index.html"), "<!doctype html><title>x</title>");
  return d;
};

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** Every operator command that opens the world, as a function of its path. */
const COMMANDS: [string, (path: string) => unknown][] = [
  ["maps:check", (path) => openWorldDatabase(path)],
  ["admin:role", (path) => runSetRole(path, "Op", "administrator")],
  ["admin:role --list", (path) => listRoles(path)],
  ["admin:audit", (path) => auditReport(path, 50)],
  [
    "admin:chatlog",
    (path) => chatlogReport(path, { channel: null, since: null, until: null, limit: 50 }),
  ],
];

describe("operator commands open only a world the server created", () => {
  test("a missing database is refused and not created", () => {
    const path = join(tempDir(), "world.sqlite");
    for (const [, run] of COMMANDS) {
      expect(() => run(path)).toThrow(NoWorldError);
      expect(existsSync(path)).toBe(false);
    }
    // The command line itself: maps:check says why and exits non-zero without reporting success.
    const out = Bun.spawnSync(["bun", "run", "maps:check"], {
      cwd: ROOT,
      env: { ...process.env, SSO_DB: path },
    });
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("no world here yet");
    expect(out.stdout.toString()).not.toContain("Every exit and setting point leads to a map.");
    expect(existsSync(path)).toBe(false);
  });

  test("a world the server has not finished creating is refused and left as it was; the server then seeds it", async () => {
    const dir = tempDir();
    const path = join(dir, "world.sqlite");
    // A start interrupted after the choice and the migrations, before the seed.
    const db = openDatabase(path);
    expect(worldToCreate(db, undefined, RELEASE_PACK_DIRS)).toBe("classic");
    migrate(db);
    db.close(true);
    const before = readFileSync(path);
    for (const [, run] of COMMANDS) {
      expect(() => run(path)).toThrow(NoWorldError);
    }
    expect(readFileSync(path).equals(before)).toBe(true);
    const server = startServer({
      dbPath: path,
      port: 0,
      development: false,
      clientDir: dir,
      autoTick: false,
      onLag: () => {},
    });
    try {
      expect(server.db.query("SELECT COUNT(*) AS n FROM maps").get()).toEqual({ n: 27 });
    } finally {
      await server.stop();
    }
    // Established now: the commands open it.
    expect(listRoles(path)).toContain("administrator");
    openWorldDatabase(path).close();
  });
});

describe("two processes creating one world", () => {
  test("both see one recorded choice, and the second seed changes nothing once the first is in", () => {
    const path = join(tempDir(), "world.sqlite");
    const a = openDatabase(path);
    const b = openDatabase(path);
    // Both start on a new file: one records the choice, the other finds it (not a second table).
    expect(worldToCreate(a, undefined, RELEASE_PACK_DIRS)).toBe("classic");
    expect(worldToCreate(b, "minimal", RELEASE_PACK_DIRS)).toBe("classic");
    migrate(a);
    migrate(b);
    // A seeds and the world is played: an operator renames the start map.
    seedNewWorld(a, "classic", RELEASE_PACK_DIRS, NOW);
    a.run("UPDATE maps SET title = 'Home' WHERE mx = 1000 AND my = 992");
    expect(worldState(b)).toBe("established");
    // B had read done = 0 before A finished; its seed now finds the world created and stops.
    seedNewWorld(b, "classic", RELEASE_PACK_DIRS, NOW);
    expect(a.query("SELECT title FROM maps WHERE mx = 1000 AND my = 992").get()).toEqual({
      title: "Home",
    });
    expect(a.query("SELECT COUNT(*) AS n FROM maps").get()).toEqual({ n: 27 });
    a.close();
    b.close();
  });
});

/** A copy of the Classic pack (without its art) whose start map places `items`. */
function classicWith(items: unknown[]): string {
  const dir = join(tempDir(), "classic");
  const from = RELEASE_PACK_DIRS.classic as string;
  cpSync(join(from, "manifest.json"), join(dir, "manifest.json"));
  cpSync(join(from, "data"), join(dir, "data"), { recursive: true });
  const world = JSON.parse(readFileSync(join(from, "world.json"), "utf8"));
  const start = world.maps.find((m: { map: string }) => m.map === "x1000y992");
  start.items = [...start.items, ...items];
  writeFileSync(join(dir, "world.json"), JSON.stringify(world));
  return dir;
}

describe("a seed's counted piles", () => {
  test("a pile of more than one gives its count as qty, and seeds as the World Editor saves it", () => {
    const db = openDatabase();
    migrate(db);
    const classic = classicWith([{ item: "Apple", x: 3, y: 3, qty: 2 }]);
    seedNewWorld(db, "classic", { classic }, NOW);
    const map = findMapByCoords(db, 1000, 992);
    const pile = db
      .query<{ item: string; qty: number }, [string]>(
        "SELECT item, qty FROM ground_items WHERE map_id = ? AND x = 3 AND y = 3",
      )
      .get(map?.id ?? "");
    expect(pile).toEqual({ item: "Apple", qty: 2 });
    // The editor shows it, and would save it back, as "2 Apple".
    expect(dropText(pile as { item: string; qty: number })).toBe("2 Apple");
    db.close();
  });

  test("a count in a name is refused except for the currency and crystals", () => {
    expect(() => readPackDir(classicWith([{ item: "2 Apple", x: 3, y: 3 }]))).toThrow(
      /"2 Apple": give a pile's count as qty/,
    );
    expect(() => readPackDir(classicWith([{ item: "Apples", x: 3, y: 3 }]))).toThrow(
      /"Apples" is not one of the pack's items/,
    );
    const ok = readPackDir(
      classicWith([
        { item: "7 Gold", x: 3, y: 3 },
        { item: "5 Blue Crystal", x: 4, y: 3 },
        { item: "Exit", x: 5, y: 3 },
      ]),
    );
    expect(ok.world?.maps.find((m) => m.map === "x1000y992")?.items).toHaveLength(8);
  });
});

describe("a stopped server leaves the process's content store as it found it", () => {
  test("a Minimal server installs Minimal while it runs and puts Classic back when it stops", async () => {
    const before = content();
    const dir = tempDir();
    const server = startServer({
      dbPath: ":memory:",
      content: "minimal",
      port: 0,
      development: false,
      clientDir: dir,
      autoTick: false,
      onLag: () => {},
    });
    try {
      expect(content()).not.toBe(before);
      expect(content().classes.skills.map((s) => s.skill)).toEqual(["Fighting"]);
    } finally {
      await server.stop();
    }
    expect(content()).toBe(before);
  });
});
