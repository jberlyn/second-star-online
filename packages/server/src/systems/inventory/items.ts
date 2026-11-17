/**
 * Item intents on the server. Each handler runs the original client's gates in their order and then
 * the server's own handler, against server state only: the item comes from the bag slot, the tile
 * from the player's position, the target from the map.
 */
import { houseData } from "@secondstaronline/data";
import {
  amountPath,
  artRef,
  bagText,
  blocksPlayer,
  checkEquip,
  clickGate,
  ctrlGate,
  type DeltaEvent,
  deedUse,
  displayName,
  EQUIP_FIELD,
  EQUIP_TEXT,
  type EquipSlot,
  equipped,
  FACING_DELTA,
  filledLines,
  headDrop,
  invAdd,
  invDelSlot,
  isFurniture,
  isGoldName,
  isWalkable,
  kitTileOk,
  lingoContains,
  lingoEq,
  MAP_HEIGHT,
  MAP_WIDTH,
  menuAction,
  NEWS_TEXT,
  NOTHING,
  PICKUP_TEXT,
  PIG_TEXT,
  pileToItem,
  type Rng,
  SCORES_PAUSE,
  SCORES_TEXT,
  STATUE_PAUSE,
  scoresBlock,
  seedTile,
  standName,
  USE_TEXT,
  useDeferred,
  useItem,
  VEHICLE_TEXT,
} from "@secondstaronline/shared";

import { bjSit } from "../casino/blackjack.ts";
import { ckSit } from "../casino/checkers.ts";
import { slotOpen } from "../casino/slots.ts";
import { plantSeeds } from "../crafting/gather.ts";
import { depositContainer, dropRoute, openContainer } from "../economy/containers.ts";
import { giveGoldToNpc } from "../economy/intents.ts";
import { questGive } from "../economy/quests.ts";
import type { ShopLedger } from "../economy/shop.ts";
import { depositVault, openVault } from "../economy/vault.ts";
import { switchClick, useKey } from "../housing/doors.ts";
import { useDeed } from "../housing/houses.ts";
import { type ArtStore, useCanvas, useFilm, viewArt } from "../mail/art.ts";
import { type BoardStore, boardOpen } from "../mail/boards.ts";
import { type MailStore, mailOpen } from "../mail/mail.ts";
import { type NewspaperStore, readNewspaper } from "../mail/newspapers.ts";
import { ctrlPig, goldTarget } from "../monsters/npc.ts";
import { statueLines } from "../social/assassin.ts";
import { guildCenterClick } from "../social/guilds.ts";
import { blockedSubstring, summonPig } from "../spells/cast.ts";
import { isBook, readBook } from "../spells/learn.ts";
import { airshipClick, airshipDeed, unboardAirship } from "../vehicles/airship.ts";
import {
  type GroundItem,
  groundView,
  type Outgoing,
  type Player,
  type Room,
  type World,
  type WorldMap,
} from "../world/world.ts";

export const DROP_TEXT = {
  crowded: "You begin to drop this but realize the floor is too crowded.",
  blocked: "You begin to drop this but realize that something is blocking the floor.",
} as const;

export const GIVE_TEXT = {
  cannot: "You cannot give this.",
  offer: (item: string, to: string) => `*** You offer the ${item} to ${to}.`,
  noOne: "*** You must be standing in front of someone to give them this.",
  receiving: (giver: string, item: string) => `${giver} is giving you a ${item}.`,
  /** 1.6 never sets the line's item for crystals, so it is void. */
  offerCrystals: (to: string) => `*** Offering the  to ${to}.`,
  notEnough: "You don't have enough crystals!",
  /**
   * For gold 1.6 sets the line's item to the amount typed, so the line names the amount and not the
   * gold (a kept 1.6 bug: "Offering the 50 to Bob").
   */
  offerGold: (n: number, to: string) => `*** Offering the ${n} to ${to}.`,
  notEnoughGold: "You don't have enough gold!",
} as const;

/** Frames between a give's drop and the target's grab: 180 ticks of 1/60 s. */
export const GIVE_GRAB_FRAMES = 60;

export interface ItemCtx {
  world: World;
  rng: Rng;
  /** Wall-clock ms (loot decay). */
  now: number;
  /** An NPC's shop ledger, loaded or made from its template; null with no file. */
  shop?(npc: string): ShopLedger | null;
  /** Mailboxes and message boards as rows; absent in tests that do not use them. */
  mail?: MailStore;
  boards?: BoardStore;
  /** Art and newspapers as rows; absent in tests that do not use them. */
  art?: ArtStore;
  newspapers?: NewspaperStore;
  /** A map's roster slots changed outside the tick (a pig grab): write them. */
  slotsChanged?(map: WorldMap): void;
}

