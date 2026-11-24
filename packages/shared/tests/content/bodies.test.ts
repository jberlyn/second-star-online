/**
 * Monster bodies (issue #29, stage 4): who draws each body, the sheet, the default anchor, the
 * flip of north frames (the same as the asset build's), the frame checks and the rows a change
 * writes.
 */
import { describe, expect, test } from "bun:test";

import type { ArtBody, ArtFrameId } from "@secondstaronline/data";
import { centreLine2, createRgba, mirrorBody } from "@secondstaronline/data/art";
import { classicData } from "@secondstaronline/data/classic";

import {
  BODY_FRAMES,
  type BodyFrameSet,
  type BodyMonsterRow,
  bodyCentreLine2,
  bodyFrameReport,
  bodyNumbersOf,
  bodySheetCell,
  bodyUsersText,
  bodyUses,
  defaultBodyAnchor,
  mirrorBodyFrame,
  planBody,
} from "../../src/content/bodies.ts";
import type { Pixels } from "../../src/content/picture.ts";
import { cutCell, sheetCell } from "../../src/content/worn.ts";
import { PAPERDOLL_REG } from "../../src/rules/inventory/paperdoll.ts";

const FILE = "a".repeat(64);
const allFrames = (regX = 25, regY = 6): BodyFrameSet["frames"] =>
  Object.fromEntries(BODY_FRAMES.map((f) => [f, { file: FILE, regX, regY }]));
const set = (frames = allFrames()): BodyFrameSet => ({
  frames,
  mirrored: true,
  transparency: "alpha",
});

/** A picture with an opaque block at (x, y, w, h). */
function block(width: number, height: number, x: number, y: number, w: number, h: number): Pixels {
  const img = createRgba(width, height);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      img.data.set([200, 100, 50, 255], (yy * width + xx) * 4);
    }
  }
  return img;
}

describe("who draws a body", () => {
  test("Classic: every monster, the generic monster, the Morph rows, the tree and the riders", () => {
    const uses = bodyUses(classicData);
    const first = classicData.monsters.monsters[0] as { name: string; body: number };
    expect(uses.get(first.body)?.monsters).toContain(first.name);
    const boat = classicData.bindings.bodies?.riders?.Boat as number;
    expect(uses.get(boat)?.users).toContain("the Boat");
    for (const row of classicData.bindings.bodies?.morph ?? []) {
      expect(uses.get(row.body)?.users).toContain("the Morph bodies");
    }
    expect(uses.get(classicData.monsters.generic.body)?.users).toContain("the generic monster");
  });

  test("the text names up to three, and leaves one out on request", () => {
    const use = {
      body: 5,
      users: ["monster A", "monster B", "monster C", "the Boat"],
      monsters: [],
    };
    expect(bodyUsersText(use)).toBe("monster A, monster B, monster C and 1 more");
    expect(bodyUsersText(use, "monster a")).toBe("monster B, monster C and the Boat");
    expect(bodyUsersText(undefined)).toBe("nothing");
  });

  test("an atlas's body numbers: frame keys only", () => {
    expect([
      ...bodyNumbersOf(["55-f1-e", "55-f2-s", "1000-f4-w", "holy shieldflame1", "invisbody"]),
    ]).toEqual([55, 1000]);
  });
});

describe("the sheet and the anchor", () => {
  test("any sheet that divides into four by four, with cells up to 512", () => {
    expect(bodySheetCell(184, 180)).toEqual({ w: 46, h: 45 });
    expect(bodySheetCell(256, 400)).toEqual({ w: 64, h: 100 });
    expect(bodySheetCell(185, 180)).toHaveProperty("error");
    expect(bodySheetCell(4 * 600, 400)).toHaveProperty("error");
  });

  test("a cell is cut from its row (facing) and column (frame), exactly", () => {
    const sheet = block(4 * 10, 4 * 12, 0, 0, 0, 0);
    const { x, y } = sheetCell("f3-w", { w: 10, h: 12 });
    expect([x, y]).toEqual([20, 36]);
    sheet.data.set([1, 2, 3, 255], ((y + 5) * sheet.width + x + 4) * 4);
    const cell = cutCell(sheet, "f3-w", { w: 10, h: 12 });
    expect([cell.width, cell.height]).toEqual([10, 12]);
    expect([...cell.data.subarray((5 * 10 + 4) * 4, (5 * 10 + 4) * 4 + 4)]).toEqual([1, 2, 3, 255]);
  });

  test("a frame stands where a player stands: a 46×45 frame lands on the paperdoll's point", () => {
    expect(defaultBodyAnchor(46, 45)).toEqual({ regX: PAPERDOLL_REG.x, regY: PAPERDOLL_REG.y });
    // Bigger frames keep their middle on the tile's middle and their bottom where the player's is.
    expect(defaultBodyAnchor(100, 80)).toEqual({ regX: 52, regY: 41 });
    expect(defaultBodyAnchor(32, 32)).toEqual({ regX: 18, regY: -7 });
  });
});

describe("mirrored north frames", () => {
  test("flip exactly as the asset build does", () => {
    const img = block(30, 40, 3, 5, 12, 30);
    for (const regX of [0, 9, 17, 25]) {
      const line2 = bodyCentreLine2(img, regX);
      expect(line2).toBe(centreLine2(img as never, regX));
      const ours = mirrorBodyFrame(img, regX, line2);
      const build = mirrorBody(img as never, regX, line2);
      expect(ours.regX).toBe(build.regX);
      expect([...ours.img.data]).toEqual([...build.img.data]);
    }
  });
});

