# Script reference

These commands are for source development and custom builds. To host the standard game, use the [public image quick start](running-a-server.md#docker-compose-recommended). Run the commands below from the repository root. Install [Bun](https://bun.sh/) and run `bun install --frozen-lockfile` first. Commands that start the server use `SSO_DB` if set, or `sso.sqlite` in the working directory; a new database is migrated and seeded on first start. See [running a server](running-a-server.md) for deployment, database and proxy configuration.

## Develop and build

| Command | What it does |
| --- | --- |
| `bun run dev` | Builds assets, then runs the server with development serving and hot reload. Opens the configured database. |
| `bun run start` | Runs the server in its configured mode. Production serving requires a previously built `dist/client/index.html`. |
| `bun run build` | Runs `assets:build`, then `build:client`. |
| `bun run build:client` | Bundles and minifies the browser client into `dist/client/`. Build assets separately when needed. |
| `bun run assets:build` | Generates the engine's UI art and interface sounds with their index under the data package's generated assets directory, the Classic pack's atlases and sounds in `packages/data/packs/classic/art/`, and Minimal's atlases in `packages/data/packs/minimal/art/`, each with its own index (gitignored); skips an unchanged build. It also updates `assets/original/usage.md` if its generated inventory differs. Pass `--force` to rebuild. |
| `bun run data:build` | Validates Classic and Minimal, writes their manifests and datasets under `packages/data/packs/`, and regenerates the seed map modules in `packages/data/src/generated/`. Each changed pack gets a version bump in its source manifest. The build preserves each pack's `art/` and `files/` folders. |
| `bun run data:import-fso` | Converts a 1.6 reference copy's maps, rosters and placed items (`.fso/FSOServer/DAT`, git-ignored) into the Classic pack's world seed, `packages/data/content/world.json`. A maintenance step: the result is committed, so run `data:build` after it. |
| `bun run data:check` | Renders both expected packs and the modules and reports missing, stale or extra files, or a content change without a version bump, without writing them. |

See the [modding guide](modding.md) before changing content or adding art. Run `data:build` after content changes and `assets:build` after art or audio changes.

## Check and format

| Command | What it does |
| --- | --- |
| `bun run typecheck` | Runs TypeScript project build checks; declaration output goes to ignored `.tsbuild/` directories. |
| `bun run lint` | Runs Biome checks over the configured files without applying fixes. |
| `bun run format` | Formats configured files in place. |
| `bun run fix` | Runs Biome checks and applies its permitted fixes in place. |
| `bun run test` | Runs repository-wide tests, then every workspace's tests at once, each with its own configuration. This includes client happy-dom tests and server bot end-to-end tests; the server's test files run on parallel workers. It needs no build first. |
| `bun run test:sweep` | Runs the content removal sweep over every Classic item and monster with every cleanup option (a few minutes); `bun run test` runs a seeded sample of it. Set `SSO_SWEEP_SEED` to try another seed. |
| `bun run gate` | Runs typecheck, lint, test and `data:check` in that order. |

Each workspace also has a `test` script; from its directory, `bun run test` runs that package's tests only. Use the root test script for the full suite so the client loads its happy-dom configuration. Server tests hash passwords at a cheaper Argon2id cost than a server does (`packages/server/tests/helpers/fast-hash.ts`), and the bot harness's `settle()` waits until both ends of every bot's socket have caught up rather than for a fixed time.

The behaviour snapshot and the seeded replay compare against golden files. After reviewing an intended change, set `SSO_UPDATE_GOLDEN=1` to record the new files; see [the safety net](modding.md#the-safety-net).

## Operate and measure

| Command | What it does |
| --- | --- |
| `bun run content:report <name>` | Reports matching name rules, catalogue entries and NPC seed-text matches using the generated data. Run `data:build` first after content edits; saved NPC edits in a database can differ from the seed. |
| `bun run admin:role <name> <role id\|none>` | Gives an existing account (by its name or its character's) one of the roles in the database selected by `SSO_DB`, such as `administrator` or `moderator`, or takes its role away with `none`, and records an audit entry. The change applies on that account's next login. `bun run admin:role --list` lists the roles, their permissions and who holds them. |
| `bun run admin:audit [n]` | Prints the most recent audit entries (default 50). Admin commands (except `/inventory`, `/location` and `/banlist`), World Editor and NPC file saves, setting changes, role changes and Assassin's Game mode changes are recorded; newspaper saves are not. Bans, jails, IP bans, mutes and pardons are recorded here too, and also in the moderation log, which `/auditlog` in game reads for them instead. It opens the selected database and runs migrations if needed. |
| `bun run admin:chatlog [name] [--channel <channel>] [--since <time>] [--until <time>] [-n <count>]` | Prints the chat log from the database selected by `SSO_DB`, oldest first (default the newest 50 lines). With a name, the lines that character sent and the IMs sent to them; times are ISO dates or date-times in UTC. It opens the selected database and runs migrations if needed. See [the chat log](running-a-server.md#the-chat-log). |
| `bun run maps:check` | Lists travel that leads nowhere in the database selected by `SSO_DB`: exits whose target map does not exist, `Exit` or `Exit2` tiles on a map with no such exit set, and start point, fallback point, jail, church bell map or Portal target settings whose map does not exist. It also lists a start point, fallback point or jail whose tile cannot hold a player, and a start or fallback point on the jail's map. In play, travel to a missing map is refused ("You cannot go that way."). Exits with a non-zero status when it finds any. |
| `bun run perf [scenario]` | Runs a load scenario (default `town`) and writes reports and scratch data under `perf-results/`. See [performance](performance.md) for scenarios, options and host requirements; Docker and browser modes have additional prerequisites. |
| `bun run docker:check` | Builds the local image and exercises it with isolated Compose projects, temporary volumes and a TLS proxy. Requires Docker with Compose and host `openssl`; it creates and removes test containers and volumes, writes scratch logs under `perf-results/docker-smoke-<time>/`, and updates the local `second-star-online:local` image. |

The Compose quick start and safe production configuration are in [running a server](running-a-server.md).
