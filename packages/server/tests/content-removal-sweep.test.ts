/**
 * The removal sweep (issue #28): for every Classic item and monster, a world is seeded with copies
 * in every place the game keeps them, a removal is published with each cleanup option, and the
 * invariants are checked: the schemas pass, nothing is left unresolved, copies are conserved (a
 * purge takes them all and refunds what characters held, a replacement adds exactly what it took,
 * a retirement keeps every copy and lets content make no more), the ledger check finds nothing
 * unlogged, memory matches the database, and a publish that fails after the world cleanup changes
 * nothing at all.
 *
 * `bun run test` runs a seeded sample. `bun run test:sweep` runs every item and monster (a few
 * minutes); `SSO_SWEEP_SEED=<n>` picks another seed. A failure names the case, the item and the
 * invariant.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import {
  type ContentData,
  content,
  displayName,
  installContent,
  isUniqueContainer,
  lingoContains,
  lingoEq,
  liveNpcText,
  NOTHING,
  type ServerMsg,
} from "@secondstaronline/shared";

import { cleanUses, spellingsOf, usesOf } from "../src/content/cleanup.ts";
import { applyRows } from "../src/content/rows.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { schemaProblems, withNpcSaves } from "../src/content/validate.ts";
import type { ContentWorld, Removal } from "../src/content/world.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import type { Db } from "../src/persistence/database.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadShop } from "../src/persistence/economy.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { seededRng } from "../src/rng.ts";
import { npcFileNamed } from "../src/systems/monsters/npcfiles.ts";
import type { WorldMap } from "../src/systems/world/world.ts";

const FULL = process.env.SSO_SWEEP === "full";
const SEED = Number(process.env.SSO_SWEEP_SEED ?? 28);
/** Items seeded into one world and removed in one publish. */
const ITEM_BATCH = 12;
/** Monsters per world: a map has four roster slots. */
const MONSTER_BATCH = 4;
const WALL = Date.UTC(2026, 10, 22, 12, 0, 0);
const ISO = new Date(WALL).toISOString();

/** mulberry32, for choosing replacements, refunds and samples. */
function picker(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (n: number) => Math.floor(next() * n),
    pick<T>(list: readonly T[]): T {
      return list[Math.floor(next() * list.length)] as T;
    },
    shuffle<T>(list: readonly T[]): T[] {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
  };
}

// ---- the base world ------------------------------------------------------------------------------

interface Base {
  bytes: Uint8Array;
  chars: Record<"god" | "al" | "cy" | "bo" | "di", { id: string; name: string; accountId: string }>;
  /** The map everyone starts on: loaded once Al and Cy are in game. */
  near: string;
  /** A map far from it, never loaded. */
  far: string;
  classic: ContentData;
}

let baseCache: Base | null = null;

function newService(db: Db, onPublish?: (hash: string, restoring: boolean) => void) {
  let t = 0;
  return new ContentService({
    db,
    now: () => new Date(WALL + t++).toISOString(),
    releasePacks: RELEASE_PACK_DIRS,
    onPublish: (store, restoring) => {
      installContent(store);
      onPublish?.(store.hash, restoring);
    },
  });
}

/** Creates the characters once; every case starts from a copy of this database. */
async function base(): Promise<Base> {
  if (baseCache) {
    return baseCache;
  }
  const db = openDatabase();
  migrate(db);
  const service = newService(db);
  installContent(service.store());
  const game = createGame({
    db,
    content: service,
    send: () => {},
    isoNow: () => ISO,
    rng: seededRng(SEED),
  });
  const chars = {} as Base["chars"];
  let ip = 0;
  for (const [k, name] of [
    ["god", "God"],
    ["al", "Al"],
    ["cy", "Cy"],
    ["bo", "Bo"],
    ["di", "Di"],
  ] as const) {
    ip += 1;
    const made = await game.create(
      {
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
      },
      `10.0.9.${ip}`,
    );
    if (!made.ok) {
      throw new Error(made.text);
    }
    const row = db
      .query<{ id: string; account_id: string; map_id: string }, [string]>(
        "SELECT id, account_id, map_id FROM characters WHERE name = ?",
      )
      .get(name);
    if (!row) {
      throw new Error(`no ${name}`);
    }
    chars[k] = { id: row.id, name, accountId: row.account_id };
  }
  setRole(db, chars.god.accountId, "administrator", ISO);
  // Starting kit out of the way: every copy in the world is one the sweep seeded.
  for (const table of [
    "inventory",
    "equipment",
    "vault_items",
    "container_items",
    "ground_items",
  ]) {
    db.query(`DELETE FROM ${table}`).run();
  }
  const near = db
    .query<{ map_id: string }, [string]>("SELECT map_id FROM characters WHERE id = ?")
    .get(chars.al.id)?.map_id as string;
  const at = db
    .query<{ mx: number; my: number }, [string]>("SELECT mx, my FROM maps WHERE id = ?")
    .get(near) as { mx: number; my: number };
  const far = db
    .query<{ id: string }, [number, number]>(
      "SELECT id FROM maps WHERE slot = 0 AND abs(mx - ?) + abs(my - ?) > 20 ORDER BY mx, my LIMIT 1",
    )
    .get(at.mx, at.my)?.id as string;
  if (!far) {
    throw new Error("no far map");
  }
  baseCache = {
    bytes: db.serialize(),
    chars,
    near,
    far,
    classic: service.publishedContent(),
  };
  return baseCache;
}

/** A running game on a copy of `bytes`, with Al and Cy in game. */
function startGame(bytes: Uint8Array, b: Base) {
  const db = Database.deserialize(bytes, { strict: true }) as unknown as Db;
  db.run("PRAGMA foreign_keys = ON;");
  const sent: { to: string; msg: ServerMsg }[] = [];
  let live: Game | null = null;
  const service = newService(db, (hash, restoring) => live?.contentPublished(hash, restoring));
  installContent(service.store());
  const game = createGame({
    db,
    content: service,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => ISO,
    rng: seededRng(SEED),
  });
  live = game;
  for (const c of [b.chars.al, b.chars.cy]) {
    if (!game.enter(c.id, false, "10.0.0.7")) {
      throw new Error(`${c.name} could not enter`);
    }
  }
  return { db, service, game, sent };
}

// ---- the census: every copy, where it is ---------------------------------------------------------

