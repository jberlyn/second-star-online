/**
 * Worn (paperdoll) frame sets (issue #29, stage 3): which layer an item draws when it is worn,
 * which of a layer's frames the character renderer ever asks for, the sheet the Content page
 * takes them in, the checks on each frame and on the set, and the draft rows a change writes.
 *
 * A layer is named by key, never by an item's `sprite`: the worn item's key after the layer
 * aliases (`paperdoll.aliases`), `+N` dropped. Its frames are pasted at the 46×45 character's
 * top-left, so they have no anchor. Everything here takes the rules as data (a draft's, or the
 * installed store's), so the Content page and the publish checks see what the game will draw.
 */
import type { ArtFrameId, ArtWorn, EquipSlot, ItemRulesData } from "@secondstaronline/data";

import { lingoEq } from "../rules/core/lingo.ts";
import { lastMatch, ruleMatches } from "../rules/core/patterns.ts";
import { behaviourTest } from "../rules/inventory/behaviours.ts";
import { equipmentOf } from "../rules/inventory/inventory.ts";
import {
  type BodyFrame,
  normaliseLookWith,
  PAPERDOLL_SIZE,
  type PaperdollRules,
  paperdollLayersWith,
} from "../rules/inventory/paperdoll.ts";
import type { Facing } from "../rules/movement/movement.ts";
import { type Pixels, visibleBounds } from "./picture.ts";

// ---- frames and the sheet ---------------------------------------------------------------------

/** The facings in the sheet's row order. */
export const WORN_FACINGS = ["N", "E", "S", "W"] as const;
/** The frames in the sheet's column order: F1-F3 walk, F4 attack. */
export const WORN_STEPS = ["F1", "F2", "F3", "F4"] as const;

/** The frame id of a frame and facing (`f2-s`). */
export const frameIdOf = (frame: BodyFrame, facing: Facing): ArtFrameId =>
  `${frame}-${facing}`.toLowerCase() as ArtFrameId;

/** Every frame id, in sheet order (row by row: north F1-F4, east F1-F4 …). */
export const ALL_FRAME_IDS: readonly ArtFrameId[] = WORN_FACINGS.flatMap((facing) =>
  WORN_STEPS.map((frame) => frameIdOf(frame, facing)),
);

/**
 * The frames the game ever asks a layer for: F1-F3 facing every way, and F4 (the attack frame)
 * facing north, east and west. A character attacking south shows F3-S, so no layer has an F4-S.
 */
export const WORN_FRAMES: readonly ArtFrameId[] = ALL_FRAME_IDS.filter((f) => f !== "f4-s");

/** A frame's size: the character it is pasted on, from its top-left. */
export const WORN_CELL = PAPERDOLL_SIZE;

/** The sheet: four rows (N, E, S, W) of four frames (F1, F2, F3, F4), each a 46×45 cell. */
export const WORN_SHEET = {
  cols: WORN_STEPS.length,
  rows: WORN_FACINGS.length,
  w: WORN_STEPS.length * PAPERDOLL_SIZE.w,
  h: WORN_FACINGS.length * PAPERDOLL_SIZE.h,
} as const;

/** A frame's cell on a sheet of `cell`-sized cells (the worn sheet's by default), by its top-left corner. */
export function sheetCell(
  id: ArtFrameId,
  cell: { w: number; h: number } = WORN_CELL,
): { x: number; y: number } {
  const [frame, facing] = id.split("-") as [string, string];
  const col = Number(frame.slice(1)) - 1;
  const row = WORN_FACINGS.indexOf(facing.toUpperCase() as Facing);
  return { x: col * cell.w, y: row * cell.h };
}

/** One cell of a sheet's pixels, exactly as they are. */
export function cutCell(
  sheet: Pixels,
  id: ArtFrameId,
  cell: { w: number; h: number } = WORN_CELL,
): Pixels {
  const { x: cx, y: cy } = sheetCell(id, cell);
  const out = new Uint8Array(cell.w * cell.h * 4);
  for (let y = 0; y < cell.h; y++) {
    const from = ((cy + y) * sheet.width + cx) * 4;
    out.set(sheet.data.subarray(from, from + cell.w * 4), y * cell.w * 4);
  }
  return { width: cell.w, height: cell.h, data: out };
}

/**
 * The frame a file is named for: `Moonblade-f1-e.png` (case ignored), with the name before it.
 * Null when the name ends in no frame.
 */
