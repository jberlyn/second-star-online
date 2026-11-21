/**
 * The menu bar on the classic layout (ui/gamemenu.ts).
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { ServerMsg } from "@secondstaronline/shared";
import { MODERATOR, PERMISSIONS } from "@secondstaronline/shared";

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
function start(w = 1024, h = 768) {
  window.innerWidth = w;
  window.innerHeight = h;
  const root = document.createElement("div");
  document.body.append(root);
  const c = conn();
  const app = runApp(root, fakeAssets, c);
  return { root, c, app };
}

describe("the desktop menu bar", () => {
  test("out of the game only what works there shows: the title has Options alone; login and creation add Game with Return To Title Screen", () => {
    const { root, app } = start();
    expect(titles(root)).toEqual(["Options"]);
    menuClick(root, "Options", "Sound Effects");
    expect(localStorage.getItem("sso.sfx")).toBe("0");
    menuClick(root, "Options", "Sound Effects");
    expect(localStorage.getItem("sso.sfx")).toBe("1");
    for (const screen of ["Load Character", "New Character"]) {
      (root.querySelector(`[aria-label="${screen}"]`) as HTMLElement).click();
      expect(titles(root)).toEqual(["Game", "Options"]);
      expect(menuTexts(root, "Game")).toEqual(["Return To Title Screen"]);
      menuClick(root, "Game", "Return To Title Screen");
      expect(titles(root)).toEqual(["Options"]);
    }
    app.stop();
  });

  test("an administrator's role before entry shows no Admin until a character is in play", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    expect(titles(root)).not.toContain("Admin");
    c.onMessage(SNAPSHOT);
    expect(titles(root)).toEqual(["Game", "Chat", "Admin", "Options"]);
    app.stop();
  });

  test("Game and Chat: their order and what each item sends", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    expect(menuTexts(root, "Game")).toEqual([
      "Open Friend's List",
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
    c.onMessage({ t: "chat", text: "old line", color: 0 });
    menuClick(root, "Chat", "Clear Chat Text");
    expect(root.querySelector(".chat-log")?.childElementCount).toBe(0);
    menuClick(root, "Game", "Open Friend's List");
    expect(root.querySelector(".window-friends")?.hasAttribute("hidden")).toBe(false);
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

  test("an administrator gets Admin between Chat and Options, and Admin Chat among the rooms", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    for (const permissions of [[], [...MODERATOR.permissions]]) {
      c.onMessage({ t: "permissions", permissions });
      expect(titles(root)).toEqual(["Game", "Chat", "Options"]);
      expect(menuTexts(root, "Chat")).not.toContain("Admin Chat");
    }
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    expect(titles(root)).toEqual(["Game", "Chat", "Admin", "Options"]);
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

  test("Options offers Modern and Classic Controls, Modern by default, and remembers the choice", () => {
    localStorage.removeItem("sso.controls");
    const a = start();
    expect(menuTexts(a.root, "Options")).toEqual([
      "Sharp Pixels Only",
      "Sound Effects",
      "-",
      "Modern Controls",
      "Classic Controls",
    ]);
    const marks = (root: ParentNode) => {
      menuTexts(root, "Options");
      return [...root.querySelectorAll<HTMLElement>(".menu-drop [role=menuitemradio]")].map(
        (e) => `${e.textContent} ${e.getAttribute("aria-checked")}`,
      );
    };
    expect(marks(a.root)).toEqual(["Modern Controls true", "Classic Controls false"]);
    menuClick(a.root, "Options", "Classic Controls");
    expect(localStorage.getItem("sso.controls")).toBe("classic");
    a.app.stop();
    const b = start();
    expect(marks(b.root)).toEqual(["Modern Controls false", "Classic Controls true"]);
    menuClick(b.root, "Options", "Modern Controls");
    expect(localStorage.getItem("sso.controls")).toBe("modern");
    b.app.stop();
    localStorage.removeItem("sso.controls");
  });

  test("the bar scales with the stage", () => {
    const a = start(1600, 1240);
    menuClick(a.root, "Options", "Sharp Pixels Only");
    const holder = a.root.querySelector(".menu-bar-holder") as HTMLElement;
    expect(holder.style.width).toBe("1600px");
    expect(holder.style.height).toBe("40px");
    expect((a.root.querySelector(".stage") as HTMLElement).style.transform).toBe("scale(2)");
    menuClick(a.root, "Options", "Sharp Pixels Only");
    a.app.stop();
    const b = start(800, 600);
    const s = 600 / 620;
    expect((b.root.querySelector(".stage") as HTMLElement).style.transform).toBe(`scale(${s})`);
    b.app.stop();
  });
});
