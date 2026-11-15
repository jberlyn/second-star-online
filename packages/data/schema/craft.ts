/**
 * Schema for the crafting stations' tables that `data:build` emits from
 * `packages/data/content/craft.json`.
 *
 * A `gt` row applies when the skill is greater than `gt`; an `lt` row when it is less than
 * `lt`. Each table checks every row in order; each match overwrites the previous one, so the last
 * row wins, and a value no row matches keeps the default (or, for the failure table, rolls
 * nothing: skill exactly 10 never fails).
 *
 */
import { z } from "zod";

const gtRow = z.strictObject({ gt: z.number().int(), value: z.number().int() });
const skillRow = z.union([
  gtRow,
  z.strictObject({ lt: z.number().int(), value: z.number().int() }),
]);
const timer = z.strictObject({ default: z.number().int().positive(), rows: z.array(gtRow).min(1) });
const pair = z.strictObject({ item: z.string().min(1), food: z.string().min(1) });
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
      /** Click names that select the raw food to cook. */
      clickFoods: z.array(pair).min(1),
      /** Cooked food names on completion: any other falls back to the selected food. */
      doneFoods: z.array(pair).min(1),
      /** The server's cooking recipes. */
      recipes: z.array(recipe).min(1),
    }),
    mix: z.strictObject({
      station: z.string(),
      /** RightHand `contains` this. */
      sandMatch: z.string(),
      timer,
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
        .array(z.strictObject({ requires: z.tuple([z.string(), z.string()]), result: z.string() }))
        .min(1),
    }),
    texts: z.record(z.string(), z.strictObject({ text: z.string().min(1) })),
  }),
});

export type CraftData = z.infer<typeof craftDataSchema>;
