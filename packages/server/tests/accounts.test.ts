import { beforeEach, describe, expect, test } from "bun:test";

import {
  createAccount,
  findAccountById,
  findAccountByUsername,
  setRole,
  UsernameTakenError,
  verifyPassword,
} from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";

const NOW = "2026-11-04T00:00:00.000Z";
let db: Db;

beforeEach(() => {
  db = openDatabase();
  migrate(db);
});

describe("accounts", () => {
  test("creates an account with an Argon2id hash and the player role", async () => {
    const a = await createAccount(db, { username: " Arthur ", password: "Excalibur!", now: NOW });
    expect(a.username).toBe("Arthur");
    expect(a.role).toBe("player");
    expect(a.id.charAt(14)).toBe("7"); // UUIDv7
    expect(a.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(a, "Excalibur!")).toBe(true);
    expect(await verifyPassword(a, "wrong")).toBe(false);
    expect(findAccountById(db, a.id)).toEqual(a);
  });

  test("usernames are unique regardless of case", async () => {
    await createAccount(db, { username: "Lancelot", password: "pw", now: NOW });
    expect(findAccountByUsername(db, "LANCELOT")?.username).toBe("Lancelot");
    await expect(
      createAccount(db, { username: "lancelot", password: "pw", now: NOW }),
    ).rejects.toBeInstanceOf(UsernameTakenError);
  });

  test("rejects an empty username", async () => {
    await expect(createAccount(db, { username: "  ", password: "pw", now: NOW })).rejects.toThrow();
  });

  test("roles come from the row, never the name (closes gm_*)", async () => {
    const gm = await createAccount(db, { username: "gm_Merlin", password: "pw", now: NOW });
    expect(gm.role).toBe("player");
    setRole(db, gm.id, "immortal", NOW);
    expect(findAccountById(db, gm.id)?.role).toBe("immortal");
    expect(() => setRole(db, gm.id, "god" as never, NOW)).toThrow(/CHECK/);
  });
});
