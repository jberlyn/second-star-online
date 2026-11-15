/**
 * Sidecars for art and sounds added on top of the original, in
 * assets/added/<group>/<name>.png|.wav|.mp3.
 * Examples: assets/added/paperdoll/Frost Bow-F2-S.json next to the PNG;
 * assets/added/sounds/icecrack.json next to icecrack.wav.
 */
import { z } from "zod";

/** Art: the five atlas groups. The registration point is the image's own anchor. */
export const addedArtSchema = z.strictObject({
  group: z.enum(["tiles", "bodies", "paperdoll", "fx", "items"]),
  regX: z.number().int(),
  regY: z.number().int(),
  key: z.enum(["none", "green", "white", "matte"]),
  prov: z.literal("authored"),
  note: z.string().min(1),
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
