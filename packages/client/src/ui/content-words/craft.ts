/** Plain words for the `craft` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

/** A crafting timer: its default and the skill rows that shorten it. */
const timer = (station: string): WordBook => ({
  [`stations.${station}.timer`]: {
    label: "How long it takes",
    help: "In frames (20 frames is a second). The last row the skill is above wins.",
  },
  [`stations.${station}.timer.default`]: { label: "Normally (frames)" },
  [`stations.${station}.timer.rows`]: { label: "By skill", noun: "row" },
  [`stations.${station}.timer.rows.[].gt`]: { label: "Skill above" },
  [`stations.${station}.timer.rows.[].value`]: { label: "Takes (frames)" },
});

const XP = {
  label: "Skill XP",
  help: "Leave off to give the skill's usual crafting XP.",
  more: true,
};

/** A recipe's skill or level requirement (a level per recipe). */
const requires = (at: string, verb: string): WordBook => ({
  [`${at}.requires`]: {
    label: "Skill needed",
    help: `A skill (or the character level) players need before they can ${verb} it. Leave off for none.`,
  },
  [`${at}.requires.needs`]: {
    label: "Skill",
    help: 'A skill, "level" for the character level, or "class" for a class (pick the classes below).',
    names: "skill",
  },
  [`${at}.requires.atLeast`]: { label: "At least" },
  [`${at}.requires.classes`]: {
    label: "Classes",
    help: 'For "class": the class numbers that may. Others are refused.',
    noun: "class",
    names: "class",
  },
  [`${at}.requires.text`]: {
    label: "Refusal message",
    help: `Said instead of “You need <skill> <number> to ${verb} this.”`,
    more: true,
  },
});

/** A recipe's own chance of success by skill level, in place of the shared failure table. */
const odds = (at: string): WordBook => ({
  [`${at}.odds`]: {
    label: "Chance of success by skill",
    help: "Its own chance at a few skill levels, in percent, in place of the shared failure table: it rises in a straight line between two levels and stays the same past the ends (100 at a level: it never fails from there). Leave off to use the shared table.",
    noun: "level",
  },
  [`${at}.odds.[].level`]: { label: "At skill" },
  [`${at}.odds.[].percent`]: { label: "Chance %" },
});

/** An item and how many of it, at `at`. */
const amount = (at: string, label: string, help: string, tab: string): WordBook => ({
  [at]: { label, help, tab },
  [`${at}.item`]: { label: "Item", names: "item" },
  [`${at}.qty`]: { label: "How many" },
});

/** A list of items with how many of each, at `at`. */
const amounts = (at: string, label: string, help: string, tab: string, more = false): WordBook => ({
  [at]: { label, help, noun: "item", tab, more },
  [`${at}.[].item`]: { label: "Item", names: "item" },
  [`${at}.[].qty`]: { label: "How many" },
});

