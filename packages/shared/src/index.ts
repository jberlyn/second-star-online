/** @secondstaronline/shared: protocol, constants and pure rules shared by server and client. */
export {
  MAP_HEIGHT,
  MAP_WIDTH,
  STEPFRAMES_PER_FRAME,
  TICK_HZ,
  TICK_MS,
  TILE_PX,
} from "./constants.ts";
export * from "./content/balance.ts";
export * from "./content/bodies.ts";
export * from "./content/fx.ts";
export * from "./content/picture.ts";
export * from "./content/sounds.ts";
export * from "./content/store.ts";
export * from "./content/tiles.ts";
export * from "./content/worn.ts";
export * from "./protocol/index.ts";
export * from "./rules/admin/activity.ts";
export * from "./rules/admin/admin.ts";
export * from "./rules/admin/auditlog.ts";
export * from "./rules/admin/character-edit.ts";
export * from "./rules/admin/characters.ts";
export * from "./rules/admin/chatlog.ts";
export * from "./rules/admin/moderation.ts";
export * from "./rules/admin/npcfile.ts";
// Bindings a module fills when content is installed (`export let ... onContent`), named again.
// `bun run dev` bundles `export *` as an object spread, which copies each value once, before any
// content is installed; a named re-export stays a live getter (tests/live-bindings.test.ts).
export {
  NPC_EDITOR_MONSTERS,
  NPC_EDITOR_NPCS,
  NPC_SPELL_TAGS,
} from "./rules/admin/npcfile.ts";
export * from "./rules/admin/permissions.ts";
export * from "./rules/admin/worldedit.ts";
export {
  EDITOR_ITEMS,
  EDITOR_MONSTERS,
  EDITOR_NPCS,
  PALETTE_CODES,
  PALETTE_PAGES,
} from "./rules/admin/worldedit.ts";
export * from "./rules/casino/blackjack.ts";
export {
  BJ_BID_BLOCK,
  BJ_BUTTON_BLOCK,
  BJ_HAND_SIZE,
  BJ_MAX_BID,
  BJ_RESET_FRAMES,
  BJ_TEXT,
} from "./rules/casino/blackjack.ts";
export * from "./rules/casino/casino.ts";
export {
  SLOT_CASH,
  SLOT_COST,
  SLOT_FACES,
  SLOT_FX,
  SLOT_SPIN_FRAMES,
  SLOT_TEXT,
} from "./rules/casino/casino.ts";
export * from "./rules/casino/checkers.ts";
export {
  CK_MARKER,
  CK_TEXT,
} from "./rules/casino/checkers.ts";
export * from "./rules/chat/chat.ts";
export * from "./rules/chat/ignore.ts";
export * from "./rules/chat/im.ts";
export {
  CHAT_SOCIAL_TEXT,
  IM_SLOTS,
} from "./rules/chat/im.ts";
export * from "./rules/chat/rooms.ts";
export { ROOM_KEYS } from "./rules/chat/rooms.ts";
export * from "./rules/combat/arena.ts";
export * from "./rules/combat/armour.ts";
export * from "./rules/combat/attpower.ts";
export * from "./rules/combat/combat.ts";
export * from "./rules/combat/gear.ts";
export * from "./rules/core/fighter.ts";
export { SKILL_KEYS } from "./rules/core/fighter.ts";
export * from "./rules/core/fixtures.ts";
export {
  lingoContains,
  lingoDiv,
  lingoEq,
  lingoInteger,
  lingoWord,
  type Rng,
} from "./rules/core/lingo.ts";
export * from "./rules/core/maps.ts";
export * from "./rules/core/patterns.ts";
export * from "./rules/core/preferences.ts";
export * from "./rules/core/requirements.ts";
export * from "./rules/core/tiles.ts";
export { TILE_DEFAULTS } from "./rules/core/tiles.ts";
export * from "./rules/core/timelength.ts";
export {
  AIRSHIP_BLOCK,
  airshipWalkGrid,
  footBlocked,
  footWalkGrid,
  isWalkable,
  isWhitelisted,
  shipWalkGrid,
  WALK_WHITELIST,
} from "./rules/core/walk.ts";
export * from "./rules/crafting/craft.ts";
export {
  CAULDRON,
  CRAFT_ORDER,
  CRAFT_TEXT,
  SMITH_FX_CHANCE,
} from "./rules/crafting/craft.ts";
export * from "./rules/crafting/gather.ts";
export {
  ANTI_MACRO_START,
  FISHING_LAYERS,
  FISHING_STOPPED_TEXT,
  GATHER_TEXT,
  RUMOUR_NPCS,
  SEED_PAUSE,
  SPRINKLE_FX,
  TREASURE,
  WATERING_SKILL,
} from "./rules/crafting/gather.ts";
export * from "./rules/economy/playershop.ts";
export * from "./rules/economy/quests.ts";
export {
  ORAKU,
  QUEST_LINES,
} from "./rules/economy/quests.ts";
export * from "./rules/housing/doors.ts";
export {
  HOUSE_KEY_PAUSE,
  KEY_PAUSE,
  KEY_TEXT,
  QUEST_SAVE_BLOCK,
  RELOCK_FRAMES,
  SWITCH_PAUSE,
  SWITCH_TEXT,
} from "./rules/housing/doors.ts";
export * from "./rules/housing/houses.ts";
export {
  HOUSE_CLOCK_FRAMES,
  HOUSE_STALE_MONTHS,
  REST_REGEN,
} from "./rules/housing/houses.ts";
export * from "./rules/inventory/behaviours.ts";
export * from "./rules/inventory/equip.ts";
export * from "./rules/inventory/ground.ts";
export * from "./rules/inventory/inventory.ts";
export {
  CURRENCY,
  ID_CONTAINERS,
} from "./rules/inventory/inventory.ts";
export * from "./rules/inventory/paperdoll.ts";
export * from "./rules/mail/mail.ts";
export {
  BOARD_TEXT,
  MAIL_RECIPIENTS,
  MAIL_TEXT,
} from "./rules/mail/mail.ts";
export * from "./rules/mail/newspaper.ts";
export {
  NEWS_DEFAULTS,
  NEWS_TEXT,
  STAND_TILE,
} from "./rules/mail/newspaper.ts";
export * from "./rules/mail/paint.ts";
export {
  ART_TEXT,
  LENS,
  PAINT_SCALE,
  PAINT_SIZE,
} from "./rules/mail/paint.ts";
export * from "./rules/monsters/flags.ts";
export * from "./rules/monsters/loot.ts";
export * from "./rules/movement/movement.ts";
export * from "./rules/progression/creation.ts";
export {
  SEXES,
  START_CLASSES,
} from "./rules/progression/creation.ts";
export * from "./rules/progression/medals.ts";
export { MEDAL_AT } from "./rules/progression/medals.ts";
export * from "./rules/progression/progress.ts";
export * from "./rules/progression/progression.ts";
export * from "./rules/progression/promotion.ts";
export * from "./rules/progression/skillgain.ts";
export * from "./rules/progression/stats.ts";
export * from "./rules/social/assassin.ts";
export {
  ARCHIVED_PRIZES,
  STATUE_ITEM,
  STATUE_PAUSE,
  STATUE_TEXT,
} from "./rules/social/assassin.ts";
export * from "./rules/social/bios.ts";
export {
  BIO_TEXT,
  LAST_NAME,
  MEDAL_SLOT_WIDTH,
} from "./rules/social/bios.ts";
export * from "./rules/social/buddies.ts";
export { BUDDY_TEXT } from "./rules/social/buddies.ts";
export * from "./rules/social/factions.ts";
export * from "./rules/social/guilds.ts";
export {
  GUILD_DEFAULT_NAME,
  GUILD_LIST_MAX,
  GUILD_NAME_MAX,
  GUILD_TEXT,
} from "./rules/social/guilds.ts";
export * from "./rules/social/highscores.ts";
export {
  SCORES_ITEM,
  SCORES_PAUSE,
  SCORES_SIZE,
  SCORES_TEXT,
} from "./rules/social/highscores.ts";
export * from "./rules/spells/spellfx.ts";
export * from "./rules/spells/spells.ts";
export * from "./rules/vehicles/cannon.ts";
export * from "./rules/vehicles/vehicles.ts";
export { VEHICLE_BODY } from "./rules/vehicles/vehicles.ts";
