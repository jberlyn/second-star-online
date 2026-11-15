/**
 * Client tests: the World Editor screen and the sign panel in play.
 */

import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { blankMap, type EditorMap, type ServerMsg } from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { createSignPanel } from "../src/ui/sign.ts";
import { createWorldEditor } from "../src/ui/worldeditor.ts";
import { menuClick, SNAPSHOT, titles } from "./helpers/menu-helpers.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

function editor() {
  const loads: [number, number][] = [];
  const saves: EditorMap[] = [];
  const ed = createWorldEditor(fakeAssets, {
    load: (mx, my) => loads.push([mx, my]),
    save: (m) => saves.push(m),
  });
  const root = document.createElement("div");
  root.append(...ed.screen.items.map((i) => i.el));
  document.body.append(root);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const byLabel = <T extends HTMLElement>(label: string) => q<T>(`[aria-label="${label}"]`);
  const pickList = (label: string, line: string) => {
    const rows = [...byLabel(label).querySelectorAll<HTMLElement>(".we-row")];
    rows.find((r) => r.textContent === line)?.click();
  };
  const click = (x: number, y: number) => {
    ed.canvasDown(x, y);
    ed.canvasUp(x, y);
  };
  return { ed, root, loads, saves, byLabel, pickList, click };
}

const at = (rows: string[], x: number, y: number) => rows[y - 1]?.split(" ")[x - 1];

