/**
 * Identify (an SSO addition, issue #17: 1.6 listed the spell but gave it no effect): what the
 * spell tells a player about the item on the ground where they cast it. Every line is worked out
 * from the rule tables the game plays by (item rules and attack power), so it says what the item
 * really does. Pure.
 */
import { content } from "../../content/store.ts";
import { damagedForm } from "../combat/armour.ts";
import { gearBonus } from "../combat/gear.ts";
import { type Equipment, NO_EQUIPMENT } from "../core/fighter.ts";
import { lingoEq } from "../core/lingo.ts";
import { excepted, ruleMatches } from "../core/patterns.ts";
import { requirementText } from "../core/requirements.ts";
import { behaviourName } from "../inventory/behaviours.ts";
import { equipSlotFor, strengthRequirement } from "../inventory/equip.ts";
import { displayName, EQUIP_FIELD, itemLabel } from "../inventory/inventory.ts";

type WornSlot = "Head" | "Body" | "LeftHand" | "RightHand" | "Feet" | "Ring";

/** Where each slot type is worn, as its line says it. */
const WORN_TEXT: Readonly<Record<WornSlot, string>> = {
  Head: "It is worn on the head.",
  Body: "It is worn on the body.",
  LeftHand: "It is wielded as a weapon.",
  RightHand: "It is held in the off hand.",
  Feet: "It is worn on the feet.",
  Ring: "It is worn as a ring.",
};

/** The `RingE`-style slot of each slot type, which the armour rows name. */
const SLOT_VAR: Readonly<Record<WornSlot, string>> = {
  Head: "HeadE",
  Body: "BodyE",
  LeftHand: "LeftHandE",
  RightHand: "RightHandE",
  Feet: "FeetE",
  Ring: "RingE",
};

/** What each gear power adds to, as its line says it. */
const GEAR_TEXT = {
  spell: "your spell power",
  blackArts: "your Black Arts spell power",
  martialArts: "your Martial Arts spell power",
  attack: "your attack power",
  killXp: "the experience each kill gives",
} as const;

/** The level after a masterwork's `+` (`Long Sword+2` is 2), or 0. */
function plusLevel(name: string): number {
  const i = name.indexOf("+");
  if (i < 0) {
    return 0;
  }
  const n = Number.parseInt(name.slice(i + 1).trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** "3" or "4 to 8": a roll of `flat + random(randomN)`. */
function range(flat: number, randomN: number): string {
  return randomN > 0 ? `${flat + 1} to ${flat + randomN}` : String(flat);
}

/** A weapon's strike: the attack power row its swing starts from, as `attackPower` picks it. */
function weaponLine(item: string): string | null {
  const ap = content().attPower.attPower;
  let row: (typeof ap.base)[number] | undefined;
  for (const r of ap.base) {
    if (ruleMatches(item, r)) {
      row = r;
    }
  }
  for (const r of ap.exactOverrides) {
    if (lingoEq(item, r.pattern) && !excepted(r, item)) {
      row = r;
    }
  }
  if (!row) {
    return null;
  }
  const strength = row.strengthHalf ? ", plus up to half your Strength" : "";
  return `It strikes for ${range(row.flat + plusLevel(item), row.randomN)}${strength}.`;
}

/** "takes 3 off" or "adds 2 to": an armour total's change to a hit. */
function hitChange(delta: number): string {
  return delta < 0 ? `takes ${-delta} off` : `adds ${delta} to`;
}

/** What the item does while worn in `slot`: armour, spell defense and gear. */
function wornLines(item: string, slot: WornSlot): string[] {
  const lines: string[] = [];
  const rules = content().itemRules;
  const slotVar = SLOT_VAR[slot];
  let vsMonsters = 0;
  let vsPlayers = 0;
  for (const r of rules.armour.rows) {
    if (r.slot === slotVar && ruleMatches(item, r)) {
      vsPlayers += r.hitMe;
      vsMonsters += r.hitMe2 ?? 0;
    }
  }
  // A masterwork's `+N` comes off every hit too, rings and weapons aside, as `armourRows` takes it.
  if (slot !== "Ring" && slot !== "LeftHand") {
    vsPlayers -= plusLevel(item);
    vsMonsters -= plusLevel(item);
  }
  if (vsMonsters !== 0) {
    lines.push(`It ${hitChange(vsMonsters)} each monster's hit on you.`);
  }
  if (vsPlayers !== 0) {
    lines.push(`It ${hitChange(vsPlayers)} each player's hit on you.`);
  }
  let spellDefense = 0;
  for (const r of rules.armour.spell.rows) {
    if (r.slot === slotVar && ruleMatches(item, r)) {
      spellDefense += r.delta;
    }
  }
  if (spellDefense !== 0) {
    lines.push(`It ${hitChange(spellDefense)} the damage spells do to you.`);
  }
  const worn: Equipment = { ...NO_EQUIPMENT, [EQUIP_FIELD[slot]]: item };
  for (const power of Object.keys(GEAR_TEXT) as (keyof typeof GEAR_TEXT)[]) {
    const add = gearBonus(worn, power);
    if (add > 0) {
      lines.push(`It adds ${add} to ${GEAR_TEXT[power]}.`);
    } else if (add < 0) {
      lines.push(`It takes ${-add} off ${GEAR_TEXT[power]}.`);
    }
  }
  return lines;
}

/**
 * Identify's lines for a stored item name ("Long Sword+2", "Crate#12"): a first line naming it,
 * then where it is worn, what a weapon strikes for, what it does while worn (armour, spell defense,
 * gear), the Strength and skills or level it needs, and whether it can break in battle. An item
 * with none of these says there is nothing more to learn.
 */
export function identifyLines(stored: string): string[] {
  const item = displayName(stored).trim();
  const facts: string[] = [];
  const slot = equipSlotFor(item);
  if (slot !== "No") {
    facts.push(WORN_TEXT[slot]);
    if (slot === "LeftHand") {
      const strike = weaponLine(item);
      if (strike) {
        facts.push(strike);
      }
    }
    facts.push(...wornLines(item, slot));
  }
  const strength = strengthRequirement(item);
  if (strength > 0) {
    facts.push(`It needs ${strength} Strength.`);
  }
  // As the requirement check reads them: without the `#id` or `+N` ending.
  const base = behaviourName(item);
  for (const r of content().itemRules.requires) {
    if (ruleMatches(base, r)) {
      facts.push(requirementText(r, r.on));
    }
  }
  if (slot !== "No" && damagedForm(item) !== item) {
    facts.push("It can break in battle.");
  }
  if (facts.length === 0) {
    facts.push("There is nothing more to learn about it.");
  }
  return [`You study the ${itemLabel(item)} closely...`, ...facts];
}
