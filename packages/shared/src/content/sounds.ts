/**
 * Sounds (issue #29, stage 7): which sounds the content and the engine play, who plays each, how
 * bulk files match them, and the draft rows a sound change writes.
 *
 * A sound is named by the name content plays it by ("fireballs", "stone skin"), case ignored, as
 * the client looks it up. An upload named like a pack's sound replaces it; taking the upload out
 * brings the pack's back. Everything here is pure.
 */
import type { ArtSound, ArtSoundFormat } from "@secondstaronline/data";

import { artRowFingerprint } from "./fx.ts";

/** The formats a sound may be in (checked by their opening bytes on the server). */
export const SOUND_FORMATS = ["wav", "mp3", "ogg"] as const satisfies readonly ArtSoundFormat[];
/** The most a sound file may weigh (the upload limit). */
export const SOUND_MAX_BYTES = 5 * 1024 * 1024;
/** The longest a sound's name may be. */
export const SOUND_NAME_MAX = 80;

const low = (s: string) => s.toLowerCase();

/**
 * The sounds the engine plays by name, in code (a hit, a kill, the shop's cash, the casino's
 * cards, the church bell…): a pack supplies their files like any other. The game frame's own
 * clicks are engine art and are not listed. Pinned against the code that plays them.
 */
export const ENGINE_SOUNDS: readonly { name: string; use: string }[] = [
  { name: "hitsound", use: "a melee or arrow hit on a monster, and PvP damage" },
  { name: "swordswing", use: "a weapon swing the item rules give no sound" },
  { name: "fx", use: "a monster killed" },
  { name: "cash", use: "a purchase, a sale and a slot win" },
  { name: "SlotMachine", use: "a slot machine pull" },
  { name: "CardShuffle", use: "a blackjack table reset" },
  { name: "CardDeal", use: "a blackjack card dealt" },
  { name: "cannonball", use: "a cannon shot" },
  { name: "splash", use: "a fishing cast" },
  { name: "Swordhit1", use: "smithing at an anvil" },
  { name: "Swordhit2", use: "smithing at an anvil" },
  { name: "Swordhit3", use: "starting to smith" },
  { name: "PotionMix", use: "starting to mix a potion" },
  { name: "sawbbb", use: "starting to build" },
  { name: "churchy", use: "the church bell" },
  { name: "heal2", use: "a class promotion" },
];

/**
 * The game frame's own clicks: engine art, served from the engine's files whatever the packs or
 * uploads hold, so no sound may take their names.
 */
export const FRAME_SOUNDS: readonly string[] = ["Clicksound", "Clicksound2"];

/** A sound and everyone who plays it. */
export interface SoundUse {
  /** As the first user spells it. */
  name: string;
  /** Who plays it: "spell Fireball", "gathering", "the engine (a monster killed)"… */
  users: string[];
}

/** What `soundUses` reads: the rows that name sounds. */
export interface SoundContent {
  spells: {
    spells: readonly { name: string; fx: readonly { sounds: readonly { name: string }[] }[] }[];
  };
  gather: unknown;
  itemRules: unknown;
  casino: unknown;
}

/**
 * Every sound the content and the engine play, by lower-case name, with everyone who plays it.
 * The engine's are always there, so a world that names none of them still lists them.
 */
export function soundUses(data: SoundContent): Map<string, SoundUse> {
  const out = new Map<string, SoundUse>();
  const note = (name: unknown, who: string) => {
    if (typeof name !== "string" || name.trim() === "") {
      return;
    }
    const k = low(name);
    const use = out.get(k) ?? { name, users: [] };
    if (!use.users.includes(who)) {
      use.users.push(who);
    }
    out.set(k, use);
  };
  for (const spell of data.spells.spells) {
    for (const run of spell.fx) {
      for (const s of run.sounds) {
        note(s.name, `spell ${spell.name}`);
      }
    }
  }
  // Sounds elsewhere: gathering's hit and success sounds, swing sounds, the casino's. A sound is an
  // object with a name and a channel, or a `sound` field.
  const walk = (v: unknown, who: string): void => {
    if (Array.isArray(v)) {
      for (const x of v) {
        walk(x, who);
      }
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (
        typeof o.name === "string" &&
        (typeof o.ch === "number" || typeof o.channels === "number")
      ) {
        note(o.name, who);
      }
      if (typeof o.sound === "string") {
        note(o.sound, who);
      }
      for (const x of Object.values(o)) {
        walk(x, who);
      }
    }
  };
  walk(data.gather, "gathering");
  walk(data.itemRules, "the item rules");
  walk(data.casino, "the casino");
  for (const s of ENGINE_SOUNDS) {
    note(s.name, `the engine (${s.use})`);
  }
  return out;
}

/** Who plays a sound, for messages: "spell Fireball, gathering". */
export const soundUsersText = (use: SoundUse | undefined): string =>
  use && use.users.length > 0 ? use.users.join(", ") : "nothing yet";

