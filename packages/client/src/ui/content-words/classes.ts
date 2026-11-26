/** Plain words for the `classes` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";
import type { FieldWords } from "../schema-form.ts";

/** The words of a formula: a number, or steps worked top to bottom from 0. */
const formula: WordBook = {
  when: {
    label: "Only when",
    help: 'Conditions like "skill > 10" or "strength < 5". None: always.',
    noun: "condition",
  },
  op: {
    label: "Step",
    choices: { set: "Set to", add: "Add", subtract: "Subtract", multiply: "Multiply by" },
  },
  value: {
    label: "Value",
    help: "A name can be skill (this skill), level, a stat, a skill's ID or a stat table.",
    shapes: ["A number", "A dice roll, like 2 + random(6)", "A name"],
  },
};

/** The words of one way a skill rises (by default, for every skill). */
const source = (label: string, help: string, xp: boolean): FieldWords => ({
  label,
  help,
  shapes: xp ? ["Earns XP", "Turned off"] : ["Can go up", "Turned off"],
});

const SOURCES: readonly (readonly [string, string, string])[] = [
  ["kill", "Killing a monster", "With a weapon that uses the skill."],
  ["shot", "Shooting arrows", "Trains archery (and martial arts, with a crossbow)."],
  ["defend", "Being attacked", "Trains parry and block."],
  ["cast", "Casting spells", "Trains magery and the spell's own skill."],
  ["gather", "Gathering", "At a gathering spot that uses the skill, and fishing."],
  ["craft", "Crafting", "Making an item with the skill."],
  ["hit", "Landing a hit", "Each hit that does damage with a weapon that uses the skill."],
];

