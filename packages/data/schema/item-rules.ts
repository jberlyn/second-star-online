/** Schema for editable item rules, including equip, use, combat, menus and containers. Table order and first- or last-match behavior are significant. */
import { z } from "zod";

import { patternRow as pattern } from "./common.ts";

const int = z.number().int();
const strictRow = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...pattern, ...shape });

/** The equip slot types. */
export const equipSlotSchema = z.enum(["Head", "Body", "LeftHand", "RightHand", "Feet", "Ring"]);
/** The `RingE`-style slot names the original uses (`RingE`, `HeadE` …). */
const slotVarSchema = z.enum(["RingE", "HeadE", "BodyE", "RightHandE", "LeftHandE", "FeetE"]);

/** The worn slots, named as `Equipment` names them. */
const wornSlotSchema = z.enum(["head", "body", "weapon", "offHand", "feet", "ring"]);
const paperdollLayerSchema = z.enum(["weapon", "shield", "helm", "gloves", "body"]);

export const itemRulesDataSchema = z.strictObject({
  equip: z.strictObject({
    /** 19 rules, required Strength to equip, last match wins. */
    strength: z.array(z.strictObject({ ...pattern, strength: int })),
    /** 157 rules in source order, last match wins; defaults to "No". */
    slots: z.array(
      z.strictObject({ ...pattern, slot: z.union([equipSlotSchema, z.literal("No")]) }),
    ),
    /** Two-handed weapons. */
    twoHanded: z.array(z.strictObject(pattern)),
    /** A name containing "Murder" needs the murder flag. */
    murder: z.strictObject(pattern),
  }),
  use: z.strictObject({
    /** Use says nothing and does nothing: any match. */
    silent: z.array(z.strictObject(pattern)),
    /** The Mysticism a spell book needs, last match wins, else 1. */
    books: z.array(strictRow({ mysticism: int })),
    /** The combat-skill books matched exactly, first match. */
    skillBooks: z.array(
      z.strictObject({
        match: z.literal("exact"),
        pattern: pattern.pattern,
        skill: z.string(),
        shown: z.string(),
      }),
    ),
    /** 35 rules; anything else is "You cannot use the X." */
    usable: z.array(z.strictObject(pattern)),
    /** 64 effect rows in source order, applied while Hunger < 35000. */
    effects: z.array(
      z.strictObject({
        ...pattern,
        stat: z.enum(["HP", "SP", "Hunger"]),
        flat: int,
        randomN: int.nullable(),
      }),
    ),
    /** The eat/drink lines, last match wins. `& SelInventory &` marks the name. */
    messages: z.array(z.strictObject({ ...pattern, text: z.string() })),
    /** Not usable, with its own line in place of "You cannot use the X."; last match wins. */
    refusals: z.array(z.strictObject({ ...pattern, text: z.string().min(1) })),
  }),
  armour: z.strictObject({
    /** 40 flat rows. `hitMe2` null = no row in HitMe2. */
    rows: z.array(
      z.strictObject({ slot: slotVarSchema, ...pattern, hitMe: int, hitMe2: int.nullable() }),
    ),
    /** 36 elemental rows: HitMe vs the attacker's weapon, HitMe2 vs the attacker's name. */
    elemental: z.array(
      z.strictObject({
        handler: z.enum(["HitMe", "HitMe2"]),
        trigger: z.string(),
        slot: slotVarSchema,
        ...pattern,
        delta: int,
      }),
    ),
    /**
     * 1.6's spell-defense lookup (`GetSpellDef`): flat rows added to the spell damage a player
     * takes, all `contains`, and Magic Shield's delta while its counter runs.
     */
    spell: z.strictObject({
      rows: z.array(z.strictObject({ slot: slotVarSchema, ...pattern, delta: int })),
      magicShield: int,
    }),
  }),
  breaks: z.strictObject({
    /** Armour break rules. */
    armour: z.strictObject({
      /** Compared with "a <name>", so it never matches (a kept bug). */
      excludedMonsters: z.array(z.string()),
      items: z.array(z.strictObject({ slot: slotVarSchema, item: z.string() })),
    }),
    /** Weapon break rules. */
    weapon: z.strictObject({
      excludedMonsters: z.array(z.string()),
      items: z.array(z.strictObject({ slot: slotVarSchema, item: z.string() })),
    }),
    /** Damaged item names: 33 contains rules, last wins. */
    damaged: z.array(z.strictObject({ ...pattern, damaged: z.string() })),
  }),
  /** The button the item menu shows in place of Equip; last match wins. */
  menu: z.array(strictRow({ action: z.enum(["Cook", "Mix", "Build", "Smith", "Storage"]) })),
  paperdoll: z.strictObject({
    /** Rewrites a layer's name before the picture is chosen, in order. */
    aliases: z.array(strictRow({ layer: paperdollLayerSchema, becomes: z.string().min(1) })),
  }),
  ground: z.strictObject({
    /** Ground items that stop a walker, player or monster, any match. */
    blocks: z.array(z.strictObject(pattern)),
    /** Blocks until a skill (or the level) reaches `atLeast`. */
    platforms: z.array(strictRow({ needs: z.string().min(1), atLeast: int })),
    /** The animated overlay, first match. */
    overlays: z.array(strictRow({ overlay: z.string().min(1) })),
    /**
     * Ground items whose overlay animates only while a player crafts facing them (an SSO addition:
     * the crafting stations), any match.
     */
    inUse: z.array(z.strictObject(pattern)),
    /** The draw layer, first match, else `items`. */
    layers: z.array(strictRow({ layer: z.enum(["hidden", "overChars", "overLayer3"]) })),
    /** The pixel offset from the tile, first match. */
    offsets: z.array(strictRow({ dx: int, dy: int })),
    /** Ground items the hover tip never names (map links, overlays, markers), any match. */
    tipless: z.array(z.strictObject(pattern)),
    /**
     * The hover tip's name for a ground item, first match: an exact row names the whole item, a
     * contains row replaces the matched part. Unmatched names show as they are.
     */
    tipNames: z.array(strictRow({ name: z.string().min(1) })),
  }),
  pickup: z.strictObject({
    /** The one-line text a Ctrl on a fixture says, first match. */
    ctrlTexts: z.array(strictRow({ text: z.string().min(1), unpause: z.boolean() })),
  }),
  containers: z.strictObject({
    /** Lines a container holds, last match wins. */
    capacity: z.array(strictRow({ capacity: int })),
    defaultCapacity: int,
    /** Containers that get a `#id` when added to a bag. */
    uniqueIds: z.array(z.strictObject({ match: z.literal("exact"), pattern: pattern.pattern })),
  }),
  /** Power a worn item adds; every matching row adds. */
  gear: z.array(
    strictRow({
      slot: wornSlotSchema,
      power: z.enum(["spell", "blackArts", "martialArts", "attack"]),
      add: int,
    }),
  ),
  swing: z.strictObject({
    /** The cooldowns a swing sets for a worn item, last match wins. */
    cooldowns: z.array(
      strictRow({
        slot: wornSlotSchema,
        atDelay: int,
        actionDelay: int,
      }),
    ),
    /**
     * The sound of a swing by weapon, first match, else `swordswing`:
     * a sound name from the sound list (or one added in assets/added/sounds/), `null` for silent.
     */
    sounds: z.array(strictRow({ sound: z.string().min(1).nullable() })),
  }),
});

export type ItemRulesData = z.infer<typeof itemRulesDataSchema>;
export type EquipSlot = z.infer<typeof equipSlotSchema>;