export function frameFileName(file: string): { stem: string; frame: ArtFrameId } | null {
  const m = /^(.*?)[-_ ]f([1-4])[-_ ]?([nesw])(?:\.png)?$/i.exec(file.trim());
  if (!m) {
    return null;
  }
  return {
    stem: (m[1] ?? "").trim(),
    frame: `f${m[2]}-${(m[3] ?? "").toLowerCase()}` as ArtFrameId,
  };
}

/**
 * The column a mirrored north frame is flipped about: column x lands on `WORN_MIRROR_AXIS - x`, so
 * the bare body (columns 9 to 35) stays where it is. A pixel right of it would land off the left
 * edge.
 */
export const WORN_MIRROR_AXIS = 44;

/** Whether the frame is a north frame (the ones `mirrored` flips). */
export const isNorthFrame = (id: ArtFrameId) => id.endsWith("-n");

/** The first column right of the mirror line that holds a visible pixel, or null. */
export function pastMirrorLine(img: Pixels): number | null {
  for (let x = WORN_MIRROR_AXIS + 1; x < img.width; x++) {
    for (let y = 0; y < img.height; y++) {
      if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) !== 0) {
        return x;
      }
    }
  }
  return null;
}

/** A north frame flipped about the mirror line (`mirrorPaperdoll`'s flip), 45 px wide. */
export function mirrorWorn(img: Pixels): Pixels {
  const w = WORN_MIRROR_AXIS + 1;
  const out = new Uint8ClampedArray(w * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < Math.min(img.width, w); x++) {
      const from = (y * img.width + x) * 4;
      if ((img.data[from + 3] ?? 0) === 0) {
        continue;
      }
      out.set(img.data.subarray(from, from + 4), (y * w + WORN_MIRROR_AXIS - x) * 4);
    }
  }
  return { width: w, height: img.height, data: out };
}

// ---- which layer an item draws ----------------------------------------------------------------

/** What the Content page calls each slot's layer. */
export const WORN_SLOT_NAMES: Record<EquipSlot, string> = {
  Head: "on the head",
  Body: "on the body",
  LeftHand: "as a weapon",
  RightHand: "in the off hand",
  Feet: "on the feet",
  Ring: "on the hands (the ring slot)",
};

/** The renderer's rules from a set of item rules (a draft's, or the installed store's). */
export function paperdollRulesOf(
  rules: Pick<ItemRulesData, "behaviours"> & {
    paperdoll: Pick<ItemRulesData["paperdoll"], "aliases">;
  },
): PaperdollRules {
  return { aliases: rules.paperdoll.aliases, has: behaviourTest(rules.behaviours) };
}

/** The item rules this module reads. */
export type WornRules = Pick<ItemRulesData, "behaviours" | "paperdoll"> & {
  equip: Pick<ItemRulesData["equip"], "slots">;
};

/** An alias row that rewrote an item's layer, with its place in the list. */
export interface WornAlias {
  index: number;
  match: "exact" | "contains";
  pattern: string;
  becomes: string;
}

/** The layer a worn item draws. */
export interface WornLayerOf {
  slot: EquipSlot;
  /** The layer, or null when it draws nothing (an alias to NOTHING). */
  layer: string | null;
  /** The alias rows that changed it, in order. */
  aliases: WornAlias[];
  /**
   * Whether every one of those rows is an exact row naming this item, so taking them out gives it
   * a layer of its own (its key). False with no aliases.
   */
  ownLayerPossible: boolean;
}

const NOTHING = "NOTHING";

/** Which `normaliseLook` field a slot's layer is, and the alias layer it answers to. */
const SLOT_FIELD = {
  Head: { field: "helm", alias: "helm" },
  Body: { field: "body", alias: "body" },
  LeftHand: { field: "weapon", alias: "weapon" },
  RightHand: { field: "shield", alias: "shield" },
  Feet: { field: "boots", alias: null },
  Ring: { field: "gloves", alias: "gloves" },
} as const;

/** An item's equip slot under these rules (`equipSlotFor`'s rule). */
export function wornSlotOf(rules: WornRules, name: string): EquipSlot | null {
  const slot = lastMatch(rules.equip.slots, name)?.slot ?? "No";
  return slot === "No" ? null : slot;
}

