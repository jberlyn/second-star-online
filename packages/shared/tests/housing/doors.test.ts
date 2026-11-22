/**
 * Golden tests for doors, keys, switches, the relock, container routing and quest chests: each test
 * pins one behaviour of 1.6.
 */
import { describe, expect, test } from "bun:test";

import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  closeAllDoors,
  facedDoor,
  HOUSE_KEY_PAUSE,
  isDoorOrSwitch,
  isKey,
  KEY_PAUSE,
  KEY_TEXT,
  keyConsumed,
  keyPause,
  periodicSave,
  QUEST_SAVE_BLOCK,
  questChestRefill,
  RELOCK_FRAMES,
  renameTargets,
  SWITCH_PAUSE,
  SWITCH_TEXT,
  switchFlip,
  switchState,
  turnKey,
} from "../../src/rules/housing/doors.ts";
import { clickGate, ctrlGate } from "../../src/rules/inventory/ground.ts";

/** Ctrl by a player of middling Strength away from their own premises. */
const STRANGER = { str: 50, mine: false };

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
      opening: true,
    });
    expect(turnKey("House Key", "Alice's Opened Door", "alice", "")).toEqual({
      kind: "turn",
      from: "Alice's Opened Door",
      to: "Alice's Door",
      coloured: false,
      opening: false,
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
      opening: true,
    });
    expect(turnKey("Gold Key", "Open Gold Door", "Alice", "")).toMatchObject({
      to: "Gold Door",
      coloured: true,
      opening: false,
    });
    expect(turnKey("Steel Key", "Gold Door", "Alice", "")).toEqual({ kind: "silent" });
    expect(turnKey("Steel Key", "Alice's Door", "Alice", "")).toEqual({ kind: "silent" });
    expect(turnKey("Steel Key", "Switch Door", "Alice", "")).toEqual({ kind: "silent" });
  });

  test("bug fixed: a coloured key is spent opening its door, not closing it; Keys.txt has no Inf", () => {
    for (const k of ["Steel Key", "Emerald Key", "Fire Key", "Gold Key", "Wooden Key"]) {
      expect(keyConsumed({ coloured: true, opening: true }, k)).toBe(true);
      expect(keyConsumed({ coloured: true, opening: false }, k)).toBe(false);
    }
    expect(keyPause({ coloured: true })).toBe(KEY_PAUSE);
    expect(KEY_PAUSE).toBe(100);
  });

  test("bug fixed: House and Guild Keys are kept and pause 100 after each turn", () => {
    expect(keyConsumed({ coloured: false, opening: true }, "House Key")).toBe(false);
    expect(keyConsumed({ coloured: false, opening: false }, "Guild Key")).toBe(false);
    expect(keyPause({ coloured: false })).toBe(HOUSE_KEY_PAUSE);
    expect(HOUSE_KEY_PAUSE).toBe(100);
  });
});

describe("the rename", () => {
  test("bug fixed: a map-wide rename matches whole names only", () => {
    const names = ["Switch Door", "3 Gold", "Open Switch Door", "Switch Door"];
    // "Open Switch Door" contains "Switch Door" but is not one.
    expect(renameTargets(names, "Switch Door")).toEqual([0, 3]);
    expect(renameTargets(["Jimbob's Door", "Bob's Door"], "Bob's Door")).toEqual([1]);
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
    expect(clickGate("ON Switch")).toEqual({ kind: "switch", state: "on" });
    expect(ctrlGate("OFF Switch", STRANGER)).toEqual({ kind: "switch", state: "off" });
  });
});

describe("relock", () => {
  test("the doors close 200 frames after the last change", () => {
    expect(RELOCK_FRAMES).toBe(200);
  });

  test("bug fixed: CloseAllDoors closes coloured, switch, player and guild doors and ON switches", () => {
    expect(
      closeAllDoors([
        "Open Steel Door",
        "Alice's Opened Door",
        "ON Switch",
        "Open Switch Door",
        "Open Steel Door",
        "The Knights's Opened Door",
        "Gold Door",
        "Alice's Door",
      ]),
    ).toEqual([
      ["Open Steel Door", "Steel Door"],
      ["Alice's Opened Door", "Alice's Door"],
      ["ON Switch", "OFF Switch"],
      ["Open Switch Door", "Switch Door"],
      ["The Knights's Opened Door", "The Knights's Door"],
    ]);
  });
});

describe("container routing", () => {
  test("a click opens chests and house and guild vaults", () => {
    expect(clickGate("Gold Chest")).toEqual({ kind: "open" });
    expect(clickGate("Wind Chest")).toEqual({ kind: "open" });
    expect(clickGate("Alice's House Vault")).toEqual({ kind: "open" });
    expect(clickGate("The Knights's Guild Vault")).toEqual({ kind: "open" });
  });

  test("bug fixed: a click opens a crate or cabinet; Ctrl picks it up with Strength 15 or 19", () => {
    expect(clickGate("Crate#12")).toEqual({ kind: "open" });
    expect(clickGate("Wind Cabinet#3")).toEqual({ kind: "open" });
    expect(clickGate("Cabinet#3")).toEqual({ kind: "open" });
    const weak = { kind: "text", text: "You're not strong enough to pick this up!" } as const;
    expect(ctrlGate("Crate#12", { str: 15, mine: false })).toEqual({ kind: "take" });
    expect(ctrlGate("Crate#12", { str: 14, mine: false })).toEqual(weak);
    expect(ctrlGate("Wind Cabinet#3", { str: 19, mine: false })).toEqual({ kind: "take" });
    expect(ctrlGate("Cabinet#3", { str: 18, mine: false })).toEqual(weak);
  });

  test("Ctrl opens chests, house and guild vaults and the Cauldron", () => {
    for (const n of ["Dark Chest", "Alice's House Vault", "The X's Guild Vault", "Cauldron#4"]) {
      expect(ctrlGate(n, STRANGER)).toEqual({ kind: "open" });
    }
    // Doors stay silent to a click and to Ctrl.
    expect(clickGate("Steel Door")).toEqual({ kind: "silent" });
    expect(ctrlGate("Alice's Door", STRANGER)).toEqual({ kind: "silent" });
  });
});

describe("quest chests", () => {
  test("the periodic save rolls 1 in 350 after a 400-frame block", () => {
    expect(QUEST_SAVE_BLOCK).toBe(400);
    const r = queue(1);
    expect(periodicSave(r)).toBe(true);
    expect(r.asked).toEqual([350]);
  });

  test("a save refills 1 in 4000; random(6) picks the chest; random(lines) picks the item", () => {
    const r = queue(1, 1, 1);
    expect(questChestRefill(r)).toEqual({ chest: "Gold Chest", item: "Thor's Hammer" });
    expect(r.asked).toEqual([4000, 6, 2]);
    expect(questChestRefill(queue(2))).toBeNull();
  });

  test("Steel, Wind and Water have no source: the roll does nothing", () => {
    for (const roll of [3, 4, 5]) {
      expect(questChestRefill(queue(1, roll))).toBeNull();
    }
    expect(questChestRefill(queue(1, 6, 4))).toEqual({ chest: "Dark Chest", item: "Axe" });
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
