/**
 * Quests: `QuestGive`'s quest-line branch, `FindNewQuest` and `SayQuest`, over the server's
 * 40 `Quests.txt` lines. Pure rules. The faction-head branch is `headTurnIn` (factions.ts).
 */
import { questData, socialData } from "@secondstaronline/data";

import { lingoContains, lingoEq, type Rng } from "../core/lingo.ts";
import type { Bag } from "../inventory/inventory.ts";

/** The lines `QuestGive` and `SayQuest` read. */
export const QUEST_LINES = socialData.questReplies.give.lines;

/** The archive's `Quests.txt`, padded to 40 lines (the stray line feeds trimmed). */
export function archivedQuestLines(): string[] {
  const out = questData.current.map((q) => `${q.npc}:${q.wants}:${q.reward}`);
  while (out.length < QUEST_LINES) {
    out.push("");
  }
  return out;
}

const fill = (text: string, npc: string, item = "") =>
  text.replace("{NPC}", npc).replace("{ITEM}", item);

/** Selects a colon-separated field by its 1-based index; a missing field is empty. */
function item(line: string, n: number): string {
  return line.split(":")[n - 1] ?? "";
}

/**
 * The quest line `<npc>` wants `<given>` for: the **last** of lines 1-40 that contains
 * `<npc>:<given>`. A substring, so Fish matches `Stephie:Fishle` (a kept bug: quest lines match by
 * substring). Returns its index (0-based) and reward, or null.
 */
export function questMatch(
  lines: readonly string[],
  npc: string,
  given: string,
): { index: number; reward: string } | null {
  const want = `${npc}:${given}`;
  let hit: { index: number; reward: string } | null = null;
  for (let i = 0; i < QUEST_LINES; i++) {
    const line = lines[i] ?? "";
    if (lingoContains(line, want)) {
      hit = { index: i, reward: item(line, 3) };
    }
  }
  return hit;
}

/** A bag line as the server's item file holds it: `Name-qty`. */
const fileItem = (bag: Bag, i: number): string => {
  const l = bag[i];
  return l ? `${l.item}-${l.qty}` : "";
};

/**
 * Takes one `name` the way `QuestGive` does: the first slot 1-15 whose `Name-qty` **contains**
 * `name-`, rewritten as `name-(qty − 1)` (so a `Gold Fish` stack given as `Fish` becomes a `Fish`
 * stack), blank at 0. Returns the slot (0-based), or -1 when none.
 */
export function questTake(bag: Bag, name: string): number {
  const key = `${name}-`;
  const slot = bag.findIndex((_l, i) => i < 15 && lingoContains(fileItem(bag, i), key));
  if (slot < 0) {
    return -1;
  }
  const line = bag[slot];
  if (!line) {
    return -1;
  }
  const left = line.qty - 1;
  bag[slot] = left === 0 ? null : { item: name, qty: left };
  return slot;
}

/**
 * Adds one `reward` the way `QuestGive` does: onto the first slot whose `Name-qty` contains
 * `reward-` (renamed to `reward`, qty + 1), else the lowest empty slot, else `fallback`, the slot
 * the given item came from, which is overwritten (a kept bug: a quest reward to a full bag replaces
 * what you gave). Returns the slot (0-based).
 */
export function questReward(bag: Bag, reward: string, fallback: number): number {
  const key = `${reward}-`;
  const stack = bag.findIndex((_l, i) => i < 15 && lingoContains(fileItem(bag, i), key));
  if (stack >= 0) {
    const qty = (bag[stack]?.qty ?? 0) + 1;
    bag[stack] = { item: reward, qty };
    return stack;
  }
  let slot = fallback;
  for (let i = 14; i >= 0; i--) {
    if (bag[i] === null || bag[i] === undefined) {
      slot = i;
    }
  }
  bag[slot] = { item: reward, qty: 1 };
  return slot;
}

/**
 * `FindNewQuest`: `random(44)` for the NPC (29 names none, so the line starts with ":"; 39 is
 * Kanta), `random(20)` for the wanted item, `random(20)` for the reward.
 */
export function findNewQuest(rng: Rng): string {
  const pools = questData.pools;
  const n = rng.random(pools.npcs.length);
  const w = rng.random(pools.wanted.length);
  const r = rng.random(pools.rewards.length);
  const npc = pools.npcs.find((p) => p.roll === n)?.npc ?? "";
  const wanted = pools.wanted.find((p) => p.roll === w)?.item ?? "";
  const reward = pools.rewards.find((p) => p.roll === r)?.item ?? "";
  return `${npc}:${wanted}:${reward}`;
}

/** "Wow thanks…", `aqs`: the giver's map hears it. */
export function questThanks(npc: string): string {
  return fill(socialData.questReplies.give.thanks, npc);
}

/** "I'm sorry but I don't need that.", `sqa`: the giver alone. */
export function questSorry(npc: string): string {
  return fill(socialData.questReplies.give.sorry, npc);
}

/** Oraku's exchange: his own orb for the Royal Ninja Uniform. */
export const ORAKU = socialData.questReplies.oraku;

export function orakuLine(): string {
  return fill(ORAKU.text, ORAKU.npc);
}

/** True when `npc` and `given` are Oraku's exchange (`=`, case ignored). */
export function isOrakuExchange(npc: string, given: string): boolean {
  return lingoEq(npc, ORAKU.npc) && lingoEq(given, ORAKU.item);
}

export interface QuestReply {
  text: string;
  /** `sqa` to the asker alone, or `aqs`, heard by the asker's map. */
  to: "asker" | "map";
}

/**
 * The quest-said routine → `SayQuest` for the names in slots 1-4 (`""` for an empty or filtered
 * slot): a name the quest text contains gets one "Bring me a…" per line among 1-40 containing it
 * (slot 1 to the asker, slots 2-4 to the map, a kept bug: the reply audience differs by NPC slot),
 * else "Sorry but I don't need anything right now" to the map. "Bring me a…" has no closing quote.
 */
export function sayQuest(lines: readonly string[], names: readonly string[]): QuestReply[] {
  const s = socialData.questReplies.say;
  const all = lines.join("\r");
  const out: QuestReply[] = [];
  names.forEach((name, slot) => {
    if (name === "") {
      return;
    }
    if (!lingoContains(all, name)) {
      out.push({ text: fill(s.nothing, name), to: "map" });
      return;
    }
    for (let i = 0; i < QUEST_LINES; i++) {
      const line = lines[i] ?? "";
      if (lingoContains(line, name)) {
        out.push({ text: fill(s.bring, name, item(line, 2)), to: slot === 0 ? "asker" : "map" });
      }
    }
  });
  return out;
}

/** The asking line the quest-said routine reads: word 1 Quest/errand or the three phrases. */
export function asksForQuest(text: string): boolean {
  const w1 = text.trim().split(/\s+/)[0] ?? "";
  return (
    lingoEq(w1, "Quest") ||
    lingoEq(w1, "errand") ||
    lingoContains(text, "do you have a quest") ||
    lingoContains(text, "is there a quest") ||
    lingoContains(text, "run an errand")
  );
}

/** The faction power question. */
export function asksAboutFaction(text: string): boolean {
  return ["faction power", "faction strength", "power?", "strength?", "status?"].some((p) =>
    lingoContains(text, p),
  );
}
