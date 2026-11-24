/**
 * Client: the Checkers window (the shipped layout data's sub/Checkers frame-1.json).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import { startBoard } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import {
  CK_MEMBER,
  CK_RECTS,
  CK_STAGE,
  type CkView,
  createCheckersWindow,
  pieceRect,
} from "../src/ui/checkers.ts";
import { createWindowLayer } from "../src/ui/window.ts";

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

const FRAME = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../../assets/original/sub/Checkers/layout/frame-1.json"),
    "utf8",
  ),
) as { stage: number[]; sprites: { channel: number; loc: number[]; rect: number[] }[] };
const sprite = (ch: number) =>
  FRAME.sprites.find((s) => s.channel === ch) as {
    loc: number[];
    rect: number[];
  };
const asRect = (r: { x: number; y: number; w: number; h: number }) => [
  r.x,
  r.y,
  r.x + r.w,
  r.y + r.h,
];

function window_(side: 1 | 2 = 1) {
  const log: unknown[] = [];
  const layer = createWindowLayer();
  document.body.replaceChildren(layer.el);
  const w = createCheckersWindow(fakeAssets, layer, {
    move: (piece, dh, dv) => log.push(["move", piece, dh, dv]),
    close: () => log.push("close"),
    lock: (on) => log.push(["lock", on]),
  });
  const v = (o: Partial<CkView> = {}): CkView => ({
    t: "ck",
    open: true,
    side,
    names: ["Alice", "Bob"],
    pieces: startBoard(),
    ...o,
  });
  const piece = (i: number) =>
    layer.el.querySelector<HTMLButtonElement>(`[data-piece="${i}"]`) as HTMLButtonElement;
  const box = () => layer.el.querySelector<HTMLElement>(".ck-box") as HTMLElement;
  const marker = () => layer.el.querySelector<HTMLElement>(".ck-marker") as HTMLElement;
  const board = () => layer.el.querySelector<HTMLElement>(".ck-board") as HTMLElement;
  const clickBoard = (h: number, vv: number) => {
    board().getBoundingClientRect = () => ({ left: 0, top: 0, width: 304, height: 310 }) as DOMRect;
    board().dispatchEvent(new MouseEvent("click", { clientX: h, clientY: vv, bubbles: true }));
  };
  return { w, layer, log, v, piece, box, marker, board, clickBoard };
}

describe("placement", () => {
  test("the stage, board and names", () => {
    expect([CK_STAGE.w as number, CK_STAGE.h as number]).toEqual(FRAME.stage);
    expect(asRect(CK_RECTS.board)).toEqual(sprite(1).rect);
    expect(asRect(CK_RECTS.p1name)).toEqual(sprite(26).rect);
    expect(asRect(CK_RECTS.p2name)).toEqual(sprite(27).rect);
  });

  test("each piece sits at loc − (15, 15) with the member its name gives", () => {
    const { w, layer, v } = window_();
    w.view(v());
    startBoard().forEach((p, i) => {
      expect(asRect(pieceRect(p))).toEqual(sprite(i + 2).rect);
      const el = layer.el.querySelector<HTMLElement>(`[data-piece="${i}"]`) as HTMLElement;
      expect(el.style.left).toBe(`${p.h - 15}px`);
      expect(el.dataset.action).toBe("checkers-select-piece");
      expect(el.querySelector("img")?.getAttribute("src")).toContain(
        `checkers-${CK_MEMBER[p.m]}.png`,
      );
    });
    expect(CK_MEMBER).toEqual({ Black: 2, White: 3, BlackKing: 6, WhiteKing: 7 });
  });
});

describe("play", () => {
  test("the window opens on the first view and shows 'Black is' and 'White is'", () => {
    const { w, layer, v, log } = window_();
    w.view(v({ names: ["Alice", ""] }));
    expect(w.isOpen).toBe(true);
    expect(layer.el.querySelector(".ck-name-1")?.textContent).toBe("Black is Alice");
    expect(layer.el.querySelector(".ck-name-2")?.textContent).toBe("");
    expect(log).toEqual([["lock", true]]);
    w.view(v());
    expect(layer.el.querySelector(".ck-name-2")?.textContent).toBe("White is Bob");
  });

  test("selection only on your own piece and your turn", () => {
    const { w, v, piece, box } = window_(1);
    w.view(v({ names: ["Alice", ""] }));
    piece(8).click(); // alone: no turn
    expect(box().hidden).toBe(true);
    w.view(v());
    piece(12).click(); // an enemy piece
    expect(box().hidden).toBe(true);
    piece(8).click();
    expect(box().hidden).toBe(false);
    expect(box().style.left).toBe(`${73 - 17}px`);
    expect(box().style.top).toBe(`${214 - 17}px`);
    w.view(v({ moved: { turn: 2 } }));
    piece(8).click(); // not your turn
    expect(box().hidden).toBe(true);
  });

  test("a board click sends the direction for each quadrant and nothing on a row or column", () => {
    const { w, v, piece, clickBoard, log, box } = window_(1);
    w.view(v());
    log.length = 0;
    const cases: [number, number, number, number][] = [
      [10, 10, -1, -1],
      [200, 10, 1, -1],
      [10, 300, -1, 1],
      [200, 300, 1, 1],
    ];
    for (const [h, vv, dh, dv] of cases) {
      piece(8).click(); // (73, 214)
      clickBoard(h, vv);
      expect(log.at(-1)).toEqual(["move", 8, dh, dv]);
      expect(box().hidden).toBe(true);
    }
    log.length = 0;
    piece(8).click();
    clickBoard(73, 10); // the piece's column
    clickBoard(10, 214); // its row
    expect(log).toEqual([]);
    expect(box().hidden).toBe(false);
    log.length = 0;
    clickBoard(300, 300);
    expect(log).toEqual([["move", 8, 1, 1]]);
  });

  test("the turn marker is hidden until the first move, then (80, 10) for Black and (80, 25) for White", () => {
    const { w, v, marker } = window_(1);
    w.view(v());
    expect(marker().hidden).toBe(true);
    w.view(v({ moved: { turn: 2 } }));
    expect(marker().hidden).toBe(false);
    expect([marker().style.left, marker().style.top]).toEqual(["72px", "17px"]);
    w.view(v({ moved: { turn: 1 } }));
    expect([marker().style.left, marker().style.top]).toEqual(["72px", "2px"]);
    w.view(v({ names: ["Alice", ""] })); // a quit never moves it
    expect(marker().hidden).toBe(false);
  });

  test("a captured piece is not drawn; closing the window sends ckClose and frees the keys", () => {
    const { w, layer, v, piece, log } = window_(1);
    const pieces = startBoard();
    pieces[12] = { ...pieces[12]!, h: pieces[12]!.h - 864, v: pieces[12]!.v - 864 };
    w.view(v({ pieces }));
    expect(piece(12).hidden).toBe(true);
    expect(piece(13).hidden).toBe(false);
    log.length = 0;
    layer.el.querySelector<HTMLButtonElement>(".window-close")?.click();
    expect(log).toEqual([["lock", false], "close"]);
    expect(w.isOpen).toBe(false);
  });
});
