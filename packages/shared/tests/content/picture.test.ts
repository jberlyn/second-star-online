/**
 * An uploaded picture's geometry (issue #29): the server's build and the Content page's preview
 * share these rules, so the preview shows what the game draws.
 */
import { describe, expect, test } from "bun:test";

import {
  applyTransparency,
  defaultItemAnchor,
  faintEdges,
  guessTransparency,
  itemPictureReport,
  type PictureArtRow,
  type PictureItem,
  type Pixels,
  planPicture,
  visibleBounds,
} from "../../src/content/picture.ts";

/** A `w`×`h` picture, see-through except the box `fill` of colour `rgba`. */
function pixels(
  w: number,
  h: number,
  fill: { x: number; y: number; w: number; h: number } | null,
  rgba: readonly number[] = [200, 30, 30, 255],
  background: readonly number[] = [0, 0, 0, 0],
): Pixels {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside =
        fill !== null && x >= fill.x && x < fill.x + fill.w && y >= fill.y && y < fill.y + fill.h;
      data.set(inside ? rgba : background, (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

describe("item picture geometry", () => {
  test("the visible box skips fully see-through edges", () => {
    expect(visibleBounds(pixels(10, 8, { x: 2, y: 1, w: 5, h: 4 }))).toEqual({
      x: 2,
      y: 1,
      w: 5,
      h: 4,
    });
    expect(visibleBounds(pixels(4, 4, null))).toBeNull();
  });

  test("the default anchor centres the visible pixels on the tile, as Classic's icons sit", () => {
    // A full 32×32 picture sits at Classic's (16, -2), the sack's and the gold piles'.
    expect(defaultItemAnchor({ x: 0, y: 0, w: 32, h: 32 })).toEqual({ regX: 16, regY: -2 });
    // Classic's 23×29 icons are at (11, -3): one pixel off at most.
    expect(defaultItemAnchor({ x: 0, y: 0, w: 23, h: 29 })).toEqual({ regX: 11, regY: -4 });
    // Margins move it with the visible pixels.
    expect(defaultItemAnchor({ x: 4, y: 6, w: 10, h: 10 })).toEqual({ regX: 9, regY: -7 });
  });

  test("green is see-through only when chosen, and a fresh upload's choice is guessed", () => {
    const green = pixels(6, 6, { x: 1, y: 1, w: 4, h: 4 }, [200, 30, 30, 255], [0, 255, 0, 255]);
    expect(guessTransparency(green)).toBe("green");
    expect(guessTransparency(pixels(6, 6, { x: 1, y: 1, w: 4, h: 4 }))).toBe("alpha");
    expect(guessTransparency(pixels(6, 6, { x: 0, y: 0, w: 6, h: 6 }))).toBe("alpha");
    const copy = { ...green, data: new Uint8Array(green.data) };
    applyTransparency(copy, "alpha");
    expect(visibleBounds(copy)).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    applyTransparency(copy, "green");
    expect(visibleBounds(copy)).toEqual({ x: 1, y: 1, w: 4, h: 4 });
  });

  test("an edge every pixel of which is nearly invisible is named", () => {
    const img = pixels(8, 8, { x: 2, y: 2, w: 4, h: 4 });
    // A faint row above the solid box: inside the hit box, but you would never see it.
    for (let x = 2; x < 6; x++) {
      img.data.set([200, 30, 30, 10], (1 * 8 + x) * 4);
    }
    const b = visibleBounds(img);
    expect(b).toEqual({ x: 2, y: 1, w: 4, h: 5 });
    expect(faintEdges(img, b as NonNullable<typeof b>)).toEqual(["top"]);
  });

  test("the report refuses what the server refuses and warns about the rest", () => {
    expect(itemPictureReport(pixels(4, 4, null), "alpha", 512).errors).toEqual([
      "Nothing shows: every pixel is see-through.",
    ]);
    expect(
      itemPictureReport(pixels(600, 4, { x: 0, y: 0, w: 4, h: 4 }), "alpha", 512).errors,
    ).toEqual(["The picture is 600×4; item pictures may be at most 512×512."]);
    const big = itemPictureReport(pixels(40, 40, { x: 0, y: 0, w: 40, h: 40 }), "alpha", 512);
    expect(big.errors).toEqual([]);
    expect(big.warnings).toEqual([
      "No pixel is see-through: it is drawn as a solid rectangle.",
      "It shows 40×40: bigger than a bag slot (32×32), so it overlaps the slots beside it.",
      "It spills out of the equipment boxes (35×35).",
    ]);
    const solidGreen = pixels(
      6,
      6,
      { x: 1, y: 1, w: 4, h: 4 },
      [200, 30, 30, 255],
      [0, 255, 0, 255],
    );
    expect(itemPictureReport(solidGreen, "alpha", 512).warnings).toEqual([
      'No pixel is see-through, but it has pure green in it: choose "Pure green is see-through" if that is its background.',
    ]);
    expect(itemPictureReport(pixels(8, 8, { x: 1, y: 1, w: 6, h: 6 }), "alpha", 512)).toEqual({
      errors: [],
      warnings: [],
      bounds: { x: 1, y: 1, w: 6, h: 6 },
    });
  });
});

describe("what a picture change writes", () => {
  const FILE = "a".repeat(64);
  const art = { file: FILE, regX: 16, regY: -2, transparency: "alpha" as const };
  const items: PictureItem[] = [
    { name: "Moonblade" },
    { name: "Starblade", sprite: "Long Sword" },
    { name: "Duskblade", sprite: "Moonblade" },
  ];
  const uploads: PictureArtRow[] = [{ name: "Moonblade", file: FILE, regX: 6, regY: -6 }];
  const exists = (n: string) => ["long sword", "moonblade"].includes(n.toLowerCase());
  const rows = (r: ReturnType<typeof planPicture>) => (r.ok ? r.rows : r.error);

  test("an upload is the item's own art row, named by its key", () => {
    expect(rows(planPicture({ op: "upload", item: "moonblade", art }, items, [], exists))).toEqual([
      {
        ref: { dataset: "art", part: "items", key: "Moonblade" },
        op: "set",
        data: { name: "Moonblade", file: FILE, regX: 16, regY: -2 },
      },
    ]);
  });

  test("an upload for an item that borrowed a picture drops only its sprite", () => {
    const withExtra = [{ ...items[1], display: "Star Blade" } as PictureItem, ...items];
    expect(
      rows(
        planPicture(
          { op: "upload", item: "Starblade", art: { ...art, transparency: "green" } },
          withExtra,
          uploads,
          exists,
        ),
      ),
    ).toEqual([
      {
        ref: { dataset: "art", part: "items", key: "Starblade" },
        op: "set",
        data: { name: "Starblade", file: FILE, regX: 16, regY: -2, transparency: "green" },
      },
      {
        ref: { dataset: "items", part: "items", key: "Starblade" },
        op: "set",
        // Every other field of the row as the draft has it now: the display name stays.
        data: { name: "Starblade", display: "Star Blade" },
      },
    ]);
  });

  test("choosing a picture sets the sprite; the item's own upload goes unless another draws it", () => {
    expect(
      rows(
        planPicture(
          { op: "choose", item: "Moonblade", picture: "Long Sword" },
          items,
          uploads,
          exists,
        ),
      ),
    ).toEqual([
      {
        ref: { dataset: "items", part: "items", key: "Moonblade" },
        op: "set",
        data: { name: "Moonblade", sprite: "Long Sword" },
      },
    ]);
    const alone = [items[0] as PictureItem];
    expect(
      rows(
        planPicture(
          { op: "choose", item: "Moonblade", picture: "Long Sword" },
          alone,
          uploads,
          exists,
        ),
      ),
    ).toEqual([
      {
        ref: { dataset: "items", part: "items", key: "Moonblade" },
        op: "set",
        data: { name: "Moonblade", sprite: "Long Sword" },
      },
      { ref: { dataset: "art", part: "items", key: "Moonblade" }, op: "remove", data: null },
    ]);
  });

  test("choosing the item's own name stops borrowing; a missing picture or no change is refused", () => {
    expect(
      rows(
        planPicture({ op: "choose", item: "Starblade", picture: "starblade" }, items, [], exists),
      ),
    ).toEqual([
      {
        ref: { dataset: "items", part: "items", key: "Starblade" },
        op: "set",
        data: { name: "Starblade" },
      },
    ]);
    expect(
      rows(planPicture({ op: "choose", item: "Starblade", picture: "Nope" }, items, [], exists)),
    ).toBe("There is no picture called Nope.");
    expect(
      rows(
        planPicture({ op: "choose", item: "Starblade", picture: "long sword" }, items, [], exists),
      ),
    ).toBe("Starblade already draws long sword.");
    expect(rows(planPicture({ op: "remove", item: "Starblade" }, items, uploads, exists))).toBe(
      "Starblade has no upload of its own.",
    );
    expect(rows(planPicture({ op: "upload", item: "Nobody", art }, items, [], exists))).toBe(
      "There is no item Nobody.",
    );
  });

  test("a currency pile is set or cleared under the engine's name", () => {
    expect(rows(planPicture({ op: "pile", pile: "SmallGold", art }, items, [], exists))).toEqual([
      {
        ref: { dataset: "art", part: "items", key: "SmallGold" },
        op: "set",
        data: { name: "SmallGold", file: FILE, regX: 16, regY: -2 },
      },
    ]);
    expect(rows(planPicture({ op: "pile", pile: "SmallGold", art: null }, items, [], exists))).toBe(
      "SmallGold has no upload to take out.",
    );
  });
});
