/**
 * Shop, bank and gold-to-NPC intents on the server. Each runs the original client's gates, then the
 * server's handler, against server state. The NPC is the one whose Bio you opened, and it must
 * still be in your map's roster (SSO checks the map's roster, not what the client says).
 */
import { content, displayName, lingoEq, promoteClass } from "@secondstaronline/shared";

import { type Holdings, holdingsOf, logActivity, logBagChange } from "../admin/activity.ts";
import type { ItemCtx } from "../inventory/items.ts";
import { goldTarget, inMonsterList, NPC_TEXT } from "../monsters/npc.ts";
import { type NpcStore, npcData, npcFileNamed } from "../monsters/npcfiles.ts";
import type { Outgoing, Player, Room, WorldMap } from "../world/world.ts";
import { BANK_TEXT, parseBank, runBank } from "./bank.ts";
import { buyList, npcBuy, npcSell, SHOP_TEXT, type ShopLedger, sellList } from "./shop.ts";

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

/** The NPC is one of the map's four roster entries, alive or not. */
export function inRoster(map: WorldMap, npc: string): boolean {
  return map.slots.some((s) => s.species !== null && lingoEq(s.species, npc));
}

/**
 * The Bio window's Buy or Sell: the button's scripted close does not run the window's
 * `closeWindow`, so the click's input lock holds until CANCEL (measured on the running 1.6). The
 * list opens; every line is listed.
 */
export function shopListIntent(
  ctx: ItemCtx,
  p: Player,
  mode: "buy" | "sell" | "train",
): Outgoing[] {
  const bio = p.bio;
  if (!bio) {
    return [];
  }
  p.bio = null; // the keys stay locked: no `closeWindow`
  const shop = ctx.shop?.(bio.npc) ?? null;
  if (!shop) {
    return [];
  }
  const data = npcData(ctx.world.npcs, bio.npc);
  const lines = !data
    ? 0
    : mode === "buy"
      ? data.sells.length
      : mode === "sell"
        ? data.buys.length
        : data.trains.length;
  if (!data || lines === 0) {
    return [];
  }
  p.shop = { npc: bio.npc, mode };
  // The list replaces the vault's list in the same window (sprites 210-219).
  p.vaultOpen = false;
  if (mode === "train") {
    // Every TRN| line is listed; the price is the line's.
    const rows = data.trains.map((t) => ({ line: t.line, item: t.cls, price: t.price }));
    return [{ to: p.id, msg: { t: "shop", mode, rows } }];
  }
  // An NPC shop leaves out a retired item its saved ledger still lists (see `buyIntent`).
  const npcShop = !ctx.world.playerShops.has(shop.npc.toLowerCase());
  const rows =
    mode === "buy"
      ? sellList(shop).filter((r) => !(npcShop && content().item(r.item)?.retired))
      : buyList(shop);
  return [{ to: p.id, msg: { t: "shop", mode, rows } }];
}

/** The open shop's ledger, when its NPC is still in your map's roster. */
function openShop(ctx: ItemCtx, p: Player, mode: "buy" | "sell"): ShopLedger | null {
  const s = p.shop;
  if (!s || s.mode !== mode || !inRoster(p.map, s.npc)) {
    return null;
  }
  return ctx.shop?.(s.npc) ?? null;
}

function keep(ctx: ItemCtx, shop: ShopLedger): void {
  ctx.world.shops.set(shop.npc, shop);
}

const processed = (p: Player, ok = false): Outgoing => ({
  to: p.id,
  msg: ok ? { t: "processed", ok } : { t: "processed" },
});

/** A container's stored lines, matched by name ignoring case. */
function storedLines(ctx: ItemCtx, name: string): string[] {
  for (const [k, v] of ctx.world.containers) {
    if (lingoEq(k, name)) {
      return v;
    }
  }
  return [];
}

/** A container id that already has storage or sits in an online player's bag. */
function containerInUse(ctx: ItemCtx, name: string): boolean {
  for (const k of ctx.world.containers.keys()) {
    if (lingoEq(k, name)) {
      return true;
    }
  }
  for (const o of ctx.world.players.values()) {
    if (o.char.bag.some((l) => l !== null && lingoEq(l.item, name))) {
      return true;
    }
  }
  return false;
}

/**
 * Logs what a shop sale or purchase moved, as the bag and gold changed: a player's shop names its
 * owner (their timeline gets the sale through the till), an NPC's names the NPC. An item sold to a
 * player's shop that has no line to stock it is gone (`lost`, issue #35).
 */
