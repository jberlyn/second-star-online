/**
 * Factions and the murder flag. Pure rules over the content store's `social` data.
 *
 * The faction system is engine (joining, the loyalty count, exile, heads and rival kills, the
 * powers and the tiers they give, member spawns); each faction, its leader, head and member, and
 * what its perks are worth by tier, are content (`social.json` `factions`). Classic declares 1.6's
 * Mage, Warrior and Adventurer with 1.6's values.
 */
import type { FactionPerkKind, FactionRow } from "@secondstaronline/data";

import { content, onContent } from "../../content/store.ts";
import type { Faction } from "../core/fighter.ts";
import { lingoEq } from "../core/lingo.ts";

/** A faction key (`factions[].key`), or null for none. 1.6's `Fctnme` was 0-3. */
export type FactionKey = string | null;

/** Each faction's power, by key (1.6's `factions.txt`, `mage:warrior:adventurer`). */
export type Powers = Readonly<Record<string, number>>;

/** The membership a character keeps: `Fctnme:Fctcnt`, sheet item 5. */
export interface Membership {
  key: FactionKey;
  /** `Fctcnt`: frames of play left. */
  count: number;
}

export const NO_MEMBERSHIP: Membership = { key: null, count: 0 };

let BY_KEY = new Map<string, FactionRow>();

/** The faction with this key (case ignored), or null: none, or a faction the world has removed. */
export function factionByKey(key: FactionKey): FactionRow | null {
  return key === null ? null : (BY_KEY.get(key.toLowerCase()) ?? null);
}

/** A saved faction key as the world knows it: its row's own spelling, else as saved, else null. */
export function factionKeyOf(key: string | null | undefined): FactionKey {
  if (!key) {
    return null;
  }
  return factionByKey(key)?.key ?? key;
}

/** The two keys name the same faction (case ignored); none never matches. */
export function sameFaction(a: FactionKey, b: FactionKey): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

/** A faction's power: the saved one, else its `startPower`. */
export function factionPower(powers: Powers, key: string): number {
  const row = factionByKey(key);
  const exact = row?.key ?? key;
  const k = exact.toLowerCase();
  // The faction's own spelling first: a key re-spelled by case may have left an older entry.
  const saved = powers[exact] ?? Object.entries(powers).find(([pk]) => pk.toLowerCase() === k)?.[1];
  return saved ?? row?.startPower ?? 0;
}

/** Every faction's power, saved or starting, keyed by the content's keys. */
export function allPowers(powers: Powers): Record<string, number> {
  const out: Record<string, number> = { ...powers };
  for (const f of content().social.factions) {
    for (const k of Object.keys(out)) {
      if (k !== f.key && k.toLowerCase() === f.key.toLowerCase()) {
        delete out[k];
      }
    }
    out[f.key] = factionPower(powers, f.key);
  }
  return out;
}

/** The powers a fresh server starts with: each faction's `startPower` (Classic: 1.6's 27:123:0). */
export function startingPowers(): Record<string, number> {
  return Object.fromEntries(content().social.factions.map((f) => [f.key, f.startPower]));
}

/** The faction whose leader is `npc` (case-insensitive comparison), or null. */
export function leaderFaction(npc: string): FactionRow | null {
  return content().social.factions.find((f) => lingoEq(f.leader, npc)) ?? null;
}

/** The faction whose head is `item` (matched exactly, case ignored), or null. */
export function headFaction(item: string): FactionRow | null {
  return content().social.factions.find((f) => lingoEq(f.head, item)) ?? null;
}

/**
 * The faction sort: a member's tier from its faction's power, by `factionRules.tiers` (Classic:
 * < 90 → 9, < 80 → 8 … < 10 → 1, < 5 → 0, the last true row winning, so 80 or more gives 9). 1.6
 * started the cascade at < 200 → 9 and left 0 when nothing matched, so 200 or more gave 0 (a bug
 * fixed: it gives 9).
 */
export function factionBonus(power: number): number {
  const t = content().social.factionRules.tiers;
  let b = t.top;
  for (const row of t.below) {
    if (power < row.below) {
      b = row.tier;
    }
  }
  return b;
}

/** The `Faction` the combat rules read: the membership and the tier its faction's power gives. */
export function sortFaction(key: FactionKey, powers: Powers): Faction {
  const row = factionByKey(key);
  if (!row) {
    return { key, tier: 0 };
  }
  return { key: row.key, tier: factionBonus(factionPower(powers, row.key)) };
}

/**
 * What a perk is worth to `f`: its faction's value at its tier (a tier past the end reads the
 * last value), else `factionRules.perkDefaults` (Classic: the skill cap 50 and the Mage cap 30),
 * else 0.
 */
export function factionPerk(f: Faction, kind: FactionPerkKind): number {
  const perk = factionByKey(f.key)?.perks.find((p) => p.kind === kind);
  if (perk) {
    return perk.values[Math.min(Math.max(0, f.tier), perk.values.length - 1)] ?? 0;
  }
  return content().social.factionRules.perkDefaults[kind] ?? 0;
}

