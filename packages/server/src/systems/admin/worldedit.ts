/**
 * The World Editor on the server.
 *
 * - Open: the `worldEditor` permission only. You leave the map: everyone there sees you go (`##!` + `LeaveGroup`), and
 *   nothing on it ticks for you. The editor loads the map you were on.
 * - Load: the map at X/Y, or the blank-map template when there is none.
 * - Save: validated, then the map, its roster and live monsters, and its placed items are replaced;
 *   everyone on the map gets it again.
 * - Close: back on the map you left, where you stood, with the login i-frames
 *   (a 40-frame hit flicker).
 *
 * Only `admin` ground items are the editor's: in 1.6 the save rewrote the whole item file.
 */
import {
  airshipWalkGrid,
  blankMap,
  can,
  canOpenControlPanel,
  type DeltaEvent,
  type EditorMap,
  type EditorMob,
  editorMapError,
  editorMobName,
  footWalkGrid,
  hasBehaviour,
  mapName,
  type PlayerView,
  shipWalkGrid,
  TEXT,
} from "@secondstaronline/shared";

import { type CasinoDeps, casinoMapChange } from "../casino/index.ts";
import { craftingInPlace, mintContainerId } from "../crafting/craft.ts";
import { leaveTrade } from "../economy/trade.ts";
import { spawnHp } from "../monsters/spawn.ts";
import {
  type Editing,
  enterRoom,
  type GroundItem,
  groundView,
  leaveRoom,
  liveMonsterViews,
  mapView,
  type Outgoing,
  type Player,
  playerView,
  selfState,
  type World,
  type WorldMap,
} from "../world/world.ts";
import { droppableName, dropText, parseDrop } from "./drop.ts";

/** The editor's view of a live map: what LOAD shows. */
export function editorView(m: WorldMap, mx: number, my: number): EditorMap {
  const mobs = m.slots.map((s, i): EditorMob | null => {
    if (!s.species) {
      return null;
    }
    // A slot set by `/roster` has no editor tile: shown on row 1 under its slot number.
    const home = s.home ?? { x: i + 1, y: 1 };
    return { name: s.species, x: home.x, y: home.y };
  });
  return {
    mx,
    my,
    layers: [[...m.layers[0]], [...m.layers[1]], [...m.layers[2]], [...m.layers[3]]],
    flags: { ...m.flags },
    header: m.title,
    signs: [...m.signs],
    exit1: m.exit1 ? { ...m.exit1 } : null,
    exit2: m.exit2 ? { ...m.exit2 } : null,
    fog: { ...m.fog },
    mobs: [mobs[0] ?? null, mobs[1] ?? null, mobs[2] ?? null, mobs[3] ?? null],
    items: m.ground
      .filter((g) => g.kind === "admin")
      .slice(0, 20)
      .map((g) => ({ name: dropText(g), x: g.x, y: g.y })),
  };
}

/** What the editor shows for a grid position: the map, or the blank template. */
export function editorMap(
  loadMap: (name: string) => WorldMap | null,
  mx: number,
  my: number,
): { map: EditorMap; exists: boolean } {
  const m = loadMap(mapName(mx, my));
  return m
    ? { map: editorView(m, mx, my), exists: true }
    : { map: blankMap(mx, my), exists: false };
}

/**
 * Leaving the map for an editor or the Control Panel (`##!` + `LeaveGroup`): everyone there sees you
 * go, and nothing on it ticks for you. From another editor or the Control Panel you are already off the
 * map, so moving between them never puts you back on it (menu 502 opens either editor from either).
 */
export function leaveForEditor(
  world: World,
  p: Player,
  which: Editing,
  casino: CasinoDeps,
): Outgoing[] {
  if (p.editing) {
    p.editing = which;
    return [];
  }
  const out = leaveTrade(world, p);
  out.push(...casinoMapChange(world, p, casino));
  out.push(...leaveRoom(world, p));
  p.editing = which;
  p.held = null;
  p.pending = null;
  p.attackHeld = false;
  p.bio = null;
  p.shop = null;
  p.keyLock = false;
  return out;
}

/** Admin menu → World Editor. Anyone without `worldEditor` gets nothing. */
export function openEditor(
  world: World,
  p: Player,
  loadMap: (name: string) => WorldMap | null,
  coords: { mx: number; my: number } | null,
  casino: CasinoDeps,
): Outgoing[] {
  if (!can(p.role, "worldEditor") || p.editing === "world" || !coords) {
    return [];
  }
  const out = leaveForEditor(world, p, "world", casino);
  const { map, exists } = editorMap(loadMap, coords.mx, coords.my);
  out.push({ to: p.id, msg: { t: "editor", editing: true, map, exists } });
  return out;
}

/** Whether `role` may stay where `editing` is (a role change can take it away). */
export function mayEdit(role: Player["role"], editing: Editing): boolean {
  switch (editing) {
    case "world":
      return can(role, "worldEditor");
    case "npc":
      return can(role, "npcEditor");
    case "controlPanel":
      return canOpenControlPanel(role);
  }
}

/** Return To Game: back where you were, with the login i-frames. */
export function closeEditor(world: World, p: Player): Outgoing[] {
  if (!p.editing) {
    return [];
  }
  p.editing = null;
  p.flicker = 40;
  const out: Outgoing[] = [{ to: p.id, msg: { t: "editor", editing: false } }];
  out.push(...enterRoom(world, p));
  return out;
}

