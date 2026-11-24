/**
 * Issue #37 stage 7: the 1.6-shaped tables a world may leave out, each turning its mechanic off,
 * and the sexes (with their heads) as content. Classic carries every table, so it plays as before.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import {
  ARCHIVED_PRIZES,
  assassinOn,
  buildContentStore,
  buildTreasure,
  CAULDRON,
  type ContentData,
  canPlant,
  cauldronBrew,
  craftOn,
  creationError,
  drawCard,
  drawProfile,
  findNewQuest,
  headsOf,
  installContent,
  isBlackjackTable,
  isCheckersTable,
  isFishingWater,
  isSlotMachine,
  nextHead,
  orakuExchange,
  prevHead,
  RUMOUR_NPCS,
  rollYield,
  SEXES,
  SLOT_COST,
  seedTile,
  sexChoices,
  sexLabel,
  slotSettle,
  sprinkleOffset,
  startBoard,
  startCraft,
  TREASURE,
  wateredTile,
} from "../../src/index.ts";

const classic = buildContentStore(classicData as ContentData);
afterEach(() => installContent(classic));

/** Installs Classic with one change, as a publish would. */
function install(change: (d: ContentData) => void): void {
  const d = structuredClone(classicData) as ContentData;
  change(d);
  installContent(buildContentStore(d, "next"));
}

const rng = (value: number) => ({ random: (n: number) => Math.min(value, Math.max(n, 0)) });

describe("a table left out turns its mechanic off", () => {
  test("Classic has every one", () => {
    expect(["Smith", "Cook", "Mix", "Build"].map((k) => craftOn(k as never))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(CAULDRON).not.toBeNull();
    expect(isFishingWater("W1")).toBe(true);
    expect(isSlotMachine("Slot Machine")).toBe(true);
    expect(assassinOn()).toBe(true);
    expect(TREASURE).toBeDefined();
  });

  test("a station left out: its craft's button does nothing, a running job ends silently", () => {
    install((d) => {
      delete d.craft.stations.cook;
      delete d.craft.stations.cauldron;
    });
    expect(craftOn("Cook")).toBe(false);
    expect(craftOn("Smith")).toBe(true);
    const r = startCraft(
      {
        bag: [{ item: "Orc Meat", qty: 1 }],
        leftHand: "NOTHING",
        rightHand: "NOTHING",
        skill: () => 50,
        facing: () => true,
        keyLock: false,
        itemPause: 0,
      },
      1,
    );
    expect(r).toEqual({ lines: [], started: null });
    expect(CAULDRON).toBeNull();
    expect(cauldronBrew(["Red Potion", "Blue Potion"])).toBeNull();
  });

  test("no mining section: no ore strike (the schema refuses an ore table without one)", () => {
    install((d) => {
      delete d.gather.gathering.mining;
      d.gather.yields = Object.fromEntries(
        Object.entries(d.gather.yields).filter(([, t]) => t.kind !== "ore"),
      );
      d.gather.harvest = d.gather.harvest.filter((n) => n.yield !== "Mining");
    });
    expect(rollYield("Mining", 50, rng(1))).toBeNull();
  });

  test("no fishing, farming, sprinkle or treasure: no water fishes, no seed plants, no treasure", () => {
    install((d) => {
      const g = d.gather.gathering;
      delete g.fishing;
      delete g.farming;
      delete g.sprinkle;
      delete g.treasure;
      d.gather.harvest = d.gather.harvest.map(({ treasure: _t, ...n }) => n);
    });
    expect(isFishingWater("W1")).toBe(false);
    expect(seedTile("Corn Seeds")).toBeNull();
    expect(canPlant("SL")).toBe(false);
    expect(wateredTile("SL")).toBeNull();
    expect(sprinkleOffset("E")).toBeNull();
    expect(TREASURE).toBeUndefined();
    expect(RUMOUR_NPCS).toEqual([]);
    expect(buildTreasure(["x1y1"], rng(1))).toBeNull();
  });

  test("a casino game left out: its items play nothing", () => {
    install((d) => {
      delete d.casino.slots;
      delete d.casino.blackjack;
      delete d.casino.checkers;
    });
    expect(isSlotMachine("Slot Machine")).toBe(false);
    expect(isBlackjackTable("Blackjack Table")).toBe(false);
    expect(isCheckersTable("Checkers Table")).toBe(false);
    // A game a publish leaves running finishes on the rules it began with.
    expect(slotSettle(100, [1, 1, 1])).toMatchObject({ ok: true });
    expect(SLOT_COST).toBe(classicData.casino.slots?.cost as number);
    expect(drawCard(rng(1))).toBe((classicData.casino.blackjack?.cards.base ?? 0) + 1);
    expect(startBoard()).toHaveLength(24);
  });

  test("no Assassin's game, no Oraku: neither runs", () => {
    const oraku = classicData.social.questReplies.oraku;
    expect(oraku).toBeDefined();
    expect(orakuExchange(oraku?.npc ?? "", oraku?.item ?? "")).toEqual(oraku ?? null);
    install((d) => {
      delete d.social.assassin;
      delete d.social.questReplies.oraku;
    });
    expect(assassinOn()).toBe(false);
    // The prizes setting's default still has its four lines, so Server Settings stays clean.
    expect(ARCHIVED_PRIZES).toEqual(["", "", "", ""]);
    expect(orakuExchange(oraku?.npc ?? "", oraku?.item ?? "")).toBeNull();
  });
});

test("no quest pools: no quest, not a broken line", () => {
  install((d) => {
    d.quests.pools = { npcs: [], wanted: [], rewards: [] };
  });
  expect(findNewQuest(rng(1))).toBe("");
});

describe("sexes are content", () => {
  test("Classic's are 1.6's: Male with seven heads, Female with four", () => {
    expect(SEXES.map((s) => [s.code, s.label])).toEqual([
      [1, "Male"],
      [2, "Female"],
    ]);
    expect(sexChoices()).toBe("male or female");
    expect(sexLabel(2)).toBe("Female");
    // The Bio shows the label, as 1.6's texts did.
    expect(drawProfile(["Ann Star", "Fighter", "2"], "Bob").bio[2]).toBe("Sex: Female");
    expect(drawProfile(["Ann Star", "Fighter", "7"], "Bob").bio[2]).toBe("Sex: ");
  });

  test("a world may offer others, each with its own heads", () => {
    install((d) => {
      d.classes.creation.sexes = [
        { code: 4, label: "Elf", heads: [12, 3] },
        { code: 1, label: "Human", heads: [1] },
        { code: 9, label: "Orc", heads: [5, 6, 7] },
      ];
    });
    expect(headsOf(4)).toEqual([12, 3]);
    expect(headsOf(2)).toEqual([]);
    expect(nextHead(9, 7)).toBe(5);
    expect(prevHead(9, 5)).toBe(7);
    expect(sexChoices()).toBe("elf, human or orc");
    const base = {
      name: "Ann",
      head: 12,
      classCode: 1,
      str: 1,
      sta: 1,
      int: 1,
      wis: 1,
      dex: 1,
    };
    expect(creationError({ ...base, sex: 4 })).toBeNull();
    expect(creationError({ ...base, sex: 2, head: 2 })).toBe("Choose elf, human or orc.");
    expect(creationError({ ...base, sex: 1 })).toBe("That head is not available.");
    expect(drawProfile(["Ann Star", "Fighter", "9"], "Bob").bio[2]).toBe("Sex: Orc");
  });
});
