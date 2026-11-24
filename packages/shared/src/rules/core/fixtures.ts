/**
 * The engine's fixtures (issue #37): the ground items whose names the engine builds or reads
 * itself. A house's door, mailbox and vault, a guild's board and vault and a parked vehicle carry
 * their owner's name (`Bob's Door`, `The Hawks's Guild Vault`, `Bob's Airship`); the exits, the
 * signs and the Street Lamp keep fixed names. A pack supplies their art, not their names, so no
 * content item may take one of these names, and no item behaviour applies to them: each is known
 * by its kind, never by a word in its owner's name (a guild called "Crate Club" has a board, not a
 * crate).
 */
import { lingoEq } from "./lingo.ts";

export type EngineFixtureKind =
  | "door"
  | "openedDoor"
  | "mailbox"
  | "board"
  | "houseVault"
  | "guildVault"
  | "airship"
  | "boat"
  | "battleship"
  | "exit"
  | "sign"
  | "streetLamp";

/** The endings of the names that carry their owner's (`<owner>'s Door`), and their kinds. */
export const OWNER_FIXTURE_ENDINGS: readonly (readonly [string, EngineFixtureKind])[] = [
  ["'s Door", "door"],
  ["'s Opened Door", "openedDoor"],
  ["'s Mailbox", "mailbox"],
  ["'s Board", "board"],
  ["'s House Vault", "houseVault"],
  ["'s Guild Vault", "guildVault"],
  ["'s Airship", "airship"],
  ["'s Boat", "boat"],
  ["'s Battleship", "battleship"],
];

/** The fixtures with fixed names, and their kinds. */
export const NAMED_FIXTURES: readonly (readonly [string, EngineFixtureKind])[] = [
  ["Exit", "exit"],
  ["Exit2", "exit"],
  ["Sign 1", "sign"],
  ["Sign 2", "sign"],
  ["Sign 3", "sign"],
  ["Street Lamp", "streetLamp"],
];

/** A name without its `#id`: `Crate#12` → `Crate`. */
export function withoutId(name: string): string {
  const at = name.indexOf("#");
  return at < 0 ? name : name.slice(0, at);
}

/**
 * Which engine fixture a name is (case ignored), or null. The whole name is read: fixtures carry no
 * `#id`, and an owner's name may hold a `#` (a guild called "Stars #1").
 */
export function engineFixtureKind(name: string): EngineFixtureKind | null {
  const named = NAMED_FIXTURES.find(([f]) => lingoEq(name, f));
  if (named) {
    return named[1];
  }
  const lower = name.toLowerCase();
  const owned = OWNER_FIXTURE_ENDINGS.find(
    ([e]) => lower.length > e.length && lower.endsWith(e.toLowerCase()),
  );
  return owned ? owned[1] : null;
}

/** Whether a name is one of the engine's fixtures. */
export function isEngineFixture(name: string): boolean {
  return engineFixtureKind(name) !== null;
}

/** Whether a name is an engine fixture of one of `kinds`. */
export function isFixtureKind(name: string, ...kinds: EngineFixtureKind[]): boolean {
  const k = engineFixtureKind(name);
  return k !== null && kinds.includes(k);
}

/**
 * A painting or photo a player made (`Painting#12`, `Photo#9`): the engine names them itself, so
 * they are known by that whole shape, never by a word in an item's name (1.6 took any name
 * holding "Painting" or "Photo" for one, so a "Photo Album" would have opened the viewer).
 */
export function playerArt(name: string): { kind: "painting" | "photo"; id: string } | null {
  const m = /^(painting|photo)#(\d+)$/i.exec(name);
  return m
    ? { kind: (m[1] as string).toLowerCase() as "painting" | "photo", id: m[2] as string }
    : null;
}
