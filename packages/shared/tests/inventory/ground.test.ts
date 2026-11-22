import { describe, expect, test } from "bun:test";

import {
  bagPicture,
  blocksMonster,
  blocksPlayer,
  clickGate,
  clockFace,
  ctrlGate,
  fixedInPlace,
  groundOverlay,
  groundTipName,
  overlayWhenInUse,
  showsClockFace,
  stationInUse,
} from "../../src/rules/inventory/ground.ts";

/** Ctrl by a player of middling Strength away from their own premises. */
const STRANGER = { str: 50, mine: false };

describe("vehicle item gates", () => {
  test("a parked Airship, Boat or Battleship is boarded by click and by Ctrl", () => {
    for (const n of ["Ann's Airship", "Ann's Boat", "Ann's Battleship"]) {
      expect(clickGate(n)).toEqual({ kind: "vehicle" });
      expect(ctrlGate(n, STRANGER)).toEqual({ kind: "vehicle" });
    }
  });
});

describe("Ctrl on a fixture says its line", () => {
  test('Ctrl on a Piano says "This is a piano."', () => {
    expect(ctrlGate("Piano", STRANGER)).toEqual({ kind: "text", text: "This is a piano." });
  });
  test('Ctrl on a Wall Torch says "This is a brightly lit torch."', () => {
    expect(ctrlGate("Wall Torch", STRANGER)).toEqual({
      kind: "text",
      text: "This is a brightly lit torch.",
    });
  });
  test('Ctrl on a Windmill says "This is a windmill."', () => {
    expect(ctrlGate("Windmill", STRANGER)).toEqual({ kind: "text", text: "This is a windmill." });
  });
  test('Ctrl on a Holy Water says "This is Holy Water."', () => {
    expect(ctrlGate("Holy Water", STRANGER)).toEqual({ kind: "text", text: "This is Holy Water." });
  });
  test('Ctrl on a Fire Pot says "I bet that\'s hot."', () => {
    expect(ctrlGate("Fire Pot", STRANGER)).toEqual({ kind: "text", text: "I bet that's hot." });
  });
  test('Ctrl on a Fountain says "This is a fountain."', () => {
    expect(ctrlGate("Fountain", STRANGER)).toEqual({ kind: "text", text: "This is a fountain." });
  });
  test('Ctrl on a Clock says "This is a clock."', () => {
    expect(ctrlGate("Clock", STRANGER)).toEqual({ kind: "text", text: "This is a clock." });
  });
  test('Ctrl on a Street Lamp says "This is a street lamp." and ends the pause', () => {
    expect(ctrlGate("Street Lamp", STRANGER)).toEqual({
      kind: "text",
      text: "This is a street lamp.",
      unpause: true,
    });
  });
  test("Ctrl on the Experience, Slash Master and Ninja Master Platforms says its line and ends the pause", () => {
    expect(ctrlGate("Experience Platform", STRANGER)).toEqual({
      kind: "text",
      text: "You must be level 21 or higher to pass this platform.",
      unpause: true,
    });
    expect(ctrlGate("Slash Master Platform", STRANGER)).toEqual({
      kind: "text",
      text: "This is a slash master's platform, only a master of slash can pass through this.",
      unpause: true,
    });
    expect(ctrlGate("Ninja Master Platform", STRANGER)).toEqual({
      kind: "text",
      text: "This is a ninja master's platform, only a master of martial arts can pass through this.",
      unpause: true,
    });
  });
  test("bug fixed: Ctrl on the Mage Master Platform says its line and ends the pause like the others", () => {
    expect(ctrlGate("Mage Master Platform", STRANGER)).toEqual({
      kind: "text",
      text: "This is a mage master's platform, only a master of magery can pass through this.",
      unpause: true,
    });
    // Any other platform name meets the check for names containing "Platform".
    expect(ctrlGate("Ann's Platform", STRANGER)).toEqual({ kind: "silent" });
  });
  test("Ctrl on a Chimney is silent", () => {
    expect(ctrlGate("Chimney", STRANGER)).toEqual({ kind: "silent" });
  });
  test("Piano and Clock match by contains, the others by equals", () => {
    expect(ctrlGate("Grand Piano", STRANGER)).toEqual({ kind: "text", text: "This is a piano." });
    expect(ctrlGate("Grandfather Clock", STRANGER)).toEqual({
      kind: "text",
      text: "This is a clock.",
    });
    expect(ctrlGate("Big Windmill", STRANGER)).toEqual({ kind: "take" });
  });
});

describe("a placed Clock's face (clock-face drawing)", () => {
  test("bug fixed: a placed clock's hand goes round once an hour, a face every 5 minutes", () => {
    const faces = Array.from({ length: 60 }, (_, m) => clockFace(m));
    expect(faces.slice(0, 5)).toEqual(Array(5).fill("Clock12"));
    expect(faces.slice(5, 10)).toEqual(Array(5).fill("Clock1"));
    expect(clockFace(30)).toBe("Clock6");
    expect(clockFace(36)).toBe("Clock7");
    expect(faces.slice(55)).toEqual(Array(5).fill("Clock11"));
    // Each of the twelve faces shows for exactly five minutes.
    for (let h = 1; h <= 12; h++) {
      expect(faces.filter((f) => f === `Clock${h}`)).toHaveLength(5);
    }
  });
  test('the face goes on any picture whose name contains "Clock"', () => {
    expect(showsClockFace("Clock")).toBe(true);
    expect(showsClockFace("Clock7")).toBe(true);
    expect(showsClockFace("Street Lamp")).toBe(false);
  });
});

