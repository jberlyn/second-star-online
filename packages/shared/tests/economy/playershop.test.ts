/**
 * Golden tests for the player shop rules: each test pins one behaviour of 1.6, or a 1.6 bug SSO
 * fixed ("bug fixed").
 */
import { describe, expect, test } from "bun:test";

import { npcLines } from "../../src/rules/admin/npcfile.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  inMonsterList,
  onShopWhitelist,
  parseShopCommand,
  profile,
  register,
  removeItem,
  rollShopkeeperName,
  SHOP_TEXT,
  setPrices,
  shopkeeperFile,
  shopkeeperName,
  shopStockLines,
} from "../../src/rules/economy/playershop.ts";

/** A random source with results from a fixed list. */
function seq(...values: number[]): Rng {
  let i = 0;
  return {
    random(n) {
      const v = values[i++];
      if (v === undefined || v < 1 || v > n) {
        throw new Error(`random(${n}) got ${v}`);
      }
      return v;
    },
  };
}

const FILE = npcLines(shopkeeperFile("Carol", "Tolam"));
const SLOTS = ["Tolam", null, null, null];
const HOUSE = "xH11000y992";

describe("the shopkeeper", () => {
  test("the name builder's five parts: random(17), three random(5), random(11)", () => {
    expect(shopkeeperName(seq(1, 1, 1, 1, 1))).toBe("Basta");
    expect(shopkeeperName(seq(17, 5, 5, 5, 8))).toBe("Zumug");
    // random(11) gives a letter only for 4-8.
    expect(shopkeeperName(seq(17, 2, 3, 3, 4))).toBe("Zeghir");
    expect(shopkeeperName(seq(9, 4, 4, 1, 3))).toBe("Lola");
    expect(shopkeeperName(seq(9, 4, 4, 1, 11))).toBe("Lola");
  });

  test("the monster list's contains test catches 16 of the 12,750 names", () => {
    expect(inMonsterList("Tela")).toBe(true);
    expect(inMonsterList("Galor")).toBe(true);
    expect(inMonsterList("Lime")).toBe(true); // inside "Slime"
    expect(inMonsterList("Demo")).toBe(true); // inside "Demon"
    expect(inMonsterList("Tolam")).toBe(false);
  });

  test("a taken name or a monster-list name is rolled again", () => {
    // Tela (T e l a, no ending), then Lime (L i m e), then Tolam.
    const rng = seq(15, 2, 4, 1, 1, 9, 3, 5, 2, 1, 15, 4, 4, 1, 5);
    const taken = (n: string) => n === "Tela";
    expect(rollShopkeeperName(rng, taken)).toBe("Tolam");
  });

  test("the shopkeeper's NPC file: OWN, two BIO lines, PRO, GLD 0, an Apple at 2 and 1", () => {
    expect(FILE).toEqual([
      "OWN|Carol",
      "BIO|Name: Tolam",
      "BIO|Class: Shopkeeper",
      "PRO|",
      "GLD|0",
      "SEL|Apple:2:0",
      "BUY|Apple:1",
    ]);
  });
});

