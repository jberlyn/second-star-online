/**
 * Sounds (issue #29, stage 7): the view lists every sound content and the engine play, with who
 * plays it and where the packs' are served; a sound's file is checked before it goes in the draft;
 * a stale panel is refused; and a publish, an undo or a pack update refuses a sound content newly
 * plays that nothing supplies, or an upload taken away that leaves its players silent.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssetIndex, PackArtIndex } from "@secondstaronline/data";
import { artRowFingerprint } from "@secondstaronline/shared";

import { keysOf } from "../src/content/art.ts";
import { contentIntent } from "../src/content/page.ts";
import { mergePackArt } from "../src/content/served-assets.ts";
import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { hasItemPicture } from "../src/systems/admin/drop.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

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
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 1]);

describe("sounds on a running server", () => {
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

  function start(content?: "minimal"): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-sound-art-"));
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
      ...(content ? { content } : {}),
    });
    server.db
      .query(
        "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
      )
      .run(ADMIN.accountId, "admin");
    return server;
  }

  function upload(server: RunningServer, bytes: Uint8Array): string {
    const up = server.content.upload(server.content.uploadTicket(ADMIN), "sound", bytes);
    if (!up.body.ok) {
      throw new Error(up.body.error);
    }
    return up.body.file;
  }

  const world = (server: RunningServer) => server.game.contentWorld;
  const publish = (server: RunningServer) =>
    server.content.publish(ADMIN, server.content.draftRev(), "", world(server));

  /** Classic's Crush, playing `name` instead of its own sound. */
  function crushPlays(server: RunningServer, name: string) {
    const ref = { dataset: "spells", part: "spells", key: "Crush" } as const;
    const crush = structuredClone(
      server.content.draftContent().spells.spells.find((s) => s.name === "Crush"),
    );
    if (!crush) {
      throw new Error("no Crush");
    }
    crush.fx = crush.fx.map((f) => ({ ...f, sounds: [{ name, ch: 4 }] }));
    const r = server.content.draftSet(ADMIN, ref, "set", crush);
    if (!r.ok) {
      throw new Error(JSON.stringify(r));
    }
  }

  test("the view lists the content's and the engine's sounds, who plays each, and the packs'", async () => {
    const server = start();
    try {
      const v = server.content.soundArtView();
      expect(v.uses.crush?.users).toContain("spell Crush");
      expect(v.uses.fx?.users).toContain("the engine (a monster killed)");
      expect(v.uses.churchy?.users).toEqual(["the engine (the church bell)"]);
      expect(v.packSounds.crush).toMatch(/^\/assets\/packs\/classic\/sounds\/crush\.wav\?v=/);
      // "stone skin" is played with a space; the pack's file has none.
      expect(v.packSounds["stone skin"]).toContain("stone-skin.wav");
      expect(v.art).toEqual([]);
      expect(v.maxBytes).toBe(5 * 1024 * 1024);
    } finally {
      await server.stop();
    }
  });

  test("a pack sound is replaced, then its upload taken out brings the pack's back", async () => {
    const server = start();
    try {
      const file = upload(server, wav(1));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "FX",
          file,
          format: "wav",
          expect: null,
        }),
      ).toEqual({ ok: true, value: { text: "FX is in the draft.", sound: "FX" } });
      expect(publish(server).ok).toBe(true);
      const art = server.content.soundArtView().art;
      expect(art).toEqual([{ name: "FX", file, format: "wav" }]);
      expect(server.content.soundArtView().liveUploads).toEqual(["fx"]);
      // A panel that saw no upload is stale now.
      expect(
        server.content.draftSound(ADMIN, { op: "remove", name: "fx", expect: null }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("changed since you opened it") });
      // Case ignored: the upload keeps its spelling.
      expect(
        server.content.draftSound(ADMIN, {
          op: "remove",
          name: "fx",
          expect: artRowFingerprint(art[0]),
        }),
      ).toEqual({ ok: true, value: { text: "FX's upload is out of the draft.", sound: "FX" } });
      // The pack has fx, so nothing goes silent.
      expect(publish(server).ok).toBe(true);
      expect(server.content.soundArtView().art).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("a sound's file is checked before anything is written", async () => {
    const server = start();
    try {
      const file = upload(server, wav(2));
      // Stored as a WAV, not an MP3.
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "boom",
          file,
          format: "mp3",
          expect: null,
        }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("not stored as MP3") });
      // Never uploaded.
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "boom",
          file: "b".repeat(64),
          format: "wav",
          expect: null,
        }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("upload it again") });
      // A name with a slash.
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "a/b",
          file,
          format: "wav",
          expect: null,
        }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("slashes") });
      // No upload to take out.
      expect(
        server.content.draftSound(ADMIN, { op: "remove", name: "crush", expect: null }),
      ).toMatchObject({
        ok: false,
        error: "crush has no upload to take out.",
      });
      expect(server.content.draft()).toEqual([]);
      // An MP3 is fine.
      const mp3 = upload(server, MP3);
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "boom",
          file: mp3,
          format: "mp3",
          expect: null,
        }).ok,
      ).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("publish refuses a sound content newly plays that nothing supplies, until one is uploaded", async () => {
    const server = start();
    try {
      crushPlays(server, "boom");
      const refused = publish(server);
      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain(
        "the sound boom has no file, so spell Crush would be silent",
      );
      const file = upload(server, wav(3));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "Boom",
          file,
          format: "wav",
          expect: null,
        }).ok,
      ).toBe(true);
      expect(publish(server).ok).toBe(true);
      // Taking it out now would leave Crush silent: no pack has it.
      const art = server.content.soundArtView().art[0];
      expect(
        server.content.draftSound(ADMIN, {
          op: "remove",
          name: "boom",
          expect: artRowFingerprint(art),
        }).ok,
      ).toBe(true);
      const again = publish(server);
      expect(again.ok).toBe(false);
      expect(JSON.stringify(again)).toContain("removing the sound boom leaves spell Crush silent");
    } finally {
      await server.stop();
    }
  });

  test("undo refuses to take away a sound the content now plays", async () => {
    const server = start();
    try {
      const file = upload(server, wav(4));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "boom",
          file,
          format: "wav",
          expect: null,
        }).ok,
      ).toBe(true);
      expect(publish(server).ok).toBe(true);
      const first = server.content.history()[0]?.id as string;
      crushPlays(server, "boom");
      expect(publish(server).ok).toBe(true);
      const r = server.content.undo(ADMIN, first, world(server));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain("boom");
    } finally {
      await server.stop();
    }
  });

  test("in a Minimal world the engine's sounds are listed, and an upload of one cannot be taken away", async () => {
    const server = start("minimal");
    try {
      const v = server.content.soundArtView();
      expect(v.uses.cash?.users).toEqual(["the engine (a purchase, a sale and a slot win)"]);
      expect(v.packSounds.cash).toBeUndefined();
      // A world that has no cash sound publishes as it is (the gap was there already).
      const file = upload(server, wav(5));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "cash",
          file,
          format: "wav",
          expect: null,
        }).ok,
      ).toBe(true);
      expect(publish(server).ok).toBe(true);
      const art = server.content.soundArtView().art[0];
      expect(
        server.content.draftSound(ADMIN, {
          op: "remove",
          name: "cash",
          expect: artRowFingerprint(art),
        }).ok,
      ).toBe(true);
      const r = publish(server);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain("removing the sound cash leaves the engine");
    } finally {
      await server.stop();
    }
  });

  test("the intents answer with the view and the change's result", async () => {
    const server = start();
    try {
      const file = upload(server, wav(6));
      const reply = contentIntent(
        server.content,
        { name: "Admin", accountId: ADMIN.accountId },
        {
          t: "contentSound",
          seq: 4,
          change: { op: "set", name: "zap", file, format: "wav", expect: null },
        },
        world(server),
      );
      expect(reply).toMatchObject({
        t: "contentResult",
        seq: 4,
        ok: true,
        text: "zap is in the draft.",
        sound: "zap",
      });
      const view = contentIntent(
        server.content,
        { name: "Admin", accountId: ADMIN.accountId },
        { t: "contentSoundArt", seq: 5 },
        world(server),
      );
      expect(view).toMatchObject({ t: "contentSoundArt", seq: 5 });
    } finally {
      await server.stop();
    }
  });

  test("review: a name that differs only by a non-ASCII letter's case is one row (Écho, écho)", async () => {
    const server = start();
    try {
      const file = upload(server, wav(7));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "Écho",
          file,
          format: "wav",
          expect: null,
        }).ok,
      ).toBe(true);
      expect(publish(server).ok).toBe(true);
      const art = server.content.soundArtView().art[0];
      expect(
        server.content.draftSound(ADMIN, {
          op: "remove",
          name: "Écho",
          expect: artRowFingerprint(art),
        }).ok,
      ).toBe(true);
      // A new upload under the other case replaces the removal: one draft row, not two.
      const other = upload(server, wav(8));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "écho",
          file: other,
          format: "wav",
          expect: null,
        }).ok,
      ).toBe(true);
      const rows = server.content.draft().filter((d) => d.dataset === "art" && d.part === "sounds");
      expect(rows).toHaveLength(1);
      expect(publish(server).ok).toBe(true);
      expect(server.content.soundArtView().art).toEqual([
        { name: "écho", file: other, format: "wav" },
      ]);
    } finally {
      await server.stop();
    }
  });

  test("review: sounds called constructor or __proto__ are entries of their own", async () => {
    const server = start();
    try {
      for (const [name, tag] of [
        ["constructor", 9],
        ["__proto__", 10],
      ] as const) {
        const file = upload(server, wav(tag));
        expect(
          server.content.draftSound(ADMIN, { op: "set", name, file, format: "wav", expect: null })
            .ok,
        ).toBe(true);
      }
      expect(publish(server).ok).toBe(true);
      const index = server.content.builtArt()?.index;
      expect(Object.hasOwn(index?.sounds ?? {}, "constructor")).toBe(true);
      expect(Object.hasOwn(index?.sounds ?? {}, "__proto__")).toBe(true);
      // Merged into the served index, both stay sounds and nothing else is touched.
      const engine: AssetIndex = {
        version: 1,
        inputHash: "",
        atlases: {} as AssetIndex["atlases"],
        ui: {},
        sounds: { clicksound: "sounds/clicksound.wav" },
      };
      const merged = mergePackArt(engine, [
        { id: "operator", art: index as PackArtIndex, prefix: "operator/" },
      ]);
      expect(typeof merged.sounds.constructor).toBe("string");
      expect(Object.getPrototypeOf(merged.sounds)).toBeNull();
      expect(Object.keys(merged.sounds).sort()).toEqual(["__proto__", "clicksound", "constructor"]);
      // An item nobody drew a `constructor` picture for has none.
      expect(hasItemPicture("constructor")).toBe(false);
      expect(hasItemPicture("toString")).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("review: a sound taken away while something newly plays it is reported once", async () => {
    const server = start();
    try {
      const file = upload(server, wav(12));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "boom",
          file,
          format: "wav",
          expect: null,
        }).ok,
      ).toBe(true);
      expect(publish(server).ok).toBe(true);
      const art = server.content.soundArtView().art[0];
      expect(
        server.content.draftSound(ADMIN, {
          op: "remove",
          name: "boom",
          expect: artRowFingerprint(art),
        }).ok,
      ).toBe(true);
      crushPlays(server, "boom");
      const about = server.content.check().filter((p) => p.message.includes("boom"));
      expect(about.map((p) => p.message)).toEqual([
        "removing the sound boom leaves spell Crush silent",
      ]);
    } finally {
      await server.stop();
    }
  });

  test("review: the game frame's clicks stay the engine's", async () => {
    const server = start();
    try {
      const file = upload(server, wav(11));
      expect(
        server.content.draftSound(ADMIN, {
          op: "set",
          name: "Clicksound2",
          file,
          format: "wav",
          expect: null,
        }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("game frame's own click") });
      // Written as JSON instead, the row is refused at publish.
      const r = server.content.draftSet(
        ADMIN,
        { dataset: "art", part: "sounds", key: "Clicksound" },
        "set",
        { name: "Clicksound", file, format: "wav" },
      );
      expect(r.ok).toBe(true);
      expect(JSON.stringify(server.content.check())).toContain("game frame's own click");
      // A pack (or the operator's art) naming one never replaces the engine's.
      const engine: AssetIndex = {
        version: 1,
        inputHash: "",
        atlases: {} as AssetIndex["atlases"],
        ui: {},
        sounds: { clicksound: "sounds/clicksound.wav" },
      };
      const merged = mergePackArt(engine, [
        {
          id: "odd",
          art: { version: 1, inputHash: "", atlases: {}, sounds: { ClickSound: "x.wav" } } as never,
        },
      ]);
      expect(merged.sounds.clicksound).toBe("sounds/clicksound.wav");
    } finally {
      await server.stop();
    }
  });
});

describe("review: a pack's sound index read in lower case", () => {
  test("mixed-case keys are one name for the checks and the served index", () => {
    const art = {
      version: 1,
      inputHash: "",
      atlases: {},
      sounds: { FireBalls: "sounds/fireballs.wav" },
    } as unknown as PackArtIndex;
    expect([...keysOf(art).sounds]).toEqual(["fireballs"]);
    const merged = mergePackArt(
      { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
      [{ id: "p", art }],
    );
    expect(Object.keys(merged.sounds)).toEqual(["fireballs"]);
  });
});
