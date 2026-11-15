import { describe, expect, test } from "bun:test";

import {
  GRID_MAPS,
  isTree,
  letters,
  openTile,
  SCENARIOS,
  TOWN,
  treeSpots,
} from "../src/scenarios.ts";

const count = (bots: { role: string }[], role: string) =>
  bots.filter((b) => b.role === role).length;

describe("scenarios", () => {
  test("names are letters only and unique, and no two bots share a tile on a map", () => {
    for (const [key, make] of Object.entries(SCENARIOS)) {
      const s = make();
      const names = new Set<string>();
      const tiles = new Set<string>();
      for (const b of s.bots) {
        expect(b.name, `${key} ${b.name}`).toMatch(/^[A-Za-z]+$/);
        expect(names.has(b.name), `${key} duplicate ${b.name}`).toBe(false);
        names.add(b.name);
        const tile = `${b.map}:${b.x},${b.y}`;
        // Traders stand beside their partner; the rest must not stack.
        if (b.role !== "trader") {
          expect(tiles.has(tile), `${key} stacked at ${tile}`).toBe(false);
        }
        tiles.add(tile);
        expect(isTree(b.x, b.y), `${key} ${b.name} stands in a tree`).toBe(false);
        expect(s.maps).toContain(b.map);
      }
    }
  });

  test("town is 40 walkers on one map", () => {
    const s = SCENARIOS.town?.();
    expect(s?.bots).toHaveLength(40);
    expect(new Set(s?.bots.map((b) => b.map))).toEqual(new Set([TOWN]));
    expect(count(s?.bots ?? [], "walker")).toBe(40);
  });

  test("hunt is 10 fighters and 10 casters; pvp is 10 v 10; craft is 30 gatherers", () => {
    const hunt = SCENARIOS.hunt?.().bots ?? [];
    expect([count(hunt, "fighter"), count(hunt, "caster")]).toEqual([10, 10]);
    const pvp = SCENARIOS.pvp?.().bots ?? [];
    expect(pvp.filter((b) => b.team === 0)).toHaveLength(10);
    expect(pvp.filter((b) => b.team === 1)).toHaveLength(10);
    expect(count(SCENARIOS.craft?.().bots ?? [], "gatherer")).toBe(30);
  });

  test("world100 and world200 have that many bots over 20 maps, 40 of them in town", () => {
    for (const n of [100, 200]) {
      const s = SCENARIOS[`world${n}`]?.();
      expect(s?.bots).toHaveLength(n);
      expect(s?.maps).toHaveLength(20);
      expect(GRID_MAPS).toHaveLength(20);
      expect(s?.bots.filter((b) => b.map === TOWN)).toHaveLength(40);
      const traders = s?.bots.filter((b) => b.role === "trader") ?? [];
      for (const t of traders) {
        expect(t.partner).toBeDefined();
        expect(traders.find((o) => o.name === t.partner)?.partner).toBe(t.name);
      }
    }
  });

  test("burst logs everyone in within 5 s; behind adds one bot on the slow link", () => {
    expect(SCENARIOS.burst?.().rampSeconds).toBe(5);
    const behind = SCENARIOS.behind?.();
    expect(behind?.bots).toHaveLength(41);
    expect(behind?.bots.filter((b) => b.profile === "slow")).toHaveLength(1);
  });

  test("every tree spot is open ground next to a tree, facing it", () => {
    const delta = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] } as const;
    const spots = treeSpots();
    expect(spots.length).toBeGreaterThan(30);
    for (const s of spots) {
      expect(isTree(s.x, s.y)).toBe(false);
      const [dx, dy] = delta[s.faceDir];
      expect(isTree(s.x + dx, s.y + dy)).toBe(true);
    }
  });

  test("letters and open tiles", () => {
    expect(letters(0)).toBe("aaa");
    expect(letters(27)).toBe("abb");
    const t = openTile(0);
    expect(isTree(t.x, t.y)).toBe(false);
  });
});
