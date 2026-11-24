/**
 * Quests on the server.
 *
 * `QuestGive` ran on the 1.6 server already; SSO keeps its order and its kept bugs, with the 40
 * `Quests.txt` lines as server rows and the NPC taken from the map, not from the message (1.6 let
 * the client name any NPC, from anywhere).
 */
import {
  anyMatch,
  CHAT_COLOR,
  content,
  displayName,
  EDITOR_MONSTERS,
  findNewQuest,
  headFaction,
  heardSqa,
  leaderFaction,
  lingoContains,
  orakuExchange,
  orakuLine,
  questMatch,
  questReward,
  questRoom,
  questSorry,
  questTake,
  questThanks,
  type Rng,
  sayQuest,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import { aqsToMap, giveHead, headRefusal } from "../social/factions.ts";
import type { Outgoing, Player, World } from "../world/world.ts";

/** Whether the editor monster list contains the given name. */
function inMonsterList(name: string): boolean {
  return lingoContains(EDITOR_MONSTERS.join("\r"), name);
}

/** The reply when a reward has nowhere to go: nothing is taken. */
export const QUEST_TEXT = {
  noRoom: (npc: string) => `${npc} says "You have no room in your bag for my reward."`,
} as const;

/**
 * `GiveNPC` → `QuestGive` for the item in bag slot `slot` (0-based) given to `npc`, one or two
 * tiles ahead. A name the World Editor's MONSTER list contains gets nothing (GiveNPC's exit). In
 * order: a head to a faction leader, Oraku's orb, then the quest lines. The item always comes from
 * the slot you gave from, and a reward with no room in the bag stops the hand-in before anything is
 * taken (1.6 took from the first slot containing the name and overwrote it with the reward). A head
 * the leader's faction would refuse the giver for stays in the bag (`headRefusal`).
 */
export function questGive(
  world: World,
  p: Player,
  slot: number,
  npc: string,
  rng: Rng,
): Outgoing[] {
  const given = p.char.bag[slot]?.item;
  if (!given || inMonsterList(npc)) {
    return [];
  }
  // A faction's head (its `head` item, exactly) given to a faction's leader; any other item goes
  // to the quest lines (1.6 took any item containing " Head", and took it for nothing).
  if (leaderFaction(npc) && headFaction(given) !== null) {
    const refused = headRefusal(world, p, npc, given);
    if (refused) {
      return refused;
    }
    if (questTake(p.char.bag, slot) < 0) {
      return [];
    }
    logQuest(world, p, npc, given, null);
    p.invDirty = true;
    return giveHead(world, p, npc, given)?.out ?? [];
  }
  const oraku = orakuExchange(npc, given);
  if (oraku) {
    if (!questRoom(p.char.bag, slot, oraku.reward)) {
      return [tellNoRoom(p, npc)];
    }
    questTake(p.char.bag, slot);
    questReward(p.char.bag, oraku.reward);
    logQuest(world, p, npc, given, oraku.reward);
    p.invDirty = true;
    return aqsToMap(world, p, orakuLine(oraku));
  }
  const match = questMatch(world.questLines, npc, given);
  if (!match) {
    // `sqa` to the giver alone.
    return [
      {
        to: p.id,
        msg: {
          t: "chat",
          text: heardSqa(questSorry(npc), p.map.name, p.y),
          color: CHAT_COLOR.normal,
        },
      },
    ];
  }
  if (!questRoom(p.char.bag, slot, match.reward)) {
    return [tellNoRoom(p, npc)];
  }
  questTake(p.char.bag, slot);
  questReward(p.char.bag, match.reward);
  logQuest(world, p, npc, given, match.reward);
  p.invDirty = true;
  const out = aqsToMap(world, p, questThanks(npc));
  // A leader's line is never rerolled, so it can be done again.
  if (!leaderFaction(npc)) {
    world.questLines[match.index] = findNewQuest(rng);
    world.questsDirty.add(match.index);
  }
  return out;
}

/** A hand-in: the item given and the reward, each as a quest step with the NPC. */
function logQuest(world: World, p: Player, npc: string, given: string, reward: string | null) {
  const step = `Gave ${displayName(given)} to ${npc}`;
  logActivity(world, p, "quest", { other: npc, item: given, qty: -1, details: { step } });
  if (reward !== null) {
    logActivity(world, p, "quest", { other: npc, item: reward, qty: 1, details: { step } });
  }
}

const tellNoRoom = (p: Player, npc: string): Outgoing => ({
  to: p.id,
  msg: {
    t: "chat",
    text: heardSqa(QUEST_TEXT.noRoom(npc), p.map.name, p.y),
    color: CHAT_COLOR.normal,
  },
});

/**
 * The quest question to an NPC: the four slots' live monsters, less names the MONSTER list
 * contains, Pig and Cow, each answering from the quest lines.
 */
export function askForQuest(world: World, p: Player): Outgoing[] {
  const room = world.rooms.get(p.map.name);
  if (!room) {
    return [];
  }
  const names = room.map.slots.slice(0, 4).map((s) => {
    const name = s.live?.name ?? "";
    if (name === "" || inMonsterList(name) || anyMatch(content().monsters.rules.noQuests, name)) {
      return "";
    }
    return name;
  });
  const out: Outgoing[] = [];
  for (const r of sayQuest(world.questLines, names)) {
    if (r.to === "asker") {
      out.push({
        to: p.id,
        msg: { t: "chat", text: heardSqa(r.text, p.map.name, p.y), color: CHAT_COLOR.normal },
      });
    } else {
      out.push(...aqsToMap(world, p, r.text));
    }
  }
  return out;
}
