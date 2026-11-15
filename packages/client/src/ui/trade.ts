/**
 * The trade window ("Make a Trade"). Stage 556×421
 * (assets/original/sub/TradeWindow/layout/frame-1.json):
 * - member 1, the frame; Trader1 at (17, 12) and Trader2 at (295, 12), Arial 14 bold white;
 * - the item name fields at x 19-194 (left) and x 302-477 (right) and the amount fields at
 *   x 207-249 (left) and x 490-532 (right), rows at y = 42 + 22·(N − 1), 16 high, Arial 12 bold
 *   white;
 * - left: Trade (member 4) [12, 394, 52, 413], Accept (2) [54, 394, 103, 413], Cancel (3)
 *   [105, 395, 151, 410]; right: Trade (79) [446, 394, 486, 413], Cancel (78) [490, 395, 536, 410].
 *
 * The initiator (A) is Trader1 and fills the left column from the gold and the bag; B sees
 * A's offer packed in the left column and fills the right. An offer is read-only
 * once sent. Only A gets Accept, once B's offer is in (the original's second-trade-back step).
 */
import type { InventoryView, TradeView } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const TRADE_STAGE = { w: 556, h: 421 } as const;
const ROWS = 16;

export interface TradeActions {
  offer(gold: number, items: { slot: number; qty: number }[]): void;
  accept(): void;
  cancel(): void;
}

export interface TradeWindow {
  window: GameWindow;
  /** Shows the server's state; null closes the window. */
  show(v: TradeView | null, inv: InventoryView | null): void;
}

interface Row {
  name: HTMLElement;
  amount: HTMLInputElement;
}

interface Column {
  el: HTMLElement;
  rows: Row[];
}

/** The integer the Trade button reads from an amount field; anything else is 0. */
export function amountOf(text: string): number {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : 0;
}

