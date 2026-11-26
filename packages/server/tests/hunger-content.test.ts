/**
 * Hunger as content: every number and line of the mechanic is the balance row `hunger`, an item's
 * use can raise or lower hunger, and a world may show players their own hunger on the Stats tab.
 * Classic's row is 1.6's (balance-golden.test.ts pins the values): hidden, with its three warnings
 * and break-odds steps, and a stuffed player refused every usable item.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import { balanceDataSchema } from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  breakOdds,
  buildContentStore,
  type ContentData,
  type CreationChoice,
  clampHunger,
  content,
  deathHunger,
  fullBalance,
  hungerLimits,
  hungerState,
  hungerTick,
  hungerView,
  installContent,
  type Rng,
  startingCharacter,
  useItem,
} from "@secondstaronline/shared";

import { balanceRowDef, withEngine } from "../src/content/balance.ts";
import type { Player } from "../src/systems/world/world.ts";
import { player, setup, testMap } from "./helpers/sim.ts";

type Hunger = NonNullable<NonNullable<ContentData["balance"]>["hunger"]>;

/** Classic with its hunger row changed by `edit`, installed (only rows the server would accept). */
function withHunger(edit: (h: Hunger) => void, more?: (d: ContentData) => void): void {
  const d = structuredClone(classicData) as ContentData;
  const b = d.balance as NonNullable<ContentData["balance"]>;
  b.hunger = { ...(b.hunger as Hunger) };
  edit(b.hunger);
  more?.(d);
  balanceDataSchema.parse(d.balance);
  installContent(buildContentStore(d));
}

afterEach(() => {
  installContent(buildContentStore(classicData as ContentData));
});

/** A new Fighter as the creation screen sends one. */
const creation = (): CreationChoice => ({
  name: "Ann",
  sex: 1,
  head: 1,
  classCode: 1,
  str: 10,
  sta: 10,
  int: 10,
  wis: 10,
  dex: 10,
});

const low: Rng = { random: (n) => (n >= 1 ? 1 : 0) };
const high: Rng = { random: (n) => (n >= 1 ? n : 0) };
const meal = (hunger: number) => ({ hp: 5, hpMax: 50, sp: 5, spMax: 50, hunger });

describe("hunger falls by the row's numbers", () => {
  test("Classic: 1 on a 1-in-3 roll, never below 0", () => {
    expect(content().balance.hunger.lose).toBe(1);
    expect(hungerTick(100, false, low).hunger).toBe(99);
    expect(hungerTick(100, false, high).hunger).toBe(100);
    expect(hungerTick(0, false, low).hunger).toBe(0);
  });

  test("`lose` sets how much a fall takes, floored at 0; 0 means nobody gets hungry", () => {
    withHunger((h) => {
      h.lose = 250;
    });
    expect(hungerTick(1000, false, low).hunger).toBe(750);
    expect(hungerTick(100, false, low).hunger).toBe(0);
    withHunger((h) => {
      h.lose = 0;
    });
    expect(hungerTick(1000, false, low).hunger).toBe(1000);
  });

  test("a row written before the later fields plays the defaults for them", () => {
    const b = fullBalance({
      hunger: { loseOneIn: 5, regenAbove: 600, starveBelow: 60, stuffed: 30_000, afterDeath: 9 },
    });
    expect(b.hunger.loseOneIn).toBe(5);
    expect(b.hunger.lose).toBe(1);
    expect(b.hunger.warnings).toEqual(BALANCE_DEFAULTS.hunger.warnings);
    expect(b.hunger.breakOdds).toEqual(BALANCE_DEFAULTS.hunger.breakOdds);
    expect(b.hunger.stuffedRefuses).toBe("all");
    expect(b.hunger.show).toBe("hidden");
    expect(b.hunger.max).toBe(50_000);
  });
});

