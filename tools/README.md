# Tools

`docker-smoke.ts` exercises the local production container, including persistence and proxy handling. Run it with `bun run docker:check`; see [running a server](../docs/running-a-server.md) for setup.

`recolour-icon.ts` recolours an original item icon onto a colour ramp and writes it, with its sidecar, as added art in `assets/added/items/` (the burned foods, Raw Meat and Cooked Meat were made with it): `bun tools/recolour-icon.ts "Orc Meat" "Burned Orc Meat" char`. Run `bun run assets:build` afterwards.
