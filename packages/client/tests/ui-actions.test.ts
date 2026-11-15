import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import { blankMap, emptyBag, NO_EQUIPMENT, type ServerMsg } from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { showAlert } from "../src/ui/alert.ts";
import { createAmountDialog } from "../src/ui/amount.ts";
import { createAwayWindow } from "../src/ui/away.ts";
import { createBioWindow } from "../src/ui/bio.ts";
import { createCharMenu } from "../src/ui/charmenu.ts";
import { createChatRoomWindow } from "../src/ui/chatroom.ts";
import { createFriendsWindow } from "../src/ui/friends.ts";
import { createImWindows } from "../src/ui/im.ts";
import { createNpcEditor } from "../src/ui/npceditor.ts";
import { createPanel } from "../src/ui/panel.ts";
import { creationScreen, loginScreen, titleScreen } from "../src/ui/screens.ts";
import { createSettingsWindow } from "../src/ui/settings.ts";
import { createShopWindow } from "../src/ui/shop.ts";
import { createSignPanel } from "../src/ui/sign.ts";
import { createTradeWindow } from "../src/ui/trade.ts";
import { createWhoWindow } from "../src/ui/who.ts";
import { createWindowLayer } from "../src/ui/window.ts";
import { createWorldEditor } from "../src/ui/worldeditor.ts";

// ---- every pointer listener, recorded as components are built --------------------------------
const POINTER_EVENTS = new Set([
  "keydown",
  "keyup",
  "input",
  "change",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointerenter",
  "pointerleave",
  "pointerover",
  "pointerout",
  "pointercancel",
  "mousedown",
  "mouseup",
  "mousemove",
  "mouseenter",
  "mouseleave",
  "mouseover",
  "mouseout",
  "touchstart",
  "touchend",
  "touchmove",
]);
const listened = new Map<EventTarget, Set<string>>();
// Wrap inherited methods too, because controls can use their own DOM prototypes.
const wrapped: [object, unknown, boolean][] = [];
for (const proto of [
  EventTarget.prototype,
  Node.prototype,
  Element.prototype,
  HTMLElement.prototype,
  Document.prototype,
  document,
  window,
]) {
  const own = Object.hasOwn(proto, "addEventListener");
  const real = (proto as { addEventListener: (...a: unknown[]) => unknown }).addEventListener;
  wrapped.push([proto, real, own]);
  Object.defineProperty(proto, "addEventListener", {
    configurable: true,
    writable: true,
    value: function (this: EventTarget, type: string, ...rest: unknown[]) {
      if (POINTER_EVENTS.has(type)) {
        const set = listened.get(this) ?? new Set();
        set.add(type);
        listened.set(this, set);
      }
      return real.call(this, type, ...rest);
    },
  });
}
afterAll(() => {
  for (const [proto, real, own] of wrapped.reverse()) {
    if (!own) {
      Reflect.deleteProperty(proto, "addEventListener");
    } else {
      Object.defineProperty(proto, "addEventListener", {
        configurable: true,
        writable: true,
        value: real,
      });
    }
  }
});

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};
/** Actions that do nothing (and allow everything). */
// biome-ignore lint/suspicious/noExplicitAny: a stand-in for every actions interface
const actionCalls: { action: string; args: unknown[] }[] = [];
const noop: any = new Proxy(
  {},
  {
    get:
      (_target, key) =>
      (...args: unknown[]) => {
        actionCalls.push({ action: String(key), args });
        return true;
      },
  },
);

