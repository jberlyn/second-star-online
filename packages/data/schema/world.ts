/**
 * Schema for a pack's world seed (issue #37 stage 7): the maps and the start, fallback and jail
 * points a new world gets when its database is created with this pack (`SSO_CONTENT`). It is
 * applied once: from then on the maps and the points are the operator's, so a pack update never
 * moves them.
 */
import { z } from "zod";

import { seedMapDataSchema } from "./seed-map.ts";

/** A grid map's name, `x<n>y<n>` with whole numbers (negatives allowed). */
export const gridMapNameSchema = z.string().regex(/^x-?\d+y-?\d+$/, "a map name like x0y0");

/** A point a player can stand on: a map and a tile (1-17 across, 1-12 down). */
export const worldPointSchema = z.strictObject({
  map: gridMapNameSchema,
  x: z.number().int().min(1).max(17),
  y: z.number().int().min(1).max(12),
});

/** Map field 12's switches: "O" turns that thing off ("X" leaves it on). */
const onOff = z.enum(["O", "X"]);

/** A seeded map: its grid name, title and four layers, and its switches (all on when absent). */
export const worldMapSchema = seedMapDataSchema.extend({
  map: gridMapNameSchema,
  flags: z.strictObject({ canFight: onOff, isIndoors: onOff, canPvp: onOff }).partial().optional(),
});

export const worldSeedSchema = z
  .strictObject({
    maps: z.array(worldMapSchema).min(1),
    startPoint: worldPointSchema,
    fallbackPoint: worldPointSchema,
    jailPoint: worldPointSchema,
    /** The church bell's map, or null for no bell. */
    bellMap: gridMapNameSchema.nullable(),
  })
  .superRefine((w, ctx) => {
    // A map by its numbers: `x00y0` is `x0y0`, as the world saves it.
    const at = (name: string) => {
      const m = /^x(-?\d+)y(-?\d+)$/i.exec(name);
      return m ? `${Number(m[1])},${Number(m[2])}` : name.toLowerCase();
    };
    const names = new Set<string>();
    w.maps.forEach((m, i) => {
      if (names.has(at(m.map))) {
        ctx.addIssue({ code: "custom", path: ["maps", i, "map"], message: `${m.map} twice` });
      }
      names.add(at(m.map));
    });
    // The seed holds every map its points stand on, and keeps the jail apart.
    for (const key of ["startPoint", "fallbackPoint", "jailPoint"] as const) {
      if (!names.has(at(w[key].map))) {
        ctx.addIssue({
          code: "custom",
          path: [key, "map"],
          message: `${w[key].map} is not one of the seed's maps`,
        });
      }
    }
    for (const key of ["startPoint", "fallbackPoint"] as const) {
      if (at(w[key].map) === at(w.jailPoint.map)) {
        ctx.addIssue({
          code: "custom",
          path: [key, "map"],
          message: "the start and fallback points cannot be on the jail's map",
        });
      }
    }
  });

export type WorldPoint = z.infer<typeof worldPointSchema>;
export type WorldMap = z.infer<typeof worldMapSchema>;
export type WorldSeed = z.infer<typeof worldSeedSchema>;
