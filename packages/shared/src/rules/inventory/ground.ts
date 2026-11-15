/**
 * Ground items. An entry is the original's `Name:px-py` string: a name (the quantity is part of it,
 * "15 Gold", "5 Blue Crystals") on a tile. Pure rules shared by the server and the client's
 * prediction and drawing.
 */
import { houseData, itemRulesData } from "@secondstaronline/data";

import { skillValue } from "../core/fighter.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";
import { anyMatch, firstMatch, ruleMatches } from "../core/patterns.ts";
import { switchState } from "../housing/doors.ts";
import { leadingInteger } from "./inventory.ts";

/** The pixel anchor of a tile (`32·x + 14`, `32·y − 3`). */
export function tilePixel(x: number, y: number): { px: number; py: number } {
  return { px: 32 * x + 14, py: 32 * y - 3 };
}

const G = itemRulesData.ground;

/**
 * Does a ground item stop a player on foot stepping onto its tile? `ground.blocks` is the list; the
 * skill platforms (`ground.platforms`) block unless the skill (Slash, Magery, MartialArts) or the
 * level reaches the row's `atLeast`.
 */
export function blocksPlayer(
  name: string,
  who: { level: number; skills: readonly number[] },
): boolean {
  if (anyMatch(G.blocks, name)) {
    return true;
  }
  return G.platforms.some(
    (p) =>
      ruleMatches(name, p) &&
      (p.needs === "level" ? who.level : skillValue(who.skills, p.needs)) < p.atLeast,
  );
}

/**
 * The monsters' list (anchor tile only): the player list without the rows marked `monsters: false`,
 * Holy Water and "'s Newspaper" (a kept bug: monsters walk onto Holy Water and newspapers).
 */
export function blocksMonster(name: string): boolean {
  return anyMatch(
    G.blocks.filter((r) => r.monsters),
    name,
  );
}

/**
 * The pictures pasted for names that `contain` these, in script order. Each paste covers the 32×32
 * scratch member, so the last match is the one seen.
 */
const PICTURES: readonly [string, string][] = [
  ["Map", "MapPic"],
  ["'s Newspaper", "NewspaperPic"],
  ["Cabinet#", "CabinetPic"],
  ["Wind Cabinet#", "WindCabinetPic"],
  ["Crate#", "CratePic"],
  ["Cauldron#", "CauldronPic"],
  ["Painting#", "PaintingPic"],
  ["Photo#", "PhotoPic"],
  ["'s Mailbox", "MailBoxPic"],
  ["'s Door", "DoorPic"],
  ["'s Opened Door", "OpenDoorPic"],
  ["'s House Vault", "HouseVaultPic"],
  ["'s Guild Vault", "GuildVaultPic"],
  ["'s Board", "MessageBoardPic"],
  ["'s Boat", "BoatPic"],
  ["'s Airship", "AirshipPic"],
  ["'s Battleship", "BattleshipPic"],
];

/**
 * The face a placed Clock shows at server minute `minute` (the clock-face drawing; the same table
 * in the time swatch, and the items draw). Minutes 0-35 step every 3 (Clock12 … Clock11), 36-59
 * every 2, so the hand goes round twice an hour, the second time faster (a kept bug).
 */
export function clockFace(minute: number): string {
  const hour = minute < 36 ? Math.floor(minute / 3) : Math.floor((minute - 36) / 2);
  return hour === 0 ? "Clock12" : `Clock${hour}`;
}

/**
 * Whether a ground item's picture takes the clock face: its member name contains "Clock", which is
 * true of the `Clock` fixture and of the faces themselves.
 */
export function showsClockFace(picture: string): boolean {
  return lingoContains(picture, "Clock");
}

/**
 * The picture a bag line shows (the bag-line drawing): a name that contains "cabinet" (not "Wind"),
 * "wind cabinet", "Painting", "Photo", "cauldron" or "crate" is drawn from that pool's picture, the
 * last test to match winning; any other name is its own member. The pools hold the carried
 * containers' and art's `Name#n` pictures.
 */
export function bagPicture(name: string): string {
  let pic = name;
  if (lingoContains(name, "cabinet") && !lingoContains(name, "Wind")) {
    pic = "CabinetBag";
  }
  if (lingoContains(name, "wind cabinet")) {
    pic = "WindCabinetBag";
  }
  if (lingoContains(name, "Painting")) {
    pic = "PaintingBag";
  }
  if (lingoContains(name, "Photo")) {
    pic = "PhotoBag";
  }
  if (lingoContains(name, "cauldron")) {
    pic = "CauldronBag";
  }
  if (lingoContains(name, "crate")) {
    pic = "CrateBag";
  }
  return pic;
}

