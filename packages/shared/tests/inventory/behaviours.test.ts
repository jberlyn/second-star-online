/**
 * Item behaviours (`item-rules.json` `behaviours`, issue #37 stage 3): content says which items
 * open doors, read as books, shoot arrows, open as chests, and so on, where 1.6 read a word in the
 * name. Classic's rows keep 1.6's words except where they misfired; engine fixtures never take one.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { isBlackjackTable } from "../../src/rules/casino/blackjack.ts";
import { isSlotMachine } from "../../src/rules/casino/casino.ts";
import { attackPower, bowRefusal } from "../../src/rules/combat/attpower.ts";
import { NO_EQUIPMENT, NO_FACTION } from "../../src/rules/core/fighter.ts";
import { isEngineFixture } from "../../src/rules/core/fixtures.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { facedDoor, isKey, turnKey } from "../../src/rules/housing/doors.ts";
import {
  behaviourName,
  hasBehaviour,
  isStorageContainer,
} from "../../src/rules/inventory/behaviours.ts";
import { useItem } from "../../src/rules/inventory/equip.ts";
import {
  bagPicture,
  clickGate,
  ctrlGate,
  groundPicture,
  showsClockFace,
} from "../../src/rules/inventory/ground.ts";
import { hidesName, paperdollLayers } from "../../src/rules/inventory/paperdoll.ts";
import { boardKind } from "../../src/rules/mail/mail.ts";
import { startingSkills } from "../../src/rules/progression/creation.ts";

const minRng: Rng = { random: (n) => (n >= 1 ? 1 : 0) };
const STRONG = { str: 50, mine: false };
const VITALS = { hp: 10, hpMax: 10, sp: 10, spMax: 10, hunger: 10000 };

/** Runs `body` with Classic's behaviour rows replaced, then puts Classic back. */
function withBehaviours(rows: ContentData["itemRules"]["behaviours"], body: () => void): void {
  const d = structuredClone(classicData) as ContentData;
  d.itemRules.behaviours = rows;
  installContent(buildContentStore(d));
  try {
    body();
  } finally {
    installContent(buildContentStore(classicData));
  }
}

describe("Classic's behaviour rows", () => {
  test("read 1.6's words, through an #id and a +N ending", () => {
    expect(isKey("Steel Key")).toBe(true);
    expect(hasBehaviour("Bless Book", "book")).toBe(true);
    expect(hasBehaviour("Crate#12", "crate")).toBe(true);
    expect(hasBehaviour("Wind Cabinet#3", "cabinet")).toBe(true);
    expect(hasBehaviour("Wind Cabinet#3", "windCabinet")).toBe(true);
    expect(hasBehaviour("Long Sword+3", "sword")).toBe(true);
    expect(hasBehaviour("Knight's Sword +1", "sword")).toBe(true);
    expect(hasBehaviour("Robe of Invisibility", "hidesName")).toBe(true);
    expect(hasBehaviour("Gold Chest", "chest")).toBe(true);
    expect(isStorageContainer("Cauldron#4")).toBe(true);
    expect(isStorageContainer("Gold Chest")).toBe(false);
    expect(useItem("Purple Potion", VITALS, minRng).argon).toBe(true);
    expect(facedDoor(["Sign 1", "Steel Door"])).toBe("Steel Door");
    // A quiver (Classic: any "Arrows") whose picture is aliased away draws nothing.
    const south = (offHand: string) =>
      paperdollLayers({ head: 1, equip: { ...NO_EQUIPMENT, offHand } }, "F2", "S");
    expect(south("Blue Arrows")).toContain("Arrows-F2-S");
    expect(south("Camera Arrows").some((l) => l.startsWith("NOTHING"))).toBe(false);
    expect(behaviourName("Knight's Sword +1")).toBe("Knight's Sword");
    expect(behaviourName("Crate#12")).toBe("Crate");
  });

  test("bug fixed: Bowmaster's Ring is no bow", () => {
    expect(hasBehaviour("Steel Bow", "bow")).toBe(true);
    expect(hasBehaviour("Silver Crossbow", "bow")).toBe(true);
    expect(hasBehaviour("Bowmaster's Ring", "bow")).toBe(false);
    expect(bowRefusal({ weapon: "Bowmaster's Ring", offHand: "NOTHING" }, [])).toBeNull();
    expect(bowRefusal({ weapon: "Steel Bow", offHand: "NOTHING" }, [])).not.toBeNull();
  });
});

