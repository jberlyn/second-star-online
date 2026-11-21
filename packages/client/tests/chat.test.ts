/**
 * Chat UI, windows and the Enter-to-chat keyboard, in happy-dom.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import { type ClientMsg, NO_EQUIPMENT, NO_FOG, type ServerMsg } from "@secondstaronline/shared";

import { type App, runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { createChatInput, createChatLog } from "../src/ui/chat.ts";
import { createWhoWindow } from "../src/ui/who.ts";
import { createWindowLayer } from "../src/ui/window.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

const lines = (log: HTMLElement) => [...log.children].map((l) => l.textContent);

describe("chat input", () => {
  test("the left and right insets match inside the frame", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
    document.body.append(style);
    const input = createChatInput();
    document.body.append(input);
    // The browser adds about 3 px at the inline start; the right inset matches it.
    expect([getComputedStyle(input).paddingLeft, getComputedStyle(input).paddingRight]).toEqual([
      "1px",
      "3px",
    ]);
  });
});

describe("chat log", () => {
  test("divergence: the scroll bar shows only when there is text to scroll, in a gutter kept for it", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
    document.body.append(style);
    const game = document.createElement("div");
    game.className = "game";
    game.dataset.shell = "desktop";
    const log = createChatLog();
    game.append(log.el);
    document.body.append(game);
    const css = getComputedStyle(log.el);
    expect([css.overflowY, css.getPropertyValue("scrollbar-gutter")]).toEqual(["auto", "stable"]);
    game.remove();
    style.remove();
  });

  test("lines take their palette colour: 0 white, 4 yellow", () => {
    const log = createChatLog();
    log.add('Bob says "hi"', 0);
    log.add('Bob broadcasts "hi"', 4);
    const [say, bc] = [...log.el.children] as HTMLElement[];
    expect(say?.style.color.toLowerCase()).toMatch(/#ffffff|rgb\(255, 255, 255\)/);
    expect(bc?.style.color.toLowerCase()).toMatch(/#ffff00|rgb\(255, 255, 0\)/);
  });

  test("divergence: identical lines in a row collapse with ×N; anything between starts a new line", () => {
    const log = createChatLog();
    log.add("You cannot fight here!");
    log.add("You cannot fight here!");
    log.add("You cannot fight here!");
    expect(lines(log.el)).toEqual(["You cannot fight here! ×3"]);
    log.add('Bob says "hi"');
    log.add("You cannot fight here!");
    expect(lines(log.el)).toEqual([
      "You cannot fight here! ×3",
      'Bob says "hi"',
      "You cannot fight here!",
    ]);
  });

  test("the web's line collapses too (the movement code sends both once per held-key tick)", () => {
    const log = createChatLog();
    for (let i = 0; i < 4; i++) {
      log.add("Your feet are stuck in the web, you cannot move!");
    }
    expect(lines(log.el)).toEqual(["Your feet are stuck in the web, you cannot move! ×4"]);
  });

  test('a skill gain line prints every time, as 1.6 (5× "You have advanced in the art of Block!")', () => {
    const log = createChatLog();
    for (let i = 0; i < 5; i++) {
      log.add("You have advanced in the art of Block!");
    }
    expect(lines(log.el)).toEqual(Array(5).fill("You have advanced in the art of Block!"));
  });

  test("the same repeating text in another colour does not collapse", () => {
    const log = createChatLog();
    log.add("You cannot fight here!", 0);
    log.add("You cannot fight here!", 4);
    expect(lines(log.el)).toEqual(["You cannot fight here!", "You cannot fight here!"]);
  });
});

describe("Who window", () => {
  test("shows the names, selects one on click, and its buttons do nothing yet", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    layer.setScale(1);
    const who = createWhoWindow(fakeAssets, layer);
    expect(who.window.isOpen).toBe(false);
    who.show(["Alice", "Bob"]);
    expect(who.window.isOpen).toBe(true);
    const rows = [...who.window.el.querySelectorAll<HTMLElement>(".who-name")];
    expect(rows.map((r) => r.textContent)).toEqual(["Alice", "Bob"]);
    rows[1]?.click();
    expect(who.selected).toBe("Bob");
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
    for (const b of who.window.el.querySelectorAll<HTMLButtonElement>(".who-btn")) {
      b.click();
    }
    expect(who.window.isOpen).toBe(true);
    const imgs = [...who.window.el.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(imgs).toEqual([
      "/assets/ui/whowindow-3.png",
      "/assets/ui/whowindow-6.png",
      "/assets/ui/whowindow-7.png",
    ]);
    who.window.el.querySelector<HTMLButtonElement>(".window-close")?.click();
    expect(who.window.isOpen).toBe(false);
    layer.el.remove();
  });

  test("floats at the original size scaled with the frame", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    layer.setScale(2);
    const who = createWhoWindow(fakeAssets, layer);
    who.show(["Alice"]);
    const body = who.window.el.querySelector<HTMLElement>(".window-body");
    expect(body?.style.getPropertyValue("--w")).toBe("120px");
    expect(body?.style.getPropertyValue("--h")).toBe("240px");
    expect(who.window.el.style.transform).toBe("scale(2)");
    layer.setScale(1);
    expect(who.window.el.style.transform).toBe("scale(1)");
    layer.el.remove();
  });
});

// ---- the app: Enter opens chat -------------------------------------

function fakeConn() {
  const sent: ClientMsg[] = [];
  const conn: Connection = {
    send: (m) => sent.push(m),
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  return { conn, sent, receive: (m: ServerMsg) => conn.onMessage(m) };
}

let app: App | null = null;
afterEach(() => {
  app?.stop();
  app = null;
  document.body.replaceChildren();
  localStorage.removeItem("sso.controls");
});

function inGame() {
  const root = document.createElement("div");
  document.body.append(root);
  const c = fakeConn();
  app = runApp(root, fakeAssets, c.conn);
  c.receive({
    t: "welcome",
    protocol: 1,
    id: "me",
    name: "Me",
    token: "00000000-0000-4000-8000-000000000000",
    resumed: false,
    rules: { chatMaxChars: 200 },
  });
  const input = root.querySelector<HTMLInputElement>(".chat-input");
  if (!input) {
    throw new Error("no chat input");
  }
  /** Dispatches a key; returns false when a handler stopped the browser's own action. */
  const key = (target: EventTarget, type: "keydown" | "keyup", k: string, code = k) =>
    target.dispatchEvent(
      new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true }),
    );
  return { ...c, root, input, key };
}

