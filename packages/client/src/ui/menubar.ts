/**
 * The menu bar widget: a strip of titles with drop-down menus, drawn in Windows
 * classic grey above the 800×600 stage. DOM only, with no game knowledge: `gamemenu.ts` says
 * what the menus hold. An open menu has an invisible full-screen catcher behind it, so a click
 * outside only closes it (as Windows does). No keyboard access (the game uses the keys).
 */
import { action } from "./action.ts";

export type MenuItem =
  | {
      kind: "item";
      label: string;
      /** False leaves the item out of the open menu (Admin Chat, without `adminChat`). */
      visible?(): boolean;
      enabled?(): boolean;
      checked?(): boolean;
      /** A radio bullet instead of a check mark. */
      radio?: boolean;
      run(): void;
    }
  | { kind: "sep"; visible?(): boolean };

export interface Menu {
  title: string;
  /** False hides the title (Admin, with no admin tool). */
  visible?(): boolean;
  items: MenuItem[];
}

export interface MenuBar {
  /** The holder: sized to the scaled bar, goes above the stage. */
  el: HTMLElement;
  /** Re-reads each title's `visible()`; closes an open menu whose title is now hidden. */
  refresh(): void;
  close(): void;
  setScale(s: number): void;
  readonly openTitle: string | null;
  dispose(): void;
}

export const MENU_BAR_H = 20;
const BAR_W = 800;

export function createMenuBar(menus: readonly Menu[]): MenuBar {
  const holder = document.createElement("div");
  holder.className = "menu-bar-holder";
  const catcher = action(document.createElement("div"), "menu-dismiss");
  catcher.className = "menu-catcher";
  catcher.hidden = true;
  const bar = action(document.createElement("div"), "menu-focus");
  bar.className = "menu-bar";
  bar.setAttribute("role", "menubar");
  holder.append(catcher, bar);

  let open: Menu | null = null;
  let drop: HTMLElement | null = null;
  const titles = new Map<Menu, HTMLButtonElement>();

  const close = () => {
    if (!open) {
      return;
    }
    const t = titles.get(open);
    t?.classList.remove("open");
    t?.setAttribute("aria-expanded", "false");
    drop?.remove();
    drop = null;
    open = null;
    catcher.hidden = true;
    holder.classList.remove("menu-open");
  };

  const openMenu = (m: Menu) => {
    close();
    const t = titles.get(m);
    if (!t) {
      return;
    }
    open = m;
    t.classList.add("open");
    t.setAttribute("aria-expanded", "true");
    catcher.hidden = false;
    holder.classList.add("menu-open");
    const d = document.createElement("div");
    d.className = "menu-drop";
    d.setAttribute("role", "menu");
    d.style.left = `${t.offsetLeft}px`;
    for (const it of m.items) {
      if (it.visible && !it.visible()) {
        continue;
      }
      if (it.kind === "sep") {
        const s = document.createElement("div");
        s.className = "menu-sep";
        s.setAttribute("role", "separator");
        d.append(s);
        continue;
      }
      const enabled = it.enabled ? it.enabled() : true;
      const checked = it.checked ? it.checked() : null;
      const b = action(
        document.createElement("button"),
        `menu-item-${it.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`,
      );
      b.type = "button";
      b.className = "menu-item";
      b.setAttribute(
        "role",
        it.radio ? "menuitemradio" : checked === null ? "menuitem" : "menuitemcheckbox",
      );
      if (checked !== null) {
        b.setAttribute("aria-checked", String(checked));
        b.dataset.mark = it.radio ? "●" : "✓";
      }
      if (!enabled) {
        b.setAttribute("aria-disabled", "true");
      }
      b.textContent = it.label;
      b.addEventListener("click", () => {
        if (!enabled) {
          return;
        }
        close();
        it.run();
      });
      d.append(b);
    }
    drop = d;
    bar.append(d);
  };

  for (const m of menus) {
    const t = action(
      document.createElement("button"),
      `menu-open-${m.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`,
    );
    t.type = "button";
    t.className = "menu-title";
    t.textContent = m.title;
    t.setAttribute("role", "menuitem");
    t.setAttribute("aria-haspopup", "true");
    t.setAttribute("aria-expanded", "false");
    t.addEventListener("click", () => (open === m ? close() : openMenu(m)));
    t.addEventListener("pointerenter", () => {
      if (open && open !== m) {
        openMenu(m);
      }
    });
    titles.set(m, t);
    bar.append(t);
  }

  // Keep the chat field's focus when the bar is clicked.
  bar.addEventListener("pointerdown", (e) => e.preventDefault());
  catcher.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  const onKey = (e: KeyboardEvent) => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", onKey);

  const refresh = () => {
    for (const m of menus) {
      const t = titles.get(m);
      const vis = m.visible ? m.visible() : true;
      if (t) {
        t.hidden = !vis;
      }
      if (!vis && open === m) {
        close();
      }
    }
  };
  const setScale = (s: number) => {
    holder.style.width = `${BAR_W * s}px`;
    holder.style.height = `${MENU_BAR_H * s}px`;
    bar.style.transform = `scale(${s})`;
  };
  refresh();
  setScale(1);

  return {
    el: holder,
    refresh,
    close,
    setScale,
    get openTitle() {
      return open ? open.title : null;
    },
    dispose: () => window.removeEventListener("keydown", onKey),
  };
}