/** What an intent produced: chat lines and events for the map. */
export class ItemOut {
  readonly out: Outgoing[] = [];
  constructor(private readonly room: Room) {}
  tell(p: Player, text: string): void {
    this.out.push({ to: p.id, msg: { t: "chat", text, color: 0 } });
  }
  /** An event for everyone on the map. */
  all(ev: DeltaEvent): void {
    for (const o of this.room.players) {
      this.out.push({ to: o.id, msg: { t: "delta", events: [ev] } });
    }
  }
}

const busy = (p: Player) => p.deadLock > 0 || p.loading > 0;
/** Ctrl waits out its own item-action pause and ignores 1.6's client-side input lock. */
const ctrlPaused = (p: Player) => busy(p) || p.itemPause > 0;
/**
 * Use, Equip, Drop and a click wait out Ctrl's item-action pause; the bag and ground clicks also
 * exit while a window holds the input lock.
 */
const paused = (p: Player) => ctrlPaused(p) || p.keyLock;

function faced(p: Player): { x: number; y: number } {
  const [dx, dy] = FACING_DELTA[p.facing];
  return { x: p.x + dx, y: p.y + dy };
}

/** Puts an item on the ground and records it for the database. */
export function addGround(
  ctx: ItemCtx,
  room: Room,
  io: ItemOut,
  g: Omit<GroundItem, "id">,
): GroundItem {
  const item: GroundItem = { id: Bun.randomUUIDv7(), ...g };
  room.map.ground.push(item);
  ctx.world.groundLog.push({ mapId: room.map.id, add: item });
  io.all({ e: "gadd", item: groundView(item) });
  return item;
}

export function removeGround(ctx: ItemCtx, room: Room, io: ItemOut, id: string): void {
  const i = room.map.ground.findIndex((g) => g.id === id);
  if (i < 0) {
    return;
  }
  room.map.ground.splice(i, 1);
  ctx.world.groundLog.push({ mapId: room.map.id, del: id });
  io.all({ e: "gdel", id });
}

const changed = (p: Player) => {
  p.invDirty = true;
};

// ---- use -------------------------------------------------------------------------------

/** The Use button. Deferred items (film, canvas, maps…) do nothing yet. */
export function useIntent(ctx: ItemCtx, room: Room, p: Player, slot: number): Outgoing[] {
  const io = new ItemOut(room);
  const line = p.char.bag[slot - 1];
  if (paused(p) || !line) {
    return io.out;
  }
  // Seeds are planted on the faced tile, and used up only when they take.
  if (seedTile(line.item)) {
    const r = plantSeeds(ctx.world, room, p, line.item);
    io.out.push(...r.out);
    if (r.planted) {
      invDelSlot(p.char.bag, slot - 1, 1);
      changed(p);
    }
    return io.out;
  }
  // The Airship Deed builds on the faced landing pad.
  if (deedUse(line.item)?.kind === "airship") {
    return airshipDeed(ctx, room, p, slot);
  }
  // A house deed starts placement.
  const deed = useDeed(p, slot, line.item);
  if (deed) {
    return deed;
  }
  // A key (the item name contains "Key").
  if (useKey(ctx, room, io, p, slot, line.item)) {
    return io.out;
  }
  // Film, Canvas, Painting and Photo, in 1.6's order.
  if (lingoContains(line.item, "Film") || lingoEq(line.item, "Canvas")) {
    const r = lingoEq(line.item, "Canvas") ? useCanvas(p) : useFilm(p);
    io.out.push(...r.out);
    if (r.consume) {
      invDelSlot(p.char.bag, slot - 1, 1);
      changed(p);
    }
    return io.out;
  }
  if (artRef(line.item)) {
    if (ctx.art) {
      io.out.push(...viewArt(p, line.item, ctx.art, "bag"));
    }
    return io.out;
  }
  // Right after the Photo branch: the Piano says it cannot be used and consumes nothing.
  if (lingoEq(line.item, "Piano")) {
    io.tell(p, USE_TEXT.piano);
    return io.out;
  }
  if (useDeferred(line.item)) {
    return io.out;
  }
  // A book is read.
  if (isBook(line.item)) {
    for (const text of readBook(p, slot - 1, ctx.rng)) {
      io.tell(p, text);
    }
    return io.out;
  }
  const v = p.char.vitals;
  const r = useItem(
    line.item,
    { hp: v.hp, hpMax: v.hpMax, sp: v.sp, spMax: v.spMax, hunger: p.char.hunger },
    ctx.rng,
  );
  for (const text of r.lines) {
    io.tell(p, text);
  }
  if (!r.consume) {
    return io.out;
  }
  v.hp = r.hp;
  v.sp = r.sp;
  p.char.hunger = r.hunger;
  p.vitalsDirty = true;
  if (r.argon) {
    p.attackBonus = 1;
    p.timers.attackCounter += 400;
  }
  invDelSlot(p.char.bag, slot - 1, 1);
  changed(p);
  return io.out;
}

