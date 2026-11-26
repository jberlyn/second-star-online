/**
 * An uploaded picture's geometry (issue #29): how its transparency is read, which pixels show,
 * where its anchor goes by default and what is worth warning about. The server builds the atlases
 * with these rules and the Content page previews with the same ones, so what the preview shows is
 * what the game draws.
 */

/** RGBA pixels, four bytes a pixel, rows top to bottom. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** How a picture's transparency is read: its own alpha, or 1.6's pure green as see-through. */
export type PictureTransparency = "alpha" | "green";

/** The visible part of a picture: the box round every pixel that is not fully transparent. */
export interface VisibleBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pixel value 1.6 keyed out of its sprites. */
export const PICTURE_GREEN = [0, 255, 0] as const;

/** An edge pixel fainter than this (of 255) is nearly invisible yet still in the hit box. */
export const FAINT_ALPHA = 32;

/**
 * An item picture's anchor sits 16 px right of its tile's left edge and 2 px above its top
 * (`walkerPixel`'s anchor, `X*32-16, Y*32-34`, against the tile at `(X-1)*32, (Y-1)*32`).
 */
export const ITEM_TILE_ANCHOR = { x: 16, y: -2 } as const;

/** A bag slot's room: anything bigger overlaps the next slot. */
export const BAG_SLOT = { w: 32, h: 32 } as const;
/** An equipment box: the picture is centred in it. */
export const EQUIP_BOX = { w: 35, h: 35 } as const;

/** Makes pure green see-through, in place (`green`); `alpha` leaves the picture as it is. */
export function applyTransparency(img: Pixels, transparency: PictureTransparency): void {
  if (transparency !== "green") {
    return;
  }
  const d = img.data;
  const [r, g, b] = PICTURE_GREEN;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === r && d[i + 1] === g && d[i + 2] === b) {
      d[i + 3] = 0;
    }
  }
}

/** The box round the visible pixels, or null when none shows. */
export function visibleBounds(img: Pixels): VisibleBounds | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The anchor that centres the visible pixels on the item's tile, in the picture's own coordinates
 * (the way Classic's icons sit: an apple, a sword and a 32×32 sack all centred on their tile).
 */
export function defaultItemAnchor(b: VisibleBounds): { regX: number; regY: number } {
  return {
    regX: b.x + Math.floor(b.w / 2) - (16 - ITEM_TILE_ANCHOR.x),
    regY: b.y + Math.floor(b.h / 2) - (16 - ITEM_TILE_ANCHOR.y),
  };
}

/** The edges of the visible box whose every pixel is fainter than `FAINT_ALPHA`. */
export function faintEdges(img: Pixels, b: VisibleBounds): ("top" | "bottom" | "left" | "right")[] {
  const alpha = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3] ?? 0;
  const rowFaint = (y: number) => {
    for (let x = b.x; x < b.x + b.w; x++) {
      if (alpha(x, y) >= FAINT_ALPHA) {
        return false;
      }
    }
    return true;
  };
  const colFaint = (x: number) => {
    for (let y = b.y; y < b.y + b.h; y++) {
      if (alpha(x, y) >= FAINT_ALPHA) {
        return false;
      }
    }
    return true;
  };
  const out: ("top" | "bottom" | "left" | "right")[] = [];
  if (rowFaint(b.y)) {
    out.push("top");
  }
  if (b.h > 1 && rowFaint(b.y + b.h - 1)) {
    out.push("bottom");
  }
  if (colFaint(b.x)) {
    out.push("left");
  }
  if (b.w > 1 && colFaint(b.x + b.w - 1)) {
    out.push("right");
  }
  return out;
}

/** Whether every pixel is fully opaque. */
export function fullyOpaque(img: Pixels): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] !== 255) {
      return false;
    }
  }
  return true;
}

