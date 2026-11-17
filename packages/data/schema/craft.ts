/**
 * Schema for the crafting stations' tables that `data:build` emits from
 * `packages/data/content/craft.json`.
 *
 * A `gt` row applies when the skill is greater than `gt`; an `lt` row when it is less than
 * `lt`. Each table checks every row in order; each match overwrites the previous one, so the last
 * row wins, and a value no row matches keeps the default.
 *
 */
import { z } from "zod";

const gtRow = z.strictObject({ gt: z.number().int(), value: z.number().int() });
const skillRow = z.union([
  gtRow,
  z.strictObject({ lt: z.number().int(), value: z.number().int() }),
]);
const timer = z.strictObject({ default: z.number().int().positive(), rows: z.array(gtRow).min(1) });
const recipe = z.strictObject({ input: z.string().min(1), output: z.string().min(1) });

export const craftDataSchema = z.strictObject({
  stations: z.strictObject({
    /** The order the four counters run in one frame, and the smith FX roll. */
    frameOrder: z.strictObject({
      order: z.tuple([z.literal("Smith"), z.literal("Cook"), z.literal("Build"), z.literal("Mix")]),
      smithFxChance: z.number().int().positive(),
    }),
    /** `random(value) = 1` fails (cooking, alchemy, carpentry; written five times, equal). */
    failure: z.strictObject({ rows: z.array(skillRow).min(1) }),
    smith: z.strictObject({
      station: z.string(),
      /** LeftHand, exactly. */
      tool: z.string(),
      /** "too crowded" when more slots than this are occupied. */
      maxOccupied: z.number().int(),
      timer,
      chunkDefault: z.string(),
      chunks: z.array(z.strictObject({ item: z.string(), chunk: z.string() })).min(1),
      repairs: z.array(recipe).min(1),
      masterworkPool: z.strictObject({ default: z.number().int(), rows: z.array(gtRow).min(1) }),
      masterwork: z
        .array(
          z.strictObject({
            item: z.string(),
            outcomes: z.array(z.strictObject({ roll: z.number().int(), result: z.string() })),
          }),
        )
        .min(1),
    }),
    cook: z.strictObject({
      stations: z.array(z.string()).min(1),
      /** The station that doubles the timer. */
      doubles: z.string(),
      minSkill: z.number().int(),
      timer,
      /** The cooking recipes: an item with none cannot be cooked. */
      recipes: z.array(recipe).min(1),
    }),
    mix: z.strictObject({
      station: z.string(),
      timer,
      /** The RightHand must be one of these sands exactly; it is a tool and is never used up. */
      sands: z
        .array(
          z.strictObject({
            sand: z.string(),
            potion: z.string(),
            crystal: z.string(),
            need: z.string(),
          }),
        )
        .min(1),
    }),
    build: z.strictObject({
      /** RightHand, exactly. */
      tool: z.string(),
      /** Carpentry below this cannot build. */
      minSkill: z.number().int(),
      timer,
      /** Carpentry skill bands in script order; every true `lt` band overwrites the last. */
      bands: z
        .array(
          z.strictObject({
            lt: z.number().int(),
            pool: z.number().int().positive().nullable(),
            results: z
              .array(
                z.strictObject({
                  roll: z.number().int().nullable(),
                  item: z.string(),
                  /**
                   * 1.6 appended a client-chosen random number from 1 to 100000; SSO mints the id.
                   */
                  id: z.boolean(),
                }),
              )
              .min(1),
          }),
        )
        .min(1),
    }),
    startPause: z.strictObject({
      Smith: z.number().int(),
      Cook: z.number().int(),
      Mix: z.number().int(),
      Build: z.number().int(),
    }),
    cauldron: z.strictObject({
      match: z.string(),
      capacity: z.number().int().positive(),
      recipes: z
        /** Both ingredients by exact name; the first matching recipe wins. */
        .array(z.strictObject({ requires: z.tuple([z.string(), z.string()]), result: z.string() }))
        .min(1),
    }),
    texts: z.record(z.string(), z.strictObject({ text: z.string().min(1) })),
  }),
});

export type CraftData = z.infer<typeof craftDataSchema>;
