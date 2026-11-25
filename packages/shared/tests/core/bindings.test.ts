/**
 * The single bindings (`bindings.json`, issue #37 stage 2): the currency, the start, the cannon's
 * ammo and the special bodies come from content, and a binding left out turns its mechanic off.
 * Classic's values are pinned where each mechanic is tested; these tests rebind them.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { npcLootItemOk } from "../../src/rules/admin/npcfile.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { groundPicture } from "../../src/rules/inventory/ground.ts";
import {
  afterCountIsGold,
  CURRENCY,
  emptyBag,
  goldPileName,
  invAdd,
  isGoldName,
} from "../../src/rules/inventory/inventory.ts";
import { startingCharacter } from "../../src/rules/progression/creation.ts";
import { prizeLineOk } from "../../src/rules/social/assassin.ts";
import { giveBio } from "../../src/rules/social/bios.ts";
import { morphBody, smokeBody, treeBody } from "../../src/rules/spells/spells.ts";
import { cannonballSlot } from "../../src/rules/vehicles/cannon.ts";
import { VEHICLE_BODY, vehicleOfBody } from "../../src/rules/vehicles/vehicles.ts";

/** `random(n)` answers from a list, then `n`. */
const queue = (results: number[] = []): Rng & { calls: number[] } => {
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      return results.length > 0 ? (results.shift() as number) : n;
    },
  };
};

/** Runs `body` with Classic changed by `change`, then puts Classic back. */
function withBindings(change: (d: ContentData) => void, body: () => void): void {
  const d = structuredClone(classicData) as ContentData;
  change(d);
  installContent(buildContentStore(d));
  try {
    body();
  } finally {
    installContent(buildContentStore(classicData));
  }
}

/** Classic with a Silver Coin item as the currency. */
const silver = (d: ContentData) => {
  d.items.items.push({ name: "Silver Coin", icon: null });
  d.bindings.currency = { item: "Silver Coin" };
};

const choice = {
  name: "alice",
  sex: 1,
  head: 1,
  classCode: 1,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
} as const;

describe("the currency", () => {
  test("Classic's is Gold: a pile is `<n> Gold`", () => {
    expect(CURRENCY).toBe("Gold");
    expect(goldPileName(15)).toBe("15 Gold");
    expect([isGoldName("15 Gold"), isGoldName("Gold Axe"), isGoldName("15 Silver Coin")]).toEqual([
      true,
      false,
      false,
    ]);
    expect([afterCountIsGold("5 gold"), afterCountIsGold("5 gold coins")]).toEqual([true, true]);
  });

  test("a world's own currency names its piles, its pickups and its drop lines", () => {
    withBindings(silver, () => {
      expect(goldPileName(15)).toBe("15 Silver Coin");
      expect([isGoldName("15 Silver Coin"), isGoldName("15 Gold")]).toEqual([true, false]);
      // The three pile pictures stay the engine's, whatever the currency is called.
      expect(groundPicture("75 Silver Coin")).toBe("MediumGold");
      expect(groundPicture("75 Gold")).toBe("75 Gold");
      // Picking a pile up adds to the purse; `15 Gold` is now an item like any other.
      const inv = { bag: emptyBag(), gold: 0 };
      expect(invAdd(inv, "15 Silver Coin", 1, queue())).toEqual({ kind: "gold", amount: 15 });
      expect(inv.gold).toBe(15);
      expect(invAdd(inv, "15 Gold", 1, queue()).kind).not.toBe("gold");
      // A multi-word currency must be written out in full after the count.
      expect([afterCountIsGold("5 silver coin"), afterCountIsGold("5 silver")]).toEqual([
        true,
        false,
      ]);
      expect([npcLootItemOk("5 Silver Coin"), npcLootItemOk("5 Silverware")]).toEqual([
        true,
        false,
      ]);
      expect([prizeLineOk("500 Silver Coin"), prizeLineOk("500 Gold")]).toEqual([true, false]);
    });
  });

  test("only `<n> <currency>` is a pile: a currency named Coin leaves Silver Coin an item", () => {
    withBindings(
      (d) => {
        d.items.items.push({ name: "Coin", icon: null }, { name: "Silver Coin", icon: null });
        d.bindings.currency = { item: "Coin" };
      },
      () => {
        expect([
          isGoldName("5 Coin"),
          isGoldName("Silver Coin"),
          isGoldName("5 Silver Coin"),
        ]).toEqual([true, false, false]);
        const inv = { bag: emptyBag(), gold: 0 };
        expect(invAdd(inv, "Silver Coin", 1, queue()).kind).not.toBe("gold");
        expect([inv.gold, inv.bag[0]]).toEqual([0, { item: "Silver Coin", qty: 1 }]);
      },
    );
  });

  test("a world with no currency has no piles", () => {
    withBindings(
      (d) => {
        d.bindings.currency = {};
      },
      () => {
        expect(CURRENCY).toBeNull();
        expect(goldPileName(15)).toBeNull();
        expect([isGoldName("15 Gold"), afterCountIsGold("15 Gold")]).toEqual([false, false]);
      },
    );
  });
});

