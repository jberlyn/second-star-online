/**
 * Upgrade rehearsal (issue #27, decision 10): before a release with migrations goes live, run it on
 * a copy of a real server's database. It never touches the file it is given:
 * 1. the migrations run and the server starts;
 * 2. the store is the Classic pack, unchanged, with Classic recorded as installed;
 * 3. every table that existed before compares equal after (characters, bags, equipment, maps,
 *    ground items...), apart from the rows the bot adds;
 * 4. a bot creates a character, logs in, is told the store's hash, fetches it, walks and talks;
 * 5. on a second copy, every existing character enters the world and leaves without a fault.
 *
 * Run: `bun tools/upgrade-rehearsal.ts <path to a copy of sso.sqlite>`. Exits 1 if any check fails.
 */
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classicData } from "../packages/data/src/classic.ts";
import { connectBot, make, settle } from "../packages/server/e2e/harness.ts";
import { startServer } from "../packages/server/src/main.ts";
import { manualClock } from "../packages/server/tests/helpers/manual-clock.ts";
import * as shared from "../packages/shared/src/index.ts";

const source = process.argv[2];
if (!source) {
  console.error("usage: bun tools/upgrade-rehearsal.ts <path to a copy of sso.sqlite>");
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), "sso-rehearsal-"));
const clientDir = join(work, "client");
mkdirSync(clientDir);
writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) {
    failures++;
  }
};

type Dump = Map<string, string[]>;
function dump(path: string): Dump {
  const db = new Database(path, { readonly: true });
  const out: Dump = new Map();
  const tables = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((t) => t.name);
  for (const t of tables) {
    out.set(
      t,
      db
        .query<Record<string, unknown>, []>(`SELECT * FROM "${t}"`)
        .all()
        .map((r) => JSON.stringify(r))
        .sort(),
    );
  }
  db.close();
  return out;
}

// ---- run 1: migrate, start, compare, play -----------------------------------------------------
const db1 = join(work, "run1.sqlite");
copyFileSync(source, db1);
const before = dump(db1);
const clock = manualClock();
const faults: unknown[] = [];
const server = startServer({
  dbPath: db1,
  port: 0,
  development: false,
  clientDir,
  clock,
  autoTick: false,
  onFault: (_w: string, e: unknown) => faults.push(e),
});
check(true, "the migrations ran and the server started");
const migrations = server.db
  .query<{ name: string }, []>("SELECT name FROM _migrations ORDER BY id DESC")
  .all()
  .map((r: { name: string }) => r.name);
check(migrations.includes("20261122_53_content_store.sql"), `migrated to ${migrations[0]}`);
const packs = server.db.query("SELECT id, version, source FROM content_packs").all();
check(
  JSON.stringify(packs) === JSON.stringify([{ id: "classic", version: "1.0.0", source: "release" }]),
  `Classic is installed: ${JSON.stringify(packs)}`,
);
const store = shared.content();
const { npcFiles: _n, rects: _r, ...storeRest } = store;
void _n;
void _r;
check(
  shared.DATASET_IDS.every(
    (id: string) => JSON.stringify(store[id]) === JSON.stringify((classicData as Record<string, unknown>)[id]),
  ),
  "the store is the Classic pack, unchanged",
);
void storeRest;

const wsUrl = new URL("/ws", server.url);
wsUrl.protocol = "ws:";
const bot = await connectBot(wsUrl.href);
bot.send(make("Rehearsal"));
await bot.waitFor((m: { t: string }) => m.t === "created");
bot.close();
const player = await connectBot(wsUrl.href);
player.send({ t: "login", name: "Rehearsal", password: "secret" });
const welcome = await player.waitFor((m: { t: string }) => m.t === "welcome");
check(welcome.content === store.hash, `the login names the store's hash (${welcome.content})`);
const file = await fetch(new URL(`/content/${welcome.content}.json`, server.url));
const body = (await file.json()) as { hash: string; data: { items: { items: unknown[] } } };
check(
  file.ok && body.hash === store.hash && body.data.items.items.length === store.items.items.length,
  "the client can fetch that store",
);
const snap = await player.waitFor((m: { t: string }) => m.t === "snapshot");
player.send({ t: "mapReady" });
await settle();
const start = { x: snap.you.x, y: snap.you.y };
for (const dir of ["S", "E", "N", "W"] as const) {
  player.send({ t: "move", dir, held: true });
  for (let i = 0; i < 20; i++) {
    clock.advance(50);
    server.tickNow(1);
  }
  player.send({ t: "move", dir, held: false });
  await settle();
}
player.send({ t: "chat", text: "Hello from the rehearsal" });
await settle();
server.tickNow(2);
await settle();
const moved = player.inbox.some((m: { t: string }) => m.t === "delta" || m.t === "correction");
check(moved, `the bot walked from ${start.x},${start.y} and the server answered`);
const heard = player.inbox.some(
  (m: { t: string; text?: string }) => m.t === "chat" && String(m.text).includes("Hello from the rehearsal"),
);
check(heard, "the bot's chat came back");
player.close();
await settle();
await server.stop();
check(faults.length === 0, `no faults (${faults.length})`);

