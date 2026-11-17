/**
 * The shop and vault window: score channels 210-219 of frame 63
 * (assets/original/main/layout/frame-63.json), in the playfield.
 * - 210, shop #11, the frame (213×266) at (205, 89), "CANCEL | OK" and the "x" painted on;
 * - 217, field `List` at (222, 109) and 218, the prices field at (352, 110) (right-aligned,
 *   bold), Arial 12 white; 219, the vault list field at (226, 109) 155×198, scrolling;
 * - 213, the quantity field at (238, 321) 38×16, editable, Arial 12 (221, 221, 221), "1";
 * - 211, shop #13, the buy and vault OK at (366, 320); 212, shop #14, the sell OK at
 *   (366, 321), drawn above 211; 215, shop #15, CANCEL at (301, 319);
 * - 370, Internal #41 "PROCESSING", 106×32 at (271, 221), above everything.
 *
 * SSO adds a train mode (1.6 had none): the list is a trainer's `TRN|` lines (class, price), the
 * buy OK shows, there is no quantity field, and OK sends the row's line (the shop's price-0 refusal
 * does not apply: a free class is allowed).
 *
 * Which OK shows is the only mode: a buy or train list shows 211, a sell list 212, and each hides
 * the other (1.6 hid neither, so a sell OK stayed on top of a later buy list). The vault shows 211
 * and the list 219. Only CANCEL closes the window. A buy or sale the server completes plays `cash`
 * (1.6 never played it).
 */
import type { ShopRow } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action } from "./action.ts";
import { artImg } from "./stage.ts";

/** The window's top-left on the stage. */
export const SHOP_ORIGIN = { x: 205, y: 89 } as const;
export const SHOP_SIZE = { w: 213, h: 266 } as const;

export interface ShopActions {
  buy(line: number, count: number): void;
  sell(line: number, count: number): void;
  /** The train OK: the `TRN|` line of the selected row. */
  train(line: number): void;
  /** Withdraw the vault's line `index` (1-based). */
  take(index: number): void;
  cancel(): void;
  sound(s: Sfx): void;
}

export interface ShopWindow {
  /** The window; the shell places it at `SHOP_ORIGIN`. */
  el: HTMLElement;
  /** The PROCESSING box (sprite 370), placed by the shell at (271, 221). */
  busy: HTMLElement;
  showList(mode: "buy" | "sell" | "train", rows: readonly ShopRow[]): void;
  showVault(items: readonly string[]): void;
  /** Hides the PROCESSING box (a reply, an `inx`, a bag click). */
  clearBusy(): void;
  /** The server's reply to an OK: hides the PROCESSING box, and a completed deal plays `cash`. */
  processed(ok: boolean): void;
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  close(): void;
}

/**
 * The quantity as the OK reads it: the entered value parsed as an integer, refused below 1 or
 * containing "-". Text that is not a whole number reads as nothing (an assumption: 1.6's files do
 * not say).
 */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) {
    return null;
  }
  const n = Number(t);
  return n >= 1 && Number.isSafeInteger(n) ? n : null;
}

