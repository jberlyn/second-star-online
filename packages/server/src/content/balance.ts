/**
 * The Control Panel's Balance page on the server (issue #19): the rows of the `balance` dataset
 * it edits, grouped as the page shows them, each with its fields and their limits, and the view
 * built from the content store's layers. Pure apart from what it is handed.
 *
 * The page edits ordinary content rows: its changes go into the shared draft and are published,
 * undone and noticed like any other row (the Content page's JSON editor edits the same rows).
 */
import type { BalanceSpellEffect } from "@secondstaronline/data";
import {
  BALANCE_DROP_KIND,
  BALANCE_DROP_WHO,
  BALANCE_HEAL_EFFECTS,
  BALANCE_LIMITS,
  ROSTER_SLOTS,
} from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  BALANCE_SPELL_EFFECT_ORDER,
  type BalanceFieldView,
  type BalanceGroupView,
  type BalanceRowView,
  type ContentData,
} from "@secondstaronline/shared";

import { type RowRef, rowHash, rowValue, sameRow } from "./rows.ts";

/** A row the page edits: where it is, what it is called and the values it shows. */
export interface BalanceRowDef {
  part: string;
  key: string | null;
  label: string;
  fields: BalanceFieldView[];
}

export interface BalanceGroupDef {
  id: string;
  title: string;
  help: string;
  rows: BalanceRowDef[];
  /** Values of the same kind kept in another dataset: the card names them and links there. */
  elsewhere?: ElsewhereDef[];
  /** More such values, from the published content (one a row: each vehicle's hull). */
  elsewhereOf?: (published: Partial<ContentData>) => ElsewhereDef[];
}

/** A value kept in another dataset's row, named on a Balance card. */
export interface ElsewhereDef {
  label: string;
  row: RowRef;
  describe(value: unknown): string;
}

const field = (
  path: string[],
  label: string,
  unit: BalanceFieldView["unit"],
  limits: { min: number; max: number },
  help?: string,
): BalanceFieldView => ({
  path,
  label,
  unit,
  min: limits.min,
  max: limits.max,
  ...(help ? { help } : {}),
});

/** A pick from a list: each value with its label (in the list's order). */
const choiceField = <T extends string>(
  path: string[],
  label: string,
  values: readonly T[],
  labels: Record<T, string>,
  help?: string,
): BalanceFieldView => ({
  path,
  label,
  unit: "choice",
  min: 0,
  max: 0,
  choices: values.map((value) => ({ value, label: labels[value] })),
  ...(help ? { help } : {}),
});

/** A damage floor's two fields: below `below`, damage becomes `random(randomN)`. */
const floorFields = (path: string[], name: string, help: string): BalanceFieldView[] => [
  field([...path, "below"], `${name}: below`, "count", BALANCE_LIMITS.floorBelow, help),
  field([...path, "randomN"], `${name}: becomes random(n)`, "random", {
    min: 1,
    max: BALANCE_LIMITS.randomN.max,
  }),
];

/**
 * The three fields of an amount (`flat + power × P + random(randomN)`) at `path`, named `name`.
 * The page previews the amount's range beside them.
 */
const amountFields = (
  path: string[],
  name: string,
  help?: string,
  optional = false,
): BalanceFieldView[] =>
  [
    field([...path, "flat"], name, "count", BALANCE_LIMITS.flat, help),
    field([...path, "power"], `${name}: × power`, "power", BALANCE_LIMITS.power),
    field([...path, "randomN"], `${name}: + random(n)`, "random", BALANCE_LIMITS.randomN),
  ].map((f) => (optional ? { ...f, optional: true } : f));

/** What an effect's amounts mean on its row. */
function effectFields(effect: BalanceSpellEffect): BalanceFieldView[] {
  if (BALANCE_HEAL_EFFECTS.includes(effect)) {
    return [
      ...amountFields(["monster"], "Heals a monster"),
      ...amountFields(["monsterUndead"], "Hurts an undead monster"),
      ...amountFields(["player"], "Heals a player"),
    ];
  }
  if (effect === "Arrows") {
    return [
      ...amountFields(
        ["monster"],
        "On a monster",
        "The monster's Defense comes off this; less than 1 rolls the arrow floor (Spell hits).",
      ),
      ...amountFields(["player"], "On a player", "Then the player's spell defense."),
    ];
  }
  const throughDefense = !["Firebolt", "Splash"].includes(effect);
  return [
    ...amountFields(["monster"], "On a monster"),
    ...amountFields(
      ["monsterHealed"],
      "Heals a species it heals",
      "A species whose healedBy names the effect is healed by this instead. Leave the three empty to heal it by the amount on a monster.",
      true,
    ),
    ...amountFields(
      ["player"],
      "On a player",
      throughDefense
        ? "Then the player's spell defense (worn armour, Magic Shield, + random(3))."
        : "Spell defense does not touch it.",
    ),
  ];
}