function logShop(
  ctx: ItemCtx,
  p: Player,
  npc: string,
  mode: "buy" | "sell",
  before: Holdings,
  stock?: { before: ShopLedger; after: ShopLedger },
) {
  const ps = ctx.world.playerShops.get(npc.toLowerCase());
  const owner = ps ? ctx.world.houses.get(ps.interior)?.ownerName : undefined;
  const stocked = (l: ShopLedger, item: string) =>
    l.lines
      .filter((x) => x.kind === "SEL" && lingoEq(displayName(x.item), displayName(item)))
      .reduce((n, x) => n + (x.stock ?? 0), 0);
  logBagChange(
    ctx.world,
    p,
    ps ? "playerShop" : mode,
    before,
    holdingsOf(p.char),
    {
      other: ps && owner ? { id: ps.ownerId, name: owner } : npc,
      details: ps ? { shop: npc, mode } : null,
    },
    (item, n) => {
      if (!ps || !stock || n >= 0) {
        return null;
      }
      const lost = -n - (stocked(stock.after, item) - stocked(stock.before, item));
      return lost > 0 ? { lost } : null;
    },
  );
}

function forgetContainer(ctx: ItemCtx, name: string): void {
  for (const k of [...ctx.world.containers.keys()]) {
    if (lingoEq(k, name)) {
      ctx.world.containers.delete(k);
      ctx.world.containersDirty.add(k);
    }
  }
}

/** The buy OK. */
export function buyIntent(ctx: ItemCtx, p: Player, line: number, count: number): Outgoing[] {
  const shop = openShop(ctx, p, "buy");
  if (!shop) {
    return [];
  }
  // No NPC shop sells a retired item, though a ledger saved before a pack retired it may still
  // list one (Merius' Damaged Armor). A player shop's stock is copies players own, sold as in a
  // trade.
  const sel = shop.lines.find((l) => l.line === line && l.kind === "SEL");
  if (
    sel &&
    !ctx.world.playerShops.has(shop.npc.toLowerCase()) &&
    content().item(sel.item)?.retired
  ) {
    return [tell(p, SHOP_TEXT.outOfStock(shop.npc)), processed(p)];
  }
  const r = npcBuy(shop, line, count, { gold: p.char.gold, bag: p.char.bag }, ctx.rng, (n) =>
    containerInUse(ctx, n),
  );
  if (!r.ok) {
    return [tell(p, r.text), processed(p)];
  }
  keep(ctx, r.ledger);
  const before = holdingsOf(p.char);
  p.char.gold = r.buyer.gold;
  p.char.bag = r.buyer.bag;
  p.invDirty = true;
  logShop(ctx, p, shop.npc, "buy", before);
  return [...r.texts.map((t) => tell(p, t)), processed(p, true)];
}

/** The sell OK. */
export function sellIntent(ctx: ItemCtx, p: Player, line: number, count: number): Outgoing[] {
  const shop = openShop(ctx, p, "sell");
  if (!shop) {
    return [];
  }
  const r = npcSell(
    shop,
    line,
    count,
    { gold: p.char.gold, bag: p.char.bag },
    (n) => storedLines(ctx, n).length,
  );
  if (!r.ok) {
    return [tell(p, r.text), processed(p)];
  }
  keep(ctx, r.ledger);
  if (r.soldContainer !== undefined) {
    // An empty container sold: its storage row goes with it.
    forgetContainer(ctx, r.soldContainer);
  }
  const before = holdingsOf(p.char);
  p.char.gold = r.buyer.gold;
  p.char.bag = r.buyer.bag;
  p.invDirty = true;
  logShop(ctx, p, shop.npc, "sell", before, { before: shop, after: r.ledger });
  return [...r.texts.map((t) => tell(p, t)), processed(p, true)];
}

/**
 * The train OK: the list's NPC must still be in the map's roster and the file line a `TRN|` line,
 * else nothing is sent (no line) or just `processed`. `promoteClass` has 1.6's checks and texts; a
 * promotion changes the class (and with it the class's stat points), gold and granted skills and
 * plays `heal2` on channel 3 to the buyer.
 */
