/**
 * Ground items. An entry is the original's `Name:px-py` string: a name (the quantity is part of it,
 * "15 Gold", "5 Blue Crystal") on a tile. Pure rules shared by the server and the client's
 * prediction and drawing.
 */
import { type ContentStore, content, onContent } from "../../content/store.ts";
import { isBlackjackTable } from "../casino/blackjack.ts";
import { isSlotMachine } from "../casino/casino.ts";
import { isCheckersTable } from "../casino/checkers.ts";
import { skillValue } from "../core/fighter.ts";
import { engineFixtureKind, playerArt, withoutId } from "../core/fixtures.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";
import { anyMatch, firstMatch, ruleMatches } from "../core/patterns.ts";
import { switchState } from "../housing/doors.ts";
import { isFurniture } from "../housing/houses.ts";
import { isNewspaperStand } from "../mail/newspaper.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";
import { vehicleOfItem, vehicleRow } from "../vehicles/rows.ts";
import { hasBehaviour, isCabinet } from "./behaviours.ts";
import {
  crystalColour,
  crystalPile,
  isGoldName,
  itemLabel,
  itemSprite,
  leadingInteger,
} from "./inventory.ts";

/** The pixel anchor of a tile (`32·x + 14`, `32·y − 3`). */
export function tilePixel(x: number, y: number): { px: number; py: number } {
  return { px: 32 * x + 14, py: 32 * y - 3 };
}

let G: ContentStore["itemRules"]["ground"];

/**
 * The name the ground tables test: without a carried container's or picture's `#id`, so a
 * `Barrel#12` sits on the ground as a Barrel does.
 */
function groundName(name: string): string {
  return withoutId(name).trim();
}

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
  const base = groundName(name);
  // A parked vehicle stands in the way, whatever `ground.blocks` says (issue #44).
  if (anyMatch(G.blocks, base) || vehicleOfItem(base) !== null) {
    return true;
  }
  return G.platforms.some(
    (p) =>
      ruleMatches(base, p) &&
      (p.needs === "level" ? who.level : skillValue(who.skills, p.needs)) < p.atLeast,
  );
}

/**
 * The monsters' list (anchor tile only): the same list as the players', so Holy Water and
 * newspapers stop monsters too (1.6 left those two off the monsters' list).
 */
export function blocksMonster(name: string): boolean {
  const base = groundName(name);
  return anyMatch(G.blocks, base) || vehicleOfItem(base) !== null;
}

/**
 * A fixture the world placed (the world editor or a staff `/drop`) that stands in the way
 * (`ground.blocks`, or a skill platform) is never picked up by a player. The same item dropped by a
 * player, such as a crafted Table, can be.
 */
export function fixedInPlace(name: string, placedByWorld: boolean): boolean {
  const base = groundName(name);
  return placedByWorld && (anyMatch(G.blocks, base) || anyMatch(G.platforms, base));
}

/** A placed carried container (`Crate#12`): its kind's behaviour, with an `#id`. */
const placed =
  (b: "cabinet" | "windCabinet" | "crate" | "cauldron") =>
  (name: string): boolean =>
    name.includes("#") && hasBehaviour(name, b);

/**
 * The pictures pasted for names that `contain` these (or pass the test), in script order. Each
 * paste covers the 32×32 scratch member, so the last match is the one seen. 1.6 tested words: a
 * name holding "Map" took the map picture, and the containers' words with their `#` (`Cabinet#`)
 * and `Painting#` and `Photo#` theirs. Content's behaviours now say which items are maps and
 * containers, and a painting or photo is a player's (`Painting#12`), known by its whole name.
 */
const PICTURES: readonly [string | ((name: string) => boolean), string][] = [
  [(name) => hasBehaviour(name, "map"), "MapPic"],
  [isNewspaperStand, "NewspaperPic"],
  [placed("cabinet"), "CabinetPic"],
  [placed("windCabinet"), "WindCabinetPic"],
  [placed("crate"), "CratePic"],
  [placed("cauldron"), "CauldronPic"],
  [(name) => playerArt(name)?.kind === "painting", "PaintingPic"],
  [(name) => playerArt(name)?.kind === "photo", "PhotoPic"],
  ["'s Mailbox", "MailBoxPic"],
  ["'s Door", "DoorPic"],
  ["'s Opened Door", "OpenDoorPic"],
  ["'s House Vault", "HouseVaultPic"],
  ["'s Guild Vault", "GuildVaultPic"],
  ["'s Board", "MessageBoardPic"],
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
 * Whether a ground item's picture takes the clock face: the `clock` behaviour (Classic: a name
 * containing "Clock", which is true of the `Clock` fixture and of the faces themselves).
 */
