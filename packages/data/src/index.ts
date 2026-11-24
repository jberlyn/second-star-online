/**
 * @secondstaronline/data: the content types, the seed maps and the asset index. The Classic pack's
 * data is not here: the server loads packs from disk and the client fetches the server's store.
 * Imports nothing at runtime.
 */

export type { AttPowerData, AttPowerTier } from "../schema/attpower.ts";
export type { BindingsData, SkillBinding } from "../schema/bindings.ts";
export type { CasinoData } from "../schema/casino.ts";
export type { ChurchMapData } from "../schema/church-map.ts";
export type {
  ClassesData,
  Creation,
  Promotion,
  SexRow,
  Skill,
  StartClass as StartClassRow,
  WeaponSkills,
} from "../schema/classes.ts";
export type { CraftData } from "../schema/craft.ts";
export type { GatherData, HarvestNode, YieldTable } from "../schema/gather.ts";
export type { HelpData, HelpTopic } from "../schema/help.ts";
export type { HouseData, HouseType } from "../schema/houses.ts";
export type { EquipSlot, ItemBehaviour, ItemRulesData } from "../schema/item-rules.ts";
export type { Item, ItemsData } from "../schema/items.ts";
export type { JailMapData } from "../schema/jail-map.ts";
export type {
  MeleeAffinity,
  Monster,
  MonsterFlags,
  MonsterSpellKind,
  MonsterSpellRule,
  MonstersData,
} from "../schema/monsters.ts";
export type { NpcFilesData, NpcFileText } from "../schema/npcfiles.ts";
export type {
  Cap,
  ChanceSettings,
  Curve,
  Formula,
  FormulaRow,
  ProgressionData,
  ProgressionSource,
  SkillProgression,
  StatTable,
  XpSettings,
} from "../schema/progression.ts";
export type { QuestData } from "../schema/quests.ts";
export type { MemberRect, RectsData } from "../schema/rects.ts";
export type { SeedMapData } from "../schema/seed-map.ts";
export type {
  Faction as FactionRow,
  FactionPerk,
  FactionPerkKind,
  SocialData,
} from "../schema/social.ts";
export type {
  Spell,
  SpellCreates,
  SpellFx,
  SpellPowerTable,
  SpellPowerTier,
  SpellSchool,
  SpellSound,
  SpellSpByBody,
  SpellSummon,
  SpellsData,
} from "../schema/spells.ts";
export type {
  Tile,
  TileDefaults,
  TileFlag,
  TilesData,
  WhitelistToken,
} from "../schema/tiles.ts";
export type {
  AssetIndex,
  AtlasGroup,
  AtlasIndex,
  AtlasSprite,
  PackArtIndex,
  UiFile,
} from "./assets.ts";
export { ASSET_INDEX_FILE } from "./assets.ts";
export { churchMapData, jailMapData, seedMapData } from "./generated/index.ts";
export { type PanelTab, TAB_ART, TAB_HIT, TAB_ROW_Y, type TabArt } from "./panel-tabs.ts";
