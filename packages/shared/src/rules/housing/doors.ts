/**
 * Doors, keys, switches and the relock. Pure functions over `houseData.keys`, `.switches` and
 * `.relock` (the generated house records).
 */
import { houseData } from "@secondstaronline/data";

import { lingoContains, lingoEq, lingoWord, type Rng } from "../core/lingo.ts";

const K = houseData.keys;
const SW = houseData.switches;
const R = houseData.relock;

export const KEY_TEXT = { doesntFit: K.doesntFit } as const;
export const SWITCH_TEXT = { notInFront: SW.text } as const;

/** Coloured keys' pause (425 frames between item actions). */
export const KEY_PAUSE = K.colouredPause;
/** House and Guild Keys' pause after turning a door (100 frames). */
export const HOUSE_KEY_PAUSE = K.housePause;
/** A switch that flips sets a 100-frame pause between item actions. */
export const SWITCH_PAUSE = SW.pause;

/** An item whose name contains "Key" routes to the key script. */
export const isKey = (item: string): boolean => lingoContains(item, "Key");

/**
 * The door a key acts on: of the ground items on the faced tile, in sprite order, the **last**
 * whose name contains "Door" (the exact tests above it are overwritten by the `contains` test).
 * Null: nothing happens.
 */
export function facedDoor(namesOnTile: readonly string[]): string | null {
  let found: string | null = null;
  for (const n of namesOnTile) {
    if (lingoContains(n, "Door")) {
      found = n;
    }
  }
  return found;
}

export type KeyTurn =
  | { kind: "silent" }
  | { kind: "text"; text: string }
  /** The door changes from `from` to `to`; `opening` is false when it closes. */
  | { kind: "turn"; from: string; to: string; coloured: boolean; opening: boolean };

/** The part of the door name before the first apostrophe. */
const owner = (door: string) => door.split("'")[0] ?? "";

/**
 * The key script, after the door is found. `guild` is the player's guild name, or empty without
 * one. Name matching ignores case.
 */
export function turnKey(key: string, door: string, me: string, guild: string): KeyTurn {
  const myGuild = `The ${guild}`;
  for (const [closedPart, openSuffix] of [
    ["'s Door", "'s Opened Door"],
    ["'s Opened Door", "'s Door"],
  ] as const) {
    if (!lingoContains(door, closedPart)) {
      continue;
    }
    const person = owner(door);
    if (lingoEq(key, K.houseKey)) {
      // the door's name before the apostrophe must be yours.
      return lingoEq(person, me)
        ? {
            kind: "turn",
            from: door,
            to: `${person}${openSuffix}`,
            coloured: false,
            opening: closedPart === "'s Door",
          }
        : { kind: "text", text: K.doesntFit };
    }
    if (lingoEq(key, K.guildKey) && lingoEq(lingoWord(door, 1), "The")) {
      // only a guild door ("The …") answers, against "The <guild>".
      return lingoEq(person, myGuild)
        ? {
            kind: "turn",
            from: door,
            to: `${person}${openSuffix}`,
            coloured: false,
            opening: closedPart === "'s Door",
          }
        : { kind: "text", text: K.doesntFit };
    }
    return { kind: "silent" };
  }
  // a coloured key toggles its own door by exact name; anything else is silent.
  for (const c of K.coloured) {
    if (!lingoEq(key, c.key)) {
      continue;
    }
    if (lingoEq(door, c.closed)) {
      return { kind: "turn", from: door, to: c.open, coloured: true, opening: true };
    }
    if (lingoEq(door, c.open)) {
      return { kind: "turn", from: door, to: c.closed, coloured: true, opening: false };
    }
  }
  return { kind: "silent" };
}

/**
 * Whether turning a door uses up the key: a coloured key is spent when it opens its door (unless
 * `Keys.txt` marks it `<key>:Inf`); closing a door with it is free, and House and Guild Keys are
 * never spent.
 */
export const keyConsumed = (turn: { coloured: boolean; opening: boolean }, key: string): boolean =>
  turn.coloured && turn.opening && !K.keysTxt.some((l) => lingoContains(l, `${key}:Inf`));

/** The item-action pause after a key turns a door. */
export const keyPause = (turn: { coloured: boolean }): number =>
  turn.coloured ? KEY_PAUSE : HOUSE_KEY_PAUSE;

