/**
 * Monster roster slots.
 *
 * Each map has four roster slots (sprites 180-183; 1.6's fifth slot never spawned, kept on
 * purpose). A slot holds at most one live monster. The state lives on the map and is saved to
 * `map_slots`, so monsters survive a restart and stay frozen while nobody is there.
 */
import type { Monster } from "@secondstaronline/data";
import {
  anyMatch,
  content,
  type Dir,
  type Facing,
  inMonsterList,
  isFootprint,
  isImmobile,
  lingoContains,
  MONSTER_STEP_FRAMES,
  type MonsterView,
  onContent,
  shownMonsterLevel,
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
  /** `M<k>Que`: the rest of a random walk. */
  queue: Dir[];
  /**
   * A hostile walk: the player it chases and the steps left. Each step's direction is picked when
   * the step starts, from where that player stands then.
   */
  chase?: { id: string; steps: number } | null;
  /** Ticks until its next RND chatter line; unset until it first counts. */
  chatIn?: number;
  /**
   * The spell-hit lockout: frames before a spell can hit it again; set to 16 by each spell hit, counted down
   * in its script, 0 when placed.
   */
  hitCountb: number;
  /** The FX hit frame that last set the lockout (runtime only, never saved). */
  lockedBy?: { fx: object; member: string } | null;
}

export interface MonsterSlot {
  slot: number;
  /** The roster entry (the editor's placed species), or null for an empty slot. */
  species: string | null;
  live: LiveMonster | null;
  /** `M<k>Pause`, counted down once per frame. */
  pause: number;
  /** Changed since the last save. */
  dirty: boolean;
  /** The tile the World Editor placed the roster entry on, shown again on LOAD. */
  home?: { x: number; y: number } | null;
}

/** A species by name (comparison ignores case), or null when it is not in `mlists`. */
export function species(name: string): Monster | null {
  return content().monster(name) ?? null;
}

/**
 * The body a live name is drawn with: its species', else member "Generic"'s (body
 * 200) when the `mlists` field does not contain the name, as for a player shop's shopkeeper. A name
 * inside a listed one but equal to none finds no member (0; shopkeeper names avoid them).
 */
export function bodyOf(name: string): number {
  return species(name)?.body ?? (inMonsterList(name) ? 0 : content().monsters.generic.body);
}

/** The defense a live name is hit with (line 3 of the monster's data). */
export function defenseOf(name: string): number {
  return species(name)?.defense ?? (inMonsterList(name) ? 0 : content().monsters.generic.defense);
}

export { isFootprint, MONSTER_STEP_FRAMES };

let HOSTILE = new Set<string>();
onContent((c) => {
  HOSTILE = new Set(c.monsters.editorLists.worldEditor.monsters.map((n) => n.toLowerCase()));
});

/**
 * The hostile (lean) test: the name is an entry of the World Editor's monster list, or matches
 * `rules.hostile` (a bug fixed: 1.6 asked whether the list's text contained the name, so "Dragon"
 * leaned through "Dragon Hatchling" and the Overlord, on no list, wandered).
 */
export function leansToward(name: string): boolean {
  return HOSTILE.has(name.toLowerCase()) || anyMatch(content().monsters.rules.hostile, name);
}

/** The NPC list contains the name. */
export function isNpced(name: string): boolean {
  return lingoContains(content().monsters.editorLists.npcEditor.npcs.join("\r"), name);
}

/** The species never walks (`flags.immobile`; Classic: Spikes, Web and Holy Shield). */
export function neverMoves(name: string): boolean {
  return isImmobile(name);
}

export function monsterView(s: MonsterSlot): MonsterView {
  const m = s.live;
  if (!m) {
    throw new Error(`slot ${s.slot} is empty`);
  }
  const level = shownMonsterLevel(m.name);
  return {
    slot: s.slot,
    name: m.name,
    ...(level === undefined ? {} : { level }),
    body: bodyOf(m.name),
    x: m.x,
    y: m.y,
    facing: m.facing,
    step: m.anim > 0 ? { fromX: m.fromX, fromY: m.fromY, frames: m.anim } : null,
  };
}
