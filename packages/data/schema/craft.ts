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

import { levelOddsSchema, requirementSchema } from "./common.ts";

const gtRow = z.strictObject({ gt: z.number().int(), value: z.number().int() });
const skillRow = z.union([
  gtRow,
  z.strictObject({ lt: z.number().int(), value: z.number().int() }),
]);
const timer = z.strictObject({ default: z.number().int().positive(), rows: z.array(gtRow).min(1) });
/**
 * The XP a craft gives an `xp`-model skill, replacing the skill's own `craft` amount: on a cooking
 * recipe, a smithing repair, an alchemy sand or a carpentry result.
 */
const xp = z.number().int().min(0).max(1_000_000_000).optional();
/**
 * What a recipe needs of the crafter (a skill or the level, as a harvest node's): without it the
 * craft is refused before it starts. RuneScape's level per recipe.
 */
const requires = requirementSchema.optional();
/**
 * The chance a craft of this recipe succeeds, by the craft's skill, in place of the shared
 * `failure` table (RuneScape's burn chance that falls to nothing at a level).
 */
const odds = levelOddsSchema.optional();
const recipe = z.strictObject({
  input: z.string().min(1),
  output: z.string().min(1),
  xp,
  requires,
});
/** A cooking recipe also names what a burn makes. */
const cookRecipe = recipe.extend({ burned: z.string().min(1), odds });

/** An item and how many of it. */
const amount = z.strictObject({
  item: z.string().min(1),
  qty: z.number().int().min(1).max(1_000_000),
});

/** Whether recipes above the crafter's level are left out of the window or shown locked. */
const aboveLevel = z.enum(["hide", "show"]);

/**
 * A recipe station (issue #45): where recipes are made, through the crafting window. Facing one of
 * its `at` items and pressing Ctrl opens it; so does using one of its `opens` items from the bag
 * (a knife for fletching, with no station). A world with none has only the four stations above.
 */
export const recipeStationSchema = z
  .strictObject({
    /** Its name, the crafting window's title; recipes name their station by it. */
    name: z.string().min(1).max(60),
    /** The ground items it is worked at (an Anvil, a Furnace, a Range), by exact name. */
    at: z.array(z.string().min(1)).max(20).optional(),
    /** Bag items whose Use opens it anywhere (a Knife, a Needle), by exact name. */
    opens: z.array(z.string().min(1)).max(20).optional(),
    /**
     * The tools it takes, each with its tier, held or in the bag; the best one there counts. Left
     * out, it needs no tool.
     */
    tools: z
      .array(
        z.strictObject({
          item: z.string().min(1),
          tier: z.number().int().min(1).max(1000),
        }),
      )
      .max(30)
      .optional(),
    /** Recipes above the crafter's level: hidden from the window, or shown locked. */
    aboveLevel,
  })
  .superRefine((s, ctx) => {
    if (!s.at?.length && !s.opens?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["at"],
        message: "a recipe station needs a station item to stand at or a bag item that opens it",
      });
    }
  });
export type RecipeStation = z.infer<typeof recipeStationSchema>;

/** One recipe (issue #45), made at its station through the crafting window. */
export const recipeSchema = z
  .strictObject({
    /** Its name, unique; the window shows the output item's name. */
    name: z.string().min(1).max(80),
    /** The recipe station it is made at, by name. */
    station: z.string().min(1),
    /** The group it is listed under in the window (Daggers, Bars). */
    category: z.string().min(1).max(40).optional(),
    /** Overrides the station's `aboveLevel` for this recipe. */
    aboveLevel: aboveLevel.optional(),
    /**
     * The item that teaches it (a recipe book): a recipe with one must be learned by using it first.
     * A quest teaches it by giving the book as its reward.
     */
    book: z.string().min(1).optional(),
    /** What one craft uses up. */
    materials: z.array(amount).min(1).max(12),
    /** What one craft needs but does not use up (a mould). */
    keeps: z.array(amount).max(12).optional(),
    /** The lowest tier of the station's tools it needs (1 when left out). */
    tier: z.number().int().min(1).max(1000).optional(),
    /**
     * Percentage points the odds gain for each tier the tool is above the recipe's lowest. Read
     * only with `odds`.
     */
    tierBonus: z.number().min(0).max(100).optional(),
    /** Percent quicker for each tier the tool is above the recipe's lowest. */
    tierSpeed: z.number().min(0).max(90).optional(),
    /**
     * The only classes (by code) that may make it (issue #15): the window leaves it out for every
     * other class. Left out: any class.
     */
    classes: z.array(z.number().int().min(1)).min(1).max(100).optional(),
    /** The skill it needs and trains. */
    skill: z.string().min(1),
    /** The skill level it needs. */
    level: z.number().int().min(0).max(1_000_000),
    /** The XP a craft gives an `xp`-model skill, replacing the skill's own `craft` amount. */
    xp,
    /** The chance it succeeds by the skill; left out, it never fails. */
    odds,
    /** How many frames one craft takes by the skill (20 frames a second), as `odds` reads. */
    time: z
      .array(
        z.strictObject({
          level: z.number().int().min(0).max(100),
          frames: z.number().int().min(1).max(12_000),
        }),
      )
      .min(1)
      .max(30),
    /** What one craft makes. */
    output: amount,
    /** What a failed craft makes (a burned fish); left out, a failure makes nothing. */
    failure: amount.optional(),
  })
  .superRefine((r, ctx) => {
    r.time.forEach((t, i) => {
      const prev = r.time[i - 1];
      if (prev && t.level <= prev.level) {
        ctx.addIssue({
          code: "custom",
          path: ["time", i, "level"],
          message: "each time row's level must be above the one before it",
        });
      }
    });
    if (r.tierBonus !== undefined && r.odds === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["tierBonus"],
        message:
          "a tool tier bonus adds to the odds by level: give the recipe odds, or leave the bonus off",
      });
    }
  });
