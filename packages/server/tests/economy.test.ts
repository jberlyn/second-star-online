/** Golden tests: NPC shops, the bank, the personal vault, gold to NPCs and trade. */
import { describe, expect, test } from "bun:test";

import { type Bag, emptyBag } from "@secondstaronline/shared";

import { BANK_TEXT, parseBank, runBank } from "../src/systems/economy/bank.ts";
import { bankChat, canBank, inRoster } from "../src/systems/economy/intents.ts";
import {
  ledgerFromTemplate,
  npcBuy,
  npcSell,
  SHOP_TEXT,
  type ShopLedger,
  sellList,
  sellName,
} from "../src/systems/economy/shop.ts";
import {
  depositVault,
  openVault,
  VAULT_TEXT,
  withdrawVault,
} from "../src/systems/economy/vault.ts";
import { npcFileNamed } from "../src/systems/monsters/npcfiles.ts";
import { ARCHIVE_NPCS, player, rngByN, testMap } from "./helpers/sim.ts";

const shop = (name: string): ShopLedger => {
  const t = npcFileNamed(ARCHIVE_NPCS, name);
  if (!t) {
    throw new Error(name);
  }
  return ledgerFromTemplate(t);
};
const bag = (...lines: [string, number][]): Bag => {
  const b = emptyBag();
  lines.forEach(([item, qty], i) => {
    b[i] = { item, qty };
  });
  return b;
};
const full = (filler = "Rock"): Bag =>
  bag(...Array.from({ length: 15 }, (_, i): [string, number] => [`${filler}${i}`, 1]));
const stock = (s: ShopLedger, line: number) => s.lines.find((l) => l.line === line)?.stock;
const rng = rngByN();

