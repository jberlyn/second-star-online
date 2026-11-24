/**
 * Uploaded art and sounds (issue #29, stage 1): an upload is checked and stored by its hash
 * beside the database; an `art` row naming it goes live with the draft's publish, built into the
 * operator's atlases (served under content-hashed URLs, merged over the packs' art) and into the
 * hit rects; a publish that takes away art content still draws is refused; and files nothing names
 * are swept.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRgba, encodePng, type Rgba } from "@secondstaronline/data/art";
import { classicData } from "@secondstaronline/data/classic";
import { EMPTY_ART } from "@secondstaronline/data/schema";
import type { ContentData } from "@secondstaronline/shared";
import { UPLOAD_TICKET_HEADER } from "@secondstaronline/shared";

import { ArtLibrary, checkUpload, keysOf, soundFormatOf, trim } from "../src/content/art.ts";
import { lostArtProblems } from "../src/content/art-usage.ts";
import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import {
  artFilesDir,
  memoryArtFiles,
  SWEEP_GRACE_MS,
  sweepArtFiles,
} from "../src/persistence/art-files.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** Gives the server a real administrator account for ADMIN, as a ticket's holder must be one. */
function admin(server: RunningServer): void {
  server.db
    .query(
      "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
    )
    .run(ADMIN.accountId, "admin");
}

/** A `w`×`h` image of one colour, with a transparent border of `pad` pixels. */
function picture(w: number, h: number, rgba = [200, 30, 30, 255], pad = 0): Rgba {
  const img = createRgba(w, h);
  for (let y = pad; y < h - pad; y++) {
    for (let x = pad; x < w - pad; x++) {
      img.data.set(rgba, (y * w + x) * 4);
    }
  }
  return img;
}
const png = (img: Rgba) => encodePng(img);
const WAV = new Uint8Array([
  ...new TextEncoder().encode("RIFF"),
  36,
  0,
  0,
  0,
  ...new TextEncoder().encode("WAVEfmt "),
]);

describe("checking an upload", () => {
  test("a PNG is measured, anything else is refused with the reason", () => {
    expect(checkUpload(png(picture(20, 10)), "image")).toEqual({
      ok: true,
      kind: "image",
      ext: "png",
      width: 20,
      height: 10,
    });
    expect(checkUpload(new Uint8Array([1, 2, 3]), "image")).toEqual({
      ok: false,
      error: "not a PNG file",
    });
    expect(checkUpload(new Uint8Array(), "image")).toEqual({
      ok: false,
      error: "the file is empty",
    });
    expect(checkUpload(new Uint8Array(6 * 1024 * 1024), "image").ok).toBe(false);
  });

  test("a sound is a WAV, MP3 or OGG by its first bytes", () => {
    expect(soundFormatOf(WAV)).toBe("wav");
    expect(soundFormatOf(new TextEncoder().encode("OggS\0\0"))).toBe("ogg");
    expect(soundFormatOf(new Uint8Array([0x49, 0x44, 0x33, 3]))).toBe("mp3");
    expect(soundFormatOf(new Uint8Array([0xff, 0xfb, 0x90]))).toBe("mp3");
    expect(checkUpload(png(picture(2, 2)), "sound")).toEqual({
      ok: false,
      error: "the file is not a WAV, MP3 or OGG sound",
    });
  });

  test("trimming keeps the visible pixels and moves the anchor with them", () => {
    const t = trim(picture(10, 8, undefined, 2), 5, 7);
    expect(t && [t.img.width, t.img.height, t.regX, t.regY]).toEqual([6, 4, 3, 5]);
    expect(trim(createRgba(3, 3), 0, 0)).toBeNull();
  });
});

