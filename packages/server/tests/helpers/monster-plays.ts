/**
 * What a monster plays, through the game's own readers: the monster golden (issue #31 stage 0) and
 * the monster resolver's round trip use it.
 */
import { classicData } from "@secondstaronline/data/classic";
import {
  anyMatch,
  content,
  firstMatch,
  inMonsterList,
  isFootprint,
  meleeDamageVsMonster,
  meleeKillXp,
  monsterSkillCap,
  NO_EQUIPMENT,
  type Rng,
} from "@secondstaronline/shared";

import {
  bodyOf,
  defenseOf,
  isNpced,
  leansToward,
  neverMoves,
  species,
} from "../../src/systems/monsters/slots.ts";

/** A random source that rolls `at` ("low": 1; "high": each draw's n) and records each draw's n. */
export function recorder(at: "low" | "high" | ((n: number, i: number) => number)): Rng & {
  draws: number[];
} {
  const draws: number[] = [];
  return {
    draws,
    random(n: number) {
      draws.push(n);
      if (!(n >= 1)) {
        return 0;
      }
      return at === "low" ? 1 : at === "high" ? n : at(n, draws.length - 1);
    },
  };
}

/** Every name the golden asks about, sorted, once each (case kept as first seen). */
export function names(): string[] {
  const m = classicData.monsters;
  const all = [
    ...m.monsters.map((s) => s.name),
    ...m.editorLists.worldEditor.monsters,
    ...m.editorLists.worldEditor.npcs,
    ...m.editorLists.npcEditor.monsters,
    ...m.editorLists.npcEditor.npcs,
    ...Object.values(m.rules).flatMap((rows) => rows.map((r) => r.pattern)),
    ...m.casting.neverCasts.map((r) => r.pattern),
    ...m.meleeAffinities.map((a) => a.monster),
    ...classicData.npcFiles.files.map((f) => f.name),
    "Nobody Knows This One",
    "",
  ];
  const seen = new Map<string, string>();
  for (const n of all) {
    if (!seen.has(n.toLowerCase())) {
      seen.set(n.toLowerCase(), n);
    }
  }
  return [...seen.values()].sort();
}

/** Each monster rule's answer for a name, as the game's readers give it. */
export function rules(name: string) {
  const r = content().monsters.rules;
  return {
    sea: anyMatch(r.sea, name),
    footprint: isFootprint(name),
    hostile: anyMatch(r.hostile, name),
    leans: leansToward(name),
    officer: anyMatch(r.officer, name),
    sparesInnocent: anyMatch(r.sparesInnocent, name),
    clearsBlock: anyMatch(r.clearsBlock, name),
    namesSelf: anyMatch(r.namesSelf, name),
    noQuests: anyMatch(r.noQuests, name),
    neverCasts: anyMatch(content().monsters.casting.neverCasts, name),
    killXp: firstMatch(r.killXp, name)?.xp ?? null,
    killBroadcast: firstMatch(r.killBroadcasts, name)?.text ?? null,
    inMonsterList: inMonsterList(name),
    npced: isNpced(name),
    neverMoves: neverMoves(name),
    body: bodyOf(name),
    defense: defenseOf(name),
  };
}

/** The weapons swung: an item of each family an affinity row names, a plain sword, bare hands. */
export function weapons(): string[] {
  const items = classicData.items.items.map((i) => i.name);
  const out = new Set<string>(["Long Sword", "Nothing"]);
  for (const a of classicData.monsters.meleeAffinities) {
    const hit = items.find((i) => i.toLowerCase().includes(a.weapon.toLowerCase()));
    out.add(hit ?? a.weapon);
  }
  return [...out].sort();
}

/** Melee damage on a species: `power|weapon → low|high|draws` for each weapon and power. */
export function damage(name: string, defense: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of weapons()) {
    for (const power of [3, 40]) {
      const lo = recorder("low");
      const hi = recorder("high");
      const a = meleeDamageVsMonster(power, { name, defense }, w, lo);
      const b = meleeDamageVsMonster(power, { name, defense }, w, hi);
      out[`${power}|${w}`] = `${a}|${b}|${lo.draws.join(",")}`;
    }
  }
  return out;
}

export const INTELLIGENCE = [0, 10, 11, 15, 16, 20, 21, 25, 26, 30, 31, 50, 100];

/**
 * What a name plays from the monster tables, as a live monster of that name: its rules, the melee
 * damage it takes, the kill skill cap and the kill XP, each with the fallbacks the melee path uses
 * for a name no species has (its defense as `defenseOf` gives it, body 0 for the cap, 30 XP).
 */
export function plays(name: string) {
  const sp = species(name);
  const ring = { ...NO_EQUIPMENT, ring: "Ring of Experience" };
  const xp = sp?.xpMelee ?? 30;
  return {
    rules: rules(name),
    damage: damage(name, defenseOf(name)),
    skillCap: INTELLIGENCE.map((i) => monsterSkillCap(sp?.body ?? 0, i, name)),
    killXp: [meleeKillXp(xp, name, NO_EQUIPMENT), meleeKillXp(xp, name, ring)],
  };
}

/**
 * The raw spellings a live name can come in: another case, spaces round it, and a suffix after it,
 * so the round trip tests each table's own name rule.
 */
export function spellings(name: string): string[] {
  return [name.toLowerCase(), name.toUpperCase(), ` ${name} `, `${name}#2`, `${name} 2`];
}
