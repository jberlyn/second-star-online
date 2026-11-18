/**
 * NPCs as world entities. An NPC is a roster species like any monster; what makes it an NPC is its
 * data file (1.6 kept one text file per NPC; the NPC file store is `npcfiles.ts`).
 */
import { monstersData } from "@secondstaronline/data";
import {
  anyMatch,
  bagText,
  type DeltaEvent,
  FACING_DELTA,
  filledLines,
  heardSqa,
  invAdd,
  lingoContains,
  type Rng,
} from "@secondstaronline/shared";

import { hears } from "../chat/ignore.ts";
import type { Outgoing, Player, Room } from "../world/world.ts";
import { type NpcStore, npcData } from "./npcfiles.ts";
import { bodyOf, leansToward, type MonsterSlot } from "./slots.ts";

export const NPC_TEXT = {
  /** Faction members and Strippers. */
  thisIs: (name: string) => `This is a ${name}.`,
  pigFull: "You are carrying too much to pick up the pig!",
  /** The offer line, as 1.6 words it: two spaces before "to". */
  offerGold: (n: number, name: string) => `*** Offering the ${n} gold to ${name}.`,
  /** The thanks line (1.6 left off the closing quote). */
  thanksGold: (name: string) => `${name} says "Thanks for the gold!"`,
} as const;

/** The pig countdown after a grab and after any `M<k>Cncl` arrives. */
export const PIG_GRAB_FRAMES = 500;
export const PIG_CNCL_FRAMES = 20;

/** The body's member-name prefix test (the frame name contains `91-`). */
const bodyHas = (s: MonsterSlot, prefix: string) =>
  lingoContains(`${s.live ? bodyOf(s.live.name) : 0}-`, prefix);

/** The tile `n` steps ahead of `p`. */
function ahead(p: Player, n: number): { x: number; y: number } {
  const [dx, dy] = FACING_DELTA[p.facing];
  return { x: p.x + n * dx, y: p.y + n * dy };
}

/**
 * The first slot (180-183 order) whose sprite stands exactly on the tile `n` ahead. Sprites are
 * compared by pixel, so a monster or player mid-step never matches.
 */
function slotAt(room: Room, p: Player, n: number): MonsterSlot | null {
  if (p.stepFrames > 0) {
    return null;
  }
  const t = ahead(p, n);
  return (
    room.map.slots.find(
      (s) => s.live && s.live.anim === 0 && s.live.x === t.x && s.live.y === t.y,
    ) ?? null
  );
}

export interface NpcOut {
  out: Outgoing[];
  /** A slot was emptied: write the map's slots. */
  slotsChanged: boolean;
}

const say = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

/** Everyone on the map gets `ev`. */
function toRoom(room: Room, ev: DeltaEvent): Outgoing[] {
  return room.players.map((o) => ({ to: o.id, msg: { t: "delta", events: [ev] } }));
}

/**
 * A monster leaves its slot without a kill (`M<k>Cncl`): every client on the map hides it and sets
 * starts its pig countdown at 20. Also called on a kill.
 */
export function cancelSlot(room: Room, slot: MonsterSlot): Outgoing[] {
  slot.live = null;
  slot.dirty = true;
  for (const o of room.players) {
    o.piggie = PIG_CNCL_FRAMES;
  }
  return toRoom(room, { e: "mgone", slot: slot.slot });
}

/**
 * Grabs a pig: the cooldown is set before the bag test; a bag whose text contains "Pig" (even
 * "Cooked Pig") skips the 15-line test. The monster leaves (no kill, no XP, no loot) and the
 * server's `itremovv "Pig"` adds a Pig.
 */
export function grabPig(room: Room, p: Player, slot: MonsterSlot, rng: Rng): NpcOut {
  if (p.piggie > 0) {
    return { out: [], slotsChanged: false };
  }
  p.piggie = PIG_GRAB_FRAMES;
  const text = bagText(p.char.bag);
  if (!lingoContains(text, "Pig") && filledLines(p.char.bag) > 14) {
    return { out: [say(p, NPC_TEXT.pigFull)], slotsChanged: false };
  }
  const out = cancelSlot(room, slot);
  // When the bag has no room 1.6's go-ahead flag stays unset (the archive does not say; the
  // client's pre-check is taken to govern) and the add then adds nothing; the pig is gone all the
  // same.
  const r = invAdd(p.char, "Pig", 1, rng);
  if (r.kind !== "full") {
    p.invDirty = true;
  }
  return { out, slotsChanged: true };
}

