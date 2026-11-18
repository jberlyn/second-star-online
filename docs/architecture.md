# Architecture

Second Star Online is a server-authoritative browser remake of First Star Online 1.6 that fixes its exploits and bugs but keeps the feel of the original. The [system guides](guides/README.md) describe the implemented behavior; deliberate differences, fixed bugs and bugs kept on purpose are documented in [differences from 1.6](differences-from-fso.md), and bugs not yet fixed in the [bug ledger](bug-ledger.md).

## Packages and boundaries

- `packages/shared` contains protocol schemas and pure rules used by server and client prediction.
- `packages/server` contains the gateway, simulation, SQLite persistence, migrations and operator commands.
- `packages/client` is plain TypeScript, DOM and Canvas2D, without a UI framework.
- `packages/data` contains editable content, strict schemas, generated game modules and the asset build.
- `packages/perf` contains load bots and performance scenarios.

Bun runs the server, bundles the client and runs tests. A single production process serves the prebuilt client and WebSocket from the same origin; the container runs as a non-root user. See [running a server](running-a-server.md) for deployment, proxy settings and operational details.

Rules and simulation use plain functions with dependencies passed in. The gateway owns sockets and message validation; persistence modules own SQL; startup wires the database, clock, random source and send functions together. Systems receive their dependencies rather than importing gateway or persistence modules. Shared imports only data and Zod; the client does not import the server. Tests enforce these boundaries. Test fixtures are not production dependencies.

## Simulation and protocol

The server runs a fixed 20 Hz simulation. Active maps are rooms with their own players, monsters, tiles, items and effects. Each frame applies the actor phase twice in its established order, then the frame logic and ensuing map changes and updates. Rules use injected randomness and clocks so seeded replays can reproduce outcomes. Gameplay cadence is enforced by the simulation.

Messages are JSON over WebSocket. Zod validates inbound messages; clients send intents and the server determines outcomes. Sender identity comes from the authenticated session. The server sends a snapshot on map entry and subsequent updates, acknowledgements and movement corrections. Token buckets limit incoming intent rates. Account roles come from the database, and privileged commands and editor writes are validated on the server.

Passwords use Bun's Argon2id support. Sessions can resume after a temporary disconnect. Login, creation and socket limits are enforced at the gateway; operators can configure trusted proxy hops. State-changing operations execute in SQL transactions; failures roll back SQL and the affected session reloads its state on login.

## Persistence and settings

SQLite uses WAL mode and migrations. Database access is synchronous and grouped by area in plain persistence modules. Primary keys use UUIDv7 except for parent-keyed value tables and migration bookkeeping. Accounts and characters are separate; current play creates one character with its account. Gold or item movement is atomic. Economy changes, deaths and progression are written through; vitals and position also receive periodic saves.

Stored data includes characters, inventory, maps and versions, NPC files and versions, shops, houses, guilds, mail, boards, social lists, settings and administrative logs. Editor saves are validated, and saved NPC files override the seed data. Settings have typed defaults and are applied when saved. Admin commands, world and NPC editor saves, setting changes and role changes are audited; newspaper saves are not.

## Content and assets

Edit the JSON in `packages/data/content/` and run `bun run data:build`. The build validates strict schemas and emits committed typed modules. `bun run data:check` detects missing, stale or extra generated modules. The NPC text seeds a fresh database; saved edits take precedence. The [modding guide](modding.md) explains content editing and the release fingerprint baseline.

The asset build reads retained bitmaps, sound and layout metadata in `assets/original/`, plus additions in `assets/added/`, and generates atlases and their indexes. Atlases are build output and are not edited by hand. Sprite positioning uses member dimensions and registration points; unstretched sprites use their member's size. Added art uses a sidecar with its group and registration point. The data build derives server collision rectangles from retained and added art.

## Client

The client uses a 544×384 logical canvas for the playfield and DOM components for controls and windows. The game frame scales as a unit; floating windows scale with it. The client predicts movement and the power bar using shared rules, then reconciles with the server. Combat results, loot and economy outcomes remain authoritative. Input uses the established directional priority and sends intents; interactive DOM controls carry semantic action identifiers.

## Tests and dependencies

`bun run gate` runs type checking, lint, tests and generated-data checks. The suite includes rule tests, seeded simulation replays, real in-memory SQLite tests, happy-dom client tests and bot end-to-end tests against a server. Differences from 1.6 and unfixed bugs have named pinning tests linked from their documents. Changes to the interface should also be checked in a browser.

Prefer web-platform and Bun built-ins. Zod is the runtime validation dependency; TypeScript, Biome, Bun types and happy-dom are development dependencies. Add a dependency only with its reason documented here.
