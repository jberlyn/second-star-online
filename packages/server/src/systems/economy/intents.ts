/**
 * Shop, bank and gold-to-NPC intents on the server. Each runs the original client's gates, then the
 * server's handler, against server state. The NPC is the one whose Bio you opened, and it must
 * still be in your map's roster (SSO checks the map's roster, not what the client says).
 */
import { lingoEq, NPC_WINDOW, promoteClass } from "@secondstaronline/shared";

import type { ItemCtx } from "../inventory/items.ts";
import { goldTarget, inMonsterList, NPC_TEXT } from "../monsters/npc.ts";
import { type NpcStore, npcData, npcFileNamed } from "../monsters/npcfiles.ts";
import type { Outgoing, Player, Room, WorldMap } from "../world/world.ts";
import { BANK_TEXT, parseBank, runBank } from "./bank.ts";
import { buyList, npcBuy, npcSell, type ShopLedger, sellList } from "./shop.ts";

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
  const rows = mode === "buy" ? sellList(shop) : buyList(shop);
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

/** The buy OK. */
export function buyIntent(ctx: ItemCtx, p: Player, line: number, count: number): Outgoing[] {
  const shop = openShop(ctx, p, "buy");
  if (!shop) {
    return [];
  }
  const r = npcBuy(shop, line, count, { gold: p.char.gold, bag: p.char.bag }, ctx.rng);
  if (!r.ok) {
    return [tell(p, r.text), processed(p)];
  }
  keep(ctx, r.ledger);
  p.char.gold = r.buyer.gold;
  p.char.bag = r.buyer.bag;
  p.invDirty = true;
  return [...r.texts.map((t) => tell(p, t)), processed(p, true)];
}

/** The sell OK. */
export function sellIntent(ctx: ItemCtx, p: Player, line: number, count: number): Outgoing[] {
  const shop = openShop(ctx, p, "sell");
  if (!shop) {
    return [];
  }
  const r = npcSell(shop, line, count, { gold: p.char.gold, bag: p.char.bag });
  if (!r.ok) {
    return [tell(p, r.text), processed(p)];
  }
  keep(ctx, r.ledger);
  p.char.gold = r.buyer.gold;
  p.char.bag = r.buyer.bag;
  p.invDirty = true;
  return [...r.texts.map((t) => tell(p, t)), processed(p, true)];
}

/**
 * The train OK: the list's NPC must still be in the map's roster and the file line a `TRN|` line,
 * else nothing is sent (no line) or just `processed`. `promoteClass` has 1.6's checks and texts; a
 * promotion changes the class, gold and stats and plays `heal2` on channel 3 to the buyer.
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
      stats: c.stats,
    },
    train.cls,
    train.price,
    s.npc,
  );
  const out: Outgoing[] = r.texts.map((t) => tell(p, t));
  if (r.result) {
    c.classCode = r.result.classCode;
    c.gold = r.result.gold;
    c.vitals.spMax = r.result.spMax;
    c.stats = { ...r.result.stats };
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

/** The map's roster has an NPC whose data contains `BNK|`. */
export function canBank(npcs: NpcStore, map: WorldMap): boolean {
  return map.slots.some((s) => s.species !== null && npcData(npcs, s.species)?.banker === true);
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
  return r.text === null ? [] : [tell(p, r.text)];
}

/**
 * The gold dialog's NPC branch. Returns null when no slot stands one or two tiles ahead (the drop
 * goes on). A name in the `MONSTER` list exits silently. Otherwise: the client's offer line; the
 * server takes the gold (silently refusing a short balance), says "Thanks for the gold!" without
 * its closing quote to you alone, and adds the gold to every `GLD|` line of the NPC's first 60
 * lines. The Stripper morph is omitted (it never worked in 1.6: no art, no NPC file, no map placed
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
  p.char.gold -= n;
  p.invDirty = true;
  out.push(tell(p, NPC_TEXT.thanksGold(name)));
  const shop = npcFileNamed(ctx.world.npcs, name) ? (ctx.shop?.(name) ?? null) : null;
  // Only a `GLD|` line among the first 60 takes the gift; further down it is lost.
  if (shop && shop.gold !== null && (shop.goldLine ?? 0) <= NPC_WINDOW.giftGold) {
    keep(ctx, { ...shop, gold: shop.gold + n, dirty: true });
  }
  return out;
}
