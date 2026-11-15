/**
 * Golden tests for doors, keys, switches, the relock, container routing and quest chests: each test
 * pins one behaviour of 1.6.
 */
import { describe, expect, test } from "bun:test";

import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  closeAllDoors,
  facedDoor,
  isDoorOrSwitch,
  isKey,
  KEY_PAUSE,
  KEY_TEXT,
  keyConsumed,
  periodicSave,
  QUEST_SAVE_BLOCK,
  questChestRefill,
  relockAfter,
  renameTargets,
  SWITCH_PAUSE,
  SWITCH_TEXT,
  switchFlip,
  switchState,
  turnKey,
} from "../../src/rules/housing/doors.ts";
import { clickGate, ctrlGate } from "../../src/rules/inventory/ground.ts";

const queue = (...xs: number[]): Rng & { asked: number[] } => {
  const asked: number[] = [];
  return {
    asked,
    random(n) {
      asked.push(n);
      return xs.shift() ?? n;
    },
  };
};

describe("keys", () => {
  test("only names containing Key go to the key script", () => {
    expect(isKey("House Key")).toBe(true);
    expect(isKey("Steel Key")).toBe(true);
    expect(isKey("Small House Deed")).toBe(false);
  });

  test("the last name containing Door on the faced tile wins; none is silent", () => {
    expect(facedDoor(["Steel Door", "Alice's Door"])).toBe("Alice's Door");
    expect(facedDoor(["Alice's Door", "3 Gold"])).toBe("Alice's Door");
    expect(facedDoor(["3 Gold"])).toBeNull();
  });

  test("a House Key opens and closes only its holder's door", () => {
    expect(turnKey("House Key", "Alice's Door", "Alice", "")).toEqual({
      kind: "turn",
      from: "Alice's Door",
      to: "Alice's Opened Door",
      coloured: false,
    });
    expect(turnKey("House Key", "Alice's Opened Door", "alice", "")).toEqual({
      kind: "turn",
      from: "Alice's Opened Door",
      to: "Alice's Door",
      coloured: false,
    });
    expect(turnKey("House Key", "Alice's Door", "Bob", "")).toEqual({
      kind: "text",
      text: "Your key doesn't fit this lock!",
    });
    expect(KEY_TEXT.doesntFit).toBe("Your key doesn't fit this lock!");
  });

  test('a Guild Key fits only "The <your guild>"; none without a guild; silent on a house door', () => {
    expect(turnKey("Guild Key", "The Knights's Door", "Alice", "")).toEqual({
      kind: "text",
      text: KEY_TEXT.doesntFit,
    });
    expect(turnKey("Guild Key", "The Knights's Door", "Alice", "Knights").kind).toBe("turn");
    expect(turnKey("Guild Key", "Alice's Door", "Alice", "")).toEqual({ kind: "silent" });
    // A House Key on a guild door reads "The Knights" as the owner: never yours.
    expect(turnKey("House Key", "The Knights's Door", "Alice", "").kind).toBe("text");
  });

  test("coloured keys toggle their own door by exact name; anything else is silent", () => {
    expect(turnKey("Steel Key", "Steel Door", "Alice", "")).toEqual({
      kind: "turn",
      from: "Steel Door",
      to: "Open Steel Door",
      coloured: true,
    });
    expect(turnKey("Gold Key", "Open Gold Door", "Alice", "")).toMatchObject({
      to: "Gold Door",
      coloured: true,
    });
    expect(turnKey("Steel Key", "Gold Door", "Alice", "")).toEqual({ kind: "silent" });
    expect(turnKey("Steel Key", "Alice's Door", "Alice", "")).toEqual({ kind: "silent" });
    expect(turnKey("Steel Key", "Switch Door", "Alice", "")).toEqual({ kind: "silent" });
  });

  test("kept bug: coloured keys are consumed on open and on close; Keys.txt has no Inf", () => {
    for (const k of ["Steel Key", "Emerald Key", "Fire Key", "Gold Key", "Wooden Key"]) {
      expect(keyConsumed(k)).toBe(true);
    }
    expect(KEY_PAUSE).toBe(425);
  });
});

describe("the rename", () => {
  test("kept bug: opening a coloured door renames every door of that name on the map", () => {
    const names = ["Steel Door", "3 Gold", "Steel Door", "Open Steel Door", "Gold Door"];
    // "Open Steel Door" contains "Steel Door" too: renamed to the same name, no change.
    expect(renameTargets(names, "Steel Door")).toEqual([0, 2, 3]);
  });

  test("kept bug: a player door rename matches by substring (Bob's Door in Jimbob's Door)", () => {
    expect(renameTargets(["Jimbob's Door", "Bob's Door"], "Bob's Door")).toEqual([0, 1]);
  });

  test("kept bug: a switch flips every switch of that state on the map", () => {
    expect(renameTargets(["ON Switch", "OFF Switch", "ON Switch"], "ON Switch")).toEqual([0, 2]);
  });

  test("only doors and switches are renamed (exploit 3 closed)", () => {
    expect(isDoorOrSwitch("Steel Door")).toBe(true);
    expect(isDoorOrSwitch("Alice's Opened Door")).toBe(true);
    expect(isDoorOrSwitch("ON Switch")).toBe(true);
    expect(isDoorOrSwitch("Steel Doormat")).toBe(false);
    expect(renameTargets(["Steel Doorstop"], "Steel Door")).toEqual([]);
  });
});

