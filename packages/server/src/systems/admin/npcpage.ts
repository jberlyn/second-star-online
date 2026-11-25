/**
 * The Control Panel's NPCs page on the server (issue #32): every NPC file and every name an editor
 * list or a species gives, the open file as LOAD shows it (live stock and gold written in) with its
 * revision, and its save, checked and written as the NPC Editor's SAVE is.
 *
 * - The page edits the whole file in structured form (the client's `npcModel`) or as text; what it
 *   sends is the file's text, so the server's one check (`checkNpcFile`) covers both.
 * - A save names the revision it started from; one over a file changed since (another admin, the
 *   Monsters page, a publish) is refused. A new file needs no revision.
 * - A player shop's file is its owner's ledger and is never shown or saved here.
 */
import {
  type ContentNpcsView,
  type ContentNpcView,
  checkNpcFile,
  content,
  editorLines,
  lingoEq,
  NPC_EDIT_TEXT,
  type NpcListEntry,
  npcModel,
  resolveNpcItemNames,
} from "@secondstaronline/shared";

import { npcFileNamed, setNpcFile } from "../monsters/npcfiles.ts";
import type { Outgoing, World } from "../world/world.ts";
import {
  closeNpcWindows,
  type LedgerOf,
  type NpcSave,
  npcFileNow,
  npcFileRevision,
} from "./npcedit.ts";

/** The names the page can open: files, editor-list names and species, player shops left out. */
function pageNames(world: World): Map<string, string> {
  const out = new Map<string, string>();
  const add = (n: string) => {
    const k = n.toLowerCase();
    if (n.trim() !== "" && !world.playerShops.has(k) && !out.has(k)) {
      out.set(k, n);
    }
  };
  for (const f of world.npcs.values()) {
    add(f.name);
  }
  const lists = content().monsters.editorLists;
  for (const n of [
    ...lists.npcEditor.npcs,
    ...lists.npcEditor.monsters,
    ...lists.worldEditor.npcs,
    ...lists.worldEditor.monsters,
  ]) {
    add(n);
  }
  for (const m of content().monsters.monsters) {
    add(m.name);
  }
  return out;
}

/** The name as the page spells it (its file's, else its list's or species'), or null. */
export function npcPageName(world: World, name: string): string | null {
  const k = name.trim().toLowerCase();
  if (k === "" || world.playerShops.has(k)) {
    return null;
  }
  return npcFileNamed(world.npcs, k)?.name ?? pageNames(world).get(k) ?? null;
}

/** The list: every name, with what its file makes it. */
export function npcList(world: World): NpcListEntry[] {
  const lists = content().monsters.editorLists;
  const on = (names: readonly string[], n: string) => names.some((x) => lingoEq(x, n));
  return [...pageNames(world).values()]
    .map((name): NpcListEntry => {
      const f = npcFileNamed(world.npcs, name);
      const m = f ? npcModel(f.text) : null;
      return {
        name,
        file: f !== null,
        npc: on(lists.npcEditor.npcs, name) || on(lists.worldEditor.npcs, name),
        species: content().monster(name) !== undefined,
        shop: (m?.sells.length ?? 0) + (m?.buys.length ?? 0) > 0,
        banker: (m?.banker.length ?? 0) > 0,
        trainer: (m?.trains.length ?? 0) > 0,
        loot: (m?.loot.length ?? 0) > 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The open file, as LOAD shows it, with its revision. */
export function npcPageFile(world: World, name: string, ledgerOf: LedgerOf): ContentNpcView | null {
  const n = npcPageName(world, name);
  if (!n) {
    return null;
  }
  const f = npcFileNamed(world.npcs, n);
  return {
    name: n,
    exists: f !== null,
    revision: f ? npcFileRevision(f.text) : null,
    text: f ? npcFileNow(world, f.name, ledgerOf) : "",
    species: content().monster(n) !== undefined,
  };
}

/** The page's view: the list, and with `name` the open file. */
export function npcPageView(world: World, ledgerOf: LedgerOf, name?: string): ContentNpcsView {
  const c = content();
  return {
    npcs: npcList(world),
    npc: name === undefined ? null : npcPageFile(world, name, ledgerOf),
    choices: {
      items: c.items.items
        .filter((i) => !i.retired)
        .map((i) => i.name)
        .sort(),
      classes: c.classes.classes.filter((x) => x.promotion).map((x) => x.name),
      spellTags: c.monsters.casting.spells.map((s) => s.tag),
    },
  };
}

export interface NpcPageSave {
  out: Outgoing[];
  /** What to write in the caller's one transaction, or null when nothing changed or it was refused. */
  save: NpcSave | null;
  ok: boolean;
  text: string;
}

/**
 * The page's save: the file's text, checked as an NPC Editor SAVE is (display names resolved to
 * keys, then `checkNpcFile`). The caller writes `save` (the file, the version it replaced, the
 * dropped shop ledger and an audit line) in one transaction.
 */
export function saveNpcPage(
  world: World,
  name: string,
  text: string,
  expect: string | null,
  ledgerOf: LedgerOf,
): NpcPageSave {
  const refuse = (why: string): NpcPageSave => ({ out: [], save: null, ok: false, text: why });
  const n = npcPageName(world, name);
  if (!n) {
    return refuse(`There is no NPC named ${name} to edit here.`);
  }
  const f = npcFileNamed(world.npcs, n);
  const revision = f ? npcFileRevision(f.text) : null;
  if (revision !== expect) {
    return refuse(
      `${n}'s NPC file changed since you opened it (another admin, the Monsters page or a publish): open it again before saving.`,
    );
  }
  const lines = resolveNpcItemNames(editorLines(text));
  const check = checkNpcFile(lines);
  if (check.error) {
    return refuse(NPC_EDIT_TEXT.refused(check.error));
  }
  const saved = lines.join("\r");
  const previous = f ? npcFileNow(world, f.name, ledgerOf) : "";
  // Unchanged from the file as the page showed it (live stock and gold included): nothing to do.
  // A stock or till set back to the stored number still saves, and resets the live shop.
  if (f && saved === editorLines(previous).join("\r")) {
    return { out: [], save: null, ok: true, text: "Nothing to save: the file is unchanged." };
  }
  setNpcFile(world.npcs, n, saved);
  // The ledger starts again from the saved file.
  world.shops.delete(n);
  return {
    out: closeNpcWindows(world, n),
    save: { npc: n, text: saved, previous },
    ok: true,
    text: [`Saved ${n}'s NPC file: it is live now.`, ...check.warnings].join("\n"),
  };
}
