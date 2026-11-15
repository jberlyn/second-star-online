/**
 * The archive's NPC files as text (schema/npcfiles.ts). Kept off the package index:
 * only the server reads them (the NPC editor's LOAD and the NPC file store).
 */
export type { NpcFilesData, NpcFileText } from "../schema/npcfiles.ts";
export { npcFilesData } from "./generated/npcfiles.ts";
