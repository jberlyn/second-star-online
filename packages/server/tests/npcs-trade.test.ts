/**
 * Sim tests: clicking NPCs and monsters, the pig grab, RND chatter, gold to an NPC, and trade.
 */
import { describe, expect, test } from "bun:test";

import { emptyBag, type ServerMsg } from "@secondstaronline/shared";

import { shopCancelIntent, shopListIntent } from "../src/systems/economy/intents.ts";
import { ledgerFromTemplate } from "../src/systems/economy/shop.ts";
import {
  acceptTrade,
  cancelTrade,
  leaveTrade,
  offerTrade,
  openTrade,
  settle,
} from "../src/systems/economy/trade.ts";
import { actionIntent, goldIntent, type ItemCtx } from "../src/systems/inventory/items.ts";
import { cancelSlot, chatterTick, clickNpc, closeBio } from "../src/systems/monsters/npc.ts";
import { npcFileNamed } from "../src/systems/monsters/npcfiles.ts";
import { placeMonster } from "../src/systems/monsters/spawn.ts";
import { tick } from "../src/systems/world/tick.ts";
import { addPlayer, createWorld, type Player, type Room } from "../src/systems/world/world.ts";
import { NO_CASINO, player, rngByN, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

function scene(queues: Record<number, number[]> = {}) {
  const map = testMap("x1000y992");
  const world = createWorld();
  const rng = rngByN(queues);
  const ctx = (): ItemCtx => ({
    world,
    rng,
    now: 0,
    shop: (npc) => {
      const t = npcFileNamed(world.npcs, npc);
      if (!t) {
        return null;
      }
      const s = world.shops.get(t.name) ?? ledgerFromTemplate(t);
      world.shops.set(t.name, s);
      return s;
    },
  });
  const join = (id: string, x: number, y: number): Player => {
    const p = player(id, map, x, y);
    addPlayer(world, p);
    p.loading = 0;
    return p;
  };
  const room = () => world.rooms.get(map.name) as Room;
  /** Puts `species` in roster slot `n`, standing on (x, y). */
  const put = (n: number, species: string, x: number, y: number) => {
    const s = map.slots[n - 1];
    if (!s) {
      throw new Error("slot");
    }
    s.species = species;
    s.live = placeMonster(species, x, y, rng);
    return s;
  };
  return { map, world, rng, ctx, join, room, put };
}

describe("clicking a monster or NPC", () => {
  test("an NPC with data opens its Bio and holds the keys until it closes", () => {
    const s = scene();
    const p = s.join("Al", 6, 6);
    s.put(1, "Akadius", 8, 4); // two tiles each way: across a counter
    const r = clickNpc(s.room(), p, 1, s.rng);
    expect(r.out[0]?.msg).toMatchObject({
      t: "bio",
      name: "Akadius",
      buy: true,
      sell: true,
    });
    expect(p.keyLock).toBe(true);
    closeBio(p);
    expect(p.keyLock).toBe(false);
  });

  test("kept on purpose: an NPC's Bio opens from anywhere on the screen", () => {
    const s = scene();
    const p = s.join("Al", 1, 12);
    s.put(1, "Akadius", 16, 1); // the far corner
    expect(clickNpc(s.room(), p, 1, s.rng).out[0]?.msg).toMatchObject({
      t: "bio",
      name: "Akadius",
    });
    expect(p.keyLock).toBe(true);
  });

  test("Buy opens the list and the keys stay locked until CANCEL", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    s.put(1, "Akadius", 7, 3);
    clickNpc(s.room(), p, 1, s.rng);
    const out = shopListIntent(s.ctx(), p, "buy");
    expect(out[0]?.msg).toMatchObject({ t: "shop", mode: "buy" });
    expect(p.bio).toBeNull();
    expect(p.keyLock).toBe(true);
    shopCancelIntent(p);
    expect(p.keyLock).toBe(false);
  });

  test("bug fixed: a Slime's loot-only file opens no window and leaves the keys free", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    s.put(1, "Slime", 7, 5);
    expect(clickNpc(s.room(), p, 1, s.rng).out).toEqual([]);
    expect([p.keyLock, p.bio]).toEqual([false, null]);
  });

  test("no data (Pig, a 0-byte file) does nothing; Faction members name themselves", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    s.put(1, "Fire Demon", 9, 9);
    s.put(2, "Warrior Faction Member", 10, 9);
    expect(clickNpc(s.room(), p, 1, s.rng).out).toEqual([]);
    expect(chat(clickNpc(s.room(), p, 2, s.rng).out, "Al")).toEqual([
      "This is a Warrior Faction Member.",
    ]);
    p.keyLock = true;
    expect(clickNpc(s.room(), p, 2, s.rng).out).toEqual([]);
  });

  test("bug fixed: clicking a Pig grabs only that Pig, on your faced tile; a removal leaves pig countdowns alone", () => {
    const s = scene();
    const p = s.join("Al", 6, 4); // faces north
    const q = s.join("Bo", 2, 2);
    q.piggie = 300;
    const far = s.put(1, "Pig", 12, 9);
    const cril = s.put(2, "Cril", 6, 3);
    // A Pig across the screen: nothing, and Cril on the faced tile stays.
    expect(clickNpc(s.room(), p, 1, s.rng)).toEqual({ out: [], slotsChanged: false });
    expect([far.live?.name, cril.live?.name]).toEqual(["Pig", "Cril"]);
    expect(p.char.bag[0]).toBeNull();
    cril.live = null;
    const pig = s.put(3, "Pig", 6, 3);
    expect(clickNpc(s.room(), p, 3, s.rng).slotsChanged).toBe(true);
    expect(pig.live).toBeNull();
    expect(p.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
    expect(p.piggie).toBe(500);
    expect(q.piggie).toBe(300);
  });

  test("bug fixed: a monster leaving its slot leaves everyone's pig countdown alone", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.piggie = 450;
    const slime = s.put(1, "Slime", 6, 3);
    if (slime.live) {
      slime.live.hp = -1;
    }
    expect(cancelSlot(s.room(), slime)).toHaveLength(1);
    expect(p.piggie).toBe(450);
  });

  test("bug fixed: a Snow Demon is no Pig: a click opens nothing and Ctrl grabs nothing", () => {
    const s = scene();
    const p = s.join("Al", 6, 4); // faces north
    const demon = s.put(1, "Snow Demon", 6, 3);
    const cril = s.put(2, "Cril", 6, 2);
    expect(clickNpc(s.room(), p, 1, s.rng).slotsChanged).toBe(false);
    expect([demon.live?.name, cril.live?.name]).toEqual(["Snow Demon", "Cril"]);
    actionIntent(s.ctx(), s.room(), p);
    expect(demon.live?.name).toBe("Snow Demon");
    expect(p.char.bag[0]).toBeNull();
  });

  test("bug fixed: a full bag refuses the grab without starting the countdown; a Pig stack takes it", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.char.bag = Array.from({ length: 15 }, (_, i) => ({ item: `Rock${i}`, qty: 1 }));
    p.char.bag[4] = { item: "Cooked Pig", qty: 1 };
    const pig = s.put(1, "Pig", 6, 3);
    expect(chat(clickNpc(s.room(), p, 1, s.rng).out, "Al")).toEqual([
      "You are carrying too much to pick up the pig!",
    ]);
    expect([p.piggie, pig.live?.name]).toEqual([0, "Pig"]);
    p.char.bag[4] = { item: "Pig", qty: 2 };
    clickNpc(s.room(), p, 1, s.rng);
    expect(pig.live).toBeNull();
    expect(p.char.bag[4]).toEqual({ item: "Pig", qty: 3 });
    expect(p.piggie).toBe(500);
  });

  test("the tick counts the pig countdown down", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.piggie = 3;
    tick(s.world, {
      loadMap: () => s.map,
      casino: NO_CASINO,
      saveIntervalTicks: 600,
      rng: s.rng,
    });
    expect(p.piggie).toBe(2);
  });
});

