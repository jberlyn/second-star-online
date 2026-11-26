/**
 * Classes for players (issue #15): Game ▸ Your Class only in a world that uses it, the Class window
 * (your class, each way out with every check marked, the Change button), and a trainer's list
 * saying what a class with paths needs.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AssetIndex, ClassRow } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ClassWindowView,
  type ContentData,
  installContent,
} from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { createClassWindow } from "../src/ui/class-window.ts";
import { drawRemovals, removalHeadline } from "../src/ui/content-usage.ts";
import { createShopWindow } from "../src/ui/shop.ts";
import { createWindowLayer } from "../src/ui/window.ts";
import { menuClick, menuTexts, SNAPSHOT } from "./helpers/menu-helpers.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
  hash: null,
  reload: async () => [],
  onReload: () => {},
};

afterEach(() => {
  installContent(buildContentStore(classicData as ContentData));
  localStorage.clear();
  document.body.replaceChildren();
});

function start() {
  const root = document.createElement("div");
  document.body.append(root);
  const sent: { t: string }[] = [];
  const c: Connection = {
    send: (m) => sent.push(m as { t: string }),
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  const app = runApp(root, fakeAssets, c);
  return { root, sent, app, c };
}

describe("Game ▸ Your Class", () => {
  test("not in Classic (1.6 had no Class window)", () => {
    const { root, app, c } = start();
    c.onMessage(SNAPSHOT);
    expect(menuTexts(root, "Game")).not.toContain("Your Class");
    app.stop();
  });

  test("in a world whose classes have a description or a path; it asks the server", () => {
    const d = structuredClone(classicData) as ContentData;
    (d.classes.classes[0] as ClassRow).description = "A fighter.";
    installContent(buildContentStore(d));
    const { root, app, c, sent } = start();
    c.onMessage(SNAPSHOT);
    expect(menuTexts(root, "Game")[0]).toBe("Your Class");
    menuClick(root, "Game", "Your Class");
    expect(sent.at(-1)).toEqual({ t: "classOpen" });
    app.stop();
  });
});

const VIEW: ClassWindowView = {
  current: {
    code: 1,
    name: "Fighter",
    description: "Hits things.",
    icon: null,
    perks: ["+1 melee attack power"],
  },
  ways: [
    {
      to: { code: 4, name: "Grunt", description: null, icon: null, perks: [] },
      text: null,
      trainers: ["Amber"],
      here: false,
      checks: [{ label: "Slash 30 (you have 12)", met: false }],
      grants: ["Thrust raised to a roll of 1 to 10"],
      ready: false,
    },
    {
      to: { code: 5, name: "Swordsman", description: "Fast blades.", icon: null, perks: [] },
      text: "Ask anywhere.",
      trainers: [],
      here: true,
      checks: [
        { label: "level 1 (you have 3)", met: true },
        { label: "40 gold", met: true },
      ],
      grants: ["Fencing raised to 10"],
      ready: true,
    },
  ],
};

describe("the Class window", () => {
  test("your class first, then each way out; a way shows its checks and Change", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const promoted: number[] = [];
    const w = createClassWindow(fakeAssets, layer, { promote: (c) => promoted.push(c) });
    w.show(VIEW);
    const el = w.window.el;
    const rows = [...el.querySelectorAll<HTMLElement>(".class-row")];
    expect(rows.map((r) => r.textContent)).toEqual(["Fighter", "Grunt", "SwordsmanReady"]);
    expect(el.querySelector(".crafting-detail")?.textContent).toContain("+1 melee attack power");
    rows[1]?.click();
    expect(el.querySelector(".crafting-facts")?.textContent).toBe("Taught by Amber");
    expect(
      [...el.querySelectorAll(".class-checks li")].map((li) => [li.className, li.textContent]),
    ).toEqual([["short", "✗Slash 30 (you have 12)"]]);
    // 1.6's promotion is a trainer's: no Change button.
    expect(el.querySelector('[data-action="class-change"]')).toBeNull();
    el.querySelectorAll<HTMLElement>(".class-row")[2]?.click();
    const change = el.querySelector<HTMLButtonElement>('[data-action="class-change"]');
    expect(change?.textContent).toBe("Become a Swordsman");
    expect(change?.disabled).toBe(false);
    change?.click();
    expect(promoted).toEqual([5]);
    // A refresh after the change shows the new class.
    w.show({ current: { ...VIEW.current, code: 5, name: "Swordsman" }, ways: [] });
    expect(el.querySelector(".crafting-title")?.textContent).toBe("Swordsman");
    expect(el.querySelector(".crafting-none")?.textContent).toBe(
      "No class can be reached from yours.",
    );
  });
});

describe("a trainer's list", () => {
  test("a class with paths says what it needs under its name", () => {
    const w = createShopWindow(fakeAssets, {
      buy: () => {},
      sell: () => {},
      train: () => {},
      take: () => {},
      cancel: () => {},
      sound: () => {},
    });
    document.body.append(w.el);
    w.showList("train", [
      { line: 2, item: "Grunt", price: 100 },
      { line: 3, item: "Swordsman", price: 20, note: "Needs Slash 40 ✗, 20 gold ✓." },
    ]);
    const rows = [...w.el.querySelectorAll<HTMLElement>(".shop-list .shop-row")];
    expect(rows.map((r) => r.querySelector(".shop-note")?.textContent ?? null)).toEqual([
      null,
      "Needs Slash 40 ✗, 20 gold ✓.",
    ]);
  });
});

describe("Publish Changes names a class's removal as a class", () => {
  test("its headline and entry", () => {
    const r = [
      {
        kind: "class" as const,
        key: "Swordsman",
        lines: ["1 character moves to Fighter"],
        stillUsed: 0,
        inWorld: 1,
      },
    ];
    expect(removalHeadline(r)).toBe("This draft removes 1 class.");
    expect(drawRemovals(r).querySelector(".content-removals-entry")?.textContent).toBe(
      "Class Swordsman:",
    );
  });
});