describe("switches", () => {
  test("ON turns OFF and closes the switch doors; OFF turns ON and opens them", () => {
    expect(switchFlip("on")).toEqual([
      ["ON Switch", "OFF Switch"],
      ["Open Switch Door", "Switch Door"],
    ]);
    expect(switchFlip("off")).toEqual([
      ["OFF Switch", "ON Switch"],
      ["Switch Door", "Open Switch Door"],
    ]);
    expect(SWITCH_PAUSE).toBe(100);
    expect(SWITCH_TEXT.notInFront).toBe(
      "You see the switch, but you must be standing in front of it to use it.",
    );
  });

  test("switches match by contains, ON first", () => {
    expect(switchState("ON Switch")).toBe("on");
    expect(switchState("OFF Switch")).toBe("off");
    expect(switchState("Switch Door")).toBeNull();
    expect(clickGate("ON Switch", 1)).toEqual({ kind: "switch", state: "on" });
    expect(ctrlGate("OFF Switch")).toEqual({ kind: "switch", state: "off" });
  });
});

describe("relock", () => {
  test("a change sets 200, an arrival 150, a switch click 100; the earliest wins", () => {
    expect(relockAfter(0, "change")).toBe(200);
    expect(relockAfter(10, "change")).toBe(200);
    expect(relockAfter(0, "arrival")).toBe(150);
    expect(relockAfter(10, "arrival")).toBe(10);
    expect(relockAfter(180, "arrival")).toBe(150);
    expect(relockAfter(0, "switchClick")).toBe(100);
    expect(relockAfter(120, "switchClick")).toBe(100);
  });

  test("kept bug: CloseAllDoors closes coloured and switch doors and ON switches, never player doors", () => {
    expect(
      closeAllDoors([
        "Open Steel Door",
        "Alice's Opened Door",
        "ON Switch",
        "Open Switch Door",
        "Open Steel Door",
        "The Knights's Opened Door",
        "Gold Door",
      ]),
    ).toEqual([
      ["Open Steel Door", "Steel Door"],
      ["ON Switch", "OFF Switch"],
      ["Open Switch Door", "Switch Door"],
    ]);
  });
});

describe("container routing", () => {
  test("a click opens chests and house and guild vaults", () => {
    expect(clickGate("Gold Chest", 1)).toEqual({ kind: "open" });
    expect(clickGate("Wind Chest", 1)).toEqual({ kind: "open" });
    expect(clickGate("Alice's House Vault", 1)).toEqual({ kind: "open" });
    expect(clickGate("The Knights's Guild Vault", 1)).toEqual({ kind: "open" });
  });

  test("kept bug: clicking a crate or cabinet picks it up; only Ctrl opens it", () => {
    expect(clickGate("Crate#12", 15)).toEqual({ kind: "take" });
    expect(clickGate("Crate#12", 14)).toMatchObject({ kind: "text" });
    expect(clickGate("Wind Cabinet#3", 19)).toEqual({ kind: "take" });
    expect(clickGate("Cabinet#3", 18)).toMatchObject({ kind: "text" });
    expect(ctrlGate("Crate#12")).toEqual({ kind: "open" });
    expect(ctrlGate("Wind Cabinet#3")).toEqual({ kind: "open" });
  });

  test("Ctrl opens chests, house and guild vaults and the Cauldron", () => {
    for (const n of ["Dark Chest", "Alice's House Vault", "The X's Guild Vault", "Cauldron#4"]) {
      expect(ctrlGate(n)).toEqual({ kind: "open" });
    }
    // Doors stay silent to a click and to Ctrl.
    expect(clickGate("Steel Door", 1)).toEqual({ kind: "silent" });
    expect(ctrlGate("Alice's Door")).toEqual({ kind: "silent" });
  });
});

describe("quest chests", () => {
  test("the periodic save rolls 1 in 350 after a 400-frame block", () => {
    expect(QUEST_SAVE_BLOCK).toBe(400);
    const r = queue(1);
    expect(periodicSave(r)).toBe(true);
    expect(r.asked).toEqual([350]);
  });

  test("a save refills 1 in 4000; random(6) picks the chest; a line overwrites it", () => {
    const r = queue(1, 1, 2);
    expect(questChestRefill(r)).toEqual({ chest: "Gold Chest", item: "Thor's Hammer" });
    expect(r.asked).toEqual([4000, 6, 3]);
    expect(questChestRefill(queue(2))).toBeNull();
  });

  test("Steel, Wind and Water have no source: the roll does nothing", () => {
    for (const roll of [3, 4, 5]) {
      expect(questChestRefill(queue(1, roll))).toBeNull();
    }
    expect(questChestRefill(queue(1, 6, 6))).toEqual({
      chest: "Dark Chest",
      item: "Green Laser Sword",
    });
    expect(questChestRefill(queue(1, 2, 1))).toEqual({
      chest: "Emerald Chest",
      item: "Emerald Key",
    });
  });

  test("Gold Chest's lines are trimmed of the stray line feed", () => {
    for (const k of [1, 2, 3]) {
      const got = questChestRefill(queue(1, 1, k));
      expect(got?.item).toBe(got?.item.trim());
    }
  });
});
