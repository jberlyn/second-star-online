/**
 * Art and sounds a pack carries as rows (issue #29, stage 8): `data/art.json` names files in the
 * pack's `files/` folder by content hash. The rows draw as a layer of that pack's art (over its
 * built atlases, under the operator's uploads); an operator upload of the same name replaces one,
 * and taking the upload out brings the pack's back. A pack file whose content does not match its
 * name is never drawn: its row is skipped and listed on the Content problems page, and publishing
 * still works. The upload sweep never touches a pack's files.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import { createRgba, encodePng } from "@secondstaronline/data/art";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { artRowFingerprint } from "@secondstaronline/shared";

import { ArtLibrary } from "../src/content/art.ts";
import { readPackDir } from "../src/content/packs.ts";
import { mergePackArt, packArtLayers } from "../src/content/served-assets.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import {
  artFilesDir,
  diskArtFiles,
  memoryArtFiles,
  packArtFileReader,
  sha256,
  sweepArtFiles,
} from "../src/persistence/art-files.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** A 16×16 picture filled with one colour, so two pictures have different files. */
function picture(r: number): Uint8Array {
  const img = createRgba(16, 16);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data.set([r, 40, 90, 255], i);
  }
  return encodePng(img);
}

/** The opening bytes of a WAV file (all the server's check reads), with a byte to tell copies apart. */
const wav = (tag = 0) =>
  new Uint8Array([
    ...new TextEncoder().encode("RIFF"),
    36,
    0,
    0,
    0,
    ...new TextEncoder().encode("WAVEfmt "),
    tag,
  ]);

interface Index {
  atlases: Record<string, { sheets: string[]; sprites: Record<string, number[]> }>;
  sounds: Record<string, string>;
}

