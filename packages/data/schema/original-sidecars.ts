/**
 * assets/original-sidecars.json: the corrections SSO makes to original art, keyed by
 * `<cast>/<member name>` (`Chars/31-F1-N`). The same fields as an added sidecar's corrections; the
 * image's size, registration point and colour key stay in the cast manifest. A member with no
 * correction has no entry.
 */
import { z } from "zod";

import { artCorrections } from "./added-asset.ts";

export const originalSidecarSchema = z.strictObject(artCorrections);

export const originalSidecarsSchema = z.record(
  z.string().regex(/^[^/]+\/.+$/),
  originalSidecarSchema,
);

export type OriginalSidecar = z.infer<typeof originalSidecarSchema>;
export type OriginalSidecars = z.infer<typeof originalSidecarsSchema>;
