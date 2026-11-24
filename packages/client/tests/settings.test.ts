/**
 * The Server Settings page (ui/settings.ts) and the admin messages the app handles:
 * `rules`, `restore`, `role`, `settingsResult`, `controlPanel`.
 */

import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { ServerMsg, SettingPage, SettingRow } from "@secondstaronline/shared";
import {
  ADMINISTRATOR,
  LOCKOUT_TEXT,
  MODERATOR,
  PERMISSIONS,
  roleToData,
} from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import {
  checkValue,
  createSettingsPanel,
  parsePoints,
  parsePrizes,
  pointsText,
  SETTINGS_SAVED,
  valueText,
} from "../src/ui/settings.ts";
import { menuClick, SNAPSHOT } from "./helpers/menu-helpers.ts";

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

const PAGES: SettingPage[] = [
  { id: "world", title: "World", kind: "rows" },
  { id: "items", title: "Items", kind: "rows" },
  { id: "chat", title: "Chat and mail", kind: "rows" },
];

const ROWS: SettingRow[] = [
  {
    key: "startPoint",
    page: "world",
    label: "Start",
    tooltip: "Start.",
    kind: "point",
    value: { map: "x1000y992", x: 6, y: 4 },
    default: { map: "x1000y992", x: 6, y: 4 },
  },
  {
    key: "hazardMap",
    page: "world",
    label: "Spirit",
    tooltip: "Spirit.",
    kind: "map",
    value: null,
    default: null,
  },
  {
    key: "portalTargets",
    page: "world",
    label: "Portal",
    tooltip: "Portal.",
    kind: "points",
    value: [],
    default: [],
  },
  {
    key: "dropOnDeath",
    page: "items",
    label: "Drop",
    tooltip: "Drops.",
    kind: "bool",
    value: true,
    default: true,
  },
  {
    key: "broadcastCooldown",
    page: "chat",
    label: "Broadcast",
    tooltip: "Broadcast.",
    kind: "duration",
    value: 400,
    default: 400,
    min: 0,
    max: 3600,
    zero: "off",
  },
  {
    key: "chatCooldown",
    page: "chat",
    label: "Chat wait",
    tooltip: "Between chat lines.",
    kind: "duration",
    value: 30,
    default: 90,
    min: 1,
    max: 3600,
  },
];

/** The Roles and Staff pages' actions, unused here. */
const NO_ROLES = { saveRole: () => {}, deleteRole: () => {}, assignRole: () => {} };

function win() {
  const saves: Record<string, unknown>[] = [];
  let loads = 0;
  const w = createSettingsPanel({
    ...NO_ROLES,
    save: (v) => saves.push(v),
    load: () => {
      loads += 1;
    },
  });
  document.body.append(w.el);
  w.show(PAGES, ROWS);
  const el = w.el;
  const row = (key: string) => el.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const status = () => el.querySelector(".settings-status")?.textContent;
  const type = (input: HTMLInputElement | HTMLTextAreaElement, v: string) => {
    input.value = v;
    input.dispatchEvent(new Event("input"));
  };
  const link = (id: string) => el.querySelector(`.settings-link[data-page="${id}"]`) as HTMLElement;
  const open = (id: string) => link(id).click();
  const btn = (cls: string) => el.querySelector(`.${cls}`) as HTMLButtonElement;
  const confirm = () => el.querySelector(".settings-confirm") as HTMLElement;
  const search = (q: string) => type(el.querySelector(".settings-search") as HTMLInputElement, q);
  const shownKeys = () =>
    [...el.querySelectorAll(".settings-list:not([hidden]) .settings-row")].map(
      (r) => (r as HTMLElement).dataset.key,
    );
  return {
    w,
    el,
    row,
    status,
    type,
    saves,
    loads: () => loads,
    link,
    open,
    btn,
    confirm,
    search,
    shownKeys,
  };
}

