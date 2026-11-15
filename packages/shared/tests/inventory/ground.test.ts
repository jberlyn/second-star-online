import { describe, expect, test } from "bun:test";

import {
  bagPicture,
  clickGate,
  clockFace,
  ctrlGate,
  groundOverlay,
  showsClockFace,
} from "../../src/rules/inventory/ground.ts";

describe("vehicle item gates", () => {
  test("'s Airship is boarded by click and by Ctrl", () => {
    expect(clickGate("Ann's Airship", 20, 0)).toEqual({ kind: "airship" });
    expect(ctrlGate("Ann's Airship")).toEqual({ kind: "airship" });
  });
  test("'s Boat and 's Battleship stay silent fixtures (B2 pin unchanged)", () => {
    for (const n of ["Ann's Boat", "Ann's Battleship"]) {
      expect(clickGate(n, 20, 0)).toEqual({ kind: "silent" });
      expect(ctrlGate(n)).toEqual({ kind: "silent" });
    }
  });
});

describe("Ctrl on a fixture says its line", () => {
  test('Ctrl on a Piano says "This is a piano."', () => {
    expect(ctrlGate("Piano")).toEqual({ kind: "text", text: "This is a piano." });
  });
  test('Ctrl on a Wall Torch says "This is a brightly lit torch."', () => {
    expect(ctrlGate("Wall Torch")).toEqual({ kind: "text", text: "This is a brightly lit torch." });
  });
  test('Ctrl on a Windmill says "This is a windmill."', () => {
    expect(ctrlGate("Windmill")).toEqual({ kind: "text", text: "This is a windmill." });
  });
  test('Ctrl on a Holy Water says "This is Holy Water."', () => {
    expect(ctrlGate("Holy Water")).toEqual({ kind: "text", text: "This is Holy Water." });
  });
  test('Ctrl on a Fire Pot says "I bet that\'s hot."', () => {
    expect(ctrlGate("Fire Pot")).toEqual({ kind: "text", text: "I bet that's hot." });
  });
  test('Ctrl on a Fountain says "This is a fountain."', () => {
    expect(ctrlGate("Fountain")).toEqual({ kind: "text", text: "This is a fountain." });
  });
  test('Ctrl on a Clock says "This is a clock."', () => {
    expect(ctrlGate("Clock")).toEqual({ kind: "text", text: "This is a clock." });
  });
  test('Ctrl on a Street Lamp says "This is a street lamp." and ends the pause', () => {
    expect(ctrlGate("Street Lamp")).toEqual({
      kind: "text",
      text: "This is a street lamp.",
      unpause: true,
    });
  });
  test("Ctrl on the Experience, Slash Master and Ninja Master Platforms says its line and ends the pause", () => {
    expect(ctrlGate("Experience Platform")).toEqual({
      kind: "text",
      text: "You must be over 30 hit points to pass this platform.",
      unpause: true,
    });
    expect(ctrlGate("Slash Master Platform")).toEqual({
      kind: "text",
      text: "This is a slash master's platform, only a master of slash can pass through this.",
      unpause: true,
    });
    expect(ctrlGate("Ninja Master Platform")).toEqual({
      kind: "text",
      text: "This is a ninja master's platform, only a master of martial arts can pass through this.",
      unpause: true,
    });
  });
  test("kept bug: Ctrl on the Mage Master Platform says its line but keeps the pause", () => {
    expect(ctrlGate("Mage Master Platform")).toEqual({
      kind: "text",
      text: "This is a mage master's platform, only a master of magery can pass through this.",
    });
    // Any other platform name meets the check for names containing "Platform".
    expect(ctrlGate("Ann's Platform")).toEqual({ kind: "silent" });
  });
  test("Ctrl on a Chimney is silent", () => {
    expect(ctrlGate("Chimney")).toEqual({ kind: "silent" });
  });
  test("Piano and Clock match by contains, the others by equals", () => {
    expect(ctrlGate("Grand Piano")).toEqual({ kind: "text", text: "This is a piano." });
    expect(ctrlGate("Grandfather Clock")).toEqual({ kind: "text", text: "This is a clock." });
    expect(ctrlGate("Big Windmill")).toEqual({ kind: "take" });
  });
});

describe("a placed Clock's face (clock-face drawing)", () => {
  // The 60 branches of the clock-face drawing, minute by minute (the time swatch and the items draw
  // use the same table).
  const ORIGINAL = [
    ...[12, 12, 12, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7],
    ...[8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 1, 1, 2, 2, 3, 3, 4, 4],
    ...[5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
  ];
  test("kept bug: a placed clock goes round twice an hour: every 3 minutes up to :35, then every 2", () => {
    expect(ORIGINAL).toHaveLength(60);
    for (let m = 0; m < 60; m++) {
      expect(clockFace(m)).toBe(`Clock${ORIGINAL[m]}`);
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