/** The picture a ground item shows: an atlas name, or the name. */
export function groundPicture(name: string): string {
  let pic = name;
  if (lingoContains(name, " gold")) {
    const n = leadingInteger(name);
    // 1-49 small, 50-99 medium, 100+ large; 0 or less keeps no picture.
    pic = n > 99 ? "LargeGold" : n > 49 ? "MediumGold" : n > 0 ? "SmallGold" : pic;
  }
  for (const [part, picture] of PICTURES) {
    if (lingoContains(name, part)) {
      pic = picture;
    }
  }
  if (lingoContains(name, " Crystal")) {
    // The last colour to match wins.
    for (const c of ["Blue", "Red", "Green", "Yellow", "Purple", "White"]) {
      if (lingoContains(name, c)) {
        pic = `${c}Crystal`;
      }
    }
  }
  return pic;
}

/**
 * The top-left pixel of a custom ground picture whose item sprite sits at (`px`, `py`). 1.6 copies
 * the picture into rect(1, 1, 33, 33) of a scratch member (`Inventory` 460-479, 32×32, regpoint
 * (16, -2)) and shows that member, so the picture's own regpoint is ignored. Every custom picture
 * is 32×32, so nothing is scaled. Gold, maps and the like have the scratch regpoint anyway; the
 * crystals' (3, -4) does not.
 */
export function groundPictureTopLeft(px: number, py: number): { x: number; y: number } {
  return { x: px - 16 + 1, y: py + 2 + 1 };
}

/**
 * Where a ground item draws, as a full map load stacks it (the item loader): `Exit`/`Exit2` at locZ
 * −100, under the map (never seen or clicked); `Chimney` one depth above layer 3; names containing
 * " Ray" or "Dragon Rock", and `DungeonAlpha`, at +800 (812): above every character, under layer 3;
 * everything else at 12, under the characters. A live drop (the drop sorter) sets only the exits;
 * SSO stacks every item as a full load does.
 */
export function groundLayer(name: string): "hidden" | "items" | "overChars" | "overLayer3" {
  return firstMatch(G.layers, name)?.layer ?? "items";
}

/**
 * The World Editor places `Left Ray` and `Right Ray` 15 px right and 10 px up of the tile, and the
 * save keeps that pixel position. SSO keeps tiles only, so a Ray is always drawn there.
 */
export function groundDrawOffset(name: string): { dx: number; dy: number } {
  const row = firstMatch(G.offsets, name);
  return row ? { dx: row.dx, dy: row.dy } : { dx: 0, dy: 0 };
}

/**
 * The animated overlay on a ground item, by its first frame name (the animated-sprite drawing);
 * frames 1-4 cycle.
 */
export function groundOverlay(name: string): string | null {
  return firstMatch(G.overlays, name)?.overlay ?? null;
}

export const PICKUP_TEXT = {
  /** Click (`#…` stripped) and Ctrl (full name). */
  full: (name: string) => `You see the ${name}, but you are carrying too much to pick it up!`,
  notAdjacent: (name: string) =>
    `You see the ${name}, but you must be standing in front of it to pick it up!`,
  gone: "You cannot pick this up because it's no longer there",
  cauldron: "This is WAY too heavy for anyone to pick up!",
  weak: "You're not strong enough to pick this up!",
} as const;

export type PickupGate =
  /** Silent: the item is not picked up and nothing is said. */
  | { kind: "silent" }
  | { kind: "text"; text: string; unpause?: boolean }
  | { kind: "take" }
  /** The chest click: a chest, crate, cabinet, cauldron or house/guild vault. */
  | { kind: "open" }
  /** `TheOnSwitchClick`/`TheOffSwitchClick`. */
  | { kind: "switch"; state: "on" | "off" }
  /** The Assassin Statue's assassin score display. */
  | { kind: "statue" }
  /** Clicking the airship: board it, or say whose it is. */
  | { kind: "airship" }
  /** The High Score Statue's score display. */
  | { kind: "scores" }
  /** `SlotMachineClick` / `BlackJackTableClick` / `CheckersTableClick`. */
  | { kind: "casino"; game: "slots" | "blackjack" | "checkers" }
  /** `GuildCenterClick`. */
  | { kind: "guildCenter" }
  /** The board loader for `Message Boards` or a hall's `'s Board`. */
  | { kind: "board" }
  /** The mailbox click (`'s Mailbox`) or the universal mailbox click (`Universal Mail`). */
  | { kind: "mail"; universal: boolean }
  /** Reading the newspaper for an `'s Newspaper`. */
  | { kind: "newspaper" }
  /** The painting viewer for a `Painting#<id>` or `Photo#<id>` (click only). */
  | { kind: "view" };