// ---- build every page screen ---------------------------------------------------------------------
function buildAll(): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const holder = (els: HTMLElement[]) => {
    const d = document.createElement("div");
    d.append(...els);
    document.body.append(d);
    roots.push(d);
    return d;
  };
  for (const s of [
    titleScreen(fakeAssets, noop),
    loginScreen(fakeAssets, noop),
    creationScreen(fakeAssets, noop),
  ]) {
    holder(s.items.map((i) => i.el));
  }

  const panel = createPanel(fakeAssets, noop);
  const bag = emptyBag();
  const items = [
    "Apple",
    "Raw Fish",
    "Potion Bottle",
    "Logs",
    "Damaged Short Sword",
    "Wooden crate",
    "Blue Crystals",
  ];
  items.forEach((item, i) => {
    bag[i] = { item, qty: 1 };
  });
  panel.setInventory({ gold: 5, bag, equip: { ...NO_EQUIPMENT, weapon: "Knife" } }, 1);
  holder([panel.el, panel.menuLayer]);
  // Each filled slot opens the item menu with its own Equip replacement; keep a copy of each.
  items.forEach((_, i) => {
    panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot")[i]?.click();
    holder([panel.menuLayer.cloneNode(true) as HTMLElement]);
    for (const b of panel.menuLayer.querySelectorAll("button")) {
      const copy = roots.at(-1)?.querySelector(`[aria-label="${b.getAttribute("aria-label")}"]`);
      if (copy) {
        listened.set(copy, new Set(["click"]));
      }
    }
  });

  holder([createAmountDialog(fakeAssets).el]);
  const shop = createShopWindow(fakeAssets, noop);
  shop.showList("buy", [{ line: 4, item: "Apple", price: 10 }]);
  holder([shop.el.cloneNode(true) as HTMLElement]);
  shop.showVault(["Apple"]);
  holder([shop.el, shop.busy]);
  holder([createCharMenu(fakeAssets, noop).el]);

  const layer = createWindowLayer();
  holder([layer.el]);
  createWhoWindow(fakeAssets, layer).show(["Ann", "Bob"]);
  // A player's own bio shows the editable profile and the medal strip.
  createBioWindow(fakeAssets, layer, noop).showPlayer({
    title: "Ann Star",
    bio: ["Name: Ann Star"],
    profile: "hi",
    medals: ["39"],
    own: true,
  });
  createFriendsWindow(fakeAssets, layer, noop).setNames(["Bob"]);
  // IMsend and all ten IM windows (one IM from each of ten senders), Away, rooms.
  const ims = createImWindows(fakeAssets, layer, noop);
  for (let n = 1; n <= 10; n++) {
    ims.receive(`Sender${n}`, "hi");
  }
  createAwayWindow(fakeAssets, layer, noop);
  createChatRoomWindow(fakeAssets, layer, noop);
  createTradeWindow(fakeAssets, layer, noop);
  // The Settings window with one row of each kind, each with its Reset shown.
  createSettingsWindow(layer, noop).show([
    { key: "a", group: "G", label: "A", tooltip: "", kind: "bool", value: true, default: false },
    {
      key: "b",
      group: "G",
      label: "B",
      tooltip: "",
      kind: "int",
      value: 1,
      default: 2,
      min: 0,
      max: 9,
      unit: "frames",
    },
    {
      key: "c",
      group: "G",
      label: "C",
      tooltip: "",
      kind: "int",
      value: 16,
      default: 8,
      min: 0,
      max: 20,
    },
    { key: "d", group: "G", label: "D", tooltip: "", kind: "map", value: null, default: "x1y1" },
    {
      key: "e",
      group: "G",
      label: "E",
      tooltip: "",
      kind: "point",
      value: { map: "x1y1", x: 1, y: 1 },
      default: null,
    },
    { key: "f", group: "G", label: "F", tooltip: "", kind: "points", value: [], default: [1] },
  ]);

  // The World Editor with a map shown, every panel open; the sign panel in play.
  const editor = createWorldEditor(fakeAssets, noop);
  editor.show(blankMap(1000, 992), false);
  holder(editor.screen.items.map((i) => i.el));
  for (const el of editor.screen.items.map((i) => i.el)) {
    el.hidden = false;
  }
  holder([createSignPanel(fakeAssets).el]);
  // The NPC editor (frame 311).
  holder(createNpcEditor(fakeAssets, noop).screen.items.map((i) => i.el));

  const alertRoot = holder([]);
  void showAlert(alertRoot, "Hello");

  // The app itself: the menu, the playfield canvas, the phone controls and the drawer.
  const appRoot = holder([]);
  const conn: Connection = {
    send: () => {},
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  const app = runApp(appRoot, fakeAssets, conn);
  conn.onMessage({
    t: "welcome",
    protocol: 1,
    id: "me",
    name: "Me",
    token: "00000000-0000-4000-8000-000000000000",
    resumed: false,
    rules: { chatMaxChars: 200 },
  } as ServerMsg);
  app.stop();
  return roots;
}