const after = dump(db1);
const botAccount = (() => {
  const d = new Database(db1, { readonly: true });
  const r = d.query<{ id: string; account_id: string }, []>(
    "SELECT id, account_id FROM characters WHERE name = 'Rehearsal'",
  ).get();
  d.close();
  return r;
})();
const isBotRow = (row: string) =>
  botAccount !== null && (row.includes(botAccount.id) || row.includes(botAccount.account_id) || row.includes("Rehearsal"));
// Expected changes: the migrations' bookkeeping, and the monster slots of the map the bot played on
// (its monsters moved while it was there, and the stop saved them).
const botMap = snap.map.name as string;
const botMapId = (() => {
  const d = new Database(db1, { readonly: true });
  const [, mx, my] = /^x(-?\d+)y(-?\d+)/.exec(botMap) ?? [];
  const r = d
    .query<{ id: string }, [number, number]>("SELECT id FROM maps WHERE mx = ? AND my = ? AND slot = 0")
    .get(Number(mx), Number(my));
  d.close();
  return r?.id ?? "";
})();
const expected = (table: string, row: string) =>
  table === "_migrations" || table === "sqlite_sequence" || (table === "map_slots" && row.includes(botMapId));
for (const [table, rows] of before) {
  const now = new Set(after.get(table) ?? []);
  const lost = rows.filter((r) => !now.has(r) && !expected(table, r));
  const added = (after.get(table) ?? []).filter(
    (r) => !rows.includes(r) && !isBotRow(r) && !expected(table, r),
  );
  const ok = lost.length === 0 && added.length === 0;
  if (!ok || ["characters", "inventory", "equipment", "maps", "ground_items", "container_items", "vault_items", "bank_accounts", "character_skills", "character_spells", "houses"].includes(table)) {
    check(ok, `${table}: ${rows.length} rows before, unchanged after${ok ? "" : ` (lost ${lost.length}, added ${added.length})`}`);
    if (!ok) {
      console.log("   lost:", lost.slice(0, 3));
      console.log("   added:", added.slice(0, 3));
    }
  }
}
const newTables = [...after.keys()].filter((t) => !before.has(t));
console.log(`new tables: ${newTables.join(", ")}`);

// ---- run 2: every existing character enters the world and leaves -----------------------------
const db2 = join(work, "run2.sqlite");
copyFileSync(source, db2);
const faults2: unknown[] = [];
const server2 = startServer({
  dbPath: db2,
  port: 0,
  development: false,
  clientDir,
  clock: manualClock(),
  autoTick: false,
  onFault: (_w: string, e: unknown) => faults2.push(e),
});
const chars = server2.db
  .query<{ id: string; name: string }, []>("SELECT id, name FROM characters ORDER BY name")
  .all();
let entered = 0;
for (const c of chars) {
  if (server2.game.enter(c.id, false, "127.0.0.1")) {
    entered++;
    server2.tickNow(5);
    server2.game.leave(c.id);
  } else {
    console.log(`   ${c.name} could not enter`);
  }
}
check(entered === chars.length, `${entered} of ${chars.length} existing characters entered the world and left`);
await server2.stop();
check(faults2.length === 0, `no faults (${faults2.length})`);

rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? "REHEARSAL PASSED" : `REHEARSAL FAILED: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
