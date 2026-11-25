/**
 * A world built only from operator content (issue #37 stage 7): a new database created with the
 * Minimal pack (`SSO_CONTENT=minimal`), and no Classic pack installed. It must start, meet the
 * content contract, pass `maps:check`, serve no Classic row or art, and, with an operator's
 * published rows on top, let a character be created, log in, walk, and train a skill.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { type ContentData, content, skillIndex } from "@secondstaronline/shared";

import { mapCheck } from "../src/cli/map-check.ts";
import { readPackDir } from "../src/content/packs.ts";
import type { ContentActor } from "../src/content/service.ts";
import { ContentChoiceError, worldToCreate } from "../src/content/world-seed.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const NOW = "2026-11-24T00:00:00.000Z";

const dirs: string[] = [];
const logged: string[] = [];
let logSpy: ReturnType<typeof spyOn> | null = null;
beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logged.push(a.join(" "));
  });
});
afterEach(() => {
  logSpy?.mockRestore();
  logged.length = 0;
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** A server on a new database file, created with `pack`, ticked by hand. */
function start(pack: string | undefined): { server: RunningServer; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "sso-minimal-"));
  dirs.push(dir);
  const clientDir = join(dir, "client");
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
  const dbPath = join(dir, "world.sqlite");
  const server = startServer({
    dbPath,
    port: 0,
    development: false,
    clientDir,
    clock: manualClock(),
    autoTick: false,
    isoNow: () => NOW,
    // Every roll takes its lowest value.
    rng: { random: (n) => (n >= 1 ? 1 : 0) },
    content: pack,
    onLag: () => {},
  });
  return { server, dbPath };
}

const classic = readPackDir(RELEASE_PACK_DIRS.classic as string).data as ContentData;