type Place = "bag" | "worn" | "vault" | "container" | "ground" | "shop";
interface Copy {
  place: Place;
  /** A character, a container's stored name, a map id, or a player shop. */
  holder: string;
  stored: string;
  qty: number;
  /** A ground item's id, a worn slot. */
  at?: string;
}
interface SlotRec {
  map: string;
  slot: number;
  species: string | null;
  live: string | null;
}
interface Census {
  copies: Copy[];
  slots: SlotRec[];
  gold: Record<string, number>;
  quests: string[];
  containers: Record<string, string[]>;
  /** NPC Editor saves (not player shops). */
  saves: Record<string, string>;
}

const EQUIP_DB: Record<string, string> = {
  weapon: "RightHand",
  offHand: "LeftHand",
  head: "Head",
  body: "Body",
  feet: "Feet",
  ring: "Ring",
};

function loadedMaps(game: Game): WorldMap[] {
  const out = new Map<string, WorldMap>();
  for (const p of game.world.players.values()) {
    out.set(p.map.id, p.map);
  }
  return [...out.values()];
}

function census(game: Game, db: Db): Census {
  const copies: Copy[] = [];
  const gold: Record<string, number> = {};
  const online = new Set<string>();
  for (const p of game.world.players.values()) {
    online.add(p.id);
    gold[p.name] = p.char.gold;
    p.char.bag.forEach((l) => {
      if (l) {
        copies.push({ place: "bag", holder: p.name, stored: l.item, qty: l.qty });
      }
    });
    for (const [field, v] of Object.entries(p.char.equip)) {
      if (v && v !== NOTHING) {
        copies.push({ place: "worn", holder: p.name, stored: v, qty: 1, at: EQUIP_DB[field] });
      }
    }
    for (const v of p.char.vault) {
      copies.push({ place: "vault", holder: p.name, stored: v, qty: 1 });
    }
  }
  const offline = db
    .query<{ id: string; name: string; gold: number }, []>("SELECT id, name, gold FROM characters")
    .all()
    .filter((c) => !online.has(c.id));
  for (const c of offline) {
    gold[c.name] = c.gold;
    for (const r of db
      .query<{ item: string; qty: number }, [string]>(
        "SELECT item, qty FROM inventory WHERE character_id = ? ORDER BY slot",
      )
      .all(c.id)) {
      copies.push({ place: "bag", holder: c.name, stored: r.item, qty: r.qty });
    }
    for (const r of db
      .query<{ item: string; slot: string }, [string]>(
        "SELECT item, slot FROM equipment WHERE character_id = ?",
      )
      .all(c.id)) {
      copies.push({ place: "worn", holder: c.name, stored: r.item, qty: 1, at: r.slot });
    }
    for (const r of db
      .query<{ item: string }, [string]>(
        "SELECT item FROM vault_items WHERE character_id = ? ORDER BY position",
      )
      .all(c.id)) {
      copies.push({ place: "vault", holder: c.name, stored: r.item, qty: 1 });
    }
  }
  const containers: Record<string, string[]> = {};
  for (const [name, lines] of [...game.world.containers].sort((x, y) => x[0].localeCompare(y[0]))) {
    containers[name] = [...lines];
    for (const l of lines) {
      copies.push({ place: "container", holder: name, stored: l, qty: 1 });
    }
  }
  const maps = loadedMaps(game);
  const loaded = new Set(maps.map((m) => m.id));
  for (const m of maps) {
    for (const g of m.ground) {
      copies.push({ place: "ground", holder: m.id, stored: g.item, qty: g.qty ?? 1, at: g.id });
    }
  }
  for (const r of db
    .query<{ id: string; map_id: string; item: string; qty: number }, []>(
      "SELECT id, map_id, item, qty FROM ground_items",
    )
    .all()) {
    if (!loaded.has(r.map_id)) {
      copies.push({ place: "ground", holder: r.map_id, stored: r.item, qty: r.qty, at: r.id });
    }
  }
  for (const s of game.world.playerShops.values()) {
    const f = npcFileNamed(game.world.npcs, s.npc);
    if (!f) {
      continue;
    }
    const saved = loadShop(db, f.name);
    const ledger =
      game.world.shops.get(f.name) ??
      (saved ? { npc: f.name, gold: saved.gold, lines: saved.lines, dirty: false } : null);
    for (const line of liveNpcText(f, ledger).split(/\r\n?|\n/)) {
      const m = /^SEL\|([^:|]*):[^:]*:(\d+)/.exec(line);
      if (m && Number(m[2]) > 0) {
        copies.push({
          place: "shop",
          holder: f.name,
          stored: (m[1] as string).trim(),
          qty: Number(m[2]),
        });
      }
    }
  }
  const slots: SlotRec[] = [];
  for (const m of maps) {
    for (const s of m.slots) {
      slots.push({ map: m.id, slot: s.slot, species: s.species, live: s.live?.name ?? null });
    }
  }
  for (const r of db
    .query<{ map_id: string; slot: number; species: string | null; live_name: string | null }, []>(
      "SELECT map_id, slot, species, live_name FROM map_slots ORDER BY map_id, slot",
    )
    .all()) {
    if (!loaded.has(r.map_id)) {
      slots.push({ map: r.map_id, slot: r.slot, species: r.species, live: r.live_name });
    }
  }
  const shops = new Set([...game.world.playerShops.keys()]);
  const saves: Record<string, string> = {};
  for (const r of db
    .query<{ npc: string; text: string }, []>("SELECT npc, text FROM npc_files ORDER BY npc")
    .all()) {
    if (!shops.has(r.npc.toLowerCase())) {
      saves[r.npc] = r.text;
    }
  }
  return { copies, slots, gold, quests: [...game.world.questLines], containers, saves };
}

/** The catalogue key a stored copy is of, and how many it counts (a crystal pile's count). */
function keyOf(stored: string): { key: string; n: number } {
  const base = displayName(stored).trim();
  if (content().item(base) || CATALOGUE.has(base.toLowerCase())) {
    return { key: base.toLowerCase(), n: 1 };
  }
  const count = /^(\d+) (.+)$/.exec(base);
  if (count && lingoContains(count[2] as string, " Crystals")) {
    return { key: (count[2] as string).trim().toLowerCase(), n: Number(count[1]) };
  }
  const level = /^(.*\S)\+\d+$/.exec(base);
  if (level) {
    return { key: (level[1] as string).toLowerCase(), n: 1 };
  }
  return { key: base.toLowerCase(), n: 1 };
}
/** Every Classic item name, lower case (keys of removed items still count as themselves). */
const CATALOGUE = new Set<string>();

