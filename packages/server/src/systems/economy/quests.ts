/**
 * Quests on the server.
 *
 * `QuestGive` ran on the 1.6 server already; SSO keeps its order and its kept bugs, with the 40
 * `Quests.txt` lines as server rows and the NPC taken from the map, not from the message (1.6 let
 * the client name any NPC, from anywhere).
 */
import { monstersData } from "@secondstaronline/data";
import {
  anyMatch,
  CHAT_COLOR,
  EDITOR_MONSTERS,
  findNewQuest,
  heardSqa,
  isOrakuExchange,
  leaderFaction,
  lingoContains,
  ORAKU,
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

import { aqsToMap, giveHead } from "../social/factions.ts";
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
 * taken (1.6 took from the first slot containing the name and overwrote it with the reward).
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
  if (leaderFaction(npc) && lingoContains(given, " Head")) {
    if (questTake(p.char.bag, slot) < 0) {
      return [];
    }
    p.invDirty = true;
    return giveHead(world, p, npc, given)?.out ?? [];
  }
  if (isOrakuExchange(npc, given)) {
    if (!questRoom(p.char.bag, slot, ORAKU.reward)) {
      return [tellNoRoom(p, npc)];
    }
    questTake(p.char.bag, slot);
    questReward(p.char.bag, ORAKU.reward);
    p.invDirty = true;
    return aqsToMap(world, p, orakuLine());
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
  p.invDirty = true;
  const out = aqsToMap(world, p, questThanks(npc));
  // A leader's line is never rerolled, so it can be done again.
  if (!leaderFaction(npc)) {
    world.questLines[match.index] = findNewQuest(rng);
    world.questsDirty.add(match.index);
  }
  return out;
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
    if (name === "" || inMonsterList(name) || anyMatch(monstersData.rules.noQuests, name)) {
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