/** The names a door or switch rename may touch (exploit 3: nothing else is renamed). */
export function isDoorOrSwitch(name: string): boolean {
  if (lingoContains(name, "'s Door") || lingoContains(name, "'s Opened Door")) {
    return true;
  }
  return R.closes.some(([open, closed]) => lingoEq(name, open) || lingoEq(name, closed));
}

/**
 * The doors or switches on the map named exactly `old` (case ignored), for the changes that touch
 * every one of a kind: a switch's doors and the relock. Returns the indices, in order. A key or a
 * switch click changes only the item it was used on.
 */
export function renameTargets(names: readonly string[], old: string): number[] {
  const out: number[] = [];
  names.forEach((n, i) => {
    if (isDoorOrSwitch(n) && lingoEq(n, old)) {
      out.push(i);
    }
  });
  return out;
}

/** Which switch, if any (a name containing "ON Switch" is tested first). */
export function switchState(name: string): "on" | "off" | null {
  if (lingoContains(name, SW.on)) {
    return "on";
  }
  if (lingoContains(name, SW.off)) {
    return "off";
  }
  return null;
}

/**
 * A switch that flips: its own new name (only the clicked switch changes), then the close-all step
 * (ON → OFF closes every `Open Switch Door`) or the open-all step (OFF → ON opens every `Switch
 * Door`). Returned as `[old, new]` renames in send order.
 */
export function switchFlip(state: "on" | "off"): [[string, string], [string, string]] {
  const sd = R.closes.find(([open]) => lingoContains(open, "Switch Door"));
  const [openDoor, shutDoor] = sd ?? ["Open Switch Door", "Switch Door"];
  return state === "on"
    ? [
        [SW.on, SW.off],
        [openDoor, shutDoor],
      ]
    : [
        [SW.off, SW.on],
        [shutDoor, openDoor],
      ];
}

const OPENED_DOOR = "'s Opened Door";

/** What closing turns an open door or ON switch into, or null when the item is not one. */
export function closedName(name: string): string | null {
  const pair = R.closes.find(([open]) => lingoEq(name, open));
  if (pair) {
    return pair[1];
  }
  // A player's or guild's opened door ("<owner>'s Opened Door") shuts as "<owner>'s Door".
  if (name.toLowerCase().endsWith(OPENED_DOOR.toLowerCase())) {
    return `${name.slice(0, -OPENED_DOOR.length)}'s Door`;
  }
  return null;
}

/**
 * Closing all doors over the map's items in sprite order: each `ON Switch`, each open coloured or
 * switch door and each opened player or guild door is closed. Returned as `[old, new]` renames in
 * send order, each name once.
 */
export function closeAllDoors(names: readonly string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const n of names) {
    const to = closedName(n);
    if (to !== null && !out.some(([o]) => lingoEq(o, n))) {
      out.push([n, to]);
    }
  }
  return out;
}

/** Whether anything on the map is open for the relock to close. */
export const anyOpenDoor = (names: readonly string[]): boolean =>
  names.some((n) => closedName(n) !== null);

/**
 * The map's relock timer (the door-lock countdown): every door or switch change sets it to 200, so
 * the doors close 200 frames after the last change, whether or not anyone is on the map.
 */
export const RELOCK_FRAMES = R.change;

// ---- quest chests ----------------------------------------------------------------------------

const QC = houseData.questChest;

/** The save-block counter is 400 after each save. */
export const QUEST_SAVE_BLOCK = QC.saveBlock;

/**
 * The periodic save, once the save-block counter is 0 (`random(350) = 1`), and its quest chest roll
 * (`random(4000) = 1`). Returns whether a save happened, which resets the block.
 */
export function periodicSave(rng: Rng): boolean {
  return rng.random(QC.saveRoll) === 1;
}

/**
 * `QuestChest` after a save: `random(4000)`, then `random(6)` picks the chest; with no source
 * nothing happens; otherwise `random(lines)` picks the line the chest gets (the source lines
 * trimmed). The server adds it when the chest has room (1.6 overwrote the chest with it).
 */
export function questChestRefill(rng: Rng): { chest: string; item: string } | null {
  if (rng.random(QC.odds) !== 1) {
    return null;
  }
  const roll = rng.random(QC.chests.length);
  const c = QC.chests.find((x) => x.roll === roll);
  if (!c || c.source.length === 0) {
    return null;
  }
  const item = c.source[rng.random(c.source.length) - 1];
  return item ? { chest: c.chest, item } : null;
}