describe("NPC shops: buying", () => {
  test("price × count from the line, charged from GLD into the NPC's gold", () => {
    const s = shop("Akadius");
    const r = npcBuy(s, 4, 2, { gold: 200, bag: emptyBag() }, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.buyer.gold).toBe(60);
    expect(r.buyer.bag[0]).toEqual({ item: "Raw Fish", qty: 2 });
    expect(r.ledger.gold).toBe(294825 + 140);
    expect(stock(r.ledger, 4)).toBe(11537);
    expect(r.texts).toEqual(['Akadius says "Thanks for the business!"']);
    // The shown ledger is unchanged until the caller keeps the result.
    expect(stock(s, 4)).toBe(11539);
  });

  test("bug fixed: each bought container gets its own line and its own unused id", () => {
    const s: ShopLedger = {
      npc: "Test",
      gold: 1000,
      lines: [{ line: 1, kind: "SEL", item: "Crate", price: 15, stock: 10 }],
      dirty: false,
    };
    // 4242 is taken by another container, and the second roll repeats the first crate's id.
    const ids = rngByN({ 999999: [4242, 11, 11, 12] });
    const r = npcBuy(s, 1, 3, { gold: 100, bag: emptyBag() }, ids, (n) => n === "Crate#4242");
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.buyer.bag.filter((l) => l !== null)).toEqual([
      { item: "Crate#11", qty: 1 },
      { item: "Crate#12", qty: 1 },
      { item: expect.stringMatching(/^Crate#\d+$/), qty: 1 },
    ]);
    expect(new Set(r.buyer.bag.filter((l) => l !== null).map((l) => l?.item)).size).toBe(3);
    expect(r.buyer.gold).toBe(55);
    expect(stock(r.ledger, 1)).toBe(7);
    // Three crates need three empty lines.
    const two = full();
    two[0] = null;
    two[1] = null;
    expect(npcBuy(s, 1, 3, { gold: 100, bag: two }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.noRoom,
    });
  });

  test("short of price × count: 'You don't have enough gold to buy this!'", () => {
    expect(npcBuy(shop("Akadius"), 4, 2, { gold: 139, bag: emptyBag() }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.cannotAfford,
    });
  });

  test("a full bag is refused unless it holds a stack of exactly that item", () => {
    expect(npcBuy(shop("Amber"), 8, 1, { gold: 100, bag: full() }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.noRoom,
    });
  });

  test("bug fixed: a full bag holding 'Orc Pot Pie' has no room for a 'Pie'; nothing changes", () => {
    const b = full();
    b[3] = { item: "Orc Pot Pie", qty: 1 };
    expect(npcBuy(shop("Amber"), 8, 1, { gold: 100, bag: b }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.noRoom,
    });
    // A Pie stack is room.
    b[4] = { item: "Pie", qty: 1 };
    const r = npcBuy(shop("Amber"), 8, 1, { gold: 100, bag: b }, rng);
    expect(r.ok && r.buyer.bag[4]).toEqual({ item: "Pie", qty: 2 });
    expect(r.ok && r.buyer.gold).toBe(90);
  });

  test("bug fixed: count over stock names the shopkeeper", () => {
    expect(npcBuy(shop("Fire God"), 1, 99, { gold: 99999, bag: emptyBag() }, rng)).toEqual({
      ok: false,
      text: `Fire God says "Sorry but I'm out of that particular item."`,
    });
  });

  test("bug fixed: a shopkeeper with no GLD line charges the price into a till that starts at 0", () => {
    expect(shop("Fire God").gold).toBe(0);
    const r = npcBuy(shop("Fire God"), 1, 1, { gold: 150, bag: emptyBag() }, rng);
    expect(r.ok && r.buyer.gold).toBe(50);
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "Fireball Book", qty: 1 });
    expect(r.ok && stock(r.ledger, 1)).toBe(97);
    expect(r.ok && r.ledger.gold).toBe(100);
    expect(npcBuy(shop("Fire God"), 1, 1, { gold: 99, bag: emptyBag() }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.cannotAfford,
    });
  });

  test("bug fixed: the Fortress Guild Hall Deed (Smithy line 17) can be bought", () => {
    const s = shop("Smithy");
    const r = npcBuy(s, 17, 1, { gold: 200000, bag: emptyBag() }, rng);
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "Fortress Guild Hall Deed", qty: 1 });
    expect(r.ok && r.buyer.gold).toBe(100000);
    expect(r.ok && stock(r.ledger, 17)).toBe(299999);
    expect(stock(s, 17)).toBe(300000);
  });

  test("Plone's line-17 White Crystals sell", () => {
    const r = npcBuy(shop("Plone"), 17, 3, { gold: 100, bag: emptyBag() }, rng);
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "White Crystals", qty: 3 });
    expect(r.ok && r.buyer.gold).toBe(100 - 78);
  });

  test("buying Picha1's apple onto an Apple stack renames it apple", () => {
    const r = npcBuy(shop("Picha1"), 7, 1, { gold: 5, bag: bag(["Apple", 2]) }, rng);
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "apple", qty: 3 });
  });

  test("a match on line 16 buys normally", () => {
    const s = shop("Akadius");
    const at = s.lines.find((l) => l.line === 16);
    expect(at?.item).toBe("Fishing Pole");
    const r = npcBuy(s, 16, 1, { gold: 100000, bag: emptyBag() }, rng);
    expect(r.ok).toBe(true);
    expect(r.ok && stock(r.ledger, 16)).toBe((at?.stock ?? 0) - 1);
  });

  test("buying Trout takes only Trout's stock, not Trout Fillet's", () => {
    const r = npcBuy(shop("Akadius"), 8, 1, { gold: 100, bag: emptyBag() }, rng);
    expect(r.ok && stock(r.ledger, 8)).toBe(12823);
    expect(r.ok && stock(r.ledger, 10)).toBe(15037);
  });

  test("every SEL line is listed", () => {
    expect(sellList(shop("Smithy")).map((r) => r.line)).toEqual([5, 7, 9, 11, 13, 15, 17]);
  });
});

