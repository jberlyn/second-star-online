/**
 * The wire protocol: JSON over WebSocket.
 *
 * Client → server messages are intents only, and each has a strict Zod schema; the gateway
 * drops anything that does not parse. Server → client messages are plain types: the server
 * builds them, so they need no runtime check.
 *
 * Identity comes from the authenticated session, never from a message.
 */
import { z } from "zod";

import {
  type AdminServerMsg,
  activityQuerySchema,
  characterEditSchema,
  characterModerateSchema,
  characterOpenSchema,
  characterSearchSchema,
  characterUndoSchema,
  controlPanelOpenSchema,
  editCloseSchema,
  editLoadSchema,
  editOpenSchema,
  type editorMapSchema,
  editSaveSchema,
  npcEditOpenSchema,
  npcLoadSchema,
  npcSaveSchema,
  roleAssignSchema,
  roleDeleteSchema,
  roleSaveSchema,
  settingsCloseSchema,
  settingsOpenSchema,
  settingsSaveSchema,
} from "./admin.ts";
import {
  bjBidSchema,
  bjHitSchema,
  bjLeaveSchema,
  bjStandSchema,
  type CasinoServerMsg,
  ckCloseSchema,
  ckMoveSchema,
  slotCloseSchema,
  slotPullSchema,
} from "./casino.ts";
import {
  awaySchema,
  type ChatServerMsg,
  chatSchema,
  imSchema,
  roomEnterSchema,
  roomLeaveSchema,
  roomSaySchema,
} from "./chat.ts";
import { attackSchema } from "./combat.ts";
import {
  type ContentServerMsg,
  contentBodyArtSchema,
  contentBodySchema,
  contentBodySheetSchema,
  contentDiscardSchema,
  contentDraftSchema,
  contentItemArtSchema,
  contentListSchema,
  contentNoticeSchema,
  contentOverviewSchema,
  contentPictureSchema,
  contentProblemsSchema,
  contentPublishSchema,
  contentRemoveSchema,
  contentRowSchema,
  contentUndoSchema,
  contentUploadTicketSchema,
  contentUsageSchema,
  contentWornArtSchema,
  contentWornSchema,
  contentWornSheetSchema,
} from "./content.ts";
import {
  type CoreServerMsg,
  createSchema,
  loginSchema,
  logoutSchema,
  mapReadySchema,
  moveSchema,
  resumeSchema,
  stepSchema,
} from "./core.ts";
import {
  buySchema,
  type EconomyServerMsg,
  npcClickSchema,
  npcCloseSchema,
  sellSchema,
  shopCancelSchema,
  shopListSchema,
  tradeAcceptSchema,
  tradeCancelSchema,
  tradeOfferSchema,
  tradeOpenSchema,
  trainSchema,
  vaultTakeSchema,
} from "./economy.ts";
import { type HousingServerMsg, placeCancelSchema, placeHouseSchema } from "./housing.ts";
import {
  actionSchema,
  arrangeSchema,
  craftSchema,
  crystalsSchema,
  dropSchema,
  equipSchema,
  giveSchema,
  goldSchema,
  type InventoryServerMsg,
  pickupSchema,
  storageSchema,
  unequipSchema,
  useSchema,
} from "./inventory.ts";
import {
  artSaveSchema,
  boardCloseSchema,
  boardPostSchema,
  type MailServerMsg,
  mailDeleteSchema,
  mailSendSchema,
  mailUiSchema,
  newspaperLoadSchema,
  newspaperSaveSchema,
  paintUiSchema,
  viewCloseSchema,
} from "./mail.ts";
import {
  ignoreAddSchema,
  ignoreRemoveSchema,
  type PreferencesServerMsg,
  prefsSaveSchema,
  whoOpenSchema,
} from "./preferences.ts";
import {
  assassinGameSchema,
  bioRequestSchema,
  friendRemoveSchema,
  guildActionSchema,
  guildCloseSchema,
  guildCreateSchema,
  guildViewSchema,
  profileSaveSchema,
  type SocialServerMsg,
} from "./social.ts";
import { castSchema, type SpellsServerMsg } from "./spells.ts";

