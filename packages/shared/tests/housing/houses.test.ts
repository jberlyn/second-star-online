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

/** A ground item's bounding rect on tile (x, y): a 32×32 member, reg (16, −2). */
const itemAt = (x: number, y: number) => {
  const left = 32 * x - 2;
  const top = 32 * y - 1;
  return { left, top, right: left + 32, bottom: top + 32 };
};

describe("deeds", () => {
  test("Boat and Battleship Deeds do nothing", () => {
    expect(deedUse("Boat Deed")).toEqual({ kind: "nothing" });
    expect(deedUse("Battleship Deed")).toEqual({ kind: "nothing" });
  });
  test("the Airship Deed runs the airship drop", () => {
    expect(deedUse("Airship Deed")).toEqual({ kind: "airship" });
  });
  test("kept bug: the Stone Guild Hall Deed does nothing (no Houses member, template or builder)", () => {
    expect(deedUse("Stone Guild Hall Deed")).toEqual({ kind: "nothing" });
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
  test("kept bug: the Small Farm keeps the hovered row ('Small Fam'), and its ghost is shifted to match", () => {
    expect(houseAnchor(type("Small Farm"), 5, 5)).toEqual({ x: 4, y: 5 });
    expect(houseAnchor(type("Small House"), 5, 5)).toEqual({ x: 4, y: 4 });
    // The farm's footprint is tiles x 4-8, y 5-7: stage x 126-286, y 159-255. The ghost sits
    // 1 px right and 2 px up of it (160×96, reg (80, 48), at (32·5+15+32, 32·5+13+32)).
    expect(ghostRect(type("Small Farm"), 5, 5)).toEqual({
      left: 127,
      top: 157,
      right: 287,
      bottom: 253,
    });
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
  test("kept bug: no house can be anchored on rows 8-9; rows 10-11 read map fields 10-11", () => {
    // Anchor y 8: the edge test passes, layer 1 rows 9-10 read item 10, which never matches.
    const t = type("Small House");
    expect(terrainOk(t, 5, 7, FLAT.layer1, FLAT.layer2)).toBe(true);
    expect(terrainOk(t, 5, 8, FLAT.layer1, FLAT.layer2)).toBe(false);
    expect(checkPlacement(input({ type: t, hx: 6, hy: 9 }))).toEqual({
      ok: false,
      text: "The terrain is too rough to build here!",
    });
  });
  test("kept bug: layer 1 counts only the first 3 columns of a 5-wide house", () => {
    const l1 = layer("G1");
    // Rough everywhere except columns 4-6 of rows 4-6: a Large House at anchor (4, 4) spans
    // columns 4-8, and its columns 7-8 are never read.
    for (const y of [4, 5, 6]) {
      const w = row("G1").split(" ");
      w[3] = "8U";
      w[4] = "8U";
      w[5] = "8R";
      l1[y - 1] = w.join(" ");
    }
    expect(terrainOk(type("Large House"), 4, 4, l1, FLAT.layer2)).toBe(true);
  });
  test('kept bug: an 8V tile never counts: "*8R*8U*8V" has no star after 8V, so contains "*8V*" fails', () => {
    expect(terrainOk(type("Small House"), 5, 4, layer("8V"), FLAT.layer2)).toBe(false);
    expect(terrainOk(type("Small House"), 5, 4, layer("8U"), FLAT.layer2)).toBe(true);
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
  test("kept bug: the ghost's rect catches an item in the column to its right, but not one below", () => {
    const t = type("Small House");
    // Hovering (6, 5): footprint x 5-7, y 4-6.
    const right = checkPlacement(input({ type: t, obstacles: [itemAt(8, 5)] }));
    expect(right).toEqual({
      ok: false,
      text: "You cannot build here because there seems to be something in the way!",
    });
    expect(checkPlacement(input({ type: t, obstacles: [itemAt(6, 7)] })).ok).toBe(true);
    expect(checkPlacement(input({ type: t, obstacles: [itemAt(4, 5)] })).ok).toBe(true);
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
  test("kept bug: the Small Shop's lamp is dropped a row below where it is recorded", () => {
    const p = planHouse(type("Small Shop"), { x: 5, y: 4 }, 1, 0, 0, "Bob", "");
    expect(p.outdoorItems).toContainEqual({ item: "Street Lamp", x: 5, y: 7 });
    expect(p.item1).toEqual({ item: "Street Lamp", x: 5, y: 6 });
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
  test("a room whose header names you clears nothing; anywhere else sets 1", () => {
    expect(headDrop(0, "Town Square", "Bob", "")).toBe(1);
    expect(headDrop(0, "Bob's House", "Bob", "")).toBe(0);
    expect(headDrop(0, "bob's farm", "Bob", "")).toBe(0);
  });
  test("SSO matches the owner exactly: Bob does not own Jimbob's House (1.6's `contains`)", () => {
    expect(headDrop(0, "Jimbob's House", "Bob", "")).toBe(1);
  });
  test("your guild's hall clears it", () => {
    expect(headDrop(1, "Hall of the Knights", "Bob", "Knights")).toBe(0);
    expect(headDrop(0, "Hall of the Knights", "Bob", "")).toBe(1);
  });
  test("kept bug: nothing clears a set flag in your own house (nothing ever resets it)", () => {
    expect(headDrop(1, "Bob's House", "Bob", "")).toBe(1);
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
  const entry = (name: string, map: string, month: string): HouseListEntry => ({
    ownerId: name.toLowerCase(),
    ownerName: name,
    map,
    month,
  });
  test("the last-login update gives every entry of the owner this month", () => {
    const list = [entry("Bob", "x1y1", "3"), entry("Ann", "x2y2", "3"), entry("Bob", "x3y3", "1")];
    expect(refreshOwner(list, "bob", "7")).toBe(true);
    expect(list.map((e) => e.month)).toEqual(["7", "3", "7"]);
  });
  test("a sweep keeps this month and last; January keeps 12, June's pair is 5/6", () => {
    const list = [entry("A", "x1y1", "12"), entry("B", "x2y2", "1"), entry("C", "x3y3", "11")];
    const r = sweep(list, "1");
    expect(r.demolish).toEqual([{ ownerId: "c", ownerName: "C", map: "x3y3" }]);
    expect(sweep([entry("A", "x1y1", "5")], "6").demolish).toEqual([]);
  });
  test("kept bug: the house remover takes all of an owner's houses; the year is ignored", () => {
    const list = [entry("Bob", "x1y1", "2"), entry("Bob", "x2y2", "9")];
    // Month 9: Bob's x1y1 entry is stale, so both houses go.
    const r = sweep(list, "9");
    expect(r.demolish.map((d) => d.map)).toEqual(["x1y1", "x2y2"]);
    expect(r.list).toEqual([]);
    // An owner seen exactly a year ago (month 9 last year) survives.
    expect(sweep([entry("Ann", "x5y5", "9")], "9").demolish).toEqual([]);
  });
  test("kept bug: the sweep rewrites the list from its stale copy, so earlier removals come back", () => {
    const list = [entry("A", "x1y1", "1"), entry("B", "x2y2", "1"), entry("C", "x3y3", "6")];
    const r = sweep(list, "6");
    expect(r.demolish.map((d) => d.ownerName)).toEqual(["A", "B"]);
    // B was removed last, so the list is the stale copy without B: A is back, house gone.
    expect(r.list.map((e) => e.ownerName)).toEqual(["A", "C"]);
  });
});