describe("a pack's art rows", () => {
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
  });

  const PICTURE = picture(200);
  const SOUND = wav(7);
  const DAMAGED = picture(10);

  /**
   * A copy of the Minimal pack carrying an item picture (`Gold`), a sound (`hitsound`, which
   * Minimal itself lacks) and, with `damaged`, a picture whose file does not match its name.
   */
  function packWithArt(damaged = false): string {
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-art-"));
    dirs.push(dir);
    cpSync(RELEASE_PACK_DIRS.minimal as string, dir, { recursive: true });
    const files = join(dir, "files");
    mkdirSync(join(files, "art"), { recursive: true });
    mkdirSync(join(files, "sounds"), { recursive: true });
    writeFileSync(join(files, "art", `${sha256(PICTURE)}.png`), PICTURE);
    writeFileSync(join(files, "sounds", `${sha256(SOUND)}.wav`), SOUND);
    const items = [{ name: "Gold", file: sha256(PICTURE), regX: 8, regY: 8 }];
    if (damaged) {
      // Named for one picture, holding another.
      const claimed = sha256(picture(11));
      writeFileSync(join(files, "art", `${claimed}.png`), DAMAGED);
      items.push({ name: "Lantern", file: claimed, regX: 8, regY: 8 });
    }
    writeFileSync(
      join(dir, "data", "art.json"),
      JSON.stringify({
        items,
        paperdoll: [],
        bodies: [],
        fx: [],
        tiles: [],
        sounds: [{ name: "hitsound", file: sha256(SOUND), format: "wav" }],
      }),
    );
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...m, files: "files" }));
    return dir;
  }

  function start(pack: string): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-art-world-"));
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
      isoNow: () => "2026-11-24T00:00:00.000Z",
      rng: { random: (n) => (n >= 1 ? 1 : 0) },
      onLag: () => {},
      content: "minimal",
      releasePacks: { ...RELEASE_PACK_DIRS, minimal: pack },
    });
    server.db
      .query(
        "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
      )
      .run(ADMIN.accountId, "admin");
    return server;
  }

  const index = async (server: RunningServer): Promise<Index> =>
    (await (await fetch(new URL("/assets/index.json", server.url))).json()) as Index;

  /** The URL of the sheet a sprite is drawn from. */
  const sheetOf = (ix: Index, group: string, name: string): string => {
    const atlas = ix.atlases[group] as Index["atlases"][string];
    const sprite = atlas.sprites[name] as number[];
    return atlas.sheets[sprite[0] as number] as string;
  };

  const publish = (server: RunningServer) => {
    const r = server.content.publish(ADMIN, server.content.draftRev(), "");
    if (!r.ok) {
      throw new Error(r.error);
    }
  };

  test("the pack format reads its files folder", () => {
    const pack = readPackDir(packWithArt());
    expect(pack.filesDir).toBe(join(dirs[0] as string, "files"));
    expect(pack.data.art?.items.map((i) => i.name)).toEqual(["Gold"]);
  });

  test("its rows draw as the pack's art, an upload replaces one, and taking it out brings it back", async () => {
    const server = start(packWithArt());
    try {
      let ix = await index(server);
      // The pack's picture, served from its own built layer.
      const packSheet = sheetOf(ix, "items", "gold");
      expect(packSheet).toStartWith("operator/packs/minimal/items-");
      const sheet = await fetch(new URL(`/assets/${packSheet}`, server.url));
      expect(sheet.status).toBe(200);
      expect(sheet.headers.get("content-type")).toBe("image/png");
      // Its sound, served from the pack's files folder.
      expect(ix.sounds.hitsound).toBe(`operator/packs/minimal/sounds/${sha256(SOUND)}.wav`);
      const sound = await fetch(new URL(`/assets/${ix.sounds.hitsound}`, server.url));
      expect(new Uint8Array(await sound.arrayBuffer())).toEqual(SOUND);
      // Hit rects come with it, and the store's own art (the operator's uploads) is empty.
      expect(server.content.publishedContent().rects.items.gold).toBeDefined();
      expect(server.content.publishedContent().art.items).toEqual([]);
      // The Sounds section says it comes from the pack, not an upload.
      const sounds = server.content.soundArtView();
      expect(sounds.art).toEqual([]);
      expect(sounds.packSounds.hitsound).toBe(
        `/assets/operator/packs/minimal/sounds/${sha256(SOUND)}.wav`,
      );

      // An operator upload of the same name replaces the pack's picture…
      const up = server.content.upload(server.content.uploadTicket(ADMIN), "image", picture(90));
      if (!up.body.ok) {
        throw new Error(up.body.error);
      }
      const ref = { dataset: "art" as const, part: "items", key: "Gold" };
      server.content.draftSet(ADMIN, ref, "set", {
        name: "Gold",
        file: up.body.file,
        regX: 8,
        regY: 8,
      });
      publish(server);
      ix = await index(server);
      expect(sheetOf(ix, "items", "gold")).toMatch(/^operator\/items-/);

      // …and taking the upload out brings the pack's back (nothing is lost: the pack draws it).
      server.content.draftSet(ADMIN, ref, "remove", null);
      publish(server);
      ix = await index(server);
      expect(sheetOf(ix, "items", "gold")).toBe(packSheet);
    } finally {
      await server.stop();
    }
  });

  test("an upload row may name a file only the pack carries", async () => {
    const server = start(packWithArt());
    try {
      server.content.draftSet(ADMIN, { dataset: "art", part: "items", key: "Torch" }, "set", {
        name: "Torch",
        file: sha256(PICTURE),
        regX: 8,
        regY: 8,
      });
      expect(server.content.check()).toEqual([]);
      publish(server);
      expect(sheetOf(await index(server), "items", "torch")).toMatch(/^operator\/items-/);
    } finally {
      await server.stop();
    }
  });

  test("a damaged file is never drawn: its row is skipped and listed, and publishing still works", async () => {
    const server = start(packWithArt(true));
    try {
      const ix = await index(server);
      expect(ix.atlases.items?.sprites.lantern).toBeUndefined();
      // The good row still draws.
      expect(ix.atlases.items?.sprites.gold).toBeDefined();
      const problems = server.content.problems().content;
      expect(problems).toContainEqual({
        where: "pack Minimal: art/items/Lantern",
        message: expect.stringContaining("does not match its name: the pack is damaged"),
      });
      // The operator can't fix a pack's files, so they never stand in the way of a publish.
      const up = server.content.upload(server.content.uploadTicket(ADMIN), "image", picture(91));
      if (!up.body.ok) {
        throw new Error(up.body.error);
      }
      server.content.draftSet(ADMIN, { dataset: "art", part: "items", key: "Torch" }, "set", {
        name: "Torch",
        file: up.body.file,
        regX: 8,
        regY: 8,
      });
      expect(server.content.check()).toEqual([]);
      publish(server);
    } finally {
      await server.stop();
    }
  });

  test("the upload sweep leaves a pack's files alone", async () => {
    const pack = packWithArt();
    const server = start(pack);
    try {
      // The world's own upload store, long after any grace period.
      const files = diskArtFiles(artFilesDir(join(dirs[1] as string, "world.sqlite")));
      sweepArtFiles(server.db, files, Date.now() + 10 * 365 * 24 * 3600 * 1000);
      expect(existsSync(join(pack, "files", "art", `${sha256(PICTURE)}.png`))).toBe(true);
      expect(existsSync(join(pack, "files", "sounds", `${sha256(SOUND)}.wav`))).toBe(true);
    } finally {
      await server.stop();
    }
  });
});

