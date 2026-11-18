/**
 * Golden tests for the housing rules: each test pins one behaviour of 1.6.
 */
import { describe, expect, test } from "bun:test";

import {
  checkPlacement,
  deedUse,
  ghostRect,
  type HouseListEntry,
  type HouseType,
  headDrop,
  houseAnchor,
  houseType,
  inFootprint,
  monthIndex,
  type PlacementInput,
  planHouse,
  refreshOwner,
  sweep,
  terrainOk,
} from "../../src/rules/housing/houses.ts";
import { clickGate } from "../../src/rules/inventory/ground.ts";

const row = (code: string) => Array.from({ length: 17 }, () => code).join(" ");
const layer = (code: string) => Array.from({ length: 12 }, () => row(code));
/** Layer 1 all `8R`, layer 2 all `G3`: buildable anywhere the rows allow. */
const FLAT = { layer1: layer("8R"), layer2: layer("G3") };
const type = (name: string) => houseType(name) as HouseType;

function input(over: Partial<PlacementInput> & { type: HouseType }): PlacementInput {
  return {
    hx: 6,
    hy: 5,
    ...FLAT,
    obstacles: [],
    hasExit: false,
    hasExit2: false,
    guild: "",
    ...over,
  };
}

describe("deeds", () => {
  test("bug fixed: Boat and Battleship Deeds say they cannot be built", () => {
    expect(deedUse("Boat Deed")).toEqual({
      kind: "nothing",
      text: "Boats cannot be built yet, so this deed can't be used.",
    });
    expect(deedUse("Battleship Deed")).toEqual({
      kind: "nothing",
      text: "Battleships cannot be built yet, so this deed can't be used.",
    });
  });
  test("the Airship Deed runs the airship drop", () => {
    expect(deedUse("Airship Deed")).toEqual({ kind: "airship" });
  });
  test("bug fixed: the Stone Guild Hall Deed says it cannot be built", () => {
    expect(deedUse("Stone Guild Hall Deed")).toEqual({
      kind: "nothing",
      text: "The Stone Guild Hall cannot be built yet, so this deed can't be used.",
    });
  });
  test("the seven house deeds start placement", () => {
    for (const h of [
      "Small House",
      "Small Farm",
      "Small Guild Hall",
      "Blue Cottage",
      "Small Shop",
      "Fortress Guild Hall",
      "Large House",
    ]) {
      const u = deedUse(`${h} Deed`);
      expect(u?.kind === "place" ? u.type.house : null).toBe(h);
    }
    expect(deedUse("Apple")).toBeNull();
  });
});

describe("the ghost and the anchor", () => {
  test("bug fixed: the Small Farm anchors one up and one left like every house, its ghost to match", () => {
    expect(houseAnchor(type("Small Farm"), 5, 5)).toEqual({ x: 4, y: 4 });
    expect(houseAnchor(type("Small House"), 5, 5)).toEqual({ x: 4, y: 4 });
    expect(houseAnchor(type("Large House"), 5, 5)).toEqual({ x: 4, y: 4 });
    // The farm's footprint is tiles x 4-8, y 4-6: stage x 126-286, y 127-223. The ghost sits
    // 1 px right and 2 px up of it (160×96, reg (80, 48), at (32·5+15+32, 32·5+13)), exactly
    // where the Large House's does.
    expect(ghostRect(type("Small Farm"), 5, 5)).toEqual({
      left: 127,
      top: 125,
      right: 287,
      bottom: 221,
    });
    expect(ghostRect(type("Small Farm"), 5, 5)).toEqual(ghostRect(type("Large House"), 5, 5));
  });
  test("a 96×96 ghost covers its 3×3 footprint 1 px right, 2 px up; the guild hall's 97-tall member 3 px up (Houses cast)", () => {
    // Small House over tile (5, 5): footprint x 4-6, y 4-6 = stage x 126-222, y 127-223.
    expect(ghostRect(type("Small House"), 5, 5)).toEqual({
      left: 127,
      top: 125,
      right: 223,
      bottom: 221,
    });
    expect(ghostRect(type("Small Guild Hall"), 5, 5).top).toBe(124);
  });
});

