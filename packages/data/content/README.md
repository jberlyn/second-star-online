# Content

The Classic pack's data, as the files `bun run data:build` reads (the Minimal pack's are in `../minimal/`). Edit these to change the game; the build validates each one against its strict Zod schema in `../schema/` (an unknown or missing field fails the build) and writes the **Classic pack** in `../packs/classic/` (a manifest and one JSON file per dataset), which is committed. The server reads the pack at start-up and clients fetch the merged store from the server; nothing here is compiled into the engine. `pack.json` is the pack's manifest source: its `version` is bumped by the build whenever the content's hash changes. The seed maps are still written as modules in `../src/generated/`.

For modding workflows, rule precedence, and worked examples, see the [Modding guide](../../../docs/modding.md).

| File | What it holds | Read by |
|---|---|---|
| `jail-map.json` | SSO's enclosed Jail at x0y0, with arrival tile 4,4 (a new Classic world has 1.6's) | migration inserts it when absent on an upgraded server; existing jails are preserved |
| `church-map.json` | the Church of the Bells at x999y999, the enclosed map the church bell sounds on (a new Classic world has none, as in 1.6) | migration inserts it when absent on an upgraded server; existing church maps are preserved |
| `seed-map.json` | the title and four layers of Willowbrook Wilds, the starter landscape servers made before the Classic world seed | the original map migration (a new world then replaces it with `world.json`); existing maps are preserved |
| `world.json` | the Classic pack's world seed: 1.6's 27 distributed maps with their roster and placed items, and the start, fallback, jail and bell points (`bun run data:import-fso` writes it from a 1.6 reference copy) | a new world, when its database is created; existing maps are preserved |
| `tiles.json` | the tile catalogue (`code`, hover `name`, `member`, `flags`), the walk whitelist (`walkable`), and single-tile `defaults` | movement, housing, spells, the map editor, the client draw and hover tip |
| `items.json` | the item catalogue (name, which is the item's permanent key; an optional `display` name and `sprite` art key; archived spellings; a `retired` mark; icon: an original member or added art), fixtures, the World Editor's item list, the player-shop whitelist, and optional item `definitions` (one item's rules in one record; Classic has none) | inventory, shops, drops, the World Editor |
| `attpower.json`, `item-rules.json` | weapon power; the item rules: item behaviours, tools and their swing ladders, requirements, equip, use, armour, breaks, the item menu, the paperdoll, ground items, containers, gear bonuses, the swing | combat, inventory, spells, the paperdoll |
| `classes.json` | classes, their stat bonuses and promotions (and, for operators, their perks, training, paths and descriptions: issue #15), the skills (keyed by `skill`, with their `display` names and `hidden` marks), the start classes and their starting skills, the skills each weapon trains on a kill or hit, and how each skill rises (`progression`: models, sources, stat tables, XP curves and the advance line) | creation, promotion, skill gain, the Skills tab |
| `bindings.json` | what the engine needs a world to name: the currency, a new character's vitals and bag, the cannon's ammo, the special bodies and the skills its mechanics read; a binding left out turns its mechanic off (the currency is required) | the purse and gold piles, creation, the cannon, Morph, Nature Shift, Smoke Bomb, vehicles, combat, spells, gathering, crafting |
| `monsters.json` | monster stats (with an optional `level`, fixed `killXp` and `skillXp`) and species `flags`, `editorLists`, name-matched `rules`, `casting`, melee affinities, skill caps, `generic`, and optional monster `definitions` (Classic has none) | the monster, combat, quest and editor systems |
| `spells.json` | spell rows: cost, crystals, harmful, book, Info, summon, school and the other skills a cast trains, power table, how long it lasts, its own amounts, what casting it requires, Create Food's items, FX runs with frames and sounds; `effect`; the `power` tables | spells, client audio, spellbook |
| `gather.json`, `craft.json` | gathering (the hit table, harvest nodes with their yields, odds, respawn and strike effects, mining, fishing and its catch pool, farming, regrowth, treasure) and the crafting stations' tables; `craft.json` may also hold recipe stations, recipes and masterworks (Classic has none) | gathering, crafting |
| `houses.json` | deeds, house types (guild halls among them) and placement previews, furniture, doors, keys and vehicle definitions | housing, vehicles |
| `balance.json` | combat, monsters, spells, regeneration, hunger, death and drops, vehicle and cannon rules, timings, XP and levels | simulation and the Control Panel's Game Rules page |
| `events.json` | world events: shared counters, offerings and counter perks (Classic's are the elemental orb war) | world events and the Control Panel's World Events page |
| `social.json` | factions (keyed by `key`, with their perks by tier), guilds, chat rooms, Bios, medals, mail, boards, art tools | the social systems |
| `casino.json`, `quests.json`, `help.json` | the casino tables, quest pools, help topics | casino, quests, help |
| `npc-files.json` | each NPC script `<Name>.txt` as one string (lines joined by CR) | the NPC file store |
| `pack.json` | the Classic pack's id, name, version, format, the SSO release it targets and its content hash | the data build (it bumps the version when the hash changes) |

- **NPC files** are loaded at every server start as the base NPC store, not only when seeding. The Control Panel's **Creatures & NPCs → Talk & Shops** tab saves its edits to the `npc_files` table, which the server applies on top of this file (`packages/server/src/systems/monsters/npcfiles.ts`), so on a running server an edit here shows wherever the database has no saved version of that NPC.
- **Fixed sizes.** Lists may grow, except where the code or the art needs a count: a map is 12 rows of 17 tokens in 4 layers, `factionRules.editorBoxes` (the World Editor's faction boxes) names at most 3 factions, there are 5 chat rooms, 4 paint tools, 24 checkers squares, and the Bio strip has room for 14 medals.
- **Release baseline rows** are fingerprinted in `../tests/content-baseline.json`; `content-baseline.test.ts` detects changed, removed or reordered baseline rows. Review intentional changes and update the affected fingerprints and behavior docs.
## Commands

- `bun run data:build` — validate `content/` against `../schema/`, write the Classic pack to `../packs/classic/` (bumping its version when the content changed) and the seed maps to `../src/generated/`; it builds the Minimal pack from `../minimal/` into `../packs/minimal/` the same way.
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
- [House types](../../../docs/modding.md#deeds-and-house-types-housesjson-deeds-types) and [vehicles](../../../docs/modding.md#vehicles-housesjson-vehicles)
- [Balance](../../../docs/modding.md#balance-balancejson) and [world events](../../../docs/modding.md#world-events-eventsjson)
- [Skills](../../../docs/modding.md#skills-classesjson) (including classes, progression and the Quarrying example)
- [Bindings](../../../docs/modding.md#bindings-bindingsjson) and [the content contract](../../../docs/modding.md#the-content-contract)
- [Pack format](../../../docs/modding.md#pack-format)
- [Art and sound](../../../docs/modding.md#art-and-sound)
- [The content report](../../../docs/modding.md#the-content-report)
