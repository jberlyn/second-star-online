/**
 * What the game makes of an item under the installed content, across every item rule table (the
 * item resolver's and the item definitions' round trips, issue #30): slot, Strength, menu, use with
 * its RNG draws, behaviours, armour, gear, attack power with its draws, weapon skills, breaking,
 * the paperdoll, swing cooldowns and sound, ground and container rules.
 */
import { classicData } from "@secondstaronline/data/classic";
import {
  armourRows,
  attackPower,
  blocksMonster,
  blocksPlayer,
  bookDex,
  checkEquip,
  content,
  ctrlGate,
  damagedForm,
  type Equipment,
  elementalRows,
  equipSlotFor,
  type Fighter,
  fixedInPlace,
  gearBonus,
  groundDrawOffset,
  groundLayer,
  groundOverlay,
  groundTipName,
  hasBehaviour,
  isUniqueContainer,
  itemRequirementRefusal,
  menuAction,
  NO_EQUIPMENT,
  NO_FACTION,
  normaliseLook,
  overlayWhenInUse,
  type Rng,
  rollArmourBreak,
  rollWeaponBreak,
  runBook,
  spellDefense,
  strengthRequirement,
  swingCooldowns,
  type Trainee,
  toolUses,
  useDeferred,
  useItem,
  weaponSkillList,
} from "@secondstaronline/shared";

import { swingSound } from "../../src/systems/combat/melee.ts";
import { containerCapacity } from "../../src/systems/economy/containers.ts";

function recorder(at: "low" | "high"): Rng & { draws: number[] } {
  const draws: number[] = [];
  return {
    draws,
    random(n: number) {
      draws.push(n);
      return at === "low" ? 1 : n;
    },
  };
}

const roll = (fn: (rng: Rng) => unknown): unknown => {
  const lo = recorder("low");
  const hi = recorder("high");
  return [fn(lo), fn(hi), lo.draws];
};

function fighter(v: number, equip: Partial<Equipment>): Fighter {
  return {
    level: Math.max(1, v),
    str: 16,
    sta: 10,
    int: 10,
    wis: 10,
    skills: Array(content().classes.skills.length).fill(v) as number[],
    equip: { ...NO_EQUIPMENT, ...equip },
    faction: NO_FACTION,
    attackBonus: 0,
    wanted: false,
  };
}

const zeroSkills = (): number[] => Array(content().classes.skills.length).fill(0) as number[];

const TRIGGERS = [...new Set(classicData.itemRules.armour.elemental.map((r) => r.trigger))];

const BEHAVIOURS = [...new Set(classicData.itemRules.behaviours.map((b) => b.behaviour))];
const POWERS = ["spell", "blackArts", "martialArts", "attack", "killXp"] as const;

/** What the game makes of `name` under the installed content. */
export function plays(name: string): Record<string, unknown> {
  const weaponOnly: Equipment = { ...NO_EQUIPMENT, weapon: name };
  const all: Equipment = {
    weapon: name,
    offHand: name,
    head: name,
    body: name,
    feet: name,
    ring: name,
  };
  return {
    slot: equipSlotFor(name),
    strength: strengthRequirement(name),
    menu: menuAction(name),
    deferred: useDeferred(name),
    damaged: damagedForm(name),
    behaviours: BEHAVIOURS.filter((b) => hasBehaviour(name, b)),
    gear: POWERS.map((p) => gearBonus(all, p)),
    armour: [armourRows(20, all, "HitMe"), armourRows(20, all, "HitMe2")],
    trains: weaponSkillList(name),
    requires: [1, 100].map((v) =>
      (["equip", "use"] as const).map((on) =>
        itemRequirementRefusal(name, on, {
          level: v,
          skills: Array(content().classes.skills.length).fill(v) as number[],
        }),
      ),
    ),
    look: normaliseLook(all),
    cooldowns: [swingCooldowns(all, zeroSkills()), swingCooldowns(weaponOnly, zeroSkills())],
    tip: [groundTipName(name), groundTipName(`${name}#12`)],
    equip: [false, true].map((wanted) =>
      checkEquip(name, {
        str: 30,
        wanted,
        equip: { ...NO_EQUIPMENT, weapon: name, offHand: name },
        level: 100,
        skills: Array(content().classes.skills.length).fill(100) as number[],
      }),
    ),
    tools: toolUses(name),
    sound: swingSound(name),
    capacity: containerCapacity(name),
    unique: isUniqueContainer(name),
    book: bookDex(name),
    reads: runBook(
      name,
      {
        level: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        skills: Array(content().classes.skills.length).fill(1) as number[],
      } as Trainee,
      [],
      { random: () => 1 },
    ),
    spellDefense: roll((rng) => spellDefense(20, { equip: all, magicShield: false }, rng)),
    elemental: TRIGGERS.flatMap((t) =>
      (["HitMe", "HitMe2"] as const).map((h) => elementalRows(20, all, h, t)),
    ),
    ground: [
      blocksPlayer(name, { level: 1, skills: zeroSkills() }),
      blocksMonster(name),
      fixedInPlace(name, true),
      groundLayer(name),
      groundDrawOffset(name),
      groundOverlay(name),
      overlayWhenInUse(name),
      ctrlGate(name, { str: 30, mine: false }),
    ],
    breaks: [
      rollWeaponBreak(weaponOnly, 10, 20000, "Troll", { random: () => 1 }),
      ...[1, 2, 3].map((k) => {
        let first = true;
        const rng: Rng = {
          random: () => {
            if (first) {
              first = false;
              return 1;
            }
            return k;
          },
        };
        return rollArmourBreak(all, 10, 20000, "a Troll", rng);
      }),
    ],
    use: roll((rng) => useItem(name, { hp: 5, hpMax: 50, sp: 5, spMax: 50, hunger: 20000 }, rng)),
    attack: [0, 31, 100].map((v) =>
      roll((rng) => attackPower(fighter(v, { weapon: name }), rng).power),
    ),
  };
}
