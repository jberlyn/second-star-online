# Game system guides

These guides describe the game in play and where its current implementation lives.

- [Admin](admin.md): operator commands and editing tools.
- [Casino](casino.md): games and wagers.
- [Chat](chat.md): messages, rooms and ignore.
- [Combat](combat.md): melee and arenas.
- [Core](core.md): shared rules used across systems.
- [Crafting](crafting.md): gathering, station crafts, recipe books and the crafting window.
- [Economy](economy.md): shops, banking and trade.
- [Housing](housing.md): houses, guild halls, placement previews, doors and keys.
- [Inventory](inventory.md): items and equipment.
- [Mail](mail.md): mailboxes, message boards, newspapers, paintings and photos.
- [Monsters](monsters.md): spawns, movement, attacks, levels, NPCs and the Creatures editor.
- [Movement](movement.md): walking, step requests, collisions, edge crossings and pushing.
- [Progression](progression.md): creation, classes and their paths, promotions, the Class window, kill experience and levels, medals, vitals, hunger and death.
  Each skill has its own page in the [skill guides](skills/README.md).
- [Social](social.md): guilds and their halls, factions, friends, bios, the Who list, murder, the Assassin's game and high scores.
- [Spells](spells.md): casting, effects, buffs, monster spells, server hazards and learning from books.
- [Vehicles](vehicles.md): vehicles as content rows (Classic's Airship, Boat and Battleship): building, travel, parking, hulls and removal.
- [World](world.md): rooms, simulation ticks, travel and respawn points, and world events (counters, offerings and counter perks), including the elemental orb war.
- [Client](client.md): input, prediction, rendering, hover tips, audio, screens, windows and the Control Panel.

## How the pieces fit

Shared rules provide pure calculations to both client and server. Server systems apply the game rules to authoritative world state. Data and editable content supply game values; the gateway receives and validates messages and routes them to game dispatch. The world tick coordinates systems and outgoing updates. Persistence writes stored state; settings and command-line tools configure and operate the server. The perf package runs load and soak scenarios.

For example, `packages/client/src/input.ts` (`keyDown`) turns an arrow press into a `move` intent (the held direction and Turn) and records the step it wants in the client's pending intent. `packages/client/src/app.ts` sends the intents using the schemas in [core protocol](../../packages/shared/src/protocol/core.ts) over the connection from `packages/client/src/net.ts` (`connect`); the step itself goes out from the frame loop, twenty times a second, through `packages/client/src/model.ts` (`clientTick`), which predicts it and sends it stamped with the tick it is meant for (`at`). `packages/server/src/gateway/server.ts` (`startGateway`) validates incoming messages and sends them to `packages/server/src/game.ts` (`createGame`), whose dispatch calls `packages/server/src/systems/movement/movement.ts` (`setHeld`) for a `move`, which for the browser records only Turn, and `packages/server/src/systems/movement/movement.ts` (`scheduleStep`) for a step with `at`, which queues it (`pressStep` handles only a step without `at`). `packages/server/src/systems/world/tick.ts` (`tick`) then runs `packages/server/src/systems/movement/movement.ts` (`movePlayer`) on the queue and collects resulting state for the client. A movement message does not itself imply a database write: [server startup](../../packages/server/src/main.ts) wires the database and game, and the game uses [persistence modules](../../packages/server/src/persistence/) to save state separately.

See the [documentation index](../README.md), [running a server](../running-a-server.md), [modding](../modding.md), [architecture specification](../architecture.md), [differences from 1.6](../differences-from-fso.md).