/** Totals by place, holder (characters, maps, shops; containers as one) and key. */
function totals(copies: readonly Copy[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of copies) {
    const { key, n } = keyOf(c.stored);
    const holder = c.place === "container" ? "*" : c.holder;
    const k = `${c.place}|${holder}|${key}`;
    out.set(k, (out.get(k) ?? 0) + c.qty * n);
  }
  return out;
}

const sortCopies = (cs: readonly Copy[]) =>
  [...cs].map((c) => JSON.stringify([c.place, c.holder, c.at ?? "", c.stored, c.qty])).sort();

/** Every row of every table, for "nothing changed at all". */
function dump(db: Db): string {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return tables
    .map(({ name }) => {
      const rows = db.query(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
      return `${name}:${rows
        .map((r) => JSON.stringify(r))
        .sort()
        .join("\n")}`;
    })
    .join("\n\n");
}

// ---- failures ------------------------------------------------------------------------------------

/** Every invariant failure of the run, by case. */
const failures: string[] = [];
let cases = 0;
/** Cases whose publish went through, and cases correctly refused. */
let published = 0;
let refusedCases = 0;
function fail(caseName: string, invariant: string, detail: unknown = "") {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  failures.push(`${caseName}: ${invariant}${text ? ` — ${text.slice(0, 600)}` : ""}`);
}

const ACTOR = (b: Base): ContentActor => ({ accountId: b.chars.god.accountId, name: "God" });

/** A publish whose world cleanup runs, then fails (the database rolls back). */
function failingWorld(world: ContentWorld): ContentWorld {
  return {
    ...world,
    apply: (...args: Parameters<ContentWorld["apply"]>) => {
      world.apply(...args);
      throw new Error("sweep: write failed");
    },
  };
}

// ---- items ---------------------------------------------------------------------------------------

type ContentMode = "remove" | "replace" | "leave";
type CopiesMode = "retire" | "purge" | "replace";

interface ItemPlan {
  items: string[];
  /** Each item's replacement (always named: content replace needs one too). */
  rep: Record<string, string>;
  fillers: [string, string];
  bystanders: string[];
  npc: string;
  questNpc: string;
}

const SLOTS = ["RightHand", "LeftHand", "Head", "Body", "Feet", "Ring"] as const;

/** The crystal colours mining makes; the six crystal items are named after them. */
const COLOURS = ["Blue", "Green", "Purple", "Red", "White", "Yellow"];

/**
 * Mining as an operator leaves it before removing crystals: the colours of removed crystals mine
 * as another colour (a colour is left for the operator by the cleanup, never removed).
 */
function recoloured(
  data: ContentData,
  items: readonly string[],
): ContentData["gather"]["gathering"] | null {
  const gone = COLOURS.filter((c) => items.some((i) => lingoEq(i, `${c} Crystals`)));
  const kept = COLOURS.find((c) => !gone.includes(c));
  if (gone.length === 0 || !kept) {
    return null;
  }
  const g = data.gather.gathering;
  return {
    ...g,
    mining: { ...g.mining, colours: g.mining.colours.map((c) => (gone.includes(c) ? kept : c)) },
  };
}

const withGathering = (data: ContentData, gathering: ContentData["gather"]["gathering"] | null) =>
  gathering ? { ...data, gather: { ...data.gather, gathering } } : data;

/** Whether a removal's content cleanup leaves a reference (so its publish must be refused). */
function leavesReferences(data: ContentData, key: string, mode: ContentMode, rep: string): boolean {
  if (mode === "leave") {
    return true; // the seeded NPC Editor save sells it
  }
  const uses = usesOf(data, "item", key, spellingsOf(data, "item", key));
  const { left } = cleanUses(data, uses, mode, rep, [], (r, value) => {
    const next = applyRows(data, [{ ...r, op: "set", data: value }]);
    return DATASET_SCHEMAS[r.dataset].safeParse(next[r.dataset]).success;
  });
  return left.length > 0;
}

/** Seeds every place the game keeps copies, in the database, before the game starts. */
function seedItems(db: Db, b: Base, plan: ItemPlan, batch: number) {
  const ins = (sql: string, ...args: (string | number | null)[]) => db.query(sql).run(...args);
  const c = b.chars;
  let n = 0;
  const id = () => 700000 + batch * 1000 + n++;
  const contents = () => [plan.fillers[0], plan.fillers[1]];
  const box = (name: string) => {
    contents().forEach((item, i) => {
      ins("INSERT INTO container_items (name, position, item) VALUES (?, ?, ?)", name, i + 1, item);
    });
    return name;
  };
  const bag = new Map<string, number>();
  const bagLine = (who: { id: string }, item: string, qty: number) => {
    const slot = (bag.get(who.id) ?? 0) + 1;
    if (slot > 15) {
      return;
    }
    bag.set(who.id, slot);
    ins(
      "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
      `sw-${who.id}-${slot}`,
      who.id,
      slot,
      item,
      qty,
    );
  };
  const vault = new Map<string, number>();
  const vaultLine = (who: { id: string }, item: string) => {
    const pos = (vault.get(who.id) ?? 0) + 1;
    vault.set(who.id, pos);
    ins(
      "INSERT INTO vault_items (character_id, position, item) VALUES (?, ?, ?)",
      who.id,
      pos,
      item,
    );
  };
  let g = 0;
  const ground = (map: string, item: string, qty: number) => {
    g += 1;
    ins(
      "INSERT INTO ground_items (id, map_id, x, y, item, qty, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, 'drop', ?)",
      `sw-g${g}`,
      map,
      1 + (g % 17),
      1 + (Math.floor(g / 17) % 12),
      item,
      qty,
      ISO,
    );
  };
  const boxLines: string[] = [];
  const shopLines: string[] = ["BIO|My shop"];
  const ledger: { line: number; item: string; price: number; stock: number }[] = [];
  const saleLines: string[] = [];
  plan.items.forEach((item, i) => {
    const storage = isUniqueContainer(item);
    const crystal = lingoContains(item, " Crystals");
    // Bags: online and offline; a container carries its storage.
    bagLine(c.al, storage ? box(`${item}#${id()}`) : item, crystal ? 7 : 2);
    bagLine(c.bo, storage ? box(`${item}#${id()}`) : item, 3);
    if (!storage && !crystal) {
      bagLine(c.cy, `${item}+2`, 1); // a masterwork level
    }
    // Worn gear, online and offline.
    if (!storage) {
      ins(
        "INSERT INTO equipment (character_id, slot, item) VALUES (?, ?, ?)",
        (i < 6 ? c.al : c.cy).id,
        SLOTS[i % 6] as string,
        item,
      );
      ins(
        "INSERT INTO equipment (character_id, slot, item) VALUES (?, ?, ?)",
        (i < 6 ? c.bo : c.di).id,
        SLOTS[i % 6] as string,
        item,
      );
    }
    // Vaults.
    vaultLine(c.al, storage ? box(`${item}#${id()}`) : item);
    vaultLine(c.bo, storage ? box(`${item}#${id()}`) : item);
    // A container's lines.
    boxLines.push(storage ? box(`${item}#${id()}`) : item);
    // The ground, loaded and not: counted piles, crystal piles, containers.
    for (const map of [b.near, b.far]) {
      if (storage) {
        ground(map, box(`${item}#${id()}`), 1);
        ground(map, item, 1);
      } else if (crystal) {
        ground(map, `5 ${item}`, 1);
        ground(map, item, 2);
      } else {
        ground(map, item, 3);
        ground(map, item, 1);
      }
    }
    // The player shop's stock (its saved ledger has sold one of every other line) and buy lines.
    shopLines.push(`SEL|${item}:${20 + i}:4`);
    if (i % 2 === 0) {
      ledger.push({ line: shopLines.length, item, price: 20 + i, stock: 3 });
    }
    if (i % 3 === 0) {
      shopLines.push(`BUY|${item}:5`);
    }
    saleLines.push(`SEL|${item}:${10 + i}:5`);
  });
  // Bystanders: items whose names are like the removed ones', which must be left alone.
  plan.bystanders.forEach((item) => {
    bagLine(c.di, item, 2);
    boxLines.push(item);
    ground(b.far, item, 2);
    ground(b.near, item, 1);
  });
  for (const [i, item] of boxLines.entries()) {
    ins(
      "INSERT INTO container_items (name, position, item) VALUES (?, ?, ?)",
      "SweepBox#1",
      i + 1,
      item,
    );
  }
  ins(
    "INSERT INTO player_shops (npc, owner_id, interior, created_at) VALUES ('Zorbu', ?, 'xH1000yH992', ?)",
    c.bo.id,
    ISO,
  );
  ins(
    "INSERT INTO npc_files (npc, text, saved_by, updated_at) VALUES ('Zorbu', ?, 'acc', ?)",
    shopLines.join("\r"),
    ISO,
  );
  ins("INSERT INTO npc_shops (npc, gold, updated_at) VALUES ('Zorbu', 40, ?)", ISO);
  for (const l of ledger) {
    ins(
      "INSERT INTO npc_shop_lines (npc, line, kind, item, price, stock) VALUES ('Zorbu', ?, 'SEL', ?, ?, ?)",
      l.line,
      l.item,
      l.price,
      l.stock,
    );
  }
  // An NPC Editor save that sells every one.
  const own = b.classic.npcFiles.files.find((f) => lingoEq(f.name, plan.npc));
  ins(
    "INSERT INTO npc_files (npc, text, saved_by, updated_at) VALUES (?, ?, 'acc', ?)",
    plan.npc,
    [own?.text ?? "BIO|Hello", ...saleLines].join("\r"),
    ISO,
  );
  // Quest lines that want and reward each.
  db.query("DELETE FROM quests").run();
  plan.items.forEach((item, i) => {
    ins(
      "INSERT INTO quests (line, text) VALUES (?, ?)",
      2 * i + 1,
      `${plan.questNpc}:${item}:${plan.fillers[0]}`,
    );
    ins(
      "INSERT INTO quests (line, text) VALUES (?, ?)",
      2 * i + 2,
      `${plan.questNpc}:${plan.fillers[1]}:${item}`,
    );
  });
  for (let line = plan.items.length * 2 + 1; line <= 40; line++) {
    ins(
      "INSERT INTO quests (line, text) VALUES (?, ?)",
      line,
      `${plan.questNpc}:${plan.fillers[0]}:${plan.fillers[1]}`,
    );
  }
}

interface ItemCase {
  name: string;
  plan: ItemPlan;
  batch: number;
  content: ContentMode;
  copies: CopiesMode;
  refused: boolean;
  refund: number;
  rollback: boolean;
}

/** The seeded world of a plan, made once and copied for each of its cases. */
const seeded = new Map<string, Uint8Array>();
function seededBytes(b: Base, plan: ItemPlan, batch: number): Uint8Array {
  const k = `${batch}:${plan.items.join("|")}`;
  let bytes = seeded.get(k);
  if (!bytes) {
    const db = Database.deserialize(b.bytes, { strict: true }) as unknown as Db;
    db.run("PRAGMA foreign_keys = ON;");
    seedItems(db, b, plan, batch);
    bytes = db.serialize();
    db.close();
    seeded.clear();
    seeded.set(k, bytes);
  }
  return bytes;
}

function runItemCase(b: Base, k: ItemCase) {
  cases += 1;
  const { db, service, game, sent } = startGame(seededBytes(b, k.plan, k.batch), b);
  const cw = game.contentWorld;
  const R = new Set(k.plan.items.map((i) => i.toLowerCase()));
  const reps = new Map(
    Object.entries(k.plan.rep).map(([a, z]) => [a.toLowerCase(), z.toLowerCase()]),
  );
  const repOf = (key: string) => reps.get(key.toLowerCase()) ?? "";
  const before = census(game, db);
  const contentBefore = service.problems(cw).content.map((p) => `${p.where}|${p.message}`);
  const worldBefore = cw.problems();
  if (worldBefore.length > 0) {
    fail(k.name, "the seeded world already has problems", worldBefore);
  }
  // Mining first, as an operator would, when crystals go.
  const mining = recoloured(b.classic, k.plan.items);
  if (mining) {
    const r = service.draftSet(
      ACTOR(b),
      { dataset: "gather", part: "gathering", key: null },
      "set",
      mining,
    );
    if (!r.ok) {
      fail(k.name, "recolouring mining was refused", r.error);
      return;
    }
  }
  // Draft every removal.
  for (const item of k.plan.items) {
    const removal: Removal = {
      kind: "item",
      key: item,
      content: k.content,
      copies: k.copies,
      replacement:
        k.content === "replace" || k.copies === "replace" ? (k.plan.rep[item] ?? null) : null,
      refundGold: k.copies === "purge" ? k.refund : 0,
    };
    const r = service.draftRemoval(ACTOR(b), removal, cw);
    if (!r.ok) {
      fail(
        `${k.name} [${item}]`,
        "draftRemoval refused",
        `${r.error} ${JSON.stringify(r.problems ?? [])}`,
      );
      return;
    }
  }
  const draftProblems = schemaProblems(service.draftContent());
  if (draftProblems.length > 0) {
    fail(k.name, "a draft dataset fails its schema", draftProblems);
  }
  const checked = service.check();
  if (k.refused) {
    refusedCases += 1;
    if (checked.length === 0) {
      fail(k.name, "a removal that leaves references passed its checks");
    }
    const quiet = dump(db);
    const sentBefore = sent.length;
    const pub = service.publish(ACTOR(b), service.draftRev(), "", cw);
    if (pub.ok) {
      fail(k.name, "a removal that leaves references was published");
      return;
    }
    if (dump(db) !== quiet) {
      fail(k.name, "a refused publish wrote to the database");
    }
    if (sent.length !== sentBefore) {
      fail(k.name, "a refused publish told clients something");
    }
    const after = census(game, db);
    if (JSON.stringify(sortCopies(after.copies)) !== JSON.stringify(sortCopies(before.copies))) {
      fail(k.name, "a refused publish changed the world");
    }
    return;
  }
  if (checked.length > 0) {
    fail(k.name, "the checks refused a removal whose cleanup left nothing", checked.slice(0, 6));
    return;
  }
  // A publish that fails after the world cleanup changes nothing, in memory or the database, and
  // tells nobody anything; the same draft then publishes.
  if (k.rollback) {
    const quiet = dump(db);
    const hash = content().hash;
    const rev = service.draftRev();
    const sentBefore = sent.length;
    let threw = false;
    try {
      service.publish(ACTOR(b), rev, "", failingWorld(cw));
    } catch {
      threw = true;
    }
    if (!threw) {
      fail(k.name, "rollback: the failing publish did not throw");
    }
    const now = census(game, db);
    for (const [what, a, z] of [
      ["copies", sortCopies(before.copies), sortCopies(now.copies)],
      ["roster slots", before.slots, now.slots],
      ["gold", before.gold, now.gold],
      ["quest lines", before.quests, now.quests],
      ["containers", before.containers, now.containers],
      ["NPC Editor saves", before.saves, now.saves],
    ] as const) {
      if (JSON.stringify(a) !== JSON.stringify(z)) {
        fail(k.name, `rollback: ${what} changed in memory`, diff(a, z));
      }
    }
    const loud = dump(db);
    if (loud !== quiet) {
      fail(k.name, "rollback: the database changed", firstDiff(quiet, loud));
    }
    if (content().hash !== hash || service.draftRev() !== rev) {
      fail(k.name, "rollback: the store or the draft changed");
    }
    if (sent.length !== sentBefore) {
      fail(
        k.name,
        "rollback: clients were told something",
        sent.slice(sentBefore).map((s) => s.msg.t),
      );
    }
  }
  const pub = service.publish(ACTOR(b), service.draftRev(), "", cw);
  if (!pub.ok) {
    fail(
      k.name,
      "publish refused",
      `${pub.error} ${JSON.stringify(pub.problems ?? []).slice(0, 400)}`,
    );
    return;
  }
  published += 1;
  const after0 = service.publishedContent();
  const schema = schemaProblems(after0);
  if (schema.length > 0) {
    fail(k.name, "a published dataset fails its schema", schema);
  }
  const worldAfter = cw.problems();
  if (worldAfter.length > 0) {
    fail(k.name, "unresolved references left in the world", worldAfter);
  }
  const contentAfter = service.problems(cw).content.map((p) => `${p.where}|${p.message}`);
  const grown = multisetMinus(contentAfter, contentBefore);
  if (grown.length > 0) {
    fail(k.name, "content problems grew beyond Classic's own", grown);
  }
  // The entries themselves.
  const saves = Object.entries(census(game, db).saves).map(([npc, text]) => ({ npc, text }));
  for (const item of k.plan.items) {
    const now = content().item(item);
    if (k.copies === "retire") {
      if (now?.retired !== true) {
        fail(`${k.name} [${item}]`, "a retired item is not marked retired", now ?? "gone");
      }
      const still = usesOf(
        withNpcSaves(after0, saves),
        "item",
        item,
        spellingsOf(after0, "item", item),
      );
      if (still.length > 0) {
        fail(
          `${k.name} [${item}]`,
          "content can still make a retired item",
          still.map((u) => u.where),
        );
      }
    } else if (now !== undefined) {
      fail(`${k.name} [${item}]`, "a purged or replaced item is still in content");
    }
  }
  const after = census(game, db);
  // Copies conserved.
  const want = new Map<string, number>();
  const lostBoxes = new Set<string>();
  if (k.copies === "purge") {
    for (const c of before.copies) {
      if (R.has(keyOf(c.stored).key) && c.stored.includes("#")) {
        lostBoxes.add(c.stored);
      }
    }
  }
  const owed: Record<string, number> = {};
  for (const c of before.copies) {
    const { key, n } = keyOf(c.stored);
    if (c.place === "container" && lostBoxes.has(c.holder)) {
      continue;
    }
    let to = key;
    if (R.has(key)) {
      if (k.copies === "purge") {
        if (c.place === "bag" || c.place === "worn" || c.place === "vault") {
          owed[c.holder] = (owed[c.holder] ?? 0) + c.qty;
        }
        continue;
      }
      if (k.copies === "replace") {
        to = repOf(key);
      }
    }
    const kk = `${c.place}|${c.place === "container" ? "*" : c.holder}|${to}`;
    want.set(kk, (want.get(kk) ?? 0) + c.qty * n);
  }
  const got = totals(after.copies);
  const keys = new Set([...want.keys(), ...got.keys()]);
  const off: string[] = [];
  for (const kk of keys) {
    if ((want.get(kk) ?? 0) !== (got.get(kk) ?? 0)) {
      off.push(`${kk}: want ${want.get(kk) ?? 0}, got ${got.get(kk) ?? 0}`);
    }
  }
  if (off.length > 0) {
    fail(k.name, `copies not conserved (${k.copies})`, off.slice(0, 12).join("; "));
  }
  // Purge refunds: copies x refund, for what characters held.
  if (k.copies === "purge") {
    for (const [who, gold] of Object.entries(after.gold)) {
      const wantGold = (before.gold[who] ?? 0) + (owed[who] ?? 0) * k.refund;
      if (gold !== wantGold) {
        fail(k.name, `refund to ${who}`, `want ${wantGold}, got ${gold}`);
      }
    }
  } else if (JSON.stringify(after.gold) !== JSON.stringify(before.gold)) {
    fail(k.name, "gold changed without a purge", diff(before.gold, after.gold));
  }
  // Container storage: a purged container's storage is gone; a replaced one's moved intact.
  for (const c of before.copies) {
    if (!c.stored.includes("#") || !R.has(keyOf(c.stored).key)) {
      continue;
    }
    const was = before.containers[c.stored];
    if (k.copies === "retire") {
      if (JSON.stringify(after.containers[c.stored]) !== JSON.stringify(was)) {
        fail(k.name, "a retired container's storage changed", c.stored);
      }
      continue;
    }
    if (after.containers[c.stored] !== undefined) {
      fail(
        k.name,
        `a ${k.copies}d container's old storage is still there`,
        `${c.stored} in ${c.place}`,
      );
    }
    if (k.copies === "replace") {
      const moved = after.copies.filter(
        (x) =>
          x.place === c.place &&
          x.holder === c.holder &&
          x.stored.includes("#") &&
          keyOf(x.stored).key === repOf(keyOf(c.stored).key) &&
          !before.copies.some((y) => y.stored === x.stored),
      );
      const intact = moved.some(
        (x) => JSON.stringify(after.containers[x.stored] ?? []) === JSON.stringify(was ?? []),
      );
      if (was !== undefined && !intact) {
        fail(
          k.name,
          "a replaced container's storage did not move intact",
          `${c.stored} in ${c.place} of ${c.holder}: was ${JSON.stringify(was)}, now ${JSON.stringify(moved.map((x) => [x.stored, after.containers[x.stored]]))}`,
        );
      }
    }
  }
  // No container storage is left that nothing holds (other than the seeded box).
  const held = new Set(after.copies.map((x) => x.stored));
  for (const name of Object.keys(after.containers)) {
    if (name !== "SweepBox#1" && !held.has(name)) {
      fail(
        k.name,
        "container storage nothing holds",
        `${name}: ${JSON.stringify(after.containers[name])}`,
      );
    }
  }
  // Quest lines: none names a removed item.
  after.quests.forEach((line, i) => {
    const [, wants = "", reward = ""] = line.split(":");
    for (const f of [wants, reward]) {
      if (f.trim() !== "" && R.has(keyOf(f.trim()).key)) {
        fail(k.name, `quest line ${i + 1} still names a removed item`, line);
      }
    }
    if (k.copies === "replace") {
      const [, w0 = "", r0 = ""] = (before.quests[i] ?? "").split(":");
      for (const [was, now] of [
        [w0, wants],
        [r0, reward],
      ] as const) {
        if (
          R.has(keyOf(was.trim()).key) &&
          keyOf(now.trim()).key !== repOf(keyOf(was.trim()).key)
        ) {
          fail(
            k.name,
            `quest line ${i + 1} does not name the replacement`,
            `${before.quests[i]} -> ${line}`,
          );
        }
      }
    }
  });
  // The ledger check finds nothing unlogged.
  if (!game.tick()) {
    fail(k.name, "the tick after the publish threw");
  }
  const unlogged = db
    .query<{ character_id: string; item: string | null; qty: number }, []>(
      "SELECT character_id, item, qty FROM activity_log WHERE type = 'unlogged'",
    )
    .all();
  if (unlogged.length > 0) {
    fail(k.name, "unlogged activity after the publish", unlogged);
  }
  // Memory matches the database: a second game on the same database sees the same world.
  compareWithReload(k.name, b, game, db);
}

function compareWithReload(name: string, b: Base, game: Game, db: Db) {
  game.saveAll();
  const a = census(game, db);
  const other = createGame({
    db,
    content: newService(db),
    send: () => {},
    isoNow: () => ISO,
    rng: seededRng(SEED),
  });
  for (const c of [b.chars.al, b.chars.cy]) {
    other.enter(c.id, false, "10.0.0.8");
  }
  const z = census(other, db);
  for (const [what, x, y] of [
    ["copies", sortCopies(a.copies), sortCopies(z.copies)],
    [
      "roster slots",
      a.slots.map((s) => [s.map, s.slot, s.species]),
      z.slots.map((s) => [s.map, s.slot, s.species]),
    ],
    [
      "live monsters",
      a.slots.map((s) => [s.map, s.slot, s.live]),
      z.slots.map((s) => [s.map, s.slot, s.live]),
    ],
    ["gold", a.gold, z.gold],
    ["quest lines", a.quests, z.quests],
    ["containers", a.containers, z.containers],
  ] as const) {
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      fail(name, `memory and the database differ: ${what}`, diff(x, y));
    }
  }
}

