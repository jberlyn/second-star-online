/**
 * A third guild hall made from the Control Panel (issue #10): a house type, its deed item and deed
 * row are content, and its placement preview is an upload the House types form saves with the
 * type (`ghost.picture`). Published, the preview is served in the items atlas, it counts as in use,
 * and the hall builds like the two Classic ones.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRgba, encodePng } from "@secondstaronline/data/art";
import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  installContent,
  type ServerMsg,
} from "@secondstaronline/shared";

import { usedArt } from "../src/content/art-usage.ts";
import { contentIntent } from "../src/content/page.ts";
import type { ContentActor } from "../src/content/service.ts";
import { createGame } from "../src/game.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadGround } from "../src/persistence/ground.ts";
import { loadHouses } from "../src/persistence/houses.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { manualClock } from "./helpers/manual-clock.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { rngByN } from "./helpers/sim.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const HALL = "Stone Guild Hall";
const DEED = "Stone Guild Hall Deed";
const PREVIEW = "Stone Guild Hall (placement)";

/** A 96×128 preview: a grey hall, a roof row above its 3×3 footprint. */
function preview(): Uint8Array {
  const img = createRgba(96, 128);
  for (let y = 8; y < 128; y++) {
    for (let x = 0; x < 96; x++) {
      img.data.set([120, 120, 128, 255], (y * 96 + x) * 4);
    }
  }
  return encodePng(img);
}

/** The Stone Guild Hall's rows: the Small Guild Hall with an Anvil, its deed and its deed item. */
function stoneHallRows(data: ContentData) {
  const small = data.houses.types.find((t) => t.house === "Small Guild Hall");
  if (!small) {
    throw new Error("Classic has no Small Guild Hall");
  }
  return {
    type: {
      ...structuredClone(small),
      house: HALL,
      deed: DEED,
      interiorItems: [...small.interiorItems, { item: "Anvil", x: 6, y: 2 }],
    },
    deed: { deed: DEED, use: "place" as const, house: HALL, text: null },
    item: { name: DEED, sprite: "Small Guild Hall Deed" },
  };
}

describe("a third guild hall on a running server", () => {
  const dirs: string[] = [];
  let logSpy: ReturnType<typeof spyOn> | null = null;
  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy?.mockRestore();
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
    installContent(buildContentStore(classicData));
  });

  function start(): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-house-art-"));
    dirs.push(dir);
    const clientDir = join(dir, "client");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
    const server = startServer({
      dbPath: join(dir, "world.sqlite"),
      port: 0,
      development: false,
      clientDir,
      clock: manualClock(),
      autoTick: false,
      isoNow: () => "2026-11-26T00:00:00.000Z",
      rng: { random: (n) => (n >= 1 ? 1 : 0) },
      onLag: () => {},
    });
    server.db
      .query(
        "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
      )
      .run(ADMIN.accountId, "admin");
    return server;
  }

  /** Puts the hall's type, deed and deed item in the draft. */
  function draftHall(server: RunningServer): void {
    const rows = stoneHallRows(server.content.draftContent());
    const set = (dataset: string, part: string, key: string, data: unknown) =>
      expect(server.content.draftSet(ADMIN, { dataset, part, key } as never, "set", data).ok).toBe(
        true,
      );
    set("items", "items", DEED, rows.item);
    set("houses", "types", HALL, rows.type);
    set("houses", "deeds", DEED, rows.deed);
  }

  function upload(server: RunningServer): string {
    const up = server.content.upload(server.content.uploadTicket(ADMIN), "image", preview());
    if (!up.body.ok) {
      throw new Error(up.body.error);
    }
    return up.body.file;
  }

  test("its placement preview is saved with the type, served in the items atlas and kept in use", async () => {
    const server = start();
    try {
      draftHall(server);
      const file = upload(server);
      // Before it has one, the picker's view shows the hall with its built-in member.
      const before = contentIntent(server.content, ADMIN, { t: "contentItemArt", seq: 1 });
      if (before.t !== "contentItemArt") {
        throw new Error(before.t);
      }
      expect(before.view.houseTypes?.find((t) => t.house === HALL)).toEqual({
        house: HALL,
        footprint: { w: 3, h: 3 },
        member: 3,
      });

      const r = server.content.draftPicture(ADMIN, {
        op: "house",
        house: "stone guild hall",
        art: { file, regX: 0, regY: 32, transparency: "alpha" },
      });
      expect(r).toEqual({ ok: true, value: `${HALL}'s placement preview is in the draft.` });
      const d = server.content.draftContent();
      expect(d.houses.types.find((t) => t.house === HALL)?.ghost.picture).toBe(PREVIEW);
      expect(d.art.items.find((a) => a.name === PREVIEW)).toEqual({
        name: PREVIEW,
        file,
        regX: 0,
        regY: 32,
      });
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "stone hall").ok).toBe(true);

      const index = (await (await fetch(new URL("/assets/index.json", server.url))).json()) as {
        atlases: { items: { sheets: string[]; sprites: Record<string, number[]> } };
      };
      const sprite = index.atlases.items.sprites[PREVIEW.toLowerCase()] as number[];
      expect(index.atlases.items.sheets[sprite[0] as number]).toMatch(/^operator\/items-/);
      // Trimmed to its visible pixels: the anchor moves up by the 8 see-through rows.
      expect(sprite.slice(3, 7)).toEqual([96, 120, 0, 24]);

      // Taking the upload out on its own would leave the hall's preview with nothing to draw.
      server.content.draftSet(
        ADMIN,
        { dataset: "art", part: "items", key: PREVIEW },
        "remove",
        null,
      );
      expect(server.content.check()).toContainEqual({
        where: "art/items",
        message: `removing the picture ${PREVIEW.toLowerCase()} leaves the ${HALL}'s placement preview with nothing to draw`,
      });
      // Taking the preview out on the form as well goes back to the built-in picture.
      expect(server.content.draftPicture(ADMIN, { op: "house", house: HALL, art: null }).ok).toBe(
        true,
      );
      expect(server.content.check()).toEqual([]);
      const after = server.content.draftContent();
      expect(after.houses.types.find((t) => t.house === HALL)?.ghost.picture).toBeUndefined();
      expect(after.art.items.some((a) => a.name === PREVIEW)).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("a house type's preview counts as a picture in use", () => {
    const d = structuredClone(classicData) as ContentData;
    const rows = stoneHallRows(d);
    d.houses.types.push({ ...rows.type, ghost: { ...rows.type.ghost, picture: PREVIEW } });
    expect(usedArt(d).sprites.items.get(PREVIEW.toLowerCase())).toBe(
      `the ${HALL}'s placement preview`,
    );
  });
});

