/**
 * Housing on the server: deeds and placement, the build, the decay clock and sweep, demolition,
 * rest regen and the do-not-drop flag.
 *
 * The rules are `shared/rules/housing/houses.ts`; this module changes the world. The database
 * writes (the interior's map row, the house tables) are game.ts's, through `HouseDeps`.
 */
import {
  checkPlacement,
  type DeltaEvent,
  deedUse,
  FACING_DELTA,
  HOUSE_CLOCK_FRAMES,
  type HouseListEntry,
  type HousePlan,
  type HouseType,
  houseType,
  invDelSlot,
  isFootprint,
  isHouseMap,
  lingoContains,
  lingoEq,
  planHouse,
  REST_REGEN,
  type Rng,
  refreshOwner,
  sweep,
  TILE_DEFAULTS,
  tileAt,
} from "@secondstaronline/shared";

import { refreshSnapshot } from "../admin/worldedit.ts";
import { createShopkeeper } from "../economy/playershop.ts";
import {
  type GroundItem,
  type HouseRecord,
  type Outgoing,
  type Player,
  type PlayerShop,
  type Room,
  setTile,
  type World,
  type WorldMap,
} from "../world/world.ts";

/** What game.ts does for housing: the interior map row and the map loader. */
export interface HouseDeps {
  /** Writes the interior's map row and returns it as a world map (in the caller's transaction). */
  createInterior(plan: HousePlan, type: HouseType, outdoor: WorldMap): WorldMap;
  loadMap(name: string): WorldMap | null;
  rng: Rng;
  /** This month in the house decay time zone, `YYYY-MM`. */
  month(): string;
}

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

/**
 * Use on a deed, after Use's own gates: a house deed starts placement and the client draws the
 * ghost; the Stone Guild Hall Deed says it cannot be built and is kept. The vehicle deeds never
 * reach here: `useIntent` builds them first (`vehicleDeed`). Returns null for anything else.
 */
export function useDeed(p: Player, slot: number, item: string): Outgoing[] | null {
  const use = deedUse(item);
  if (!use) {
    return null;
  }
  if (use.kind === "nothing") {
    return use.text ? [tell(p, use.text)] : [];
  }
  if (use.kind !== "place") {
    return [];
  }
  p.placing = { slot, house: use.type.house };
  return [{ to: p.id, msg: { t: "placing", house: use.type.house, slot } }];
}

/** Placement ends without a build (on mouse leave, or a bag click). */
export function placeCancel(p: Player): void {
  p.placing = null;
}

/**
 * The tiles a house cannot cover: each ground item's, each live monster's (a wide monster's three),
 * and each player's, the builder's too, including the tile a walker is stepping onto.
 */
export function obstacleTiles(room: Room): { x: number; y: number }[] {
  const out = room.map.ground.map((g) => ({ x: g.x, y: g.y }));
  for (const s of room.map.slots) {
    const m = s.live;
    if (m) {
      const wide = isFootprint(m.name) ? 3 : 1;
      for (let i = 0; i < wide; i++) {
        out.push({ x: m.x + i, y: m.y });
      }
    }
  }
  for (const o of room.players) {
    out.push({ x: o.x, y: o.y });
    if (o.stepFrames > 0) {
      const [dx, dy] = FACING_DELTA[o.facing];
      out.push({ x: o.x + dx, y: o.y + dy });
    }
  }
  return out;
}

const groundAdd = (world: World, m: WorldMap, g: Omit<GroundItem, "id">): GroundItem => {
  const item: GroundItem = { id: Bun.randomUUIDv7(), ...g };
  m.ground.push(item);
  world.groundLog.push({ mapId: m.id, add: item });
  return item;
};

/**
 * The click in placement mode. The deed must still be in its slot; the checks run in 1.6's order
 * and a refusal keeps placement on. A build writes the outdoor exit, items and tiles, the interior,
 * the deed and the house record, then sends everyone on the map the map again.
 */
