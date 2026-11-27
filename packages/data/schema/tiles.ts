/** Schema for the editable tile catalogue and walk whitelist. */
import { z } from "zod";

/**
 * Tile codes are 2 characters: the walk test joins the tokens and uses `contains`, so a longer
 * token would make its 2-character substrings walkable (`shared/rules/core/walk.ts`).
 */
export const whitelistTokenSchema = z.strictObject({ code: z.string().length(2) });

/**
 * Tile meanings tested by code:
 * - `sea` (layer 1): deep water where sea creatures spawn and move.
 * - `airshipBlock` (layer 2): tiles that block an Airship.
 * - `dock` (layer 1, all 12 rows): Airship landing pads.
 * - `arena` (layer 1, all 12 rows): arena challenge tiles.
 * - `grave` (layer 2): graves for Raise Dead.
 */
export const tileFlagSchema = z.enum(["sea", "airshipBlock", "dock", "arena", "grave"]);

export const tileSchema = z.strictObject({
  code: z.string().min(1),
  /**
   * What the playfield hover tip calls this tile when it is on layer 2 and nothing else is under
   * the mouse (an SSO addition: 1.6 named no tiles). Absent tiles are never named, so name only
   * tiles a player uses: trees, rocks, crops and what they turn into.
   */
  name: z.string().trim().min(1).optional(),
  /** MapGFX cast member number for original tiles (pages 1-10). Absent on added tiles (page 10 slots 50-60, then pages 11+). */
  member: z.number().int().optional(),
  flags: z
    .array(tileFlagSchema)
    .min(1)
    .refine((a) => new Set(a).size === a.length, { message: "duplicate tile flag" })
    .optional(),
});

/**
 * Single-valued tile defaults:
 * - `ground`: blank-map layer 1 ground tile.
 * - `empty`: blank-map layers 2 and 3 empty tile, house footprint layer-2 requirement, and house demolish reset.
 * - `shadow`: blank-map layer S shadow tile and the layer-3 (7, 6) mark.
 * - `editorTile`: the tile 1.6's World Editor had selected when it opened. Nothing reads it now (the
 *   World page starts with no tile picked).
 */
export const tileDefaultsSchema = z.strictObject({
  ground: z.string().min(1),
  empty: z.string().min(1),
  shadow: z.string().min(1),
  editorTile: z.string().min(1),
});

/** The part of tiles.json that `data:build` emits. */
export const tilesDataSchema = z
  .strictObject({
    walkable: z.array(whitelistTokenSchema),
    catalogue: z.array(tileSchema),
    defaults: tileDefaultsSchema,
  })
  .refine(
    (d) => {
      const codes = new Set(d.catalogue.map((t) => t.code));
      return (
        codes.has(d.defaults.ground) &&
        codes.has(d.defaults.empty) &&
        codes.has(d.defaults.shadow) &&
        codes.has(d.defaults.editorTile)
      );
    },
    { message: "each default must name a catalogue tile" },
  );

export type WhitelistToken = z.infer<typeof whitelistTokenSchema>;
export type TileFlag = z.infer<typeof tileFlagSchema>;
export type Tile = z.infer<typeof tileSchema>;
export type TileDefaults = z.infer<typeof tileDefaultsSchema>;
export type TilesData = z.infer<typeof tilesDataSchema>;
