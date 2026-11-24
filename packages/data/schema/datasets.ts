/**
 * Every content dataset's schema and file stem, keyed by the id the content store uses. The data
 * build validates the Classic pack with these, and the server validates every pack, the operator
 * layer and each draft with the same schemas.
 */
import { attPowerDataSchema } from "./attpower.ts";
import { bindingsDataSchema } from "./bindings.ts";
import { casinoDataSchema } from "./casino.ts";
import { classesDataSchema } from "./classes.ts";
import { craftDataSchema } from "./craft.ts";
import { gatherDataSchema } from "./gather.ts";
import { helpDataSchema } from "./help.ts";
import { houseDataSchema } from "./houses.ts";
import { itemRulesDataSchema } from "./item-rules.ts";
import { itemsDataSchema } from "./items.ts";
import { monstersDataSchema } from "./monsters.ts";
import { npcFilesDataSchema } from "./npcfiles.ts";
import { questDataSchema } from "./quests.ts";
import { rectsDataSchema } from "./rects.ts";
import { socialDataSchema } from "./social.ts";
import { spellsDataSchema } from "./spells.ts";
import { tilesDataSchema } from "./tiles.ts";

export const DATASET_SCHEMAS = {
  attPower: attPowerDataSchema,
  bindings: bindingsDataSchema,
  casino: casinoDataSchema,
  classes: classesDataSchema,
  craft: craftDataSchema,
  gather: gatherDataSchema,
  help: helpDataSchema,
  houses: houseDataSchema,
  itemRules: itemRulesDataSchema,
  items: itemsDataSchema,
  monsters: monstersDataSchema,
  quests: questDataSchema,
  social: socialDataSchema,
  spells: spellsDataSchema,
  tiles: tilesDataSchema,
  npcFiles: npcFilesDataSchema,
  rects: rectsDataSchema,
} as const;

export type SchemaDatasetId = keyof typeof DATASET_SCHEMAS;

/** Each dataset's file stem in `content/` and in a pack's `data/` folder. */
export const DATASET_FILES: Record<SchemaDatasetId, string> = {
  attPower: "attpower",
  bindings: "bindings",
  casino: "casino",
  classes: "classes",
  craft: "craft",
  gather: "gather",
  help: "help",
  houses: "houses",
  itemRules: "item-rules",
  items: "items",
  monsters: "monsters",
  quests: "quests",
  social: "social",
  spells: "spells",
  tiles: "tiles",
  npcFiles: "npc-files",
  rects: "rects",
};

export { comparePackVersions, PACK_FORMAT, type PackManifest, packManifestSchema } from "./pack.ts";
export { checkProgression, FORMULA_MAX, formulaRange, skillDependents } from "./progression.ts";
export {
  type WorldMap,
  type WorldPoint,
  type WorldSeed,
  worldPointSchema,
  worldSeedSchema,
} from "./world.ts";
