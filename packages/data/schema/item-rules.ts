/** Schema for editable item rules, including equip, use, combat, menus and containers. Table order and first- or last-match behavior are significant. */
import { z } from "zod";

import { patternRow as pattern, requirementSchema, toolCanSchema } from "./common.ts";
import { formulaSchema } from "./progression.ts";

const int = z.number().int();
const strictRow = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...pattern, ...shape });

/** The equip slot types. */
export const equipSlotSchema = z.enum(["Head", "Body", "LeftHand", "RightHand", "Feet", "Ring"]);
/** The `RingE`-style slot names the original uses (`RingE`, `HeadE` …). */
const slotVarSchema = z.enum(["RingE", "HeadE", "BodyE", "RightHandE", "LeftHandE", "FeetE"]);

/** The worn slots, named as `Equipment` names them. */
const wornSlotSchema = z.enum(["head", "body", "weapon", "offHand", "feet", "ring"]);
const paperdollLayerSchema = z.enum(["weapon", "shield", "helm", "gloves", "body"]);

/**
 * The behaviours an item can have (issue #37 stage 3). 1.6 gave each of these to any item whose name
 * held a word; content now says which items have them, in `behaviours`.
 */
export const itemBehaviourSchema = z.enum([
  /** Use opens the doors its name unlocks (the key script). */
  "key",
  /** Use reads it: a spell book teaches its spell, a skill book its skill. */
  "book",
  /** Shoots arrows from the off hand, spending a crystal of their colour. */
  "bow",
  /** A bow that also trains Martial Arts. */
  "crossbow",
  /** Worn as body armour, hides the wearer's name. */
  "hidesName",
  /** A chest: opens with the chest click and is never carried. */
  "chest",
  /** A carried container drawn as a cabinet; Ctrl needs 19 Strength to lift it. */
  "cabinet",
  /** A cabinet drawn as the Wind Cabinet. */
  "windCabinet",
  /** A carried container drawn as a crate; Ctrl needs 15 Strength to lift it. */
  "crate",
  /** A carried container that brews its recipes as items go in. */
  "cauldron",
  /** A slot machine: a click or Ctrl plays it. */
  "slotMachine",
  /** A blackjack table: a click or Ctrl sits at it. */
  "blackjackTable",
  /** A checkers table: a click or Ctrl sits at it. */
  "checkersTable",
  /** Shows the high scores, from any distance. */
  "highScoreStatue",
  /** Shows the assassins' ranking, from any distance. */
  "assassinStatue",
  /** Held in the right hand, lets a Film take a photo. */
  "camera",
  /** Spent by a photo. */
  "film",
  /** Spent by a painting. */
  "canvas",
  /** Dropped on a newspaper stand tile, becomes the dropper's newspaper. */
  "newspaperKit",
  /** Every swing also sends a fireball. */
  "swingFireballs",
  /** A sword, for the Firesword spell. */
  "sword",
  /** Use also casts Argon's Fist on you, with the Argon line in place of its drink line. */
  "argonsFist",
  /** Dropped, it becomes the live monster of the same name (a Pig item lets a Pig go). */
  "releasesMonster",
  /** Worn as body armour, covers the head: no hair is drawn. */
  "hidesHead",
  /** Worn as body armour, covers the helmet: no helmet is drawn. */
  "hidesHelm",
  /** Held in the off hand, drawn on the back: behind the body facing S or W, over it facing N. */
  "quiver",
  /** Held in the off hand, not drawn facing N (held out in front). */
  "hiddenFacingNorth",
  /** A door: a click or Ctrl leaves it alone, and a key turns the last one on the faced tile. */
  "door",
  /** The open door the switches close and open. */
  "switchDoor",
  /** Shows the server's time on its face. */
  "clock",
  /** The town's message board: a click or Ctrl reads it. */
  "messageBoard",
  /** The mailbox anyone can use: a click or Ctrl opens your mail. */
  "universalMail",
  /** The guild center: a click or Ctrl opens the guild window. */
  "guildCenter",
  /** Your own vault: a click or Ctrl opens it, and Drop facing it puts the item in. */
  "personalVault",
  /** A click does nothing (Ctrl may still take it). */
  "noClick",
  /** Ctrl does nothing, when nothing before it answered. */
  "noCtrl",
]);

export const itemRulesDataSchema = z
  .strictObject({
    /**
     * The behaviours by name, any match: an item has every behaviour a row gives it. A row tests the
     * name without its `#id` or `+N` ending, and never an engine fixture's name (`Bob's Door`).
     */
    behaviours: z.array(z.strictObject({ ...pattern, behaviour: itemBehaviourSchema })),
    /**
     * What tools do (issue #37 stage 5), any match: a weapon can do every `can` a row gives it, at
     * that row's `tier` (1 when left out), and swings at the speed of the last matching row's
     * `ladder`. A row tests the whole name. Each `can` row keeps its own hit counter, by its pattern
     * (so an Axe and a Gold Axe share one).
     */
    tools: z.array(
      strictRow({
        can: toolCanSchema.optional(),
        tier: int.min(1).max(1000).optional(),
        /** A ladder in `ladders`. */
        ladder: z.string().min(1).optional(),
      }),
    ),
    /**
     * Swing speed ladders by name. The first step whose `below` is above the skill (or that has no
     * `below`) sets the attack delay; none, and the delay stays as the gear set it. With no `skill`,
     * the skill reads 0. `gearSpeedUp` takes the worn gear's speed-up (the Ring of Quickness's) off the
     * step; without it the step replaces the delay outright.
     */
    ladders: z.record(
      z.string().min(1),
      z.strictObject({
        skill: z.string().min(1).optional(),
        steps: z
          .array(z.strictObject({ below: int.optional(), delay: int.min(1).max(1000) }))
          .min(1),
        gearSpeedUp: z.boolean().optional(),
      }),
    ),
    /**
     * What an item needs before it can be equipped or used (issue #37 stage 5): every matching row of
     * that kind must be met, and the first one that is not refuses with its line.
     */
    requires: z.array(
      z.strictObject({ ...pattern, on: z.enum(["equip", "use"]), ...requirementSchema.shape }),
    ),
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
      /**
       * Items that teach a skill when read, matched exactly, first match; always used up. On a
       * `chance` skill `points` (a formula) are added, never past `upTo`; on an `xp` skill `xp`
       * is given (or, without `xp`, the points), the level never passing `upTo`. Classic: `1 +
       * random(5)` points, up to 77.
       */
      skillBooks: z.array(
        z.strictObject({
          match: z.literal("exact"),
          pattern: pattern.pattern,
          skill: z.string(),
          points: formulaSchema.optional(),
          xp: formulaSchema.optional(),
          upTo: z.number().int().min(0).max(100).optional(),
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
        power: z.enum(["spell", "blackArts", "martialArts", "attack", "killXp"]),
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
  })
  .superRefine((data, ctx) => {
    data.tools.forEach((t, i) => {
      if (t.ladder !== undefined && !Object.hasOwn(data.ladders, t.ladder)) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", i, "ladder"],
          message: `ladder ${JSON.stringify(t.ladder)} is not in ladders`,
        });
      }
      if (t.can === undefined && t.tier !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", i, "tier"],
          message: "a tier belongs to a row that gives a can",
        });
      }
      if (t.can === undefined && t.ladder === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", i],
          message: "a tool row needs a can, a ladder or both",
        });
      }
    });
  });

export type ItemRulesData = z.infer<typeof itemRulesDataSchema>;
export type EquipSlot = z.infer<typeof equipSlotSchema>;
export type ItemBehaviour = z.infer<typeof itemBehaviourSchema>;
