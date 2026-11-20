/**
 * Body tests compare the monster's body number: 1.6 searched the member name ("<body>-<frame>")
 * for text such as "45-" or "92-", so a longer body ending in the same digits matched too.
 */
import { describe, expect, test } from "bun:test";

import type { Rng } from "../../src/rules/core/lingo.ts";
import { isWebBody } from "../../src/rules/movement/movement.ts";
import { memberBody, spellHitOnMonster } from "../../src/rules/spells/spells.ts";

const minRng: Rng = { random: (n) => (n >= 1 ? 1 : 0) };

describe("body numbers", () => {
  test("memberBody reads the number before the first dash", () => {
    expect(memberBody("445-1-S")).toBe(445);
    expect(memberBody("45-2-E")).toBe(45);
  });

  test("bug fixed: a Shark (body 445) is not healed by Firebolt like a Ghoul (body 45)", () => {
    expect(spellHitOnMonster("Firebolt-12", "45-1-S", 0, 2, minRng)).toMatchObject({ heal: true });
    expect(spellHitOnMonster("Firebolt-12", "445-1-S", 0, 2, minRng)).toMatchObject({
      heal: false,
    });
  });

  test("bug fixed: a Shark takes a Fireball's full damage; a Ghoul takes random(3)", () => {
    expect(spellHitOnMonster("FireballL-1", "45-1-S", 0, 2, minRng)?.n).toBe(1);
    expect(spellHitOnMonster("FireballL-1", "445-1-S", 0, 2, minRng)?.n).toBe(4 + 2 + 1);
  });

  test("bug fixed: only body 92 is a Web", () => {
    expect(isWebBody(92)).toBe(true);
    expect(isWebBody(192)).toBe(false);
    expect(isWebBody(892)).toBe(false);
  });
});