describe("the click's checks", () => {
  test("edges: the corrected anchor must be 2-14, 2-9", () => {
    const r = checkPlacement(input({ type: type("Small House"), hx: 2, hy: 5 }));
    expect(r).toEqual({ ok: false, text: "You cannot build off the map, or on the edges of it!" });
    expect(checkPlacement(input({ type: type("Small House"), hx: 3, hy: 3 })).ok).toBe(true);
  });
  test("bug fixed: a house can be anchored on rows 8 and 9; its rows 10 and 11 read the map", () => {
    const t = type("Small House");
    expect(terrainOk(t, 5, 8, FLAT.layer1, FLAT.layer2)).toBe(true);
    expect(terrainOk(t, 5, 9, FLAT.layer1, FLAT.layer2)).toBe(true);
    expect(checkPlacement(input({ type: t, hx: 6, hy: 10 }))).toMatchObject({
      ok: true,
      anchor: { x: 5, y: 9 },
    });
    // Rough ground on row 11 is still refused.
    const l1 = layer("8R");
    l1[10] = row("G1");
    expect(terrainOk(t, 5, 9, l1, FLAT.layer2)).toBe(false);
  });
  test("bug fixed: layer 1 is checked on every column of a 5-wide house", () => {
    const l1 = layer("G1");
    // Good ground only on columns 4-6 of rows 4-6: a Large House at anchor (4, 4) spans
    // columns 4-8, so its columns 7-8 are rough.
    for (const y of [4, 5, 6]) {
      const w = row("G1").split(" ");
      w[3] = "8U";
      w[4] = "8U";
      w[5] = "8R";
      l1[y - 1] = w.join(" ");
    }
    expect(terrainOk(type("Large House"), 4, 4, l1, FLAT.layer2)).toBe(false);
    expect(terrainOk(type("Small House"), 4, 4, l1, FLAT.layer2)).toBe(true);
  });
  test("bug fixed: 8V counts as house ground like 8R and 8U, matched whole", () => {
    expect(terrainOk(type("Small House"), 5, 4, layer("8V"), FLAT.layer2)).toBe(true);
    expect(terrainOk(type("Small House"), 5, 4, layer("8v"), FLAT.layer2)).toBe(true);
    expect(terrainOk(type("Small House"), 5, 4, layer("8U"), FLAT.layer2)).toBe(true);
    expect(terrainOk(type("Small House"), 5, 4, layer("8"), FLAT.layer2)).toBe(false);
  });
  test("a 5-wide house at x 14 fails layer 2: a 17-word row has no word 18", () => {
    expect(terrainOk(type("Large House"), 13, 3, FLAT.layer1, FLAT.layer2)).toBe(true);
    expect(terrainOk(type("Large House"), 14, 3, FLAT.layer1, FLAT.layer2)).toBe(false);
  });
  test("layer 2 must be G3 on every footprint tile", () => {
    const l2 = layer("G3");
    const w = row("G3").split(" ");
    w[6] = "S3"; // a tree at (7, 5)
    l2[4] = w.join(" ");
    expect(terrainOk(type("Large House"), 3, 4, FLAT.layer1, l2)).toBe(false);
  });
  test("bug fixed: only something on the footprint itself is in the way", () => {
    const t = type("Small House");
    // Hovering (6, 5): footprint x 5-7, y 4-6. The tiles all round it are clear to stand on.
    for (const o of [
      { x: 8, y: 5 },
      { x: 6, y: 3 },
      { x: 6, y: 7 },
      { x: 4, y: 5 },
    ]) {
      expect(checkPlacement(input({ type: t, obstacles: [o] })).ok).toBe(true);
    }
    for (const o of [
      { x: 5, y: 4 },
      { x: 7, y: 6 },
    ]) {
      expect(checkPlacement(input({ type: t, obstacles: [o] }))).toEqual({
        ok: false,
        text: "You cannot build here because there seems to be something in the way!",
      });
    }
    expect(inFootprint(type("Large House"), { x: 5, y: 4 }, 9, 6)).toBe(true);
    expect(inFootprint(type("Large House"), { x: 5, y: 4 }, 10, 6)).toBe(false);
  });
  test("an Exit takes slot 1, so the next house takes Exit2; both taken refuses", () => {
    const t = type("Small House");
    expect(checkPlacement(input({ type: t }))).toMatchObject({ ok: true, slot: 1 });
    expect(checkPlacement(input({ type: t, hasExit: true }))).toMatchObject({ ok: true, slot: 2 });
    expect(checkPlacement(input({ type: t, hasExit: true, hasExit2: true }))).toEqual({
      ok: false,
      text: "There are already too many buildings here!",
    });
  });
  test("a guild hall needs a guild, checked last", () => {
    expect(checkPlacement(input({ type: type("Small Guild Hall") }))).toEqual({
      ok: false,
      text: "You have to belong to a guild to build a guild hall!",
    });
    expect(checkPlacement(input({ type: type("Small Guild Hall"), guild: "Knights" })).ok).toBe(
      true,
    );
  });
});

