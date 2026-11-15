/** The landscape used when a database first creates its starting map. */
import { z } from "zod";

const row = z.string().refine((s) => /^(\S+ ){16}\S+$/.test(s), {
  message: "a map row must contain 17 space-separated tile codes",
});
const layer = z.array(row).length(12);

export const seedMapDataSchema = z.strictObject({
  title: z.string().min(1).max(200),
  layers: z.tuple([layer, layer, layer, layer]),
});

export type SeedMapData = z.infer<typeof seedMapDataSchema>;