describe("building the operator's art", () => {
  const files = memoryArtFiles();
  const lib = new ArtLibrary(files);
  const put = (img: Rgba) => files.put("art", "png", png(img));

  test("an item picture is trimmed into the items atlas, with its hit rect", () => {
    const file = put(picture(16, 16, undefined, 3));
    const art = { ...EMPTY_ART, items: [{ name: "Frost Sword", file, regX: 8, regY: 8 }] };
    expect(lib.problems(art)).toEqual([]);
    const built = lib.build(art);
    expect(built.index.atlases.items.sprites["frost sword"]?.slice(3)).toEqual([10, 10, 5, 5]);
    expect(built.rects.items["frost sword"]).toEqual([10, 10, 5, 5]);
    expect(built.index.atlases.items.sheets[0]).toMatch(/^items-[0-9a-f]{16}\.png$/);
    // The same rows build the same sheets.
    expect(new ArtLibrary(files).build(art).index).toEqual(built.index);
  });

  test("green is see-through when the row says so", () => {
    const img = picture(4, 4, [0, 255, 0, 255]);
    img.data.set([9, 9, 9, 255], 0);
    const file = put(img);
    const art = {
      ...EMPTY_ART,
      items: [{ name: "Dot", file, regX: 0, regY: 0, transparency: "green" as const }],
    };
    expect(lib.build(art).rects.items.dot).toEqual([1, 1, 0, 0]);
  });

  test("a worn layer's frames are at most 46×45, and f4-s is never drawn", () => {
    const ok = put(picture(46, 45));
    const big = put(picture(47, 45));
    const art = {
      ...EMPTY_ART,
      paperdoll: [
        { name: "Cape", frames: { "f1-s": { file: ok }, "f2-s": { file: big } } },
        { name: "Hat", frames: { "f4-s": { file: ok } } },
      ],
    };
    expect(lib.problems(art).map((p) => p.message)).toEqual([
      "f2-s is 47×45; worn frames are at most 46×45, drawn from the character's top-left",
      "f4-s is never drawn (a character attacking south shows f3-s)",
    ]);
    expect(Object.keys(lib.build(art).index.atlases.paperdoll.sprites)).toEqual([
      "cape-f1-s",
      "hat-f4-s",
    ]);
  });

  test("a body needs all 16 frames; its north frames flip about the standing frame when mirrored", () => {
    const frame = put(picture(20, 30));
    const frames = Object.fromEntries(
      ["f1", "f2", "f3", "f4"].flatMap((f) =>
        ["n", "e", "s", "w"].map((d) => [`${f}-${d}`, { file: frame, regX: 4, regY: 25 }]),
      ),
    );
    const { "f3-w": _gone, ...fifteen } = frames;
    expect(
      lib.problems({ ...EMPTY_ART, bodies: [{ name: "1000", frames: fifteen }] })[0]?.message,
    ).toBe("a body needs all 16 frames; missing f3-w");
    const built = lib.build({ ...EMPTY_ART, bodies: [{ name: "1000", frames, mirrored: true }] });
    expect(Object.keys(built.rects.chars)).toHaveLength(16);
    // The figure's centre is 10 px right of the anchor, so a flip about it keeps it in place.
    expect(built.rects.chars["1000-f2-n"]).toEqual([20, 30, 4, 25]);
  });

  test("an effect run and its trail are frames 1..n, and two rows may not make one sprite", () => {
    const f = { file: put(picture(8, 8)), regX: 4, regY: 4 };
    const built = lib.build({ ...EMPTY_ART, fx: [{ name: "Frost", frames: [f, f], trail: [f] }] });
    expect(Object.keys(built.rects.fx).sort()).toEqual(["frost-1", "frost-2", "xfrost-1"]);
    expect(
      lib.problems({
        ...EMPTY_ART,
        fx: [
          { name: "Frost", frames: [f], trail: [f] },
          { name: "xFrost", frames: [f] },
        ],
      })[0]?.message,
    ).toBe("two rows make the sprite xfrost-1");
  });

  test("a missing or damaged file, an empty picture and a mislabelled sound are named", () => {
    const empty = put(createRgba(4, 4));
    const wav = files.put("sounds", "wav", WAV);
    const problems = lib.problems({
      ...EMPTY_ART,
      items: [
        { name: "Gone", file: "0".repeat(64), regX: 0, regY: 0 },
        { name: "Blank", file: empty, regX: 0, regY: 0 },
      ],
      sounds: [{ name: "Crack", file: wav, format: "mp3" }],
    });
    expect(problems).toEqual([
      { where: "art/items/Gone", message: "the picture: its file is missing" },
      { where: "art/items/Blank", message: "the picture has no visible pixels" },
      { where: "art/sounds/Crack", message: "its file is a WAV sound, not an MP3" },
    ]);
  });
});