describe("bag icons for containers and art (bag-line drawing)", () => {
  test("a carried container, painting or photo shows its pool's picture; other names their own", () => {
    expect(bagPicture("Cabinet#96881")).toBe("CabinetBag");
    expect(bagPicture("Wind Cabinet#73435")).toBe("WindCabinetBag");
    expect(bagPicture("Crate#4242")).toBe("CrateBag");
    expect(bagPicture("Cauldron#77")).toBe("CauldronBag");
    expect(bagPicture("Painting#12")).toBe("PaintingBag");
    expect(bagPicture("Photo#3")).toBe("PhotoBag");
    expect(bagPicture("Cauldron")).toBe("CauldronBag"); // `contains`, # or not
    expect(bagPicture("Long Sword")).toBe("Long Sword");
  });
});

describe("ground overlays", () => {
  test("a Carpentry Bench animates, blocks movement and stays fixed in place", () => {
    const text = "This is a carpentry bench, used for carpentry.";
    expect(groundOverlay("Carpentry Bench")).toBe("WB");
    expect(blocksPlayer("Carpentry Bench", { level: 1, skills: [] })).toBe(true);
    expect(blocksMonster("Carpentry Bench")).toBe(true);
    expect(fixedInPlace("Carpentry Bench", true)).toBe(true);
    expect(clickGate("Carpentry Bench")).toEqual({ kind: "text", text });
    expect(ctrlGate("Carpentry Bench", { ...STRANGER, mine: true })).toEqual({
      kind: "text",
      text,
    });
  });

  test("design change: a Stove and an Anvil animate like the other crafting stations", () => {
    expect(groundOverlay("Stove")).toBe("SV");
    expect(groundOverlay("Anvil")).toBe("AN");
    expect(groundOverlay("Alchemy Lab")).toBe("AL");
    expect(groundOverlay("Stove Top")).toBeNull();
    expect(groundOverlay("Anvils")).toBeNull();
  });

  test("design change: the crafting stations animate only in use; scenery always does", () => {
    for (const station of ["Stove", "Anvil", "Alchemy Lab", "Carpentry Bench"]) {
      expect(overlayWhenInUse(station)).toBe(true);
    }
    for (const scenery of ["Campfire", "Wall Torch", "Fountain", "5 Blue Crystals", "Apple"]) {
      expect(overlayWhenInUse(scenery)).toBe(false);
    }
  });

  test("a station is in use while a crafting player faces it", () => {
    const at = { x: 5, y: 6, facing: "N" as const };
    expect(stationInUse(5, 5, [{ ...at, crafting: true }])).toBe(true);
    expect(stationInUse(5, 5, [{ ...at, crafting: false }])).toBe(false);
    expect(stationInUse(5, 5, [{ ...at, facing: "E", crafting: true }])).toBe(false);
    expect(stationInUse(5, 5, [{ x: 5, y: 5, facing: "N", crafting: true }])).toBe(false);
    expect(
      stationInUse(5, 5, [
        { ...at, crafting: false },
        { x: 4, y: 5, facing: "E", crafting: true },
      ]),
    ).toBe(true);
    expect(stationInUse(5, 5, [])).toBe(false);
  });

  test("the animated overlays match Crystal piles or exact fixture names", () => {
    expect(groundOverlay("5 Blue Crystals")).toBe("CC");
    expect(groundOverlay("Campfire")).toBe("CF");
    expect(groundOverlay("campfire")).toBe("CF");
    expect(groundOverlay("Big Campfire")).toBeNull();
    expect(groundOverlay("Chimney")).toBe("CM");
    expect(groundOverlay("Apple")).toBeNull();
  });
});

describe("the hover tip's name for a ground item", () => {
  test("design change: loose items, vehicles and fixtures are named as they are, quantity included", () => {
    expect(groundTipName("Long Sword")).toBe("Long Sword");
    expect(groundTipName("15 Gold")).toBe("15 Gold");
    expect(groundTipName("5 Blue Crystals")).toBe("5 Blue Crystals");
    expect(groundTipName("Zieg's Boat")).toBe("Zieg's Boat");
    expect(groundTipName("Slim's House Vault")).toBe("Slim's House Vault");
    expect(groundTipName("Wooden Door")).toBe("Wooden Door");
    expect(groundTipName("Experience Platform")).toBe("Experience Platform");
    expect(groundTipName("ON Switch")).toBe("ON Switch");
  });
  test("design change: exits, Rays, clouds, chimneys and markers are never named", () => {
    for (const name of [
      "Exit",
      "Exit2",
      "exit",
      "Left Ray",
      "RIGHT RAY",
      "Cloud",
      "Chimney",
      "Dragon Rock",
      "DungeonAlpha",
      "Dragon Lair",
    ]) {
      expect(groundTipName(name)).toBeNull();
    }
    // Only the exact names: an item merely containing "Exit" is named.
    expect(groundTipName("Exit Sign")).toBe("Exit Sign");
  });
  test("design change: tidied names drop the #id, the sign number and the open state", () => {
    expect(groundTipName("Painting#12")).toBe("Painting");
    expect(groundTipName("Crate#3")).toBe("Crate");
    expect(groundTipName("Sign 1")).toBe("Sign");
    expect(groundTipName("sign 3")).toBe("Sign");
    expect(groundTipName("BlueCrystal")).toBe("Blue Crystal");
    expect(groundTipName("WhiteCrystal")).toBe("White Crystal");
    expect(groundTipName("Open Wooden Door")).toBe("Wooden Door");
    expect(groundTipName("Open Switch Door")).toBe("Switch Door");
    expect(groundTipName("Slim's Opened Door")).toBe("Slim's Door");
  });
});
