/**
 * The spell counters of the frame script, each run where 1.6 runs it: Smoke Bomb before the
 * collision test; the morph counter after hunger; Hold and Stone Skin before the Argon's Fist
 * counter; Firesword and Magic Shield after it.
 */
import { type DeltaEvent, EFFECT_TEXT } from "@secondstaronline/shared";

import type { Player, Room } from "../world/world.ts";
import { setBody } from "./collide.ts";
import { queueCast } from "./fx.ts";
import { playerLoc } from "./geometry.ts";

/**
 * Smoke Bomb's countdown: at 0 the smoke puff (always `xSmokeoBomb`) is cast 15 px below you at
 * power 1, in a vehicle too, then the body reverts (sent twice in 1.6; the second changes nothing).
 */
export function smokeBombStep(room: Room, p: Player, res: { events: DeltaEvent[] }): void {
  const s = p.spell;
  if (s.smokeBomb <= 0) {
    return;
  }
  s.smokeBomb -= 1;
  if (s.smokeBomb === 0) {
    const me = playerLoc(p);
    queueCast(room, {
      owner: p.name,
      ownerId: p.id,
      name: "xSmokeoBomb",
      casterH: me.h,
      casterV: me.v + 15,
      h: me.h,
      v: me.v + 15,
      power: 1,
    });
    // Being in a vehicle is the revert's only guard: aboard it is skipped.
    if (!p.vehicle) {
      setBody(p, null, res);
    }
  }
}

/**
 * The morph counter: at 0 the body reverts (no vehicle). A revert from Dispel Illusions or Smoke
 * Bomb leaves the counter running, so a second, redundant revert follows.
 */
export function morphStep(p: Player, res: { events: DeltaEvent[] }): void {
  const s = p.spell;
  if (s.morph <= 0) {
    return;
  }
  s.morph -= 1;
  if (s.morph === 0 && !p.vehicle) {
    setBody(p, null, res);
  }
}

/** Hold and Stone Skin, before the Argon's Fist counter. */
export function holdDefenseStep(p: Player, tell: (text: string) => void): void {
  const s = p.spell;
  if (s.hold > 0) {
    s.hold -= 1;
  }
  if (s.defenseCounter > 0) {
    s.defenseCounter -= 1;
    if (s.defenseCounter === 0) {
      tell(EFFECT_TEXT.stoneSkinEnds);
      p.defenseBonus = 0;
    }
  }
}

/** Firesword and Magic Shield, after the Argon's Fist counter. */
export function swordShieldStep(p: Player, tell: (text: string) => void): void {
  const s = p.spell;
  if (s.fireSword > 0) {
    s.fireSword -= 1;
    if (s.fireSword === 0) {
      tell(EFFECT_TEXT.fireswordEnds);
    }
  }
  if (s.magicDef > 0) {
    s.magicDef -= 1;
    if (s.magicDef === 0) {
      tell(EFFECT_TEXT.magicShieldEnds);
    }
  }
}

/** The monster-spell block counts down once per frame. */
export function npcSpellBlockStep(p: Player): void {
  if (p.spell.npcSpellBlock > 0) {
    p.spell.npcSpellBlock -= 1;
  }
}
