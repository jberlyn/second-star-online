/**
 * The Who window. Stage 120×240:
 * - member 3, the purple frame, drawn at rect (0,-1) 120×242 (frames 2-28 of channel 1);
 * - the user list field at (8,9) 105×205, a scrolling list in Geneva 12 white, not editable;
 *   clicking a name selects it;
 * - IM (member 6) and Profile (member 7), 19×15 at (6,219) and (26,219). IM opens IMsend with `To`
 *   = the selection; Profile asks the selection for its bio, removes the highlight (the selection
 *   itself stays) and prints "Loading profile...". Both do nothing with no name selected.
 *
 * The list is a snapshot of the `who` reply, as in 1.6: it does not update while open.
 */
import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export interface WhoWindow {
  window: GameWindow;
  /** Fills the list and opens the window (the `who` reply). */
  show(names: readonly string[]): void;
  readonly selected: string | null;
}

export const WHO_STAGE = { w: 120, h: 240 } as const;

export interface WhoActions {
  /** IM: open IMsend with `To` filled. */
  im(name: string): void;
  /** Profile: the bio request and its line. */
  profile(name: string): void;
}

export function createWhoWindow(a: Assets, layer: WindowLayer, act?: WhoActions): WhoWindow {
  const stage = document.createElement("div");
  stage.className = "who-stage";

  const frame = document.createElement("img");
  frame.className = "who-frame art";
  frame.src = a.ui("WhoWindow", 3);
  frame.alt = "";
  frame.draggable = false;

  const list = document.createElement("div");
  list.className = "who-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Players online");

  const buttons = document.createElement("div");
  buttons.className = "who-buttons";
  const button = (member: number, label: string, cls: string) => {
    // IM and Profile are their members' own scripts.
    const b = action(document.createElement("button"), cls);
    b.type = "button";
    b.className = `who-btn ${cls}`;
    b.setAttribute("aria-label", label);
    b.title = label;
    const img = document.createElement("img");
    img.src = a.ui("WhoWindow", member);
    img.alt = "";
    img.draggable = false;
    b.append(img);
    return b;
  };
  const imBtn = button(6, "Send an instant message", "who-im");
  imBtn.addEventListener("click", () => {
    if (selected) {
      act?.im(selected);
    }
  });
  const profileBtn = button(7, "View profile", "who-profile");
  profileBtn.addEventListener("click", () => {
    if (selected) {
      act?.profile(selected);
      // The highlight goes, the selection stays.
      for (const r of list.children) {
        r.setAttribute("aria-selected", "false");
      }
    }
  });
  buttons.append(imBtn, profileBtn);
  stage.append(frame, list, buttons);

  const win = layer.create({
    title: "Who's Online",
    name: "who",
    movie: "WhoWindow",
    width: WHO_STAGE.w,
    height: WHO_STAGE.h,
    body: stage,
  });

  let selected: string | null = null;
  const select = (row: HTMLElement | null) => {
    for (const r of list.children) {
      r.setAttribute("aria-selected", String(r === row));
    }
    selected = row?.textContent ?? null;
  };
  action(list, "who-select-player"); // the user list field's own script
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".who-name");
    if (row) {
      select(row);
    }
  });

  return {
    window: win,
    get selected() {
      return selected;
    },
    show(names) {
      list.replaceChildren(
        ...names.map((n) => {
          const row = document.createElement("div");
          row.className = "who-name";
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", "false");
          row.textContent = n;
          return row;
        }),
      );
      selected = null;
      win.open();
    },
  };
}