describe("uploading and publishing art on a running server", () => {
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

  function start(): { server: RunningServer; dbPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "sso-art-"));
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
      isoNow: () => "2026-11-24T00:00:00.000Z",
      rng: { random: (n) => (n >= 1 ? 1 : 0) },
      onLag: () => {},
    });
    admin(server);
    return { server, dbPath };
  }

  const post = (server: RunningServer, kind: string, bytes: Uint8Array, ticket?: string) =>
    fetch(new URL(`/upload/${kind}`, server.url), {
      method: "POST",
      body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
      headers: ticket ? { [UPLOAD_TICKET_HEADER]: ticket } : {},
    });

  test("an upload needs a ticket, is checked, and is stored by its hash beside the database", async () => {
    const { server, dbPath } = start();
    try {
      const bytes = png(picture(12, 12));
      expect((await post(server, "image", bytes)).status).toBe(403);
      const ticket = server.content.uploadTicket(ADMIN);
      const bad = await post(server, "image", new Uint8Array([1, 2, 3]), ticket);
      expect([bad.status, await bad.json()]).toEqual([422, { ok: false, error: "not a PNG file" }]);
      expect((await post(server, "video", bytes, ticket)).status).toBe(404);
      const res = await post(server, "image", bytes, ticket);
      const body = (await res.json()) as { ok: boolean; file: string; width: number };
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, ext: "png", width: 12, height: 12 });
      expect(existsSync(join(artFilesDir(dbPath), "art", `${body.file}.png`))).toBe(true);
      // An upload can be looked at by its hash (the Content page's preview), and cached for good.
      const view = await fetch(new URL(`/assets/uploads/art/${body.file}.png`, server.url));
      expect(view.status).toBe(200);
      expect(view.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      const sound = await post(server, "sound", WAV, ticket);
      expect(await sound.json()).toMatchObject({ ok: true, ext: "wav" });
    } finally {
      await server.stop();
    }
  });

  test("a published picture is served in the operator's atlas over the pack's, with its hit rect", async () => {
    const { server } = start();
    try {
      const ticket = server.content.uploadTicket(ADMIN);
      const up = (await (
        await post(server, "image", png(picture(20, 20, undefined, 2)), ticket)
      ).json()) as { file: string };
      const index0 = (await (await fetch(new URL("/assets/index.json", server.url))).json()) as {
        atlases: { items: { sheets: string[]; sprites: Record<string, number[]> } };
      };
      const classicSheet = index0.atlases.items.sprites["long sword"]?.[0];
      expect(index0.atlases.items.sheets[classicSheet as number]).toMatch(
        /^packs\/classic\/items-0\.png\?v=[0-9a-f]+$/,
      );
      const r = server.content.draftSet(
        ADMIN,
        { dataset: "art", part: "items", key: "Long Sword" },
        "set",
        { name: "Long Sword", file: up.file, regX: 10, regY: 10 },
      );
      expect(r.ok).toBe(true);
      expect(server.content.check()).toEqual([]);
      const pub = server.content.publish(ADMIN, server.content.draftRev(), "new sword");
      expect(pub.ok).toBe(true);
      const index = (await (await fetch(new URL("/assets/index.json", server.url))).json()) as {
        atlases: { items: { sheets: string[]; sprites: Record<string, number[]> } };
      };
      const sprite = index.atlases.items.sprites["long sword"] as number[];
      const sheet = index.atlases.items.sheets[sprite[0] as number] as string;
      expect(sheet).toMatch(/^operator\/items-[0-9a-f]{16}\.png$/);
      expect(sprite.slice(3)).toEqual([16, 16, 8, 8]);
      const res = await fetch(new URL(`/assets/${sheet}`, server.url));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(server.content.store().rects.items["long sword"]).toEqual([16, 16, 8, 8]);
      // Undo takes the picture back to the pack's.
      const undo = server.content.undo(ADMIN, pub.ok ? pub.value.id : "");
      expect(undo.ok).toBe(true);
      const after = (await (await fetch(new URL("/assets/index.json", server.url))).json()) as {
        atlases: { items: { sheets: string[]; sprites: Record<string, number[]> } };
      };
      expect(
        after.atlases.items.sheets[after.atlases.items.sprites["long sword"]?.[0] as number],
      ).toMatch(/^packs\/classic\//);
    } finally {
      await server.stop();
    }
  });

  test("removing a picture an item still draws is refused; removing both together passes", async () => {
    const { server } = start();
    try {
      const file = server.content.upload(
        server.content.uploadTicket(ADMIN),
        "image",
        png(picture(10, 10)),
      ).body as { file: string };
      const item = { name: "Frost Sword", icon: "added" };
      server.content.draftSet(
        ADMIN,
        { dataset: "items", part: "items", key: "Frost Sword" },
        "set",
        item,
      );
      server.content.draftSet(ADMIN, { dataset: "art", part: "items", key: "Frost Sword" }, "set", {
        name: "Frost Sword",
        file: file.file,
        regX: 5,
        regY: 5,
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      server.content.draftSet(
        ADMIN,
        { dataset: "art", part: "items", key: "Frost Sword" },
        "remove",
        null,
      );
      expect(server.content.check()).toContainEqual({
        where: "art/items",
        message: "removing the picture frost sword leaves item Frost Sword with nothing to draw",
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(false);
      server.content.draftSet(
        ADMIN,
        { dataset: "items", part: "items", key: "Frost Sword" },
        "remove",
        null,
      );
      expect(server.content.check()).toEqual([]);
    } finally {
      await server.stop();
    }
  });
});

describe("review fixes", () => {
  test("each database keeps its uploads in a folder of its own", () => {
    expect(artFilesDir("/data/sso.sqlite")).toBe("/data/sso-content");
    expect(artFilesDir("/data/test.db")).toBe("/data/test-content");
  });

  test("an art row that breaks the schema is named by the checks, never thrown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-art-bad-"));
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const clientDir = join(dir, "client");
      mkdirSync(clientDir);
      writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
      const server = startServer({
        dbPath: join(dir, "w.sqlite"),
        port: 0,
        development: false,
        clientDir,
        clock: manualClock(),
        autoTick: false,
        onLag: () => {},
      });
      try {
        const r = server.content.draftSet(
          ADMIN,
          { dataset: "art", part: "paperdoll", key: "Cape" },
          "set",
          { name: "Cape" },
        );
        // Refused as a schema problem when drafted, or named by the checks: either way, no throw.
        if (r.ok) {
          expect(server.content.check().length).toBeGreaterThan(0);
        } else {
          expect(r.error).toContain("art");
        }
      } finally {
        await server.stop();
      }
    } finally {
      logSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an effect's trail counts as in use: removing an uploaded trail a spell draws is refused", () => {
    const data = structuredClone(classicData) as ContentData;
    const run = data.spells.spells.find((sp) => sp.fx.length > 0)?.fx[0] as { member: string };
    const trail = `x${run.member}-1`.toLowerCase();
    const none = keysOf({ atlases: {} as never, sounds: {} });
    const before = keysOf({
      atlases: {
        tiles: {},
        bodies: {},
        paperdoll: {},
        items: {},
        fx: { sheets: [], sprites: { [trail]: [0, 0, 0, 1, 1, 0, 0] } },
      } as never,
      sounds: {},
    });
    expect(lostArtProblems(data, none, before, none).map((p) => p.where)).toEqual(["art/fx"]);
  });
});

