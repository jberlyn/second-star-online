/**
 * The scenarios: pure descriptions of who plays where. `stage.ts` turns one
 * into a database, `main.ts` runs it. Maps are copies of the seed map on a 5 x 4 grid, so a
 * walker crossing an edge lands on a real neighbour.
 */
import type { DirKey, Role } from "./bot.ts";

/** The seed map, where new characters start, and where `town` crowds. */
export const TOWN = "x1000y992";
export const GRID_COLS = 5;
export const GRID_ROWS = 4;
/** Map names of the 5 x 4 grid, the town first. */
export const GRID_MAPS: readonly string[] = (() => {
  const out: string[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      out.push(`x${1000 + c}y${992 + r}`);
    }
  }
  return out;
})();

export interface BotPlan {
  name: string;
  role: Role;
  map: string;
  x: number;
  y: number;
  team?: number;
  partner?: string;
  faceDir?: DirKey;
  spell?: string;
  /** A relay profile for this bot alone (the `behind` scenario's slow link). */
  profile?: string;
}

export interface Scenario {
  name: string;
  description: string;
  bots: BotPlan[];
  /** Seconds over which logins are staggered. */
  rampSeconds: number;
  /** Seconds measured after the ramp. */
  seconds: number;
  /** Maps the scenario needs in the database. */
  maps: string[];
  /** Maps where PvP is on (`canPvp` "X"); every other copy of the seed map has it off ("O"). */
  pvpMaps?: string[];
  /** Fill each map's four monster slots (default: none, so walkers are not killed in passing). */
  monsters?: boolean;
}

/** Letters only (a name may have nothing else): 0 -> "aaa", 1 -> "aab". */
export function letters(i: number): string {
  let n = i;
  let s = "";
  for (let k = 0; k < 3; k++) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

const WIDTH = 17;
const HEIGHT = 12;

/** The seed map's tree tiles (layer 2 "S3"), as `x,y`; the rest is open ground. */
const TREES = new Set([
  "1,1",
  "2,1",
  "13,1",
  "1,2",
  "12,2",
  "13,2",
  "14,2",
  "13,3",
  "9,5",
  "10,5",
  "9,6",
  "10,6",
  "2,7",
  "15,7",
  "1,8",
  "2,8",
  "3,8",
  "14,8",
  "15,8",
  "2,9",
  "11,9",
]);
export const isTree = (x: number, y: number) => TREES.has(`${x},${y}`);

/** Open tiles in a fixed order, spread out: tile `i` of a map. */
export function openTile(i: number): { x: number; y: number } {
  const open: { x: number; y: number }[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (!isTree(x, y) && (x + y) % 2 === 0) {
        open.push({ x, y });
      }
    }
  }
  return open[i % open.length] ?? { x: 6, y: 4 };
}

/** Open tiles next to a tree, each with the way to face the tree. */
export function treeSpots(): { x: number; y: number; faceDir: DirKey }[] {
  const out: { x: number; y: number; faceDir: DirKey }[] = [];
  const seen = new Set<string>();
  const dirs: [number, number, DirKey][] = [
    [0, 1, "U"],
    [0, -1, "D"],
    [1, 0, "L"],
    [-1, 0, "R"],
  ];
  for (const t of TREES) {
    const [tx = 0, ty = 0] = t.split(",").map(Number);
    for (const [dx, dy, faceFromSpot] of dirs) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || isTree(x, y) || seen.has(`${x},${y}`)) {
        continue;
      }
      seen.add(`${x},${y}`);
      out.push({ x, y, faceDir: faceFromSpot });
    }
  }
  return out;
}

/** A counter handing out names and tiles, per map. */
function planner() {
  let n = 0;
  const used = new Map<string, number>();
  const nextTile = (map: string) => {
    const i = used.get(map) ?? 0;
    used.set(map, i + 1);
    return openTile(i);
  };
  const name = (prefix: string) => `${prefix}${letters(n++)}`;
  return { nextTile, name };
}

function walkers(map: string, count: number, p = planner()): BotPlan[] {
  return Array.from({ length: count }, () => ({
    name: p.name("Walk"),
    role: "walker" as const,
    map,
    ...p.nextTile(map),
  }));
}

const SPELL = "Fireball";

export function town(count = 40): Scenario {
  return {
    name: "town",
    description: `${count} players walking and chatting on one map`,
    bots: walkers(TOWN, count),
    rampSeconds: 60,
    seconds: 180,
    maps: [TOWN],
  };
}

export function hunt(): Scenario {
  const p = planner();
  const bots: BotPlan[] = [];
  for (let i = 0; i < 10; i++) {
    bots.push({ name: p.name("Figh"), role: "fighter", map: TOWN, ...p.nextTile(TOWN) });
  }
  for (let i = 0; i < 10; i++) {
    bots.push({
      name: p.name("Cast"),
      role: "caster",
      map: TOWN,
      spell: SPELL,
      ...p.nextTile(TOWN),
    });
  }
  return {
    name: "hunt",
    description: "20 players fighting monsters with melee and spells on one map",
    bots,
    rampSeconds: 30,
    seconds: 180,
    maps: [TOWN],
    monsters: true,
  };
}

