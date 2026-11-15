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

/**
 * `GiveNPC` → `QuestGive` for the item in bag slot `slot` (0-based) given to `npc`, one or two
 * tiles ahead. A name the World Editor's MONSTER list contains gets nothing (GiveNPC's exit). In
 * order: a head to a faction leader, Oraku's orb, then the quest lines.
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
    // The named slot must hold it; one comes off the first slot that does.
    if (questTake(p.char.bag, given) < 0) {
      return [];
    }
    p.invDirty = true;
    return giveHead(world, p, npc, given)?.out ?? [];
  }
  if (isOrakuExchange(npc, given)) {
    const from = questTake(p.char.bag, ORAKU.item);
    if (from < 0) {
      return [];
    }
    questReward(p.char.bag, ORAKU.reward, from);
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
  const from = questTake(p.char.bag, given);
  if (from < 0) {
    return [];
  }
  questReward(p.char.bag, match.reward, from);
  p.invDirty = true;
  const out = aqsToMap(world, p, questThanks(npc));
  // A leader's line is never rerolled, so it can be done again.
  if (!leaderFaction(npc)) {
    world.questLines[match.index] = findNewQuest(rng);
    world.questsDirty.add(match.index);
  }
  return out;
}

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