/** The page's groups, in order. Each later stage of issue #19 adds its group here. */
export const BALANCE_GROUPS: readonly BalanceGroupDef[] = [
  {
    id: "spells",
    title: "Spell amounts",
    help: "What each spell effect deals or heals: a fixed amount, plus the caster's spell power times a multiple, plus a roll of 1 to n (0 rolls nothing). A spell row on the Content page may set its own amounts (its amount field), which replace these when that spell is cast from a spellbook (a free fireball, a monster's cast or a map hazard running the same effect keeps these).",
    rows: [
      ...BALANCE_SPELL_EFFECT_ORDER.map((effect) => ({
        part: "spellEffects",
        key: effect,
        label: effect,
        fields: effectFields(effect),
      })),
      {
        part: "spellHits",
        key: null,
        label: "Spell hits",
        fields: [
          field(
            ["dispel"],
            "Dispel Illusions on a dispellable monster",
            "count",
            BALANCE_LIMITS.flat,
          ),
          field(
            ["resistedRandomN"],
            "A resisted effect deals random(n)",
            "random",
            { min: 1, max: BALANCE_LIMITS.randomN.max },
            "A species whose resists names the effect takes this roll instead of the amount.",
          ),
          field(["arrowsFloorRandomN"], "An arrow under 1 deals random(n)", "random", {
            min: 1,
            max: BALANCE_LIMITS.randomN.max,
          }),
        ],
      },
    ],
  },
  {
    id: "buffs",
    title: "Buffs and cast power",
    help: "How long the buff spells last for each point of the caster's power, their bonuses, Morph's roll and the free fireballs' power.",
    rows: [
      {
        part: "buffs",
        key: null,
        label: "Buffs",
        fields: [
          field(
            ["magicShieldPerPower"],
            "Magic Shield: frames per power",
            "frames",
            BALANCE_LIMITS.perPower,
          ),
          field(
            ["stoneSkinPerPower"],
            "Stone Skin: frames per power",
            "frames",
            BALANCE_LIMITS.perPower,
          ),
          field(["stoneSkinBonus"], "Stone Skin: defense bonus", "count", BALANCE_LIMITS.bonus),
          field(
            ["fireSwordPerPower"],
            "Firesword: frames per power",
            "frames",
            BALANCE_LIMITS.perPower,
          ),
          field(["holdPerPower"], "Hold: frames per power", "frames", BALANCE_LIMITS.perPower),
          field(
            ["argonFrames"],
            "Argon's Fist",
            "frames",
            BALANCE_LIMITS.frames,
            "A Purple Potion gives the same.",
          ),
          field(
            ["diminishHunger", "add"],
            "Diminish Hunger: hunger added",
            "count",
            BALANCE_LIMITS.hunger,
          ),
          field(
            ["diminishHunger", "below"],
            "Diminish Hunger: only below hunger",
            "count",
            BALANCE_LIMITS.hunger,
          ),
          ...amountFields(
            ["morph"],
            "Morph roll",
            "The last morph body (bindings.json bodies.morph) whose above the roll passes is taken.",
          ),
        ],
      },
      {
        part: "castPower",
        key: null,
        label: "Free fireballs",
        fields: [
          field(
            ["staffFireball", "flat"],
            "Fire Staff fireball power",
            "count",
            BALANCE_LIMITS.flat,
            "Before the Fire Staff skill's steps (over 20, 40, 80 and 99).",
          ),
          field(
            ["staffFireball", "randomN"],
            "Fire Staff: + random(n)",
            "random",
            BALANCE_LIMITS.randomN,
          ),
          field(
            ["swordFireball", "flat"],
            "Firesword fireball power",
            "count",
            BALANCE_LIMITS.flat,
          ),
          field(
            ["swordFireball", "randomN"],
            "Firesword: + random(n)",
            "random",
            BALANCE_LIMITS.randomN,
          ),
        ],
      },
    ],
  },
  {
    id: "vitals",
    title: "Regeneration, hunger and death",
    help: "How HP and SP regenerate and starve, how hunger falls, and what a death leaves. Hunger counts down while you play: food raises it.",
    // House rest is the houses dataset's own row (`houses.restRegen`), edited on the Content page.
    elsewhere: [
      {
        label: "Resting in a house",
        row: { dataset: "houses", part: "restRegen", key: null },
        describe: (v) => {
          const r = v as { odds?: number; maxY?: number } | undefined;
          return r?.odds
            ? `+1 HP and SP with a chance of 1 in ${r.odds} each frame, on a house map's rows up to ${r.maxY}`
            : "none: this world has no house rest";
        },
      },
    ],
    rows: [
      {
        part: "regen",
        key: null,
        label: "Regeneration",
        fields: [
          field(
            ["periodFrames"],
            "Regeneration counts up to",
            "counter",
            { min: 1, max: BALANCE_LIMITS.frames.max },
            "A counter starts at 1, rises each frame and acts on reaching this, then starts again at 1: so regeneration acts every this − 1 frames (Classic's 149 is every 148, 1.6's cadence). A faction's regeneration perk takes its value off this first.",
          ),
          field(["regenerate"], "HP and SP regenerated a period", "count", BALANCE_LIMITS.vitals),
          field(
            ["starve"],
            "HP and SP starved a period",
            "count",
            BALANCE_LIMITS.vitals,
            "Never below 1.",
          ),
        ],
      },
      {
        part: "hunger",
        key: null,
        label: "Hunger",
        fields: [
          field(
            ["loseOneIn"],
            "Loses 1 each frame with a chance of",
            "oneIn",
            BALANCE_LIMITS.oneIn,
          ),
          field(["regenAbove"], "Regenerates above", "count", BALANCE_LIMITS.hunger),
          field(
            ["starveBelow"],
            "Starves below",
            "count",
            BALANCE_LIMITS.hunger,
            "Below Regenerates above, which is at most Stuffed at.",
          ),
          field(
            ["stuffed"],
            "Stuffed at",
            "count",
            BALANCE_LIMITS.hunger,
            "From here on, food and potions are refused and kept.",
          ),
          field(["afterDeath"], "After a death", "count", BALANCE_LIMITS.hunger),
        ],
      },
      {
        part: "death",
        key: null,
        label: "Death",
        fields: [
          field(
            ["hp"],
            "HP after a death",
            "count",
            { min: 1, max: BALANCE_LIMITS.vitals.max },
            "At most the player's full HP.",
          ),
          field(
            ["sp"],
            "SP after a death",
            "count",
            BALANCE_LIMITS.vitals,
            "At most the player's full SP.",
          ),
          field(
            ["pauseFrames"],
            "Pause",
            "frames",
            BALANCE_LIMITS.frames,
            "No monster rolls against a player for this long after a death.",
          ),
        ],
      },
    ],
  },
  {
    id: "drops",
    title: "Death drops and loot",
    help: "Whose deaths drop gold or one random bag item (never crystals) where they died, and how long monster loot stays on the ground. These were Server Settings (the Items page) before.",
    rows: [
      {
        part: "drops",
        key: null,
        label: "Death drops and loot",
        fields: [
          choiceField(
            ["who"],
            "Drops on death",
            BALANCE_DROP_WHO,
            {
              off: "Off",
              wanted: "Wanted only",
              pvp: "Killed by a player",
              everyone: "Everyone",
            },
            "Wanted only: characters wanted for murder. Killed by a player: anyone another player kills, and wanted characters however they die. Everyone: every death outside an arena, as in 1.6. A faction member killed on a PvP map drops the faction's head whatever this says, and a role with the drop-on-every-death permission always drops.",
          ),
          choiceField(["kind"], "What drops", BALANCE_DROP_KIND, {
            either: "Gold or an item",
            gold: "Gold only",
            items: "Items only",
          }),
          field(
            ["goldCap"],
            "Most gold dropped",
            "count",
            BALANCE_LIMITS.goldCap,
            "Unless the character is wanted for murder (a wanted character can drop all they carry). 0 means no cap; 1.6 capped it at 200.",
          ),
          field(
            ["minLevel"],
            "No drops below level",
            "count",
            BALANCE_LIMITS.level,
            "Protects new players' first gear; not a character wanted for murder. 0 protects no one.",
          ),
          field(
            ["lootDecaySeconds"],
            "Monster loot lasts",
            "seconds",
            BALANCE_LIMITS.lootSeconds,
            "Player drops and items placed with /drop never disappear. 1.6 never removed ground items.",
          ),
        ],
      },
    ],
  },
  {
    id: "timings",
    title: "Timings",
    help: "Waits that pace fights and a few actions. The game runs 20 frames a second.",
    rows: [
      {
        part: "timings",
        key: null,
        label: "Timings",
        fields: [
          field(
            ["flickerFrames"],
            "Hit flicker",
            "passFrames",
            BALANCE_LIMITS.frames,
            "A hit player flickers this long, and no other hit lands meanwhile.",
          ),
          field(
            ["castDelayFrames"],
            "After a cast",
            "passFrames",
            { min: 1, max: BALANCE_LIMITS.frames.max },
            "Before the caster may act again.",
          ),
          field(
            ["swingBaseFrames"],
            "Swing cooldown",
            "frames",
            { min: 1, max: BALANCE_LIMITS.frames.max },
            "With no gear that sets one (Ring of Quickness, item rules). A ladder's own steps (an Axe's, a Fishing Pole's) are the item rules'.",
          ),
          field(
            ["killCreditFrames"],
            "A hit counts as the kill for",
            "frames",
            { min: 1, max: BALANCE_LIMITS.frames.max },
            "A death after this, with no new hit, credits no killer.",
          ),
          field(["pigGrabFrames"], "Between pig grabs", "frames", BALANCE_LIMITS.frames),
          field(["giveGrabFrames"], "A give is picked up after", "frames", BALANCE_LIMITS.frames),
          field(
            ["npcSpellBlockFrames"],
            "Between monster spells on a map",
            "frames",
            BALANCE_LIMITS.frames,
            "After a monster's spell, before another monster spell may hit the same players.",
          ),
        ],
      },
    ],
  },
  {
    id: "combat",
    title: "Combat rolls",
    help: "The rolls inside the fight formulas. A chance of 1 in N means a roll of 1 to N hits on a 1.",
    rows: [
      {
        part: "combat",
        key: null,
        label: "Combat rolls",
        fields: [
          ...floorFields(
            ["meleeFloor"],
            "Melee on a monster",
            "Damage under this after the monster's Defense rolls instead.",
          ),
          ...floorFields(
            ["playerHitFloor"],
            "A hit on a player",
            "A monster's or a player's hit under this after defense rolls instead.",
          ),
          field(
            ["dodgeBaseRandomN"],
            "Parry and block: base roll random(n)",
            "random",
            { min: 1, max: BALANCE_LIMITS.randomN.max },
            "A parry or block succeeds on a 1. Past a little skill (over 10 against monsters, over 0 against players) the skill's own ladder rolls instead.",
          ),
          field(
            ["monsterMeleeOneIn"],
            "A monster next to you attacks each frame with a chance of",
            "oneIn",
            BALANCE_LIMITS.oneIn,
          ),
          field(
            ["pushOneIn"],
            "Walking into a player pushes them with a chance of",
            "oneIn",
            BALANCE_LIMITS.oneIn,
          ),
        ],
      },
    ],
  },
  {
    id: "monsters",
    title: "Monsters",
    help: "How often a map's monsters move and spawn, by the players on the map, and the rolls inside a move and a spawn. What each species does is its own row on the Content page.",
    // The generic stand-in is the monsters dataset's own row (`monsters.generic`).
    elsewhere: [
      {
        label: "Generic stand-in (a name no species has, such as a player shop's shopkeeper)",
        row: { dataset: "monsters", part: "generic", key: null },
        describe: (v) => {
          // Its `hp` is not read: a name no species has starts with 1 HP (and so does a new
          // shopkeeper).
          const g = v as { body?: number; defense?: number } | undefined;
          return g ? `body ${g.body}, defense ${g.defense} (it starts with 1 HP)` : "none";
        },
      },
    ],
    rows: [
      {
        part: "monsters",
        key: null,
        label: "Monster rolls",
        fields: [
          ...[1, 2, 3, 4, 5, 6, 7, 8].map((n, i) =>
            field(
              ["moveLadder", String(i)],
              `Move pick with ${n === 8 ? "8 or more players" : n === 1 ? "1 player" : `${n} players`}: random(n)`,
              "random",
              { min: ROSTER_SLOTS, max: BALANCE_LIMITS.oneIn.max },
              i === 0
                ? "Twice each frame, for each player on the map (at most 15), one slot is picked by this roll, and the monster in it moves when the roll is 1 to 4: a larger n moves monsters less often. At least 4, so every slot can be picked."
                : undefined,
            ),
          ),
          field(["walkStepsRandomN"], "A walk's steps: random(n)", "random", {
            min: 1,
            max: BALANCE_LIMITS.randomN.max,
          }),
          ...[1, 2, 3, 4, 5, 6, 7].map((n, i) =>
            field(
              ["spawnLadder", String(i)],
              `Spawn pass with ${n === 7 ? "7 or more players" : n === 1 ? "1 player" : `${n} players`}: a chance of`,
              "oneIn",
              BALANCE_LIMITS.oneIn,
              i === 0
                ? "Twice each frame, for each player on the map (at most 15), a spawn pass goes ahead with this chance."
                : undefined,
            ),
          ),
          field(
            ["slotOneIn"],
            "In a pass, each empty slot spawns with a chance of",
            "oneIn",
            BALANCE_LIMITS.oneIn,
          ),
          field(
            ["factionSlotRandomN"],
            "A faction's member takes slot random(n)",
            "random",
            { min: ROSTER_SLOTS, max: BALANCE_LIMITS.randomN.max },
            "On a faction's map; a roll above 4 swaps no slot. At least 4, so the member can take any slot and every slot's own species still spawns.",
          ),
          field(["npcSpawn", "randomN"], "An NPC spawns when random(n)", "random", {
            min: 1,
            max: BALANCE_LIMITS.randomN.max,
          }),
          field(
            ["npcSpawn", "passAtMost"],
            "… is at most",
            "count",
            BALANCE_LIMITS.randomN,
            "So an NPC spawns at this many in n of a monster's rate.",
          ),
        ],
      },
    ],
  },
  {
    id: "vehicles",
    title: "Vehicles",
    help: "Hull wear and repair, and the cannon (SSO additions: 1.6 had no hulls and never fired its cannon). Each vehicle's full hull is its own row, edited on the Content page.",
    // Each vehicle's full hull is its `houses.vehicles` row's (issue #44).
    elsewhereOf: (published) =>
      (published.houses?.vehicles ?? []).map((v) => ({
        label: `${v.display ?? v.name} hull`,
        row: { dataset: "houses", part: "vehicles", key: v.name },
        describe: (value) => {
          const hull = (value as { hull?: number } | undefined)?.hull;
          return hull === undefined ? "none: no such vehicle" : `full hull ${hull}`;
        },
      })),
    rows: [
      {
        part: "vehicles",
        key: null,
        label: "Hull wear and repair",
        fields: [
          field(
            ["hullHit"],
            "Hull taken by one hit",
            "count",
            BALANCE_LIMITS.hullHit,
            "What one arrow or harmful spell takes off a rider's hull, whatever the attacker's level.",
          ),
          field(
            ["repairPerMinute"],
            "Hull mended each minute parked",
            "count",
            BALANCE_LIMITS.repairPerMinute,
            "A parked vehicle regains this for each whole minute, up to its full hull.",
          ),
        ],
      },
      {
        part: "cannon",
        key: null,
        label: "Cannon",
        fields: [
          field(["damage", "flat"], "Damage", "count", BALANCE_LIMITS.flat),
          field(
            ["damage", "randomN"],
            "plus random(n)",
            "random",
            BALANCE_LIMITS.randomN,
            "A cannonball takes the damage plus a roll of 1 to n (0 rolls nothing) off a player's HP, a hull or a monster.",
          ),
          field(["reloadFrames"], "Reload", "frames", { min: 1, max: BALANCE_LIMITS.frames.max }),
        ],
      },
    ],
  },
];

