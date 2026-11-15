/** The menu bar widget (ui/menubar.ts). */
import { describe, expect, test } from "bun:test";

import { createMenuBar, type Menu } from "../src/ui/menubar.ts";

function setup(over: { adminVisible?: () => boolean } = {}) {
  const ran: string[] = [];
  const state = { checked: false };
  const menus: Menu[] = [
    {
      title: "File",
      items: [
        { kind: "item", label: "One", run: () => ran.push("one") },
        { kind: "sep" },
        { kind: "item", label: "Off", enabled: () => false, run: () => ran.push("off") },
        {
          kind: "item",
          label: "Box",
          checked: () => state.checked,
          run: () => ran.push("box"),
        },
        { kind: "item", label: "Radio", radio: true, checked: () => true, run: () => {} },
      ],
    },
    { title: "Edit", items: [{ kind: "item", label: "Two", run: () => ran.push("two") }] },
    {
      title: "Admin",
      visible: over.adminVisible ?? (() => true),
      items: [{ kind: "item", label: "Three", run: () => {} }],
    },
  ];
  const bar = createMenuBar(menus);
  document.body.append(bar.el);
  const title = (t: string) =>
    [...bar.el.querySelectorAll<HTMLElement>(".menu-title")].find(
      (e) => e.textContent === t,
    ) as HTMLElement;
  const item = (t: string) =>
    [...bar.el.querySelectorAll<HTMLElement>(".menu-item")].find(
      (e) => e.textContent === t,
    ) as HTMLElement;
  return { bar, ran, state, title, item };
}

describe("menu bar widget", () => {
  test("a title click opens its menu; a second click closes it", () => {
    const { bar, title } = setup();
    title("File").click();
    expect(title("File").getAttribute("aria-expanded")).toBe("true");
    expect(bar.openTitle).toBe("File");
    title("File").click();
    expect(title("File").getAttribute("aria-expanded")).toBe("false");
    expect(bar.el.querySelector(".menu-drop")).toBeNull();
  });

  test("hovering another title while one is open switches to it", () => {
    const { bar, title } = setup();
    title("File").dispatchEvent(new Event("pointerenter"));
    expect(bar.openTitle).toBeNull();
    title("File").click();
    title("Edit").dispatchEvent(new Event("pointerenter"));
    expect(bar.openTitle).toBe("Edit");
    expect(bar.el.querySelectorAll(".menu-drop")).toHaveLength(1);
  });

  test("an enabled item runs once and closes; a disabled one does nothing and stays open", () => {
    const { bar, ran, title, item } = setup();
    title("File").click();
    item("Off").click();
    expect(ran).toEqual([]);
    expect(bar.openTitle).toBe("File");
    expect(item("Off").getAttribute("aria-disabled")).toBe("true");
    item("One").click();
    expect(ran).toEqual(["one"]);
    expect(bar.openTitle).toBeNull();
  });

  test("separators, check marks and radio bullets", () => {
    const { state, title, item, bar } = setup();
    title("File").click();
    expect(bar.el.querySelectorAll(".menu-sep")).toHaveLength(1);
    expect(item("Box").getAttribute("role")).toBe("menuitemcheckbox");
    expect(item("Box").getAttribute("aria-checked")).toBe("false");
    expect(item("Radio").getAttribute("role")).toBe("menuitemradio");
    expect(item("Radio").getAttribute("aria-checked")).toBe("true");
    expect(item("Radio").dataset.mark).toBe("●");
    // Read live each time the menu opens.
    title("File").click();
    state.checked = true;
    title("File").click();
    expect(item("Box").getAttribute("aria-checked")).toBe("true");
    expect(item("Box").dataset.mark).toBe("✓");
  });

  test("a click outside only closes (the catcher swallows it); Escape closes", () => {
    const { bar, title } = setup();
    let behind = 0;
    document.body.addEventListener("pointerdown", () => behind++);
    title("File").click();
    const catcher = bar.el.querySelector(".menu-catcher") as HTMLElement;
    expect(catcher.hidden).toBe(false);
    catcher.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(behind).toBe(0);
    expect(bar.openTitle).toBeNull();
    expect(catcher.hidden).toBe(true);
    title("Edit").click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bar.openTitle).toBeNull();
  });

  test("visible() hides a title; refresh() shows it after a flip and closes a hidden open menu", () => {
    let admin = false;
    const { bar, title } = setup({ adminVisible: () => admin });
    expect(title("Admin").hidden).toBe(true);
    admin = true;
    bar.refresh();
    expect(title("Admin").hidden).toBe(false);
    title("Admin").click();
    admin = false;
    bar.refresh();
    expect(bar.openTitle).toBeNull();
    expect(title("Admin").hidden).toBe(true);
  });

  test("setScale sizes the holder and scales the bar", () => {
    const { bar } = setup();
    bar.setScale(2);
    expect(bar.el.style.width).toBe("1600px");
    expect(bar.el.style.height).toBe("40px");
    expect((bar.el.querySelector(".menu-bar") as HTMLElement).style.transform).toBe("scale(2)");
  });
});