// ---- equip and unequip -----------------------------------------------------------------

/** The Equip button: one unit moves into the derived slot. */
export function equipIntent(_ctx: ItemCtx, room: Room, p: Player, slot: number): Outgoing[] {
  const io = new ItemOut(room);
  const line = p.char.bag[slot - 1];
  // Items whose menu shows Cook/Mix/Build/Smith/Storage have no Equip button.
  if (paused(p) || !line || menuAction(line.item) !== "Equip") {
    return io.out;
  }
  const c = checkEquip(line.item, {
    str: p.char.stats.str,
    wanted: p.char.wanted,
    equip: p.char.equip,
  });
  if (!c.ok) {
    io.tell(p, c.text);
    return io.out;
  }
  p.char.equip[EQUIP_FIELD[c.slot]] = line.item;
  invDelSlot(p.char.bag, slot - 1, 1);
  changed(p);
  p.lookDirty = true;
  return io.out;
}

/** A click on the × beside an equipment box. */
export function unequipIntent(ctx: ItemCtx, room: Room, p: Player, slot: EquipSlot): Outgoing[] {
  const io = new ItemOut(room);
  const item = equipped(p.char.equip, slot);
  // The input lock, Ctrl's item-action pause and the empty slot exit first.
  if (paused(p) || lingoEq(item, NOTHING)) {
    return io.out;
  }
  const bag = p.char.bag;
  // `flinv`: no empty line and the bag text does not contain the name.
  if (filledLines(bag) >= bag.length && !lingoContains(bagText(bag), item)) {
    io.tell(p, EQUIP_TEXT.full);
    return io.out;
  }
  const r = invAdd(p.char, item, 1, ctx.rng);
  if (r.kind === "full") {
    // InvAdd found no exact stack and no line: nothing is written.
    return io.out;
  }
  p.char.equip[EQUIP_FIELD[slot]] = NOTHING;
  changed(p);
  p.lookDirty = true;
  return io.out;
}

// ---- drop ------------------------------------------------------------------------------

/**
 * Dropping a Pig: a live Pig is summoned on the faced tile. The checks run in 1.6's order, and the
 * Pig is gone before the summon's own tests, so a dropped pig can be lost (a kept 1.6 bug).
 */
function pigDrop(ctx: ItemCtx, room: Room, io: ItemOut, p: Player, slot: number): Outgoing[] {
  // Monster slots 1-4 all live (sprites 180-183; slot 5 is never counted).
  if (room.map.slots.every((s) => s.live !== null)) {
    io.tell(p, PIG_TEXT.crowded);
    return io.out;
  }
  const t = faced(p);
  // 1.6's fourth test repeats the x < 1 test, so there is no y < 1 test.
  if (t.x > MAP_WIDTH || t.x < 1 || t.y > MAP_HEIGHT) {
    return io.out;
  }
  if (blockedSubstring(p.vehicle ? room.map.walkAir : room.map.walk, t.x, t.y)) {
    io.tell(p, PIG_TEXT.blocked);
    return io.out;
  }
  // The Pig leaves the bag, then the summon runs. No pause is set here: 1.6's item-action pause and
  // modify flag are cleared by the reply's `inx`.
  invDelSlot(p.char.bag, slot - 1, 1);
  changed(p);
  io.out.push(...summonPig(room, t.x, t.y, ctx.rng).out);
  return io.out;
}