function multisetMinus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const x of b) {
    left.set(x, (left.get(x) ?? 0) + 1);
  }
  return a.filter((x) => {
    const n = left.get(x) ?? 0;
    left.set(x, n - 1);
    return n <= 0;
  });
}

function diff(a: unknown, z: unknown): string {
  if (Array.isArray(a) && Array.isArray(z)) {
    const as = a.map((x) => JSON.stringify(x));
    const zs = z.map((x) => JSON.stringify(x));
    return `only before: ${multisetMinus(as, zs).slice(0, 6).join(", ")} | only after: ${multisetMinus(zs, as).slice(0, 6).join(", ")}`;
  }
  return `${JSON.stringify(a).slice(0, 300)} -> ${JSON.stringify(z).slice(0, 300)}`;
}

function firstDiff(a: string, z: string): string {
  const al = a.split("\n");
  const zl = z.split("\n");
  const only = multisetMinus(al, zl).slice(0, 3);
  const added = multisetMinus(zl, al).slice(0, 3);
  return `removed ${JSON.stringify(only)} added ${JSON.stringify(added)}`.slice(0, 600);
}

// ---- monsters ------------------------------------------------------------------------------------

interface MonsterCase {
  name: string;
  monsters: string[];
  rep: Record<string, string>;
  batch: number;
  spawns: "remove" | "replace";
  live: "despawn" | "leave";
  npcFile: "delete" | "keep";
  content: ContentMode;
  refused: boolean;
}