const roots = buildAll();
const clickables = [
  ...new Set(
    roots.flatMap((r) =>
      [r, ...r.querySelectorAll<HTMLElement>("*")].filter(
        (el) =>
          listened.has(el) ||
          ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName.toUpperCase()),
      ),
    ),
  ),
];
const describeEl = (el: HTMLElement) =>
  `${el.tagName.toLowerCase()}.${el.className} "${el.getAttribute("aria-label") ?? el.textContent ?? ""}"`;

const missingActions = (elements: readonly HTMLElement[]) =>
  elements.filter((el) => !/^[a-z][a-z0-9-]*$/.test(el.dataset.action ?? "")).map(describeEl);

function actionCoverage(elements: readonly HTMLElement[]) {
  const groups: Record<string, { count: number; hidden: number; disabled: number }> = {};
  for (const el of elements) {
    const key = el.dataset.action ?? "";
    const group = groups[key] ?? { count: 0, hidden: 0, disabled: 0 };
    groups[key] = group;
    group.count++;
    if (el.hidden) {
      group.hidden++;
    }
    if ("disabled" in el && (el as HTMLButtonElement).disabled) {
      group.disabled++;
    }
  }
  return groups;
}
const expectedCoverage = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/ui-actions.json"), "utf8"),
);

describe("UI action annotations", () => {
  test("the screen builders expose their controls", () => {
    expect(clickables.length).toBeGreaterThan(80);
  });
  test("interactive controls have semantic action IDs", () => {
    expect(missingActions(clickables)).toEqual([]);
  });
  test("built controls and their initial states match the action contract", () => {
    expect(actionCoverage(clickables)).toEqual(expectedCoverage);
    expect(actionCoverage(clickables.slice(1))).not.toEqual(expectedCoverage);
  });
  test("missing or malformed annotations are reported", () => {
    const unmarked = document.createElement("button");
    const malformed = document.createElement("button");
    malformed.dataset.action = "Bad Action";
    expect(missingActions([unmarked, malformed])).toHaveLength(2);
  });
  test("built controls retain pointer, input and Enter-key outcomes", () => {
    const expected = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/ui-action-outcomes.json"), "utf8"),
    );
    const outcomes = clickables.map((el) => {
      actionCalls.length = 0;
      const events = [...(listened.get(el) ?? [])].sort();
      const before = el.outerHTML;
      const errors: string[] = [];
      for (const event of events) {
        try {
          el.dispatchEvent(
            event.startsWith("key")
              ? new KeyboardEvent(event, { key: "Enter", bubbles: true, cancelable: true })
              : new MouseEvent(event, { bubbles: true, cancelable: true }),
          );
        } catch (error) {
          errors.push(String(error));
        }
      }
      return {
        action: el.dataset.action ?? null,
        tag: el.tagName,
        events,
        hidden: el.hidden,
        changed: before !== el.outerHTML,
        calls: structuredClone(actionCalls),
        errors,
      };
    });
    expect(outcomes).toEqual(expected);
    const wrongDispatch = structuredClone(expected);
    const dispatched = wrongDispatch.find((row: { calls: unknown[] }) => row.calls.length > 0);
    dispatched.calls[0].action = "wrong-action";
    expect(outcomes).not.toEqual(wrongDispatch);
  });
  test("title actions call their corresponding callbacks", () => {
    const calls: string[] = [];
    const screen = titleScreen(fakeAssets, {
      load: () => calls.push("load"),
      create: () => calls.push("create"),
      sound: () => {},
    });
    const elements = screen.items.map((item) => item.el);
    elements.find((el) => el.dataset.action === "title-load-character")!.click();
    elements.find((el) => el.dataset.action === "title-new-character")!.click();
    expect(calls).toEqual(["load", "create"]);
  });
});
