# Movement

## What happens in play

Hold an arrow to walk; hold the turn control with a direction to face that way without stepping. If two arrows are held, left takes priority over right, then up, then down. A blocked step can turn the character without moving it.

## Where it lives

- [packages/shared/src/rules/movement/movement.ts](../../packages/shared/src/rules/movement/movement.ts): selects held directions, checks steps, wraps edges and advances step animation.
- [packages/client/src/input.ts](../../packages/client/src/input.ts): turns held keys into the `move` intent and the step the client wants next.
- [packages/client/src/model.ts](../../packages/client/src/model.ts): predicts steps, commits their directions and reconciles authoritative updates.
- [packages/shared/src/protocol/core.ts](../../packages/shared/src/protocol/core.ts): the `move` and `step` messages, the `move` and `turn` events others see, and `moveRejected` in the player's own state.
- [packages/server/src/systems/movement/movement.ts](../../packages/server/src/systems/movement/movement.ts): applies player input, movement locks, collisions and movement events.
- [packages/server/src/systems/movement/push.ts](../../packages/server/src/systems/movement/push.ts): rolls and applies pushes to other players.

Entry points include `packages/shared/src/rules/movement/movement.ts` (`resolveHeld`), `packages/shared/src/rules/movement/movement.ts` (`attemptMove`), `packages/shared/src/rules/movement/movement.ts` (`edgeWrap`), `packages/server/src/systems/movement/movement.ts` (`setHeld`), `packages/server/src/systems/movement/movement.ts` (`scheduleStep`), `packages/server/src/systems/movement/movement.ts` (`movePlayer`) and `packages/server/src/systems/movement/push.ts` (`rollPushes`).

## How it works

The browser selects a direction at each predicted tile boundary and sends an ordered step request with its starting map, tile and step count. The server queues at most four requests, checks the starting state, enforces the step cadence and decides collision. It never independently chooses another held direction for these requests. This keeps overlapping keys on the same path despite different client and server tick phases. Legacy clients can still send held input. The server sends the resulting position and movement to players.

Loading a map, a window holding the keys or a running craft locks input. Attack animation, a hold effect and the death lock also stop movement: a legacy pending press waits and expires if it cannot be acted on in time. A scheduled request waits for the current step to finish and for the attack animation (a few ticks), because the attack key is sent when pressed but steps are sent on client ticks, so a step sent just before an attack can reach the server's swing tick. A scheduled request that reaches the server during loading, a key lock or a craft is refused, as is a fifth queued request; during a hold or the death lock the request at the head of the queue is refused, one a tick. The browser predicts the attack lock from the attack key with the server's attack rules (a bow with no arrows or no crystal is refused before the swing, so it locks nothing), so it does not send a step during the lock; the server's `swing` then corrects the cooldowns.

Each refusal names one request by its sequence number (`moveRejected`); the requests queued behind it are checked on their own, and a key, loading or craft lock refuses the whole queue at once. A refused predicted step causes an immediate correction, while matching acknowledgements preserve the local animation. A correction writes off every request already sent, because they were predicted from the discarded position: the browser ignores refusals of requests up to the last one it sent before correcting, so requests still in flight cannot cause another correction.

A turn does not start while already stepping. A step checks player and monster footprints first, then items, then a web on the current tile. An off-map step becomes an edge crossing; otherwise the destination must be walkable. An edge crossing wraps to the neighboring map, and the server refuses it when there is no map beyond or the wrapped tile is not walkable there on the player's own grid: on foot, the Airship's, or water for a Boat or Battleship. The jail map never wraps, and its edges refuse without a line. The world tick handles crossings, exits and warps and sends room changes. Stepping toward a standing player rolls the balance row `combat.pushOneIn` (Classic: 1 in 25) to shove them the same way (`push.ts`). A role with `unpushable`, a player in a key lock and a player still loading cannot be shoved, though a crafter can, and a shove stops their craft; a pusher with less Strength only tells the victim. The shove uses the victim's own Turn key and the same movement checks, including chains of pushes; rolls are collected before the resulting shoves. A step on foot takes 16 step frames, 0.4 seconds. A flying vehicle (Classic: the Airship) steps in half that time and a ship at walking pace (`stepLengthFor`). Aboard, the walkable tiles are the ones the vehicle's row crosses: nothing blocks a flying vehicle, while a ship is blocked by players, monsters and fixtures as a walker is, and neither is held by a web. A rider never pushes and is never pushed, and a flying rider blocks no one.

## Differences from 1.6

A player blocks the tile they are stepping onto, so two players never share a tile; only an Overlord or Mutant Worm blocks three wide; a Web or Holy Shield can be walked onto but clears no other block. A weaker player cannot shove you, an edge crossing onto a wall or a missing map is refused, and the web line prints once a press. The server controls movement and immediately reports a changed facing to other players. See the [movement bugs fixed](../differences-from-fso.md#movement) and [server-side movement changes](../differences-from-fso.md#server-side-movement).
