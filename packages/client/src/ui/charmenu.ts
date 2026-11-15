/**
 * The player menu: clicking a character shows sprites 302-304 at the mouse (the player-click
 * script): Inventory #210 (the backdrop, registration point (29, 19)) at the mouse, #211 "Bio"
 * at mouseV − 8 and #212 "Trade" at mouseV + 8 (both 55×17, registration (27, 8)). Leaving the
 * backdrop hides it.
 * Your own character shows it too.
 *
 * Trade asks for a trade. Bio asks the player for its bio, hides the menu and prints "You view
 * the bio..."; it works on yourself, the only way to your own bio.
 *
 * Positions are in playfield pixels; the shell scales the overlay with the playfield.
 */
import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg } from "./stage.ts";

export interface CharMenu {
  el: HTMLElement;
  /** Opens for player `id` at playfield pixel (x, y). */
  open(id: string, x: number, y: number): void;
  close(): void;
  readonly isOpen: boolean;
}

export interface CharMenuActions {
  trade(id: string): void;
  /** Bio: the bio request (`$*+`) and its line. */
  bio(id: string): void;
}

export function createCharMenu(a: Assets, act: CharMenuActions): CharMenu {
  // Leaving the menu hides it: the backdrop sprite 302's mouse-leave script.
  const el = action(document.createElement("div"), "character-menu-dismiss");
  el.className = "char-menu";
  el.hidden = true;
  el.setAttribute("role", "menu");
  const back = artImg(a.ui("inventory", 210));
  back.classList.add("char-menu-back");
  const item = (member: number, label: string) => {
    // Bio and Trade are their members' own scripts.
    const b = action(
      document.createElement("button"),
      member === 211 ? "character-view-bio" : "character-trade",
    );
    b.type = "button";
    b.className = "art-btn char-menu-item";
    b.setAttribute("role", "menuitem");
    b.setAttribute("aria-label", label);
    b.append(artImg(a.ui("inventory", member)));
    return b;
  };
  const bio = item(211, "Bio");
  const trade = item(212, "Trade");
  el.append(back, bio, trade);
  // Each piece at its sprite rect relative to the backdrop's top-left (mouse − (29, 19)).
  const at = (n: HTMLElement, x: number, y: number) => {
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
  };
  at(back, 0, 0);
  at(bio, 29 - 27, 19 - 8 - 8);
  at(trade, 29 - 27, 19 + 8 - 8);

  let target: string | null = null;
  const menu: CharMenu = {
    el,
    get isOpen() {
      return !el.hidden;
    },
    open(id, x, y) {
      target = id;
      el.style.left = `${x - 29}px`;
      el.style.top = `${y - 19}px`;
      el.hidden = false;
    },
    close() {
      el.hidden = true;
      target = null;
    },
  };
  el.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") {
      menu.close();
    }
  });
  bio.addEventListener("click", () => {
    const id = target;
    menu.close();
    if (id) {
      act.bio(id);
    }
  });
  trade.addEventListener("click", () => {
    const id = target;
    menu.close();
    if (id) {
      act.trade(id);
    }
  });
  return menu;
}
