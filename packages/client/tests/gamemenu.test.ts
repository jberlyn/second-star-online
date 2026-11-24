/**
 * The menu bar on the classic layout (ui/gamemenu.ts).
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { ServerMsg } from "@secondstaronline/shared";
import { MODERATOR, PERMISSIONS } from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { menuClick, menuTexts, openMenu, SNAPSHOT, titles } from "./helpers/menu-helpers.ts";

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

const conn = (): Connection & { sent: { t: string }[] } => {
  const sent: { t: string }[] = [];
  return {
    sent,
    send: (m) => sent.push(m as { t: string }),
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

afterEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

function start(w = 1024, h = 768) {
  window.innerWidth = w;
  window.innerHeight = h;
  const root = document.createElement("div");
  document.body.append(root);
  const c = conn();
  const app = runApp(root, fakeAssets, c);
  return { root, c, app };
}

function openSettingsPage(root: ParentNode, page: string): HTMLElement {
  menuClick(root, "Game", "Settings");
  const win = root.querySelector<HTMLElement>(".window-player-settings");
  if (!win) {
    throw new Error("no player settings window");
  }
  win.querySelector<HTMLButtonElement>(`.settings-link[data-page="${page}"]`)?.click();
  return win;
}

describe("the desktop menu bar", () => {
  test("out of the game only what works there shows: the title has Game with Settings; login and creation add Return To Title Screen", () => {
    const { root, app } = start();
    expect(titles(root)).toEqual(["Game"]);
    expect(menuTexts(root, "Game")).toEqual(["Settings"]);
    const win = openSettingsPage(root, "sound");
    const box = win.querySelector<HTMLInputElement>('[aria-label="Sound effects"]');
    expect(box?.checked).toBe(true);
    if (box) {
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    win.querySelector<HTMLButtonElement>(".settings-save")?.click();
    expect(JSON.parse(localStorage.getItem("sso.prefs") ?? "{}").sfxEnabled).toBe(false);
    win.querySelector<HTMLButtonElement>(".window-close")?.click();

    for (const screen of ["Load Character", "New Character"]) {
      (root.querySelector(`[aria-label="${screen}"]`) as HTMLElement).click();
      expect(titles(root)).toEqual(["Game"]);
      expect(menuTexts(root, "Game")).toEqual(["Settings", "Return To Title Screen"]);
      menuClick(root, "Game", "Return To Title Screen");
      expect(titles(root)).toEqual(["Game"]);
      expect(menuTexts(root, "Game")).toEqual(["Settings"]);
    }
    app.stop();
  });

  test("an administrator's role before entry shows no Admin until a character is in play", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    expect(titles(root)).not.toContain("Admin");
    c.onMessage(SNAPSHOT);
    expect(titles(root)).toEqual(["Game", "Chat", "Admin"]);
    app.stop();
  });

  test("Game and Chat: their order, shortcuts and what each item sends", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    expect(menuTexts(root, "Game")).toEqual([
      "Open Friend's List",
      "Who's Online",
      "Send Instant Message",
      "Edit Newspaper",
      "-",
      "Settings",
      "Return To Title Screen",
    ]);
    // Modern controls show F and O right-aligned on Friend's List and Who's Online.
    const drop = openMenu(root, "Game");
    const shortcutOf = (label: string) =>
      [...(drop?.querySelectorAll<HTMLElement>(".menu-item") ?? [])].find(
        (e) => e.textContent === label,
      )?.dataset.shortcut;
    expect(shortcutOf("Open Friend's List")).toBe("F");
    expect(shortcutOf("Who's Online")).toBe("O");

    expect(menuTexts(root, "Chat")).toEqual([
      "General Chat",
      "New Player Chat",
      "Trading Post Chat",
      "Guild Chat",
      "-",
      "Clear Chat Text",
    ]);
    c.onMessage({ t: "chat", text: "old line", color: 0 });
    menuClick(root, "Chat", "Clear Chat Text");
    expect(root.querySelector(".chat-log")?.childElementCount).toBe(0);
    menuClick(root, "Game", "Open Friend's List");
    expect(root.querySelector(".window-friends")?.hasAttribute("hidden")).toBe(false);
    menuClick(root, "Game", "Who's Online");
    expect(c.sent).toContainEqual({ t: "whoOpen" });
    menuClick(root, "Game", "Send Instant Message");
    expect(root.querySelector(".window-imsend")?.hasAttribute("hidden")).toBe(false);
    for (const r of ["General Chat", "New Player Chat", "Trading Post Chat", "Guild Chat"]) {
      menuClick(root, "Chat", r);
    }
    expect(c.sent.filter((m) => m.t === "roomEnter")).toEqual([
      { t: "roomEnter", room: "general" },
      { t: "roomEnter", room: "newPlayer" },
      { t: "roomEnter", room: "tradingPost" },
      { t: "roomEnter", room: "guild" },
    ] as never);
    app.stop();
  });

  test("an administrator gets Admin after Chat, and Admin Chat among the rooms", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    for (const permissions of [[], [...MODERATOR.permissions]]) {
      c.onMessage({ t: "permissions", permissions });
      expect(titles(root)).toEqual(["Game", "Chat"]);
      expect(menuTexts(root, "Chat")).not.toContain("Admin Chat");
    }
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    expect(titles(root)).toEqual(["Game", "Chat", "Admin"]);
    expect(menuTexts(root, "Chat")).toEqual([
      "General Chat",
      "New Player Chat",
      "Trading Post Chat",
      "Guild Chat",
      "Admin Chat",
      "-",
      "Clear Chat Text",
    ]);
    menuClick(root, "Chat", "Admin Chat");
    expect(c.sent).toContainEqual({ t: "roomEnter", room: "admin" } as never);
    c.onMessage({ t: "permissions", permissions: [] });
    expect(titles(root)).not.toContain("Admin");
    expect(menuTexts(root, "Chat")).not.toContain("Admin Chat");
    app.stop();
  });

  test("no menu offers Quit Game: a page cannot close its own tab", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    c.onMessage(SNAPSHOT);
    const all = titles(root).flatMap((t) => menuTexts(root, t));
    expect(all).not.toContain("Quit Game");
    expect(all.filter((l) => l === "Return To Title Screen")).toHaveLength(1);
    app.stop();
  });

  test("Game > Return To Title Screen: in play it logs out; on the login screen it shows the title", () => {
    const { root, c, app } = start();
    (root.querySelector('[aria-label="Load Character"]') as HTMLElement | null)?.click();
    menuClick(root, "Game", "Return To Title Screen");
    expect(c.sent.filter((m) => m.t === "logout")).toHaveLength(0);
    expect(root.querySelector('[aria-label="Load Character"]')).not.toBeNull();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    menuClick(root, "Game", "Return To Title Screen");
    expect(c.sent.filter((m) => m.t === "logout")).toHaveLength(1);
    app.stop();
  });

  test("a click on the bar casts nothing", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    const t = root.querySelector(".menu-title") as HTMLElement;
    t.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(c.sent.filter((m) => m.t === "cast")).toHaveLength(0);
    app.stop();
  });

  test("Game → Settings offers Modern, Classic and Custom Controls, Modern by default, and remembers the choice", () => {
    const a = start();
    expect(menuTexts(a.root, "Game")).toEqual(["Settings"]);
    const winA = openSettingsPage(a.root, "controls");
    const selA = winA.querySelector<HTMLSelectElement>('[aria-label="Control set"]');
    expect(selA?.value).toBe("modern");
    if (selA) {
      selA.value = "classic";
      selA.dispatchEvent(new Event("change", { bubbles: true }));
    }
    winA.querySelector<HTMLButtonElement>(".settings-save")?.click();
    expect(JSON.parse(localStorage.getItem("sso.prefs") ?? "{}").controlSet).toBe("classic");
    a.app.stop();

    const b = start();
    const winB = openSettingsPage(b.root, "controls");
    const selB = winB.querySelector<HTMLSelectElement>('[aria-label="Control set"]');
    expect(selB?.value).toBe("classic");
    if (selB) {
      selB.value = "modern";
      selB.dispatchEvent(new Event("change", { bubbles: true }));
    }
    winB.querySelector<HTMLButtonElement>(".settings-save")?.click();
    expect(JSON.parse(localStorage.getItem("sso.prefs") ?? "{}").controlSet).toBe("modern");
    b.app.stop();
  });

  test("the bar scales with the stage", () => {
    const a = start(1600, 1240);
    const win = openSettingsPage(a.root, "display");
    const sel = win.querySelector<HTMLSelectElement>('[aria-label="Game size"]');
    if (sel) {
      sel.value = "sharp";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    win.querySelector<HTMLButtonElement>(".settings-save")?.click();
    const holder = a.root.querySelector(".menu-bar-holder") as HTMLElement;
    expect(holder.style.width).toBe("1600px");
    expect(holder.style.height).toBe("40px");
    expect((a.root.querySelector(".stage") as HTMLElement).style.transform).toBe("scale(2)");
    if (sel) {
      sel.value = "fit";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    win.querySelector<HTMLButtonElement>(".settings-save")?.click();
    a.app.stop();
    const b = start(800, 600);
    const s = 600 / 620;
    expect((b.root.querySelector(".stage") as HTMLElement).style.transform).toBe(`scale(${s})`);
    b.app.stop();
  });
});