/** The Drop button: one unit onto the faced tile. */
export function dropIntent(ctx: ItemCtx, room: Room, p: Player, slot: number): Outgoing[] {
  const io = new ItemOut(room);
  const line = p.char.bag[slot - 1];
  // The bag takes no click while a window holds the keys.
  if (busy(p) || p.keyLock || !line) {
    return io.out;
  }
  const name = line.item;
  // The do-not-drop flag is cleared, then set by the house test for the six furniture items,
  // before Drop's pause gates: placed only where the header names you.
  p.headFlag = 0;
  if (isFurniture(name)) {
    p.headFlag = headDrop(0, p.map.title, p.name, p.guild);
    if (p.headFlag === 1) {
      io.tell(p, houseData.furnitureDrop.text);
      return io.out;
    }
  }
  // A Pig (exact name) comes before the locks, the vehicle tests and the mid-step test, so Pigs
  // drop during the item pause, mid-step and from an Airship (1.6 did the same).
  if (lingoEq(name, "Pig")) {
    return pigDrop(ctx, room, io, p, slot);
  }
  if (paused(p)) {
    return io.out;
  }
  // Crystals belong to the amount dialog.
  if (lingoContains(name, "Crystals")) {
    return io.out;
  }
  // Aboard an Airship nothing else leaves the bag. The gold and crystal dialogs never reach here,
  // so they still drop from the sky.
  if (p.vehicle) {
    io.tell(p, VEHICLE_TEXT.sky);
    return io.out;
  }
  if (p.stepFrames > 0) {
    return io.out; // mid-step: silent
  }
  // The four orbs go to 1.6's orb routine, which never matches and falls through.
  const t = faced(p);
  // The first item on the faced tile decides (sprites 158-177 in order): a house or guild vault, a
  // `Cabinet#`, `Crate#` or `Cauldron#`, the Gold, Steel, Water, Emerald or Dark Chest, or the
  // Vault takes the item; a Wind Chest or a plain "Crate" falls to "the floor is too crowded".
  const first = room.map.ground.find((g) => g.x === t.x && g.y === t.y);
  const route = first ? dropRoute(first) : null;
  if (route !== null && lingoEq(route, "Vault")) {
    io.out.push(...depositVault(p, slot));
    return io.out;
  }
  if (route !== null) {
    io.out.push(...depositContainer(ctx.world, p, slot, route));
    return io.out;
  }
  if (first) {
    io.tell(p, DROP_TEXT.crowded);
    return io.out;
  }
  if (t.x < 1 || t.x > MAP_WIDTH || t.y < 1 || t.y > MAP_HEIGHT) {
    return io.out; // off the screen: silent
  }
  if (!isWalkable(room.map.walk, t.x, t.y)) {
    io.tell(p, DROP_TEXT.blocked);
    return io.out;
  }
  // The Newspaper Kit needs the faced tile's layer-1 code `K2`, and the item put down is
  // `<owner>'s Newspaper`.
  let placed = name;
  if (lingoEq(name, "Newspaper Kit")) {
    if (!kitTileOk(room.map.layers[0], t.x, t.y)) {
      io.tell(p, NEWS_TEXT.noStand);
      return io.out;
    }
    placed = standName(p.name);
  }
  addGround(ctx, room, io, { item: placed, x: t.x, y: t.y, kind: "drop", expiresAt: null });
  invDelSlot(p.char.bag, slot - 1, 1);
  changed(p);
  return io.out;
}

// ---- give ------------------------------------------------------------------------------

/** The standing player on a tile, other than `p` (the sprite-pixel test). */
function playerOn(room: Room, p: Player, x: number, y: number): Player | null {
  return room.players.find((o) => o !== p && o.stepFrames === 0 && o.x === x && o.y === y) ?? null;
}

/**
 * A monster or NPC standing one, then two tiles ahead wins first (the give-to-NPC check; the gold
 * dialog's sprite-pixel test).
 */
function monsterAhead(room: Room, p: Player): boolean {
  return goldTarget(room, p) !== null;
}

/**
 * The Give button: one unit goes onto the target's tile, and the target grabs it 60 frames later.
 */
export function giveIntent(ctx: ItemCtx, room: Room, p: Player, slot: number): Outgoing[] {
  const io = new ItemOut(room);
  const line = p.char.bag[slot - 1];
  if (busy(p) || p.keyLock || !line || lingoContains(line.item, "Crystals")) {
    return io.out;
  }
  if (isFurniture(line.item)) {
    io.tell(p, GIVE_TEXT.cannot);
    return io.out;
  }
  // A monster or NPC one, then two tiles ahead takes it as a quest give.
  const npc = goldTarget(room, p)?.live?.name;
  if (npc !== undefined) {
    return [...io.out, ...questGive(ctx.world, p, slot - 1, npc, ctx.rng)];
  }
  const t = faced(p);
  const target = p.stepFrames === 0 ? playerOn(room, p, t.x, t.y) : null;
  if (!target) {
    io.tell(p, GIVE_TEXT.noOne);
    return io.out;
  }
  io.tell(p, GIVE_TEXT.offer(displayName(line.item), target.name));
  const g = addGround(ctx, room, io, {
    item: line.item,
    x: target.x,
    y: target.y,
    kind: "drop",
    expiresAt: null,
  });
  invDelSlot(p.char.bag, slot - 1, 1);
  changed(p);
  ctx.world.gives.push({
    at: ctx.world.tickNo + GIVE_GRAB_FRAMES,
    giver: p.id,
    giverName: p.name,
    target: target.id,
    mapId: room.map.id,
    groundId: g.id,
  });
  return io.out;
}

