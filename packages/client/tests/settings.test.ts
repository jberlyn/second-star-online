/**
 * The Settings window (ui/settings.ts) and the admin messages the app handles:
 * `rules`, `restore`, `role`, `settingsResult`.
 */

import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { ServerMsg, SettingRow } from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import {
  checkValue,
  createSettingsWindow,
  parsePoints,
  parsePrizes,
  pointsText,
  SETTINGS_SAVED,
  valueText,
} from "../src/ui/settings.ts";
import { createWindowLayer } from "../src/ui/window.ts";
import { menuClick, SNAPSHOT } from "./helpers/menu-helpers.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

const ROWS: SettingRow[] = [
  {
    key: "startPoint",
    group: "World",
    label: "Start",
    tooltip: "Start.",
    kind: "point",
    value: { map: "x1000y992", x: 6, y: 4 },
    default: { map: "x1000y992", x: 6, y: 4 },
  },
  {
    key: "hazardMap",
    group: "World",
    label: "Spirit",
    tooltip: "Spirit.",
    kind: "map",
    value: null,
    default: null,
  },
  {
    key: "portalTargets",
    group: "World",
    label: "Portal",
    tooltip: "Portal.",
    kind: "points",
    value: [],
    default: [],
  },
  {
    key: "dropOnDeath",
    group: "Items",
    label: "Drop",
    tooltip: "Drops.",
    kind: "bool",
    value: true,
    default: true,
  },
  {
    key: "broadcastCooldown",
    group: "Moderation and security",
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
    key: "saveInterval",
    group: "Server",
    label: "Save",
    tooltip: "Save.",
    kind: "duration",
    value: 30,
    default: 90,
    min: 1,
    max: 3600,
  },
];

function win() {
  const saves: Record<string, unknown>[] = [];
  let loads = 0;
  const layer = createWindowLayer();
  document.body.append(layer.el);
  const w = createSettingsWindow(layer, {
    save: (v) => saves.push(v),
    load: () => {
      loads += 1;
    },
  });
  w.show(ROWS);
  const el = w.window.el;
  const row = (key: string) => el.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const status = () => el.querySelector(".settings-status")?.textContent;
  const type = (input: HTMLInputElement | HTMLTextAreaElement, v: string) => {
    input.value = v;
    input.dispatchEvent(new Event("input"));
  };
  return { w, el, row, status, type, saves, loads: () => loads };
}