/** The layer an item draws when worn, or null when it is never worn. */
export function wornLayerOf(rules: WornRules, name: string): WornLayerOf | null {
  const slot = wornSlotOf(rules, name);
  if (slot === null) {
    return null;
  }
  const pd = paperdollRulesOf(rules);
  const n = normaliseLookWith(pd, equipmentOf({ [slot]: name }));
  const { field, alias } = SLOT_FIELD[slot];
  const drawn = n[field];
  // The rows that rewrote it: the renderer's loop again, on this layer alone.
  const aliases: WornAlias[] = [];
  if (alias !== null) {
    let current = stripPlus(name);
    rules.paperdoll.aliases.forEach((row, index) => {
      if (row.layer === alias && ruleMatches(current, row)) {
        aliases.push({ index, match: row.match, pattern: row.pattern, becomes: row.becomes });
        current = row.becomes;
      }
    });
  }
  const ownLayerPossible =
    aliases.length > 0 &&
    aliases.every((a) => a.match === "exact" && lingoEq(a.pattern, stripPlus(name)));
  return {
    slot,
    layer: lingoEq(drawn, NOTHING) ? null : drawn,
    aliases,
    ownLayerPossible,
  };
}

/** `+N` and one trailing space dropped (the renderer's `strip`). */
function stripPlus(name: string): string {
  let n = name.includes("+") ? (name.split("+")[0] ?? "") : name;
  if (n.endsWith(" ")) {
    n = n.slice(0, -1);
  }
  return n;
}

/**
 * The frames of `layer` the renderer draws for a character wearing only `name` in `slot`. The
 * renderer is asked frame by frame, so this is exactly what the game draws.
 */
export function framesDrawn(
  pd: PaperdollRules,
  slot: EquipSlot,
  name: string,
  layer: string,
): ArtFrameId[] {
  const look = { head: 0, equip: equipmentOf({ [slot]: name }) };
  return WORN_FRAMES.filter((id) => {
    const [frame, facing] = id.toUpperCase().split("-") as [BodyFrame, Facing];
    const want = `${layer}-${frame}-${facing}`;
    return paperdollLayersWith(pd, look, frame, facing).some((l) => lingoEq(l, want));
  });
}

/** One layer the content draws, and the frames it must have. */
export interface WornLayerUse {
  /** The layer, spelled as content names it first. */
  name: string;
  /** The frames some wearer needs (in sheet order); every drawn frame for engine layers. */
  needs: ArtFrameId[];
  /** The items that draw it when worn. */
  wornBy: { item: string; slot: EquipSlot }[];
  /** The engine's own uses: every character's bare body and feet, a sex's heads. */
  engine: string[];
}

/** What `wornLayers` reads. */
export interface WornContent {
  items: { items: readonly { name: string }[] };
  itemRules: WornRules;
  classes: { creation: { sexes: readonly { label: string; heads: readonly number[] }[] } };
}

/** The engine's own layers with frames (BIM, the shadow, is one picture and not a frame set). */
export const ENGINE_WORN_LAYERS = ["DEFBOD", "Bare Feet"] as const;

/** Every layer the content draws, by its name in lower case. */
export function wornLayers(data: WornContent): Map<string, WornLayerUse> {
  const pd = paperdollRulesOf(data.itemRules);
  const out = new Map<string, WornLayerUse>();
  const use = (name: string): WornLayerUse => {
    const k = name.toLowerCase();
    let u = out.get(k);
    if (!u) {
      u = { name, needs: [], wornBy: [], engine: [] };
      out.set(k, u);
    }
    return u;
  };
  const need = (u: WornLayerUse, frames: readonly ArtFrameId[]) => {
    const have = new Set([...u.needs, ...frames]);
    u.needs = WORN_FRAMES.filter((f) => have.has(f));
  };
  for (const layer of ENGINE_WORN_LAYERS) {
    const u = use(layer);
    u.engine.push("every character");
    need(u, WORN_FRAMES);
  }
  for (const sex of data.classes.creation.sexes) {
    for (const head of sex.heads) {
      const u = use(`Head${head}`);
      u.engine.push(`the ${sex.label} heads`);
      need(u, WORN_FRAMES);
    }
  }
  for (const item of data.items.items) {
    const w = wornLayerOf(data.itemRules, item.name);
    if (!w?.layer) {
      continue;
    }
    const u = use(w.layer);
    u.wornBy.push({ item: item.name, slot: w.slot });
    need(u, framesDrawn(pd, w.slot, item.name, w.layer));
  }
  return out;
}

// ---- checks -----------------------------------------------------------------------------------

/** A set's frames that its wearers need and it lacks. */
export function missingFrames(
  row: Pick<ArtWorn, "frames">,
  use: WornLayerUse | undefined,
): ArtFrameId[] {
  return (use?.needs ?? []).filter((f) => !row.frames[f]);
}

/** The frames a set has that nothing ever draws. */
export function unusedFrames(
  row: Pick<ArtWorn, "frames">,
  use: WornLayerUse | undefined,
): ArtFrameId[] {
  const needs = new Set(use?.needs ?? WORN_FRAMES);
  return ALL_FRAME_IDS.filter((f) => row.frames[f] && !needs.has(f));
}

