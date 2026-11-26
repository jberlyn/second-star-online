# Tools

`docker-smoke.ts` exercises the local production container, including persistence and proxy handling. Run it with `bun run docker:check`; see [running a server](../docs/running-a-server.md) for setup.

`recolour-icon.ts` recolours an original item icon onto a colour ramp and writes it, with its sidecar, as added art in `assets/added/items/` (the burned foods, Raw Meat and Cooked Meat were made with it): `bun tools/recolour-icon.ts "Orc Meat" "Burned Orc Meat" char`. Run `bun run assets:build` afterwards.

`spell-art.ts` draws the effects, cast sounds and book icons for the seven spells that had no art in 1.6 (Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon, Identify) and writes them, with their sidecars, to `assets/added/fx/`, `assets/added/sounds/` and `assets/added/items/`. Everything is drawn from fixed seeds, so it always writes the same files; change the script and run it again rather than editing its output: `bun tools/spell-art.ts [--preview <dir>]` (`--preview` also writes a 4x contact sheet per spell there). Run `bun run assets:build` and `bun run data:build` afterwards.

`upgrade-rehearsal.ts` rehearses an upgrade on a copy of a real server's database before a release with migrations goes live: the migrations run, the server starts on the installed packs, every table that existed before compares equal after (characters, bags, equipment, maps, ground items), every existing character enters the world and leaves, and a bot creates a character, fetches the content store and plays. It works on its own copies and never changes the file it is given. Take the copy with SQLite's `VACUUM INTO` (or from a backup), then run `bun tools/upgrade-rehearsal.ts <copy.sqlite>`; it exits 1 if any check fails.