describe("the client's checks (SH)", () => {
  const parse = (line: string, map = HOUSE) => parseShopCommand(line, map, SLOTS);

  test("only on a map whose name contains H, to a roster name in any case", () => {
    expect(parse("Tolam inventory", "x1000y992")).toBeNull();
    expect(parse("tolam INVENTORY")).toEqual({ kind: "inventory", npc: "Tolam" });
    expect(parse("Bob inventory")).toBeNull();
    expect(parse("Tolam hello there")).toBeNull();
  });

  test("an empty slot keeps the name read before it", () => {
    expect(parseShopCommand("Tolam inventory", HOUSE, [null, "Tolam", null, null])).toEqual({
      kind: "inventory",
      npc: "Tolam",
    });
    expect(parseShopCommand("Tolam inventory", HOUSE, [null, null, null, null])).toBeNull();
  });

  test("set: the whitelist, case ignored, the name as typed", () => {
    expect(parse("Tolam set fish=5,2")).toEqual({
      kind: "set",
      npc: "Tolam",
      item: "fish",
      sell: 5,
      buy: 2,
    });
    expect(parse("Tolam set Dragon=5,2")).toEqual({ kind: "refused", text: SHOP_TEXT.wrongItem });
    // A space before "=" is part of the name.
    expect(parse("Tolam set Fish =5,2")).toEqual({ kind: "refused", text: SHOP_TEXT.wrongItem });
    // Bug fixed: the list names crystals in the singular, as the bag does.
    expect(onShopWhitelist("Blue Crystal")).toBe(true);
    expect(onShopWhitelist("white crystal")).toBe(true);
    expect(onShopWhitelist("Blue Crystals")).toBe(false);
    expect(parse("Tolam set Red Crystal=30,15")).toMatchObject({
      kind: "set",
      item: "Red Crystal",
    });
    expect(onShopWhitelist("Crystals")).toBe(false);
  });

  test("set: spaces leave the prices, a deleted one skipping the next", () => {
    expect(parse("Tolam set Fish= 5 , 2")).toMatchObject({ sell: 5, buy: 2 });
    expect(parse("Tolam set Fish=5,  2")).toMatchObject({ sell: 5, buy: 2 });
  });

  test("set: prices 1-9999 or nothing at all", () => {
    expect(parse("Tolam set Fish=0,2")).toEqual({ kind: "silent" });
    expect(parse("Tolam set Fish=10000,2")).toEqual({ kind: "silent" });
    expect(parse("Tolam set Fish=5")).toEqual({ kind: "silent" });
    expect(parse("Tolam set Fish=5.5,2")).toEqual({ kind: "silent" });
    expect(parse("Tolam set Fish=9999,1")).toMatchObject({ sell: 9999, buy: 1 });
  });

  test("remove takes any text; the server stops it at a colon", () => {
    expect(parse("Tolam remove Fish")).toEqual({ kind: "remove", npc: "Tolam", item: "Fish" });
    expect(parse("Tolam remove g")).toEqual({ kind: "remove", npc: "Tolam", item: "g" });
    expect(parse("Tolam remove a:b")).toEqual({ kind: "remove", npc: "Tolam", item: "a" });
  });

  test("register below 1 is silent", () => {
    expect(parse("Tolam register 50")).toEqual({ kind: "register", npc: "Tolam", amount: 50 });
    expect(parse("Tolam register 0")).toEqual({ kind: "silent" });
    expect(parse("Tolam register -5")).toEqual({ kind: "silent" });
    expect(parse("Tolam register lots")).toEqual({ kind: "silent" });
  });

  test("profile and title stop at a colon; a title with # is silent", () => {
    expect(parse("Tolam profile Fresh fish: daily")).toEqual({
      kind: "profile",
      npc: "Tolam",
      text: "Fresh fish",
    });
    expect(parse("Tolam title Carol's Fish")).toEqual({
      kind: "title",
      npc: "Tolam",
      text: "Carol's Fish",
    });
    expect(parse("Tolam title Fish #1")).toEqual({ kind: "silent" });
  });
});

