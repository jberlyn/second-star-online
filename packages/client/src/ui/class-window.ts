/**
 * The Class window (issue #15): your class and what it gives, and each way out of it with every
 * check marked (✓ met, ✗ not yet), the trainers that teach it, what it gives, and a Change button
 * for a path the window may take. An SSO window in the crafting window's look; opened from
 * Game ▸ Your Class in a world that uses it (Classic's players never see it, as in 1.6). Everything
 * is the server's to check.
 */
import type { ClassCardView, ClassWayView, ClassWindowView } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { picture } from "./crafting.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export interface ClassWindowActions {
  /** The Change button on the way into class `code`. */
  promote(code: number): void;
}

export interface ClassWindow {
  readonly window: GameWindow;
  /** The server's view: opens the window, or refreshes it. */
  show(view: ClassWindowView): void;
  /** The class shown on the right (a way's, or null for your own). */
  readonly picked: number | null;
}

export const CLASS_WINDOW_SIZE = { w: 440, h: 330 } as const;

export function createClassWindow(
  a: Assets,
  layer: WindowLayer,
  act: ClassWindowActions,
): ClassWindow {
  const stage = document.createElement("div");
  stage.className = "crafting class-window";

  const list = document.createElement("div");
  list.className = "crafting-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Your class and the ways out of it");

  const detail = document.createElement("div");
  detail.className = "crafting-detail";

  const left = document.createElement("div");
  left.className = "crafting-left";
  left.append(list);
  const right = document.createElement("div");
  right.className = "crafting-right";
  right.append(detail);
  stage.append(left, right);

  let view: ClassWindowView | null = null;
  /** The way picked, by the class it leads to; null shows your own class. */
  let picked: number | null = null;

  const wayOf = (code: number | null) =>
    code === null ? undefined : view?.ways.find((w) => w.to.code === code);

  const row = (c: ClassCardView, sub: string, code: number | null, state: string) => {
    const line = action(document.createElement("button"), "class-pick");
    line.type = "button";
    line.className = `crafting-row class-row class-${state}`;
    line.dataset.cls = String(c.code);
    line.setAttribute("role", "option");
    line.setAttribute("aria-selected", String(code === picked));
    const name = document.createElement("span");
    name.className = "crafting-row-name";
    name.textContent = c.name;
    const note = document.createElement("span");
    note.className = "crafting-row-level";
    note.textContent = sub;
    line.append(...(c.icon ? [picture(a, c.icon, "crafting-row-pic")] : []), name, note);
    line.addEventListener("click", () => {
      picked = code;
      render();
    });
    return line;
  };

  const renderList = () => {
    if (!view) {
      list.replaceChildren();
      return;
    }
    const out: HTMLElement[] = [];
    const head = (text: string) => {
      const h = document.createElement("div");
      h.className = "crafting-category";
      h.textContent = text;
      return h;
    };
    out.push(head("Your class"), row(view.current, "", null, "current"));
    out.push(head("Can become"));
    if (view.ways.length === 0) {
      const none = document.createElement("div");
      none.className = "crafting-none";
      none.textContent = "No class can be reached from yours.";
      out.push(none);
    }
    for (const w of view.ways) {
      out.push(row(w.to, w.ready ? "Ready" : "", w.to.code, w.ready ? "ready" : "locked"));
    }
    list.replaceChildren(...out);
  };

  const section = (title: string, lines: readonly string[], cls = "") => {
    const box = document.createElement("div");
    box.className = "class-section";
    const h = document.createElement("div");
    h.className = "crafting-category";
    h.textContent = title;
    const ul = document.createElement("ul");
    ul.className = `crafting-needs ${cls}`;
    for (const l of lines) {
      const li = document.createElement("li");
      li.textContent = l;
      ul.append(li);
    }
    box.append(h, ul);
    return box;
  };

  const headOf = (c: ClassCardView, facts: string) => {
    const head = document.createElement("div");
    head.className = "crafting-head";
    const title = document.createElement("div");
    title.className = "crafting-title";
    title.textContent = c.name;
    const sub = document.createElement("div");
    sub.className = "crafting-facts";
    sub.textContent = facts;
    const titles = document.createElement("div");
    titles.append(title, sub);
    head.append(...(c.icon ? [picture(a, c.icon, "crafting-pic")] : []), titles);
    return head;
  };

  const description = (text: string | null) => {
    const d = document.createElement("p");
    d.className = "class-description";
    d.textContent = text ?? "";
    d.hidden = !text;
    return d;
  };

  const renderWay = (w: ClassWayView) => {
    const parts: HTMLElement[] = [
      headOf(
        w.to,
        w.trainers.length > 0
          ? `Taught by ${w.trainers.join(", ")}${w.here ? ", or change here" : ""}`
          : w.here
            ? "Change here, from this window"
            : "No trainer teaches it yet",
      ),
      description(w.to.description),
      description(w.text),
    ];
    const checks = document.createElement("ul");
    checks.className = "crafting-needs class-checks";
    checks.setAttribute("aria-label", "What it needs");
    for (const c of w.checks) {
      const li = document.createElement("li");
      li.className = c.met ? "have" : "short";
      const mark = document.createElement("span");
      mark.className = "class-mark";
      mark.textContent = c.met ? "✓" : "✗";
      mark.setAttribute("aria-label", c.met ? "Met" : "Not yet");
      const t = document.createElement("span");
      t.textContent = c.label;
      li.append(mark, t);
      checks.append(li);
    }
    if (w.checks.length > 0) {
      const h = document.createElement("div");
      h.className = "crafting-category";
      h.textContent = "Needs";
      parts.push(h, checks);
    }
    if (w.grants.length > 0) {
      parts.push(section("Gives", w.grants));
    }
    if (w.to.perks.length > 0) {
      parts.push(section(`As a ${w.to.name}`, w.to.perks));
    }
    if (w.here) {
      const buttons = document.createElement("div");
      buttons.className = "crafting-make";
      const b = action(document.createElement("button"), "class-change");
      b.type = "button";
      b.className = "crafting-btn";
      b.textContent = `Become a ${w.to.name}`;
      b.disabled = !w.ready;
      b.addEventListener("click", () => act.promote(w.to.code));
      buttons.append(b);
      parts.push(buttons);
    }
    detail.replaceChildren(...parts);
  };

  const renderDetail = () => {
    if (!view) {
      detail.replaceChildren();
      return;
    }
    const w = wayOf(picked);
    if (w) {
      renderWay(w);
      return;
    }
    const c = view.current;
    detail.replaceChildren(
      headOf(c, "Your class"),
      description(c.description),
      section("What it gives", c.perks.length > 0 ? c.perks : ["Nothing beyond its name."]),
    );
  };

  const render = () => {
    renderList();
    renderDetail();
  };

  const win = layer.create({
    title: "Your Class",
    name: "class",
    width: CLASS_WINDOW_SIZE.w,
    height: CLASS_WINDOW_SIZE.h,
    body: stage,
  });

  return {
    window: win,
    get picked() {
      return picked;
    },
    show(next) {
      const changed = view !== null && view.current.code !== next.current.code;
      view = next;
      if (changed || !wayOf(picked)) {
        picked = null;
      }
      render();
      if (!win.isOpen) {
        win.open();
      }
    },
  };
}
