/** A role that takes no damage loses no HP to starving either. */
import { describe, expect, test } from "bun:test";

import { ADMINISTRATOR, type Role } from "@secondstaronline/shared";

import { regenStep } from "../src/systems/progression/vitals.ts";
import { player, testMap } from "./helpers/sim.ts";

/** Runs the regen timer until it fires once. */
function starve(role: Role) {
  const p = player("Ann", testMap("x1000y992"), 5, 5);
  p.role = role;
  p.char.hunger = 10;
  p.char.vitals.hp = 15;
  for (let i = 0; i < 400; i++) {
    regenStep(p);
  }
  return p.char.vitals.hp;
}

describe("starving", () => {
  test("costs a player HP, and an invulnerable role none", () => {
    expect(starve(null)).toBeLessThan(15);
    expect(starve(ADMINISTRATOR)).toBe(15);
  });
});
