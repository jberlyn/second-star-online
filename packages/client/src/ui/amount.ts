/**
 * The gold and crystal amount dialog: channels 88-92 of frames 50-63 at their score rects,
 * background Internal #119 [223, 183, 476, 300], the title field (#125, [245, 197, 436, 229]),
 * the editable amount field (#124, [254, 253, 348, 269]), OK (#120) and Cancel (#126).
 * - Gold (Internal #118): "How Much Gold Do You Want To Give/Drop?" and the amount set to "0".
 * - Crystals: "Drop/Give how many <colour> crystals?", which leave the amount as it was; the
 *   cast's saved text is "2".
 *
 * OK hides the dialog before any test, then keeps the original's silent refusals for what the
 * client can test (more than 4 characters, a "-", outside 1..9999); the server checks the rest.
 */
import type { Assets } from "../assets.ts";
import { action, gameInput } from "./action.ts";
import { artImg } from "./stage.ts";

export interface AmountDialog {
  /** 253×117, positioned at (223, 183) on the stage by the shell. */
  el: HTMLElement;
  /** `seed` replaces the amount; null keeps the field as it was. */
  open(title: string, seed: string | null, onOk: (n: number) => void): void;
  close(): void;
}

/** The original's client tests: n, or null for a silent refusal. */
export function parseAmount(text: string): number | null {
  if (text.length > 4 || text.includes("-")) {
    return null;
  }
  const n = Number.parseInt(text, 10);
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    return null;
  }
  return n;
}

export function createAmountDialog(a: Assets): AmountDialog {
  const el = document.createElement("div");
  el.className = "amount-dialog";
  el.hidden = true;
  const ox = 223;
  const oy = 183;
  const put = (node: HTMLElement, x: number, y: number, w: number, h: number) => {
    node.style.position = "absolute";
    node.style.left = `${x - ox}px`;
    node.style.top = `${y - oy}px`;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    el.append(node);
    return node;
  };
  put(artImg(a.ui("internal", 119)), 223, 183, 253, 117);
  const title = document.createElement("div");
  title.className = "field amount-title";
  put(title, 245, 197, 191, 32);
  const input = gameInput("amount-input");
  input.className = "field amount-input";
  input.inputMode = "numeric";
  input.setAttribute("aria-label", "Amount");
  input.value = "2"; // the field's saved text
  put(input, 254, 253, 94, 16);
  const ok = action(document.createElement("button"), "amount-confirm");
  ok.type = "button";
  ok.className = "art-btn";
  ok.setAttribute("aria-label", "OK");
  ok.append(artImg(a.ui("internal", 120)));
  put(ok, 424, 249, 39, 29);
  const cancel = action(document.createElement("button"), "amount-cancel");
  cancel.type = "button";
  cancel.className = "art-btn";
  cancel.setAttribute("aria-label", "Cancel");
  cancel.append(artImg(a.ui("internal", 126)));
  put(cancel, 398, 250, 25, 30);

  let done: ((n: number) => void) | null = null;
  const dialog: AmountDialog = {
    el,
    open(text, seed, onOk) {
      title.textContent = text;
      if (seed !== null) {
        input.value = seed;
      }
      done = onOk;
      el.hidden = false;
      input.focus();
    },
    close() {
      el.hidden = true;
      done = null;
      input.blur();
    },
  };
  const submit = () => {
    const go = done;
    dialog.close(); // before the tests
    const n = parseAmount(input.value);
    if (n === null || !go) {
      return;
    }
    go(n);
  };
  // A click in the field selects the line under the pointer, and the field holds one line, so
  // typing replaces the amount.
  input.addEventListener("click", () => input.select());
  ok.addEventListener("click", submit);
  cancel.addEventListener("click", () => dialog.close());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
    }
  });
  return dialog;
}

/** The two titles. */
export const GOLD_TITLE = "How Much Gold Do You Want To Give/Drop?";
export const crystalTitle = (colour: string) => `Drop/Give how many ${colour} crystals?`;