/** Who draws a layer, for messages: "Knight's Sword and Broad Sword", "every character". */
export function wornByText(use: WornLayerUse | undefined): string {
  if (!use) {
    return "nothing";
  }
  const names = [...use.engine, ...use.wornBy.map((w) => w.item)];
  if (names.length === 0) {
    return "nothing";
  }
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) {
    return `${shown.join(", ")} and ${more} more`;
  }
  return shown.length === 1
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** What the Content page says about one frame before it is saved. */
export interface WornFrameReport {
  errors: string[];
  warnings: string[];
  /** Nothing in it shows. */
  empty: boolean;
}

/**
 * Checks one frame, already keyed with its transparency: its size, the mirror line (a mirrored
 * north frame), whether anything shows, and whether the layer's wearers ever draw it (`needed`:
 * null when nothing wears the layer).
 */
export function wornFrameReport(
  img: Pixels,
  id: ArtFrameId,
  mirrored: boolean,
  needed: boolean | null,
): WornFrameReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const leftOut = id === "f4-s" || needed === false;
  if (img.width > WORN_CELL.w || img.height > WORN_CELL.h) {
    errors.push(
      `${id} is ${img.width}×${img.height}; worn frames are at most ${WORN_CELL.w}×${WORN_CELL.h}, drawn from the character's top-left`,
    );
  }
  if (mirrored && isNorthFrame(id)) {
    const col = pastMirrorLine(img);
    if (col !== null) {
      errors.push(
        `${id} has pixels in column ${col}, past the mirror line (column ${WORN_MIRROR_AXIS}): a mirrored north frame would lose them`,
      );
    }
  }
  const empty = visibleBounds(img) === null;
  if (empty && !leftOut) {
    warnings.push(`${id} shows nothing`);
  }
  if (id === "f4-s") {
    warnings.push("f4-s is never drawn (a character attacking south shows f3-s); it is left out");
  } else if (needed === false) {
    warnings.push(`${id} is never drawn for this layer; it is left out`);
  }
  // A frame left out is never stored, so nothing wrong with it holds the rest back.
  return leftOut ? { errors: [], warnings, empty } : { errors, warnings, empty };
}

// ---- changes ----------------------------------------------------------------------------------

/** One worn-art change, as the Content page asks for it. */
export type WornChange =
  | {
      op: "set";
      layer: string;
      frames: Partial<Record<ArtFrameId, string>>;
      mirrored: boolean;
      transparency: "alpha" | "green";
    }
  | { op: "remove"; layer: string }
  | { op: "ownLayer"; item: string };

/** One row a worn change writes. */
export type WornRowChange =
  | {
      ref: { dataset: "art"; part: "paperdoll"; key: string };
      op: "set" | "remove";
      data: ArtWorn | null;
    }
  | {
      ref: { dataset: "itemRules"; part: "paperdoll"; key: null };
      op: "set";
      data: ItemRulesData["paperdoll"];
    };

/**
 * The rows a worn change writes, against the draft's rules and uploads. An upload replaces the
 * layer's whole row (the page sends every frame it keeps); `f4-s` is left out. Giving an item its
 * own layer takes out the exact alias rows that name it alone.
 */
export function planWorn(
  change: WornChange,
  rules: WornRules,
  items: readonly { name: string }[],
  art: readonly ArtWorn[],
): { ok: true; rows: WornRowChange[] } | { ok: false; error: string } {
  if (change.op === "ownLayer") {
    const item = items.find((i) => lingoEq(i.name, change.item));
    if (!item) {
      return { ok: false, error: `There is no item ${change.item}.` };
    }
    const w = wornLayerOf(rules, item.name);
    if (!w) {
      return { ok: false, error: `${item.name} is never worn.` };
    }
    const problem = ownLayerProblem(rules, items, item.name, w);
    if (problem !== null) {
      return { ok: false, error: problem };
    }
    const aliases = withoutOwnAliases(rules, w);
    return {
      ok: true,
      rows: [
        {
          ref: { dataset: "itemRules", part: "paperdoll", key: null },
          op: "set",
          data: { ...rules.paperdoll, aliases },
        },
      ],
    };
  }
  const layer = change.layer.trim();
  if (layer === "" || layer.length > 80) {
    return { ok: false, error: "A layer's name is 1 to 80 characters." };
  }
  if (lingoEq(layer, NOTHING) || lingoEq(layer, "BIM")) {
    return { ok: false, error: `${layer} is not a layer that can be uploaded.` };
  }
  const own = art.find((a) => lingoEq(a.name, layer));
  if (change.op === "remove") {
    return own
      ? { ok: true, rows: [{ ref: artRef(own.name), op: "remove", data: null }] }
      : { ok: false, error: `${layer} has no upload to take out.` };
  }
  const frames: ArtWorn["frames"] = {};
  for (const id of ALL_FRAME_IDS) {
    const file = change.frames[id];
    if (file !== undefined && id !== "f4-s") {
      frames[id] = { file };
    }
  }
  if (Object.keys(frames).length === 0) {
    return { ok: false, error: "A worn layer needs at least one frame." };
  }
  const name = own?.name ?? layer;
  const row: ArtWorn = {
    name,
    frames,
    ...(change.mirrored ? { mirrored: true as const } : {}),
    ...(change.transparency === "green" ? { transparency: "green" as const } : {}),
  };
  return { ok: true, rows: [{ ref: artRef(name), op: "set", data: row }] };
}