/** Before login: only these are accepted. */
export const preAuthSchema = z.discriminatedUnion("t", [loginSchema, createSchema, resumeSchema]);
/** In game. */
export const inGameSchema = z.discriminatedUnion("t", [
  moveSchema,
  stepSchema,
  mapReadySchema,
  logoutSchema,
  chatSchema,
  attackSchema,
  useSchema,
  equipSchema,
  dropSchema,
  giveSchema,
  arrangeSchema,
  craftSchema,
  storageSchema,
  placeHouseSchema,
  placeCancelSchema,
  unequipSchema,
  pickupSchema,
  actionSchema,
  crystalsSchema,
  goldSchema,
  npcClickSchema,
  npcCloseSchema,
  shopListSchema,
  trainSchema,
  buySchema,
  sellSchema,
  shopCancelSchema,
  vaultTakeSchema,
  tradeOpenSchema,
  tradeOfferSchema,
  tradeAcceptSchema,
  tradeCancelSchema,
  castSchema,
  editOpenSchema,
  editLoadSchema,
  editSaveSchema,
  editCloseSchema,
  npcEditOpenSchema,
  npcLoadSchema,
  npcSaveSchema,
  controlPanelOpenSchema,
  settingsOpenSchema,
  settingsSaveSchema,
  settingsCloseSchema,
  roleSaveSchema,
  roleDeleteSchema,
  roleAssignSchema,
  activityQuerySchema,
  contentOverviewSchema,
  contentListSchema,
  contentRowSchema,
  contentDraftSchema,
  contentDiscardSchema,
  contentPublishSchema,
  contentUndoSchema,
  contentNoticeSchema,
  contentUsageSchema,
  contentRemoveSchema,
  contentProblemsSchema,
  contentUploadTicketSchema,
  contentItemArtSchema,
  contentPictureSchema,
  contentWornArtSchema,
  contentWornSheetSchema,
  contentWornSchema,
  contentBodyArtSchema,
  contentBodySheetSchema,
  contentBodySchema,
  characterSearchSchema,
  characterOpenSchema,
  characterModerateSchema,
  characterEditSchema,
  characterUndoSchema,
  assassinGameSchema,
  guildCreateSchema,
  guildCloseSchema,
  slotPullSchema,
  slotCloseSchema,
  bjBidSchema,
  bjHitSchema,
  bjStandSchema,
  bjLeaveSchema,
  ckMoveSchema,
  ckCloseSchema,
  guildViewSchema,
  guildActionSchema,
  mailUiSchema,
  mailSendSchema,
  mailDeleteSchema,
  boardPostSchema,
  boardCloseSchema,
  paintUiSchema,
  viewCloseSchema,
  artSaveSchema,
  newspaperLoadSchema,
  newspaperSaveSchema,
  imSchema,
  awaySchema,
  roomEnterSchema,
  roomLeaveSchema,
  roomSaySchema,
  bioRequestSchema,
  profileSaveSchema,
  friendRemoveSchema,
  prefsSaveSchema,
  ignoreAddSchema,
  ignoreRemoveSchema,
  whoOpenSchema,
]);

export type LoginMsg = z.infer<typeof loginSchema>;
export type CreateMsg = z.infer<typeof createSchema>;
export type ResumeMsg = z.infer<typeof resumeSchema>;
export type MoveMsg = z.infer<typeof moveSchema>;
export type StepMsg = z.infer<typeof stepSchema>;
export type ChatMsg = z.infer<typeof chatSchema>;
export type AttackMsg = z.infer<typeof attackSchema>;
export type ItemMsg = z.infer<
  | typeof useSchema
  | typeof equipSchema
  | typeof dropSchema
  | typeof giveSchema
  | typeof arrangeSchema
  | typeof craftSchema
  | typeof storageSchema
  | typeof unequipSchema
  | typeof pickupSchema
  | typeof actionSchema
  | typeof crystalsSchema
  | typeof goldSchema
>;
export type CastMsg = z.infer<typeof castSchema>;
export type EditorMapMsg = z.infer<typeof editorMapSchema>;
export type TradeOfferMsg = z.infer<typeof tradeOfferSchema>;
export type PreAuthMsg = z.infer<typeof preAuthSchema>;
export type InGameMsg = z.infer<typeof inGameSchema>;
export type ClientMsg = PreAuthMsg | InGameMsg;

/** Every server → client message, by system. */
export type ServerMsg =
  | CoreServerMsg
  | InventoryServerMsg
  | HousingServerMsg
  | EconomyServerMsg
  | SpellsServerMsg
  | ChatServerMsg
  | AdminServerMsg
  | ContentServerMsg
  | SocialServerMsg
  | CasinoServerMsg
  | MailServerMsg
  | PreferencesServerMsg;
