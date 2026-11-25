/** Plain words for the `spells` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

/** The words of a spell-power row (the base rows and each table's rows). */
const powerRow: WordBook = {
  when: {
    label: "Only when",
    help: 'Conditions like "Magery > 10" (a skill or level, then > or <, then a number). None: always.',
    noun: "condition",
  },
  op: {
    label: "Step",
    choices: { set: "Set to", add: "Add", subtract: "Subtract" },
  },
  value: {
    label: "Value",
    shapes: ["A number", "A dice roll"],
  },
};

export const spellsWords: WordBook = {
  // One spell.
  "spells.name": { label: "Name", help: "The spell's name in spellbooks and messages." },
  "spells.id": {
    label: "1.6 save number",
    help: "The number 1.6 saved spellbooks with. Not needed for new spells.",
    more: true,
  },
  "spells.effect": {
    label: "Works like",
    help: "The original spell whose effect this spell has.",
    names: "spell",
  },
  "spells.sp": {
    label: "SP cost",
    help: "Spell points one cast takes. Off or 0: it can't be cast.",
  },
  "spells.spByBody": {
    label: "SP cost in certain armour",
    help: "A different cost while wearing matching body armour. The last match wins.",
    noun: "armour rule",
  },
  "spells.spByBody.[].pattern": {
    label: "Armour name",
    help: "The body armour's name, or part of it.",
    names: "item",
  },
  "spells.spByBody.[].sp": { label: "SP cost while wearing it" },
  "spells.crystals": {
    label: "Needs crystals",
    help: "Crystals used up by each cast.",
  },
  "spells.crystals.colour": {
    label: "Crystal colour",
    help: "Blue, Red, Green, Yellow, Purple or White.",
  },
  "spells.crystals.count": { label: "How many" },
  "spells.harmful": {
    label: "Harmful",
    help: "Can't be cast on safe maps.",
  },
  "spells.book": {
    label: "Spellbook",
    help: "The book item that teaches this spell. Later spells in the list win a name both match.",
  },
  "spells.book.pattern": {
    label: "Book name",
    help: "The book item's name, or part of it.",
    names: "item",
  },
  "spells.info": {
    label: "Spellbook text",
    help: "What the spellbook says about the spell.",
    long: true,
  },
  "spells.summon": {
    label: "Summons a monster",
    help: "The monster this spell calls up.",
  },
  "spells.summon.monster": { label: "Monster", names: "monster" },
  "spells.summon.skilled": {
    label: "A better monster for skilled casters",
    help: "Summoned instead when the caster's skill is high enough.",
  },
  "spells.summon.skilled.skill": { label: "Skill", names: "skill" },
  "spells.summon.skilled.above": { label: "Skill above" },
  "spells.summon.skilled.monster": { label: "Monster", names: "monster" },
  "spells.school": {
    label: "Trains a skill",
    help: "The skill each cast trains, besides Magery.",
  },
  "spells.school.skill": { label: "Skill", names: "skill" },
  "spells.school.cap": {
    label: "Stops training at",
    help: "Leave off to use the caster's mage limit.",
  },
  "spells.power": {
    label: "Power table",
    help: "The extra power rows (from Spell power) this spell adds to the base power.",
  },
  "spells.lasts": {
    label: "Lasts (seconds)",
    help: "How long the new body lasts, for spells that change the caster's look. 65 if left off.",
  },
  "spells.amount": {
    label: "Own damage and healing",
    help: "Replaces the Balance page's amounts for this spell only.",
  },
  "spells.amount.monster": { label: "On a monster" },
  "spells.amount.monsterHealed": {
    label: "On a monster it heals",
    help: "For monsters this spell heals instead of hurting.",
  },
  "spells.amount.monsterUndead": {
    label: "On an undead monster",
    help: "Damage a healing spell does to the undead.",
  },
  "spells.amount.player": { label: "On a player" },
  "spells.creates": {
    label: "Food it can make",
    help: "One is picked at random on each cast.",
    noun: "food",
  },
  "spells.creates.[].item": { label: "Item", names: "item" },
  "spells.creates.[].article": {
    label: "Word before it",
    help: 'As in "an" for "an Apple". Leave off for "a".',
  },
  "spells.fx": {
    label: "Animations",
    help: "The pictures and sounds played when it is cast.",
    noun: "animation",
    more: true,
  },
  "spells.fx.[].member": {
    label: "Picture name",
    help: 'The animation\'s pictures, named "<this>-1", "<this>-2" and so on.',
  },
  "spells.fx.[].effect": {
    label: "Behaves like",
    help: "The original spell animation this one moves and hits like.",
  },
  "spells.fx.[].frames": { label: "Number of pictures" },
  "spells.fx.[].lastFrame": {
    label: "Hides after picture",
    help: "Leave off for a shot that keeps flying.",
  },
  "spells.fx.[].projectile": {
    label: "Flies across the screen",
    help: "For shots: which way it moves and how far each step.",
  },
  "spells.fx.[].projectile.axis": {
    label: "Direction",
    choices: { locH: "Left or right", locV: "Up or down" },
  },
  "spells.fx.[].projectile.px": {
    label: "Pixels per step",
    help: "Minus moves left or up.",
  },
  "spells.fx.[].sounds": { label: "Sounds", noun: "sound" },
  "spells.fx.[].sounds.[].name": { label: "Sound", names: "sound" },
  "spells.fx.[].sounds.[].ch": {
    label: "Sound channel",
    help: "1 to 8. A new sound on a channel stops the one playing there.",
  },

  // Spell power.
  power: {
    label: "Spell power",
    help: "How strong each cast is: every spell takes the base rows, then its own table's rows.",
  },
  "power.base": {
    label: "Base power",
    help: "Rows every spell takes, top to bottom, starting from 1.",
    noun: "row",
  },
  "power.tables": {
    label: "Power tables",
    help: "Extra rows a spell adds after the base power, picked by the spell's Power table.",
    noun: "table",
  },
  "power.tables.{}.tiers": { label: "Rows", noun: "row" },
  "power.tables.{}.gear": {
    label: "Adds worn gear's bonus",
    choices: { blackArts: "Black arts gear", martialArts: "Martial arts gear" },
  },
  ...Object.fromEntries(Object.entries(powerRow).map(([k, w]) => [`power.*.${k}`, w])),
};
