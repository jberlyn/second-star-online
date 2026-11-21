import { fxRun } from "@secondstaronline/shared";

/** Volume mixer categories in Player Settings → Sound. */
export type SoundCategory = "combat" | "spells" | "world";

/**
 * Every sound SSO plays, with its 1.6 member and Director sound channel. A sound on a busy channel
 * cuts off the one playing there, as `puppetSound` did.
 */
export interface Sfx {
  /** Audio cast member, as the script writes it (lookup ignores case). */
  name: string;
  /** Director sound channel, 1-8. */
  ch: number;
  /** This sound's own volume, 0-255 (the church bell's 200); the channel's is left alone. */
  volume?: number;
  /** Optional explicit mixer category (falls back to `soundCategory(s)`). */
  category?: SoundCategory;
}

const COMBAT_SOUNDS = new Set([
  "swordswing",
  "lasersword",
  "hitsound",
  "fx",
  "monsterdeath",
  "cannonball",
]);
const SPELL_SOUNDS = new Set([
  "crush",
  "fireballs",
  "firebolt",
  "fx2",
  "fx3",
  "heal1",
  "heal2",
  "lightning",
  "raindrop",
  "stone-skin",
  "whirlwind",
  "clear",
  "clear2",
  "land",
]);

/** Side-channel category overrides for shared audio samples (e.g. spell `fx` / Meteor `monsterdeath`). */
const sfxCategoryMap = new WeakMap<Sfx, SoundCategory>();

/** Maps any sound effect to its volume slider category: combat, spells or world. */
export function soundCategory(s: Pick<Sfx, "name" | "category">): SoundCategory {
  if (s.category) {
    return s.category;
  }
  const mapped = sfxCategoryMap.get(s as Sfx);
  if (mapped) {
    return mapped;
  }
  const n = s.name.toLowerCase();
  if (COMBAT_SOUNDS.has(n)) {
    return "combat";
  }
  if (SPELL_SOUNDS.has(n)) {
    return "spells";
  }
  return "world";
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
  /** A slot win, a shop purchase or a sale. */
  cash: { name: "cash", ch: 4 },
  /** A slot pull, on a channel nothing else uses. */
  slotMachine: { name: "SlotMachine", ch: 6 },
  /** A blackjack table reset. */
  cardShuffle: { name: "CardShuffle", ch: 1 },
  /** A card that fills a slot. */
  cardDeal: { name: "CardDeal", ch: 1 },
  /** A spell kill (twice in 1.6's script, heard once). */
  spellKill: { name: "fx", ch: 1 },
} as const satisfies Record<string, Sfx>;

// Spell kills share the `fx` sample with melee kills; route them through the Spells slider.
sfxCategoryMap.set(SOUND.spellKill, "spells");

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
  // `random(2)` is drawn for every spell cast, whatever the spell; only BSmith uses it.
  const smithRoll = random(2);
  const on4 = (sound: string) => out.push({ name: sound, ch: 4 });
  const run = fxRun(name);
  if (run) {
    for (const s of run.sounds) {
      const copy: Sfx = { ...s };
      sfxCategoryMap.set(copy, "spells");
      out.push(copy);
    }
    return out;
  }
  if (has(name, "Cannonball")) {
    on4("cannonball");
  }
  if (eq(name, "Fishing")) {
    on4("splash");
  }
  // The Slot Machine's pull has a channel of its own, so it cuts off nothing else (1.6 drew a
  // random channel 1-4 for it, cutting off a spell, a hit or the church bell).
  if (eq(name, "Slot Machine")) {
    out.push(SOUND.slotMachine);
  }
  // A smith at work: every client, the smith's own too, plays Swordhit2 on a 1, else Swordhit1.
  if (eq(name, "BSmith")) {
    on4(smithRoll === 1 ? "Swordhit2" : "Swordhit1");
  }
  return out;
}

/** The swing (`swordswing` or `LaserSword`) plays on channel 3. */
export const SWING_CHANNEL = 3;