/**
 * Whether a placed item name is allowed: what `/drop` allows, and a cauldron that already has its
 * id (`Cauldron#12`), so a map that holds one saves again.
 */
export const editorItemOk = (name: string) => {
  if (droppableName(name)) {
    return true;
  }
  const m = /^(.+)#\d+$/.exec(name);
  return !!m && hasBehaviour(m[1] as string, "cauldron") && droppableName(m[1] as string);
};

/** Why a save is refused, or null. */
export function saveError(m: EditorMap): string | null {
  return editorMapError(m, editorItemOk);
}

/** What applying a save changed, for the caller to write in one transaction. */
export interface SaveResult {
  out: Outgoing[];
  removed: string[];
  added: GroundItem[];
}

/**
 * Applies a validated save to a live map in place, so every player and room holding it sees the
 * change: tiles, walk grid, flags, header, signs, exits, fog; the placed monsters become the roster
 * and the live monsters at full HP where they were placed; the map's `admin` items become the
 * placed ones. Everyone on the map gets the map again.
 */
export function applySave(
  world: World,
  target: WorldMap,
  m: EditorMap,
  newId: () => string,
  now: number = Date.now(),
): SaveResult {
  target.layers = [[...m.layers[0]], [...m.layers[1]], [...m.layers[2]], [...m.layers[3]]];
  target.walk = footWalkGrid(target.layers[0], target.layers[1]);
  target.walkAir = airshipWalkGrid(target.layers[1]);
  target.walkShip = shipWalkGrid(target.layers[0]);
  target.flags = { ...m.flags };
  target.title = m.header;
  target.signs = [...m.signs];
  target.exit1 = m.exit1 ? { ...m.exit1 } : null;
  target.exit2 = m.exit2 ? { ...m.exit2 } : null;
  target.fog = { ...m.fog };

  const room = world.rooms.get(target.name);
  const events: DeltaEvent[] = [];
  target.slots.forEach((s, i) => {
    const placed = m.mobs[i] ?? null;
    if (s.live) {
      events.push({ e: "mgone", slot: s.slot });
    }
    const name = placed ? (editorMobName(placed.name) ?? placed.name) : null;
    s.species = name;
    s.home = placed ? { x: placed.x, y: placed.y } : null;
    s.pause = 0;
    s.dirty = true;
    // `name:HP:x:y` with the species' HP, as a spawn takes it.
    s.live =
      name && placed
        ? {
            name,
            hp: spawnHp(name),
            x: placed.x,
            y: placed.y,
            facing: "S",
            anim: 0,
            fromX: placed.x,
            fromY: placed.y,
            queue: [],
            hitCountb: 0,
          }
        : null;
  });

  const removed = target.ground.filter((g) => g.kind === "admin").map((g) => g.id);
  // Each name passed `editorItemOk`; a counted pile reads back as `/drop` writes it.
  const added: GroundItem[] = m.items.map((it) => {
    const pile = parseDrop(it.name) ?? { item: it.name, qty: 1 };
    // 1.6's item save renamed an exact "Cauldron" to `Cauldron#<id>`, and one with an id kept it:
    // SSO's id is unique. A cauldron is an item with the `cauldron` behaviour.
    if (!pile.item.includes("#") && hasBehaviour(pile.item, "cauldron")) {
      pile.item = `${pile.item}#${mintContainerId(world, now)}`;
    }
    return {
      id: newId(),
      item: pile.item,
      ...(pile.qty > 1 ? { qty: pile.qty } : {}),
      x: it.x,
      y: it.y,
      kind: "admin",
      expiresAt: null,
    };
  });
  target.ground = [...target.ground.filter((g) => g.kind !== "admin"), ...added];

  const out: Outgoing[] = [];
  for (const p of room?.players ?? []) {
    if (events.length > 0) {
      out.push({ to: p.id, msg: { t: "delta", events } });
    }
    out.push({ to: p.id, msg: refreshSnapshot(p, target, room?.players ?? []) });
  }
  return { out, removed, added };
}

/**
 * The map, items and monsters again, without a map change. A craft keeps running, so `you` says
 * so even when it started after the map was last told (the client keeps its key lock by it).
 */
export function refreshSnapshot(p: Player, m: WorldMap, all: readonly Player[]) {
  const { crafting: _shown, ...view } = playerView(p);
  const you: PlayerView = craftingInPlace(p) ? { ...view, crafting: true } : view;
  return {
    t: "snapshot" as const,
    map: mapView(m),
    you,
    self: selfState(p),
    players: all.filter((o) => o !== p).map(playerView),
    monsters: liveMonsterViews(m),
    ground: m.ground.map(groundView),
  };
}

/** The alert after a save. */
export const SAVED = TEXT.mapSaved;

/** Rows of a map as the history keeps them (map_versions.data). */
export function versionData(m: WorldMap): unknown {
  return {
    title: m.title,
    layers: m.layers,
    flags: m.flags,
    exit1: m.exit1,
    exit2: m.exit2,
    signs: m.signs,
    fog: m.fog,
    roster: m.slots.map((s) => ({ species: s.species, home: s.home ?? null })),
    items: m.ground
      .filter((g) => g.kind === "admin")
      .map((g) => ({ name: dropText(g), x: g.x, y: g.y })),
  };
}
