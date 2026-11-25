/**
 * Schema for the housing tables that `data:build` emits from `packages/data/content/houses.json`.
 *
 * Tiles are 1-based map tiles; `dx`/`dy` are offsets from the house's anchor (its top-left
 * footprint tile after the placement ghost's offset). Names hold `<name>` (the builder) and
 * `<guild>` (the builder's guild) placeholders, as the original's house script concatenated them.
 *
 */
import { z } from "zod";

import { bodyNumberSchema } from "./art.ts";
import { BALANCE_LIMITS } from "./balance.ts";
import { tileFlagSchema } from "./tiles.ts";

const int = z.number().int();
const text = z.string().min(1);
const flag = z.enum(["O", "X"]);
const row = z.string().regex(/^(\S+ ){16}\S+$/);
// The map format: 12 rows of 17 tokens, 4 layers (shared/constants.ts, the map columns, the client draw).
const layer = z.array(row).length(12);

const houseType = z.strictObject({
  house: text,
  deed: text,
  guild: z.boolean(),
  /** The `Houses` cast member drawn as the placement ghost (sprite 360), and its shift. */
  ghost: z.strictObject({
    member: int,
    width: int.positive(),
    height: int.positive(),
    regX: int,
    regY: int,
    shiftX: int,
    shiftY: int,
  }),
  /** Added to the hovered tile when placing a house: the footprint's top-left tile. */
  anchor: z.strictObject({ dx: int, dy: int }),
  footprint: z.strictObject({ w: z.union([z.literal(3), z.literal(5)]), h: z.literal(3) }),
  /** `[code, dx, dy]`, in the order they were written. */
  tiles: z.array(z.tuple([text, int.nonnegative(), int.nonnegative()])).min(9),
  mailbox: z.boolean(),
  lamp: z.boolean(),
  header: z.enum(["house", "farm", "guild", "shop"]),
  interiorItems: z
    .array(z.strictObject({ item: text, x: int.min(1).max(17), y: int.min(1).max(12) }))
    .min(1),
  /** The `Internal` field the interior is copied from. */
  template: z.strictObject({
    layers: z.tuple([layer, layer, layer, layer]),
    flags: z.strictObject({
      canFight: flag,
      /** The faction a new interior's spawn swap brings (a faction key), or "" for none. */
      fctSpwn: z.string().max(40),
      isIndoors: flag,
      canPvp: flag,
    }),
    field18: z.string(),
  }),
});

/**
 * Tiles named by their flags and/or their codes (issue #44). A flag is read on the layer it lives
 * on (`sea` and `dock` on layer 1, `airshipBlock` on layer 2: `tiles.ts`); a code matches on layer
 * 1 or layer 2. Case is ignored.
 */
export const tileSetSchema = z
  .strictObject({
    flags: z.array(tileFlagSchema).max(5).optional(),
    codes: z.array(z.string().trim().min(1)).max(256).optional(),
  })
  .refine((t) => (t.flags?.length ?? 0) + (t.codes?.length ?? 0) > 0, {
    message: "name at least one tile flag or code",
  });

/** The hull a vehicle may have (the `balance` limits; issue #2's hulls). */
export const VEHICLE_HULL_LIMITS = BALANCE_LIMITS.hull;

