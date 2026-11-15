/**
 * Monster roster slots.
 *
 * Each map has four roster slots (sprites 180-183; 1.6's fifth slot never spawned, a kept bug). A
 * slot holds at most one live monster. The state lives on the map and is saved to `map_slots`, so
 * monsters survive a restart and stay frozen while nobody is there.
 */
import { type Monster, monstersData } from "@secondstaronline/data";
import {
  type Dir,
  type Facing,
  inMonsterList,
  isFootprint,
  isWebBody,
  lingoContains,
  MONSTER_STEP_FRAMES,
  type MonsterView,
} from "@secondstaronline/shared";

export interface LiveMonster {
  name: string;
  hp: number;
  /** Logical tile: the destination as soon as a step starts. */
  x: number;
  y: number;
  facing: Facing;
  /** Frames left of the current 16-frame step. */
  anim: number;
  /** Where the current step started. */
  fromX: number;
  fromY: number;
  /** `M<k>Que`: the rest of the authored path. */
  queue: Dir[];
  /**
   * The spell-hit lockout: frames before a spell can hit it again; set to 16 by each spell hit, counted down
   * in its script, 0 when placed.
   */
  hitCountb: number;
}

export interface MonsterSlot {
  slot: number;
  /** The roster entry (the editor's placed species), or null for an empty slot. */
  species: string | null;
  live: LiveMonster | null;
  /** `M<k>Pause`, counted down once per frame. */
  pause: number;
  /** HP the last occupant had when it died; a species without an HP entry inherits it. */
  lastHp: number | null;
  /** Changed since the last save. */
  dirty: boolean;
  /** The tile the World Editor placed the roster entry on, shown again on LOAD. */
  home?: { x: number; y: number } | null;
}

const BY_NAME = new Map(monstersData.monsters.map((m) => [m.name.toLowerCase(), m]));

/** A species by name (comparison ignores case), or null when it is not in `mlists`. */
export function species(name: string): Monster | null {
  return BY_NAME.get(name.toLowerCase()) ?? null;
}

/**
 * The body a live name is drawn with: its species', else member "Generic"'s (body
 * 200) when the `mlists` field does not contain the name, as for a player shop's shopkeeper. A name
 * inside a listed one but equal to none finds no member (0; shopkeeper names avoid them).
 */
export function bodyOf(name: string): number {
  return species(name)?.body ?? (inMonsterList(name) ? 0 : monstersData.generic.body);
}

/** The defense a live name is hit with (line 3 of the monster's data). */
export function defenseOf(name: string): number {
  return species(name)?.defense ?? (inMonsterList(name) ? 0 : monstersData.generic.defense);
}

export { isFootprint, MONSTER_STEP_FRAMES };

/** The hostile (lean) test: the monster list contains the name. */
export function leansToward(name: string): boolean {
  return lingoContains(monstersData.editorLists.worldEditor.monsters.join("\r"), name);
}

/** The NPC list contains the name. */
export function isNpced(name: string): boolean {
  return lingoContains(monstersData.editorLists.npcEditor.npcs.join("\r"), name);
}

/** Bodies that never move: Spikes 90-, Web 92-, Holy Shield 99-. */
export function neverMoves(body: number): boolean {
  const s = `${body}-`;
  return lingoContains(s, "90-") || isWebBody(body) || lingoContains(s, "99-");
}

export function monsterView(s: MonsterSlot): MonsterView {
  const m = s.live;
  if (!m) {
    throw new Error(`slot ${s.slot} is empty`);
  }
  return {
    slot: s.slot,
    name: m.name,
    body: bodyOf(m.name),
    x: m.x,
    y: m.y,
    facing: m.facing,
    step: m.anim > 0 ? { fromX: m.fromX, fromY: m.fromY, frames: m.anim } : null,
  };
}
