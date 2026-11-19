import { describe, expect, test } from "bun:test";

import type { Assets } from "../src/assets.ts";
import { createAmountDialog } from "../src/ui/amount.ts";
import { createSignPanel } from "../src/ui/sign.ts";

const assets = { ui: () => "" } as unknown as Assets;

describe("semantic actions", () => {
  test("amount confirmation dispatches a valid amount and rejects invalid input", () => {
    const dialog = createAmountDialog(assets);
    const sent: number[] = [];
    dialog.open("Amount", "5", (n) => sent.push(n));
    dialog.el.querySelector<HTMLButtonElement>('[data-action="amount-confirm"]')!.click();
    expect(sent).toEqual([5]);
    expect(dialog.el.hidden).toBe(true);
    dialog.open("Amount", "-1", (n) => sent.push(n));
    dialog.el.querySelector<HTMLButtonElement>('[data-action="amount-confirm"]')!.click();
    expect(sent).toEqual([5]);
    dialog.open("Amount", "3", (n) => sent.push(n));
    dialog.el.querySelector<HTMLButtonElement>('[data-action="amount-cancel"]')!.click();
    expect(sent).toEqual([5]);
    expect(dialog.el.hidden).toBe(true);
  });

  test("sign closes on click", () => {
    const sign = createSignPanel(assets);
    sign.show("Hello");
    sign.el.click();
    expect(sign.el.dataset.action).toBe("sign-close");
    expect(sign.open).toBe(false);
  });
});
