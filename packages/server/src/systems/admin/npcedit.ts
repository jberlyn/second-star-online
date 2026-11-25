/**
 * What every NPC file save shares (the Control Panel's NPCs page, issue #32, and the Monsters
 * page's NPC file section, #31): the file as LOAD showed it in 1.6 (with the shop's live stock and
 * gold written in: in 1.6 the file was the ledger), its revision, closing the NPC's open windows,
 * and what a save writes. The floating NPC Editor (frame 311) these began in is retired (#32).
 */
import { lingoEq, liveNpcText } from "@secondstaronline/shared";

import type { ShopLedger } from "../economy/shop.ts";
import { npcFileNamed } from "../monsters/npcfiles.ts";
import type { Outgoing, World } from "../world/world.ts";

/** The shop ledger an NPC has now (in memory or saved), or null: never makes one. */
export type LedgerOf = (npc: string) => ShopLedger | null;

/** The file as an editor shows it: live stock and gold written in. */
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
  /** The file name (the store's spelling when it has the file, else the name saved). */
  npc: string;
  text: string;
  /** The file as it was (as an editor showed it), kept as a version. */
  previous: string;
}
