/**
 * The Control Panel's Items page on the server (issue #30, stage 3): the item list and the item open
 * in the form, built from the content store's layers. Pure apart from what it is handed.
 *
 * The page edits ordinary content rows: an item's definition (`items/definitions/<name>`) and its
 * catalogue row (`items/items/<name>`, for its display name). Its changes go into the shared draft
 * and are published, undone and noticed like any other row; the Content page's JSON editor edits
 * the same rows, and both name the item's fingerprint so neither writes over a change it has not
 * seen.
 */
import type { ItemDefinition } from "@secondstaronline/data";
import {
  BREAK_ARMOUR_SLOTS,
  BREAK_WEAPON_SLOTS,
  equipSlotSchema,
  itemBehaviourSchema,
  paperdollLayerSchema,
  slotVarSchema,
  toolCanSchema,
  wornSlotSchema,
} from "@secondstaronline/data/schema";
import {
  type ContentData,
  type ContentItemView,
  DEFINITION_TABLES,
  type DefinitionTable,
  type ItemListEntry,
  type ItemRuleSource,
  type TableHit,
} from "@secondstaronline/shared";

import { rowHash } from "./rows.ts";

/** The form's groups (its tabs) and the tables each covers, in order. */
export const ITEM_GROUPS: readonly { id: string; title: string; tables: DefinitionTable[] }[] = [
  {
    id: "basics",
    title: "Basics",
    tables: [
      "itemRules equip.slots",
      "itemRules equip.strength",
      "itemRules equip.twoHanded",
      "itemRules behaviours",
      "itemRules requires",
      "itemRules paperdoll.aliases",
    ],
  },
  {
    id: "weapon",
    title: "Weapon",
    tables: [
      "attPower attPower.base",
      "attPower attPower.exactOverrides",
      "attPower attPower.skillBlocks",
      "classes skillGain.weaponSkills",
      "itemRules swing.cooldowns",
      "itemRules swing.sounds",
    ],
  },
  {
    id: "armour",
    title: "Armour",
    tables: [
      "itemRules armour.rows",
      "itemRules armour.elemental",
      "itemRules armour.spell.rows",
      "itemRules gear",
    ],
  },
  {
    id: "use",
    title: "When used",
    tables: [
      "itemRules use.usable",
      "itemRules use.silent",
      "itemRules use.whenFull",
      "itemRules use.effects",
      "itemRules use.messages",
      "itemRules use.refusals",
      "itemRules use.books",
      "itemRules use.skillBooks",
      "itemRules menu",
    ],
  },
  {
    id: "tools",
    title: "Tool",
    tables: ["itemRules tools"],
  },
  {
    id: "breaking",
    title: "Breaking",
    tables: [
      "itemRules breaks.damaged",
      "itemRules breaks.armour.items",
      "itemRules breaks.weapon.items",
    ],
  },
  {
    id: "ground",
    title: "On the ground",
    tables: [
      "itemRules ground.blocks",
      "itemRules ground.platforms",
      "itemRules ground.overlays",
      "itemRules ground.inUse",
      "itemRules ground.layers",
      "itemRules ground.offsets",
      "itemRules ground.tipless",
      "itemRules ground.tipNames",
      "itemRules pickup.ctrlTexts",
      "itemRules containers.capacity",
      "itemRules containers.uniqueIds",
    ],
  },
];

