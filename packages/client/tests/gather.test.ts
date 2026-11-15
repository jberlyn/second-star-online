/**
 * Client: a changed tile, the tool swing sounds, the gatherer's server sounds, BSmith's two sounds
 * and the treasure maps setting's control.
 */
import { describe, expect, test } from "bun:test";

import type { MapView, PlayerView, SettingRow } from "@secondstaronline/shared";
import { NO_EQUIPMENT, NO_FOG } from "@secondstaronline/shared";

import { applyDelta, applySnapshot, createModel } from "../src/model.ts";
import { spellSounds } from "../src/sfx.ts";
import { checkValue, parseMaps, valueText } from "../src/ui/settings.ts";

const rows = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
const map = (): MapView => ({
  name: "x1000y992",
  title: "",
  layers: [rows("G1"), rows("G3"), rows("G3"), rows("5A")],
  signs: ["", "", ""],
  fog: { ...NO_FOG },
});
const you: PlayerView = {
  id: "me",
  name: "me",
  head: 1,
  x: 5,
  y: 5,
  facing: "N",
  step: null,
  equip: { ...NO_EQUIPMENT },
  body: null,
};

function model() {
  const m = createModel();
  applySnapshot(m, {
    map: map(),
    you,
    self: { n: 0, x: 5, y: 5, facing: "N", frames: 0 },
    players: [],
    monsters: [],
  });
  m.loading = false;
  return m;
}

describe("a changed tile", () => {
  test("the layer changes, the walk grid follows, and the playfield is told to redraw it", () => {
    const m = model();
    expect(m.walk[3]?.[4]).toBe(true);
    applyDelta(m, [{ e: "tile", layer: 2, x: 5, y: 4, code: "S3" }]);
    expect(m.map?.layers[1][3]?.split(" ")[4]).toBe("S3");
    expect(m.walk[3]?.[4]).toBe(false); // a tree blocks on foot
    expect(m.tileChanges).toEqual([{ x: 5, y: 4 }]);
    applyDelta(m, [{ e: "tile", layer: 2, x: 5, y: 4, code: "P3" }]);
    expect(m.map?.layers[1][3]?.split(" ")[4]).toBe("P3");
  });

  test("a tile off the map changes nothing", () => {
    const m = model();
    applyDelta(m, [{ e: "tile", layer: 2, x: 18, y: 4, code: "S3" }]);
    expect(m.tileChanges).toEqual([]);
  });
});

describe("gathering sounds", () => {
  test("treechop and swordhit2 replace the swing on channel 3", () => {
    const m = model();
    m.peers.set("b", {
      id: "b",
      name: "b",
      head: 1,
      x: 6,
      y: 5,
      facing: "N",
      frames: 0,
      fromX: 6,
      fromY: 5,
      equip: { ...NO_EQUIPMENT },
      body: null,
    } as never);
    applyDelta(m, [
      { e: "swing", id: "b", bonus: 0, atDelay: 0, actionDelay: 0, sound: "treechop" },
    ]);
    applyDelta(m, [
      { e: "swing", id: "b", bonus: 0, atDelay: 0, actionDelay: 0, sound: "swordhit2" },
    ]);
    expect(m.sounds).toEqual([
      { name: "treechop", ch: 3 },
      { name: "swordhit2", ch: 3 },
    ]);
  });

  test("BSmith plays Swordhit2 on a 1, else Swordhit1, on channel 4", () => {
    expect(spellSounds("BSmith", () => 1)).toEqual([{ name: "Swordhit2", ch: 4 }]);
    expect(spellSounds("BSmith", () => 2)).toEqual([{ name: "Swordhit1", ch: 4 }]);
    expect(spellSounds("Fishing", () => 1)).toEqual([{ name: "splash", ch: 4 }]);
    expect(spellSounds("sprinkle", () => 1)).toEqual([]);
  });

  test("the roll is drawn for every spell cast, whatever the spell", () => {
    const calls: number[] = [];
    spellSounds("Portal", (n) => {
      calls.push(n);
      return 1;
    });
    expect(calls).toEqual([2]);
  });
});

describe("the treasure maps setting", () => {
  const row: SettingRow = {
    key: "treasureMaps",
    group: "World",
    label: "Treasure maps",
    tooltip: "",
    kind: "maps",
    value: [],
    default: [],
  };

  test("one map per line; a bad line is named", () => {
    expect(parseMaps("x1y1\n\n  x-2y30 \n")).toEqual(["x1y1", "x-2y30"]);
    expect(checkValue(row, ["x1y1", "x2y2"])).toBeNull();
    expect(checkValue(row, ["x1y1", "town"])).toBe("Line 2: write a map name, like x1000y992.");
    expect(valueText(row, [])).toBe("none");
    expect(valueText(row, ["x1y1", "x2y2"])).toBe("2 maps");
  });
});
