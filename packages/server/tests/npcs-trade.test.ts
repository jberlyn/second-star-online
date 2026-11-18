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
import { chatterRoll, clickNpc, closeBio } from "../src/systems/monsters/npc.ts";
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
    s.live = placeMonster(s, species, x, y, rng);
    return s;
  };
  return { map, world, rng, ctx, join, room, put };
}

describe("clicking a monster or NPC", () => {
  test("an NPC with data opens its Bio, with no range check, and holds the keys until it closes", () => {
    const s = scene();
    const p = s.join("Al", 1, 12);
    s.put(1, "Akadius", 16, 1);
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

  test("Buy opens the list and the keys stay locked until CANCEL", () => {
    const s = scene();
    const p = s.join("Al", 1, 12);
    s.put(1, "Akadius", 16, 1);
    clickNpc(s.room(), p, 1, s.rng);
    const out = shopListIntent(s.ctx(), p, "buy");
    expect(out[0]?.msg).toMatchObject({ t: "shop", mode: "buy" });
    expect(p.bio).toBeNull();
    expect(p.keyLock).toBe(true);
    shopCancelIntent(p);
    expect(p.keyLock).toBe(false);
  });

  test("kept bug: a Slime's loot-only file opens an empty Bio and locks you", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    s.put(1, "Slime", 9, 9);
    const r = clickNpc(s.room(), p, 1, s.rng);
    expect(r.out[0]?.msg).toEqual({
      t: "bio",
      name: "Slime",
      bio: [],
      profile: [],
      buy: false,
      sell: false,
      train: false,
    });
    expect(p.keyLock).toBe(true);
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

  test("kept bug: clicking any Pig grabs whatever stands on your faced tile, here Cril; any Cncl sets everyone's pig countdown to 20", () => {
    const s = scene();
    const p = s.join("Al", 6, 4); // faces north
    const q = s.join("Bo", 2, 2);
    s.put(1, "Pig", 12, 9);
    const cril = s.put(2, "Cril", 6, 3);
    const r = clickNpc(s.room(), p, 1, s.rng);
    expect(r.slotsChanged).toBe(true);
    expect(cril.live).toBeNull();
    expect(p.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
    expect(p.piggie).toBe(20);
    expect(q.piggie).toBe(20);
  });

  test('kept bug: Snow Demon runs the pig grab: its body 891 contains "91-", so a click on it grabs what you face, and Ctrl grabs a faced Snow Demon as a Pig', () => {
    const s = scene();
    const p = s.join("Al", 6, 4); // faces north
    s.put(1, "Snow Demon", 12, 9);
    const cril = s.put(2, "Cril", 6, 3);
    expect(clickNpc(s.room(), p, 1, s.rng).slotsChanged).toBe(true);
    expect(cril.live).toBeNull();
    expect(p.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
    // Ctrl on the faced tile tests the faced monster's own body: a Snow Demon passes.
    p.piggie = 0;
    const demon = s.put(3, "Snow Demon", 6, 3);
    expect(actionIntent(s.ctx(), s.room(), p)).not.toEqual([]);
    expect(demon.live).toBeNull();
    expect(p.char.bag[0]).toEqual({ item: "Pig", qty: 2 });
  });

  test("the grab's cooldown is set before the bag test; 'Pig' in the bag text skips it", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.char.bag = Array.from({ length: 15 }, (_, i) => ({ item: `Rock${i}`, qty: 1 }));
    s.put(1, "Pig", 6, 3);
    expect(chat(clickNpc(s.room(), p, 1, s.rng).out, "Al")).toEqual([
      "You are carrying too much to pick up the pig!",
    ]);
    expect(p.piggie).toBe(500);
    p.piggie = 0;
    p.char.bag[4] = { item: "Cooked Pig", qty: 1 };
    clickNpc(s.room(), p, 1, s.rng);
    // InvAdd finds no room, so no Pig; the pig is gone all the same (an assumption: the
    // archive does not say).
    expect(s.map.slots[0]?.live).toBeNull();
  });

  test("the tick counts the pig countdown down", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.piggie = 3;
    tick(s.world, {
      loadMap: () => s.map,
      startPoint: { map: s.map.name, x: 6, y: 4 },
      casino: NO_CASINO,
      saveIntervalTicks: 600,
      rng: s.rng,
    });
    expect(p.piggie).toBe(2);
  });
});

describe("RND chatter", () => {
  test("random(15), then all six UserList draws with the last, random(400), deciding; then the line (bug ledger)", () => {
    const s = scene({ 15: [1], 400: [1], 2: [2] });
    s.join("Al", 6, 4);
    const god = s.put(1, "Fire God", 9, 9);
    expect(chatterRoll(s.world.npcs, god, s.rng)).toBe(
      'Fire God says "Fire does not effect us in the slightest."',
    );
    expect(s.rng.calls).toEqual([4, 15, 12000, 12000, 6000, 3000, 900, 400, 2]);
  });

  test("a monster with data but no RND lines draws only random(15)", () => {
    const s = scene({ 15: [1] });
    const slime = s.put(1, "Slime", 9, 9);
    s.rng.calls.length = 0;
    expect(chatterRoll(s.world.npcs, slime, s.rng)).toBeNull();
    expect(s.rng.calls).toEqual([15]);
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