/**
 * A vehicle (issue #44): what a deed builds, keyed by `name`, which is the parked fixture's name
 * (`Bob's Boat`) and what a character rides. The engine keeps the mechanics (crossing tiles,
 * boarding, parking, the hull, sinking, the cannon's shot); a row picks the options.
 *
 * - `display`: what its lines call it (default: `name`).
 * - `picture`: the item picture a parked one shows (an `art.items` name).
 * - `rider`: the body a rider shows. Every peer knows the vehicle by it, so no two vehicles share
 *   one.
 * - `hull`: its full hull (hits wear the hull, never the rider; at 0 it is lost).
 * - `moves`: the tiles it crosses: `over` (`"any"`, or flags and/or codes) less `except`.
 * - `boards`: `shore` sails: it is built on a tile it crosses, boarded from the tile beside it
 *   and left onto a walkable tile beside it, walks at walking pace, is blocked by players,
 *   monsters and fixtures and blocks walkers, and rides the swell (the Boat). `pad` flies: it is
 *   built on, boarded beside and left on a `lands` tile, steps twice as fast, and flies over
 *   players, monsters and fixtures, blocking no one (the Airship). Any rider passes over exits,
 *   cannot swing, cast or drop anything, and is never meleed.
 * - `lands`: the pads a `pad` vehicle is built and left on.
 * - `cannon`: the rider fires the Battleship's cannon, spending `bindings.cannon.ammo`.
 * - `bobs`: a parked `shore` vehicle bobs at its mooring, drawn as its rider's frame on the swell
 *   facing the way it was left (Classic's Boat and Battleship, whose rider art is cut from their
 *   pictures); without it a parked one shows `picture`.
 */
export const vehicleSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[^'#]+$/, "a vehicle's name cannot hold ' or #"),
    display: z.string().trim().min(1).max(40).optional(),
    picture: text,
    rider: bodyNumberSchema,
    hull: int.min(VEHICLE_HULL_LIMITS.min).max(VEHICLE_HULL_LIMITS.max),
    moves: z.strictObject({
      over: z.union([z.literal("any"), tileSetSchema]),
      except: tileSetSchema.optional(),
    }),
    boards: z.enum(["shore", "pad"]),
    lands: tileSetSchema.optional(),
    cannon: z.literal(true).optional(),
    bobs: z.literal(true).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.boards === "pad" && !v.lands) {
      ctx.addIssue({
        code: "custom",
        path: ["lands"],
        message: "a vehicle boarded from a pad needs the tiles it lands on (lands)",
      });
    }
    if (v.boards === "pad" && v.bobs) {
      ctx.addIssue({
        code: "custom",
        path: ["bobs"],
        message: "only a vehicle boarded from the shore bobs at its mooring (boards: shore)",
      });
    }
    if (v.boards === "shore" && v.lands) {
      ctx.addIssue({
        code: "custom",
        path: ["lands"],
        message: "only a vehicle boarded from a pad lands (boards: pad)",
      });
    }
  });

/** The vehicles a deed's old `use` names: the Classic rows of those names (issue #44). */
export const LEGACY_DEED_VEHICLES = {
  boat: "Boat",
  airship: "Airship",
  battleship: "Battleship",
} as const;

const deedSchema = z
  .strictObject({
    deed: text,
    /**
     * `vehicle` builds the vehicle named by `vehicle`; `boat`, `airship` and `battleship` are the
     * older spellings of a vehicle deed for the Classic rows of those names.
     */
    use: z.enum(["nothing", "vehicle", "airship", "boat", "battleship", "place"]),
    /** The vehicle a `vehicle` deed builds (a `vehicles` name). */
    vehicle: text.optional(),
    house: text.nullable(),
    /** What Use says for a deed that builds nothing; the deed is kept. */
    text: text.nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.use === "vehicle" && d.vehicle === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["vehicle"],
        message: "a vehicle deed names the vehicle it builds",
      });
    }
    if (d.use !== "vehicle" && d.vehicle !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["vehicle"],
        message: 'only a deed whose use is "vehicle" names a vehicle',
      });
    }
  });

