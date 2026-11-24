/**
 * Upgrade rehearsal (issue #27, decision 10): before a release with migrations goes live, run it on
 * a copy of a real server's database. It never touches the file it is given:
 * 1. the migrations run and the server starts;
 * 2. the store is the Classic pack, unchanged, with Classic recorded as installed;
 * 3. every table that existed before compares equal after (characters, bags, equipment, maps,
 *    ground items...), apart from the rows the bot adds and what the migrations change on purpose
 *    (each named below: columns added or dropped, renamed roles and crystals, faction keys,
 *    restored HP/SP maxima, filled respawn points, seeded settings, unanswerable quest lines rolled
 *    afresh, the
 *    death-drop settings moved to the Balance page, loot that had already expired);
 * 4. a bot creates a character, logs in, is told the store's hash, fetches it, walks (its tile
 *    really changes) and talks;
 * 5. on a second copy, every existing character enters the world and leaves without a fault.
 *
 * Run: `bun tools/upgrade-rehearsal.ts <path to a copy of sso.sqlite>`. Exits 1 if any check fails.
 */
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classicData, classicManifest } from "../packages/data/src/classic.ts";
import { connectBot, make, settle } from "../packages/server/e2e/harness.ts";
import { MOVE_SUMMARY, movedValues } from "../packages/server/src/content/moved-settings.ts";
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