export function showsClockFace(picture: string): boolean {
  return hasBehaviour(picture, "clock");
}

/**
 * The picture a bag line shows (the bag-line drawing): a cabinet, a wind cabinet, a player's
 * painting or photo, a cauldron or a crate is drawn from that pool's picture, the last test to
 * match winning; any other name is its own member, unless SSO has drawn it a new picture (its
 * `sprite`). The pools hold the carried containers' and art's `Name#n` pictures. 1.6 tested words
 * ("cabinet" without "Wind", any name holding "Painting" or "Photo"); content's behaviours now say
 * which items are containers, and a painting or photo is known by its whole name (`Painting#12`).
 */
export function bagPicture(name: string): string {
  let pic = name;
  if (hasBehaviour(name, "cabinet") && !hasBehaviour(name, "windCabinet")) {
    pic = "CabinetBag";
  }
  if (hasBehaviour(name, "windCabinet")) {
    pic = "WindCabinetBag";
  }
  const art = playerArt(name);
  if (art?.kind === "painting") {
    pic = "PaintingBag";
  }
  if (art?.kind === "photo") {
    pic = "PhotoBag";
  }
  if (hasBehaviour(name, "cauldron")) {
    pic = "CauldronBag";
  }
  if (hasBehaviour(name, "crate")) {
    pic = "CrateBag";
  }
  return pic === name ? itemSprite(name) : pic;
}

/**
 * The member an item on the ground shows when it has no custom picture: its `sprite` (the
 * Cannonball's 13 px icon, issue #2), or the name.
 */
export function groundMember(name: string): string {
  return itemSprite(name);
}

