/**
 * Monster bodies (issue #29, stage 4): a sheet is cut into its 16 frames, a new body takes the
 * next free number in the same change that gives it to its monster, a body's upload can be
 * replaced, taken out or swapped for another, and a monster that goes takes its own body with it.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtFrameId } from "@secondstaronline/data";
import { createRgba, encodePng, type Rgba } from "@secondstaronline/data/art";
import { classicData } from "@secondstaronline/data/classic";
import { BODY_MAX, OPERATOR_BODY_MIN } from "@secondstaronline/data/schema";
import {
  BODY_FRAMES,
  BODY_NUMBER_MAX,
  type BodyFrameSet,
  type ContentData,
  sheetCell,
} from "@secondstaronline/shared";

import { sliceBodySheet } from "../src/content/art.ts";
import { newBodyGaps, usedArt } from "../src/content/art-usage.ts";
import { contentIntent } from "../src/content/page.ts";
import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** A body sheet of `cell`-sized cells, each with a block of its own colour; the rest see-through. */
function sheet(cell: { w: number; h: number }, blank: readonly ArtFrameId[] = []): Rgba {
  const img = createRgba(cell.w * 4, cell.h * 4);
  BODY_FRAMES.forEach((id, n) => {
    if (blank.includes(id)) {
      return;
    }
    const { x, y } = sheetCell(id, cell);
    for (let dy = 4; dy < cell.h - 2; dy++) {
      for (let dx = 4; dx < cell.w - 4; dx++) {
        img.data.set([10 + n, 20, 30, 255], ((y + dy) * img.width + x + dx) * 4);
      }
    }
  });
  return img;
}

describe("cutting a body sheet", () => {
  test("any equal cell size: all 16 cells are kept exactly, blank ones too", () => {
    const cut = sliceBodySheet(sheet({ w: 60, h: 70 }, ["f4-s"]));
    if (typeof cut === "string") {
      throw new Error(cut);
    }
    expect(cut.cell).toEqual({ w: 60, h: 70 });
    expect([...cut.frames.keys()]).toEqual([...BODY_FRAMES]);
    const f3e = cut.frames.get("f3-e") as Rgba;
    expect([f3e.width, f3e.height]).toEqual([60, 70]);
    // f3-e is the 11th cell in sheet order (north F1-F4, east F1-F4…): colour 10 + 6.
    expect([...f3e.data.subarray((10 * 60 + 10) * 4, (10 * 60 + 10) * 4 + 4)]).toEqual([
      16, 20, 30, 255,
    ]);
    expect((cut.frames.get("f4-s") as Rgba).data.every((b) => b === 0)).toBe(true);
  });

  test("a sheet that does not divide into four by four, or with cells over 512, is refused", () => {
    expect(sliceBodySheet(createRgba(46, 45))).toContain("divide by 4");
    expect(sliceBodySheet(createRgba(4 * 513, 8))).toContain("at most 512×512");
  });
});

describe("what draws a body", () => {
  test("monsters, the generic monster, the Morph rows, the tree and the riders", () => {
    const used = usedArt(classicData).sprites.bodies;
    const first = classicData.monsters.monsters[0];
    expect(used.get(String(first?.body))).toContain("monster ");
    expect(used.get(String(classicData.bindings.bodies?.riders?.Boat))).toBeDefined();
  });

  test("the shared limit matches the data schema's", () => {
    expect(BODY_NUMBER_MAX).toBe(BODY_MAX);
  });
});