function monsterLeaves(
  data: ContentData,
  key: string,
  mode: ContentMode,
  rep: string,
  npcFile: string,
) {
  if (mode === "leave") {
    return usesOf(data, "monster", key).some((u) => u.kind !== "npc");
  }
  const own = npcFile === "delete" ? [{ dataset: "npcFiles" as const, part: "files", key }] : [];
  const { left } = cleanUses(data, usesOf(data, "monster", key), mode, rep, own, (r, value) => {
    const next = applyRows(data, [{ ...r, op: "set", data: value }]);
    return DATASET_SCHEMAS[r.dataset].safeParse(next[r.dataset]).success;
  });
  return left.some((u) => u.kind !== "npc");
}

function seedMonsters(db: Db, b: Base, monsters: readonly string[]) {
  for (const map of [b.near, b.far]) {
    db.query("DELETE FROM map_slots WHERE map_id = ?").run(map);
    monsters.forEach((m, i) => {
      db.query(
        "INSERT INTO map_slots (map_id, slot, species, live_name, hp, x, y, facing, updated_at, home_x, home_y) VALUES (?, ?, ?, ?, 5, ?, 4, 'S', ?, ?, 4)",
      ).run(map, i + 1, m, m, 3 + i * 2, ISO, 3 + i * 2);
    });
  }
  for (const m of monsters) {
    db.query(
      "INSERT OR REPLACE INTO npc_files (npc, text, saved_by, updated_at) VALUES (?, ?, 'acc', ?)",
    ).run(m, b.classic.npcFiles.files.find((f) => lingoEq(f.name, m))?.text ?? "BIO|Hello", ISO);
  }
}

