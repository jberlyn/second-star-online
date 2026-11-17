# Repository guidance

Second Star Online is a server-authoritative browser game. `packages/shared` contains pure game rules and protocol schemas; `packages/server` owns authoritative simulation and persistence; `packages/client` contains the browser interface; `packages/data` builds editable content and assets; `packages/perf` supplies load scenarios.

Use Bun: `bun run dev`, `bun run build`, `bun run test`, and `bun run gate`. Keep game rules pure where practical, validate client intents at the server, and pass I/O dependencies to systems. See [architecture](docs/architecture.md) and the [system guides](docs/guides/README.md).

Edit game data in `packages/data/content/`, validate it against the schemas, and regenerate committed modules with `bun run data:build`. Build atlases with `bun run assets:build`; do not edit generated atlases. Preserve retained art geometry and annotate interactive DOM controls with semantic actions.

Add meaningful regression tests for behavior changes. Explain kept gameplay bugs in the [bug ledger](docs/bug-ledger.md) and deliberate differences in [divergences](docs/divergences.md), alongside their code and pinning tests. Check relevant interactions in a browser when changing the interface.

Project skills live in `.agents/skills/` (linked from `.claude/skills/`). When preparing a release or writing release notes, follow [release-notes](.agents/skills/release-notes/SKILL.md).