export function placeHouseIntent(
  world: World,
  room: Room,
  p: Player,
  slot: number,
  hx: number,
  hy: number,
  deps: HouseDeps,
): { out: Outgoing[]; built: HouseRecord | null; shop?: { shop: PlayerShop; interior: WorldMap } } {
  const line = p.char.bag[slot - 1];
  const use = line ? deedUse(line.item) : null;
  if (!p.placing || p.placing.slot !== slot || !use || use.kind !== "place") {
    p.placing = null;
    return { out: [], built: null };
  }
  const type = use.type;
  const m = room.map;
  const outdoor = parseOutdoor(m.name);
  // Any guild member can build a hall for their guild.
  const guild = p.guild;
  const check = checkPlacement({
    type,
    hx,
    hy,
    layer1: m.layers[0],
    layer2: m.layers[1],
    obstacles: obstacleTiles(room),
    hasExit: m.ground.some((g) => lingoEq(g.item, "Exit")),
    hasExit2: m.ground.some((g) => lingoEq(g.item, "Exit2")),
    guild,
  });
  if (!check.ok) {
    return { out: [tell(p, check.text)], built: null };
  }
  if (!outdoor) {
    // A house map has no grid name for an interior (its exit would name nothing).
    return { out: [], built: null };
  }
  p.placing = null;
  const plan = planHouse(type, check.anchor, check.slot, outdoor.mx, outdoor.my, p.name, guild);

  // 1. The outdoor exit field and items. `createInterior` reads the exit (it writes it to SQL), so
  //    the exit goes first; if the interior then throws, the memory changes below are undone before
  //    the throw goes on (a failed build must leave no items and no deed spent).
  const undo = {
    exit1: m.exit1,
    exit2: m.exit2,
    ground: m.ground.length,
    log: world.groundLog.length,
  };
  if (check.slot === 1) {
    m.exit1 = plan.exit;
  } else {
    m.exit2 = plan.exit;
  }
  for (const it of plan.outdoorItems) {
    groundAdd(world, m, { ...it, kind: "drop", expiresAt: null });
  }
  // 2. The interior, its items and an empty roster; a Small Shop's roster holds its shopkeeper
  //    instead.
  let interior: WorldMap;
  try {
    interior = deps.createInterior(plan, type, m);
  } catch (err) {
    m.exit1 = undo.exit1;
    m.exit2 = undo.exit2;
    m.ground.length = undo.ground;
    world.groundLog.length = undo.log;
    throw err;
  }
  const shop = lingoContains(type.house, "Shop")
    ? createShopkeeper(world, interior, p, deps.rng)
    : null;
  // 3. The deed.
  invDelSlot(p.char.bag, slot - 1, 1);
  p.invDirty = true;
  // 4. The tiles, each only where layer 2 still holds `TILE_DEFAULTS.empty`.
  for (const t of plan.tiles) {
    if (tileAt(m.layers[1], t.x, t.y) === TILE_DEFAULTS.empty) {
      setTile(world, m, 2, t.x, t.y, t.code);
    }
  }
  // 5. The blueprint, one per house (named by its interior), and its list entry.
  const rec: HouseRecord = {
    ownerId: p.id,
    ownerName: p.name,
    map: m.name,
    item1: plan.item1,
    item2: plan.item2,
    tiles: plan.tiles,
    interior: plan.interior,
  };
  world.houses.set(rec.interior, rec);
  world.houseList.push({
    ownerId: p.id,
    ownerName: p.name,
    map: m.name,
    interior: rec.interior,
    month: deps.month(),
  });
  world.housesDirty = true;

  const out: Outgoing[] = [{ to: p.id, msg: { t: "placing", house: null, slot } }];
  for (const o of room.players) {
    out.push({ to: o.id, msg: refreshSnapshot(o, m, room.players) });
  }
  return { out, built: rec, ...(shop ? { shop: { shop, interior } } : {}) };
}

function parseOutdoor(name: string): { mx: number; my: number } | null {
  const m = /^x(-?\d+)y(-?\d+)$/i.exec(name);
  return m?.[1] && m[2] ? { mx: Number(m[1]), my: Number(m[2]) } : null;
}