describe("second review round", () => {
  const started: { dir: string; server: RunningServer }[] = [];
  afterEach(async () => {
    for (const { dir, server } of started.splice(0)) {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  function boot(withAdmin = true): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-art-r2-"));
    const clientDir = join(dir, "client");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const server = startServer({
      dbPath: join(dir, "w.sqlite"),
      port: 0,
      development: false,
      clientDir,
      clock: manualClock(),
      autoTick: false,
      onLag: () => {},
    });
    logSpy.mockRestore();
    started.push({ dir, server });
    if (withAdmin) {
      admin(server);
    }
    return server;
  }
  const raw = (server: RunningServer, headers: Record<string, string>, body: BodyInit) =>
    fetch(new URL("/upload/image", server.url), { method: "POST", headers, body });

  test("an upload's length must be a positive whole number, and a body past the limit is cut off", async () => {
    const server = boot();
    const ticket = server.content.uploadTicket(ADMIN);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    expect((await raw(server, { [UPLOAD_TICKET_HEADER]: ticket }, new Blob([big]))).status).toBe(
      413,
    );
    // A stream with no declared length is refused before it is read.
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(10));
        c.close();
      },
    });
    const res = await fetch(new URL("/upload/image", server.url), {
      method: "POST",
      headers: { [UPLOAD_TICKET_HEADER]: ticket },
      body: stream,
      // @ts-expect-error Bun's fetch streams a body with this
      duplex: "half",
    });
    expect([411, 413]).toContain(res.status);
  });

  test("a draft naming a file before it is uploaded passes once the file arrives", () => {
    const server = boot();
    const bytes = png(picture(9, 9));
    const file = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    server.content.draftSet(ADMIN, { dataset: "art", part: "items", key: "Dot" }, "set", {
      name: "Dot",
      file,
      regX: 0,
      regY: 0,
    });
    expect(server.content.check()).toContainEqual({
      where: "art/items/Dot",
      message: "the picture: its file is missing",
    });
    server.content.upload(server.content.uploadTicket(ADMIN), "image", bytes);
    expect(server.content.check()).toEqual([]);
  });

  test("a ticket stops working when its holder loses the Content page", async () => {
    const server = boot();
    const ticket = server.content.uploadTicket(ADMIN);
    const send = () =>
      raw(
        server,
        { [UPLOAD_TICKET_HEADER]: ticket },
        new Blob([png(picture(4, 4)) as Uint8Array<ArrayBuffer>]),
      );
    expect((await send()).status).toBe(200);
    server.db.query("UPDATE accounts SET role = NULL WHERE id = ?").run(ADMIN.accountId);
    expect((await send()).status).toBe(403);
  });
});

