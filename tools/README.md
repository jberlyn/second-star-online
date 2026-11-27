# Tools

`docker-smoke.ts` exercises the local production container, including persistence and proxy handling. Run it with `bun run docker:check`; see [running a server](../docs/running-a-server.md) for setup.

`recolour-icon.ts` recolours an original item icon onto a colour ramp and writes it, with its sidecar, as added art in `assets/added/items/` (the burned foods, Raw Meat and Cooked Meat were made with it): `bun tools/recolour-icon.ts "Orc Meat" "Burned Orc Meat" char`. Run `bun run assets:build` afterwards.

`spell-art.ts` draws the effects, cast sounds and book icons for the seven spells that had no art in 1.6 (Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon, Identify) and writes them, with their sidecars, to `assets/added/fx/`, `assets/added/sounds/` and `assets/added/items/`. Everything is drawn from fixed seeds, so it always writes the same files; change the script and run it again rather than editing its output: `bun tools/spell-art.ts [--preview <dir>]` (`--preview` also writes a 4x contact sheet per spell there). Run `bun run assets:build` and `bun run data:build` afterwards.

Use `bun tools/upgrade-rehearsal.ts <copy.sqlite>` to rehearse a release migration on a Classic database snapshot taken with SQLite's `VACUUM INTO` or from a backup. The script expects Classic as the sole installed pack and compares the published data with Classic, allowing for migrated death-drop settings. A customized world can therefore fail this comparison after a successful migration.

The rehearsal works on temporary copies. It compares pre-existing tables while accounting for expected migration changes, checks that existing characters can enter and leave the world, and runs a bot through character creation, content download, movement and chat. Failed checks produce exit status 1.