const fill = (text: string, values: { NAME?: string; NPC?: string; ITEM?: string }) =>
  text.replace(/\{(NAME|NPC|ITEM)\}/g, (_m, k: "NAME" | "NPC" | "ITEM") => values[k] ?? "");

/**
 * The head a dying member drops: its own faction's, on a map whose PvP flag is X (`DeathPenalty`),
 * whatever killed it. Null otherwise.
 */
export function deathHead(key: FactionKey, pvpX: boolean): string | null {
  const row = factionByKey(key);
  if (!row || !pvpX) {
    return null;
  }
  return row.head;
}

/**
 * The exile check after the death penalty, on the new HPmax: below the faction's line, the
 * membership ends with its text (and so the faction channel, which is the faction's members). A
 * faction never takes a joiner below its own exile line, so a fresh member is not exiled at its
 * next death.
 */
export function exileAtDeath(m: Membership, hpMax: number): string | null {
  const row = factionByKey(m.key);
  if (!row) {
    return null;
  }
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
  const row = factionByKey(m.key);
  if (!row) {
    // A faction the world has removed: the count waits for its return (none drains it to 0,
    // where it would never kick).
    return {
      count: m.key === null ? Math.max(0, m.count - 1) : m.count,
      text: null,
      kicked: false,
    };
  }
  const count = Math.max(0, m.count - 1);
  const hit = row.loyalty.find((l) => l.count === count);
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

/** Whether a membership is in no faction the world has (none, or a removed faction's). */
const inNone = (m: Membership) => factionByKey(m.key) === null;

/**
 * Whether `leader`'s faction would take this membership: anyone already in it, or someone in no
 * faction with `HPmax` above its join line. A member of another faction, or one too weak, is
 * refused before anything is handed over.
 */
export function joinRefusal(m: Membership, leader: FactionRow, hpMax: number): string | null {
  if (sameFaction(m.key, leader.key)) {
    return null;
  }
  if (!inNone(m)) {
    return leader.texts.other;
  }
  return hpMax > leader.joinHpMaxAbove ? null : leader.texts.weak;
}

/**
 * The faction-join routines (`joinFaction`) for a head turned in to `leader`'s faction: not in a
 * faction and above the join line (49, Warriors 59) joins with 212000 frames; too weak is refused;
 * the same faction adds 212000 with no HP check; another faction changes nothing but still
 * announces (with "Mage's" for the Mages). The server asks `joinRefusal` first, so the last two
 * refusals are never reached by a hand-in.
 */
export function joinFaction(
  m: Membership,
  leader: FactionRow,
  hpMax: number,
  me: string,
): JoinResult {
  const t = leader.texts;
  if (inNone(m)) {
    if (hpMax > leader.joinHpMaxAbove) {
      return {
        membership: { key: leader.key, count: leader.joinCount },
        line: t.join,
        announce: fill(t.announce, { NAME: me }),
      };
    }
    return { membership: m, line: t.weak, announce: null };
  }
  if (sameFaction(m.key, leader.key)) {
    return {
      membership: { key: leader.key, count: m.count + leader.rejoinAdds },
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
  | { kind: "rival"; line: string; powers: Powers; leader: FactionRow; join: boolean };

/**
 * The faction branch of `QuestGive`, after the head is taken: a faction's head given to another
 * faction's leader (Angela, Trianus or Corin in Classic). The leader's own faction's head is wasted;
 * a rival's moves 1 power from the rival to the leader's faction if the rival is above 0. Names
 * compare ignoring case (`adventurer's Head`). 1.6 took any item containing " Head" and read the
 * faction words in it ("Mage's"); a head is now its faction's `head` item, exactly.
 */
export function headTurnIn(npc: string, item: string, powers: Powers): HeadTurnIn {
  const row = leaderFaction(npc);
  const head = headFaction(item);
  if (!row || !head) {
    return { kind: "notHead" };
  }
  const r = content().social.factionRules.turnIn;
  if (head.key === row.key) {
    return { kind: "own", line: fill(r.ownHead, { NPC: npc }) };
  }
  const next = allPowers(powers);
  if ((next[head.key] ?? 0) > 0) {
    next[head.key] = (next[head.key] ?? 0) - 1;
    next[row.key] = (next[row.key] ?? 0) + 1;
  }
  return {
    kind: "rival",
    line: fill(r.rivalHead, { NPC: npc }),
    powers: next,
    leader: row,
    join: true,
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
  const s = content().social.factionRules.sayFaction;
  const mine = factionPower(powers, row.key);
  const others = content()
    .social.factions.filter((f) => f.key !== row.key)
    .map((f) => factionPower(powers, f.key));
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
  return fill(content().social.murder.wanted.text, { NAME: victim });
}

/** The pardon line to the pardoned, naming the staff member (1.6: the immortal). */
export function pardonedLine(staff: string): string {
  return fill(content().social.murder.pardoned.text, { NAME: staff });
}

/** "Pardoning <name>..." to the staff member. */
export function pardoningLine(name: string): string {
  return fill(content().social.murder.pardoning.text, { NAME: name });
}

export { fill as fillSocialText };

onContent((c) => {
  BY_KEY = new Map(c.social.factions.map((f) => [f.key.toLowerCase(), f]));
});
