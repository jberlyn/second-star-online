/**
 * Factions and the murder flag. Pure rules over the generated `socialData`.
 */
import { type FactionRow, socialData } from "@secondstaronline/data";

import type { Faction } from "../core/fighter.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";

/** `Fctnme`: 0 none, 1 Mage, 2 Warrior, 3 Adventurer. */
export type FactionId = 0 | 1 | 2 | 3;

/** Mage, Warrior and Adventurer power (`factions.txt`). */
export type Powers = [number, number, number];

/** The membership a character keeps: `Fctnme:Fctcnt`, sheet item 5. */
export interface Membership {
  id: FactionId;
  /** `Fctcnt`: frames of play left. */
  count: number;
}

export const NO_MEMBERSHIP: Membership = { id: 0, count: 0 };

/** A stored `Fctnme` as a faction id; anything but 1-3 is none. */
export function factionIdOf(n: number): FactionId {
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

/** The archive's powers, `27:123:0`. */
export const ARCHIVED_POWERS: Powers = parsePowers(socialData.factionRules.powers.archived);

/**
 * Parse the selected colon-separated faction value as an integer; missing or invalid values are 0.
 */
export function parsePowers(text: string): Powers {
  const n = (s: string | undefined) => {
    const v = Number.parseInt(s ?? "", 10);
    return Number.isNaN(v) ? 0 : v;
  };
  const items = text.split(":");
  return [n(items[0]), n(items[1]), n(items[2])];
}

/** One faction's row (the generated social data's `factions`). */
export function factionRow(id: 1 | 2 | 3): FactionRow {
  const row = socialData.factions.find((f) => f.id === id);
  if (!row) {
    throw new Error(`no faction ${id}`);
  }
  return row;
}

/** One faction's power (1 Mage, 2 Warrior, 3 Adventurer). */
function power(p: Powers, id: 1 | 2 | 3): number {
  return p[id - 1] ?? 0;
}

/** The faction whose leader is `npc` (case-insensitive comparison), or null. */
export function leaderFaction(npc: string): FactionRow | null {
  return socialData.factions.find((f) => lingoEq(f.leader, npc)) ?? null;
}

/**
 * The faction sort: only your own faction's bonus is set, by a cascade where the last true branch
 * wins: < 90 → 9, < 80 → 8 … < 10 → 1, < 5 → 0, so 80 or more gives 9. 1.6 started the cascade at
 * < 200 → 9 and left 0 when nothing matched, so 200 or more gave 0 (a bug fixed: it gives 9).
 */
export function factionBonus(power: number): number {
  let b = 9;
  const steps: [number, number][] = [
    [90, 9],
    [80, 8],
    [70, 7],
    [60, 6],
    [50, 5],
    [40, 4],
    [30, 3],
    [20, 2],
    [10, 1],
    [5, 0],
  ];
  for (const [below, bonus] of steps) {
    if (power < below) {
      b = bonus;
    }
  }
  return b;
}

/** The `Faction` the combat rules read: the membership with the faction sort's bonuses. */
export function sortFaction(id: FactionId, powers: Powers): Faction {
  const f: Faction = { id, f1Bonus: 0, f2Bonus: 0, f3Bonus: 0 };
  if (id === 1) {
    f.f1Bonus = factionBonus(powers[0]);
  }
  if (id === 2) {
    f.f2Bonus = factionBonus(powers[1]);
  }
  if (id === 3) {
    f.f3Bonus = factionBonus(powers[2]);
  }
  return f;
}

const fill = (text: string, values: { NAME?: string; NPC?: string; ITEM?: string }) =>
  text.replace(/\{(NAME|NPC|ITEM)\}/g, (_m, k: "NAME" | "NPC" | "ITEM") => values[k] ?? "");

/**
 * The head a dying member drops: its own faction's, on a map whose PvP flag is X (`DeathPenalty`),
 * whatever killed it. Null otherwise.
 */
export function deathHead(id: FactionId, pvpX: boolean): string | null {
  if (id === 0 || !pvpX) {
    return null;
  }
  return factionRow(id).head;
}

/**
 * The exile check after the death penalty, on the new HPmax: below the faction's line, the
 * membership ends with its text (and so the faction channel, which is the faction's members). A
 * faction never takes a joiner below its own exile line, so a fresh member is not exiled at its
 * next death.
 */
export function exileAtDeath(m: Membership, hpMax: number): string | null {
  if (m.id === 0) {
    return null;
  }
  const row = factionRow(m.id);
  return hpMax < row.exileHpMaxBelow ? row.exileText : null;
}

export interface LoyaltyStep {
  count: number;
  /** A warning or the kick line, printed to the member. */
  text: string | null;
  /** The membership ended (`Fctcnt = 1`). */
  kicked: boolean;
}

/**
 * One frame of the faction-loyalty countdown (`loyaltyStep`), run while `Fctcnt > 0`: count − 1
 * (floored at 0); exactly 20000, 10000 and 5000 warn; exactly 1 kicks.
 */
export function loyaltyStep(m: Membership): LoyaltyStep {
  const count = Math.max(0, m.count - 1);
  if (m.id === 0) {
    return { count, text: null, kicked: false };
  }
  const hit = factionRow(m.id).loyalty.find((l) => l.count === count);
  if (!hit) {
    return { count, text: null, kicked: false };
  }
  return { count: hit.kick ? 0 : count, text: hit.text, kicked: hit.kick };
}

export interface JoinResult {
  membership: Membership;
  /** Said to the joiner alone (chat line). */
  line: string;
  /** To the leader's faction channel as `sqa`, or null. */
  announce: string | null;
}

/**
 * Whether `leader`'s faction would take this membership: anyone already in it, or someone in no
 * faction with `HPmax` above its join line. A member of another faction, or one too weak, is
 * refused before anything is handed over.
 */
export function joinRefusal(m: Membership, leader: 1 | 2 | 3, hpMax: number): string | null {
  const row = factionRow(leader);
  if (m.id === leader) {
    return null;
  }
  if (m.id !== 0) {
    return row.texts.other;
  }
  return hpMax > row.joinHpMaxAbove ? null : row.texts.weak;
}

/**
 * The three faction-join routines (`joinFaction`) for a head turned in to `leader`'s faction: not
 * in a faction and above the join line (49, Warriors 59) joins with 212000 frames; too weak is
 * refused; the same faction adds 212000 with no HP check; another faction changes nothing but still
 * announces (with "Mage's" for the Mages). The server asks `joinRefusal` first, so the last two
 * refusals are never reached by a hand-in.
 */
export function joinFaction(
  m: Membership,
  leader: 1 | 2 | 3,
  hpMax: number,
  me: string,
): JoinResult {
  const row = factionRow(leader);
  const t = row.texts;
  if (m.id === 0) {
    if (hpMax > row.joinHpMaxAbove) {
      return {
        membership: { id: leader, count: row.joinCount },
        line: t.join,
        announce: fill(t.announce, { NAME: me }),
      };
    }
    return { membership: m, line: t.weak, announce: null };
  }
  if (m.id === leader) {
    return {
      membership: { id: leader, count: m.count + row.rejoinAdds },
      line: t.rejoin,
      announce: fill(t.announce, { NAME: me }),
    };
  }
  return { membership: m, line: t.other, announce: fill(t.announceOther, { NAME: me }) };
}

export type HeadTurnIn =
  /** Not a head given to a leader: the quest lines decide. */
  | { kind: "notHead" }
  /** The leader's own faction's head: consumed for nothing. */
  | { kind: "own"; line: string }
  /** A rival head: the power moves (when the rival has any), then the join. */
  | { kind: "rival"; line: string; powers: Powers; leader: 1 | 2 | 3; join: boolean };

/**
 * The faction branch of `QuestGive`, after the head is taken: an item containing " Head" given to
 * Angela, Trianus or Corin. A head whose name contains the leader's own faction word ("Mage's" for
 * Angela) is wasted; any other moves 1 power from the rival to the leader's faction if the rival is
 * above 0. Names compare ignoring case (`adventurer's Head`).
 */
export function headTurnIn(npc: string, item: string, powers: Powers): HeadTurnIn {
  const row = leaderFaction(npc);
  if (!row || !lingoContains(item, " Head")) {
    return { kind: "notHead" };
  }
  const word = (id: number) => `${factionRow(id as 1 | 2 | 3).name}'s`;
  const r = socialData.factionRules.turnIn;
  if (lingoContains(item, word(row.id))) {
    return { kind: "own", line: fill(r.ownHead, { NPC: npc }) };
  }
  const next: Powers = [...powers];
  // The join message goes with each rival word the head contains.
  let join = false;
  for (const rival of [1, 2, 3] as const) {
    if (rival === row.id || !lingoContains(item, word(rival))) {
      continue;
    }
    join = true;
    if (power(next, rival) > 0) {
      next[rival - 1] = power(next, rival) - 1;
      next[row.id - 1] = power(next, row.id) + 1;
    }
  }
  return {
    kind: "rival",
    line: fill(r.rivalHead, { NPC: npc }),
    powers: next,
    leader: row.id,
    join,
  };
}

/**
 * `SayFaction`: strictly highest → absolute power, strictly lowest → very weak, else fine. 1.6's
 * lines lacked their closing quote; SSO's close it.
 */
export function sayFaction(npc: string, powers: Powers): string | null {
  const row = leaderFaction(npc);
  if (!row) {
    return null;
  }
  const s = socialData.factionRules.sayFaction;
  const mine = power(powers, row.id);
  const others = powers.filter((_p, i) => i !== row.id - 1);
  let text = s.fine;
  if (others.every((o) => mine < o)) {
    text = s.weak;
  }
  if (others.every((o) => mine > o)) {
    text = s.absolute;
  }
  return fill(text, { NPC: row.leader });
}

/** The wanted line to the killer, naming the victim. */
export function wantedLine(victim: string): string {
  return fill(socialData.murder.wanted.text, { NAME: victim });
}

/** The pardon line to the pardoned, naming the immortal. */
export function pardonedLine(immortal: string): string {
  return fill(socialData.murder.pardoned.text, { NAME: immortal });
}

/** "Pardoning <name>..." to the immortal. */
export function pardoningLine(name: string): string {
  return fill(socialData.murder.pardoning.text, { NAME: name });
}

export { fill as fillSocialText };
