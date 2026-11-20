# Repository guidance

Second Star Online is a server-authoritative browser game. `packages/shared` contains pure game rules and protocol schemas; `packages/server` owns authoritative simulation and persistence; `packages/client` contains the browser interface; `packages/data` builds editable content and assets; `packages/perf` supplies load scenarios. The root `tests/` folder holds repository-wide checks (import rules, doc paths, pinning-test names) and `tools/` holds maintenance scripts.

Use Bun: `bun run dev`, `bun run build`, `bun run test`, and `bun run gate`. Keep game rules pure where practical, validate client intents at the server, and pass I/O dependencies to systems. See [architecture](docs/architecture.md) and the [system guides](docs/guides/README.md).

Edit game data in `packages/data/content/`, validate it against the schemas, and regenerate committed modules with `bun run data:build`. Build atlases with `bun run assets:build`; do not edit generated atlases. Preserve retained art geometry and annotate interactive DOM controls with semantic actions.

Second Star Online is a remake that fixes 1.6's exploits and bugs but keeps the feel of the original; do not preserve a 1.6 bug just because the original had it. Add meaningful regression tests for behavior changes. Record every deliberate difference from 1.6, including fixed bugs and bugs kept on purpose, in [differences from 1.6](docs/differences-from-fso.md), alongside the code and pinning tests. Check relevant interactions in a browser when changing the interface.

Project skills live in `.agents/skills/` (linked from `.claude/skills/`). When preparing a release or writing release notes, follow [release-notes](.agents/skills/release-notes/SKILL.md).
