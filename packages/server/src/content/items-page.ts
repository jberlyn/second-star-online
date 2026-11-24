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

/** The form's groups and the tables each covers, in order. */
export const ITEM_GROUPS: readonly { id: string; title: string; tables: DefinitionTable[] }[] = [
  {
    id: "equip",
    title: "Equip",
    tables: [
      "itemRules equip.slots",
      "itemRules equip.strength",
      "itemRules equip.twoHanded",
      "itemRules behaviours",
    ],
  },
  {
    id: "attack",
    title: "Attack",
    tables: [
      "attPower attPower.base",
      "attPower attPower.exactOverrides",
      "attPower attPower.skillBlocks",
      "classes skillGain.weaponSkills",
    ],
  },
  {
    id: "armour",
    title: "Armour and gear",
    tables: [
      "itemRules armour.rows",
      "itemRules armour.elemental",
      "itemRules armour.spell.rows",
      "itemRules gear",
      "itemRules swing.cooldowns",
      "itemRules swing.sounds",
    ],
  },
  {
    id: "use",
    title: "Use",
    tables: [
      "itemRules use.usable",
      "itemRules use.silent",
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
    title: "Tools and needs",
    tables: ["itemRules tools", "itemRules requires"],
  },
  {
    id: "breaking",
    title: "Breaking and look",
    tables: [
      "itemRules breaks.damaged",
      "itemRules breaks.armour.items",
      "itemRules breaks.weapon.items",
      "itemRules paperdoll.aliases",
    ],
  },
  {
    id: "ground",
    title: "Ground and containers",
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
  "itemRules equip.slots": "Slot",
  "itemRules equip.strength": "Strength",
  "itemRules equip.twoHanded": "Two-handed",
  "itemRules behaviours": "Behaviours",
  "attPower attPower.base": "Attack rolls",
  "attPower attPower.exactOverrides": "Override rolls",
  "attPower attPower.skillBlocks": "Skill tiers",
  "classes skillGain.weaponSkills": "Trains",
  "itemRules armour.rows": "Armour",
  "itemRules armour.elemental": "Elemental armour",
  "itemRules armour.spell.rows": "Spell defence",
  "itemRules gear": "Gear bonuses",
  "itemRules swing.cooldowns": "Swing cooldowns",
  "itemRules swing.sounds": "Swing sound",
  "itemRules use.usable": "Usable",
  "itemRules use.silent": "Silent",
  "itemRules use.effects": "Use effects",
  "itemRules use.messages": "Eat or drink line",
  "itemRules use.refusals": "Refusal line",
  "itemRules use.books": "Mysticism to read",
  "itemRules use.skillBooks": "Skill book",
  "itemRules menu": "Menu button",
  "itemRules tools": "Tool uses",
  "itemRules requires": "Needs",
  "itemRules breaks.damaged": "Broken form",
  "itemRules breaks.armour.items": "Breaks as armour",
  "itemRules breaks.weapon.items": "Breaks as a weapon",
  "itemRules paperdoll.aliases": "Drawn when worn as",
  "itemRules ground.blocks": "Blocks walkers",
  "itemRules ground.platforms": "Skill platform",
  "itemRules ground.overlays": "Ground overlay",
  "itemRules ground.inUse": "Animates while in use",
  "itemRules ground.layers": "Ground layer",
  "itemRules ground.offsets": "Ground offset",
  "itemRules ground.tipless": "No hover tip",
  "itemRules ground.tipNames": "Hover tip name",
  "itemRules pickup.ctrlTexts": "Ctrl line",
  "itemRules containers.capacity": "Container lines",
  "itemRules containers.uniqueIds": "Gets a #id",
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
  slot: "Slot",
  strength: "Strength",
  twoHanded: "Two-handed",
  behaviours: "Behaviours",
  "attack/base": "Attack roll",
  "attack/overrides": "Override roll",
  "attack/blocks": "Skill tiers",
  armour: "Armour",
  elemental: "Elemental armour",
  spellDefense: "Spell defence",
  gear: "Gear bonus",
  cooldowns: "Swing cooldown",
  sound: "Swing sound",
  "use/usable": "Usable",
  "use/silent": "Silent",
  "use/effects": "Use effect",
  "use/message": "Eat or drink line",
  "use/refusal": "Refusal line",
  "use/mysticism": "Mysticism to read",
  "use/skillBook": "Skill book",
  trains: "Trains",
  tools: "Tool use",
  requires: "Needs",
  menu: "Menu button",
  damaged: "Broken form",
  "breaks/armour": "Breaks as armour",
  "breaks/weapon": "Breaks as a weapon",
  paperdoll: "Drawn when worn as",
  "ground/platforms": "Skill platform",
  "ground/overlay": "Ground overlay",
  "ground/layer": "Ground layer",
  "ground/offset": "Ground offset",
  "ground/tipName": "Hover tip name",
  "ground/ctrlText": "Ctrl line",
  "container/capacity": "Container lines",
  inEditorList: "World Editor list",
  inPlayerShops: "Player shops",
};

/** A definition's field keys as the page names them in a message. */
const KEY_LABELS: Record<string, string> = {
  randomN: "random(n)",
  strengthHalf: "+ random(Strength) / 2",
  hitMe: "HitMe",
  hitMe2: "HitMe2",
  atDelay: "swing delay",
  actionDelay: "action delay",
  spellDefense: "Spell defence",
  twoHanded: "Two-handed",
};

/**
 * A refused definition's problems as the page says them: each names the field it is about by the
 * form's label (`Attack roll 2`), and a field's key in the message becomes its label in quotes.
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
      where = trains.includes(skill.toLowerCase()) ? "Trains" : "Skill tiers";
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
