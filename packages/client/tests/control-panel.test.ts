/**
 * The Control Panel (ui/control-panel.ts), its shared parts (ui/control-panel-kit.ts) and how the app switches
 * between it and the game (issue #24).
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import {
  MODERATOR,
  PERMISSIONS,
  type Permission,
  type ServerMsg,
  type SettingPage,
  type SettingRow,
} from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { type ControlPanelActions, createControlPanel } from "../src/ui/control-panel.ts";
import { confirmBox, createTable, formField } from "../src/ui/control-panel-kit.ts";
import { createWindowLayer } from "../src/ui/window.ts";
import { menuClick, menuTexts, SNAPSHOT, titles } from "./helpers/menu-helpers.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

const click = (el: Element | null | undefined) => (el as HTMLElement | null)?.click();

function panelWith(perms: Permission[], changes = { n: 0 }) {
  const calls: string[] = [];
  const shown: string[] = [];
  const actions: ControlPanelActions = {
    returnToGame: () => calls.push("returnToGame"),
    returnToTitle: () => calls.push("returnToTitle"),
    openFriends: () => calls.push("openFriends"),
    openWho: () => calls.push("openWho"),
    sendIm: () => calls.push("sendIm"),
    enterRoom: (r) => calls.push(`enterRoom:${r}`),
    playerSettings: () => calls.push("playerSettings"),
  };
  const page = (id: string, title: string, permission: Permission) => {
    const el = document.createElement("div");
    el.className = `page-${id}`;
    return {
      id,
      title,
      group: "Server",
      permission,
      el,
      onShow: () => shown.push(id),
      changes: () => (id === "settings" ? changes.n : 0),
    };
  };
  let can = new Set<Permission>(perms);
  const controlPanel = createControlPanel({
    pages: [page("settings", "Server Settings", "settings"), page("logs", "Logs", "activityLog")],
    links: [
      {
        id: "worldEditor",
        title: "World Editor",
        group: "Classic tools",
        permission: "worldEditor",
        run: () => calls.push("worldEditor"),
      },
    ],
    actions,
    can: (p) => can.has(p),
  });
  document.body.append(controlPanel.el);
  controlPanel.open();
  const q = <T extends Element = HTMLElement>(sel: string) => controlPanel.el.querySelector<T>(sel);
  const sidebar = () =>
    [...controlPanel.el.querySelectorAll(".control-panel-sidebar .control-panel-group")].map(
      (g) => [
        g.querySelector("h2")?.textContent,
        ...[...g.querySelectorAll(".control-panel-link")].map((a) => a.textContent),
      ],
    );
  const setPerms = (p: Permission[]) => {
    can = new Set(p);
    controlPanel.refresh();
  };
  return { controlPanel, calls, shown, q, sidebar, setPerms };
}

describe("the Control Panel shell", () => {
  test("the sidebar lists only the pages and classic tools your role may use, by group", () => {
    const { sidebar, controlPanel, shown } = panelWith(["settings", "worldEditor"]);
    expect(sidebar()).toEqual([
      ["Server", "Server Settings"],
      ["Classic tools", "World Editor"],
    ]);
    // The first page opens and asks for its data; it is marked current.
    expect(controlPanel.page).toBe("settings");
    expect(shown).toEqual(["settings"]);
    expect(controlPanel.el.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Server Settings",
    );
    const all = panelWith(["settings", "activityLog"]);
    expect(all.sidebar()).toEqual([["Server", "Server Settings", "Logs"]]);
    all.controlPanel.go("logs");
    expect(all.controlPanel.page).toBe("logs");
  });

  test("the header's tools call the menu's actions; rooms list Admin Chat only for its holders", () => {
    const { q, calls, setPerms } = panelWith(["settings"]);
    for (const a of [
      "control-panel-friends",
      "control-panel-who",
      "control-panel-im",
      "control-panel-player-settings",
    ]) {
      click(q(`[data-action="${a}"]`));
    }
    expect(calls).toEqual(["openFriends", "openWho", "sendIm", "playerSettings"]);
    const rooms = q<HTMLSelectElement>(".control-panel-rooms");
    const options = () =>
      [...(rooms?.options ?? [])].filter((o) => !o.disabled).map((o) => o.textContent);
    expect(options()).not.toContain("Admin Chat");
    setPerms(["settings", "adminChat"]);
    expect(options()).toContain("Admin Chat");
    if (rooms) {
      rooms.value = "admin";
      rooms.dispatchEvent(new Event("change"));
    }
    expect(calls.at(-1)).toBe("enterRoom:admin");
    expect(rooms?.value).toBe("");
    click(q(".control-panel-to-title"));
    click(q(".control-panel-return"));
    expect(calls.slice(-2)).toEqual(["returnToTitle", "returnToGame"]);
  });

  test("IMs that come while the Control Panel is open are counted on Send IM until it is clicked", () => {
    const { q, controlPanel } = panelWith(["settings"]);
    const badge = q(".control-panel-badge");
    expect(badge?.hidden).toBe(true);
    controlPanel.noteIm();
    controlPanel.noteIm();
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe("2");
    expect(q('[data-action="control-panel-im"]')?.getAttribute("aria-label")).toBe(
      "Send IM, 2 new",
    );
    click(q('[data-action="control-panel-im"]'));
    expect(badge?.hidden).toBe(true);
  });

  test("unsaved changes ask before Return to Game, another page or a classic tool", async () => {
    const changes = { n: 2 };
    const { q, calls, controlPanel } = panelWith(
      ["settings", "activityLog", "worldEditor"],
      changes,
    );
    click(q(".control-panel-return"));
    const box = q(".control-panel-confirm-box");
    expect(box?.getAttribute("role")).toBe("alertdialog");
    expect(box?.textContent).toContain(
      "You have 2 unsaved changes on Server Settings. If you return to the game, they will be discarded.",
    );
    click(q('[data-action="control-panel-confirm-cancel"]'));
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(q(".control-panel-confirm")).toBeNull();
    // Escape is Keep editing too.
    controlPanel.go("logs");
    q(".control-panel-confirm-box")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();
    expect(controlPanel.page).toBe("settings");
    click(q('[data-link="worldEditor"]'));
    click(q('[data-action="control-panel-confirm-ok"]'));
    await Promise.resolve();
    expect(calls).toEqual(["worldEditor"]);
    // No changes: no question.
    changes.n = 0;
    controlPanel.go("logs");
    expect(controlPanel.page).toBe("logs");
  });

  test("losing a page's permission drops its changes; while closed nothing is asked for", () => {
    const discarded: string[] = [];
    let can = new Set<Permission>(["settings", "activityLog"]);
    const shown: string[] = [];
    const page = (id: string, permission: Permission) => ({
      id,
      title: id,
      group: "G",
      permission,
      el: document.createElement("div"),
      onShow: () => shown.push(id),
      changes: () => 1,
      discard: () => discarded.push(id),
    });
    const cp = createControlPanel({
      pages: [page("settings", "settings"), page("logs", "activityLog")],
      links: [],
      actions: {} as ControlPanelActions,
      can: (p) => can.has(p),
    });
    document.body.append(cp.el);
    cp.open();
    can = new Set(["activityLog"]);
    cp.refresh();
    expect(discarded).toEqual(["settings"]);
    expect(cp.page).toBe("logs");
    // Closed: a permission change shows nothing and asks the server for nothing.
    cp.close();
    cp.el.remove();
    shown.length = 0;
    can = new Set(["settings"]);
    cp.refresh();
    expect(shown).toEqual([]);
    expect(cp.page).toBeNull();
    // A new session starts on the first page again.
    cp.reset();
    document.body.append(cp.el);
    can = new Set(["settings", "activityLog"]);
    cp.open();
    expect(cp.page).toBe("settings");
  });

  test("losing a page's permission leaves it; reopening returns to the last page", () => {
    const { controlPanel, setPerms, q } = panelWith(["settings", "activityLog"]);
    controlPanel.go("logs");
    controlPanel.open();
    expect(controlPanel.page).toBe("logs");
    setPerms(["settings"]);
    expect(controlPanel.page).toBe("settings");
    setPerms([]);
    expect(controlPanel.page).toBeNull();
    expect(q(".control-panel-none")?.textContent).toBe("Your role has no admin pages.");
  });
});

describe("the Control Panel's shared parts", () => {
  test("a table lists rows, says when it is empty, and opens a row by click or Enter", () => {
    const opened: string[] = [];
    const t = createTable<{ name: string; n: number }>({
      label: "Players",
      columns: [
        { label: "Name", cell: (r) => r.name },
        { label: "Gold", cell: (r) => String(r.n), numeric: true },
      ],
      empty: "No players.",
      key: (r) => r.name,
      open: { id: "player-open", run: (r) => opened.push(r.name) },
    });
    const empty = t.el.querySelector<HTMLElement>(".control-panel-table-empty");
    t.setRows([]);
    expect(empty?.hidden).toBe(false);
    t.setRows([
      { name: "Ann", n: 5 },
      { name: "Bob", n: 7 },
    ]);
    expect(empty?.hidden).toBe(true);
    expect([...t.el.querySelectorAll("th")].map((h) => h.textContent)).toEqual(["Name", "Gold"]);
    const rows = [...t.el.querySelectorAll<HTMLElement>("tbody tr")];
    expect(rows.map((r) => [r.dataset.key, r.dataset.action, r.textContent])).toEqual([
      ["Ann", "player-open", "Ann5"],
      ["Bob", "player-open", "Bob7"],
    ]);
    rows[0]?.click();
    rows[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(opened).toEqual(["Ann", "Bob"]);
  });

  test("a control inside an openable row does its own job, not the row's", () => {
    const opened: string[] = [];
    const pressed: string[] = [];
    const t = createTable<{ name: string }>({
      label: "Rows",
      columns: [
        { label: "Name", cell: (r) => r.name },
        {
          label: "",
          cell: (r) => {
            const b = document.createElement("button");
            b.addEventListener("click", () => pressed.push(r.name));
            return b;
          },
        },
      ],
      empty: "None",
      key: (r) => r.name,
      open: { id: "row-open", run: (r) => opened.push(r.name) },
    });
    t.setRows([{ name: "Ann" }]);
    const button = t.el.querySelector("tbody button") as HTMLButtonElement;
    button.click();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(pressed).toEqual(["Ann"]);
    expect(opened).toEqual([]);
  });

  test("a form field labels its control and ties its help to it", () => {
    const input = document.createElement("input");
    const f = formField("Name", input, "What players see.");
    const label = f.querySelector("label");
    expect(label?.htmlFor).toBe(input.id);
    expect(input.getAttribute("aria-describedby")).toBe(f.querySelector("p")?.id ?? "");
  });

  test("Tab stays inside a question, and focus goes back where it was when it closes", async () => {
    const host = document.createElement("div");
    const trigger = document.createElement("button");
    host.append(trigger);
    document.body.append(host);
    trigger.focus();
    const answer = confirmBox(host, { text: "Sure?", confirm: "Yes", cancel: "No" });
    const [no, yes] = [
      ...host.querySelectorAll<HTMLButtonElement>(".control-panel-confirm-box button"),
    ];
    const box = host.querySelector(".control-panel-confirm-box");
    expect(document.activeElement === no).toBe(true);
    yes?.focus();
    box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement === no).toBe(true);
    box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement === yes).toBe(true);
    // A click on the question's text focuses the box itself: Tab and Escape still work there.
    expect((box as HTMLElement | null)?.tabIndex).toBe(-1);
    (box as HTMLElement | null)?.focus();
    box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement === no).toBe(true);
    box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await answer).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  test("a floating window larger than the screen shrinks to fit; a small one keeps its size", () => {
    window.innerWidth = 390;
    window.innerHeight = 800;
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const big = layer.create({
      title: "Big",
      name: "big",
      width: 720,
      height: 500,
      body: document.createElement("div"),
    });
    const small = layer.create({
      title: "Small",
      name: "small",
      width: 140,
      height: 200,
      body: document.createElement("div"),
    });
    layer.setScale(1);
    big.open();
    small.open();
    expect(big.el.style.transform).toBe(`scale(${390 / 720})`);
    expect(big.el.style.left).toBe("0px");
    expect(small.el.style.transform).toBe("scale(1)");
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  test("a second question answers the open one with no", async () => {
    const host = document.createElement("div");
    const first = confirmBox(host, { text: "One?", confirm: "Yes", cancel: "No" });
    const second = confirmBox(host, { text: "Two?", confirm: "Yes", cancel: "No", danger: true });
    expect(await first).toBe(false);
    expect(host.querySelectorAll(".control-panel-confirm")).toHaveLength(1);
    expect(host.querySelector(".control-panel-btn-danger")?.textContent).toBe("Yes");
    host.querySelector<HTMLElement>(".control-panel-btn-danger")?.click();
    expect(await second).toBe(true);
  });
});

describe("switching between the game and the Control Panel", () => {
  const conn = (): Connection & { sent: { t: string }[] } => {
    const sent: { t: string }[] = [];
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
  const start = (permissions: readonly string[]) => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...permissions] });
    c.onMessage(SNAPSHOT);
    return { root, c, app };
  };

  test("a role with only the Assassin's Game has no stray separator", () => {
    const { root, app } = start(["assassinGame"]);
    expect(menuTexts(root, "Admin")).toEqual([
      "Begin Assassin's Game",
      "Begin Lightning Assassin's Game",
      "End Assassin's Game",
    ]);
    app.stop();
  });

  test("a moderator gets no Control Panel; an administrator's Admin menu leads with it", () => {
    const mod = start([...MODERATOR.permissions]);
    expect(titles(mod.root)).not.toContain("Admin");
    mod.app.stop();
    const admin = start(["settings"]);
    expect(menuTexts(admin.root, "Admin")).toEqual(["Control Panel"]);
    admin.app.stop();
  });

  test("the Control Panel replaces the game and its menu bar; Return to Game brings the game back", () => {
    const { root, c, app } = start([...PERMISSIONS]);
    menuClick(root, "Admin", "Control Panel");
    expect(c.sent.at(-1)).toEqual({ t: "controlPanelOpen" });
    c.onMessage({ t: "controlPanel" });
    expect(root.querySelector(".control-panel")?.isConnected).toBe(true);
    expect(root.querySelector(".menu-bar")).toBeNull();
    expect(root.querySelector("canvas")).toBeNull();
    // Opening it again from the server changes nothing.
    c.onMessage({ t: "controlPanel" });
    expect(c.sent.filter((m) => m.t === "settingsOpen")).toHaveLength(1);
    click(root.querySelector(".control-panel-return"));
    expect(c.sent.at(-1)).toEqual({ t: "editClose" });
    c.onMessage({ t: "editor", editing: false });
    c.onMessage(SNAPSHOT);
    expect(root.querySelector(".control-panel")).toBeNull();
    expect(root.querySelector(".menu-bar")?.isConnected).toBe(true);
    app.stop();
  });

  test("floating windows open over the Control Panel at their own size, and IMs are counted", () => {
    const { root, c, app } = start([...PERMISSIONS]);
    c.onMessage({ t: "controlPanel" });
    click(root.querySelector('[data-action="control-panel-who"]'));
    expect(c.sent.at(-1)).toEqual({ t: "whoOpen" });
    c.onMessage({ t: "who", names: ["Ann"] });
    const who = root.querySelector<HTMLElement>(".window-who");
    expect(who?.hidden).toBe(false);
    expect(who?.style.transform).toBe("scale(1)");
    c.onMessage({ t: "im", from: "Ann", text: "hi", away: false });
    expect(root.querySelector(".control-panel-badge")?.textContent).toBe("1");
    app.stop();
  });

  test("bug fixed: a resumed connection puts the client back in the game, as the server does", () => {
    const { root, c, app } = start([...PERMISSIONS]);
    c.onMessage({ t: "controlPanel" });
    // The socket dropped and resumed: the server put the character back on the map.
    c.onMessage({ ...welcome, resumed: true } as ServerMsg);
    c.onMessage(SNAPSHOT);
    expect(root.querySelector(".control-panel")).toBeNull();
    expect(root.querySelector(".menu-bar")?.isConnected).toBe(true);
    menuClick(root, "Admin", "Control Panel");
    expect(c.sent.at(-1)).toEqual({ t: "controlPanelOpen" });
    app.stop();
  });

  test("bug fixed: discarded changes are gone when the Control Panel opens again", () => {
    const { root, c, app } = start([...PERMISSIONS]);
    const pages: SettingPage[] = [{ id: "chat", title: "Chat", kind: "rows" }];
    const rows: SettingRow[] = [
      {
        key: "chatCooldown",
        page: "chat",
        label: "Chat wait",
        tooltip: "",
        kind: "duration",
        value: 30,
        default: 30,
        min: 0,
        max: 3600,
      },
    ];
    c.onMessage({ t: "controlPanel" });
    c.onMessage({ t: "settings", pages, rows, roles: [], staff: [] });
    const input = () => root.querySelector<HTMLInputElement>('[data-key="chatCooldown"] input');
    const field = input();
    if (field) {
      field.value = "1m";
      field.dispatchEvent(new Event("input"));
    }
    click(root.querySelector(".control-panel-return"));
    click(root.querySelector('[data-action="control-panel-confirm-ok"]'));
    return Promise.resolve().then(() => {
      expect(c.sent.at(-1)).toEqual({ t: "editClose" });
      c.onMessage({ t: "editor", editing: false });
      c.onMessage(SNAPSHOT);
      // Open again: before the server's reply comes, the page already shows its values.
      c.onMessage({ t: "controlPanel" });
      expect(input()?.value).toBe("30s");
      expect(root.querySelector(".settings-status")?.textContent).toBe("No unsaved changes");
      app.stop();
    });
  });

  test("a server line shows under the header, since the game's chat log is not on screen", () => {
    const { root, c, app } = start([...PERMISSIONS]);
    c.onMessage({ t: "controlPanel" });
    const notice = root.querySelector<HTMLElement>(".control-panel-notice");
    expect(notice?.hidden).toBe(true);
    c.onMessage({ t: "chat", text: "You are not in a guild.", color: 0 });
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toBe("You are not in a guild.");
    expect(notice?.getAttribute("role")).toBe("status");
    app.stop();
  });

  test("a classic editor opens from the Control Panel; its Admin menu goes back to the Control Panel", () => {
    const { root, c, app } = start([...PERMISSIONS]);
    c.onMessage({ t: "controlPanel" });
    click(root.querySelector('[data-link="npcEditor"]'));
    expect(c.sent.at(-1)).toEqual({ t: "npcEditOpen" });
    c.onMessage({ t: "npcEditor" });
    expect(root.querySelector(".control-panel")).toBeNull();
    expect(root.querySelector(".npced-script")).not.toBeNull();
    menuClick(root, "Admin", "Control Panel");
    expect(c.sent.at(-1)).toEqual({ t: "controlPanelOpen" });
    c.onMessage({ t: "controlPanel" });
    expect(root.querySelector(".control-panel")?.isConnected).toBe(true);
    app.stop();
  });
});