describe("desktop chat keys", () => {
  test("Enter opens the input; arrows then walk nothing; Enter sends and closes it", () => {
    const { input, key, sent } = inGame();
    expect(input.maxLength).toBe(200);
    key(window, "keydown", "Enter");
    expect(document.activeElement).toBe(input);
    sent.length = 0;
    key(input, "keydown", "ArrowLeft");
    key(input, "keyup", "ArrowLeft");
    expect(sent.filter((m) => m.t === "move" || m.t === "step")).toEqual([]);
    input.value = "hello";
    key(input, "keydown", "Enter");
    expect(sent).toEqual([{ t: "chat", text: "hello" }]);
    expect(input.value).toBe("");
    expect(document.activeElement).not.toBe(input);
  });

  test.each([
    ["classic", "ArrowLeft", "ArrowLeft"],
    ["modern", "a", "KeyA"],
  ])(
    "%s: %s walks while the input is closed, committing the direction on the game tick",
    async (layout, k, code) => {
      localStorage.setItem("sso.controls", layout);
      let nextFrame: FrameRequestCallback | undefined;
      const raf = spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        nextFrame = cb;
        return 1;
      });
      try {
        const { key, sent, receive } = inGame();
        const rows = (code: string) =>
          Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
        receive({
          t: "snapshot",
          map: {
            name: "x1000y992",
            title: "",
            layers: [rows("G1"), rows("G3"), rows("G3"), rows("5A")],
            signs: ["", "", ""],
            fog: { ...NO_FOG },
          },
          you: {
            id: "me",
            name: "Me",
            head: 1,
            x: 5,
            y: 5,
            facing: "N",
            step: null,
            equip: { ...NO_EQUIPMENT },
            body: null,
          },
          self: { n: 0, x: 5, y: 5, facing: "N", frames: 0 },
          players: [],
          monsters: [],
          ground: [],
        });
        await Bun.sleep(0);
        expect(sent.some((m) => m.t === "mapReady")).toBe(true);
        key(window, "keydown", k, code);
        expect(sent.some((m) => m.t === "step")).toBe(false);
        nextFrame?.(performance.now() + 100);
        expect(sent.filter((m) => m.t === "step")).toMatchObject([
          { dir: "L", at: { map: "x1000y992", n: 0, x: 5, y: 5 } },
        ]);
        expect(sent.filter((m) => m.t === "move")).toMatchObject([{ held: "L", scheduled: true }]);
      } finally {
        raf.mockRestore();
      }
    },
  );

  test("Modern's A types into the open chat input instead of walking", () => {
    const { input, key, sent } = inGame();
    key(window, "keydown", "Enter");
    sent.length = 0;
    key(input, "keydown", "a", "KeyA");
    key(input, "keyup", "a", "KeyA");
    expect(sent.filter((m) => m.t === "move" || m.t === "step")).toEqual([]);
  });

  test("/ opens the input with the slash typed, in both layouts", () => {
    for (const layout of ["modern", "classic"]) {
      localStorage.setItem("sso.controls", layout);
      app?.stop();
      document.body.replaceChildren();
      const { input, key } = inGame();
      expect(key(window, "keydown", "/", "Slash")).toBe(false); // no quick find
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("/");
      expect(input.selectionStart).toBe(1);
    }
  });

  test("/ after Escape keeps the kept draft and adds the slash", () => {
    const { input, key } = inGame();
    key(window, "keydown", "Enter");
    input.value = "hi ";
    key(input, "keydown", "Escape");
    key(window, "keydown", "/", "Slash");
    expect(input.value).toBe("hi /");
  });

  test("a clicked game button does not keep focus, so Space cannot press it again", () => {
    const { root, input, key } = inGame();
    const tab = root.querySelector<HTMLButtonElement>("button.tab-hit");
    if (!tab) {
      throw new Error("no panel tab");
    }
    key(window, "keydown", "Enter");
    expect(document.activeElement).toBe(input);
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    tab.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true); // the button takes no focus
    expect(document.activeElement).not.toBe(input); // the click still closes the chat input
    expect(document.activeElement).not.toBe(tab);
  });

  test("focusing another game text field releases movement and attack", () => {
    const { root, key, sent } = inGame();
    const field = document.createElement("textarea");
    root.append(field);
    key(window, "keydown", "w", "KeyW");
    key(window, "keydown", " ", "Space");
    field.focus();
    expect(sent).toMatchObject([
      { t: "move", held: "U" },
      { t: "attack", held: true },
      { t: "move", held: null },
      { t: "attack", held: false },
    ]);
    expect(key(field, "keyup", "w", "KeyW")).toBe(true);
    expect(key(field, "keydown", " ", "Space")).toBe(true);
  });

  test("a secondary pointer press on a game button leaves the text field focused", () => {
    const { root, input } = inGame();
    input.focus();
    const down = new PointerEvent("pointerdown", { button: 2, bubbles: true, cancelable: true });
    root.querySelector("button.tab-hit")?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  test("the chat input itself still takes focus from a click", () => {
    const { input } = inGame();
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    input.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });

  test("Escape closes the input and keeps the text; Enter on an empty line sends nothing", () => {
    const { input, key, sent } = inGame();
    key(window, "keydown", "Enter");
    input.value = "draft";
    key(input, "keydown", "Escape");
    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe("draft");
    input.value = "";
    key(window, "keydown", "Enter");
    key(input, "keydown", "Enter");
    expect(sent.filter((m) => m.t === "chat")).toEqual([]);
  });

  test("a line refused by a cooldown comes back into the input", () => {
    const { input, receive, root } = inGame();
    receive({
      t: "chat",
      text: "You cannot broadcast yet - 49 seconds remaining.",
      color: 0,
      restore: "'two",
    });
    expect(input.value).toBe("'two");
    expect(root.querySelector(".chat-log")?.textContent).toContain("49 seconds remaining");
  });

  test("the who reply opens the Who window; presence prints nothing", () => {
    const { receive, root } = inGame();
    receive({ t: "presence", on: true, name: "Bob" });
    expect(root.querySelector(".chat-log")?.textContent).toBe("");
    receive({ t: "who", names: ["Me", "Bob"] });
    const win = document.querySelector<HTMLElement>(".window-who");
    expect(win?.hidden).toBe(false);
  });
});