describe("a world created with the Minimal pack", () => {
  test("starts with no Classic pack, meets the contract and passes maps:check", async () => {
    const { server } = start("minimal");
    try {
      expect(logged).toContain("content: created a new world with the minimal pack");
      expect(server.content.installedPacks().map((p) => p.id)).toEqual(["minimal"]);
      expect(server.content.check()).toEqual([]);
      expect(server.game.contractPointProblems()).toEqual([]);
      expect(mapCheck(server.db)).toEqual([]);
      expect(server.game.settings.startPoint).toEqual({ map: "x0y0", x: 1, y: 1 });
      expect(server.game.settings.fallbackPoint).toEqual({ map: "x0y0", x: 1, y: 1 });
      expect(server.game.settings.jailPoint).toEqual({ map: "x50y50", x: 1, y: 1 });
      expect(server.game.settings.bellMap).toBeNull();
      expect(server.db.query("SELECT mx, my, title FROM maps ORDER BY mx").all()).toEqual([
        { mx: 0, my: 0, title: "Grassland" },
        { mx: 50, my: 50, title: "Jail" },
      ]);
    } finally {
      await server.stop();
    }
  });

  test("holds no Classic content: one item (the currency), no monster, NPC or spell, its own class and skill", async () => {
    const { server } = start("minimal");
    try {
      const d = server.content.publishedContent();
      expect(d.items.items.map((i) => i.name)).toEqual(["Gold"]);
      expect(d.monsters.monsters).toEqual([]);
      expect(d.npcFiles.files).toEqual([]);
      expect(d.spells.spells).toEqual([]);
      expect(d.houses.deeds).toEqual([]);
      expect(d.social.factions).toEqual([]);
      expect(d.classes.classes.map((c) => c.name)).toEqual(["Novice"]);
      expect(d.classes.skills.map((s) => s.skill)).toEqual(["Fighting"]);
      const classicNames = new Set([
        ...classic.classes.classes.map((c) => c.name),
        ...classic.classes.skills.map((s) => s.skill),
      ]);
      expect(classicNames.has("Novice")).toBe(false);
      expect(classicNames.has("Fighting")).toBe(false);
      // The tiles are grass, the empty tile and the shadow, as Classic draws them.
      expect(d.tiles.catalogue.map((t) => t.code)).toEqual(["G1", "G3", "5A"]);
    } finally {
      await server.stop();
    }
  });

  test("serves only the Minimal pack's art: no Classic atlas or sound", async () => {
    const { server } = start("minimal");
    try {
      const res = await fetch(new URL("/assets/index.json", server.url));
      expect(res.status).toBe(200);
      const index = (await res.json()) as {
        atlases: Record<string, { sheets: string[]; sprites: Record<string, unknown> }>;
        sounds: Record<string, string>;
      };
      const sheets = Object.values(index.atlases).flatMap((a) => a.sheets);
      expect(sheets.length).toBeGreaterThan(0);
      expect(sheets.every((s) => s.startsWith("packs/minimal/"))).toBe(true);
      expect(Object.keys(index.atlases.tiles?.sprites ?? {}).sort()).toEqual(["5a", "g1", "g3"]);
      expect(Object.keys(index.atlases.items?.sprites ?? {}).sort()).toEqual([
        "largegold",
        "mediumgold",
        "smallgold",
      ]);
      expect(Object.keys(index.atlases.bodies?.sprites ?? {})).toEqual([]);
      // The interface's own clicks, and nothing of Classic's.
      expect(Object.keys(index.sounds).sort()).toEqual(["clicksound", "clicksound2"]);
      const classicArt = await fetch(new URL("/assets/packs/classic/index.json", server.url));
      expect(classicArt.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  test("with an operator's rows: a character is created, logs in, walks and trains a skill", async () => {
    const { server } = start("minimal");
    try {
      const svc = server.content;
      const set = (dataset: string, part: string, key: string | null, data: unknown) => {
        const r = svc.draftSet(ADMIN, { dataset: dataset as never, part, key }, "set", data);
        expect(r.ok ? "ok" : r.error).toBe("ok");
      };
      const d = svc.publishedContent();
      // A Lore skill on an XP curve, taught by a book every new character carries.
      set("classes", "progression", null, {
        ...d.classes.progression,
        curves: { lore: { counting: "total", table: [0, 100, 250, 450], cap: 4 } },
      });
      set("classes", "skills", "Lore", {
        skill: "Lore",
        progression: { model: "xp", curve: "lore" },
      });
      set("items", "items", "Lore Book", { name: "Lore Book", variants: [], icon: null });
      set("itemRules", "behaviours", null, [
        { match: "exact", pattern: "Lore Book", behaviour: "book" },
      ]);
      set("itemRules", "use", null, {
        ...d.itemRules.use,
        skillBooks: [
          {
            match: "exact",
            pattern: "Lore Book",
            skill: "Lore",
            xp: [{ op: "set", value: 150 }],
          },
        ],
      });
      set("bindings", "start", null, { hp: 20, sp: 20, bag: [{ item: "Lore Book", qty: 1 }] });
      // A section the Minimal pack leaves out can be added: the slot machine's game.
      set("casino", "slots", null, classic.casino.slots);
      // Its sounds are named now, and the Minimal pack has none: the operator uploads them
      // (issue #29, stage 7), or the publish is refused rather than leaving the casino silent.
      expect(svc.check().map((p) => p.message)).toEqual([
        "the sound SlotMachine has no file, so the casino would be silent",
        "the sound cash has no file, so the casino would be silent",
      ]);
      const wav = new Uint8Array([
        ...new TextEncoder().encode("RIFF"),
        36,
        0,
        0,
        0,
        ...new TextEncoder().encode("WAVEfmt "),
      ]);
      server.db
        .query(
          "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
        )
        .run(ADMIN.accountId, "admin");
      const up = svc.upload(svc.uploadTicket(ADMIN), "sound", wav);
      if (!up.body.ok) {
        throw new Error(up.body.error);
      }
      for (const name of ["SlotMachine", "cash"]) {
        const r = svc.draftSound(ADMIN, {
          op: "set",
          name,
          file: up.body.file,
          format: "wav",
          expect: null,
        });
        expect(r.ok).toBe(true);
      }
      expect(svc.check()).toEqual([]);
      const published = svc.publish(ADMIN, svc.draftRev(), "Lore", server.game.contentWorld);
      expect(published.ok ? "ok" : published.error).toBe("ok");
      expect(content().classes.skills.map((s) => s.skill)).toEqual(["Fighting", "Lore"]);
      expect(content().casino.slots).toEqual(classic.casino.slots as never);

      const g = server.game;
      const made = await g.create({
        t: "create",
        name: "Nova",
        password: "pw",
        sex: 2,
        head: 2,
        classCode: 1,
        str: 11,
        sta: 11,
        int: 11,
        wis: 11,
        dex: 11,
      });
      expect(made).toEqual({ ok: true });
      const l = await g.login("Nova", "pw");
      if (!l.ok) {
        throw new Error(l.text);
      }
      g.enter(l.characterId, false);
      g.intent(l.characterId, { t: "mapReady" });
      const nova = () => {
        const p = g.world.players.get(l.characterId);
        if (!p) {
          throw new Error("Nova is not online");
        }
        return p;
      };
      expect([nova().map.name, nova().x, nova().y]).toEqual(["x0y0", 1, 1]);
      expect(nova().char.bag[0]).toEqual({ item: "Lore Book", qty: 1 });

      // Walk two tiles east on the grass.
      g.intent(l.characterId, { t: "step", seq: 1, dir: "R", turn: false });
      server.tickNow(20);
      g.intent(l.characterId, { t: "step", seq: 2, dir: "R", turn: false });
      server.tickNow(20);
      expect([nova().map.name, nova().x, nova().y]).toEqual(["x0y0", 3, 1]);

      // Read the book: 150 XP on a total curve of 0, 100, 250 is level 2, and the book is used up.
      const lore = skillIndex("Lore") as number;
      expect(nova().char.skills[lore]).toBe(1);
      g.intent(l.characterId, { t: "use", slot: 1 });
      server.tickNow(2);
      expect(nova().char.skills[lore]).toBe(2);
      expect(nova().char.bag[0]).toBeNull();
      g.saveAll();
      expect(
        server.db.query("SELECT skill, value, xp FROM character_skills WHERE skill = 'Lore'").all(),
      ).toEqual([{ skill: "Lore", value: 2, xp: 150 }]);
    } finally {
      await server.stop();
    }
  });

  test("SSO_CONTENT is read only when the database is created", async () => {
    const first = start("minimal");
    await first.server.stop();
    // Started again with another choice: the world stays as it was created.
    const again = startServer({
      dbPath: first.dbPath,
      port: 0,
      development: false,
      clientDir: join(first.dbPath, "..", "client"),
      autoTick: false,
      content: "classic",
      onLag: () => {},
    });
    try {
      expect(again.content.installedPacks().map((p) => p.id)).toEqual(["minimal"]);
      expect(logged).toContain(
        "SSO_CONTENT=classic ignored: this world was created with minimal (the variable is read only when the server creates its database; see docs/running-a-server.md)",
      );
    } finally {
      await again.stop();
    }
  });

  test("a creation a crash interrupted resumes with the pack it chose", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-minimal-"));
    dirs.push(dir);
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>x</title>");
    const dbPath = join(dir, "world.sqlite");
    // The choice is recorded and the migrations run, then the process stops before the seed.
    const db = openDatabase(dbPath);
    expect(worldToCreate(db, "minimal", RELEASE_PACK_DIRS)).toBe("minimal");
    migrate(db);
    db.close(true);
    // Started again with no choice at all: the world is still created with Minimal.
    const server = startServer({
      dbPath,
      port: 0,
      development: false,
      clientDir: dir,
      autoTick: false,
      onLag: () => {},
    });
    try {
      expect(server.content.installedPacks().map((p) => p.id)).toEqual(["minimal"]);
      expect(server.game.settings.startPoint).toEqual({ map: "x0y0", x: 1, y: 1 });
      expect(worldToCreate(server.db, "classic", RELEASE_PACK_DIRS)).toBeNull();
    } finally {
      await server.stop();
    }
  });

  test("an unknown SSO_CONTENT refuses a new world, and is only logged for an established one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-minimal-"));
    dirs.push(dir);
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>x</title>");
    const dbPath = join(dir, "world.sqlite");
    const opts = { dbPath, port: 0, development: false, clientDir: dir, autoTick: false };
    expect(() => startServer({ ...opts, content: "minmal" })).toThrow(ContentChoiceError);
    // Nothing was made: the next start creates the world it is asked for.
    const made = startServer({ ...opts, content: "minimal", onLag: () => {} });
    await made.stop();
    const again = startServer({ ...opts, content: "minmal", onLag: () => {} });
    try {
      expect(again.content.installedPacks().map((p) => p.id)).toEqual(["minimal"]);
      expect(logged.some((l) => l.startsWith("SSO_CONTENT=minmal ignored"))).toBe(true);
    } finally {
      await again.stop();
    }
  });

  test("a vehicle row in use is taken out only with its cleanup; a rider of a vehicle no row has lands at login (issue #44)", async () => {
    const { server } = start(undefined);
    try {
      const g = server.game;
      for (const name of ["Sailor", "Rafter"]) {
        await g.create({
          t: "create",
          name,
          password: "pw",
          sex: 1,
          head: 1,
          classCode: 1,
          str: 11,
          sta: 11,
          int: 11,
          wis: 11,
          dex: 11,
        });
      }
      server.db.run("UPDATE characters SET vehicle = 'Boat', hull = 40 WHERE name = 'Sailor'");
      const svc = server.content;
      // Taken out by hand, not with Remove's cleanup: refused while someone rides it.
      for (const ref of [
        { dataset: "houses", part: "vehicles", key: "Boat" },
        { dataset: "houses", part: "deeds", key: "Boat Deed" },
      ] as const) {
        expect(svc.draftSet(ADMIN, ref, "remove", null).ok).toBe(true);
      }
      const refused = svc.publish(ADMIN, svc.draftRev(), "No boats", g.contentWorld);
      expect(refused.ok).toBe(false);
      expect(refused.ok ? [] : (refused.problems ?? []).map((p) => p.message)).toContain(
        "the Boat is in use (1 aboard, 0 parked): take it out with Remove on its row, which lands or switches them",
      );
      // With Remove's cleanup, the same removal publishes and lands the rider.
      for (const ref of [
        { dataset: "houses", part: "vehicles", key: "Boat" },
        { dataset: "houses", part: "deeds", key: "Boat Deed" },
      ] as const) {
        expect(svc.draftDiscard(ref).ok).toBe(true);
      }
      const removal = svc.draftRemoval(
        ADMIN,
        { kind: "vehicle", key: "Boat", content: "remove", riders: "land", replacement: null },
        g.contentWorld,
      );
      expect(removal.ok).toBe(true);
      const done = svc.publish(ADMIN, svc.draftRev(), "No boats", g.contentWorld);
      expect(done.ok ? "ok" : done.error).toBe("ok");
      expect(server.db.query("SELECT vehicle FROM characters WHERE name = 'Sailor'").get()).toEqual(
        { vehicle: null },
      );
      // A vehicle no row has (a release pack that dropped it, a database edit): listed, and its
      // rider lands where they are at their next login, logged.
      server.db.run("UPDATE characters SET vehicle = 'Raft', hull = 9 WHERE name = 'Rafter'");
      expect(g.contentWorld.problems().filter((p) => p.where === "world/riders")).toEqual([
        {
          where: "world/riders",
          message:
            '"Raft" is not a vehicle: ridden by Rafter. They ride as nothing and land where they are when they next log in.',
        },
      ]);
      const l = await g.login("Rafter", "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      g.enter(l.characterId, false, "10.0.0.1");
      const rafter = g.world.players.get(l.characterId);
      expect([rafter?.vehicle, rafter?.hull, rafter?.spell.body]).toEqual([null, null, null]);
      g.tick();
      expect(
        server.db
          .query(
            "SELECT item, qty, details FROM activity_log WHERE character = 'Rafter' AND type = 'admin'",
          )
          .get(),
      ).toEqual({
        item: "Raft",
        qty: 0,
        details: JSON.stringify({ placed: -1, landed: "no such vehicle" }),
      });
    } finally {
      await server.stop();
    }
  });

  test("a new database with no choice is a Classic world, as before", async () => {
    const { server } = start(undefined);
    try {
      expect(server.content.installedPacks().map((p) => p.id)).toEqual(["classic"]);
      expect(server.game.settings.startPoint).toEqual({ map: "x1000y992", x: 6, y: 4 });
      expect(server.game.settings.jailPoint).toEqual({ map: "x0y0", x: 4, y: 4 });
    } finally {
      await server.stop();
    }
  });
});
