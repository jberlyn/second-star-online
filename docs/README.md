# Documentation

## Operating and modding Second Star Online

Current instructions for running, configuring, and extending the game:

- [Running a server](running-a-server.md): public container images and standalone Docker Compose setup, updates, optional source builds, reverse proxies and TLS, environment variables, roles, admin commands, settings, editors, and backups.
- [Script reference](scripts.md): development, build, test and operator commands.
- [Modding](modding.md): installing and exporting packs, editing content, configuring classes and world events, adding art and sound, and extending spell effects.
- [System and client guides](guides/README.md): gameplay behaviour and where each system lives in the codebase.
  - [Skills](guides/skills/README.md): each of the 38 skills, how it rises, what it does and the systems it touches.
- [Performance](performance.md): measured capacity, tick timing, and running load tests.

Reference pages kept beside what they describe:

- [Classic pack content](../packages/data/content/README.md): the editable content files.
- [Added assets](../assets/added/README.md): art and sounds added to the originals.
- [Original assets](../assets/original/usage.md): every 1.6 bitmap and sound and what the asset build does with it (generated).
- [Server systems](../packages/server/src/systems/README.md): the server's system folders.
- [Tools](../tools/README.md): maintenance scripts outside the game.

## Architecture and differences from 1.6

- [Architecture specification](architecture.md): package boundaries, protocol design, and engineering principles.
- [Differences from 1.6](differences-from-fso.md): the remake's policy and every deliberate difference from First Star Online 1.6, including fixed bugs and bugs kept on purpose.

