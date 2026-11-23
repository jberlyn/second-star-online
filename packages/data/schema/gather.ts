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

import { requirementSchema, toolCanSchema } from "./common.ts";

const gtRow = z.strictObject({ gt: z.number().int(), value: z.number().int() });
const ltRow = z.strictObject({ lt: z.number().int(), value: z.number().int() });
const tilePair = z.strictObject({ from: z.string().length(2), to: z.string().length(2) });
const sound = z.strictObject({ name: z.string().min(1), ch: z.number().int().min(1).max(8) });
const offset = z.tuple([z.number().int(), z.number().int()]);

/**
 * A harvest node (issue #37 stage 5): what a tool that `can` work it does to one layer-2 tile. Each
 * swing at the tile with such a tool advances the tool's hit counter; the swing that empties it
 * turns the tile into `becomes`, drops from the `yield` table, and rolls the skill's gain row.
 * Fishing and watering are kinds of their own (`fishing`, `farming.watering`).
 */
export const harvestNodeSchema = z.strictObject({
  /** The layer-2 tile. Several nodes may share one: the first a swung tool can work decides. */
  tile: z.string().length(2),
  can: toolCanSchema.exclude(["Fish", "Water"]),
  /** Only these tools work it (item names, exactly): the Ice Hammer's ice rock. */
  tools: z.array(z.string().min(1)).min(1).optional(),
  /** The lowest tool tier that works it (1 when left out). */
  tier: z.number().int().min(1).max(1000).optional(),
  /**
   * The layer-1 tile under it must be one of these (the shovel's diggable grounds); an empty list
   * passes nowhere.
   */
  under: z.array(z.string().length(2)).optional(),
  /** What the node needs of the gatherer; a swing without it is refused, told once per press. */
  requires: requirementSchema.optional(),
  /** Layer 2 becomes this on success. */
  becomes: z.string().length(2),
  /** Reads the counter table, and is the skill a success trains. */
  skill: z.string().min(1),
  /** Every success trains the skill by its `gather` progression (the skill must have one). */
  gains: z.boolean(),
  /** The XP a success gives an `xp`-model skill, replacing the skill's own `gather` amount. */
  xp: z.number().int().min(0).max(1_000_000_000).optional(),
  /** A table in `yields`, rolled on every success. */
  yield: z.string().min(1).optional(),
  /** Every success may uncover the buried treasure. */
  treasure: z.boolean().optional(),
  /** Replaces the swing sound, for everyone, when the faced tile is the node's. */
  hitSound: sound.nullable(),
  /** Played on channel 2 to the gatherer on the swing that succeeds. */
  successSound: sound.nullable(),
});

/**
 * A yield table: `chance` drops its item on `random(chance) = 1` (from `bySkill`, the last row the
 * skill is above, when it has one); `ore` is the mining strike, from `gathering.mining`.
 */
export const yieldTableSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("chance"),
    item: z.string().min(1),
    chance: z.number().int().positive(),
    bySkill: z
      .array(z.strictObject({ gt: z.number().int(), value: z.number().int().positive() }))
      .min(1)
      .optional(),
  }),
  z.strictObject({ kind: z.literal("ore") }),
]);

export const gatherDataSchema = z
  .strictObject({
    gathering: z.strictObject({
      counterTable: z.array(gtRow).min(1),
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
      }),
      fishing: z.strictObject({
        /** Water on any of these layers can be fished. */
        layers: z.array(z.union([z.literal(1), z.literal(2)])).min(1),
        waterTiles: z.array(z.string().length(2)).min(1),
        fxOffsets: z.record(z.enum(["E", "W", "N", "S"]), offset),
        bands: z.array(z.strictObject({ lt: z.number().int(), fish: z.string() })).min(1),
        fishCheck: z.array(gtRow).min(1),
        /** Catches allowed from one tile before you must fish from another. */
        antiMacroStart: z.number().int().positive(),
        /** Told when a cast finds the tile's allowance spent. */
        stoppedText: z.string().min(1),
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
        /** The skill whose counter a Water tool advances. */
        wateringSkill: z.string().min(1),
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
      texts: z.strictObject({ plant: z.string(), plantWrong: z.string() }),
    }),
    harvest: z.array(harvestNodeSchema),
    yields: z.record(z.string().min(1), yieldTableSchema),
  })
  .superRefine((data, ctx) => {
    // A node after one on the same tile, of the same kind, open to every tool and every ground, is
    // never reached.
    data.harvest.forEach((n, i) => {
      const open = data.harvest
        .slice(0, i)
        .find(
          (m) =>
            m.tile.toLowerCase() === n.tile.toLowerCase() &&
            m.can === n.can &&
            !m.tools &&
            !m.under,
        );
      if (open) {
        ctx.addIssue({
          code: "custom",
          path: ["harvest", i, "tile"],
          message: `an earlier ${n.can} node on tile ${JSON.stringify(n.tile)} takes every tool on any ground, so this one is never reached`,
        });
      }
      if (n.yield !== undefined && !Object.hasOwn(data.yields, n.yield)) {
        ctx.addIssue({
          code: "custom",
          path: ["harvest", i, "yield"],
          message: `yield table ${JSON.stringify(n.yield)} is not in yields`,
        });
      }
    });
  });

export type HarvestNode = z.infer<typeof harvestNodeSchema>;
export type YieldTable = z.infer<typeof yieldTableSchema>;
export type GatherData = z.infer<typeof gatherDataSchema>;
