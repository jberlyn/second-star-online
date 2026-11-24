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

/** A tile on the 17×12 map. */
const tileX = z.number().int().min(1).max(17);
const tileY = z.number().int().min(1).max(12);

/**
 * An exit (map field 13 or 18): the target map and tile; `house` marks a house's exit, whose
 * target is the interior `xH<slot><mx>yH<slot><my>`.
 */
const worldExitSchema = z.strictObject({
  mx: z.number().int(),
  my: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
  house: z.union([z.literal(1), z.literal(2)]).optional(),
});

/**
 * A seeded map: its grid name, title and four layers, and its switches (all on when absent). A pack
 * built from a world (Classic, from 1.6's maps, #43) also gives the rest of the World Editor's
 * fields: the faction spawn swap, the exits, the signs, the fog, the roster (the editor's placed
 * monsters, by slot, with their home tiles) and the placed ground items (as the editor saves them:
 * a gold pile's count is in its name). Absent, each is empty.
 */
export const worldMapSchema = seedMapDataSchema.extend({
  map: gridMapNameSchema,
  /** The header; 1.6 left most of its maps' empty. */
  title: z.string().max(200),
  flags: z
    .strictObject({
      canFight: onOff,
      isIndoors: onOff,
      canPvp: onOff,
      /** The faction whose member species spawns in place of the roster's, by key. */
      fctSpwn: z.string().min(1).max(40),
    })
    .partial()
    .optional(),
  exit1: worldExitSchema.nullable().optional(),
  exit2: worldExitSchema.nullable().optional(),
  signs: z.tuple([z.string().max(2000), z.string().max(2000), z.string().max(2000)]).optional(),
  fog: z
    .strictObject({
      tex: z.string().min(1).max(40),
      blend: z.number().int().min(0).max(255),
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255),
    })
    .optional(),
  roster: z
    .array(
      z.strictObject({
        slot: z.number().int().min(1).max(4),
        species: z.string().min(1),
        x: tileX,
        y: tileY,
      }),
    )
    .max(4)
    .refine((r) => new Set(r.map((e) => e.slot)).size === r.length, { message: "a slot twice" })
    .optional(),
  // At most the World Editor's 20 placed items, so the map can be saved again as it came. A pile
  // of more than one gives its count as `qty`; only the currency and crystals carry it in their
  // name instead (`"3 Gold"`), as the editor saves them (see `seedItemProblem`).
  items: z
    .array(
      z.strictObject({
        item: z.string().min(1).max(80),
        x: tileX,
        y: tileY,
        qty: z.number().int().min(1).max(9999).optional(),
      }),
    )
    .max(20)
    .optional(),
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

/**
 * Why a seed's placed item name cannot stand, or null. `items` are the pack's item names and
 * `currency` its currency item, `qty` the placement's own count. A name with a leading count (at
 * least 1, and with no `qty` beside it) is a pile only for the currency or a crystal (`"3 Gold"`,
 * `"5 Blue Crystal"`, as the World Editor saves them); any other count goes in `qty`, so
 * `"2 Apple"` is refused rather than placed as an item literally named "2 Apple".
 */
export function seedItemProblem(
  name: string,
  items: readonly string[],
  currency: string | null,
  qty?: number,
): string | null {
  const known = new Set(items.map((i) => i.toLowerCase()));
  const counted = /^(\d+) (.+)$/.exec(name.trim());
  if (counted) {
    const base = (counted[2] as string).toLowerCase();
    const pile =
      (currency !== null && base === currency.toLowerCase()) ||
      (/ crystal$/.test(base) && known.has(base));
    if (pile) {
      // A pile holds at least one, and its count is in its name alone.
      if (Number(counted[1]) < 1) {
        return `"${name}": a pile holds at least 1`;
      }
      if (qty !== undefined) {
        return `"${name}": the count is already in the name, so give no qty`;
      }
      return null;
    }
    if (known.has(base)) {
      return `"${name}": give a pile's count as qty ({ "item": "${counted[2]}", "qty": ${counted[1]} }); only the currency and crystals carry it in their name`;
    }
  }
  return known.has(name.trim().toLowerCase()) ? null : `"${name}" is not one of the pack's items`;
}

/**
 * Every placed item in `world` whose name cannot stand (`seedItemProblem`), as `<map>: <why>`.
 * `items` are the pack's item and fixture names, `currency` its currency item.
 */
export function worldItemProblems(
  world: WorldSeed,
  items: readonly string[],
  currency: string | null,
): string[] {
  return world.maps.flatMap((m) =>
    (m.items ?? []).flatMap((it) => {
      const why = seedItemProblem(it.item, items, currency, it.qty);
      return why === null ? [] : [`${m.map}: ${why}`];
    }),
  );
}

export type WorldPoint = z.infer<typeof worldPointSchema>;
export type WorldMap = z.infer<typeof worldMapSchema>;
export type WorldSeed = z.infer<typeof worldSeedSchema>;
