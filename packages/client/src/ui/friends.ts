/**
 * The Friends window (stage 120×240, white), assets/original/sub/Friendsgui/layout/frame-1.json:
 * - the purple frame (member 3) at [0, -1, 120, 241];
 * - the buddy list field at [8, 9, 113, 214] (frames 2-28's stretched 105×205), Geneva 12 white,
 *   read-only: online buddies, one a line; clicking a line selects it;
 * - Remove (member 4) at [5, 219, 24, 234], IM (member 6) at [25, 219, 44, 234] and Away
 *   (member 7) at [45, 219, 64, 234], 19×15, their labels in their art.
 *
 * Remove removes the selected buddy; IM opens IMsend with `To` = the selection; Away opens the
 * Away window, whatever is selected. The selection (the selected name) is never cleared: Remove
 * pressed again says "is not on your friend's list!" and IM still opens for a removed name;
 * before the first click Remove and IM do nothing (an assumption: 1.6's files do not say what a
 * void selection does).
 * The lines come from the server, which keeps them while the window is closed (the original's
 * `closeWindow` is empty). No sound.
 */
import { BUDDY_TEXT } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg, place, type Rect } from "./im.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const FRIENDS_STAGE = { w: 120, h: 240 } as const;
const r = (l: number, t: number, rr: number, b: number): Rect => ({
  x: l,
  y: t,
  w: rr - l,
  h: b - t,
});
/** Friendsgui's sprites at their `frame-1.json` rects (the list at frames 2-28's). */
export const FRIENDS_RECTS = {
  frame: r(0, -1, 120, 241),
  list: r(8, 9, 113, 214),
  remove: r(5, 219, 24, 234),
  im: r(25, 219, 44, 234),
  away: r(45, 219, 64, 234),
} as const;

export interface FriendsActions {
  /** Remove: the selected name. */
  remove(name: string): void;
  /** IM: IMsend with `To` filled. */
  im(name: string): void;
  /** Away: the Away window. */
  away(): void;
}

export interface FriendsWindow {
  window: GameWindow;
  /** The server's lines; the selection stays (it is a name, not a line). */
  setNames(names: readonly string[]): void;
  readonly names: readonly string[];
  readonly selected: string | null;
}

export function createFriendsWindow(
  a: Assets,
  layer: WindowLayer,
  act: FriendsActions,
): FriendsWindow {
  const stage = document.createElement("div");
  stage.className = "im-stage friends-stage";
  const frame = place(artImg(a, "Friendsgui", 3, "im-art"), FRIENDS_RECTS.frame, "im-abs");
  const list = place(
    action(document.createElement("div"), "friends-select-player"),
    FRIENDS_RECTS.list,
    "im-abs",
  );
  list.classList.add("friends-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Friends online");

  let selected: string | null = null;
  let names: string[] = [];
  const button = (member: 4 | 6 | 7, label: string, rect: Rect, on: () => void) => {
    const b = place(
      action(
        document.createElement("button"),
        member === 4 ? "friends-remove" : member === 6 ? "friends-message" : "friends-away",
      ),
      rect,
      "im-abs",
    );
    b.classList.add("im-btn", "friends-btn");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.append(artImg(a, "Friendsgui", member, "im-btn-art"));
    b.addEventListener("click", on);
    return b;
  };
  const removeBtn = button(4, "Remove from your friends", FRIENDS_RECTS.remove, () => {
    if (selected) {
      act.remove(selected);
    }
  });
  const imBtn = button(6, "Send an instant message", FRIENDS_RECTS.im, () => {
    if (selected) {
      act.im(selected);
    }
  });
  const awayBtn = button(7, "Away message", FRIENDS_RECTS.away, () => act.away());
  stage.append(frame, list, removeBtn, imBtn, awayBtn);

  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".friends-name");
    // A click below the last line reads an empty line: the selected name becomes empty.
    selected = row?.textContent ?? "";
    for (const r2 of list.children) {
      r2.setAttribute("aria-selected", String(r2 === row));
    }
  });

  const win = layer.create({
    title: BUDDY_TEXT.title,
    name: "friends",
    movie: "Friendsgui",
    width: FRIENDS_STAGE.w,
    height: FRIENDS_STAGE.h,
    body: stage,
  });

  return {
    window: win,
    get names() {
      return names;
    },
    get selected() {
      return selected;
    },
    setNames(next) {
      names = [...next];
      // Replacing the field text drops its highlight.
      list.replaceChildren(
        ...names.map((n) => {
          const row = document.createElement("div");
          row.className = "friends-name";
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", "false");
          row.textContent = n;
          return row;
        }),
      );
    },
  };
}