describe("the start", () => {
  test("Classic's: 20 HP and SP, two Apples and a Knife", () => {
    const c = startingCharacter(choice);
    expect([c.hp, c.hpMax, c.sp, c.spMax]).toEqual([20, 20, 20, 20]);
    expect(c.bag).toEqual([
      { item: "Apple", qty: 2 },
      { item: "Knife", qty: 1 },
    ]);
  });

  test("a world's own vitals and bag", () => {
    withBindings(
      (d) => {
        d.bindings.start = { hp: 35, sp: 0, bag: [{ item: "Bread", qty: 3 }] };
      },
      () => {
        const c = startingCharacter(choice);
        expect([c.hp, c.hpMax, c.sp, c.spMax]).toEqual([35, 35, 0, 0]);
        expect(c.bag).toEqual([{ item: "Bread", qty: 3 }]);
      },
    );
  });
});

describe("the cannon's ammo", () => {
  const bag = () => {
    const b = emptyBag();
    b[0] = { item: "Iron Ball", qty: 2 };
    b[3] = { item: "Cannonball", qty: 5 };
    return b;
  };

  test("Classic's is the Cannonball", () => {
    expect(cannonballSlot(bag())).toBe(3);
  });

  test("a world's own ammo, or none: a cannon with no ammo never fires", () => {
    withBindings(
      (d) => {
        d.bindings.cannon = { ammo: "Iron Ball" };
      },
      () => {
        expect(cannonballSlot(bag())).toBe(0);
      },
    );
    withBindings(
      (d) => {
        d.bindings.cannon = {};
      },
      () => {
        expect(cannonballSlot(bag())).toBe(-1);
      },
    );
  });
});

describe("the special bodies", () => {
  test("a world's own morph table; none: Morph rolls nothing and does nothing", () => {
    withBindings(
      (d) => {
        d.bindings.bodies.morph = [
          { above: 0, body: 200 },
          { above: 9, body: 201 },
        ];
      },
      () => {
        expect(morphBody(1, queue([1]))).toBe(200);
        expect(morphBody(5, queue([2]))).toBe(201);
      },
    );
    withBindings(
      (d) => {
        delete d.bindings.bodies.morph;
      },
      () => {
        const rng = queue([1]);
        expect(morphBody(1, rng)).toBeNull();
        expect(rng.calls).toEqual([]);
      },
    );
  });

  test("the tree and the smoke; left out, their spells do nothing", () => {
    expect([treeBody(), smokeBody()]).toEqual([80, 100]);
    withBindings(
      (d) => {
        d.bindings.bodies.tree = 300;
        delete d.bindings.bodies.smoke;
      },
      () => {
        expect([treeBody(), smokeBody()]).toEqual([300, null]);
        // The tree's bio shows its body.
        expect(
          giveBio({
            name: "Ann",
            sex: 1,
            level: 1,
            profile: "",
            medals: "",
            skills: [],
            hpMax: 20,
            spMax: 20,
            guild: null,
            faction: null,
            wanted: false,
            body: 300,
            tree: true,
            bodyItem: "",
            inVehicle: false,
          }).at(-1),
        ).toBe("300");
      },
    );
  });

  test("a world's own rider bodies say which vehicle a rider is on", () => {
    withBindings(
      (d) => {
        // A rider's body is its vehicle row's (issue #44).
        for (const v of d.houses.vehicles ?? []) {
          v.rider += 100;
        }
      },
      () => {
        expect(VEHICLE_BODY).toEqual({ Boat: 155, Battleship: 156, Airship: 157 });
        expect([vehicleOfBody(155), vehicleOfBody(157), vehicleOfBody(55)]).toEqual([
          "Boat",
          "Airship",
          null,
        ]);
      },
    );
    expect(vehicleOfBody(55)).toBe("Boat");
  });
});