/** The words of recipe stations and recipes (issue #45). */
const recipeWords: WordBook = {
  // ---- recipe stations ----
  "recipeStations.name": {
    label: "Name",
    help: "The crafting window's title; each recipe names the station it is made at.",
  },
  "recipeStations.at": {
    label: "Stand at",
    help: "The station items players face and press Ctrl at to open the window (an Anvil, a Furnace).",
    noun: "station item",
    names: "item",
  },
  "recipeStations.at.[]": { names: "item" },
  "recipeStations.opens": {
    label: "Or use from the bag",
    help: "Bag items whose Use opens the window anywhere (a Knife for fletching). Give a station item, a bag item, or both.",
    noun: "item",
    names: "item",
  },
  "recipeStations.opens.[]": { names: "item" },
  "recipeStations.tools": {
    label: "Tools",
    help: "The tools it takes, held or in the bag, each with a tier: the best one the player has counts. Leave off for a station that needs no tool.",
    noun: "tool",
  },
  "recipeStations.tools.[].item": { label: "Tool", names: "item" },
  "recipeStations.tools.[].tier": {
    label: "Tier",
    help: "Higher is better: a Bronze Hammer 1, a Steel Hammer 2.",
  },
  "recipeStations.aboveLevel": {
    label: "Recipes above the player's level",
    help: "Left out of the window, or shown with a lock and the level they need. A recipe can choose for itself.",
    choices: { hide: "Hidden", show: "Shown locked" },
  },

  // ---- recipes ----
  "recipes.name": {
    label: "Recipe name",
    help: "Unique; the window lists it by this name (Bronze Dagger).",
    tab: "Recipe",
  },
  "recipes.station": {
    label: "Made at",
    help: "The recipe station it is made at.",
    names: "recipeStation",
    tab: "Recipe",
  },
  "recipes.category": {
    label: "Group",
    help: "The heading it is listed under in the window (Daggers, Bars).",
    tab: "Recipe",
  },
  "recipes.aboveLevel": {
    label: "Above the player's level",
    help: "Hidden or shown locked, in place of the station's choice.",
    choices: { hide: "Hidden", show: "Shown locked" },
    tab: "Recipe",
    more: true,
  },
  "recipes.book": {
    label: "Learned from",
    help: "A recipe book players must use before they can make it (give it as a quest reward to teach it by a quest). Leave off for a recipe everyone knows.",
    names: "item",
    tab: "Recipe",
    more: true,
  },
  ...amounts("recipes.materials", "Materials", "What one craft uses up.", "Materials"),
  ...amounts(
    "recipes.keeps",
    "Also needs (not used up)",
    "Items one craft needs in the bag but keeps (a mould).",
    "Materials",
  ),
  "recipes.tier": {
    label: "Lowest tool tier",
    help: "The station's tools below this tier can't make it. Leave off for any of them.",
    tab: "Tool",
  },
  "recipes.tierBonus": {
    label: "Odds bonus per tier",
    help: "Percentage points added to the chance for each tier the tool is above the lowest. Needs the chance by skill.",
    tab: "Tool",
  },
  "recipes.tierSpeed": {
    label: "Quicker per tier (%)",
    help: "Each tier the tool is above the lowest makes one craft this much quicker (90% at most).",
    tab: "Tool",
  },
  "recipes.classes": {
    label: "Only these classes",
    help: "Class numbers: only characters in one of them see and make it. Leave off for every class.",
    noun: "class",
    names: "class",
    tab: "Skill",
    more: true,
  },
  "recipes.skill": {
    label: "Skill",
    help: "The skill it needs and trains.",
    names: "skill",
    tab: "Skill",
  },
  "recipes.level": { label: "Level needed", tab: "Skill" },
  "recipes.xp": {
    label: "Skill XP",
    help: "For a skill that levels by XP: the XP each success gives. Leave off for the skill's usual crafting XP.",
    tab: "Skill",
  },
  "recipes.odds": {
    label: "Chance of success by skill",
    help: "The chance at a few skill levels, in percent: it rises in a straight line between two levels and stays the same past the ends (100 at a level: it never fails from there). Leave off for a recipe that never fails.",
    noun: "level",
    tab: "Odds",
  },
  "recipes.odds.[].level": { label: "At skill" },
  "recipes.odds.[].percent": { label: "Chance %" },
  "recipes.time": {
    label: "How long one craft takes",
    help: "In frames (20 frames is a second), at a few skill levels: in a straight line between two. One row for a time that never changes.",
    noun: "level",
    tab: "Odds",
  },
  "recipes.time.[].level": { label: "At skill" },
  "recipes.time.[].frames": { label: "Frames" },
  ...amount("recipes.output", "Makes", "What one successful craft makes.", "Output"),
  ...amount(
    "recipes.failure",
    "A failure makes",
    "What a failed craft makes instead (a burned fish). Leave off for a failure that makes nothing.",
    "Output",
  ),
};

/** The words of the masterworks every craft shares. */
const masterworkWords: WordBook = {
  "masterworks.item": {
    label: "Item",
    help: "The item a craft makes: whenever any craft (a recipe, cooking, a brew, a build or a repair) makes it, it may come out as a masterwork instead. A repair the Classic smithing table has masterworks for keeps that table's roll.",
    names: "item",
  },
  "masterworks.odds": {
    label: "Chance by skill",
    help: "The chance a successful craft comes out a masterwork, at a few levels of the crafting skill, in percent: in a straight line between two levels and the same past the ends.",
    noun: "level",
  },
  "masterworks.odds.[].level": { label: "At skill" },
  "masterworks.odds.[].percent": { label: "Chance %" },
  "masterworks.results": {
    label: "Masterworks",
    help: "What it can come out as, each picked by its weight (weight 3 comes up three times as often as weight 1). Name each after the item with a +N ending (Leather Armor +1): it keeps the item's abilities and adds N to its armour or attack.",
    noun: "masterwork",
  },
  "masterworks.results.[].item": { label: "Masterwork", names: "item" },
  "masterworks.results.[].weight": { label: "Weight" },
};

