/**
 * Spell FX sprites: where a cast places its FX, and how the original's spell FX script advances it
 * each frame. The server runs this for collision; the client runs the same steps to draw, so both
 * agree frame for frame.
 *
 * Coordinates are 800×600 stage pixels, as the original's sprite locs: a character standing on tile
 * (x, y) has its sprite at `(x·32 + 14, y·32 − 3)` (the playfield's origin is (30, 31) and
 * characters sit at (X·32−16, Y·32−34) within it).
 *
 * Mirrors the original's cast handler (placement) and FX sprite sender (trails).
 */
import { lingoContains, lingoEq } from "../core/lingo.ts";
import {
  CANNONBALL_OFFSET,
  CANNONBALL_STEP_PX,
  cannonballDir,
  cannonballFrame,
  cannonballTile,
} from "../vehicles/cannon.ts";
import { fxEffect, fxRun } from "./spells.ts";

/** The stage loc of a character on tile (x, y). */
export function tileLoc(x: number, y: number): { h: number; v: number } {
  return { h: x * 32 + 14, v: y * 32 - 3 };
}

/** The playfield on the stage: also the viewport mask's rect. */
export const PLAYFIELD_RECT = { left: 30, top: 31, right: 574, bottom: 415 } as const;

/**
 * One FX sprite. `name` is the second entry in the cast handler's list ("Minor Heal", "FireballL",
 * "Blue ArrowsR").
 */
export interface FxSprite {
  name: string;
  /** The member shown is `<name>-<frame>`. */
  frame: number;
  /** The sprite's loc (its registration point) on the stage. */
  h: number;
  v: number;
  /** Moved off the stage to vertical position -5000 or -5300: finished. */
  gone: boolean;
}

/** The member a FX shows. */
export function fxMember(fx: Pick<FxSprite, "name" | "frame">): string {
  return `${fx.name}-${fx.frame}`;
}

/** Point spells placed at the click, `=` on the name. */
const AT_CLICK = [
  "BSmith",
  "Smoke Bomb",
  "xSmokeoBomb",
  "minor heal",
  "Portal",
  "Diminish Hunger",
  "major heal",
  "Fishing",
  "Illusionary Spikes",
  "Web",
  "morph",
  "Raise Dead",
  "Summon Creature",
  "Holy Shield",
  "Firesword",
  "Hold",
  "Argon's Fist",
  "Inxition",
  "Create Food",
  "Dispel Illusions",
  "meteor",
  "Radar",
  "Crush",
  "Nature Shift",
  "Stone Skin",
  "Whirlwind",
  "sprinkle",
  "Firebolt",
  "Magic Shield",
];

/**
 * Offsets from the caster's sprite. 1.6's cannonballs never fired; SSO's Battleship shot
 * (`CannonballShot<dir>`) is placed 48 px out, as 1.6 would have placed its own.
 */
const FROM_CASTER: Record<string, [number, number]> = {
  fireballl: [-32, 0],
  fireballr: [32, 0],
  fireballu: [0, -32],
  fireballd: [0, 32],
  boltl: [-48, -5],
  boltr: [30, -5],
  boltu: [-8, -48],
  boltd: [-7, 40],
  "wind wavel": [-33, 0],
  "wind waver": [33, 0],
  "wind waveu": [0, -33],
  "wind waved": [0, 33],
  cannonballshotl: [-CANNONBALL_OFFSET, 0],
  cannonballshotr: [CANNONBALL_OFFSET, 0],
  cannonballshotu: [0, -CANNONBALL_OFFSET],
  cannonballshotd: [0, CANNONBALL_OFFSET],
};

/**
 * Where the cast handler places `name`, or null when it sets no loc: the sprite keeps its off-stage
 * loc and nothing shows (Bless, Haste, Weaken, Poison Dart, Replenish, Holy Weapon, Identify, and
 * any name without a member).
 */
export function placeFx(
  name: string,
  caster: { h: number; v: number },
  target: { h: number; v: number },
): { h: number; v: number } | null {
  const eff = fxEffect(name);
  if (AT_CLICK.some((n) => lingoEq(eff, n))) {
    return { h: target.h, v: target.v };
  }
  // Arrows: the target is the shooter's tile; the arrow starts one tile on.
  for (const [d, dx, dy] of [
    ["ArrowsL", -32, 0],
    ["ArrowsR", 32, 0],
    ["ArrowsU", 0, -32],
    ["ArrowsD", 0, 32],
  ] as const) {
    if (lingoContains(eff, d)) {
      return { h: target.h + dx, v: target.v + dy };
    }
  }
  if (lingoEq(eff, "splash")) {
    return { h: target.h, v: target.v - 32 };
  }
  if (lingoEq(eff, "Slot Machine")) {
    return { h: caster.h, v: caster.v - 32 };
  }
  if (lingoEq(eff, "Music")) {
    return { h: caster.h, v: caster.v - 7 };
  }
  const off = FROM_CASTER[eff.toLowerCase()];
  if (off) {
    return { h: caster.h + off[0], v: caster.v + off[1] };
  }
  return null;
}

