/**
 * 1.6's menu bar on the classic layout (ui/gamemenu.ts).
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { ServerMsg } from "@secondstaronline/shared";

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
const disabled = (root: ParentNode, title: string) => {
  const t = [...root.querySelectorAll<HTMLElement>(".menu-title")].find(
    (b) => b.textContent === title,
  );
  if (t?.getAttribute("aria-expanded") !== "true") {
    t?.click();
  }
  return [...root.querySelectorAll<HTMLElement>(".menu-item")]
    .filter((i) => i.getAttribute("aria-disabled") === "true")
    .map((i) => i.textContent);
};

describe("the desktop menu bar", () => {
  test("menu 500 is up from the title screen: File, Edit, Game, Options; no Admin; Edit and Game greyed before login; Options live", () => {
    const { root, app } = start();
    expect(titles(root)).toEqual(["File", "Edit", "Game", "Options"]);
    expect(disabled(root, "Edit")).toEqual(["Clear Chat Text"]);
    expect(disabled(root, "Game")).toHaveLength(6);
    expect(disabled(root, "File")).toEqual([]);
    menuClick(root, "Options", "Sound Effects");
    expect(localStorage.getItem("sso.sfx")).toBe("0");
    menuClick(root, "Options", "Sound Effects");
    expect(localStorage.getItem("sso.sfx")).toBe("1");
    app.stop();
  });

  test("menu 500's order and what each item sends", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    expect(menuTexts(root, "File")).toEqual(["Return To Title Screen", "Quit Game"]);
    expect(menuTexts(root, "Edit")).toEqual(["Clear Chat Text"]);
    expect(menuTexts(root, "Game")).toEqual([
      "Open Friend's List",
      "-",
      "Send Instant Message",
      "-",
      "General Chat",
      "New Player Chat",
      "Trading Post Chat",
      "Guild Chat",
    ]);
    c.onMessage({ t: "chat", text: "old line", color: 0 });
    menuClick(root, "Edit", "Clear Chat Text");
    expect(root.querySelector(".chat-log")?.childElementCount).toBe(0);
    menuClick(root, "Game", "Open Friend's List");
    expect(root.querySelector(".window-friends")?.hasAttribute("hidden")).toBe(false);
    menuClick(root, "Game", "Send Instant Message");
    expect(root.querySelector(".window-imsend")?.hasAttribute("hidden")).toBe(false);
    for (const r of ["General Chat", "New Player Chat", "Trading Post Chat", "Guild Chat"]) {
      menuClick(root, "Game", r);
    }
    expect(c.sent.filter((m) => m.t === "roomEnter")).toEqual([
      { t: "roomEnter", room: "general" },
      { t: "roomEnter", room: "newPlayer" },
      { t: "roomEnter", room: "tradingPost" },
      { t: "roomEnter", room: "guild" },
    ] as never);
    expect(disabled(root, "Game")).toEqual([]);
    app.stop();
  });

  test("menu 502 puts Admin between Edit and Game for an immortal", () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    for (const role of ["player", "moderator"] as const) {
      c.onMessage({ t: "role", role });
      expect(titles(root)).toEqual(["File", "Edit", "Game", "Options"]);
    }
    c.onMessage({ t: "role", role: "immortal" });
    expect(titles(root)).toEqual(["File", "Edit", "Admin", "Game", "Options"]);
    c.onMessage({ t: "role", role: "player" });
    expect(titles(root)).not.toContain("Admin");
    app.stop();
  });

  test("File > Return To Title Screen: in play it logs out; on the login screen it shows the title", () => {
    const { root, c, app } = start();
    (root.querySelector('[aria-label="Load Character"]') as HTMLElement | null)?.click();
    menuClick(root, "File", "Return To Title Screen");
    expect(c.sent.filter((m) => m.t === "logout")).toHaveLength(0);
    expect(root.querySelector('[aria-label="Load Character"]')).not.toBeNull();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    menuClick(root, "File", "Return To Title Screen");
    expect(c.sent.filter((m) => m.t === "logout")).toHaveLength(1);
    app.stop();
  });

  /** A socket that opens at once, so `onGone`'s reconnect resolves without a server. */
  class OpeningSocket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    constructor() {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send() {}
    close() {}
  }

  test("File > Quit Game: logs out, then the quit screen shows both lines and no alert; a click shows the title", async () => {
    const { root, c, app } = start();
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    menuClick(root, "File", "Quit Game");
    expect(c.sent.filter((m) => m.t === "logout")).toHaveLength(1);
    const realSocket = globalThis.WebSocket;
    globalThis.WebSocket = OpeningSocket as never;
    try {
      c.onGone("You have been logged out.");
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      globalThis.WebSocket = realSocket;
    }
    expect(root.textContent).toContain("You can close this tab now.");
    expect(root.textContent).toContain("Click to return to the title screen.");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    (root.querySelector('[aria-label="Return to the title screen"]') as HTMLElement).click();
    expect(root.querySelector('[aria-label="Load Character"]')).not.toBeNull();
    app.stop();
  });

  test("Quit Game before login goes straight to the quit screen", () => {
    const { root, app } = start();
    menuClick(root, "File", "Quit Game");
    expect(root.textContent).toContain("You can close this tab now.");
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
