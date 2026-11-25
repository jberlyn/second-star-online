/**
 * Every content dataset's schema and file stem, keyed by the id the content store uses. The data
 * build validates the Classic pack with these, and the server validates every pack, the operator
 * layer and each draft with the same schemas.
 */
import { z } from "zod";

import { artDataSchema } from "./art.ts";
import { attPowerDataSchema } from "./attpower.ts";
import { balanceDataSchema } from "./balance.ts";
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
  art: artDataSchema,
  balance: balanceDataSchema,
} as const;

export type SchemaDatasetId = keyof typeof DATASET_SCHEMAS;

/**
 * A dataset's top-level field as JSON Schema (its input shape), for the Control Panel's forms;
 * null for a field the dataset does not have.
 */
export function partJsonSchema(
  dataset: SchemaDatasetId,
  part: string,
): Record<string, unknown> | null {
  const shape = (DATASET_SCHEMAS[dataset] as unknown as { shape?: Record<string, z.ZodType> })
    .shape;
  const field = shape?.[part];
  if (!field) {
    return null;
  }
  const json = z.toJSONSchema(field, { unrepresentable: "any", io: "input" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}

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
  art: "art",
  balance: "balance",
};

/**
 * Datasets a pack may leave out, each read as empty when it does: uploaded art (issue #29), which
 * the shipped packs don't carry (their art is their built atlases), and the balance numbers
 * (issue #19), whose every value has an engine default.
 */
export const OPTIONAL_DATASETS: readonly SchemaDatasetId[] = ["art", "balance"];

export {
  ART_FRAME_IDS,
  ART_SOUND_FORMATS,
  type ArtData,
  type ArtSoundFormat,
  artDataSchema,
  BODY_MAX,
  bodyNumberSchema,
  EMPTY_ART,
  NO_BODY_NUMBERS,
  nextOperatorBody,
  OPERATOR_BODY_MIN,
} from "./art.ts";
export {
  type Amount,
  amountSchema,
  BALANCE_DROP_KIND,
  BALANCE_DROP_WHO,
  BALANCE_HEAL_EFFECTS,
  BALANCE_LIMITS,
  BALANCE_SPELL_EFFECTS,
  type BalanceCombat,
  type BalanceData,
  type BalanceDrops,
  type BalanceMonsters,
  type BalanceSpellEffect,
  type BalanceTimings,
  balanceDataSchema,
  type CannonBalance,
  type FlatAmount,
  ROSTER_SLOTS,
  type SpellAmountOverride,
  type SpellEffectRow,
  type VehicleBalance,
} from "./balance.ts";
export { toolCanSchema } from "./common.ts";
export { gatherDataSchema, harvestNodeSchema, yieldTableSchema } from "./gather.ts";
export {
  LEGACY_DEED_VEHICLES,
  tileSetSchema,
  VEHICLE_HULL_LIMITS,
  vehicleSchema,
} from "./houses.ts";
export {
  equipSlotSchema,
  itemBehaviourSchema,
  paperdollLayerSchema,
  slotVarSchema,
  wornSlotSchema,
} from "./item-rules.ts";
export { BREAK_ARMOUR_SLOTS, BREAK_WEAPON_SLOTS } from "./items.ts";
export { MONSTER_HIT_EFFECTS, monsterSpellKindSchema } from "./monsters.ts";
export {
  comparePackVersions,
  EXPORT_PACK_FORMAT,
  PACK_FORMAT,
  type PackManifest,
  packIdSchema,
  packManifestSchema,
  packVersionSchema,
} from "./pack.ts";
export {
  checkProgression,
  curveSchema,
  FORMULA_MAX,
  formulaRange,
  skillDependents,
  skillProgressionSchema,
} from "./progression.ts";
export {
  type WorldMap,
  type WorldPoint,
  type WorldSeed,
  worldItemProblems,
  worldPointSchema,
  worldSeedSchema,
} from "./world.ts";
