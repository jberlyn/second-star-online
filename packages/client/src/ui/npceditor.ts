/**
 * The NPC editor: frame 311 (assets/original/main/layout/frame-311.json), reached from the ≡ menu's
 * Admin section. The server checks everything a save holds.
 *
 * Sprites, each at its rect (bitmaps: loc − regpoint at the member's own size; fields: the
 * member's text box with the 16-px scroll bar to its right, `maxHeight` tall, as the 312-338
 * span stores the monster list, 108×166 — frame 311's 92×432 is stale):
 * - 1 background (Internal #224) [84, 103, 704, 296];
 * - 3 the monster list (#233) [100, 117, 208, 283] and 2 the NPC list (#225) [224, 117, 314, 283]:
 *   Arial 10 bold white, scroll fields that cannot be edited. A click highlights the line under the
 *   pointer, clears the other list's highlight and sets the name; below the last line the name is
 *   EMPTY and nothing stays lit.
 * - 7 the NPC script field (#228) [331, 115, 690, 254]: Arial 12 bold white, editable, scrolling;
 *   it starts as `INV|Broad Sword:1` and, being a cast member, keeps its text between visits.
 * - 4 LOAD (#226) [598, 263, 635, 282] and 5 SAVE (#227)
 *   [649, 263, 685, 282]. Neither plays a sound.
 * The frame shows nothing else: no chat, no way out but Return To Game.
 */
import { NPC_EDITOR_MONSTERS, NPC_EDITOR_NPCS, showNpcScript } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import type { Screen } from "./screens.ts";
import { artImg, type Rect, type StageItem } from "./stage.ts";

export interface NpcEditorActions {
  load(name: string): void;
  save(name: string, text: string): void;
}

export interface NpcEditor {
  screen: Screen;
  /** LOAD's reply (the loaded NPC's script). */
  showScript(text: string): void;
  /** The selected name, "" for none. */
  readonly name: string;
  /** The field's text. */
  readonly text: string;
}

/** The field's text before anything is loaded (the script field's own text). */
export const NPC_SCRIPT_DEFAULT = "INV|Broad Sword:1\n";

export const NPC_EDITOR_RECTS = {
  background: { x: 84, y: 103, w: 620, h: 193 },
  monsters: { x: 100, y: 117, w: 108, h: 166 },
  npcs: { x: 224, y: 117, w: 90, h: 166 },
  script: { x: 331, y: 115, w: 359, h: 139 },
  load: { x: 598, y: 263, w: 37, h: 19 },
  save: { x: 649, y: 263, w: 36, h: 19 },
} as const satisfies Record<string, Rect>;

/** A name list: a click highlights the line under the pointer. */
function nameList(
  label: string,
  origin: string,
  names: readonly string[],
  pick: (n: string) => void,
) {
  const box = action(document.createElement("div"), origin);
  box.className = "npced-list";
  box.setAttribute("role", "listbox");
  box.setAttribute("aria-label", label);
  const rows = names.map((n) => {
    const row = document.createElement("div");
    row.className = "npced-row";
    row.textContent = n;
    row.setAttribute("role", "option");
    box.append(row);
    return row;
  });
  const clear = () => {
    for (const r of rows) {
      r.classList.remove("on");
    }
  };
  box.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest(".npced-row");
    clear();
    if (row instanceof HTMLDivElement) {
      row.classList.add("on");
    }
    // A click below the last line clears the name.
    pick(row instanceof HTMLDivElement ? (row.textContent ?? "") : "");
  });
  return { box, clear };
}

export function createNpcEditor(assets: Assets, actions: NpcEditorActions): NpcEditor {
  const items: StageItem[] = [];
  const add = (el: HTMLElement, r: Rect, z: number, art = false) => {
    items.push({ el, ...r, z, art });
  };
  let name = "";

  add(artImg(assets.ui("internal", 224)), NPC_EDITOR_RECTS.background, 1, true);

  // Both lists set the selected name; each clears the other's highlight.
  const monsters = nameList("Monsters", "npc-editor-select-monster", NPC_EDITOR_MONSTERS, (n) => {
    name = n;
    npcs.clear();
  });
  const npcs = nameList("NPCs", "npc-editor-select-npc", NPC_EDITOR_NPCS, (n) => {
    name = n;
    monsters.clear();
  });
  add(monsters.box, NPC_EDITOR_RECTS.monsters, 3);
  add(npcs.box, NPC_EDITOR_RECTS.npcs, 2);

  const script = action(document.createElement("textarea"), "npc-editor-script");
  script.className = "npced-script";
  script.spellcheck = false;
  script.value = NPC_SCRIPT_DEFAULT;
  script.setAttribute("aria-label", "NPC script");
  add(script, NPC_EDITOR_RECTS.script, 7);

  const button = (m: number, label: string, r: Rect, z: number, onClick: () => void) => {
    const b = action(document.createElement("button"), `npc-editor-${label.toLowerCase()}`);
    b.type = "button";
    b.className = "hit npced-button";
    b.setAttribute("aria-label", label);
    b.append(artImg(assets.ui("internal", m), label));
    b.addEventListener("click", onClick);
    add(b, r, z);
  };
  // LOAD and SAVE send whatever name is selected; with none selected SSO sends nothing (the
  // server would ignore it).
  button(226, "LOAD", NPC_EDITOR_RECTS.load, 4, () => {
    if (name !== "") {
      actions.load(name);
    }
  });
  button(227, "SAVE", NPC_EDITOR_RECTS.save, 5, () => {
    if (name !== "") {
      actions.save(name, script.value);
    }
  });

  return {
    screen: { items },
    showScript(text) {
      script.value = showNpcScript(text).replace(/\r/g, "\n");
      script.scrollTop = 0;
    },
    get name() {
      return name;
    },
    get text() {
      return script.value;
    },
  };
}