export type Recipe = z.infer<typeof recipeSchema>;

/**
 * A masterwork row: when any craft (a recipe, a cooking recipe, a brew, a build, or a repair the
 * Classic smithing table has no row for) succeeds in making `item`, `odds` by the craft's skill is
 * the chance it comes out as one of `results` instead, picked by weight. Name a result after its
 * item with a `+N` ending (`Leather Armor +1`): it then keeps the item's abilities and adds N to
 * its armour or attack, as the Classic smithing masterworks do.
 */
export const masterworkSchema = z
  .strictObject({
    /** The item a craft makes, by exact name. */
    item: z.string().min(1),
    /** The chance a success makes a masterwork, by the craft's skill. */
    odds: levelOddsSchema,
    /** The masterworks it can come out as, each picked by its weight among them. */
    results: z
      .array(
        z.strictObject({
          item: z.string().min(1),
          weight: z.number().int().min(1).max(1000),
        }),
      )
      .min(1)
      .max(10),
  })
  .superRefine((m, ctx) => {
    m.results.forEach((r, i) => {
      if (r.item.toLowerCase() === m.item.toLowerCase()) {
        ctx.addIssue({
          code: "custom",
          path: ["results", i, "item"],
          message: "a masterwork must be a different item from the one it is made from",
        });
      }
    });
  });
export type Masterwork = z.infer<typeof masterworkSchema>;

/**
 * Each station (`smith`, `cook`, `mix`, `build`, `cauldron`) may be left out: that craft is then off,
 * as when its skill binding is.
 */
export const craftDataSchema = z.strictObject({
  stations: z.strictObject({
    /** The order the four counters run in one frame, and the smith FX roll. */
    frameOrder: z.strictObject({
      order: z.tuple([z.literal("Smith"), z.literal("Cook"), z.literal("Build"), z.literal("Mix")]),
      smithFxChance: z.number().int().positive(),
    }),
    /** `random(value) = 1` fails (cooking, alchemy, carpentry; written five times, equal). */
    failure: z.strictObject({ rows: z.array(skillRow).min(1) }),
    smith: z
      .strictObject({
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
      })
      .optional(),
    cook: z
      .strictObject({
        stations: z.array(z.string()).min(1),
        /** The station that doubles the timer. */
        doubles: z.string(),
        minSkill: z.number().int(),
        timer,
        /** The cooking recipes: an item with none cannot be cooked. A burn makes `burned`. */
        recipes: z.array(cookRecipe).min(1),
      })
      .optional(),
    mix: z
      .strictObject({
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
              xp,
              requires,
              odds,
            }),
          )
          .min(1),
      })
      .optional(),
    build: z
      .strictObject({
        station: z.string(),
        /** RightHand, exactly. */
        tool: z.string(),
        /** Carpentry below this cannot build. */
        minSkill: z.number().int(),
        timer,
        /**
         * Set recipes (RuneScape's fletching): building with exactly this item in hand makes this
         * item, in place of the bands' roll. The last matching row wins. An item with no recipe
         * builds from the bands.
         */
        recipes: z
          .array(
            z.strictObject({
              input: z.string().min(1),
              output: z.string().min(1),
              xp,
              requires,
              odds,
            }),
          )
          .optional(),
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
                    xp,
                  }),
                )
                .min(1),
            }),
          )
          .min(1),
      })
      .optional(),
    startPause: z.strictObject({
      Smith: z.number().int(),
      Cook: z.number().int(),
      Mix: z.number().int(),
      Build: z.number().int(),
    }),
    cauldron: z
      .strictObject({
        match: z.string(),
        capacity: z.number().int().positive(),
        recipes: z
          /** Both ingredients by exact name; the first matching recipe wins. */
          .array(
            z.strictObject({ requires: z.tuple([z.string(), z.string()]), result: z.string() }),
          )
          .min(1),
      })
      .optional(),
    texts: z.record(z.string(), z.strictObject({ text: z.string().min(1) })),
  }),
  /** Recipe stations (issue #45), keyed by name. Classic has none. */
  recipeStations: z.array(recipeStationSchema).optional(),
  /** Recipes (issue #45), keyed by name. Classic has none. */
  recipes: z.array(recipeSchema).optional(),
  /** Masterworks any craft can make, keyed by the item made. Classic has none. */
  masterworks: z.array(masterworkSchema).optional(),
});

export type CraftData = z.infer<typeof craftDataSchema>;
