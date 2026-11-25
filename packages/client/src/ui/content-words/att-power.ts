/** Plain words for the `attPower` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

const roll = {
  flat: { label: "Fixed damage" },
  randomN: { label: "Plus a roll of 1 to", help: "0 for no roll." },
};

export const attPowerWords: WordBook = {
  "attPower.handler": { hidden: true },
  "attPower.base": {
    label: "Weapon damage",
    help: "Each weapon's attack roll; when several rows match, the last one counts.",
    noun: "weapon",
  },
  "attPower.base.[].pattern": { label: "Weapon", names: "item" },
  "attPower.base.[].flat": roll.flat,
  "attPower.base.[].randomN": roll.randomN,
  "attPower.base.[].strengthHalf": {
    label: "Add half a Strength roll",
    help: "Also adds a roll of up to the wielder's Strength, halved.",
  },
  "attPower.exactOverrides": {
    label: "Damage overrides",
    help: "Replaces the roll above for one weapon by its exact name (Strength never adds).",
    noun: "override",
    more: true,
  },
  "attPower.exactOverrides.[].pattern": { label: "Weapon", names: "item" },
  "attPower.exactOverrides.[].flat": roll.flat,
  "attPower.exactOverrides.[].randomN": roll.randomN,
  "attPower.exactOverrides.[].strengthHalf": { label: "Add half a Strength roll", more: true },
  "attPower.arrowBonus": {
    label: "Arrow bonuses",
    help: "Extra damage from the arrows a bow shoots.",
    noun: "arrow bonus",
  },
  "attPower.arrowBonus.[].arrows": { label: "Arrows", names: "item" },
  "attPower.arrowBonus.[].match": { hidden: true },
  "attPower.arrowBonus.[].bonus": { label: "Extra damage" },
  "attPower.ringBonus": {
    label: "Ring bonuses",
    help: "Extra damage from a worn ring.",
    noun: "ring bonus",
  },
  "attPower.ringBonus.[].ring": { label: "Ring", names: "item" },
  "attPower.ringBonus.[].match": { hidden: true },
  "attPower.ringBonus.[].bonus": { label: "Extra damage" },
  "attPower.ringBonus.[].requiresBow": { label: "Only with a bow" },
  "attPower.skillBlocks": {
    label: "Skill bonuses",
    help: "Damage that grows with the wielder's skills, by weapon.",
    noun: "weapon's skill bonus",
  },
  "attPower.skillBlocks.[].weaponMatch": {
    label: "Which weapons",
    choices: {
      contains: "Any weapon whose name contains it",
      exact: "The weapon with exactly this name",
      any: "Every weapon",
    },
  },
  "attPower.skillBlocks.[].pattern": {
    label: "Weapon",
    help: "Leave off when it is for every weapon.",
    names: "item",
  },
  "attPower.skillBlocks.[].tiers": { label: "Steps", noun: "step" },
  "attPower.skillBlocks.[].tiers.[].subWeapon": {
    label: "Only for one weapon",
    help: "Applies this step only to the weapon with exactly this name.",
  },
  "attPower.skillBlocks.[].tiers.[].subWeapon.match": { hidden: true },
  "attPower.skillBlocks.[].tiers.[].subWeapon.pattern": { label: "Weapon", names: "item" },
  "attPower.skillBlocks.[].tiers.[].when": {
    label: "Only when",
    help: 'Conditions like "Archery > 29" (a skill, or level, above or below a number); all must hold.',
    noun: "condition",
  },
  "attPower.skillBlocks.[].tiers.[].when.[]": { label: "Condition" },
  "attPower.skillBlocks.[].tiers.[].op": {
    label: "What it does",
    choices: { set: "Sets the damage to", add: "Adds", subtract: "Takes off" },
  },
  "attPower.skillBlocks.[].tiers.[].value": {
    label: "Amount",
    shapes: ["A fixed number", "A roll"],
  },
  "attPower.skillBlocks.[].tiers.[].value.flat": roll.flat,
  "attPower.skillBlocks.[].tiers.[].value.randomN": roll.randomN,
};