describe("bodies on a running server", () => {
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

  function start(): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-body-art-"));
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
    });
    server.db
      .query(
        "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
      )
      .run(ADMIN.accountId, "admin");
    return server;
  }

  /** Uploads a 46×45-cell sheet, cuts it, and gives the frames their default anchors. */
  function frames(server: RunningServer, img: Rgba = sheet({ w: 46, h: 45 })): BodyFrameSet {
    const up = server.content.upload(server.content.uploadTicket(ADMIN), "image", encodePng(img));
    if (!up.body.ok) {
      throw new Error(up.body.error);
    }
    const r = server.content.bodySheet(up.body.file);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(r.cell).toEqual({ w: 46, h: 45 });
    return {
      frames: Object.fromEntries(
        Object.entries(r.frames).map(([id, file]) => [id, { file, regX: 25, regY: 6 }]),
      ),
      mirrored: true,
      transparency: "alpha",
    };
  }

  const monsterRow = (server: RunningServer, name: string) =>
    (server.content.draftContent() as ContentData).monsters.monsters.find((m) => m.name === name);

  test("a new body for a monster takes 1000 and becomes its body in one change", async () => {
    const server = start();
    try {
      const orc = classicData.monsters.monsters[0];
      if (!orc) {
        throw new Error("no monster");
      }
      const set = frames(server);
      expect(server.content.draft()).toEqual([]);
      expect(server.content.bodyArtView().next).toBe(OPERATOR_BODY_MIN);
      const r = server.content.draftBody(ADMIN, {
        op: "new",
        monster: orc.name.toLowerCase(),
        ...set,
      });
      expect(r).toEqual({
        ok: true,
        value: { text: `Body 1000 is in the draft, as ${orc.name}'s body.`, body: 1000 },
      });
      expect(monsterRow(server, orc.name)?.body).toBe(1000);
      // The rest of its row is as it was.
      expect({ ...monsterRow(server, orc.name), body: orc.body }).toEqual(orc);
      expect(
        server.content
          .draft()
          .map((d) => `${d.dataset}/${d.part}/${d.key}`)
          .sort(),
      ).toEqual(["art/bodies/1000", `monsters/monsters/${orc.name}`]);
      // The next one takes 1001; the view shows who draws each.
      expect(server.content.bodyArtView().next).toBe(1001);
      expect(server.content.draftBody(ADMIN, { op: "new", ...set })).toEqual({
        ok: true,
        value: { text: "Body 1001 is in the draft.", body: 1001 },
      });
      const view = server.content.bodyArtView();
      expect(view.bodies.find((b) => b.body === 1000)?.monsters).toEqual([orc.name]);
      expect(view.art.map((a) => a.name).sort()).toEqual(["1000", "1001"]);
      expect(view.packBodies).toContain(orc.body);
      expect(view.monsters.find((m) => m.name === orc.name)?.body).toBe(1000);

      // It publishes and builds: 16 frames, north ones flipped.
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "bodies").ok).toBe(true);
      const sprites = server.content.builtArt()?.index.atlases.bodies.sprites ?? {};
      expect(BODY_FRAMES.every((f) => sprites[`1000-${f}`])).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("a body needs all 16 frames; a choice needs a body that exists", async () => {
    const server = start();
    try {
      const set = frames(server);
      const some = { ...set, frames: { "f1-n": set.frames["f1-n"] } } as BodyFrameSet;
      expect(server.content.draftBody(ADMIN, { op: "new", ...some })).toMatchObject({
        ok: false,
        error: expect.stringContaining("A body needs all 16 frames; missing f2-n, f3-n"),
      });
      const orc = classicData.monsters.monsters[0]?.name as string;
      expect(server.content.draftBody(ADMIN, { op: "choose", monster: orc, body: 9000 })).toEqual({
        ok: false,
        error: "Body 9000 has no picture.",
      });
      const other = classicData.monsters.monsters[1]?.body as number;
      expect(server.content.draftBody(ADMIN, { op: "choose", monster: orc, body: other })).toEqual({
        ok: true,
        value: { text: `${orc} has body ${other} in the draft.`, body: other },
      });
      expect(server.content.draftBody(ADMIN, { op: "remove", body: other })).toEqual({
        ok: false,
        error: `Body ${other} has no upload to take out.`,
      });
      expect(server.content.draftBody(ADMIN, { op: "new", monster: "Nobody", ...set })).toEqual({
        ok: false,
        error: "There is no monster Nobody.",
      });
    } finally {
      await server.stop();
    }
  });

  test("uploading over a pack body overrides it; taking the upload out brings the pack's back", async () => {
    const server = start();
    try {
      const orc = classicData.monsters.monsters[0];
      const n = orc?.body as number;
      expect(server.content.draftBody(ADMIN, { op: "set", body: n, ...frames(server) })).toEqual({
        ok: true,
        value: { text: `Body ${n}'s frames are in the draft.`, body: n },
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(server.content.builtArt()?.index.atlases.bodies.sprites[`${n}-f2-s`]).toBeDefined();
      // Out again: no usage problem, since the pack still draws it.
      expect(server.content.draftBody(ADMIN, { op: "remove", body: n }).ok).toBe(true);
      expect(server.content.check()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("taking out an upload a monster still draws (and no pack does) is refused at publish", async () => {
    const server = start();
    try {
      const orc = classicData.monsters.monsters[0]?.name as string;
      server.content.draftBody(ADMIN, { op: "new", monster: orc, ...frames(server) });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(server.content.draftBody(ADMIN, { op: "remove", body: 1000 }).ok).toBe(true);
      expect(server.content.check()).toContainEqual({
        where: "art/bodies",
        message: `removing the body 1000 leaves monster ${orc} with nothing to draw`,
      });
    } finally {
      await server.stop();
    }
  });

  const removal = (key: string) => ({
    kind: "monster" as const,
    key,
    content: "remove" as const,
    replacement: null,
    spawns: "remove" as const,
    live: "despawn" as const,
    npcFile: "delete" as const,
  });

  test("removing a monster takes its own uploaded body with it", async () => {
    const server = start();
    try {
      const a = classicData.monsters.monsters[0]?.name as string;
      server.content.draftBody(ADMIN, { op: "new", monster: a, ...frames(server) });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(server.content.draftRemoval(ADMIN, removal(a)).ok).toBe(true);
      expect(
        server.content.draft().map((d) => `${d.dataset}/${d.part}/${d.key}:${d.op}`),
      ).toContain("art/bodies/1000:remove");
    } finally {
      await server.stop();
    }
  });

  test("a body another monster still draws stays when its first monster goes", async () => {
    const server = start();
    try {
      const [a, b] = classicData.monsters.monsters.map((m) => m.name) as [string, string];
      server.content.draftBody(ADMIN, { op: "new", monster: a, ...frames(server) });
      server.content.draftBody(ADMIN, { op: "choose", monster: b, body: 1000 });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(server.content.draftRemoval(ADMIN, removal(a)).ok).toBe(true);
      expect(server.content.draft().some((d) => d.dataset === "art")).toBe(false);
      expect(server.content.check()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("Sol fix: a body given to a monster whose upload goes before its first publish is refused", async () => {
    const server = start();
    try {
      const orc = classicData.monsters.monsters[0]?.name as string;
      server.content.draftBody(ADMIN, { op: "new", monster: orc, ...frames(server) });
      // The upload only the draft adds goes: the monster would point at a body nothing draws.
      expect(server.content.draftBody(ADMIN, { op: "remove", body: 1000 }).ok).toBe(true);
      expect(monsterRow(server, orc)?.body).toBe(1000);
      expect(server.content.check()).toContainEqual({
        where: "art/bodies",
        message: `body 1000 has no picture, so monster ${orc} would draw nothing`,
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("Sol fix: a gap the published content already had is not held against a change", () => {
    const published = structuredClone(classicData) as ContentData;
    published.monsters.generic.body = 200;
    const next = structuredClone(published);
    (next.monsters.monsters[0] as { body: number }).body = 200;
    const none = {
      sprites: {
        tiles: new Set<string>(),
        bodies: new Set<string>(),
        paperdoll: new Set<string>(),
        fx: new Set<string>(),
        items: new Set<string>(),
      },
      sounds: new Set<string>(),
    };
    // Body 200 was named and drawn by nothing before: naming it again is no new gap.
    expect(newBodyGaps(next, published, none, none, none)).toEqual([]);
    (next.monsters.monsters[1] as { body: number }).body = 4321;
    expect(newBodyGaps(next, published, none, none, none).map((p) => p.message)).toEqual([
      `body 4321 has no picture, so monster ${next.monsters.monsters[1]?.name} would draw nothing`,
    ]);
  });

  test("Sol fix: replacing a monster's own body is refused once another monster draws it", async () => {
    const server = start();
    try {
      const [a, b] = classicData.monsters.monsters.map((m) => m.name) as [string, string];
      const set = frames(server);
      server.content.draftBody(ADMIN, { op: "new", monster: a, ...set });
      // Another admin gives the same body to a second monster meanwhile.
      server.content.draftBody(ADMIN, { op: "choose", monster: b, body: 1000 });
      const r = server.content.draftBody(ADMIN, { op: "set", body: 1000, owner: a, ...set });
      expect(r).toMatchObject({
        ok: false,
        error: expect.stringContaining(`Body 1000 is now also drawn by monster ${b}`),
      });
      // A monster no longer on that body is refused too; with no owner it repaints for all.
      expect(
        server.content.draftBody(ADMIN, {
          op: "set",
          body: 1000,
          owner: classicData.monsters.monsters[2]?.name as string,
          ...set,
        }),
      ).toMatchObject({ ok: false });
      expect(server.content.draftBody(ADMIN, { op: "set", body: 1000, ...set }).ok).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("Sol fix: frames that are blank, missing or too large are refused before any row is written", async () => {
    const server = start();
    try {
      const orc = classicData.monsters.monsters[0];
      const blank = frames(server, createRgba(4 * 46, 4 * 45));
      expect(server.content.draftBody(ADMIN, { op: "new", monster: orc?.name, ...blank })).toEqual({
        ok: false,
        error: "f1-n shows nothing: every frame of a body is drawn",
      });
      // Pure green read as see-through is blank too.
      const green = createRgba(4 * 46, 4 * 45);
      for (let i = 0; i < green.data.length; i += 4) {
        green.data.set([0, 255, 0, 255], i);
      }
      const greens = { ...frames(server, green), transparency: "green" as const };
      expect(server.content.draftBody(ADMIN, { op: "new", ...greens }).ok).toBe(false);
      const set = frames(server);
      const gone = {
        ...set,
        frames: { ...set.frames, "f2-s": { file: "0".repeat(64), regX: 25, regY: 6 } },
      };
      expect(server.content.draftBody(ADMIN, { op: "new", ...gone })).toMatchObject({
        ok: false,
        error: expect.stringContaining("f2-s:"),
      });
      expect(server.content.draft()).toEqual([]);
      expect(monsterRow(server, orc?.name as string)?.body).toBe(orc?.body);
    } finally {
      await server.stop();
    }
  });

  test("Neon fix: the page's answer to a body change carries the body's number", async () => {
    const server = start();
    try {
      const orc = classicData.monsters.monsters[0]?.name as string;
      const reply = contentIntent(server.content, ADMIN, {
        t: "contentBody",
        seq: 9,
        change: { op: "new", monster: orc, ...frames(server) },
      });
      expect(reply).toMatchObject({ t: "contentResult", seq: 9, ok: true, body: 1000 });
      const bad = contentIntent(server.content, ADMIN, {
        t: "contentBody",
        seq: 10,
        change: { op: "remove", body: 31 },
      });
      expect(bad).toMatchObject({ t: "contentResult", ok: false });
      expect("body" in bad && bad.body !== undefined).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("Neon fix: a frame over 512×512 is refused by the server", async () => {
    const server = start();
    try {
      const set = frames(server);
      const up = server.content.upload(
        server.content.uploadTicket(ADMIN),
        "image",
        encodePng(createRgba(600, 20)),
      );
      if (!up.body.ok) {
        throw new Error(up.body.error);
      }
      const big = {
        ...set,
        frames: { ...set.frames, "f3-w": { file: up.body.file, regX: 0, regY: 0 } },
      };
      expect(server.content.draftBody(ADMIN, { op: "new", ...big })).toEqual({
        ok: false,
        error: "f3-w is 600×20; body frames may be at most 512×512",
      });
    } finally {
      await server.stop();
    }
  });

  test("Neon fix: a new body never takes Smoke Bomb's number", async () => {
    const server = start();
    try {
      server.content.draftSet(ADMIN, { dataset: "bindings", part: "bodies", key: null }, "set", {
        ...(classicData.bindings.bodies as object),
        smoke: 1000,
      });
      expect(server.content.bodyArtView().next).toBe(1001);
    } finally {
      await server.stop();
    }
  });
});
