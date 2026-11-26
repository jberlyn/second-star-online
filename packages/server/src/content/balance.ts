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
  HUNGER_BREAK_ADD_MAX,
  HUNGER_SHOW,
  HUNGER_STEPS_MAX,
  HUNGER_STUFFED_REFUSES,
  HUNGER_WARNING_TEXT_MAX,
  KILL_XP_ADJUST,
  LEVEL_COUNTING,
  MONSTER_LEVEL_DISPLAY,
  ROSTER_SLOTS,
} from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  BALANCE_SPELL_EFFECT_ORDER,
  type BalanceFieldView,
  type BalanceGroupView,
  type BalanceRowView,
  type BalanceStepsView,
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

/** A list of counts typed with commas, each within `limits`, at most `maxItems`. */
const listField = (
  path: string[],
  label: string,
  limits: { min: number; max: number },
  maxItems: number,
  help?: string,
): BalanceFieldView => ({
  path,
  label,
  unit: "list",
  min: limits.min,
  max: limits.max,
  maxItems,
  ...(help ? { help } : {}),
});

/** A list of `<number>: <value>` entries typed one a line, each number within `limits`. */
const stepsField = (
  path: string[],
  label: string,
  limits: { min: number; max: number },
  maxItems: number,
  steps: BalanceStepsView,
  help?: string,
): BalanceFieldView => ({
  path,
  label,
  unit: "steps",
  min: limits.min,
  max: limits.max,
  maxItems,
  steps,
  ...(help ? { help } : {}),
});

/** A damage floor's two fields: under `below`, damage becomes a roll of 1 to `randomN`. */
const floorFields = (path: string[], name: string, help: string): BalanceFieldView[] => [
  field([...path, "below"], `${name}: damage under`, "count", BALANCE_LIMITS.floorBelow, help),
  field([...path, "randomN"], `${name}: becomes a roll of 1 to`, "random", {
    min: 1,
    max: BALANCE_LIMITS.randomN.max,
  }),
];

/**
 * The three fields of an amount (`flat + power × P + random(randomN)`) at `path`, named `name`.
 * The page shows the fixed part and the roll as one "from … to …" range, and previews the whole
 * amount at a few powers.
 */
const amountFields = (
  path: string[],
  name: string,
  help?: string,
  optional = false,
): BalanceFieldView[] =>
  [
    field([...path, "flat"], name, "count", BALANCE_LIMITS.flat, help),
    field([...path, "power"], `${name}: plus the caster's power ×`, "power", BALANCE_LIMITS.power),
    field([...path, "randomN"], `${name}: extra roll up to`, "random", BALANCE_LIMITS.randomN),
  ].map((f) => (optional ? { ...f, optional: true } : f));

/**
 * A timed spell's two length fields (issue #17): a fixed time, plus a time for each point of the
 * caster's power. A spell's own "Lasts" on the Spells page replaces both.
 */
const lengthFields = (frames: string, perPower: string, name: string): BalanceFieldView[] => [
  field(
    [frames],
    `${name}: lasts`,
    "frames",
    BALANCE_LIMITS.frames,
    "A spell with its own Lasts on the Spells page lasts that long instead.",
  ),
  field([perPower], `${name}: plus time per point of power`, "frames", BALANCE_LIMITS.perPower),
];

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
        "The monster's Defense comes off this; under 1, the arrow deals the small roll set under Spell hits.",
      ),
      ...amountFields(["player"], "On a player", "Then the player's spell defense."),
    ];
  }
  if (effect === "Poison Dart") {
    return [
      ...amountFields(["monster"], "Each hit on a monster"),
      ...amountFields(
        ["monsterHealed"],
        "Each hit on a monster it heals",
        "A monster set to be healed by this spell is healed by this much instead. Leave it empty to heal it by the amount on a monster.",
        true,
      ),
      ...amountFields(
        ["player"],
        "Each hit on a player",
        "The poison hits this often for as long as it lasts (under Buffs). Spell defense doesn't reduce it.",
      ),
    ];
  }
  const throughDefense = !["Firebolt", "Splash"].includes(effect);
  return [
    ...amountFields(["monster"], "On a monster"),
    ...amountFields(
      ["monsterHealed"],
      "On a monster it heals",
      "A monster set to be healed by this spell is healed by this much instead. Leave it empty to heal it by the amount on a monster.",
      true,
    ),
    ...amountFields(
      ["player"],
      "On a player",
      throughDefense
        ? "Then the player's spell defense comes off it (worn armour, Magic Shield and a roll of 1 to 3)."
        : "Spell defense doesn't reduce it.",
    ),
  ];
}

