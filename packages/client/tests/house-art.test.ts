/**
 * A house type's placement preview (issue #10): an uploaded ghost is drawn from the items atlas
 * with its anchor on the footprint's top-left corner, and the House types form's panel uploads
 * one, starts it on the building's bottom-left and saves it with the type as one change.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AtlasSprite } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  type ContentItemArtView,
  installContent,
  type PictureChange,
} from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { createHouseArtPanel, freshHouseAnchor, housePictureReport } from "../src/ui/house-art.ts";
import { drawGhost } from "../src/ui/placement.ts";

afterEach(() => {
  document.body.replaceChildren();
  installContent(buildContentStore(classicData));
});

const FILE = "b".repeat(64);
const PREVIEW = "Stone Guild Hall (placement)";

/** Classic with a Stone Guild Hall whose ghost is an uploaded picture. */
function withStoneHall(): void {
  const d = structuredClone(classicData) as ContentData;
  const small = d.houses.types.find((t) => t.house === "Small Guild Hall");
  if (!small) {
    throw new Error("no Small Guild Hall");
  }
  d.houses.types.push({
    ...small,
    house: "Stone Guild Hall",
    deed: "Stone Guild Hall Deed",
    ghost: { ...small.ghost, picture: PREVIEW },
  });
  installContent(buildContentStore(d));
}

describe("drawing an uploaded ghost", () => {
  test("its anchor goes on the footprint's top-left corner; the member is not drawn", () => {
    withStoneHall();
    const calls: { args: number[]; from: unknown }[] = [];
    const ctx = {
      drawImage: (from: unknown, ...a: number[]) => calls.push({ args: a, from }),
    } as unknown as CanvasRenderingContext2D;
    const sheet = {} as HTMLImageElement;
    const sprites: Record<string, AtlasSprite> = {
      [PREVIEW.toLowerCase()]: [0, 0, 0, 96, 120, 0, 24],
    };
    const assets = {
      sprite: (_g: string, n: string) => sprites[n.toLowerCase()],
      sheets: { items: [sheet] },
    } as unknown as Assets;
    const member = {} as HTMLImageElement;
    // Hovering (5, 5): the footprint's top-left tile is (4, 4), at playfield pixel (96, 96).
    drawGhost(
      ctx,
      { house: "Stone Guild Hall", slot: 3, tile: { x: 5, y: 5 }, img: member },
      assets,
    );
    expect(calls).toEqual([{ args: [0, 0, 96, 120, 96, 72, 96, 120], from: sheet }]);
    // A Classic house still draws its member at its stage rect.
    calls.length = 0;
    drawGhost(ctx, { house: "Small House", slot: 3, tile: { x: 5, y: 5 }, img: member }, assets);
    expect(calls).toEqual([{ args: [97, 94], from: member }]);
  });
});

describe("the placement preview panel", () => {
  const view = (over: Partial<ContentItemArtView> = {}): ContentItemArtView => ({
    items: [],
    art: [],
    currency: "Gold",
    maxSide: 512,
    packPictures: [],
    houseTypes: [
      { house: "Small Guild Hall", footprint: { w: 3, h: 3 }, member: 3 },
      { house: "Stone Guild Hall", footprint: { w: 3, h: 3 }, member: 3, picture: PREVIEW },
    ],
    ...over,
  });
  const noArt = {
    index: { atlases: { items: { sheets: [], sprites: {} } }, ui: {} },
    sheets: {},
    sprite: () => undefined,
    ui: (cast: string, member: number) => `/assets/ui/${cast}-${member}.png`,
    loadGroup: async () => {},
  } as unknown as Assets;
  /** A 96×128 picture: see-through, with an opaque block. */
  const PIXELS = (() => {
    const data = new Uint8ClampedArray(96 * 128 * 4);
    for (let i = 96 * 8; i < 96 * 128; i++) {
      data.set([120, 120, 128, 255], i * 4);
    }
    return { width: 96, height: 128, data };
  })();
  const $ = (el: HTMLElement, a: string) =>
    el.querySelector<HTMLElement>(`[data-action="${a}"]`) as HTMLElement;

  test("a fresh upload starts on the building's bottom-left, so a taller one rises above it", () => {
    expect(freshHouseAnchor(128, { h: 3 })).toEqual({ regX: 0, regY: 32 });
    expect(freshHouseAnchor(96, { h: 3 })).toEqual({ regX: 0, regY: 0 });
    // A building is bigger than a bag slot: only what stops it being drawn is said.
    expect(housePictureReport(PIXELS, "alpha", 512)).toMatchObject({ errors: [], warnings: [] });
  });

  test("uploads a picture and saves it with the house type; takes it out again", async () => {
    const sent: PictureChange[] = [];
    let saved = 0;
    const panel = createHouseArtPanel({
      assets: noArt,
      upload: async () => ({ ok: true, stored: { file: FILE, ext: "png" } }),
      decode: async () => PIXELS,
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "Small Guild Hall's placement preview is in the draft." };
      },
      saved: () => {
        saved += 1;
      },
    });
    document.body.append(panel.el);
    panel.show("small guild hall", view());
    expect(panel.el.hidden).toBe(false);
    expect(panel.el.textContent).toContain("built-in house picture 3");
    expect($(panel.el, "house-art-save").hidden).toBe(true);
    expect($(panel.el, "house-art-remove").hidden).toBe(true);

    const input = $(panel.el, "house-art-file") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([new Uint8Array(1)], "hall.png")],
    });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 10));
    expect(panel.pending()).toBe(true);
    expect(($(panel.el, "house-art-up") as HTMLInputElement).value).toBe("32");
    // Moved two pixels left.
    const left = $(panel.el, "house-art-left") as HTMLInputElement;
    left.value = "2";
    left.dispatchEvent(new Event("change"));
    $(panel.el, "house-art-save").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([
      {
        op: "house",
        house: "small guild hall",
        art: { file: FILE, transparency: "alpha", regX: 2, regY: 32 },
      },
    ]);
    expect(saved).toBe(1);
    expect(panel.el.textContent).toContain("placement preview is in the draft");

    // A type with an upload of its own offers to go back to the built-in picture.
    const v = view({ art: [{ name: PREVIEW, file: FILE, regX: 0, regY: 32 }] });
    panel.show("Stone Guild Hall", v);
    expect(panel.el.textContent).toContain("It shows your uploaded picture.");
    await new Promise((r) => setTimeout(r, 10));
    expect(panel.pending()).toBe(false);
    expect($(panel.el, "house-art-remove").hidden).toBe(false);
    $(panel.el, "house-art-remove").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.at(-1)).toEqual({ op: "house", house: "Stone Guild Hall", art: null });
  });

  test("a house type not saved yet shows no panel", () => {
    const panel = createHouseArtPanel({
      assets: noArt,
      upload: async () => ({ ok: false, error: "no" }),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
    });
    panel.show("Castle", view());
    expect(panel.el.hidden).toBe(true);
  });
});