describe("NPC shops: selling", () => {
  test("pays the BUY price from GLD, takes the count, returns the stock and thanks", () => {
    const r = npcSell(shop("Akadius"), 5, 2, { gold: 0, bag: bag(["Raw Fish", 3]) });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.buyer.gold).toBe(50);
    expect(r.buyer.bag[0]).toEqual({ item: "Raw Fish", qty: 1 });
    expect(stock(r.ledger, 4)).toBe(11541);
    expect(r.ledger.gold).toBe(294825 - 50);
    expect(r.texts).toEqual(['Akadius says "Thanks for the business!"']);
  });

  test("selling to Picha1 from a Long Sword stack renames it long sword", () => {
    const r = npcSell(shop("Picha1"), 6, 1, { gold: 0, bag: bag(["Long Sword", 3]) });
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "long sword", qty: 2 });
  });

  test("bug fixed: selling Trout restocks only Trout and thanks once", () => {
    const r = npcSell(shop("Akadius"), 9, 1, { gold: 0, bag: bag(["Trout", 1]) });
    expect(r.ok && r.texts).toEqual(['Akadius says "Thanks for the business!"']);
    expect(r.ok && stock(r.ledger, 8)).toBe(12825);
    expect(r.ok && stock(r.ledger, 10)).toBe(15037);
    expect(r.ok && r.buyer.bag[0]).toBeNull();
  });

  test("bug fixed: a sale to a shopkeeper who does not stock the item is thanked too", () => {
    const r = npcSell(shop("Kanta"), 11, 1, { gold: 0, bag: bag(["Crate#55", 1]) });
    expect(r.ok && r.texts).toEqual(['Kanta says "Thanks for the business!"']);
    expect(r.ok && r.buyer.gold).toBe(15);
    expect(r.ok && r.soldContainer).toBe("Crate#55");
  });

  test("bug fixed: a container with something stored in it is refused, and an empty one is sold first", () => {
    const stored = (n: string) => (n === "Crate#55" ? 2 : 0);
    expect(npcSell(shop("Kanta"), 11, 1, { gold: 0, bag: bag(["Crate#55", 1]) }, stored)).toEqual({
      ok: false,
      text: 'Kanta says "Empty that out before you sell it to me."',
    });
    const r = npcSell(
      shop("Kanta"),
      11,
      1,
      { gold: 0, bag: bag(["Crate#55", 1], ["Crate#56", 1]) },
      stored,
    );
    expect(r.ok && r.buyer.bag.slice(0, 2)).toEqual([{ item: "Crate#55", qty: 1 }, null]);
    expect(r.ok && r.soldContainer).toBe("Crate#56");
  });

  test("the refusals in order: errsel, too few, none", () => {
    const s = shop("Akadius");
    expect(npcSell(s, 5, 2, { gold: 0, bag: bag(["Raw Fish", 1]) })).toEqual({
      ok: false,
      text: "You don't have enough of those to sell!",
    });
    expect(npcSell(s, 5, 1, { gold: 0, bag: emptyBag() })).toEqual({
      ok: false,
      text: "You don't have that item.",
    });
    // A SEL line under the sell OK names its own price, which no BUY line has.
    expect(npcSell(s, 4, 1, { gold: 0, bag: bag(["Raw Fish", 1]) })).toEqual({
      ok: false,
      text: "Error in trying to sell!",
    });
  });

  test("bug fixed: an NPC whose gold would go negative names itself", () => {
    const s = { ...shop("Akadius"), gold: 10 };
    expect(npcSell(s, 5, 1, { gold: 0, bag: bag(["Raw Fish", 1]) })).toEqual({
      ok: false,
      text: `Akadius says "I'm sorry but I can't afford to buy that."`,
    });
  });

  test("bug fixed: a shopkeeper with no GLD line pays from its till, refusing while it is empty", () => {
    const s = { ...shop("Akadius"), gold: 0 };
    expect(npcSell(s, 5, 1, { gold: 7, bag: bag(["Raw Fish", 1]) })).toEqual({
      ok: false,
      text: `Akadius says "I'm sorry but I can't afford to buy that."`,
    });
    // Once a purchase fills the till, it buys.
    const filled = npcBuy(s, 4, 1, { gold: 100, bag: emptyBag() }, rng);
    const r = filled.ok
      ? npcSell(filled.ledger, 5, 1, { gold: 7, bag: bag(["Raw Fish", 1]) })
      : null;
    expect(r?.ok && r.buyer.gold).toBe(32);
    expect(r?.ok && r.ledger.gold).toBe(45);
  });

  test("the sell OK swaps a Crate or Cabinet line for a bag container of exactly that kind, one unit", () => {
    expect(sellName("Crate", 5, bag(["Apple", 1], ["Crate#9", 1], ["Crate#2", 1]))).toEqual({
      item: "Crate#9",
      count: 1,
    });
    expect(sellName("Cabinet", 1, bag(["Wind Cabinet#4", 1], ["Cabinet#7", 1]))).toEqual({
      item: "Cabinet#7",
      count: 1,
    });
    const r = npcSell(shop("Kanta"), 12, 1, {
      gold: 0,
      bag: bag(["Wind Cabinet#4", 1], ["Cabinet#7", 1]),
    });
    expect(r.ok && r.buyer.bag.slice(0, 2)).toEqual([{ item: "Wind Cabinet#4", qty: 1 }, null]);
  });
});

