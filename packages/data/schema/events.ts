/**
 * World events (issue #3): named counters the whole world shares and saves, offerings (an item
 * dropped onto a world-placed item changes them) and counter perks (a counter's value adds to the
 * spell power, melee or defence of chosen classes). The Classic pack builds 1.6's elemental orb war
 * from them; an operator can build any other contest of the same shape (a wishing well, a shrine
 * tally, a war between factions' altars) without engine work.
 */
import { z } from "zod";

/** A counter's name: what offerings and perks name it by (case ignored). */
export const counterNameSchema = z.string().trim().min(1).max(40);

const value = z.number().int().min(-1_000_000).max(1_000_000);

/** A world counter: a saved number every player shares. */
export const counterSchema = z
  .strictObject({
    /** Its name, unique (case ignored). */
    name: counterNameSchema,
    /** What it is for, for the Control Panel. */
    description: z.string().max(400).optional(),
    /** Its value when the world first has it (and after a staff reset). */
    start: value,
    /** The lowest it goes: a change stops here. */
    min: value,
    /** The highest it goes: a change stops here. */
    max: value,
    /**
     * Moves back on its own: every `everyMinutes` minutes of the server running, `by` toward
     * `toward` (its `start` when left out), never past it.
     */
    drift: z
      .strictObject({
        everyMinutes: z
          .number()
          .int()
          .min(1)
          .max(7 * 24 * 60),
        by: z.number().int().min(1).max(1_000_000),
        toward: value.optional(),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    if (c.min > c.max) {
      ctx.addIssue({ code: "custom", path: ["max"], message: "the highest is below the lowest" });
    }
    if (c.start < c.min || c.start > c.max) {
      ctx.addIssue({
        code: "custom",
        path: ["start"],
        message: `the start is outside ${c.min} to ${c.max}`,
      });
    }
    const toward = c.drift?.toward;
    if (toward !== undefined && (toward < c.min || toward > c.max)) {
      ctx.addIssue({
        code: "custom",
        path: ["drift", "toward"],
        message: `it drifts toward a value outside ${c.min} to ${c.max}`,
      });
    }
  });

/** A test an offering makes before it does anything: the counter must be within the bounds. */
export const counterCheckSchema = z
  .strictObject({
    counter: counterNameSchema,
    /** The counter must be at least this. */
    atLeast: value.optional(),
    /** The counter must be at most this. */
    atMost: value.optional(),
    /** Said to the player when the test fails; nothing else happens and the item stays. */
    refusal: z.string().trim().min(1).max(200),
  })
  .superRefine((c, ctx) => {
    if (c.atLeast === undefined && c.atMost === undefined) {
      ctx.addIssue({ code: "custom", path: ["atLeast"], message: "give a lowest or a highest" });
    }
  });

/** One change an offering makes: `add` to the counter (negative takes away), within its bounds. */
export const counterChangeSchema = z.strictObject({
  counter: counterNameSchema,
  add: value.refine((n) => n !== 0, "adding 0 changes nothing"),
});

/** A line every online player in `classes` (by code; all players when left out) sees. */
export const announcementSchema = z.strictObject({
  /** `{player}` is the player who made the offering, `{item}` the item, `{onto}` what it was dropped on. */
  text: z.string().trim().min(1).max(200),
  classes: z.array(z.number().int().min(1)).min(1).max(100).optional(),
});

/**
 * An offering: a player drops `item` while facing `onto`, an item the world placed (the World Editor
 * or a staff `/drop`). The first offering that names both runs instead of the drop: its checks in
 * order (the first that fails says its refusal), then its changes, its message and announcements.
 * The item is used up unless `keepsItem`.
 */
export const offeringSchema = z.strictObject({
  /** Its name, unique (case ignored): for the Control Panel. */
  name: z.string().trim().min(1).max(80),
  /** The item dropped (its name without a `#id` or `+N`; case ignored). */
  item: z.string().trim().min(1).max(80),
  /** The placed item faced (its name without a `#id`; case ignored). */
  onto: z.string().trim().min(1).max(80),
  /** Only characters in one of these classes (by code) may; others hear `classRefusal`. */
  classes: z.array(z.number().int().min(1)).min(1).max(100).optional(),
  classRefusal: z.string().trim().min(1).max(200).optional(),
  checks: z.array(counterCheckSchema).max(16).optional(),
  changes: z.array(counterChangeSchema).max(16).optional(),
  /** The item stays in the bag (an offering that only says something, or a refusal). */
  keepsItem: z.boolean().optional(),
  /** Said to the player who made it; `{item}` and `{onto}` as in announcements. */
  message: z.string().trim().min(1).max(200).optional(),
  announce: z.array(announcementSchema).max(8).optional(),
});

/** What a counter perk adds to: the class perks a world counter can drive. */
export const COUNTER_PERKS = ["spellPower", "melee", "defence"] as const;
export type CounterPerkKind = (typeof COUNTER_PERKS)[number];

/**
 * A counter perk: characters in `classes` (by code, a class inheriting one included; everyone when
 * left out) get `value` × the whole steps of `every` the counter is past `from` (rounded toward
 * `from`, so below it the perk is a penalty), kept between `least` and `most`. It stacks with the
 * faction's and class's perk of the same kind.
 */
export const counterPerkSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    counter: counterNameSchema,
    kind: z.enum(COUNTER_PERKS),
    classes: z.array(z.number().int().min(1)).min(1).max(100).optional(),
    from: value,
    every: z.number().int().min(1).max(1_000_000),
    value: z.number().int().min(-10_000).max(10_000),
    least: z.number().int().min(-10_000).max(10_000).optional(),
    most: z.number().int().min(-10_000).max(10_000).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.least !== undefined && p.most !== undefined && p.least > p.most) {
      ctx.addIssue({ code: "custom", path: ["most"], message: "the most is below the least" });
    }
  });

export const eventsDataSchema = z.strictObject({
  counters: z.array(counterSchema).max(64),
  offerings: z.array(offeringSchema).max(512),
  perks: z.array(counterPerkSchema).max(128),
});

export type WorldCounter = z.infer<typeof counterSchema>;
export type CounterCheck = z.infer<typeof counterCheckSchema>;
export type CounterChange = z.infer<typeof counterChangeSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type Offering = z.infer<typeof offeringSchema>;
export type CounterPerk = z.infer<typeof counterPerkSchema>;
export type EventsData = z.infer<typeof eventsDataSchema>;

/** A world with no events. */
export const EMPTY_EVENTS: EventsData = { counters: [], offerings: [], perks: [] };