describe("RND chatter", () => {
  test("bug fixed: a talking NPC speaks once per interval, whatever the crowd; then the line", () => {
    const s = scene({ 2: [2] });
    const god = s.put(1, "Fire God", 9, 9);
    s.rng.calls.length = 0;
    for (let i = 0; i < 99; i++) {
      expect(chatterTick(s.world.npcs, god, 100, s.rng)).toBeNull();
    }
    expect(s.rng.calls).toEqual([]);
    expect(chatterTick(s.world.npcs, god, 100, s.rng)).toBe(
      'Fire God says "Fire does not effect us in the slightest."',
    );
    expect(s.rng.calls).toEqual([2]); // the line, of two
    // The countdown starts again.
    expect(chatterTick(s.world.npcs, god, 100, s.rng)).toBeNull();
    expect(god.live?.chatIn).toBe(99);
  });

  test("bug fixed: the tick says it once to the whole map, however many players are on it", () => {
    const s = scene();
    const al = s.join("Al", 6, 4);
    const bo = s.join("Bo", 2, 2);
    const cy = s.join("Cy", 12, 9);
    s.put(1, "Fire God", 9, 9);
    const deps = {
      loadMap: () => s.map,
      casino: NO_CASINO,
      saveIntervalTicks: 10_000,
      npcChatterSeconds: 10, // 200 ticks
      rng: s.rng,
    };
    const heard: string[][] = [[], [], []];
    for (let i = 0; i < 400; i++) {
      const out = tick(s.world, deps).out;
      [al, bo, cy].forEach((p, k) => {
        heard[k]?.push(...chat(out, p.id).filter((l) => l.includes("Fire God says")));
      });
    }
    expect(heard.map((h) => h.length)).toEqual([2, 2, 2]);
  });

  test("a monster with data but no RND lines never speaks", () => {
    const s = scene();
    const slime = s.put(1, "Slime", 9, 9);
    s.rng.calls.length = 0;
    for (let i = 0; i < 5; i++) {
      expect(chatterTick(s.world.npcs, slime, 2, s.rng)).toBeNull();
    }
    expect(s.rng.calls).toEqual([]);
  });
});

