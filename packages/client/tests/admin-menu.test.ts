/**
 * Client tests: the Admin, Game and Chat menus. The World and NPC Editors are Control Panel pages
 * with no Admin menu items of their own (issues #32, #33 retired the frame-262 and frame-311 windows).
 */

import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { MODERATOR, PERMISSIONS, type ServerMsg } from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { menuClick, menuTexts, SNAPSHOT, titles } from "./helpers/menu-helpers.ts";

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

describe("the Admin, Game and Chat menus (menu 502)", () => {
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

  test("Admin holds Control Panel, then the three Assassin items; Admin Chat is on Chat; the World page opens on the map you stand on", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    c.onMessage(SNAPSHOT);
    // No World Editor or NPC Editor: both are Control Panel pages.
    expect(menuTexts(root, "Admin")).toEqual([
      "Control Panel",
      "-",
      "Begin Assassin's Game",
      "Begin Lightning Assassin's Game",
      "End Assassin's Game",
    ]);
    menuClick(root, "Chat", "Admin Chat");
    expect(c.sent).toContainEqual({ t: "roomEnter", room: "admin" });
    // Edit Newspaper (on the Game menu for everyone) opens the editor and asks for the paper.
    menuClick(root, "Game", "Edit Newspaper");
    expect(c.sent).toContainEqual({ t: "newspaperLoad" });
    expect(root.querySelectorAll(".window-newspaper-editor:not([hidden])")).toHaveLength(1);
    menuClick(root, "Admin", "Control Panel");
    expect(c.sent).toContainEqual({ t: "controlPanelOpen" });
    c.onMessage({ t: "controlPanel" });
    // The World page opens on the map the admin stood on (x1000y992), as the World Editor did.
    root.querySelector<HTMLElement>('.control-panel-link[data-page="world"]')?.click();
    expect(c.sent).toContainEqual(expect.objectContaining({ t: "contentMaps", mx: 1000, my: 992 }));
    app.stop();
  });

  test("the content permission alone gives every content page, maps and NPC files among them", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const pagesFor = (permissions: string[]) => {
      const root = document.createElement("div");
      document.body.append(root);
      const c = conn();
      const app = runApp(root, fakeAssets, c);
      c.onMessage(welcome);
      c.onMessage({ t: "permissions", permissions } as ServerMsg);
      c.onMessage(SNAPSHOT);
      c.onMessage({ t: "controlPanel" });
      const pages = [...root.querySelectorAll<HTMLElement>(".control-panel-link")].map(
        (a) => a.dataset.page,
      );
      app.stop();
      root.remove();
      return pages;
    };
    // One permission: the World page and Creatures & NPCs (whose Talk & Shops tab edits NPC files),
    // and no NPCs page of its own.
    const editor = pagesFor(["contentEditor"]);
    expect(editor).toContain("world");
    expect(editor).toContain("monsters");
    expect(editor).not.toContain("npcs");
    // Without it, neither.
    const settings = pagesFor(["settings"]);
    expect(settings).not.toContain("world");
    expect(settings).not.toContain("monsters");
  });

  test("the Admin menu shows only for an administrator on the desktop", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    for (const permissions of [[], [...MODERATOR.permissions]]) {
      c.onMessage({ t: "permissions", permissions });
      expect(titles(root)).toEqual(["Game", "Chat"]);
    }
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    expect(titles(root)).toEqual(["Game", "Chat", "Admin"]);
    c.onMessage({ t: "permissions", permissions: [...MODERATOR.permissions] });
    expect(titles(root)).not.toContain("Admin");
    // The content permission adds pages to the Control Panel, not items to the menu.
    c.onMessage({ t: "permissions", permissions: ["contentEditor"] });
    expect(menuTexts(root, "Admin")).toEqual(["Control Panel"]);
    app.stop();
  });

  test("the Game and Chat items: Open Friend's List, Send Instant Message, Edit Newspaper, the four rooms, Clear Chat Text", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    c.onMessage({ t: "chat", text: "old line", color: 0 });
    expect(menuTexts(root, "Game")).toEqual([
      "Open Friend's List",
      "Who's Online",
      "Send Instant Message",
      "Edit Newspaper",
      "-",
      "Settings",
      "Return To Title Screen",
    ]);
    expect(menuTexts(root, "Chat")).toEqual([
      "General Chat",
      "New Player Chat",
      "Trading Post Chat",
      "Guild Chat",
      "-",
      "Clear Chat Text",
    ]);
    menuClick(root, "Chat", "Clear Chat Text");
    expect(root.querySelector(".chat-log")?.childElementCount).toBe(0);
    // The open-Friend's-List command opens the window; it never opens by itself.
    expect(root.querySelector(".window-friends")?.hasAttribute("hidden")).toBe(true);
    menuClick(root, "Game", "Open Friend's List");
    expect(root.querySelector(".window-friends")?.hasAttribute("hidden")).toBe(false);
    menuClick(root, "Game", "Who's Online");
    expect(c.sent).toContainEqual({ t: "whoOpen" });
    menuClick(root, "Game", "Send Instant Message");
    expect(root.querySelector(".window-imsend")?.hasAttribute("hidden")).toBe(false);
    // bug fixed: any player may write the paper their stand shows.
    menuClick(root, "Game", "Edit Newspaper");
    expect(c.sent).toContainEqual({ t: "newspaperLoad" });
    expect(root.querySelectorAll(".window-newspaper-editor:not([hidden])")).toHaveLength(1);
    for (const t of ["General Chat", "New Player Chat", "Trading Post Chat", "Guild Chat"]) {
      menuClick(root, "Chat", t);
    }
    expect(c.sent.filter((m) => (m as { t: string }).t === "roomEnter")).toEqual([
      { t: "roomEnter", room: "general" },
      { t: "roomEnter", room: "newPlayer" },
      { t: "roomEnter", room: "tradingPost" },
      { t: "roomEnter", room: "guild" },
    ]);
    app.stop();
  });

  test("divergence: game entry fills the Friends window but opens it at no size; a player's bio opens the Bio window", () => {
    for (const [w, h] of [
      [1024, 768],
      [390, 844],
    ] as const) {
      window.innerWidth = w;
      window.innerHeight = h;
      const root = document.createElement("div");
      document.body.append(root);
      const c = conn();
      const app = runApp(root, fakeAssets, c);
      c.onMessage(welcome);
      c.onMessage({ t: "friends", names: ["Bob"] });
      const win = root.querySelector(".window-friends") as HTMLElement;
      expect(win.hasAttribute("hidden")).toBe(true);
      expect([...win.querySelectorAll(".friends-name")].map((n) => n.textContent)).toEqual(["Bob"]);
      c.onMessage({
        t: "playerBio",
        title: "Bob Star",
        bio: ["Name: Bob Star"],
        profile: "",
        medals: [],
        own: false,
      });
      expect(root.querySelector(".window-bio")?.hasAttribute("hidden")).toBe(false);
      app.stop();
    }
  });
});
