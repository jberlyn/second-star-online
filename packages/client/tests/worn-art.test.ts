/**
 * Worn frame sets on the Content page (issue #29, stage 3): how files are sorted into frames or a
 * sheet and matched to layers, what the panel says and writes to the draft, how it stacks the
 * layer for the preview, and the bulk upload.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { ArtFrameId } from "@secondstaronline/data";
import {
  type ContentWornArtView,
  type Pixels,
  paperdollRulesOf,
  WORN_FRAMES,
  type WornChange,
} from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import {
  bulkFrameErrors,
  bulkMirrored,
  bulkTransparency,
  createWornArtPicker,
  createWornLayers,
  groupWornFiles,
  keptFrames,
  matchWornLayer,
  previewLook,
  previewStack,
  sheetFrame,
  wornFiles,
  wornItemText,
  wornLayerList,
  wornSource,
} from "../src/ui/worn-art.ts";

afterEach(() => document.body.replaceChildren());

const FILE = "a".repeat(64);
const SHIELD: ArtFrameId[] = [
  "f1-n",
  "f2-n",
  "f3-n",
  "f4-n",
  "f1-s",
  "f2-s",
  "f3-s",
  "f1-w",
  "f2-w",
  "f3-w",
  "f4-w",
];
const view = (over: Partial<ContentWornArtView> = {}): ContentWornArtView => ({
  items: [
    {
      name: "Star Shield",
      slot: "RightHand",
      layer: "Star Shield",
      aliases: [],
      ownLayerPossible: false,
    },
    {
      name: "Knight's Sword",
      slot: "LeftHand",
      layer: "Broad Sword",
      aliases: [{ index: 0, match: "exact", pattern: "Knight's Sword", becomes: "Broad Sword" }],
      ownLayerPossible: true,
    },
    {
      name: "Broad Sword",
      slot: "LeftHand",
      layer: "Broad Sword",
      aliases: [],
      ownLayerPossible: false,
    },
    {
      name: "Ruby Ring",
      slot: "Ring",
      layer: null,
      aliases: [{ index: 1, match: "contains", pattern: "Ring", becomes: "NOTHING" }],
      ownLayerPossible: false,
    },
    {
      name: "Old Helm",
      display: "Rusty Helm",
      slot: "Head",
      layer: "Old Helm",
      aliases: [],
      ownLayerPossible: false,
      retired: true,
    },
  ],
  layers: [
    {
      name: "Star Shield",
      needs: SHIELD,
      wornBy: [{ item: "Star Shield", slot: "RightHand" }],
      engine: [],
    },
    {
      name: "Broad Sword",
      needs: WORN_FRAMES.filter((f) => !["f1-n", "f2-n", "f3-n"].includes(f)),
      wornBy: [
        { item: "Knight's Sword", slot: "LeftHand" },
        { item: "Broad Sword", slot: "LeftHand" },
      ],
      engine: [],
    },
    { name: "DEFBOD", needs: [...WORN_FRAMES], wornBy: [], engine: ["every character"] },
  ],
  art: [{ name: "Star Shield", frames: { "f1-n": { file: FILE } }, mirrored: true }],
  packLayers: { "broad sword": ["f1-e"] },
  rules: {
    aliases: [
      { layer: "weapon", match: "exact", pattern: "Knight's Sword", becomes: "Broad Sword" },
      { layer: "gloves", match: "contains", pattern: "Ring", becomes: "NOTHING" },
    ],
    behaviours: [],
  },
  head: 1,
  ...over,
});

const noArt = {
  index: { atlases: { paperdoll: { sheets: [], sprites: {} } }, ui: {} },
  sheets: {},
  sprite: () => undefined,
  ui: () => "",
  loadGroup: async () => {},
} as unknown as Assets;

const frame = (w = 46, h = 45): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  data.set([200, 30, 30, 255], (10 * w + 10) * 4);
  return { width: w, height: h, data };
};
const stored = (n: number) => ({
  ok: true as const,
  stored: { file: String(n % 10).repeat(64), ext: "png" },
});
const tick = () => new Promise((r) => setTimeout(r, 10));

function choose(el: HTMLElement, action: string, files: File[]): void {
  const input = el.querySelector<HTMLInputElement>(`[data-action="${action}"]`);
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input?.dispatchEvent(new Event("change"));
}

describe("what the panel reads", () => {
  test("files are one sheet or frames named -f1-e; anything else is refused with why", () => {
    expect(wornFiles(["Moonblade.png"])).toEqual({ kind: "sheet", file: "Moonblade.png" });
    expect(wornFiles(["a-f1-e.png", "a-F2-S.png"])).toEqual({
      kind: "frames",
      frames: [
        { file: "a-f1-e.png", frame: "f1-e" },
        { file: "a-F2-S.png", frame: "f2-s" },
      ],
    });
    expect(wornFiles(["a-f1-e.png", "b.png"]).kind).toBe("bad");
    expect(wornFiles(["a-f1-e.png", "b-f1-e.png"])).toEqual({
      kind: "bad",
      error: "Two files are for f1-e.",
    });
  });

  test("bulk files group by the layer they name, and names match items, then layers", () => {
    expect(groupWornFiles(["Star-f1-e.png", "star-f2-e.png", "Moon.png"])).toEqual([
      { stem: "Star", files: ["Star-f1-e.png", "star-f2-e.png"] },
      { stem: "Moon", files: ["Moon.png"] },
    ]);
    const v = view();
    expect(matchWornLayer("knight's sword", v)).toEqual({ layer: "Broad Sword", by: "key" });
    expect(matchWornLayer("defbod", v)).toEqual({ layer: "DEFBOD", by: "layer" });
    expect(matchWornLayer("Ruby Ring", v)).toMatchObject({ layer: null });
    // Retired items take no new art.
    expect(matchWornLayer("Rusty Helm", v)).toMatchObject({ layer: null });
    expect(wornLayerList(v).map((l) => l.name)).toEqual(["Broad Sword", "DEFBOD", "Star Shield"]);
  });

  test("where a layer's frames come from, and what the panel says about an item", () => {
    const v = view();
    expect(wornSource(v, "star shield").kind).toBe("upload");
    expect(wornSource(v, "Broad Sword")).toEqual({ kind: "pack", frames: ["f1-e"] });
    expect(wornSource(v, "Axe")).toEqual({ kind: "none" });
    const knight = v.items[1] as ContentWornArtView["items"][number];
    expect(wornItemText(knight, v.layers[1])).toBe(
      'Worn as a weapon. It draws the layer Broad Sword, through the alias rule the exact name "Knight\'s Sword" becomes Broad Sword. It shares it with Broad Sword: an upload repaints them all.',
    );
    expect(wornItemText(v.items[3] as never, undefined)).toContain("draws nothing when worn");
  });

  test("the preview stacks the layer where the game does: a weapon facing west goes behind", () => {
    const v = view();
    const rules = paperdollRulesOf({
      behaviours: v.rules.behaviours,
      paperdoll: { aliases: v.rules.aliases },
    });
    const look = previewLook(v, { kind: "item", item: "Knight's Sword" }, "Broad Sword");
    const west = previewStack(rules, look, 1, "Broad Sword", "F1", "W");
    expect(west.map((l) => l.name)).toEqual([
      "BIM",
      "Broad Sword-F1-W",
      "DEFBOD-F1-W",
      "Bare Feet-F1-W",
      "Head1-F1-W",
    ]);
    expect(west[1]?.mine).toBe(true);
    // A layer nothing wears goes on top of the bare character.
    const loose = previewStack(
      rules,
      previewLook(v, { kind: "layer", layer: "Cape" }, "Cape"),
      1,
      "Cape",
      "F2",
      "S",
    );
    expect(loose.at(-1)).toEqual({ name: "Cape-F2-S", mine: true });
    expect(previewLook(v, { kind: "layer", layer: "Head7" }, "Head7")).toEqual({ head: 7 });
  });

  test("a sheet's cell is its frame", () => {
    const sheet = { width: 184, height: 180, data: new Uint8ClampedArray(184 * 180 * 4) };
    sheet.data.set([1, 2, 3, 255], ((45 + 5) * 184 + 46 * 3 + 7) * 4);
    const f = sheetFrame(sheet, "f4-e");
    expect([...f.data.subarray((5 * 46 + 7) * 4, (5 * 46 + 7) * 4 + 4)]).toEqual([1, 2, 3, 255]);
  });
});

describe("the panel", () => {
  test("frames join the saved upload's and go in the draft as the whole row", async () => {
    const sent: WornChange[] = [];
    const picker = createWornArtPicker({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "ok" };
      },
      saved: () => {},
    });
    document.body.append(picker.el);
    picker.show({ kind: "item", item: "Star Shield" }, view());
    await tick();
    expect(picker.el.textContent).toContain("It draws your upload (1 frame of the 11 it needs)");
    choose(picker.el, "worn-art-files", [
      new File([new Uint8Array(2)], "Star Shield-f2-n.png"),
      new File([new Uint8Array(3)], "star shield-F1-S.png"),
    ]);
    await tick();
    expect(picker.el.textContent).toContain("Publishing waits for f3-n, f4-n, f2-s, f3-s");
    picker.el.querySelector<HTMLButtonElement>('[data-action="worn-art-save"]')?.click();
    await tick();
    expect(sent).toEqual([
      {
        op: "set",
        layer: "Star Shield",
        frames: { "f1-n": FILE, "f2-n": "2".repeat(64), "f1-s": "3".repeat(64) },
        mirrored: true,
        transparency: "alpha",
      },
    ]);
  });

  test("a sheet is cut by the server and replaces every frame", async () => {
    const sent: WornChange[] = [];
    const cuts: string[] = [];
    const picker = createWornArtPicker({
      assets: noArt,
      upload: async () => stored(7),
      slice: async (sheet) => {
        cuts.push(sheet);
        return { ok: true, frames: { "f1-s": "b".repeat(64), "f2-s": "c".repeat(64) } };
      },
      decode: async () => frame(184, 180),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "ok" };
      },
      saved: () => {},
    });
    document.body.append(picker.el);
    picker.show({ kind: "layer", layer: "star shield" }, view());
    await tick();
    choose(picker.el, "worn-art-files", [new File([new Uint8Array(1)], "Star Shield.png")]);
    await tick();
    expect(cuts).toEqual(["7".repeat(64)]);
    picker.el.querySelector<HTMLButtonElement>('[data-action="worn-art-save"]')?.click();
    await tick();
    expect(sent[0]).toMatchObject({
      op: "set",
      layer: "Star Shield",
      frames: { "f1-s": "b".repeat(64), "f2-s": "c".repeat(64) },
    });
  });

  test("a sheet of the wrong size is refused before it is uploaded", async () => {
    let uploads = 0;
    const picker = createWornArtPicker({
      assets: noArt,
      upload: async () => {
        uploads += 1;
        return stored(1);
      },
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(100, 100),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
    });
    document.body.append(picker.el);
    picker.show({ kind: "item", item: "Broad Sword" }, view());
    choose(picker.el, "worn-art-files", [new File([new Uint8Array(1)], "sword.png")]);
    await tick();
    expect(uploads).toBe(0);
    expect(picker.el.textContent).toContain("sword.png is 100×100; a worn sheet is 184×180");
  });

  test("an aliased item can get its own layer; an item drawing nothing takes no upload", async () => {
    const sent: WornChange[] = [];
    const picker = createWornArtPicker({
      assets: noArt,
      upload: async () => stored(1),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "" };
      },
      saved: () => {},
    });
    document.body.append(picker.el);
    const own = () => picker.el.querySelector<HTMLButtonElement>('[data-action="worn-art-own"]');
    picker.show({ kind: "item", item: "Knight's Sword" }, view());
    expect(own()?.hidden).toBe(false);
    own()?.click();
    await tick();
    expect(sent).toEqual([{ op: "ownLayer", item: "Knight's Sword" }]);
    picker.show({ kind: "item", item: "Ruby Ring" }, view());
    expect(own()?.hidden).toBe(true);
    const files = picker.el.querySelector<HTMLInputElement>('[data-action="worn-art-files"]');
    expect(files?.parentElement?.hidden).toBe(true);
  });

  test("files still uploading for another layer are dropped when they arrive", async () => {
    let finish: () => void = () => {};
    const picker = createWornArtPicker({
      assets: noArt,
      upload: () =>
        new Promise((resolve) => {
          finish = () => resolve(stored(1));
        }),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
    });
    document.body.append(picker.el);
    picker.show({ kind: "item", item: "Broad Sword" }, view());
    choose(picker.el, "worn-art-files", [new File([new Uint8Array(1)], "x-f1-e.png")]);
    picker.show({ kind: "layer", layer: "DEFBOD" }, view());
    finish();
    await tick();
    expect(picker.pending()).toBe(false);
    expect(
      picker.el.querySelector<HTMLButtonElement>('[data-action="worn-art-save"]')?.hidden,
    ).toBe(true);
  });
});

describe("the Worn layers section", () => {
  test("lists every layer, and attaches sheets and frames to the layers they name", async () => {
    const sent: WornChange[] = [];
    const list = createWornLayers({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice: async () => ({ ok: true, frames: { "f2-s": "d".repeat(64) } }),
      decode: async (src) =>
        typeof src !== "string" && (src as File).name.endsWith("Sword.png")
          ? frame(184, 180)
          : frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "" };
      },
      saved: () => {},
    });
    document.body.append(list.el);
    list.setView(view());
    const rows = [...list.el.querySelectorAll<HTMLElement>('[data-action="worn-layers-open"]')];
    expect(rows.map((r) => r.dataset.key)).toEqual(["Broad Sword", "DEFBOD", "Star Shield"]);
    choose(list.el, "worn-layers-files", [
      new File([new Uint8Array(1)], "Knight's Sword.png"),
      new File([new Uint8Array(2)], "Star Shield-f2-n.png"),
      new File([new Uint8Array(3)], "Nobody-f1-e.png"),
    ]);
    await tick();
    expect(list.el.textContent).toContain("No item or layer is called Nobody.");
    list.el.querySelector<HTMLButtonElement>('[data-action="worn-layers-attach"]')?.click();
    await tick();
    await tick();
    expect(sent).toEqual([
      {
        op: "set",
        layer: "Broad Sword",
        frames: { "f2-s": "d".repeat(64) },
        mirrored: true,
        transparency: "alpha",
      },
      {
        op: "set",
        layer: "Star Shield",
        frames: { "f1-n": FILE, "f2-n": "2".repeat(64) },
        mirrored: true,
        transparency: "alpha",
      },
    ]);
  });
});

describe("checks before attaching (browser check fixes)", () => {
  test("a bulk line names a frame past the mirror line, or a sheet of the wrong size, before Attach", () => {
    const edge = frame();
    edge.data.set([200, 30, 30, 255], (3 * 46 + 45) * 4);
    const raws = new Map<string, Pixels | null>([["a-f2-n.png", edge]]);
    expect(bulkFrameErrors(["a-f2-n.png"], raws, true, "alpha")).toContain("past the mirror line");
    expect(bulkFrameErrors(["a-f2-n.png"], raws, false, "alpha")).toBe("");
    expect(bulkFrameErrors(["a.png"], new Map([["a.png", frame(100, 100)]]), true, "alpha")).toBe(
      "a.png is 100×100; a worn sheet is 184×180.",
    );
  });

  test("the bulk list waits on a bad frame and attaches nothing for it", async () => {
    const sent: WornChange[] = [];
    const edge = frame();
    edge.data.set([200, 30, 30, 255], (3 * 46 + 45) * 4);
    const list = createWornLayers({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => edge,
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "" };
      },
      saved: () => {},
    });
    document.body.append(list.el);
    list.setView(view());
    choose(list.el, "worn-layers-files", [new File([new Uint8Array(1)], "DEFBOD-f2-n.png")]);
    await tick();
    expect(list.el.textContent).toContain("past the mirror line");
    const attach = list.el.querySelector<HTMLButtonElement>('[data-action="worn-layers-attach"]');
    expect(attach?.disabled).toBe(true);
    // Unticking "1.6-style" means the frame is not flipped: it may go.
    const box = list.el.querySelector<HTMLInputElement>('[data-action="worn-layers-mirrored"]');
    if (box) {
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    }
    expect(attach?.disabled).toBe(false);
  });

  test("a save's answer stays when the page shows the same item again", async () => {
    const picker = createWornArtPicker({
      assets: noArt,
      upload: async () => stored(1),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async () => ({ ok: true, text: "Saved it." }),
      saved: () => {
        picker.clear();
        picker.show({ kind: "item", item: "Knight's Sword" }, view());
      },
    });
    document.body.append(picker.el);
    picker.show({ kind: "item", item: "Knight's Sword" }, view());
    picker.el.querySelector<HTMLButtonElement>('[data-action="worn-art-own"]')?.click();
    await tick();
    expect(picker.el.querySelector(".item-art-status")?.textContent).toBe("Saved it.");
  });
});

describe("review fixes (Sol)", () => {
  test("frames no wearer draws are left out of a save, and never hold it back", () => {
    const use = view().layers[1];
    expect(
      keptFrames(
        [
          ["f1-n", "a"],
          ["f1-e", "b"],
          ["f4-s", "c"],
        ] as [ArtFrameId, string][],
        use,
      ),
    ).toEqual([["f1-e", "b"]]);
    // A layer nothing wears keeps every frame but F4-S.
    expect(keptFrames([["f1-n", "a"]] as [ArtFrameId, string][], undefined)).toEqual([
      ["f1-n", "a"],
    ]);
    // A 47-wide F4-S, or an unused north frame of a weapon, is no error.
    const wide = frame(47, 45);
    expect(
      bulkFrameErrors(["x-f4-s.png"], new Map([["x-f4-s.png", wide]]), true, "alpha", use),
    ).toBe("");
    expect(
      bulkFrameErrors(["x-f1-n.png"], new Map([["x-f1-n.png", wide]]), true, "alpha", use),
    ).toBe("");
    expect(
      bulkFrameErrors(["x-f1-e.png"], new Map([["x-f1-e.png", wide]]), true, "alpha", use),
    ).toContain("47×45");
  });

  test("a sheet is checked and saved with its own transparency; frames with the upload's", () => {
    const green = frame(184, 180);
    for (let i = 0; i < green.data.length; i += 4) {
      green.data.set([0, 255, 0, 255], i);
    }
    const art = { name: "X", frames: {}, transparency: undefined };
    expect(bulkTransparency(["X.png"], new Map([["X.png", green]]), art)).toBe("green");
    expect(
      bulkTransparency(["X-f1-e.png"], new Map([["X-f1-e.png", green]]), {
        ...art,
        transparency: undefined,
      }),
    ).toBe("alpha");
  });

  test("files cannot be chosen while the saved frames load", async () => {
    let finish: (p: Pixels) => void = () => {};
    const picker = createWornArtPicker({
      assets: noArt,
      upload: async () => stored(1),
      slice: async () => ({ ok: false, error: "no" }),
      decode: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
    });
    document.body.append(picker.el);
    picker.show({ kind: "item", item: "Star Shield" }, view());
    const input = picker.el.querySelector<HTMLInputElement>('[data-action="worn-art-files"]');
    expect(input?.disabled).toBe(true);
    finish(frame());
    await tick();
    expect(input?.disabled).toBe(false);
  });

  test("a bulk line's layer is locked while the batch runs, and the open panel follows the draft", async () => {
    let release: () => void = () => {};
    const sent: WornChange[] = [];
    const list = createWornLayers({
      assets: noArt,
      upload: () =>
        new Promise((resolve) => {
          release = () => resolve(stored(2));
        }),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "" };
      },
      saved: () => {},
    });
    document.body.append(list.el);
    list.setView(view());
    choose(list.el, "worn-layers-files", [new File([new Uint8Array(1)], "DEFBOD-f2-s.png")]);
    await tick();
    list.el.querySelector<HTMLButtonElement>('[data-action="worn-layers-attach"]')?.click();
    await tick();
    const box = list.el.querySelector<HTMLInputElement>('[data-action="worn-layers-layer"]');
    expect(box?.disabled).toBe(true);
    release();
    await tick();
    expect(sent.map((c) => (c.op === "set" ? c.layer : c.op))).toEqual(["DEFBOD"]);
    // Opening Star Shield, then a new view with another frame: the panel shows the new one.
    list.el
      .querySelector<HTMLElement>('[data-action="worn-layers-open"][data-key="Star Shield"]')
      ?.click();
    await tick();
    const v = view();
    v.art = [{ name: "Star Shield", frames: { "f1-n": { file: FILE }, "f2-n": { file: FILE } } }];
    list.setView(v);
    await tick();
    expect(list.el.textContent).toContain("It draws your upload (2 frames of the 11 it needs)");
  });
});

describe("review fixes (Neon)", () => {
  test("frames joining an upload keep its mirrored setting; a sheet takes the box's", () => {
    const art = { name: "X", frames: {} };
    expect(bulkMirrored(["X-f1-e.png"], art, true)).toBe(false);
    expect(bulkMirrored(["X-f1-e.png"], { ...art, mirrored: true }, false)).toBe(true);
    expect(bulkMirrored(["X.png"], art, true)).toBe(true);
    expect(bulkMirrored(["X-f1-e.png"], undefined, true)).toBe(true);
  });

  test("a sheet's pure green cells are left out of the checks, as the server leaves them out", () => {
    const sheet = frame(184, 180);
    sheet.data.fill(0);
    // F1-N all pure green, with green in column 45 too.
    for (let y = 0; y < 45; y++) {
      for (let x = 0; x < 46; x++) {
        sheet.data.set([0, 255, 0, 255], (y * 184 + x) * 4);
      }
    }
    expect(bulkFrameErrors(["X.png"], new Map([["X.png", sheet]]), true, "alpha")).toBe("");
  });

  test("a saved frame the browser cannot read is kept when another is added", async () => {
    const sent: WornChange[] = [];
    let n = 0;
    const picker = createWornArtPicker({
      assets: noArt,
      upload: async () => stored(5),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => (n++ === 0 ? null : frame()),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "" };
      },
      saved: () => {},
    });
    document.body.append(picker.el);
    picker.show({ kind: "item", item: "Star Shield" }, view());
    await tick();
    expect(picker.el.textContent).toContain("f1-n could not be read for the preview; it is kept");
    choose(picker.el, "worn-art-files", [new File([new Uint8Array(1)], "x-f2-n.png")]);
    await tick();
    picker.el.querySelector<HTMLButtonElement>('[data-action="worn-art-save"]')?.click();
    await tick();
    expect(sent[0]).toMatchObject({ frames: { "f1-n": FILE, "f2-n": "5".repeat(64) } });
  });

  test("the section's panel shows the draft again after its own save", async () => {
    let current = view();
    const list = createWornLayers({
      assets: noArt,
      upload: async () => stored(3),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async () => {
        current = view({
          art: [{ name: "DEFBOD", frames: { "f1-e": { file: "3".repeat(64) } }, mirrored: true }],
        });
        return { ok: true, text: "Saved." };
      },
      saved: () => list.setView(current),
    });
    document.body.append(list.el);
    list.setView(current);
    list.el
      .querySelector<HTMLElement>('[data-action="worn-layers-open"][data-key="DEFBOD"]')
      ?.click();
    await tick();
    choose(list.el, "worn-layer-files", [new File([new Uint8Array(1)], "DEFBOD-f1-e.png")]);
    await tick();
    expect(list.pending()).toBe(true);
    list.el.querySelector<HTMLButtonElement>('[data-action="worn-layer-save"]')?.click();
    await tick();
    expect(list.pending()).toBe(false);
    expect(list.el.textContent).toContain("It draws your upload (1 frame of the 15 it needs)");
    expect(
      list.el.querySelector<HTMLButtonElement>('[data-action="worn-layer-remove"]')?.hidden,
    ).toBe(false);
  });

  test("an item that draws nothing, BIM and NOTHING are refused as a bulk line's layer", async () => {
    const list = createWornLayers({
      assets: noArt,
      upload: async () => stored(1),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
    });
    document.body.append(list.el);
    list.setView(view());
    choose(list.el, "worn-layers-files", [new File([new Uint8Array(1)], "Nobody-f1-e.png")]);
    await tick();
    const box = () => list.el.querySelector<HTMLInputElement>('[data-action="worn-layers-layer"]');
    const set = (v: string) => {
      const b = box();
      if (b) {
        b.value = v;
        b.dispatchEvent(new Event("change"));
      }
    };
    set("Ruby Ring");
    expect(list.el.textContent).toContain("Ruby Ring draws nothing when worn");
    set("BIM");
    expect(list.el.textContent).toContain("BIM is not a layer that can be uploaded.");
    set("Cape");
    expect(
      list.el.querySelector<HTMLButtonElement>('[data-action="worn-layers-attach"]')?.disabled,
    ).toBe(false);
  });

  test("a layer worn only by a retired item is previewed in its slot", () => {
    const v = view();
    expect(previewLook(v, { kind: "layer", layer: "Old Helm" }, "Old Helm")).toEqual({
      head: 1,
      equip: expect.objectContaining({ head: "Old Helm" }),
    });
  });
});
