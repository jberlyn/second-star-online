/** Field schemas used by more than one protocol file. Not part of the package's public surface. */
import { z } from "zod";

export const seq = z
  .number()
  .int()
  .nonnegative()
  .max(2 ** 31);

/** A bag slot, 1-15. */
export const bagSlot = z.number().int().min(1).max(15);

export const tileX = z.number().int().min(1).max(17);

export const tileY = z.number().int().min(1).max(12);
