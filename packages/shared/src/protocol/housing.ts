/** House placement. */
import { z } from "zod";

import { bagSlot, tileX, tileY } from "./fields.ts";

/**
 * A click on the playfield in placement mode (`HouseEExit` mouseUp): the deed's bag slot and the
 * hovered tile.
 */
export const placeHouseSchema = z.strictObject({
  t: z.literal("placeHouse"),
  slot: bagSlot,
  x: tileX,
  y: tileY,
});

/** Placement left: the pointer left the playfield, a bag slot was clicked, or Cancel. */
export const placeCancelSchema = z.strictObject({ t: z.literal("placeCancel") });

export type HousingServerMsg =
  /**
   * Placement mode: a house deed's Use starts it with the house art member to draw as the ghost; a
   * build ends it (`house` null).
   */
  { t: "placing"; house: string | null; slot: number };