describe("the World Editor screen (frames 262-288)", () => {
  test("entering: Pencil, layer 1, tile G1; LOAD reads X and Y", () => {
    const e = editor();
    e.ed.show(blankMap(1000, 992), false);
    expect(e.byLabel<HTMLInputElement>("Map X").value).toBe("1000");
    e.click(3, 3);
    expect(at(e.ed.current().layers[0], 3, 3)).toBe("G1");
    e.byLabel<HTMLInputElement>("Map X").value = "1001";
    e.byLabel<HTMLButtonElement>("Load").click();
    e.byLabel<HTMLButtonElement>("Map south").click();
    expect(e.loads).toEqual([
      [1001, 992],
      [1001, 993],
    ]);
  });

  test("layer 2 with the Bucket fills only layer 2", () => {
    const e = editor();
    e.ed.show(blankMap(1, 1), false);
    e.byLabel<HTMLButtonElement>("Layer 2").click();
    e.byLabel<HTMLButtonElement>("Paint bucket").click();
    e.click(1, 1);
    const m = e.ed.current();
    expect(m.layers[1].every((r) => r.split(" ").every((c) => c === "G1"))).toBe(true);
    expect(at(m.layers[0], 1, 1)).toBe("H1");
  });

  test("monsters and NPCs take the first free sprite of 180-183; the ☒ clears all four", () => {
    const e = editor();
    e.ed.show(blankMap(1, 1), false);
    e.pickList("Monsters", "Slime");
    e.click(4, 4);
    e.pickList("NPCs", "Cril");
    e.click(5, 5);
    expect(e.ed.current().mobs).toEqual([
      { name: "Slime", x: 4, y: 4 },
      { name: "Cril", x: 5, y: 5 },
      null,
      null,
    ]);
    e.byLabel<HTMLButtonElement>("Clear monsters").click();
    expect(e.ed.current().mobs).toEqual([null, null, null, null]);
  });

  test("an Exit opens its panel; the fields become exit 1 on SAVE", () => {
    const e = editor();
    e.ed.show(blankMap(1, 1), false);
    e.pickList("Items", "Exit");
    e.click(8, 6);
    const fields = ["Exit map X", "Exit map Y", "Exit tile X", "Exit tile Y"].map(
      (l) =>
        e.root.querySelectorAll<HTMLInputElement>(`[aria-label="${l}"]`)[0] as HTMLInputElement,
    );
    expect(fields[0]?.closest(".we-panel")?.hasAttribute("hidden")).toBe(false);
    ["1001", "992", "3", "3"].forEach((v, i) => {
      (fields[i] as HTMLInputElement).value = v;
    });
    e.byLabel<HTMLButtonElement>("Save").click();
    expect(e.saves[0]?.exit1).toEqual({ mx: 1001, my: 992, x: 3, y: 3 });
    expect(e.saves[0]?.items).toEqual([{ name: "Exit", x: 8, y: 6 }]);
  });

  test("Delete removes a clicked item; a sign's OK keeps its text", () => {
    const e = editor();
    e.ed.show(blankMap(1, 1), false);
    e.pickList("Items", "Sign 2");
    e.click(2, 2);
    e.byLabel<HTMLTextAreaElement>("Sign text").value = "Hello";
    (e.root.querySelector('[data-action="editor-sign-save"]') as HTMLButtonElement).click();
    expect(e.ed.current().signs).toEqual(["", "Hello", ""]);
    e.pickList("Items", "Delete");
    e.click(2, 2);
    expect(e.ed.current().items).toEqual([]);
  });

  test("the flag boxes write field 12; SAFE AREA loads from item 1", () => {
    const e = editor();
    e.ed.show(blankMap(1, 1), false);
    expect(e.ed.current().flags.canFight).toBe("O");
    e.byLabel<HTMLButtonElement>("Safe area").click();
    e.byLabel<HTMLButtonElement>("No PvP").click();
    e.byLabel<HTMLButtonElement>("Faction W").click();
    e.byLabel<HTMLButtonElement>("Faction A").click();
    expect(e.ed.current().flags).toEqual({
      canFight: "X",
      fctSpwn: "A",
      isIndoors: "X",
      canPvp: "O",
    });
  });

  test("kept bug: a map with no exit keeps the last map's exit fields", () => {
    const e = editor();
    const first = blankMap(1, 1);
    first.exit1 = { mx: 7, my: 8, x: 9, y: 10 };
    e.ed.show(first, true);
    e.ed.show(blankMap(2, 2), false);
    expect(e.ed.current().exit1).toEqual({ mx: 7, my: 8, x: 9, y: 10 });
  });

  test("kept bug: the sign panel's background breaks exit 1's map X field", () => {
    const e = editor();
    e.ed.show(blankMap(1, 1), false);
    e.pickList("Items", "Exit");
    e.click(8, 6);
    e.pickList("Items", "Sign 1");
    e.click(9, 6);
    (e.root.querySelector(".we-sign-bg") as HTMLElement).click();
    const mapX = e.root.querySelector('[aria-label="Exit map X"]') as HTMLInputElement;
    expect(mapX.hidden).toBe(true);
  });

  test("with the chat open the brush paints nothing", () => {
    const e = editor();
    e.ed.show(blankMap(1, 1), false);
    (e.root.querySelector(".we-chatbar") as HTMLElement).click();
    e.click(3, 3);
    expect(at(e.ed.current().layers[0], 3, 3)).toBe("H1");
  });

  test("the closed chat strip takes clicks only on the closed strip [15, 465, 402, 479], clear of the header (frame 261 ch 356, 66)", () => {
    const e = editor();
    const items = e.ed.screen.items;
    const bar = items.find((i) => i.el.classList.contains("we-chatbar"));
    const header = items.find((i) => i.el.getAttribute("aria-label") === "Header");
    expect(bar && { x: bar.x, y: bar.y, w: bar.w, h: bar.h }).toEqual({
      x: 15,
      y: 465,
      w: 387,
      h: 14,
    });
    expect(header && bar && header.y + header.h <= bar.y).toBe(true);
    const el = bar?.el as HTMLElement;
    el.style.top = `${bar?.y}px`; // as the stage places it
    el.click();
    // The open strip is [15, 389, 402, 479].
    expect([el.style.top, el.style.height]).toEqual(["389px", "90px"]);
  });
});

describe("signs in play", () => {
  test("the panel shows the text and a click on it closes it", () => {
    const s = createSignPanel(fakeAssets);
    document.body.append(s.el);
    s.show("Welcome");
    expect(s.open).toBe(true);
    expect(s.el.textContent).toBe("Welcome");
    s.el.click();
    expect(s.open).toBe(false);
  });
});