function runMonsterCase(b: Base, k: MonsterCase) {
  cases += 1;
  const db0 = Database.deserialize(b.bytes, { strict: true }) as unknown as Db;
  seedMonsters(db0, b, k.monsters);
  const bytes = db0.serialize();
  db0.close();
  const { db, service, game } = startGame(bytes, b);
  const cw = game.contentWorld;
  const R = new Set(k.monsters.map((m) => m.toLowerCase()));
  const before = census(game, db);
  const contentBefore = service.problems(cw).content.map((p) => `${p.where}|${p.message}`);
  for (const m of k.monsters) {
    const r = service.draftRemoval(
      ACTOR(b),
      {
        kind: "monster",
        key: m,
        content: k.content,
        spawns: k.spawns,
        live: k.live,
        npcFile: k.npcFile,
        replacement: k.spawns === "replace" || k.content === "replace" ? (k.rep[m] ?? null) : null,
      },
      cw,
    );
    if (!r.ok) {
      fail(
        `${k.name} [${m}]`,
        "draftRemoval refused",
        `${r.error} ${JSON.stringify(r.problems ?? [])}`,
      );
      return;
    }
  }
  const checked = service.check();
  if (k.refused) {
    refusedCases += 1;
    if (checked.length === 0) {
      fail(k.name, "a removal that leaves references passed its checks");
    }
    const quiet = dump(db);
    if (service.publish(ACTOR(b), service.draftRev(), "", cw).ok) {
      fail(k.name, "a removal that leaves references was published");
    } else if (dump(db) !== quiet) {
      fail(k.name, "a refused publish wrote to the database");
    }
    return;
  }
  if (checked.length > 0) {
    fail(k.name, "the checks refused a removal whose cleanup left nothing", checked.slice(0, 6));
    return;
  }
  // A failing publish first: nothing changes.
  {
    const quiet = dump(db);
    let threw = false;
    try {
      service.publish(ACTOR(b), service.draftRev(), "", failingWorld(cw));
    } catch {
      threw = true;
    }
    const now = census(game, db);
    if (
      !threw ||
      JSON.stringify(now.slots) !== JSON.stringify(before.slots) ||
      dump(db) !== quiet
    ) {
      fail(k.name, "rollback: a failed publish changed the roster", diff(before.slots, now.slots));
    }
  }
  const pub = service.publish(ACTOR(b), service.draftRev(), "", cw);
  if (!pub.ok) {
    fail(
      k.name,
      "publish refused",
      `${pub.error} ${JSON.stringify(pub.problems ?? []).slice(0, 400)}`,
    );
    return;
  }
  published += 1;
  const after0 = service.publishedContent();
  if (schemaProblems(after0).length > 0) {
    fail(k.name, "a published dataset fails its schema", schemaProblems(after0));
  }
  const worldAfter = cw.problems();
  if (worldAfter.length > 0) {
    fail(k.name, "unresolved references left in the world", worldAfter);
  }
  const grown = multisetMinus(
    service.problems(cw).content.map((p) => `${p.where}|${p.message}`),
    contentBefore,
  );
  if (grown.length > 0) {
    fail(k.name, "content problems grew beyond Classic's own", grown);
  }
  const after = census(game, db);
  after.slots.forEach((s, i) => {
    const was = before.slots[i];
    if (!was || was.map !== s.map || was.slot !== s.slot) {
      fail(k.name, "the roster changed shape");
      return;
    }
    const wasKey = (was.species ?? "").toLowerCase();
    if (R.has(wasKey)) {
      const want =
        k.spawns === "replace"
          ? (k.rep[k.monsters.find((m) => m.toLowerCase() === wasKey) ?? ""] ?? null)
          : null;
      if (s.species !== want) {
        fail(
          k.name,
          `roster slot ${s.map}/${s.slot}`,
          `${was.species} -> ${s.species}, want ${want}`,
        );
      }
    } else if (s.species !== was.species) {
      fail(
        k.name,
        `an unrelated roster slot changed ${s.map}/${s.slot}`,
        `${was.species} -> ${s.species}`,
      );
    }
    const liveKey = (was.live ?? "").toLowerCase();
    if (R.has(liveKey)) {
      const want = k.live === "despawn" ? null : was.live;
      if (s.live !== want) {
        fail(k.name, `live monster ${s.map}/${s.slot}`, `${was.live} -> ${s.live}, want ${want}`);
      }
    }
  });
  for (const m of k.monsters) {
    if (content().monster(m)) {
      fail(`${k.name} [${m}]`, "a removed monster is still in content");
    }
    const hasSave = Object.keys(after.saves).some((n) => lingoEq(n, m));
    const hasRow = after0.npcFiles.files.some((f) => lingoEq(f.name, m));
    if (k.npcFile === "delete" && (hasSave || hasRow)) {
      fail(`${k.name} [${m}]`, "a deleted NPC file is still there", { hasSave, hasRow });
    }
    if (k.npcFile === "keep" && !hasSave) {
      fail(`${k.name} [${m}]`, "a kept NPC Editor save went");
    }
  }
  for (let i = 0; i < 5; i++) {
    if (!game.tick()) {
      fail(k.name, "a tick after the publish threw");
      break;
    }
  }
  compareWithReload(k.name, b, game, db);
}