/** Whether any opaque pixel is pure green. */
export function hasPureGreen(img: Pixels): boolean {
  const d = img.data;
  const [r, g, b] = PICTURE_GREEN;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === r && d[i + 1] === g && d[i + 2] === b && d[i + 3] === 255) {
      return true;
    }
  }
  return false;
}

/**
 * The transparency a freshly uploaded picture most likely means: its alpha when it has any
 * see-through pixel, else green when it holds pure green (1.6's convention), else its alpha.
 */
export function guessTransparency(img: Pixels): PictureTransparency {
  return !fullyOpaque(img) || !hasPureGreen(img) ? "alpha" : "green";
}

/** What the Content page says about an item picture before it is saved. */
export interface PictureReport {
  /** Reasons the server would refuse it. */
  errors: string[];
  /** Things that work but may not be what was meant. */
  warnings: string[];
  /** The visible box, after the transparency is applied. */
  bounds: VisibleBounds | null;
}

/** Checks an item picture already keyed with its transparency, against its size limit. */
export function itemPictureReport(
  keyed: Pixels,
  transparency: PictureTransparency,
  maxSide: number,
): PictureReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (keyed.width > maxSide || keyed.height > maxSide) {
    errors.push(
      `The picture is ${keyed.width}×${keyed.height}; item pictures may be at most ${maxSide}×${maxSide}.`,
    );
  }
  const bounds = visibleBounds(keyed);
  if (!bounds) {
    errors.push(
      transparency === "green"
        ? "Nothing shows: every pixel is see-through once pure green is taken out."
        : "Nothing shows: every pixel is see-through.",
    );
    return { errors, warnings, bounds };
  }
  if (fullyOpaque(keyed)) {
    warnings.push(
      transparency === "alpha" && hasPureGreen(keyed)
        ? 'No pixel is see-through, but it has pure green in it: choose "Pure green is see-through" if that is its background.'
        : "No pixel is see-through: it is drawn as a solid rectangle.",
    );
  }
  if (bounds.w > BAG_SLOT.w || bounds.h > BAG_SLOT.h) {
    warnings.push(
      `It shows ${bounds.w}×${bounds.h}: bigger than a bag slot (${BAG_SLOT.w}×${BAG_SLOT.h}), so it overlaps the slots beside it.`,
    );
  }
  if (bounds.w > EQUIP_BOX.w || bounds.h > EQUIP_BOX.h) {
    warnings.push(`It spills out of the equipment boxes (${EQUIP_BOX.w}×${EQUIP_BOX.h}).`);
  }
  const faint = faintEdges(keyed, bounds);
  if (faint.length > 0) {
    warnings.push(
      `Its ${listOf(faint)} edge${faint.length === 1 ? " is" : "s are"} nearly invisible (every pixel fainter than ${FAINT_ALPHA} of 255) but still inside its hit box, so the box is bigger than what you see.`,
    );
  }
  return { errors, warnings, bounds };
}

