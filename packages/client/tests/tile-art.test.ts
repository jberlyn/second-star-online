/**
 * The Tiles section (issue #29, stage 6): where a tile's picture comes from, who a repaint changes,
 * tilesets cut into new tiles and attached in one change, clashes, the panel's edits, and Discard
 * stopping a bulk attach before its next write.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  artRowFingerprint,
  type ContentTileArtView,
  type Pixels,
  type TileChange,
  tileFingerprint,
} from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import {
  bulkChanges,
  bulkLineError,
  bulkLinesFor,
  createTiles,
  filterTiles,
  tileRepaintText,
  tileSource,
  tilesetSizeError,
  tileUsedText,
} from "../src/ui/tile-art.ts";

afterEach(() => document.body.replaceChildren());

const FILE = "a".repeat(64);
const view = (over: Partial<ContentTileArtView> = {}): ContentTileArtView => ({
  catalogue: [
    { code: "G1", member: 1 },
    { code: "S3", name: "Tree", member: 55 },
    { code: "N2" },
    { code: "N2" },
    { code: "AA" },
  ],
  walkable: ["G1"],
  art: [{ code: "AA", file: FILE }],
  packTiles: ["g1", "s3", "n2"],
  refs: { g1: ["the blank map's ground"] },
  maps: { g1: { count: 22, names: Array.from({ length: 20 }, (_, i) => `x${i}y0`) } },
  next: "AB",
  ground: "G1",
  liveUploads: [],
  head: 1,
  ...over,
});

const noArt = {
  index: { atlases: { tiles: { sheets: [], sprites: {} } }, ui: {} },
  sheets: {},
  sprite: () => undefined,
  ui: () => "",
  loadGroup: async () => {},
} as unknown as Assets;

const solid = (w: number, h: number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data.set([10, 20, 30, 255], i * 4);
  }
  return { width: w, height: h, data };
};
const tick = () => new Promise((r) => setTimeout(r, 10));
function choose(el: HTMLElement, action: string, files: File[]): void {
  const input = el.querySelector<HTMLInputElement>(`[data-action="${action}"]`);
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input?.dispatchEvent(new Event("change"));
}
const click = (el: HTMLElement, a: string) =>
  el.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)?.click();
const png = (name: string) => new File([new Uint8Array(4)], name);

describe("what the section reads", () => {
  test("a tile's picture: its upload, the pack's, the pack's coming back, or none", () => {
    expect(tileSource(view(), "aa")).toEqual({ kind: "upload", art: { code: "AA", file: FILE } });
    expect(tileSource(view(), "G1")).toEqual({ kind: "pack" });
    expect(tileSource(view({ liveUploads: ["g1"] }), "G1")).toEqual({ kind: "comingBack" });
    expect(tileSource(view(), "ZZ")).toEqual({ kind: "none" });
  });

  test("the list shows each code once, filtered by code or name", () => {
    expect(filterTiles(view(), "").map((t) => t.code)).toEqual(["G1", "S3", "N2", "AA"]);
    expect(filterTiles(view(), "tree").map((t) => t.code)).toEqual(["S3"]);
  });

  test("a repaint names every map the view knows and the rest as a count", () => {
    expect(tileUsedText(view(), "g1")).toContain("on 22 maps (x0y0, x1y0");
    expect(tileUsedText(view(), "g1")).toContain("and 2 more");
    expect(tileUsedText(view(), "g1")).toContain("named by the blank map's ground");
    expect(tileRepaintText(view(), "S3")).toBe("Repaints S3, which no map uses yet.");
  });

  test("a tileset's size is checked before it is uploaded", () => {
    expect(tilesetSizeError(64, 32)).toBeNull();
    expect(tilesetSizeError(50, 32)).toContain("multiples of 32");
    expect(tilesetSizeError(4096, 32)).toContain("at most 2048");
  });

  test("a one-tile file named like a tile replaces it; a tileset's cells are new tiles", () => {
    const single = bulkLinesFor(
      "tree.png",
      [{ col: 0, row: 0, file: FILE }],
      { cols: 1, rows: 1 },
      "alpha",
      view(),
      true,
    );
    expect(single[0]).toMatchObject({ replaces: "S3", walkable: false, expect: null });
    const replaced = bulkLinesFor(
      "aa.png",
      [{ col: 0, row: 0, file: FILE }],
      { cols: 1, rows: 1 },
      "alpha",
      view(),
      true,
    );
    expect(replaced[0]?.expect).toBe(artRowFingerprint({ code: "AA", file: FILE }));
    const sheet = bulkLinesFor(
      "tree.png",
      [
        { col: 0, row: 0, file: FILE },
        { col: 1, row: 0, file: FILE },
      ],
      { cols: 2, rows: 1 },
      "green",
      view(),
      true,
    );
    expect(sheet.map((l) => [l.label, l.replaces, l.walkable])).toEqual([
      ["tree.png 1-1", null, true],
      ["tree.png 1-2", null, true],
    ]);
  });

  test("two lines for one tile clash; changes go as one add per transparency, then repaints", () => {
    const a = bulkLinesFor(
      "S3.png",
      [{ col: 0, row: 0, file: FILE }],
      { cols: 1, rows: 1 },
      "alpha",
      view(),
      false,
    );
    const b = bulkLinesFor(
      "Tree.png",
      [{ col: 0, row: 0, file: FILE }],
      { cols: 1, rows: 1 },
      "alpha",
      view(),
      false,
    );
    const lines = [...a, ...b];
    expect(bulkLineError(lines[0] as never, lines)).toContain("Another line also replaces S3");
    (lines[1] as { include: boolean }).include = false;
    expect(bulkLineError(lines[0] as never, lines)).toBe("");
    const fresh = [
      ...bulkLinesFor(
        "x.png",
        [
          { col: 0, row: 0, file: FILE },
          { col: 1, row: 0, file: FILE },
        ],
        { cols: 2, rows: 1 },
        "alpha",
        view(),
        true,
      ),
      ...bulkLinesFor(
        "y.png",
        [
          { col: 0, row: 0, file: FILE },
          { col: 1, row: 0, file: FILE },
        ],
        { cols: 2, rows: 1 },
        "green",
        view(),
        false,
      ),
      ...a,
    ];
    expect(bulkChanges(fresh).map((c) => [c.change.op, c.lines.length])).toEqual([
      ["add", 2],
      ["add", 2],
      ["set", 1],
    ]);
  });
});

describe("the section", () => {
  function section(
    sent: TileChange[],
    opts: {
      gate?: Promise<void>;
      decode?: (src: string | Blob) => Promise<Pixels | null>;
      upload?: Promise<void>;
      apply?: (c: TileChange) => Promise<{ ok: boolean; text: string; codes?: string[] }>;
    } = {},
  ) {
    const uploads: string[] = [];
    const s = createTiles({
      assets: noArt,
      upload: async (f) => {
        uploads.push(f.name);
        await opts.upload;
        return { ok: true, stored: { file: FILE, ext: "png" } };
      },
      // The last file uploaded decides the cut: aa.png is one tile, anything else two.
      slice: async () =>
        uploads.at(-1) === "aa.png"
          ? {
              ok: true,
              grid: { cols: 1, rows: 1 },
              cells: [{ col: 0, row: 0, file: "d".repeat(64) }],
            }
          : {
              ok: true,
              grid: { cols: 2, rows: 1 },
              cells: [
                { col: 0, row: 0, file: "b".repeat(64) },
                { col: 1, row: 0, file: "c".repeat(64) },
              ],
            },
      decode:
        opts.decode ?? (async (src) => (typeof src === "string" ? solid(32, 32) : solid(64, 32))),
      apply:
        opts.apply ??
        (async (c) => {
          sent.push(c);
          await opts.gate;
          return c.op === "add"
            ? { ok: true, text: "In the draft.", codes: c.tiles.map((_, i) => `Q${i}`) }
            : { ok: true, text: "In the draft." };
        }),
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    return { s, uploads };
  }

  test("a tileset's cells become new tiles, added in one change with the codes given back", async () => {
    const sent: TileChange[] = [];
    const { s } = section(sent);
    choose(s.el, "tiles-walkable", []);
    const walk = s.el.querySelector<HTMLInputElement>('[data-action="tiles-walkable"]');
    if (walk) {
      walk.checked = true;
    }
    choose(s.el, "tiles-files", [png("Forest.png")]);
    await tick();
    expect(s.pending()).toBe(true);
    expect(s.el.textContent).toContain("Forest.png 1-2");
    click(s.el, "tiles-attach");
    await tick();
    expect(sent).toEqual([
      {
        op: "add",
        transparency: "alpha",
        tiles: [
          { file: "b".repeat(64), walkable: true },
          { file: "c".repeat(64), walkable: true },
        ],
      },
    ]);
    expect(s.el.textContent).toContain("Tile Q1 is in the draft.");
    expect(s.pending()).toBe(false);
  });

  test("a picture the server would refuse is never uploaded", async () => {
    const sent: TileChange[] = [];
    const { s, uploads } = section(sent, { decode: async () => solid(50, 32) });
    choose(s.el, "tiles-files", [png("Odd.png")]);
    await tick();
    expect(uploads).toEqual([]);
    expect(s.el.textContent).toContain("multiples of 32");
  });

  test("Discard stops a bulk attach before its next write", async () => {
    const sent: TileChange[] = [];
    let open = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const { s } = section(sent, {
      gate,
      // Forest.png is a tileset; aa.png a one-tile file replacing AA.
      decode: async (src) =>
        typeof src !== "string" && (src as File).name === "aa.png" ? solid(32, 32) : solid(64, 32),
    });
    choose(s.el, "tiles-files", [png("Forest.png"), png("aa.png")]);
    await tick();
    expect(s.el.textContent).toContain("Repaints AA");
    click(s.el, "tiles-attach");
    await tick();
    // The new tiles' add is saving; the repaint of AA waits behind it.
    expect(sent.map((c) => c.op)).toEqual(["add"]);
    s.discard();
    open();
    await tick();
    expect(sent).toHaveLength(1);
    expect(s.pending()).toBe(false);
  });

  test("the panel saves a tile's name, walkability and flags", async () => {
    const sent: TileChange[] = [];
    const { s } = section(sent);
    s.open("s3");
    const name = s.el.querySelector<HTMLInputElement>('[data-action="tile-art-name"]');
    const save = s.el.querySelector<HTMLButtonElement>('[data-action="tile-art-save"]');
    expect(save?.disabled).toBe(true);
    if (name) {
      name.value = "Oak";
      name.dispatchEvent(new Event("input"));
    }
    const grave = s.el.querySelector<HTMLInputElement>('[data-action="tile-art-flag-grave"]');
    if (grave) {
      grave.checked = true;
      grave.dispatchEvent(new Event("change"));
    }
    expect(s.pending()).toBe(true);
    // A refresh while work is set up keeps it.
    s.setView(view());
    expect(name?.value).toBe("Oak");
    click(s.el, "tile-art-save");
    await tick();
    const v = view();
    expect(sent).toEqual([
      {
        op: "edit",
        code: "S3",
        name: "Oak",
        walkable: false,
        flags: ["grave"],
        // The tile as the panel showed it, so a stale panel is refused.
        seen: tileFingerprint(
          v.catalogue,
          v.walkable.map((c) => ({ code: c })),
          "S3",
        ),
      },
    ]);
  });

  test("a new picture must be 32×32; the repaint carries the upload it replaces", async () => {
    const sent: TileChange[] = [];
    let size = 33;
    const { s, uploads } = section(sent, { decode: async () => solid(size, 32) });
    s.open("AA");
    choose(s.el, "tile-art-file", [png("new.png")]);
    await tick();
    expect(uploads).toEqual([]);
    expect(s.el.textContent).toContain("a tile is exactly 32×32");
    size = 32;
    choose(s.el, "tile-art-file", [png("new.png")]);
    await tick();
    click(s.el, "tile-art-save-picture");
    await tick();
    expect(sent).toEqual([
      {
        op: "set",
        code: "AA",
        file: FILE,
        transparency: "alpha",
        expect: artRowFingerprint({ code: "AA", file: FILE }),
      },
    ]);
  });

  test("a tile in use cannot be taken out of the catalogue", () => {
    const { s } = section([]);
    s.open("G1");
    const del = s.el.querySelector<HTMLButtonElement>('[data-action="tile-art-delete"]');
    expect(del?.disabled).toBe(true);
    s.open("S3");
    expect(del?.disabled).toBe(false);
  });
});

describe("review fixes (stage 6)", () => {
  const blank = (): Pixels => ({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) });
  function mk(over: Parameters<typeof createTiles>[0] extends infer O ? Partial<O> : never) {
    const sent: TileChange[] = [];
    const s = createTiles({
      assets: noArt,
      upload: async () => ({ ok: true, stored: { file: FILE, ext: "png" } }),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => solid(32, 32),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "In the draft." };
      },
      saved: () => {},
      ...over,
    });
    document.body.append(s.el);
    s.setView(view());
    return { s, sent };
  }

  test("another admin's rename refreshes an untouched panel, and is not unsaved work", () => {
    const { s } = mk({});
    s.open("S3");
    const renamed = view({
      catalogue: view().catalogue.map((t) => (t.code === "S3" ? { ...t, name: "Oak" } : t)),
    });
    s.setView(renamed);
    expect(s.pending()).toBe(false);
    expect(s.el.querySelector<HTMLInputElement>('[data-action="tile-art-name"]')?.value).toBe(
      "Oak",
    );
  });

  test("a picture still uploading is unsaved work, and a refresh keeps it", async () => {
    let done = () => {};
    const gate = new Promise<void>((r) => {
      done = r;
    });
    const { s, sent } = mk({
      upload: async () => {
        await gate;
        return { ok: true, stored: { file: FILE, ext: "png" } };
      },
    });
    s.open("AA");
    choose(s.el, "tile-art-file", [png("new.png")]);
    await tick();
    expect(s.pending()).toBe(true);
    s.setView(view());
    done();
    await tick();
    click(s.el, "tile-art-save-picture");
    await tick();
    expect(sent.map((c) => c.op)).toEqual(["set"]);
  });

  test("a picture that shows nothing is refused before it is uploaded, and when its transparency hides it", async () => {
    const uploads: string[] = [];
    const { s } = mk({
      decode: async () => blank(),
      upload: async (f) => {
        uploads.push(f.name);
        return { ok: true, stored: { file: FILE, ext: "png" } };
      },
    });
    s.open("AA");
    choose(s.el, "tile-art-file", [png("blank.png")]);
    await tick();
    expect(uploads).toEqual([]);
    expect(s.el.textContent).toContain("shows nothing");
  });

  test("lines a failed attach did not save stay, to try again", async () => {
    let fail = true;
    const sent: TileChange[] = [];
    const s = createTiles({
      assets: noArt,
      upload: async () => ({ ok: true, stored: { file: FILE, ext: "png" } }),
      slice: async () => ({
        ok: true,
        grid: { cols: 2, rows: 1 },
        cells: [
          { col: 0, row: 0, file: "b".repeat(64) },
          { col: 1, row: 0, file: "c".repeat(64) },
        ],
      }),
      decode: async () => solid(64, 32),
      apply: async (c) => {
        sent.push(c);
        return fail
          ? { ok: false, text: "No tile codes left." }
          : { ok: true, text: "ok", codes: ["Q1", "Q2"] };
      },
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    choose(s.el, "tiles-files", [png("Forest.png")]);
    await tick();
    click(s.el, "tiles-attach");
    await tick();
    expect(s.el.textContent).toContain("Not saved: No tile codes left.");
    expect(s.pending()).toBe(true);
    fail = false;
    click(s.el, "tiles-attach");
    await tick();
    expect(sent).toHaveLength(2);
    expect(s.el.textContent).toContain("Tile Q2 is in the draft.");
  });

  test("a big tileset is attached as several changes", () => {
    const cells = Array.from({ length: 384 }, (_, i) => ({
      col: i % 24,
      row: Math.floor(i / 24),
      file: FILE,
    }));
    const lines = bulkLinesFor("Big.png", cells, { cols: 24, rows: 16 }, "alpha", view(), true);
    for (const l of lines) {
      l.name = "雪".repeat(80);
    }
    const changes = bulkChanges(lines);
    expect(changes.length).toBeGreaterThan(1);
    expect(changes.flatMap((c) => c.lines)).toHaveLength(384);
  });

  test("a file named after a name several tiles share must be named by code", () => {
    const v = view({
      catalogue: [
        { code: "A1", name: "Wall" },
        { code: "A2", name: "Wall" },
      ],
    });
    const lines = bulkLinesFor(
      "Wall.png",
      [{ col: 0, row: 0, file: FILE }],
      { cols: 1, rows: 1 },
      "alpha",
      v,
      true,
    );
    expect(bulkLineError(lines[0] as never, lines)).toContain("2 tiles are called that (A1, A2)");
  });

  test("the section offers a 32×32 template", () => {
    const { s } = mk({});
    expect(s.el.querySelector('[data-action="tiles-template"]')).not.toBeNull();
  });
});

describe("review fixes, second review (stage 6)", () => {
  function mk(over: Partial<Parameters<typeof createTiles>[0]> = {}, v = view()) {
    const sent: TileChange[] = [];
    const s = createTiles({
      assets: noArt,
      upload: async () => ({ ok: true, stored: { file: FILE, ext: "png" } }),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => solid(32, 32),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "In the draft." };
      },
      saved: () => {},
      ...over,
    });
    document.body.append(s.el);
    s.setView(v);
    return { s, sent };
  }
  const nameOf = (el: HTMLElement) =>
    el.querySelector<HTMLInputElement>('[data-action="tile-art-name"]') as HTMLInputElement;

  test("saving the picture keeps a rename being typed, and the rename then saves", async () => {
    const { s, sent } = mk();
    s.open("S3");
    const name = nameOf(s.el);
    name.value = "Oak";
    name.dispatchEvent(new Event("input"));
    choose(s.el, "tile-art-file", [png("new.png")]);
    await tick();
    click(s.el, "tile-art-save-picture");
    await tick();
    // The page refreshes with the new upload: the picture half catches up, the rename stays.
    const v = view({ art: [...view().art, { code: "S3", file: FILE }] });
    s.setView(v);
    expect(name.value).toBe("Oak");
    click(s.el, "tile-art-save");
    await tick();
    expect(sent.map((c) => c.op)).toEqual(["set", "edit"]);
    // The edit carries the tile as first shown: a picture saved from the same panel never makes
    // it stale.
    expect((sent[1] as { seen?: string | null }).seen).toBe(
      tileFingerprint(
        v.catalogue,
        v.walkable.map((c) => ({ code: c })),
        "S3",
      ),
    );
    // A repaint after that carries the new upload.
    choose(s.el, "tile-art-file", [png("again.png")]);
    await tick();
    click(s.el, "tile-art-save-picture");
    await tick();
    expect((sent[2] as { expect?: string | null }).expect).toBe(
      artRowFingerprint({ code: "S3", file: FILE }),
    );
  });

  test("taking a tile out closes its panel, with nothing left unsaved", async () => {
    const { s, sent } = mk();
    s.open("S3");
    click(s.el, "tile-art-delete");
    await tick();
    expect(sent.map((c) => c.op)).toEqual(["delete"]);
    expect(s.pending()).toBe(false);
    expect(s.el.querySelector<HTMLElement>(".tile-art")?.hidden).toBe(true);
    expect(s.el.textContent).toContain("In the draft.");
  });

  test("nothing is sent while a picture is still uploading", async () => {
    let done = () => {};
    const gate = new Promise<void>((r) => {
      done = r;
    });
    const { s } = mk({
      upload: async () => {
        await gate;
        return { ok: true, stored: { file: FILE, ext: "png" } };
      },
    });
    s.open("S3");
    choose(s.el, "tile-art-file", [png("new.png")]);
    await tick();
    for (const a of ["tile-art-delete", "tile-art-save-picture", "tile-art-save"]) {
      expect(s.el.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)?.disabled).toBe(true);
    }
    done();
    await tick();
  });

  test("a failed save does not refresh the page", async () => {
    let saves = 0;
    const { s } = mk({
      apply: async () => ({
        ok: false,
        text: "Not saved.",
        problems: [{ where: "tiles/walkable", message: "too short" }],
      }),
      saved: () => {
        saves += 1;
      },
    });
    s.open("S3");
    const name = nameOf(s.el);
    name.value = "Oak";
    name.dispatchEvent(new Event("input"));
    click(s.el, "tile-art-save");
    await tick();
    expect(saves).toBe(0);
    expect(s.el.textContent).toContain("tiles/walkable: too short");
  });

  test("an engine fixture's long code cannot be made walkable or painted", () => {
    const { s } = mk({}, view({ catalogue: [...view().catalogue, { code: "CHURCH" }] }));
    s.open("CHURCH");
    expect(
      s.el.querySelector<HTMLInputElement>('[data-action="tile-art-walkable"]')?.disabled,
    ).toBe(true);
    expect(s.el.querySelector<HTMLInputElement>('[data-action="tile-art-file"]')?.disabled).toBe(
      true,
    );
  });

  test("bulk: files wait for the view, names survive a redraw, and unticked lines are not unsaved", async () => {
    const s = createTiles({
      assets: noArt,
      upload: async () => ({ ok: true, stored: { file: FILE, ext: "png" } }),
      slice: async () => ({
        ok: true,
        grid: { cols: 2, rows: 1 },
        cells: [
          { col: 0, row: 0, file: "b".repeat(64) },
          { col: 1, row: 0, file: "c".repeat(64) },
        ],
      }),
      decode: async () => solid(64, 32),
      apply: async (c) => ({
        ok: true,
        text: "ok",
        codes: c.op === "add" ? c.tiles.map((_, i) => `Q${i}`) : [],
      }),
      saved: () => {},
    });
    document.body.append(s.el);
    // No view yet: the file input is off.
    expect(s.el.querySelector<HTMLInputElement>('[data-action="tiles-files"]')?.disabled).toBe(
      true,
    );
    s.setView(view());
    choose(s.el, "tiles-files", [png("Forest.png")]);
    await tick();
    const names = s.el.querySelectorAll<HTMLInputElement>('[data-action="tiles-name"]');
    (names[0] as HTMLInputElement).value = "Moss";
    (names[0] as HTMLInputElement).dispatchEvent(new Event("input"));
    // A refresh redraws the table; the typed name stays.
    s.setView(view());
    expect(s.el.querySelector<HTMLInputElement>('[data-action="tiles-name"]')?.value).toBe("Moss");
    const ticks = s.el.querySelectorAll<HTMLInputElement>('[data-action="tiles-include"]');
    (ticks[1] as HTMLInputElement).checked = false;
    (ticks[1] as HTMLInputElement).dispatchEvent(new Event("change"));
    click(s.el, "tiles-attach");
    await tick();
    expect(s.pending()).toBe(false);
  });
});