describe("warnings are the row's lines", () => {
  test("a world's own warnings, each told once as hunger falls to it", () => {
    withHunger((h) => {
      h.warnings = [
        { at: 20_000, text: "Your stomach rumbles." },
        { at: 5_000, text: "Eat something soon." },
      ];
    });
    expect(hungerTick(20_001, false, low).warning).toBe("Your stomach rumbles.");
    expect(hungerTick(20_000, false, low).warning).toBeNull();
    expect(hungerTick(5_001, false, low).warning).toBe("Eat something soon.");
    // 1.6's lines are gone with the row's.
    expect(hungerTick(1_501, false, low).warning).toBeNull();
  });

  test("a fall past several warnings tells the lowest; no warnings tells nothing", () => {
    withHunger((h) => {
      h.lose = 1000;
    });
    expect(hungerTick(1600, false, low).warning).toBe("You are extremely hungry, you need to eat.");
    withHunger((h) => {
      h.warnings = [];
    });
    expect(hungerTick(1501, false, low).warning).toBeNull();
  });
});

describe("items raise or lower hunger", () => {
  /** Classic, with the Red Potion's use lowering hunger by 5000 in place of raising it. */
  const potionLowers = (d: ContentData) => {
    d.itemRules.use.effects = d.itemRules.use.effects.filter(
      (r) => !(r.pattern === "Red Potion" && r.stat === "Hunger"),
    );
    d.itemRules.use.effects.push({
      match: "exact",
      pattern: "Red Potion",
      stat: "Hunger",
      flat: -5000,
      randomN: null,
    });
  };

  test("a negative amount lowers hunger, never below 0", () => {
    withHunger(() => {}, potionLowers);
    expect(useItem("Red Potion", meal(8000), low).hunger).toBe(3000);
    expect(useItem("Red Potion", meal(2000), low).hunger).toBe(0);
  });

  test("an item that only lowers hunger is never refused when stuffed", () => {
    withHunger(() => {}, potionLowers);
    const r = useItem("Red Potion", meal(36_000), low);
    expect(r.consume).toBe(true);
    expect(r.hunger).toBe(31_000);
    expect(r.lines).not.toContain("You're stuffed!");
  });

  test("Classic (1.6): being stuffed refuses every usable item, healing potions too", () => {
    expect(content().balance.hunger.stuffedRefuses).toBe("all");
    const potion = useItem("Red Potion", meal(35_000), low);
    expect(potion.consume).toBe(false);
    expect(potion.lines).toEqual(["You're stuffed!"]);
  });

  test("`food`: a stuffed player still drinks a potion that doesn't feed, but is refused food", () => {
    // Classic's potions raise hunger too (1.6's data), so this world's Red Potion doesn't.
    withHunger(
      (h) => {
        h.stuffedRefuses = "food";
      },
      (d) => {
        d.itemRules.use.effects = d.itemRules.use.effects.filter(
          (r) => !(r.pattern === "Red Potion" && r.stat === "Hunger"),
        );
      },
    );
    const potion = useItem("Red Potion", meal(35_000), low);
    expect(potion.consume).toBe(true);
    expect(potion.sp).toBeGreaterThan(5);
    expect(potion.hunger).toBe(35_000);
    const apple = useItem("Apple", meal(35_000), low);
    expect(apple.consume).toBe(false);
    expect(apple.lines).toEqual(["You're stuffed!"]);
  });

  test("an item marked usable when full is never refused, and still feeds (up to `max`)", () => {
    withHunger(
      (h) => {
        h.max = 37_000;
        h.afterDeath = 30_000;
      },
      (d) => {
        d.itemRules.use.whenFull = [{ match: "exact", pattern: "Red Potion" }];
      },
    );
    const r = useItem("Red Potion", meal(35_500), low);
    expect(r.consume).toBe(true);
    expect(r.hunger).toBe(37_000);
    expect(useItem("Apple", meal(35_500), low).consume).toBe(false);
  });

  test("`max`: food stops there, and hunger is never above it", () => {
    withHunger((h) => {
      h.max = 36_000;
      h.afterDeath = 30_000;
    });
    expect(useItem("Apple", meal(34_999), low).hunger).toBe(36_000);
    expect(clampHunger(41_750)).toBe(36_000);
    expect(clampHunger(-5)).toBe(0);
    // The character editor takes hunger from 0 to the maximum, and no higher.
    expect(hungerLimits()).toEqual({ max: 36_000, start: 36_000, afterDeath: 30_000 });
    withHunger((h) => {
      h.max = 60_000;
    });
    expect(hungerLimits()).toEqual({ max: 60_000, start: 50_000, afterDeath: 40_000 });
  });

  test("Classic's maximum is its starting hunger, 50,000: more than any meal or spell reaches", () => {
    expect(content().balance.hunger.max).toBe(50_000);
    // The most food gives in Classic: a Watermelon eaten at 34,999.
    expect(useItem("Watermelon", meal(34_999), low).hunger).toBe(43_499);
    expect(startingCharacter(creation()).hunger).toBe(50_000);
    expect(deathHunger()).toBe(40_000);
  });

  test("a new character, a death and a saved character above the maximum all stay at or below it", () => {
    withHunger((h) => {
      h.max = 45_000;
      h.afterDeath = 30_000;
    });
    // Classic's new characters start at 50,000: they start at the maximum.
    expect(startingCharacter(creation()).hunger).toBe(45_000);
    // A death never sets more than the maximum (a cross-check refuses a row that would).
    expect(deathHunger()).toBe(30_000);
    // A character saved above it (the maximum was lowered) is brought down on the next frame.
    expect(hungerTick(48_000, false, high).hunger).toBe(45_000);
    expect(hungerTick(48_000, true, high).hunger).toBe(45_000);
  });
});

