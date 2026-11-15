# Second Star Online

**Return to First Star Online in your browser.** Second Star Online is a server-authoritative multiplayer remake of FSO 1.6: explore, fight, trade and build in a familiar interface, with gameplay quirks preserved and harmful exploits closed by the server.

## A world to explore and make your own

Create a character, venture across maps, learn skills and spells, gather resources, craft equipment, and meet monsters and NPCs. Trade with other players, build houses, join guilds and factions, exchange messages, or take a break with casino games and checkers. The game uses original art and sounds; see [NOTICE](NOTICE) for attribution.

Each server starts with a seed world. Operators can build maps and configure NPCs in-game, adjust server settings, and edit game content in JSON. See the [game system guides](docs/guides/README.md) and [modding guide](docs/modding.md) for details.

## Get started

Run locally with Docker and Docker Compose:

```sh
docker compose up -d --build
```

Then open [http://localhost:3000](http://localhost:3000) in your browser. For source development with [Bun](https://bun.sh/):

```sh
bun install --frozen-lockfile
bun run dev
```

The [server guide](docs/running-a-server.md) covers production setup, reverse proxies, TLS, configuration and backups. The server serves the client and WebSocket from the same origin.

## Explore the project

- [Documentation](docs/README.md) — guides, operations, modding and performance.
- [Architecture](docs/architecture.md) — the server, client and data pipeline.
- [Kept bugs](docs/bug-ledger.md) and [deliberate differences](docs/divergences.md) — how the remake handles the original's quirks and exploits.
- [NOTICE](NOTICE) and [LICENSE](LICENSE) — original-material attribution and the SSO code license.

For development commands and checks, see the [contributor command guide](docs/scripts.md).
