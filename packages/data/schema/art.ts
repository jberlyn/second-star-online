/**
 * Schema for uploaded art and sounds (issue #29): the `art` dataset. Each row names the sprite or
 * sound the engine draws or plays and the uploaded file(s) that supply it, by content hash. The
 * files themselves live in the server's file store (`<data dir>/content/`), never in the row.
 *
 * Rows sit in the content store's operator layer like any other row, so an upload goes live with
 * the draft's publish and is undone with it. Packs may carry art rows too (an exported pack,
 * #34); the shipped packs' own art is their built atlases (`art/` beside the pack), so their
 * `art` dataset is empty. An art row whose sprite a pack also draws replaces the pack's picture.
 *
 * Server-only: clients get the art through the asset index, not through this dataset.
 */
import { z } from "zod";

/** A file in the server's store: the SHA-256 of its bytes, in lower-case hex. */
export const artFileSchema = z.string().regex(/^[0-9a-f]{64}$/, "a file's SHA-256 (64 hex digits)");

/** Body numbers run 1 to 9999 everywhere (monsters, bindings, uploads). */
export const BODY_MAX = 9999;
/** Uploaded bodies are numbered from here, so no pack's own numbers are taken. */
export const OPERATOR_BODY_MIN = 1000;

/** A body number, wherever one is named: a monster's body, a binding's, an uploaded body's. */
export const bodyNumberSchema = z
  .number()
  .int()
  .min(1, "body numbers start at 1")
  .max(BODY_MAX, `body numbers go up to ${BODY_MAX}`);

/**
 * The first free body number for an upload (1000 up), or null with every one taken. `taken` holds
 * the numbers the packs' art and the content already use.
 */
export function nextOperatorBody(taken: ReadonlySet<number>): number | null {
  for (let n = OPERATOR_BODY_MIN; n <= BODY_MAX; n++) {
    if (!taken.has(n)) {
      return n;
    }
  }
  return null;
}

/** What an upload is told when 1000-9999 are all taken. */
export const NO_BODY_NUMBERS = `No body numbers left (uploaded bodies use ${OPERATOR_BODY_MIN} to ${BODY_MAX}).`;

/** A registration point, relative to the image's top-left. */
const coord = z.number().int().min(-2048).max(2048);

/**
 * How the image's transparency is read: its own alpha (`alpha`, the default), or 1.6's convention
 * of pure green (0, 255, 0) as see-through (`green`).
 */
export const artTransparencySchema = z.enum(["alpha", "green"]);

/** A walk or attack frame: `f1`-`f4` and a facing. */
export const ART_FRAME_IDS = [
  "f1-n",
  "f1-e",
  "f1-s",
  "f1-w",
  "f2-n",
  "f2-e",
  "f2-s",
  "f2-w",
  "f3-n",
  "f3-e",
  "f3-s",
  "f3-w",
  "f4-n",
  "f4-e",
  "f4-s",
  "f4-w",
] as const;
export type ArtFrameId = (typeof ART_FRAME_IDS)[number];
const frameIdSchema = z.enum(ART_FRAME_IDS);

const anchored = z.strictObject({ file: artFileSchema, regX: coord, regY: coord });

/** An item's picture: the bag icon, the equipment box and the ground (`items` atlas). */
export const artItemSchema = z.strictObject({
  /** The sprite: an item's key or its `sprite` (case ignored). */
  name: z.string().trim().min(1).max(80),
  file: artFileSchema,
  regX: coord,
  regY: coord,
  transparency: artTransparencySchema.optional(),
});

/**
 * A worn layer (`paperdoll` atlas): one picture per frame, pasted at the 46×45 character's
 * top-left, so a frame has no anchor of its own.
 */
export const artWornSchema = z.strictObject({
  /** The layer: the worn item's key (after `paperdoll.aliases`), `+N` dropped. */
  name: z.string().trim().min(1).max(80),
  frames: z.partialRecord(frameIdSchema, z.strictObject({ file: artFileSchema })),
  /** The north frames are drawn mirrored, the way 1.6 drew its back views: they are flipped. */
  mirrored: z.literal(true).optional(),
  transparency: artTransparencySchema.optional(),
});

/** A monster or morph body (`bodies` atlas): every walk and attack frame, each anchored. */
export const artBodySchema = z.strictObject({
  /** The body number, as text (`"1000"`). */
  name: z.string().regex(/^[1-9][0-9]{0,3}$/, `a body number from 1 to ${BODY_MAX}`),
  frames: z.partialRecord(frameIdSchema, anchored),
  mirrored: z.literal(true).optional(),
  transparency: artTransparencySchema.optional(),
});

/** A spell effect run (`fx` atlas): `<name>-1` … `<name>-<n>`, and its trail `x<name>-<n>`. */
export const artFxSchema = z.strictObject({
  /** The run's member, as a spell's FX run names it. */
  name: z.string().trim().min(1).max(80),
  frames: z.array(anchored).min(1).max(99),
  trail: z.array(anchored).min(1).max(99).optional(),
  transparency: artTransparencySchema.optional(),
});

/** A map tile (`tiles` atlas), pasted at its cell's top-left. */
export const artTileSchema = z.strictObject({
  /** The tile code (2 characters). */
  code: z.string().length(2),
  file: artFileSchema,
  transparency: artTransparencySchema.optional(),
});

export const ART_SOUND_FORMATS = ["wav", "mp3", "ogg"] as const;
export type ArtSoundFormat = (typeof ART_SOUND_FORMATS)[number];

/** A sound, played by naming it in a content row. */
export const artSoundSchema = z.strictObject({
  /** The sound's name (case ignored). */
  name: z.string().trim().min(1).max(80),
  file: artFileSchema,
  format: z.enum(ART_SOUND_FORMATS),
});

export const artDataSchema = z.strictObject({
  items: z.array(artItemSchema),
  paperdoll: z.array(artWornSchema),
  bodies: z.array(artBodySchema),
  fx: z.array(artFxSchema),
  tiles: z.array(artTileSchema),
  sounds: z.array(artSoundSchema),
});

export type ArtItem = z.infer<typeof artItemSchema>;
export type ArtWorn = z.infer<typeof artWornSchema>;
export type ArtBody = z.infer<typeof artBodySchema>;
export type ArtFx = z.infer<typeof artFxSchema>;
export type ArtTile = z.infer<typeof artTileSchema>;
export type ArtSound = z.infer<typeof artSoundSchema>;
export type ArtData = z.infer<typeof artDataSchema>;
export type ArtTransparency = z.infer<typeof artTransparencySchema>;

/** A pack with no art rows (every shipped pack: their art is their built atlases). */
export const EMPTY_ART: ArtData = {
  items: [],
  paperdoll: [],
  bodies: [],
  fx: [],
  tiles: [],
  sounds: [],
};