describe("a full stomach and gear breaks", () => {
  test("Classic: 1.6's steps above 20k, 25k, 30k and 40k", () => {
    expect(breakOdds(10, 1000, 600)).toBe(631);
    expect(breakOdds(10, 20_001, 600)).toBe(641);
    expect(breakOdds(10, 45_000, 500)).toBe(661);
  });

  test("a world's own steps, or none: hunger then makes no difference", () => {
    withHunger((h) => {
      h.breakOdds = [{ above: 100, add: 1000 }];
    });
    expect(breakOdds(10, 101, 600)).toBe(1631);
    expect(breakOdds(10, 100, 600)).toBe(631);
    withHunger((h) => {
      h.breakOdds = [];
    });
    expect(breakOdds(10, 45_000, 500)).toBe(531);
  });
});

describe("what a player sees of their hunger", () => {
  test("states by the row's thresholds", () => {
    expect(hungerState(35_000)).toBe("stuffed");
    expect(hungerState(34_999)).toBe("fed");
    expect(hungerState(501)).toBe("fed");
    expect(hungerState(500)).toBe("hungry");
    expect(hungerState(50)).toBe("hungry");
    expect(hungerState(49)).toBe("starving");
  });

  test("Classic hides it; words, a percentage of the maximum, or the number in hundreds", () => {
    expect(hungerView(20_000)).toBeNull();
    withHunger((h) => {
      h.show = "words";
    });
    expect(hungerView(20_000)).toEqual({ state: "fed" });
    withHunger((h) => {
      h.show = "percent";
    });
    // A percentage of the maximum (Classic 50,000): never over 100.
    expect(hungerView(25_000)).toEqual({ state: "fed", percent: 50 });
    expect(hungerView(40_000)).toEqual({ state: "stuffed", percent: 80 });
    expect(hungerView(50_000)).toEqual({ state: "stuffed", percent: 100 });
    expect(hungerView(60_000)).toEqual({ state: "stuffed", percent: 100 });
    withHunger((h) => {
      h.show = "number";
    });
    expect(hungerView(17_599)).toEqual({ state: "fed", value: 17_500 });
  });

  function scene() {
    const map = testMap("x1000y992", [[5, 5]]);
    const s = setup([map], undefined, low);
    const p = player("Ann", map, 6, 6);
    s.join(p);
    return { ...s, p };
  }
  const vitalsSent = (out: { to: string; msg: { t: string } }[], p: Player) =>
    out.filter((o) => o.to === p.id && o.msg.t === "vitals").map((o) => o.msg) as unknown as {
      vitals: { hunger?: unknown };
    }[];

  test("hidden (Classic): vitals never carry it, and a fall sends nothing", () => {
    const s = scene();
    s.p.char.hunger = 20_000;
    const first = vitalsSent(s.run(1), s.p);
    expect(first.length).toBe(1);
    expect(first[0]?.vitals.hunger).toBeUndefined();
    expect(vitalsSent(s.run(5), s.p)).toEqual([]);
  });

  test("shown: vitals carry it, and are sent again only when what is shown changes", () => {
    withHunger((h) => {
      h.show = "number";
    });
    const s = scene();
    s.p.char.hunger = 20_003;
    expect(vitalsSent(s.run(1), s.p)[0]?.vitals.hunger).toEqual({ state: "fed", value: 20_000 });
    // 20,002 then 20,001 and 20,000 still read 20,000: nothing is sent.
    expect(vitalsSent(s.run(2), s.p)).toEqual([]);
    // Falling to 19,999 reads 19,900.
    const next = vitalsSent(s.run(2), s.p);
    expect(next.map((m) => m.vitals.hunger)).toEqual([{ state: "fed", value: 19_900 }]);
  });
});

