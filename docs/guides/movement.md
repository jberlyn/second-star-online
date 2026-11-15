# Movement

## What happens in play

Hold an arrow to walk; hold the turn control with a direction to face that way without stepping. If two arrows are held, left takes priority over right, then up, then down. A blocked step can turn the character without moving it.

## Where it lives

- [packages/shared/src/rules/movement/movement.ts](../../packages/shared/src/rules/movement/movement.ts): selects held directions, checks steps, wraps edges and advances step animation.
- [packages/client/src/model.ts](../../packages/client/src/model.ts): predicts steps, commits their directions and reconciles authoritative updates.
- [packages/server/src/systems/movement/movement.ts](../../packages/server/src/systems/movement/movement.ts): applies player input, movement locks, collisions and movement events.
- [packages/server/src/systems/movement/push.ts](../../packages/server/src/systems/movement/push.ts): rolls and applies pushes to other players.

Entry points include `packages/shared/src/rules/movement/movement.ts` (`resolveHeld`), `packages/shared/src/rules/movement/movement.ts` (`attemptMove`), `packages/shared/src/rules/movement/movement.ts` (`edgeWrap`) and `packages/server/src/systems/movement/movement.ts` (`movePlayer`).

## How it works

The browser selects a direction at each predicted tile boundary and sends an ordered step request with its starting map, tile and step count. The server queues at most four requests, checks the starting state, enforces the step cadence and decides collision. It never independently chooses another held direction for these requests. This keeps overlapping keys on the same path despite different client and server tick phases. Legacy clients can still send held input. The server sends the resulting position and movement to players.

Loading a map or a window holding the keys locks input. Attack animation, a hold effect and the death lock also delay movement. A legacy pending press expires if it cannot be acted on in time; scheduled requests wait for the current step to finish. A refused predicted step causes an immediate correction, while matching acknowledgements preserve the local animation.

A turn does not start while already stepping. A step checks player and monster footprints first, then items, then a web on the current tile. An off-map step becomes an edge crossing; otherwise the destination must be walkable. An edge crossing wraps to the neighboring map without checking the destination walk grid. The world tick handles crossings, exits and warps and sends room changes. The same movement checks apply to pushes, including chains of pushes; rolls are collected before the resulting shoves. A vehicle uses its own step length and does not push players.

## Kept bugs and differences

Webs on the current tile repeatedly refuse movement. Moving players between tiles do not block one another, and a Web or Holy Shield can clear an earlier blocking result. A weak push can still shove its target, and some movement attempts refresh the fishing allowance even when blocked. The server controls movement and immediately reports a changed facing to other players. See [movement kept bugs](../bug-ledger.md#movement) and [movement differences](../divergences.md#movement).

