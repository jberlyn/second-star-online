/**
 * Quests: `QuestGive`'s quest-line branch, `FindNewQuest` and `SayQuest`, over the server's
 * 40 `Quests.txt` lines. Pure rules. The faction-head branch is `headTurnIn` (factions.ts).
 */
import { type ContentStore, content, onContent } from "../../content/store.ts";
import { lingoContains, lingoEq, type Rng } from "../core/lingo.ts";
import { addSlotFor, type Bag, itemLabel } from "../inventory/inventory.ts";

/** The lines `QuestGive` and `SayQuest` read. */
export let QUEST_LINES: ContentStore["social"]["questReplies"]["give"]["lines"];

/** The archive's `Quests.txt`, padded to 40 lines (the stray line feeds trimmed). */
export function archivedQuestLines(): string[] {
  const out = content().quests.current.map((q) => `${q.npc}:${q.wants}:${q.reward}`);
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
 * The quest line `<npc>` wants `<given>` for: the **first** of lines 1-40 whose NPC and wanted item
 * are exactly those names (case and surrounding spaces ignored). 1.6 took the last line that merely
 * contained `<npc>:<given>`, so Fish matched `Stephie:Fishle`. Returns its index (0-based) and
 * reward, or null.
 */
export function questMatch(
  lines: readonly string[],
  npc: string,
  given: string,
): { index: number; reward: string } | null {
  for (let i = 0; i < QUEST_LINES; i++) {
    const line = lines[i] ?? "";
    if (
      item(line, 1).trim() !== "" &&
      lingoEq(item(line, 1).trim(), npc.trim()) &&
      lingoEq(item(line, 2).trim(), given.trim())
    ) {
      return { index: i, reward: item(line, 3).trim() };
    }
  }
  return null;
}

/**
 * Whether bag slot `slot` (0-based) can give one item and take `reward` in return: a stack of
 * exactly the reward, an empty slot, or the given slot itself when its last unit goes.
 */
export function questRoom(bag: Bag, slot: number, reward: string): boolean {
  return addSlotFor(bag, reward) >= 0 || bag[slot]?.qty === 1;
}

/**
 * Takes one item from bag slot `slot` (0-based), the one you handed over, blank at 0. The stack
 * keeps its name (1.6 took from the first slot whose text contained the name and renamed it, so a
 * `Gold Fish` stack given as `Fish` became a `Fish` stack). Returns the slot, or -1 when it is
 * empty.
 */
export function questTake(bag: Bag, slot: number): number {
  const line = bag[slot];
  if (!line) {
    return -1;
  }
  bag[slot] = line.qty <= 1 ? null : { item: line.item, qty: line.qty - 1 };
  return slot;
}

/**
 * Adds one `reward`: onto a stack of exactly that name (which keeps its spelling), else the lowest
 * empty slot. Returns the slot (0-based), or -1 with no room (the caller checks `questRoom` first;
 * 1.6 overwrote the slot the given item came from).
 */
export function questReward(bag: Bag, reward: string): number {
  const slot = addSlotFor(bag, reward);
  if (slot < 0) {
    return -1;
  }
  const line = bag[slot];
  bag[slot] = line ? { item: line.item, qty: line.qty + 1 } : { item: reward, qty: 1 };
  return slot;
}

/**
 * `FindNewQuest`: the NPC is one of the pool's named NPCs, each equally likely; then a roll over the
 * wanted pool and one over the rewards (1.6's were `random(20)` each; the Classic pack dropped the
 * items nobody could get). (1.6 rolled `random(44)` for the NPC, and roll 29 named nobody, writing a
 * line no NPC would answer.)
 */
export function findNewQuest(rng: Rng): string {
  const pools = content().quests.pools;
  const names = pools.npcs.flatMap((p) => (p.npc ? [p.npc] : []));
  const npc = names[rng.random(names.length) - 1] ?? names[0] ?? "";
  const w = rng.random(pools.wanted.length);
  const r = rng.random(pools.rewards.length);
  const wanted = (pools.wanted.find((p) => p.roll === w)?.item ?? "").trim();
  const reward = (pools.rewards.find((p) => p.roll === r)?.item ?? "").trim();
  return `${npc}:${wanted}:${reward}`;
}

/** An item a quest may still ask for or give: in the catalogue (any spelling) and not retired. */
function questItemOk(name: string): boolean {
  const n = name.trim();
  const c = content();
  const it =
    c.itemNamed(n) ?? c.items.items.find((i) => (i.variants ?? []).some((v) => lingoEq(v, n)));
  return it !== undefined && !it.retired;
}

/**
 * A stored quest line that can never be finished: it names no NPC, or it asks for or gives an item
 * the catalogue no longer has or has retired (1.6's Water Orb, which nobody could get).
 */
export function questLineUnanswerable(line: string): boolean {
  if (line === "") {
    return false;
  }
  return item(line, 1).trim() === "" || !questItemOk(item(line, 2)) || !questItemOk(item(line, 3));
}

/** "Wow thanks…", `aqs`: the giver's map hears it. */
export function questThanks(npc: string): string {
  return fill(content().social.questReplies.give.thanks, npc);
}

/** "I'm sorry but I don't need that.", `sqa`: the giver alone. */
export function questSorry(npc: string): string {
  return fill(content().social.questReplies.give.sorry, npc);
}

/** Oraku's exchange: his own orb for the Royal Ninja Uniform. */
export let ORAKU: ContentStore["social"]["questReplies"]["oraku"];

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
 * slot): an NPC named by a quest line gets one "Bring me a…" per line among 1-40 it gives, else
 * "Sorry but I don't need anything right now". Every reply is heard by the asker's map, as the
 * question was (1.6 sent slot 1's "Bring me a…" to the asker alone and left off its closing quote).
 */
export function sayQuest(lines: readonly string[], names: readonly string[]): QuestReply[] {
  const s = content().social.questReplies.say;
  const out: QuestReply[] = [];
  for (const name of names) {
    if (name === "") {
      continue;
    }
    const mine = lines
      .slice(0, QUEST_LINES)
      .filter((line) => lingoEq(item(line, 1).trim(), name.trim()));
    if (mine.length === 0) {
      out.push({ text: fill(s.nothing, name), to: "map" });
      continue;
    }
    for (const line of mine) {
      out.push({ text: fill(s.bring, name, itemLabel(item(line, 2).trim())), to: "map" });
    }
  }
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

onContent((c) => {
  QUEST_LINES = c.social.questReplies.give.lines;
  ORAKU = c.social.questReplies.oraku;
});