describe("the row's limits", () => {
  const parse = (edit: (h: Hunger) => void) => {
    const b = structuredClone(classicData.balance) as NonNullable<ContentData["balance"]>;
    edit(b.hunger as Hunger);
    return balanceDataSchema.safeParse(b).success;
  };

  test("a maximum below Full at or the hunger after a death, two warnings at one hunger, or an empty line are refused", () => {
    expect(parse(() => {})).toBe(true);
    expect(
      parse((h) => {
        h.max = 30_000;
      }),
    ).toBe(false);
    expect(
      parse((h) => {
        h.max = 38_000;
      }),
    ).toBe(false);
    // Left out, the maximum is 50,000: a death can't set more.
    expect(
      parse((h) => {
        delete h.max;
        h.afterDeath = 50_001;
      }),
    ).toBe(false);
    expect(
      parse((h) => {
        h.warnings = [
          { at: 10, text: "a" },
          { at: 10, text: "b" },
        ];
      }),
    ).toBe(false);
    expect(
      parse((h) => {
        h.warnings = [{ at: 10, text: "  " }];
      }),
    ).toBe(false);
    expect(
      parse((h) => {
        h.breakOdds = [
          { above: 5, add: 1 },
          { above: 5, add: 2 },
        ];
      }),
    ).toBe(false);
  });
});

describe("the Game Rules page edits every hunger value", () => {
  test("the Hunger row has a field for each part of the row", () => {
    const def = balanceRowDef("hunger", null);
    expect(def?.fields.map((f) => f.path.join("."))).toEqual([
      "loseOneIn",
      "regenAbove",
      "starveBelow",
      "stuffed",
      "stuffedRefuses",
      "max",
      "lose",
      "afterDeath",
      "warnings",
      "breakOdds",
      "show",
    ]);
    expect(def?.fields.find((f) => f.path[0] === "max")?.optional).toBeUndefined();
    expect(def?.fields.find((f) => f.path[0] === "warnings")?.unit).toBe("steps");
  });

  test("an operator row from before the later fields shows (and saves) the defaults for them", () => {
    const engine = BALANCE_DEFAULTS.hunger;
    const old = { loseOneIn: 9, regenAbove: 500, starveBelow: 50, stuffed: 35_000, afterDeath: 1 };
    expect(withEngine(old, engine)).toEqual({ ...engine, ...old });
    expect(withEngine(undefined, engine)).toEqual(engine);
  });
});