describe("the bank", () => {
  test("commands by word 1, any case; the amount after one space; bad amounts read as none", () => {
    expect(parseBank("/BALANCE")).toEqual({ kind: "balance" });
    expect(parseBank("/deposit 50")).toEqual({ kind: "deposit", n: 50 });
    expect(parseBank("/withdraw  50")).toEqual({ kind: "withdraw", n: null });
    expect(parseBank("/deposit -5")).toEqual({ kind: "deposit", n: null });
    expect(parseBank("/deposit abc")).toEqual({ kind: "deposit", n: null });
    expect(parseBank("hello")).toBeNull();
  });

  test("bug fixed: a deposit and a withdrawal each say what they did, and every failure says why", () => {
    expect(runBank({ kind: "balance" }, 10, null)).toEqual({
      text: "You have 0 gold in the bank.",
      gold: 10,
      bank: 0,
    });
    expect(runBank({ kind: "deposit", n: 10 }, 10, 5)).toEqual({
      text: "You deposit 10 gold. You now have 15 gold in the bank.",
      gold: 0,
      bank: 15,
    });
    expect(runBank({ kind: "deposit", n: 11 }, 10, 5)).toEqual({
      text: "You don't have that much gold to deposit.",
      gold: 10,
      bank: 5,
    });
    expect(runBank({ kind: "withdraw", n: 5 }, 0, 5)).toEqual({
      text: "You withdraw 5 gold. You now have 0 gold in the bank.",
      gold: 5,
      bank: 0,
    });
    expect(runBank({ kind: "withdraw", n: 6 }, 0, 5)).toEqual({
      text: BANK_TEXT.shortBank,
      gold: 0,
      bank: 5,
    });
    expect(runBank({ kind: "withdraw", n: null }, 0, 5)).toEqual({
      text: "Type /withdraw and an amount, such as /withdraw 300.",
      gold: 0,
      bank: 5,
    });
    expect(runBank({ kind: "deposit", n: 0 }, 3, 4).text).toBe(
      "You deposit 0 gold. You now have 4 gold in the bank.",
    );
  });

  test("bug fixed: the bank needs a living banker on the map; else 'You cannot bank here!'", () => {
    const map = testMap("x1000y992");
    const p = player("Al", map, 6, 4);
    p.char.gold = 100;
    expect(bankChat(ARCHIVE_NPCS, p, "/balance")).toEqual([
      { to: "Al", msg: { t: "chat", text: "You cannot bank here!", color: 0 } },
    ]);
    const slot3 = map.slots[2];
    if (!slot3) {
      throw new Error("slot");
    }
    // On the roster but not spawned, or dead (no live entry): no bank.
    slot3.species = "Andero";
    expect(canBank(ARCHIVE_NPCS, map)).toBe(false);
    expect(inRoster(map, "andero")).toBe(true);
    slot3.live = {
      name: "Andero",
      hp: 0, // NPCs have no HP; a living one has a live entry
      x: 3,
      y: 3,
      facing: "S",
      anim: 0,
      fromX: 3,
      fromY: 3,
      queue: [],
      hitCountb: 0,
    };
    expect(canBank(ARCHIVE_NPCS, map)).toBe(true);
    expect(bankChat(ARCHIVE_NPCS, p, "/deposit 40")[0]?.msg).toEqual({
      t: "chat",
      text: "You deposit 40 gold. You now have 40 gold in the bank.",
      color: 0,
    });
    expect(p.char.gold).toBe(60);
    expect(p.char.bank).toBe(40);
  });
});