// ---- planning ------------------------------------------------------------------------------------

function itemCases(b: Base): ItemCase[] {
  const rnd = picker(SEED);
  const data = b.classic;
  const all = data.items.items.filter((i) => !i.retired).map((i) => i.name);
  for (const n of all) {
    CATALOGUE.add(n.toLowerCase());
  }
  const npc =
    data.npcFiles.files.find((f) => /^SEL\|/m.test(f.text.replace(/\r/g, "\n")))?.name ?? "Agavar";
  const questNpc = data.quests.pools.npcs[0]?.npc as string;
  // The sample always holds a storage item, whose copies carry storage of their own.
  const sample = rnd.shuffle(all.filter((x) => !isUniqueContainer(x))).slice(0, 2 * ITEM_BATCH - 1);
  const chosen = FULL ? all : [...sample, rnd.pick(all.filter((x) => isUniqueContainer(x)))];
  // Each item's replacement: a storage item for a storage item, never one being removed with it.
  const out: ItemCase[] = [];
  let batchNo = 0;
  for (const content of ["remove", "replace", "leave"] as const) {
    const order = rnd.shuffle(chosen);
    const rep: Record<string, string> = {};
    // The replacement is picked from items outside the item's batch, so it is picked per batch.
    const groups: { ok: boolean; items: string[] }[] = [];
    const pending = { ok: [] as string[], refused: [] as string[] };
    for (const item of order) {
      pending.ok.push(item);
    }
    // Batches: storage items spread out, so each has storage replacements left over.
    const batches: string[][] = [];
    for (let i = 0; i < pending.ok.length; i += ITEM_BATCH) {
      batches.push(pending.ok.slice(i, i + ITEM_BATCH));
    }
    for (const items of batches) {
      const inBatch = new Set(items.map((x) => x.toLowerCase()));
      for (const item of items) {
        const storage = isUniqueContainer(item);
        const choices = all.filter(
          (x) => !inBatch.has(x.toLowerCase()) && isUniqueContainer(x) === storage,
        );
        rep[item] = rnd.pick(choices);
      }
      const mined = withGathering(data, recoloured(data, items));
      const ok = items.filter((i) => !leavesReferences(mined, i, content, rep[i] as string));
      const refused = items.filter((i) => !ok.includes(i));
      if (ok.length > 0) {
        groups.push({ ok: true, items: ok });
      }
      if (refused.length > 0) {
        groups.push({ ok: false, items: refused });
      }
    }
    for (const g of groups) {
      batchNo += 1;
      const inBatch = new Set(g.items.map((x) => x.toLowerCase()));
      const reps = new Set(g.items.map((i) => (rep[i] as string).toLowerCase()));
      const free = all.filter(
        (x) => !inBatch.has(x.toLowerCase()) && !reps.has(x.toLowerCase()) && !isUniqueContainer(x),
      );
      const fillers: [string, string] = [rnd.pick(free), rnd.pick(free)];
      const bystanders = all
        .filter((x) => !inBatch.has(x.toLowerCase()))
        .filter((x) =>
          g.items.some((i) => {
            const a = x.toLowerCase();
            const z = i.toLowerCase();
            return a.includes(z) || z.includes(a);
          }),
        )
        .slice(0, 12);
      const plan: ItemPlan = {
        items: g.items,
        rep: Object.fromEntries(g.items.map((i) => [i, rep[i] as string])),
        fillers,
        bystanders,
        npc,
        questNpc,
      };
      for (const copies of ["retire", "purge", "replace"] as const) {
        out.push({
          name: `items#${batchNo} content=${content} copies=${copies}${g.ok ? "" : " (refused)"} [${g.items.join(", ")}]`,
          plan,
          batch: batchNo,
          content,
          copies,
          refused: !g.ok,
          refund: 1 + rnd.int(50),
          rollback: g.ok,
        });
      }
    }
  }
  return out;
}

