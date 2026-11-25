/**
 * Item reconciliation's rules (issue #35): how each activity type counts towards what exists, what
 * a stored name counts as, and how a run's lines are worked out.
 */
import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_GROUPS,
  ACTIVITY_TYPES,
  type ActivityType,
} from "../../src/rules/admin/activity.ts";
import {
  ACTIVITY_COUNTS,
  activityChange,
  addCount,
  addFlow,
  COUNTED_ACTIVITY_TYPES,
  type CountMap,
  CURRENCY_KEY,
  countedPile,
  type FlowMap,
  nightlyDue,
  reconcileFlagged,
  reconcileItems,
  WORLD_ACTIVITY_TYPES,
} from "../../src/rules/admin/reconcile.ts";

const row = (
  type: ActivityType,
  qty = 0,
  gold = 0,
  details: Record<string, string | number | boolean> | null = null,
) => ({ type, qty, gold, details });

describe("how a row counts", () => {
  test("every type is classed; only item and quest types count, and the world events are items", () => {
    for (const t of ACTIVITY_TYPES) {
      expect(ACTIVITY_COUNTS[t]).toBeDefined();
    }
    const counted = new Set<string>([...ACTIVITY_GROUPS.items, "quest"]);
    expect(new Set(COUNTED_ACTIVITY_TYPES)).toEqual(counted as Set<ActivityType>);
    for (const t of WORLD_ACTIVITY_TYPES) {
      expect(ACTIVITY_GROUPS.items).toContain(t);
      expect(ACTIVITY_COUNTS[t]).toBe("make");
    }
  });

  test("the classification is the decided one", () => {
    const by = (c: string): string[] =>
      ACTIVITY_TYPES.filter((t) => ACTIVITY_COUNTS[t] === c).sort();
    expect(by("move")).toEqual(
      [
        "trade",
        "give",
        "drop",
        "pickup",
        "playerShop",
        "bank",
        "vault",
        "container",
        "deathDrop",
      ].sort(),
    );
    expect(by("make")).toEqual(
      [
        "buy",
        "sell",
        "reward",
        "pay",
        "use",
        "spell",
        "loot",
        "gather",
        "craft",
        "transform",
        "quest",
        "casino",
        "admin",
        "decay",
        "refill",
        "demolish",
        "regrow",
      ].sort(),
    );
    expect(by("unlogged")).toEqual(["unlogged"]);
  });

  test("a move changes nothing; a make or end counts its signed qty and gold", () => {
    expect(activityChange(row("trade", -2, 50))).toEqual({ item: 0, gold: 0, unlogged: false });
    expect(activityChange(row("bank", 0, -500))).toEqual({ item: 0, gold: 0, unlogged: false });
    expect(activityChange(row("buy", 2, -10))).toEqual({ item: 2, gold: -10, unlogged: false });
    expect(activityChange(row("use", -1))).toEqual({ item: -1, gold: 0, unlogged: false });
    expect(activityChange(row("decay", -3))).toEqual({ item: -3, gold: 0, unlogged: false });
    expect(activityChange(row("kill", 5, 5))).toEqual({ item: 0, gold: 0, unlogged: false });
  });

  test("an unlogged row is kept apart", () => {
    expect(activityChange(row("unlogged", 1))).toEqual({ item: 1, gold: 0, unlogged: true });
    expect(activityChange(row("unlogged", 0, -40))).toEqual({ item: 0, gold: -40, unlogged: true });
  });

  test("placed, stored, vault and bank details are made; lost ends, whatever the type", () => {
    // Loot on the ground, a faction head at a death, gold placed by `/drop`.
    expect(activityChange(row("loot", 0, 0, { placed: 3 })).item).toBe(3);
    expect(activityChange(row("deathDrop", 0, 0, { placed: 1 })).item).toBe(1);
    expect(activityChange(row("admin", 0, 0, { placedGold: 100 })).gold).toBe(100);
    // A deathDrop that stays on the ground is a move; a vehicle lost at a death ends.
    expect(activityChange(row("deathDrop", -1)).item).toBe(0);
    expect(activityChange(row("deathDrop", 0, 0, { lost: 1 })).item).toBe(-1);
    // A pickup into a full bag destroys the item.
    expect(activityChange(row("pickup", 0, 0, { lost: 2 })).item).toBe(-2);
    // A prize that found no room was never made: its `lost` takes nothing away.
    expect(activityChange(row("reward", 0, 0, { lost: 1 })).item).toBe(0);
    // An unstocked sale to a player shop destroys the item sold.
    expect(activityChange(row("playerShop", -1, 0, { lost: 1 })).item).toBe(-1);
    // A Cauldron's brew, an admin's vault and bank changes.
    expect(activityChange(row("craft", 0, 0, { stored: -2 })).item).toBe(-2);
    expect(activityChange(row("admin", 0, 0, { vault: -4 })).item).toBe(-4);
    expect(activityChange(row("admin", 0, 0, { bank: 250 })).gold).toBe(250);
  });

  test("a monster grabbed into the bag, or let go from it, counts though it is a pickup or drop", () => {
    expect(activityChange(row("pickup", 1, 0, { as: "monster" })).item).toBe(1);
    expect(activityChange(row("drop", -1, 0, { as: "monster" })).item).toBe(-1);
    expect(activityChange(row("pickup", 1)).item).toBe(0);
  });
});

