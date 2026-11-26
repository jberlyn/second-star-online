/** Plain words for the `events` dataset's forms (see content-words.ts): world counters (issue #3). */
import type { WordBook } from "../content-words.ts";

const classes = (help: string) => ({ label: "Classes", help, noun: "class", names: "class" });

export const eventsWords: WordBook = {
  "counters.name": {
    label: "Name",
    help: "What offerings and perks call it, and what /counter shows. Case does not matter.",
  },
  "counters.description": { label: "What it is for", long: true },
  "counters.start": {
    label: "Starts at",
    help: "Its value when the world first has it, and after /counter <name> reset.",
  },
  "counters.min": { label: "Lowest", help: "A change never takes it below this." },
  "counters.max": { label: "Highest", help: "A change never takes it above this." },
  "counters.drift": {
    label: "Drifts back",
    help: "Moves back on its own while the server runs. Leave off to keep every change.",
  },
  "counters.drift.everyMinutes": { label: "Every (minutes)" },
  "counters.drift.by": { label: "By" },
  "counters.drift.toward": {
    label: "Toward",
    help: "The value it drifts to. Leave empty for its starting value.",
  },
  "offerings.name": {
    label: "Name",
    help: "For this page only: players never see it.",
  },
  "offerings.item": {
    label: "Item dropped",
    help: "The item a player drops. The first offering naming both items runs.",
    names: "item",
  },
  "offerings.onto": {
    label: "Onto",
    help: "What the player faces as they drop it: an item placed with the World Editor or /drop. Players' own drops never count.",
    names: "item",
  },
  "offerings.classes": classes(
    "Only characters in these classes may (a class inheriting one counts). Leave off for everyone.",
  ),
  "offerings.classRefusal": {
    label: "Said to other classes",
    help: "Leave empty for “Nothing happens.”",
    more: true,
  },
  "offerings.checks": {
    label: "Checks",
    help: "Tested in order before anything happens. The first that fails says its refusal, and the item stays in the bag.",
    noun: "check",
  },
  "offerings.checks.[].counter": { label: "Counter" },
  "offerings.checks.[].atLeast": { label: "Must be at least" },
  "offerings.checks.[].atMost": { label: "Must be at most" },
  "offerings.checks.[].refusal": { label: "Refusal", long: true },
  "offerings.changes": {
    label: "Changes",
    help: "Each adds to a counter (a negative number takes away), stopping at its lowest and highest.",
    noun: "change",
  },
  "offerings.changes.[].counter": { label: "Counter" },
  "offerings.changes.[].add": { label: "Add" },
  "offerings.keepsItem": {
    label: "The item stays in the bag",
    help: "Off: one of the item is used up.",
  },
  "offerings.message": {
    label: "Said to the player",
    help: "{item} is the item, {onto} what it was dropped onto.",
    long: true,
  },
  "offerings.announce": {
    label: "Announcements",
    help: "Lines every online player in the classes sees (everyone when no class is picked).",
    noun: "announcement",
  },
  "offerings.announce.[].text": {
    label: "Text",
    help: "{player} is who made the offering, {item} the item, {onto} what it was dropped onto.",
    long: true,
  },
  "offerings.announce.[].classes": classes("Leave off for every player online."),
  "perks.name": { label: "Name", help: "For this page only: players never see it." },
  "perks.counter": { label: "Counter" },
  "perks.kind": {
    label: "Adds to",
    choices: { spellPower: "Spell power", melee: "Melee attack", defence: "Defence" },
  },
  "perks.classes": classes("Who gets it (a class inheriting one counts). Leave off for everyone."),
  "perks.from": {
    label: "From",
    help: "The counter's value where the perk is 0. Below it the perk takes away.",
  },
  "perks.every": { label: "For every", help: "How far the counter moves for one step." },
  "perks.value": { label: "Each step adds" },
  "perks.least": { label: "Never less than", more: true },
  "perks.most": { label: "Never more than", more: true },
};