describe("the Server Settings page", () => {
  test("a sidebar link per page; the first page opens, every explanation shown, not hovered", () => {
    const { el, link, shownKeys } = win();
    expect([...el.querySelectorAll(".settings-link")].map((a) => a.textContent)).toEqual([
      "World",
      "Items",
      "Chat and mail",
    ]);
    expect(link("world").getAttribute("aria-current")).toBe("page");
    expect(el.querySelector(".settings-title")?.textContent).toBe("World");
    expect(shownKeys()).toEqual(["startPoint", "hazardMap", "portalTargets"]);
    expect([...el.querySelectorAll(".settings-help")].map((p) => p.textContent)).toEqual([
      "Start.",
      "Spirit.",
      "Portal.",
    ]);
    expect(el.querySelector(".settings [title]")).toBeNull();
  });

  test("a page link opens that page's rows", () => {
    const { el, link, open, shownKeys } = win();
    open("chat");
    expect(shownKeys()).toEqual(["broadcastCooldown", "chatCooldown"]);
    expect(link("chat").getAttribute("aria-current")).toBe("page");
    expect(link("world").hasAttribute("aria-current")).toBe(false);
    expect(el.querySelector(".settings-title")?.textContent).toBe("Chat and mail");
  });

  test("a duration is shown and typed as time, and read as whole seconds", () => {
    const { row, open } = win();
    open("chat");
    const wait = row("broadcastCooldown");
    expect((wait.querySelector("input") as HTMLInputElement).value).toBe("6m 40s");
    // "0 = off" sits by the label, so the field lines up with every other row's.
    expect(wait.querySelector(".settings-label .settings-unit")?.textContent).toBe("0 = off");
    expect(wait.querySelector(".settings-control .settings-unit")).toBeNull();
    expect(row("chatCooldown").querySelector(".settings-unit")).toBeNull();
  });

  test("a changed row is marked and counted, with a dot on its page; Reset puts its default back", () => {
    const { row, status, type, open, link } = win();
    open("chat");
    expect(status()).toBe("No unsaved changes");
    // Chat wait is 30 s on the server, default 90 s: not changed, but resettable.
    const walk = row("chatCooldown");
    expect(walk.classList.contains("settings-changed")).toBe(false);
    const reset = walk.querySelector(".settings-reset") as HTMLButtonElement;
    expect(reset.hidden).toBe(false);
    expect(reset.textContent).toBe("Reset to default (1m 30s)");
    reset.click();
    expect(walk.classList.contains("settings-changed")).toBe(true);
    expect(reset.hidden).toBe(true);
    expect(link("chat").classList.contains("settings-changed")).toBe(true);
    type(row("broadcastCooldown").querySelector("input") as HTMLInputElement, "100s");
    expect(status()).toBe("2 unsaved changes");
  });

  test("Save sends only the open page's values; Revert asks again", () => {
    const { w, row, saves, loads, type, btn, open } = win();
    type(
      row("portalTargets").querySelector("textarea") as HTMLTextAreaElement,
      "x1y1 2 3\nx5y5 6 7",
    );
    btn("settings-save").click();
    expect(saves).toEqual([
      {
        startPoint: { map: "x1000y992", x: 6, y: 4 },
        hazardMap: null,
        portalTargets: [
          { map: "x1y1", x: 2, y: 3 },
          { map: "x5y5", x: 6, y: 7 },
        ],
      },
    ]);
    btn("settings-revert").click();
    expect(loads()).toBe(1);
    // The server's reply shows what it holds, so the page has no changes left to ask about.
    w.show(PAGES, ROWS);
    open("items");
    btn("settings-save").click();
    expect(saves[1]).toEqual({ dropOnDeath: true });
  });

  test("leaving a page with unsaved changes asks; Keep editing stays, Discard goes", () => {
    const { w, el, row, type, open, confirm, btn, shownKeys, link, status } = win();
    open("chat");
    type(row("broadcastCooldown").querySelector("input") as HTMLInputElement, "1m");
    open("items");
    expect(confirm().hidden).toBe(false);
    expect(el.querySelector('[role="alertdialog"]')).toBe(
      confirm().querySelector(".settings-confirm-box"),
    );
    expect(confirm().textContent).toContain(
      "You have an unsaved change on Chat and mail. If you leave this page, it will be discarded.",
    );
    expect(shownKeys()).toEqual(["broadcastCooldown", "chatCooldown"]);
    btn("settings-stay").click();
    expect(confirm().hidden).toBe(true);
    expect(el.querySelector('[role="alertdialog"]')).toBeNull();
    expect((row("broadcastCooldown").querySelector("input") as HTMLInputElement).value).toBe("1m");
    expect(w.page).toBe("chat");
    open("items");
    btn("settings-discard").click();
    expect(confirm().hidden).toBe(true);
    expect(w.page).toBe("items");
    expect(shownKeys()).toEqual(["dropOnDeath"]);
    expect(link("chat").classList.contains("settings-changed")).toBe(false);
    expect(status()).toBe("No unsaved changes");
    // Back on Chat, the server's value is shown again.
    open("chat");
    expect(confirm().hidden).toBe(true);
    expect((row("broadcastCooldown").querySelector("input") as HTMLInputElement).value).toBe(
      "6m 40s",
    );
  });

  test("leaving with unsaved changes asks; Keep editing stays, Discard goes on", () => {
    const { w, row, type, open, confirm, btn } = win();
    let left = 0;
    open("chat");
    type(row("broadcastCooldown").querySelector("input") as HTMLInputElement, "1m");
    expect(w.changes()).toBe(1);
    w.leave(() => left++, "return to the game");
    expect(left).toBe(0);
    expect(confirm().hidden).toBe(false);
    expect(confirm().textContent).toContain(
      "You have an unsaved change on Chat and mail. If you return to the game, it will be discarded.",
    );
    btn("settings-stay").click();
    expect(left).toBe(0);
    expect((row("broadcastCooldown").querySelector("input") as HTMLInputElement).value).toBe("1m");
    w.leave(() => left++, "return to the game");
    btn("settings-discard").click();
    expect(left).toBe(1);
    expect(confirm().hidden).toBe(true);
  });

  test("leaving with no changes does not ask; a question the Control Panel drops goes nowhere", () => {
    const { w, row, type, open, confirm, btn } = win();
    let left = 0;
    w.leave(() => left++);
    expect(left).toBe(1);
    open("chat");
    type(row("broadcastCooldown").querySelector("input") as HTMLInputElement, "1m");
    w.leave(() => left++);
    w.cancelLeave();
    expect(confirm().hidden).toBe(true);
    btn("settings-discard").click();
    expect(left).toBe(1);
  });

  test("an unchanged page, or its own link, never asks", () => {
    const { open, confirm, w, row } = win();
    open("items");
    expect(confirm().hidden).toBe(true);
    expect(w.page).toBe("items");
    (row("dropOnDeath").querySelector("input") as HTMLInputElement).click();
    open("items");
    expect(confirm().hidden).toBe(true);
  });

  test("search finds settings on every page by label or explanation; a result opens its page", () => {
    const { el, search, open, w, confirm, row, type, btn } = win();
    search("portal");
    const results = () =>
      [...el.querySelectorAll(".settings-result")].map((r) => [
        (r as HTMLElement).dataset.key,
        r.querySelector(".settings-result-page")?.textContent,
      ]);
    expect(results()).toEqual([["portalTargets", "World"]]);
    expect((el.querySelector(".settings-list") as HTMLElement).hidden).toBe(true);
    search("between chat");
    expect(results()).toEqual([["chatCooldown", "Chat and mail"]]);
    search("nothing like it");
    expect(el.querySelector(".settings-none")?.textContent).toBe(
      "No setting matches “nothing like it”.",
    );
    // A result on another page asks first when this page has changes.
    open("world");
    type(row("hazardMap").querySelector("input") as HTMLInputElement, "x1y1");
    // The key matches too.
    search("cooldown");
    expect(results().map(([k]) => k)).toEqual(["broadcastCooldown", "chatCooldown"]);
    (el.querySelector('.settings-result[data-key="chatCooldown"]') as HTMLElement).click();
    expect(confirm().hidden).toBe(false);
    btn("settings-discard").click();
    expect(w.page).toBe("chat");
    expect((el.querySelector(".settings-search") as HTMLInputElement).value).toBe("");
    expect((el.querySelector(".settings-list") as HTMLElement).hidden).toBe(false);
    expect(document.activeElement?.closest("[data-key]")?.getAttribute("data-key")).toBe(
      "chatCooldown",
    );
  });

  test("the rows coming again (after a save) stay on the open page", () => {
    const { w, open } = win();
    open("chat");
    w.show(PAGES, ROWS);
    expect(w.page).toBe("chat");
  });

  test("a bad value is shown on its row and nothing is sent", () => {
    const { row, saves, status, type, btn, open } = win();
    open("chat");
    const field = row("broadcastCooldown").querySelector("input") as HTMLInputElement;
    type(field, "100");
    btn("settings-save").click();
    expect(saves).toEqual([]);
    const err = row("broadcastCooldown").querySelector(".settings-error") as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("Write a time like 30s, 5m, 2h or 7d.");
    expect(status()).toBe("Check Broadcast before saving.");
    // Typing again clears it.
    type(field, "2h");
    expect(err.hidden).toBe(true);
    btn("settings-save").click();
    expect(err.textContent).toBe("Enter a time up to 1h, or 0 for off.");
    type(row("chatCooldown").querySelector("input") as HTMLInputElement, "0");
    btn("settings-save").click();
    expect(row("chatCooldown").querySelector(".settings-error")?.textContent).toBe(
      "Enter a time from 1s to 1h.",
    );
    expect(saves).toEqual([]);
  });

  test("the server's answer: saved for everyone, or refused on the setting at fault", () => {
    const { w, row, status, open } = win();
    open("chat");
    w.result({ ok: true });
    expect(status()).toBe(SETTINGS_SAVED);
    w.result({ ok: false, key: "chatCooldown", text: "Chat wait: 1 or more" });
    expect(row("chatCooldown").querySelector(".settings-error")?.textContent).toBe(
      "Chat wait: 1 or more",
    );
    expect(status()).toBe("Not saved. Check Chat wait.");
  });

  test("a choice is a list of its labels; Save sends the value and Reset names the default", () => {
    const drops: SettingRow = {
      key: "deathDrops",
      page: "items",
      label: "Drops on death",
      tooltip: "Drops.",
      kind: "choice",
      choices: [
        { value: "off", label: "Off" },
        { value: "wanted", label: "Wanted only" },
        { value: "everyone", label: "Everyone" },
      ],
      value: "off",
      default: "wanted",
    };
    const { w, row, open, btn, saves } = win();
    w.show(PAGES, [...ROWS, drops]);
    open("items");
    const sel = row("deathDrops").querySelector("select") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Off", "Wanted only", "Everyone"]);
    expect(sel.value).toBe("off");
    expect(sel.dataset.action).toBe("settings-value");
    expect(row("deathDrops").querySelector(".settings-reset")?.textContent).toBe(
      "Reset to default (Wanted only)",
    );
    sel.value = "everyone";
    sel.dispatchEvent(new Event("change"));
    btn("settings-save").click();
    expect(saves.at(-1)).toEqual({ dropOnDeath: true, deathDrops: "everyone" });
    expect(checkValue(drops, "pvp")).toBe("Pick one from the list.");
    expect(checkValue(drops, "wanted")).toBeNull();
  });

  test("checks match the server's schemas", () => {
    const [start, spirit, portal] = ROWS as [SettingRow, SettingRow, SettingRow];
    expect(checkValue(start, { map: "x1y1", x: 17, y: 12 })).toBeNull();
    expect(checkValue(start, { map: "x1y1", x: 18, y: 1 })).toBe("Enter x from 1 to 17.");
    expect(checkValue(start, { map: "home", x: 1, y: 1 })).toBe("Enter a map name like x1000y992.");
    expect(checkValue(spirit, null)).toBeNull();
    expect(checkValue(portal, parsePoints("x1y1 2 3\nx1y1 2"))).toBe(
      "Line 2: write a map and a tile, like x1000y992 5 5 (x 1-17, y 1-12).",
    );
    expect(valueText(portal, [])).toBe("none");
  });

  test("Assassin prizes: four lines, blanks kept; items, gold amounts or blank", () => {
    const prizes: SettingRow = {
      key: "assassinPrizes",
      page: "items",
      label: "Assassin prizes",
      tooltip: "Prizes.",
      kind: "prizes",
      value: ["Long Sword", "1000 Gold", "500 Gold", "Knife"],
      default: ["Long Sword", "1000 Gold", "500 Gold", "Knife"],
    };
    expect(parsePrizes("Long Sword\n\n500 Gold")).toEqual(["Long Sword", "", "500 Gold", ""]);
    expect(parsePrizes("a\nb\nc\nd\ne")).toEqual(["a", "b", "c", "d"]);
    expect(checkValue(prizes, ["Long Sword", "1000 Gold", "", "Knife"])).toBeNull();
    expect(checkValue(prizes, ["Long Sword", "Excalibur", "", ""])).toBe(
      "Line 2: write an item, an amount like 1000 Gold, or leave it empty.",
    );
    expect(checkValue(prizes, ["0 Gold", "", "", ""])).toBe(
      "Line 1: write an item, an amount like 1000 Gold, or leave it empty.",
    );
    expect(valueText(prizes, prizes.default)).toBe("Long Sword, 1000 Gold, 500 Gold, Knife");
    const saves: Record<string, unknown>[] = [];
    const w = createSettingsPanel({
      ...NO_ROLES,
      save: (v) => saves.push(v),
      load: () => {},
    });
    w.show([{ id: "items", title: "Items", kind: "rows" }], [prizes]);
    const t = w.el.querySelector("textarea") as HTMLTextAreaElement;
    expect(t.value).toBe("Long Sword\n1000 Gold\n500 Gold\nKnife");
    expect(t.getAttribute("data-action")).not.toBeNull();
  });

  test("Login news: free text up to 1000 characters, empty for none", () => {
    const news: SettingRow = {
      key: "news",
      page: "chat",
      label: "Login news",
      tooltip: "News.",
      kind: "text",
      value: "Welcome to First Star Online!",
      default: "Welcome to First Star Online!",
    };
    expect(checkValue(news, "")).toBeNull();
    expect(checkValue(news, "x".repeat(1001))).toBe("Enter at most 1000 characters.");
    expect(valueText(news, "")).toBe("none");
    const w = createSettingsPanel({
      ...NO_ROLES,
      save: () => {},
      load: () => {},
    });
    w.show([{ id: "chat", title: "Chat and mail", kind: "rows" }], [news]);
    const t = w.el.querySelector("textarea") as HTMLTextAreaElement;
    expect(t.value).toBe("Welcome to First Star Online!");
    expect(t.getAttribute("data-action")).not.toBeNull();
  });

  test("points text both ways; a line of the wrong shape stays as its text", () => {
    expect(pointsText([{ map: "x1y1", x: 2, y: 3 }])).toBe("x1y1 2 3");
    expect(parsePoints("x1y1 2 3 4\n\n")).toEqual(["x1y1 2 3 4"]);
  });
});

