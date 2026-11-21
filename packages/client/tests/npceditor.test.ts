/**
 * Client tests: the NPC editor (frame 311) and its menu item.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import {
  MODERATOR,
  NPC_EDITOR_MONSTERS,
  NPC_EDITOR_NPCS,
  PERMISSIONS,
  type ServerMsg,
} from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { createNpcEditor, NPC_EDITOR_RECTS, NPC_SCRIPT_DEFAULT } from "../src/ui/npceditor.ts";
import { menuClick, menuTexts, SNAPSHOT, titles } from "./helpers/menu-helpers.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

function editor() {
  const loads: string[] = [];
  const saves: [string, string][] = [];
  const ed = createNpcEditor(fakeAssets, {
    load: (n) => loads.push(n),
    save: (n, t) => saves.push([n, t]),
  });
  const root = document.createElement("div");
  root.append(...ed.screen.items.map((i) => i.el));
  document.body.append(root);
  const byLabel = <T extends HTMLElement>(label: string) =>
    root.querySelector(`[aria-label="${label}"]`) as T;
  const rows = (label: string) => [...byLabel(label).querySelectorAll<HTMLElement>(".npced-row")];
  const lit = (label: string) => rows(label).filter((r) => r.classList.contains("on"));
  return { ed, loads, saves, byLabel, rows, lit };
}

const FRAME = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../../assets/original/main/layout/frame-311.json"),
    "utf8",
  ),
) as { sprites: { channel: number; rect: number[] }[] };
const rectOf = (ch: number) => FRAME.sprites.find((s) => s.channel === ch)?.rect;
const asRect = (r: { x: number; y: number; w: number; h: number }) => [
  r.x,
  r.y,
  r.x + r.w,
  r.y + r.h,
];

describe("the NPC editor screen (frame 311)", () => {
  test("bitmaps sit at frame-311.json's rects: background #224, LOAD #226, SAVE #227", () => {
    expect(asRect(NPC_EDITOR_RECTS.background)).toEqual(rectOf(1) ?? []);
    expect(asRect(NPC_EDITOR_RECTS.load)).toEqual(rectOf(4) ?? []);
    expect(asRect(NPC_EDITOR_RECTS.save)).toEqual(rectOf(5) ?? []);
  });

  test("fields: the member's box plus a 16-px scroll bar, maxHeight tall (span 312-338 stores the monster field at 108×166)", () => {
    // Monster field 92 + 16, NPC field 74 + 16, script field 343 + 16; frame 311 stores the monster
    // field at a stale 92×432.
    expect(NPC_EDITOR_RECTS.monsters).toEqual({ x: 100, y: 117, w: 108, h: 166 });
    expect(NPC_EDITOR_RECTS.npcs).toEqual({ x: 224, y: 117, w: 90, h: 166 });
    expect(NPC_EDITOR_RECTS.script).toEqual({ x: 331, y: 115, w: 359, h: 139 });
    expect(rectOf(7)).toEqual([331, 115, 690, 254]);
    expect(rectOf(2)).toEqual([224, 117, 314, 283]);
  });

  test("the lists hold the monster field's 36 and the NPC field's 56 names in their order", () => {
    const e = editor();
    expect(e.rows("Monsters").map((r) => r.textContent)).toEqual([...NPC_EDITOR_MONSTERS]);
    expect(e.rows("NPCs").map((r) => r.textContent)).toEqual([...NPC_EDITOR_NPCS]);
    expect(NPC_EDITOR_MONSTERS[0]).toBe("Wolf");
    expect(NPC_EDITOR_NPCS[0]).toBe("Water God");
  });

  test("a click lights its line and clears the other list; below the last line the name is EMPTY", () => {
    const e = editor();
    e.rows("Monsters")[2]?.click();
    expect(e.ed.name).toBe("Slime");
    expect(e.lit("Monsters").map((r) => r.textContent)).toEqual(["Slime"]);
    e.rows("NPCs")[4]?.click();
    expect(e.ed.name).toBe("Cril");
    expect(e.lit("Monsters")).toEqual([]);
    expect(e.lit("NPCs").map((r) => r.textContent)).toEqual(["Cril"]);
    e.byLabel("NPCs").click(); // the box itself, below the last line
    expect(e.ed.name).toBe("");
    expect(e.lit("NPCs")).toEqual([]);
  });

  test("the field starts as INV|Broad Sword:1; LOAD and SAVE send the name and the field", () => {
    const e = editor();
    expect(e.byLabel<HTMLTextAreaElement>("NPC script").value).toBe(NPC_SCRIPT_DEFAULT);
    e.byLabel<HTMLButtonElement>("LOAD").click();
    e.byLabel<HTMLButtonElement>("SAVE").click();
    expect([e.loads, e.saves]).toEqual([[], []]); // no name selected: nothing sent
    e.rows("NPCs")[4]?.click();
    e.byLabel<HTMLButtonElement>("LOAD").click();
    expect(e.loads).toEqual(["Cril"]);
    e.byLabel<HTMLTextAreaElement>("NPC script").value = "GLD|5\n";
    e.byLabel<HTMLButtonElement>("SAVE").click();
    expect(e.saves).toEqual([["Cril", "GLD|5\n"]]);
  });

  test("LOAD's reply displays lossless complete text including OWN|, empty lines, and >100 lines", () => {
    const e = editor();
    e.ed.showScript("BIO|Name: Cril\r\rOWN|king\r\nSEL|Knife:5:7");
    expect(e.ed.text).toBe("BIO|Name: Cril\n\nOWN|king\nSEL|Knife:5:7");
    const long = Array.from({ length: 105 }, (_, i) => `BIO|${i + 1}`).join("\r");
    e.ed.showScript(long);
    expect(e.ed.text.split("\n")).toHaveLength(105);
  });
});

describe("the Admin menu's NPC Editor (menu 502)", () => {
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

  test("Admin holds World Editor, NPC Editor, Return To Game, Server Settings, then the three Assassin items; Admin Chat is on Chat; NPC Editor sends npcEditOpen and shows frame 311; the field keeps its text between visits", () => {
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
      "World Editor",
      "NPC Editor",
      "Return To Game",
      "-",
      "Server Settings",
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
    menuClick(root, "Admin", "NPC Editor");
    expect(c.sent).toContainEqual({ t: "npcEditOpen" });
    c.onMessage({ t: "npcEditor" });
    const field = root.querySelector(".npced-script") as HTMLTextAreaElement;
    expect(field).not.toBeNull();
    c.onMessage({ t: "npcScript", name: "Cril", text: "GLD|10" });
    expect(field.value).toBe("GLD|10");
    expect(root.querySelector(".menu-bar")?.isConnected).toBe(true);
    // Return To Game, then back: the same field, the same text (a cast member keeps it).
    menuClick(root, "Admin", "Return To Game");
    expect(c.sent).toContainEqual({ t: "editClose" });
    c.onMessage({ t: "editor", editing: false });
    c.onMessage({ t: "npcEditor" });
    expect((root.querySelector(".npced-script") as HTMLTextAreaElement).value).toBe("GLD|10");
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
      expect(titles(root)).toEqual(["Game", "Chat", "Options"]);
    }
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    expect(titles(root)).toEqual(["Game", "Chat", "Admin", "Options"]);
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
