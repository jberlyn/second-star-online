/** The client message schemas where they close an original exploit. */
import { describe, expect, test } from "bun:test";

import { inGameSchema } from "../../src/protocol/messages.ts";

const ok = (m: unknown) => inGameSchema.safeParse(m).success;

describe("amounts are validated positive integers", () => {
  test("SSO: counts and amounts are integers ≥ 1 at the schema, gold drop ≤ 9999, trade gold ≥ 0", () => {
    // A negative count minted gold or items in 1.6's NPCBuy, NPCSell and trade.
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(ok({ t: "buy", line: 4, count: bad })).toBe(false);
      expect(ok({ t: "sell", line: 4, count: bad })).toBe(false);
      expect(ok({ t: "crystals", slot: 1, n: bad, mode: "drop" })).toBe(false);
      expect(ok({ t: "gold", n: bad })).toBe(false);
      expect(ok({ t: "tradeOffer", gold: 0, items: [{ slot: 1, qty: bad }] })).toBe(false);
    }
    expect(ok({ t: "gold", n: 10_000 })).toBe(false);
    expect(ok({ t: "tradeOffer", gold: -1, items: [] })).toBe(false);
    expect(ok({ t: "buy", line: 4, count: 1 })).toBe(true);
    expect(ok({ t: "sell", line: 4, count: 3 })).toBe(true);
    expect(ok({ t: "crystals", slot: 1, n: 1, mode: "give" })).toBe(true);
    expect(ok({ t: "crystals", slot: 1, n: 1 })).toBe(false); // the button is required
    expect(ok({ t: "gold", n: 9999 })).toBe(true);
    expect(ok({ t: "tradeOffer", gold: 0, items: [{ slot: 1, qty: 1 }] })).toBe(true);
  });
});