describe("admin messages in the app", () => {
  const conn = (): Connection & { sent: unknown[] } => {
    const sent: unknown[] = [];
    return {
      sent,
      send: (m) => sent.push(m),
      close: () => {},
      onMessage: () => {},
      onGone: () => {},
      token: null,
    };
  };
  const welcome: ServerMsg = {
    t: "welcome",
    protocol: 1,
    id: "me",
    name: "Me",
    token: "00000000-0000-4000-8000-000000000000",
    resumed: false,
    rules: { chatMaxChars: 200 },
  };

  test("Control Panel asks to open; the Control Panel's Server Settings page asks for the rows and saves", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    c.onMessage(SNAPSHOT);
    menuClick(root, "Admin", "Control Panel");
    expect(c.sent).toContainEqual({ t: "controlPanelOpen" });
    expect(c.sent).not.toContainEqual({ t: "settingsOpen" });
    c.onMessage({ t: "controlPanel" });
    expect(c.sent).toContainEqual({ t: "settingsOpen" });
    c.onMessage({ t: "settings", pages: PAGES, rows: ROWS, roles: [], staff: [] });
    const page = root.querySelector<HTMLElement>(".control-panel-main .settings");
    expect(page?.querySelector(".settings-title")?.textContent).toBe("World");
    c.onMessage({ t: "settingsResult", ok: true });
    expect(page?.querySelector(".settings-status")?.textContent).toBe(SETTINGS_SAVED);
    app.stop();
  });

  test("a kick keeps the game behind its alert and leaves only on OK", async () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    c.onMessage({ t: "controlPanel" });
    c.onMessage({ t: "settings", pages: PAGES, rows: ROWS, roles: [], staff: [] });
    const w = root.querySelector<HTMLElement>(".control-panel");
    expect(w?.isConnected).toBe(true);
    c.onMessage({ t: "chat", text: "*** You are being kicked.", color: 0 });
    c.onMessage({ t: "kicked", text: "You have been kicked from the game." });
    c.onGone(null);
    // The connection is gone, but the game (here the open Control Panel) stays until OK.
    expect(w?.isConnected).toBe(true);
    const ok = document.querySelector<HTMLButtonElement>('[role="alertdialog"] .alert-ok');
    expect(ok?.closest("[role=alertdialog]")?.textContent).toContain(
      "You have been kicked from the game.",
    );
    ok?.click();
    await Promise.resolve();
    await Promise.resolve();
    // OK closes the alert; the title screen replaces the Control Panel once the connection is back.
    expect(document.querySelector('[role="alertdialog"] .alert-ok')).toBeNull();
    app.stop();
  });

  test("the Assassin items send at once, no confirmation", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    c.onMessage(SNAPSHOT);
    const click = (text: string) => menuClick(root, "Admin", text);
    click("Begin Assassin's Game");
    click("Begin Lightning Assassin's Game");
    click("End Assassin's Game");
    expect(c.sent.filter((m) => (m as { t: string }).t === "assassinGame")).toEqual([
      { t: "assassinGame", mode: "GO" },
      { t: "assassinGame", mode: "LIGHTNING" },
      { t: "assassinGame", mode: "STOP" },
    ]);
    expect(root.querySelector(".sso-dialog")).toBeNull();
    app.stop();
  });

  test("rules change the chat cap; restore puts a refused line back", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    const input = root.querySelector(".chat-input") as HTMLInputElement;
    c.onMessage({ t: "rules", rules: { chatMaxChars: 50 } });
    expect(input.maxLength).toBe(50);
    c.onMessage({ t: "restore", text: "-hi" });
    expect(input.value).toBe("-hi");
    app.stop();
  });
});

