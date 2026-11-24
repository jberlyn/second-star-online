/**
 * Client: the Blackjack Table (frame 72's channels 333 and 338-353).
 * Rects are checked against the shipped layout data (frame-72.json and cast-manifest.jsonl,
 * castLib 27).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import type { Sfx } from "../src/sfx.ts";
import {
  BJ_CARD_X,
  BJ_CARD_Y,
  BJ_ORIGIN,
  BJ_RECTS,
  type BjView,
  cardMember,
  cardRect,
  createBlackjack,
} from "../src/ui/blackjack.ts";

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

const ROOT = join(import.meta.dir, "../../../assets/original/main/layout");
const FRAME = JSON.parse(readFileSync(join(ROOT, "frame-72.json"), "utf8")) as {
  sprites: { channel: number; loc: number[]; rect: number[] }[];
};
const MANIFEST = readFileSync(join(ROOT, "cast-manifest.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, unknown>)
  .filter((m) => m.castLib === 27);
const member = (n: number) =>
  MANIFEST.find((m) => m.member === n) as {
    width: number;
    height: number;
    regX: number;
    regY: number;
  };
const asRect = (r: { x: number; y: number; w: number; h: number }) => [
  r.x,
  r.y,
  r.x + r.w,
  r.y + r.h,
];
const sprite = (ch: number) =>
  FRAME.sprites.find((s) => s.channel === ch) as {
    loc: number[];
    rect: number[];
  };

function table() {
  const log: unknown[] = [];
  const sounds: Sfx[] = [];
  const state = { locked: false, framed: false };
  const t = createBlackjack(fakeAssets, {
    bid: (text) => log.push(["bid", text]),
    hit: () => log.push("hit"),
    stand: () => log.push("stand"),
    leave: () => log.push("leave"),
    lock: (on) => {
      state.locked = on;
    },
    frame: (on) => {
      state.framed = on;
      log.push(["frame", on]);
    },
    sound: (s) => sounds.push(s),
  });
  document.body.replaceChildren(t.el);
  const button = (label: string) =>
    t.el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) as HTMLButtonElement;
  const bids = () => [...t.el.querySelectorAll<HTMLInputElement>(".bj-bid")];
  const cards = (i: number) =>
    [...t.el.querySelectorAll<HTMLElement>(".bj-card")]
      .slice(i * 5, i * 5 + 5)
      .map((c) => (c.hidden ? null : c.dataset.card));
  return { t, log, sounds, state, button, bids, cards };
}

const view = (o: Partial<BjView> = {}): BjView => ({
  t: "bj",
  open: true,
  side: 1,
  names: ["Alice", "Bob"],
  fields: ["0", "0"],
  locked: [false, false],
  hands: [[], []],
  sfx: [],
  ...o,
});

describe("placement", () => {
  test("the table, fields and bid buttons sit at the sprites' rects", () => {
    expect(asRect(BJ_RECTS.table)).toEqual([153, 54, 493, 287]);
    const loc = sprite(333).loc;
    const mem = member(20);
    expect([
      (loc[0] as number) - mem.regX,
      (loc[1] as number) - mem.regY,
      (loc[0] as number) - mem.regX + mem.width,
      (loc[1] as number) - mem.regY + mem.height,
    ]).toEqual(asRect(BJ_RECTS.table));
    expect(asRect(BJ_RECTS.names[0])).toEqual(sprite(338).rect);
    expect(asRect(BJ_RECTS.bids[0])).toEqual(sprite(339).rect);
    expect(asRect(BJ_RECTS.names[1])).toEqual(sprite(340).rect);
    expect(asRect(BJ_RECTS.bids[1])).toEqual(sprite(341).rect);
    expect(asRect(BJ_RECTS.buttons[0])).toEqual(sprite(342).rect);
    expect(asRect(BJ_RECTS.buttons[1])).toEqual(sprite(343).rect);
  });

  test("the ten cards sit at loc − their own regpoint; 58-60 are 82 high", () => {
    for (const side of [0, 1] as const) {
      for (let slot = 0; slot < 5; slot += 1) {
        const s = sprite(344 + side * 5 + slot);
        expect([BJ_CARD_X[side]?.[slot], BJ_CARD_Y]).toEqual(s.loc);
      }
    }
    for (const card of [51, 57, 58, 60] as const) {
      const m = cardMember(card);
      const mem = member(m.member);
      expect([m.w, m.h, m.rx, m.ry]).toEqual([mem.width, mem.height, mem.regX, mem.regY]);
    }
    expect(asRect(cardRect(51, 0, 0))).toEqual([165, 142, 221, 223]);
    expect(asRect(cardRect(60, 1, 4))).toEqual([423, 141, 479, 223]);
    expect(cardMember("back").member).toBe(21);
  });

  test("Leave, Stand and Hit are the table's mouse ranges", () => {
    expect(asRect(BJ_RECTS.leave)).toEqual([242, 261, 298, 280]);
    expect(asRect(BJ_RECTS.stand)).toEqual([302, 260, 359, 276]);
    expect(asRect(BJ_RECTS.hit)).toEqual([367, 260, 404, 276]);
    const { t, button } = table();
    t.view(view());
    const hit = button("Hit");
    expect(hit.style.left).toBe(`${367 - BJ_ORIGIN.x}px`);
    expect(hit.dataset.action).toBe("blackjack-hit");
    expect(button("Lock your bid").dataset.action).toBe("blackjack-lock-bid");
  });
});

describe("the table", () => {
  test("the first view shows the table, locks the keys and goes to frame 72", () => {
    const { t, state } = table();
    expect(t.el.hidden).toBe(true);
    t.view(view());
    expect(t.el.hidden).toBe(false);
    expect(state).toEqual({ locked: true, framed: true });
    expect(t.el.querySelectorAll(".bj-name")[1]?.textContent).toBe("Bob");
  });

  test("only your own bid field is editable, and only while unlocked; the button swaps", () => {
    const { t, bids, button } = table();
    t.view(view());
    expect(bids().map((b) => b.readOnly)).toEqual([false, true]);
    bids()[0]!.value = "42";
    t.view(view()); // an unchanged server value does not overwrite your typing
    expect(bids()[0]!.value).toBe("42");
    t.view(view({ locked: [true, false], fields: ["42", "0"] }));
    expect(bids()[0]!.readOnly).toBe(true);
    expect(button("Lock your bid").querySelector("img")?.src).toContain("casino-42.png");
    t.view(view({ side: 2, locked: [true, false], fields: ["42", "0"] }));
    expect(bids().map((b) => b.readOnly)).toEqual([true, false]);
  });

  test("a bid click sends the field text once; the click blocks for 15 frames; only your own button, not once locked", () => {
    const { t, log, button, bids } = table();
    t.view(view());
    bids()[0]!.value = "50";
    const btns = [...t.el.querySelectorAll<HTMLButtonElement>(".bj-button")];
    btns[1]?.click(); // Player 2's button is not yours
    expect(log).toEqual([["frame", true]]);
    btns[0]?.click();
    btns[0]?.click();
    expect(log.at(-1)).toEqual(["bid", "50"]);
    expect(log.filter((l) => Array.isArray(l) && l[0] === "bid")).toHaveLength(1);
    for (let i = 0; i < 15; i += 1) {
      t.frame();
    }
    btns[0]?.click();
    expect(log.filter((l) => Array.isArray(l) && l[0] === "bid")).toHaveLength(2);
    t.view(view({ locked: [true, false] }));
    for (let i = 0; i < 15; i += 1) {
      t.frame();
    }
    btns[0]?.click();
    expect(log.filter((l) => Array.isArray(l) && l[0] === "bid")).toHaveLength(2);
    expect(button("Hit")).toBeTruthy();
  });

  test("Hit, Stand and Leave send once per 10 frames", () => {
    const { t, log, button } = table();
    t.view(view());
    button("Hit").click();
    button("Stand").click();
    expect(log.filter((l) => l === "hit" || l === "stand")).toEqual(["hit"]);
    for (let i = 0; i < 10; i += 1) {
      t.frame();
    }
    button("Stand").click();
    for (let i = 0; i < 10; i += 1) {
      t.frame();
    }
    button("Leave the table").click();
    expect(log.slice(1)).toEqual(["hit", "stand", "leave"]);
  });

  test('cards are drawn per slot; "back" is the card back; sfx play on their channels', () => {
    const { t, cards, sounds } = table();
    t.view(
      view({
        hands: [
          [51, 60],
          [55, "back"],
        ],
        sfx: ["shuffle", "deal", "deal", "cash"],
      }),
    );
    expect(cards(0)).toEqual(["51", "60", null, null, null]);
    expect(cards(1)).toEqual(["55", "back", null, null, null]);
    const imgs = [...t.el.querySelectorAll<HTMLImageElement>(".bj-card")];
    expect(imgs[6]?.src).toContain("casino-21.png");
    expect(imgs[1]?.src).toContain("casino-32.png");
    expect(sounds).toEqual([
      { name: "CardShuffle", ch: 1 },
      { name: "CardDeal", ch: 1 },
      { name: "CardDeal", ch: 1 },
      { name: "cash", ch: 4 },
    ]);
  });

  test("a server close hides the table, frees the keys and plays the first tab", () => {
    const { t, state, log } = table();
    t.view(view());
    t.close();
    expect(t.el.hidden).toBe(true);
    expect(t.isOpen).toBe(false);
    expect(state.locked).toBe(false);
    expect(log.at(-1)).toEqual(["frame", false]);
    t.view(view());
    expect(t.isOpen).toBe(true);
  });
});
