/**
 * Client tests: the Bio window, the shop and vault window with its clicks and gates, the
 * player menu and the trade window.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { emptyBag, type InventoryView, NO_EQUIPMENT } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import type { Sfx } from "../src/sfx.ts";
import { createBioWindow } from "../src/ui/bio.ts";
import { createCharMenu } from "../src/ui/charmenu.ts";
import { createShopWindow, parseCount } from "../src/ui/shop.ts";
import { amountOf, createTradeWindow } from "../src/ui/trade.ts";
import { createWindowLayer } from "../src/ui/window.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

function shop() {
  const calls: unknown[][] = [];
  const sounds: Sfx[] = [];
  const w = createShopWindow(fakeAssets, {
    buy: (line, n) => calls.push(["buy", line, n]),
    sell: (line, n) => calls.push(["sell", line, n]),
    train: (line) => calls.push(["train", line]),
    take: (i) => calls.push(["take", i]),
    cancel: () => calls.push(["cancel"]),
    sound: (s) => sounds.push(s),
  });
  document.body.append(w.el, w.busy);
  const q = <T extends HTMLElement>(sel: string) => w.el.querySelector(sel) as T;
  const rows = (sel = ".shop-list:not(.shop-vault) .shop-row") => [
    ...w.el.querySelectorAll<HTMLElement>(sel),
  ];
  return { w, calls, sounds, q, rows };
}

describe("the shop and vault window (channels 210-219)", () => {
  test("a line click plays Clicksound2 first, then is ignored while PROCESSING shows", () => {
    const s = shop();
    s.w.showList("buy", [
      { line: 4, item: "Apple", price: 10 },
      { line: 6, item: "Ale", price: 10 },
    ]);
    s.rows()[1]?.click();
    expect(s.sounds).toEqual([{ name: "Clicksound2", ch: 3 }]);
    expect(s.rows()[1]?.getAttribute("aria-selected")).toBe("true");
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    expect(s.calls).toEqual([["buy", 6, 1]]);
    expect(s.w.isBusy).toBe(true);
    // Busy: a row click still clicks but selects nothing; OK does nothing, silently.
    s.rows()[0]?.click();
    expect(s.rows()[0]?.getAttribute("aria-selected")).toBe("false");
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    expect(s.calls.length).toBe(1);
    expect(s.sounds.length).toBe(3);
    s.w.clearBusy();
    expect(s.w.isBusy).toBe(false);
  });

  test("the buy OK: a bad quantity is silent; nothing selected clicks and sends nothing", () => {
    const s = shop();
    s.w.showList("buy", [{ line: 4, item: "Apple", price: 10 }]);
    const count = s.q<HTMLInputElement>(".shop-count");
    count.value = "0";
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    count.value = "-3";
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    expect(s.sounds).toEqual([]);
    count.value = "2";
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    expect(s.sounds.length).toBe(1);
    expect(s.calls).toEqual([]);
    expect(parseCount(" 7 ")).toBe(7);
    expect(parseCount("2.5")).toBeNull();
  });

  test("kept bug: after a sell list the sell OK stays shown over the buy list", () => {
    const s = shop();
    s.w.showList("sell", [{ line: 5, item: "Apple", price: 5 }]);
    s.w.showList("buy", [{ line: 4, item: "Apple", price: 10 }]);
    expect(s.q<HTMLButtonElement>(".shop-sell-ok").hidden).toBe(false);
    expect(s.q<HTMLButtonElement>(".shop-buy-ok").hidden).toBe(false);
    s.rows()[0]?.click();
    s.q<HTMLButtonElement>(".shop-sell-ok").click();
    expect(s.calls).toEqual([["sell", 4, 1]]);
  });

  test("kept bug: a buy and a sale play only the OK click, never cash", () => {
    const s = shop();
    s.w.showList("buy", [{ line: 4, item: "Apple", price: 10 }]);
    s.rows()[0]?.click();
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    s.w.clearBusy(); // the reply
    s.w.showList("sell", [{ line: 5, item: "Apple", price: 5 }]);
    s.rows()[0]?.click();
    s.q<HTMLButtonElement>(".shop-sell-ok").click();
    s.w.clearBusy();
    expect(s.sounds.map((x) => x.name)).toEqual([
      "Clicksound2",
      "Clicksound2",
      "Clicksound2",
      "Clicksound2",
    ]);
  });

  test("CANCEL clicks, closes and leaves PROCESSING", () => {
    const s = shop();
    s.w.showList("buy", [{ line: 4, item: "Apple", price: 10 }]);
    s.rows()[0]?.click();
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    s.q<HTMLButtonElement>(".shop-cancel").click();
    expect(s.w.isOpen).toBe(false);
    expect(s.w.isBusy).toBe(true);
    expect(s.calls.at(-1)).toEqual(["cancel"]);
    expect(s.sounds.length).toBe(3);
  });

  test("the vault: OK on a line takes it with no PROCESSING box", () => {
    const s = shop();
    s.w.showVault(["Apple", "Pie"]);
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    expect(s.calls).toEqual([]);
    s.rows(".shop-vault .shop-row")[1]?.click();
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    expect(s.calls).toEqual([["take", 2]]);
    expect(s.w.isBusy).toBe(false);
  });
});

describe("the Bio window", () => {
  test("titled with the NPC; Buy asks for the list and closes it by script, so the lock holds (no closeWindow)", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const calls: string[] = [];
    const bio = createBioWindow(fakeAssets, layer, {
      list: (m) => calls.push(m),
      closed: () => calls.push("closed"),
    });
    bio.show({
      name: "Amber",
      bio: ["Name: Amber"],
      profile: ["Hello"],
      buy: true,
      sell: false,
      train: false,
    });
    expect(bio.window.el.getAttribute("aria-label")).toBe("Amber");
    expect(bio.window.el.querySelector<HTMLElement>(".bio-sell")?.hidden).toBe(true);
    expect(bio.window.el.querySelector(".bio-profile")?.textContent).toBe("Hello");
    bio.window.el.querySelector<HTMLButtonElement>(".bio-buy")?.click();
    expect(calls).toEqual(["buy"]);
    expect(bio.window.isOpen).toBe(false);
  });
});

describe("the Train button and list", () => {
  const trainBio = (train: boolean) => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const calls: string[] = [];
    const bio = createBioWindow(fakeAssets, layer, {
      list: (m) => calls.push(m),
      closed: () => calls.push("closed"),
    });
    bio.show({ name: "Fire God", bio: [], profile: [], buy: false, sell: false, train });
    const btn = bio.window.el.querySelector<HTMLButtonElement>(".bio-train");
    return { bio, calls, btn };
  };

  test("divergence: the Train button shows only with train: true, never in a player's bio", () => {
    expect(trainBio(false).btn?.hidden).toBe(true);
    const t = trainBio(true);
    expect(t.btn?.hidden).toBe(false);
    expect(t.btn?.dataset.action).toBe("bio-train");
    t.bio.showPlayer({ title: "A", bio: [], profile: "", medals: [], own: false });
    expect(t.btn?.hidden).toBe(true);
  });

  test("divergence: the Train click asks for the train list and closes the window", () => {
    const t = trainBio(true);
    t.btn?.click();
    expect(t.calls).toEqual(["train"]);
    expect(t.bio.window.isOpen).toBe(false);
  });

  test("divergence: the train list has no quantity field; OK sends the row's line, even at price 0", () => {
    const s = shop();
    s.w.showList("train", [
      { line: 3, item: "Fire Mage", price: 10000 },
      { line: 5, item: "Grunt", price: 0 },
    ]);
    expect(s.q<HTMLElement>(".shop-count").hidden).toBe(true);
    expect(s.q<HTMLElement>(".shop-buy-ok").hidden).toBe(false);
    expect(s.q<HTMLElement>(".shop-sell-ok").hidden).toBe(true);
    s.q<HTMLButtonElement>(".shop-buy-ok").click(); // no row selected: nothing
    expect(s.calls).toEqual([]);
    s.rows()[1]?.click();
    s.q<HTMLButtonElement>(".shop-buy-ok").click();
    expect(s.calls).toEqual([["train", 5]]);
    expect(s.w.isBusy).toBe(true);
    s.w.clearBusy();
    s.w.showList("buy", [{ line: 1, item: "Apple", price: 1 }]);
    expect(s.q<HTMLElement>(".shop-count").hidden).toBe(false);
  });
});

describe("the player menu (sprites 302-304)", () => {
  test("opens at the click with Bio and Trade; Trade asks for a trade, Bio for the bio", () => {
    const asked: string[] = [];
    const menu = createCharMenu(fakeAssets, {
      trade: (id) => asked.push(`trade ${id}`),
      bio: (id) => asked.push(`bio ${id}`),
    });
    menu.open("bob", 100, 80);
    expect(menu.el.style.left).toBe("71px");
    expect(menu.el.style.top).toBe("61px");
    const [bio, trade] = [...menu.el.querySelectorAll<HTMLButtonElement>(".char-menu-item")];
    bio?.click();
    expect(asked).toEqual(["bio bob"]);
    expect(menu.isOpen).toBe(false);
    menu.open("bob", 100, 80);
    trade?.click();
    expect(asked).toEqual(["bio bob", "trade bob"]);
  });
});

describe("the trade window", () => {
  const inv = (): InventoryView => {
    const bag = emptyBag();
    bag[2] = { item: "Apple", qty: 4 };
    return { gold: 90, bag, equip: { ...NO_EQUIPMENT } };
  };

  test("A fills the left column from gold and bag; Trade sends the amounts by slot", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const offers: unknown[] = [];
    const w = createTradeWindow(fakeAssets, layer, {
      offer: (gold, items) => offers.push({ gold, items }),
      accept: () => offers.push("accept"),
      cancel: () => offers.push("cancel"),
    });
    w.show({ you: "a", self: "Al", partner: "Bo", mine: null, theirs: null }, inv());
    const left = [...w.window.el.querySelectorAll<HTMLInputElement>(".trade-left .trade-amount")];
    const names = [...w.window.el.querySelectorAll(".trade-left .trade-name")].map(
      (n) => n.textContent,
    );
    expect(names.slice(0, 4)).toEqual(["Gold", "", "", "Apple"]);
    expect(w.window.el.querySelector<HTMLElement>(".trade-accept")?.hidden).toBe(true);
    expect(w.window.el.querySelector<HTMLElement>(".trade-right")?.hidden).toBe(true);
    for (const [i, v] of [
      [0, "20"],
      [3, "2"],
    ] as const) {
      const f = left[i];
      if (f) {
        f.value = v;
      }
    }
    w.window.el.querySelector<HTMLButtonElement>(".trade-offer-a")?.click();
    expect(offers).toEqual([{ gold: 20, items: [{ slot: 3, qty: 2 }] }]);
    // B's offer arrives: Accept shows, the right column holds it packed.
    w.show(
      {
        you: "a",
        self: "Al",
        partner: "Bo",
        mine: { gold: 20, items: [{ item: "Apple", qty: 2 }] },
        theirs: { gold: 0, items: [{ item: "Knife", qty: 1 }] },
      },
      inv(),
    );
    expect(w.window.el.querySelector<HTMLElement>(".trade-accept")?.hidden).toBe(false);
    expect(w.window.el.querySelector<HTMLElement>(".trade-offer-a")?.hidden).toBe(true);
    expect(left[0]?.readOnly).toBe(true);
    const right = [...w.window.el.querySelectorAll(".trade-right .trade-name")].map(
      (n) => n.textContent,
    );
    expect(right.slice(0, 3)).toEqual(["Gold", "Knife", ""]);
    // Closing the window cancels; a null state closes it without a second cancel.
    w.show(null, null);
    expect(w.window.isOpen).toBe(false);
    expect(offers.at(-1)).toEqual({ gold: 20, items: [{ slot: 3, qty: 2 }] });
    expect(amountOf("x")).toBe(0);
  });
});
