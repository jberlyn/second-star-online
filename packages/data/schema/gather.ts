/**
 * Schema for the gathering tables and the crafting skill handlers that `data:build` emits from
 * `packages/data/content/gather.json`.
 *
 * A `gt` row applies when the skill is greater than `gt` (a `>= 0` row is `gt: -1`); an `lt`
 * row when it is less than `lt`. Each table checks all its rows in order: every true row overwrites
 * the last, so the last true row wins.
 *
 */
import { z } from "zod";

const gtRow = z.strictObject({ gt: z.number().int(), value: z.number().int() });
const ltRow = z.strictObject({ lt: z.number().int(), value: z.number().int() });
const tilePair = z.strictObject({ from: z.string().length(2), to: z.string().length(2) });
const sound = z.strictObject({ name: z.string().min(1), ch: z.number().int().min(1).max(8) });
const offset = z.tuple([z.number().int(), z.number().int()]);

export const gatherToolSchema = z.strictObject({
  /** The LeftHand item as the swing message carries it. */
  tool: z.string().min(1),
  /** `contains` (Axe: Gold Axe too) or `=`. */
  match: z.enum(["contains", "="]),
  /** Which counter it advances: Chop, Dig, Farm, Watering or the one Mine for all hammers. */
  counter: z.enum(["Chop", "Dig", "Farm", "Watering", "Mine"]),
  skill: z.string().min(1),
  /** Layer 2 from → to on success (the bucket's pairs are `farming.watering`). */
  tiles: tilePair.optional(),
  /** Played on channel 2 to the gatherer on the swing that succeeds. */
  successSound: sound.nullable(),
  /** Replaces the swing sound, for everyone, when the faced tile is the tool's. */
  hitSound: sound.nullable(),
  /** The skill handler run on every success (`skillGain`). */
  imp: z.string().nullable(),
});

export const skillGainSchema = z.strictObject({
  handler: z.string().min(1),
  skill: z.string().min(1),
  /** `random(chance) = 1`. */
  chance: z.number().int().positive(),
  /** Rolls only while min <= skill < below (above 0 and below 100). */
  min: z.number().int(),
  below: z.number().int(),
  text: z.string().min(1),
});

export const gatherDataSchema = z.strictObject({
  gathering: z.strictObject({
    counterTable: z.array(gtRow).min(1),
    shovelLayer1: z.strictObject({ test: z.string().min(1) }),
    tools: z.array(gatherToolSchema).min(1),
    logs: z.strictObject({ item: z.string(), chance: z.number().int().positive() }),
    mining: z.strictObject({
      countDefault: z.number().int(),
      count: z.array(gtRow).min(1),
      colourDefault: z.number().int(),
      colourPool: z.array(gtRow).min(1),
      /** `colours[roll - 1]`. */
      colours: z.array(z.string()).min(1),
      ore: z.strictObject({
        base: z.array(ltRow).min(1),
        steelAdd: z.number().int(),
        /** Added to the Steel pool, as `xoo = xii + 100`. */
        starAdd: z.number().int(),
        items: z.tuple([z.string(), z.string(), z.string()]),
      }),
      findChance: z.number().int().positive(),
      chunks: z.array(
        z.strictObject({
          tool: z.string(),
          item: z.string(),
          chance: z.number().int().positive(),
        }),
      ),
    }),
    fishing: z.strictObject({
      tool: z.string(),
      match: z.literal("contains"),
      layer: z.literal(1),
      waterTiles: z.array(z.string().length(2)).min(1),
      atDelay: z.number().int().positive(),
      fxOffsets: z.record(z.enum(["E", "W", "N", "S"]), offset),
      bands: z.array(z.strictObject({ lt: z.number().int(), fish: z.string() })).min(1),
      fishCheck: z.array(gtRow).min(1),
      antiMacroStart: z.number().int().positive(),
    }),
    sprinkle: z.strictObject({
      fx: z.string(),
      offsets: z.record(z.enum(["E", "W", "S"]), offset),
      notFacing: z.literal("N"),
    }),
    farming: z.strictObject({
      seedTest: z.string(),
      seeds: z.array(z.strictObject({ item: z.string(), plants: z.string().length(2) })).min(1),
      seedPause: z.number().int().positive(),
      watering: z.array(tilePair).min(1),
      produce: z.array(z.strictObject({ tile: z.string().length(2), item: z.string() })).min(1),
    }),
    regrowth: z.strictObject({
      roll: z.number().int().positive(),
      tileRoll: z.tuple([z.number().int(), z.number().int()]),
      checks: z
        .array(
          z.strictObject({
            handler: z.string(),
            /** Runs when the frame's roll is below this. */
            below: z.number().int(),
            /** Skipped while the roller's death lock runs. */
            deathGated: z.boolean(),
            /** Tested in order against one cached tile: at most one change per call. */
            tiles: z.array(tilePair),
          }),
        )
        .min(1),
    }),
    treasure: z.strictObject({
      items: z.array(z.string()).min(1),
      originalMaps: z.array(z.string()).min(1),
      rumourNpcs: z.array(z.string().min(1)).min(1),
      chance: z.number().int().positive(),
      text: z.string(),
    }),
    texts: z.strictObject({ plant: z.string(), plantWrong: z.string(), advanced: z.string() }),
  }),
  skillGain: z.array(skillGainSchema).min(1),
});

export type GatherTool = z.infer<typeof gatherToolSchema>;
export type SkillGainRule = z.infer<typeof skillGainSchema>;
export type GatherData = z.infer<typeof gatherDataSchema>;