// ---- crystals --------------------------------------------------------------------------

/**
 * The crystal dialog's OK (C120): a player on the faced tile gets them, otherwise they are
 * dropped there (bug ledger "Drop on crystals while facing a player gives them").
 */
export function crystalsIntent(
  ctx: ItemCtx,
  room: Room,
  p: Player,
  slot: number,
  n: number,
): Outgoing[] {
  const io = new ItemOut(room);
  const line = p.char.bag[slot - 1];
  if (busy(p) || !line || !lingoContains(line.item, "Crystals")) {
    return io.out;
  }
  const t = faced(p);
  const target = p.stepFrames === 0 ? playerOn(room, p, t.x, t.y) : null;
  const pile = `${n} ${line.item}`;
  const path = amountPath({
    gold: false,
    enough: line.qty >= n,
    playerAhead: target !== null,
    monsterAhead: false,
  });
  if (path === "short") {
    // Before the path split, so a short drop also says this; the drop's own "…to drop!" test can
    // never fail after it.
    io.tell(p, GIVE_TEXT.notEnough);
    return io.out;
  }
  if (target) {
    io.tell(p, GIVE_TEXT.offerCrystals(target.name));
    const g = addGround(ctx, room, io, {
      item: pile,
      x: target.x,
      y: target.y,
      kind: "drop",
      expiresAt: null,
    });
    invDelSlot(p.char.bag, slot - 1, n);
    changed(p);
    // The give's grab goes at once for crystals.
    io.out.push(...receiveGive(ctx, room, target, g, p.name));
    return io.out;
  }
  if (p.stepFrames > 0) {
    return io.out;
  }
  if (room.map.ground.some((g) => g.x === t.x && g.y === t.y)) {
    io.tell(p, DROP_TEXT.crowded); // any item, no container redirect
    return io.out;
  }
  if (!isWalkable(room.map.walk, t.x, t.y)) {
    io.tell(p, DROP_TEXT.blocked); // no map-edge test on this path
    return io.out;
  }
  addGround(ctx, room, io, { item: pile, x: t.x, y: t.y, kind: "drop", expiresAt: null });
  invDelSlot(p.char.bag, slot - 1, n);
  changed(p);
  return io.out;
}

// ---- gold ------------------------------------------------------------------------------

/**
 * The gold dialog's OK. In order: the balance test for both paths; a standing player on the faced
 * tile gets a `"<n> Gold"` pile on their tile and grabs it at once; a monster or NPC one or two
 * tiles ahead gets the gold (a `MONSTER` list name exits silently); otherwise the pile is dropped
 * on the faced tile. The server takes the gold only when it has at least n; the amount is 1..9999
 * at the schema (1.6 let a negative amount add gold, which is closed).
 */
export function goldIntent(ctx: ItemCtx, room: Room, p: Player, n: number): Outgoing[] {
  const io = new ItemOut(room);
  if (busy(p)) {
    return io.out; // the give blocker is set
  }
  const t = faced(p);
  const pile = `${n} Gold`;
  const target = p.stepFrames === 0 ? playerOn(room, p, t.x, t.y) : null;
  const path = amountPath({
    gold: true,
    enough: p.char.gold >= n,
    playerAhead: target !== null,
    monsterAhead: monsterAhead(room, p),
  });
  if (path === "short") {
    io.tell(p, GIVE_TEXT.notEnoughGold);
    return io.out;
  }
  if (target) {
    io.tell(p, GIVE_TEXT.offerGold(n, target.name));
    const g = addGround(ctx, room, io, {
      item: pile,
      x: target.x,
      y: target.y,
      kind: "drop",
      expiresAt: null,
    });
    p.char.gold -= n;
    changed(p);
    // The grab goes at once; gold always passes the bag check.
    io.out.push(...receiveGive(ctx, room, target, g, p.name));
    return io.out;
  }
  if (path === "monster") {
    // Gold to an NPC: a name in the MONSTER list exits silently.
    io.out.push(...(giveGoldToNpc(ctx, room, p, n) ?? []));
    return io.out;
  }
  if (p.stepFrames > 0) {
    return io.out;
  }
  if (room.map.ground.some((g) => g.x === t.x && g.y === t.y)) {
    io.tell(p, DROP_TEXT.crowded); // any item, no container redirect
    return io.out;
  }
  if (!isWalkable(room.map.walk, t.x, t.y)) {
    io.tell(p, DROP_TEXT.blocked); // no map-edge test on this path
    return io.out;
  }
  addGround(ctx, room, io, { item: pile, x: t.x, y: t.y, kind: "drop", expiresAt: null });
  p.char.gold -= n;
  changed(p);
  return io.out;
}

