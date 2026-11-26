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

import { levelOddsSchema, requirementSchema, toolCanSchema } from "./common.ts";

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
  /**
   * The chance each swing harvests, by the node's skill (RuneScape's way: a yew is slow at level
   * 60 and quicker at 99). Left out, every swing advances the tool's hit counter and the swing
   * that empties it harvests (the shared `counterTable`, 1.6's way).
   */
  odds: levelOddsSchema.optional(),
  /**
   * Percentage points `odds` gains for each tier the tool is above the node's lowest (a better
   * axe chops faster). Read only with `odds`.
   */
  tierBonus: z.number().min(0).max(100).optional(),
  /**
   * A harvest uses the node up 1 time in this many: until then the tile stays and keeps giving
   * (an oak gives several logs before it falls). Left out (or 1), every harvest uses it up (1.6).
   */
  depletes: z.number().int().min(1).max(1_000_000).optional(),
  /**
   * Seconds after the node is used up until its tile comes back, whoever is on the map. Left out,
   * only the regrowth checks bring it back (1.6).
   */
  respawn: z.number().int().min(1).max(604_800).optional(),
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
  /**
   * The effect run every map shows on the tile at each swing that strikes it (issue #41), as
   * fishing shows its splash: frames `<fx>-1` … `<fx>-<frames>`, each frame's anchor placed at the
   * tile's character point (its horizontal centre, 2 px above its top). Left out, nothing shows.
   */
  strikeFx: z
    .strictObject({
      fx: z
        .string()
        .min(1)
        .max(80)
        .refine((s) => !/-\d+$/.test(s), "name the run without a frame number"),
      frames: z.number().int().min(1).max(99),
    })
    .optional(),
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
      mining: z
        .strictObject({
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
        })
        .optional(),
      fishing: z
        .strictObject({
          /** Water on any of these layers can be fished. */
          layers: z.array(z.union([z.literal(1), z.literal(2)])).min(1),
          waterTiles: z.array(z.string().length(2)).min(1),
          /**
           * The effect run every map shows at each cast into water: frames `<fx>-1` …
           * `<fx>-<frames>`, placed at the caster's point plus `fxOffsets` for the facing. Null
           * shows none.
           */
          castFx: z
            .strictObject({
              fx: z
                .string()
                .min(1)
                .max(80)
                .refine((s) => !/-\d+$/.test(s), "name the run without a frame number"),
              frames: z.number().int().min(1).max(99),
            })
            .nullable(),
          /** Played to everyone on the map at each cast into water. Null plays none. */
          castSound: sound.nullable(),
          fxOffsets: z.record(z.enum(["E", "W", "N", "S"]), offset),
          /**
           * What a cast trains (the bound Fishing skill, the `gather` source): `cast`, every cast
           * while the tile's allowance lasts, hit or miss (1.6); `catch`, every fish caught. With
           * both, a catch trains twice. A `chance` skill rolls once for each; an `xp` skill gets
           * its `gather` XP for each, a catch the fish's own `xp` when it has one.
           */
          trains: z.strictObject({ cast: z.boolean(), catch: z.boolean() }),
          /**
           * The catch pool: a bite catches one of the fish whose range holds the Fishing skill
           * (`from` ≤ skill, and skill < `below` when it has one), picked by `weight` (a 3 is three
           * times as likely as a 1). Ranges may overlap (a high-level fisher still catches small
           * fish) or not (1.6: one fish per range). No fish in range (or none at all): a bite catches
           * nothing.
           */
          catches: z.array(
            z.strictObject({
              fish: z.string().min(1),
              from: z.number().int().min(0).max(100),
              below: z.number().int().min(1).max(101).optional(),
              weight: z.number().int().min(1).max(1_000_000),
              /** The XP a catch gives an `xp`-model skill, replacing its `gather` amount. */
              xp: z.number().int().min(0).max(1_000_000_000).optional(),
              /**
               * Only these fishing tools catch it (item names, exactly): a harpoon for sharks, a
               * net for shrimp. Left out, any fishing tool does.
               */
              tools: z.array(z.string().min(1)).min(1).optional(),
            }),
          ),
          fishCheck: z.array(gtRow).min(1),
          /** Catches allowed from one tile before you must fish from another. */
          antiMacroStart: z.number().int().positive(),
          /** Told when a cast finds the tile's allowance spent. */
          stoppedText: z.string().min(1),
        })
        .optional(),
      sprinkle: z
        .strictObject({
          fx: z.string(),
          offsets: z.record(z.enum(["E", "W", "S"]), offset),
          notFacing: z.literal("N"),
        })
        .optional(),
      farming: z
        .strictObject({
          seedTest: z.string(),
          seeds: z.array(z.strictObject({ item: z.string(), plants: z.string().length(2) })).min(1),
          seedPause: z.number().int().positive(),
          /** The skill whose counter a Water tool advances. */
          wateringSkill: z.string().min(1),
          watering: z.array(tilePair).min(1),
          produce: z.array(z.strictObject({ tile: z.string().length(2), item: z.string() })).min(1),
        })
        .optional(),
      regrowth: z.strictObject({
        roll: z.number().int().positive(),
        tileRoll: z.tuple([z.number().int(), z.number().int()]),
        checks: z.array(
          z.strictObject({
            handler: z.string(),
            /** Runs when the frame's roll is below this. */
            below: z.number().int(),
            /** Tested in order against one cached tile: at most one change per call. */
            tiles: z.array(tilePair),
            /**
             * Whether it drops farming produce rather than changing tiles (issue #38). Left out, a
             * check with no tiles drops produce (Classic's `DoVeg`); `false` keeps a tile check
             * whose pairs are all gone a tile check that changes nothing.
             */
            produce: z.boolean().optional(),
          }),
        ),
      }),
      treasure: z
        .strictObject({
          items: z.array(z.string()).min(1),
          originalMaps: z.array(z.string()).min(1),
          rumourNpcs: z.array(z.string().min(1)).min(1),
          chance: z.number().int().positive(),
          text: z.string(),
        })
        .optional(),
      texts: z.strictObject({ plant: z.string(), plantWrong: z.string() }),
    }),
    harvest: z.array(harvestNodeSchema),
    yields: z.record(z.string().min(1), yieldTableSchema),
  })
  .superRefine((data, ctx) => {
    data.gathering.fishing?.catches.forEach((c, i) => {
      if (c.below !== undefined && c.below <= c.from) {
        ctx.addIssue({
          code: "custom",
          path: ["gathering", "fishing", "catches", i, "below"],
          message: `${c.fish} is caught from skill ${c.from} but only below ${c.below}, so never`,
        });
      }
    });
    data.harvest.forEach((n, i) => {
      if (n.tierBonus !== undefined && n.odds === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["harvest", i, "tierBonus"],
          message:
            "a tool tier bonus adds to the odds by level: give the node odds, or leave the bonus off",
        });
      }
      if (n.respawn !== undefined && n.becomes.toLowerCase() === n.tile.toLowerCase()) {
        ctx.addIssue({
          code: "custom",
          path: ["harvest", i, "respawn"],
          message: "the node never changes its tile, so there is nothing to come back",
        });
      }
    });
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
      if (n.treasure && !data.gathering.treasure) {
        ctx.addIssue({
          code: "custom",
          path: ["harvest", i, "treasure"],
          message: "this node digs up treasure, but gathering has no treasure section",
        });
      }
    });
    // An ore strike rolls from gathering.mining: without it, no table may be an ore table.
    for (const [name, t] of Object.entries(data.yields)) {
      if (t.kind === "ore" && !data.gathering.mining) {
        ctx.addIssue({
          code: "custom",
          path: ["yields", name],
          message: `yield table ${JSON.stringify(name)} is an ore strike, but gathering has no mining section`,
        });
      }
    }
  });

export type HarvestNode = z.infer<typeof harvestNodeSchema>;
export type YieldTable = z.infer<typeof yieldTableSchema>;
export type GatherData = z.infer<typeof gatherDataSchema>;
