/**
 * The crafting window (issue #45): a recipe station's recipes, made a quantity at a time
 * (RuneScape's "Make X"). An SSO window: 1.6 had no recipes, so it has no 1.6 art; it wears the
 * item menu's purple frame on the right panel's woodgrain, at full strength because it sits beside
 * 1.6's own art (the Control Panel and Player Settings use a softer cut of the same tokens).
 *
 * The list on the left groups the recipes by category, with a search box. Recipes the player can
 * make now stand out; ones short of materials or a tool are greyed; ones above their level (or not
 * learned) show a lock, when the station shows them at all. The right side shows the picked
 * recipe: its picture, level, XP, chance, materials (have/need) and the Make buttons (1, 5, 10, X,
 * All). A running Make X shows under it with a Stop button. Everything is the server's to check.
 */
import { bagPicture, type RecipeRowView, type RecipeWindowView } from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action } from "./action.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export interface CraftingActions {
  make(recipe: string, count: number): void;
  stop(): void;
  /** The window closed by its close button. */
  closed(): void;
}

export interface CraftingWindow {
  readonly window: GameWindow;
  /** The server's view; null closes the window. */
  show(view: RecipeWindowView | null): void;
  /** The recipe shown on the right, or null. */
  readonly picked: string | null;
}

export const CRAFTING_SIZE = { w: 420, h: 330 } as const;

/** The most "All" asks for: the server stops when the materials run out. */
export const MAKE_ALL = 10_000;

/** An item's bag picture, drawn at its own size (empty when the item has no art). */
function picture(a: Assets, item: string, cls: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.className = cls;
  const name = bagPicture(item);
  const s = a.sprite("items", name);
  if (!s) {
    c.width = 1;
    c.height = 1;
    return c;
  }
  const [, , , w, h, rx, ry] = s;
  c.width = w;
  c.height = h;
  const paint = () => {
    const ctx = c.getContext("2d");
    if (ctx) {
      drawSprite(ctx, a, "items", name, rx, ry);
    }
  };
  if (a.sheets.items) {
    paint();
  } else {
    void a.loadGroup("items").then(paint);
  }
  return c;
}

/** A small padlock for a locked recipe's level. */
function padlock(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 10 12");
  svg.setAttribute("width", "9");
  svg.setAttribute("height", "11");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("crafting-lock");
  const shackle = document.createElementNS(ns, "path");
  shackle.setAttribute("d", "M2.5 5.5V3.5a2.5 2.5 0 0 1 5 0v2");
  shackle.setAttribute("fill", "none");
  shackle.setAttribute("stroke", "currentColor");
  shackle.setAttribute("stroke-width", "1.4");
  const body = document.createElementNS(ns, "rect");
  body.setAttribute("x", "1");
  body.setAttribute("y", "5.5");
  body.setAttribute("width", "8");
  body.setAttribute("height", "6");
  body.setAttribute("rx", "1");
  body.setAttribute("fill", "currentColor");
  svg.append(shackle, body);
  return svg;
}

/** "1 Bronze Bar" or "2 × Iron Bar". */
const amountText = (qty: number, item: string) => (qty > 1 ? `${qty} × ${item}` : item);