// ---- pickup ----------------------------------------------------------------------------

/**
 * The pickup: every entry with the same name on that tile goes (1.6 did this, so picking up clears
 * every identical entry on the tile), then one is granted. Gold goes to the gold field; a crystal
 * pile becomes n crystals; with no empty line and no substring match of the name in the bag, the
 * item is destroyed. An immortal's counted `/drop` pile gives its count.
 */
export function grab(ctx: ItemCtx, room: Room, io: ItemOut, p: Player, g: GroundItem): void {
  for (const other of [...room.map.ground]) {
    if (other.x === g.x && other.y === g.y && lingoEq(other.item, g.item)) {
      removeGround(ctx, room, io, other.id);
    }
  }
  if (isGoldName(g.item)) {
    invAdd(p.char, g.item, 1, ctx.rng);
    changed(p);
    return;
  }
  const { item, qty } = pileToItem(g.item);
  const bag = p.char.bag;
  const room4 = filledLines(bag) < bag.length || lingoContains(bagText(bag), `${item}-`);
  if (!room4) {
    return;
  }
  // A counted `/drop` pile gives its count; every other pile gives 1.
  invAdd(p.char, item, qty * (g.qty ?? 1), ctx.rng);
  changed(p);
}

/** The click pre-check on a full bag (give side): gold always passes. */
function clickBagFull(p: Player, name: string): boolean {
  // The stack test overwrites the bag list first, so a stack never helps (bug ledger).
  return !isGoldName(name) && filledLines(p.char.bag) >= p.char.bag.length;
}

/**
 * The Assassin Statue: "You view the top Assassins of FSO...", a 20-frame item-action pause, then
 * the server's all-time and current tables as two chat blocks.
 */
function viewStatue(ctx: ItemCtx, io: ItemOut, p: Player): void {
  p.itemPause = STATUE_PAUSE;
  for (const line of statueLines(ctx.world)) {
    io.tell(p, line);
  }
}

/**
 * The High Score Statue: "You read the high score list...", a 20-frame item-action pause, then the
 * server's table as one chat entry.
 */
function viewScores(io: ItemOut, p: Player, world: World): void {
  p.itemPause = SCORES_PAUSE;
  io.tell(p, SCORES_TEXT);
  io.tell(p, scoresBlock(world.highScores));
}

