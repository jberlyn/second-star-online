/**
 * The shape of the generated asset index, written by
 * `bun run assets:build` to packages/data/assets/index.json and served at /assets/.
 * Types only, so the client can import them.
 */

/**
 * Atlas groups: one per playfield cast (fx = the FX cast: splats, kill puffs, spells;
 * items = the Inventory cast: item icons, ground piles and fixtures).
 */
export type AtlasGroup = "tiles" | "bodies" | "paperdoll" | "fx" | "items";

/** `[sheet, x, y, w, h, regX, regY]` */
export type AtlasSprite = [number, number, number, number, number, number, number];

export interface AtlasIndex {
  /** Sheet files, relative to /assets/. */
  sheets: string[];
  /**
   * Sprites by lower-cased member name: member lookup ignores case, and when
   * two members share a name the lower-numbered one wins, because lookup returns it.
   */
  sprites: Record<string, AtlasSprite>;
}

export interface UiFile {
  file: string;
  w: number;
  h: number;
  regX: number;
  regY: number;
}

export interface AssetIndex {
  version: 1;
  /** Hash of every input; the build is skipped when it matches. */
  inputHash: string;
  atlases: Record<AtlasGroup, AtlasIndex>;
  /** Large UI art as single files, by `<cast>:<member>` (e.g. `internal:186`). */
  ui: Record<string, UiFile>;
  /** Sounds of the Audio cast by lower-cased member name (`hitsound`, `stone skin`): WAV, or MP3 for `churchy`. */
  sounds: Record<string, string>;
}

export const ASSET_INDEX_FILE = "index.json";