/** The picture a ground item shows: an atlas name, or the name. */
export function groundPicture(name: string): string {
  let pic = name;
  if (isGoldName(name)) {
    const n = leadingInteger(name);
    // 1-49 small, 50-99 medium, 100+ large; 0 or less keeps no picture. The three pictures are the
    // currency's whatever it is called.
    pic = n > 99 ? "LargeGold" : n > 49 ? "MediumGold" : n > 0 ? "SmallGold" : pic;
  }
  for (const [part, picture] of PICTURES) {
    if (typeof part === "string" ? lingoContains(name, part) : part(name)) {
      pic = picture;
    }
  }
  // A parked vehicle shows its row's picture (issue #44; Classic's BoatPic, AirshipPic,
  // BattleshipPic).
  const parked = vehicleRow(vehicleOfItem(name));
  if (parked) {
    pic = parked.picture;
  }
  // A crystal, or a pile of them (`5 Blue Crystal`), by its whole name.
  const colour = crystalColour(crystalPile(name)?.item ?? name);
  if (colour) {
    pic = `${colour}Crystal`;
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
  return firstMatch(G.layers, groundName(name))?.layer ?? "items";
}

/**
 * The World Editor places `Left Ray` and `Right Ray` 15 px right and 10 px up of the tile, and the
 * save keeps that pixel position. SSO keeps tiles only, so a Ray is always drawn there.
 */
export function groundDrawOffset(name: string): { dx: number; dy: number } {
  const row = firstMatch(G.offsets, groundName(name));
  return row ? { dx: row.dx, dy: row.dy } : { dx: 0, dy: 0 };
}

/**
 * The animated overlay on a ground item, by its first frame name (the animated-sprite drawing);
 * frames 1-4 cycle.
 */
export function groundOverlay(name: string): string | null {
  return firstMatch(G.overlays, groundName(name))?.overlay ?? null;
}

/**
 * True when a ground item's overlay animates only while the item is in use: the crafting stations
 * (an SSO change; 1.6's Alchemy Lab always bubbled).
 */
export function overlayWhenInUse(name: string): boolean {
  return anyMatch(G.inUse, groundName(name));
}

/** A player as the station test sees them: where they stand, the way they face, and if they craft. */
export interface Crafter {
  x: number;
  y: number;
  facing: Facing;
  crafting: boolean;
}

/** True when a crafting player faces the tile (x, y): the station there is in use. */
export function stationInUse(x: number, y: number, crafters: Iterable<Crafter>): boolean {
  for (const c of crafters) {
    const [dx, dy] = FACING_DELTA[c.facing];
    if (c.crafting && c.x + dx === x && c.y + dy === y) {
      return true;
    }
  }
  return false;
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
  // A renamed item is named as players know it, count and level included ("2 Brown Ale").
  const label = itemLabel(base);
  if (label !== base) {
    return label;
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

/** The casino game an item plays, in 1.6's order: Slot Machine, Blackjack, Checkers. */
function casinoGame(name: string): "slots" | "blackjack" | "checkers" | null {
  return isSlotMachine(name)
    ? "slots"
    : isBlackjackTable(name)
      ? "blackjack"
      : isCheckersTable(name)
        ? "checkers"
        : null;
}

/** The click fixtures' actions that still answer: the switches. */
const SWITCH_CLICKS: ReadonlySet<string> = new Set(["TheOnSwitchClick", "TheOffSwitchClick"]);

/**
 * The gate an engine fixture answers with whatever its owner is called, or null for any other name.
 * 1.6 read words, so "The Photo Club's Guild Vault" was a photo and "The Clock Club's Board" a
 * clock; SSO knows a fixture by its kind before any other test. The Street Lamp has no owner and
 * runs the tables.
 */
function fixtureGate(name: string): PickupGate | null {
  switch (engineFixtureKind(name)) {
    case "door":
    case "openedDoor":
    case "exit":
    case "sign":
      return { kind: "silent" };
    case "board":
      return { kind: "board" };
    case "mailbox":
      return { kind: "mail", universal: false };
    case "houseVault":
    case "guildVault":
      return { kind: "open" };
    case "vehicle":
      return { kind: "vehicle" };
    default:
      return null;
  }
}

/**
 * The name gates of a click pickup. A click uses a thing that does something and Ctrl picks up the
 * ones that can be carried (`ctrlGate`). An engine fixture answers by its kind first (`fixtureGate`);
 * items by their behaviours (`item-rules.json` `behaviours`), in 1.6's order: doors and `noClick`
 * items are left alone; boards and mail open their windows; chests, crates and cabinets open with
 * the chest click; the casino tables play and the guild center opens; then `houses.json`
 * `clickFixtures` gives a text, a silent exit or a switch. The stations and casino tables answer
 * wherever they stand, your own house included (1.6 picked them up there instead).
 */
export function clickGate(name: string): PickupGate {
  const has = (p: string) => lingoContains(name, p);
  const eq = (p: string) => lingoEq(name, p);
  const fixture = fixtureGate(name);
  if (fixture) {
    return fixture;
  }
  // The newspaper (tested on the part of the name before `#`), then a player's painting or photo
  // (by its whole name), before the door/exit/Ray silence.
  const item1 = name.split("#")[0] ?? name;
  if (isNewspaperStand(item1)) {
    return { kind: "newspaper" };
  }
  if (playerArt(name)) {
    return { kind: "view" };
  }
  // 1.6 tested " Ray", "door" and "exit", then "Sign" (and "Lair" after the vehicles); Classic's
  // `noClick` rows hold those words.
  if (hasBehaviour(name, "noClick") || hasBehaviour(name, "door")) {
    return { kind: "silent" };
  }
  // Town Square's board and a hall's board; a chest opens with the chest click; then the mail,
  // the universal mailbox before a house's, and a house vault.
  if (hasBehaviour(name, "messageBoard")) {
    return { kind: "board" };
  }
  if (hasBehaviour(name, "chest")) {
    return { kind: "open" };
  }
  if (hasBehaviour(name, "universalMail")) {
    return { kind: "mail", universal: true };
  }
  // The statues open from any distance and are never picked up, before any header test.
  if (hasBehaviour(name, "highScoreStatue")) {
    return { kind: "scores" };
  }
  if (hasBehaviour(name, "assassinStatue")) {
    return { kind: "statue" };
  }
  if (hasBehaviour(name, "cauldron")) {
    return { kind: "text", text: PICKUP_TEXT.cauldron };
  }
  // A crate or cabinet opens like a chest; Ctrl carries it off (1.6's click picked it up and never
  // reached the chest click).
  if (hasBehaviour(name, "crate") || isCabinet(name)) {
    return { kind: "open" };
  }
  // The casino tables and the guild center. 1.6 found them among the fixtures below, after the
  // Vault; no Classic one matches a fixture before it.
  const game = casinoGame(name);
  if (game) {
    return { kind: "casino", game };
  }
  if (hasBehaviour(name, "guildCenter")) {
    return { kind: "guildCenter" };
  }
  // The personal vault is the server's, before this gate.
  if (hasBehaviour(name, "personalVault")) {
    return { kind: "silent" };
  }
  for (const f of content().houses.clickFixtures) {
    // A row for the Vault, the Guild Center or a casino table is an item behaviour now.
    if (f.action !== null && !SWITCH_CLICKS.has(f.action)) {
      continue;
    }
    if (f.match === "exact" ? eq(f.item) : has(f.item)) {
      if (f.text) {
        return { kind: "text", text: f.text };
      }
      const state = switchState(name);
      return state && f.action ? { kind: "switch", state } : { kind: "silent" };
    }
  }
  return { kind: "take" };
}

/**
 * The name gates of a Ctrl pickup, by behaviour and fixture kind in 1.6's order: a newspaper is
 * read, then a door or exit is silent; chests open and switches flip; no Painting/Photo branch, so
 * paintings and photos are taken (a click views them); a crate or cabinet is taken by whoever is
 * strong enough (a click opens it); the stations and casino tables are taken on your own premises
 * (`mine`: the room's header names you or your guild) and used anywhere else; the fixtures with a
 * line (`pickup.ctrlTexts`) say it and take nothing; signs, boards, mail, vaults, parked boats and
 * `noCtrl` items are silent.
 */
export function ctrlGate(name: string, who: { str: number; mine: boolean }): PickupGate {
  const fixture = fixtureGate(name);
  if (fixture) {
    return fixture;
  }
  // A newspaper stand first, so a stand whose author's name holds "door" or "exit" is read (1.6
  // tested the door/exit silence first, so Ctrl ignored "Doorman's Newspaper").
  if (isNewspaperStand(name)) {
    return { kind: "newspaper" };
  }
  if (hasBehaviour(name, "door")) {
    return { kind: "silent" };
  }
  // Town Square's board, a house mailbox, then the statues, the vehicles and the universal
  // mailbox, all before the chests. Ctrl's mail order is the reverse of the click's.
  if (hasBehaviour(name, "messageBoard")) {
    return { kind: "board" };
  }
  if (hasBehaviour(name, "highScoreStatue")) {
    return { kind: "scores" };
  }
  if (hasBehaviour(name, "assassinStatue")) {
    return { kind: "statue" };
  }
  if (hasBehaviour(name, "universalMail")) {
    return { kind: "mail", universal: true };
  }
  if (hasBehaviour(name, "chest")) {
    return { kind: "open" };
  }
  // The six furniture items (stations and casino tables) are carried off from your own premises.
  if (who.mine && isFurniture(name)) {
    return { kind: "take" };
  }
  // Elsewhere the casino tables play, before the vaults, cabinets and crates.
  const game = casinoGame(name);
  if (game) {
    return { kind: "casino", game };
  }
  // The fixtures' one-line texts and the skill platforms', `pickup.ctrlTexts`, in 1.6's order, with
  // the stations' lines after them (docs/modding.md has the notes on the platforms).
  const said = firstMatch(content().itemRules.pickup.ctrlTexts, groundName(name));
  if (said) {
    return { kind: "text", text: said.text, ...(said.unpause ? { unpause: true } : {}) };
  }
  // The vaults and the cauldron open. 1.6 opened crates and cabinets here too, so its Strength
  // tests below were never reached; SSO takes them.
  if (hasBehaviour(name, "cauldron")) {
    return { kind: "open" };
  }
  if (hasBehaviour(name, "crate") || isCabinet(name)) {
    const need = isCabinet(name) ? 19 : 15;
    return who.str < need ? { kind: "text", text: PICKUP_TEXT.weak } : { kind: "take" };
  }
  const state = switchState(name);
  if (state) {
    return { kind: "switch", state };
  }
  // `GuildCenterClick` on the faced guild center.
  if (hasBehaviour(name, "guildCenter")) {
    return { kind: "guildCenter" };
  }
  // 1.6's last silence: "Sign", "Board", " Chest", "Mail", "Vault", "'s Boat", "'s Battleship",
  // "Platform", "Lair" and an exact "Chimney". Classic's `noCtrl` rows hold the words; the
  // engine's signs, mail and vaults are silent by kind.
  if (hasBehaviour(name, "noCtrl")) {
    return { kind: "silent" };
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

onContent((c) => {
  G = c.itemRules.ground;
});
