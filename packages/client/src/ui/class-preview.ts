/**
 * The Classes tab's preview (issue #15): the class tree as published, with the class being edited
 * marked, then what the class gives (its chain followed, by the game's own `classPerkLines`) and
 * its ways in from the form as it reads now, and its ways out as published.
 */
import type { ClassRow } from "@secondstaronline/data";
import {
  classPerkLines,
  content,
  hasContent,
  SKILL_KEYS,
  skillDisplay,
  waysOutOf,
} from "@secondstaronline/shared";

const nameOf = (code: number) =>
  content().classes.classes.find((c) => c.code === code)?.name ?? `class ${code}`;

/** "Fighter → Grunt → Barbarian": every class reachable from each class no way leads into. */
function treeLines(marked: number | undefined): HTMLElement {
  const classes = content().classes.classes;
  const into = new Set<number>();
  const out = new Map<number, number[]>();
  for (const c of classes) {
    for (const w of waysOutOf(c.code)) {
      if (w.to.code !== c.code) {
        into.add(w.to.code);
        const list = out.get(c.code) ?? [];
        if (!list.includes(w.to.code)) {
          list.push(w.to.code);
        }
        out.set(c.code, list);
      }
    }
  }
  const starts = new Set(content().classes.startClasses.map((s) => s.code));
  const roots = classes.filter((c) => starts.has(c.code) || !into.has(c.code));
  const ul = document.createElement("ul");
  ul.className = "class-tree";
  const seen = new Set<number>();
  const add = (code: number, parent: HTMLElement, depth: number) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = nameOf(code);
    if (code === marked) {
      label.className = "class-tree-marked";
    }
    li.append(label);
    parent.append(li);
    if (seen.has(code) || depth > 12) {
      if ((out.get(code) ?? []).length > 0) {
        label.textContent += " …";
      }
      return;
    }
    seen.add(code);
    const kids = out.get(code) ?? [];
    if (kids.length > 0) {
      const sub = document.createElement("ul");
      li.append(sub);
      for (const k of kids) {
        add(k, sub, depth + 1);
      }
    }
  };
  for (const r of roots) {
    add(r.code, ul, 0);
  }
  return ul;
}

const list = (lines: readonly string[]) => {
  const ul = document.createElement("ul");
  ul.className = "class-preview-list";
  for (const l of lines) {
    const li = document.createElement("li");
    li.textContent = l;
    ul.append(li);
  }
  return ul;
};

const heading = (text: string) => {
  const h = document.createElement("h4");
  h.className = "balance-row-title";
  h.textContent = text;
  return h;
};

/** The preview, or null while the form does not yet hold a class. */
export function classPreview(value: unknown): HTMLElement | null {
  const c = value as Partial<ClassRow> | null;
  if (!hasContent() || !c || typeof c !== "object" || typeof c.code !== "number") {
    return null;
  }
  const box = document.createElement("section");
  box.className = "class-preview";
  const help = document.createElement("p");
  help.className = "control-panel-field-help";
  help.textContent =
    "What players see in their Class window. The tree, what it gives and the ways out are as published; the ways in are as the form reads now.";
  box.append(heading("This class"), help);
  const gives = classPerkLines(c.code, (i) => skillDisplay(SKILL_KEYS[i] ?? ""));
  box.append(
    heading("What it gives (published, with what it inherits)"),
    list(gives.length > 0 ? gives : ["Nothing beyond its name."]),
  );
  const ins: string[] = [];
  if (c.promotion) {
    ins.push(
      `1.6 promotion from ${c.promotion.from.join(", ")}: ${c.promotion.requirement.stat} ${c.promotion.requirement.min} at a trainer`,
    );
  }
  for (const p of c.paths ?? []) {
    const needs = (p.requires ?? []).map((r) => `${r.needs} ${r.atLeast}`);
    if (p.gold) {
      needs.push(`${p.gold} gold`);
    }
    for (const it of p.items ?? []) {
      needs.push(`${it.qty} ${it.item}${it.keep ? " (kept)" : ""}`);
    }
    const where =
      p.where === "anywhere"
        ? "in the Class window"
        : p.where === "both"
          ? "at a trainer or in the Class window"
          : "at a trainer";
    ins.push(
      `From ${(p.from ?? []).map(nameOf).join(", ") || "no class"}, ${where}${needs.length > 0 ? `: needs ${needs.join(", ")}` : ""}`,
    );
  }
  box.append(heading("Ways in"), list(ins.length > 0 ? ins : ["None: no one can change into it."]));
  const outs = waysOutOf(c.code)
    .filter((w) => w.to.code !== c.code)
    .map((w) => w.to.name);
  box.append(
    heading("Ways out"),
    list(outs.length > 0 ? [...new Set(outs)] : ["None: it is as far as this branch goes."]),
  );
  box.append(heading("The class tree"), treeLines(c.code));
  return box;
}
