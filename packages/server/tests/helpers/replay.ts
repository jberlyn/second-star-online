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
  content,
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
import { findMapByCoords, saveMap } from "../../src/persistence/maps.ts";
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

// ---- the maps ---------------------------------------------------------------------------

const grid = (f: (x: number, y: number) => string) =>
  Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) => f(x + 1, y + 1)).join(" "),
  );

/**
 * The start map, x1000y992, laid out for the gatherers, crafters and traders (x 1-17, y 1-12),
 * with PvP off so a stray swing hurts no one:
 *
 * - layer 1: grass (G1), with sea (W1) in columns 14-17;
 * - layer 2: trees (S3) at x 2, y 1-6; rocks (B8) at x 2, y 7-12; farmland (TL) at x 4, y 7-12.
 */
function townLayers(): [string[], string[], string[], string[]] {
  return [
    grid((x) => (x >= 14 ? "W1" : "G1")),
    grid((x, y) => {
      if (x === 2) {
        return y <= 6 ? "S3" : "B8";
      }
      if (x === 4 && y >= 7) {
        return "TL";
      }
      return "G3";
    }),
    grid(() => "G3"),
    grid(() => "5A"),
  ];
}

/** The fighting map, x1001y992: open grass with PvP on, an Orc and a Wolf. */
const FIELD = { mx: 1001, my: 992, name: "x1001y992" };
/** The church map, where the bell rings. */
const CHURCH = { mx: 999, my: 999 };

/** Fixtures on the start map: the crafting stations, a crate and a locked door. */
const GROUND: { item: string; x: number; y: number }[] = [
  { item: "Stove", x: 8, y: 2 },
  { item: "Anvil", x: 10, y: 2 },
  { item: "Carpentry Bench", x: 12, y: 2 },
  { item: "Alchemy Lab", x: 8, y: 6 },
  { item: "Crate#1", x: 10, y: 6 },
  { item: "Gold Door", x: 11, y: 7 },
];

/** The rosters: a shopkeeper at home; an Orc and a Wolf on the field. */
const TOWN_SLOTS = [{ slot: 1, species: "Agavar", x: 7, y: 9 }];
const FIELD_SLOTS = [
  { slot: 1, species: "Orc", x: 11, y: 6 },
  { slot: 2, species: "Wolf", x: 13, y: 10 },
];

// ---- the players --------------------------------------------------------------------------

interface BotCtx {
  game: Game;
  /** The last message of each type the game sent this player. */
  last: Map<string, ServerMsg>;
}