describe("engine fixtures", () => {
  test("the owner-named fixtures, the exits, signs and Street Lamp are the engine's", () => {
    for (const n of [
      "Bob's Door",
      "Bob's Opened Door",
      "Bob's Mailbox",
      "Hawks's Board",
      "Bob's House Vault",
      "The Hawks's Guild Vault",
      "Zieg's Boat",
      "Bob's Airship",
      "Bob's Battleship",
      "exit",
      "Exit2",
      "Sign 2",
      "Street Lamp",
    ]) {
      expect(isEngineFixture(n)).toBe(true);
    }
    for (const n of ["Argon's Ring", "Knight's Sword", "Boat Deed", "Signet", "'s Door"]) {
      expect(isEngineFixture(n)).toBe(false);
    }
  });

  test("bug fixed: an owner's fixture named after a container is not taken for one", () => {
    expect(hasBehaviour("Crate Club's Board", "crate")).toBe(false);
    expect(hasBehaviour("The Cauldron Club's Guild Vault", "cauldron")).toBe(false);
    expect(ctrlGate("Crate Club's Board", STRONG)).toEqual({ kind: "board" });
    expect(ctrlGate("Crate#12", STRONG)).toEqual({ kind: "take" });
    // A player called "Doorman": 1.6 took the mailbox for a door, and a click did nothing.
    expect(clickGate("Doorman's Mailbox")).toEqual({ kind: "mail", universal: false });
    expect(facedDoor(["Doorman's Mailbox"])).toBeNull();
    expect(facedDoor(["Doorman's Door"])).toBe("Doorman's Door");
    // A key turns only an owner's door, not an item named like one.
    expect(turnKey("House Key", "Bob's Doorway", "Bob", "").kind).not.toBe("turn");
    expect(turnKey("House Key", "Bob's Door", "Bob", "")).toMatchObject({
      kind: "turn",
      to: "Bob's Opened Door",
    });
    // Words before the owner's ending never win, and a # in the owner's name is kept.
    expect(clickGate("The Photo Club's Guild Vault")).toEqual({ kind: "open" });
    expect(ctrlGate("The Clock Club's Board", STRONG)).toEqual({ kind: "board" });
    expect(clickGate("The Stars #1's Board")).toEqual({ kind: "board" });
    expect(ctrlGate("The Stars #1's Guild Vault", STRONG)).toEqual({ kind: "open" });
    expect(isEngineFixture("The Stars #1's Guild Vault")).toBe(true);
  });
});

describe("pictures by name (issue #29)", () => {
  test("bug fixed: a name holding Map, Painting or Photo does not take their picture", () => {
    // 1.6 pasted MapPic for any name holding "Map", and the painting and photo pictures for any
    // holding "Painting" or "Photo" (the bag) or "Painting#"/"Photo#" (the ground).
    expect(groundPicture("Maple Bow")).toBe("Maple Bow");
    expect(groundPicture("Treasure Map")).toBe("Treasure Map");
    expect(bagPicture("Oil Painting Kit")).toBe("Oil Painting Kit");
    expect(bagPicture("Photo Album")).toBe("Photo Album");
    expect(clickGate("Photo Album")).not.toEqual({ kind: "view" });
    // A player's own painting and photo keep their pictures and their viewer.
    expect(bagPicture("Painting#12")).toBe("PaintingBag");
    expect(bagPicture("Photo#3")).toBe("PhotoBag");
    expect(groundPicture("Painting#12")).toBe("PaintingPic");
    expect(clickGate("Photo#3")).toEqual({ kind: "view" });
  });
  test("an item with the map behaviour shows the map picture on the ground", () => {
    withBehaviours([{ match: "exact", pattern: "Treasure Map", behaviour: "map" }], () => {
      expect(groundPicture("Treasure Map")).toBe("MapPic");
      expect(groundPicture("Maple Bow")).toBe("Maple Bow");
    });
  });
});

