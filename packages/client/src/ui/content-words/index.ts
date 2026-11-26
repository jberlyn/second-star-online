/** Every dataset's words for the content forms, by dataset id (see content-words.ts). */
import type { WordBook } from "../content-words.ts";
import { attPowerWords } from "./att-power.ts";
import { balanceWords } from "./balance.ts";
import { bindingsWords } from "./bindings.ts";
import { casinoWords } from "./casino.ts";
import { classesWords } from "./classes.ts";
import { craftWords } from "./craft.ts";
import { eventsWords } from "./events.ts";
import { gatherWords } from "./gather.ts";
import { helpWords } from "./help.ts";
import { housesWords } from "./houses.ts";
import { itemRulesWords } from "./item-rules.ts";
import { itemsWords } from "./items.ts";
import { monstersWords } from "./monsters.ts";
import { npcFilesWords } from "./npc-files.ts";
import { questsWords } from "./quests.ts";
import { socialWords } from "./social.ts";
import { spellsWords } from "./spells.ts";
import { tilesWords } from "./tiles.ts";

export const DATASET_WORDS: Record<string, WordBook> = {
  attPower: attPowerWords,
  bindings: bindingsWords,
  casino: casinoWords,
  classes: classesWords,
  craft: craftWords,
  gather: gatherWords,
  help: helpWords,
  houses: housesWords,
  itemRules: itemRulesWords,
  items: itemsWords,
  monsters: monstersWords,
  npcFiles: npcFilesWords,
  quests: questsWords,
  social: socialWords,
  spells: spellsWords,
  tiles: tilesWords,
  balance: balanceWords,
  events: eventsWords,
};
