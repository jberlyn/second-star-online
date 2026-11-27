/**
 * The Monsters page's NPC file sections on the server (issue #31, stage 3): a monster's drop lines
 * (`INV|`), the monster spells it casts (`SPL|`) and its flags (`FLG|`), read and written in
 * structured form.
 *
 * - They live in the monster's NPC file, so a save takes the NPCs page's path: it applies at once,
 *   outside the draft, keeps the file it replaced as a version, and starts the NPC's shop again from
 *   the saved file (with the live stock written in, as an NPCs page save does).
 * - Every other line of the file, and every line ending, stays as it was (`withNpcSections`).
 * - A save names the revision of the file it was made from: one the NPCs page, a publish or another
 *   page changed since is refused. Shop sales do not change the revision.
 * - A file is attached (made) only for a monster the content has; an existing file of any name can
 *   be edited.
 */
import {
  type ContentNpcFileView,
  checkNpcFile,
  content,
  editorLines,
  NPC_MAX_LINES,
  type NpcSections,
  npcFieldOk,
  npcSections,
  resolveNpcItemNames,
  withNpcSections,
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

export { npcFileRevision };

/** The name the page edits: the file's own spelling, else the monster's; null for neither. */
function editable(world: World, name: string): { name: string; text: string | null } | null {
  // A player shop's file is its owner's ledger, never content.
  if (world.playerShops.has(name.toLowerCase())) {
    return null;
  }
  const f = npcFileNamed(world.npcs, name);
  if (f) {
    return { name: f.name, text: f.text };
  }
  const m = content().monster(name);
  return m ? { name: m.name, text: null } : null;
}

/** The view of a monster's NPC file sections, or null when the name is neither a monster nor a file. */
export function npcFileView(world: World, name: string): ContentNpcFileView | null {
  const e = editable(world, name.trim());
  if (!e) {
    return null;
  }
  const text = e.text ?? "";
  const s = npcSections(text);
  return {
    name: e.name,
    exists: e.text !== null,
    revision: e.text === null ? null : npcFileRevision(e.text),
    loot: s.loot,
    spells: s.spells,
    flags: s.flags,
    mixed: s.mixed,
    lines: editorLines(text).length,
    maxLines: NPC_MAX_LINES,
    spellTags: content().monsters.casting.spells.map((x) => x.tag),
  };
}

/**
 * The drop lines with their items by key, in the key's spelling ("15 gold" → "15 Gold", a display
 * name → the key); a name no item has stays, for the file check to refuse. An entry the file already
 * has is left as written, so an unchanged line keeps its text.
 */
function resolvedLoot(loot: NpcSections["loot"], had: NpcSections["loot"]): NpcSections["loot"] {
  return loot.map((l) => {
    if (had.some((h) => h.item === l.item && h.oneIn === l.oneIn)) {
      return l;
    }
    const line = resolveNpcItemNames([`INV|${l.item}:${l.oneIn}`])[0] as string;
    const got = npcSections(line).loot[0] ?? l;
    const m = /^(\d+ )?(.+)$/.exec(got.item);
    const item = m ? content().item(m[2] as string) : undefined;
    return item ? { item: `${m?.[1] ?? ""}${item.name}`, oneIn: got.oneIn } : got;
  });
}

export interface NpcSectionsSave {
  out: Outgoing[];
  /** What to write in the caller's one transaction, or null when nothing changed or it was refused. */
  save: NpcSave | null;
  ok: boolean;
  text: string;
}

/**
 * A save of the sections. The caller writes `save` (file, the version it replaced, the dropped shop
 * ledger and an audit line) in one transaction, as for an NPCs page save.
 */
export function saveNpcSections(
  world: World,
  name: string,
  expect: string | null,
  next: NpcSections,
  ledgerOf: LedgerOf,
): NpcSectionsSave {
  const refuse = (text: string): NpcSectionsSave => ({ out: [], save: null, ok: false, text });
  const e = editable(world, name.trim());
  if (!e) {
    return refuse(`There is no monster or NPC file named ${name}.`);
  }
  const revision = e.text === null ? null : npcFileRevision(e.text);
  if (revision !== expect) {
    return refuse(
      `${e.name}'s NPC file changed since you opened it (a Talk & Shops save or a publish): open it again before saving.`,
    );
  }
  const tags = content().monsters.casting.spells.map((x) => x.tag.toLowerCase());
  const unknown = next.spells.find((t) => !tags.includes(t.toLowerCase()));
  if (unknown !== undefined) {
    return refuse(`Spells: "${unknown}" is not a monster spell.`);
  }
  // Each field is one line of its own: a line break would add a line outside the sections.
  const fields = [
    ...next.loot.map((l) => ["Loot", l.item] as const),
    ...next.spells.map((t) => ["Spells", t] as const),
    ...next.flags.map((f) => ["Flags", f] as const),
  ];
  const bad = fields.find(([, v]) => v.trim() === "" || !npcFieldOk(v));
  if (bad) {
    return refuse(`${bad[0]}: "${bad[1]}" must be one line, without | : \` * or ^.`);
  }
  const badChance = next.loot.find((l) => !Number.isSafeInteger(l.oneIn) || l.oneIn < 1);
  if (badChance) {
    return refuse(`Loot: the chance for ${badChance.item} is a whole number from 1.`);
  }
  // The save is made from the file as LOAD shows it, live stock written in, as the NPCs page's is.
  const live = e.text === null ? "" : npcFileNow(world, e.name, ledgerOf);
  if (npcSections(live).mixed.length > 0) {
    return refuse(
      `Line ${npcSections(live).mixed[0]} of ${e.name}'s NPC file is read as two sections at once: take that line out on the Talk & Shops tab first.`,
    );
  }
  const text = withNpcSections(live, {
    ...next,
    loot: resolvedLoot(next.loot, npcSections(live).loot),
  });
  if (e.text !== null && text === live) {
    return { out: [], save: null, ok: true, text: "Nothing to save: the file is unchanged." };
  }
  const check = checkNpcFile(editorLines(text));
  if (check.error) {
    return refuse(`The NPC file would be refused: ${check.error}`);
  }
  setNpcFile(world.npcs, e.name, text);
  world.shops.delete(e.name);
  const out = closeNpcWindows(world, e.name);
  const saved = `Saved ${e.name}'s NPC file: it is live now.`;
  return {
    out,
    save: { npc: e.name, text, previous: live },
    ok: true,
    text: [saved, ...check.warnings].join("\n"),
  };
}