/** The page's groups, in order. Each later stage of issue #19 adds its group here. */
export const BALANCE_GROUPS: readonly BalanceGroupDef[] = [
  {
    id: "spells",
    title: "Spell amounts",
    help: "How much each spell deals or heals: a range (from … to …), plus the caster's spell power times a number. A spell on the Content page can set its own amounts, which replace these when it is cast from a spellbook; free fireballs, monster spells and map hazards keep these.",
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
            "Dispel Illusions' damage to a monster it destroys",
            "count",
            BALANCE_LIMITS.flat,
          ),
          field(
            ["resistedRandomN"],
            "A resisted spell deals 1 to",
            "random",
            { min: 1, max: BALANCE_LIMITS.randomN.max },
            "A monster that resists a spell takes a roll of 1 to this instead of the amount.",
          ),
          field(["arrowsFloorRandomN"], "An arrow that would deal under 1 deals 1 to", "random", {
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
    help: "How long buff spells last, their bonuses, Morph's roll and the power of free fireballs.",
    rows: [
      {
        part: "buffs",
        key: null,
        label: "Buffs",
        fields: [
          field(
            ["magicShieldPerPower"],
            "Magic Shield: time per point of power",
            "frames",
            BALANCE_LIMITS.perPower,
          ),
          field(
            ["stoneSkinPerPower"],
            "Stone Skin: time per point of power",
            "frames",
            BALANCE_LIMITS.perPower,
          ),
          field(["stoneSkinBonus"], "Stone Skin: defense bonus", "count", BALANCE_LIMITS.bonus),
          field(
            ["fireSwordPerPower"],
            "Firesword: time per point of power",
            "frames",
            BALANCE_LIMITS.perPower,
          ),
          field(
            ["holdPerPower"],
            "Hold: time per point of power",
            "frames",
            BALANCE_LIMITS.perPower,
          ),
          field(
            ["argonFrames"],
            "Argon's Fist lasts",
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
            "Diminish Hunger: works only below hunger",
            "count",
            BALANCE_LIMITS.hunger,
          ),
          ...amountFields(
            ["morph"],
            "Morph roll",
            'Picks the body: the last morph body (bindings.json bodies.morph) whose "above" the roll beats.',
          ),
          ...lengthFields("hasteFrames", "hastePerPower", "Haste"),
          field(
            ["hasteRegenPercent"],
            "Haste: regeneration speed, in percent",
            "count",
            BALANCE_LIMITS.speedPercent,
            "How fast HP and SP come back while Haste lasts: 200 is twice as fast.",
          ),
          ...lengthFields("blessFrames", "blessPerPower", "Bless"),
          field(["blessBonus"], "Bless: attack power added", "count", BALANCE_LIMITS.bonus),
          ...lengthFields("holyWeaponFrames", "holyWeaponPerPower", "Holy Weapon"),
          field(
            ["holyWeaponBonus"],
            "Holy Weapon: damage added to each melee hit",
            "count",
            BALANCE_LIMITS.bonus,
          ),
          field(
            ["holyWeaponUndeadBonus"],
            "Holy Weapon: damage added on an undead monster",
            "count",
            BALANCE_LIMITS.bonus,
            "Undead monsters are the ones healing hurts.",
          ),
          ...lengthFields("weakenFrames", "weakenPerPower", "Weaken"),
          field(
            ["weakenPenalty"],
            "Weaken: attack taken off",
            "count",
            BALANCE_LIMITS.bonus,
            "Off a player's attack power, or a monster's attack. Never below 1.",
          ),
          ...lengthFields("poisonFrames", "poisonPerPower", "Poison Dart's poison"),
          field(
            ["poisonEveryFrames"],
            "Poison Dart's poison: time between hits",
            "frames",
            BALANCE_LIMITS.poisonEvery,
            "Each hit deals Poison Dart's amount under Spell amounts.",
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
            "Before the Fire Staff skill's bonuses (over 20, 40, 80 and 99).",
          ),
          field(
            ["staffFireball", "randomN"],
            "Fire Staff fireball power: extra roll up to",
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
            "Firesword fireball power: extra roll up to",
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
    help: "How HP and SP come back or drain away, how hunger falls, and what a death leaves. Hunger counts down while you play; food raises it.",
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
            "Regeneration timer",
            "counter",
            { min: 1, max: BALANCE_LIMITS.frames.max },
            "Regeneration happens every this many frames minus 1 (Classic's 149 is every 148 frames, 7.4 seconds, as in 1.6). A faction's regeneration perk takes its value off this first.",
          ),
          field(["regenerate"], "HP and SP regained each time", "count", BALANCE_LIMITS.vitals),
          field(
            ["starve"],
            "HP and SP lost each time while starving",
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
            "Chance hunger drops each frame: 1 in",
            "oneIn",
            BALANCE_LIMITS.oneIn,
          ),
          field(["regenAbove"], "Regenerates only above hunger", "count", BALANCE_LIMITS.hunger),
          field(
            ["starveBelow"],
            "Starves below hunger",
            "count",
            BALANCE_LIMITS.hunger,
            'Must be below "Regenerates only above hunger", which is at most "Full at".',
          ),
          field(
            ["stuffed"],
            "Full at",
            "count",
            BALANCE_LIMITS.hunger,
            'From here on, Use is refused and the item kept (see "When full, refuse").',
          ),
          choiceField(
            ["stuffedRefuses"],
            "When full, refuse",
            HUNGER_STUFFED_REFUSES,
            { all: "Every usable item (1.6)", food: "Only food" },
            'Every usable item: healing potions too, as in 1.6. Only food: an item whose use can raise hunger (Classic\'s potions raise it too). An item that only lowers hunger, or one marked "Can be used when full" on the Items page, is never refused. What an item does to hunger is set there too ("When used"): a positive amount raises it, a negative one lowers it.',
          ),
          field(
            ["max"],
            "Most hunger can be",
            "count",
            BALANCE_LIMITS.hunger,
            'Nothing goes above this: food and spells stop here, a new character and a death start no higher, and a character saved above it is brought down to it. At least "Full at" and "Hunger after a death". A percentage shown to players is of this. Classic\'s 50000 is its starting hunger, the most 1.6 ever gave.',
          ),
          field(
            ["lose"],
            "Hunger lost each time it drops",
            "count",
            BALANCE_LIMITS.hunger,
            "0: nobody ever gets hungry. Never below 0.",
          ),
          field(
            ["afterDeath"],
            "Hunger after a death",
            "count",
            BALANCE_LIMITS.hunger,
            'At most "Most hunger can be".',
          ),
          stepsField(
            ["warnings"],
            "Warnings",
            BALANCE_LIMITS.hunger,
            HUNGER_STEPS_MAX,
            {
              key: "at",
              value: "text",
              valueKind: "text",
              valueMin: 1,
              valueMax: HUNGER_WARNING_TEXT_MAX,
              example: "1500: You are very hungry.",
            },
            "One a line: a hunger, a colon, then what a player is told when their hunger falls to it. Empty: no warnings.",
          ),
          stepsField(
            ["breakOdds"],
            "A full stomach protects gear",
            BALANCE_LIMITS.hunger,
            HUNGER_STEPS_MAX,
            {
              key: "above",
              value: "add",
              valueKind: "count",
              valueMin: 0,
              valueMax: HUNGER_BREAK_ADD_MAX,
              example: "20000: 10",
            },
            "One a line: a hunger, a colon, then how much is added to the gear-break roll above it (bigger is safer). Each one the hunger is above counts. A break roll starts from 1 + 3 × Stamina + 600 for armour, or 500 for a weapon, and breaks on a 1. Empty: hunger makes no difference.",
          ),
          choiceField(
            ["show"],
            "Players see their hunger",
            HUNGER_SHOW,
            {
              hidden: "Never (1.6)",
              words: "In words",
              percent: "As a percentage of full",
              number: "As a number",
            },
            'Shown on the Stats tab under the stats. In words: Stuffed, Fed, Hungry (no longer regenerating) or Starving. A percentage is of "Most hunger can be"; a number is rounded down to the hundred.',
          ),
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
            "Safe time after a death",
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
    id: "levels",
    title: "Levels and experience",
    help: "How much experience a kill gives, how much each character level takes, and what a level gives. A monster's own XP and level are set on the Creatures & NPCs page; gear that adds kill XP (a Ring of Experience) on the Items page.",
    rows: [
      {
        part: "killXp",
        key: null,
        label: "Experience from kills",
        fields: [
          choiceField(
            ["adjust"],
            "The killer's level",
            KILL_XP_ADJUST,
            {
              minusLevel: "Takes its level off the XP (1.6)",
              none: "Changes nothing: every kill gives the same",
              levelDifference: "Compares the monster's level with it",
            },
            "Takes its level off: a monster gives less as you level, and nothing once your level reaches its XP. Changes nothing: a monster always gives the same XP, so the level curve below must grow steeply instead. Compares: more for a monster above your level, less for one below (a monster with no level counts as your level).",
          ),
          field(
            ["bonus"],
            "Added to every kill",
            "count",
            BALANCE_LIMITS.xp,
            "After the monster's own XP and any gear's. 1.6 added 10.",
          ),
          listField(
            ["thresholds"],
            "Extra XP once the XP is above",
            BALANCE_LIMITS.xp,
            BALANCE_LIMITS.listItems.max,
            "Each one the XP is above adds the extra below, tested in order on the growing XP. Rising numbers, separated by commas; empty for none. 1.6: 100, 150, 200, 250, 300, 350, 400.",
          ),
          field(["thresholdBonus"], "Extra XP for each", "count", BALANCE_LIMITS.xp),
          field(
            ["belowPercent"],
            "Comparing levels: percent less for each level the monster is below",
            "count",
            BALANCE_LIMITS.percent,
          ),
          field(
            ["abovePercent"],
            "Comparing levels: percent more for each level the monster is above",
            "count",
            BALANCE_LIMITS.percent,
          ),
          field(
            ["maxPercent"],
            "Comparing levels: at most this percent of the XP",
            "count",
            BALANCE_LIMITS.percent,
            "100 means a monster above you gives no more than its XP.",
          ),
          field(
            ["fromLevel", "flat"],
            "A monster with no XP of its own gives",
            "count",
            BALANCE_LIMITS.xp,
            "Set its level on the Creatures & NPCs page and leave its XP empty: it gives this plus the amount below for each level.",
          ),
          field(
            ["fromLevel", "perLevel"],
            "Plus, for each of its levels",
            "count",
            BALANCE_LIMITS.xp,
          ),
          field(
            ["noSpecies"],
            "A monster that is not on the Creatures & NPCs page gives",
            "count",
            BALANCE_LIMITS.xp,
            "Such as a shopkeeper's stand-in. 1.6 gave 30.",
          ),
        ],
      },
      {
        part: "levels",
        key: null,
        label: "Character levels",
        fields: [
          listField(
            ["firstLevels"],
            "XP for the first levels",
            BALANCE_LIMITS.xp,
            BALANCE_LIMITS.listItems.max,
            "Exact XP for level 1, 2, 3… separated by commas. Levels past the list use the formula below. 1.6: 30, 400.",
          ),
          field(["start"], "Formula: start at", "count", BALANCE_LIMITS.xp),
          field(
            ["perLevel"],
            "Formula: plus this times the level",
            "count",
            BALANCE_LIMITS.xp,
            "1.6: 400 plus 2 times the level.",
          ),
          field(
            ["exponent"],
            "Formula: the level raised to the power",
            "count",
            BALANCE_LIMITS.exponent,
            "1 is a straight line; 2 squares the level, so later levels take much more.",
          ),
          field(
            ["growthPercent"],
            "Formula: then grows by this percent each level",
            "count",
            BALANCE_LIMITS.growth,
            "Compounding: 10 makes each level take about 10% more than the last, as in games where a monster always gives the same XP. 0 for none.",
          ),
          choiceField(
            ["counting"],
            "XP is counted",
            LEVEL_COUNTING,
            {
              perLevel: "From one level to the next (1.6)",
              total: "In total, from level 1",
            },
            "From one level to the next: the list and formula give the XP each level takes, and the XP bar starts again at 0 each level. In total: they give the total XP that reaches the next level, and the bar shows the running total.",
          ),
          {
            ...field(
              ["cap"],
              "Highest level",
              "count",
              { min: 1, max: BALANCE_LIMITS.level.max },
              "Characters stop levelling here; their XP still counts. Empty for no highest level (1.6 had none).",
            ),
            optional: true,
          },
          field(["hpPerLevel"], "Most HP gained each level", "count", BALANCE_LIMITS.vitals),
          field(["spPerLevel"], "Most SP gained each level", "count", BALANCE_LIMITS.vitals),
          choiceField(
            ["showMonsterLevels"],
            "Monster levels",
            MONSTER_LEVEL_DISPLAY,
            { hidden: "Hidden (1.6)", shown: "Shown beside their names" },
            'Shown: a monster with a level reads "Wolf (level 3)" in the hover tip and an NPC\'s Bio. Monsters already on a map show the change once it is loaded again.',
          ),
        ],
      },
    ],
  },
  {
    id: "timings",
    title: "Timings",
    help: "Waits that pace fights and a few actions. Times are in frames: 20 frames make 1 second.",
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
            "Wait after casting",
            "passFrames",
            { min: 1, max: BALANCE_LIMITS.frames.max },
            "Before the caster may act again.",
          ),
          field(
            ["swingBaseFrames"],
            "Wait between swings",
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
          field(["pigGrabFrames"], "Wait between pig grabs", "frames", BALANCE_LIMITS.frames),
          field(
            ["giveGrabFrames"],
            "A given item can be picked up after",
            "frames",
            BALANCE_LIMITS.frames,
          ),
          field(
            ["npcSpellBlockFrames"],
            "Wait between monster spells on a map",
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
    help: "The dice inside fights. A chance of 1 in N happens on average once every N tries.",
    rows: [
      {
        part: "combat",
        key: null,
        label: "Combat rolls",
        fields: [
          ...floorFields(
            ["meleeFloor"],
            "Melee on a monster",
            "Damage under this, after the monster's Defense, becomes a small roll instead.",
          ),
          ...floorFields(
            ["playerHitFloor"],
            "A hit on a player",
            "A monster's or a player's hit under this, after defense, becomes a small roll instead.",
          ),
          field(
            ["dodgeBaseRandomN"],
            "Parry and block with little skill: a roll of 1 to",
            "random",
            { min: 1, max: BALANCE_LIMITS.randomN.max },
            "It succeeds on a 1. Past a little skill (over 10 against monsters, over 0 against players) the skill's own chances take over.",
          ),
          field(
            ["monsterMeleeOneIn"],
            "Chance a monster next to you attacks, each frame: 1 in",
            "oneIn",
            BALANCE_LIMITS.oneIn,
          ),
          field(
            ["pushOneIn"],
            "Chance walking into a player pushes them: 1 in",
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
    help: "How often a map's monsters move and appear, by how many players are on the map. What each monster does is set on the Monsters page.",
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
              `Move roll with ${n === 8 ? "8 or more players" : n === 1 ? "1 player" : `${n} players`}: 1 to`,
              "random",
              { min: ROSTER_SLOTS, max: BALANCE_LIMITS.oneIn.max },
              i === 0
                ? "Twice each frame, for each player on the map (at most 15), this is rolled, and the monster in slots 1 to 4 that the roll picks moves: a bigger number moves monsters less often. At least 4, so every slot can be picked."
                : undefined,
            ),
          ),
          field(["walkStepsRandomN"], "Steps in one walk: 1 to", "random", {
            min: 1,
            max: BALANCE_LIMITS.randomN.max,
          }),
          ...[1, 2, 3, 4, 5, 6, 7].map((n, i) =>
            field(
              ["spawnLadder", String(i)],
              `Spawn chance with ${n === 7 ? "7 or more players" : n === 1 ? "1 player" : `${n} players`}: 1 in`,
              "oneIn",
              BALANCE_LIMITS.oneIn,
              i === 0
                ? "Twice each frame, for each player on the map (at most 15), the map tries to spawn monsters with this chance."
                : undefined,
            ),
          ),
          field(
            ["slotOneIn"],
            "Chance each empty slot spawns in a try: 1 in",
            "oneIn",
            BALANCE_LIMITS.oneIn,
          ),
          field(
            ["factionSlotRandomN"],
            "Slot a faction member takes: a roll of 1 to",
            "random",
            { min: ROSTER_SLOTS, max: BALANCE_LIMITS.randomN.max },
            "On a faction's map; a roll above 4 takes no slot. At least 4, so the member can take any slot and every slot's own monster still appears.",
          ),
          field(["npcSpawn", "randomN"], "NPC spawn roll: 1 to", "random", {
            min: 1,
            max: BALANCE_LIMITS.randomN.max,
          }),
          field(
            ["npcSpawn", "passAtMost"],
            "An NPC spawns when that roll is at most",
            "count",
            BALANCE_LIMITS.randomN,
            "So NPCs appear at this many in (the roll's top) of a monster's rate.",
          ),
        ],
      },
    ],
  },
  {
    id: "vehicles",
    title: "Vehicles",
    help: "Hull wear and repair, and the cannon (new in SSO: 1.6 had no hulls and never fired its cannon). Each vehicle's full hull is set on the Content page.",
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
          field(
            ["damage", "flat"],
            "Damage",
            "count",
            BALANCE_LIMITS.flat,
            "A cannonball takes this off a player's HP, a hull or a monster.",
          ),
          field(
            ["damage", "randomN"],
            "Damage: extra roll up to",
            "random",
            BALANCE_LIMITS.randomN,
          ),
          field(["reloadFrames"], "Reload time", "frames", {
            min: 1,
            max: BALANCE_LIMITS.frames.max,
          }),
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

/**
 * A row's value with the engine's default for each field it leaves out: a row written before a
 * field existed (the later hunger fields) shows, and saves, what plays. No row: the engine's.
 */
export function withEngine(row: unknown, engine: unknown): unknown {
  if (row === undefined || row === null) {
    return engine;
  }
  const plain = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  return plain(row) && plain(engine) ? { ...structuredClone(engine), ...row } : row;
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
        // A keyed row's optional parts are left out on purpose (a spell effect's amounts).
        published:
          def.key === null
            ? withEngine(rowValue(l.published, ref), engine)
            : (rowValue(l.published, ref) ?? engine),
        draft:
          def.key === null
            ? withEngine(rowValue(l.draft, ref), engine)
            : (rowValue(l.draft, ref) ?? engine),
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
