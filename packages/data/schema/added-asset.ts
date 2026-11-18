/**
 * Sidecars for art and sounds added on top of the original, in
 * assets/added/<group>/<name>.png|.wav|.mp3.
 * Examples: assets/added/paperdoll/Frost Bow-F2-S.json next to the PNG;
 * assets/added/sounds/icecrack.json next to icecrack.wav.
 */
import { z } from "zod";

/**
 * What SSO decides about an image, beyond what the image itself records: the same fields for
 * added art (in its sidecar) and original art (in assets/original-sidecars.json).
 */
export const artCorrections = {
  /**
   * A north frame (`-F<n>-N`) of a paperdoll layer or body drawn mirrored, like 1.6's back views:
   * the asset build flips it. Set on every north frame of the layer or body, or on none.
   */
  mirrored: z.literal(true).optional(),
};

/** Art: the five atlas groups. The registration point is the image's own anchor. */
export const addedArtSchema = z.strictObject({
  group: z.enum(["tiles", "bodies", "paperdoll", "fx", "items"]),
  regX: z.number().int(),
  regY: z.number().int(),
  key: z.enum(["none", "green", "white", "matte"]),
  prov: z.literal("authored"),
  note: z.string().min(1),
  ...artCorrections,
});

/** A sound: nothing but where it came from. The channel belongs to the content row that plays it. */
export const addedSoundSchema = z.strictObject({
  group: z.literal("sounds"),
  prov: z.literal("authored"),
  note: z.string().min(1),
});

export const addedAssetSchema = z.discriminatedUnion("group", [addedArtSchema, addedSoundSchema]);

export type AddedArt = z.infer<typeof addedArtSchema>;
export type AddedSound = z.infer<typeof addedSoundSchema>;
export type AddedAsset = z.infer<typeof addedAssetSchema>;
