# Repository guidance

Second Star Online is a server-authoritative browser game engine. Its content (items, monsters, NPCs, maps, art and sounds) comes from installed packs plus the operator's own layer, edited and published live from the Control Panel; the 1.6 remake is the Classic pack (`packages/data/packs/classic/`, built from `packages/data/content/` and `assets/`). `packages/shared` contains pure game rules and protocol schemas; `packages/server` owns authoritative simulation and persistence; `packages/client` contains the browser interface; `packages/data` builds editable content and assets; `packages/perf` supplies load scenarios. The root `tests/` folder holds repository-wide checks (import rules, doc paths, pinning-test names) and `tools/` holds maintenance scripts.

Use Bun: `bun run dev`, `bun run build`, `bun run test`, and `bun run gate`. Keep game rules pure where practical, validate client intents at the server, and pass I/O dependencies to systems. See [architecture](docs/architecture.md) and the [system guides](docs/guides/README.md).

When killing processes during development, make sure each one is yours and not owned by another person or session. Other sessions run their own dev servers, and a hosted server can run as the same user with the same command line (`bun packages/server/src/main.ts`), so `pkill -f`, `killall` or a PID found with `pgrep`/`ps` can stop someone else's server. Stop only what you started, by the PID you got when you launched it, by stopping your background task, or by your own port (`fuser -k <port>/tcp`).

Edit Classic pack data in `packages/data/content/`, validate it against the schemas, and regenerate committed modules with `bun run data:build`. Build atlases with `bun run assets:build`; do not edit generated atlases. Preserve retained art geometry and annotate interactive DOM controls with semantic actions.

The Classic pack remakes 1.6: it fixes 1.6's exploits and bugs but keeps the feel of the original; do not preserve a 1.6 bug just because the original had it. Add meaningful regression tests for behavior changes. Record every deliberate difference from 1.6, including fixed bugs and bugs kept on purpose, in [differences from 1.6](docs/differences-from-fso.md), alongside the code and pinning tests. Check relevant interactions in a browser when changing the interface.

Project skills live in `.agents/skills/` (linked from `.claude/skills/`). When preparing a release or writing release notes, follow [release-notes](.agents/skills/release-notes/SKILL.md).
