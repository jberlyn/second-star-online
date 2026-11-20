/**
 * Pins for ledger entries in docs/differences-from-fso.md about what a client may say: no message
 * acts on another player, and the attack and gold intents carry no target, damage or position.
 */
import { describe, expect, test } from "bun:test";

import { inGameSchema, preAuthSchema } from "../src/protocol/messages.ts";

const types = [...inGameSchema.options, ...preAuthSchema.options].map((o) => o.shape.t.value);
const ok = (m: unknown) => inGameSchema.safeParse(m).success;

describe("the client's messages", () => {
  test("SSO: no client message warps, pushes, jails, kicks or pays another player", () => {
    for (const t of types) {
      expect(t).not.toMatch(/warp|push|jail|kick|ban|sigil|loot|break|damage|spawn/i);
    }
    for (const t of ["warp", "push", "jail", "kick", "ban", "giveGold", "dropLoot", "breakItem"]) {
      expect(ok({ t, name: "Bob" })).toBe(false);
    }
    // The gold dialog names an amount only: who gets it is the server's faced tile.
    expect(ok({ t: "gold", n: 5 })).toBe(true);
    expect(ok({ t: "gold", n: 5, to: "Bob" })).toBe(false);
  });

  test("SSO: 1.6's inert admin tools have no message: SaveMonDrops, RPG, LoadMiniMap, ClearChest", () => {
    for (const t of types) {
      expect(t).not.toMatch(/monDrop|^rpg$|miniMap|clearChest|^rain|weather/i);
    }
  });

  test("SSO: the attack intent is the key's hold state only: no damage, power, target, position or weapon", () => {
    expect(ok({ t: "attack", seq: 1, held: true })).toBe(true);
    for (const extra of [
      { dmg: 9 },
      { power: 9 },
      { target: "Bob" },
      { x: 5, y: 5 },
      { facing: "N" },
      { weapon: "Rune Sword" },
      { crystal: "Blue" },
    ]) {
      expect(ok({ t: "attack", seq: 1, held: true, ...extra })).toBe(false);
    }
  });
});