describe("re-uploading a file", () => {
  test("starts its sweep grace over", () => {
    let t = 1000;
    const files = memoryArtFiles(() => t);
    const bytes = png(picture(3, 3));
    files.put("art", "png", bytes);
    t = 1000 + SWEEP_GRACE_MS * 2;
    files.put("art", "png", bytes);
    expect(files.list()[0]?.storedAt).toBe(t);
  });
});

describe("sweeping uploads", () => {
  test("a file nothing names goes after the grace period; one a row names stays", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-sweep-"));
    try {
      const clientDir = join(dir, "client");
      mkdirSync(clientDir);
      writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
      const dbPath = join(dir, "world.sqlite");
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const server = startServer({
        dbPath,
        port: 0,
        development: false,
        clientDir,
        clock: manualClock(),
        autoTick: false,
        onLag: () => {},
      });
      admin(server);
      try {
        const ticket = server.content.uploadTicket(ADMIN);
        const used = (
          server.content.upload(ticket, "image", png(picture(5, 5))).body as { file: string }
        ).file;
        const orphan = (
          server.content.upload(ticket, "image", png(picture(6, 6))).body as { file: string }
        ).file;
        server.content.draftSet(ADMIN, { dataset: "art", part: "items", key: "Dot" }, "set", {
          name: "Dot",
          file: used,
          regX: 0,
          regY: 0,
        });
        const root = artFilesDir(dbPath);
        const old = new Date(Date.now() - SWEEP_GRACE_MS - 60_000);
        for (const f of [used, orphan]) {
          utimesSync(join(root, "art", `${f}.png`), old, old);
        }
        const files = (await import("../src/persistence/art-files.ts")).diskArtFiles(root);
        expect(sweepArtFiles(server.db, files, Date.now())).toBe(1);
        expect(existsSync(join(root, "art", `${used}.png`))).toBe(true);
        expect(existsSync(join(root, "art", `${orphan}.png`))).toBe(false);
      } finally {
        await server.stop();
        logSpy.mockRestore();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
