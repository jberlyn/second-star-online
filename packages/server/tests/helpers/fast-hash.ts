/**
 * Test preload: hashes passwords with a cheap Argon2id cost. The real cost (accounts.ts
 * `HASH_OPTIONS`) took over half the suite's CPU time. Tests that need hashing to take real time,
 * such as the races that must count tries before the hash, restore it with
 * `setHashOptionsForTests(null)` and put this back after.
 */
import { setHashOptionsForTests } from "../../src/persistence/accounts.ts";

export const TEST_HASH_OPTIONS = { algorithm: "argon2id", memoryCost: 1024, timeCost: 1 } as const;

setHashOptionsForTests(TEST_HASH_OPTIONS);
