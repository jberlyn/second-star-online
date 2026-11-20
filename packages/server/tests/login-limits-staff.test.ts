/**
 * A role with `bypassLoginLimits` and an address over its per-address count: the operator still
 * gets in, but the bypass is not a free run of guesses at a staff password.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { TEXT } from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

const IP = "10.0.0.9";

describe("staff and the per-address login limit", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
  });

  async function spentAddress() {
    const game = createGame({
      db,
      send: () => {},
      isoNow: () => "2026-11-20T00:00:00.000Z",
      rng: NEVER_PUSH,
    });
    for (const name of ["Mod", "Bob"]) {
      const r = await game.create({
        t: "create",
        name,
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      });
      expect(r).toEqual({ ok: true });
    }
    const mod = await game.login("Mod", "pw", "10.9.9.9");
    if (!mod.ok) {
      throw new Error(mod.text);
    }
    setRole(db, mod.accountId, "moderator", "2026-11-20T00:00:00.000Z");
    // Spend the address's 20 failures on names that do not exist.
    for (let i = 0; i < game.settings.loginFailsPerIp; i++) {
      await game.login(`Nobody${i}`, "x", IP);
    }
    expect(await game.login("Bob", "pw", IP)).toEqual({ ok: false, text: TEXT.tooManyLogins });
    return game;
  }

  test("SSO: a staff account still gets in from a spent address", async () => {
    const game = await spentAddress();
    expect((await game.login("Mod", "pw", IP)).ok).toBe(true);
  });

  test("SSO: a spent address gets one try at a staff account, not a run of guesses", async () => {
    const game = await spentAddress();
    expect(await game.login("Mod", "guess1", IP)).toEqual({ ok: false, text: TEXT.badPassword });
    expect(await game.login("Mod", "guess2", IP)).toEqual({ ok: false, text: TEXT.tooManyLogins });
    expect(await game.login("Mod", "pw", IP)).toEqual({ ok: false, text: TEXT.tooManyLogins });
    // Another address is untouched.
    expect((await game.login("Mod", "pw", "10.0.0.10")).ok).toBe(true);
  });
});