describe("the Roles and Staff pages", () => {
  const roles = [
    { ...roleToData(ADMINISTRATOR), holders: 1 },
    { ...roleToData(MODERATOR), holders: 0 },
  ];
  const staff = [{ name: "Berlyn", role: "administrator" }];
  function open(kind: "roles" | "staff") {
    const calls: unknown[][] = [];
    const w = createSettingsPanel({
      save: () => {},
      load: () => {},
      saveRole: (...a) => calls.push(["saveRole", ...a]),
      deleteRole: (...a) => calls.push(["deleteRole", ...a]),
      assignRole: (...a) => calls.push(["assignRole", ...a]),
    });
    w.show([{ id: kind, title: kind, kind }], [], { roles, staff });
    document.body.append(w.el);
    const q = <T extends Element>(sel: string) => w.el.querySelector(sel) as T;
    const status = () => q<HTMLElement>(".settings-status").textContent;
    return { w, q, calls, status };
  }

  test("a role opens with no unsaved changes, and an edit is sent as the role", () => {
    const { q, calls, status } = open("roles");
    expect(status()).toBe("No unsaved changes");
    const pick = q<HTMLSelectElement>('[data-action="roles-pick"]');
    pick.value = "moderator";
    pick.dispatchEvent(new Event("change"));
    expect(status()).toBe("No unsaved changes");
    q<HTMLInputElement>('[data-permission="warp"]').click();
    expect(status()).toBe("1 unsaved change");
    q<HTMLButtonElement>('[data-action="settings-save"]').click();
    expect(calls).toEqual([
      [
        "saveRole",
        {
          ...roleToData(MODERATOR),
          permissions: PERMISSIONS.filter((p) => p === "warp" || MODERATOR.permissions.has(p)),
        },
        false,
      ],
    ]);
  });

  test("the last role with every permission cannot lose one; nothing is sent", () => {
    const { q, calls, status } = open("roles");
    q<HTMLInputElement>('[data-permission="kick"]').click();
    q<HTMLButtonElement>('[data-action="settings-save"]').click();
    expect(status()).toBe(LOCKOUT_TEXT);
    expect(calls).toEqual([]);
  });

  test("a staff picker sends the change and shows the server's role until it answers", () => {
    const { q, calls } = open("staff");
    const sel = q<HTMLSelectElement>('[data-action="staff-row-role"]');
    sel.value = "";
    sel.dispatchEvent(new Event("change"));
    expect(calls).toEqual([["assignRole", "Berlyn", null]]);
    expect(sel.value).toBe("administrator");
    expect(q<HTMLButtonElement>('[data-action="settings-save"]').hidden).toBe(true);
  });
});