/** A pack folder holding only art rows and their files (a pack may leave every other dataset out). */
function artPack(
  dirs: string[],
  id: string,
  art: Record<string, unknown[]>,
  files: Record<string, Uint8Array>,
  withFolder = true,
): string {
  const dir = mkdtempSync(join(tmpdir(), `sso-${id}-`));
  dirs.push(dir);
  mkdirSync(join(dir, "data"));
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, "files", rel.split("/")[0] as string), { recursive: true });
    writeFileSync(join(dir, "files", rel), bytes);
  }
  writeFileSync(
    join(dir, "data", "art.json"),
    JSON.stringify({ items: [], paperdoll: [], bodies: [], fx: [], tiles: [], sounds: [], ...art }),
  );
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id,
      name: id[0]?.toUpperCase() + id.slice(1),
      version: "1.0.0",
      format: 1,
      sso: "1.10",
      contentHash: "0000000000000000",
      ...(withFolder ? { files: "files" } : {}),
    }),
  );
  return dir;
}

/** A Classic world with `extra` installed too, before Classic (`first`) or after it. */
function withExtra(dir: string, first: boolean, art = new ArtLibrary(memoryArtFiles())) {
  const db = openDatabase();
  migrate(db);
  if (first) {
    db.query("UPDATE content_packs SET position = 1 WHERE id = 'classic'").run();
  }
  db.query(
    "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('extra', 'Extra', '1.0.0', ?, 'release', NULL, 'now')",
  ).run(first ? 0 : 1);
  const service = new ContentService({
    db,
    now: () => "2026-11-24T00:00:00.000Z",
    releasePacks: { ...RELEASE_PACK_DIRS, extra: dir },
    art,
  });
  return { db, service, art };
}

/** The packs' art as the served index merges it. */
const drawnBy = (service: ContentService) =>
  mergePackArt(
    { version: 1, atlases: {}, sounds: {} } as unknown as AssetIndex,
    packArtLayers(service.installedPacks(), service.packRowArt()),
  );

