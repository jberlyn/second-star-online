# Content

The game's data, as the files `bun run data:build` reads. Edit these to change the game; the build validates each one against its strict Zod schema in `../schema/` (an unknown or missing field fails the build) and writes the **Classic pack** in `../packs/classic/` (a manifest and one JSON file per dataset), which is committed. The server reads the pack at start-up and clients fetch the merged store from the server; nothing here is compiled into the engine. `pack.json` is the pack's manifest source: its `version` is bumped by the build whenever the content's hash changes. The seed maps are still written as modules in `../src/generated/`.

For modding workflows, rule precedence, and worked examples, see the [Modding guide](../../../docs/modding.md).

| File | What it holds | Read by |
|---|---|---|
| `jail-map.json` | the enclosed Jail at x0y0, with arrival tile 4,4 | migration inserts it when absent; existing jails are preserved |
| `church-map.json` | the Church of the Bells at x999y999, the enclosed map the church bell sounds on | migration inserts it when absent; existing church maps are preserved |
| `seed-map.json` | the title and four layers of Willowbrook Wilds, the fresh-server starter landscape | first map creation; existing maps are preserved |
| `tiles.json` | the tile catalogue (`code`, hover `name`, `member`, `flags`), the walk whitelist (`walkable`), and single-tile `defaults` | movement, housing, spells, the map editor, the client draw and hover tip |
| `items.json` | the item catalogue (name, which is the item's permanent key; an optional `display` name and `sprite` art key; archived spellings; icon: an original member or added art), fixtures, the World Editor's item list, the player-shop whitelist | inventory, shops, drops, the World Editor |
| `attpower.json`, `item-rules.json` | weapon power; the item rules: equip, use, armour, breaks, the item menu, the paperdoll, ground items, containers, gear bonuses, the swing | combat, inventory, spells, the paperdoll |
| `classes.json` | classes, their stat bonuses and promotions, the skills (keyed by `skill`, with their `display` names and `hidden` marks), the start classes and their starting skills, the skills each weapon trains on a kill | creation, promotion, skill gain, the Skills tab |
| `bindings.json` | what the engine needs a world to name: today the skills its mechanics read (`skills`); a binding left out turns its mechanic off | combat, spells, gathering, crafting |
| `monsters.json` | monster stats, `editorLists`, name-matched `rules`, `casting`, melee affinities, skill caps, `generic` | the monster, combat, quest and editor systems |
| `spells.json` | spell rows: cost, crystals, harmful, book, Info, summon, FX runs with frames and sounds; `effect` | spells, client audio, spellbook |
| `gather.json`, `craft.json` | gathering and crafting tables | gathering, crafting |
| `houses.json` | house types, placement, doors and keys | housing |
| `social.json` | factions, guilds, chat rooms, Bios, medals, mail, boards, art tools | the social systems |
| `casino.json`, `quests.json`, `help.json` | the casino tables, quest pools, help topics | casino, quests, help |
| `npc-files.json` | each NPC script `<Name>.txt` as one string (lines joined by CR) | the NPC file store |
| `pack.json` | the Classic pack's id, name, version, format, the SSO release it targets and its content hash | the data build (it bumps the version when the hash changes) |

- **NPC files** are loaded at every server start as the base NPC store, not only when seeding. The in-game NPC Editor saves its edits to the `npc_files` table, which the server applies on top of this file (`packages/server/src/systems/monsters/npcfiles.ts`), so on a running server an edit here shows wherever the database has no saved version of that NPC.
- **Fixed sizes.** Lists may grow, except where the code or the art needs a count: a map is 12 rows of 17 tokens in 4 layers, there are 3 factions, 5 chat rooms, 4 paint tools, 24 checkers squares, and the Bio strip has room for 14 medals.
- **Release baseline rows** are fingerprinted in `../tests/content-baseline.json`; `content-baseline.test.ts` detects changed, removed or reordered baseline rows. Review intentional changes and update the affected fingerprints and behavior docs.
## Commands

- `bun run data:build` — validate `content/` against `../schema/`, write the Classic pack to `../packs/classic/` (bumping its version when the content changed) and the seed maps to `../src/generated/`.
- `bun run data:check` — verify the pack and the generated modules are current.
- `bun run assets:build` — rebuild sprite atlases and sound index after adding art or audio in `assets/added/`.
- `bun run content:report <name>` — list every name rule matching `<name>` (run after `data:build`).

## Modding guides

- [Workflow and validation](../../../docs/modding.md#workflow-and-validation)
- [Ordered name tables](../../../docs/modding.md#ordered-name-tables)
- [Items](../../../docs/modding.md#items-itemsjson-item-rulesjson-attpowerjson) (including the Moonblade example)
- [Tiles](../../../docs/modding.md#tiles-tilesjson) (including the Z9 deep-water tile example)
- [Monsters and NPCs](../../../docs/modding.md#monsters-and-npcs-monstersjson-npc-filesjson) (including body-number traps and the Frost Wolf example)
- [Spells](../../../docs/modding.md#spells-spellsjson) (including the Ice Shard example and adding a new effect)
- [Skills](../../../docs/modding.md#skills-classesjson) (including the Swimming example)
- [Art and sound](../../../docs/modding.md#art-and-sound)
- [The content report](../../../docs/modding.md#the-content-report)
