/**
 * Which original assets SSO builds, and where each goes (asset build).
 * One pure function decides it for both the
 * build (build/assets.ts) and the committed list `assets/original/usage.md`, so they cannot
 * drift apart.
 */
import type { AtlasGroup } from "../../src/assets.ts";
import type { ScoreUsage } from "./key.ts";

export const GROUP_CAST: Record<AtlasGroup, string> = {
  tiles: "MapGFX",
  bodies: "Chars",
  paperdoll: "Characters",
  fx: "FX",
  items: "Inventory",
};

/**
 * Audio cast members some 1.6 script plays, copied as they are (WAV; `churchy` is an MP3):
 * the sounds used in play. The 13 sounds nothing plays
 * (`fireball`, `monsterhit`, `monsterhitme`, `Ghost1`, `crunch`, `MonsterGrowl1-3`,
 * `Thunder1-3`, `windy`, `RiverFlow`) are left out.
 */
export const SOUNDS = [
  "fx",
  "fx2",
  "fx3",
  "clicksound",
  "clicksound2",
  "clear",
  "clear2",
  "bad",
  "cash",
  "heal1",
  "heal2",
  "monsterdeath",
  "swordhit1",
  "swordhit2",
  "swordhit3",
  "swordswing",
  "land",
  "hitsound",
  "crush",
  "Fireballs",
  "firebolt",
  "treechop",
  "LaserSword",
  "stone skin",
  "splash",
  "whirlwind",
  "treefalling",
  "cannonball",
  "Sawbbb",
  "PotionMix",
  "CardShuffle",
  "CardDeal",
  "SlotMachine",
  "lightning",
  "Shoveling",
  "raindrop",
  "churchy",
];

/**
 * Window art casts: the frame (Internal), the shop and vault window (shop), the
 * World Editor (WorldEdit) and the house placement ghosts (Houses).
 */
export const UI_CASTS = ["Internal", "shop", "WorldEdit", "Houses", "Mail", "Paintings", "Casino"];

/**
 * Unnamed Inventory members are window art (the item menu Inventory #50-56, the equipment
 * boxes #1), built as UI files; named ones are item icons and go on the `items` atlas.
 */
export const UI_UNNAMED_CASTS = ["Inventory"];

/**
 * Inventory members the original renames at runtime and saved under stale names ("2 Gold",
 * "Painting#6959517"): the ground-item scratch members 460-479
 * and the bag pools for cabinets, crates, wind cabinets, paintings, cauldrons and photos.
 * They are not art: name lookup would otherwise
 * find "2 Gold" there.
 */
const INVENTORY_SCRATCH: readonly [number, number][] = [
  [460, 479],
  [590, 604],
  [620, 634],
  [660, 674],
  [680, 694],
  [710, 724],
  [730, 744],
];

/**
 * One picture per bag pool, kept under its own name for the bag icon (the original's inventory drawing renames a
 * pool member to the carried `Name#n` and shows it).
 * The 15 members of a pool hold the same 32×32 picture; the first is taken.
 */
const BAG_POOLS: readonly [number, string][] = [
  [590, "CabinetBag"],
  [620, "CrateBag"],
  [660, "WindCabinetBag"],
  [680, "PaintingBag"],
  [710, "CauldronBag"],
  [730, "PhotoBag"],
];

const isInventoryScratch = (b: { cast: string; member: number }) =>
  b.cast === "Inventory" && INVENTORY_SCRATCH.some(([lo, hi]) => b.member >= lo && b.member <= hi);

/**
 * Sub-movie windows whose art is built as UI files. Their manifests live in
 * assets/original/sub/<movie>/layout/ and their bitmaps in assets/original/sub/<movie>/bitmaps/.
 */
export const UI_SUB_MOVIES = [
  "WhoWindow",
  "BioWindow",
  "TradeWindow",
  // IMwin2-10 share IMwin1's art (identical bitmaps), so only IMwin1 is built.
  "IMsend",
  "IMwin1",
  "AwayMessageWindow",
  "ChatWindow",
  // The Friends window.
  "Friendsgui",
  // The newspaper reader and editor.
  "Newspaper",
  "newspapergui",
  // The Checkers window (board 1, Black 2, White 3, BlackKing 6, WhiteKing 7, Box 8,
  // turn marker 14).
  "Checkers",
];

/**
 * `SP<sprite>-F<n>-<facing>` members of `Chars` are scratch images the original paints
 * players into at runtime (the original's character renderer), not art.
 */
const SCRATCH = /^SP\d+-F\d-[NSEW]$/i;

export const MAIN_MOVIE = "main";

export interface ManifestBitmap {
  castLib: number;
  /** The cast's name; for a sub-movie member the movie's name (the key prefix of its UI id). */
  cast: string;
  /** The cast's own name, also for a sub-movie member. */
  castName?: string;
  /** `main` or the sub-movie's name. */
  movie?: string;
  member: number;
  name: string;
  type: string;
  asset: string;
  width: number;
  height: number;
  regX: number;
  regY: number;
  keyHint: string;
  flags22?: number;
  scoreUsage?: ScoreUsage[];
  /** Folder the `asset` path is relative to; set for sub-movie members. */
  root?: string;
}

export interface ManifestSound {
  castLib: number;
  cast: string;
  member: number;
  name: string;
  type: string;
  asset: string[];
  movie?: string;
}