describe("gold to an NPC", () => {
  test("bug fixed: the offer line, then 'Thanks for the gold!' with its closing quote; the NPC's GLD grows", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.char.gold = 100;
    s.put(1, "Akadius", 6, 2); // two tiles ahead
    const out = goldIntent(s.ctx(), s.room(), p, 30);
    expect(chat(out, "Al")).toEqual([
      "*** Offering the 30 gold to Akadius.",
      'Akadius says "Thanks for the gold!"',
    ]);
    expect(p.char.gold).toBe(70);
    expect(s.world.shops.get("Akadius")?.gold).toBe(294825 + 30);
  });

  test("a name in the MONSTER list (contains: 'Dragon') exits silently", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.char.gold = 100;
    s.put(1, "Slime", 6, 3);
    expect(goldIntent(s.ctx(), s.room(), p, 30)).toEqual([]);
    expect(p.char.gold).toBe(100);
  });
});

describe("trade", () => {
  const two = () => {
    const s = scene();
    const a = s.join("A", 6, 4);
    const b = s.join("B", 7, 4);
    a.char.gold = 100;
    a.char.bag = emptyBag();
    a.char.bag[0] = { item: "Apple", qty: 5 };
    b.char.bag = emptyBag();
    b.char.bag[2] = { item: "Knife", qty: 1 };
    return { s, a, b };
  };

  test("bug fixed: A offers, B offers, both accept: one move, and both are told it is complete", () => {
    const { s, a, b } = two();
    expect(chat(openTrade(s.world, a, "A"), "A")).toEqual(["You can't trade with yourself!"]);
    openTrade(s.world, a, "B");
    // The amounts are clamped to what A holds (TW 4:4-57).
    let out = offerTrade(s.world, a, {
      t: "tradeOffer",
      gold: 500,
      items: [{ slot: 1, qty: 9 }],
    });
    expect(chat(out, "B")).toEqual(["A is initiating a trade with you."]);
    expect(out.find((o) => o.to === "B" && o.msg.t === "trade")?.msg).toEqual({
      t: "trade",
      trade: {
        you: "b",
        self: "B",
        partner: "A",
        mine: null,
        theirs: { gold: 100, items: [{ item: "Apple", qty: 5 }] },
        mineAccepted: false,
        theirsAccepted: false,
      },
    });
    out = offerTrade(s.world, b, { t: "tradeOffer", gold: 0, items: [{ slot: 3, qty: 1 }] });
    expect(chat(out, "A")).toEqual([
      "B has selected the items to trade. Accept or cancel the trade.",
    ]);
    // B accepts first; nothing moves until A does too.
    out = acceptTrade(s.world, b);
    expect(chat(out, "B")).toEqual(["You accept the trade..."]);
    expect(chat(out, "A")).toEqual(["B accepts the trade..."]);
    expect(a.char.gold).toBe(100);
    expect(acceptTrade(s.world, b)).toEqual([]);
    out = acceptTrade(s.world, a);
    expect(chat(out, "A")).toEqual(["You accept the trade...", "The trade is complete."]);
    expect(chat(out, "B")).toEqual(["A accepts the trade...", "The trade is complete."]);
    expect(a.char.gold).toBe(0);
    expect(b.char.gold).toBe(100);
    expect(a.char.bag[0]).toEqual({ item: "Knife", qty: 1 });
    expect(b.char.bag[0]).toEqual({ item: "Apple", qty: 5 });
    expect(a.trade).toBeNull();
    expect(b.trade).toBeNull();
  });

  test("bug fixed: an accept checks that the partner is still on your map", () => {
    const { s, a, b } = two();
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 10, items: [] });
    offerTrade(s.world, b, { t: "tradeOffer", gold: 0, items: [{ slot: 3, qty: 1 }] });
    b.map = testMap("x1001y992");
    const out = acceptTrade(s.world, a);
    expect(out).toEqual([
      {
        to: "A",
        msg: { t: "chat", text: "B is no longer in your area, you cannot trade.", color: 0 },
      },
    ]);
    expect(a.char.gold).toBe(100);
    expect(b.char.bag[2]).toEqual({ item: "Knife", qty: 1 });
    expect(a.trade).not.toBeNull();
  });

  test("bug fixed: either side can change its offer, which clears both acceptances", () => {
    const { s, a, b } = two();
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 10, items: [] });
    offerTrade(s.world, b, { t: "tradeOffer", gold: 0, items: [{ slot: 3, qty: 1 }] });
    acceptTrade(s.world, b);
    // A raises the offer: B's acceptance is cleared and B is told.
    const out = offerTrade(s.world, a, { t: "tradeOffer", gold: 30, items: [] });
    expect(chat(out, "B")).toEqual(["A has changed the offer. Check it before you accept."]);
    expect(out.find((o) => o.to === "B" && o.msg.t === "trade")?.msg).toMatchObject({
      trade: { theirs: { gold: 30 }, mineAccepted: false },
    });
    acceptTrade(s.world, a);
    expect(a.char.gold).toBe(100);
    acceptTrade(s.world, b);
    expect(a.char.gold).toBe(70);
    expect(b.char.gold).toBe(30);
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 5 });
    expect(a.char.bag[1]).toEqual({ item: "Knife", qty: 1 });
  });

  test("a failed move changes nothing and tells both", () => {
    const { s, a, b } = two();
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 0, items: [{ slot: 1, qty: 1 }] });
    offerTrade(s.world, b, { t: "tradeOffer", gold: 0, items: [] });
    b.char.bag = Array.from({ length: 15 }, (_, i) => ({ item: `Rock${i}`, qty: 1 }));
    acceptTrade(s.world, b);
    const out = acceptTrade(s.world, a);
    expect(chat(out, "B")).toContain("There was a problem with the transaction. Try again!");
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 5 });
    expect(settle(a.char, b.char, { gold: 101, items: [] }, { gold: 0, items: [] })).toBeNull();
  });

  test("bug fixed: Cancel: whoever cancels hears 'You cancel the trade.', the partner 'Trade cancelled.'", () => {
    const { s, a, b } = two();
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 1, items: [] });
    let out = cancelTrade(s.world, a);
    expect(chat(out, "A")).toEqual(["You cancel the trade."]);
    expect(chat(out, "B")).toEqual(["Trade cancelled."]);
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 1, items: [] });
    out = cancelTrade(s.world, b);
    expect(chat(out, "B")).toEqual(["You cancel the trade."]);
    expect(chat(out, "A")).toEqual(["Trade cancelled."]);
  });

  test("a third player cannot take B over; a trader leaving ends it for both", () => {
    const { s, a, b } = two();
    const c = s.join("C", 8, 4);
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 1, items: [] });
    openTrade(s.world, c, "B");
    const out = offerTrade(s.world, c, { t: "tradeOffer", gold: 0, items: [] });
    expect(chat(out, "C")).toEqual(["Trade cancelled."]);
    expect(b.trade).toBe(a.trade);
    expect(chat(leaveTrade(s.world, b), "A")).toEqual(["Trade cancelled."]);
    expect(a.trade).toBeNull();
  });
});