/** The rows the page edits. */
export function balanceRowDefs(): BalanceRowDef[] {
  return BALANCE_GROUPS.flatMap((g) => g.rows);
}

/** The page's row named by a part and key (key case ignored), or undefined. */
export function balanceRowDef(part: string, key: string | null): BalanceRowDef | undefined {
  const ref: RowRef = { dataset: "balance", part, key };
  return balanceRowDefs().find((r) => sameRow({ dataset: "balance", ...r }, ref));
}

/** The engine's default for a row. */
export function engineValue(def: BalanceRowDef): unknown {
  const v = rowValue({ balance: BALANCE_DEFAULTS } as unknown as Partial<ContentData>, {
    dataset: "balance",
    part: def.part,
    key: def.key,
  });
  return structuredClone(v);
}

/** What the view is built from: the content store's layers for the balance rows. */
export interface BalanceLayers {
  pack: ContentData;
  published: ContentData;
  draft: ContentData;
  /** The operator rows that are published (`set` or removal markers). */
  operatorRows: readonly (RowRef & { op: "set" | "remove" })[];
  /** The draft's changes. */
  draftRows: readonly (RowRef & { op: "set" | "remove" | "revert" })[];
  notices: readonly (RowRef & { packName: string; packVersion: string; now: unknown })[];
  /** Draft changes outside the balance dataset. */
  otherDraft: number;
}