function monsterCases(b: Base): MonsterCase[] {
  const rnd = picker(SEED + 1);
  const data = b.classic;
  const all = data.monsters.monsters.map((m) => m.name);
  const chosen = FULL ? rnd.shuffle(all) : rnd.shuffle(all).slice(0, MONSTER_BATCH);
  const out: MonsterCase[] = [];
  let batchNo = 0;
  for (let i = 0; i < chosen.length; i += MONSTER_BATCH) {
    const group = chosen.slice(i, i + MONSTER_BATCH);
    const inBatch = new Set(group.map((m) => m.toLowerCase()));
    const rep = Object.fromEntries(
      group.map((m) => [m, rnd.pick(all.filter((x) => !inBatch.has(x.toLowerCase())))]),
    );
    for (const spawns of ["remove", "replace"] as const) {
      for (const live of ["despawn", "leave"] as const) {
        for (const npcFile of ["delete", "keep"] as const) {
          const content: ContentMode = spawns === "replace" ? "replace" : "remove";
          const ok = group.filter(
            (m) => !monsterLeaves(data, m, content, rep[m] as string, npcFile),
          );
          const refused = group.filter((m) => !ok.includes(m));
          for (const [monsters, isRefused] of [
            [ok, false],
            [refused, true],
          ] as const) {
            if (monsters.length === 0) {
              continue;
            }
            batchNo += 1;
            out.push({
              name: `monsters#${batchNo} spawns=${spawns} live=${live} npcFile=${npcFile} content=${content}${isRefused ? " (refused)" : ""} [${monsters.join(", ")}]`,
              monsters,
              rep,
              batch: batchNo,
              spawns,
              live,
              npcFile,
              content,
              refused: isRefused,
            });
          }
        }
      }
    }
  }
  return out;
}

// ---- the sweep -----------------------------------------------------------------------------------

describe("the removal sweep", () => {
  test(
    `every ${FULL ? "" : "sampled "}Classic item and monster, with every cleanup option, keeps the invariants`,
    async () => {
      const started = performance.now();
      const b = await base();
      const items = itemCases(b);
      const monsters = monsterCases(b);
      for (const k of items) {
        try {
          runItemCase(b, k);
        } catch (e) {
          fail(k.name, "threw", e instanceof Error ? (e.stack ?? e.message) : String(e));
        }
      }
      for (const k of monsters) {
        try {
          runMonsterCase(b, k);
        } catch (e) {
          fail(k.name, "threw", e instanceof Error ? (e.stack ?? e.message) : String(e));
        }
      }
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      console.log(
        `removal sweep (seed ${SEED}): ${cases} cases (${items.length} item, ${monsters.length} monster; ${published} published, ${refusedCases} correctly refused) in ${secs}s, ${failures.length} failures`,
      );
      for (const f of failures) {
        console.log(`FAIL ${f}`);
      }
      expect(failures, failures.slice(0, 40).join("\n")).toEqual([]);
    },
    FULL ? 3_600_000 : 120_000,
  );
});