describe("pack art rows among several packs", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });
  const PIC = picture(120);

  test("hit rects follow the draw order: a later pack's own sprite wins over an earlier pack's row", () => {
    const dir = artPack(
      dirs,
      "extra",
      { items: [{ name: "Airship Deed", file: sha256(PIC), regX: 3, regY: 5 }] },
      { [`art/${sha256(PIC)}.png`]: PIC },
    );
    const { service } = withExtra(dir, true);
    const classic = readPackDir(RELEASE_PACK_DIRS.classic as string).data.rects?.items[
      "airship deed"
    ];
    // Classic comes after the extra pack, so its own picture is drawn, and hit.
    expect(drawnBy(service).atlases.items?.sprites["airship deed"]?.[0]).toBe(
      (drawnBy(service).atlases.items?.sheets ?? []).findIndex((s) =>
        s.startsWith("packs/classic/"),
      ),
    );
    expect(service.packContent().rects.items["airship deed"]).toEqual(classic as never);
  });

  test("a later pack's uploaded run is whole: the earlier pack's frames after its last are neither drawn nor hit", () => {
    const one = picture(130);
    const two = picture(131);
    const dir = artPack(
      dirs,
      "extra",
      {
        fx: [
          {
            name: "Crush",
            frames: [
              { file: sha256(one), regX: 1, regY: 2 },
              { file: sha256(two), regX: 3, regY: 4 },
            ],
          },
        ],
      },
      { [`art/${sha256(one)}.png`]: one, [`art/${sha256(two)}.png`]: two },
    );
    const { service } = withExtra(dir, false);
    const rects = service.packContent().rects.fx;
    // Trimmed to the 16×16 picture's visible pixels, anchored where the row says.
    expect(rects["crush-1"]).toEqual([16, 16, 1, 2]);
    expect(rects["crush-2"]).toEqual([16, 16, 3, 4]);
    expect(rects["crush-3"]).toBeUndefined();
    expect(rects["crush-30"]).toBeUndefined();
    const sprites = drawnBy(service).atlases.fx?.sprites ?? {};
    expect(sprites["crush-2"]).toBeDefined();
    expect(sprites["crush-3"]).toBeUndefined();
    // The Spell effects section counts what is drawn: two frames, not Classic's thirty.
    expect(service.fxArtView().packRuns.crush?.frames).toBe(2);
  });

  test("names like constructor and __proto__ are a pack's own layer and run", () => {
    const dir = artPack(
      dirs,
      "extra",
      {
        paperdoll: [{ name: "constructor", frames: { "f1-s": { file: sha256(PIC) } } }],
        fx: [{ name: "__proto__", frames: [{ file: sha256(PIC), regX: 0, regY: 0 }] }],
      },
      { [`art/${sha256(PIC)}.png`]: PIC },
    );
    const { service } = withExtra(dir, false);
    const worn = service.wornArtView();
    expect(Object.hasOwn(worn.packLayers, "constructor")).toBe(true);
    expect(Object.entries(worn.packLayers).find(([k]) => k === "constructor")?.[1]).toEqual([
      "f1-s",
    ]);
    const fx = service.fxArtView();
    expect(Object.hasOwn(fx.packRuns, "__proto__")).toBe(true);
    expect(JSON.parse(JSON.stringify(fx.packRuns)).__proto__).toEqual({ frames: 1, trail: 0 });
  });

  test("a row with one bad frame is left out whole, so the pack under it still shows", () => {
    const good = picture(140);
    const dir = artPack(
      dirs,
      "extra",
      {
        fx: [
          {
            name: "Crush",
            frames: [
              { file: sha256(good), regX: 0, regY: 0 },
              { file: sha256(picture(141)), regX: 0, regY: 0 },
            ],
          },
        ],
      },
      // Frame 2's file is missing.
      { [`art/${sha256(good)}.png`]: good },
    );
    const { service } = withExtra(dir, false);
    const sheets = drawnBy(service).atlases.fx?.sheets ?? [];
    const crush1 = drawnBy(service).atlases.fx?.sprites["crush-1"];
    expect(sheets[crush1?.[0] as number]).toStartWith("packs/classic/");
    expect(drawnBy(service).atlases.fx?.sprites["crush-30"]).toBeDefined();
    expect(service.packContent().rects.fx["crush-30"]).toBeDefined();
    expect(service.problems().content.map((p) => p.where)).toContain("pack Extra: art/fx/Crush");
  });

  test("each pack's rows read only its own files", () => {
    const pic = picture(150);
    // Extra names a file it does not carry; the upload store has it, but extra declares a folder.
    const dir = artPack(
      dirs,
      "extra",
      { items: [{ name: "Shell", file: sha256(pic), regX: 0, regY: 0 }] },
      {},
    );
    const store = memoryArtFiles();
    store.put("art", "png", pic);
    const { service } = withExtra(dir, false, new ArtLibrary(store));
    expect(drawnBy(service).atlases.items?.sprites.shell).toBeUndefined();
    expect(service.problems().content.map((p) => p.where)).toContain("pack Extra: art/items/Shell");
  });

  test("an operator row naming a file only a pack carries keeps it in the upload store", () => {
    const dir = artPack(
      dirs,
      "extra",
      { items: [{ name: "Shell", file: sha256(PIC), regX: 0, regY: 0 }] },
      { [`art/${sha256(PIC)}.png`]: PIC },
    );
    const store = memoryArtFiles();
    const { service } = withExtra(dir, false, new ArtLibrary(store));
    const r = service.draftSet(ADMIN, { dataset: "art", part: "items", key: "Pearl" }, "set", {
      name: "Pearl",
      file: sha256(PIC),
      regX: 0,
      regY: 0,
    });
    expect(r.ok).toBe(true);
    // A later pack version may drop the file: the row keeps its own copy.
    expect(store.read("art", sha256(PIC), "png")).toEqual(PIC);
  });

  test("the sweep keeps upload-store files a folder pack's rows name", () => {
    // A pack with no files folder reads its rows' files from the upload store.
    const sound = wav(9);
    const dir = artPack(
      dirs,
      "extra",
      { sounds: [{ name: "plink", file: sha256(sound), format: "wav" }] },
      {},
      false,
    );
    const store = memoryArtFiles(() => 0);
    store.put("sounds", "wav", sound);
    const { db, service } = withExtra(dir, false, new ArtLibrary(store));
    expect(service.soundArtView().packSounds.plink).toBeDefined();
    const later = 10 * 24 * 3600 * 1000;
    expect(sweepArtFiles(db, store, later, service.packRowHashes())).toBe(0);
    expect(store.read("sounds", sha256(sound), "wav")).toEqual(sound);
    // Without the pack's hashes it would have gone.
    expect(sweepArtFiles(db, store, later)).toBe(1);
  });
});

