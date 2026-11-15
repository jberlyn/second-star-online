/**
 * A second process that holds a lock on a database file (tests/database.test.ts): opens `path`
 * in WAL, takes the write lock (or, with `exclusive`, the whole file, as a closing connection
 * does while it checkpoints), prints "locked", holds it for `ms`, then commits and exits.
 *
 * Run: `bun tests/helpers/lock-holder.ts <path> <write|exclusive> <ms>`.
 */
import { Database } from "bun:sqlite";

const [path, mode, ms] = process.argv.slice(2);
if (!path || (mode !== "write" && mode !== "exclusive") || !ms) {
  console.error("usage: bun tests/helpers/lock-holder.ts <path> <write|exclusive> <ms>");
  process.exit(2);
}
const db = new Database(path, { create: true });
db.run("PRAGMA journal_mode = WAL;");
db.run("CREATE TABLE IF NOT EXISTS held (who TEXT NOT NULL);");
if (mode === "exclusive") {
  // The first write after this keeps the file locked until the connection closes.
  db.run("PRAGMA locking_mode = EXCLUSIVE;");
  db.run("INSERT INTO held (who) VALUES ('holder');");
}
db.run("BEGIN IMMEDIATE;");
db.run("INSERT INTO held (who) VALUES ('holder');");
console.log("locked");
Bun.sleepSync(Number(ms));
db.run("COMMIT;");
db.close(true);
