import { describe, expect, test } from "bun:test";

import { formatTimeLength, parseTimeLength } from "../../src/rules/core/timelength.ts";

describe("lengths of time", () => {
  test("format and parse as operators write them", () => {
    expect(formatTimeLength(0)).toBe("0");
    expect(formatTimeLength(3)).toBe("3s");
    expect(formatTimeLength(150)).toBe("2m 30s");
    expect(formatTimeLength(129_600)).toBe("1d 12h");
    expect(formatTimeLength(315_360_000)).toBe("3650d");
    expect(parseTimeLength("30s")).toBe(30);
    expect(parseTimeLength(" 5 min ")).toBe(300);
    expect(parseTimeLength("1h 30m")).toBe(5400);
    expect(parseTimeLength("1d12h")).toBe(129_600);
    expect(parseTimeLength("2 weeks")).toBe(1_209_600);
    expect(parseTimeLength("1.5h")).toBe(5400);
    expect(parseTimeLength("0")).toBe(0);
    expect(parseTimeLength("Off", "off")).toBe(0);
    expect(parseTimeLength("off")).toBeNull();
    // A bare number has no unit: refused, not guessed.
    expect(parseTimeLength("30")).toBeNull();
    expect(parseTimeLength("5 fortnights")).toBeNull();
    expect(parseTimeLength("")).toBeNull();
    // Every shown value reads back as itself.
    for (const n of [1, 59, 61, 3600, 86_399, 2_592_000]) {
      expect(parseTimeLength(formatTimeLength(n))).toBe(n);
    }
  });
});
