/** Schema for the editable item catalogue. */
import { z } from "zod";

import { attPowerTierSchema } from "./attpower.ts";
import { requirementSchema, toolCanSchema } from "./common.ts";
import {
  equipSlotSchema,
  itemBehaviourSchema,
  paperdollLayerSchema,
  slotVarSchema,
  wornSlotSchema,
} from "./item-rules.ts";
import { formulaSchema } from "./progression.ts";

const strings = z.array(z.string());
const int = z.number().int();

/**
 * One catalogue entry. The game reads the name, the display name, the picture (`sprite`) and the
 * archived spellings (`variants`). What 1.6's scripts decide about an item (equip slot, power, price, loot,
 * item code) is not on the record: it is in item-rules.json, attpower.json and the other rule
 * tables, which match items by name,.
 */
export const itemSchema = z.strictObject({
  /**
   * The item's permanent key: the name it was created with (the 1.6 name for Classic). Stored
   * data, map files, NPC files and rule tables refer to it, so it never changes.
   */
  name: z.string().min(1),
  /** The name players see, when an operator has renamed the item; the key otherwise. */
  display: z.string().min(1).max(40).optional(),
  /** The Inventory art to draw (bag, equipment boxes, the ground), when it differs from the key. */
  sprite: z.string().min(1).optional(),
  /** Other spellings of the name seen in the archive. */
  variants: strings.optional(),
  /**
   * Retired by an operator: copies players already hold stay and work, but no more can be made.
   * Content may not refer to it (no shop, drop, recipe, gathering or quest), and admins cannot
   * create it. Set when an operator removes an item that players still hold (issue #28).
   */
  retired: z.literal(true).optional(),
  /**
   * Where Classic's picture came from: an original Inventory cast member, `"added"` for art in
   * `assets/added/items/<name>.png` (a data test checks the file and its sidecar exist), or `null`
   * for an item 1.6 drew none for. A record only: whether an item has a picture is whether the art
   * draws its sprite (a pack's atlas or an uploaded picture, issue #29), so a new item leaves this
   * out.
   */
  icon: z
    .union([
      z.strictObject({ member: z.number().int(), castLib: z.number().int(), asset: z.string() }),
      z.literal("added"),
    ])
    .nullable()
    .optional(),
});

/** A base or override roll in an item definition: `flat + random(randomN)`, and the Gold Axe's Strength roll. */
const definitionRollSchema = z.strictObject({
  flat: int.min(-9999).max(9999),
  randomN: int.min(0).max(9999),
  strengthHalf: z.boolean().optional(),
});

/**
 * An item definition (issue #30): one item's rules in one record, keyed by its catalogue name. The
 * content store compiles it into exact rows for that item in the rule tables it covers (equip,
 * attack, armour, gear, swing, use, weapon skills and behaviours), and the pack's rows that matched
 * the item stop applying to it there: a defined item plays only what its definition says. A field
 * left out is "none" (no slot row, no armour, no behaviours, no tools…). One rule stays the pack's:
 * `equip.murder` (a single name test, 1.6's "Murder"). A masterwork (`Knight's Sword +1`) takes its
 * behaviours from its base item, so its definition sets none.
 */
/** The worn slots armour can break in (the engine rolls BodyE, HeadE and RightHandE). */
export const BREAK_ARMOUR_SLOTS = ["BodyE", "HeadE", "RightHandE"] as const;
/** The worn slot a weapon can break in. */
export const BREAK_WEAPON_SLOTS = ["LeftHandE"] as const;