/**
 * The frame at which the FX script hides non-spell point FX (when the spell frame reaches n). Spell
 * runs read `lastFrame` and `projectile` from their spell data row via `fxRun`.
 */
const OTHER_LAST_FRAME: Record<string, number> = {
  sprinkle: 5,
  "slot machine": 52,
  fishing: 13,
  bsmith: 13,
  music: 30,
};

/** The edge tests for a moving sprite. */
function offEdge(fx: FxSprite, dh: number, dv: number, arrow: boolean): boolean {
  if (dh < 0) {
    return fx.h < 34;
  }
  if (dh > 0) {
    return fx.h > 550;
  }
  if (dv < 0) {
    return fx.v < 31;
  }
  return fx.v > (arrow ? 410 : 400);
}

/** A placed FX at frame 1 (a cannonball shot at its spin frame for where it is). */
export function newFx(name: string, at: { h: number; v: number }): FxSprite {
  const dir = cannonballDir(name);
  const frame = dir ? cannonballFrame(at.h, at.v, dir) : 1;
  return { name, frame, h: at.h, v: at.v, gone: false };
}

/** Whether a shot cannot pass over map tile (x, y): one an Airship cannot cross. */
export type ShotBlocked = (x: number, y: number) => boolean;

/**
 * One `stepFrame` of the spell FX script (an actor: two calls a frame). It runs only while the
 * sprite's vertical position is positive. The arrows' viewport intersection wait never fires:
 * sprite 1, the viewport mask, is an all-white bitmap in matte ink, whose matte is empty, so an
 * arrow flies on until its edge test hides it (measured on the running 1.6: gone within a frame of
 * its last position in all four directions; this replaces the earlier reading that it lingered 10
 * frames).
 */
export function stepFx(fx: FxSprite, blocked?: ShotBlocked): void {
  if (fx.gone || fx.v <= 0) {
    return;
  }
  const shot = cannonballDir(fx.name);
  if (shot) {
    const [dh, dv] = [shot[0] * CANNONBALL_STEP_PX, shot[1] * CANNONBALL_STEP_PX];
    fx.h += dh;
    fx.v += dv;
    fx.frame = cannonballFrame(fx.h, fx.v, shot);
    const t = cannonballTile(fx.h, fx.v);
    if (offEdge(fx, dh, dv, false) || blocked?.(t.x, t.y)) {
      fx.gone = true;
    }
    return;
  }
  const run = fxRun(fx.name);
  if (run) {
    if (run.lastFrame !== null) {
      if (fx.frame === run.lastFrame) {
        fx.gone = true; // locV = -5300
        return;
      }
      fx.frame += 1;
      return;
    }
    if (run.projectile) {
      const dh = run.projectile.axis === "locH" ? run.projectile.px : 0;
      const dv = run.projectile.axis === "locV" ? run.projectile.px : 0;
      fx.h += dh;
      fx.v += dv;
      if (offEdge(fx, dh, dv, false)) {
        fx.gone = true; // locV = -5000
      }
      fx.frame = fx.frame === 3 ? 1 : fx.frame + 1;
      return;
    }
    return;
  }
  const last = OTHER_LAST_FRAME[fx.name.toLowerCase()];
  if (last !== undefined) {
    if (fx.frame === last) {
      fx.gone = true; // locV = -5300
      return;
    }
    fx.frame += 1;
    return;
  }
  for (const [d, dh, dv] of [
    [" ArrowsL", -8, 0],
    [" ArrowsR", 8, 0],
    [" ArrowsU", 0, -8],
    [" ArrowsD", 0, 8],
  ] as const) {
    if (lingoContains(fx.name, d)) {
      fx.h += dh;
      fx.v += dv;
      if (offEdge(fx, dh, dv, true)) {
        fx.gone = true;
      }
      return;
    }
  }
  // An FX nothing describes any more (a publish removed the spell whose run it was) ends, rather
  // than standing on the map with its hit box for good.
  fx.gone = true;
}

/** A sprite rect from a member's `[w, h, regX, regY]` at a loc. */
export function spriteRect(
  r: readonly [number, number, number, number],
  h: number,
  v: number,
): { left: number; top: number; right: number; bottom: number } {
  const left = h - r[2];
  const top = v - r[3];
  return { left, top, right: left + r[0], bottom: top + r[1] };
}

/** Director `intersects` for unstretched ink-36 sprites: the bounding rects overlap. */
export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Trails (the FX sprite sender): follower `x<Spell>` members, by frames shown. */
export const TRAILS: Record<string, number> = {
  "smoke bomb": 15,
  firebolt: 16,
  hold: 7,
};

/** Trail frame count for `name` (mapped through `fxEffect`), or undefined. */
export function trailFrames(name: string): number | undefined {
  return TRAILS[fxEffect(name).toLowerCase()];
}