describe("the Admin menu (menu 502) and the editor switch", () => {
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

  test("immortals on desktop see World Editor; it sends editOpen; the editor replaces the game", () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const c = conn();
    const app = runApp(root, fakeAssets, c);
    c.onMessage(welcome);
    c.onMessage(SNAPSHOT);
    c.onMessage({ t: "role", role: "player" });
    expect(titles(root)).not.toContain("Admin");
    c.onMessage({ t: "role", role: "immortal" });
    expect(titles(root)).toContain("Admin");
    menuClick(root, "Admin", "World Editor");
    expect(c.sent).toContainEqual({ t: "editOpen" });
    c.onMessage({ t: "editor", editing: true, map: blankMap(1000, 992), exists: true });
    expect(root.querySelector(".we-canvas")).not.toBeNull();
    // The bar stays up in the editor, so the palette tile and page arrow at the top right take
    // their clicks, and Return To Game is in its Admin menu.
    expect(root.querySelector(".menu-bar")?.isConnected).toBe(true);
    menuClick(root, "Admin", "Return To Game");
    expect(c.sent).toContainEqual({ t: "editClose" });
    app.stop();
  });
});

describe("the World Editor tile palette (frame 261, channels 5-64)", () => {
  test("ink 0 (copy): each palette tile is filled green under the keyed tile, so its green shows", async () => {
    // happy-dom has no 2D context: record each 32×32 palette canvas's calls in order.
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : () => calls.push(`${String(k)}:${String(t.fillStyle)}`)),
      set: (t, k, v) => {
        t[k] = v;
        return true;
      },
    });
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return this.width === 32 && this.height === 32 ? ctx : null;
    } as never;
    try {
      const e = editor();
      e.ed.show(blankMap(1, 1), false);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      HTMLCanvasElement.prototype.getContext = real;
    }
    expect(calls.filter((c) => c === "fillRect:rgb(0,255,0)").length).toBe(60);
    expect(calls.some((c) => c.startsWith("clearRect"))).toBe(false);
  });
  test("empty palette slots are blank and unclickable on every page; added tiles fill page 10 first", () => {
    // Page p (1-9) holds codes "p-0".."p-59"; page 10 holds 49, plus `extra` added tiles in slots 49+.
    const run = (extra: number) => {
      const page = (p: number) => [
        ...Array.from({ length: p === 10 ? 49 : 60 }, (_, i) => `${p}-${i}`),
        ...(p === 10 ? Array.from({ length: extra }, (_, i) => `Z${i}`) : []),
      ];
      const root = document.createElement("div");
      const ed = createWorldEditor(
        fakeAssets,
        { load: () => {}, save: () => {} },
        { pages: 10, page },
      );
      root.append(...ed.screen.items.map((i) => i.el));
      document.body.append(root);
      const slots = () =>
        [...root.querySelectorAll<HTMLButtonElement>("button.hit")].filter(
          (b) => b.firstElementChild instanceof HTMLCanvasElement,
        );
      const next = root.querySelector<HTMLElement>('[aria-label="Next tiles"]') as HTMLElement;
      const prev = root.querySelector<HTMLElement>('[aria-label="Previous tiles"]') as HTMLElement;
      ed.show(blankMap(1, 1), false);
      return { slots, next, prev };
    };
    // No added tiles: page 10's slots 49-59 are blank and disabled, reached from page 9 or from page 1.
    const none = run(0);
    expect(none.slots().length).toBe(60);
    for (let i = 0; i < 8; i++) {
      none.next.click(); // to page 9
    }
    none.next.click(); // page 10, coming from page 9 (1.6 showed page 9's tiles in slots 49-59)
    for (const route of ["from 9", "from 1"]) {
      const s = none.slots();
      expect(s.slice(0, 49).every((b) => b.dataset.code && !b.disabled)).toBe(true);
      for (const b of s.slice(49)) {
        expect(`${route} ${b.dataset.code}`).toBe(`${route} undefined`);
        expect(b.disabled).toBe(true);
      }
      none.next.click(); // wraps to page 1
      none.prev.click(); // back to page 10 from page 1
    }
    // Added tiles fill the free slots; the rest of page 10 is still blank on every page.
    const some = run(2);
    some.prev.click(); // page 1 -> page 10
    const s = some.slots();
    expect(s.slice(49, 51).map((b) => b.dataset.code)).toEqual(["Z0", "Z1"]);
    expect(s.slice(49, 51).every((b) => !b.disabled)).toBe(true);
    for (const b of s.slice(51)) {
      expect(b.dataset.code).toBeUndefined();
      expect(b.disabled).toBe(true);
    }
  });
});