/** Click or tap on a ground item (`ItemClick`). */
export function pickupIntent(ctx: ItemCtx, room: Room, p: Player, id: string): Outgoing[] {
  const io = new ItemOut(room);
  const g = room.map.ground.find((x) => x.id === id);
  if (paused(p)) {
    return io.out;
  }
  // Someone took it first: 1.6's server says the item is no longer there. 1.6's client had run its
  // own gates on the item it still drew; SSO's has nothing left to test.
  if (!g) {
    io.tell(p, PICKUP_TEXT.gone);
    return io.out;
  }
  // The house test on every click, never reset (1.6 did the same, so a room's own stations show
  // their text after a refusal elsewhere).
  p.headFlag = headDrop(p.headFlag, p.map.title, p.name, p.guild);
  // The personal vault.
  if (lingoEq(g.item, "Vault")) {
    return openVault(p, g);
  }
  const gate = clickGate(g.item, p.char.stats.str, p.headFlag);
  if (gate.kind === "silent") {
    return io.out;
  }
  // The airship click: board it or say whose it is; silent aboard.
  if (gate.kind === "airship") {
    return airshipClick(ctx, room, p, g);
  }
  // A container: a 40-frame item-action pause, then the chest click, whose open ends the pause.
  if (gate.kind === "open") {
    p.itemPause = houseData.containers.clickPause;
    return openContainer(ctx.world, p, g);
  }
  if (gate.kind === "switch") {
    switchClick(ctx, room, io, p, g, gate.state);
    return io.out;
  }
  if (gate.kind === "text") {
    io.tell(p, gate.text);
    return io.out;
  }
  if (gate.kind === "statue") {
    viewStatue(ctx, io, p);
    return io.out;
  }
  if (gate.kind === "scores") {
    viewScores(io, p, ctx.world);
    return io.out;
  }
  // The casino tables after the click's pause.
  if (gate.kind === "casino") {
    p.itemPause = houseData.containers.clickPause;
    if (gate.game === "slots") {
      io.out.push(...slotOpen(p, g));
    } else if (gate.game === "blackjack") {
      io.out.push(...bjSit(ctx.world, p, g));
    } else {
      io.out.push(...ckSit(ctx.world, p, g));
    }
    return io.out;
  }
  // The Guild Center click after the click's 40-frame item-action pause.
  if (gate.kind === "guildCenter") {
    p.itemPause = houseData.containers.clickPause;
    io.out.push(...guildCenterClick(ctx.world, p, g));
    return io.out;
  }
  // A mailbox (the owner's or another's) after the click's pause, and a board (the hall's own pause
  // is set inside).
  if (gate.kind === "mail") {
    p.itemPause = houseData.containers.clickPause;
    if (ctx.mail) {
      io.out.push(...mailOpen(p, g, gate.universal, ctx.mail));
    }
    return io.out;
  }
  if (gate.kind === "board") {
    if (ctx.boards) {
      io.out.push(...boardOpen(p, g, "click", ctx.boards));
    }
    return io.out;
  }
  // A newspaper stand and a painting or photo, from any distance.
  if (gate.kind === "newspaper") {
    if (ctx.newspapers && ctx.art) {
      io.out.push(...readNewspaper(p, g.item, ctx.newspapers, ctx.art));
    }
    return io.out;
  }
  if (gate.kind === "view") {
    if (ctx.art) {
      io.out.push(...viewArt(p, g.item, ctx.art, "click"));
    }
    return io.out;
  }
  const name = displayName(g.item);
  if (clickBagFull(p, g.item)) {
    io.tell(p, PICKUP_TEXT.full(name));
    return io.out;
  }
  // Orthogonally adjacent, by sprite pixel: never mid-step, never your own tile.
  const adjacent = p.stepFrames === 0 && Math.abs(g.x - p.x) + Math.abs(g.y - p.y) === 1;
  if (!adjacent) {
    io.tell(p, PICKUP_TEXT.notAdjacent(name));
    return io.out;
  }
  grab(ctx, room, io, p, g);
  return io.out;
}

/** Ctrl: the faced tile's first item. */
/** Which numbered sign a ground item is, ignoring case, or null. */
export function signNumber(name: string): 1 | 2 | 3 | null {
  return lingoEq(name, "Sign 1")
    ? 1
    : lingoEq(name, "Sign 2")
      ? 2
      : lingoEq(name, "Sign 3")
        ? 3
        : null;
}

