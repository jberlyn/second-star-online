import { describe, expect, test } from "bun:test";

import {
  bagPicture,
  clickGate,
  clockFace,
  ctrlGate,
  groundOverlay,
  showsClockFace,
} from "../../src/rules/inventory/ground.ts";

/** Ctrl by a player of middling Strength away from their own premises. */
const STRANGER = { str: 50, mine: false };

describe("vehicle item gates", () => {
  test("'s Airship is boarded by click and by Ctrl", () => {
    expect(clickGate("Ann's Airship")).toEqual({ kind: "airship" });
    expect(ctrlGate("Ann's Airship", STRANGER)).toEqual({ kind: "airship" });
  });
  test("'s Boat and 's Battleship stay silent fixtures (B2 pin unchanged)", () => {
    for (const n of ["Ann's Boat", "Ann's Battleship"]) {
      expect(clickGate(n)).toEqual({ kind: "silent" });
      expect(ctrlGate(n, STRANGER)).toEqual({ kind: "silent" });
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
  test("the animated overlays: Crystal piles CC, then eight fixtures by `=`", () => {
    expect(groundOverlay("5 Blue Crystals")).toBe("CC");
    expect(groundOverlay("Campfire")).toBe("CF");
    expect(groundOverlay("campfire")).toBe("CF");
    expect(groundOverlay("Big Campfire")).toBeNull();
    expect(groundOverlay("Chimney")).toBe("CM");
    expect(groundOverlay("Apple")).toBeNull();
  });
});
