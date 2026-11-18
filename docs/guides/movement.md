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

Loading a map or a window holding the keys locks input. Attack animation, a hold effect and the death lock also stop movement: a legacy pending press waits and expires if it cannot be acted on in time. A scheduled request waits for the current step to finish and for the attack animation (a few ticks), because the attack key is sent when pressed but steps are sent on client ticks, so a step sent just before an attack can reach the server's swing tick. A scheduled request that reaches the server during a hold, the death lock, loading or a key lock is refused. The browser predicts the attack lock from the attack key with the server's attack rules (a bow with no arrows or no crystal is refused before the swing, so it locks nothing), so it does not send a step during the lock; the server's `swing` then corrects the cooldowns.

Each refusal names one request by its sequence number (`moveRejected`); the requests queued behind it are checked on their own, and a key or loading lock refuses the whole queue. A refused predicted step causes an immediate correction, while matching acknowledgements preserve the local animation. A correction writes off every request already sent, because they were predicted from the discarded position: the browser ignores refusals of requests up to the last one it sent before correcting, so requests still in flight cannot cause another correction.

A turn does not start while already stepping. A step checks player and monster footprints first, then items, then a web on the current tile. An off-map step becomes an edge crossing; otherwise the destination must be walkable. An edge crossing wraps to the neighboring map, and the server refuses it when there is no map beyond or the wrapped tile is not walkable there. The world tick handles crossings, exits and warps and sends room changes. The same movement checks apply to pushes, including chains of pushes; rolls are collected before the resulting shoves. A vehicle uses its own step length and does not push players.

## Unfixed bugs and differences

Movement has no unfixed 1.6 bugs. A player blocks the tile they are stepping onto, so two players never share a tile; only an Overlord or Mutant Worm blocks three wide; a Web or Holy Shield can be walked onto but clears no other block. A weaker player cannot shove you, an edge crossing onto a wall or a missing map is refused, the web line prints once a press, and only a press that turns you refills the fishing allowance. The server controls movement and immediately reports a changed facing to other players. See the [movement bugs fixed](../differences-from-fso.md#movement) and [server-side movement changes](../differences-from-fso.md#server-side-movement).
