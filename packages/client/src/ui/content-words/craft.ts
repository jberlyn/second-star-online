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

export const craftWords: WordBook = {
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
    help: "For cooking, alchemy and carpentry: fails 1 time in this many. The last row that fits wins.",
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

  // ---- carpentry ----
  "stations.build": { label: "Carpentry" },
  "stations.build.station": { label: "Station", names: "item" },
  "stations.build.tool": { label: "Tool", help: "Held in the right hand.", names: "item" },
  "stations.build.minSkill": { label: "Carpentry skill needed" },
  ...timer("build"),
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