describe("the personal vault", () => {
  const scene = () => {
    const map = testMap("x1000y992");
    const p = player("Al", map, 6, 4);
    const vault = { id: "v", item: "Vault", x: 6, y: 3, kind: "admin" as const, expiresAt: null };
    return { p, vault };
  };

  test("opens only from in front of it, and sets the key lock", () => {
    const { p, vault } = scene();
    p.facing = "E";
    expect(openVault(p, vault)).toEqual([
      { to: "Al", msg: { t: "chat", text: VAULT_TEXT.notInFront, color: 0 } },
    ]);
    p.facing = "N";
    const out = openVault(p, vault);
    expect(out[1]?.msg).toEqual({
      t: "chat",
      text: "You open your vault to see what's inside...",
      color: 0,
    });
    expect(p.keyLock).toBe(true);
  });

  test("bug fixed: deposit checks the capacity before the drop line; containers refused; an open list is refreshed", () => {
    const { p, vault } = scene();
    p.char.bag = bag(["Apple", 2], ["Crate#3", 1]);
    expect(depositVault(p, 2).map((o) => (o.msg.t === "chat" ? o.msg.text : ""))).toEqual([
      "You cannot store a container!",
    ]);
    expect(depositVault(p, 1).map((o) => (o.msg.t === "chat" ? o.msg.text : ""))).toEqual([
      "You drop a Apple into the container.",
    ]);
    expect(p.char.vault).toEqual(["Apple"]);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
    openVault(p, vault);
    expect(depositVault(p, 1).map((o) => o.msg)).toEqual([
      { t: "chat", text: "You drop a Apple into the container.", color: 0 },
      { t: "vault", items: ["Apple", "Apple"], open: false },
    ]);
    p.char.bag[0] = { item: "Apple", qty: 1 };
    p.char.vault = Array.from({ length: 15 }, () => "Rock");
    expect(depositVault(p, 1).map((o) => (o.msg.t === "chat" ? o.msg.text : ""))).toEqual([
      "This is too full to store anything else!",
    ]);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
  });

  test("bug fixed: a withdrawal keeps the window open and the keys locked, says so, and stacks on an exact name", () => {
    const { p, vault } = scene();
    p.char.vault = ["Apple", "Pie"];
    p.char.bag = bag(["Apple", 1]);
    openVault(p, vault);
    const out = withdrawVault(p, 1, rng);
    expect(p.keyLock).toBe(true);
    expect(p.vaultOpen).toBe(true);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 2 });
    expect(out.map((o) => o.msg)).toEqual([
      { t: "vault", items: ["Pie"], open: false },
      { t: "chat", text: "You take a Apple out of the container.", color: 0 },
    ]);
  });

  test("bug fixed: withdrawing 'Pie' into a full bag holding 'Orc Pot Pie' is refused and keeps the Pie", () => {
    const { p, vault } = scene();
    p.char.vault = ["Pie"];
    p.char.bag = full();
    p.char.bag[0] = { item: "Orc Pot Pie", qty: 1 };
    openVault(p, vault);
    expect(withdrawVault(p, 1, rng)[0]?.msg).toEqual({
      t: "chat",
      text: "You are carrying too much to withdraw this item.",
      color: 0,
    });
    expect(p.char.vault).toEqual(["Pie"]);
    expect(p.char.bag[0]).toEqual({ item: "Orc Pot Pie", qty: 1 });
  });

  test("a full bag with no stack: 'You are carrying too much to withdraw this item.'", () => {
    const { p, vault } = scene();
    p.char.vault = ["Apple"];
    p.char.bag = full();
    openVault(p, vault);
    expect(withdrawVault(p, 1, rng)[0]?.msg).toEqual({
      t: "chat",
      text: "You are carrying too much to withdraw this item.",
      color: 0,
    });
    expect(p.char.vault).toEqual(["Apple"]);
  });

  test("bug fixed: a crystal line comes back as the same crystals", () => {
    const { p, vault } = scene();
    p.char.vault = ["Blue Crystals"];
    p.char.bag = bag(["Blue Crystals", 4]);
    openVault(p, vault);
    withdrawVault(p, 1, rng);
    expect(p.char.bag[0]).toEqual({ item: "Blue Crystals", qty: 5 });
    expect(p.char.vault).toEqual([]);
  });
});
