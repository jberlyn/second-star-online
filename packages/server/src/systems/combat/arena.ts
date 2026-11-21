/**
 * The arena challenge: `Challenge` and `quit` typed as chat lines, and the hop they share with the
 * arena death. The checks and rolls are in shared/rules/combat/arena.ts. Hold and the death wait
 * refuse both commands, and neither puts you on a tile someone or something already holds (bugs
 * fixed; 1.6 tested only for a step in progress). A rider cannot challenge (a bug fixed) and, over
 * an arena tile, is not in the arena, so it cannot quit either: arenas are for players on foot.
 */
import {
  ARENA_TEXT,
  type ArenaCheck,
  CHAT_COLOR,
  challengeCheck,
  type DeltaEvent,
  findArenaTile,
  pickArenaExit,
  quitCheck,
  type Rng,
  type TileTaken,
} from "@secondstaronline/shared";

import { groundBlocks } from "../inventory/items.ts";
import { isFootprint } from "../monsters/slots.ts";
import { aqsToMap } from "../social/factions.ts";
import { type Outgoing, type Player, playerView, type Room, type World } from "../world/world.ts";

const FOOTPRINT_TILES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, -1],
  [1, -1],
  [2, -1],
];

/**
 * A tile already holding another player, a live monster (any tile of an Overlord's or Mutant
 * Worm's footprint) or a ground item that blocks walking.
 */
export function arenaTileTaken(room: Room | undefined, self: Player): TileTaken {
  if (!room) {
    return () => false;
  }
  return (x, y) =>
    room.players.some((o) => o !== self && o.x === x && o.y === y) ||
    room.map.slots.some((s) => {
      const m = s.live;
      if (!m) {
        return false;
      }
      const cells = isFootprint(m.name) ? FOOTPRINT_TILES : FOOTPRINT_TILES.slice(0, 1);
      return cells.some(([cx, cy]) => m.x + cx === x && m.y + cy === y);
    }) ||
    groundBlocks(room, self, x, y);
}

/** Hold, or the wait after death, as the arena checks see them. */
function arenaState(p: Player): { held: boolean; dead: boolean } {
  return { held: p.spell.hold > 0, dead: p.deadLock > 0 || p.dontHitMeAgain };
}

/**
 * The hop (the `3` message): a teleport with no walk. The mover's own client is told through
 * `forceYou`; the returned events re-place the sprite for the others.
 */
export function hopTo(p: Player, x: number, y: number): DeltaEvent[] {
  p.x = x;
  p.y = y;
  p.stepFrames = 0;
  p.forceYou = true;
  return [
    { e: "leave", id: p.id },
    { e: "enter", player: playerView(p) },
  ];
}

function hopOut(world: World, p: Player, x: number, y: number): Outgoing[] {
  const events = hopTo(p, x, y);
  const room = world.rooms.get(p.map.name);
  return (room ? room.players : [])
    .filter((o) => o !== p)
    .map((o) => ({ to: o.id, msg: { t: "delta", events } }));
}

function checkText(p: Player, r: ArenaCheck): Outgoing[] | null {
  if (r.kind === "text") {
    return [{ to: p.id, msg: { t: "chat", text: r.text, color: CHAT_COLOR.normal } }];
  }
  return r.kind === "silent" ? [] : null;
}

/** The `Challenge` command. */
export function challenge(world: World, p: Player, rng: Rng): Outgoing[] {
  const r = challengeCheck({
    stepFrames: p.stepFrames,
    ...arenaState(p),
    riding: p.vehicle,
    layer1: p.map.layers[0],
    x: p.x,
    y: p.y,
  });
  const early = checkText(p, r);
  if (early) {
    return early;
  }
  const room = world.rooms.get(p.map.name);
  const tile = findArenaTile(p.map.layers[0], rng, arenaTileTaken(room, p));
  if (!tile) {
    return checkText(p, { kind: "text", text: ARENA_TEXT.full }) ?? [];
  }
  return [...aqsToMap(world, p, ARENA_TEXT.entered(p.name)), ...hopOut(world, p, tile.x, tile.y)];
}

/** The `quit` command. */
export function quitArena(world: World, p: Player, rng: Rng): Outgoing[] {
  const r = quitCheck({
    stepFrames: p.stepFrames,
    ...arenaState(p),
    riding: p.vehicle !== null,
    layer1: p.map.layers[0],
    x: p.x,
    y: p.y,
  });
  const early = checkText(p, r);
  if (early) {
    return early;
  }
  const room = world.rooms.get(p.map.name);
  const tile = pickArenaExit(p.map.layers[0], p.map.walk, rng, arenaTileTaken(room, p));
  if (!tile) {
    return [];
  }
  return [...aqsToMap(world, p, ARENA_TEXT.stopped(p.name)), ...hopOut(world, p, tile.x, tile.y)];
}
