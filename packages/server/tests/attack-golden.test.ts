/**
 * Issue #30, stage 0: the safety net for structuring attack power. Every Classic weapon (every
 * catalogue item an attack-power row or a weapon skill block names, every item worn in the weapon
 * hand, a few runtime names and bare hands) is swung through the game's own `attackPower` at every
 * skill and level boundary the skill blocks test, with a recording random source rolled low and
 * high (a bow with arrows and their crystal); bows are also swung with each arrow colour, both bow
 * rings and with and without a crystal.
 * The result must equal the golden recorded before attack power changed shape:
 * `fixtures/attack-golden.json`.
 *
 * Write the golden afresh with `ATTACK_GOLDEN=write bun test tests/attack-golden.test.ts`, only for
 * a deliberate change to Classic's attack power, then `bunx biome format --write` the file.
 */
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ARROW_COLOURS,
  attackPower,
  content,
  type Equipment,
  equipSlotFor,
  type Fighter,
  factionPerk,
  hasBehaviour,
  NO_EQUIPMENT,
  NO_FACTION,
  NOTHING,
  type Rng,
  ruleMatches,
  weaponIs,
} from "@secondstaronline/shared";

const GOLDEN = join(import.meta.dir, "fixtures", "attack-golden.json");

/** A random source that always rolls `at` (1 or each draw's n) and records each draw's n. */
function recorder(at: "low" | "high"): Rng & { draws: number[] } {
  const draws: number[] = [];
  return {
    draws,
    random(n: number) {
      draws.push(n);
      return at === "low" ? 1 : n;
    },
  };
}

/** One swing rolled low and high: `low|high|draw,draw…` (and the bow outcome when there is one). */
function swing(f: Fighter, hasCrystal?: boolean): string {
  const lo = recorder("low");
  const hi = recorder("high");
  const crystal = hasCrystal === undefined ? undefined : () => hasCrystal;
  const a = attackPower(f, lo, crystal);
  const b = attackPower(f, hi, crystal);
  const bow = a.crystal || a.outOfCrystals ? `|${a.crystal ?? ""}|${a.outOfCrystals ?? ""}` : "";
  return `${a.power}|${b.power}|${lo.draws.join(",")}${bow}`;
}

/** Each number a skill block tests, and one past it, so every tier boundary is crossed. */
function boundaries(): number[] {
  const out = new Set<number>([0, 100]);
  for (const block of content().attPower.attPower.skillBlocks) {
    for (const t of block.tiers) {
      for (const w of t.when ?? []) {
        const n = Number(w.split(" ")[2]);
        out.add(n);
        out.add(n + 1);
      }
    }
  }
  return [...out].filter((n) => n <= 100).sort((a, b) => a - b);
}

const STRENGTHS = [1, 6, 11, 16, 20];

function fighter(v: number, i: number, equip: Partial<Equipment>, extra: Partial<Fighter> = {}) {
  return {
    level: Math.max(1, v),
    str: STRENGTHS[i % STRENGTHS.length] as number,
    sta: 10,
    int: 10,
    wis: 10,
    skills: Array(content().classes.skills.length).fill(v) as number[],
    equip: { ...NO_EQUIPMENT, ...equip },
    faction: NO_FACTION,
    attackBonus: 0,
    wanted: false,
    ...extra,
  } satisfies Fighter;
}

/** The names attack power can treat differently from bare hands. */
function weapons(): string[] {
  const ap = content().attPower.attPower;
  const named = (n: string) =>
    ap.base.some((r) => ruleMatches(n, r)) ||
    ap.exactOverrides.some((r) => ruleMatches(n, r)) ||
    ap.skillBlocks.some(
      (b) =>
        (b.weaponMatch === "contains" &&
          ruleMatches(n, { match: "contains", pattern: b.pattern ?? "" })) ||
        (b.weaponMatch === "exact" && weaponIs(n, b.pattern ?? "")),
    ) ||
    equipSlotFor(n) === "LeftHand";
  const out = content()
    .items.items.map((i) => i.name)
    .filter(named);
  const masterworks = (content().craft.stations.smith?.masterwork ?? []).flatMap((m) =>
    m.outcomes.map((o) => o.result),
  );
  const runtime = ["Long Sword+3", "Gold Axe+2", "Bo+1", "Thor's Hammer+5"];
  return [...new Set([NOTHING, ...out, ...masterworks, ...runtime])];
}

function now(): Record<string, unknown> {
  const levels = boundaries();
  const out: Record<string, unknown> = {};
  for (const w of weapons()) {
    const row: Record<string, string> = {};
    // A bow is swung with arrows and their crystal, so its skill tiers are reached (with no arrows
    // attack power stops at 1 before them).
    const bow = hasBehaviour(w, "bow");
    const hand: Partial<Equipment> = bow
      ? { weapon: w, offHand: `${ARROW_COLOURS[0]} Arrows` }
      : { weapon: w };
    const crystal = bow ? true : undefined;
    levels.forEach((v, i) => {
      row[String(v)] = swing(fighter(v, i, hand), crystal);
    });
    row.potion = swing(fighter(50, 3, hand, { attackBonus: 1 }), crystal);
    row.argonRing = swing(fighter(50, 2, { ...hand, ring: "Argon's Ring" }), crystal);
    // A faction whose perk adds to melee (Classic: the Warriors), so the perk is in the roll.
    const melee =
      content().social.factions.find((f) => factionPerk({ key: f.key, tier: 3 }, "melee") > 0)
        ?.key ?? null;
    expect(melee).not.toBeNull();
    row.faction = swing(fighter(50, 4, hand, { faction: { key: melee, tier: 3 } }), crystal);
    if (hasBehaviour(w, "bow")) {
      for (const v of [0, 31, 100]) {
        for (const off of [NOTHING, ...ARROW_COLOURS.map((c) => `${c} Arrows`)]) {
          for (const ring of [NOTHING, "Bowmaster's Ring", "Argon's Ring"]) {
            for (const crystal of [true, false]) {
              row[`bow ${v} ${off} ${ring} ${crystal}`] = swing(
                fighter(v, v, { weapon: w, offHand: off, ring }),
                crystal,
              );
            }
          }
        }
      }
    }
    out[w] = row;
  }
  return out;
}

test("every Classic weapon's attack power is the golden's", () => {
  const got = now();
  if (process.env.ATTACK_GOLDEN === "write") {
    writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
  expect(Object.keys(got).length).toBeGreaterThan(60);
  expect(got).toEqual(golden);
});