describe("the build", () => {
  test("a Small House: exit field H1, interior name, outdoor Exit and mailbox, tiles, header, owner, exit back", () => {
    const p = planHouse(type("Small House"), { x: 5, y: 4 }, 1, 3, 7, "Bob", "");
    expect(p.interior).toBe("xH13yH17");
    expect(p.exit).toEqual({ mx: 3, my: 7, x: 9, y: 11, house: 1 });
    expect(p.outdoorItems).toEqual([
      { item: "Exit", x: 6, y: 6 },
      { item: "Bob's Mailbox", x: 5, y: 6 },
    ]);
    expect(p.tiles.map((t) => t.code).join(" ")).toBe("D5 E5 I5 O5 P5 B5 G5 S5 H5");
    expect(p.tiles[7]).toEqual({ code: "S5", x: 6, y: 6 }); // the door tile, under the Exit
    expect(p.title).toBe("Bob's House");
    expect(p.sign3).toBe("Bob");
    expect(p.exitBack).toEqual({ mx: 3, my: 7, x: 6, y: 7 });
    expect(p.interiorItems).toEqual([
      { item: "Exit", x: 9, y: 12 },
      { item: "Bob's Door", x: 9, y: 10 },
      { item: "Bob's House Vault", x: 5, y: 8 },
    ]);
    expect(p.item1).toEqual({ item: "Bob's Mailbox", x: 5, y: 6 });
    expect(p.item2).toEqual({ item: "Exit", x: 6, y: 6 });
  });
  test("slot 2 writes Exit2 and H2", () => {
    const p = planHouse(type("Blue Cottage"), { x: 10, y: 2 }, 2, -1, 4, "Ann", "");
    expect(p.interior).toBe("xH2-1yH24");
    expect(p.exit.house).toBe(2);
    expect(p.outdoorItems[0]).toEqual({ item: "Exit2", x: 11, y: 4 });
  });
  test("bug fixed: the Small Shop's lamp is recorded where it is dropped, so demolition finds it", () => {
    const p = planHouse(type("Small Shop"), { x: 5, y: 4 }, 1, 0, 0, "Bob", "");
    expect(p.outdoorItems).toContainEqual({ item: "Street Lamp", x: 5, y: 7 });
    expect(p.item1).toEqual({ item: "Street Lamp", x: 5, y: 7 });
    expect(p.title).toBe("Bob's Shop");
    expect(p.interiorItems).toEqual([{ item: "Exit", x: 9, y: 12 }]);
  });
  test("the Large House, Farm and Fortress: their items and headers", () => {
    const large = planHouse(type("Large House"), { x: 3, y: 3 }, 1, 0, 0, "Bob", "");
    expect(large.interiorItems.map((i) => i.item)).toEqual([
      "Exit",
      "Bob's Door",
      "Stove",
      "Blackjack Table",
      "Bob's House Vault",
    ]);
    expect(planHouse(type("Small Farm"), { x: 3, y: 3 }, 1, 0, 0, "Bob", "").title).toBe(
      "Bob's Farm",
    );
    const fort = planHouse(type("Fortress Guild Hall"), { x: 3, y: 3 }, 1, 0, 0, "Bob", "Knights");
    expect(fort.title).toBe("Hall of the Knights");
    expect(fort.item1).toBeNull();
    expect(fort.interiorItems.map((i) => `${i.item}@${i.x},${i.y}`)).toEqual([
      "Exit@9,12",
      "The Knights's Door@9,10",
      "The Knights's Guild Vault@5,8",
      "The Knights's Board@13,2",
      "Anvil@6,2",
      "Alchemy Lab@8,2",
      "Blackjack Table@13,5",
      "Vault@3,4",
    ]);
  });
  test("the farm, shop and halls are O-O-O and set your respawn point; the houses are not (templates' field 12)", () => {
    const ooo = (h: string) => {
      const f = type(h).template.flags;
      return `${f.canFight}-${f.isIndoors}-${f.canPvp}` === "O-O-O";
    };
    expect(["Small Farm", "Small Shop", "Small Guild Hall", "Fortress Guild Hall"].every(ooo)).toBe(
      true,
    );
    expect(["Small House", "Blue Cottage", "Large House"].some(ooo)).toBe(false);
  });
});

describe("HeadDrop", () => {
  test("a room whose header names you is 0; anywhere else is 1", () => {
    expect(headDrop("Town Square", "Bob", "")).toBe(1);
    expect(headDrop("Bob's House", "Bob", "")).toBe(0);
    expect(headDrop("bob's farm", "Bob", "")).toBe(0);
  });
  test("SSO matches the owner exactly: Bob does not own Jimbob's House (1.6's `contains`)", () => {
    expect(headDrop("Jimbob's House", "Bob", "")).toBe(1);
  });
  test("your guild's hall is 0", () => {
    expect(headDrop("Hall of the Knights", "Bob", "Knights")).toBe(0);
    expect(headDrop("Hall of the Knights", "Bob", "")).toBe(1);
  });
});

