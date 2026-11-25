import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import {
  type ActivityRow,
  ADMINISTRATOR,
  blankMap,
  defaultPlayerPrefs,
  emptyBag,
  NO_EQUIPMENT,
  roleToData,
  type ServerMsg,
} from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { createActivityLogPage } from "../src/ui/activity-log.ts";
import { showAlert } from "../src/ui/alert.ts";
import { createAmountDialog } from "../src/ui/amount.ts";
import { createAwayWindow } from "../src/ui/away.ts";
import { createBioWindow } from "../src/ui/bio.ts";
import { createCharactersPage } from "../src/ui/characters.ts";
import { createCharMenu } from "../src/ui/charmenu.ts";
import { createChatRoomWindow } from "../src/ui/chatroom.ts";
import { createControlPanel } from "../src/ui/control-panel.ts";
import { confirmBox, createTable, formField } from "../src/ui/control-panel-kit.ts";
import { createFriendsWindow } from "../src/ui/friends.ts";
import { createImWindows } from "../src/ui/im.ts";
import { createPanel } from "../src/ui/panel.ts";
import { createPlayerSettingsWindow } from "../src/ui/player-settings.ts";
import { creationScreen, loginScreen, titleScreen } from "../src/ui/screens.ts";
import { createSettingsPanel } from "../src/ui/settings.ts";
import { createShopWindow } from "../src/ui/shop.ts";
import { createSignPanel } from "../src/ui/sign.ts";
import { createTradeWindow } from "../src/ui/trade.ts";
import { createWhoWindow } from "../src/ui/who.ts";
import { createWindowLayer } from "../src/ui/window.ts";

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
  hash: null,
  reload: async () => [],
  onReload: () => {},
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
    "Blue Crystal",
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
  // The Control Panel with every header tool, a page and a classic-tool link, and a page built
  // from the shared parts: a table with openable rows, a form field and an open confirmation.
  const kitPage = document.createElement("div");
  const table = createTable<{ name: string }>({
    label: "Rows",
    columns: [{ label: "Name", cell: (r) => r.name }],
    empty: "None",
    key: (r) => r.name,
    open: { id: "control-panel-row", run: () => {} },
  });
  table.setRows([{ name: "Ann" }]);
  const field = document.createElement("input");
  field.dataset.action = "control-panel-field";
  kitPage.append(table.el, formField("Name", field, "A name."));
  const controlPanel = createControlPanel({
    pages: [{ id: "p", title: "P", group: "G", permission: "settings", el: kitPage }],
    links: [
      { id: "l", title: "L", group: "Classic tools", permission: "worldEditor", run: () => {} },
    ],
    actions: noop,
    can: () => true,
  });
  holder([controlPanel.el]);
  controlPanel.open();
  void confirmBox(controlPanel.el, { text: "Sure?", confirm: "Yes", cancel: "No" });

  // The Server Settings page with one row of each kind, each with its Reset shown.
  const panels = [createSettingsPanel(noop), createSettingsPanel(noop), createSettingsPanel(noop)];
  layer.el.append(...panels.map((p) => p.el));
  panels[0]?.show(
    [{ id: "g", title: "G", kind: "rows" }],
    [
      { key: "a", page: "g", label: "A", tooltip: "", kind: "bool", value: true, default: false },
      {
        key: "b",
        page: "g",
        label: "B",
        tooltip: "",
        kind: "duration",
        value: 1,
        default: 2,
        min: 0,
        max: 9,
        zero: "off",
      },
      {
        key: "c",
        page: "g",
        label: "C",
        tooltip: "",
        kind: "int",
        value: 16,
        default: 8,
        min: 0,
        max: 20,
      },
      { key: "d", page: "g", label: "D", tooltip: "", kind: "map", value: null, default: "x1y1" },
      {
        key: "e",
        page: "g",
        label: "E",
        tooltip: "",
        kind: "point",
        value: { map: "x1y1", x: 1, y: 1 },
        default: null,
      },
      { key: "f", page: "g", label: "F", tooltip: "", kind: "points", value: [], default: [1] },
    ],
  );

  // The Roles and Staff pages, with a role picked and a staff member listed.
  const lists = {
    roles: [{ ...roleToData(ADMINISTRATOR), holders: 1 }],
    staff: [{ name: "Al", role: "administrator" }],
  };
  panels[1]?.show([{ id: "r", title: "R", kind: "roles" }], [], lists);
  panels[2]?.show([{ id: "s", title: "S", kind: "staff" }], [], lists);

  // The Activity Log page: an item's flow (players linked) and a timeline (items linked), each
  // with a row, its totals and a further page.
  const row: ActivityRow = {
    id: "r1",
    at: "2026-11-22T09:00:00.000Z",
    type: "trade",
    character: "Al",
    other: "Bo",
    otherIsPlayer: true,
    item: "Apple",
    qty: -1,
    gold: 0,
    map: "x1y1",
    x: 3,
    y: 4,
    details: null,
  };
  for (const scope of ["item", "character"] as const) {
    let seq = 0;
    const page = createActivityLogPage({ query: (q) => (seq = q.seq) });
    layer.el.append(page.el);
    page.show(scope, scope === "item" ? "Apple" : "Al");
    page.receive({
      seq,
      rows: [row],
      more: true,
      totals: [{ type: "trade", gained: 0, lost: 1, rows: 1 }],
    });
  }

  // The Characters page: a search result, then a hub on each tab (every action allowed).
  {
    const searches: number[] = [];
    const opens: number[] = [];
    const chars = createCharactersPage({
      search: (seq) => searches.push(seq),
      open: (seq) => opens.push(seq),
      moderate: () => {},
      edit: () => {},
      undo: () => {},
      openActivity: () => {},
      can: () => true,
    });
    layer.el.append(chars.el);
    chars.onShow();
    chars.receiveList({
      seq: searches.at(-1) ?? 0,
      rows: [
        {
          name: "Al",
          level: 5,
          classCode: 1,
          role: null,
          online: true,
          lastSaved: "2026-11-22T09:00:00.000Z",
        },
      ],
    });
    const listCopy = chars.el.cloneNode(true) as HTMLElement;
    for (const el of listCopy.querySelectorAll("[data-action]")) {
      listened.set(el, new Set(["click"]));
    }
    holder([listCopy]);
    const bag = emptyBag();
    bag[0] = { item: "Apple", qty: 1 };
    chars.openHub("Al");
    chars.receiveHub({
      seq: opens.at(-1) ?? 0,
      hub: {
        name: "Al",
        role: null,
        created: "2026-11-01T00:00:00.000Z",
        lastSaved: "2026-11-22T09:00:00.000Z",
        presence: "playing",
        sheet: {
          name: "Al",
          sex: 1,
          head: 1,
          classCode: 1,
          level: 5,
          exp: 0,
          expNeeded: 10,
          hp: 1,
          hpMax: 1,
          sp: 1,
          spMax: 1,
          stats: { str: 1, sta: 1, dex: 1, int: 1, wis: 1 },
          skills: { Slash: 1 },
          hunger: 0,
          faction: null,
          factionCount: 0,
          wanted: false,
          position: { map: "x1y1", x: 1, y: 1, facing: "S" },
          respawn: null,
          vehicle: null,
          gold: 0,
          bank: null,
          bag,
          equip: { ...NO_EQUIPMENT },
          vault: [],
          spellbook: [],
          houses: [],
        },
        ban: null,
        jail: null,
        mute: null,
        history: [],
        hunger: { max: 50_000, start: 50_000, afterDeath: 40_000 },
        edits: [
          {
            id: "e1",
            at: "2026-11-22T09:00:00.000Z",
            actorName: "God",
            reason: "refund",
            changes: [{ field: "gold", before: 0, after: 5 }],
            override: false,
            undoOf: null,
            undoneBy: null,
          },
        ],
        chat: [],
        addresses: [],
      },
    });
    // The Edit and Edits tabs as copies (their controls are kept across tabs), then Moderation.
    for (const t of ["edit", "edits"]) {
      chars.el.querySelector<HTMLButtonElement>(`[data-action="hub-tab-${t}"]`)?.click();
      const copy = chars.el.querySelector(".hub-body")?.cloneNode(true) as HTMLElement;
      for (const el of copy.querySelectorAll("[data-action]")) {
        listened.set(el, new Set(el.tagName === "BUTTON" ? ["click"] : ["input"]));
      }
      holder([copy]);
    }
    chars.el.querySelector<HTMLButtonElement>('[data-action="hub-tab-moderation"]')?.click();
  }

  // Player Settings on Controls (keybinds), Sound (sliders/checkboxes), and Social (choices + ignore list).
  const pControls = createPlayerSettingsWindow(layer, noop);
  pControls.open(defaultPlayerPrefs(), ["Spammer"], true);
  pControls.dispose();
  const pSound = createPlayerSettingsWindow(layer, noop);
  pSound.open(defaultPlayerPrefs(), ["Spammer"], true);
  pSound.window.el.querySelector<HTMLButtonElement>('.settings-link[data-page="sound"]')?.click();
  pSound.dispose();
  const pSocial = createPlayerSettingsWindow(layer, noop);
  pSocial.open(defaultPlayerPrefs(), ["Spammer"], true);
  pSocial.window.el.querySelector<HTMLButtonElement>('.settings-link[data-page="social"]')?.click();
  pSocial.dispose();

  // The sign panel in play. (The World Editor is the Control Panel's World page, issue #33.)
  holder([createSignPanel(fakeAssets).el]);

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
  test("the title offers only its two choices and credits the original instead of unFun Games", () => {
    const screen = titleScreen(fakeAssets, noop);
    const elements = screen.items.map((item) => item.el);
    const choices = elements.filter((el) => el.dataset.action);
    expect(choices.map((el) => el.getAttribute("aria-label"))).toEqual([
      "Load Character",
      "New Character",
    ]);
    const footer = elements.find((el) => el.classList.contains("title-credits"))!;
    expect(footer.textContent).toContain("A remake of First Star Online 1.6");
    expect(footer.textContent).toContain("originally by unFun Games");
    expect(footer.textContent).not.toContain("unfungames.com");
  });
});
