/**
 * The NPC file store: every NPC data file (1.6 kept one text file per NPC), parsed, keyed by
 * lower-case name (the original Windows file lookup ignored case). It starts as the archive's
 * files and takes the NPC editor's saves on top (`npc_files`, persistence), so the shops, Bio
 * windows, chatter, flags, monster spells and drops all read one current copy.
 */
import { npcFilesData } from "@secondstaronline/data/npcfiles";
import { type NpcFile, parseNpcFile } from "@secondstaronline/shared";

export type NpcStore = Map<string, NpcFile>;

/** The seeded NPC files. */
export function archiveNpcStore(): NpcStore {
  return new Map(
    npcFilesData.files.map((f) => [f.name.toLowerCase(), parseNpcFile(f.name, f.text)]),
  );
}

/** Puts a file in the store (an editor save, or a saved override at start-up). */
export function setNpcFile(store: NpcStore, name: string, text: string): NpcFile {
  const f = parseNpcFile(name, text);
  store.set(name.toLowerCase(), f);
  return f;
}

/** The file by name, empty or not; null when there is none. */
export function npcFileNamed(store: NpcStore, name: string): NpcFile | null {
  return store.get(name.toLowerCase()) ?? null;
}

/** The NPC data a slot holds, or null when it is EMPTY: no file, or a 0-byte one. */
export function npcData(store: NpcStore, name: string): NpcFile | null {
  const f = npcFileNamed(store, name);
  return f && !f.empty ? f : null;
}

/** The NPC's data contains `FLG|<flag>`. */
export function hasFlag(store: NpcStore, name: string, flag: string): boolean {
  return (npcData(store, name)?.flags ?? []).some((f) =>
    f.toLowerCase().includes(`flg|${flag}`.toLowerCase()),
  );
}
