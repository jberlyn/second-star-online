/**
 * NPCs as world entities. An NPC is a roster species like any monster; what makes it an NPC is its
 * data file (1.6 kept one text file per NPC; the NPC file store is `npcfiles.ts`).
 */
import {
  addSlotFor,
  anyMatch,
  content,
  type DeltaEvent,
  FACING_DELTA,
  heardSqa,
  invAdd,
  lingoContains,
  monsterFlags,
  monsterLabel,
  type NpcFile,
  type Rng,
} from "@secondstaronline/shared";

import { hears } from "../chat/ignore.ts";
import type { Outgoing, Player, Room } from "../world/world.ts";
import { type NpcStore, npcData } from "./npcfiles.ts";
import type { MonsterSlot } from "./slots.ts";

export const NPC_TEXT = {
  /** Faction members and Strippers. */
  thisIs: (name: string) => `This is a ${name}.`,
  pigFull: "You are carrying too much to pick up the pig!",
  /** The offer line, as 1.6 words it: two spaces before "to". */
  offerGold: (n: number, name: string) => `*** Offering the ${n} gold to ${name}.`,
  /** The thanks line (1.6 left off the closing quote). */
  thanksGold: (name: string) => `${name} says "Thanks for the gold!"`,
} as const;

/** The pig countdown after a grab. */
export const PIG_GRAB_FRAMES = 500;

/**
 * The item the slot's monster is grabbed as (`flags.grabbable`; Classic: a Pig), or null. A bug
 * fixed: 1.6 asked whether the body's member name contained `"91-"`, so the Snow Demon's 891 ran
 * the Pig's click.
 */
const grabbedAs = (s: MonsterSlot): string | null =>
  s.live === null ? null : (monsterFlags(s.live.name).grabbable ?? null);

/** The file has something for the Bio window to show: lines, or a shop or trainer. */
export function hasBio(f: NpcFile): boolean {
  return (
    f.bio.length > 0 ||
    f.profile.length > 0 ||
    f.sells.length > 0 ||
    f.buys.length > 0 ||
    f.trains.length > 0
  );
}

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
  /** The monster grabbed into the bag (a Pig), for the activity log. */
  grabbed?: string;
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
 * A monster leaves its slot without a kill (`M<k>Cncl`): every client on the map hides it. Also
 * called on a kill. Nobody's pig countdown changes (a bug fixed: 1.6 set every player's to 20,
 * which cut short the 500 after a grab).
 */
export function cancelSlot(room: Room, slot: MonsterSlot): Outgoing[] {
  slot.live = null;
  slot.dirty = true;
  return toRoom(room, { e: "mgone", slot: slot.slot });
}

/**
 * Grabs a grabbable monster (Classic: a Pig) into the bag as its item: refused while the countdown
 * runs, or with no stack of that item and no free line; the countdown starts only when the grab
 * goes through (bugs fixed: 1.6 started it before the bag test, and a bag whose text contained
 * "Pig", even "Cooked Pig", skipped that test). The monster leaves (no kill, no XP, no loot).
 */
export function grabPig(room: Room, p: Player, slot: MonsterSlot, item: string, rng: Rng): NpcOut {
  if (p.piggie > 0) {
    return { out: [], slotsChanged: false };
  }
  if (addSlotFor(p.char.bag, item) < 0) {
    return { out: [say(p, NPC_TEXT.pigFull)], slotsChanged: false };
  }
  p.piggie = PIG_GRAB_FRAMES;
  const out = cancelSlot(room, slot);
  invAdd(p.char, item, 1, rng);
  p.invDirty = true;
  return { out, slotsChanged: true, grabbed: item };
}

/** Ctrl/Action on the faced tile: a grabbable monster only. */
export function ctrlPig(room: Room, p: Player, rng: Rng): NpcOut | null {
  const s = slotAt(room, p, 1);
  const item = s ? grabbedAs(s) : null;
  if (!s || item === null) {
    return null;
  }
  return grabPig(room, p, s, item, rng);
}

/** True when a dialog or the death lock holds the keys (1.6's client-side input lock). */
export function keyLocked(p: Player): boolean {
  return p.keyLock || p.loading > 0 || p.deadLock > 0;
}

/**
 * A click on a monster or NPC, in order: the input lock; a click on a grabbable monster (a Pig)
 * standing on your faced tile grabs it (a bug fixed: 1.6 grabbed whatever stood there, whichever
 * Pig you clicked); Faction members and Strippers name themselves; an unclickable species (Classic:
 * Spikes, Pig, Web and Holy Shield) does nothing; NPC data with nothing for a Bio (EMPTY, or only loot lines like a Slime's) does nothing
 * (a bug fixed: 1.6 opened an empty window); else the Bio window opens, from anywhere on the
 * screen (kept on purpose: NPCs walk), and holds the keys until it closes.
 */
export function clickNpc(room: Room, p: Player, slotNo: number, rng: Rng): NpcOut {
  const none = { out: [], slotsChanged: false };
  const slot = room.map.slots[slotNo - 1];
  const m = slot?.live;
  if (!slot || !m || keyLocked(p)) {
    return none;
  }
  const item = grabbedAs(slot);
  if (item !== null && slotAt(room, p, 1) === slot) {
    return grabPig(room, p, slot, item, rng);
  }
  if (anyMatch(content().monsters.rules.namesSelf, m.name)) {
    return { out: [say(p, NPC_TEXT.thisIs(monsterLabel(m.name)))], slotsChanged: false };
  }
  if (monsterFlags(m.name).unclickable === true) {
    return none;
  }
  const data = npcData(room.npcs, m.name);
  if (!data || !hasBio(data)) {
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
  return lingoContains(content().monsters.editorLists.worldEditor.monsters.join("\r"), name);
}

/**
 * RND chatter, once per tick for a live monster: a monster whose data has `RND|` lines among lines
 * 1-20 says one of them, at random, every `intervalTicks` (a bug fixed: 1.6 rolled on each
 * player's client against a player-count ladder that read a list nothing wrote, so the rate was
 * neither steady nor scaled). The countdown starts at a spawn and runs while players are on the
 * map. Returns the line, or null.
 */
export function chatterTick(
  npcs: NpcStore,
  slot: MonsterSlot,
  intervalTicks: number,
  rng: Rng,
): string | null {
  const m = slot.live;
  if (!m) {
    return null;
  }
  const lines = npcData(npcs, m.name)?.chatter ?? [];
  if (lines.length === 0) {
    return null;
  }
  m.chatIn = (m.chatIn ?? intervalTicks) - 1;
  if (m.chatIn > 0) {
    return null;
  }
  m.chatIn = intervalTicks;
  const line = lines[rng.random(lines.length) - 1] ?? "";
  return `${m.name} says "${line}"`;
}

/** An NPC chat line → `sqa` to the map, heard by each as ordinary chat. */
export function chatterOut(room: Room, text: string, from?: string, ambient = false): Outgoing[] {
  // `from`: the player whose client sent the line (Radar, Inxition), whose ignorers miss it.
  // `ambient`: an NPC's periodic `RND|` chatter, skipped for players who hid NPC chatter.
  return room.players
    .filter((o) => (from === undefined || hears(o, from)) && (!ambient || o.prefs.showNpcChatter))
    .map((o) => ({
      to: o.id,
      msg: { t: "chat", text: heardSqa(text, o.map.name, o.y), color: 0 },
    }));
}
