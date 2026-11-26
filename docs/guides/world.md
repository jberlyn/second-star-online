# World

## What happens in play

When a character enters a map, players already there see the arrival and the arriving player receives a snapshot of the map, its occupants, monsters and ground items. Later changes arrive as updates; walking off an edge moves the character to the neighboring map.

## Where it lives

- [packages/server/src/systems/world/world.ts](../../packages/server/src/systems/world/world.ts): defines world, room, map and player state, creates the world, builds views and manages arrivals and departures.
- [packages/server/src/systems/world/tick.ts](../../packages/server/src/systems/world/tick.ts): advances the simulation, coordinates system passes, map changes, outgoing updates and save requests.
- [packages/shared/src/rules/world/events.ts](../../packages/shared/src/rules/world/events.ts): the world events' rules (issue #3): counters, offerings, counter perks, drift and `/counter`.
- [packages/server/src/systems/world/events.ts](../../packages/server/src/systems/world/events.ts): runs an offering in place of a drop, drifts the counters once a minute and answers `/counter`.
- [packages/server/src/persistence/counters.ts](../../packages/server/src/persistence/counters.ts): saves and loads the counters' values (`world_counters`).

Entry points include `packages/server/src/systems/world/world.ts` (`createWorld`), `packages/server/src/systems/world/world.ts` (`enterRoom`), `packages/server/src/systems/world/world.ts` (`leaveRoom`), `packages/server/src/systems/world/world.ts` (`addPlayer`), `packages/server/src/systems/world/world.ts` (`removePlayer`) and `packages/server/src/systems/world/tick.ts` (`tick`).

## How it works

The world keeps players and rooms; each occupied room has a map, players and transient effects. Entry announces the player to current occupants before adding them and preparing their snapshot. Entry also starts a loading lock, resets several per-map counters, clears the key lock and the walk queue, closes an open vault, container, board or mailbox, cancels crafts and, on a no-fight, indoor, no-PvP map other than the jail, saves the respawn point. A warp also ends a trade and any open casino game first. Departure announces a leave and unloads an empty room. Views sent to clients are built from server state rather than giving clients authority over that state.

Each tick collects outgoing messages and work to save. For each room it advances loading, places queued spells and runs counters and collision work. Its actor pass advances regeneration, player sprite timers, monster spawning and actions, and spell effects. After the first actor pass the key poll handles attack before movement; an exit under a player is checked before starting a step. Further actor passes then run. Room events are sent to their recipients. After the room loop come, in order, queued portals and exits, the server timer (hazards and the church bell), due gives, loot decay, edge crossings, respawns, the casino, jail releases and mute ends; then the cooldowns count down and medal lines print. Portals, exits and edge crossings do nothing on the jail map, and a death there revives in the jail. The tick gathers changed state and save requests; the server's persistence wiring performs the actual writes.

A map's walkability comes from the tile tables: when a publish changes the walk list or a tile's flags, every loaded map's walk grids are worked out again on the server and on each client, so a tile made walkable can be stepped on at once. Operators add tiles and change their pictures, names, walkability and flags on the Pictures & Sounds page (see [Tiles](../running-a-server.md#tiles)); the server gives a new tile a code no pack, content row or map uses (`nextTileCodes` and `tileRefs` in [packages/shared/src/content/tiles.ts](../../packages/shared/src/content/tiles.ts)), reading loaded maps from memory and the rest from the database (`tileMaps` on the content world). The World Editor's palette and the maps on screen are drawn again when a publish changes the tiles.

### World events

World events (the `events` dataset, edited on the Control Panel's World Events page) are named counters the whole world shares, offerings that change them and counter perks that read them; the Classic pack builds 1.6's elemental orb war from them. The world keeps each counter's value in `world.counters`. At start each counter content defines takes its saved value (kept inside its bounds) or its `start`, and a publish does the same, so a new counter starts and a narrowed one is brought inside its new bounds. A change marks the counters for the next write, which saves them in the same transaction as the bags (`persistItems`), so an orb is never used up without its counter moving.

A drop runs its usual refusals first (a busy player, a pause, a vehicle, mid-step). Then, before the faced tile's containers and the crowded test, `offeringDrop` looks for an item on the faced tile that the world placed (`kind: "admin"`: the World Editor, a staff `/drop` or the world seed) and an offering naming both it and the dropped item (case, `#id` and `+N` ignored). The offering's class test and checks run in order, and the first that fails says its refusal and keeps the item; otherwise its changes are made (each kept inside the counter's bounds), one of the item is used up unless the offering keeps it, the player hears its message and each announcement goes to every online player of its classes (or everyone) in broadcast colour. A player's own drop is never an altar. Once a minute of running, each counter with a drift moves toward its target (`driftTick`). The counter perks add to spell power (`basePower`), melee (`attackPower`) and defence (`factionRows`) beside the faction and class perks: the server passes `world.counters` into the caster and the fighter it builds. Staff with the content editor's permission read and set the counters with `/counter` (audited).

## Differences from 1.6

The elemental orb war works: see [the elemental orb war works](../differences-from-fso.md#the-elemental-orb-war-works).

Every character has a respawn point from creation, the starting map, replaced on entering a no-fight, indoor, no-PvP map; a death or jail release goes there, and a lost place (a deleted map or decayed house) goes to the fallback map instead (see [every character has a respawn point](../differences-from-fso.md#every-character-has-a-respawn-point) and [respawn points](../running-a-server.md#respawn-points)). Jail sentences run in real time and survive map changes and logouts. The server holds a loading lock until the client is ready or the timeout expires, and runs exactly two actor passes per frame, without the original's occasional extra passes. See the [server-side world changes](../differences-from-fso.md#server-side-world), [movement bugs fixed](../differences-from-fso.md#movement) and [server-side movement changes](../differences-from-fso.md#server-side-movement).