/** Who a replacement changes: "Replaces fx for the engine (a monster killed), spell Crush." */
export function soundReplaceText(name: string, use: SoundUse | undefined): string {
  return use && use.users.length > 0
    ? `Replaces ${name} for ${soundUsersText(use)}.`
    : `Replaces ${name}, which nothing plays yet.`;
}

/** Why a name cannot be a sound's, or null when it can. */
export function soundNameProblem(name: string): string | null {
  const n = name.trim();
  if (n === "") {
    return "A sound needs a name.";
  }
  if (n.length > SOUND_NAME_MAX) {
    return `A sound's name may be at most ${SOUND_NAME_MAX} characters.`;
  }
  // Control characters and slashes have no place in a name content plays by.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to refuse them.
  if (/[\u0000-\u001f\u007f\\/]/.test(n)) {
    return "A sound's name may not hold slashes or control characters.";
  }
  if (FRAME_SOUNDS.some((f) => low(f) === low(n))) {
    return `${n} is the game frame's own click, which only the engine supplies.`;
  }
  return null;
}

/** A sound file's format from its name, or null. */
export function soundFormatOfName(file: string): ArtSoundFormat | null {
  const m = /\.(wav|mp3|ogg)$/i.exec(file);
  return m ? (low(m[1] as string) as ArtSoundFormat) : null;
}

/** A file's name without its folder and extension: the sound it is for. */
export const soundStem = (file: string) =>
  file
    .replace(/^.*[\\/]/, "")
    .replace(/\.(wav|mp3|ogg)$/i, "")
    .trim();

/**
 * What a bulk file's name stands for: a sound already listed (spelled as it is listed), or a new
 * sound under the file's name. Names ignore case, so one name is one sound.
 */
export type SoundMatch = { kind: "sound"; name: string } | { kind: "new"; name: string };

export function matchSound(stem: string, known: readonly string[]): SoundMatch {
  const hit = known.find((n) => low(n) === low(stem));
  return hit !== undefined ? { kind: "sound", name: hit } : { kind: "new", name: stem };
}

// ---- changes ----------------------------------------------------------------------------------

/** One sound change, as the Content page asks for it. */
export type SoundChange =
  /** A sound's file (new, or replacing); `expect` is its upload as the panel saw it (null: none). */
  | { op: "set"; name: string; file: string; format: ArtSoundFormat; expect: string | null }
  /** Take a sound's upload out (a pack's comes back). Always checked against `expect`. */
  | { op: "remove"; name: string; expect: string | null };

/** A row a sound change writes. */
export type SoundRowChange =
  | { ref: { dataset: "art"; part: "sounds"; key: string }; op: "set"; data: ArtSound }
  | { ref: { dataset: "art"; part: "sounds"; key: string }; op: "remove"; data: null };

export type SoundPlan =
  | { ok: true; rows: SoundRowChange[]; name: string }
  | { ok: false; error: string };

const soundRef = (name: string) => ({ dataset: "art", part: "sounds", key: name }) as const;

/** Works out the row a sound change writes, or why it is refused. */
export function planSound(change: SoundChange, art: readonly ArtSound[]): SoundPlan {
  const bad = soundNameProblem(change.name);
  if (bad) {
    return { ok: false, error: bad };
  }
  const own = art.find((a) => low(a.name) === low(change.name.trim()));
  // An upload keeps the spelling it was made with; a new one takes the change's.
  const name = own?.name ?? change.name.trim();
  if (artRowFingerprint(own) !== change.expect) {
    return {
      ok: false,
      error: `${name}'s upload changed since you opened it: open it again to hear the new one.`,
    };
  }
  if (change.op === "remove") {
    if (!own) {
      return { ok: false, error: `${name} has no upload to take out.` };
    }
    return { ok: true, name, rows: [{ ref: soundRef(own.name), op: "remove", data: null }] };
  }
  if (!SOUND_FORMATS.includes(change.format)) {
    return { ok: false, error: "A sound is a WAV, MP3 or OGG file." };
  }
  return {
    ok: true,
    name,
    rows: [
      {
        ref: soundRef(name),
        op: "set",
        data: { name, file: change.file, format: change.format },
      },
    ],
  };
}

/**
 * Sounds the draft newly makes content play that nothing supplies: no pack has it and no upload
 * will. A gap is kept by who plays the sound, so only a player that already played it without a
 * file in the published content is left alone (Minimal's engine sounds): a spell newly set to
 * play a sound nobody supplies is reported even when the engine already played that name. A
 * sound taken away is `lostArtProblems`'s to report.
 */
export function newSoundGaps(
  next: SoundContent,
  published: SoundContent,
  supplied: ReadonlySet<string>,
): { name: string; users: string[] }[] {
  const before = soundUses(published);
  const out: { name: string; users: string[] }[] = [];
  for (const [k, use] of soundUses(next)) {
    if (supplied.has(k)) {
      continue;
    }
    const had = new Set(before.get(k)?.users ?? []);
    const users = use.users.filter((u) => !had.has(u));
    if (users.length > 0) {
      out.push({ name: use.name, users });
    }
  }
  return out;
}