describe("reading a pack's files", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });
  const PIC = picture(160);

  function folder(): string {
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-files-"));
    dirs.push(dir);
    mkdirSync(join(dir, "files", "art"), { recursive: true });
    return join(dir, "files");
  }

  test("only declared hashes are looked up", () => {
    const files = folder();
    writeFileSync(join(files, "art", `${sha256(PIC)}.png`), PIC);
    const read = packArtFileReader(files, "Extra", new Set(), 1 << 20);
    expect(read("art", sha256(PIC), "png")).toBeNull();
    const declared = packArtFileReader(files, "Extra", new Set([sha256(PIC)]), 1 << 20);
    expect(declared("art", sha256(PIC), "png")).toEqual(PIC);
  });

  test("a link out of the pack, a folder or an oversized file is refused, not followed", () => {
    const files = folder();
    const outside = mkdtempSync(join(tmpdir(), "sso-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "x.png"), PIC);
    symlinkSync(join(outside, "x.png"), join(files, "art", `${sha256(PIC)}.png`));
    const big = picture(161);
    writeFileSync(join(files, "art", `${sha256(big)}.png`), big);
    const dirHash = sha256(picture(162));
    mkdirSync(join(files, "art", `${dirHash}.png`));
    const read = packArtFileReader(
      files,
      "Extra",
      new Set([sha256(PIC), sha256(big), dirHash]),
      big.length - 1,
    );
    expect(read("art", sha256(PIC), "png")).toContain("is a link out of the pack");
    expect(read("art", sha256(big), "png")).toContain("is over");
    expect(read("art", dirHash, "png")).toContain("is not a file");
  });

  test("a file replaced while the server runs is checked again before it is served", () => {
    const files = folder();
    const path = join(files, "art", `${sha256(PIC)}.png`);
    writeFileSync(path, PIC);
    const read = packArtFileReader(files, "Extra", new Set([sha256(PIC)]), 1 << 20);
    expect(read("art", sha256(PIC), "png")).toEqual(PIC);
    writeFileSync(path, picture(170));
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    expect(read("art", sha256(PIC), "png")).toContain("does not match its name");
  });
});

