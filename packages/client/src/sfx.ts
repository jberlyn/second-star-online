import { fxRun } from "@secondstaronline/shared";

/**
 * Every sound SSO plays, with its 1.6 member and Director sound channel. A sound on a busy channel
 * cuts off the one playing there, as `puppetSound` did.
 */
export interface Sfx {
  /** Audio cast member, as the script writes it (lookup ignores case). */
  name: string;
  /** Director sound channel, 1-8. */
  ch: number;
  /**
   * `sound(ch).volume` set first, sound on or off: the church bell leaves channel 5 at 200
   * for the session (kept bug: 1.6 did the same).
   */
  volume?: number;
}

export const SOUND = {
  /** The four right-panel tabs. */
  tab: { name: "Clicksound", ch: 3 },
  /**
   * Every other button: the item menu, unequip, the amount dialog's drop, Load Character,
   * the login OK and Cancel and the creation Cancel.
   */
  click: { name: "Clicksound2", ch: 3 },
  /** New Character, the one UI click on channel 1. */
  newCharacter: { name: "Clicksound2", ch: 1 },
  /** A melee or arrow hit on a monster. */
  monsterHit: { name: "hitsound", ch: 2 },
  /** The hit that kills it. */
  monsterKill: { name: "fx", ch: 1 },
  /** A damage number carrying `hitsound` in item 6: PvP damage. */
  floatieHit: { name: "hitsound", ch: 5 },
  /** A slot win. */
  cash: { name: "cash", ch: 4 },
  /** A blackjack table reset. */
  cardShuffle: { name: "CardShuffle", ch: 1 },
  /** A card that fills a slot. */
  cardDeal: { name: "CardDeal", ch: 1 },
  /** A spell kill (twice in 1.6's script, heard once). */
  spellKill: { name: "fx", ch: 1 },
} as const satisfies Record<string, Sfx>;

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/**
 * A random roll from 1 through n. A sound's own roll is the client's, as each
 * 1.6 client rolled its own.
 */
const lingoRandom = (n: number) => 1 + Math.floor(Math.random() * n);
const has = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase());

/**
 * The spell-cast sounds, in source order, for the second field of the message. Every client on
 * the map plays them, the caster's own too. Spell runs read their `spells.json` row; non-spell
 * FX (Cannonball, Slot Machine, BSmith, Fishing) are handled here. Arrows, Bless, Haste,
 * Weaken, Poison Dart, Replenish, Holy Weapon and Identify are silent.
 */
export function spellSounds(name: string, random: (n: number) => number = lingoRandom): Sfx[] {
  const out: Sfx[] = [];
  // A slot pull's `random(4)` channel is drawn first, before the `random(2)` that
  // follows it in the chain (kept bug: 1.6 picked a random channel for slot machine sounds).
  const slotChannel = eq(name, "Slot Machine") ? random(4) : 0;
  // `random(2)` is drawn for every spell cast, whatever the spell; only BSmith uses it.
  const smithRoll = random(2);
  const on4 = (sound: string) => out.push({ name: sound, ch: 4 });
  const run = fxRun(name);
  if (run) {
    out.push(...run.sounds);
    return out;
  }
  if (has(name, "Cannonball")) {
    on4("cannonball");
  }
  if (eq(name, "Fishing")) {
    on4("splash");
  }
  // The Slot Machine's pull plays on a random channel 1-4, cutting off whatever was there.
  if (eq(name, "Slot Machine")) {
    out.push({ name: "SlotMachine", ch: slotChannel });
  }
  // A smith at work: every client, the smith's own too, plays Swordhit2 on a 1, else Swordhit1.
  if (eq(name, "BSmith")) {
    on4(smithRoll === 1 ? "Swordhit2" : "Swordhit1");
  }
  return out;
}

/** The swing (`swordswing` or `LaserSword`) plays on channel 3. */
export const SWING_CHANNEL = 3;