type Row = Record<string, unknown>;
type Dump = Map<string, { cols: string[]; rows: Row[] }>;
function dump(path: string): Dump {
  const db = new Database(path, { readonly: true });
  const out: Dump = new Map();
  const tables = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((t) => t.name);
  // Skills were saved by position until skills_by_key (#37): a numbered row reads as the skill the
  // server recorded at that position, else Classic's, so both layouts compare by skill.
  const recorded = tables.includes("content_skills")
    ? new Map(
        db
          .query<{ skill: string; idx: number }, []>("SELECT skill, idx FROM content_skills")
          .all()
          .map((r) => [r.idx, r.skill]),
      )
    : new Map<number, string>();
  const skillAt = (n: number) =>
    recorded.get(n) ?? classicData.classes.skills[n - 1]?.skill ?? `#${n}`;
  for (const t of tables) {
    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info("${t}")`)
      .all()
      .map((c) => c.name);
    const rows = db
      .query<Row, []>(`SELECT * FROM "${t}"`)
      .all()
      .map((r) =>
        t === "character_skills" && typeof r.skill === "number" ? { ...r, skill: skillAt(r.skill) } : r,
      );
    out.set(t, { cols, rows });
  }
  db.close();
  return out;
}

// ---- what the migrations change on purpose ----------------------------------------------------
/** Migration 56: crystals in the singular, and the broken Knight's Sword's new name. */
const RENAMED_ITEMS: Record<string, string> = {
  "blue crystals": "Blue Crystal",
  "blue crystal": "Blue Crystal",
  "red crystals": "Red Crystal",
  "red crystal": "Red Crystal",
  "green crystals": "Green Crystal",
  "green crystal": "Green Crystal",
  "yellow crystals": "Yellow Crystal",
  "yellow crystal": "Yellow Crystal",
  "purple crystals": "Purple Crystal",
  "purple crystal": "Purple Crystal",
  "white crystals": "White Crystal",
  "white crystal": "White Crystal",
  "damaged sword, knight's": "Damaged Sword, Knight",
};
/** Migration 42: `immortal` became the Administrator role and `player` no role. */
const ROLES: Record<string, string | null> = { immortal: "administrator", player: null };
/** Migration 63: factions by key (0 none). */
const FACTIONS: Record<string, string | null> = { "0": null, "1": "mage", "2": "warrior", "3": "adventurer" };
const FCT_SPWN: Record<string, string> = { w: "warrior", m: "mage", a: "adventurer" };
/** Settings migrations 59 and 66 store when the server had none. */
const SEEDED_SETTINGS = new Set(["jailPoint", "bellMap", "startPoint", "fallbackPoint"]);
/** The death-drop and loot settings, moved to the Balance page (#19 stage 4). */
const MOVED_SETTINGS = new Set(["deathDrops", "deathDropKind", "deathDropGoldCap", "deathDropMinLevel", "lootDecay"]);
/** Columns that may only grow (migration 39 gave back HP/SP maxima a death had taken). */
const GROW: Record<string, string[]> = { characters: ["hp_max", "sp_max"] };
/** Columns a migration may fill where they were empty (a respawn point, migration 35). */
const FILL: Record<string, string[]> = { characters: ["respawn_map_id", "respawn_x", "respawn_y"] };

/** A row before the upgrade, as the migrations leave it. */
function migrated(table: string, r: Row): Row {
  const o = { ...r };
  if (typeof o.item === "string" && Object.hasOwn(RENAMED_ITEMS, o.item.toLowerCase())) {
    o.item = RENAMED_ITEMS[o.item.toLowerCase()];
  }
  if (table === "accounts" && typeof o.role === "string" && Object.hasOwn(ROLES, o.role)) {
    o.role = ROLES[o.role];
  }
  if (table === "characters" && (typeof o.faction === "number" || typeof o.faction === "string")) {
    const k = String(o.faction);
    o.faction = Object.hasOwn(FACTIONS, k) ? FACTIONS[k] : o.faction;
  }
  if (table === "maps" && typeof o.fct_spwn === "string") {
    o.fct_spwn = FCT_SPWN[o.fct_spwn.toLowerCase()] ?? "";
  }
  return o;
}

/** Tables a migration drops on purpose. */
const DROPPED = new Set(["content_skills", "faction_powers"]);

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
  JSON.stringify(packs) ===
    JSON.stringify([{ id: "classic", version: classicManifest.version, source: "release" }]),
  `Classic is installed: ${JSON.stringify(packs)}`,
);
const store = shared.content();
// The death-drop and loot settings the operator changed now play from the balance `drops` row.
const movedBefore = (() => {
  const d = new Database(source, { readonly: true });
  try {
    return movedValues(d as never).values;
  } finally {
    d.close();
  }
})();
const classicWithMoved = structuredClone(classicData) as Record<string, any>;
classicWithMoved.balance.drops = { ...classicWithMoved.balance.drops, ...movedBefore };
const { npcFiles: _n, rects: _r, ...storeRest } = store;
void _n;
void _r;
check(
  shared.DATASET_IDS.every(
    (id: string) => JSON.stringify(store[id]) === JSON.stringify(classicWithMoved[id]),
  ),
  Object.keys(movedBefore).length > 0
    ? `the store is the Classic pack, with the moved settings (${Object.keys(movedBefore).join(", ")}) in its drops row`
    : "the store is the Classic pack, unchanged",
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
const me = () =>
  [...server.game.world.players.values()].find((p: { name: string }) => p.name === "Rehearsal") as
    | { x: number; y: number }
    | undefined;
let seq = 0;
const tiles: string[] = [];
for (const dir of ["D", "R", "U", "L"] as const) {
  player.send({ t: "move", seq: ++seq, held: dir, turn: false });
  await settle();
  for (let i = 0; i < 20; i++) {
    clock.advance(50);
    server.tickNow(1);
  }
  player.send({ t: "move", seq: ++seq, held: null, turn: false });
  await settle();
  server.tickNow(10);
  await settle();
  const at = me();
  tiles.push(at ? `${at.x},${at.y}` : "gone");
}
player.send({ t: "chat", text: "Hello from the rehearsal" });
await settle();
server.tickNow(2);
await settle();
const moved = tiles.some((t) => t !== `${start.x},${start.y}` && t !== "gone");
check(moved, `the bot walked from ${start.x},${start.y}: ${tiles.join(" → ")}`);
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
const nowIso = new Date().toISOString();
const isBotMapSlot = (table: string, r: Row) => table === "map_slots" && r.map_id === botMapId;
for (const [table, was] of before) {
  if (table === "_migrations" || table === "sqlite_sequence") {
    continue;
  }
  if (DROPPED.has(table) && !after.has(table)) {
    console.log(`dropped table: ${table} (${was.rows.length} rows), as its migration does`);
    continue;
  }
  const is = after.get(table) ?? { cols: [], rows: [] };
  // Columns a migration added or dropped are not compared.
  const cols = was.cols.filter((c) => is.cols.includes(c));
  const loose = new Set([...(GROW[table] ?? []), ...(FILL[table] ?? [])]);
  const pick = (r: Row, all = false) =>
    JSON.stringify(Object.fromEntries(cols.filter((c) => all || !loose.has(c)).map((c) => [c, r[c]])));
  const afterRows = is.rows.filter((r) => !isBotRow(JSON.stringify(r)) && !isBotMapSlot(table, r));
  const remaining = new Map<string, Row[]>();
  for (const r of afterRows) {
    const k = pick(r);
    remaining.set(k, [...(remaining.get(k) ?? []), r]);
  }
  const lost: string[] = [];
  const changed: string[] = [];
  for (const raw of was.rows) {
    if (isBotMapSlot(table, raw)) {
      continue;
    }
    const r = migrated(table, raw);
    const match = remaining.get(pick(r))?.shift();
    if (!match) {
      if (table === "ground_items" && r.kind === "loot" && typeof r.expires_at === "string" && r.expires_at < nowIso) {
        continue; // already expired: it decays on the first tick, as it would have
      }
      // A quest line no one can answer (Dantan's retired Water Orb) is rolled afresh at start.
      if (table === "quests" && typeof r.text === "string" && shared.questLineUnanswerable(r.text)) {
        for (const [k, rows] of remaining) {
          const i = rows.findIndex((x) => x.line === r.line);
          if (i >= 0) {
            rows.splice(i, 1);
            remaining.set(k, rows);
            break;
          }
        }
        continue;
      }
      if (table === "settings" && MOVED_SETTINGS.has(String(r.key))) {
        continue; // moved to the Balance page, checked below
      }
      lost.push(pick(r, true));
      continue;
    }
    for (const c of GROW[table] ?? []) {
      if (cols.includes(c) && Number(match[c]) < Number(r[c])) {
        changed.push(`${c} ${String(r[c])} → ${String(match[c])}`);
      }
    }
    for (const c of FILL[table] ?? []) {
      if (cols.includes(c) && r[c] !== null && r[c] !== match[c]) {
        changed.push(`${c} ${String(r[c])} → ${String(match[c])}`);
      }
    }
  }
  const added = [...remaining.values()]
    .flat()
    .filter((r) => !(table === "settings" && SEEDED_SETTINGS.has(String(r.key)) && !was.rows.some((w) => w.key === r.key)))
    // The moved settings' publish, checked below.
    .filter((r) => !(table === "audit_log" && r.actor === "system" && r.command === "content publish" && r.after === '["balance/drops"]'))
    .map((r) => pick(r, true));
  const ok = lost.length === 0 && added.length === 0 && changed.length === 0;
  if (!ok || ["characters", "inventory", "equipment", "maps", "ground_items", "container_items", "vault_items", "bank_accounts", "character_skills", "character_spells", "houses", "accounts", "quests", "settings"].includes(table)) {
    check(ok, `${table}: ${was.rows.length} rows before, as the migrations leave them after${ok ? "" : ` (lost ${lost.length}, added ${added.length}, changed ${changed.length})`}`);
    if (!ok) {
      console.log("   lost:", lost.slice(0, 3));
      console.log("   added:", added.slice(0, 3));
      console.log("   changed:", changed.slice(0, 3));
    }
  }
}
// The moved settings: gone from Server Settings, and (when any changed what plays) a publish by
// `system` with its audit row and the operator's drops row.
{
  const d = new Database(db1, { readonly: true });
  const left = d
    .query<{ key: string }, []>("SELECT key FROM settings")
    .all()
    .filter((r) => MOVED_SETTINGS.has(r.key));
  check(left.length === 0, `the death-drop and loot settings left Server Settings (${left.length} left)`);
  const publishes = d
    .query<{ id: string; actor_name: string }, [string]>("SELECT id, actor_name FROM content_publishes WHERE summary = ?")
    .all(MOVE_SUMMARY);
  const changesPlay =
    JSON.stringify({ ...classicData.balance.drops, ...movedBefore }) !== JSON.stringify(classicData.balance.drops);
  if (changesPlay) {
    const audit = publishes[0]
      ? d.query("SELECT 1 FROM audit_log WHERE command = 'content publish' AND target = ?").get(publishes[0].id)
      : null;
    const row = d.query("SELECT 1 FROM content_rows WHERE dataset = 'balance' AND part = 'drops'").get();
    check(
      publishes.length === 1 && publishes[0]?.actor_name === "system" && audit !== null && row !== null,
      `the moved settings were published once by system, with its audit row and drops row (${publishes.length} publish)`,
    );
  } else {
    check(publishes.length === 0, `nothing to move was published (${publishes.length} publish)`);
  }
  d.close();
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
