/**
 * Client tests: the Admin, Game and Chat menus. Admin → NPC Editor opens the Control Panel's NPCs
 * page (issue #32 retired the frame-311 window).
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

  test("Admin holds Control Panel, World Editor, NPC Editor, Return To Game, then the three Assassin items; Admin Chat is on Chat; NPC Editor opens the Control Panel's NPCs page", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    c.onMessage(SNAPSHOT);
    expect(menuTexts(root, "Admin")).toEqual([
      "Control Panel",
      "-",
      "World Editor",
      "NPC Editor",
      "Return To Game",
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
    // The NPC Editor window is retired (issue #32): its item opens the Control Panel's NPCs page.
    menuClick(root, "Admin", "NPC Editor");
    expect(c.sent).toContainEqual({ t: "controlPanelOpen" });
    c.onMessage({ t: "controlPanel" });
    expect(c.sent).toContainEqual({ t: "contentNpcs", seq: expect.any(Number) });
    expect(root.querySelector(".npcs-page")?.isConnected).toBe(true);
    app.stop();
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
