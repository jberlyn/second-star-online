/**
 * Schema for the member rects the server's spell collision uses:
 * every bitmap of cast FX (spell FX) and cast Chars (monster and morph bodies), from
 * assets/original/main/layout/cast-manifest.jsonl; and cast Inventory (ground items), for the
 * house ghost's overlap test. Sprites 112, 180-183 and 260-269 use ink 36
 * and are never stretched, so Director's `intersects` is the plain bounding rect of the current
 * member placed by its registration point.
 *
 * Added art in assets/added/ (`fx`, `bodies`, `items`) is in the same tables, its rect taken from
 * the image and its sidecar's registration point.
 *
 * Keyed by lower-case member name (member names ignore case). Where a cast holds two
 * members with one name, the lower member number wins, because lookup finds it first.
 */
import { z } from "zod";

const int = z.number().int();

/** `[width, height, regX, regY]`. */
export const memberRectSchema = z.tuple([int.nonnegative(), int.nonnegative(), int, int]);

export const rectsDataSchema = z.strictObject({
  fx: z.record(z.string(), memberRectSchema),
  chars: z.record(z.string(), memberRectSchema),
  items: z.record(z.string(), memberRectSchema),
});

export type MemberRect = z.infer<typeof memberRectSchema>;
export type RectsData = z.infer<typeof rectsDataSchema>;
