/**
 * The Spellbook page (frame 67): the spell list, the Info button and the cast
 * button, at their score rects (assets/original/main/layout/frame-67.json).
 *
 * - The list (channel 41): the spellbook field (DBAdmin #19), a scroll box 164×173 in Arial 12
 *   white at (608, 119). A click selects the clicked line, or nothing on an empty one (a bug
 *   fixed: 1.6 first rebuilt the list from its 29-line save, so a learned Identify dropped out).
 * - Info (channel 43, Internal #200, a 14×17 "i" at [614, 300, 628, 317]): one line about the
 *   selected spell.
 * - The cast button (channel 44, loc (651, 308)): member 199, a 32×27 bolt at [635, 295, 667, 322],
 *   arms it with a spell selected, swapping in member 205, a 14×15 × at [644, 301, 658, 316];
 *   member 205 disarms it. A cast never disarms (the cast script never writes to sprite 44).
 *
 * Neither sprite is stretched (score ink byte bit 0x80 clear), so Director draws each member
 * at its own size with its registration point on the sprite's loc; the score's stored sizes
 * (59×19, 24×24) are stale and ignored.
 *
 * Every one of the three clicks plays `Clicksound2` on channel 3 first.
 */
import { spellByName } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action } from "./action.ts";
import { artImg, DIRECTOR_BAR_W } from "./stage.ts";

/** The Info line, from the spell's `spells.json` row. Poison Dart and Identify have none. */
export function spellInfo(spell: string): string | null {
  return spellByName(spell)?.info ?? null;
}

export interface SpellbookActions {
  sound(s: Sfx): void;
  /** A chat line for you alone. */
  say(text: string): void;
}

export interface Spellbook {
  page: HTMLElement;
  /** The selected spell: the clicked line, "" for none. */
  readonly selected: string;
  /** Sprite 44 shows member 205. */
  readonly armed: boolean;
  setSpells(lines: readonly string[]): void;
  /** Arms (true) or disarms the cursor, as clicking sprite 44 does (with its sound). */
  pressCast(): void;
  /** Leaving the page puts back the score's member 199 (an assumption: 1.6's files do not say). */
  disarm(): void;
}

const PANEL_X = 566;
/** Field `Spellbook` (DBAdmin #19) is 164 px wide (text-styles.jsonl). */
const SPELL_FIELD_W = 164;

function place(el: HTMLElement, left: number, top: number, w: number, h: number): void {
  el.style.position = "absolute";
  el.style.left = `${left - PANEL_X}px`;
  el.style.top = `${top}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

export function createSpellbook(a: Assets, act: SpellbookActions): Spellbook {
  const page = document.createElement("div");
  page.className = "page page-spellbook";

  let lines: string[] = [];
  let selected = "";
  let armed = false;

  const list = action(document.createElement("div"), "spell-select");
  list.className = "field spell-list director-scroll";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Spells");
  // The box runs on to x 791 so the browser's bar sits where Director drew the field's: x 775-790,
  // outside the 164 px field (SSO places the bar where Director drew it). The text keeps the
  // field's 164 px; `.director-scroll` pads the rest.
  place(list, 608, 119, SPELL_FIELD_W + DIRECTOR_BAR_W, 173);

  const render = () => {
    list.replaceChildren();
    for (const [i, s] of lines.entries()) {
      const row = document.createElement("div");
      row.className = "spell-line";
      row.textContent = s;
      row.dataset.line = String(i + 1);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(s === selected && s !== ""));
      if (s === selected && s !== "") {
        row.classList.add("selected");
      }
      list.append(row);
    }
  };

  list.addEventListener("click", (e) => {
    act.sound(SOUND.click);
    if (e.target === list && e.offsetX >= SPELL_FIELD_W) {
      return; // the gap beside the field: outside the sprite in 1.6, so no click
    }
    const t = (e.target as HTMLElement).closest<HTMLElement>(".spell-line");
    const n = t ? Number(t.dataset.line) : 0;
    selected = n > 0 ? (lines[n - 1] ?? "") : "";
    render();
  });

  const info = action(document.createElement("button"), "spell-info");
  info.type = "button";
  info.className = "spell-info";
  info.setAttribute("aria-label", "About this spell");
  place(info, 614, 300, 14, 17);
  const infoArt = artImg(a.ui("internal", 200));
  infoArt.className = "fill";
  info.append(infoArt);
  info.addEventListener("click", () => {
    act.sound(SOUND.click);
    const text = spellInfo(selected);
    if (text) {
      act.say(text);
    }
  });

  const cast = action(document.createElement("button"), "spell-toggle-cast");
  cast.type = "button";
  cast.className = "spell-cast";
  const castArt = artImg(a.ui("internal", 199));
  castArt.className = "fill";
  cast.append(castArt);
  const show = () => {
    castArt.src = a.ui("internal", armed ? 205 : 199);
    // loc (651, 308) less each member's registration point: #199 (16, 13), #205 (7, 7).
    if (armed) {
      place(cast, 644, 301, 14, 15);
    } else {
      place(cast, 635, 295, 32, 27);
    }
    cast.setAttribute("aria-pressed", String(armed));
    cast.setAttribute("aria-label", armed ? "Stop casting" : "Cast the selected spell");
    page.classList.toggle("armed", armed);
  };
  const book: Spellbook = {
    page,
    get selected() {
      return selected;
    },
    get armed() {
      return armed;
    },
    setSpells(next) {
      lines = [...next];
      render();
    },
    pressCast() {
      // Member 199 clicks before its empty-selection exit; 205 clicks then disarms.
      act.sound(SOUND.click);
      if (armed) {
        armed = false;
      } else if (selected !== "") {
        armed = true;
      } else {
        return;
      }
      show();
    },
    disarm() {
      if (armed) {
        armed = false;
        show();
      }
    },
  };
  cast.addEventListener("click", () => book.pressCast());
  show();
  page.append(list, info, cast);
  return book;
}
