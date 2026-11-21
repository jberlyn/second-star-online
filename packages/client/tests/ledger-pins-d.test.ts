/**
 * Pins for design and platform changes in docs/differences-from-fso.md: lifted sprite caps on the
 * playfield, the shop list, floating windows, the in-page alert, the sound switch, the centred
 * equipment boxes and `/logchat` as a download.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import {
  CHAT_SOCIAL_TEXT,
  type ClientMsg,
  emptyBag,
  NO_EQUIPMENT,
  type ServerMsg,
} from "@secondstaronline/shared";

import { type App, runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import { createModel, type Peer, walkerPixel } from "../src/model.ts";
import type { Connection } from "../src/net.ts";
import { createPlayfield } from "../src/playfield.ts";
import { createPanel } from "../src/ui/panel.ts";
import { createShopWindow } from "../src/ui/shop.ts";
import { createWindowLayer } from "../src/ui/window.ts";
import { openMenu } from "./helpers/menu-helpers.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
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

let apps: App[] = [];
afterEach(() => {
  for (const a of apps) {
    a.stop();
  }
  apps = [];
  document.body.replaceChildren();
});

function start() {
  const sent: ClientMsg[] = [];
  const conn: Connection = {
    send: (m) => sent.push(m),
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  const root = document.createElement("div");
  document.body.append(root);
  apps.push(runApp(root, fakeAssets, conn));
  return { root, sent, receive: (m: ServerMsg) => conn.onMessage(m) };
}

describe("No per-screen cap on players, monsters or ground items", () => {
  test("design change: every one of 36 other players and 40 ground items on a map can be clicked", () => {
    const assets: Assets = { ...fakeAssets, sprite: () => [0, 0, 0, 64, 64, 32, 32] as never };
    const field = createPlayfield(assets);
    const model = createModel();
    model.self = null;
    const at: { id: string; x: number; y: number }[] = [];
    for (const y of [2, 5, 8, 11]) {
      for (let x = 1; x <= 17; x += 2) {
        const id = `p${x}-${y}`;
        const peer: Peer = {
          id,
          name: id,
          head: 1,
          x,
          y,
          facing: "S",
          frames: 0,
          fromX: x,
          fromY: y,
          atkAnim: 0,
          equip: { ...NO_EQUIPMENT },
          body: null,
          spellAnim: 0,
        };
        model.peers.set(id, peer);
        const p = walkerPixel(x, y, "S", 0);
        at.push({ id, x: p.px, y: p.py + 10 });
      }
    }
    expect(at.length).toBeGreaterThan(15);
    for (const p of at) {
      expect(field.pick(model, p.x, p.y)).toMatchObject({ kind: "player", id: p.id });
    }

    const ground = createModel();
    for (let i = 0; i < 40; i++) {
      const x = (i % 17) + 1;
      const y = Math.floor(i / 17) + 1;
      ground.ground.set(`g${i}`, { id: `g${i}`, name: "Apple", x, y });
    }
    for (let i = 0; i < 40; i++) {
      const x = (i % 17) * 32 + 16;
      const y = Math.floor(i / 17) * 32 + 16;
      expect(field.pick(ground, x, y)).toEqual({ kind: "ground", id: `g${i}` });
    }
  });
});

describe("Shop window lists every SEL line", () => {
  test("design change: a 40-line list shows every row and OK buys the clicked row's line", () => {
    const calls: unknown[][] = [];
    const w = createShopWindow(fakeAssets, {
      buy: (line, n) => calls.push(["buy", line, n]),
      sell: () => {},
      train: () => {},
      take: () => {},
      cancel: () => {},
      sound: () => {},
    });
    document.body.append(w.el, w.busy);
    w.showList(
      "buy",
      Array.from({ length: 40 }, (_, i) => ({ line: i + 3, item: `Item ${i}`, price: 5 })),
    );
    const rows = [...w.el.querySelectorAll<HTMLElement>(".shop-list:not(.shop-vault) .shop-row")];
    expect(rows).toHaveLength(40);
    rows[39]?.click();
    w.el.querySelector<HTMLButtonElement>(".shop-buy-ok")?.click();
    expect(calls).toEqual([["buy", 42, 1]]);
  });
});

describe("Sub-movie windows as floating windows", () => {
  test("design change: a sub-movie window floats in its own layer and drags by its title bar", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const body = document.createElement("div");
    const w = layer.create({ title: "Who", name: "who", width: 120, height: 240, body });
    w.open();
    expect(w.el.parentElement).toBe(layer.el);
    expect(w.el.getAttribute("role")).toBe("dialog");
    const x0 = Number.parseFloat(w.el.style.left);
    const y0 = Number.parseFloat(w.el.style.top);
    const bar = w.el.querySelector<HTMLElement>(".window-bar") as HTMLElement;
    const ev = (type: string, x: number, y: number) =>
      new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true });
    bar.dispatchEvent(ev("pointerdown", 100, 100));
    bar.dispatchEvent(ev("pointermove", 150, 130));
    bar.dispatchEvent(ev("pointerup", 150, 130));
    expect(Number.parseFloat(w.el.style.left)).toBe(x0 + 50);
    expect(Number.parseFloat(w.el.style.top)).toBe(y0 + 30);
    // A later move without a press does not drag it.
    bar.dispatchEvent(ev("pointermove", 300, 300));
    expect(Number.parseFloat(w.el.style.left)).toBe(x0 + 50);
  });
});

describe("Title and login screens in a browser", () => {
  test("design change: a login message is an in-page box with OK, never the browser's alert", async () => {
    const alert = spyOn(window, "alert").mockImplementation(() => {});
    try {
      const { root, receive } = start();
      receive({ t: "denied", text: "Wrong password." } as ServerMsg);
      const box = root.querySelector<HTMLElement>('[role="alertdialog"]');
      expect(box?.textContent).toContain("Wrong password.");
      expect(alert).not.toHaveBeenCalled();
      box?.querySelector<HTMLButtonElement>(".alert-ok")?.click();
      expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    } finally {
      alert.mockRestore();
    }
  });
});

describe("In-game sound effects switch", () => {
  const sfxItem = (root: HTMLElement) =>
    [...(openMenu(root, "Options")?.querySelectorAll<HTMLElement>(".menu-item") ?? [])].find(
      (e) => e.textContent === "Sound Effects",
    );

  test("design change: Sound Effects defaults to on on the title screen and the browser remembers it", () => {
    localStorage.clear();
    const a = start();
    expect(sfxItem(a.root)?.getAttribute("aria-checked")).toBe("true");
    sfxItem(a.root)?.click();
    expect(sfxItem(a.root)?.getAttribute("aria-checked")).toBe("false");
    // A new page in the same browser keeps it off.
    const b = start();
    expect(sfxItem(b.root)?.getAttribute("aria-checked")).toBe("false");
    localStorage.clear();
  });
});

describe("Equipment icons, × markers and the paperdoll centred on their boxes", () => {
  test("design change: each icon's bitmap is centred in its box; the × markers centre on the rows, 8 px out", () => {
    // A 28×20 icon whose registration point is far from its centre.
    const assets: Assets = {
      ...fakeAssets,
      sprite: (group) => (group === "items" ? ([0, 0, 0, 28, 20, 3, 17] as never) : undefined),
    };
    const panel = createPanel(assets, {
      use: () => {},
      equip: () => {},
      drop: () => {},
      give: () => {},
      unequip: () => {},
      crystals: () => {},
      oneCrystal: () => {},
      stack: () => {},
      arrange: () => {},
      gold: () => {},
      sound: () => {},
      canModify: () => true,
      say: () => {},
    });
    panel.setInventory(
      {
        gold: 0,
        bag: emptyBag(),
        equip: {
          ...NO_EQUIPMENT,
          head: "Chain Helm",
          weapon: "Knife",
          feet: "Boots",
          body: "Robe",
          offHand: "Shield",
          ring: "Ring",
        },
      },
      1,
    );
    const PANEL_X = 566;
    const boxes = [626, 726].flatMap((x) => [280, 318, 358].map((y) => ({ x, y })));
    const icons = [...panel.el.querySelectorAll<HTMLCanvasElement>("canvas.sprite")].filter(
      (c) => c.style.width === "28px",
    );
    expect(icons).toHaveLength(6);
    const centres = icons.map((c) => ({
      x: Number.parseFloat(c.style.left) + PANEL_X + 14,
      y: Number.parseFloat(c.style.top) + 10,
    }));
    for (const b of boxes) {
      const cx = b.x + 17.5;
      const cy = b.y + 17.5;
      expect(centres.some((c) => Math.abs(c.x - cx) <= 0.5 && Math.abs(c.y - cy) <= 0.5)).toBe(
        true,
      );
    }
    const marks = [...panel.el.querySelectorAll<HTMLButtonElement>(".equip-x")];
    expect(marks).toHaveLength(6);
    for (const m of marks) {
      const left = Number.parseFloat(m.style.left) + PANEL_X;
      const top = Number.parseFloat(m.style.top);
      const cx = left + 7.5;
      const cy = top + 7;
      // 8 px outside the left boxes (x 626) or the right boxes (x 726 + 35).
      expect(Math.abs(cx - 618) <= 0.5 || Math.abs(cx - 769) <= 0.5).toBe(true);
      expect(boxes.some((b) => Math.abs(b.y + 17.5 - cy) <= 0.5)).toBe(true);
    }
  });
});

describe("/logchat becomes a browser download", () => {
  test("design change: /logchat downloads the main chat as chatlog.txt or the named file, then says so", async () => {
    const blobs: Blob[] = [];
    const names: string[] = [];
    const create = spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blobs.push(b as Blob);
      return "blob:x";
    });
    const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    try {
      const { root, sent, receive } = start();
      receive(welcome);
      receive({ t: "chat", text: "hello", color: 0 });
      const input = root.querySelector<HTMLInputElement>(".chat-input") as HTMLInputElement;
      const enter = () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      input.value = "/logchat";
      enter();
      input.value = "/logchat mine.txt";
      enter();
      expect(names).toEqual(["chatlog.txt", "mine.txt"]);
      expect(await blobs[0]?.text()).toBe("hello\n");
      expect(sent.filter((m) => m.t === "chat")).toEqual([]);
      const lines = [...(root.querySelector(".chat-log")?.children ?? [])].map(
        (l) => l.textContent ?? "",
      );
      expect(lines.some((l) => l.includes(CHAT_SOCIAL_TEXT.logging))).toBe(true);
    } finally {
      create.mockRestore();
      revoke.mockRestore();
      click.mockRestore();
    }
  });
});
