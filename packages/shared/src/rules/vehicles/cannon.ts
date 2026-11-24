/**
 * The Battleship's cannon (issue #2, an SSO addition: 1.6 drew the cannonball but never fired it).
 * The attack key fires one shot per press forward along the rider's facing, spending one
 * cannonball (the world's cannon ammo) from the bag. The shot is a FX, `CannonballShot<L|R|U|D>`,
 * placed 48 px out from the rider (as 1.6's cast handler placed its cannonballs) and moved 5 px
 * each `stepFrame` call.
 * It stops at the first player, monster or vehicle it meets, over a tile an Airship cannot cross,
 * or at the playfield's edge.
 *
 * Its damage and reload are the world's balance (`balance.cannon`, issue #19).
 */
import { rollFlat } from "../../content/balance.ts";
import { content } from "../../content/store.ts";
import { lingoEq, type Rng } from "../core/lingo.ts";
import type { Bag } from "../inventory/inventory.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";

/**
 * The bag slot (0-based) a shot takes its cannonball from: the first line of the world's cannon
 * ammo (`bindings.json` `cannon`, Classic's `Cannonball`), or -1 with none. A world that binds no
 * ammo has a cannon that never fires.
 */
export function cannonballSlot(bag: Bag): number {
  const ammo = content().bindings.cannon.ammo;
  if (ammo === undefined) {
    return -1;
  }
  return bag.findIndex((l) => l !== null && l.qty > 0 && lingoEq(l.item, ammo));
}

/** Frames (ticks) between shots (`balance.cannon.reloadFrames`; the engine's default is 5 seconds). */
export function cannonReloadFrames(): number {
  return content().balance.cannon.reloadFrames;
}

/** How far from the rider's loc the shot appears, along the facing (1.6's cast handler). */
export const CANNONBALL_OFFSET = 48;

/** Pixels the shot moves on each `stepFrame` call (two a drawn frame). */
export const CANNONBALL_STEP_PX = 5;

/**
 * What a cannonball takes off a player's HP or a hull (`balance.cannon.damage`; the engine's
 * default is 13 + random(3), 14 to 16).
 */
export function cannonDamage(rng: Rng): number {
  return rollFlat(content().balance.cannon.damage, rng);
}

/**
 * `stepFrame` calls the rider shows the firing frames for after a shot: `fire1`, `fire2`, `fire3`
 * for a third each (three drawn frames apiece).
 */
export const CANNON_FIRE_ANIM = 18;

/** The firing frame (1-3) a Battleship rider shows with `anim` calls of the animation left. */
export function cannonFireFrame(anim: number): 1 | 2 | 3 {
  const done = CANNON_FIRE_ANIM - Math.max(1, Math.min(CANNON_FIRE_ANIM, anim));
  return (1 + Math.floor((done * 3) / CANNON_FIRE_ANIM)) as 1 | 2 | 3;
}

export const CANNON_TEXT = {
  noAmmo: "You have no cannonballs!",
} as const;

const DIR_OF: Record<Facing, "L" | "R" | "U" | "D"> = { W: "L", E: "R", N: "U", S: "D" };

/** The shot's FX name for a facing: `CannonballShotR` for east. */
export function cannonballName(facing: Facing): string {
  return `CannonballShot${DIR_OF[facing]}`;
}

const SHOT = /^CannonballShot([LRUD])$/i;

/** The pixel step of a shot FX per unit, or null when `name` is not one. */
export function cannonballDir(name: string): readonly [number, number] | null {
  const d = SHOT.exec(name)?.[1]?.toUpperCase();
  switch (d) {
    case "L":
      return [-1, 0];
    case "R":
      return [1, 0];
    case "U":
      return [0, -1];
    case "D":
      return [0, 1];
    default:
      return null;
  }
}

/** A FX name that is a cannonball shot. */
export function isCannonball(name: string): boolean {
  return cannonballDir(name) !== null;
}

/** Where a shot from the rider's loc appears. */
export function cannonballStart(
  caster: { h: number; v: number },
  facing: Facing,
): { h: number; v: number } {
  const [dx, dy] = FACING_DELTA[facing];
  return { h: caster.h + dx * CANNONBALL_OFFSET, v: caster.v + dy * CANNONBALL_OFFSET };
}

/**
 * The ball flies at a rider's hull height, its centre 6 px below the FX loc, and its shadow falls on
 * the water 8 px lower. What the shot meets is tested at the shadow, in this 9 px box: a sprite's
 * rect reaches well into the tiles beside it (a walker's is 46 x 45), and a shot along a row must
 * not hit someone standing in the next one.
 */
export function cannonballHitBox(
  h: number,
  v: number,
): { left: number; top: number; right: number; bottom: number } {
  return { left: h - 4, top: v + 10, right: h + 5, bottom: v + 19 };
}

/**
 * The hit box swept from loc `from` to loc `to`: everything the shot's shadow passed over since it
 * was last tested, so nothing in its way is stepped over.
 */
export function cannonballSweep(
  from: { h: number; v: number },
  to: { h: number; v: number },
): { left: number; top: number; right: number; bottom: number } {
  const a = cannonballHitBox(from.h, from.v);
  const b = cannonballHitBox(to.h, to.v);
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * Where a shot's first sweep starts: the edge of the rider's own tile. The ball appears 48 px out,
 * past the middle of the next tile, so whatever stands right beside the ship is tested too.
 */
export function cannonballLaunchFrom(
  caster: { h: number; v: number },
  dir: readonly [number, number],
): { h: number; v: number } {
  return { h: caster.h + dir[0] * 16, v: caster.v + dir[1] * 16 };
}

/**
 * The tile under a shot at loc (h, v), where its shadow falls: a rider's own loc maps to its own
 * tile. The playfield's tile x spans stage h `32x − 2` to `32x + 29`, tile y spans v `32y − 1` to
 * `32y + 30`.
 */
export function cannonballTile(h: number, v: number): { x: number; y: number } {
  return { x: Math.floor((h + 2) / 32), y: Math.floor((v + 15) / 32) };
}

/**
 * The tiles a shot passes before it appears, from the one next to the rider (whose loc is
 * `caster`) up to the one it appears over. Any of them an Airship cannot cross stops the shot at
 * once.
 */
export function cannonballLaunchTiles(
  caster: { h: number; v: number },
  dir: readonly [number, number],
): { x: number; y: number }[] {
  const from = cannonballTile(caster.h, caster.v);
  const end = cannonballTile(
    caster.h + dir[0] * CANNONBALL_OFFSET,
    caster.v + dir[1] * CANNONBALL_OFFSET,
  );
  const out: { x: number; y: number }[] = [];
  for (let n = 1; n <= 3; n++) {
    const t = { x: from.x + dir[0] * n, y: from.y + dir[1] * n };
    out.push(t);
    if (t.x === end.x && t.y === end.y) {
      break;
    }
  }
  return out;
}

/** The spin frame (1-4) a shot shows: one turn a drawn frame (10 px), the same on every client. */
export function cannonballFrame(h: number, v: number, dir: readonly [number, number]): number {
  const along = dir[0] !== 0 ? h : v;
  return 1 + (((Math.floor(along / (CANNONBALL_STEP_PX * 2)) % 4) + 4) % 4);
}