/** Ctrl/Action on the faced tile: a Pig or Snow Demon body only. */
export function ctrlPig(room: Room, p: Player, rng: Rng): NpcOut | null {
  const s = slotAt(room, p, 1);
  if (!s || !bodyHas(s, "91-")) {
    return null;
  }
  return grabPig(room, p, s, rng);
}

/** True when a dialog or the death lock holds the keys (1.6's client-side input lock). */
export function keyLocked(p: Player): boolean {
  return p.keyLock || p.loading > 0 || p.deadLock > 0;
}

/**
 * A click on a monster or NPC, in order: the input lock; a click on any Pig or Snow Demon body
 * grabs whatever stands on your faced tile (a kept 1.6 bug); Faction members and Strippers name
 * themselves; Spikes, Pig, Web and Holy Shield bodies do nothing; EMPTY NPC data does nothing; else
 * the Bio window opens, with no range check, and holds the keys until it closes.
 */
export function clickNpc(room: Room, p: Player, slotNo: number, rng: Rng): NpcOut {
  const none = { out: [], slotsChanged: false };
  const slot = room.map.slots[slotNo - 1];
  const m = slot?.live;
  if (!slot || !m || keyLocked(p)) {
    return none;
  }
  if (bodyHas(slot, "91-")) {
    const target = slotAt(room, p, 1);
    if (target) {
      return grabPig(room, p, target, rng);
    }
  }
  if (anyMatch(monstersData.rules.namesSelf, m.name)) {
    return { out: [say(p, NPC_TEXT.thisIs(m.name))], slotsChanged: false };
  }
  if (["90-", "91-", "92-", "99-"].some((b) => bodyHas(slot, b))) {
    return none;
  }
  const data = npcData(room.npcs, m.name);
  if (!data) {
    return none;
  }
  p.bio = { slot: slotNo, npc: m.name };
  p.keyLock = true;
  return {
    out: [
      {
        to: p.id,
        msg: {
          t: "bio",
          name: m.name,
          bio: [...data.bio],
          profile: [...data.profile],
          buy: data.sells.length > 0,
          sell: data.buys.length > 0,
          train: data.trains.length > 0,
        },
      },
    ],
    slotsChanged: false,
  };
}

/** The Bio window closed: closing it releases the input lock. */
export function closeBio(p: Player): void {
  if (p.bio) {
    p.keyLock = false;
  }
  p.bio = null;
}

/**
 * The gold dialog's NPC branch: the first slot standing on the faced tile, then two tiles ahead.
 * Names in the World Editor's `MONSTER` list (`contains`, so "Dragon" too) exit silently. Returns
 * null when no slot stands there.
 */
export function goldTarget(room: Room, p: Player): MonsterSlot | null {
  return slotAt(room, p, 1) ?? slotAt(room, p, 2);
}

/** The `MONSTER` field `contains` the name. */
export function inMonsterList(name: string): boolean {
  return leansToward(name);
}

/**
 * RND chatter, one client's roll for one slot on stage: `random(15) = 1` for any slot whose data
 * is loaded (EMPTY is not VOID), then, when the data has `RND|` lines among lines 1-20, the
 * user-list ladder. Its unqualified user-list field is castLib 1's copy, which nothing
 * in play writes ("King" and a return), so all six draws are taken and the last, `random(400)`,
 * decides, whatever the player count (a kept 1.6 bug). A hit picks a line with
 * `random(RNDCNT)`. Returns the line, or null.
 */
export function chatterRoll(npcs: NpcStore, slot: MonsterSlot, rng: Rng): string | null {
  const m = slot.live;
  if (!m) {
    return null;
  }
  if (rng.random(15) !== 1) {
    return null;
  }
  const lines = npcData(npcs, m.name)?.chatter ?? [];
  if (lines.length === 0) {
    return null;
  }
  let r = 0;
  for (const n of [12000, 12000, 6000, 3000, 900, 400]) {
    r = rng.random(n);
  }
  if (r !== 1) {
    return null;
  }
  const line = lines[rng.random(lines.length) - 1] ?? "";
  return `${m.name} says "${line}"`;
}

/** An NPC chat line → `sqa` to the map, heard by each as ordinary chat. */
export function chatterOut(room: Room, text: string, from?: string): Outgoing[] {
  // `from`: the player whose client sent the line (Radar, Inxition), whose ignorers miss it.
  return room.players
    .filter((o) => from === undefined || hears(o, from))
    .map((o) => ({
      to: o.id,
      msg: { t: "chat", text: heardSqa(text, o.map.name, o.y), color: 0 },
    }));
}