const CASINO_CLICKS: Readonly<Record<string, "slots" | "blackjack" | "checkers">> = {
  SlotMachineClick: "slots",
  BlackJackTableClick: "blackjack",
  CheckersTableClick: "checkers",
};

/**
 * The name gates of a click pickup. Chests and house and guild vaults open with the chest click;
 * boards, mailboxes and signs open windows elsewhere (here they are left alone); the fixtures after
 * the Guild Vault run in 1.6's order from `houseData.clickFixtures`: a text, a silent exit, or a
 * handler (the switches, the Guild Center and the casino tables; the personal Vault is the
 * server's, before this test). `headFlag` is the do-not-drop flag after the click's house test: the
 * stations and casino tables answer only while it is 1, and in a room whose header names you fall
 * through to pickup.
 */
export function clickGate(name: string, str: number, headFlag: 0 | 1 = 1): PickupGate {
  const has = (p: string) => lingoContains(name, p);
  const eq = (p: string) => lingoEq(name, p);
  // The newspaper, then a painting or photo, both tested on the part of the name before `#`,
  // before the door/exit/Ray silence.
  const item1 = name.split("#")[0] ?? name;
  if (lingoContains(item1, "'s Newspaper")) {
    return { kind: "newspaper" };
  }
  if (lingoContains(item1, "Painting") || lingoContains(item1, "Photo")) {
    return { kind: "view" };
  }
  if (has(" Ray") || has("door") || has("exit")) {
    return { kind: "silent" };
  }
  // The signs come first (silent); then Town Square's board (exact) and a hall's `'s Board`; a
  // chest opens with the chest click; then the mail, `Universal Mail` before `'s Mailbox`, and a
  // House Vault.
  if (has("Sign")) {
    return { kind: "silent" };
  }
  if (eq("Message Boards") || has("'s Board")) {
    return { kind: "board" };
  }
  if (has(" Chest")) {
    return { kind: "open" };
  }
  if (has("Universal Mail")) {
    return { kind: "mail", universal: true };
  }
  if (has("'s Mailbox")) {
    return { kind: "mail", universal: false };
  }
  if (has("House Vault")) {
    return { kind: "open" };
  }
  // The High Score Statue and Assassin Statue open from any distance and are never picked up,
  // before any header test.
  if (eq("High Score Statue")) {
    return { kind: "scores" };
  }
  if (eq("Assassin Statue")) {
    return { kind: "statue" };
  }
  // The Airship is boarded; the Boat and Battleship stay silent fixtures.
  if (has("'s Airship")) {
    return { kind: "airship" };
  }
  if (has("'s Boat") || has("'s Battleship") || has("Lair")) {
    return { kind: "silent" };
  }
  if (eq("Cauldron") || has("Cauldron#")) {
    return { kind: "text", text: PICKUP_TEXT.cauldron };
  }
  if (has("Crate") && str < 15) {
    return { kind: "text", text: PICKUP_TEXT.weak };
  }
  if (has("Cabinet") && str < 19) {
    return { kind: "text", text: PICKUP_TEXT.weak };
  }
  if (has("Guild Vault")) {
    return { kind: "open" };
  }
  for (const f of houseData.clickFixtures) {
    if (f.needsFlag && headFlag !== 1) {
      continue;
    }
    if (f.match === "exact" ? eq(f.item) : has(f.item)) {
      if (f.text) {
        return { kind: "text", text: f.text };
      }
      // The Guild Center.
      if (f.action === "GuildCenterClick") {
        return { kind: "guildCenter" };
      }
      // The casino tables, only where `needsFlag` held above.
      const game = CASINO_CLICKS[f.action ?? ""];
      if (game) {
        return { kind: "casino", game };
      }
      // The switches; the Vault is the server's before this gate.
      const state = switchState(name);
      return state && f.action ? { kind: "switch", state } : { kind: "silent" };
    }
  }
  return { kind: "take" };
}

