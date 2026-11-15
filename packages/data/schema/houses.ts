/**
 * Schema for the housing tables that `data:build` emits from `packages/data/content/houses.json`.
 *
 * Tiles are 1-based map tiles; `dx`/`dy` are offsets from the house's anchor (its top-left
 * footprint tile after the placement ghost's offset). Names hold `<name>` (the builder) and
 * `<guild>` (the builder's guild) placeholders, as the original's house script concatenated them.
 *
 */
import { z } from "zod";

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
  /** Added to the hovered tile when placing a house (the Small Farm keeps its Y). */
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
    flags: z.strictObject({ canFight: flag, fctSpwn: text, isIndoors: flag, canPvp: flag }),
    field18: z.string(),
  }),
});

export const houseDataSchema = z
  .strictObject({
    deeds: z
      .array(
        z.strictObject({
          deed: text,
          use: z.enum(["nothing", "airship", "place"]),
          house: text.nullable(),
        }),
      )
      .min(1),
    types: z.array(houseType).min(1),
    /** Sprite 360's loc: `ThisX * 32 + baseX`, `ThisY * 32 + baseY`, plus the type's shift. */
    ghost: z.strictObject({ baseX: int, baseY: int }),
    placement: z.strictObject({
      edge: z.strictObject({ minX: int, minY: int, maxX: int, maxY: int, text }),
      terrain: z.strictObject({
        layer1Codes: z.array(text).min(1),
        layer1Need: int.positive(),
        layer1Columns: int.positive(),
        /** Footprint rows below this read the map's NPC and monster fields: never a match. */
        layer1MaxRow: int.positive(),
        text,
      }),
      obstacles: text,
      slots: text,
      guild: text,
    }),
    build: z.strictObject({
      exit: z.strictObject({ dx: int, dy: int }),
      mailbox: z.strictObject({ dx: int, dy: int }),
      /** Dropped at `dy`, recorded in the blueprint at `recordDy` (a kept bug). */
      lamp: z.strictObject({ dx: int, dy: int, recordDy: int }),
      headers: z.strictObject({ house: text, farm: text, guild: text, shop: text }),
      arrival: z.strictObject({ x: int, y: int }),
    }),
    /** Dropped only where the map's header names you. */
    furnitureDrop: z.strictObject({ items: z.array(text).min(1), text }),
    /**
     * Fixtures checked on a ground-item click after the Guild Vault, in order: a text, a silent exit
     * (both null) or a handler; `needsFlag` rows apply only while the drop-block flag is set.
     */
    clickFixtures: z
      .array(
        z.strictObject({
          item: text,
          match: z.enum(["exact", "contains"]),
          text: text.nullable(),
          action: text.nullable(),
          needsFlag: z.boolean(),
        }),
      )
      .min(1),
    restRegen: z.strictObject({ odds: int.positive(), maxY: int.positive() }),
    decay: z.strictObject({
      clockFrames: int.positive(),
      listCap: int.positive(),
      sweepOdds: int.positive(),
      /** Current month → the months whose entries survive a sweep (June's pair is written 5/6). */
      keep: z.record(z.string(), z.array(int.min(1).max(12)).min(1)),
    }),
    /** Keys: the texts, the coloured pairs, the pause. */
    keys: z.strictObject({
      houseKey: text,
      guildKey: text,
      doesntFit: text,
      coloured: z.array(z.strictObject({ key: text, closed: text, open: text })).min(1),
      colouredPause: int.positive(),
      /** `Keys.txt`: a key followed by `:Inf` is never consumed. */
      keysTxt: z.array(text),
    }),
    /** On/Off switch items, arm delay, pause and message. */
    switches: z.strictObject({
      on: text,
      off: text,
      arm: int.positive(),
      pause: int.positive(),
      text,
    }),
    /** Door relock countdown values and `[open, closed]` door pairs. */
    relock: z.strictObject({
      change: int.positive(),
      arrival: int.positive(),
      switchClick: int.positive(),
      closes: z.array(z.tuple([text, text])).min(1),
    }),
    /** Drop's container routes in order and the click's pause. */
    containers: z.strictObject({
      clickPause: int.positive(),
      drop: z.array(z.strictObject({ name: text, match: z.enum(["exact", "contains"]) })).min(1),
    }),
    /** Quest chest refill rolls on 1.6's periodic save. */
    questChest: z.strictObject({
      odds: int.positive(),
      saveBlock: int.positive(),
      saveRoll: int.positive(),
      chests: z
        .array(z.strictObject({ roll: int.positive(), chest: text, source: z.array(text) }))
        .min(1),
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
export type HouseType = z.infer<typeof houseType>;