describe("pack art rows of every kind", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });
  const PIC = picture(180);
  const FRAMES = [
    "f1-n",
    "f1-e",
    "f1-s",
    "f1-w",
    "f2-n",
    "f2-e",
    "f2-s",
    "f2-w",
    "f3-n",
    "f3-e",
    "f3-s",
    "f3-w",
    "f4-n",
    "f4-e",
    "f4-s",
    "f4-w",
  ];

  test("a pack's body and tile are its own, and new numbers and codes go round them", () => {
    const dir = artPack(
      dirs,
      "extra",
      {
        bodies: [
          {
            name: "1000",
            frames: Object.fromEntries(
              FRAMES.map((f) => [f, { file: sha256(PIC), regX: 8, regY: 8 }]),
            ),
          },
        ],
        tiles: [{ code: "AA", file: sha256(picture32()) }],
      },
      { [`art/${sha256(PIC)}.png`]: PIC, [`art/${sha256(picture32())}.png`]: picture32() },
    );
    const { service } = withExtra(dir, false);
    const bodies = service.bodyArtView();
    expect(bodies.packBodies).toContain(1000);
    expect(bodies.art).toEqual([]);
    expect(bodies.next).toBe(1001);
    const tiles = service.tileArtView();
    expect(tiles.packTiles).toContain("aa");
    expect(tiles.art).toEqual([]);
    expect(tiles.next).not.toBe("AA");
    expect(service.problems().content).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ where: expect.stringContaining("pack") }),
      ]),
    );
  });

  test("sounds follow the draw order too", () => {
    const sound = wav(21);
    const files = { [`sounds/${sha256(sound)}.wav`]: sound };
    const rows = { sounds: [{ name: "bad", file: sha256(sound), format: "wav" }] };
    const after = withExtra(artPack(dirs, "extra", rows, files), false).service;
    expect(after.soundArtView().packSounds.bad).toStartWith("/assets/operator/packs/extra/sounds/");
    const before = withExtra(artPack(dirs, "extra", rows, files), true).service;
    expect(before.soundArtView().packSounds.bad).toStartWith("/assets/packs/classic/");
  });

  test("a missing file and a damaged one are told apart", () => {
    const damaged = sha256(picture(190));
    const dir = artPack(
      dirs,
      "extra",
      {
        items: [
          { name: "Gone", file: sha256(picture(191)), regX: 0, regY: 0 },
          { name: "Broken", file: damaged, regX: 0, regY: 0 },
        ],
      },
      { [`art/${damaged}.png`]: picture(192) },
    );
    const { service } = withExtra(dir, false);
    const byWhere = Object.fromEntries(service.problems().content.map((p) => [p.where, p.message]));
    expect(byWhere["pack Extra: art/items/Gone"]).toContain("its file is missing");
    expect(byWhere["pack Extra: art/items/Broken"]).toContain("does not match its name");
  });

  test("an imported pack's rows read their files from the upload store", () => {
    const store = memoryArtFiles();
    store.put("art", "png", PIC);
    const db = openDatabase();
    migrate(db);
    db.query(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('shared', 'Shared', '1.0.0', 1, 'imported', ?, 'now')",
    ).run(
      JSON.stringify({
        manifest: {
          id: "shared",
          name: "Shared",
          version: "1.0.0",
          format: 1,
          sso: "1.10",
          contentHash: "0000000000000000",
        },
        data: {
          art: {
            items: [{ name: "Shell", file: sha256(PIC), regX: 0, regY: 0 }],
            paperdoll: [],
            bodies: [],
            fx: [],
            tiles: [],
            sounds: [],
          },
        },
      }),
    );
    const service = new ContentService({
      db,
      now: () => "2026-11-24T00:00:00.000Z",
      releasePacks: RELEASE_PACK_DIRS,
      art: new ArtLibrary(store),
    });
    expect(drawnBy(service).atlases.items?.sprites.shell).toBeDefined();
    expect(service.packRowArt().map((r) => r.id)).toEqual(["shared"]);
  });

  test("a sound file only a pack carries can be given to another sound, and an override taken out", () => {
    const sound = wav(31);
    const dir = artPack(
      dirs,
      "extra",
      { sounds: [{ name: "plink", file: sha256(sound), format: "wav" }] },
      { [`sounds/${sha256(sound)}.wav`]: sound },
    );
    const store = memoryArtFiles();
    const { service } = withExtra(dir, false, new ArtLibrary(store));
    const reuse = service.draftSound(ADMIN, {
      op: "set",
      name: "plonk",
      file: sha256(sound),
      format: "wav",
      expect: null,
    });
    expect(reuse.ok).toBe(true);
    expect(store.read("sounds", sha256(sound), "wav")).toEqual(sound);
    // Override the pack's plink, publish, then take the override out: the pack's comes back.
    const mine = wav(32);
    store.put("sounds", "wav", mine);
    expect(
      service.draftSound(ADMIN, {
        op: "set",
        name: "plink",
        file: sha256(mine),
        format: "wav",
        expect: null,
      }).ok,
    ).toBe(true);
    expect(service.publish(ADMIN, service.draftRev(), "").ok).toBe(true);
    const own = service.soundArtView().art.find((a) => a.name === "plink");
    const out = service.draftSound(ADMIN, {
      op: "remove",
      name: "plink",
      expect: artRowFingerprint(own),
    });
    expect(out.ok).toBe(true);
    expect(service.check()).toEqual([]);
    expect(service.publish(ADMIN, service.draftRev(), "").ok).toBe(true);
    expect(service.soundArtView().packSounds.plink).toStartWith("/assets/operator/packs/extra/");
  });

  test("a pack update that changes or drops a row is picked up at the next start", () => {
    const one = picture(200);
    const two = picture(201);
    const dir = artPack(
      dirs,
      "extra",
      {
        items: [
          { name: "Shell", file: sha256(one), regX: 0, regY: 0 },
          { name: "Pearl", file: sha256(one), regX: 0, regY: 0 },
        ],
      },
      { [`art/${sha256(one)}.png`]: one, [`art/${sha256(two)}.png`]: two },
    );
    const { db } = withExtra(dir, false);
    writeFileSync(
      join(dir, "data", "art.json"),
      JSON.stringify({
        items: [{ name: "Shell", file: sha256(two), regX: 2, regY: 2 }],
        paperdoll: [],
        bodies: [],
        fx: [],
        tiles: [],
        sounds: [],
      }),
    );
    const again = new ContentService({
      db,
      now: () => "2026-11-24T00:00:00.000Z",
      releasePacks: { ...RELEASE_PACK_DIRS, extra: dir },
      art: new ArtLibrary(memoryArtFiles()),
    });
    const sprites = drawnBy(again).atlases.items?.sprites ?? {};
    expect(sprites.pearl).toBeUndefined();
    expect(sprites.shell?.[5]).toBe(2);
  });
});

/** A 32×32 tile picture. */
function picture32(): Uint8Array {
  const img = createRgba(32, 32);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data.set([20, 120, 20, 255], i);
  }
  return encodePng(img);
}