/**
 * A row as the page last showed it: its draft value, the draft's change and whether it is
 * published with an operator change. A save whose `expect` differs is refused.
 */
export function balanceFingerprint(def: BalanceRowDef, l: BalanceLayers): string {
  const ref: RowRef = { dataset: "balance", part: def.part, key: def.key };
  return rowHash({
    draft: rowValue(l.draft, ref) ?? null,
    pending: l.draftRows.find((d) => sameRow(d, ref))?.op ?? null,
    edited: l.operatorRows.some((r) => sameRow(r, ref)),
  });
}

/**
 * A refused balance row's problems as the page says them: each names the field it is about by
 * the field's label (`Starves below`), and a field's key in the message becomes its label in
 * quotes. A problem with no field of the row keeps the row's label.
 */
export function balanceProblems(
  def: BalanceRowDef,
  problems: readonly { where: string; message: string }[],
): { where: string; message: string }[] {
  const prefix = `balance/${def.part}/`;
  const labels = new Map(def.fields.map((f) => [f.path.join("/"), f.label] as const));
  const byKey = new Map(def.fields.map((f) => [f.path.at(-1) ?? "", f.label] as const));
  return problems.map((p) => {
    let path = p.where.startsWith(prefix) ? p.where.slice(prefix.length) : "";
    // A keyed row's entry index comes first (`spellEffects/3/monster/flat`).
    if (def.key !== null) {
      path = path.replace(/^\d+\//, "");
    }
    const where =
      labels.get(path) ??
      [...labels].find(([k]) => path.startsWith(`${k}/`) || k.startsWith(`${path}/`))?.[1] ??
      def.label;
    const message = p.message.replace(/\b[a-z]+[A-Z][A-Za-z]*\b/g, (w) => {
      const label = byKey.get(w);
      return label ? `"${label}"` : w;
    });
    return { where, message };
  });
}

/** The Balance page's view. */
export function balanceView(l: BalanceLayers): { groups: BalanceGroupView[]; otherDraft: number } {
  const groups = BALANCE_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    help: g.help,
    ...(g.elsewhere || g.elsewhereOf
      ? {
          elsewhere: [...(g.elsewhere ?? []), ...(g.elsewhereOf?.(l.published) ?? [])].map((e) => ({
            label: e.label,
            row: e.row,
            now: e.describe(rowValue(l.published, e.row)),
          })),
        }
      : {}),
    rows: g.rows.map((def): BalanceRowView => {
      const ref: RowRef = { dataset: "balance", part: def.part, key: def.key };
      const engine = engineValue(def);
      const notice = l.notices.find((n) => sameRow(n, ref));
      return {
        part: def.part,
        key: def.key,
        label: def.label,
        fields: def.fields,
        engine,
        pack: rowValue(l.pack, ref) ?? null,
        published: rowValue(l.published, ref) ?? engine,
        draft: rowValue(l.draft, ref) ?? engine,
        edited: l.operatorRows.some((r) => sameRow(r, ref)),
        pending: l.draftRows.find((d) => sameRow(d, ref))?.op ?? null,
        fingerprint: balanceFingerprint(def, l),
        notice: notice
          ? { packName: notice.packName, packVersion: notice.packVersion, now: notice.now }
          : null,
      };
    }),
  }));
  return { groups, otherDraft: l.otherDraft };
}