export type Use =
  | { kind: "atlas"; group: AtlasGroup; as?: string }
  | { kind: "ui"; file: string }
  | { kind: "sound"; file: string }
  | { kind: "none"; reason: string };

export interface AtlasEntry {
  b: ManifestBitmap;
  /** The sprite's name: the member's own, or the bag pool's. */
  name: string;
}

export interface Selection {
  /** Per atlas group, the sources in build order (members, then bag pools). */
  atlas: Record<AtlasGroup, AtlasEntry[]>;
  /** UI files in build order: main movie, then `UI_SUB_MOVIES` in their order. */
  ui: ManifestBitmap[];
  /** The Audio sounds some script plays, in manifest order. */
  sounds: ManifestSound[];
  bitmapUse: Map<ManifestBitmap, Use>;
  soundUse: Map<ManifestSound, Use>;
}

/** Where the build writes a UI member. */
export const uiFile = (b: ManifestBitmap) => `ui/${b.cast.toLowerCase()}-${b.member}.png`;

/** Where the build writes a sound. The first asset is the media: `churchy`'s is the MP3. */
export function soundFile(snd: ManifestSound): string {
  const src = snd.asset[0] as string;
  return `sounds/${snd.name.toLowerCase().replaceAll(" ", "-")}${src.slice(src.lastIndexOf("."))}`;
}

const isMain = (m: { movie?: string }) => (m.movie ?? MAIN_MOVIE) === MAIN_MOVIE;

/**
 * `main` and `sub` are bitmap members sorted by cast then member (sub-movie members carry their
 * movie as `cast`); `sounds` are the sound members of every movie.
 */
export function selectMembers(
  main: ManifestBitmap[],
  sub: ManifestBitmap[],
  sounds: ManifestSound[],
): Selection {
  const bitmapUse = new Map<ManifestBitmap, Use>();
  const soundUse = new Map<ManifestSound, Use>();
  const atlas = {} as Record<AtlasGroup, AtlasEntry[]>;

  for (const group of Object.keys(GROUP_CAST).sort() as AtlasGroup[]) {
    const byKey = new Map<string, AtlasEntry>();
    for (const b of main) {
      if (b.cast !== GROUP_CAST[group]) {
        continue;
      }
      const key = b.name.toLowerCase();
      if (!b.name) {
        // Unnamed Inventory members are window art, built below.
        if (!UI_UNNAMED_CASTS.includes(b.cast)) {
          bitmapUse.set(b, { kind: "none", reason: "unnamed" });
        }
      } else if (SCRATCH.test(b.name)) {
        bitmapUse.set(b, { kind: "none", reason: "scratch (painted at run time)" });
      } else if (isInventoryScratch(b)) {
        bitmapUse.set(b, { kind: "none", reason: "scratch (renamed at run time)" });
      } else if (byKey.has(key)) {
        // name lookup finds the lowest-numbered member
        const first = (byKey.get(key) as AtlasEntry).b;
        bitmapUse.set(b, {
          kind: "none",
          reason: `duplicate name (${first.cast} #${first.member} is built)`,
        });
      } else {
        byKey.set(key, { b, name: b.name });
        bitmapUse.set(b, { kind: "atlas", group });
      }
    }
    if (GROUP_CAST[group] === "Inventory") {
      for (const [member, name] of BAG_POOLS) {
        const b = main.find((x) => x.cast === "Inventory" && x.member === member);
        if (!b) {
          throw new Error(`bag pool member Inventory #${member} is missing`);
        }
        byKey.set(name.toLowerCase(), { b, name });
        bitmapUse.set(b, { kind: "atlas", group, as: name });
      }
    }
    atlas[group] = [...byKey.values()];
  }

  const ui: ManifestBitmap[] = [];
  const addUi = (b: ManifestBitmap) => {
    ui.push(b);
    bitmapUse.set(b, { kind: "ui", file: uiFile(b) });
  };
  for (const b of main) {
    if (UI_CASTS.includes(b.cast) || (UI_UNNAMED_CASTS.includes(b.cast) && !b.name)) {
      addUi(b);
    }
  }
  for (const movie of UI_SUB_MOVIES) {
    for (const b of sub) {
      if (b.cast === movie) {
        addUi(b);
      }
    }
  }

  for (const b of [...main, ...sub]) {
    if (!bitmapUse.has(b)) {
      bitmapUse.set(b, { kind: "none", reason: unusedReason(b) });
    }
  }

  const built: ManifestSound[] = [];
  for (const snd of sounds) {
    if (!isMain(snd)) {
      soundUse.set(snd, { kind: "none", reason: "movie not used" });
    } else if (snd.cast === "Audio" && SOUNDS.includes(snd.name)) {
      built.push(snd);
      soundUse.set(snd, { kind: "sound", file: soundFile(snd) });
    } else {
      soundUse.set(snd, { kind: "none", reason: "sound nothing plays" });
    }
  }

  return { atlas, ui, sounds: built, bitmapUse, soundUse };
}

function unusedReason(b: ManifestBitmap): string {
  if (!isMain(b)) {
    return /^IMwin([2-9]|10)$/.test(b.cast) ? "copy of IMwin1" : "movie not used";
  }
  return "cast not used";
}
