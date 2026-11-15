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
    expect(r.texts).toEqual([]);
    // The shown ledger is unchanged until the caller keeps the result.
    expect(stock(s, 4)).toBe(11539);
  });

  test("short of price × count: 'You don't have enough gold to buy this!'", () => {
    expect(npcBuy(shop("Akadius"), 4, 2, { gold: 139, bag: emptyBag() }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.cannotAfford,
    });
  });

  test("a full bag is refused unless the bag text contains '<item>-'", () => {
    expect(npcBuy(shop("Amber"), 8, 1, { gold: 100, bag: full() }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.noRoom,
    });
  });

  test("kept bug: a full bag with 'Orc Pot Pie' passes for 'Pie'; InvAdd adds nothing and keeps the gold, but Amber's stock and gold change", () => {
    const b = full();
    b[3] = { item: "Orc Pot Pie", qty: 1 };
    const r = npcBuy(shop("Amber"), 8, 1, { gold: 100, bag: b }, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.buyer.gold).toBe(100);
    expect(r.buyer.bag).toEqual(b);
    expect(stock(r.ledger, 8)).toBe(5770);
    expect(r.ledger.gold).toBe(107537424 + 10);
  });

  test("count over stock: ' says \"Sorry but I'm out of that particular item.\"', blank name", () => {
    expect(npcBuy(shop("Fire God"), 1, 99, { gold: 99999, bag: emptyBag() }, rng)).toEqual({
      ok: false,
      text: ` says "Sorry but I'm out of that particular item."`,
    });
  });

  test("kept bug: no GLD line, nothing charged, but the gold test still needs price × count", () => {
    const r = npcBuy(shop("Fire God"), 1, 1, { gold: 100, bag: emptyBag() }, rng);
    expect(r.ok && r.buyer.gold).toBe(100);
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "Fireball Book", qty: 1 });
    expect(r.ok && stock(r.ledger, 1)).toBe(97);
    expect(npcBuy(shop("Fire God"), 1, 1, { gold: 99, bag: emptyBag() }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.cannotAfford,
    });
  });

  test("kept bug: the Fortress Guild Hall Deed (Smithy line 17) always answers NEI, nothing written", () => {
    const s = shop("Smithy");
    expect(npcBuy(s, 17, 1, { gold: 200000, bag: emptyBag() }, rng)).toEqual({
      ok: false,
      text: SHOP_TEXT.outOfStock,
    });
    expect(stock(s, 17)).toBe(300000);
  });

  test("crystals skip the inner loop, so Plone's line-17 White Crystals sell", () => {
    const r = npcBuy(shop("Plone"), 17, 3, { gold: 100, bag: emptyBag() }, rng);
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "White Crystals", qty: 3 });
    expect(r.ok && r.buyer.gold).toBe(100 - 78);
  });

  test("buying Picha1's apple onto an Apple stack renames it apple", () => {
    const r = npcBuy(shop("Picha1"), 7, 1, { gold: 5, bag: bag(["Apple", 2]) }, rng);
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "apple", qty: 3 });
  });

  test("a match on line 16 buys normally: the inner loop leaves x at 16 and the outer goes on at 17", () => {
    const s = shop("Akadius");
    const at = s.lines.find((l) => l.line === 16);
    expect(at?.item).toBe("Fishing Pole");
    const r = npcBuy(s, 16, 1, { gold: 100000, bag: emptyBag() }, rng);
    expect(r.ok).toBe(true);
    expect(r.ok && stock(r.ledger, 16)).toBe((at?.stock ?? 0) - 1);
  });

  test("a match below line 17 skips to line 17, so Trout does not also take Trout Fillet's stock", () => {
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
    expect(r.texts).toEqual(["Thanks for the business!"]);
  });

  test("selling to Picha1 from a Long Sword stack renames it long sword", () => {
    const r = npcSell(shop("Picha1"), 6, 1, { gold: 0, bag: bag(["Long Sword", 3]) });
    expect(r.ok && r.buyer.bag[0]).toEqual({ item: "long sword", qty: 2 });
  });

  test("kept bug: selling Trout bumps Trout Fillet's stock too and thanks twice", () => {
    const r = npcSell(shop("Akadius"), 9, 1, { gold: 0, bag: bag(["Trout", 1]) });
    expect(r.ok && r.texts).toEqual(["Thanks for the business!", "Thanks for the business!"]);
    expect(r.ok && stock(r.ledger, 8)).toBe(12825);
    expect(r.ok && stock(r.ledger, 10)).toBe(15038);
    expect(r.ok && r.buyer.bag[0]).toBeNull();
  });

  test("kept bug: BUY without SEL pays but says nothing", () => {
    const r = npcSell(shop("Kanta"), 11, 1, { gold: 0, bag: bag(["Crate#55", 1]) });
    expect(r.ok && r.texts).toEqual([]);
    expect(r.ok && r.buyer.gold).toBe(15);
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

  test("an NPC whose gold would go negative: ' says \"I'm sorry but I can't afford to buy that.\"'", () => {
    const s = { ...shop("Akadius"), gold: 10 };
    expect(npcSell(s, 5, 1, { gold: 0, bag: bag(["Raw Fish", 1]) })).toEqual({
      ok: false,
      text: ` says "I'm sorry but I can't afford to buy that."`,
    });
  });

  test("kept bug: no GLD line takes the item and pays nothing", () => {
    const s = { ...shop("Akadius"), gold: null };
    const r = npcSell(s, 5, 1, { gold: 7, bag: bag(["Raw Fish", 1]) });
    expect(r.ok && r.buyer.gold).toBe(7);
    expect(r.ok && r.buyer.bag[0]).toBeNull();
  });

  test("the sell OK swaps a Crate or Cabinet line for the lowest Crate#/Cabinet# slot, one unit; 'Cabinet' finds a Wind Cabinet", () => {
    expect(sellName("Crate", 5, bag(["Apple", 1], ["Crate#9", 1], ["Crate#2", 1]))).toEqual({
      item: "Crate#9",
      count: 1,
    });
    expect(sellName("Cabinet", 1, bag(["Wind Cabinet#4", 1], ["Cabinet#7", 1]))).toEqual({
      item: "Wind Cabinet#4",
      count: 1,
    });
    // ...which Kanta's BUY|Cabinet does not match: errsel.
    const r = npcSell(shop("Kanta"), 12, 1, {
      gold: 0,
      bag: bag(["Wind Cabinet#4", 1], ["Cabinet#7", 1]),
    });
    expect(r).toEqual({ ok: false, text: "Error in trying to sell!" });
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

  test("kept bug: the texts; failures are silent; withdraw says 'You now have' too", () => {
    expect(runBank({ kind: "balance" }, 10, null)).toEqual({
      text: "You have 0 gold in the bank.",
      gold: 10,
      bank: 0,
    });
    expect(runBank({ kind: "deposit", n: 10 }, 10, 5)).toEqual({
      text: "You now have 15 gold in the bank.",
      gold: 0,
      bank: 15,
    });
    expect(runBank({ kind: "deposit", n: 11 }, 10, 5)).toEqual({ text: null, gold: 10, bank: 5 });
    expect(runBank({ kind: "withdraw", n: 5 }, 0, 5)).toEqual({
      text: BANK_TEXT.now(0),
      gold: 5,
      bank: 0,
    });
    expect(runBank({ kind: "withdraw", n: 6 }, 0, 5)).toEqual({ text: null, gold: 0, bank: 5 });
    expect(runBank({ kind: "deposit", n: 0 }, 3, 4).text).toBe("You now have 4 gold in the bank.");
  });

  test("kept bug: the banker only has to be in the map's roster, alive or not; else 'You cannot bank here!'", () => {
    const map = testMap("x1000y992");
    const p = player("Al", map, 6, 4);
    p.char.gold = 100;
    expect(bankChat(ARCHIVE_NPCS, p, "/balance")).toEqual([
      { to: "Al", msg: { t: "chat", text: "You cannot bank here!", color: 0 } },
    ]);
    const slot3 = map.slots[2];
    if (slot3) {
      slot3.species = "Andero";
    }
    expect(canBank(ARCHIVE_NPCS, map)).toBe(true);
    expect(inRoster(map, "andero")).toBe(true);
    expect(bankChat(ARCHIVE_NPCS, p, "/deposit 40")[0]?.msg).toEqual({
      t: "chat",
      text: "You now have 40 gold in the bank.",
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

  test("deposit: the line is printed before the capacity test; containers refused", () => {
    const { p } = scene();
    p.char.bag = bag(["Apple", 2], ["Crate#3", 1]);
    expect(depositVault(p, 2).map((o) => (o.msg.t === "chat" ? o.msg.text : ""))).toEqual([
      "You cannot store a container!",
    ]);
    expect(depositVault(p, 1).map((o) => (o.msg.t === "chat" ? o.msg.text : ""))).toEqual([
      "You drop a Apple into the container.",
    ]);
    expect(p.char.vault).toEqual(["Apple"]);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
    p.char.vault = Array.from({ length: 15 }, () => "Rock");
    expect(depositVault(p, 1).map((o) => (o.msg.t === "chat" ? o.msg.text : ""))).toEqual([
      "You drop a Apple into the container.",
      "This is too full to store anything else!",
    ]);
  });

  test("withdraw ends the key lock and stacks on an exact name", () => {
    const { p, vault } = scene();
    p.char.vault = ["Apple", "Pie"];
    p.char.bag = bag(["Apple", 1]);
    openVault(p, vault);
    const out = withdrawVault(p, 1, rng);
    expect(p.keyLock).toBe(false);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 2 });
    expect(out[0]?.msg).toEqual({ t: "vault", items: ["Pie"], open: false });
  });

  test("kept bug: withdrawing 'Pie' into a full bag holding 'Orc Pot Pie' destroys it", () => {
    const { p, vault } = scene();
    p.char.vault = ["Pie"];
    p.char.bag = full();
    p.char.bag[0] = { item: "Orc Pot Pie", qty: 1 };
    openVault(p, vault);
    withdrawVault(p, 1, rng);
    expect(p.char.vault).toEqual([]);
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

  test("kept bug: a crystal line comes back as 'Crystals '", () => {
    const { p, vault } = scene();
    p.char.vault = ["Blue Crystals"];
    openVault(p, vault);
    withdrawVault(p, 1, rng);
    expect(p.char.bag[0]).toEqual({ item: "Crystals ", qty: 1 });
  });
});