describe("a world's own behaviours", () => {
  const own: ContentData["itemRules"]["behaviours"] = [
    { match: "exact", pattern: "Lockpick", behaviour: "key" },
    { match: "exact", pattern: "Moon Bow", behaviour: "bow" },
    { match: "exact", pattern: "Old Trunk", behaviour: "chest" },
    { match: "exact", pattern: "Barrel", behaviour: "crate" },
    { match: "exact", pattern: "Lucky Reels", behaviour: "slotMachine" },
    { match: "exact", pattern: "Card Table", behaviour: "blackjackTable" },
    { match: "exact", pattern: "Shadow Cloak", behaviour: "hidesName" },
    { match: "exact", pattern: "Hall Statue", behaviour: "highScoreStatue" },
    { match: "exact", pattern: "Gate", behaviour: "door" },
    { match: "exact", pattern: "Notice Board", behaviour: "messageBoard" },
    { match: "exact", pattern: "Post Box", behaviour: "universalMail" },
    { match: "exact", pattern: "Guild Desk", behaviour: "guildCenter" },
    { match: "exact", pattern: "Sundial", behaviour: "clock" },
    { match: "exact", pattern: "Hood", behaviour: "hidesHead" },
    { match: "exact", pattern: "Lantern", behaviour: "hiddenFacingNorth" },
    { match: "exact", pattern: "Statue", behaviour: "noCtrl" },
  ];

  test("decide what an item does, whatever its name", () => {
    withBehaviours(own, () => {
      expect(isKey("Lockpick")).toBe(true);
      expect(isKey("Steel Key")).toBe(false);
      expect(bowRefusal({ weapon: "Moon Bow", offHand: "NOTHING" }, [])).not.toBeNull();
      expect(bowRefusal({ weapon: "Steel Bow", offHand: "NOTHING" }, [])).toBeNull();
      expect(clickGate("Old Trunk")).toEqual({ kind: "open" });
      expect(clickGate("Gold Chest")).not.toEqual({ kind: "open" });
      expect(ctrlGate("Barrel#2", { str: 14, mine: false })).toMatchObject({ kind: "text" });
      expect(ctrlGate("Barrel#2", { str: 15, mine: false })).toEqual({ kind: "take" });
      expect(bagPicture("Barrel#2")).toBe("CrateBag");
      expect(groundPicture("Barrel#2")).toBe("CratePic");
      expect(isSlotMachine("Lucky Reels")).toBe(true);
      expect(isSlotMachine("Slot Machine")).toBe(false);
      expect(clickGate("Lucky Reels")).toEqual({ kind: "casino", game: "slots" });
      expect(ctrlGate("Card Table", STRONG)).toEqual({ kind: "casino", game: "blackjack" });
      expect(isBlackjackTable("Card Table")).toBe(true);
      expect(clickGate("Hall Statue")).toEqual({ kind: "scores" });
      expect(hidesName({ ...NO_EQUIPMENT, body: "Shadow Cloak" })).toBe(true);
      expect(hidesName({ ...NO_EQUIPMENT, body: "Robe of Invisibility" })).toBe(false);
      expect(clickGate("Gate")).toEqual({ kind: "silent" });
      expect(ctrlGate("Steel Door", STRONG)).toEqual({ kind: "take" });
      expect(facedDoor(["Gate"])).toBe("Gate");
      expect(clickGate("Notice Board")).toEqual({ kind: "board" });
      expect(boardKind("Notice Board")).toBe("town");
      expect(boardKind("Message Boards")).toBeNull();
      expect(ctrlGate("Post Box", STRONG)).toEqual({ kind: "mail", universal: true });
      expect(clickGate("Guild Desk")).toEqual({ kind: "guildCenter" });
      expect(showsClockFace("Sundial")).toBe(true);
      expect(showsClockFace("Clock")).toBe(false);
      expect(ctrlGate("Statue", STRONG)).toEqual({ kind: "silent" });
      expect(useItem("Purple Potion", VITALS, minRng).argon).toBe(false);
      const look = (body: string, offHand: string) =>
        paperdollLayers({ head: 1, equip: { ...NO_EQUIPMENT, body, offHand } }, "F2", "N");
      expect(look("Hood", "NOTHING")).not.toContain("Head1-F2-N");
      expect(look("Robe of Invisibility", "NOTHING")).toContain("Head1-F2-N");
      expect(look("NOTHING", "Lantern")).not.toContain("Lantern-F2-N");
      expect(look("NOTHING", "Torch")).toContain("Torch-F2-N");
    });
  });

  test("a casino item a pack set before the behaviours still plays", () => {
    const d = structuredClone(classicData) as ContentData;
    d.itemRules.behaviours = [];
    d.casino.blackjack!.item = { text: "Deluxe Blackjack Table" };
    d.casino.slots!.item = { text: "Slot Machine" };
    installContent(buildContentStore(d));
    try {
      expect(isBlackjackTable("Deluxe Blackjack Table")).toBe(true);
      expect(ctrlGate("Deluxe Blackjack Table", STRONG)).toEqual({
        kind: "casino",
        game: "blackjack",
      });
      expect(isSlotMachine("Golden Slot Machine")).toBe(true);
      expect(isBlackjackTable("Blackjack Table")).toBe(false);
    } finally {
      installContent(buildContentStore(classicData));
    }
  });

  test("a behaviour no row gives is off", () => {
    withBehaviours([], () => {
      // Click and Ctrl agree: the Vault, the Guild Center and the casino tables are plain items.
      for (const n of ["Vault", "Guild Center", "Slot Machine", "Blackjack Table"]) {
        expect(clickGate(n)).toEqual({ kind: "take" });
        expect(ctrlGate(n, { str: 50, mine: false })).toEqual({ kind: "take" });
      }
      // The switches and the fixtures' texts are still `houses.json` rows.
      expect(clickGate("ON Switch")).toEqual({ kind: "switch", state: "on" });
      expect(clickGate("Anvil")).toMatchObject({ kind: "text" });
      expect(isKey("Steel Key")).toBe(false);
      expect(hasBehaviour("Bless Book", "book")).toBe(false);
      const bow = attackPower(
        {
          level: 1,
          str: 1,
          sta: 1,
          int: 1,
          wis: 1,
          skills: startingSkills(1),
          equip: { ...NO_EQUIPMENT, weapon: "Steel Bow" },
          faction: { ...NO_FACTION },
          attackBonus: 0,
          wanted: false,
        },
        minRng,
      );
      expect(bow.crystal).toBeNull();
      expect(bow.outOfCrystals).toBeNull();
    });
  });
});
