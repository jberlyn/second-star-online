# Content

The game's data, as the files `bun run data:build` reads. Edit these to change the game; the build validates each one against its strict Zod schema in `../schema/` (an unknown or missing field fails the build) and writes the typed modules in `../src/generated/`, which are committed.

For modding workflows, rule precedence, and worked examples, see the [Modding guide](../../../docs/modding.md).

| File | What it holds | Read by |
|---|---|---|
| `jail-map.json` | the enclosed Jail at x0y0, with arrival tile 4,4 | migration inserts it when absent; existing jails are preserved |
| `seed-map.json` | the title and four layers of Willowbrook Wilds, the fresh-server starter landscape | first map creation; existing maps are preserved |
| `tiles.json` | the tile catalogue (`code`, `member`, `flags`), the walk whitelist (`walkable`), and single-tile `defaults` | movement, housing, spells, the map editor, the client draw |
| `items.json` | the item catalogue (name, archived spellings, icon: an original member or added art), fixtures, the World Editor's item list, the player-shop whitelist | inventory, shops, drops, the World Editor |
| `attpower.json`, `item-rules.json` | weapon power; the item rules: equip, use, armour, breaks, the item menu, the paperdoll, ground items, containers, gear bonuses, the swing | combat, inventory, spells, the paperdoll |
| `classes.json` | classes and promotions, the skills, the Skills page rows, starting skills | creation, promotion, the Skills tab |
| `monsters.json` | monster stats, `editorLists`, name-matched `rules`, `casting`, melee affinities, skill caps, `generic` | the monster, combat, quest and editor systems |
| `spells.json` | spell rows: cost, crystals, harmful, book, Info, summon, FX runs with frames and sounds; `effect` | spells, client audio, spellbook |
| `gather.json`, `craft.json` | gathering and crafting tables | gathering, crafting |
| `houses.json` | house types, placement, doors and keys | housing |
| `social.json` | factions, guilds, chat rooms, Bios, medals, mail, boards, art tools | the social systems |
| `casino.json`, `quests.json`, `help.json` | the casino tables, quest pools, help topics | casino, quests, help |
| `npc-files.json` | each NPC script `<Name>.txt` as one string (lines joined by CR) | the NPC file store |

- **NPC files** are only the seed for a fresh database. The in-game NPC Editor saves its edits to the `npc_files` table, which the server reads on top of this file (`packages/server/src/systems/monsters/npcfiles.ts`), so on a running server an edit here shows only where the database has no saved version of that NPC.
- **Fixed sizes.** Lists may grow, except where the code or the art needs a count: a map is 12 rows of 17 tokens in 4 layers, there are 3 start classes, 3 factions, 5 chat rooms, 4 paint tools, 24 checkers squares, and the Bio strip has room for 14 medals.
- **Release baseline rows** are fingerprinted in `../tests/content-baseline.json`; `content-baseline.test.ts` detects changed, removed or reordered baseline rows. Review intentional changes and update the affected fingerprints and behavior docs.
## Commands

- `bun run data:build` — validate `content/` against `../schema/` and regenerate `../src/generated/`.
- `bun run data:check` — verify generated modules are current.
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