interface BotSpec {
  name: string;
  /** Where the bot starts: the start map unless it names the field or the church. */
  map?: "field" | "church";
  /** Where it respawns, when not where it starts: a tile on the start map. */
  respawn?: { map: "town"; x: number; y: number };
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
/** One step, or with `turn` only a turn to face that way. */
const step = (dir: "L" | "R" | "U" | "D", turn = false): InGameMsg => ({
  t: "step",
  seq: 1,
  dir,
  turn,
});
const walk = (held: "L" | "R" | "U" | "D" | null): InGameMsg => ({
  t: "move",
  seq: 1,
  held,
  turn: false,
});
/** Holds attack from tick `from`, releasing it at `to`. */
const swingBetween = (t: number, from: number, to: number): InGameMsg[] =>
  t === from ? [hold(true)] : t === to ? [hold(false)] : [];
/**
 * Works along a line of tiles: swings from `from` and, every `period` ticks, stops, takes one step
 * the next way in `walk`, turns back to `face` and swings again, until `to`.
 */
function patrol(
  t: number,
  o: {
    from: number;
    to: number;
    period: number;
    walk: readonly ("L" | "R" | "U" | "D")[];
    face: "L" | "R" | "U" | "D";
  },
): InGameMsg[] {
  if (t === o.from) {
    return [hold(true)];
  }
  if (t >= o.to) {
    return t === o.to ? [hold(false)] : [];
  }
  const k = Math.floor((t - o.from) / o.period);
  const at = (t - o.from) % o.period;
  if (k === 0) {
    return [];
  }
  const dir = o.walk[(k - 1) % o.walk.length] ?? o.face;
  return at === 0
    ? [hold(false), step(dir)]
    : at === 10
      ? [step(o.face, true)]
      : at === 15
        ? [hold(true)]
        : [];
}

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

/**
 * The scripted players. Walker, the gatherers, crafters, Trader, User and Sailor share the start map
 * (PvP off); Fighter, Mage and Victim fight on the field; Listener stands in the church.
 */
/** Five steps down a column and five back up; five right along a row and five back. */
const DOWN_AND_BACK = ["D", "D", "D", "D", "D", "U", "U", "U", "U", "U"] as const;
const RIGHT_AND_BACK = ["R", "R", "R", "R", "R", "L", "L", "L", "L", "L"] as const;

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
    at: { x: 3, y: 1, facing: "W" },
    equip: { weapon: "Axe" },
    skills: { Lumberjacking: 60, AxeFighting: 20 },
    script: (t) => patrol(t, { from: 5, to: 3600, period: 150, walk: DOWN_AND_BACK, face: "L" }),
  },
  {
    name: "Miner",
    at: { x: 3, y: 7, facing: "W" },
    equip: { weapon: "Mining Hammer" },
    skills: { Mining: 60 },
    script: (t) => patrol(t, { from: 5, to: 3600, period: 150, walk: DOWN_AND_BACK, face: "L" }),
  },
  {
    name: "Farmer",
    at: { x: 5, y: 7, facing: "W" },
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
      // The next patch down: hoe it, plant it and water it.
      ...(t === 2010 ? [step("D")] : []),
      ...(t === 2030 ? [step("L", true), { t: "equip", slot: 2 } as const] : []),
      ...swingBetween(t, 2040, 2800),
      ...(t === 2810 ? [{ t: "use", slot: 1 } as const] : []),
      ...(t === 2820 ? [{ t: "equip", slot: 2 } as const] : []),
      ...swingBetween(t, 2830, 3500),
    ],
  },
  {
    name: "Digger",
    at: { x: 7, y: 11, facing: "S" },
    equip: { weapon: "Shovel" },
    skills: { Shoveling: 60 },
    script: (t) => patrol(t, { from: 5, to: 3600, period: 150, walk: RIGHT_AND_BACK, face: "D" }),
  },
  {
    name: "Fisher",
    at: { x: 13, y: 4, facing: "E" },
    equip: { weapon: "Fishing Pole" },
    skills: { Fishing: 30 },
    script: (t) => [
      ...swingBetween(t, 5, 1800),
      // The fish stop biting at one spot: one step along the shore, then face the sea again.
      ...(t === 1810 ? [step("U")] : []),
      ...(t === 1830 ? [step("R", true)] : []),
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
    at: { x: 6, y: 3, facing: "S" },
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
          // Seeds and a Hoe, by turns.
          const want = Math.floor(t / 300) % 2 === 0 ? "Seeds" : "Hoe";
          const row = rows("buy").find((r) => r.item === want);
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
    gold: 50,
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
        // The crate: open it, take a line out, put an apple in, close it.
        90: crate ? [{ t: "pickup", id: crate.id }] : [],
        100: [{ t: "vaultTake", index: 1 }],
        110: [{ t: "drop", slot: 1 }],
        120: [{ t: "shopCancel" }],
        // Ctrl at the crate: too weak to carry it off.
        130: [{ t: "action" }],
        // The carried cabinet: open it from the bag, take its crystal, close it.
        150: [{ t: "storage", slot: 5 }],
        160: [{ t: "vaultTake", index: 1 }],
        170: [{ t: "shopCancel" }],
        // Face the Gold Door and use the Gold Key on it.
        180: [step("R", true)],
        200: [{ t: "use", slot: 6 }],
        // After the key's pause.
        320: [{ t: "unequip", slot: "LeftHand" }],
        340: [{ t: "gold", n: 5 }],
      };
      return steps[t] ?? [];
    },
  },
  {
    name: "Fighter",
    map: "field",
    at: { x: 8, y: 6, facing: "E" },
    equip: { weapon: "Long Sword", body: "Chain Armor" },
    skills: { Slash: 25, Parry: 20, Block: 10 },
    script: (t, p, c) =>
      t < 3900 ? hunt(t, p, c, 1) : t === 3900 ? [hold(false), walk(null)] : [],
  },
  {
    name: "Mage",
    map: "field",
    at: { x: 6, y: 6, facing: "E" },
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
      const target = c.game.world.rooms.get(p.map.name)?.map.slots[0]?.live;
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
    map: "field",
    respawn: { map: "town", x: 9, y: 9 },
    at: { x: 12, y: 11, facing: "S" },
    hp: 3,
    script: (t, p, c) => (t >= 1000 && t < 3000 ? hunt(t, p, c, 2) : []),
  },
  {
    name: "Listener",
    map: "church",
    at: { x: 9, y: 9, facing: "N" },
    script: () => [],
  },
];

