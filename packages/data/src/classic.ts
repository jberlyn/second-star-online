/**
 * The Classic pack's datasets, from the generated modules, keyed as the content store keys them.
 * Kept off the package index: the server's pack loader and the test fixtures read it, and the
 * client never bundles it.
 */
import { attPowerData } from "./generated/attpower.ts";
import { casinoData } from "./generated/casino.ts";
import { classesData } from "./generated/classes.ts";
import { craftData } from "./generated/craft.ts";
import { gatherData } from "./generated/gather.ts";
import { helpData } from "./generated/help.ts";
import { houseData } from "./generated/houses.ts";
import { itemRulesData } from "./generated/item-rules.ts";
import { itemsData } from "./generated/items.ts";
import { monstersData } from "./generated/monsters.ts";
import { npcFilesData } from "./generated/npcfiles.ts";
import { questData } from "./generated/quests.ts";
import { rectsData } from "./generated/rects.ts";
import { socialData } from "./generated/social.ts";
import { spellsData } from "./generated/spells.ts";
import { tilesData } from "./generated/tiles.ts";

export const classicData = {
  attPower: attPowerData,
  casino: casinoData,
  classes: classesData,
  craft: craftData,
  gather: gatherData,
  help: helpData,
  houses: houseData,
  itemRules: itemRulesData,
  items: itemsData,
  monsters: monstersData,
  quests: questData,
  social: socialData,
  spells: spellsData,
  tiles: tilesData,
  npcFiles: npcFilesData,
  rects: rectsData,
};
