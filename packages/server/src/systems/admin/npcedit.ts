/**
 * The NPC editor on the server.
 *
 * - Open: the `npcEditor` permission only; you leave the map as for the World Editor.
 * - LOAD: the file as the server holds it, with the shop's live stock and gold written in (in 1.6
 *   the file was the ledger); "" with no file. The client shows it through the editor's display routine.
 * - SAVE: checked line by line (`checkNpcFile`), then the file replaces the NPC's, its shop ledger
 *   starts again from the saved numbers, and everything reads it at once; the NPC's open Bio and
 *   shop windows close.
 *
 * Only the names on the editor's two lists are loaded or saved, and nothing happens with no name
 * selected. 1.6 read and wrote whatever name was selected, including the nameless `.txt` and names
 * left over from play.
 */
import {
  can,
  checkNpcFile,
  editorLines,
  lingoEq,
  liveNpcText,
  NPC_EDIT_TEXT,
  NPC_MAX_LINES,
  npcEditorName,
  resolveNpcItemNames,
} from "@secondstaronline/shared";

import type { CasinoDeps } from "../casino/index.ts";
import type { ShopLedger } from "../economy/shop.ts";
import { npcFileNamed, setNpcFile } from "../monsters/npcfiles.ts";
import type { Outgoing, Player, World } from "../world/world.ts";
import { leaveForEditor } from "./worldedit.ts";

/** Admin menu → NPC Editor. Anyone without `npcEditor` gets nothing. */
export function openNpcEditor(world: World, p: Player, casino: CasinoDeps): Outgoing[] {
  if (!can(p.role, "npcEditor") || p.editing === "npc") {
    return [];
  }
  const out = leaveForEditor(world, p, "npc", casino);
  out.push({ to: p.id, msg: { t: "npcEditor" } });
  return out;
}

const inEditor = (p: Player) => can(p.role, "npcEditor") && p.editing === "npc";

/** The shop ledger an NPC has now (in memory or saved), or null: never makes one. */
export type LedgerOf = (npc: string) => ShopLedger | null;

/** The file as LOAD shows it before the editor's display routine: live stock and gold written in. */
export function npcFileNow(world: World, name: string, ledgerOf: LedgerOf): string {
  const f = npcFileNamed(world.npcs, name);
  return f ? liveNpcText(f, ledgerOf(f.name)) : "";
}

/** A file's revision: 16 hex digits of its text's hash (no file reads as ""). */
export function npcFileRevision(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);
}

/** The revision of an NPC's file as it stands (shop sales leave it as it is). */
export function npcRevisionOf(world: World, name: string): string {
  return npcFileRevision(npcFileNamed(world.npcs, name)?.text ?? "");
}

/** LOAD. */
export function loadNpc(world: World, p: Player, name: string, ledgerOf: LedgerOf): Outgoing[] {
  const listed = npcEditorName(name);
  if (!inEditor(p) || !listed) {
    return [];
  }
  const text = npcFileNow(world, listed, ledgerOf);
  const out: Outgoing[] = [
    {
      to: p.id,
      msg: { t: "npcScript", name: listed, text, revision: npcRevisionOf(world, listed) },
    },
  ];
  // LOAD shows every line, but SAVE refuses more than NPC_MAX_LINES: say so before the edit.
  const lines = editorLines(text).length;
  if (lines > NPC_MAX_LINES) {
    out.push({ to: p.id, msg: { t: "alert", text: NPC_EDIT_TEXT.tooLong(lines) } });
  }
  return out;
}

/**
 * Closes every open Bio window and shop list of `npc` (also for a player shop's `set` and `remove`,
 * which move its lines).
 */
export function closeNpcWindows(world: World, npc: string): Outgoing[] {
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    const open = (o.shop && lingoEq(o.shop.npc, npc)) || (o.bio && lingoEq(o.bio.npc, npc));
    if (open) {
      o.shop = null;
      o.vaultOpen = false;
      o.bio = null;
      o.keyLock = false;
      out.push({ to: o.id, msg: { t: "npcClosed" } });
    }
  }
  return out;
}

/** What a save writes, for the caller's one transaction. */
export interface NpcSave {
  /** The file name (the archive's spelling when it has the file, else the list's). */
  npc: string;
  text: string;
  /** The file as it was (LOAD's view), kept as a version. */
  previous: string;
}

/**
 * SAVE. Returns the replies, and what to write when the save went through. The caller writes
 * it and drops the stored ledger in one transaction.
 */
export function saveNpc(
  world: World,
  p: Player,
  name: string,
  text: string,
  ledgerOf: LedgerOf,
  expect?: string,
): { out: Outgoing[]; save: NpcSave | null } {
  const listed = npcEditorName(name);
  if (!inEditor(p) || !listed) {
    return { out: [], save: null };
  }
  // A save from a LOAD older than the file (the Monsters page or another admin saved it since) is
  // refused, so it never puts back what they changed. A file that exists is saved only over the
  // LOAD that showed it; one that does not yet exist may be made without a LOAD, as in 1.6.
  const exists = npcFileNamed(world.npcs, listed) !== null;
  if (
    (expect === undefined && exists) ||
    (expect !== undefined && expect !== npcRevisionOf(world, listed))
  ) {
    return {
      out: [
        {
          to: p.id,
          msg: {
            t: "alert",
            text: expect === undefined ? NPC_EDIT_TEXT.unloaded : NPC_EDIT_TEXT.stale,
          },
        },
      ],
      save: null,
    };
  }
  const lines = resolveNpcItemNames(editorLines(text));
  const check = checkNpcFile(lines);
  if (check.error) {
    return {
      out: [{ to: p.id, msg: { t: "alert", text: NPC_EDIT_TEXT.refused(check.error) } }],
      save: null,
    };
  }
  const npc = npcFileNamed(world.npcs, listed)?.name ?? listed;
  const previous = npcFileNow(world, npc, ledgerOf);
  const saved = lines.join("\r");
  setNpcFile(world.npcs, npc, saved);
  // The ledger starts again from the saved file.
  world.shops.delete(npc);
  const out: Outgoing[] = closeNpcWindows(world, npc);
  const alert = [NPC_EDIT_TEXT.saved, ...check.warnings].join("\n");
  out.push({
    to: p.id,
    msg: { t: "npcRevision", name: listed, revision: npcRevisionOf(world, npc) },
  });
  out.push({ to: p.id, msg: { t: "alert", text: alert } });
  return { out, save: { npc, text: saved, previous } };
}