/**
 * The name gates of a Ctrl pickup: door/exit silent; containers open and switches flip; no
 * Painting/Photo branch, so paintings and photos are taken; the fixtures with a line (Piano, Wall
 * Torch, Windmill, Holy Water, Fire Pot, Fountain, Clock, Street Lamp) say it and take nothing, as
 * do the four skill platforms; Chimney is silent.
 */
export function ctrlGate(name: string): PickupGate {
  const has = (p: string) => lingoContains(name, p);
  const eq = (p: string) => lingoEq(name, p);
  if (has("door") || has("exit")) {
    return { kind: "silent" };
  }
  // Town Square's board, a house mailbox, then the statue and `Universal Mail`, all before the
  // chests. Ctrl's mail order is the reverse of the click's.
  if (eq("Message Boards")) {
    return { kind: "board" };
  }
  if (has("'s Mailbox")) {
    return { kind: "mail", universal: false };
  }
  // The High Score Statue, the same lines as the click.
  if (eq("High Score Statue")) {
    return { kind: "scores" };
  }
  if (eq("Assassin Statue")) {
    return { kind: "statue" };
  }
  // The airship click on the faced Airship, between the statues and the mail.
  if (has("'s Airship")) {
    return { kind: "airship" };
  }
  if (has("Universal Mail")) {
    return { kind: "mail", universal: true };
  }
  // A newspaper stand, tested on the whole name: after the door/exit silence above, so an author
  // whose name holds "door" or "exit" is never read by Ctrl.
  if (has("'s Newspaper")) {
    return { kind: "newspaper" };
  }
  // The chest click for a chest, House Vault, Cabinet, Crate, Cauldron and Guild Vault; then the
  // switches.
  // No other name before them contains these.
  if (has(" Chest")) {
    return { kind: "open" };
  }
  // The casino tables: Ctrl plays with no header test, even in your own house, in 1.6's order: Slot
  // Machine, Blackjack, Checkers, before the vaults, cabinets and crates.
  if (has("Slot Machine")) {
    return { kind: "casino", game: "slots" };
  }
  if (has("Blackjack")) {
    return { kind: "casino", game: "blackjack" };
  }
  if (has("Checkers")) {
    return { kind: "casino", game: "checkers" };
  }
  // The fixtures' one-line texts and the skill platforms', `pickup.ctrlTexts`, in 1.6's
  // order. The notes on the Experience Platform, the Mage Master's kept bug and the Street Lamp are
  // in the content README.
  const said = firstMatch(itemRulesData.pickup.ctrlTexts, name);
  if (said) {
    return { kind: "text", text: said.text, ...(said.unpause ? { unpause: true } : {}) };
  }
  if (
    has("House Vault") ||
    has("Cabinet") ||
    has("Crate") ||
    has("Cauldron") ||
    has("Guild Vault")
  ) {
    return { kind: "open" };
  }
  // A hall's board (only " Chest" precedes it in 1.6 and no item has both).
  if (has("'s Board")) {
    return { kind: "board" };
  }
  const state = switchState(name);
  if (state) {
    return { kind: "switch", state };
  }
  // `GuildCenterClick` on the faced Guild Center.
  if (eq("Guild Center")) {
    return { kind: "guildCenter" };
  }
  if (
    has("Sign") ||
    has("Board") ||
    has(" Chest") ||
    has("Mail") ||
    has("Vault") ||
    has("'s Boat") ||
    has("'s Battleship") ||
    has("Platform") ||
    has("Lair")
  ) {
    return { kind: "silent" };
  }
  if (eq("Chimney")) {
    return { kind: "silent" }; // returns silently
  }
  return { kind: "take" };
}

/** Which branch the amount dialog's OK takes. */
export type AmountPath = "short" | "give" | "monster" | "drop";

/**
 * The amount dialog's branches in order: the balance test for every path (gold, crystals, "You
 * don't have enough …!"), then a standing player on the faced tile takes it, then for gold only a
 * monster or NPC one or two tiles ahead (the give-gold routine), else the drop. Server and client
 * share it: only the drop path clicks.
 */
export function amountPath(a: {
  gold: boolean;
  enough: boolean;
  playerAhead: boolean;
  monsterAhead: boolean;
}): AmountPath {
  if (!a.enough) {
    return "short";
  }
  if (a.playerAhead) {
    return "give";
  }
  if (a.gold && a.monsterAhead) {
    return "monster";
  }
  return "drop";
}
