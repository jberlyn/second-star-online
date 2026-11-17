/**
 * The right panel's four tab icons: their crop boxes and the row they sit on.
 *
 * The original bitmaps are opaque crops of the panel wood with the glyph baked in. The asset
 * build cuts each bitmap out of its wood with a hand-drawn mask (`build/assets-lib/`), using the
 * `crop` boxes here as the visible bounds, and erases the copies baked into Internal #186. The
 * client then draws each visible crop centred on `TAB_ROW_Y` and on its original x.
 *
 * All rectangles are in the source member's pixels; `original` is the member's stage top-left
 * in frame 63, which is where its wood background is in Internal #186 (the stage x of the panel
 * is 566).
 */

export type PanelTab = "stats" | "inventory" | "skills" | "spellbook";

export interface TabArt {
  tab: PanelTab;
  /** Internal member of the small (unselected) icon. */
  member: number;
  /** Internal member of the larger selected icon. */
  selected: number;
  /** The small icon's full bitmap size. */
  source: readonly [w: number, h: number];
  /** The selected icon's full bitmap size. */
  selectedSource: readonly [w: number, h: number];
  /** The small icon's glyph inside its bitmap. */
  crop: readonly [x: number, y: number, w: number, h: number];
  /** The selected icon's glyph inside its bitmap. */
  selectedCrop: readonly [x: number, y: number, w: number, h: number];
  /** The small icon's original stage top-left, used to find its wood in Internal #186. */
  original: readonly [x: number, y: number];
  /** The selected icon's original stage top-left. */
  selectedOriginal: readonly [x: number, y: number];
  /** Stage x the tab's icon is centred on. */
  x: number;
}

/** The tab row's centre: all four icons and their selected versions centre on it. */
export const TAB_ROW_Y = 34;

/**
 * A click target around a tab; the 43 px pitch leaves a 3 px gap between neighbours.
 * It is tall enough to take in the selected icon's top and bottom.
 */
export const TAB_HIT: { w: number; h: number } = { w: 40, h: 40 };

export const TAB_ART: readonly TabArt[] = [
  {
    tab: "stats",
    member: 130,
    selected: 206,
    source: [32, 30],
    selectedSource: [38, 39],
    crop: [1, 1, 29, 28],
    selectedCrop: [3, 4, 34, 31],
    original: [617, 21],
    selectedOriginal: [613, 17],
    x: 634,
  },
  {
    tab: "inventory",
    member: 131,
    selected: 207,
    source: [37, 24],
    selectedSource: [48, 38],
    crop: [3, 1, 33, 22],
    selectedCrop: [5, 5, 41, 31],
    original: [659, 22],
    selectedOriginal: [653, 15],
    x: 677,
  },
  {
    tab: "skills",
    member: 132,
    selected: 208,
    source: [29, 22],
    selectedSource: [36, 35],
    crop: [1, 1, 26, 20],
    selectedCrop: [1, 4, 34, 27],
    original: [706, 22],
    selectedOriginal: [702, 14],
    x: 720,
  },
  {
    tab: "spellbook",
    member: 133,
    selected: 209,
    source: [30, 27],
    selectedSource: [41, 41],
    crop: [1, 1, 28, 25],
    selectedCrop: [5, 6, 35, 34],
    original: [748, 17],
    selectedOriginal: [738, 6],
    x: 763,
  },
];
