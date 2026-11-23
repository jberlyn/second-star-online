/**
 * Species flags replace 1.6's body tests: 1.6 searched the member name ("<body>-<frame>") for text
 * such as "45-" or "92-", so a longer body ending in the same digits matched too. SSO reads the
 * species' `flags` (monsters.json), so the mechanic follows the species, whatever its body.
 */
import { describe, expect, test } from "bun:test";

import type { Rng } from "../../src/rules/core/lingo.ts";
import { isImmobile, isTrap, monsterFlags } from "../../src/rules/monsters/flags.ts";
import { spellHitOnMonster } from "../../src/rules/spells/spells.ts";

const minRng: Rng = { random: (n) => (n >= 1 ? 1 : 0) };

describe("species flags", () => {
  test("Classic gives 1.6's body mechanics to the species drawn with those bodies", () => {
    expect(monsterFlags("Ghoul")).toEqual({ healedBy: ["Firebolt"], resists: ["Fireball"] });
    expect(monsterFlags("Pig")).toEqual({ unclickable: true, grabbable: "Pig" });
    expect(monsterFlags("Zombie")).toEqual({ hurtByHealing: true });
    expect(isTrap("Web")).toBe(true);
    expect(isImmobile("Holy Shield")).toBe(true);
    expect(monsterFlags("Shark")).toEqual({});
    // A name off the monster list (a shopkeeper) has none.
    expect(monsterFlags("Bob the Shopkeeper")).toEqual({});
  });

  test("bug fixed: a Shark (body 445) is not healed by Firebolt like a Ghoul (body 45)", () => {
    const ghoul = monsterFlags("Ghoul");
    const shark = monsterFlags("Shark");
    expect(spellHitOnMonster("Firebolt-12", ghoul, 0, 2, minRng)).toMatchObject({ heal: true });
    expect(spellHitOnMonster("Firebolt-12", shark, 0, 2, minRng)).toMatchObject({ heal: false });
  });

  test("bug fixed: a Shark takes a Fireball's full damage; a Ghoul takes random(3)", () => {
    expect(spellHitOnMonster("FireballL-1", monsterFlags("Ghoul"), 0, 2, minRng)?.n).toBe(1);
    expect(spellHitOnMonster("FireballL-1", monsterFlags("Shark"), 0, 2, minRng)?.n).toBe(
      4 + 2 + 1,
    );
  });

  test("bug fixed: only a species flagged as a trap holds players, whatever its body", () => {
    expect(isTrap("Web")).toBe(true);
    expect(isTrap("Holy Shield")).toBe(false);
    expect(isTrap("Illusionary Spikes")).toBe(false);
  });

  test("a flag works on any species: healed by, resisting and hurt by healing", () => {
    // A heal-by effect with no heal amount of its own heals by its damage.
    expect(spellHitOnMonster("BoltL-1", { healedBy: ["Bolt"] }, 0, 2, minRng)).toEqual({
      n: 15 + 2 + 1,
      heal: true,
      splat: true,
    });
    // A resisted hit rolls its damage, then deals random(3): two draws.
    const draws: number[] = [];
    const rng: Rng = {
      random: (n) => {
        draws.push(n);
        return 1;
      },
    };
    expect(spellHitOnMonster("splash-18", { resists: ["Splash"] }, 0, 2, rng)?.n).toBe(1);
    expect(draws).toEqual([3, 3]);
    expect(spellHitOnMonster("minor heal-3", { hurtByHealing: true }, 0, 2, minRng)).toEqual({
      n: 1 + 2 + 1,
      heal: false,
      splat: true,
    });
    expect(spellHitOnMonster("Dispel Illusions-8", { dispellable: true }, 0, 2, minRng)?.n).toBe(
      2000,
    );
    expect(spellHitOnMonster("Dispel Illusions-8", {}, 0, 2, minRng)).toBeNull();
  });
});