export function createShopWindow(a: Assets, act: ShopActions): ShopWindow {
  const el = document.createElement("div");
  el.className = "shop-dialog";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Shop");
  const put = (node: HTMLElement, x: number, y: number, w: number, h: number) => {
    // CSS places it from these.
    node.style.setProperty("--x", `${x - SHOP_ORIGIN.x}px`);
    node.style.setProperty("--y", `${y - SHOP_ORIGIN.y}px`);
    node.style.setProperty("--w", `${w}px`);
    node.style.setProperty("--h", `${h}px`);
    el.append(node);
    return node;
  };
  const frame = artImg(a.ui("shop", 11));
  frame.classList.add("shop-frame");
  put(frame, 205, 89, 213, 266);

  // The List and Prices fields as one list of rows: a click on either column selects the
  // line in both.
  const list = document.createElement("div");
  list.className = "shop-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Items");
  put(list, 222, 109, 176, 195);
  const vault = document.createElement("div");
  vault.className = "shop-list shop-vault";
  vault.setAttribute("role", "listbox");
  vault.setAttribute("aria-label", "Vault");
  put(vault, 226, 109, 155, 198);

  const count = action(document.createElement("input"), "shop-quantity");
  count.className = "field shop-count";
  count.inputMode = "numeric";
  count.value = "1";
  count.setAttribute("aria-label", "How many");
  put(count, 238, 321, 38, 16);

  const btn = (member: number, label: string, cls: string) => {
    const b = action(
      document.createElement("button"),
      member === 13 ? "shop-buy" : member === 14 ? "shop-sell" : "shop-cancel",
    );
    b.type = "button";
    b.className = `art-btn ${cls}`;
    b.setAttribute("aria-label", label);
    b.append(artImg(a.ui("shop", member)));
    return b;
  };
  const buyOk = btn(13, "OK", "shop-ok shop-buy-ok");
  put(buyOk, 366, 320, 35, 18);
  const sellOk = btn(14, "OK", "shop-ok shop-sell-ok");
  put(sellOk, 366, 321, 34, 20);
  const cancel = btn(15, "Cancel", "shop-cancel");
  put(cancel, 301, 319, 63, 21);
  // Hidden until a list shows them; the quantity field shows with a shop list only.
  buyOk.hidden = true;
  sellOk.hidden = true;
  count.hidden = true;

  const busy = artImg(a.ui("internal", 41));
  busy.className = "shop-busy art";
  busy.hidden = true;

  let rows: ShopRow[] = [];
  /** The selected line, 1-based, or 0. */
  let selected = 0;
  let vaultMode = false;
  let trainMode = false;

  const highlight = (box: HTMLElement) => {
    box.querySelectorAll<HTMLElement>(".shop-row").forEach((r, i) => {
      r.setAttribute("aria-selected", String(i + 1 === selected));
    });
  };
  const rowClick = (box: HTMLElement, i: number) => {
    act.sound(SOUND.click); // first
    if (!busy.hidden) {
      return;
    }
    selected = i;
    highlight(box);
  };

  buyOk.addEventListener("click", () => {
    if (trainMode) {
      if (!busy.hidden) {
        return;
      }
      act.sound(SOUND.click);
      const row = rows[selected - 1];
      if (!row) {
        return;
      }
      busy.hidden = false;
      act.train(row.line);
      return;
    }
    const n = parseCount(count.value);
    if (n === null || !busy.hidden) {
      return;
    }
    act.sound(SOUND.click);
    if (vaultMode) {
      if (selected === 0) {
        return;
      }
      act.take(selected);
      selected = 0;
      return;
    }
    const row = rows[selected - 1];
    if (!row || row.price === 0) {
      return;
    }
    busy.hidden = false;
    act.buy(row.line, n);
  });
  sellOk.addEventListener("click", () => {
    if (!busy.hidden) {
      return;
    }
    const n = parseCount(count.value);
    if (n === null) {
      return;
    }
    act.sound(SOUND.click);
    const row = vaultMode ? undefined : rows[selected - 1];
    if (!row) {
      return;
    }
    busy.hidden = false;
    act.sell(row.line, n);
  });
  cancel.addEventListener("click", () => {
    act.sound(SOUND.click);
    // Hides 210-219 and 213, not the PROCESSING box.
    el.hidden = true;
    buyOk.hidden = true;
    sellOk.hidden = true;
    count.hidden = true;
    act.cancel();
  });

  const fillRows = (box: HTMLElement, cells: string[][]) => {
    box.replaceChildren(
      ...cells.map((c, i) => {
        // A line is a click on List (shop #9) or Prices (#10), or on the vault list (#23).
        const r = action(
          document.createElement("div"),
          box === vault ? "vault-select-item" : "shop-select-item",
        );
        r.className = "shop-row";
        r.setAttribute("role", "option");
        r.setAttribute("aria-selected", "false");
        for (const [k, text] of c.entries()) {
          const span = document.createElement("span");
          span.className = k === 0 ? "shop-name" : "shop-price";
          span.textContent = text;
          r.append(span);
        }
        r.addEventListener("click", () => rowClick(box, i + 1));
        return r;
      }),
    );
  };

  return {
    el,
    busy,
    get isOpen() {
      return !el.hidden;
    },
    get isBusy() {
      return !busy.hidden;
    },
    showList(mode, r) {
      rows = [...r];
      vaultMode = false;
      trainMode = mode === "train";
      selected = 0;
      fillRows(
        list,
        rows.map((x) => [x.item, String(x.price)]),
      );
      list.hidden = false;
      vault.hidden = true;
      count.hidden = trainMode;
      // The quantity field is set to "1".
      count.value = "1";
      sellOk.hidden = mode !== "sell";
      buyOk.hidden = mode === "sell";
      el.hidden = false;
    },
    showVault(items) {
      vaultMode = true;
      trainMode = false;
      selected = 0;
      fillRows(
        vault,
        items.map((x) => [x]),
      );
      vault.hidden = false;
      list.hidden = true;
      buyOk.hidden = false;
      sellOk.hidden = true;
      el.hidden = false;
    },
    clearBusy() {
      busy.hidden = true;
    },
    processed(ok) {
      busy.hidden = true;
      if (ok) {
        act.sound(SOUND.cash);
      }
    },
    close() {
      el.hidden = true;
      buyOk.hidden = true;
      sellOk.hidden = true;
      busy.hidden = true;
      selected = 0;
    },
  };
}
