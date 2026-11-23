/**
 * The seeded whole-server replay (issue #37's safety net): a real game (`createGame`) on an
 * in-memory database with the Classic pack, a seeded `Rng`, an injected clock and scripted players
 * who walk, fight, cast, gather, craft, trade, use items, open containers, sail, die and respawn.
 * The world state is flattened to `path = value` lines and hashed every tick, so two runs can be
 * compared tick by tick and a divergence read as a line diff of the two states.
 *
 * Bun's `randomUUIDv7` is swapped for a counter while the replay runs: ids are not behaviour, but
 * they sit in the state the replay hashes. Password hashing is swapped for a plain prefix, which
 * only saves time.
 */
import { createHash } from "node:crypto";

import {
  type Facing,
  type InGameMsg,
  MAP_HEIGHT,
  MAP_WIDTH,
  type ServerMsg,
  skillIndex,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../../src/game.ts";
import { saveContainer } from "../../src/persistence/containers.ts";
import { type Db, openDatabase } from "../../src/persistence/database.ts";
import { insertGround } from "../../src/persistence/ground.ts";
import { findMapByCoords } from "../../src/persistence/maps.ts";
import { migrate } from "../../src/persistence/migrations.ts";
import { saveSlots } from "../../src/persistence/monsters.ts";
import { seededRng } from "../../src/rng.ts";
import type { Player } from "../../src/systems/world/world.ts";

export const REPLAY_SEED = 37;
export const REPLAY_TICKS = 4000;
/** A component breakdown is recorded this often. */
export const REPLAY_CHECKPOINT = 100;
/** The clock starts here and moves one tick (50 ms) per tick. */
const T0 = Date.parse("2026-11-22T00:00:00.000Z");
const TICK_MS = 50;

// ---- the map ------------------------------------------------------------------------------

/**
 * The start map, x1000y992, laid out for the scripted players (x 1-17, y 1-12):
 *
 * - layer 1: grass (G1), with sea (W1) in columns 14-17;
 * - layer 2: trees (S3) at x 2, y 2-4; rocks (B8) at x 2, y 6-7; farmland (TL) at x 2, y 10-11.
 */
function layers(): [string[], string[], string[], string[]] {
  const grid = (f: (x: number, y: number) => string) =>
    Array.from({ length: MAP_HEIGHT }, (_, y) =>
      Array.from({ length: MAP_WIDTH }, (_, x) => f(x + 1, y + 1)).join(" "),
    );
  return [
    grid((x) => (x >= 14 ? "W1" : "G1")),
    grid((x, y) => {
      if (x === 2 && y >= 2 && y <= 4) {
        return "S3";
      }
      if (x === 2 && (y === 6 || y === 7)) {
        return "B8";
      }
      if (x === 2 && (y === 10 || y === 11)) {
        return "TL";
      }
      return "G3";
    }),
    grid(() => "G3"),
    grid(() => "5A"),
  ];
}

/** Fixtures on the ground: the crafting stations and a crate. */
const GROUND: { item: string; x: number; y: number }[] = [
  { item: "Stove", x: 8, y: 2 },
  { item: "Anvil", x: 10, y: 2 },
  { item: "Carpentry Bench", x: 12, y: 2 },
  { item: "Alchemy Lab", x: 8, y: 6 },
  { item: "Crate#1", x: 10, y: 6 },
];

/** The roster: a shopkeeper, an Orc to fight and a Wolf by the victim. */
const SLOTS = [
  { slot: 1, species: "Agavar", x: 5, y: 9 },
  { slot: 2, species: "Orc", x: 11, y: 10 },
  { slot: 3, species: "Wolf", x: 12, y: 12 },
];

// ---- the players --------------------------------------------------------------------------

interface BotCtx {
  game: Game;
  /** The last message of each type the game sent this player. */
  last: Map<string, ServerMsg>;
}

interface BotSpec {
  name: string;
  at: { x: number; y: number; facing: Facing };
  bag?: [string, number][];
  equip?: Partial<Player["char"]["equip"]>;
  skills?: Record<string, number>;
  gold?: number;
  hp?: number;
  spells?: string[];
  hunger?: number;
  /** The intents to send at tick `t`. */
  script(t: number, p: Player, c: BotCtx): InGameMsg[];
}

const hold = (held: boolean): InGameMsg => ({ t: "attack", seq: 1, held });
const walk = (held: "L" | "R" | "U" | "D" | null): InGameMsg => ({
  t: "move",
  seq: 1,
  held,
  turn: false,
});
/** Holds attack from tick `from`, releasing it at `to`. */
const swingBetween = (t: number, from: number, to: number): InGameMsg[] =>
  t === from ? [hold(true)] : t === to ? [hold(false)] : [];
/** Every `n` ticks from `from`. */
const every = (t: number, from: number, n: number) => t >= from && (t - from) % n === 0;

/** The way to step to reach a tile beside `to`, or null when already beside it. */
function toward(p: Player, to: { x: number; y: number }): "L" | "R" | "U" | "D" | null {
  const dx = to.x - p.x;
  const dy = to.y - p.y;
  if (Math.abs(dx) + Math.abs(dy) <= 1) {
    return null;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "R" : "L";
  }
  return dy > 0 ? "D" : "U";
}

/** The way that faces `to` from beside it. */
function facingTo(p: Player, to: { x: number; y: number }): "L" | "R" | "U" | "D" {
  const dx = to.x - p.x;
  const dy = to.y - p.y;
  if (dx !== 0) {
    return dx > 0 ? "R" : "L";
  }
  return dy > 0 ? "D" : "U";
}

const FACING_DIR = { E: "R", W: "L", N: "U", S: "D" } as const;

/**
 * Hunts the live monster in `slot`: walks toward it, and once beside it turns to face it and holds
 * attack. Every 10 ticks, so the walk keys change only now and then.
 */
function hunt(t: number, p: Player, c: BotCtx, slot: number): InGameMsg[] {
  if (t % 10 !== 0) {
    return [];
  }
  const m = c.game.world.rooms.get(p.map.name)?.map.slots[slot - 1]?.live;
  if (!m || m.hp <= 0) {
    return [walk(null), hold(false)];
  }
  const dir = toward(p, m);
  if (dir) {
    return [hold(false), walk(dir)];
  }
  const face = facingTo(p, m);
  return [
    walk(null),
    ...(FACING_DIR[p.facing] === face
      ? []
      : [{ t: "step", seq: 1, dir: face, turn: true } as const]),
    hold(true),
  ];
}

const BOTS: BotSpec[] = [
  {
    name: "Walker",
    at: { x: 4, y: 5, facing: "E" },
    script: (t) => {
      if (t % 50 !== 0) {
        return [];
      }
      return [walk((["R", null, "L", null] as const)[(t / 50) % 4] ?? null)];
    },
  },
  {
    name: "Lumberjack",
    at: { x: 3, y: 3, facing: "W" },
    equip: { weapon: "Axe" },
    skills: { Lumberjacking: 20, AxeFighting: 20 },
    script: (t) => swingBetween(t, 5, 3500),
  },
  {
    name: "Miner",
    at: { x: 3, y: 6, facing: "W" },
    equip: { weapon: "Mining Hammer" },
    skills: { Mining: 40 },
    script: (t) => swingBetween(t, 5, 3500),
  },
  {
    name: "Farmer",
    at: { x: 3, y: 10, facing: "W" },
    equip: { weapon: "Hoe" },
    bag: [
      ["Seeds", 3],
      ["Watering Bucket", 1],
    ],
    skills: { Farming: 30 },
    script: (t) => [
      ...swingBetween(t, 5, 800),
      ...(t === 820 ? [{ t: "use", slot: 1 } as const] : []),
      ...(t === 900 ? [{ t: "equip", slot: 2 } as const] : []),
      ...swingBetween(t, 920, 2000),
      ...(t === 2010 ? [{ t: "equip", slot: 2 } as const] : []),
      ...swingBetween(t, 2020, 3000),
    ],
  },
  {
    name: "Digger",
    at: { x: 6, y: 10, facing: "S" },
    equip: { weapon: "Shovel" },
    skills: { Shoveling: 30 },
    script: (t) => [
      ...swingBetween(t, 5, 1500),
      ...(t === 1510 ? [walk("R"), walk(null)] : []),
      ...(t === 1530 ? [{ t: "step", seq: 1, dir: "D", turn: true } as const] : []),
      ...swingBetween(t, 1540, 3000),
    ],
  },
  {
    name: "Fisher",
    at: { x: 13, y: 4, facing: "E" },
    equip: { weapon: "Fishing Pole" },
    skills: { Fishing: 30 },
    script: (t) => [
      ...swingBetween(t, 5, 1800),
      // The fish stop biting at one spot: move along the shore.
      ...(t === 1810 ? [walk("U"), walk(null)] : []),
      ...(t === 1830 ? [{ t: "step", seq: 1, dir: "R", turn: true } as const] : []),
      ...swingBetween(t, 1840, 3800),
    ],
  },
  {
    name: "Sailor",
    at: { x: 13, y: 8, facing: "E" },
    bag: [["Boat Deed", 1]],
    script: (t, p, c) => {
      if (t === 10) {
        return [{ t: "use", slot: 1 }];
      }
      if (t === 40) {
        const room = c.game.world.rooms.get(p.map.name);
        const boat = room?.map.ground.find((x) => x.item.endsWith("'s Boat"));
        return boat ? [{ t: "pickup", id: boat.id }] : [];
      }
      if (t >= 60 && t % 80 === 0 && t < 1500) {
        return [walk((["R", "D", "U", "L"] as const)[(t / 80) % 4] ?? null)];
      }
      if (t === 1500) {
        return [walk(null)];
      }
      return [];
    },
  },
  {
    name: "Cook",
    at: { x: 8, y: 3, facing: "N" },
    bag: [["Orc Meat", 6]],
    skills: { Cooking: 30 },
    script: (t) => (every(t, 10, 450) ? [{ t: "craft", slot: 1 }] : []),
  },
  {
    name: "Smith",
    at: { x: 10, y: 3, facing: "N" },
    equip: { weapon: "Blacksmith Hammer" },
    bag: [
      ["Damaged Helm, Fire", 1],
      ["Chunk of Fire", 1],
      ["Damaged Armor, Chain", 1],
      ["Chunk of Iron", 2],
    ],
    skills: { Blacksmithing: 40 },
    script: (t) =>
      t === 10 ? [{ t: "craft", slot: 1 }] : t === 1200 ? [{ t: "craft", slot: 3 }] : [],
  },
  {
    name: "Builder",
    at: { x: 12, y: 3, facing: "N" },
    equip: { offHand: "Saw" },
    bag: [["Logs", 12]],
    skills: { Carpentry: 30 },
    script: (t) => (every(t, 10, 400) ? [{ t: "craft", slot: 1 }] : []),
  },
  {
    name: "Mixer",
    at: { x: 8, y: 7, facing: "N" },
    equip: { offHand: "Red Sand" },
    bag: [
      ["Potion Bottle", 4],
      ["Red Sand", 4],
      ["Red Crystal", 4],
    ],
    skills: { Alchemy: 30 },
    script: (t) => (every(t, 10, 400) ? [{ t: "craft", slot: 1 }] : []),
  },
  {
    name: "Trader",
    at: { x: 5, y: 8, facing: "S" },
    gold: 1000,
    bag: [["Corn", 5]],
    script: (t, _p, c) => {
      if (t >= 3000) {
        return [];
      }
      const rows = (mode: "buy" | "sell") => {
        const m = c.last.get("shop");
        return m?.t === "shop" && m.mode === mode ? m.rows : [];
      };
      switch (t % 300) {
        case 20:
          return [{ t: "npcClick", slot: 1 }];
        case 25:
          return [{ t: "shopList", mode: "buy" }];
        case 30: {
          // Seeds, then a Hoe, by turns.
          const row = rows("buy")[(t / 300) % 2 === 0 ? 2 : 0];
          return row ? [{ t: "buy", line: row.line, count: 2 }] : [];
        }
        case 35:
          return [{ t: "shopCancel" }];
        case 40:
          return [{ t: "npcClick", slot: 1 }];
        case 45:
          return [{ t: "shopList", mode: "sell" }];
        case 50: {
          const row = rows("sell").find((r) => r.item === "Corn");
          return row ? [{ t: "sell", line: row.line, count: 1 }] : [];
        }
        case 55:
          return [{ t: "shopCancel" }, { t: "npcClose" }];
        default:
          return [];
      }
    },
  },
  {
    name: "User",
    at: { x: 10, y: 7, facing: "N" },
    hp: 200,
    hunger: 10000,
    bag: [
      ["Apple", 3],
      ["Red Potion", 2],
      ["Firebolt Book", 1],
      ["Long Sword", 1],
      ["Cabinet#2", 1],
      ["Gold Key", 1],
    ],
    script: (t, p, c) => {
      const room = c.game.world.rooms.get(p.map.name);
      const crate = room?.map.ground.find((x) => x.item === "Crate#1");
      const steps: Record<number, InGameMsg[]> = {
        10: [{ t: "use", slot: 1 }],
        30: [{ t: "use", slot: 2 }],
        50: [{ t: "use", slot: 3 }],
        70: [{ t: "equip", slot: 4 }],
        90: crate ? [{ t: "pickup", id: crate.id }] : [],
        100: [{ t: "vaultTake", index: 1 }],
        110: [{ t: "action" }],
        140: [{ t: "storage", slot: 5 }],
        150: [{ t: "vaultTake", index: 1 }],
        170: [{ t: "use", slot: 6 }],
        180: [{ t: "drop", slot: 1 }],
        200: [{ t: "unequip", slot: "LeftHand" }],
        220: [{ t: "gold", n: 1 }],
      };
      return steps[t] ?? [];
    },
  },
  {
    name: "Fighter",
    at: { x: 10, y: 10, facing: "E" },
    equip: { weapon: "Long Sword", body: "Chain Armor" },
    skills: { Slash: 25, Parry: 20, Block: 10 },
    script: (t, p, c) =>
      t < 3900 ? hunt(t, p, c, 2) : t === 3900 ? [hold(false), walk(null)] : [],
  },
  {
    name: "Mage",
    at: { x: 9, y: 10, facing: "E" },
    spells: ["Minor Heal", "Firebolt", "Fireball", "Magic Shield"],
    bag: [
      ["Red Crystal", 99],
      ["Blue Crystal", 99],
      ["White Crystal", 99],
      ["Yellow Crystal", 99],
      ["Green Crystal", 99],
      ["Purple Crystal", 99],
    ],
    skills: { Magery: 30, Fire: 20, Blessing: 20, Wrath: 10 },
    script: (t, p, c) => {
      if (!every(t, 30, 45)) {
        return [];
      }
      const target = c.game.world.rooms.get(p.map.name)?.map.slots[2]?.live;
      const spell =
        ["Firebolt", "Minor Heal", "Fireball", "Magic Shield"][Math.floor((t - 30) / 45) % 4] ?? "";
      // The playfield starts at (30, 31); aim at the middle of the target's tile.
      const x = target ? 30 + (target.x - 1) * 32 + 16 : 300;
      const y = target ? 31 + (target.y - 1) * 32 + 16 : 300;
      return [{ t: "cast", spell, x, y }];
    },
  },
  {
    name: "Victim",
    at: { x: 12, y: 11, facing: "S" },
    hp: 3,
    script: (t, p, c) => (t >= 1000 && t < 3000 ? hunt(t, p, c, 3) : []),
  },
];

// ---- hashing ------------------------------------------------------------------------------

/** World keys left out: static content, and the NPC files the game lays over it. */
const SKIP = new Set(["npcs"]);

/**
 * The state as sorted `path = value` lines: objects by key, maps and arrays in their own order (the
 * order is behaviour), a repeated object as a reference to its first path.
 */
export function flatten(root: unknown): string[] {
  const out: string[] = [];
  const seen = new Map<object, string>();
  const walk = (v: unknown, path: string) => {
    if (v === null || typeof v !== "object") {
      if (typeof v === "function") {
        return;
      }
      out.push(`${path} = ${v === undefined ? "undefined" : JSON.stringify(v)}`);
      return;
    }
    const first = seen.get(v);
    if (first !== undefined) {
      out.push(`${path} = @${first}`);
      return;
    }
    seen.set(v, path);
    if (v instanceof Map) {
      out.push(`${path} = Map(${v.size})`);
      for (const [k, x] of v) {
        // A player or other named entry reads by its name as well as its key.
        const name =
          x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string"
            ? `:${(x as { name: string }).name}`
            : "";
        walk(x, `${path}[${typeof k === "string" ? k : JSON.stringify(k)}${name}]`);
      }
      return;
    }
    if (v instanceof Set) {
      out.push(`${path} = Set(${v.size})`);
      let i = 0;
      for (const x of v) {
        walk(x, `${path}{${i++}}`);
      }
      return;
    }
    if (Array.isArray(v)) {
      out.push(`${path} = Array(${v.length})`);
      v.forEach((x, i) => {
        walk(x, `${path}[${i}]`);
      });
      return;
    }
    for (const k of Object.keys(v).sort()) {
      if (SKIP.has(k)) {
        continue;
      }
      walk((v as Record<string, unknown>)[k], `${path}.${k}`);
    }
  };
  walk(root, "world");
  return out;
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex");

/** The hash of each top-level part of the state (a player or room by name), for the breakdowns. */
function components(lines: string[]): Map<string, string> {
  const parts = new Map<string, string[]>();
  for (const l of lines) {
    const m = /^world\.(\w+)(\[[^\]]*\])?/.exec(l);
    const key = m ? `${m[1]}${m[2] ?? ""}` : "?";
    let a = parts.get(key);
    if (!a) {
      a = [];
      parts.set(key, a);
    }
    a.push(l);
  }
  return new Map([...parts].map(([k, ls]) => [k, sha(ls.join("\n")).slice(0, 8)]));
}

// ---- the run ------------------------------------------------------------------------------

/**
 * Tables the migrations fill with the wall-clock time of the run (the replay's clock starts after
 * them): the migration list, the installed pack and the built-in roles.
 */
const MIGRATION_TABLES = new Set(["_migrations", "content_packs", "roles"]);

/** Every table's rows, sorted, hashed: what the run wrote to the database. */
function dbDigest(db: Db): string[] {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .filter((t) => !MIGRATION_TABLES.has(t.name));
  return tables.map(({ name }) => {
    const rows = db
      .query<Record<string, unknown>, []>(`SELECT * FROM "${name}"`)
      .all()
      .map((r) => JSON.stringify(r))
      .sort();
    return `db ${name} rows=${rows.length} ${sha(rows.join("\n")).slice(0, 12)}`;
  });
}

export interface ReplayResult {
  /**
   * The golden text: a hash per tick, a breakdown at each checkpoint, and the database's tables
   * after a final save.
   */
  lines: string[];
  /** The flattened state after the tick asked for in `dumpAt`. */
  dumps: Map<number, string[]>;
  game: Game;
}

/** Runs the replay; `dumpAt` keeps the flattened state after those ticks. */
export async function runReplay(
  opts: {
    ticks?: number;
    dumpAt?: readonly number[];
    /** Sees every message the game sends (the probe's view of what happened). */
    send?: (playerId: string, msg: ServerMsg) => void;
  } = {},
): Promise<ReplayResult> {
  const ticks = opts.ticks ?? REPLAY_TICKS;
  const dumpAt = new Set(opts.dumpAt ?? []);
  const realUuid = Bun.randomUUIDv7;
  const realPassword = Bun.password;
  let ids = 0;
  const bun = Bun as unknown as { randomUUIDv7: () => string; password: unknown };
  bun.randomUUIDv7 = () => `00000000-0000-7000-8000-${(++ids).toString(16).padStart(12, "0")}`;
  // A password hash costs a tenth of a second; the replay's logins need none.
  bun.password = {
    hash: async (pw: string) => `replay:${pw}`,
    verify: async (pw: string, hash: string) => hash === `replay:${pw}`,
  };
  try {
    let now = T0;
    const iso = () => new Date(now).toISOString();
    const db = openDatabase();
    migrate(db);
    const [l1, l2, l3, l4] = layers();
    db.run(
      "UPDATE maps SET title = 'Replay', layer1 = ?, layer2 = ?, layer3 = ?, layer4 = ? WHERE mx = 1000 AND my = 992 AND slot = 0",
      [JSON.stringify(l1), JSON.stringify(l2), JSON.stringify(l3), JSON.stringify(l4)],
    );
    const map = findMapByCoords(db, 1000, 992);
    if (!map) {
      throw new Error("no seed map");
    }
    for (const g of GROUND) {
      insertGround(
        db,
        {
          id: Bun.randomUUIDv7(),
          mapId: map.id,
          x: g.x,
          y: g.y,
          item: g.item,
          qty: 1,
          kind: "admin",
          expiresAt: null,
        },
        iso(),
      );
    }
    saveContainer(db, "Crate#1", ["Apple", "Red Potion", "Long Sword"]);
    saveContainer(db, "Cabinet#2", ["Blue Crystal"]);
    saveSlots(
      db,
      map.id,
      SLOTS.map((s) => ({
        slot: s.slot,
        species: s.species,
        live: {
          name: s.species,
          hp: 40,
          x: s.x,
          y: s.y,
          facing: "S" as const,
        },
        home: { x: s.x, y: s.y },
      })),
      iso(),
    );
    const rng = seededRng(REPLAY_SEED);
    const inboxes = new Map<string, Map<string, ServerMsg>>();
    const game = createGame({
      db,
      send: (id, msg) => {
        let m = inboxes.get(id);
        if (!m) {
          m = new Map();
          inboxes.set(id, m);
        }
        m.set(msg.t, msg);
        opts.send?.(id, msg);
      },
      isoNow: iso,
      nowMs: () => now,
      minute: () => new Date(now).getUTCMinutes(),
      rng,
      onFault: (where, err) => {
        throw new Error(`replay fault in ${where}: ${(err as Error).stack ?? String(err)}`);
      },
    });
    const players: { bot: BotSpec; p: Player }[] = [];
    for (const [i, bot] of BOTS.entries()) {
      // Each from its own address: the creation limit counts per address.
      const ip = `10.0.0.${i + 1}`;
      const made = await game.create(
        {
          t: "create",
          name: bot.name,
          password: "replay",
          sex: 1,
          head: 1,
          classCode: 1,
          str: 11,
          sta: 11,
          int: 11,
          wis: 11,
          dex: 11,
        },
        ip,
      );
      if (!made.ok) {
        throw new Error(`${bot.name}: ${made.text}`);
      }
      const l = await game.login(bot.name, "replay", ip);
      if (!l.ok) {
        throw new Error(`${bot.name}: ${l.text}`);
      }
      game.enter(l.characterId, false, ip);
      const p = game.world.players.get(l.characterId);
      if (!p) {
        throw new Error(`${bot.name} did not enter`);
      }
      game.intent(p.id, { t: "mapReady" });
      p.x = bot.at.x;
      p.y = bot.at.y;
      p.facing = bot.at.facing;
      p.char.equip = { ...p.char.equip, ...bot.equip };
      for (const [skill, v] of Object.entries(bot.skills ?? {})) {
        p.char.skills[skillIndex(skill)] = v;
      }
      (bot.bag ?? []).forEach(([item, qty], i) => {
        p.char.bag[i] = { item, qty };
      });
      if (bot.gold !== undefined) {
        p.char.gold = bot.gold;
      }
      // Tough enough to outlast the Orc and the Wolf, except those meant to be hurt.
      p.char.vitals.hpMax = 500;
      p.char.vitals.hp = bot.hp ?? 500;
      if (bot.hunger !== undefined) {
        p.char.hunger = bot.hunger;
      }
      if (bot.spells) {
        p.spell.book = [...bot.spells];
        p.char.vitals.sp = p.char.vitals.spMax = 200;
      }
      p.invDirty = true;
      players.push({ bot, p });
    }
    const lines: string[] = [];
    const dumps = new Map<number, string[]>();
    for (let t = 0; t < ticks; t++) {
      for (const { bot, p } of players) {
        const live = game.world.players.get(p.id);
        if (!live) {
          continue;
        }
        const last = inboxes.get(live.id) ?? new Map<string, ServerMsg>();
        for (const msg of bot.script(t, live, { game, last })) {
          game.intent(live.id, msg);
        }
      }
      if (!game.tick()) {
        throw new Error(`tick ${t} threw`);
      }
      now += TICK_MS;
      const flat = flatten(game.world);
      lines.push(`${t} ${sha(flat.join("\n")).slice(0, 12)}`);
      if ((t + 1) % REPLAY_CHECKPOINT === 0) {
        lines.push(`@${t} ${[...components(flat)].map(([k, h]) => `${k}=${h}`).join(" ")}`);
      }
      if (dumpAt.has(t)) {
        dumps.set(t, flat);
      }
    }
    game.saveAll();
    game.flushLogs();
    lines.push(...dbDigest(db));
    return { lines, dumps, game };
  } finally {
    bun.randomUUIDv7 = realUuid;
    bun.password = realPassword;
  }
}
