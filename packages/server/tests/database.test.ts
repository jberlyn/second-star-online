/**
 * The busy timeout (persistence/database.ts): when another process holds the file, the server
 * waits for it instead of failing at once, and the wait has a ceiling. Real SQL on a file, with a
 * real second process holding the lock (tests/helpers/lock-holder.ts).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUSY_TIMEOUT_MS, openDatabase } from "../src/persistence/database.ts";

const HOLDER = join(import.meta.dir, "helpers", "lock-holder.ts");

let dir = "";
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = "";
  }
});

/** Starts the holder on a fresh file and resolves once it holds the lock. */
async function hold(mode: "write" | "exclusive", ms: number) {
  dir = mkdtempSync(join(tmpdir(), "sso-busy-"));
  const path = join(dir, "sso.sqlite");
  const proc = Bun.spawn(["bun", HOLDER, path, mode, String(ms)], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(value)).toContain("locked");
  return { path, proc };
}

describe("busy timeout", () => {
  test("every connection gets it, in memory too", () => {
    const db = openDatabase();
    expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: BUSY_TIMEOUT_MS });
    db.close(true);
  });

  test("a write waits for another process's write lock, then lands", async () => {
    const { path, proc } = await hold("write", 300);
    const db = openDatabase(path);
    const began = performance.now();
    db.run("INSERT INTO held (who) VALUES ('server');");
    const waited = performance.now() - began;
    expect(waited).toBeGreaterThan(150);
    expect(waited).toBeLessThan(BUSY_TIMEOUT_MS);
    expect(db.query("SELECT who FROM held ORDER BY rowid").all()).toEqual([
      { who: "holder" },
      { who: "server" },
    ]);
    db.close(true);
    expect(await proc.exited).toBe(0);
  });

  test("opening waits while another process holds the whole file (a closing server's checkpoint)", async () => {
    const { path, proc } = await hold("exclusive", 300);
    const began = performance.now();
    const db = openDatabase(path); // without the timeout: SQLITE_BUSY on `journal_mode = WAL`
    expect(performance.now() - began).toBeGreaterThan(150);
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    db.close(true);
    expect(await proc.exited).toBe(0);
  });

  test("a lock held longer than the timeout still fails, after about the timeout", async () => {
    const { path, proc } = await hold("write", BUSY_TIMEOUT_MS * 3);
    const db = openDatabase(path);
    const began = performance.now();
    expect(() => db.run("INSERT INTO held (who) VALUES ('server');")).toThrow("database is locked");
    const waited = performance.now() - began;
    expect(waited).toBeGreaterThan(BUSY_TIMEOUT_MS * 0.8);
    expect(waited).toBeLessThan(BUSY_TIMEOUT_MS * 2);
    db.close(true);
    proc.kill("SIGKILL");
    await proc.exited;
  });
});