/** "top", "top and left", "top, left and right". */
function listOf(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// ---- what a picture change writes (pure) -------------------------------------------------------

/** An item as a picture change reads it. */
export interface PictureItem {
  name: string;
  sprite?: string;
  retired?: true;
}

/** An `art/items` row. */
export interface PictureArtRow {
  name: string;
  file: string;
  regX: number;
  regY: number;
  transparency?: PictureTransparency;
}

/** An upload's settings: its stored file, anchor and transparency. */
export interface PictureSettings {
  file: string;
  regX: number;
  regY: number;
  transparency: PictureTransparency;
}

/**
 * The pictures the engine names for the currency's ground piles (1 to 49, 50 to 99, 100 or more),
 * whatever the currency is called: the only engine pictures the Content page sets.
 */
export const CURRENCY_PILES = [
  { name: "SmallGold", label: "Small pile (1 to 49)" },
  { name: "MediumGold", label: "Medium pile (50 to 99)" },
  { name: "LargeGold", label: "Large pile (100 or more)" },
] as const;
export type CurrencyPile = (typeof CURRENCY_PILES)[number]["name"];

/**
 * One picture change, as the Content page asks for it (issue #29): give an item an upload of its
 * own, make it draw a picture that exists, take its upload out, or set or clear a currency pile.
 */
export type PictureChange =
  | { op: "upload"; item: string; art: PictureSettings }
  | { op: "choose"; item: string; picture: string }
  | { op: "remove"; item: string }
  | { op: "pile"; pile: CurrencyPile; art: PictureSettings | null }
  /**
   * A house type's placement preview (issue #10): its upload, named `<house> (placement)`, and the
   * type's `ghost.picture`, set or taken out together.
   */
  | { op: "house"; house: string; art: PictureSettings | null };

/** One row a picture change writes. */
export interface PictureRowChange {
  ref:
    | { dataset: "items" | "art"; part: "items"; key: string }
    | { dataset: "houses"; part: "types"; key: string };
  op: "set" | "remove";
  data: unknown;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The picture an item draws: its `sprite`, else its key. */
export const pictureOf = (item: PictureItem): string => item.sprite ?? item.name;

/** The `art/items` row for a picture called `name`. */
export function pictureArtRow(name: string, s: PictureSettings): PictureArtRow {
  return {
    name,
    file: s.file,
    regX: s.regX,
    regY: s.regY,
    ...(s.transparency === "green" ? { transparency: "green" as const } : {}),
  };
}

const artRef = (key: string) => ({ dataset: "art" as const, part: "items" as const, key });
const itemRef = (key: string) => ({ dataset: "items" as const, part: "items" as const, key });

/** The item picture the House types form's upload gives a house type's ghost (issue #10). */
export function housePlacementPicture(house: string): string {
  return `${house} (placement)`;
}

/** The longest picture name an `art/items` row takes. */
const PICTURE_NAME_MAX = 80;

/** What a house picture change reads of a house type. */
export interface PictureHouseType {
  house: string;
  /** The rest of the ghost is kept as it is. */
  ghost: { picture?: string; [field: string]: unknown };
}

const houseRef = (key: string) => ({ dataset: "houses" as const, part: "types" as const, key });

/** An item row without its `sprite`. */
function withoutSprite<T extends PictureItem>(item: T): T {
  const { sprite: _sprite, ...rest } = item;
  return rest as T;
}

/**
 * The rows a picture change writes, against the draft's items and uploads (`exists` says whether
 * a picture of that name will be drawn: an upload or a pack's). Only an item's `sprite` changes,
 * read from the row as the draft has it now, so no other edit to the row is lost.
 *
 * - An upload is the item's own `art/items` row, named by its key; an item that borrowed another
 *   picture through `sprite` stops borrowing it, so the upload is what it draws (an upload named
 *   after the borrowed picture would repaint every item that shares it).
 * - Choosing a picture only sets `sprite` (none for the item's own name); its own upload goes
 *   when nothing else draws it.
 * - A pile is an `art/items` row under the engine's name.
 * - A house type's placement preview is an `art/items` row named `<house> (placement)`, and the
 *   type's `ghost.picture` names it (read from the type's row as the draft has it now).
 */
export function planPicture<T extends PictureItem, H extends PictureHouseType = PictureHouseType>(
  change: PictureChange,
  items: readonly T[],
  art: readonly PictureArtRow[],
  exists: (name: string) => boolean,
  houses: readonly H[] = [],
): { ok: true; rows: PictureRowChange[] } | { ok: false; error: string } {
  const upload = (name: string) => art.find((a) => sameName(a.name, name));
  if (change.op === "house") {
    return planHousePicture(change, houses, upload);
  }
  if (change.op === "pile") {
    const row = upload(change.pile);
    if (change.art === null) {
      return row
        ? { ok: true, rows: [{ ref: artRef(row.name), op: "remove", data: null }] }
        : { ok: false, error: `${change.pile} has no upload to take out.` };
    }
    const name = row?.name ?? change.pile;
    return {
      ok: true,
      rows: [{ ref: artRef(name), op: "set", data: pictureArtRow(name, change.art) }],
    };
  }
  const item = items.find((i) => sameName(i.name, change.item));
  if (!item) {
    return { ok: false, error: `There is no item ${change.item}.` };
  }
  const own = upload(item.name);
  const drawnByOthers = (name: string) =>
    items.some((i) => !sameName(i.name, item.name) && sameName(pictureOf(i), name));
  if (change.op === "upload") {
    const name = own?.name ?? item.name;
    const rows: PictureRowChange[] = [
      { ref: artRef(name), op: "set", data: pictureArtRow(name, change.art) },
    ];
    if (item.sprite !== undefined && !sameName(item.sprite, item.name)) {
      rows.push({ ref: itemRef(item.name), op: "set", data: withoutSprite(item) });
    }
    return { ok: true, rows };
  }
  if (change.op === "remove") {
    return own
      ? { ok: true, rows: [{ ref: artRef(own.name), op: "remove", data: null }] }
      : { ok: false, error: `${item.name} has no upload of its own.` };
  }
  // Choose: a picture that is drawn (or the item's own name, to stop borrowing).
  const isOwn = sameName(change.picture, item.name);
  if (!isOwn && !exists(change.picture)) {
    return { ok: false, error: `There is no picture called ${change.picture}.` };
  }
  const rows: PictureRowChange[] = [];
  const current = item.sprite;
  if (isOwn ? current !== undefined : current === undefined || !sameName(current, change.picture)) {
    rows.push({
      ref: itemRef(item.name),
      op: "set",
      data: isOwn ? withoutSprite(item) : { ...item, sprite: change.picture },
    });
  }
  if (!isOwn && own && !drawnByOthers(own.name)) {
    rows.push({ ref: artRef(own.name), op: "remove", data: null });
  }
  return rows.length > 0
    ? { ok: true, rows }
    : { ok: false, error: `${item.name} already draws ${change.picture}.` };
}

/** A house type's placement preview change (issue #10): its upload and the type's `ghost.picture`. */
function planHousePicture<H extends PictureHouseType>(
  change: { house: string; art: PictureSettings | null },
  houses: readonly H[],
  upload: (name: string) => PictureArtRow | undefined,
): { ok: true; rows: PictureRowChange[] } | { ok: false; error: string } {
  const type = houses.find((t) => sameName(t.house, change.house));
  if (!type) {
    return { ok: false, error: `There is no house type ${change.house}.` };
  }
  const own = upload(housePlacementPicture(type.house));
  const name = own?.name ?? housePlacementPicture(type.house);
  const current = type.ghost.picture;
  const rows: PictureRowChange[] = [];
  if (change.art === null) {
    if (own) {
      rows.push({ ref: artRef(own.name), op: "remove", data: null });
    }
    if (current !== undefined) {
      const { picture: _picture, ...ghost } = type.ghost;
      rows.push({ ref: houseRef(type.house), op: "set", data: { ...type, ghost } });
    }
    return rows.length > 0
      ? { ok: true, rows }
      : { ok: false, error: `${type.house} has no placement preview of its own to take out.` };
  }
  if (name.length > PICTURE_NAME_MAX) {
    return {
      ok: false,
      error: `${type.house}'s name is too long to name its picture: shorten it to ${PICTURE_NAME_MAX - " (placement)".length} letters or fewer.`,
    };
  }
  rows.push({ ref: artRef(name), op: "set", data: pictureArtRow(name, change.art) });
  if (current === undefined || !sameName(current, name)) {
    rows.push({
      ref: houseRef(type.house),
      op: "set",
      data: { ...type, ghost: { ...type.ghost, picture: name } },
    });
  }
  return { ok: true, rows };
}
