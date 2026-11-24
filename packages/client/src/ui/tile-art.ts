/**
 * Tiles on the Content page (issue #29, stage 6): a Tiles section that lists every tile in the
 * catalogue with its picture, opens a panel for one (its picture, name, whether it is walkable,
 * its flags, taking it out of the catalogue), and adds many tiles at once from tilesets: every
 * 32×32 cell of a sheet that shows something becomes a new tile, its code given by the server.
 *
 * What the section writes goes through the `contentTile` intent; publishing the draft makes it
 * live (the World Editor's palette and the maps on screen follow). A tile is pasted at its cell's
 * top-left, so its picture is exactly 32×32.
 */
import type { ArtTile } from "@secondstaronline/data";
import {
  artRowFingerprint,
  type ContentTileArtView,
  chunkNewTiles,
  guessTransparency,
  isTileCode,
  matchTile,
  PAPERDOLL_REG,
  type PictureTransparency,
  type Pixels,
  paperdollLayersWith,
  TILE_FLAGS,
  TILE_SHEET_MAX,
  TILE_SIZE,
  type TileChange,
  type TileFlagName,
  type TileRow,
  tileFingerprint,
  tileSheetGrid,
  tileShows,
  tileStem,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action } from "./action.ts";
import { type StoredUpload, uploadUrl } from "./art-uploads.ts";
import { createTable, formField, panelButton } from "./control-panel-kit.ts";
import { keyed, loadPixels, templateLink } from "./item-art.ts";
import { pixelCanvas } from "./worn-art.ts";

// ---- what the section reads (pure) ------------------------------------------------------------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The draft's upload for a tile, if any. */
export const tileUpload = (view: ContentTileArtView, code: string): ArtTile | undefined =>
  view.art.find((a) => same(a.code, code));

/** Where a tile's picture will come from once the draft is published. */
export type TileSource =
  | { kind: "upload"; art: ArtTile }
  | { kind: "pack" }
  /** The draft takes out a published upload, so the pack's picture comes back on publish. */
  | { kind: "comingBack" }
  | { kind: "none" };

export function tileSource(view: ContentTileArtView, code: string): TileSource {
  const art = tileUpload(view, code);
  if (art) {
    return { kind: "upload", art };
  }
  const k = code.toLowerCase();
  if (view.liveUploads.includes(k)) {
    return view.packTiles.includes(k) ? { kind: "comingBack" } : { kind: "none" };
  }
  return view.packTiles.includes(k) ? { kind: "pack" } : { kind: "none" };
}

/** Whether the draft has a tile walkable. */
export const tileWalkable = (view: ContentTileArtView, code: string): boolean =>
  view.walkable.some((w) => same(w, code));