describe("the click's fixtures", () => {
  test("a town Anvil, Stove or Alchemy Lab shows its line; in your house it is picked up", () => {
    expect(clickGate("Anvil", 10, 1)).toEqual({
      kind: "text",
      text: "This is an anvil, used for blacksmithing.",
    });
    expect(clickGate("Stove", 10, 1)).toEqual({
      kind: "text",
      text: "This is a stove, used for cooking food.",
    });
    expect(clickGate("Alchemy Lab", 10, 0)).toEqual({ kind: "take" });
  });
  test("the fixed lines: Fire Pot, Wall Torch, platforms, a clock by `contains`", () => {
    expect(clickGate("Fire Pot", 10)).toEqual({ kind: "text", text: "I bet that's hot" });
    expect(clickGate("Wall Torch", 10)).toEqual({
      kind: "text",
      text: "This is a brightly lit torch.",
    });
    expect(clickGate("Experience Platform", 10)).toEqual({
      kind: "text",
      text: "You must be over 30 hit points to pass this platform.",
    });
    expect(clickGate("Grandfather Clock", 10)).toEqual({ kind: "text", text: "This is a clock." });
    expect(clickGate("Chimney", 10)).toEqual({ kind: "silent" });
    expect(clickGate("Street Lamp", 10)).toEqual({ kind: "text", text: "This is a street lamp." });
  });
  test("the casino tables open only where the flag is set, else they are picked up", () => {
    expect(clickGate("Slot Machine", 10, 1)).toEqual({ kind: "casino", game: "slots" });
    expect(clickGate("Slot Machine", 10, 0)).toEqual({ kind: "take" });
  });
});

describe("decay", () => {
  const entry = (
    name: string,
    map: string,
    month: string,
    interior = `${map}h`,
  ): HouseListEntry => ({
    ownerId: name.toLowerCase(),
    ownerName: name,
    map,
    interior,
    month,
  });
  test("months carry their year", () => {
    expect(monthIndex("2026-01")).toBe(2026 * 12);
    expect(monthIndex("2026-12")).toBe(2026 * 12 + 11);
    expect(monthIndex("7")).toBeNull();
    expect(monthIndex("2026-13")).toBeNull();
  });
  test("the last-login update gives every house of the owner this month", () => {
    const list = [
      entry("Bob", "x1y1", "2026-03"),
      entry("Ann", "x2y2", "2026-03"),
      entry("Bob", "x3y3", "2026-01"),
    ];
    expect(refreshOwner(list, "bob", "2026-07")).toBe(true);
    expect(list.map((e) => e.month)).toEqual(["2026-07", "2026-03", "2026-07"]);
    expect(refreshOwner(list, "bob", "2026-07")).toBe(false);
  });
  test("a sweep keeps this month and last, across the new year", () => {
    const list = [
      entry("A", "x1y1", "2025-12"),
      entry("B", "x2y2", "2026-01"),
      entry("C", "x3y3", "2025-11"),
    ];
    expect(sweep(list, "2026-01").demolish.map((d) => d.ownerName)).toEqual(["C"]);
    expect(sweep([entry("A", "x1y1", "2026-05")], "2026-06").demolish).toEqual([]);
  });
  test("bug fixed: a stale house goes alone; the owner's other houses and the year count", () => {
    const list = [entry("Bob", "x1y1", "2026-02"), entry("Bob", "x2y2", "2026-09")];
    const r = sweep(list, "2026-09");
    expect(r.demolish.map((d) => d.map)).toEqual(["x1y1"]);
    expect(r.list.map((e) => e.map)).toEqual(["x2y2"]);
    // An owner last seen in this month a year ago is stale.
    expect(sweep([entry("Ann", "x5y5", "2025-09")], "2026-09").demolish).toHaveLength(1);
  });
  test("bug fixed: every house the sweep removes stays removed", () => {
    const list = [
      entry("A", "x1y1", "2026-01"),
      entry("B", "x2y2", "2026-01"),
      entry("C", "x3y3", "2026-06"),
      entry("A", "x1y1", "2026-01"),
    ];
    const r = sweep(list, "2026-06");
    // A's duplicate entry is one house, demolished once.
    expect(r.demolish.map((d) => d.ownerName)).toEqual(["A", "B"]);
    expect(r.list.map((e) => e.ownerName)).toEqual(["C"]);
  });
  test("bug fixed: two houses on one map are two entries, judged apart", () => {
    const list = [
      entry("Bob", "x1y1", "2026-01", "xH11yH11"),
      entry("Bob", "x1y1", "2026-06", "xH21yH21"),
    ];
    expect(sweep(list, "2026-06").demolish.map((d) => d.interior)).toEqual(["xH11yH11"]);
  });
});