/** What each covered table is, as the page names it. */
export const TABLE_LABELS: Record<DefinitionTable, string> = {
  "itemRules equip.slots": "Worn in",
  "itemRules equip.strength": "Strength needed",
  "itemRules equip.twoHanded": "Needs both hands",
  "itemRules behaviours": "Special abilities",
  "attPower attPower.base": "Damage",
  "attPower attPower.exactOverrides": "Final damage override",
  "attPower attPower.skillBlocks": "Skill bonuses",
  "classes skillGain.weaponSkills": "Skills it trains",
  "itemRules armour.rows": "Protection",
  "itemRules armour.elemental": "Protection against one attacker",
  "itemRules armour.spell.rows": "Spell protection",
  "itemRules gear": "Bonuses while worn",
  "itemRules swing.cooldowns": "Swing speed",
  "itemRules swing.sounds": "Swing sound",
  "itemRules use.usable": "Can be used",
  "itemRules use.silent": "Does nothing when used",
  "itemRules use.whenFull": "Can be used when full",
  "itemRules use.effects": "Effects when used",
  "itemRules use.messages": "Message when used",
  "itemRules use.refusals": "Message when it can't be used",
  "itemRules use.books": "Mysticism needed to read",
  "itemRules use.skillBooks": "Skill book",
  "itemRules menu": "Item menu button",
  "itemRules tools": "Tool uses",
  "itemRules requires": "Requirements",
  "itemRules breaks.damaged": "Breaks into",
  "itemRules breaks.armour.items": "Can break as armour",
  "itemRules breaks.weapon.items": "Can break as a weapon",
  "itemRules paperdoll.aliases": "Borrowed worn picture",
  "itemRules ground.blocks": "Blocks movement",
  "itemRules ground.platforms": "Blocks until a skill is high enough",
  "itemRules ground.overlays": "Animated overlay",
  "itemRules ground.inUse": "Overlay animates only while in use",
  "itemRules ground.layers": "Drawn on layer",
  "itemRules ground.offsets": "Position on its tile",
  "itemRules ground.tipless": "No hover name",
  "itemRules ground.tipNames": "Hover name",
  "itemRules pickup.ctrlTexts": "Ctrl message",
  "itemRules containers.capacity": "Container size",
  "itemRules containers.uniqueIds": "Each copy has its own storage",
};

/** What an item is, from what it plays: a weapon, armour, food or something else. */
export function itemKind(def: ItemDefinition): ItemListEntry["kind"] {
  if (def.use?.effects?.some((e) => e.stat === "Hunger")) {
    return "food";
  }
  // 1.6's weapon hand is the left one (the right holds a shield).
  if ((def.attack?.base?.length ?? 0) > 0 || def.slot === "LeftHand") {
    return "weapon";
  }
  if ((def.armour?.length ?? 0) > 0 || (def.slot !== undefined && def.slot !== "No")) {
    return "armour";
  }
  if (def.use?.effects?.length) {
    return "food";
  }
  return "other";
}

/**
 * Where each covered table's rules come from, for an item. `defined`: by a definition, the
 * operator's own (`"yours"`) or a pack's (`"pack"`); `edited(table)`: the operator has changed that
 * rule table itself (its rows are no longer just the pack's).
 */
export function ruleSources(
  hits: readonly TableHit[],
  defined: "yours" | "pack" | null,
  edited: (table: string) => boolean = () => false,
): ItemRuleSource[] {
  const byKey = new Map(hits.map((h) => [h.key, h]));
  return ITEM_GROUPS.flatMap((g) =>
    g.tables.map((t) => {
      const hit = byKey.get(t);
      const deciding = hit?.deciding ?? [];
      const whose = edited(t) ? "your edited table's" : "the pack's";
      const from =
        defined === "yours"
          ? "your definition"
          : defined === "pack"
            ? "the pack's definition"
            : deciding.length === 0
              ? `nothing: ${edited(t) ? "your edited table" : "the pack"} has no row for it`
              : `${whose} ${deciding
                  .map(
                    (r) =>
                      `${r.match} "${r.pattern}" (${r.subject ? `${r.subject}, ` : ""}row ${r.index})`,
                  )
                  .join(", ")}`;
      return { group: g.id, label: TABLE_LABELS[t], from };
    }),
  );
}

/** The labels a definition's fields are named by in a refusal. */
const FIELD_LABELS: Record<string, string> = {
  slot: "Worn in",
  strength: "Strength needed",
  twoHanded: "Needs both hands",
  behaviours: "Special abilities",
  "attack/base": "Damage roll",
  "attack/overrides": "Final damage override",
  "attack/blocks": "Skill bonuses",
  armour: "Protection",
  elemental: "Protection against one attacker",
  spellDefense: "Spell protection",
  gear: "Bonus while worn",
  cooldowns: "Swing speed",
  sound: "Swing sound",
  "use/usable": "Can be used",
  "use/silent": "Does nothing when used",
  "use/whenFull": "Can be used when full",
  "use/effects": "Effect when used",
  "use/message": "Message when used",
  "use/refusal": "Message when it can't be used",
  "use/mysticism": "Mysticism needed to read",
  "use/skillBook": "Skill book",
  trains: "Skills it trains",
  tools: "Tool use",
  requires: "Requirement",
  menu: "Item menu button",
  damaged: "Breaks into",
  "breaks/armour": "Can break as armour",
  "breaks/weapon": "Can break as a weapon",
  paperdoll: "Borrowed worn picture",
  "ground/platforms": "Skill needed to pass",
  "ground/overlay": "Animated overlay",
  "ground/layer": "Drawn on layer",
  "ground/offset": "Position on its tile",
  "ground/tipName": "Hover name",
  "ground/ctrlText": "Ctrl message",
  "container/capacity": "Container size",
  inEditorList: "World Editor list",
  inPlayerShops: "Player shops",
};