// ---- decay -----------------------------------------------------------------------------

/**
 * One clock check from this player: their houses take this month. Then, once per day of the decay
 * calendar (the first check of the day, by anyone), the sweep removes every house whose owner has
 * not been seen this month or last. Returns the houses to demolish.
 */
export function monthCheck(world: World, p: Player, month: string, day: string): HouseListEntry[] {
  if (refreshOwner(world.houseList, p.id, month)) {
    world.housesDirty = true;
  }
  if (world.houseSweepDay === day) {
    return [];
  }
  world.houseSweepDay = day;
  const r = sweep(world.houseList, month);
  if (r.demolish.length > 0) {
    world.houseList = r.list;
    world.housesDirty = true;
  }
  return r.demolish;
}

/**
 * The five-minute countdown per player: every 1230 frames 1.6's client asked the time and sent its
 * month report; SSO's server takes the month from its own clock. True when this frame is due.
 */
export function houseClockStep(p: Player): boolean {
  p.houseClock -= 1;
  if (p.houseClock > 0) {
    return false;
  }
  p.houseClock = HOUSE_CLOCK_FRAMES;
  return true;
}

/**
 * Demolition for one house, named by its interior: the recorded mailbox or lamp and exit are
 * blanked by exact name and tile, each tile reverts to G3 only where layer 2 still holds it, and
 * the exit field is left. SSO also shows it at once and queues the interior for deletion. Missing
 * blueprint: nothing.
 */
export function demolish(
  world: World,
  interior: string,
  loadMap: (name: string) => WorldMap | null,
): { out: Outgoing[]; interior: string | null } {
  const rec = world.houses.get(interior);
  const m = rec ? loadMap(rec.map) : null;
  if (!rec || !m) {
    return { out: [], interior: null };
  }
  const events: DeltaEvent[] = [];
  for (const it of [rec.item1, rec.item2]) {
    if (!it) {
      continue;
    }
    for (const g of m.ground.filter((x) => x.item === it.item && x.x === it.x && x.y === it.y)) {
      m.ground.splice(m.ground.indexOf(g), 1);
      world.groundLog.push({ mapId: m.id, del: g.id });
      events.push({ e: "gdel", id: g.id });
    }
  }
  for (const t of rec.tiles) {
    if (tileAt(m.layers[1], t.x, t.y) === t.code) {
      const ev = setTile(world, m, 2, t.x, t.y, TILE_DEFAULTS.empty);
      if (ev) {
        events.push(ev);
      }
    }
  }
  world.houses.delete(interior);
  world.housesDirty = true;
  world.interiorsToDelete.add(rec.interior);
  world.containersDirty.add(`${rec.ownerName}'s House Vault`);
  world.containers.delete(`${rec.ownerName}'s House Vault`);
  const room = world.rooms.get(m.name);
  const out: Outgoing[] = [];
  if (events.length > 0) {
    for (const o of room?.players ?? []) {
      out.push({ to: o.id, msg: { t: "delta", events } });
    }
  }
  return { out, interior: rec.interior };
}

// ---- indoors ---------------------------------------------------------------------------

/**
 * Rest regen: on a house map `random(10) = 1`; then, if the step's destination row is below 11,
 * HP and SP rise by 1, capped. The dead do not rest.
 */
export function restRegen(p: Player, rng: Rng): void {
  if (!isHouseMap(p.map.name) || p.deadLock > 0) {
    return;
  }
  if (rng.random(REST_REGEN.odds) !== 1 || p.y > REST_REGEN.maxY) {
    return;
  }
  const v = p.char.vitals;
  const hp = Math.min(v.hp + 1, v.hpMax);
  const sp = Math.min(v.sp + 1, v.spMax);
  if (hp !== v.hp || sp !== v.sp) {
    v.hp = hp;
    v.sp = sp;
    p.vitalsDirty = true;
  }
}

export { houseType };