describe("the Settings window", () => {
  test("one section per group in the rows' order; every explanation shown, not hovered", () => {
    const { el } = win();
    expect([...el.querySelectorAll(".settings-section h3")].map((h) => h.textContent)).toEqual([
      "World",
      "Items",
      "Moderation and security",
      "Server",
    ]);
    expect([...el.querySelectorAll(".settings-help")].map((p) => p.textContent)).toEqual(
      ROWS.map((r) => r.tooltip),
    );
    expect(el.querySelector(".settings [title]")).toBeNull();
  });

  test("a duration is shown and typed as time, and read as whole seconds", () => {
    const { row } = win();
    const wait = row("broadcastCooldown");
    expect((wait.querySelector("input") as HTMLInputElement).value).toBe("6m 40s");
    expect(wait.querySelector(".settings-unit")?.textContent).toBe("0 = off");
    expect(row("saveInterval").querySelector(".settings-unit")).toBeNull();
  });

  test("a changed row is marked and counted; Reset puts its default back", () => {
    const { row, status, type } = win();
    expect(status()).toBe("No unsaved changes");
    // Save is 30 s on the server, default 90 s: not changed, but resettable.
    const walk = row("saveInterval");
    expect(walk.classList.contains("settings-changed")).toBe(false);
    const reset = walk.querySelector(".settings-reset") as HTMLButtonElement;
    expect(reset.hidden).toBe(false);
    expect(reset.textContent).toBe("Reset to default (1m 30s)");
    reset.click();
    expect(walk.classList.contains("settings-changed")).toBe(true);
    expect(reset.hidden).toBe(true);
    type(row("broadcastCooldown").querySelector("input") as HTMLInputElement, "100s");
    expect(status()).toBe("2 unsaved changes");
  });

  test("Save sends every value from its control; Revert asks again", () => {
    const { row, el, saves, loads, type } = win();
    type(row("broadcastCooldown").querySelector("input") as HTMLInputElement, "1m 40s");
    type(
      row("portalTargets").querySelector("textarea") as HTMLTextAreaElement,
      "x1y1 2 3\nx5y5 6 7",
    );
    (el.querySelector(".settings-save") as HTMLButtonElement).click();
    expect(saves).toEqual([
      {
        startPoint: { map: "x1000y992", x: 6, y: 4 },
        hazardMap: null,
        portalTargets: [
          { map: "x1y1", x: 2, y: 3 },
          { map: "x5y5", x: 6, y: 7 },
        ],
        dropOnDeath: true,
        broadcastCooldown: 100,
        saveInterval: 30,
      },
    ]);
    (el.querySelector(".settings-revert") as HTMLButtonElement).click();
    expect(loads()).toBe(1);
  });

  test("a bad value is shown on its row and nothing is sent", () => {
    const { row, el, saves, status, type } = win();
    const field = row("broadcastCooldown").querySelector("input") as HTMLInputElement;
    type(field, "100");
    (el.querySelector(".settings-save") as HTMLButtonElement).click();
    expect(saves).toEqual([]);
    const err = row("broadcastCooldown").querySelector(".settings-error") as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("Write a time like 30s, 5m, 2h or 7d.");
    expect(status()).toBe("Check Broadcast before saving.");
    // Typing again clears it.
    type(field, "2h");
    expect(err.hidden).toBe(true);
    (el.querySelector(".settings-save") as HTMLButtonElement).click();
    expect(err.textContent).toBe("Enter a time up to 1h, or 0 for off.");
    type(row("saveInterval").querySelector("input") as HTMLInputElement, "0");
    (el.querySelector(".settings-save") as HTMLButtonElement).click();
    expect(row("saveInterval").querySelector(".settings-error")?.textContent).toBe(
      "Enter a time from 1s to 1h.",
    );
    expect(saves).toEqual([]);
  });

  test("the server's answer: saved for everyone, or refused on the setting at fault", () => {
    const { w, row, status } = win();
    w.result({ ok: true });
    expect(status()).toBe(SETTINGS_SAVED);
    w.result({ ok: false, key: "saveInterval", text: "Save: 1 or more" });
    expect(row("saveInterval").querySelector(".settings-error")?.textContent).toBe(
      "Save: 1 or more",
    );
    expect(status()).toBe("Not saved. Check Save.");
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
      group: "Items",
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
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const saves: Record<string, unknown>[] = [];
    const w = createSettingsWindow(layer, { save: (v) => saves.push(v), load: () => {} });
    w.show([prizes]);
    const t = w.window.el.querySelector("textarea") as HTMLTextAreaElement;
    expect(t.value).toBe("Long Sword\n1000 Gold\n500 Gold\nKnife");
    expect(t.getAttribute("data-action")).not.toBeNull();
  });

  test("Login news: free text up to 1000 characters, empty for none", () => {
    const news: SettingRow = {
      key: "news",
      group: "Chat",
      label: "Login news",
      tooltip: "News.",
      kind: "text",
      value: "Welcome to First Star Online!",
      default: "Welcome to First Star Online!",
    };
    expect(checkValue(news, "")).toBeNull();
    expect(checkValue(news, "x".repeat(1001))).toBe("Enter at most 1000 characters.");
    expect(valueText(news, "")).toBe("none");
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const w = createSettingsWindow(layer, { save: () => {}, load: () => {} });
    w.show([news]);
    const t = w.window.el.querySelector("textarea") as HTMLTextAreaElement;
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

  test("Settings in the Admin menu asks for the rows; the reply opens the window", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage({ t: "role", role: "immortal" });
    c.onMessage(SNAPSHOT);
    menuClick(root, "Admin", "Settings");
    expect(c.sent).toContainEqual({ t: "settingsOpen" });
    c.onMessage({ t: "settings", rows: ROWS });
    const w = root.querySelector(".settings")?.closest<HTMLElement>(".sso-window");
    expect(w?.hidden).toBe(false);
    c.onMessage({ t: "settingsResult", ok: true });
    expect(w?.querySelector(".settings-status")?.textContent).toBe(SETTINGS_SAVED);
    // A demotion closes it and hides the Admin section.
    c.onMessage({ t: "role", role: "moderator" });
    expect(w?.hidden).toBe(true);
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
    c.onMessage({ t: "role", role: "immortal" });
    c.onMessage({ t: "settings", rows: ROWS });
    const w = root.querySelector(".settings")?.closest<HTMLElement>(".sso-window");
    expect(w?.hidden).toBe(false);
    c.onMessage({ t: "chat", text: "*** You are being kicked.", color: 0 });
    c.onMessage({ t: "kicked", text: "You have been kicked from the game." });
    c.onGone(null);
    // The connection is gone, but the game (here its open Settings window) stays until OK.
    expect(w?.hidden).toBe(false);
    const ok = document.querySelector<HTMLButtonElement>('[role="alertdialog"] .alert-ok');
    expect(ok?.closest("[role=alertdialog]")?.textContent).toContain(
      "You have been kicked from the game.",
    );
    ok?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(w?.hidden).toBe(true);
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
    c.onMessage({ t: "role", role: "immortal" });
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
