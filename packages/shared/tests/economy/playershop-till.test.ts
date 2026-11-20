/**
 * A player shop's till is its `GLD|` line wherever it is: a sale credits it anywhere in the file,
 * so Register and Inventory read it anywhere too (1.6 read only lines 1-30).
 */
import { describe, expect, test } from "bun:test";

import { npcLines } from "../../src/rules/admin/npcfile.ts";
import { register, shopkeeperFile, shopStockLines } from "../../src/rules/economy/playershop.ts";

const FILE = npcLines(shopkeeperFile("Carol", "Tolam"));
/** The till moved past line 30. */
const LATE = [
  ...FILE.filter((l) => !l.startsWith("GLD|")),
  ...Array.from({ length: 30 }, (_, i) => `REM|${i}`),
  "GLD|100",
];

describe("player shop till past line 30", () => {
  test("bug fixed: Register pays from a till line past line 30", () => {
    expect(LATE.indexOf("GLD|100")).toBeGreaterThanOrEqual(30);
    const r = register(LATE, true, "Tolam", 60);
    expect(r.paid).toBe(60);
    expect(r.lines?.at(-1)).toBe("GLD|40");
  });

  test("bug fixed: Inventory reports a till line past line 30", () => {
    expect(shopStockLines(LATE, true, "Tolam")[0]).toBe(
      `Tolam says "I have 100 gold in the register..."`,
    );
  });
});