export function createCraftingWindow(
  a: Assets,
  layer: WindowLayer,
  act: CraftingActions,
): CraftingWindow {
  const stage = document.createElement("div");
  stage.className = "crafting";

  const search = action(document.createElement("input"), "crafting-search");
  search.type = "search";
  search.className = "crafting-search";
  search.placeholder = "Search recipes";
  search.setAttribute("aria-label", "Search recipes");
  search.autocomplete = "off";

  const list = document.createElement("div");
  list.className = "crafting-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Recipes");

  const detail = document.createElement("div");
  detail.className = "crafting-detail";

  const status = document.createElement("div");
  status.className = "crafting-status";
  status.setAttribute("aria-live", "polite");

  const left = document.createElement("div");
  left.className = "crafting-left";
  left.append(search, list);
  const right = document.createElement("div");
  right.className = "crafting-right";
  right.append(detail, status);
  stage.append(left, right);

  let view: RecipeWindowView | null = null;
  let picked: string | null = null;
  let xValue = 14;

  const rowOf = (name: string | null) =>
    name === null ? undefined : view?.rows.find((r) => r.name === name);

  const button = (label: string, act_: string, on: () => void, disabled = false) => {
    const b = action(document.createElement("button"), act_);
    b.type = "button";
    b.className = "crafting-btn";
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener("click", on);
    return b;
  };

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const rows = (view?.rows ?? []).filter(
      (r) =>
        q === "" ||
        r.name.toLowerCase().includes(q) ||
        r.output.item.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
    const groups = new Map<string, RecipeRowView[]>();
    for (const r of rows) {
      const g = groups.get(r.category) ?? [];
      g.push(r);
      groups.set(r.category, g);
    }
    const out: HTMLElement[] = [];
    for (const [category, rs] of groups) {
      if (category !== "" || groups.size > 1) {
        const h = document.createElement("div");
        h.className = "crafting-category";
        h.textContent = category || "Other";
        out.push(h);
      }
      for (const r of rs) {
        const line = action(document.createElement("button"), "crafting-pick");
        line.type = "button";
        line.className = `crafting-row crafting-${r.state}`;
        line.dataset.recipe = r.name;
        line.setAttribute("role", "option");
        line.setAttribute("aria-selected", String(r.name === picked));
        const name = document.createElement("span");
        name.className = "crafting-row-name";
        name.textContent = r.name;
        const lvl = document.createElement("span");
        lvl.className = "crafting-row-level";
        lvl.textContent = String(r.level);
        if (r.state === "level" || r.state === "unlearned") {
          // A padlock drawn in the page, not an emoji: the game's fonts have none.
          lvl.prepend(padlock());
          lvl.setAttribute("aria-label", `Locked, level ${r.level}`);
        }
        line.title = r.why ?? `Can make ${r.affordable}`;
        line.append(picture(a, r.output.item, "crafting-row-pic"), name, lvl);
        line.addEventListener("click", () => {
          picked = r.name;
          render();
        });
        out.push(line);
      }
    }
    if (out.length === 0) {
      const none = document.createElement("div");
      none.className = "crafting-none";
      none.textContent = view?.rows.length ? "No recipe matches." : "Nothing can be made here yet.";
      out.push(none);
    }
    list.replaceChildren(...out);
  };

  const renderDetail = () => {
    const r = rowOf(picked);
    if (!r) {
      const hint = document.createElement("div");
      hint.className = "crafting-hint";
      hint.textContent = "Pick a recipe to see what it needs.";
      detail.replaceChildren(hint);
      return;
    }
    const head = document.createElement("div");
    head.className = "crafting-head";
    const title = document.createElement("div");
    title.className = "crafting-title";
    title.textContent = amountText(r.output.qty, r.output.item);
    const facts = document.createElement("div");
    facts.className = "crafting-facts";
    const xp = r.xp === null ? "" : ` · ${r.xp} XP`;
    const masterwork = r.masterwork > 0 ? ` · ${percentText(r.masterwork)} masterwork` : "";
    facts.textContent = `${r.skill} ${r.level}${xp} · ${Math.round(r.chance * 100)}% success${masterwork}`;
    const titles = document.createElement("div");
    titles.append(title, facts);
    head.append(picture(a, r.output.item, "crafting-pic"), titles);

    const needs = document.createElement("ul");
    needs.className = "crafting-needs";
    needs.setAttribute("aria-label", "Materials");
    const line = (m: { item: string; qty: number; have: number }, kept: boolean) => {
      const li = document.createElement("li");
      li.className = m.have >= m.qty ? "have" : "short";
      li.append(picture(a, m.item, "crafting-need-pic"));
      const t = document.createElement("span");
      t.textContent = `${amountText(m.qty, m.item)}${kept ? " (kept)" : ""}`;
      const n = document.createElement("span");
      n.className = "crafting-have";
      n.textContent = `${m.have}/${m.qty}`;
      li.append(t, n);
      return li;
    };
    needs.append(...r.materials.map((m) => line(m, false)), ...r.keeps.map((m) => line(m, true)));

    const why = document.createElement("div");
    why.className = "crafting-why";
    why.textContent = r.why ?? "";

    const can = r.state === "ready";
    const buttons = document.createElement("div");
    buttons.className = "crafting-make";
    const make = (n: number) => act.make(r.name, n);
    const x = action(document.createElement("input"), "crafting-amount");
    x.type = "number";
    x.min = "1";
    x.max = String(MAKE_ALL);
    x.value = String(xValue);
    x.className = "crafting-x";
    x.setAttribute("aria-label", "How many to make");
    x.addEventListener("change", () => {
      xValue = Math.max(1, Math.min(MAKE_ALL, Math.floor(Number(x.value)) || 1));
      x.value = String(xValue);
    });
    buttons.append(
      button("Make 1", "crafting-make-1", () => make(1), !can),
      button("5", "crafting-make-5", () => make(5), !can),
      button("10", "crafting-make-10", () => make(10), !can),
      x,
      button("Make X", "crafting-make-x", () => make(xValue), !can),
      button("All", "crafting-make-all", () => make(MAKE_ALL), !can),
    );
    detail.replaceChildren(head, needs, why, buttons);
  };

  const renderStatus = () => {
    const run = view?.run ?? null;
    if (!run) {
      status.replaceChildren();
      return;
    }
    const text = document.createElement("span");
    text.textContent =
      run.left >= MAKE_ALL / 2 ? `Making ${run.recipe}…` : `Making ${run.recipe}… ${run.left} left`;
    status.replaceChildren(
      text,
      button("Stop", "crafting-stop", () => act.stop()),
    );
  };

  const render = () => {
    renderList();
    renderDetail();
    renderStatus();
  };

  search.addEventListener("input", renderList);

  const win = layer.create({
    title: "Crafting",
    name: "crafting",
    width: CRAFTING_SIZE.w,
    height: CRAFTING_SIZE.h,
    body: stage,
    onClose: () => {
      if (view !== null) {
        view = null;
        act.closed();
      }
    },
  });

  return {
    window: win,
    get picked() {
      return picked;
    },
    show(next) {
      if (next === null) {
        view = null;
        win.close();
        return;
      }
      const opening = view === null || view.station !== next.station;
      view = next;
      if (opening) {
        search.value = "";
        picked = next.run?.recipe ?? next.rows.find((r) => r.state === "ready")?.name ?? null;
        win.setTitle(next.station);
      }
      if (picked !== null && !rowOf(picked)) {
        picked = null;
      }
      render();
      if (!win.isOpen) {
        win.open();
      }
    },
  };
}

/** A chance as a percent: whole above 1%, else to one decimal place, so a small chance never reads 0%. */
function percentText(chance: number): string {
  const p = chance * 100;
  return p >= 1 ? `${Math.round(p)}%` : `${Math.max(0.1, Math.round(p * 10) / 10)}%`;
}