export const houseDataSchema = z
  .strictObject({
    deeds: z.array(deedSchema),
    /** The vehicles deeds build (issue #44). Left out, the world has none. */
    vehicles: z
      .array(vehicleSchema)
      .refine((rows) => new Set(rows.map((r) => r.name.toLowerCase())).size === rows.length, {
        message: "each vehicle has one row",
      })
      .optional(),
    types: z.array(houseType),
    /** Sprite 360's loc: `ThisX * 32 + baseX`, `ThisY * 32 + baseY`, plus the type's shift. */
    ghost: z.strictObject({ baseX: int, baseY: int }),
    placement: z.strictObject({
      edge: z.strictObject({ minX: int, minY: int, maxX: int, maxY: int, text }),
      terrain: z.strictObject({
        /** Every footprint tile's layer-1 code must be one of these (case ignored). */
        layer1Codes: z.array(text),
        text,
      }),
      obstacles: text,
      slots: text,
      guild: text,
    }),
    build: z.strictObject({
      exit: z.strictObject({ dx: int, dy: int }),
      mailbox: z.strictObject({ dx: int, dy: int }),
      /** The Small Shop's street lamp, dropped and recorded at the same tile. */
      lamp: z.strictObject({ dx: int, dy: int }),
      headers: z.strictObject({ house: text, farm: text, guild: text, shop: text }),
      arrival: z.strictObject({ x: int, y: int }),
    }),
    /** Dropped only where the map's header names you. */
    furnitureDrop: z.strictObject({ items: z.array(text), text }),
    /**
     * Fixtures checked on a ground-item click after the Guild Vault, in order: a text, a silent exit
     * (both null) or a switch (`TheOnSwitchClick`, `TheOffSwitchClick`). They answer wherever they
     * stand. Since issue #37 a row with any other action (the Vault, the Guild Center, the casino
     * tables) is skipped: those are item behaviours.
     */
    clickFixtures: z.array(
      z.strictObject({
        item: text,
        match: z.enum(["exact", "contains"]),
        text: text.nullable(),
        action: text.nullable(),
      }),
    ),
    restRegen: z.strictObject({ odds: int.positive(), maxY: int.positive() }),
    decay: z.strictObject({
      clockFrames: int.positive(),
      /** A house goes once its owner was last seen this many calendar months ago (2: before last month). */
      staleAfterMonths: int.positive(),
    }),
    /** Keys: the texts, the coloured pairs, the pause. */
    keys: z.strictObject({
      houseKey: text,
      guildKey: text,
      doesntFit: text,
      coloured: z.array(z.strictObject({ key: text, closed: text, open: text })),
      colouredPause: int.positive(),
      /** House and Guild Keys: the pause after turning a door (the key is kept). */
      housePause: int.positive(),
      /** `Keys.txt`: a key followed by `:Inf` is never consumed. */
      keysTxt: z.array(text),
    }),
    /** On/Off switch items, the pause after a flip, and the refusal. */
    switches: z.strictObject({
      on: text,
      off: text,
      pause: int.positive(),
      text,
    }),
    /** Frames from the last door change to the relock, and the `[open, closed]` pairs it closes. */
    relock: z.strictObject({
      change: int.positive(),
      closes: z.array(z.tuple([text, text])),
    }),
    /** Drop's container routes in order and the click's pause. */
    containers: z.strictObject({
      clickPause: int.positive(),
      /**
       * Unused since issue #37: Drop finds a container by its item behaviour or fixture kind. Kept
       * so packs made before still load.
       */
      drop: z.array(z.strictObject({ name: text, match: z.enum(["exact", "contains"]) })),
    }),
    /** Quest chest refill rolls on 1.6's periodic save. */
    questChest: z.strictObject({
      odds: int.positive(),
      saveBlock: int.positive(),
      saveRoll: int.positive(),
      /** Empty: no quest chest is ever refilled. */
      chests: z.array(z.strictObject({ roll: int.positive(), chest: text, source: z.array(text) })),
    }),
  })
  .superRefine((data, ctx) => {
    // `random(chests.length)` rolls 1..N and `.find(roll)` must find it: no gaps, no repeats.
    data.questChest.chests.forEach((c, i) => {
      if (c.roll !== i + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["questChest", "chests", i, "roll"],
          message: `roll ${c.roll} should be ${i + 1}`,
        });
      }
    });
  });

export type HouseData = z.infer<typeof houseDataSchema>;
export type VehicleRow = z.infer<typeof vehicleSchema>;
export type TileSet = z.infer<typeof tileSetSchema>;
export type Deed = z.infer<typeof deedSchema>;
export type HouseType = z.infer<typeof houseType>;