/** The catalogue's tiles, one per code (Classic lists N2 twice), in catalogue order. */
export function uniqueTiles(view: ContentTileArtView): TileRow[] {
  const seen = new Set<string>();
  const out: TileRow[] = [];
  for (const t of view.catalogue) {
    if (!seen.has(t.code.toLowerCase())) {
      seen.add(t.code.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/** The tiles a filter shows: by code or name, case ignored ("" shows every tile). */
export function filterTiles(view: ContentTileArtView, query: string): TileRow[] {
  const q = query.trim().toLowerCase();
  const all = uniqueTiles(view);
  if (q === "") {
    return all;
  }
  return all.filter(
    (t) => t.code.toLowerCase().includes(q) || (t.name ?? "").toLowerCase().includes(q),
  );
}

/** Where a tile is used, every map named that the view names: "on 2 maps (x1y1, x2y2)". */
export function tileUsedText(view: ContentTileArtView, code: string): string {
  const k = code.toLowerCase();
  const parts: string[] = [];
  const m = view.maps[k];
  if (m && m.count > 0) {
    const more = m.count - m.names.length;
    parts.push(
      `on ${m.count === 1 ? "1 map" : `${m.count} maps`} (${m.names.join(", ")}${more > 0 ? ` and ${more} more` : ""})`,
    );
  }
  const refs = view.refs[k] ?? [];
  if (refs.length > 0) {
    parts.push(`named by ${refs.join(", ")}`);
  }
  return parts.join("; ");
}

/** Who a repaint changes: "Repaints G1 on 3 maps (…)." */
export function tileRepaintText(view: ContentTileArtView, code: string): string {
  const used = tileUsedText(view, code);
  return used ? `Repaints ${code} ${used}.` : `Repaints ${code}, which no map uses yet.`;
}

/** Why a picture cannot be a tileset, or null when it can (sides multiples of 32, ≤ 2048). */
export function tilesetSizeError(width: number, height: number): string | null {
  const g = tileSheetGrid(width, height);
  return typeof g === "string" ? g : null;
}

/** One tile a bulk upload found: a 32×32 cell of a file, and what it becomes. */
export interface TileBulkLine {
  /** Which file and cell it came from ("Grass.png", or "Forest.png 2-3"). */
  label: string;
  file: string;
  transparency: PictureTransparency;
  /** An existing tile it replaces (a one-tile file named after its code or name), or null: new. */
  replaces: string | null;
  /** The line is attached (new, or replacing `replaces`) when ticked. */
  include: boolean;
  name: string;
  walkable: boolean;
  /** The replaced tile's upload as the line saw it, for the stale-save check. */
  expect: string | null;
  /** The tiles a one-tile file's name matches when several share it (it must be named by code). */
  ambiguous: string[];
  /** What the line became once saved; empty until then. */
  done: string;
  /** Why the last attach did not save it (it stays, to try again). */
  error: string;
}

/** The lines one cut file makes: a one-tile file named like a tile replaces it; the rest are new. */
export function bulkLinesFor(
  fileName: string,
  cells: readonly { col: number; row: number; file: string }[],
  grid: { cols: number; rows: number },
  transparency: PictureTransparency,
  view: ContentTileArtView,
  walkable: boolean,
): TileBulkLine[] {
  const stem = tileStem(fileName);
  const single = grid.cols === 1 && grid.rows === 1;
  const match = single ? matchTile(stem, uniqueTiles(view)) : { kind: "new" as const };
  return cells.map((c) => {
    const replaces = match.kind === "tile" ? match.code : null;
    const ambiguous = match.kind === "ambiguous" ? match.codes : [];
    return {
      label: single ? fileName : `${fileName} ${c.row + 1}-${c.col + 1}`,
      file: c.file,
      transparency,
      replaces,
      include: true,
      name: "",
      walkable: replaces ? tileWalkable(view, replaces) : walkable,
      expect: replaces ? artRowFingerprint(tileUpload(view, replaces)) : null,
      ambiguous,
      done: "",
      error: "",
    };
  });
}

/** Why a line cannot be attached as it is, or "" when it can. */
export function bulkLineError(line: TileBulkLine, lines: readonly TileBulkLine[]): string {
  if (!line.include || line.done) {
    return "";
  }
  if (line.ambiguous.length > 0) {
    return `${line.ambiguous.length} tiles are called that (${line.ambiguous.join(", ")}): name the file after the code of the one it replaces, or untick it.`;
  }
  if (line.replaces !== null) {
    // Lines clash by where they write: two files for the same tile.
    const clash = lines.some(
      (o) =>
        o !== line &&
        o.include &&
        !o.done &&
        o.replaces !== null &&
        same(o.replaces, line.replaces as string),
    );
    if (clash) {
      return `Another line also replaces ${line.replaces}: untick one.`;
    }
  }
  return "";
}

/**
 * The changes a bulk attach sends, worked out when Attach is pressed: the new tiles as `add`
 * changes per transparency, each small enough for one frame (`chunkNewTiles`) and making all its
 * codes at once, then one `set` per replaced tile.
 */
export function bulkChanges(lines: readonly TileBulkLine[]): {
  change: TileChange;
  lines: TileBulkLine[];
}[] {
  const out: { change: TileChange; lines: TileBulkLine[] }[] = [];
  for (const t of ["alpha", "green"] as const) {
    const fresh = lines.filter(
      (l) => l.include && !l.done && l.replaces === null && l.transparency === t,
    );
    const tiles = fresh.map((l) => ({
      file: l.file,
      walkable: l.walkable,
      ...(l.name.trim() ? { name: l.name.trim() } : {}),
    }));
    let at = 0;
    for (const chunk of chunkNewTiles(tiles)) {
      out.push({
        change: { op: "add", transparency: t, tiles: chunk },
        lines: fresh.slice(at, at + chunk.length),
      });
      at += chunk.length;
    }
  }
  for (const l of lines) {
    if (l.include && !l.done && l.replaces !== null) {
      out.push({
        change: {
          op: "set",
          code: l.replaces,
          file: l.file,
          transparency: l.transparency,
          expect: l.expect,
        },
        lines: [l],
      });
    }
  }
  return out;
}

/** What the section says about tiles. */
export const TILE_RULES = `A tile is a ${TILE_SIZE}×${TILE_SIZE} picture, pasted at its square's top-left on any layer. Upload a single ${TILE_SIZE}×${TILE_SIZE} PNG, or a tileset: a PNG whose sides are multiples of ${TILE_SIZE} (at most ${TILE_SHEET_MAX}), where every square that shows something becomes a tile of its own. The server gives each new tile its code, and a code never changes. A one-tile file named after a tile's code or name replaces that tile's picture instead. Transparency is the picture's own, or 1.6's pure green. The template is one tile of pure green: the whole square is the tile, and whatever you leave green is see-through; for a tileset, set squares like it side by side.`;

// ---- the section ------------------------------------------------------------------------------

export interface TilesOptions {
  assets: Assets;
  /** Uploads one PNG; the stored file, or why it was refused. */
  upload(file: File): Promise<{ ok: true; stored: StoredUpload } | { ok: false; error: string }>;
  /** Cuts an uploaded tileset into tile files (nothing goes in the draft). */
  slice(
    sheet: string,
    transparency: PictureTransparency,
  ): Promise<
    | {
        ok: true;
        grid: { cols: number; rows: number };
        cells: { col: number; row: number; file: string }[];
      }
    | { ok: false; error: string }
  >;
  /** Puts one tile change in the draft (the server makes it as a whole). */
  apply(change: TileChange): Promise<{
    ok: boolean;
    text: string;
    codes?: string[];
    problems?: { where: string; message: string }[];
  }>;
  decode?(src: string | Blob): Promise<Pixels | null>;
  /** The draft changed: the page refreshes. */
  saved(): void;
}

export interface Tiles {
  readonly el: HTMLElement;
  setView(view: ContentTileArtView): void;
  /** Work set up but not saved: a picture or changes in the panel, or files waiting to attach. */
  pending(): boolean;
  /** Drops that work, and stops a bulk attach before its next write. */
  discard(): void;
  reset(): void;
  /** Opens a tile's panel (tests and links). */
  open(code: string): void;
}

/** How many tiles the list shows before "Show more". */
export const TILES_SHOWN = 120;

/** The bare player standing on a tile, for the walkable preview. */
const bareLayers = (head: number) =>
  paperdollLayersWith({ aliases: [], has: () => false }, { head }, "F2", "S").filter(
    (l) => !same(l, "BIM"),
  );

export function createTiles(opts: TilesOptions): Tiles {
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("div");
  el.className = "item-pictures tiles";
  let view: ContentTileArtView | null = null;

  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = TILE_RULES;

  /** Draft uploads, decoded once each (by file hash). */
  const uploads = new Map<string, Promise<Pixels | null>>();
  const uploadPixels = (art: ArtTile): Promise<Pixels | null> => {
    let p = uploads.get(art.file);
    if (!p) {
      p = decode(uploadUrl({ file: art.file, ext: "png" })).catch(() => null);
      uploads.set(art.file, p);
    }
    return p.then((raw) => (raw ? keyed(raw, art.transparency ?? "alpha") : null));
  };

  /** Draws a tile's picture as the draft would publish it at (x, y) of `ctx`, scaled. */
  const drawTile = async (
    ctx: CanvasRenderingContext2D,
    code: string,
    x: number,
    y: number,
    scale = 1,
  ): Promise<void> => {
    if (!view) {
      return;
    }
    const src = tileSource(view, code);
    if (src.kind === "upload") {
      const px = await uploadPixels(src.art);
      if (px) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(pixelCanvas(px), x, y, TILE_SIZE * scale, TILE_SIZE * scale);
      }
      return;
    }
    if (src.kind === "pack") {
      await opts.assets.loadGroup("tiles").catch(() => {});
      if (scale === 1) {
        drawSprite(ctx, opts.assets, "tiles", code, x, y, true);
      } else {
        const c = document.createElement("canvas");
        c.width = TILE_SIZE;
        c.height = TILE_SIZE;
        const cx = c.getContext("2d");
        if (cx) {
          drawSprite(cx, opts.assets, "tiles", code, 0, 0, true);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(c, x, y, TILE_SIZE * scale, TILE_SIZE * scale);
        }
      }
    }
  };

  // ---- the list -------------------------------------------------------------------------------

  const filter = action(document.createElement("input"), "tiles-filter");
  filter.type = "search";
  filter.placeholder = "Code or name";
  let shown = TILES_SHOWN;
  filter.addEventListener("input", () => {
    shown = TILES_SHOWN;
    drawList();
  });
  const list = document.createElement("div");
  list.className = "tiles-list";
  list.setAttribute("role", "list");
  const more = panelButton("tiles-more", "Show more", () => {
    shown += TILES_SHOWN;
    drawList();
  });
  /** What happened to a tile whose panel closed (taken out of the catalogue). */
  const listStatus = document.createElement("p");
  listStatus.className = "item-art-status";
  listStatus.setAttribute("role", "status");
  let listSeq = 0;
  function drawList(): void {
    const mine = ++listSeq;
    list.replaceChildren();
    if (!view) {
      more.hidden = true;
      return;
    }
    const tiles = filterTiles(view, filter.value);
    for (const t of tiles.slice(0, shown)) {
      const b = action(document.createElement("button"), "tiles-open");
      b.type = "button";
      b.className = "tiles-tile";
      b.dataset.code = t.code;
      b.setAttribute("role", "listitem");
      b.setAttribute("aria-label", `Tile ${t.code}${t.name ? `, ${t.name}` : ""}`);
      const c = document.createElement("canvas");
      c.width = TILE_SIZE;
      c.height = TILE_SIZE;
      const label = document.createElement("span");
      label.textContent = t.name ? `${t.code} · ${t.name}` : t.code;
      b.append(c, label);
      b.addEventListener("click", () => showTile(t.code));
      list.append(b);
      const ctx = c.getContext("2d");
      if (ctx) {
        void (async () => {
          if (mine === listSeq) {
            await drawTile(ctx, t.code, 0, 0);
          }
        })();
      }
    }
    more.hidden = tiles.length <= shown;
  }

  // ---- the panel ------------------------------------------------------------------------------

  const panel = document.createElement("div");
  panel.className = "item-art tile-art";
  panel.hidden = true;
  const title = document.createElement("h4");
  title.className = "item-art-title";
  const source = document.createElement("p");
  source.className = "item-art-rules";
  const used = document.createElement("p");
  used.className = "item-art-rules";
  const preview = document.createElement("canvas");
  preview.className = "tile-art-preview";
  preview.width = 3 * TILE_SIZE + 16 + 3 * TILE_SIZE * 2;
  preview.height = 3 * TILE_SIZE;
  preview.setAttribute("aria-label", "The tile in a patch of itself and beside the map's ground");

  const nameInput = action(document.createElement("input"), "tile-art-name");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  const walkInput = action(document.createElement("input"), "tile-art-walkable");
  walkInput.type = "checkbox";
  const walkLabel = document.createElement("label");
  walkLabel.className = "item-art-check";
  walkLabel.append(walkInput, " Walkable: players on foot can stand on it");
  const flagInputs = new Map<TileFlagName, HTMLInputElement>();
  const flagsRow = document.createElement("div");
  flagsRow.className = "content-buttons";
  const FLAG_TEXT: Record<TileFlagName, string> = {
    sea: "Sea (sea creatures swim here; boats sail on layer 1)",
    airshipBlock: "Blocks an Airship (layer 2)",
    dock: "Airship dock (layer 1)",
    arena: "Arena challenge tile (layer 1)",
    grave: "Grave for Raise Dead (layer 2)",
  };
  for (const f of TILE_FLAGS) {
    const input = action(document.createElement("input"), `tile-art-flag-${f}`);
    input.type = "checkbox";
    const l = document.createElement("label");
    l.className = "item-art-check";
    l.append(input, ` ${FLAG_TEXT[f]}`);
    flagInputs.set(f, input);
    flagsRow.append(l);
    input.addEventListener("change", updateButtons);
  }
  nameInput.addEventListener("input", updateButtons);
  walkInput.addEventListener("change", () => {
    updateButtons();
    void drawPreview();
  });

  const pictureFile = action(document.createElement("input"), "tile-art-file");
  pictureFile.type = "file";
  pictureFile.accept = ".png,image/png";
  pictureFile.setAttribute("aria-label", `A new ${TILE_SIZE}×${TILE_SIZE} picture for the tile`);
  const transparencySel = action(document.createElement("select"), "tile-art-transparency");
  for (const [v, label] of [
    ["alpha", "Its own transparency"],
    ["green", "Pure green is see-through (1.6)"],
  ] as const) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    transparencySel.append(o);
  }
  transparencySel.addEventListener("change", () => {
    if (picked) {
      picked.transparency = transparencySel.value as PictureTransparency;
      status.textContent = tileShows(picked.raw, picked.transparency)
        ? "The picture is ready: save it to put it in the draft."
        : "With this transparency the picture shows nothing: a tile that shows nothing leaves a hole in the map.";
      updateButtons();
      void drawPreview();
    }
  });
  const repaint = document.createElement("p");
  repaint.className = "item-art-rules";
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");

  const saveEdit = panelButton("tile-art-save", "Save changes", () => void doEdit(), "primary");
  const savePicture = panelButton(
    "tile-art-save-picture",
    "Save the picture",
    () => void doPicture(),
    "primary",
  );
  const removeUpload = panelButton("tile-art-remove", "Take the upload out", () => void doRemove());
  const deleteTile = panelButton(
    "tile-art-delete",
    "Take the tile out of the catalogue",
    () => void doDelete(),
    "danger",
  );
  const close = panelButton("tile-art-close", "Close", () => clearPanel());
  const editButtons = document.createElement("div");
  editButtons.className = "content-buttons";
  editButtons.append(saveEdit);
  const pictureButtons = document.createElement("div");
  pictureButtons.className = "content-buttons";
  pictureButtons.append(savePicture, removeUpload);
  const endButtons = document.createElement("div");
  endButtons.className = "content-buttons";
  endButtons.append(deleteTile, close);

  panel.append(
    title,
    source,
    used,
    preview,
    formField("Name (the hover tip shows it on layer 2; leave empty for scenery)", nameInput),
    walkLabel,
    flagsRow,
    editButtons,
    formField("New picture", pictureFile),
    formField("Transparency", transparencySel),
    repaint,
    pictureButtons,
    endButtons,
    status,
  );

  /**
   * The tile the panel shows, its upload's fingerprint and the whole tile's (`tileFingerprint`)
   * as they were shown, and the fields as they were filled in, so only the operator's own typing
   * counts as unsaved (another admin's rename refreshes an untouched panel).
   */
  let code: string | null = null;
  let expect: string | null = null;
  let seen: string | null = null;
  let filled: { name: string; walkable: boolean; flags: string } | null = null;
  /** A picture chosen in the panel, not yet saved, and one still being read or uploaded. */
  let picked: { file: string; raw: Pixels; transparency: PictureTransparency } | null = null;
  let picking = false;
  let generation = 0;
  let busy = false;

  const row = (): TileRow | undefined =>
    code && view ? view.catalogue.find((t) => same(t.code, code as string)) : undefined;
  const flagsChosen = (): TileFlagName[] => TILE_FLAGS.filter((f) => flagInputs.get(f)?.checked);
  const fields = () => ({
    name: nameInput.value.trim(),
    walkable: walkInput.checked,
    flags: flagsChosen().sort().join(","),
  });
  const editChanged = (): boolean => {
    if (!filled || code === null) {
      return false;
    }
    const f = fields();
    return f.name !== filled.name || f.walkable !== filled.walkable || f.flags !== filled.flags;
  };
  const pictureShows = () => picked !== null && tileShows(picked.raw, picked.transparency);

  function updateButtons(): void {
    const has = code !== null && view !== null;
    // An engine fixture's longer code can be named and flagged, but not walked on or painted.
    const tileCode = code !== null && isTileCode(code);
    // While a picture is being read or uploaded, nothing else is sent: its answer could cross.
    const held = busy || picking;
    saveEdit.disabled = held || !has || !editChanged();
    savePicture.disabled = held || !has || !pictureShows();
    removeUpload.hidden = !(has && view && code && tileUpload(view, code));
    removeUpload.disabled = held;
    const usedNow = has && view && code ? tileUsedText(view, code) : "";
    deleteTile.disabled = held || !has || usedNow !== "";
    deleteTile.title = usedNow ? `Still used ${usedNow}` : "";
    pictureFile.disabled = busy || !tileCode;
    transparencySel.disabled = !tileCode;
    walkInput.disabled = !tileCode;
  }

  async function drawPreview(): Promise<void> {
    const mine = generation;
    const ctx = preview.getContext("2d");
    if (!ctx || !view || !code) {
      return;
    }
    ctx.clearRect(0, 0, preview.width, preview.height);
    const at = async (c: string, x: number, y: number, scale: number) => {
      if (c === code && picked) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          pixelCanvas(keyed(picked.raw, picked.transparency)),
          x,
          y,
          TILE_SIZE * scale,
          TILE_SIZE * scale,
        );
      } else {
        await drawTile(ctx, c, x, y, scale);
      }
    };
    // A 3×3 patch of the tile at 1×, then the tile between the map's ground at 2×.
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        await at(code, x * TILE_SIZE, y * TILE_SIZE, 1);
        if (mine !== generation) {
          return;
        }
      }
    }
    const left = 3 * TILE_SIZE + 16;
    for (let x = 0; x < 3; x++) {
      await at(x === 1 ? code : view.ground, left + x * TILE_SIZE * 2, TILE_SIZE / 2, 2);
      if (mine !== generation) {
        return;
      }
    }
    // A walkable tile has a player standing on the patch's middle.
    if (walkInput.checked) {
      await opts.assets.loadGroup("paperdoll").catch(() => {});
      if (mine !== generation) {
        return;
      }
      const px = TILE_SIZE + 16;
      const py = TILE_SIZE - 2;
      for (const l of bareLayers(view.head)) {
        drawSprite(
          ctx,
          opts.assets,
          "paperdoll",
          l,
          px - PAPERDOLL_REG.x,
          py - PAPERDOLL_REG.y,
          true,
        );
      }
    }
  }

  /** What the panel says about the tile: its title, where its picture comes from, its uses. */
  function fillInfo(): void {
    if (!view || !code) {
      return;
    }
    const r = row();
    title.textContent = r?.name ? `Tile ${code} · ${r.name}` : `Tile ${code}`;
    const src = tileSource(view, code);
    source.textContent = !isTileCode(code)
      ? `${code} is an engine fixture's name, not a 2-character tile code: it can be named and flagged, but not made walkable or given a picture.`
      : src.kind === "upload"
        ? "Its picture is an upload."
        : src.kind === "pack"
          ? "Its picture is the pack's. Uploading one replaces it; taking the upload out brings it back."
          : src.kind === "comingBack"
            ? "The draft takes its upload out: the pack's picture comes back when the draft is published."
            : "It has no picture: upload one.";
    const u = tileUsedText(view, code);
    used.textContent = u ? `Used ${u}.` : "No map or content row uses it.";
    repaint.textContent = tileRepaintText(view, code);
  }

  /** The name, walkable and flag fields, and the tile as they show it (`seen`). */
  function fillMeta(): void {
    if (!view || !code) {
      return;
    }
    const r = row();
    nameInput.value = r?.name ?? "";
    walkInput.checked = tileWalkable(view, code);
    for (const f of TILE_FLAGS) {
      const input = flagInputs.get(f);
      if (input) {
        input.checked = r?.flags?.includes(f) ?? false;
      }
    }
    filled = fields();
    seen = tileFingerprint(
      view.catalogue,
      view.walkable.map((w) => ({ code: w })),
      code,
    );
  }

  /** The picture half: its transparency and its upload as it shows it (`expect`). */
  function fillPicture(): void {
    if (!view || !code) {
      return;
    }
    transparencySel.value = tileUpload(view, code)?.transparency ?? "alpha";
    expect = artRowFingerprint(tileUpload(view, code));
  }

  function fill(): void {
    fillInfo();
    fillMeta();
    fillPicture();
    updateButtons();
    void drawPreview();
  }

  function showTile(c: string): void {
    if (!view) {
      return;
    }
    const r = view.catalogue.find((t) => same(t.code, c));
    if (!r) {
      return;
    }
    generation += 1;
    code = r.code;
    picked = null;
    picking = false;
    pictureFile.value = "";
    status.textContent = "";
    panel.hidden = false;
    fill();
  }

  function clearPanel(): void {
    generation += 1;
    code = null;
    expect = null;
    seen = null;
    filled = null;
    picked = null;
    picking = false;
    pictureFile.value = "";
    status.textContent = "";
    panel.hidden = true;
  }

  pictureFile.addEventListener("change", () => {
    const f = pictureFile.files?.[0];
    if (!f) {
      return;
    }
    const mine = ++generation;
    // From the choice until it is uploaded, the picture counts as unsaved work: a refresh of the
    // page keeps it.
    picking = true;
    picked = null;
    updateButtons();
    status.textContent = "Reading…";
    void (async () => {
      try {
        const raw = await decode(f);
        if (mine !== generation) {
          return;
        }
        if (!raw) {
          status.textContent = `${f.name} cannot be read as a picture.`;
          return;
        }
        if (raw.width !== TILE_SIZE || raw.height !== TILE_SIZE) {
          status.textContent = `${f.name} is ${raw.width}×${raw.height}; a tile is exactly ${TILE_SIZE}×${TILE_SIZE}. For a tileset, use Add tiles below.`;
          pictureFile.value = "";
          return;
        }
        const transparency = guessTransparency(raw);
        if (!tileShows(raw, transparency)) {
          status.textContent = `${f.name} shows nothing: a tile that shows nothing leaves a hole in the map.`;
          pictureFile.value = "";
          return;
        }
        status.textContent = "Uploading…";
        const stored = await opts.upload(f);
        if (mine !== generation) {
          return;
        }
        if (!stored.ok) {
          status.textContent = `Refused: ${stored.error}`;
          return;
        }
        transparencySel.value = transparency;
        picked = { file: stored.stored.file, raw, transparency };
        status.textContent = `${f.name} is ready: save the picture to put it in the draft.`;
        void drawPreview();
      } finally {
        if (mine === generation) {
          picking = false;
          updateButtons();
        }
      }
    })();
  });

  /** Sends a change from the panel; a reply for a tile the panel no longer shows changes nothing. */
  async function send(change: TileChange, after: () => void): Promise<void> {
    if (busy) {
      return;
    }
    const mine = generation;
    busy = true;
    updateButtons();
    status.textContent = "Saving…";
    try {
      const r = await opts.apply(change);
      if (mine !== generation) {
        // The panel shows something else now; the page still catches up with a saved change.
        if (r.ok) {
          opts.saved();
        }
        return;
      }
      status.textContent = [
        r.text,
        ...(r.problems ?? []).map((p) => `${p.where}: ${p.message}`),
      ].join(" ");
      if (r.ok) {
        after();
        opts.saved();
      }
    } finally {
      busy = false;
      updateButtons();
    }
  }

  async function doEdit(): Promise<void> {
    if (!code) {
      return;
    }
    await send(
      {
        op: "edit",
        code,
        name: nameInput.value.trim() || null,
        walkable: walkInput.checked,
        flags: flagsChosen(),
        seen,
      },
      () => {
        // What was saved is what the panel shows now: the refresh fills it in again.
        filled = fields();
      },
    );
  }

  async function doPicture(): Promise<void> {
    if (!code || !picked) {
      return;
    }
    const p = picked;
    await send({ op: "set", code, file: p.file, transparency: p.transparency, expect }, () => {
      picked = null;
      pictureFile.value = "";
    });
  }

  async function doRemove(): Promise<void> {
    if (!code) {
      return;
    }
    await send({ op: "remove", code, expect }, () => {});
  }

  async function doDelete(): Promise<void> {
    if (!code) {
      return;
    }
    const was = code;
    await send({ op: "delete", code: was, seen }, () => {
      const said = status.textContent;
      clearPanel();
      // The panel is closed, and what the change did is said under the list.
      listStatus.textContent = said;
    });
  }

  // ---- adding many tiles ----------------------------------------------------------------------

  let lines: TileBulkLine[] = [];
  let reading = 0;
  let attaching = false;
  /** Bumped by Clear and Discard: a batch still running for a cleared list stops. */
  let batch = 0;
  const bulkStatus = document.createElement("p");
  bulkStatus.className = "item-art-status";
  bulkStatus.setAttribute("role", "status");
  const walkDefault = action(document.createElement("input"), "tiles-walkable");
  walkDefault.type = "checkbox";
  const walkDefaultLabel = document.createElement("label");
  walkDefaultLabel.className = "item-art-check";
  walkDefaultLabel.append(walkDefault, " New tiles are walkable");
  const files = action(document.createElement("input"), "tiles-files");
  files.type = "file";
  files.multiple = true;
  files.accept = ".png,image/png";
  files.setAttribute("aria-label", "Tiles and tilesets to add");
  files.addEventListener("change", () => {
    const list = [...(files.files ?? [])];
    files.value = "";
    void addFiles(list);
  });

  const table = createTable<TileBulkLine>({
    label: "Tiles to add",
    empty: "No tilesets chosen.",
    key: (l) => `${l.label}:${lines.indexOf(l)}`,
    columns: [
      {
        label: "Tile",
        cell: (l) => {
          const c = document.createElement("canvas");
          c.width = TILE_SIZE;
          c.height = TILE_SIZE;
          const ctx = c.getContext("2d");
          const mine = batch;
          void uploadPixels({ code: "", file: l.file, transparency: l.transparency }).then((px) => {
            if (px && ctx && mine === batch) {
              ctx.drawImage(pixelCanvas(px), 0, 0);
            }
          });
          return c;
        },
      },
      { label: "From", cell: (l) => l.label },
      {
        label: "Add",
        cell: (l) => {
          const input = action(document.createElement("input"), "tiles-include");
          input.type = "checkbox";
          input.checked = l.include;
          input.disabled = attaching || l.done !== "";
          input.setAttribute("aria-label", `Attach ${l.label}`);
          input.addEventListener("change", () => {
            l.include = input.checked;
            redraw();
          });
          return input;
        },
      },
      {
        label: "Makes",
        cell: (l) => {
          if (l.done) {
            return l.done;
          }
          const err = bulkLineError(l, lines);
          if (err) {
            return err;
          }
          if (l.error) {
            return l.error;
          }
          return l.replaces !== null && view ? tileRepaintText(view, l.replaces) : "A new tile.";
        },
      },
      {
        label: "Name",
        cell: (l) => {
          const input = action(document.createElement("input"), "tiles-name");
          input.type = "text";
          input.maxLength = 80;
          input.value = l.name;
          input.placeholder = l.replaces ? "" : "None (scenery)";
          input.disabled = attaching || l.done !== "" || l.replaces !== null;
          input.setAttribute("aria-label", `The name of the tile from ${l.label}`);
          input.addEventListener("input", () => {
            l.name = input.value;
          });
          return input;
        },
      },
      {
        label: "Walkable",
        cell: (l) => {
          const input = action(document.createElement("input"), "tiles-line-walkable");
          input.type = "checkbox";
          input.checked = l.walkable;
          input.disabled = attaching || l.done !== "" || l.replaces !== null;
          input.setAttribute("aria-label", `The tile from ${l.label} is walkable`);
          input.addEventListener("change", () => {
            l.walkable = input.checked;
          });
          return input;
        },
      },
    ],
  });

  const attach = panelButton("tiles-attach", "Add the tiles", () => void attachAll(), "primary");
  const clear = panelButton("tiles-clear", "Clear", () => {
    batch += 1;
    lines = [];
    reading = 0;
    bulkStatus.textContent = "";
    redraw();
  });
  const bulkButtons = document.createElement("div");
  bulkButtons.className = "content-buttons";
  bulkButtons.append(attach, clear);

  function redraw(): void {
    table.setRows(lines);
    const open = lines.filter((l) => l.include && !l.done);
    attach.disabled =
      attaching ||
      reading > 0 ||
      open.length === 0 ||
      open.some((l) => bulkLineError(l, lines) !== "");
    clear.disabled = attaching;
    files.disabled = attaching || view === null;
  }

  async function addFiles(chosen: File[]): Promise<void> {
    if (!view) {
      bulkStatus.textContent = "The tiles are still loading: choose the files again in a moment.";
      return;
    }
    const mine = batch;
    reading += chosen.length;
    redraw();
    for (const f of chosen) {
      try {
        // Checked here first, so a picture the server would refuse is never uploaded.
        const raw = await decode(f);
        if (mine !== batch) {
          return;
        }
        if (!raw) {
          bulkStatus.textContent = `${f.name} cannot be read as a picture.`;
          continue;
        }
        const size = tilesetSizeError(raw.width, raw.height);
        if (size) {
          bulkStatus.textContent = `${f.name}: ${size}.`;
          continue;
        }
        const transparency = guessTransparency(raw);
        const stored = await opts.upload(f);
        if (mine !== batch) {
          return;
        }
        if (!stored.ok) {
          bulkStatus.textContent = `${f.name} refused: ${stored.error}`;
          continue;
        }
        const cut = await opts.slice(stored.stored.file, transparency);
        if (mine !== batch) {
          return;
        }
        if (!cut.ok) {
          bulkStatus.textContent = `${f.name}: ${cut.error}`;
          continue;
        }
        if (view) {
          lines.push(
            ...bulkLinesFor(f.name, cut.cells, cut.grid, transparency, view, walkDefault.checked),
          );
        }
      } finally {
        if (mine === batch) {
          reading -= 1;
          redraw();
        }
      }
    }
  }

  async function attachAll(): Promise<void> {
    if (!view || attaching) {
      return;
    }
    const mine = ++batch;
    // Where each line writes, its name, walkability and the upload it replaces are fixed now:
    // the changes are built from the lines as they are when Attach is pressed.
    const plan = bulkChanges(lines);
    attaching = true;
    redraw();
    let added = 0;
    try {
      for (const p of plan) {
        // A Clear or Discard while an earlier change was saving stops here, before this write.
        if (mine !== batch) {
          return;
        }
        const r = await opts.apply(p.change);
        if (mine !== batch) {
          return;
        }
        const codes = r.codes ?? [];
        p.lines.forEach((l, i) => {
          if (r.ok) {
            l.done =
              p.change.op === "add"
                ? `Tile ${codes[i] ?? "?"} is in the draft.`
                : `Tile ${(p.change as { code: string }).code}'s picture is in the draft.`;
            l.error = "";
          } else {
            // Kept, ticked, to try again with Add the tiles.
            l.error = `Not saved: ${r.text}`;
          }
        });
        added += r.ok ? p.lines.length : 0;
        redraw();
      }
    } finally {
      attaching = false;
      // A batch cut short by Clear or a reset still gives the controls back.
      redraw();
    }
    const left = lines.filter((l) => l.include && !l.done).length;
    bulkStatus.textContent = `${
      added === 0
        ? "Nothing was saved."
        : `${added} ${added === 1 ? "tile is" : "tiles are"} in the draft.`
    }${left > 0 ? ` ${left} not saved: see why in the list, then Add the tiles again.` : ""}`;
    if (added > 0) {
      opts.saved();
    }
  }

  const bulk = document.createElement("div");
  bulk.className = "tiles-bulk";
  const bulkTitle = document.createElement("h4");
  bulkTitle.textContent = "Add tiles";
  bulk.append(
    bulkTitle,
    templateLink("tiles-template", "tile-template.png"),
    formField("Tiles or tilesets (PNG)", files),
    walkDefaultLabel,
    table.el,
    bulkButtons,
    bulkStatus,
  );

  el.append(rules, formField("Find a tile", filter), list, more, listStatus, panel, bulk);
  redraw();

  return {
    el,
    setView(v) {
      view = v;
      // Pictures uploaded since may have been decoded under an old row: they are read again.
      drawList();
      if (code !== null) {
        if (!v.catalogue.some((t) => same(t.code, code as string))) {
          clearPanel();
        } else {
          // Each half of the panel catches up unless the operator has work set up in it: a
          // picture saved from it leaves the fields alone, and a rename keeps a picked picture.
          fillInfo();
          if (!busy && !editChanged()) {
            fillMeta();
          }
          if (!busy && picked === null && !picking) {
            fillPicture();
            void drawPreview();
          }
          updateButtons();
        }
      }
      redraw();
    },
    pending: () =>
      picked !== null ||
      picking ||
      editChanged() ||
      lines.some((l) => l.include && !l.done) ||
      attaching ||
      reading > 0,
    discard() {
      batch += 1;
      lines = [];
      reading = 0;
      bulkStatus.textContent = "";
      clearPanel();
      redraw();
    },
    reset() {
      batch += 1;
      view = null;
      lines = [];
      reading = 0;
      uploads.clear();
      clearPanel();
      drawList();
      redraw();
    },
    open: (c) => showTile(c),
  };
}