export function actionIntent(ctx: ItemCtx, room: Room, p: Player): Outgoing[] {
  const io = new ItemOut(room);
  // The click timer and the item-action pause gate Ctrl to one action per 40 frames.
  if (ctrlPaused(p)) {
    return io.out;
  }
  p.itemPause = 40;
  // Aboard an Airship Ctrl only ever tries to unboard, never picks anything up: a pig or an item in
  // front is ignored.
  if (p.vehicle) {
    return unboardAirship(ctx, room, p);
  }
  // A Pig or Snow Demon on the faced tile is grabbed first.
  const pig = ctrlPig(room, p, ctx.rng);
  if (pig) {
    io.out.push(...pig.out);
    if (pig.slotsChanged) {
      ctx.slotsChanged?.(room.map);
    }
    return io.out;
  }
  if (p.stepFrames > 0) {
    return io.out;
  }
  const t = faced(p);
  const g = room.map.ground.find((x) => x.x === t.x && x.y === t.y);
  if (!g) {
    return io.out;
  }
  // A sign shows its text: map field 14-16.
  const sign = signNumber(g.item);
  if (sign) {
    io.out.push({ to: p.id, msg: { t: "sign", n: sign } });
    return io.out;
  }
  // The personal vault.
  if (lingoEq(g.item, "Vault")) {
    io.out.push(...openVault(p, g));
    return io.out;
  }
  const gate = ctrlGate(g.item);
  // The airship click on the faced Airship.
  if (gate.kind === "airship") {
    return airshipClick(ctx, room, p, g);
  }
  // Chests, house and guild vaults, cabinets, crates and the Cauldron open; the switches flip.
  if (gate.kind === "open") {
    io.out.push(...openContainer(ctx.world, p, g));
    return io.out;
  }
  if (gate.kind === "switch") {
    switchClick(ctx, room, io, p, g, gate.state);
    return io.out;
  }
  if (gate.kind === "statue") {
    viewStatue(ctx, io, p);
    return io.out;
  }
  if (gate.kind === "scores") {
    viewScores(io, p, ctx.world);
    return io.out;
  }
  if (gate.kind === "casino") {
    if (gate.game === "slots") {
      io.out.push(...slotOpen(p, g));
    } else if (gate.game === "blackjack") {
      io.out.push(...bjSit(ctx.world, p, g));
    } else {
      io.out.push(...ckSit(ctx.world, p, g));
    }
    return io.out;
  }
  // `GuildCenterClick` on the faced Center.
  if (gate.kind === "guildCenter") {
    io.out.push(...guildCenterClick(ctx.world, p, g));
    return io.out;
  }
  // The faced mailbox or board.
  if (gate.kind === "mail") {
    if (ctx.mail) {
      io.out.push(...mailOpen(p, g, gate.universal, ctx.mail));
    }
    return io.out;
  }
  if (gate.kind === "board") {
    if (ctx.boards) {
      io.out.push(...boardOpen(p, g, "ctrl", ctx.boards));
    }
    return io.out;
  }
  // The faced newspaper stand.
  if (gate.kind === "newspaper") {
    if (ctx.newspapers && ctx.art) {
      io.out.push(...readNewspaper(p, g.item, ctx.newspapers, ctx.art));
    }
    return io.out;
  }
  if (gate.kind !== "take") {
    if (gate.kind === "text") {
      io.tell(p, gate.text);
      if (gate.unpause) {
        p.itemPause = 0; // the Street Lamp clears the item-action pause
      }
    }
    return io.out;
  }
  if (!isGoldName(g.item) && filledLines(p.char.bag) >= p.char.bag.length) {
    // Ctrl tests the bag for "<name>-" correctly.
    const search = `${pileToItem(g.item).item}-`;
    if (!lingoContains(bagText(p.char.bag), search)) {
      io.tell(p, PICKUP_TEXT.full(g.item));
      return io.out;
    }
  }
  grab(ctx, room, io, p, g);
  return io.out;
}

/**
 * The target's side of a give: the click bag check, then the pickup with no adjacency test. A
 * refused give stays on the ground.
 */
export function receiveGive(
  ctx: ItemCtx,
  room: Room,
  target: Player,
  g: GroundItem,
  giverName: string,
): Outgoing[] {
  const io = new ItemOut(room);
  // 1.6 prints this first, before the ground and bag checks, with the name as the client stored it:
  // a painting's `#` number stays (a kept 1.6 bug), gold reads "a 50 Gold".
  io.tell(target, GIVE_TEXT.receiving(giverName, g.item));
  if (!room.map.ground.includes(g) || clickBagFull(target, g.item)) {
    return io.out;
  }
  grab(ctx, room, io, target, g);
  return io.out;
}

/** Gives whose 60 frames are up. */
export function dueGives(ctx: ItemCtx): Outgoing[] {
  const w = ctx.world;
  const out: Outgoing[] = [];
  const due = w.gives.filter((g) => g.at <= w.tickNo);
  w.gives = w.gives.filter((g) => g.at > w.tickNo);
  for (const give of due) {
    const target = w.players.get(give.target);
    if (!target || target.map.id !== give.mapId) {
      continue;
    }
    const room = w.rooms.get(target.map.name);
    const g = room?.map.ground.find((x) => x.id === give.groundId);
    if (room && g) {
      out.push(...receiveGive(ctx, room, target, g, give.giverName));
    }
  }
  return out;
}

/** Loot whose time is up, on the maps that are loaded. */
export function decayLoot(ctx: ItemCtx): Outgoing[] {
  const out: Outgoing[] = [];
  for (const room of ctx.world.rooms.values()) {
    const expired = room.map.ground.filter((g) => g.expiresAt !== null && g.expiresAt <= ctx.now);
    if (expired.length === 0) {
      continue;
    }
    const io = new ItemOut(room);
    for (const g of expired) {
      removeGround(ctx, room, io, g.id);
    }
    out.push(...io.out);
  }
  return out;
}

/** A ground item blocks the player's step. */
export function groundBlocks(room: Room, p: Player, x: number, y: number): boolean {
  return room.map.ground.some(
    (g) =>
      g.x === x &&
      g.y === y &&
      blocksPlayer(g.item, { level: p.char.vitals.level, skills: p.char.skills }),
  );
}

export { USE_TEXT };
