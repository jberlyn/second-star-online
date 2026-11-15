# Game system guides

These guides describe the game in play and where its current implementation lives.

- [Admin](admin.md): operator commands and editing tools.
- [Casino](casino.md): games and wagers.
- [Chat](chat.md): messages, rooms and ignore.
- [Combat](combat.md): melee and arenas.
- [Core](core.md): shared rules used across systems.
- [Crafting](crafting.md): gathering and crafting.
- [Economy](economy.md): shops, banking and trade.
- [Housing](housing.md): houses, doors and keys.
- [Inventory](inventory.md): items and equipment.
- [Mail](mail.md): messages, boards, news and art.
- [Monsters](monsters.md): spawns, movement and attacks.
- [Movement](movement.md): walking, collisions and pushing.
- [Progression](progression.md): character growth, vitals and death.
- [Social](social.md): guilds, factions and presence.
- [Spells](spells.md): casting, effects and learning.
- [Vehicles](vehicles.md): Airship building, travel and parking.
- [World](world.md): rooms, simulation ticks and state.
- [Client](client.md): input, rendering, audio and screens.

## How the pieces fit

Shared rules provide pure calculations to both client and server. Server systems apply the game rules to authoritative world state. Data and editable content supply game values; the gateway receives and validates messages and routes them to game dispatch. The world tick coordinates systems and outgoing updates. Persistence writes stored state; settings and command-line tools configure and operate the server. The perf package runs load and soak scenarios.

For example, `packages/client/src/input.ts` (`keyDown`) turns an arrow press into movement intents, which `packages/client/src/net.ts` (`connect`) sends over the connection. `packages/client/src/app.ts` sends the intents using the schemas in [core protocol](../../packages/shared/src/protocol/core.ts). `packages/server/src/gateway/server.ts` (`startGateway`) validates incoming messages and sends them to `packages/server/src/game.ts` (`createGame`), whose dispatch calls `packages/server/src/systems/movement/movement.ts` (`setHeld`) or `packages/server/src/systems/movement/movement.ts` (`pressStep`). `packages/server/src/systems/world/tick.ts` (`tick`) invokes movement and collects resulting state for the client. A movement message does not itself imply a database write: [server startup](../../packages/server/src/main.ts) wires the database and game, and the game uses [persistence modules](../../packages/server/src/persistence/) to save state separately.

See the [documentation index](../README.md), [running a server](../running-a-server.md), [modding](../modding.md), [architecture specification](../architecture.md), [kept bugs](../bug-ledger.md), [differences](../divergences.md).
