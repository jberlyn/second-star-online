/**
 * Item pictures on the Content page (issue #29, stage 2): what the picker writes to the draft,
 * how a bulk upload matches files to items, what it says about pool pictures, and the page
 * wiring (an item row shows the picker; the bulk list attaches pictures).
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AtlasSprite } from "@secondstaronline/data";
import type { ContentItemArtView, PictureChange } from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../src/assets.ts";
import {
  createItemArtPicker,
  createItemPictures,
  matchFiles,
  pictureExists,
  pictureSource,
  poolNotes,
  poolPictures,
} from "../src/ui/item-art.ts";

afterEach(() => document.body.replaceChildren());

const FILE = "a".repeat(64);
const view = (over: Partial<ContentItemArtView> = {}): ContentItemArtView => ({
  items: [
    { name: "Moonblade" },
    { name: "Starblade", sprite: "Long Sword" },
    { name: "Duskblade", sprite: "Moonblade" },
    { name: "Old Blade", retired: true },
    { name: "Ale", display: "Brown Ale" },
  ],
  art: [{ name: "Moonblade", file: FILE, regX: 6, regY: -6 }],
  currency: "Gold",
  maxSide: 512,
  packPictures: [],
  ...over,
});
const at = (v: ContentItemArtView, name: string) =>
  v.items.find((i) => i.name === name) as ContentItemArtView["items"][number];

describe("what the picker reads", () => {
  test("where the picture will come from: an upload, a pack, or nowhere", () => {
    const v = view({ packPictures: ["long sword"] });
    expect(pictureSource(at(v, "Duskblade"), v).kind).toBe("upload");
    expect(pictureSource(at(v, "Starblade"), v)).toEqual({ kind: "pack", name: "Long Sword" });
    expect(pictureSource(at(v, "Ale"), v)).toEqual({ kind: "none" });
  });

  test("a published upload the draft takes out is no longer a picture", () => {
    // The live atlas still has it; the draft's art rows and the packs decide.
    const v = view({ art: [], packPictures: [] });
    expect(pictureExists(v, "Moonblade")).toBe(false);
    expect(pictureSource(at(v, "Moonblade"), v)).toEqual({ kind: "none" });
  });
});

describe("bulk matching", () => {
  test("files match item keys, then the names players see, ignoring case; retired items take none", () => {
    const m = matchFiles(
      ["moonblade.png", "Brown Ale.PNG", "Old Blade.png", "Nothing.png"],
      view().items,
    );
    expect(m.map((x) => [x.file, x.item?.name ?? null, x.by])).toEqual([
      ["moonblade.png", "Moonblade", "key"],
      ["Brown Ale.PNG", "Ale", "display"],
      ["Old Blade.png", null, null],
      ["Nothing.png", null, null],
    ]);
  });
});

describe("pool pictures", () => {
  test("the views that show another picture are named", () => {
    expect(poolNotes({ name: "Crate" }, "Gold")).toEqual({
      bag: "In the bag it shows CrateBag, the picture every item like it shares.",
      ground: "On the ground it shows CratePic, the picture every item like it shares.",
    });
    expect(poolNotes({ name: "Blue Crystal", sprite: "Blue Crystals" }, "Gold")).toEqual({
      ground: "On the ground it shows BlueCrystal, the picture every item like it shares.",
    });
    expect(poolNotes({ name: "Gold" }, "Gold").ground).toContain("SmallGold (1 to 49)");
    expect(poolNotes({ name: "Long Sword" }, "Gold")).toEqual({});
  });
});

describe("a trimmed upload pasted by its corner", () => {
  test("starts where its visible pixels did in the picture", () => {
    const calls: number[][] = [];
    const ctx = {
      drawImage: (...a: unknown[]) => calls.push(a.slice(5) as number[]),
    } as unknown as CanvasRenderingContext2D;
    const sprites: Record<string, AtlasSprite> = {
      pile: [0, 0, 0, 10, 8, 4, 2, 11, 12],
      plain: [0, 0, 0, 10, 8, 4, 2],
    };
    const assets = {
      sprite: (_g: string, n: string) => sprites[n],
      sheets: { items: [{} as HTMLImageElement] },
    } as unknown as Assets;
    drawSprite(ctx, assets, "items", "pile", 100, 50, true);
    drawSprite(ctx, assets, "items", "plain", 100, 50, true);
    drawSprite(ctx, assets, "items", "pile", 100, 50);
    expect(calls).toEqual([
      [111, 62, 10, 8],
      [100, 50, 10, 8],
      [96, 48, 10, 8],
    ]);
  });
});

/** Assets with no art: previews draw nothing, which is all a test window can do. */
const noArt = {
  index: { atlases: { items: { sheets: [], sprites: {} } }, ui: {} },
  sheets: {},
  sprite: () => undefined,
  ui: () => "",
  loadGroup: async () => {},
} as unknown as Assets;

