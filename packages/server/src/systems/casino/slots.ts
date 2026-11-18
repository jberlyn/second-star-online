/**
 * The Slot Machine.
 *
 * The panel is `p.slot`: `null` closed, `spin` the ticks until a pull settles (0 idle). A map
 * change closes the panel, and a pull requires standing in front of a slot machine on the map.
 */
import {
  CHAT_COLOR,
  isSlotMachine,
  SLOT_COST,
  SLOT_FX,
  SLOT_SPIN_FRAMES,
  SLOT_TEXT,
  slotOpenCheck,
  slotReels,
  slotSettle,
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
 * The click or Ctrl on a machine: exits unless the name contains "Slot Machine" or while a casino
 * panel is up; a wrong spot prints the stand text; else the panel opens and the keys are locked
 * (1.6's client-side input lock).
 */
export function slotOpen(p: Player, machine: GroundItem): Outgoing[] {
  if (!isSlotMachine(machine.item) || p.slot !== null) {
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
 * Pull: ignored unless the panel is open and idle; closes the panel if not in front of a slot
 * machine. Short gold returns the lever and prints the line without closing the panel; else the FX
 * is queued at the player and the 30-frame spin starts.
 */
export function slotPull(room: Room, p: Player): Outgoing[] {
  if (!p.slot || p.slot.spin > 0) {
    return [];
  }
  const atMachine = room.map.ground.some(
    (g) => isSlotMachine(g.item) && slotOpenCheck(p, g) === "open",
  );
  if (!atMachine) {
    p.slot = null;
    p.keyLock = false;
    return [closed(p)];
  }
  if (p.char.gold < SLOT_COST) {
    return [
      { to: p.id, msg: { t: "slotResult", reels: null, win: false } },
      chat(p, SLOT_TEXT.poor),
    ];
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

/** Closes an open slot panel on map change. */
export function slotMapLeave(p: Player): Outgoing[] {
  if (p.slot === null) {
    return [];
  }
  p.slot = null;
  p.keyLock = false;
  return [closed(p)];
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