/** A definition's field keys as the page names them in a message. */
const KEY_LABELS: Record<string, string> = {
  randomN: "damage range",
  strengthHalf: "Strength bonus",
  hitMe: "against players",
  hitMe2: "against monsters",
  atDelay: "attack delay",
  actionDelay: "action delay",
  spellDefense: "Spell protection",
  twoHanded: "Needs both hands",
};

/**
 * A refused definition's problems as the page says them: each names the field it is about by the
 * form's label (`Damage roll 2`), and a field's key in the message becomes its label in quotes.
 */
export function itemProblems(
  name: string,
  problems: readonly { where: string; message: string }[],
  def?: unknown,
): { where: string; message: string }[] {
  const trains = ((def as ItemDefinition | undefined)?.trains ?? []).map((s) => s.toLowerCase());
  return problems.map((p) => {
    let path = p.where.replace(/^items\/definitions\/?/, "");
    // A keyed row is named by its entry's index (the schema) or its key (the checks).
    if (
      path.toLowerCase() === name.toLowerCase() ||
      path.toLowerCase().startsWith(`${name.toLowerCase()}/`)
    ) {
      path = path.slice(name.length).replace(/^\//, "");
    } else {
      path = path.replace(/^\d+\/?/, "");
    }
    const parts = path.split("/").filter((x) => x !== "");
    let where = name;
    for (const len of [2, 1]) {
      const label = FIELD_LABELS[parts.slice(0, len).join("/")];
      if (label) {
        const n = parts[len];
        where = n !== undefined && /^\d+$/.test(n) ? `${label} ${Number(n) + 1}` : label;
        break;
      }
    }
    // A reference check names only the row: a missing skill is in Trains or a skill tier.
    const skill = /names a skill that does not exist: (.+)$/.exec(p.message)?.[1];
    if (where === name && skill !== undefined) {
      where = trains.includes(skill.toLowerCase()) ? "Skills it trains" : "Skill bonuses";
    }
    const message = p.message.replace(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g, (w) => {
      const label = KEY_LABELS[w];
      return label ? `"${label}"` : w;
    });
    return { where, message };
  });
}

/** The values the form's picks offer. */
export function itemChoices(data: ContentData): ContentItemView["choices"] {
  return {
    slots: [...equipSlotSchema.options, "No"],
    slotVars: [...slotVarSchema.options],
    breakArmourSlots: [...BREAK_ARMOUR_SLOTS],
    breakWeaponSlots: [...BREAK_WEAPON_SLOTS],
    wornSlots: [...wornSlotSchema.options],
    behaviours: [...itemBehaviourSchema.options],
    powers: ["spell", "blackArts", "martialArts", "attack", "killXp"],
    stats: ["HP", "SP", "Hunger"],
    skills: data.classes.skills.map((s) => s.skill),
    toolCans: [...toolCanSchema.options],
    ladders: Object.keys(data.itemRules.ladders),
    menus: ["Cook", "Mix", "Build", "Smith", "Storage"],
    layers: [...paperdollLayerSchema.options],
    groundLayers: ["hidden", "overChars", "overLayer3"],
  };
}

/**
 * An item as the page last showed it: its definition and catalogue row in the draft, the draft's
 * changes to them and whether a definition is published. A change whose `expect` differs is refused.
 */
export function itemFingerprint(parts: {
  definition: unknown;
  catalogue: unknown;
  pending: unknown;
  edited: boolean;
  /** What the item plays now when it has no definition (the form's seed), so a raw rule-table edit
   * under an open form makes it stale. */
  plays: unknown;
}): string {
  return rowHash(parts);
}

/** The covered tables (re-exported for the service). */
export { DEFINITION_TABLES };