describe("the picker", () => {
  test("says where an item's picture comes from, and chooses an existing one", async () => {
    const sent: PictureChange[] = [];
    const picker = createItemArtPicker({
      assets: noArt,
      upload: async () => ({ ok: false, error: "no" }),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "Ale's picture is in the draft." };
      },
      saved: () => {},
    });
    document.body.append(picker.el);
    const v = view();
    picker.show(at(v, "Ale"), v);
    expect(picker.el.hidden).toBe(false);
    expect(picker.el.textContent).toContain("It has no picture yet");
    const choose = picker.el.querySelector<HTMLInputElement>('[data-action="item-art-choose"]');
    (choose as HTMLInputElement).value = "moonblade";
    picker.el.querySelector<HTMLButtonElement>('[data-action="item-art-use"]')?.click();
    await Promise.resolve();
    // Moonblade is an upload in this draft, so it can be chosen; the server writes the rows.
    expect(sent).toEqual([{ op: "choose", item: "Ale", picture: "Moonblade" }]);
    await Promise.resolve();
    expect(picker.el.textContent).toContain("Ale's picture is in the draft.");
    picker.show({ name: "Gold" }, v);
    expect(picker.el.querySelectorAll(".item-art-pile").length).toBe(3);
    picker.clear();
    expect(picker.el.hidden).toBe(true);
  });
});

describe("the bulk list", () => {
  test("lists the items with no picture, and opens one", () => {
    const opened: string[] = [];
    const list = createItemPictures({
      assets: noArt,
      upload: async () => ({ ok: false, error: "no" }),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
      openItem: (k) => opened.push(k),
    });
    document.body.append(list.el);
    list.setView(view());
    const rows = [...list.el.querySelectorAll<HTMLElement>('[data-action="item-pictures-open"]')];
    // Moonblade and Duskblade draw the upload; Starblade's Long Sword is in no pack here.
    expect(rows.map((r) => r.dataset.key)).toEqual(["Starblade", "Ale"]);
    rows[1]?.click();
    expect(opened).toEqual(["Ale"]);
  });
});

/** A 4×4 picture with a visible 2×2 middle. */
const PIXELS = (() => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (const i of [5, 6, 9, 10]) {
    data.set([200, 30, 30, 255], i * 4);
  }
  return { width: 4, height: 4, data };
})();
const stored = (n: number) => ({
  ok: true as const,
  stored: { file: String(n).repeat(64).slice(0, 64), ext: "png" },
});

describe("review fixes (issue #29 stage 2)", () => {
  test("two files for one item wait for the operator; Attach sends each change once", async () => {
    const sent: PictureChange[] = [];
    let release: () => void = () => {};
    const list = createItemPictures({
      assets: noArt,
      upload: async (f) => stored(f.size),
      decode: async () => PIXELS,
      apply: (c) => {
        sent.push(c);
        // The first answer waits, so a second click lands while the batch runs.
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, text: "" });
        });
      },
      saved: () => {},
      openItem: () => {},
    });
    document.body.append(list.el);
    list.setView(view({ art: [] }));
    const input = list.el.querySelector<HTMLInputElement>('[data-action="item-pictures-files"]');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File([new Uint8Array(1)], "Ale.png"),
        new File([new Uint8Array(2)], "brown ale.png"),
        new File([new Uint8Array(3)], "Moonblade.png"),
      ],
    });
    input?.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 10));
    const table = list.el.querySelector('table[aria-label="Pictures to attach"]');
    expect(table?.textContent).toContain("Another file is for Ale too");
    const attach = list.el.querySelector<HTMLButtonElement>('[data-action="item-pictures-attach"]');
    attach?.click();
    attach?.click();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.map((c) => (c.op === "upload" ? c.item : c.op))).toEqual(["Moonblade"]);
  });

  test("a file still uploading for another item is dropped when it arrives", async () => {
    let finish: () => void = () => {};
    const picker = createItemArtPicker({
      assets: noArt,
      upload: () =>
        new Promise((resolve) => {
          finish = () => resolve(stored(1));
        }),
      decode: async () => PIXELS,
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
    });
    document.body.append(picker.el);
    const v = view();
    picker.show(at(v, "Ale"), v);
    const input = picker.el.querySelector<HTMLInputElement>('[data-action="item-art-file"]');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([new Uint8Array(1)], "x.png")],
    });
    input?.dispatchEvent(new Event("change"));
    // The operator moves on to Moonblade before the upload answers.
    picker.show(at(v, "Old Blade"), v);
    finish();
    await new Promise((r) => setTimeout(r, 10));
    const save = picker.el.querySelector<HTMLButtonElement>('[data-action="item-art-save"]');
    expect(save?.hidden).toBe(true);
    expect(picker.el.textContent).not.toContain("x.png is uploaded");
  });

  test("the currency and items always drawn with shared pictures are not missing one", () => {
    const list = createItemPictures({
      assets: noArt,
      upload: async () => ({ ok: false, error: "no" }),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
      openItem: () => {},
    });
    document.body.append(list.el);
    const v = view();
    list.setView({ ...v, items: [...v.items, { name: "Gold" }, { name: "Crate" }] });
    const rows = [...list.el.querySelectorAll<HTMLElement>('[data-action="item-pictures-open"]')];
    expect(rows.map((r) => r.dataset.key)).toEqual(["Starblade", "Ale"]);
  });

  test("the shared pictures each view shows are named for the captions", () => {
    expect(poolPictures({ name: "Crate" }, "Gold")).toEqual({
      bag: "CrateBag",
      ground: "CratePic",
    });
    expect(poolPictures({ name: "Gold" }, "Gold").ground).toBe(
      "SmallGold, MediumGold or LargeGold",
    );
    expect(poolPictures({ name: "Long Sword" }, "Gold")).toEqual({});
  });
});
