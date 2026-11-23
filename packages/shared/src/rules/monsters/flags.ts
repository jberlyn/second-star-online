/**
 * Species flags (monsters.json `flags`): the engine mechanics 1.6 tied to a body number, read by
 * species instead. 1.6 tested the body's member name for text such as `"92-"`, so any body ending
 * in those digits (192, 892, …) took the mechanic too; SSO reads the flag (a bug fixed).
 */
import type { MonsterFlags } from "@secondstaronline/data";

import { content } from "../../content/store.ts";
import { lingoEq } from "../core/lingo.ts";

const NO_FLAGS: MonsterFlags = {};

/** A live name's flags: its species', or none (a name off the monster list, a shopkeeper). */
export function monsterFlags(name: string): MonsterFlags {
  return content().monster(name)?.flags ?? NO_FLAGS;
}

/** The species never walks. */
export function isImmobile(name: string): boolean {
  return monsterFlags(name).immobile === true;
}

/** The species holds a player standing on its tile, and never attacks (Classic: Web). */
export function isTrap(name: string): boolean {
  return monsterFlags(name).trap === true;
}

/** The species is in a flag's list of spell effects (`healedBy`, `resists`). */
export function flagHasEffect(list: readonly string[] | undefined, effect: string): boolean {
  return list?.some((e) => lingoEq(e, effect)) ?? false;
}
