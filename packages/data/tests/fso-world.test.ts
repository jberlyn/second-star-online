/**
 * The Classic world seed from 1.6's distributed maps (issue #43): the converter reads 1.6's files as
 * its scripts did, and the committed `content/world.json` is what it makes of the reference copy.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
  CLASSIC_WORLD_SOURCE,
  FSO_DAT,
  importFsoWorld,
  parseFsoExit,
  parseFsoItems,
  parseFsoMap,
  parseFsoMobs,
  renderWorldSource,
} from "../build/fso-world.ts";
import { seedItemProblem, worldSeedSchema } from "../schema/world.ts";

/** A map file: layer n's rows are `<prefix><n><row>` codes, so every row says where it came from. */
function mapFile(fields: Partial<Record<number, string>> = {}): string {
  const items: string[] = [];
  const row = (layer: number, r: number) =>
    Array.from({ length: 17 }, () => `${"ABCD"[layer - 1]}${r.toString(36)}`).join(" ");
  const layout: [number, number, number][] = [];
  for (let layer = 1; layer <= 4; layer++) {
    const [top, bottom] = [
      [1, 46],
      [19, 49],
      [28, 52],
      [37, 55],
    ][layer - 1] as [number, number];
    for (let r = 1; r <= 9; r++) {
      layout.push([top + r - 1, layer, r]);
    }
    for (let r = 10; r <= 12; r++) {
      layout.push([bottom + r - 10, layer, r]);
    }
  }
  for (let n = 1; n <= 57; n++) {
    const at = layout.find(([i]) => i === n);
    items.push(fields[n] ?? (at ? row(at[1], at[2]) : ""));
  }
  return `${items.join("#")}#`;
}

describe("the 1.6 file formats", () => {
  test("1.6's map, Mobs and Items files convert as its scripts read them", () => {
    const m = parseFsoMap(
      "x0y106",
      mapFile({
        12: "X:W:O:None:O:Fog1:30:10:20:40",
        13: "1000:1050:9:10:",
        14: "Slim's Love Shack!",
        16: "A sign",
        17: "Meldein Sea",
        18: "H21000:H2992:9:11:",
      }),
    );
    // Rows 1-9 and 10-12 of each layer come from their own items, in order.
    expect(m.layers.map((l) => l.map((r) => r.slice(0, 2)))).toEqual(
      [1, 2, 3, 4].map((layer) =>
        Array.from({ length: 12 }, (_, i) => `${"ABCD"[layer - 1]}${(i + 1).toString(36)}`),
      ),
    );
    expect(m.title).toBe("Meldein Sea");
    expect(m.flags).toEqual({ canFight: "X", isIndoors: "O", canPvp: "O", fctSpwn: "warrior" });
    expect(m.fog).toEqual({ tex: "Fog1", blend: 30, r: 10, g: 20, b: 40 });
    expect(m.exit1).toEqual({ mx: 1000, my: 1050, x: 9, y: 10 });
    expect(m.exit2).toEqual({ mx: 1000, my: 992, x: 9, y: 11, house: 2 });
    expect(m.signs).toEqual(["Slim's Love Shack!", "", "A sign"]);

    // "X" is no faction swap, NoTex white is no fog, an empty exit is none.
    const plain = parseFsoMap("x0y1", mapFile({ 12: "O:X:X:None:X:NoTex:0:255:255:255" }));
    expect(plain.flags).toEqual({ canFight: "O", isIndoors: "X", canPvp: "X" });
    // Each faction letter, any case, as its key; O is no swap.
    for (const [letter, key] of [
      ["M", "mage"],
      ["a", "adventurer"],
      ["w", "warrior"],
    ] as const) {
      expect(
        parseFsoMap("x", mapFile({ 12: `X:${letter}:X:None:X:NoTex:0:255:255:255` })).flags,
      ).toEqual({ canFight: "X", isIndoors: "X", canPvp: "X", fctSpwn: key });
    }
    expect(parseFsoMap("x", mapFile({ 12: "X:O:X:None:X:NoTex:0:255:255:255" })).flags).toEqual({
      canFight: "X",
      isIndoors: "X",
      canPvp: "X",
    });
    expect(plain.fog).toBeUndefined();
    expect(plain.exit1).toBeNull();
    expect(parseFsoExit("a:b:c:d:")).toBeNull();

    // Mobs: the roster, `+`, then the live monsters; only the roster is content.
    // Entries are `name:hp:x:y`, joined here from their parts.
    const mob = (...parts: (string | number)[]) => parts.join(":");
    const roster = [mob("Slime", 15, 11, 9), "", "", mob("Orc", 30, 2, 3)].join("|");
    const live = [mob("Slime", 14, 5, 7), "", "", "", ""].join("|");
    expect(parseFsoMobs(`${roster}+${live}`)).toEqual([
      { slot: 1, species: "Slime", x: 11, y: 9 },
      { slot: 4, species: "Orc", x: 2, y: 3 },
    ]);
    // Nothing live: the roster still stands.
    expect(parseFsoMobs(`${roster}+||||`)).toEqual([
      { slot: 1, species: "Slime", x: 11, y: 9 },
      { slot: 4, species: "Orc", x: 2, y: 3 },
    ]);
    // A live monster with no roster entry is not content.
    expect(parseFsoMobs(`||||+${live}`)).toEqual([]);
    expect(parseFsoMobs("||||+||||")).toEqual([]);

    // Items: stage pixels on a tile's anchor (32·x + 14, 32·y − 3).
    // Entries are `<name>:<h>-<v>`, joined here from their parts.
    const item = (name: string, h: number, v: number) => `${name}:${h}-${v}`;
    expect(
      parseFsoItems("x", `${item("3 Gold", 174, 253)}|${item("apple", 206, 125)}||||`),
    ).toEqual([
      { item: "3 Gold", x: 5, y: 8 },
      { item: "apple", x: 6, y: 4 },
    ]);
    expect(() => parseFsoItems("x", item("apple", 200, 125))).toThrow("not on a tile");
    expect(() => parseFsoMap("x", "G1#G1")).toThrow("57 items");
  });
});

