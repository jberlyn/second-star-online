/**
 * Pins for entries in docs/differences-from-fso.md that are rules or schemas: no client message
 * carries character state or a price, the editor's `H1<mx>` exit form, and the exact header owner.
 */
import { describe, expect, test } from "bun:test";

import { inGameSchema } from "../src/protocol/messages.ts";
import { exitFieldsAfterLoad, exitFromFields } from "../src/rules/admin/worldedit.ts";
import { headDrop } from "../src/rules/housing/houses.ts";

const ok = (m: unknown) => inGameSchema.safeParse(m).success;

describe("client messages are intents", () => {
  test("SSO: no in-game message carries character state, so a character cannot be uploaded", () => {
    const state = [
      "char",
      "character",
      "bag",
      "inventory",
      "equip",
      "skills",
      "stats",
      "vitals",
      "hp",
      "sp",
      "xp",
      "level",
      "classCode",
      "bank",
    ];
    for (const o of inGameSchema.options) {
      const keys = Object.keys((o as unknown as { shape: Record<string, unknown> }).shape);
      expect(keys.filter((k) => state.includes(k))).toEqual([]);
    }
    expect(ok({ t: "character", char: { gold: 1_000_000 } })).toBe(false);
    expect(ok({ t: "step", seq: 1, dir: "U", turn: false, hp: 999 })).toBe(false);
  });

  test("SSO: a buy, sell or train names the line and count; a client price is refused", () => {
    expect(ok({ t: "buy", line: 4, count: 2 })).toBe(true);
    expect(ok({ t: "buy", line: 4, count: 2, price: 0 })).toBe(false);
    expect(ok({ t: "sell", line: 4, count: 2, price: 1_000_000 })).toBe(false);
    expect(ok({ t: "train", line: 1 })).toBe(true);
    expect(ok({ t: "train", line: 1, price: 0 })).toBe(false);
  });
});

describe("house interiors in the World Editor", () => {
  test("SSO: an exit to a house map shows as H1<mx>/H1<my> and is read back as that house", () => {
    const exit = { mx: 1000, my: 992, x: 9, y: 11, house: 1 as const };
    const fields = exitFieldsAfterLoad(exit);
    expect(fields).toEqual(["H11000", "H1992", "9", "11"]);
    expect(exitFromFields(fields)).toEqual(exit);
    expect(exitFromFields(["h2-5", "H24", "3", "4"])).toEqual({
      mx: -5,
      my: 4,
      x: 3,
      y: 4,
      house: 2,
    });
    // A plain grid exit has no house.
    expect(exitFromFields(["1000", "992", "9", "11"])).toEqual({ mx: 1000, my: 992, x: 9, y: 11 });
  });
});

describe("HeadDrop", () => {
  test("SSO: the header must begin with '<name>'s ' or equal 'Hall of the <guild>'", () => {
    expect(headDrop("Bob's House", "Bob", "")).toBe(0);
    expect(headDrop("Not Bob's House", "Bob", "")).toBe(1);
    expect(headDrop("Bobs House", "Bob", "")).toBe(1);
    expect(headDrop("Hall of the Knights", "Bob", "Knights")).toBe(0);
    expect(headDrop("Hall of the Knights Annex", "Bob", "Knights")).toBe(1);
    expect(headDrop("Hall of the Knightsmen", "Bob", "Knights")).toBe(1);
    expect(headDrop("Hall of the Knights", "Bob", "Knight")).toBe(1);
  });
});