describe("frame checks", () => {
  test("a frame over 512 or showing nothing is an error; faint edges are a warning", () => {
    expect(bodyFrameReport(block(600, 20, 0, 0, 5, 5), "f1-n").errors[0]).toContain(
      "at most 512×512",
    );
    expect(bodyFrameReport(createRgba(20, 20), "f2-s").errors).toEqual([
      "f2-s shows nothing: every frame of a body is drawn",
    ]);
    const faint = block(20, 20, 2, 2, 10, 10);
    faint.data.set([0, 0, 0, 10], (2 * 20 + 2) * 4);
    for (let x = 2; x < 12; x++) {
      faint.data[(2 * 20 + x) * 4 + 3] = 10;
    }
    expect(bodyFrameReport(faint, "f2-s")).toEqual({
      errors: [],
      warnings: ["f2-s's top edge is nearly invisible but still clickable"],
    });
  });
});

describe("the rows a change writes", () => {
  const orc: BodyMonsterRow = { name: "Orc", body: 30, hp: 10 };
  const goblin: BodyMonsterRow = { name: "Goblin", body: 30, hp: 5 };
  const upload: ArtBody = { name: "1000", frames: allFrames() as ArtBody["frames"] };
  const input = (next: number | null = 1001) => ({
    monsters: [orc, goblin],
    art: [upload],
    exists: (n: number) => n === 30 || n === 1000,
    nextNumber: next,
    noNumbers: "No body numbers left.",
  });

  test("a new body for a monster takes the next number and becomes its body, its row kept", () => {
    const r = planBody({ op: "new", monster: "orc", ...set() }, input());
    expect(r).toEqual({
      ok: true,
      body: 1001,
      rows: [
        {
          ref: { dataset: "art", part: "bodies", key: "1001" },
          op: "set",
          data: { name: "1001", frames: allFrames(), mirrored: true },
        },
        {
          ref: { dataset: "monsters", part: "monsters", key: "Orc" },
          op: "set",
          data: { name: "Orc", body: 1001, hp: 10 },
        },
      ],
    });
  });

  test("with every number taken, a new body is refused with the reason", () => {
    expect(planBody({ op: "new", ...set() }, input(null))).toEqual({
      ok: false,
      error: "No body numbers left.",
    });
  });

  test("a body needs all 16 frames", () => {
    const frames = allFrames();
    delete frames["f4-s" as ArtFrameId];
    expect(planBody({ op: "set", body: 30, ...set(frames) }, input())).toEqual({
      ok: false,
      error: "A body needs all 16 frames; missing f4-s.",
    });
  });

  test("painting a body keeps green transparency and leaves mirrored off when unticked", () => {
    const r = planBody(
      { op: "set", body: 30, frames: allFrames(), mirrored: false, transparency: "green" },
      input(),
    );
    expect(r.ok && r.rows[0]?.data).toEqual({
      name: "30",
      frames: allFrames(),
      transparency: "green",
    });
  });

  test("choosing needs a body that exists; removing needs an upload", () => {
    expect(planBody({ op: "choose", monster: "Goblin", body: 1000 }, input())).toMatchObject({
      ok: true,
      rows: [{ data: { name: "Goblin", body: 1000, hp: 5 } }],
    });
    expect(planBody({ op: "choose", monster: "Goblin", body: 77 }, input())).toEqual({
      ok: false,
      error: "Body 77 has no picture.",
    });
    expect(planBody({ op: "remove", body: 1000 }, input())).toMatchObject({
      ok: true,
      rows: [{ ref: { key: "1000" }, op: "remove", data: null }],
    });
    expect(planBody({ op: "remove", body: 30 }, input())).toEqual({
      ok: false,
      error: "Body 30 has no upload to take out.",
    });
    expect(planBody({ op: "choose", monster: "Nobody", body: 30 }, input())).toEqual({
      ok: false,
      error: "There is no monster Nobody.",
    });
  });

  test("Sol fix: a monster's own body is repainted only while it still draws it alone", () => {
    const uses = (n: number) =>
      n === 1000
        ? { body: 1000, users: ["monster Orc", "monster Goblin"], monsters: ["Orc", "Goblin"] }
        : undefined;
    const own = {
      ...input(),
      monsters: [
        { ...orc, body: 1000 },
        { ...goblin, body: 1000 },
      ],
      uses,
    };
    expect(planBody({ op: "set", body: 1000, owner: "Orc", ...set() }, own)).toEqual({
      ok: false,
      error:
        "Body 1000 is now also drawn by monster Goblin: reopen Orc's row to give it a new body, or repaint body 1000 for everyone.",
    });
    expect(planBody({ op: "set", body: 30, owner: "Wisp", ...set() }, own)).toMatchObject({
      ok: false,
    });
    expect(
      planBody(
        { op: "set", body: 1000, owner: "Orc", ...set() },
        { ...own, uses: () => ({ body: 1000, users: ["monster Orc"], monsters: ["Orc"] }) },
      ).ok,
    ).toBe(true);
  });
});
