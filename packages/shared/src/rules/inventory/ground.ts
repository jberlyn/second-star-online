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
import { isFurniture } from "../housing/houses.ts";
import { leadingInteger } from "./inventory.ts";

/** The pixel anchor of a tile (`32·x + 14`, `32·y − 3`). */
export function tilePixel(x: number, y: number): { px: number; py: number } {
  return { px: 32 * x + 14, py: 32 * y - 3 };
}

const G = itemRulesData.ground;

/**
 * The item-action pause after Ctrl: 4 frames (200 ms). 1.6 set 40 frames on every Ctrl and held
 * the client until the server's inventory reply ended it, so a pickup waited one round trip while
 * a press with no reply (boarding, unboarding, a sign) waited the full 2 seconds. SSO answers in
 * the same tick and needs no wait, so the pause only absorbs a double press.
 */
export const ACTION_PAUSE = 4;

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
 * The monsters' list (anchor tile only): the same list as the players', so Holy Water and
 * newspapers stop monsters too (1.6 left those two off the monsters' list).
 */
export function blocksMonster(name: string): boolean {
  return anyMatch(G.blocks, name);
}

/**
 * A fixture the world placed (the world editor or a staff `/drop`) that stands in the way
 * (`ground.blocks`, or a skill platform) is never picked up by a player. The same item dropped by a
 * player, such as a crafted Table, can be.
 */
export function fixedInPlace(name: string, placedByWorld: boolean): boolean {
  return placedByWorld && (anyMatch(G.blocks, name) || anyMatch(G.platforms, name));
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
 * in the time swatch, and the items draw): the hand points at the minute, moving one face every 5
 * minutes, so it goes round once an hour (Clock12 at :00, Clock1 at :05 … Clock11 at :55). 1.6's
 * table stepped every 3 minutes up to :35 and every 2 after, going round twice.
 */
export function clockFace(minute: number): string {
  const face = Math.floor((((minute % 60) + 60) % 60) / 5);
  return face === 0 ? "Clock12" : `Clock${face}`;
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
 * last test to match winning; any other name is its own member, unless SSO has drawn it a new
 * picture (`ADDED_PICTURES`). The pools hold the carried containers' and art's `Name#n` pictures.
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
  return ADDED_PICTURES[name.toLowerCase()] ?? pic;
}

/**
 * Items whose picture is added art drawn in place of their 1.6 member, which stays in the atlas:
 * the Cannonball's 13 px icon (issue #2).
 */
const ADDED_PICTURES: Readonly<Record<string, string>> = { cannonball: "CannonballBag" };

/** The member an item on the ground shows when it has no custom picture: added art, or the name. */
export function groundMember(name: string): string {
  return ADDED_PICTURES[name.toLowerCase()] ?? name;
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

/**
 * What the hover tip calls a ground item (an SSO addition: 1.6 named nothing on the ground), or
 * null for one it never names (`ground.tipless`: exits, Rays, clouds, chimneys and other markers or
 * overlays). The `#id` a container or picture carries is dropped ("Painting#12" is "Painting"),
 * then the first `ground.tipNames` row tidies the rest: "Sign 1" is "Sign", "BlueCrystal" is "Blue
 * Crystal", an open door is named as the door.
 */
export function groundTipName(name: string): string | null {
  const base = (name.split("#")[0] ?? name).trim();
  if (!base || anyMatch(G.tipless, base)) {
    return null;
  }
  const row = firstMatch(G.tipNames, base);
  if (!row) {
    return base;
  }
  if (row.match === "exact") {
    return row.name;
  }
  const at = base.toLowerCase().indexOf(row.pattern.toLowerCase());
  return base.slice(0, at) + row.name + base.slice(at + row.pattern.length);
}

export const PICKUP_TEXT = {
  /** Click (`#…` stripped) and Ctrl (full name). */
  full: (name: string) => `You see the ${name}, but you are carrying too much to pick it up!`,
  notAdjacent: (name: string) =>
    `You see the ${name}, but you must be standing in front of it to pick it up!`,
  gone: "You cannot pick this up because it's no longer there",
  cauldron: "This is WAY too heavy for anyone to pick up!",
  weak: "You're not strong enough to pick this up!",
  /** A fixture the world placed (`fixedInPlace`). */
  fixed: "This is fixed in place; you can't pick it up.",
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
  /** Clicking a vehicle: board it, or say whose it is. */
  | { kind: "vehicle" }
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
 * The name gates of a click pickup. A click uses a thing that does something and Ctrl picks up the
 * ones that can be carried (`ctrlGate`). Chests, crates, cabinets and house and guild vaults open
 * with the chest click; boards, mailboxes and signs open windows elsewhere (here they are left
 * alone); the fixtures after the Guild Vault run in 1.6's order from `houseData.clickFixtures`: a
 * text, a silent exit, or a handler (the switches, the Guild Center and the casino tables; the
 * personal Vault is the server's, before this test). The stations and casino tables answer
 * wherever they stand, your own house included (1.6 picked them up there instead).
 */
export function clickGate(name: string): PickupGate {
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
  // A vehicle is boarded (1.6's BoatClick and AirshipClick).
  if (has("'s Airship") || has("'s Boat") || has("'s Battleship")) {
    return { kind: "vehicle" };
  }
  if (has("Lair")) {
    return { kind: "silent" };
  }
  if (eq("Cauldron") || has("Cauldron#")) {
    return { kind: "text", text: PICKUP_TEXT.cauldron };
  }
  // A crate or cabinet opens like a chest; Ctrl carries it off (1.6's click picked it up and never
  // reached the chest click).
  if (has("Crate") || has("Cabinet")) {
    return { kind: "open" };
  }
  if (has("Guild Vault")) {
    return { kind: "open" };
  }
  for (const f of houseData.clickFixtures) {
    if (f.match === "exact" ? eq(f.item) : has(f.item)) {
      if (f.text) {
        return { kind: "text", text: f.text };
      }
      // The Guild Center.
      if (f.action === "GuildCenterClick") {
        return { kind: "guildCenter" };
      }
      // The casino tables.
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
 * The name gates of a Ctrl pickup: a newspaper is read, then door/exit is silent; chests open and
 * switches flip; no Painting/Photo branch, so paintings and photos are taken (a click views them);
 * a crate or cabinet is taken by whoever is strong enough (a click opens it); the stations and
 * casino tables are taken on your own premises (`mine`: the room's header names you or your guild)
 * and used anywhere else; the fixtures with a line (Piano, Wall Torch, Windmill, Holy Water, Fire
 * Pot, Fountain, Clock, Street Lamp) say it and take nothing, as do the four skill platforms;
 * Chimney is silent.
 */
export function ctrlGate(name: string, who: { str: number; mine: boolean }): PickupGate {
  const has = (p: string) => lingoContains(name, p);
  const eq = (p: string) => lingoEq(name, p);
  // A newspaper stand first, so a stand whose author's name holds "door" or "exit" is read (1.6
  // tested the door/exit silence first, so Ctrl ignored "Doorman's Newspaper").
  if (has("'s Newspaper")) {
    return { kind: "newspaper" };
  }
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
  // The vehicle click on the faced Airship, Boat or Battleship, between the statues and the mail.
  if (has("'s Airship") || has("'s Boat") || has("'s Battleship")) {
    return { kind: "vehicle" };
  }
  if (has("Universal Mail")) {
    return { kind: "mail", universal: true };
  }
  // The chest click for a chest, House Vault, Cabinet, Crate, Cauldron and Guild Vault; then the
  // switches.
  // No other name before them contains these.
  if (has(" Chest")) {
    return { kind: "open" };
  }
  // The six furniture items (stations and casino tables) are carried off from your own premises.
  if (who.mine && isFurniture(name)) {
    return { kind: "take" };
  }
  // Elsewhere the casino tables play, in 1.6's order: Slot Machine, Blackjack, Checkers, before the
  // vaults, cabinets and crates.
  if (has("Slot Machine")) {
    return { kind: "casino", game: "slots" };
  }
  if (has("Blackjack")) {
    return { kind: "casino", game: "blackjack" };
  }
  if (has("Checkers")) {
    return { kind: "casino", game: "checkers" };
  }
  // The fixtures' one-line texts and the skill platforms', `pickup.ctrlTexts`, in 1.6's order, with
  // the stations' lines after them (docs/modding.md has the notes on the platforms).
  const said = firstMatch(itemRulesData.pickup.ctrlTexts, name);
  if (said) {
    return { kind: "text", text: said.text, ...(said.unpause ? { unpause: true } : {}) };
  }
  // The vaults and the Cauldron open. 1.6 opened crates and cabinets here too, so its Strength
  // tests below were never reached; SSO takes them.
  if (has("House Vault") || has("Cauldron") || has("Guild Vault")) {
    return { kind: "open" };
  }
  if (has("Crate") || has("Cabinet")) {
    const need = has("Cabinet") ? 19 : 15;
    return who.str < need ? { kind: "text", text: PICKUP_TEXT.weak } : { kind: "take" };
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
 * monster or NPC one or two tiles ahead (the give-gold routine), else the drop. The crystal dialog
 * passes `playerAhead` only for its Give button.
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