export function trainIntent(
  ctx: ItemCtx,
  p: Player,
  line: number,
): { out: Outgoing[]; result: PromotionApplied | null } {
  const s = p.shop;
  if (!s || s.mode !== "train" || !inRoster(p.map, s.npc)) {
    return { out: [], result: null };
  }
  const train = npcData(ctx.world.npcs, s.npc)?.trains.find((t) => t.line === line);
  if (!train) {
    return { out: [processed(p)], result: null };
  }
  const c = p.char;
  const r = promoteClass(
    {
      classCode: c.classCode,
      gold: c.gold,
      hpMax: c.vitals.hpMax,
      spMax: c.vitals.spMax,
      skills: c.skills,
    },
    train.cls,
    train.price,
    s.npc,
    ctx.rng,
  );
  const out: Outgoing[] = r.texts.map((t) => tell(p, t));
  if (r.result) {
    if (r.result.gold !== c.gold) {
      logActivity(ctx.world, p, "pay", {
        other: s.npc,
        gold: r.result.gold - c.gold,
        details: { train: train.cls },
      });
    }
    c.classCode = r.result.classCode;
    c.gold = r.result.gold;
    c.vitals.spMax = r.result.spMax;
    c.skills = [...r.result.skills];
    p.invDirty = true;
    p.vitalsDirty = true;
  }
  if (r.sound) {
    out.push({ to: p.id, msg: { t: "sound", name: "heal2", ch: 3 } });
  }
  out.push(processed(p));
  return { out, result: r.result };
}

/** What a promotion changed, for the write-through. */
export type PromotionApplied = NonNullable<ReturnType<typeof promoteClass>["result"]>;

/** CANCEL: the keys are unlocked; the shop and vault lists close. */
export function shopCancelIntent(p: Player): void {
  p.keyLock = false;
  p.shop = null;
  p.vaultOpen = false;
  p.container = null;
}

/**
 * A living banker (an NPC whose data contains `BNK|`) stands on the map. 1.6 read the roster loaded
 * with the map, so a banker that had not spawned or had died still kept the bank open.
 */
export function canBank(npcs: NpcStore, map: WorldMap): boolean {
  return map.slots.some(
    (s) => s.species !== null && s.live !== null && npcData(npcs, s.species)?.banker === true,
  );
}

/** `/balance`, `/deposit`, `/withdraw`. */
export function bankChat(npcs: NpcStore, p: Player, text: string): Outgoing[] {
  const cmd = parseBank(text);
  if (!cmd) {
    return [];
  }
  if (!canBank(npcs, p.map)) {
    return [tell(p, BANK_TEXT.cannot)];
  }
  const r = runBank(cmd, p.char.gold, p.char.bank);
  if (r.bank !== p.char.bank || r.gold !== p.char.gold) {
    p.char.storeDirty = true;
  }
  if (r.gold !== p.char.gold) {
    p.invDirty = true;
  }
  p.char.gold = r.gold;
  p.char.bank = r.bank;
  return [tell(p, r.text)];
}

/**
 * The gold dialog's NPC branch. Returns null when no slot stands one or two tiles ahead (the drop
 * goes on). A name in the `MONSTER` list exits silently. Otherwise: the client's offer line; the
 * server takes the gold (silently refusing a short balance), says "Thanks for the gold!" to you
 * alone, and adds the gold to the NPC's till. The Stripper morph is omitted (it never worked in 1.6: no art, no NPC file, no map placed
 * one).
 */
export function giveGoldToNpc(ctx: ItemCtx, room: Room, p: Player, n: number): Outgoing[] | null {
  const slot = goldTarget(room, p);
  const name = slot?.live?.name;
  if (!slot || !name) {
    return null;
  }
  if (inMonsterList(name)) {
    return [];
  }
  const out = [tell(p, NPC_TEXT.offerGold(n, name))];
  if (p.char.gold - n < 0) {
    return out;
  }
  const shop = npcFileNamed(ctx.world.npcs, name) ? (ctx.shop?.(name) ?? null) : null;
  // A player's shopkeeper keeps the gift in a till the item reconciliation counts, so it moves
  // there; an ordinary NPC's till is not counted, so the gold is paid away (issue #35).
  const tilled = shop !== null && ctx.world.playerShops.has(name.toLowerCase());
  logActivity(ctx.world, p, tilled ? "playerShop" : "pay", {
    other: name,
    gold: -n,
    details: tilled ? { till: true, gift: true } : null,
  });
  p.char.gold -= n;
  p.invDirty = true;
  out.push(tell(p, NPC_TEXT.thanksGold(name)));
  // The gift goes into the NPC's till, which starts at 0 without a GLD| line (1.6 kept it only
  // with a GLD| line among the first 60).
  if (shop) {
    keep(ctx, { ...shop, gold: (shop.gold ?? 0) + n, dirty: true });
  }
  return out;
}
