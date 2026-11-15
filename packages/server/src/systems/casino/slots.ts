/**
 * The Slot Machine and the High Score Statue's table.
 *
 * The panel is `p.slot`: `null` closed, `spin` the ticks until a pull settles (0 idle). It keeps
 * across a map change, as 1.6's puppet sprites did, so Pull checks only that the panel is open and
 * idle.
 */
import {
  CHAT_COLOR,
  highScorePoints,
  lingoEq,
  rankEntry,
  SCORES_SIZE,
  SLOT_FX,
  SLOT_ITEM,
  SLOT_SPIN_FRAMES,
  SLOT_TEXT,
  slotOpenCheck,
  slotReels,
  slotSettle,
  submitsScore,
} from "@secondstaronline/shared";

import type { Rng } from "../../rng.ts";
import { queueCast } from "../spells/fx.ts";
import { playerLoc } from "../spells/geometry.ts";
import type { GroundItem, Outgoing, Player, Room, World } from "../world/world.ts";

const chat = (to: Player, text: string): Outgoing => ({
  to: to.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

const closed = (p: Player): Outgoing => ({ to: p.id, msg: { t: "slot", open: false } });

/**
 * The click or Ctrl on a machine: exits unless the name is exactly "Slot Machine" or while a casino
 * panel is up; a wrong spot prints the stand text; else the panel opens and the keys are locked
 * (1.6's client-side input lock).
 */
export function slotOpen(p: Player, machine: GroundItem): Outgoing[] {
  if (!lingoEq(machine.item, SLOT_ITEM) || p.slot !== null) {
    return [];
  }
  if (slotOpenCheck(p, machine) === "stand") {
    return [chat(p, SLOT_TEXT.stand)];
  }
  p.slot = { spin: 0 };
  p.keyLock = true;
  return [{ to: p.id, msg: { t: "slot", open: true } }];
}

/**
 * Pull: ignored unless the panel is open and idle (no position test, so it works on any map).
 * Short gold closes the panel and then prints the line; else the FX is queued at the player and the
 * 30-frame spin starts.
 */
export function slotPull(room: Room, p: Player): Outgoing[] {
  if (!p.slot || p.slot.spin > 0) {
    return [];
  }
  if (p.char.gold < 5) {
    p.slot = null;
    p.keyLock = false;
    return [closed(p), chat(p, SLOT_TEXT.poor)];
  }
  const me = playerLoc(p);
  queueCast(room, {
    owner: p.name,
    ownerId: p.id,
    name: SLOT_FX,
    casterH: me.h,
    casterV: me.v,
    h: me.h,
    v: me.v,
    power: 1,
  });
  p.slot.spin = SLOT_SPIN_FRAMES;
  return [{ to: p.id, msg: { t: "slotSpin" } }];
}

/** Close: ignored while a pull is settling; else the keys are free again. */
export function slotClose(p: Player): void {
  if (p.slot && p.slot.spin === 0) {
    p.slot = null;
    p.keyLock = false;
  }
}

/**
 * One tick of a pull: at 0 the server rolls the reels and settles in one gold change. Gold gone
 * since the pull charges nothing and reads as the not-enough-gold line.
 */
export function slotTick(rng: Rng, p: Player): Outgoing[] {
  if (!p.slot || p.slot.spin <= 0) {
    return [];
  }
  p.slot.spin -= 1;
  if (p.slot.spin > 0) {
    return [];
  }
  const reels = slotReels(rng);
  const r = slotSettle(p.char.gold, reels);
  if (!r.ok) {
    return [
      { to: p.id, msg: { t: "slotResult", reels: null, win: false } },
      chat(p, SLOT_TEXT.poor),
    ];
  }
  p.char.gold = r.gold;
  p.invDirty = true;
  return [
    { to: p.id, msg: { t: "slotResult", reels, win: r.win } },
    chat(p, r.win ? SLOT_TEXT.win : SLOT_TEXT.lose),
  ];
}

/**
 * The score send and the high-score check on a save tick: immortals and five-digit scores send
 * nothing; a ranked score replaces the table.
 */
export function submitHighScore(world: World, p: Player): void {
  const v = p.char.vitals;
  const points = highScorePoints(p.char.skills, v.hpMax, v.spMax);
  if (!submitsScore(points, p.role === "immortal")) {
    return;
  }
  const next = rankEntry(world.highScores, { id: p.id, name: p.name, points }, SCORES_SIZE);
  if (next) {
    world.highScores = next;
    world.highScoresDirty = true;
  }
}
