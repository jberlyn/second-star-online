/**
 * Schema for the NPC files as text: every `DAT/NPC/<name>.txt` of the archive, lines joined by
 * CR as the server's line reader reads them, from npcs.json's `fileText`. The server parses
 * these (and the NPC editor's saved overrides) with `parseNpcFile`
 * (shared/rules/admin/npcfile.ts); the NPC editor's LOAD shows them. Server only: imported
 * through `@secondstaronline/data/npcfiles`.
 */
import { z } from "zod";

export const npcFileTextSchema = z.strictObject({
  /** The file name without `.txt` (the nameless `.txt` is left out: no species opens it). */
  name: z.string().min(1),
  /** CR-separated lines; "" for a 0-byte file. */
  text: z.string(),
});

export const npcFilesDataSchema = z.strictObject({ files: z.array(npcFileTextSchema) });

export type NpcFileText = z.infer<typeof npcFileTextSchema>;
export type NpcFilesData = z.infer<typeof npcFilesDataSchema>;
