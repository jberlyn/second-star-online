/** Plain words for the `quests` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

export const questsWords: WordBook = {
  current: {
    label: "Starting quests",
    help: "Only used when a new world starts; after that each finished quest picks a new one from the quest pools.",
    noun: "quest",
  },
  "current.[].npc": { label: "NPC", help: "Who asks for the item.", names: "npc" },
  "current.[].wants": { label: "Wants", help: "The item the NPC asks for.", names: "item" },
  "current.[].reward": { label: "Reward", help: "The item the NPC gives back.", names: "item" },

  "pools.npcs": {
    label: "NPCs who give quests",
    help: "A new quest goes to one of these, each equally likely.",
    noun: "NPC",
  },
  "pools.npcs.[].roll": { label: "Number", help: "Numbers go 1, 2, 3… in order.", more: true },
  "pools.npcs.[].npc": { label: "NPC", help: "Leave off for an unused number.", names: "npc" },
  "pools.wanted": {
    label: "Items asked for",
    help: "A new quest asks for one of these, each equally likely.",
    noun: "item",
  },
  "pools.wanted.[].roll": { label: "Number", help: "Numbers go 1, 2, 3… in order.", more: true },
  "pools.wanted.[].item": { label: "Item", names: "item" },
  "pools.rewards": {
    label: "Rewards",
    help: "A new quest gives one of these, each equally likely.",
    noun: "reward",
  },
  "pools.rewards.[].roll": { label: "Number", help: "Numbers go 1, 2, 3… in order.", more: true },
  "pools.rewards.[].item": { label: "Item", names: "item" },
};
