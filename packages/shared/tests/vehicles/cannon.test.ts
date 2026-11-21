/** The Battleship cannon's pure rules (issue #2). */
import { describe, expect, test } from "bun:test";

import {
  bagPicture,
  CANNON_FIRE_ANIM,
  cannonballFrame,
  cannonballHitBox,
  cannonballLaunchTiles,
  cannonballName,
  cannonballSlot,
  cannonballTile,
  cannonDamage,
  cannonFireFrame,
  groundMember,
  newFx,
  placeFx,
  type Rng,
  stepFx,
  tileLoc,
} from "../../src/index.ts";

const fixed = (n: number): Rng => ({ random: () => n });

describe("the cannon", () => {
  test("SSO: a cannonball does 14 to 16", () => {
    expect([1, 2, 3].map((n) => cannonDamage(fixed(n)))).toEqual([14, 15, 16]);
  });

  test("SSO: the shot is placed 48 px out from the rider along the facing", () => {
    const at = tileLoc(8, 5);
    expect(placeFx(cannonballName("E"), at, at)).toEqual({ h: at.h + 48, v: at.v });
    expect(placeFx(cannonballName("W"), at, at)).toEqual({ h: at.h - 48, v: at.v });
    expect(placeFx(cannonballName("N"), at, at)).toEqual({ h: at.h, v: at.v - 48 });
    expect(placeFx(cannonballName("S"), at, at)).toEqual({ h: at.h, v: at.v + 48 });
  });

  test("SSO: the shot moves 5 px a step and spins a frame each drawn frame", () => {
    const fx = newFx("CannonballShotR", { h: 300, v: 157 });
    const frames: number[] = [];
    for (let i = 0; i < 8; i++) {
      stepFx(fx);
      frames.push(fx.frame);
    }
    expect(fx.h).toBe(340);
    expect(fx.v).toBe(157);
    // Two steps (one drawn frame) a spin frame, cycling 1-4.
    expect(frames).toEqual([3, 4, 4, 1, 1, 2, 2, 3]);
    expect(cannonballFrame(fx.h, fx.v, [1, 0])).toBe(fx.frame);
  });

  test("SSO: the shot stops over a tile it cannot cross, and at the playfield's edge", () => {
    const fx = newFx("CannonballShotL", tileLoc(8, 5));
    const seen: { x: number; y: number }[] = [];
    while (!fx.gone) {
      stepFx(fx, (x, y) => {
        seen.push({ x, y });
        return x === 5;
      });
    }
    expect(cannonballTile(fx.h, fx.v)).toEqual({ x: 5, y: 5 });
    expect(seen.every((t) => t.y === 5)).toBe(true);
    const free = newFx("CannonballShotD", tileLoc(8, 5));
    let steps = 0;
    while (!free.gone) {
      stepFx(free, () => false);
      steps++;
    }
    expect(free.v).toBeGreaterThan(400);
    expect(steps).toBe(Math.ceil((401 - tileLoc(8, 5).v) / 5));
  });

  test("SSO: a rider's loc is over its own tile, and the shot's way out is checked", () => {
    expect(cannonballTile(tileLoc(1, 1).h, tileLoc(1, 1).v)).toEqual({ x: 1, y: 1 });
    expect(cannonballTile(tileLoc(17, 12).h, tileLoc(17, 12).v)).toEqual({ x: 17, y: 12 });
    const at = tileLoc(8, 5);
    expect(cannonballLaunchTiles(at, [1, 0])).toEqual([
      { x: 9, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect(cannonballLaunchTiles(at, [-1, 0])).toEqual([{ x: 7, y: 5 }]);
    expect(cannonballLaunchTiles(at, [0, -1])).toEqual([
      { x: 8, y: 4 },
      { x: 8, y: 3 },
    ]);
    expect(cannonballLaunchTiles(at, [0, 1])).toEqual([{ x: 8, y: 6 }]);
  });

  test("SSO: the shot's hit box stays inside its own row and column", () => {
    const at = tileLoc(8, 5);
    const box = cannonballHitBox(at.h, at.v);
    // The tile spans h 254-285 and v 159-190.
    expect(box.left).toBeGreaterThanOrEqual(254);
    expect(box.right).toBeLessThanOrEqual(286);
    expect(box.top).toBeGreaterThanOrEqual(159);
    expect(box.bottom).toBeLessThanOrEqual(191);
  });

  test("SSO: a shot spends the first Cannonball in the bag", () => {
    expect(cannonballSlot([{ item: "Apple", qty: 1 }, null, { item: "Cannonball", qty: 4 }])).toBe(
      2,
    );
    expect(cannonballSlot([{ item: "Cannonballs", qty: 1 }])).toBe(-1);
  });

  test("SSO: the rider shows fire1, fire2, fire3 a third of the animation each", () => {
    const shown = Array.from({ length: CANNON_FIRE_ANIM }, (_, i) =>
      cannonFireFrame(CANNON_FIRE_ANIM - i),
    );
    expect(shown).toEqual([...Array(6).fill(1), ...Array(6).fill(2), ...Array(6).fill(3)]);
  });

  test("SSO: the Cannonball shows its 13 px picture in the bag and on the ground", () => {
    expect(bagPicture("Cannonball")).toBe("CannonballBag");
    expect(groundMember("Cannonball")).toBe("CannonballBag");
    expect(groundMember("Apple")).toBe("Apple");
  });
});