export function createTradeWindow(a: Assets, layer: WindowLayer, act: TradeActions): TradeWindow {
  const stage = document.createElement("div");
  stage.className = "trade-stage";
  const frame = document.createElement("img");
  frame.className = "trade-frame art";
  frame.src = a.ui("TradeWindow", 1);
  frame.alt = "";
  frame.draggable = false;

  const label = (cls: string, x: number) => {
    const d = document.createElement("div");
    d.className = `trade-trader ${cls}`;
    d.style.setProperty("--x", `${x}px`);
    return d;
  };
  const trader1 = label("trade-trader1", 17);
  const trader2 = label("trade-trader2", 295);

  // The amount fields are #23-38 (left) and #57-72 (right), made editable by the original's
  // incoming-message script.
  const column = (cls: string, nameX: number, amountX: number): Column => {
    const el = document.createElement("div");
    el.className = `trade-col ${cls}`;
    const rows: Row[] = [];
    for (let i = 0; i < ROWS; i++) {
      const y = 42 + 22 * i;
      const n = document.createElement("div");
      n.className = "trade-name";
      n.style.setProperty("--x", `${nameX}px`);
      n.style.setProperty("--y", `${y}px`);
      const q = action(document.createElement("input"), `${cls}-amount`);
      q.className = "field trade-amount";
      q.inputMode = "numeric";
      q.style.setProperty("--x", `${amountX}px`);
      q.style.setProperty("--y", `${y}px`);
      q.setAttribute("aria-label", `Amount ${i + 1}`);
      rows.push({ name: n, amount: q });
      el.append(n, q);
    }
    return { el, rows };
  };
  const left = column("trade-left", 19, 207);
  const right = column("trade-right", 302, 490);

  const btn = (member: number, label: string, cls: string, x: number, y: number) => {
    // Each button is its member's own script (members 2, 3, 4, 78, 79).
    const b = action(document.createElement("button"), cls);
    b.type = "button";
    b.className = `trade-btn ${cls}`;
    b.style.setProperty("--x", `${x}px`);
    b.style.setProperty("--y", `${y}px`);
    b.setAttribute("aria-label", label);
    const img = document.createElement("img");
    img.src = a.ui("TradeWindow", member);
    img.alt = "";
    img.draggable = false;
    b.append(img);
    return b;
  };
  const tradeL = btn(4, "Trade", "trade-offer-a", 12, 394);
  const accept = btn(2, "Accept", "trade-accept", 54, 394);
  const cancelL = btn(3, "Cancel", "trade-cancel-a", 105, 395);
  const tradeR = btn(79, "Trade", "trade-offer-b", 446, 394);
  const cancelR = btn(78, "Cancel", "trade-cancel-b", 490, 395);
  stage.append(
    frame,
    trader1,
    trader2,
    left.el,
    right.el,
    tradeL,
    accept,
    cancelL,
    tradeR,
    cancelR,
  );

  /** Which side the bag is in: A fills the left column, B the right. */
  let mine: Column = left;
  let open: TradeView | null = null;
  /** Bag slot of each row of my column (row 0 is gold). */
  let slots: (number | null)[] = [];

  const win = layer.create({
    title: "Make a Trade",
    name: "trade",
    width: TRADE_STAGE.w,
    height: TRADE_STAGE.h,
    body: stage,
    // SSO: closing the window cancels the trade (1.6's close box told the partner nothing).
    onClose: () => {
      if (open) {
        open = null;
        act.cancel();
      }
    },
  });

  /** My gold and bag lines, editable "0". Row 0 is gold, row k bag slot k. */
  const fillBag = (c: Column, inv: InventoryView | null) => {
    slots = [];
    c.rows.forEach((r, i) => {
      const line = i === 0 ? null : (inv?.bag[i - 1] ?? null);
      r.name.textContent = i === 0 ? "Gold" : line ? line.item : "";
      r.amount.value = "0";
      r.amount.readOnly = false;
      slots.push(line ? i : null);
    });
  };
  /** An offer packed in list order: Gold first, then each line. */
  const fillOffer = (
    c: Column,
    o: { gold: number; items: { item: string; qty: number }[] } | null,
  ) => {
    const lines = o ? [{ item: "Gold", qty: o.gold }, ...o.items] : [];
    c.rows.forEach((r, i) => {
      const l = lines[i];
      r.name.textContent = l ? l.item : "";
      r.amount.value = l ? String(l.qty) : "";
      r.amount.readOnly = true;
    });
  };
  const lockMine = () => {
    for (const r of mine.rows) {
      r.amount.readOnly = true;
    }
  };

  const sendOffer = () => {
    let gold = 0;
    const items: { slot: number; qty: number }[] = [];
    mine.rows.forEach((r, i) => {
      const qty = amountOf(r.amount.value);
      const slot = slots[i] ?? null;
      if (i === 0) {
        gold = qty;
      } else if (slot !== null && qty > 0) {
        items.push({ slot, qty });
      }
    });
    act.offer(gold, items);
  };
  tradeL.addEventListener("click", sendOffer);
  tradeR.addEventListener("click", sendOffer);
  accept.addEventListener("click", () => act.accept());
  const cancel = () => {
    open = null;
    act.cancel();
  };
  cancelL.addEventListener("click", cancel);
  cancelR.addEventListener("click", cancel);

  return {
    window: win,
    show(v, inv) {
      const was = open;
      open = v;
      if (!v) {
        win.close();
        return;
      }
      const isA = v.you === "a";
      stage.dataset.you = v.you;
      mine = isA ? left : right;
      const theirs = isA ? right : left;
      // Trader1 is A, Trader2 is B.
      trader1.textContent = isA ? v.self : v.partner;
      trader2.textContent = isA ? v.partner : v.self;
      if (!was || was.you !== v.you) {
        fillBag(mine, inv);
      }
      if (v.mine) {
        lockMine();
      }
      fillOffer(theirs, v.theirs);
      theirs.el.hidden = isA && !v.theirs;
      tradeL.hidden = !isA || v.mine !== null;
      cancelL.hidden = !isA;
      accept.hidden = !isA || v.theirs === null;
      tradeR.hidden = isA || v.mine !== null;
      cancelR.hidden = isA;
      win.open();
    },
  };
}
