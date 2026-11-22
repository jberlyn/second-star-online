/**
 * Spell collision geometry: the original's sprite rects, evaluated once on the server instead of on
 * every client (a divergence). Sprite locs are stage pixels (shared/rules/spells/spellfx.ts
 * `tileLoc`); rects come from each member's size and registration point
 * (@secondstaronline/data/rects, from the cast manifest).
 */
import type { MemberRect } from "@secondstaronline/data/rects";
import {
  content,
  FACING_DELTA,
  type FxSprite,
  fxMember,
  PAPERDOLL_REG,
  PAPERDOLL_SIZE,
  spriteRect,
  stepLengthFor,
  stepOffsetPx,
  tileLoc,
  walkFrame,
} from "@secondstaronline/shared";

import { BODY, bodyOf, MONSTER_STEP_FRAMES, type MonsterSlot } from "../monsters/slots.ts";
import type { Player } from "../world/world.ts";

export type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * A body with no `Chars` bitmap (Stone Skull, Dragon, Overlord…) collides as a 32×32 box on its
 * tile (an assumption: the archive does not say): with the sprite loc at (x·32+14, y·32−3), reg
 * (16, −2) covers the tile exactly.
 */
export const FALLBACK_BODY_RECT: MemberRect = [32, 32, 16, -2];

export function fxRect(fx: Pick<FxSprite, "name" | "frame" | "h" | "v">): Rect | null {
  const r = content().rects.fx[fxMember(fx).toLowerCase()];
  return r ? spriteRect(r, fx.h, fx.v) : null;
}

/** Where a walker's sprite is: its step start plus the pixels walked toward `facing`. */
function walkerLoc(
  x: number,
  y: number,
  facing: keyof typeof FACING_DELTA,
  framesLeft: number,
  stepLength: number,
): { h: number; v: number } {
  const [dx, dy] = FACING_DELTA[facing];
  if (framesLeft <= 0) {
    return tileLoc(x, y);
  }
  const from = tileLoc(x - dx, y - dy);
  const moved = stepOffsetPx(framesLeft, stepLength);
  return { h: from.h + dx * moved, v: from.v + dy * moved };
}

/** The `locH`/`locV` of a player's sprite 112. */
export function playerLoc(p: Player): { h: number; v: number } {
  return walkerLoc(p.x, p.y, p.facing, p.stepFrames, stepLengthFor(p.vehicle));
}

/** The frame a standing Airship rider shows on a tick: F2, F3, F1. */
const RIDER_FRAMES = ["F2", "F3", "F1"] as const;

/**
 * A player's sprite rect: the paperdoll composite `SP112-F<n>-<dir>` (46×45, reg 25, 6), or after a
 * body change the `Chars` body member.
 */
export function playerRect(p: Player, tick = 0): Rect {
  const at = playerLoc(p);
  const body = p.spell.body;
  if (body !== null) {
    const len = stepLengthFor(p.vehicle);
    const frame =
      p.vehicle && p.stepFrames <= 0
        ? (RIDER_FRAMES[tick % 3] ?? "F2")
        : walkFrame(p.stepFrames, len);
    const r = content().rects.chars[`${body}-${frame}-${p.facing}`.toLowerCase()];
    if (r) {
      return spriteRect(r, at.h, at.v);
    }
  }
  return spriteRect(
    [PAPERDOLL_SIZE.w, PAPERDOLL_SIZE.h, PAPERDOLL_REG.x, PAPERDOLL_REG.y],
    at.h,
    at.v,
  );
}

/** A monster's sprite loc (sprites 180-183). */
export function monsterLoc(slot: MonsterSlot): { h: number; v: number } | null {
  const m = slot.live;
  if (!m) {
    return null;
  }
  if (m.anim > 0) {
    const [dx, dy] = FACING_DELTA[m.facing];
    const from = tileLoc(m.fromX, m.fromY);
    const moved = stepOffsetPx(m.anim, MONSTER_STEP_FRAMES);
    return { h: from.h + dx * moved, v: from.v + dy * moved };
  }
  return tileLoc(m.x, m.y);
}

/** A monster's sprite rect: its body member `<body>-F<n>-<dir>` placed by its regpoint. */
export function monsterRect(slot: MonsterSlot): Rect | null {
  const m = slot.live;
  const at = monsterLoc(slot);
  if (!m || !at) {
    return null;
  }
  const body = bodyOf(m.name);
  const member = `${body}-${walkFrame(m.anim, MONSTER_STEP_FRAMES)}-${m.facing}`;
  return spriteRect(content().rects.chars[member.toLowerCase()] ?? FALLBACK_BODY_RECT, at.h, at.v);
}

/** The member name a monster shows, for the body tests for names containing "61-". */
export function monsterMember(slot: MonsterSlot): string {
  const m = slot.live;
  const body = m ? bodyOf(m.name) : 0;
  return m ? `${body}-${walkFrame(m.anim, MONSTER_STEP_FRAMES)}-${m.facing}` : "";
}

/**
 * The Holy Shield test of `HitMe`/`HitMe2`: an innocent (`gnL = 0`) whose sprite 112 has exactly
 * the loc of a Holy Shield (body 99). The original tested the member name for "99-", which any
 * body ending in 99 would also pass; SSO compares the body (a bug fixed). Spells never test it.
 */
export function onHolyShield(p: Player, slots: readonly MonsterSlot[]): boolean {
  if (p.char.wanted) {
    return false;
  }
  const me = playerLoc(p);
  return slots.some((s) => {
    const at = monsterLoc(s);
    return (
      !!at &&
      s.live !== null &&
      bodyOf(s.live.name) === BODY.holyShield &&
      at.h === me.h &&
      at.v === me.v
    );
  });
}
