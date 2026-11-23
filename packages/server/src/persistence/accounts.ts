/**
 * Accounts: Argon2id hashes via `Bun.password`, the role's id on the row (roles.ts). Plain
 * functions taking the `Db` first.
 */
import type { Db } from "./database.ts";

export interface Account {
  id: string;
  username: string;
  passwordHash: string;
  /** The role's id, or null for an ordinary player. */
  role: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AccountRow {
  id: string;
  username: string;
  password_hash: string;
  role: string | null;
  created_at: string;
  updated_at: string;
}

interface HashOptions {
  algorithm: "argon2id";
  memoryCost: number;
  timeCost: number;
}

/** Argon2id parameters for every stored password. */
export const HASH_OPTIONS: Readonly<HashOptions> = {
  algorithm: "argon2id",
  memoryCost: 65536,
  timeCost: 2,
};

let hashOptions: Readonly<HashOptions> = HASH_OPTIONS;

/**
 * Tests only: hash new passwords with cheaper parameters (null restores `HASH_OPTIONS`). The
 * server test preload sets this, because the real cost was over half the suite's CPU time.
 * Verifying reads the parameters from the stored hash, so hashes of either cost still verify.
 */
export function setHashOptionsForTests(options: Readonly<HashOptions> | null): void {
  hashOptions = options ?? HASH_OPTIONS;
}

const COLUMNS = "id, username, password_hash, role, created_at, updated_at";

export class UsernameTakenError extends Error {
  constructor(readonly username: string) {
    super(`Account '${username}' already exists`);
  }
}

export function findAccountByUsername(db: Db, username: string): Account | null {
  const row = db
    .query<AccountRow, [string]>(`SELECT ${COLUMNS} FROM accounts WHERE username = ? LIMIT 1`)
    .get(username);
  return row ? toAccount(row) : null;
}

export function findAccountById(db: Db, id: string): Account | null {
  const row = db
    .query<AccountRow, [string]>(`SELECT ${COLUMNS} FROM accounts WHERE id = ? LIMIT 1`)
    .get(id);
  return row ? toAccount(row) : null;
}

/**
 * At most this many Argon2id hashes run at once, whatever the number of sockets (each takes 64
 * MiB). Later ones wait their turn in order.
 */
export const HASH_SLOTS = 2;
let hashing = 0;
const hashWaiting: (() => void)[] = [];

async function inHashSlot<T>(work: () => Promise<T>): Promise<T> {
  if (hashing >= HASH_SLOTS) {
    await new Promise<void>((resolve) => hashWaiting.push(resolve));
  } else {
    hashing += 1;
  }
  try {
    return await work();
  } finally {
    // Hand the slot straight to the next waiter, or free it.
    const next = hashWaiting.shift();
    if (next) {
      next();
    } else {
      hashing -= 1;
    }
  }
}

/** Hashes a password with the Argon2id parameters above. */
export function hashPassword(password: string): Promise<string> {
  return inHashSlot(() => Bun.password.hash(password, hashOptions));
}

/**
 * Inserts an account row with an already-hashed password. Synchronous, so a caller can put
 * it in one transaction with the character it creates. Throws `UsernameTakenError`.
 */
export function insertAccount(
  db: Db,
  input: { username: string; passwordHash: string; now: string; role?: string | null },
): Account {
  const username = input.username.trim();
  if (username === "") {
    throw new Error("Username cannot be empty");
  }
  const account: Account = {
    id: Bun.randomUUIDv7(),
    username,
    passwordHash: input.passwordHash,
    role: input.role ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  try {
    db.query(
      "INSERT INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(account.id, username, account.passwordHash, account.role, input.now, input.now);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new UsernameTakenError(username);
    }
    throw err;
  }
  return account;
}

/**
 * Creates an account. `now` is an ISO timestamp passed in by the caller (no hidden clock).
 * Hashing is async; the insert is a single synchronous statement.
 */
export async function createAccount(
  db: Db,
  input: { username: string; password: string; now: string; role?: string | null },
): Promise<Account> {
  const username = input.username.trim();
  if (username === "") {
    throw new Error("Username cannot be empty");
  }
  if (findAccountByUsername(db, username)) {
    throw new UsernameTakenError(username);
  }
  const passwordHash = await hashPassword(input.password);
  // Two creates racing across the await above: the UNIQUE constraint decides.
  return insertAccount(db, { username, passwordHash, now: input.now, role: input.role });
}

export function verifyPassword(account: Account, password: string): Promise<boolean> {
  return inHashSlot(() => Bun.password.verify(password, account.passwordHash));
}

/** Replaces an account's password hash (the in-game `Password=` command). */
export function setPasswordHash(db: Db, accountId: string, hash: string, now: string): void {
  db.query("UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    hash,
    now,
    accountId,
  );
}

/** Gives an account a role by id, or none (`null`). */
export function setRole(db: Db, accountId: string, role: string | null, now: string): void {
  db.query("UPDATE accounts SET role = ?, updated_at = ? WHERE id = ?").run(role, now, accountId);
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