describe("the world seed schema", () => {
  test("takes the World Editor's fog blend levels, through 255", () => {
    const seed = (blend: number) => {
      const world = JSON.parse(readFileSync(CLASSIC_WORLD_SOURCE, "utf8"));
      world.maps[0].fog = { tex: "Cloudy3", blend, r: 255, g: 255, b: 255 };
      return worldSeedSchema.safeParse(world).success;
    };
    expect(seed(0)).toBe(true);
    expect(seed(200)).toBe(true);
    expect(seed(255)).toBe(true);
    expect(seed(256)).toBe(false);
  });

  test("a placed name carries a count only for the currency and crystals", () => {
    const items = ["Apple", "Gold", "Blue Crystal", "Exit"];
    expect(seedItemProblem("Apple", items, "Gold")).toBeNull();
    expect(seedItemProblem("apple", items, "Gold")).toBeNull();
    expect(seedItemProblem("3 Gold", items, "Gold")).toBeNull();
    expect(seedItemProblem("5 Blue Crystal", items, "Gold")).toBeNull();
    expect(seedItemProblem("2 Apple", items, "Gold")).toContain("give a pile's count as qty");
    // With no currency, Gold is an ordinary item: its count goes in qty.
    expect(seedItemProblem("3 Gold", items, null)).toContain("give a pile's count as qty");
    expect(seedItemProblem("Pear", items, "Gold")).toContain("not one of the pack's items");
    expect(seedItemProblem("0 Gold", items, "Gold")).toContain("at least 1");
    expect(seedItemProblem("0 Blue Crystal", items, "Gold")).toContain("at least 1");
    expect(seedItemProblem("3 Gold", items, "Gold", 2)).toContain("give no qty");
    expect(seedItemProblem("Apple", items, "Gold", 2)).toBeNull();
  });
});

describe("the committed Classic world seed", () => {
  const world = worldSeedSchema.parse(JSON.parse(readFileSync(CLASSIC_WORLD_SOURCE, "utf8")));

  test("names only Classic items, monsters and tiles", () => {
    const content = (f: string) =>
      JSON.parse(readFileSync(CLASSIC_WORLD_SOURCE.replace("world.json", f), "utf8"));
    const items = new Set(
      (content("items.json").items as { name: string }[]).map((i) => i.name.toLowerCase()),
    );
    const monsters = new Set(
      (content("monsters.json").monsters as { name: string }[]).map((m) => m.name.toLowerCase()),
    );
    const tiles = new Set(
      (content("tiles.json").catalogue as { code: string }[]).map((t) => t.code),
    );
    for (const m of world.maps) {
      for (const layer of m.layers) {
        for (const code of layer.join(" ").split(" ")) {
          expect(tiles.has(code)).toBe(true);
        }
      }
      for (const r of m.roster ?? []) {
        expect(monsters.has(r.species.toLowerCase())).toBe(true);
      }
      for (const it of m.items ?? []) {
        // A gold pile carries its count in its name, as the World Editor saves it.
        const name = it.item.replace(/^\d+ (?=Gold$)/, "");
        expect(items.has(name.toLowerCase())).toBe(true);
      }
    }
  });

  test.skipIf(!existsSync(FSO_DAT))("is what the converter makes of the 1.6 reference copy", () => {
    expect(renderWorldSource(importFsoWorld(FSO_DAT))).toBe(
      readFileSync(CLASSIC_WORLD_SOURCE, "utf8"),
    );
  });
});
