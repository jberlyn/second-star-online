/**
 * The arena challenge: `Challenge` and `quit` typed as chat lines, and the hop they share with the
 * arena death. The checks and rolls are in shared/rules/combat/arena.ts. Neither command tests the
 * Airship, Hold, the death wait or HP, so Hold and the death wait don't stop the arena words (a
 * kept 1.6 bug).
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
} from "@secondstaronline/shared";

import { aqsToMap } from "../social/factions.ts";
import { type Outgoing, type Player, playerView, type World } from "../world/world.ts";

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
    layer1: p.map.layers[0],
    x: p.x,
    y: p.y,
    record: { layers: p.map.layers, signs: p.map.signs, title: p.map.title },
  });
  const early = checkText(p, r);
  if (early) {
    return early;
  }
  const tile = findArenaTile(p.map.layers[0], rng);
  if (!tile) {
    return []; // 799 misses: silent
  }
  return [...aqsToMap(world, p, ARENA_TEXT.entered(p.name)), ...hopOut(world, p, tile.x, tile.y)];
}

/** The `quit` command. */
export function quitArena(world: World, p: Player, rng: Rng): Outgoing[] {
  const r = quitCheck({ stepFrames: p.stepFrames, layer1: p.map.layers[0], x: p.x, y: p.y });
  const early = checkText(p, r);
  if (early) {
    return early;
  }
  const grid = p.vehicle === "Airship" ? p.map.walkAir : p.map.walk;
  const tile = pickArenaExit(p.map.layers[0], grid, rng);
  if (!tile) {
    return [];
  }
  return [...aqsToMap(world, p, ARENA_TEXT.stopped(p.name)), ...hopOut(world, p, tile.x, tile.y)];
}
