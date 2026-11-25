/**
 * Editor forms behind tabs (ui/control-panel-kit.ts `sectionTabs`): the Items, Monsters, NPCs,
 * Skills and Gathering pages show one section at a time, so a record's rules need no scrolling,
 * and keep their Save bar in view.
 */
import { describe, expect, test } from "bun:test";

import { ALL_SECTIONS, formActions, sectionTabs } from "../src/ui/control-panel-kit.ts";
import { createItemsPage } from "../src/ui/items-page.ts";

/** Lets the tab strip's MutationObserver catch up. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function section(title: string, extra: { tab?: string; ownSave?: boolean } = {}): HTMLElement {
  const s = document.createElement("section");
  s.className = "balance-row";
  const h = document.createElement("h3");
  h.className = "balance-row-title";
  h.textContent = title;
  s.append(h);
  if (extra.tab) {
    s.dataset.tab = extra.tab;
  }
  if (extra.ownSave) {
    s.dataset.ownSave = "";
  }
  return s;
}

function form() {
  const f = document.createElement("section");
  const tabs = sectionTabs(f, "test");
  const groups = document.createElement("div");
  f.append(tabs.el, groups);
  document.body.append(f);
  const labels = () =>
    [...tabs.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map((b) => b.textContent);
  const shown = () =>
    [...f.querySelectorAll<HTMLElement>(".balance-row")]
      .filter(
        (s) => !s.closest(".control-panel-tab-hidden") && !s.parentElement?.closest(".balance-row"),
      )
      .map((s) => s.querySelector(".balance-row-title")?.textContent);
  const tab = (label: string) =>
    tabs.el.querySelector<HTMLButtonElement>(`[data-tab="${label}"]`) as HTMLButtonElement;
  return { f, tabs, groups, labels, shown, tab };
}

describe("section tabs", () => {
  test("one tab per section, the first showing, and a tab for every section at once", async () => {
    const t = form();
    t.groups.append(section("Stats"), section("Behaviour"), section("XP"));
    await settle();
    expect(t.labels()).toEqual(["Stats", "Behaviour", "XP", ALL_SECTIONS]);
    expect(t.shown()).toEqual(["Stats"]);
    expect(t.tab("Stats").getAttribute("aria-selected")).toBe("true");
    t.tab("XP").click();
    expect(t.shown()).toEqual(["XP"]);
    expect(t.tab("XP").getAttribute("aria-selected")).toBe("true");
    expect(t.tab("Stats").getAttribute("aria-selected")).toBe("false");
    t.tab(ALL_SECTIONS).click();
    expect(t.shown()).toEqual(["Stats", "Behaviour", "XP"]);
  });

  test("the tab chosen stays chosen when the page draws the next record's sections", async () => {
    const t = form();
    t.groups.append(section("Equip"), section("Attack"));
    await settle();
    t.tab("Attack").click();
    // Opening another item redraws every section from scratch.
    t.groups.replaceChildren(section("Equip"), section("Attack"));
    await settle();
    expect(t.shown()).toEqual(["Attack"]);
    // A record without that section falls back to the first.
    t.groups.replaceChildren(section("Equip"));
    await settle();
    expect(t.shown()).toEqual(["Equip"]);
    expect(t.tabs.el.hidden).toBe(true);
  });

  test("a hidden section has no tab, nested sections are not tabs, and data-tab names a tab", async () => {
    const t = form();
    const hidden = section("Remove this skill");
    hidden.hidden = true;
    const outer = section("Loot, spells and NPC flags (its NPC file)", { tab: "Loot" });
    outer.append(section("Inner"));
    t.groups.append(section("Name"), hidden, outer);
    await settle();
    expect(t.labels()).toEqual(["Name", "Loot", ALL_SECTIONS]);
    hidden.hidden = false;
    t.tabs.select("Remove this skill");
    await settle();
    expect(t.labels()).toEqual(["Name", "Remove this skill", "Loot", ALL_SECTIONS]);
    expect(t.shown()).toEqual(["Remove this skill"]);
  });

  test("a section that saves on its own puts the form's Save bar aside", async () => {
    const t = form();
    t.groups.append(section("Stats"), section("NPC file", { ownSave: true }));
    t.f.append(formActions(document.createElement("button")));
    await settle();
    expect(t.f.classList.contains("control-panel-own-save")).toBe(false);
    t.tab("NPC file").click();
    expect(t.f.classList.contains("control-panel-own-save")).toBe(true);
    t.tab(ALL_SECTIONS).click();
    expect(t.f.classList.contains("control-panel-own-save")).toBe(false);
  });

  test("arrow keys, Home and End move between tabs", async () => {
    const t = form();
    t.groups.append(section("A"), section("B"), section("C"));
    await settle();
    t.tab("A").focus();
    const key = (k: string) =>
      t.tabs.el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("ArrowRight");
    expect(t.shown()).toEqual(["B"]);
    key("End");
    expect(t.tabs.selected()).toBe(ALL_SECTIONS);
    key("ArrowRight");
    expect(t.shown()).toEqual(["A"]);
    key("ArrowLeft");
    expect(t.tabs.selected()).toBe(ALL_SECTIONS);
    key("Home");
    expect(t.shown()).toEqual(["A"]);
  });
});

describe("the Items page's tabs", () => {
  test("an empty form has no tabs, and Save sits in the bar kept in view", async () => {
    const p = createItemsPage({
      view: () => {},
      set: () => {},
      openContent: () => {},
      openContentRow: () => {},
      panels: () => null,
    });
    document.body.append(p.el);
    await settle();
    expect(p.el.querySelector<HTMLElement>(".control-panel-tabs")?.hidden).toBe(true);
    expect(
      p.el.querySelector('.control-panel-form-actions [data-action="items-save"]'),
    ).not.toBeNull();
    // New item lives in the list's column, beside Find.
    expect(p.el.querySelector(".items-list-box .items-new")).not.toBeNull();
  });
});
