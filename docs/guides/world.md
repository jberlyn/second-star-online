# World

## What happens in play

When a character enters a map, players already there see the arrival and the arriving player receives a snapshot of the map, its occupants, monsters and ground items. Later changes arrive as updates; walking off an edge moves the character to the neighboring map.

## Where it lives

- [packages/server/src/systems/world/world.ts](../../packages/server/src/systems/world/world.ts): defines world, room, map and player state, creates the world, builds views and manages arrivals and departures.
- [packages/server/src/systems/world/tick.ts](../../packages/server/src/systems/world/tick.ts): advances the simulation, coordinates system passes, map changes, outgoing updates and save requests.

Entry points include `packages/server/src/systems/world/world.ts` (`createWorld`), `packages/server/src/systems/world/world.ts` (`enterRoom`), `packages/server/src/systems/world/world.ts` (`leaveRoom`), `packages/server/src/systems/world/world.ts` (`addPlayer`), `packages/server/src/systems/world/world.ts` (`removePlayer`) and `packages/server/src/systems/world/tick.ts` (`tick`).

## How it works

The world keeps players and rooms; each occupied room has a map, players and transient effects. Entry announces the player to current occupants before adding them and preparing their snapshot. Entry also starts a loading lock, resets several per-map counters, clears the key lock and the walk queue, closes an open vault, container, board or mailbox, cancels crafts and, on a no-fight, indoor, no-PvP map other than the jail, saves the respawn point. A warp also ends a trade and any open casino game first. Departure announces a leave and unloads an empty room. Views sent to clients are built from server state rather than giving clients authority over that state.

Each tick collects outgoing messages and work to save. For each room it advances loading, places queued spells and runs counters and collision work. Its actor pass advances regeneration, player sprite timers, monster spawning and actions, and spell effects. After the first actor pass the key poll handles attack before movement; an exit under a player is checked before starting a step. Further actor passes then run. Room events are sent to their recipients. After the room loop come, in order, queued portals and exits, the server timer (hazards and the church bell), due gives, loot decay, edge crossings, respawns, the casino, jail releases and mute ends; then the cooldowns count down and medal lines print. Portals, exits and edge crossings do nothing on the jail map, and a death there revives in the jail. The tick gathers changed state and save requests; the server's persistence wiring performs the actual writes.

## Differences from 1.6

Every character has a respawn point from creation, the starting map, replaced on entering a no-fight, indoor, no-PvP map; a death or jail release goes there, and a lost place (a deleted map or decayed house) goes to the fallback map instead (see [every character has a respawn point](../differences-from-fso.md#every-character-has-a-respawn-point) and [respawn points](../running-a-server.md#respawn-points)). Jail sentences run in real time and survive map changes and logouts. The server holds a loading lock until the client is ready or the timeout expires, and runs exactly two actor passes per frame, without the original's occasional extra passes. See the [server-side world changes](../differences-from-fso.md#server-side-world), [movement bugs fixed](../differences-from-fso.md#movement) and [server-side movement changes](../differences-from-fso.md#server-side-movement).