export function pvp(): Scenario {
  const p = planner();
  const map = "x1001y992";
  const bots: BotPlan[] = [];
  for (let i = 0; i < 20; i++) {
    const team = i % 2;
    bots.push({
      name: p.name(team === 0 ? "Pvpa" : "Pvpb"),
      role: "pvp",
      map,
      team,
      ...p.nextTile(map),
    });
  }
  return {
    name: "pvp",
    description: "10 v 10 on a PvP map",
    bots,
    rampSeconds: 30,
    seconds: 180,
    maps: [map],
    pvpMaps: [map],
  };
}

export function craft(): Scenario {
  const p = planner();
  const spots = treeSpots();
  const bots: BotPlan[] = [];
  for (let i = 0; i < 30; i++) {
    const spot = spots[i];
    const tile = spot ?? p.nextTile(TOWN);
    bots.push({
      name: p.name("Gath"),
      role: "gatherer",
      map: TOWN,
      x: tile.x,
      y: tile.y,
      faceDir: spot?.faceDir,
    });
  }
  return {
    name: "craft",
    description: "30 players working trees on one map",
    bots,
    rampSeconds: 30,
    seconds: 180,
    maps: [TOWN],
  };
}

/** Everything at once: the town's 40 walkers, the rest spread over the 20 maps in a role mix. */
export function world(total: number, rampSeconds = 60, name = `world${total}`): Scenario {
  const p = planner();
  const bots: BotPlan[] = walkers(TOWN, 40, p);
  const mix: Role[] = ["walker", "fighter", "caster", "walker", "gatherer", "trader"];
  const spots = treeSpots();
  const spotUsed = new Map<string, number>();
  const traders: BotPlan[] = [];
  for (let i = 0; bots.length < total; i++) {
    // Skip the town: the grid's other 19 maps share the rest.
    const map = GRID_MAPS[1 + (i % (GRID_MAPS.length - 1))] ?? TOWN;
    const role = mix[i % mix.length] ?? "walker";
    const tile = p.nextTile(map);
    const prefix = {
      walker: "Walk",
      fighter: "Figh",
      caster: "Cast",
      gatherer: "Gath",
      trader: "Trad",
      pvp: "Pvpa",
    }[role];
    const bot: BotPlan = { name: p.name(prefix), role, map, ...tile };
    if (role === "caster") {
      bot.spell = SPELL;
    }
    if (role === "gatherer") {
      // The next unused tree spot on this map.
      const k = spotUsed.get(map) ?? 0;
      spotUsed.set(map, k + 1);
      const spot = spots[k];
      if (spot) {
        Object.assign(bot, { x: spot.x, y: spot.y, faceDir: spot.faceDir });
      }
    }
    if (role === "trader") {
      traders.push(bot);
    }
    bots.push(bot);
  }
  // Traders pair up on their map and stand side by side.
  const byMap = new Map<string, BotPlan[]>();
  for (const t of traders) {
    byMap.set(t.map, [...(byMap.get(t.map) ?? []), t]);
  }
  for (const list of byMap.values()) {
    for (let i = 0; i + 1 < list.length; i += 2) {
      const a = list[i];
      const b = list[i + 1];
      if (a && b) {
        a.partner = b.name;
        b.partner = a.name;
        b.x = a.x + 1;
        b.y = a.y;
      }
    }
    if (list.length % 2 === 1) {
      const lone = list[list.length - 1];
      if (lone) {
        lone.role = "walker";
      }
    }
  }
  return {
    name,
    description: `${total} players over ${GRID_MAPS.length} maps, 40 of them in town`,
    bots,
    rampSeconds,
    seconds: 180,
    maps: [...GRID_MAPS],
    monsters: true,
  };
}

/** `world200` with every login inside 5 s: everyone reconnecting after a restart. */
export const burst = (): Scenario => ({
  ...world(200, 5, "burst"),
  description: "200 players, every login inside 5 s (a restart: the save burst)",
});

/** `town` plus one bot on a link capped at 4 KB/s: it must be closed with 4007 and resume. */
export function behind(): Scenario {
  const base = town();
  const p = planner();
  for (let i = 0; i < 40; i++) {
    p.name("Walk");
    p.nextTile(TOWN);
  }
  const slow: BotPlan = {
    name: p.name("Walk"),
    role: "walker",
    map: TOWN,
    ...p.nextTile(TOWN),
    profile: "slow",
  };
  return {
    ...base,
    name: "behind",
    description: "town plus one player on a 4 KB/s link",
    bots: [...base.bots, slow],
  };
}

export const SCENARIOS: Record<string, () => Scenario> = {
  town: () => town(),
  hunt,
  pvp,
  craft,
  world100: () => world(100),
  world200: () => world(200),
  burst,
  behind,
};
