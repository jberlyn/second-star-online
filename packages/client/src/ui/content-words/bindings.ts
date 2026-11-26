/** Plain words for the `bindings` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

/** A skill the game uses for a mechanic. */
const skill = (label: string, help: string) => ({ label, help, names: "skill" });

export const bindingsWords: WordBook = {
  currency: {
    label: "Money",
    help: "The item players carry in their purse and pay with.",
  },
  "currency.item": {
    label: "Money item",
    help: 'A pile of it on the ground shows its amount, like "15 Gold".',
    names: "item",
  },

  start: {
    label: "New characters",
    help: "What a new character starts with, besides its class's skills.",
  },
  "start.hp": { label: "HP", help: "Full hit points." },
  "start.sp": { label: "SP", help: "Full spell points." },
  "start.bag": {
    label: "Starting bag",
    help: "Items in the bag, in order. The bag holds 15.",
    noun: "item",
  },
  "start.bag.[].item": { label: "Item", names: "item" },
  "start.bag.[].qty": { label: "How many" },

  cannon: { label: "Cannons" },
  "cannon.ammo": {
    label: "Cannon ammo",
    help: "The item each cannon shot uses up. Off: cannons can't fire.",
    names: "item",
  },

  bodies: { label: "Spell bodies", help: "The looks some spells give a player." },
  "bodies.morph": {
    label: "Morph",
    help: "The body Morph gives, by the spell's roll: the last row the roll is above wins. Off: Morph does nothing.",
    noun: "row",
  },
  "bodies.morph.[].above": { label: "Roll above" },
  "bodies.morph.[].body": { label: "Body (picture number)" },
  "bodies.tree": {
    label: "Nature Shift tree",
    help: "The tree body Nature Shift gives. Off: Nature Shift does nothing.",
  },
  "bodies.smoke": {
    label: "Smoke Bomb body",
    help: "Drawn as nothing, so the player vanishes. Off: Smoke Bomb does nothing.",
  },

  skills: {
    label: "Which skill does what",
    help: "Which skill does each job. Off: that job is turned off.",
  },
  "skills.parry": skill("Parry", "Rolled to dodge melee hits."),
  "skills.block": skill("Block", "Rolled to dodge monster hits."),
  "skills.archery": skill("Archery", "Trained by shooting and bow kills."),
  "skills.martialArts": skill("Martial arts", "Trained by empty-handed kills."),
  "skills.staffFighting": skill("Staff fighting", "Adds to spell damage while holding a staff."),
  "skills.magery": skill("Magery", "Sets every spell's power, and trains on each cast."),
  "skills.fishing": skill("Fishing", "Decides what a player catches."),
  "skills.blacksmithing": skill("Blacksmithing", "The skill for smithing."),
  "skills.cooking": skill("Cooking", "The skill for cooking."),
  "skills.alchemy": skill("Alchemy", "The skill for alchemy."),
  "skills.carpentry": skill("Carpentry", "The skill for carpentry."),
};