export const classesWords: WordBook = {
  // Classes (issue #15): About, What it gives, Ways in.
  "classes.code": {
    label: "Class number",
    help: "The number characters are saved with. Can't change once saved.",
    tab: "About",
  },
  "classes.name": { label: "Name", tab: "About" },
  "classes.description": {
    label: "Description",
    help: "What players read about the class in their Class window. Giving any class a description (or a way in) turns the Class window on for players.",
    long: true,
    tab: "About",
  },
  "classes.icon": {
    label: "Picture",
    help: "An item whose picture is shown beside the class in the Class window.",
    names: "item",
    tab: "About",
  },
  "classes.inherits": {
    label: "Starts from class",
    help: "The class (by number) whose stat bonus, perks and training this one starts from. Whatever this class sets replaces that one's, kind by kind. Leave off to set everything here.",
    names: "class",
    tab: "What it gives",
  },
  "classes.statBonus": {
    label: "Stat bonus",
    help: "Points added to a character's stats while in this class.",
    tab: "What it gives",
  },
  "classes.perks": {
    label: "Perks",
    help: "Bonuses while in the class. Combat perks add to the faction's of the same kind.",
    noun: "perk",
    tab: "What it gives",
  },
  "classes.perks.[].kind": {
    label: "Perk",
    choices: {
      spellPower: "Spell power",
      melee: "Melee attack power",
      defence: "Defence (taken off damage)",
      regeneration: "Faster HP and SP (frames sooner)",
      pvpParry: "Parry players (lower rolls parry more)",
      pvpBlock: "Block players (lower rolls block more)",
      monsterDodge: "Dodge monsters (lower rolls dodge more)",
      hpPerLevel: "Full HP gained each level",
      spPerLevel: "Full SP gained each level",
    },
  },
  "classes.perks.[].value": {
    label: "Amount",
    help: "Use a minus number to take away. HP and SP each level replace the Balance page's.",
  },
  "classes.training": {
    label: "How skills train",
    help: "How high and how fast skills rise while in the class. A faction the character is in can only lower these limits.",
    tab: "What it gives",
  },
  "classes.training.cap": {
    label: "Highest any skill rises to",
    help: "Leave off for the usual limits (the faction's, as in 1.6).",
  },
  "classes.training.percent": {
    label: "Training speed (%)",
    help: "100 is normal, 200 twice as fast, 50 half as fast, 0 never.",
  },
  "classes.training.skills": {
    label: "Single skills",
    help: "A skill's own limit or speed, over the class-wide ones.",
    noun: "skill",
  },
  "classes.training.skills.[].skill": { label: "Skill", names: "skill" },
  "classes.training.skills.[].cap": { label: "Rises to at most" },
  "classes.training.skills.[].percent": { label: "Speed (%)" },
  "classes.paths": {
    label: "Ways in",
    help: "How characters change into this class: from which classes, what they need, what it costs and what it gives.",
    noun: "way in",
    tab: "Ways in",
  },
  "classes.paths.[].from": {
    label: "From classes",
    help: "The classes (by number) a character must be in. A way back to an earlier class is a respec.",
    noun: "class",
    names: "class",
  },
  "classes.paths.[].where": {
    label: "Where",
    help: "At a trainer: an NPC whose Talk & Shops tab promotes players to this class (its price is charged too). In the Class window: players change from their Game menu.",
    choices: { trainer: "At a trainer", anywhere: "In the Class window", both: "Either" },
  },
  "classes.paths.[].requires": {
    label: "Needs",
    help: "Every one must be met.",
    noun: "requirement",
  },
  "classes.paths.[].requires.[].needs": {
    label: "Skill or stat",
    help: 'A skill, or "level", "HPmax" (full HP) or "SPmax" (full SP).',
    names: "skill",
  },
  "classes.paths.[].requires.[].atLeast": { label: "At least" },
  "classes.paths.[].gold": { label: "Gold it costs" },
  "classes.paths.[].items": {
    label: "Items it takes",
    help: "Taken from the bag, unless kept (then only needed).",
    noun: "item",
  },
  "classes.paths.[].items.[].item": { label: "Item", names: "item" },
  "classes.paths.[].items.[].qty": { label: "How many" },
  "classes.paths.[].items.[].keep": { label: "Kept (only needed)" },
  "classes.paths.[].grants": { label: "Gives" },
  "classes.paths.[].grants.skills": {
    label: "Skills raised",
    help: "Each raised to at least this; a higher skill keeps its value.",
    noun: "skill",
  },
  "classes.paths.[].grants.skills.[].skill": { label: "Skill", names: "skill" },
  "classes.paths.[].grants.skills.[].to": { label: "Raised to" },
  "classes.paths.[].grants.items": { label: "Items", noun: "item" },
  "classes.paths.[].grants.items.[].item": { label: "Item", names: "item" },
  "classes.paths.[].grants.items.[].qty": { label: "How many" },
  "classes.paths.[].grants.spells": {
    label: "Spells",
    help: "Added to the spellbook.",
    noun: "spell",
    names: "spell",
  },
  "classes.paths.[].grants.hpMax": { label: "Full HP raised to" },
  "classes.paths.[].grants.spMax": { label: "Full SP raised to" },
  "classes.paths.[].text": {
    label: "Note for players",
    help: "Shown with this way in the Class window.",
    long: true,
  },
  "classes.statBonus.str": { label: "Strength" },
  "classes.statBonus.sta": { label: "Stamina" },
  "classes.statBonus.dex": { label: "Dexterity" },
  "classes.statBonus.int": { label: "Intelligence" },
  "classes.statBonus.wis": { label: "Wisdom" },
  "classes.promotion": {
    label: "1.6 promotion",
    help: "1.6's way into this class, as the Classic classes have it: from a trainer, one requirement, skills raised to a roll of 1 to 10. Use Ways in for anything more.",
    tab: "Ways in",
  },
  "classes.promotion.from": {
    label: "From classes",
    help: "The class names a player must be in to change to this one.",
    noun: "class",
  },
  "classes.promotion.requirement": { label: "Needs" },
  "classes.promotion.requirement.stat": {
    label: "Skill or stat",
    names: "skill",
  },
  "classes.promotion.requirement.min": { label: "At least" },
  "classes.promotion.statChanges": {
    label: "Raises SP",
    help: "The character's full SP rises to at least this.",
    noun: "change",
  },
  "classes.promotion.statChanges.[].stat": { hidden: true },
  "classes.promotion.statChanges.[].atLeast": { label: "Full SP at least" },
  "classes.promotion.skillGrants": {
    label: "Skills it gives",
    help: "Each one below a roll of 1 to 10 is raised to it.",
    noun: "skill",
    names: "skill",
  },

  // Start classes: what the creation screen offers.
  "startClasses.code": {
    label: "Class number",
    help: "The class a new character starts in.",
    names: "class",
  },
  "startClasses.label": {
    label: "Name on the creation screen",
    help: "Leave off to use the class's name.",
  },
  "startClasses.skills": {
    label: "Starting skills",
    help: "Each skill's starting value, 0 to 100. Others start at 1; 0 never rises.",
    noun: "skill",
    names: "skill",
  },
  "startClasses.skills.{}": { label: "Starting value" },
  "startClasses.kit": {
    label: "Starting kit",
    help: "Items a new character of this class gets, after every character's starting bag (New characters).",
    noun: "item",
  },
  "startClasses.kit.[].item": { label: "Item", names: "item" },
  "startClasses.kit.[].qty": { label: "How many" },

  // Character creation.
  creation: { label: "Character creation" },
  "creation.sexes": {
    label: "Sexes",
    help: "The choices on the creation screen, in its order.",
    noun: "sex",
  },
  "creation.sexes.[].code": {
    label: "Number",
    help: "The number characters are saved with.",
    more: true,
  },
  "creation.sexes.[].label": { label: "Name" },
  "creation.sexes.[].heads": {
    label: "Heads",
    help: "The head pictures it can pick, in the order the arrows step through them.",
    noun: "head",
  },
  "creation.sexes.[].heads.[]": { label: "Head number" },
  // 1.6 notes kept with the data (how 1.6 did it): the game reads none of them, so they are kept
  // as they are and not shown.
  "creation.statBudget": { hidden: true },
  "creation.startingVitals": { hidden: true },
  "creation.startingMap": { hidden: true },
  "creation.nameRules": { hidden: true },
  "creation.otherFields": { label: "New characters start with" },
  "creation.otherFields.gold": { label: "Gold" },
  "creation.otherFields.faction": { hidden: true },
  "creation.otherFields.profile": {
    label: "Profile text",
    help: "The text a new character's profile starts with.",
    long: true,
  },
  "creation.otherFields.hunger": {
    label: "Hunger",
    help: "A new character's hunger. At most the Game Rules page's \"Most hunger can be\": a higher value starts at that.",
  },
  // An old 1.6 counter saved with each new character, which nothing in play reads.
  "creation.otherFields.breakCount": { hidden: true },

  // Weapon skills: what a weapon trains.
  skillGain: { label: "Weapon skills" },
  "skillGain.weaponSkills": {
    label: "Skills each weapon trains",
    help: "The skills a weapon trains on a kill or a hit. The last matching row wins.",
    noun: "weapon",
  },
  "skillGain.weaponSkills.[].weapon": {
    label: "Weapon name",
    help: 'The weapon\'s name, or part of it. "NOTHING" means empty hands.',
    names: "item",
  },
  "skillGain.weaponSkills.[].skills": {
    label: "Skills it trains",
    noun: "skill",
    names: "skill",
  },

  // Progression: how skills rise.
  progression: {
    label: "How skills go up",
    help: "The world's settings for how every skill rises; each skill can change them.",
  },
  "progression.line": {
    label: "Message when a skill goes up",
    help: "{skill} is replaced by the skill's name.",
  },
  "progression.tables": {
    label: "Stat tables",
    help: "Named numbers worked out from a stat, for formulas to use.",
    noun: "table",
  },
  "progression.tables.{}.stat": {
    label: "Worked out from",
    choices: {
      strength: "Strength",
      stamina: "Stamina",
      intelligence: "Intelligence",
      wisdom: "Wisdom",
      dexterity: "Dexterity",
      level: "Level",
    },
  },
  "progression.tables.{}.start": { label: "Starts at" },
  "progression.tables.{}.tiers": {
    label: "Steps",
    help: "Each step the stat is above adds its amount.",
    noun: "step",
  },
  "progression.tables.{}.tiers.[].above": { label: "When the stat is above" },
  "progression.tables.{}.tiers.[].add": { label: "Add", help: "Use a minus number to take away." },
  "progression.curves": {
    label: "Level curves",
    help: "How much XP each level takes, for skills that earn XP.",
    noun: "curve",
  },
  "progression.curves.{}.counting": {
    label: "XP counted",
    choices: { perLevel: "From one level to the next", total: "In total, from level 0" },
  },
  "progression.curves.{}.table": {
    label: "XP for the first levels",
    help: "One number per level, in order.",
    noun: "level",
  },
  "progression.curves.{}.table.[]": { label: "XP" },
  "progression.curves.{}.formula": {
    label: "XP for later levels",
    help: "Used after the list runs out. Its steps can read level.",
    shapes: ["A number", "Steps"],
  },
  "progression.curves.{}.growth": {
    label: "Growth",
    help: "In place of steps: (start + per level × level to the power) × (1 + growth%) to the power level.",
  },
  "progression.curves.{}.growth.start": { label: "Start" },
  "progression.curves.{}.growth.perLevel": { label: "Per level" },
  "progression.curves.{}.growth.exponent": { label: "Power" },
  "progression.curves.{}.growth.growthPercent": { label: "Growth %" },
  "progression.curves.{}.cap": { label: "Highest level" },
  "progression.defaults": {
    label: "Defaults",
    help: "What every skill uses unless it sets its own.",
  },
  "progression.defaults.chance": {
    label: "Skills that go up by chance",
    help: "Each time, a 1 in a number chance to go up by one.",
  },
  "progression.defaults.xp": {
    label: "Skills that earn XP",
    help: "Each time, the skill earns XP toward its next level.",
  },
  ...Object.fromEntries(
    SOURCES.flatMap(([id, label, help]) => [
      [`progression.defaults.chance.${id}`, source(label, help, false)],
      [`progression.defaults.xp.${id}`, source(label, help, true)],
    ]),
  ),
  "progression.*.roll": {
    label: "Chance to go up: 1 in…",
    help: "A bigger number is slower. Starting from skill makes it harder as it rises.",
    shapes: ["A number", "Steps"],
  },
  "progression.*.xp": {
    label: "XP earned each time",
    shapes: ["A number", "Steps"],
  },
  "progression.*.cap": {
    label: "Stops going up at",
    shapes: ["The faction limit", "The mage limit", "A fixed number"],
  },
  "progression.*.requires": {
    label: "Needs another skill",
    help: "Only goes up while another skill is above a value.",
  },
  "progression.*.monsterCap": { label: "Also stops at the killed monster's skill limit" },
  "progression.*.min": {
    label: "Can go up from",
    help: "The lowest value that still goes up. Off: 0.",
  },
  ...Object.fromEntries(Object.entries(formula).map(([k, w]) => [`progression.*.${k}`, w])),
};