export const craftWords: WordBook = {
  ...recipeWords,
  ...masterworkWords,
  // ---- all stations ----
  "stations.frameOrder": { label: "Crafting order", more: true },
  "stations.frameOrder.order": {
    label: "Order crafts finish in",
    help: "When several finish at the same moment.",
    hidden: true,
  },
  "stations.frameOrder.smithFxChance": {
    label: "Anvil sparks: 1 in",
    help: "How often smithing shows sparks each frame.",
  },
  "stations.failure": {
    label: "Chance of failing",
    help: "For cooking, alchemy and carpentry: fails 1 time in this many. The last row that fits wins. A recipe with its own chance of success uses that instead.",
  },
  "stations.failure.rows": { label: "By skill", noun: "row" },
  "stations.failure.rows.[]": { shapes: ["Skill above", "Skill below"] },
  "stations.failure.rows.[].gt": { label: "Skill above" },
  "stations.failure.rows.[].lt": { label: "Skill below" },
  "stations.failure.rows.[].value": { label: "Fails 1 time in" },

  // ---- smithing ----
  "stations.smith": { label: "Smithing", help: "Repairing damaged armour at an anvil." },
  "stations.smith.station": {
    label: "Station",
    help: "What players stand in front of.",
    names: "item",
  },
  "stations.smith.tool": {
    label: "Tool",
    help: "Held in the left hand.",
    names: "item",
  },
  "stations.smith.maxOccupied": {
    label: "Bag slots allowed in use",
    help: "Players with more full slots are told their bag is too crowded.",
    more: true,
  },
  ...timer("smith"),
  "stations.smith.chunkDefault": {
    label: "Usual chunk needed",
    help: "The chunk a repair uses unless listed below.",
    names: "item",
  },
  "stations.smith.chunks": {
    label: "Other chunks",
    help: "Damaged items that need a different chunk.",
    noun: "chunk",
  },
  "stations.smith.chunks.[].item": { label: "Damaged item", names: "item" },
  "stations.smith.chunks.[].chunk": { label: "Chunk needed", names: "item" },
  "stations.smith.repairs": { label: "Repairs", noun: "repair" },
  "stations.smith.repairs.[].input": { label: "Damaged item", names: "item" },
  "stations.smith.repairs.[].output": { label: "Repaired item", names: "item" },
  "stations.smith.repairs.[].xp": XP,
  ...requires("stations.smith.repairs.[]", "repair"),
  "stations.smith.masterworkPool": {
    label: "Masterwork roll",
    help: "A repair rolls 1 to this number; low rolls can make a better item. The last row the skill is above wins.",
  },
  "stations.smith.masterworkPool.default": { label: "Normally 1 to" },
  "stations.smith.masterworkPool.rows": { label: "By skill", noun: "row" },
  "stations.smith.masterworkPool.rows.[].gt": { label: "Skill above" },
  "stations.smith.masterworkPool.rows.[].value": { label: "Roll 1 to" },
  "stations.smith.masterwork": {
    label: "Masterworks",
    help: "Better items a lucky repair can make.",
    noun: "masterwork",
  },
  "stations.smith.masterwork.[].item": { label: "Repaired item", names: "item" },
  "stations.smith.masterwork.[].outcomes": { label: "Lucky rolls", noun: "roll" },
  "stations.smith.masterwork.[].outcomes.[].roll": { label: "On a roll of" },
  "stations.smith.masterwork.[].outcomes.[].result": { label: "Makes", names: "item" },

  // ---- cooking ----
  "stations.cook": { label: "Cooking" },
  "stations.cook.stations": {
    label: "Stations",
    help: "What players can cook in front of.",
    noun: "station",
    names: "item",
  },
  "stations.cook.stations.[]": { label: "Station", names: "item" },
  "stations.cook.doubles": {
    label: "Slow station",
    help: "Cooking here takes twice as long.",
    names: "item",
  },
  "stations.cook.minSkill": { label: "Cooking skill needed" },
  ...timer("cook"),
  "stations.cook.recipes": {
    label: "Recipes",
    help: "An item with no recipe can't be cooked.",
    noun: "recipe",
  },
  "stations.cook.recipes.[].input": { label: "Raw item", names: "item" },
  "stations.cook.recipes.[].output": { label: "Cooked item", names: "item" },
  "stations.cook.recipes.[].burned": { label: "When burned", names: "item" },
  "stations.cook.recipes.[].xp": XP,
  ...requires("stations.cook.recipes.[]", "cook"),
  ...odds("stations.cook.recipes.[]"),

  // ---- alchemy ----
  "stations.mix": { label: "Alchemy", help: "Making potions at an alchemy lab." },
  "stations.mix.station": { label: "Station", names: "item" },
  ...timer("mix"),
  "stations.mix.sands": {
    label: "Potions",
    help: "The sand is held in the right hand and never used up.",
    noun: "potion",
  },
  "stations.mix.sands.[].sand": { label: "Sand held", names: "item" },
  "stations.mix.sands.[].potion": { label: "Potion made", names: "item" },
  "stations.mix.sands.[].crystal": { label: "Crystal used up", names: "item" },
  "stations.mix.sands.[].need": { label: "Message without the crystal", long: true },
  "stations.mix.sands.[].xp": XP,
  ...requires("stations.mix.sands.[]", "brew"),
  ...odds("stations.mix.sands.[]"),

  // ---- carpentry ----
  "stations.build": { label: "Carpentry" },
  "stations.build.station": { label: "Station", names: "item" },
  "stations.build.tool": { label: "Tool", help: "Held in the right hand.", names: "item" },
  "stations.build.minSkill": { label: "Carpentry skill needed" },
  ...timer("build"),
  "stations.build.recipes": {
    label: "Set recipes",
    help: "Building with one of these items makes exactly what its recipe says, in place of a roll from the bands below (Oak Logs make an Oak Shortbow). Items with no recipe roll the bands.",
    noun: "recipe",
  },
  "stations.build.recipes.[].input": { label: "Built from", names: "item" },
  "stations.build.recipes.[].output": { label: "Makes", names: "item" },
  "stations.build.recipes.[].xp": XP,
  ...requires("stations.build.recipes.[]", "build"),
  ...odds("stations.build.recipes.[]"),
  "stations.build.bands": {
    label: "What gets made",
    help: "By skill: the last band the skill is below wins.",
    noun: "band",
  },
  "stations.build.bands.[].lt": { label: "Skill below" },
  "stations.build.bands.[].pool": {
    label: "Roll 1 to",
    help: "Leave off to always make the first item.",
  },
  "stations.build.bands.[].results": { label: "Results", noun: "result" },
  "stations.build.bands.[].results.[].roll": { label: "On a roll of" },
  "stations.build.bands.[].results.[].item": { label: "Makes", names: "item" },
  "stations.build.bands.[].results.[].id": {
    label: "Can hold items",
    help: "Gets its own storage number, like a crate.",
  },
  "stations.build.bands.[].results.[].xp": XP,

  // ---- pause before starting ----
  "stations.startPause": {
    label: "Pause before starting (frames)",
    help: "20 frames is a second.",
    more: true,
  },
  "stations.startPause.Smith": { label: "Smithing" },
  "stations.startPause.Cook": { label: "Cooking" },
  "stations.startPause.Mix": { label: "Alchemy" },
  "stations.startPause.Build": { label: "Carpentry" },

  // ---- cauldron ----
  "stations.cauldron": { label: "Cauldron", help: "Two items dropped in make a new one." },
  "stations.cauldron.match": {
    label: "Cauldron name",
    help: "Any item whose name contains this is a cauldron.",
    more: true,
  },
  "stations.cauldron.capacity": { label: "Items it holds" },
  "stations.cauldron.recipes": {
    label: "Recipes",
    help: "The first that matches wins.",
    noun: "recipe",
  },
  "stations.cauldron.recipes.[].requires": { label: "Ingredients" },
  "stations.cauldron.recipes.[].requires.0": { label: "First", names: "item" },
  "stations.cauldron.recipes.[].requires.1": { label: "Second", names: "item" },
  "stations.cauldron.recipes.[].result": { label: "Makes", names: "item" },

  // ---- messages ----
  "stations.texts": {
    label: "Messages",
    help: "What players are told. {} is filled in with the item.",
    noun: "message",
  },
  "stations.texts.{}.text": { label: "Message", long: true },
};