describe("building a third guild hall", () => {
  let db: Db;
  let sent: { to: string; msg: ServerMsg }[];
  const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    prepareScenarioMap(db);
    sent = [];
    db.run("UPDATE maps SET layer1 = ?", [
      JSON.stringify(Array.from({ length: 12 }, () => ROW_8R)),
    ]);
    const d = structuredClone(classicData) as ContentData;
    const rows = stoneHallRows(d);
    d.items.items.push(rows.item);
    d.houses.types.push({ ...rows.type, ghost: { ...rows.type.ghost, picture: PREVIEW } });
    d.houses.deeds.push(rows.deed);
    installContent(buildContentStore(d));
  });
  afterEach(() => {
    installContent(buildContentStore(classicData));
  });

  test("a guild member places it from its deed and gets its interior with the Anvil", async () => {
    const now = "2026-11-26T00:00:00.000Z";
    const g = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => now,
      rng: rngByN(),
      minute: () => 0,
    });
    const make = async (name: string) => {
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
      const l = await g.login(name, "pw");
      if (!l.ok) {
        throw new Error(l.text);
      }
      return l.characterId;
    };
    const al = await make("Al");
    g.enter(al, false);
    g.intent(al, { t: "mapReady" });
    const p = g.world.players.get(al);
    if (p) {
      p.guildScreen = true;
      p.keyLock = true;
    }
    g.intent(al, { t: "guildCreate", name: "Masons", alignment: "G" });
    if (p) {
      p.char.bag[2] = { item: DEED, qty: 1 };
    }
    g.intent(al, { t: "use", slot: 3 });
    expect(sent.some((m) => m.msg.t === "placing" && m.msg.house === HALL)).toBe(true);
    g.intent(al, { t: "placeHouse", slot: 3, x: 10, y: 4 });

    const interior = findMapByCoords(db, 1000, 992, 1);
    expect(interior?.title).toBe("Hall of the Masons");
    expect(loadGround(db, interior?.id ?? "", now).map((x) => x.item)).toEqual([
      "Exit",
      "The Masons's Door",
      "The Masons's Guild Vault",
      "The Masons's Board",
      "Anvil",
    ]);
    expect(loadHouses(db)).toMatchObject([{ ownerName: "Al", interior: "xH11000yH1992" }]);
  });
});