export const itemDefinitionSchema = z.strictObject({
  /** The catalogue item's key. */
  name: z.string().min(1),
  /** `equip.slots`: the slot it is equipped in ("No" refuses Equip). */
  slot: z.union([equipSlotSchema, z.literal("No")]).optional(),
  /** `equip.strength`: the Strength needed to equip it. */
  strength: int.min(0).max(200).optional(),
  /** `equip.twoHanded`: it takes both hands. */
  twoHanded: z.literal(true).optional(),
  /** `equip.classes`: the only classes (by code) that may equip it. */
  classes: z.array(int).min(1).max(100).optional(),
  /** `behaviours`: what it does (a bow, a key, a sword for Firesword…). */
  behaviours: z.array(itemBehaviourSchema).optional(),
  /** `attPower`: its attack power. */
  attack: z
    .strictObject({
      /** `attPower.base`: every roll draws, in order, and the last stands. */
      base: z.array(definitionRollSchema).optional(),
      /** `attPower.exactOverrides`: rolled after the gear bonus, replacing the power. */
      overrides: z.array(definitionRollSchema).optional(),
      /** `attPower.skillBlocks`: the skill tiers added to its power, block by block. */
      blocks: z.array(z.strictObject({ tiers: z.array(attPowerTierSchema) })).optional(),
    })
    .optional(),
  /** `armour.rows`: mitigation while worn in the row's slot. */
  armour: z
    .array(
      z.strictObject({
        slot: slotVarSchema,
        hitMe: int.min(-999).max(999),
        hitMe2: int.min(-999).max(999).nullable(),
      }),
    )
    .optional(),
  /** `armour.elemental`: elemental armour against a trigger. */
  elemental: z
    .array(
      z.strictObject({
        handler: z.enum(["HitMe", "HitMe2"]),
        trigger: z.string(),
        slot: slotVarSchema,
        delta: int.min(-999).max(999),
      }),
    )
    .optional(),
  /** `armour.spell.rows`: spell damage it adds or takes off while worn. */
  spellDefense: z
    .array(z.strictObject({ slot: slotVarSchema, delta: int.min(-999).max(999) }))
    .optional(),
  /** `gear`: power it adds while worn. */
  gear: z
    .array(
      z.strictObject({
        slot: wornSlotSchema,
        power: z.enum(["spell", "blackArts", "martialArts", "attack", "killXp"]),
        add: int.min(-999).max(999),
      }),
    )
    .optional(),
  /** `swing.cooldowns`: the swing delays it sets while worn, one per worn slot. */
  cooldowns: z
    .array(
      z.strictObject({
        slot: wornSlotSchema,
        atDelay: int.min(0).max(1000),
        actionDelay: int.min(0).max(1000),
      }),
    )
    .optional(),
  /** `swing.sounds`: its swing sound (null: silent). Left out: the default swing. */
  sound: z.string().min(1).nullable().optional(),
  /** `use`: what Use does with it. */
  use: z
    .strictObject({
      /** `use.usable`: Use accepts it. */
      usable: z.literal(true).optional(),
      /** `use.silent`: Use says and does nothing. */
      silent: z.literal(true).optional(),
      /** `use.whenFull`: usable even by a stuffed player. */
      whenFull: z.literal(true).optional(),
      /** `use.effects`: each adds `flat + random(randomN)` to the stat. */
      effects: z
        .array(
          z.strictObject({
            stat: z.enum(["HP", "SP", "Hunger"]),
            flat: int.min(-99999).max(99999),
            randomN: int.min(0).max(99999).nullable(),
          }),
        )
        .optional(),
      /** `use.messages`: the eat or drink line (`" & SelInventory & "` marks the name). */
      message: z.string().optional(),
      /** `use.refusals`: the line Use shows in place of "You cannot use the X.". */
      refusal: z.string().min(1).optional(),
      /** `use.books`: the Mysticism reading it needs (a spell book; left out, 1). */
      mysticism: int.min(0).max(1000).optional(),
      /** `use.skillBooks`: reading it teaches a skill, and uses it up. */
      skillBook: z
        .strictObject({
          skill: z.string().min(1),
          points: formulaSchema.optional(),
          xp: formulaSchema.optional(),
          upTo: int.min(0).max(100).optional(),
        })
        .optional(),
    })
    .optional(),
  /** `skillGain.weaponSkills`: the skills a kill with it trains. */
  trains: z.array(z.string()).min(1).optional(),
  /** `tools`: what it can do as a tool, and its swing ladder. */
  tools: z
    .array(
      z.strictObject({
        can: toolCanSchema.optional(),
        tier: int.min(1).max(1000).optional(),
        ladder: z.string().min(1).optional(),
        /** The hit counter a swing advances (shared with the items that name the same one). */
        counter: z.string().min(1).optional(),
      }),
    )
    .optional(),
  /** `requires`: what it needs before it is equipped or used. */
  requires: z
    .array(z.strictObject({ on: z.enum(["equip", "use"]), ...requirementSchema.shape }))
    .optional(),
  /** `menu`: the item menu's button in place of Equip. */
  menu: z.enum(["Cook", "Mix", "Build", "Smith", "Storage"]).optional(),
  /** `breaks.damaged`: what it becomes when it breaks. */
  damaged: z.string().min(1).optional(),
  /** `breaks.armour.items` and `breaks.weapon.items`: the worn slots it can break in. */
  breaks: z
    .strictObject({
      // The slots the engine rolls a break in: armour in the body, head and shield slots, a
      // weapon in the weapon hand.
      armour: z.array(z.enum(BREAK_ARMOUR_SLOTS)).optional(),
      weapon: z.array(z.enum(BREAK_WEAPON_SLOTS)).optional(),
    })
    .optional(),
  /** `paperdoll.aliases`: the picture a layer draws it with (`becomes` another item's). */
  paperdoll: z
    .array(z.strictObject({ layer: paperdollLayerSchema, becomes: z.string().min(1) }))
    .optional(),
  /** `ground` and `pickup`: how it sits on the ground. */
  ground: z
    .strictObject({
      blocks: z.literal(true).optional(),
      /** Every skill or level platform row it meets (each must be met). */
      platforms: z
        .array(z.strictObject({ needs: z.string().min(1), atLeast: int }))
        .min(1)
        .optional(),
      overlay: z.string().min(1).optional(),
      inUse: z.literal(true).optional(),
      layer: z.enum(["hidden", "overChars", "overLayer3"]).optional(),
      offset: z.strictObject({ dx: int.min(-999).max(999), dy: int.min(-999).max(999) }).optional(),
      tipless: z.literal(true).optional(),
      tipName: z.string().min(1).optional(),
      ctrlText: z.strictObject({ text: z.string().min(1), unpause: z.boolean() }).optional(),
    })
    .optional(),
  /** `containers`: the lines it holds as a container, and whether it gets a `#id` in a bag. */
  container: z
    .strictObject({
      capacity: int.min(0).max(1000).optional(),
      uniqueId: z.literal(true).optional(),
    })
    .optional(),
  /** On the World Editor's item list (`editorItems`). */
  inEditorList: z.literal(true).optional(),
  /** On the list a player shop accepts (`playerShopWhitelist`). */
  inPlayerShops: z.literal(true).optional(),
});

/** The part of items.json that `data:build` emits. */
export const itemsDataSchema = z.strictObject({
  items: z.array(itemSchema),
  /**
   * Inventory cast members that are ground fixtures or world objects, not bag items (the
   * Vault, chests, signs, doors…; the excluded cast members). 1.6's `/drop` accepted
   * any member of the Inventory cast by name,
   * so operators place these with `/drop` until the world editor.
   */
  fixtures: strings,
  /**
   * The items a player shop's `set` accepts, in the client's order (comparison ignores case).
   * 204 lines, Trout twice; the singular crystals match no bag item.
   */
  playerShopWhitelist: strings,
  /**
   * The World Editor's ITEM list after "Delete" (field `ITEM`), in
   * order. The editor places these by name.
   */
  editorItems: strings,
  /**
   * Item definitions (issue #30), keyed by item name: one record of an item's rules, which the
   * store compiles into exact rows that win in every table they cover. Classic ships none: its
   * items are defined by its rule tables.
   */
  definitions: z.array(itemDefinitionSchema).optional(),
});

export type Item = z.infer<typeof itemSchema>;
export type ItemsData = z.infer<typeof itemsDataSchema>;
export type ItemDefinition = z.infer<typeof itemDefinitionSchema>;