describe("what a stored name counts as", () => {
  test("gold piles, crystal piles, containers and vehicles", () => {
    expect(countedPile("15 Gold")).toEqual({ gold: 15 });
    expect(countedPile("15 Gold", 2)).toEqual({ gold: 30 });
    expect(countedPile("5 Blue Crystal")).toEqual({ item: "Blue Crystal", n: 5 });
    expect(countedPile("Crate#12")).toEqual({ item: "Crate", n: 1 });
    expect(countedPile("Apple", 7)).toEqual({ item: "Apple", n: 7 });
    expect(countedPile("Bob's Airship")).toEqual({ item: "Airship", n: 1 });
    expect(countedPile("Ann's Battleship")).toEqual({ item: "Battleship", n: 1 });
  });

  test("fixtures and doors and switches that are renamed in place are not counted", () => {
    for (const name of [
      "Bob's Door",
      "Bob's Opened Door",
      "Bob's House Vault",
      "Alice's Newspaper",
      "The Hawks's Guild Vault",
      "Exit",
      "Sign 1",
      "Steel Door",
      "Open Steel Door",
      "ON Switch",
      "OFF Switch",
      "",
    ]) {
      expect(countedPile(name)).toBeNull();
    }
    expect(countedPile("Apple", 0)).toBeNull();
  });
});

describe("a run's lines", () => {
  const counts = (...xs: [string, string, number][]): CountMap => {
    const m: CountMap = new Map();
    for (const [k, item, n] of xs) {
      addCount(m, k, item, n);
    }
    return m;
  };

  test("expected is the baseline plus made less ended; the difference is what was counted beyond", () => {
    const flows: FlowMap = new Map();
    addFlow(flows, "apple", "Apple", 5, false);
    addFlow(flows, "apple", "Apple", -2, false);
    addFlow(flows, CURRENCY_KEY, "Gold", -100, false);
    addFlow(flows, "sword", "Sword", 1, true);
    const lines = reconcileItems(
      counts(["apple", "Apple", 10], [CURRENCY_KEY, "Gold", 1000], ["sword", "Sword", 1]),
      flows,
      counts(["apple", "Apple", 13], [CURRENCY_KEY, "Gold", 900], ["sword", "Sword", 2]),
      "Gold",
    );
    expect(lines.find((l) => l.item === "Apple")).toEqual({
      item: "Apple",
      currency: false,
      baseline: 10,
      made: 5,
      ended: 2,
      unlogged: 0,
      expected: 13,
      actual: 13,
      difference: 0,
    });
    expect(lines.find((l) => l.currency)).toMatchObject({ expected: 900, difference: 0 });
    // An unlogged dupe: kept out of expected, so it is still a difference, with the row beside it.
    expect(lines[0]).toMatchObject({ item: "Sword", unlogged: 1, expected: 1, difference: 1 });
    expect(lines.filter(reconcileFlagged).map((l) => l.item)).toEqual(["Sword"]);
  });

  test("the first run only takes the baseline", () => {
    const flows: FlowMap = new Map();
    addFlow(flows, "apple", "Apple", 5, false);
    const lines = reconcileItems(null, flows, counts(["apple", "Apple", 3]), "Gold");
    expect(lines).toEqual([
      {
        item: "Apple",
        currency: false,
        baseline: 3,
        made: 0,
        ended: 0,
        unlogged: 0,
        expected: 3,
        actual: 3,
        difference: 0,
      },
    ]);
  });

  test("an item gone from everywhere still has a line, and one never seen has none", () => {
    const lines = reconcileItems(counts(["apple", "Apple", 2]), new Map(), new Map(), "Gold");
    expect(lines).toMatchObject([{ item: "Apple", expected: 2, actual: 0, difference: -2 }]);
    expect(reconcileItems(new Map(), new Map(), new Map(), "Gold")).toEqual([]);
  });
});

test("the nightly run is due at the hour, UTC, today or yesterday", () => {
  const at = (iso: string) => new Date(nightlyDue(Date.parse(iso))).toISOString();
  expect(at("2026-11-25T09:00:00.000Z")).toBe("2026-11-25T04:00:00.000Z");
  expect(at("2026-11-25T04:00:00.000Z")).toBe("2026-11-25T04:00:00.000Z");
  expect(at("2026-11-25T03:59:59.000Z")).toBe("2026-11-24T04:00:00.000Z");
});