describe("the server's rules (SV)", () => {
  test("not the owner: the employee line, nothing written", () => {
    expect(setPrices(FILE, false, "Tolam", "Fish", 5, 2)).toEqual({
      lines: null,
      text: "Tolam is not your employee!",
    });
    expect(removeItem(FILE, false, "Tolam", "Apple").text).toBe("Tolam is not your employee!");
    expect(register(FILE, false, "Tolam", 5).text).toBe(
      `Tolam says "I don't think my boss would like you trying to steal from us."`,
    );
    expect(shopStockLines(FILE, false, "Tolam")).toEqual([]);
    expect(profile(FILE, false, "Tolam", "x")).toBeNull();
  });

  test("SetPrices appends SEL and BUY with the name as typed", () => {
    const r = setPrices(FILE, true, "Tolam", "fish", 5, 2);
    expect(r.text).toBe(`Tolam says "OK boss, I've added the item!"`);
    expect(r.lines).toEqual([...FILE, "SEL|fish:5:0", "BUY|fish:2", ""]);
  });

  test("bug fixed: SetPrices touches only the item's own lines; Alex keeps his OWN| line", () => {
    const alex = npcLines(shopkeeperFile("Alex", "Tolam"));
    const r = setPrices(alex, true, "Tolam", "Ale", 5, 2);
    expect(r.lines).toEqual([...alex, "SEL|Ale:5:0", "BUY|Ale:2", ""]);
  });

  test("bug fixed: setting Fish leaves Fish Sticks, its stock and its place alone", () => {
    const lines = [...FILE, "SEL|Fish Sticks:9:4", "BUY|Fish Sticks:3"];
    const r = setPrices(lines, true, "Tolam", "Fish", 5, 2);
    expect(r.lines).toEqual([...lines, "SEL|Fish:5:0", "BUY|Fish:2", ""]);
  });

  test("bug fixed: re-pricing keeps the item's stock and its place in the list", () => {
    const lines = [
      ...FILE.slice(0, 5),
      "SEL|Apple:2:7",
      "BUY|Apple:1",
      "SEL|Fish:5:1",
      "BUY|Fish:2",
    ];
    const r = setPrices(lines, true, "Tolam", "apple", 9, 4);
    expect(r.lines).toEqual([
      ...FILE.slice(0, 5),
      "SEL|Apple:9:7",
      "BUY|Apple:4",
      "SEL|Fish:5:1",
      "BUY|Fish:2",
    ]);
  });

  test("bug fixed: empty lines and lines past 30 are kept", () => {
    const lines = [...FILE, "", ...Array.from({ length: 25 }, (_, i) => `RND|line ${i}`)];
    const r = setPrices(lines, true, "Tolam", "Fish", 5, 2);
    expect(r.lines).toEqual([...lines, "SEL|Fish:5:0", "BUY|Fish:2", ""]);
  });

  test("bug fixed: max 10 counts every SEL line in the file; a re-priced item is not new", () => {
    const tenth = [...FILE];
    for (const it of ["Bread", "Fish", "Trout", "Carrot", "Corn", "Ale", "Wine", "Torch", "Rope"]) {
      tenth.push(`SEL|${it}:1:0`, `BUY|${it}:1`);
    }
    expect(setPrices(tenth, true, "Tolam", "Shovel", 5, 2).text).toBe(
      "Tolam is currently selling the maximum number of items allowed!",
    );
    expect(setPrices(tenth, true, "Tolam", "Bread", 5, 2).lines).not.toBeNull();
    // Pushed past line 30 by other lines, the ten items still count.
    const pushed = [...tenth.slice(0, 5), ...Array(30).fill("RND|x"), ...tenth.slice(5)];
    expect(setPrices(pushed, true, "Tolam", "Shovel", 5, 2).lines).toBeNull();
    // "Fish" already selling does not make "Fish Sticks" a re-price.
    const nine = tenth.slice(0, -2);
    expect(setPrices(nine, true, "Tolam", "Fish Sticks", 5, 2).lines).not.toBeNull();
    const ten = setPrices(nine, true, "Tolam", "Fish Sticks", 5, 2).lines ?? [];
    expect(setPrices(ten, true, "Tolam", "Fish Stick", 5, 2).lines).toBeNull();
  });

  test("the seventh item lands on line 18, where it can be bought", () => {
    let lines: string[] = [...FILE];
    for (const it of ["Bread", "Fish", "Trout", "Carrot", "Corn", "Ale"]) {
      lines = (setPrices(lines, true, "Tolam", it, 1, 1).lines ?? []).filter((l) => l !== "");
    }
    expect(lines.indexOf("SEL|Ale:1:0") + 1).toBe(18);
    expect(lines.indexOf("SEL|Corn:1:0") + 1).toBe(16);
  });

  test("RemoveItem: not selling, in stock, removed", () => {
    expect(removeItem(FILE, true, "Tolam", "Fish").text).toBe(
      `Tolam says "I'm not currently selling that item, boss!"`,
    );
    const stocked = [...FILE.slice(0, 5), "SEL|Apple:2:3", "BUY|Apple:1"];
    expect(removeItem(stocked, true, "Tolam", "Apple")).toEqual({
      lines: null,
      text: `Tolam says "We have that in stock, you need to buy it all back first."`,
    });
    const r = removeItem(FILE, true, "Tolam", "Apple");
    expect(r.text).toBe(`Tolam says "OK boss, I removed the item!"`);
    expect(r.lines).toEqual([...FILE.slice(0, 5), ""]);
  });

  test("bug fixed: removing Apple leaves Apple Pie and every other line", () => {
    const lines = [...FILE, "SEL|Apple Pie:4:2", "BUY|Apple Pie:2"];
    expect(removeItem(lines, true, "Tolam", "Apple").lines).toEqual([
      ...FILE.slice(0, 5),
      "SEL|Apple Pie:4:2",
      "BUY|Apple Pie:2",
      "",
    ]);
    // A single letter matches no item, so nothing goes, the gold line included.
    expect(removeItem(lines, true, "Tolam", "g")).toEqual({
      lines: null,
      text: `Tolam says "I'm not currently selling that item, boss!"`,
    });
  });

  test("Register moves the till to the owner; below 0 refuses", () => {
    const till = FILE.map((l) => (l === "GLD|0" ? "GLD|100" : l));
    const r = register(till, true, "Tolam", 60);
    expect(r).toEqual({
      lines: till.map((l) => (l === "GLD|100" ? "GLD|40" : l)),
      text: `Tolam says "Here's the gold."`,
      paid: 60,
    });
    expect(register(till, true, "Tolam", 101)).toEqual({
      lines: null,
      text: `Tolam says "I don't have that much gold!"`,
      paid: 0,
    });
  });

  test("with no GLD line Register refuses; 1.6 paid from nothing", () => {
    const none = FILE.filter((l) => l !== "GLD|0");
    expect(register(none, true, "Tolam", 5)).toMatchObject({ lines: null, paid: 0 });
  });

  test("bug fixed: the till line has its closing quote; the stock lines name each item as it is", () => {
    const lines = [...FILE.slice(0, 5), "SEL|Chunk of Iron:9:3", "SEL|Fish:5:1", "SEL|Bread:2:0"];
    expect(shopStockLines(lines, true, "Tolam")).toEqual([
      `Tolam says "I have 0 gold in the register..."`,
      `Tolam says "I have 3 Chunk of Iron in stock."`,
      `Tolam says "I have 1 Fish in stock."`,
      `Tolam says "I have 0 Bread in stock."`,
    ]);
  });

  test("Profile rewrites PRO lines and answers even with none", () => {
    expect(profile(FILE, true, "Tolam", "Fresh fish")?.lines?.[3]).toBe("PRO|Fresh fish");
    const none = FILE.filter((l) => l !== "PRO|");
    expect(profile(none, true, "Tolam", "Fresh fish")).toEqual({
      lines: none,
      text: "Tolam's profile has been updated.",
    });
  });
});