/** The alias rows without the ones that rewrote an item's layer. */
function withoutOwnAliases(rules: WornRules, w: WornLayerOf): WornRules["paperdoll"]["aliases"] {
  const drop = new Set(w.aliases.map((a) => a.index));
  return rules.paperdoll.aliases.filter((_, i) => !drop.has(i));
}

/**
 * The other items whose layer changes with these alias rows (an exact row also matches the name an
 * earlier row rewrote another item's to: Other Sword → Moon Sword → Broad Sword).
 */
function othersMoved(
  rules: WornRules,
  aliases: WornRules["paperdoll"]["aliases"],
  items: readonly { name: string }[],
  except: string,
): string[] {
  const after: WornRules = { ...rules, paperdoll: { ...rules.paperdoll, aliases } };
  return (
    items
      // Its own upgraded copies (`Knight's Sword +1`) draw its layer, and move with it.
      .filter((i) => !lingoEq(stripPlus(i.name), stripPlus(except)))
      .filter((i) => wornLayerOf(rules, i.name)?.layer !== wornLayerOf(after, i.name)?.layer)
      .map((i) => i.name)
  );
}

/**
 * Why an item cannot be given a layer of its own by taking out its alias rows, or null when it can:
 * every row that rewrote its layer is an exact row naming it, it is not an upgraded copy
 * (`Knight's Sword +1` draws its base item's layer), without those rows it draws its own key (no
 * later rule renames it), and no other item's layer changes.
 */
function ownLayerProblem(
  rules: WornRules,
  items: readonly { name: string }[],
  name: string,
  w: WornLayerOf,
): string | null {
  const manual = "change paperdoll.aliases in the item rules by hand.";
  if (w.aliases.length === 0) {
    return `${name} already draws a layer of its own.`;
  }
  if (stripPlus(name) !== name.trim()) {
    return `${name} is an upgraded copy and draws ${stripPlus(name)}'s layer: give ${stripPlus(name)} a layer of its own instead.`;
  }
  if (!w.ownLayerPossible) {
    return `${name}'s layer comes from an alias rule that other items match too: ${manual}`;
  }
  const aliases = withoutOwnAliases(rules, w);
  const after = wornLayerOf({ ...rules, paperdoll: { ...rules.paperdoll, aliases } }, name);
  if (after === null || after.aliases.length > 0 || !lingoEq(after.layer ?? "", name)) {
    return `Without its own alias rows another rule still renames ${name}'s layer: ${manual}`;
  }
  const moved = othersMoved(rules, aliases, items, name);
  if (moved.length > 0) {
    return `Taking out ${name}'s alias rows would also change what ${moved.join(", ")} draw${moved.length === 1 ? "s" : ""}: ${manual}`;
  }
  return null;
}

/** Whether "a layer of its own" can be given to an item (see `ownLayerProblem`). */
export function ownLayerPossible(
  rules: WornRules,
  items: readonly { name: string }[],
  name: string,
): boolean {
  const w = wornLayerOf(rules, name);
  return w !== null && ownLayerProblem(rules, items, name, w) === null;
}

/** A sheet cell that is blank whichever way its transparency is read: all see-through, or all pure green. */
export function blankCell(img: Pixels): boolean {
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] ?? 0;
    const green = img.data[i] === 0 && img.data[i + 1] === 255 && img.data[i + 2] === 0;
    if (a !== 0 && !(a === 255 && green)) {
      return false;
    }
  }
  return true;
}

const artRef = (key: string) => ({ dataset: "art" as const, part: "paperdoll" as const, key });