// ---- hashing ------------------------------------------------------------------------------

/**
 * Keys left out: the NPC files the game lays over the content, and `lastSheet`, the copy of the last
 * character sheet sent (derived, and its skills by position; what was sent is hashed itself).
 */
const SKIP = new Set(["npcs", "lastSheet"]);

/**
 * The state as sorted `path = value` lines: objects by key, maps and arrays in their own order (the
 * order is behaviour), a repeated object as a reference to its first path.
 */
export function flatten(root: unknown): string[] {
  const out: string[] = [];
  const seen = new Map<object, string>();
  const skillNames = content().classes.skills.map((s) => s.skill);
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
    // A list of skill values reads by skill name, so storing skills by key instead of position
    // changes no line.
    if (
      Array.isArray(v) &&
      /\.(skills|awardSkills)$/.test(path) &&
      v.length === skillNames.length
    ) {
      skillNames
        .map((name, i) => [name, v[i]] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .forEach(([name, x]) => {
          walk(x, `${path}.${name}`);
        });
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

/**
 * A `JSON.stringify` replacer: a list of skill values (a character sheet's `skills`) is written by
 * skill name, so sending skills by key instead of position changes nothing.
 */
function skillsByName(key: string, value: unknown): unknown {
  const skillNames = content().classes.skills.map((s) => s.skill);
  if (
    /skills$/i.test(key) &&
    Array.isArray(value) &&
    value.length === skillNames.length &&
    value.every((x) => typeof x === "number")
  ) {
    return Object.fromEntries(
      skillNames.map((n, i) => [n, value[i]] as const).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  return value;
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
  const skillNames = content().classes.skills.map((s) => s.skill);
  return tables.map(({ name }) => {
    const rows = db
      .query<Record<string, unknown>, []>(`SELECT * FROM "${name}"`)
      .all()
      .map((r) =>
        // A character's skill by name, not by its position in the skill list (a later layout keyed
        // by skill projects to the same three fields).
        name === "character_skills"
          ? JSON.stringify({
              character: r.character_id,
              skill: skillNames[Number(r.skill) - 1] ?? r.skill,
              value: r.value,
            })
          : JSON.stringify(r),
      )
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
    /** Runs after each tick. */
    onTick?: (t: number, game: Game) => void;
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
    const json = (ls: string[][]) => ls.map((l) => JSON.stringify(l));
    const [l1, l2, l3, l4] = json(townLayers());
    db.run(
      "UPDATE maps SET title = 'Replay', layer1 = ?, layer2 = ?, layer3 = ?, layer4 = ?, can_pvp = 'O' WHERE mx = 1000 AND my = 992 AND slot = 0",
      [l1 as string, l2 as string, l3 as string, l4 as string],
    );
    const town = findMapByCoords(db, 1000, 992);
    const church = findMapByCoords(db, CHURCH.mx, CHURCH.my);
    if (!town || !church) {
      throw new Error("no seed or church map");
    }
    saveMap(
      db,
      {
        ...town,
        mx: FIELD.mx,
        my: FIELD.my,
        title: "Field",
        layers: [grid(() => "G1"), grid(() => "G3"), grid(() => "G3"), grid(() => "5A")],
        flags: { ...town.flags, canFight: "X", canPvp: "X" },
      },
      iso(),
    );
    const field = findMapByCoords(db, FIELD.mx, FIELD.my);
    if (!field) {
      throw new Error("no field map");
    }
    for (const g of GROUND) {
      insertGround(
        db,
        {
          id: Bun.randomUUIDv7(),
          mapId: town.id,
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
    for (const [mapId, slots] of [
      [town.id, TOWN_SLOTS],
      [field.id, FIELD_SLOTS],
    ] as const) {
      saveSlots(
        db,
        mapId,
        slots.map((s) => ({
          slot: s.slot,
          species: s.species,
          live: { name: s.species, hp: 40, x: s.x, y: s.y, facing: "S" as const },
          home: { x: s.x, y: s.y },
        })),
        iso(),
      );
    }
    const mapIdOf = (bot: BotSpec) =>
      bot.map === "field" ? field.id : bot.map === "church" ? church.id : town.id;
    const rng = seededRng(REPLAY_SEED);
    const inboxes = new Map<string, Map<string, ServerMsg>>();
    /** What the game sent since the last hash, in order, by player name. */
    const sent: string[] = [];
    /** Player names by id, as they enter. */
    const names = new Map<string, string>();
    const game = createGame({
      db,
      send: (id, msg) => {
        sent.push(`${names.get(id) ?? id} ${JSON.stringify(msg, skillsByName)}`);
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
          // Every start class: Fighter, Mage and Ranger by turns.
          classCode: ((i % 3) + 1) as 1 | 2 | 3,
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
      // The bot starts where it works, and respawns there.
      const at = mapIdOf(bot);
      const back = bot.respawn
        ? { map: town.id, x: bot.respawn.x, y: bot.respawn.y }
        : { map: at, x: bot.at.x, y: bot.at.y };
      db.run(
        "UPDATE characters SET map_id = ?, x = ?, y = ?, facing = ?, respawn_map_id = ?, respawn_x = ?, respawn_y = ? WHERE name = ?",
        [at, bot.at.x, bot.at.y, bot.at.facing, back.map, back.x, back.y, bot.name],
      );
      const l = await game.login(bot.name, "replay", ip);
      if (!l.ok) {
        throw new Error(`${bot.name}: ${l.text}`);
      }
      names.set(l.characterId, bot.name);
      game.enter(l.characterId, false, ip);
      const p = game.world.players.get(l.characterId);
      if (!p) {
        throw new Error(`${bot.name} did not enter`);
      }
      game.intent(p.id, { t: "mapReady" });
      // A login faces south; the bot faces its work.
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
        p.spell.bookDirty = true;
        p.char.vitals.sp = p.char.vitals.spMax = 200;
      }
      p.invDirty = true;
      players.push({ bot, p });
    }
    const lines: string[] = [`setup sent ${sha(sent.join("\n")).slice(0, 12)}`];
    sent.length = 0;
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
      opts.onTick?.(t, game);
      const flat = flatten(game.world);
      // The world after the tick, then everything sent during it (intents and the tick).
      lines.push(`${t} ${sha(flat.join("\n")).slice(0, 12)} ${sha(sent.join("\n")).slice(0, 8)}`);
      if ((t + 1) % REPLAY_CHECKPOINT === 0) {
        lines.push(`@${t} ${[...components(flat)].map(([k, h]) => `${k}=${h}`).join(" ")}`);
      }
      if (dumpAt.has(t)) {
        dumps.set(t, [...flat, ...sent.map((m) => `sent ${m}`)]);
      }
      sent.length = 0;
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
