# Modding

SSO is the engine; the content comes from **packs**. Each release ships two: the **Classic pack** (1.6's content, the default) and the **Minimal pack** (the bare minimum a world needs, for building your own game; see [Starting a world: Classic or Minimal](#starting-a-world-classic-or-minimal)). Most of this guide describes the datasets every pack fills, with Classic's rows as the examples.

Classic's data lives as JSON files in [packages/data/content/](../packages/data/content/README.md). Together they are the source of the **Classic pack**: each file is validated against its strict Zod schema in [packages/data/schema/](../packages/data/schema/) (unknown or missing fields fail the build) and written to the committed pack in `packages/data/packs/classic/` (a `manifest.json` and one file per dataset). The pack's version lives in `content/pack.json`; the build bumps it whenever the content changes, so servers can tell a changed row from an unchanged one. The server reads the pack from the release at every start and lays the operator's changes on top; clients fetch the result from the server. A few rules that span files or rows are checked by the tests in `packages/data/tests/` rather than by the build (noted below), so run the gate after editing.

The [public image](running-a-server.md#docker-compose-recommended) is ready to host the standard game. In-game map, NPC and settings edits, and content changes made on the Control Panel's [content pages](running-a-server.md#how-the-content-pages-work), persist in your database without rebuilding. To change the content files, assets, or code described below, clone the repository and build a custom image; these files are baked into the image and are not hot-reloaded at runtime.

A new Classic world is 1.6's own distributed maps: its 27 maps with the Test map's roster and placed items, in Classic's [world seed](#world-seeds), [world.json](../packages/data/content/world.json). It is converted once from a 1.6 reference copy in `.fso/` (`bun run data:import-fso`, then `bun run data:build`); edit the JSON directly for small changes. Existing worlds keep their saved maps; use the in-game World Editor to change those. [seed-map.json](../packages/data/content/seed-map.json), [jail-map.json](../packages/data/content/jail-map.json) and [church-map.json](../packages/data/content/church-map.json) are the maps SSO seeded before, still used by the upgrade migrations: a server that predates them gets the Jail and Church where those coordinates are empty. Keep the configured spawn and respawn tiles walkable.

## Workflow and validation

1. Edit the relevant JSON file in [packages/data/content/](../packages/data/content/README.md) (or, for the Minimal pack, `packages/data/minimal/`), and add any new art or audio under [assets/added/](../assets/added/README.md).
2. Rebuild the packs (each changed pack's version is bumped):

   ```sh
   bun run data:build
   ```

3. If you added or changed art or sounds, rebuild the sprite atlases and sound index (each pack's art lands in its `art/` folder under `packages/data/packs/`):

   ```sh
   bun run assets:build
   ```

4. Check for unintended name-rule collisions with `bun run content:report <name>` (see [The content report](#the-content-report)).
5. Run the relevant tests and the full verification gate:

   ```sh
   bun run gate
   ```

6. If you run the server with Docker, use the repository’s source-build `docker-compose.yml` (which builds `second-star-online:local`) and rebuild before restarting: the container bakes the Classic pack, asset atlases, and prebuilt client into the image at build time, so mounted or edited JSON files are not hot-reloaded at runtime:

   ```sh
   docker compose up -d --build
   ```

Release baseline rows are fingerprinted in `packages/data/tests/content-baseline.json`; the corresponding test detects changed, removed or reordered rows. For intentional changes, review and update only the affected fingerprints and relevant behavior documentation.

### The safety net

Golden-file tests record how the Classic pack plays today, so a change to the engine or the content that alters play shows up as a diff rather than going unnoticed.

- **The behaviour snapshot** (`packages/server/tests/behaviour-snapshot.test.ts`) records what every name-based decision returns for every Classic item, masterwork, monster and spell, and for names the game builds at run time (`Crate#12`, `Long Sword+3`, `Bob's Door`, `5 Gold`, `Damaged Helm, Fire`). Each group is a file in `packages/server/tests/golden/behaviour/`, one sorted line per name. The groups cover:
  - keyword tests (keys, books, bows, hidden names, gathering tools), the item rule tables, ground pictures and click and Ctrl routing, containers, and keys turning doors directly and through the server;
  - attack power with the skills each weapon reads, melee damage against each monster, spell defence, paperdoll layers, and equipment breaks for each slot;
  - kill skill gain with each skill and its requirement apart, the order the skills roll in, its roll sizes, the caps and the monster's cap;
  - spell power with each school skill, faction bonus and robe apart, cast skill gain, costs and refusals, and where each spell effect is placed and how it moves;
  - monster bodies and name tables, and what the server does on a click, a Ctrl, a Holy Shield and an attack, for innocent and wanted players, on fighting and no-fight maps;
  - faction perks with each bonus field apart, gathering and crafting tables, and each item used, equipped, clicked and taken through the server.

  Inputs vary one at a time, so a rule wired to the wrong skill or field shows. A roll is recorded by running it with every draw answering 1 and again answering the largest value, with the sizes drawn.
- **The client's goldens**: `packages/client/tests/spell-sounds-snapshot.test.ts` records the sounds of every spell's FX, `creation-classes.test.ts` pins the class each creation radio sends, and `playfield-clicks.test.ts` pins that Smoke Bomb's body cannot be clicked.
- **The seeded replay** (`packages/server/tests/replay.test.ts`) runs a whole server on a seeded random number generator and a fixed clock for 4,000 ticks. Seventeen scripted players, created with each start class in turn, play on three maps:
  - On the start map, with PvP off, they walk, chop, mine, dig, fish from two spots, hoe, plant and water, cook, smith, build, mix potions, buy and sell, eat, drink, read, equip and unequip, open a crate and a carried cabinet, use a key on a door, drop gold, and build and sail a boat.
  - On a field with PvP on, they fight an Orc and cast spells; one dies and respawns at its point in town.
  - In the church, one hears the bell.

  Every tick, the world state and everything the game sent are hashed (skills by name in both, and in the database) into `packages/server/tests/golden/replay.txt`, with a breakdown by player and room every 100 ticks and a hash of every database table at the end. The test also checks that each activity still happens. A failure names the first tick that differs, whether the state or the messages changed, and the parts that changed. To see the change, dump that tick before and after it and diff the two files: `SSO_REPLAY_DUMP=<tick>:<file> bun test tests/replay.test.ts` from `packages/server`.

They record behaviour as it is, 1.6 bugs included. When one of them fails:

1. Review the diff. An unexpected line is a regression, so fix the change.
2. If every changed line is intended, record the new behaviour with `SSO_UPDATE_GOLDEN=1`: from `packages/server`, `SSO_UPDATE_GOLDEN=1 bun test tests/behaviour-snapshot.test.ts tests/replay.test.ts`; from `packages/client`, `SSO_UPDATE_GOLDEN=1 bun test tests/spell-sounds-snapshot.test.ts`. Commit the golden files with the change.
3. If the new behaviour differs from 1.6, add an entry to [the differences document](differences-from-fso.md), with a pinning test.

## Ordered name tables

The original engine classified items, monsters, and spells by testing their names in script order using case-insensitive exact equality (`exact`) or substring matching (`contains`). In SSO, those tests are stored as ordered `{ "match": "exact" | "contains", "pattern": "...", ...result }` rows. Each table uses one of five combination rules:

- **First match wins:** the first matching row supplies the result.
- **Last match wins:** every row is tested in order and the last match overrides earlier ones.
- **Any match:** the table acts as a boolean list (`true` if any row matches).
- **Every match adds:** all matching rows' numeric bonuses or effects are summed.
- **In order:** every matching row applies, one after another in file order (`paperdoll.aliases`, where each row can rename the result of the one before).

Because `contains` tests the entire name string, it also matches runtime-generated names (`Crate#123`, `5 Blue Crystal`, `Long Sword+3`, `Damaged Helm, Fire`) and owner-prefixed fixtures (a player named `"Crate"` owns `"Crate's Door"`). Use `exact` when you want to match only a single name. Two tables also extend `exact` to masterworks: an exact row in `classes.json` `skillGain.weaponSkills` or an exact skill block in `attpower.json` also matches the `+1` to `+N` masterworks that `craft.json` `stations.smith.masterwork` makes from that weapon.

## Items (`items.json`, `item-rules.json`, `attpower.json`)

| Table (`item-rules.json`) | Decides | Wins | Result and default |
|---|---|---|---|
| `behaviours` | What an item does: a key, a book, a bow, a chest, a container and so on ([Item behaviours](#item-behaviours)) | Every match adds | `behaviour`; an item no row matches has none |
| `equip.slots` | Equipment slot | Last | `slot` (`LeftHand` is weapon hand); default `No` (not equippable) |
| `equip.strength` | Strength needed to equip | Last | `strength`; default `0` |
| `equip.twoHanded` | Two-handed weapons | Any | Boolean |
| `equip.murder` | The item that needs the murder flag (a single row, not a list) | Match | Boolean |
| `use.usable`, `use.effects`, `use.messages` | Food and potion use behaviour | See schema | Healing/messages |
| `use.silent` | Use does and says nothing (keys, deeds, seeds, `Map`) | Any | Boolean |
| `use.refusals` | The line Use shows for an item it does not accept (burned food) | Last | `text`; default "You cannot use the X." |
| `use.books` | Mysticism needed for a spell book | Last | `mysticism`; default `1` |
| `use.skillBooks` | Items that teach a skill when read (used up when they teach) | First | `skill`, `points` (a [formula](#formulas)), `xp` and `upTo`; see [Progression](#progression) |
| `menu` | Item menu button in place of Equip | Last | `Cook`, `Mix`, `Build`, `Smith`, or `Storage`; default `Equip` |
| `paperdoll.aliases` | Worn item sprite name | In order, per `layer` | `becomes` sprite name; default is the item's own name |
| `ground.blocks` | Ground items that block players and monsters; one the world placed cannot be picked up | Any | Boolean |
| `ground.platforms` | Blocks until a skill or level reaches `atLeast` | Any | `needs` skill or `level` |
| `ground.overlays` | Animated overlay on a ground item | First | `overlay`; default none |
| `ground.inUse` | Ground items whose overlay animates only while a crafting player faces them | Any | Boolean |
| `ground.layers` | Draw layer | First | `hidden`, `overChars`, or `overLayer3`; default items layer |
| `ground.offsets` | Pixel offset from tile | First | `dx`, `dy`; default `0, 0` |
| `ground.tipless` | Ground items the hover tip never names (exits, overlays, markers) | Any | Boolean |
| `ground.tipNames` | The hover tip's name for a ground item, after any `#id` is dropped | First | `name`: an `exact` row replaces the whole name, a `contains` row the matched part; default the name |
| `pickup.ctrlTexts` | Line Ctrl says on a fixture | First | `text`; `unpause` ends Ctrl's pause |
| `containers.capacity` | Lines a container holds | Last | `capacity`; default `containers.defaultCapacity` |
| `containers.uniqueIds` | Containers assigned a `#id` in a bag | Any | Boolean |
| `gear` | Stat bonus from worn item | Every match adds | `power` (`spell`, `blackArts`, `martialArts`, `attack`, `killXp`), `add`, `slot` |
| `swing.cooldowns` | Swing delays for a worn item | Last | `atDelay`, `actionDelay`; default `14, 14` |
| `tools` | What a tool can do, and its swing ladder (see [Tools and gathering](#tools-and-gathering)) | Every match adds; last `ladder` | `can`, `tier`, `ladder`, `counter` |
| `requires` | What an item needs before it is equipped or used (see [Requirements](#requirements)) | Every match must be met | `on` (`equip`, `use`), `needs` skill or `level`, `atLeast`, `text` |
| `swing.sounds` | Swing sound by weapon | First | Sound name or `null` (silent); default `swordswing` |
| `armour.*`, `breaks.*` | Armour mitigation and breakage | See schema | Mitigation / broken form |

### Item behaviours

1.6 gave an item a mechanic by a word in its name: "Key" opened doors, "bow" shot arrows, " Chest" opened as a chest. In SSO, `item-rules.json` `behaviours` says which items have each mechanic. Each row is `{ "match", "pattern", "behaviour" }`, and an item has every behaviour a row matches. A row tests the name without its `#id` or `+N` ending, so `Crate#12` is a crate and `Knight's Sword +1` is a sword. An item that no row gives a behaviour does not have it: with no `key` rows, no item opens a door.

| Behaviour | What the item does | Classic's rows |
|---|---|---|
| `key` | Use opens the doors its name unlocks (`houses.json` keys) | contains `Key` |
| `book` | Use reads it: a spell book teaches its spell (`use.books`), a skill book its skill (`use.skillBooks`) | contains `Book` |
| `bow` | Shoots the arrows in the off hand, spending a crystal of their colour; no arrows, no swing | the five bows by name |
| `crossbow` | A bow shot also trains Martial Arts | contains `Crossbow` |
| `hidesName` | Worn as body armour, hides the wearer's name from others | contains `Invis` |
| `chest` | Opens with the chest click, takes Drop, and is never carried | contains ` Chest` |
| `cabinet`, `windCabinet`, `crate` | A carried container: opens with a click, is lifted with Ctrl (19 Strength for a cabinet, 15 for a crate), is drawn from that kind's bag and ground pictures, takes Drop once placed, and sells by its `#id` | contains `Cabinet`, `Wind Cabinet`, `Crate` |
| `cauldron` | A carried container that brews `craft.json` recipes as items go in; the world editor gives a placed one its `#id` | contains `Cauldron` |
| `slotMachine`, `blackjackTable`, `checkersTable` | A click or Ctrl plays it | contains `Slot Machine`; `Blackjack Table` and `Checkers Table` by name |
| `highScoreStatue`, `assassinStatue` | Shows the high scores or the assassins' ranking, from any distance | each by name |
| `camera`, `film`, `canvas` | A film used with a camera in the right hand takes a photo; a canvas opens the paint screen; each save spends one | `Camera` and `Canvas` by name; contains `Film` |
| `newspaperKit` | Dropped on a newspaper stand tile, becomes the dropper's newspaper | `Newspaper Kit` |
| `swingFireballs` | Every swing also sends a fireball, by Staff Fighting | `Fire Staff` |
| `sword` | Firesword can light it | each sword by name, and contains `Damaged Sword` |
| `argonsFist` | Use also casts Argon's Fist, with the Argon line in place of its drink line | `Purple Potion` |
| `releasesMonster` | Dropped, it becomes the live monster of the same name (no such monster: it drops as an item) | `Pig` |
| `hidesHead`, `hidesHelm` | Worn as body armour, no hair, or no helmet, is drawn | four robes and outfits; two of them |
| `quiver` | In the off hand, drawn on the back: behind the body facing S or W, over it facing N | contains `Arrows` |
| `hiddenFacingNorth` | In the off hand, not drawn facing N | `Torch` |
| `door` | A click or Ctrl leaves it alone; a key turns the last door on the faced tile (`houses.json` `keys`) | contains `door` |
| `switchDoor` | The open door the switches close and open (`houses.json` `switches`) | contains `Switch Door` |
| `clock` | Its picture shows the server's time | contains `Clock` |
| `map` | Drawn on the ground as the map picture (`MapPic`) | none (1.6 took any name holding "Map", so a "Maple Bow" would have been one; no Classic item has the word) |
| `messageBoard`, `universalMail`, `guildCenter` | A click or Ctrl reads Town Square's board, opens your mail, or opens the guild window | `Message Boards`; contains `Universal Mail`; `Guild Center` |
| `personalVault` | A click or Ctrl opens your vault; Drop facing it puts the item in | `Vault` |
| `noClick` | A click does nothing (Ctrl may still take it); tested where 1.6 tested " Ray", "door" and "exit", before boards, chests and mail | contains ` Ray`, `Sign`, `Lair` |
| `noCtrl` | Ctrl does nothing, when nothing before it answered | contains `Sign`, `Board`, ` Chest`, `Mail`, `Vault`, `Platform`, `Lair`; `Chimney` |

Classic keeps 1.6's words where they did no harm, and names the items where they misfired: `bow` matched Bowmaster's Ring, and Firesword's `sword` matched Swordfish ([differences](differences-from-fso.md)). The item editor (issue #30) will write `exact` rows. `houses.json` `containers.drop` and the `clickFixtures` rows for the Vault, the Guild Center and the casino tables are no longer read: those are behaviours now (Classic keeps the rows, unused). Two 1.6 name tests became rows of existing tables instead: the Ring of Experience's +5 kill XP is a `gear` row with `power` `killXp`, and the Piano's "You can't use this." is a `use.refusals` row.

The click and Ctrl gates test these in 1.6's order, so where a name has two behaviours the earlier test wins (a `noCtrl` item that is also a `chest` opens).

The **engine fixtures** never take a behaviour, and no new content item may take one of their names: the owner-named `<owner>'s Door`, `'s Opened Door`, `'s Mailbox`, `'s Board`, `'s House Vault`, `'s Guild Vault`, `'s Airship`, `'s Boat` and `'s Battleship`, and `Exit`, `Exit2`, `Sign 1` to `Sign 3` and `Street Lamp`. The engine builds or reads these names itself and knows each by its kind, before any other test and from the whole name (a guild called "Stars #1" keeps its board); a pack supplies their art. So a guild named "Crate Club" has a board, not a crate, and a player named "Doorman" a mailbox, not a door. A house type's guild hall and shop are its `guild` flag and `header`, not words in its name.

### Tools and gathering

1.6 knew its tools by name: an "Axe" fell trees, a "Mining" tool swung faster with Mining, a "Fishing" item fished. In SSO, content says what each tool does, and what each tile gives.

**`item-rules.json` `tools`** gives a weapon what it `can` do: `Chop`, `Mine`, `Dig`, `Farm`, `Fish` or `Water`. These are the engine's kinds of gathering. Each row is `{ "match", "pattern", "can"?, "tier"?, "ladder"?, "counter"? }`, and a weapon can do everything a matching row gives it, at that row's `tier` (1 when left out). Each `can` row keeps its own hit counter, named by its `counter` or else its pattern, so an Axe and a Gold Axe share one and each hammer has its own; an exact row written for one item (the item editor's) names the counter of the row it replaces. The last matching row with a `ladder` sets the weapon's swing speed from **`ladders`**: `{ "skill"?, "steps": [{ "below"?, "delay" }], "gearSpeedUp"? }`. The first step whose `below` is above the skill (or that has no `below`) sets the attack delay. `gearSpeedUp` takes the worn gear's speed-up (the Ring of Quickness's) off the step; without it the step replaces the delay outright. A ladder whose `skill` the world lacks is off. Classic's rows: contains `Axe` (`Chop`, and ladder `axe` on Axe Fighting), `Shovel` (`Dig`), `Hoe` (`Farm`), `Watering Bucket` (`Water`), the three hammers (`Mine`), contains `Fishing` (`Fish`), contains `Mining` (ladder `mining` on Mining) and contains `Fishing` again (ladder `fishing`: a flat 20 less the gear's speed-up, never below 1).

**`gather.json` `harvest`** lists the harvest nodes: what a tool that can work a layer-2 tile does there. Several nodes may share a tile, each for its own `tools`; the first one the swung tool can work decides.

| Field | Meaning |
|---|---|
| `tile`, `becomes` | The tile, and what it turns into on a success (`gathering.regrowth.checks` turns it back: a check's `tiles` pairs; a check with no tiles, or `produce: true`, drops farming produce instead, and `produce: false` keeps a check with no pairs a tile check) |
| `can` | The kind of tool that works it: `Chop`, `Mine`, `Dig` or `Farm` |
| `tools` | Only these tools work it, by exact item name (Classic: each hammer its own rock, the Shovel, the Hoe) |
| `tier` | The lowest tool tier that works it (1 when left out). A lower tier is refused: "You need a better tool to mine this." |
| `under` | The layer-1 tile under it must be one of these (the shovel's diggable grounds); two nodes on one tile can split by ground |
| `requires` | `{ "needs", "atLeast", "text"? }` (see [Requirements](#requirements)): "You need Mining 20 to mine this." |
| `skill`, `gains` | The skill whose value reads the shared hit table (`gathering.counterTable`), and whether each success trains it by its `gather` [progression](#progression) (the publish check refuses `gains` on a skill with none) |
| `xp` | The XP a success gives an `xp`-model skill, in place of the skill's own `gather` amount (Copper can give less than Gold) |
| `yield` | A table in `yields`, rolled on every success |
| `treasure` | Every success may uncover the buried treasure (Classic: the dig) |
| `hitSound`, `successSound` | The swing sound when the faced tile is the node's, and the sound to the gatherer on a success |

A refusal is said once, not on every swing, while the attack key stays held. **`yields`** holds the drop tables by name: `{ "kind": "chance", "item", "chance", "bySkill"? }` drops its item on `random(chance) = 1` (Classic's Logs, 1 in 3, and the two chunks, 1 in 130), with the chance taken from the last `bySkill` `{ gt, value }` row the skill is above when it has them; `{ "kind": "ore" }` is the mining strike, whose crystal count, colour pool and ore odds stay in `gathering.mining`. Fishing and watering are their own kinds: a `Fish` tool fishes the `gathering.fishing` water with its catch bands, and a `Water` tool waters `gathering.farming.watering` soil, reading `farming.wateringSkill` for its hits, and sprinkles on every swing. Regrowth stays in `gathering.regrowth.checks`: a new node that should grow back adds a check row there.

The Control Panel's **Gathering & Crafting** page ([Running a server](running-a-server.md#the-gathering--crafting-page)) edits the nodes, their yield tables and regrowth, fishing, farming and the hit counter, with a preview of each skill value and tool tier's chance of success and expected yield.

So a new gathering skill needs no code. For example, add a `Panning` skill, a `Gold Pan` item with a `tools` row `{ "match": "exact", "pattern": "Gold Pan", "can": "Dig" }`, a node `{ "tile": "Q9", "can": "Dig", "tools": ["Gold Pan"], "becomes": "R9", "skill": "Panning", "gains": true, "yield": "Gold Dust", ... }`, a `Gold Dust` chance table, a `gather` progression on Panning (`"progression": { "model": "chance", "on": { "gather": { "roll": 12, "cap": 100 } } }`), and a regrowth check from `R9` back to `Q9`.

### Requirements

An item can need a skill, or the level, before it is equipped or used, and a harvest node before it is gathered. A requirement is `{ "needs", "atLeast", "text"? }`: `needs` is a skill key, or exactly `level`, the shape the skill platforms use. `item-rules.json` `requires` rows add `match`, `pattern` and `on` (`equip` or `use`); a row tests the name without its `#id` or `+N` ending, as the behaviours do (a masterwork needs what its item needs). Every matching row of that kind must be met, and the first that is not refuses with its `text`, else "You need Cooking 10 to use this." ("You need to be level 5 to equip this." for the level). Equip tests it after 1.6's own equip gates, Use before anything else, and the character editor's wear check honours it too. Classic needs nothing.

### Names the engine still builds or reads

These are the engine's own names:

| Name | What reads it |
|---|---|
| `Painting#<id>`, `Photo#<id>` | The engine names the paintings and photos it saves; their pictures and the viewer read the words |
| `Map` (a name containing it) | Drawn with the `MapPic` picture on the ground (no Classic item has it; give an item a `sprite` instead) |
| The newspaper's `'s Newspaper` | `social.json` `newspaper.suffix`: content already |
| `+N` at the end (`Long Sword+3`) | A masterwork: adds `N` to attack power |
| `<Colour> Arrows`, `<Colour> Crystal` | A bow's ammunition: arrows of one of the six colours spend crystals of that colour |

### Adding an item

Add a catalogue entry to `packages/data/content/items.json`, plus rows in `item-rules.json` and `attpower.json` for any behaviour its name does not already match. Most rows match a specific weapon name, not a word: `equip.slots` has a `contains` row for each sword ("Long Sword", "Short Sword", …) and no row for "Sword" alone. So `"Elven Long Sword"` inherits the Long Sword's slot, attack power, Strength and kill training through those `contains` rows, and the generic Sword skill block, but not the Long Sword's Heavy Arms tiers, which are an `exact` block (it still needs a `paperdoll.aliases` row to be drawn as one), but `"Elven Sword"` matches no slot row and cannot be equipped until you add one; a novel name like `"Moonblade"` needs every row. Run `bun run content:report "<name>"` to see which rows a name picks up.

An item's `name` is its permanent key: stored bags, maps, NPC files and every rule table refer to it, so never change it once players hold the item. To change what players see, set `display` (the name shown in the bag, tips, shops, trades and give messages); to draw it with other art, set `sprite` to the atlas name (the Cannonball's `CannonballBag` is an example). Monsters take a `display` name too. `"retired": true` retires an item: copies players hold stay and work, but nothing may make it (no shop, drop, recipe, gathering find or quest may name it, and admins cannot create it); the Control Panel sets it when an operator removes an item players still hold. The same fields can be set live on a running server from the Control Panel's [Items page](running-a-server.md#the-items-page).

What still needs code: a new mechanic (an item that does something no table or [behaviour](#item-behaviours) expresses), new bag or ground pictures for a new kind of container, a new owner-named fixture, and anything whose name is built at run time.

#### Example: Moonblade

This illustrative example adds a sword `"Moonblade"` (`9 + random(6)` base power, Strength `15`, `LeftHand`, drawn when worn as a `Broad Sword`). On a running server, the Control Panel's [Items page](running-a-server.md#the-items-page) does all of this in one form: **+ New item** `Moonblade`, copying `Long Sword`, then change what differs (its damage is typed as a range, **10 to 15**) and publish. In a pack it is two records:

1. **Catalogue (`items.json`, `items`):**

   ```json
   { "name": "Moonblade", "sprite": "Broad Sword" }
   ```

   `sprite` draws the Broad Sword's picture in the bag, the equipment boxes and on the ground. For a picture of its own, leave `sprite` out and place `items/Moonblade.png` and its sidecar under `assets/added/` (with `"icon": "added"`, so a data test checks the file is there), or upload it on a running server's Items page ([Item pictures](running-a-server.md#item-pictures)). An item the art draws no picture for cannot be made with `/drop`.

2. **Its rules, as an [item definition](#item-definitions) (`items.json`, `definitions`):**

   ```json
   {
     "name": "Moonblade",
     "slot": "LeftHand",
     "strength": 15,
     "behaviours": ["sword"],
     "attack": { "base": [{ "flat": 9, "randomN": 6 }] },
     "trains": ["Slash", "Thrust", "Swordsmanship", "Fencing"],
     "paperdoll": [{ "layer": "weapon", "becomes": "Broad Sword" }],
     "breaks": { "weapon": ["LeftHandE"] },
     "damaged": "Damaged Sword, Broad"
   }
   ```

   A base roll is `flat + random(randomN)` (`flat` any whole number; `randomN` from 0, where 0 rolls nothing). `"strengthHalf": true` adds `random(strength) / 2` after it, as Classic's Gold Axe does. Every roll draws, in order, and the last one's stands. The Moonblade gets no skill tiers: give it `attack.blocks` for the Slash and sword tiers, and the Thrust block every Classic weapon gets (the Items page's copy of a Long Sword starts with the Long Sword's).

**The same in the rule tables.** A pack can also give an item its rules as rows in the tables that match names, which is how Classic defines its own: rows that `contains` a name reach every item with that name in it. `"Elven Long Sword"` inherits the Long Sword's slot, attack power, Strength and kill training through Classic's "Long Sword" contains rows, and the generic Sword skill block; `"Elven Sword"` matches no slot row and cannot be equipped until it has one. The Moonblade above, as rows: an `equip.slots` row `{ "match": "exact", "pattern": "Moonblade", "slot": "LeftHand" }`, an `attPower.base` row `{ "match": "exact", "pattern": "Moonblade", "flat": 9, "randomN": 6 }`, an `equip.strength` row, a `behaviours` row, a `classes.json` `skillGain.weaponSkills` row `{ "weapon": "Moonblade", "match": "exact", "skills": [...] }`, a `paperdoll.aliases` row `{ "layer": "weapon", "match": "exact", "pattern": "Moonblade", "becomes": "Broad Sword" }`, and `breaks.weapon.items` and `breaks.damaged` rows. In `attPower.base`, every matching row rolls, in file order, and the last one's roll stands: the earlier rolls still draw, so Classic's Gold Axe draws its `Axe` row's roll before its own. A matching `exactOverrides` row then replaces it (Classic's bows); an override is tested by exact name whatever its `match` says, and never rolls Strength. A row is parts only: there is no formula text.

### Item definitions

An **item definition** (`items.json` `definitions`, keyed by the item's name) is one item's rules in one record, in place of rows spread over the tables above. The content store compiles each definition into exact rows for that item, and the pack's rows that matched the item stop applying to it in every table the definition covers, including the every-match tables (behaviours, skill blocks, armour, gear, use effects). A defined item plays only what its definition says there, whatever `contains` rows its name would match; the rest of its family keeps them (defining `"Long Sword"` leaves `"Broad Sword"` and `"Elven Long Sword"` on the pack's rows).

On a running server, the Control Panel's [Items page](running-a-server.md#the-items-page) writes these for you: it opens any item as a definition of what it plays now, and saves the definition when you change it.

The [Moonblade](#example-moonblade) above is one. Its fields, and the tables each compiles into:

| Field | Table it compiles into |
|---|---|
| `slot`, `strength`, `twoHanded: true` | `equip.slots`, `equip.strength`, `equip.twoHanded` |
| `behaviours` | `behaviours` (one row per behaviour) |
| `attack.base`, `attack.overrides` | `attPower.base`, `attPower.exactOverrides`: `{ flat, randomN, strengthHalf? }`, every roll drawing in order |
| `attack.blocks` | `attPower.skillBlocks`: `[{ tiers }]`, the tiers as a skill block's |
| `armour`, `elemental`, `spellDefense` | `armour.rows` (`{ slot, hitMe, hitMe2 }`), `armour.elemental`, `armour.spell.rows` |
| `gear`, `cooldowns`, `sound` | `gear`, `swing.cooldowns` (one per worn slot), `swing.sounds` (null: silent) |
| `use.usable`, `use.silent`, `use.effects`, `use.message`, `use.refusal` | `use.usable`, `use.silent`, `use.effects`, `use.messages`, `use.refusals` |
| `trains` | `classes.json` `skillGain.weaponSkills` |
| `tools` | `tools`: `{ can?, tier?, ladder?, counter? }`; items naming the same `counter` share a hit count (a seeded Gold Axe keeps the Axe's) |
| `requires` | `requires`: `{ on: "equip" \| "use", needs, atLeast, text? }` (`needs` a skill or `level`) |
| `menu` | `menu`: the button in place of Equip (`Cook`, `Mix`, `Build`, `Smith`, `Storage`) |
| `use.mysticism`, `use.skillBook` | `use.books` (the Mysticism a spell book needs), `use.skillBooks` (`{ skill, points?, xp?, upTo? }`) |
| `damaged`, `breaks.armour`, `breaks.weapon` | `breaks.damaged`, and `breaks.armour.items` and `breaks.weapon.items` (the slots it breaks in: armour in `BodyE`, `HeadE` or `RightHandE`, a weapon in `LeftHandE`, the slots the engine rolls a break in) |
| `paperdoll` | `paperdoll.aliases`: `[{ layer, becomes }]`, one per layer |
| `ground.blocks`, `.platforms` (every row must be met), `.overlay`, `.inUse`, `.layer`, `.offset`, `.tipless`, `.tipName`, `.ctrlText` | `ground.blocks`, `ground.platforms`, `ground.overlays`, `ground.inUse`, `ground.layers`, `ground.offsets`, `ground.tipless`, `ground.tipNames`, `pickup.ctrlTexts` |
| `container.capacity`, `container.uniqueId` | `containers.capacity`, `containers.uniqueIds` |
| `inEditorList`, `inPlayerShops` | membership of `editorItems` (the World Editor's list) and `playerShopWhitelist` |

- **Left out means none.** A definition with only a `name` gives the item no slot, no behaviours, no attack rolls (power 1, then the Strength tiers), no skill tiers and no training. The every-weapon Thrust block is a skill block too: an item that should keep it lists it in `attack.blocks`.
- **One rule stays the tables':** `equip.murder`, a single name test (1.6's "Murder"), is not part of a definition.
- **Pictures when worn:** a definition's aliases go before the pack's aliases, so the pack's aliases of the name it becomes still apply (a Moonblade drawn as an Ice Hammer is drawn as an Ice Hammer is, a Mining Hammer). An alias naming another defined item follows that item's own alias on the same layer, whatever order the definitions are in; a loop is refused, and so is an alias to a picture with no worn frames. The Items page's copy of an item is drawn as that item when worn until it has worn frames of its own; **Give it a layer of its own** takes the copy's alias out.
- **Lists:** an item a definition puts on a list it is not on goes at the end; one it leaves off comes off.
- **Names:** a definition is for its catalogue name exactly. Behaviour and requirement rows test a name without its `#id` or `+N`, and paperdoll aliases without its `+N`, so a runtime `"Long Sword+3"` has a defined Long Sword's behaviours but the tables' slot and power; a masterwork (`"Knight's Sword +1"`) takes its behaviours, needs and worn picture from its base item, so its definition sets none of them (and leaves the base's alone). The item menu, a container's lines and the ground rules test a name without its `#id`, so a carried `Crate#12` opens, holds and sits on the ground as a defined Crate does. A base item's definition leaves its masterworks on the pack's rows (or their own definitions). An engine fixture (a door, a sign) has none.
- **Checks:** the schema's limits (Strength 0–200, attack `flat` −9999–9999 and `randomN` 0–9999, armour ±999, use effects ±99999), an item the catalogue has (a retired one too), skills that exist (trained, in a skill tier, needed, a skill platform's, a skill book's), one swing cooldown per slot, two-handed only in LeftHand and never on a bow (a bow shoots arrows held in the off hand, and some arrows must be wearable there), a tool use that does something (a use or a ladder; a tier only with a use) with a ladder that exists, one picture per paperdoll layer, Storage only with a `#id` for each copy (a copy held from before gets its id when first opened), Smith only on an item a repair recipe takes (unless the pack already gave it Smith), a book that teaches only when it is a book, a spell book only when a spell's book is it, a skill book's formulas checked as the table's are, and a new item's name never a map fixture's (`Wooden Door`, `Gold Chest`, or a door's other form). Removing an item takes its definition with it.
- **Editing a pack's item:** an operator who edits an item gets a definition seeded from what it plays now (saved unchanged, it plays identically). From then on the item no longer follows the pack's rule changes; when a pack update changes what the pack's rules play for it, Publish Changes raises a notice for the definition, and taking the pack's version drops the definition. `seedDefinition` and `resolveIn` in `packages/shared/src/content/definitions.ts` give an item's current rules as a definition.

Definitions are edited on the Control Panel's [Items page](running-a-server.md#the-items-page), which shows each rule group as a tab in plain words with where it comes from, and refuses a save over a change it has not seen.

## Tiles (`tiles.json`)

`packages/data/content/tiles.json` contains `walkable` (the 2-character walkable code whitelist), `catalogue` (tile codes, hover names and flags), and `defaults` (`ground`, `empty`, `shadow`, `editorTile`).

On a running server, the Pictures & Sounds page's [Tiles section](running-a-server.md#tiles) adds tiles from PNGs and tilesets, picks their codes, and edits a tile's picture, name, walkability and flags without JSON or a rebuild.

### Tile flags and defaults

| Flag (`catalogue[].flags`) | Layer tested | What it does | Original codes |
|---|---|---|---|
| `sea` | 1 | Deep water where sea creatures spawn and move, and where Boats and Battleships are built and sail | `W1`, `N1`, `D2`, `I2`, `V2` |
| `airshipBlock` | 2 | Tiles that block an Airship | `D8`, `I8`, `E8`, `J8`, `K8`, `L8` |
| `dock` | 1 (any row) | Airship landing pad | `J2` |
| `arena` | 1 (any row) | Forced-PvP arena tile | `6P` |
| `grave` | 2 | Grave tile for Raise Dead | `Q8`, `9A`, `9B` |

| Default (`defaults`) | Used for | Original code |
|---|---|---|
| `ground` | Blank-map layer 1 ground | `H1` (Minimal: `G1`) |
| `empty` | Blank-map layers 2 and 3, house footprint layer 2, house demolish reset | `G3` |
| `shadow` | Blank-map layer S shadow and the layer-3 `(7, 6)` mark | `5A` |
| `editorTile` | Initial selected tile when opening the World Editor | `G1` |

- **Hover names (`catalogue[].name`):** the playfield hover tip names a layer-2 tile with a `name` when no player, monster or named ground item is under the mouse. The shipped names cover the tiles you gather from and what they turn into (`S3` is `Tree`, `P3` is `Tree Stump`, `XL` is `Corn Plant`). Leave plain ground, water and decorative tiles unnamed, so most of the map shows no tip. A tile you add for a gathering tool should get a name too.
- **Walk whitelist (`walkable`):** every code in `walkable` must be exactly 2 characters.
- **Checked by tests, not the build:** the schema accepts any non-empty tile `code`; the rule that an added tile's code is 2 characters and unique in any case is enforced by `packages/data/tests/data.test.ts`, so run `bun run test` (or `bun run gate`) as well as `data:build`.
- **Other tile codes live with their systems:** harvest nodes and fishing water in `gather.json`, the newspaper stand (`K2`) in `social.json`, and rough terrain and house tiles in `houses.json`.
- **Palette order:** original tiles (with `member`) fill World Editor pages `1`–`10` in member order (stopping at member `589`, leaving slots `50`–`60` on page `10` free). Added tiles (without `member`) fill page `10` slots `50`–`60` first in `catalogue` order, then pages `11+` at `60` tiles per page. Every slot with no tile is blank and cannot be clicked (stale slots on page `10` are not kept).

### Example: Deep-water tile (`Z9`)

Add a 2-character `code` to `tiles.json` `catalogue` that is unique in any case and has no `member`:

```json
{ "code": "Z9", "flags": ["sea"] }
```

Add `{ "code": "Z9" }` to `walkable` only if players and land monsters should walk on it. Provide a 32×32 PNG and sidecar under `assets/added/` (`tiles/Z9.png` and `tiles/Z9.json` with `"group": "tiles"`):

```json
{ "group": "tiles", "regX": 16, "regY": 16, "key": "none", "prov": "authored", "note": "Deep water Z9 example" }
```

With no other added tiles in `catalogue`, `Z9` appears on World Editor **palette page `10`, slot `50`**, `PALETTE_CODES.has("Z9")` and `tileHas("Z9", "sea")` are `true`, and `editorMapError` accepts maps painted with `Z9`.

## Monsters and NPCs (`monsters.json`, `npc-files.json`)

`packages/data/content/monsters.json` defines species stats (`monsters`), `editorLists`, ordered `rules`, `casting` (`spells`, the `SPL|` monster spell definitions, and `neverCasts`), `meleeAffinities` (weapon-against-monster damage changes: a row whose `weapon` text the swung weapon contains and whose `monster` matches the species, by `monsterMatch` `exact` or `contains`, adds `delta` and then `random(randomN)`, a roll of 1 to n, where 0 rolls nothing; every matching row adds, in order; Classic's Sword of Hope rows roll `randomN` 6), `skillCaps`, and `generic` (the body and defense a name not in `monsters` falls back to; its `hp` is not read, since such a name starts with 1 HP). See [Monsters guide](guides/monsters.md) for runtime behaviour and NPC script tags.

| Table (`monsters.json`) | Decides | Wins | Result and default |
|---|---|---|---|
| `rules.sea` | Species that spawn and move only on `sea` tiles | Any | Default land rules |
| `rules.footprint` | 3×2 wide monsters | Any | Default 1×1 |
| `rules.hostile` | Species off `editorLists.worldEditor.monsters` that walk toward players | Any | Default wanders |
| `rules.officer` | Attacks wanted players on no-fight maps | Any | Default skips no-fight maps |
| `rules.sparesInnocent` | Never hits an innocent player | Any | Default attacks anyone |
| `rules.clearsBlock` | Never blocks a player's step (`blockPCCheck`); clears no other block | Any | Default blocks its tile |
| `rules.killBroadcasts` | Server broadcast when a player kills the monster, by melee or spell (`{}` = killer name) | First | `text`; default none |
| `rules.namesSelf` | Click says `"This is <name>."` instead of opening Bio | Any | Default opens Bio |
| `rules.noQuests` | Gives no quests in `askForQuest` | Any | Default checks quest lines |
| `casting.neverCasts` | Never casts monster spells (`contains`) | Any | Default casts its `SPL|` tags |

Two lists in `editorLists` also drive gameplay:
- `worldEditor.monsters`: a whole entry (ignoring case) walks toward players; add species that should chase but stay off the editor list to `rules.hostile`. A name the list contains as text (`contains`) gets no quests and gives no treasure rumours, so `"Dragon"` is caught there through `"Dragon Hatchling"`.
- `npcEditor.npcs`: spawns only when its roll passes, `balance.json`'s `monsters.npcSpawn` (Classic: `random(60) <= 2`). The test is `contains` over the whole list, so a name that appears inside a longer entry is caught too.

Every species row needs an `hp`. Its `attack` may be `null`: the species never melees. A species may have a `level` (0 to 100,000; issue #42), which players see beside its name only when the balance row `levels.showMonsterLevels` is `shown` ("Wolf (level 3)" in the hover tip and an NPC's Bio), and which kill XP can compare with the killer's level (`killXp.adjust` `levelDifference`). Its kill XP is `xpMelee` and `xpSpell`; a species that leaves them out gives `killXp.fromLevel` from its level instead (see [Balance](#balance-balancejson)). Its `killXp`, when set, is a fixed kill XP in place of both and of any XP gear's bonus (Classic: Cow and Holy Shield, 5); before issue #42 this was the name-matched table `rules.killXp`, which an upgrade moves onto the species rows (and out of monster definitions) so every monster gives what it gave. Classic sets no levels.

### Adding a monster or NPC

1. Add a species record to `monsters.json` `monsters` (`bodyInMainChars: true` when its body has art).
2. Add its NPC file in `npc-files.json` (or on the Control Panel's Talk & Shops tab; no file means it never moves and has no Bio).
3. Add its name to `editorLists.worldEditor` (`monsters` or `npcs`) and the matching list in `editorLists.npcEditor`.
4. Add a `skillCaps.byBody` row if it uses a new body number (default is `85`).
5. Add rows to `rules` or `casting.neverCasts` if it needs a behaviour its name does not already match, and add body art if it uses a new body.

### Species flags

A species' `flags` turn on the mechanics no table names (1.6 tied each one to a body number; a body is now only art). A flag left out is off.

| Flag | What it does | Classic |
|---|---|---|
| `immobile` | Never walks | Illusionary Spikes, Web, Holy Shield |
| `unclickable` | A click on it does nothing (after a grab, and a `rules.namesSelf` row) | Illusionary Spikes, Pig, Web, Holy Shield |
| `trap` | Holds a player standing on its tile ("Your feet are stuck in the web…"), and never attacks | Web |
| `dispellable` | Dispel Illusions destroys it | Illusionary Spikes |
| `shieldsInnocent` | An innocent player standing exactly on it cannot be hit in melee; spells never test it | Holy Shield |
| `grabbable` | Ctrl, or a click from the faced tile, picks it up as this item | Pig (`"Pig"`) |
| `hurtByHealing` | Minor Heal and Major Heal hurt it instead | Zombie |
| `healedBy` | These spell effects heal it: by their heal amount where 1.6 had one (Splash, Crush), else by their damage | Dragon Hatchling (`Splash`), Fire Demon (`Crush`), Ghoul (`Firebolt`) |
| `resists` | A hit from these effects rolls its damage, then deals only `random(3)` | Ghoul (`Fireball`) |

`healedBy` and `resists` name the effects that hit monsters: `Meteor`, `Bolt`, `Splash`, `Crush`, `Firebolt`, `Fireball` and `Wind Wave`. A spell of your own heals or is resisted by its `effect`, so an Ice Shard on Firebolt's effect heals a Ghoul. A `grabbable` item must be an item.

A species saved before these flags existed took its mechanics from its body number; the upgrade that added them gave each such row the flags its body had, so it plays the same. A new species on one of those bodies takes none unless you give it the flags.

### Monster definitions

A **monster definition** (`monsters.json` `definitions`, keyed by the monster's name) is what the monster tables decide for one monster, in one record, as an [item definition](#item-definitions) is for an item. The content store compiles it into exact rows for that monster, and the pack's rows that matched it stop applying to it in every table the definition covers; the rest of a `contains` row's family keeps them (defining `"Orc"` leaves `"Orc Chief"` on the pack's rows).

```json
{
  "name": "Overlord",
  "footprint": true,
  "hostile": true,
  "killBroadcast": "*** ** * All hail {} who has rid the world of an evil overlord!",
  "affinities": [
    { "weapon": "Dark", "delta": -12, "randomN": 0 },
    { "weapon": "Hope", "delta": 14, "randomN": 6 }
  ]
}
```

| Field | Table it replaces | Meaning |
|---|---|---|
| `sea`, `footprint`, `hostile`, `officer`, `sparesInnocent`, `clearsBlock`, `namesSelf`, `noQuests` | `rules.<field>` | `true`: the rule applies to it |
| `neverCasts` | `casting.neverCasts` | `true`: it never casts monster spells |
| `killBroadcast` | `rules.killBroadcasts` | broadcast on a kill, `{}` the killer's name |
| `affinities` | `meleeAffinities` (monster side) | in order: a swung weapon whose name contains `weapon` adds `delta`, then `random(randomN)` (0 rolls nothing) |
| `skillCap` | `skillCaps.byBody` | the kill skill cap for this species, ahead of the by-body rows; left out, `skillCaps.default` |
| `lists` | `editorLists` | `worldEditorMonsters`, `worldEditorNpcs`, `npcEditorMonsters`, `npcEditorNpcs`: on that list (off it when left out) |

- **Left out means none.** A definition with only a `name` takes every rule above away from the monster, gives it the default skill cap whatever its body, and takes it off the editor lists.
- **Stays elsewhere:** its stats and flags (`monsters`), its loot, spells cast and NPC flags (its NPC file), and the monster spells themselves (`casting.spells`).
- **Order:** a definition's rows go where the monster's first matching row was (else first), so the order other monsters' rows meet in is the pack's, and the order of the definitions never matters.
- **Names:** a definition is for its name as the tables test it: any case, nothing round it. A live name the tables would test differently (`"Orc 2"`, `"Orc#2"`) keeps the pack's rows.
- **Checks:** the schema's limits, a name that is a species, an editor list entry or an NPC file, and an affinity's weapon text that some item's name contains (never empty, which every weapon contains). A species row needs hit points of at least 1, and attack (when set), defense and XP of at least 0; a trap must be immobile, and can't be a sea creature or 3×2 wide. A new species' key can't be an item's name, a fixture's, an NPC's on an editor's NPC list or a faction's. Two monster spells can't share a tag, and each ladder step is at least 1. Removing the species, from any page, takes its definition with it.
- **Editing a pack's monster:** an operator who defines a pack monster from what it plays now (`seedMonsterDefinition` with `resolveMonster`, in `packages/shared/src/content/monster-definitions.ts` and `name-tables.ts`) gets one that plays identically. From then on the monster no longer follows the pack's rule changes; when a pack update changes what the pack's rules play for it, Publish Changes raises a notice for the definition, and taking the pack's version drops the definition. The operator's own monsters raise none.

That is Classic's Overlord as its tables play it (wide, walking toward players, its kill broadcast, the Sword of Darkness and Sword of Hope rows), with no kill skill cap of its own (the default) and on no editor list. Definitions are edited on the Control Panel's [Creatures & NPCs](running-a-server.md#the-creatures--npcs-page) page, with the species row, which refuses a save over a change it has not seen.

### Example: Frost Wolf

1. Append a species row to `monsters.json` `monsters`:

   ```json
   { "name": "Frost Wolf", "body": 32, "bodyInMainChars": true, "hp": 16, "attack": 4, "defense": 1, "xpMelee": 18, "xpSpell": 18, "spawnMinute": null }
   ```

2. Append `"Frost Wolf"` to `editorLists.worldEditor.monsters` and `editorLists.npcEditor.monsters` in `monsters.json`.
3. Add its seed NPC script to `npc-files.json` `files`:

   ```json
   { "name": "Frost Wolf", "text": "BIO|Name: Frost Wolf\rPRO|A fierce wolf of the snow.\rINV|5 Gold:1" }
   ```

Body `32` is the Wolf's, so the Frost Wolf reuses its art; a body with no art in the atlases would leave the monster invisible (its `<body>-f2-s` key is also missing from the generated `packages/data/packs/classic/data/rects.json`, which is a quick way to check). Body numbers run from 1 to 9999 everywhere (monsters, `bindings.json` and uploads); a running server's operators can upload a body of their own on the Control Panel instead, from the creature's Picture tab or the Pictures & Sounds page's Bodies section, and the server numbers it from 1000 (see [Bodies](running-a-server.md#bodies)).

`npc-files.json` is not only a seed: the server loads it at every start as the base NPC store, then applies the `npc_files` rows saved on the Control Panel's Talk & Shops tab (and a creature's Loot & spells) on top. So a rebuilt image changes every NPC that has no saved NPC Editor edit, on existing servers too.

### Shops and other NPC lines

An NPC's shop is lines in its NPC file (`npc-files.json`, or the Control Panel's Talk & Shops tab on a running server), one `TAG|data` per line:

- `SEL|<item>:<price>:<stock>`: an item the NPC sells, at `price` gold, with `stock` left (the server lowers it as players buy).
- `BUY|<item>:<price>`: an item the NPC buys from players for `price` gold.
- `GLD|<n>`: the shopkeeper's till; purchases and gifts fill it and sales pay from it. Without one it starts at 0.
- `TRN|<class>:<price>`: a class promotion the NPC trains.
- The other tags: `BIO|` and `PRO|` (Bio window), `INV|` (monster drops), `RND|` (chatter), `FLG|` (`Still`, `Passive`), `SPL|` (monster spells), `BNK|` (banker) and `OWN|`.

The Talk & Shops tab checks these forms as you type and when you save; see the [economy guide](guides/economy.md) for how shops trade.

## Other content files

These files have no worked example here; their schemas in [packages/data/schema/](../packages/data/schema/) document every field, and the matching [system guide](guides/README.md) describes what they do in play.

- **`gather.json`:** `gathering` (the hit table, mining strikes, fishing, farming, regrowth and treasure), and `harvest` and `yields` (see [Tools and gathering](#tools-and-gathering)). How the gathering and crafting skills rise is each skill's [progression](#progression).
- **`craft.json`:** `stations`: what each crafting station makes, from what, and at what skill.
- **`houses.json`:** house deeds and types, [vehicles](#vehicles-housesjson-vehicles), placement and building, doors, keys and switches, containers, resting regeneration and monthly decay.
- **`social.json`:** [factions](#factions-socialjson) and their rules, murder, the Assassin's Game, high scores, guilds, chat rooms, buddies, Bios, medals, mail, boards, art tools and the newspaper.
- **`casino.json`:** the Slot Machine, Blackjack and Checkers games, including their sounds. Which items play them is the `slotMachine`, `blackjackTable` and `checkersTable` [behaviours](#item-behaviours). Classic no longer sets each game's `item`; a pack made before the behaviours that still sets it keeps that item playing.
- **`quests.json`:** the quest lines that seed a fresh database's `quests` table (`current`) and the pools a replacement quest is drawn from (`pools`).
- **`help.json`:** the help topics `/help <topic>` shows, with their lines. The `Help` topic is also the greeting a character gets on logging in; a world without one sends none.

### Vehicles (`houses.json` `vehicles`)

A vehicle is a row of `houses.json` `vehicles` (issue #44), keyed by `name`: what a character rides and what a parked one is called (`Bob's Boat`). A deed builds one with `"use": "vehicle", "vehicle": "<name>"`; the older `"use": "boat"`, `"airship"` and `"battleship"` still read, as the Classic rows of those names. The engine keeps the mechanics (crossing tiles, boarding, parking, the hull, sinking and the cannon's shot); a row picks the options:

| Field | What it is | Classic's Boat / Battleship / Airship |
|---|---|---|
| `name` | Its key: no `'` or `#`, no leading count (`5 Skiff`), not an owner fixture's word (`Door`, `Mailbox`, `Board`, …), and not the end of an item's name (`Bob's Skiff`) | `Boat`, `Battleship`, `Airship` |
| `display` | What its lines call it (optional; default `name`); no two vehicles show the same name | (none) |
| `picture` | The item picture a parked one shows (an `art.items` name) | `BoatPic`, `BattleshipPic`, `AirshipPic` |
| `rider` | The body a rider shows; every peer knows the vehicle by it, so no two vehicles share one. It needs its four walking frames (`F1`-`F4`) in each direction | 55, 56, 57 |
| `hull` | The full hull (1 to 100,000); hits wear it, never the rider, and at 0 the vehicle is lost | 60, 150, 80 |
| `moves` | The tiles it crosses: `over` (`"any"`, or `flags` and/or `codes`) less `except` (`flags` and/or `codes`) | over `sea`; over `sea`; over `"any"` except `airshipBlock` |
| `boards` | `shore`: it sails. It is built on a tile it crosses, boarded from the tile beside it, left onto a walkable tile beside it, steps at walking pace, is blocked by players, monsters and fixtures and blocks walkers (monsters pass riders, as before), and rides the swell. `pad`: it flies. It is built on, boarded beside and left on one of its `lands` tiles, steps twice as fast, and flies over players, monsters and items, blocking no one. Every rider passes over exits, cannot swing, cast or drop anything, and is never meleed | `shore`, `shore`, `pad` |
| `lands` | The pads a `pad` vehicle is built and left on (`flags` and/or `codes`; only for `pad`) | -, -, `dock` |
| `cannon` | `true`: the attack key fires the cannon, spending `bindings.json` `cannon.ammo`. Its rider shows its body's `fire1`-`fire3` frames while it fires, or its standing frame when the body has none (an uploaded body holds only walking frames) | -, `true`, - |
| `bobs` | `true`: a parked one (a `shore` vehicle) bobs at its mooring, drawn as its rider's frame on the swell, facing the way it was left; without it a parked one shows `picture` | `true`, `true`, - |

A flag is read on the layer its tiles live on (`sea` and `dock` on layer 1, `airshipBlock` on layer 2); a code matches on layer 1 or layer 2. A Sand Skiff that crosses sand and is boarded from the shore:

```json
{
  "name": "Sand Skiff",
  "picture": "SandSkiffPic",
  "rider": 1001,
  "hull": 40,
  "moves": { "over": { "codes": ["8R"] } },
  "boards": "shore"
}
```

(`8R` standing for the world's sand tiles) with a deed `{ "deed": "Sand Skiff Deed", "use": "vehicle", "vehicle": "Sand Skiff", "house": null, "text": null }`. Rows are edited on the Control Panel's [Houses & Vehicles](running-a-server.md#the-houses--vehicles-page) page. The publish check refuses a tile code the catalogue lacks, a flag no tile carries, a vehicle with no way to board (judged as play judges it: a `shore` vehicle that crosses no tile once `except` is taken off `over`, a `pad` one with no tile it can fly onto and land on), a parked picture or walking frames neither a pack (one being installed included) nor an upload draws, two vehicles with one rider body or one display name, and an item named like a parked one (`Bob's Sand Skiff`). A new kind of movement (swimming, digging) still needs code.

Characters and parked vehicles store the vehicle's name. **Remove this vehicle…** (on the Houses & Vehicles page's **Vehicles** tab) lists where it is used (the deeds that build it, the characters riding it, the parked ones) and, when the draft is published, lands its riders where they are and turns each parked one into its deed where it stands, or switches both to another vehicle; the deeds are removed with it or build the other one. Taking out a vehicle that is ridden or parked any other way (by hand, an undo, a pack import or update) is refused until Remove's cleanup is in the draft. A vehicle no row has (a release pack that dropped it, a database edit) rides and parks as nothing: its riders are listed under the Publish Changes page's Find problems and land where they are (logged), at once if online and when they next log in otherwise, and a parked one is an ordinary item.

### Balance (`balance.json`)

`balance.json` holds the game's global balance numbers (issue #19), edited on the Control Panel's [Game Rules](running-a-server.md#the-game-rules-page) page (the spell amounts and buffs on [Spells](running-a-server.md#the-spells-page), the hull and cannon on [Houses & Vehicles](running-a-server.md#the-houses--vehicles-page)). Every value has an engine default, so a pack may leave the file, or any part of it, out (Minimal leaves it out and plays the defaults). Classic writes the defaults out: 1.6's values, and SSO's own for its additions. Every value is a whole number, except the `drops` row's `who` and `kind`, `killXp.adjust` and `levels.counting` and `showMonsterLevels` (picks from a list) and the lists `killXp.thresholds` and `levels.firstLevels`, with limits the schema enforces ([balance.ts](../packages/data/schema/balance.ts)); a draft, publish, undo or pack update with a value outside them is refused.

| Part | Row | Fields (Classic) |
|---|---|---|
| `spellEffects` | One per effect, keyed by `effect` (`Firebolt`, `Fireball`, `Bolt`, `Meteor`, `Splash`, `Crush`, `Wind Wave`, `Arrows`, `Minor Heal`, `Major Heal`) | `monster`: on a monster (a heal for the heals; an arrow's has the monster's Defense taken off); `monsterHealed`: on a species whose `healedBy` names the effect (optional, harmful effects other than Arrows; absent heals by `monster`); `monsterUndead`: a heal's damage to an undead monster (the heals only, required); `player`: on a player (a heal for the heals; all but Firebolt and Splash then pass the player's spell defense). Firebolt is `{ "monster": { "flat": 6, "power": 1, "randomN": 3 }, "player": { "flat": 8, "power": 1, "randomN": 3 } }` |
| `spellHits` | One row | `dispel`: Dispel Illusions on a dispellable monster (2000); `resistedRandomN`: a resisted effect deals `random(n)` instead (3); `arrowsFloorRandomN`: an arrow under 1 after Defense deals `random(n)` (2) |
| `buffs` | One row | `magicShieldPerPower` (70), `stoneSkinPerPower` (30), `fireSwordPerPower` (40), `holdPerPower` (8): frames for each point of power; `stoneSkinBonus`: the defense bonus (1); `argonFrames`: Argon's Fist and a Purple Potion (400); `diminishHunger`: `{ "add": 3000, "below": 35000 }`; `morph`: Morph's roll, an amount (`3 + P + random(5)`). A buff whose length works out to 0 frames does nothing at all (no bonus and no message), and Diminish Hunger adding 0 says nothing |
| `castPower` | One row | `staffFireball` (`{ "flat": 1, "randomN": 3 }`, before the Fire Staff skill's steps) and `swordFireball` (`{ "flat": 4, "randomN": 3 }`): the free fireballs' power |
| `regen` | One row | `periodFrames`: what the regeneration counter counts up to, less a faction's regeneration perk, at least 1 (149): the counter starts at 1 and starts again once it acts, so regeneration acts every `periodFrames` − 1 frames (148, 1.6's cadence); `regenerate` and `starve`: HP and SP each gains or loses a tick (1, 1; starving stops at 1) |
| `hunger` | One row | `loseOneIn`: hunger falls by 1 each frame with a chance of 1 in this (3); `regenAbove` (500) and `starveBelow` (50); `stuffed`: food and potions refused from here (35000); `afterDeath` (40000). `starveBelow` < `regenAbove` ≤ `stuffed`, else refused |
| `death` | One row | `hp` (1, at least 1) and `sp` (1) after a death, each at most the player's full; `pauseFrames`: no monster rolls against you for this long (90) |
| `vehicles` | One row | `hullHit`: hull one arrow or harmful spell takes off a rider (2); `repairPerMinute`: hull a parked vehicle mends each whole minute (1). Each vehicle's full hull is its own [vehicle row](#vehicles-housesjson-vehicles)'s `hull`, which the Houses & Vehicles page's Hull and cannon card names and links to |
| `cannon` | One row | `damage`: `{ "flat": 13, "randomN": 3 }`, the flat amount plus `random(randomN)` (1 to n; 0 rolls nothing); `reloadFrames`: frames between shots, 20 a second (100) |
| `drops` | One row | `who`: whose deaths drop gold or an item, `off`, `wanted`, `pvp` or `everyone` (`wanted`; 1.6 dropped on every death); `kind`: `either` (1.6's coin toss), `gold` or `items` (`either`); `goldCap`: the most gold a death drops unless wanted, 0 for no cap (200); `minLevel`: nothing drops below this level unless wanted (0); `lootDecaySeconds`: how long monster loot lasts on the ground, 60 to 604800 (1800). Server Settings before issue #19 |
| `timings` | One row, frames (20 a second) | `flickerFrames`: a hit player's flicker, in which no other hit lands (40; counted down twice a frame, so about 1 s); `castDelayFrames`: after a cast, at least 1 (20; also counted down twice a frame, about 0.5 s); `swingBaseFrames`: a swing's cooldown with no gear that sets one, at least 1 (14); `killCreditFrames`: a hit counts as the kill this long, at least 1 (40; at 1 the fatal hit of any kind still counts, and no later hit lands on a downed player, even with a flicker of 0); `pigGrabFrames`: between pig grabs (500); `giveGrabFrames`: before a give is picked up (60); `npcSpellBlockFrames`: between monster spells hitting the same players (30) |
| `monsters` | One row | The monsters' global rolls. `moveLadder`: 8 values, twice each frame for each player on the map (at most 15) one slot is picked to move by `random(n)` (slot n moves, 1 to 4), n by players on the map, 1 … 8 or more (30, 50, 70, 100, 200, 300, 400, 600), each at least 4 so every slot can be picked; `walkStepsRandomN`: a walk's steps (10); `spawnLadder`: 7 values, twice each frame for each player on the map (at most 15) a spawn pass goes ahead with a chance of 1 in n by players, 1 … 7 or more (80, 120, 230, 400, 600, 900, 1300); `slotOneIn`: each empty slot's spawn chance in a pass (5); `factionSlotRandomN`: the slot a faction's member takes on its map, above 4 none (35), at least 4 so the member can take any slot; `npcSpawn`: an NPC spawns when `random(randomN)` is at most `passAtMost` (`{ "randomN": 60, "passAtMost": 2 }`, `passAtMost` ≤ `randomN`). Every other roll at least 1 |
| `killXp` | One row | Kill XP for the character level (issue #42), in order: the species' `xpMelee` or `xpSpell` (by the kind of kill), or for a species with neither `fromLevel.flat + fromLevel.perLevel × level` (`{ "flat": 10, "perLevel": 5 }`, SSO's), or `noSpecies` for a name with no species (30); plus the worn gear's `killXp` ([gear](#items-itemsjson-item-rulesjson-attpowerjson); Classic: the Ring of Experience's 5); replaced by the species' fixed `killXp`; plus `bonus` (10, 1.6's `Regged`); plus `thresholdBonus` (10) for each of `thresholds` the value is above, tested in order on the growing value (100, 150 … 400; rising, at most 100). Then `adjust`: `minusLevel` takes the killer's level off, never below 0 (1.6's: a monster gives less as you level); `none` gives the same whatever the level (a RuneScape-like world, which grows its level curve instead); `levelDifference` scales it by the monster's `level` against the killer's, `belowPercent` less for each level below (10), `abovePercent` more for each level above (5), between 0 and `maxPercent` percent (150), rounded down; a monster with no level counts as the killer's level. Each percent 0 to 10,000 |
| `levels` | One row | The character level curve and what a level gives (issue #42). Leaving level L takes its entry in `firstLevels` while the list lasts (the first entry is level 1's; `[30, 400]`), then `floor((start + perLevel × L^exponent) × (1 + growthPercent/100)^(L − 1))` (`start` 400, `perLevel` 2, `exponent` 1 to 4: 1, `growthPercent` 0 to 100: 0; so 1.6's 400 + 2 × L). `counting`: `perLevel` (those figures are the XP from L to L + 1, counted from 0 within each level with leftovers carried, 1.6's) or `total` (they are the running total that reaches L + 1, and the XP bar shows the running total; a step never takes less than 1). `cap`: the highest level, optional (none); at it no more levels come and XP still counts. `hpPerLevel` and `spPerLevel`: the most HP and SP each level adds (1, 1). `showMonsterLevels`: `hidden` (1.6) or `shown` |
| `combat` | One row | `meleeFloor`: melee on a monster below `below` after its Defense becomes `random(randomN)` (`{ "below": 1, "randomN": 3 }`); `playerHitFloor`: the same for a hit on a player, a monster's or a player's (`{ "below": 2, "randomN": 3 }`); each `below` at least 1, so a hit always does at least 1. `dodgeBaseRandomN`: a parry's or block's base roll, which succeeds on a 1, before the skill's ladder (90); `monsterMeleeOneIn`: a monster next to a player attacks each frame with a chance of 1 in this (10); `pushOneIn`: walking into a player pushes them with a chance of 1 in this (25) |

An amount is always structured parts, never a formula string: `flat + power × P + random(randomN)`, where P is the caster's spell power (`power` 0 to 100; with no `power` field, as in `castPower` and `cannon`, just `flat + random(randomN)`), the same form [attpower.json](#items-itemsjson-item-rulesjson-attpowerjson) uses. A roll draws only when `randomN` is above 0.

A spell row in `spells.json` may set its own `amount`, with any of `monster`, `monsterHealed`, `monsterUndead` and `player` in the same form: each part it sets replaces the effect's for hits from that spell's runs only. So a new spell that runs Firebolt's effect, such as [Ice Shard](#example-ice-shard-reusing-firebolt) below, can hit harder than Firebolt without changing it, by adding to its row (a fragment, not a whole row):

```json
"amount": { "monster": { "flat": 12, "power": 1, "randomN": 3 } }
```

Only a spell cast from a spellbook takes its own amounts: a free fireball, a monster's cast or a map hazard that runs the same FX takes the effect's.

### What a world may leave out

1.6's game shaped many of these files: tables that name its items, tiles and NPCs. A world that does not want a mechanic leaves its table out, and the mechanic is off (Classic fills every one; the [Minimal pack](#starting-a-world-classic-or-minimal) leaves them out):

| Left out or empty | Then |
|---|---|
| `gather.json` `gathering.mining` | No mining strike: no `yields` table may be `{ "kind": "ore" }` (the schema refuses one) |
| `gathering.fishing` | No water can be fished, whatever a `Fish` tool's row says |
| `gathering.farming`, `gathering.sprinkle` | No seed plants, a `Water` tool waters nothing, no sprinkle is shown |
| `gathering.treasure` | No treasure is buried and no NPC tells a rumour; no harvest node may set `treasure` |
| `gathering.regrowth.checks` (empty) | Nothing grows back |
| `craft.json` `stations.smith`, `cook`, `mix`, `build`, `cauldron` | That craft is off: its menu button does nothing (as with an unbound skill), and a job running when a publish takes the station out ends silently; with no `cauldron`, nothing dropped is taken for one |
| `casino.json` `slots`, `blackjack`, `checkers` | Its items play nothing: their click and Ctrl fall through to the item's other uses. A spin, hand or match a publish leaves running finishes on the rules it began with |
| `social.json` `assassin` | No Assassin's Game: the menu does nothing, kills score nothing, and an `assassinStatue` item is a plain item. A game running when a publish takes it out ends there (Lightning's one-hit melee with it), without prizes, and does not come back with the section |
| `social.json` `questReplies.oraku` | No NPC takes Oraku's orb |
| `social.json` `factions`, `medals.awards`, `bios.titles` (empty) | No factions, no medals, no Bio titles beyond `firstTitle` |
| `houses.json` `deeds`, `types` and the other lists (empty) | No houses or vehicles from deeds, no coloured keys, no relocking doors, no quest chest refills |
| `houses.json` `vehicles` | No vehicles: a deed that names one builds nothing (and is refused at publish) |
| `help.json` `topics` (empty) | `/help` finds no topic |
| `bindings.json` `cannon`, `bodies`, `skills` entries | See [Bindings](#bindings-bindingsjson) |

The rest of each file is the engine's frame (texts, timers, the chat rooms, the art tools) and stays required; the Minimal pack carries Classic's values. On the Control Panel's [Community](running-a-server.md#the-community-page) page, the casino games and the Assassin's Game are cards of their own: **Turn this off** leaves one out once published, and a card for one the packs leave out has **Add it**, to fill one in. The tables inside a section (a craft station, mining) are left out by editing the section.

## Spells (`spells.json`)

Each entry in `packages/data/content/spells.json` defines one spell's data:

- `name` (unique, case-insensitive) and `id` (1.6's save id, or `null`; SSO saves spellbooks by name, so every spell is kept).
- `effect`: the spell whose effect code this row runs (`"Firebolt"`, `"Fireball"`, etc.).
- `sp`: base SP cost (`null` or `0` cannot be cast), plus optional `spByBody` (`{ match, pattern, sp }[]`, last match wins) for body-armour overrides (such as Smoke Bomb).
- `crystals`: `{ colour, count }` (one of the six colours: Blue, Red, Green, Yellow, Purple, White; checked by `packages/data/tests/data.test.ts`, not the schema) or `null`.
- `harmful`: whether the spell is blocked on safe maps (Hold is also blocked by effect name).
- `book`: `{ match, pattern }` or `null`. `spells.json` is walked in **file order** and the **last match wins** (so `"Ice Bolt Book"` must appear after `"Bolt"`). Append new spells at the end.
- `info`: Spellbook Info text, or `null`.
- `summon` (optional): `{ monster, skilled: { skill, above, monster } | null }` for the five summon effects (`Web`, `Illusionary Spikes`, `Holy Shield`, `Raise Dead`, `Summon Creature`).
- `fx`: array of FX runs (`member` unique across all rows, `effect` naming a run of the spell's `effect`, `frames` and `lastFrame` (each at most 99), `projectile`, `sounds` as `{ name, ch }[]`).
- `school` (optional): `{ skill, cap? }`, the skill a cast of this spell trains after Magery (by the skill's `cast` [progression](#progression)), and a cap that replaces the progression's (left out: the progression's own; Classic's is the caster's Mage skill cap, a [faction perk](#factions-socialjson)). A spell hit that does damage trains the school too, by its `hit` progression. Classic's Smoke Bomb trains `MartialArts` up to 100; a spell with no school trains Magery alone.
- `power` (optional): the name of a table in the file's `power.tables` that the spell's power takes after the base power. Left out, the spell has the base power.
- `lasts` (optional, read by the Morph, Nature Shift and Smoke Bomb effects): how many seconds the body the spell gives lasts, 1 to 3600; left out, 65 (1.6's 1,300 frames). 1.6 chose the length by the body's number instead (over 300 never wore off); see [the difference](differences-from-fso.md#a-body-spell-lasts-the-spells-time-not-its-body-numbers).
- `creates` (optional, read by the Create Food effect): `{ item, article? }[]`, one taken at random; `article` goes before the item in the line ("Suddenly, an Apple appears in your inventory.").

Spell power is attack power's shape (`attpower.json` `skillBlocks`): every cast starts from 1, takes the `power.base` rows (Classic: +1 for each step of Magery over 10, 20 … 90), the caster's `spellPower` faction perk and worn `spell` gear (engine), then its own table's rows and the table's `gear` power (`blackArts` or `martialArts`). A row is `{ when, op, value }`: `when` is a list of `"<Skill> <op> <n>"` conditions (`level` for the character level), `op` is `set`, `add` or `subtract`, and `value` a number or a roll `{ "flat": a, "randomN": n }` (`a + random(n)`; a `randomN` of 0 rolls nothing). A cast's power stays from 0 to 100000 whatever the rows give, and each number in a row is at most five digits. Classic's tables are `Blessing`, `Wrath`, `Illusion`, `Water`, `Earth`, `Fire`, `Wind`, `BlackArts` and `MartialArts` (whose `set` rows replace the power, as 1.6's Smoke Bomb did). The school, the power and the food are the spell's own, so a new spell on an old effect picks them freely; the skills and items they name are checked at every publish.

To add a new spell with an existing effect, you also need:
- an `id` that no other spell uses, or `null` (spellbooks are saved by name, so either persists; the schema only refuses a repeated non-null id);
- a book item in `items.json` (a book is read whether or not it has a picture), and optionally a `use.books` Mysticism requirement in `item-rules.json`;
- FX art `<member>-<n>` and hit rects (`fx/` under `assets/added/`; rects are generated by `bun run data:build`), or, on a running server, an uploaded `art/fx` row (the spell's row has an Effect panel that uploads it and can set `lastFrame` to the frames uploaded: see [Spell effects](running-a-server.md#spell-effects));
- sounds whose `name` is in the built sound list (`packages/data/build/assets-lib/select.ts` `SOUNDS`) or added under `sounds/` in `assets/added/`, or, on a running server, uploaded on the Pictures & Sounds page's [Sounds](running-a-server.md#sounds) section under the name the run plays.

- **Validation:** [packages/data/schema/spells.ts](../packages/data/schema/spells.ts) restricts `effect` to `IMPLEMENTED_SPELL_EFFECTS` (the 36 original implemented effects) and requires every `fx[].effect` on a new spell to name an FX run of that original spell. Arbitrary `effect` names are rejected at `data:build`.

### Example: Ice Shard (reusing `Firebolt`)

Add to the end of `spells.json` `spells` (it trains and is powered by Water, where Firebolt uses Fire):

```json
{
  "name": "Ice Shard",
  "id": 89,
  "effect": "Firebolt",
  "sp": 30,
  "crystals": { "colour": "Blue", "count": 4 },
  "harmful": true,
  "book": { "match": "contains", "pattern": "Ice Shard" },
  "info": "Launch a shard of ice at your foe.",
  "school": { "skill": "Water" },
  "power": "Water",
  "fx": [
    {
      "member": "Ice Shard",
      "effect": "Firebolt",
      "frames": 16,
      "lastFrame": 16,
      "projectile": null,
      "sounds": [{ "name": "icecrack", "ch": 4 }]
    }
  ]
}
```

And add its book item to `items.json` `items`, with its picture at `items/Ice Shard Book.png` under `assets/added/` (`"icon": "added"` has a data test check the file; without a picture the book can still be read, but `/drop` cannot make it):

```json
{
  "name": "Ice Shard Book",
  "variants": ["Ice Shard Book"],
  "icon": "added"
}
```

Provide `fx/Ice Shard-1.png` through `fx/Ice Shard-16.png` (and `fx/xIce Shard-1.png` through `fx/xIce Shard-16.png` for the Firebolt trail), `items/Ice Shard Book.png`, and `sounds/icecrack.wav` with their sidecars under `assets/added/`. Note that a Smoke Bomb-like spell still ends in the original puff (`xSmokeoBomb`).

### Adding a brand-new spell effect

Reusing an existing `effect` is data-only. Creating a brand-new effect requires code and schema changes across shared, server, and client (see [Spells guide](guides/spells.md) and [Client guide](guides/client.md)):

- [packages/data/schema/spells.ts](../packages/data/schema/spells.ts): add the new effect name to `IMPLEMENTED_SPELL_EFFECTS` (and update spell/FX schema tests).
- `packages/shared/src/rules/spells/spells.ts`: `spellHitOnMonster` (monster hit, and `MONSTER_HIT_EFFECTS` in the monsters schema if species may be healed by or resist it), `playerSpellAmount` (player hit), `spellImp` (`IMP_EXITS`), `INERT_EFFECTS`, and `directional` / `boltForm` / `fireballForm` if directional. Its school and power are content.
- `packages/shared/src/rules/spells/spellfx.ts`: `AT_CLICK` / `FROM_CASTER` in `placeFx`, and `TRAILS` if the effect leaves a trail.
- `packages/server/src/systems/spells/cast.ts`: `castIntent` (safe-map, directional, or Portal-style checks), and `planSummon` if it summons a creature.
- `packages/server/src/systems/spells/collide.ts`: `playerCollision` and `monsterHits`.
- `packages/server/src/systems/spells/buffs.ts`: if the effect applies a timed buff or debuff.
- `packages/client/src/playfield.ts`: draw-order or trail handling if special.

## Factions (`social.json`)

The faction system is the engine's: joining by turning a rival's head in to a leader, the loyalty count and its warnings, exile at death, the head a member drops on a PvP map, each faction's power and the tier it gives, the faction channel and the members a map's faction spawn brings. Each faction is a row of `social.json` `factions`:

- `key`: the faction's permanent name, which characters and maps save (Classic: `mage`, `warrior`, `adventurer`). Letters, digits, `_` and `-`, starting with a letter.
- `name`, `leader` (the NPC heads are given to), `head` (the item a member drops and a rival leader takes, matched exactly), `member` (the species a map's faction spawn puts in a slot), `bio` (the faction line of a member's Bio) and `startPower` (its power on a server that has saved none for it; Classic: 1.6's 27, 123 and 0).
- The join and exile lines (`joinHpMaxAbove`, `exileHpMaxBelow`), the loyalty count (`joinCount`, `rejoinAdds`, `loyalty`) and the texts.
- `perks`: `{ kind, values }[]`, what membership is worth by tier. `values[tier]` is the perk's value (a tier past the end reads the last value).

| Perk | What it changes | Classic |
|---|---|---|
| `spellPower` | Added to spell power | Mage: the tier |
| `melee` | Added to melee attack power | Warrior: the tier |
| `defence` | Taken off damage taken, from players and monsters | Warrior: 1 from tier 1, 2 from 5, 3 at 9; Adventurer: 1 from tier 1, 2 from 7 |
| `skillCap` | The kill skill gain's cap | Warrior 55 … 90, then 100; Adventurer 55 … 75, then 80 |
| `mageCap` | The Mage skill cap: Magery, the spell schools, Staff Fighting and Unholy Combat | Mage: 50, 60, 70, 90, then 100 |
| `regeneration` | Frames off the HP and SP regeneration period ([`balance.json`](#balance-balancejson) `regen.periodFrames`; Classic's 149) | Adventurer: 5 × (tier + 1) |
| `pvpParry`, `pvpBlock` | Taken off the parry and block rolls against a player's swing | Adventurer: 4 and 10 |
| `monsterDodge` | Taken off the parry and block rolls against a monster | Adventurer: 10 |

`factionRules` holds what all factions share: `tiers` (a member's tier from its faction's power: `top`, then each `{ below, tier }` row the power is under, the last winning; Classic gives 9 from 80, down to 0 below 5), `perkDefaults` (a perk's value for anyone outside a faction that has it; Classic: `skillCap` 50 and `mageCap` 30, others 0) and `editorBoxes` (the factions the World Editor's three spawn boxes pick, in box order; Classic: Warrior, Mage, Adventurer for the W, M and A boxes). A faction's leader and member must be species, and its head an item; each is checked at every publish. A head is matched exactly: any other item given to a leader goes to the quest lines.

A faction an operator removes keeps its members' saved memberships, their loyalty count (it waits) and its saved power, for it to return to; while it is gone they have none of its perks, and maps whose spawn names it bring no one (the World Editor keeps the spawn when such a map is saved).

## Skills (`classes.json`)

`packages/data/content/classes.json` defines:

- `classes`: each class's `code`, `name`, optional `statBonus` and `promotion` (its `skillGrants`, and `statChanges`, an SPmax floor applied before the grants);
- `skills`: each skill's `skill` (its permanent key), an optional `display` name, and `hidden` for a skill the Skills page leaves out;
- `skillOrder` (optional): the Skills page's order, as skill keys; the skills it names come first, in its order, then the rest in the order of `skills`. It changes only what the page shows, never what characters store;
- `startClasses`: the classes the creation screen offers, in its order, each with its class `code`, an optional `label` (the class's name when absent) and its starting `skills` by key;
- `creation`: the creation screen's `sexes` (below) and the rest of the new-character record (the starting gold, hunger, profile text and so on);
- `skillGain.weaponSkills`: which skills a kill or a hit trains for each weapon (`weapon`, `match`, `skills`). A kill rolls them in the list's order (Classic's lists are in 1.6's roll order);
- `progression`: the world's progression settings, and each skill's own `progression` (see [Progression](#progression)).

How skills behave:

- **Saved by key.** A character stores each skill's value under its `skill` key, so skills can be added, removed or reordered at any time. A character who has never had a skill starts it at `1` (`NEW_SKILL_VALUE`), and their next save writes it. A removed skill's values stay saved, and come back if the skill returns. Two skills whose keys read the same with case and spaces ignored (`MartialArts` and `Martial Arts`) are refused, because the rules find skills that way.
- **Shown by `display`.** The Skills page lists every skill without `hidden`, in the order of `skillOrder` then `skills`, under its `display` name (the key when absent); with more skills than fit, its arrows scroll the list, as 1.6's did. The same name is used in the advance line (`progression.line`) and in the character editor. Classic hides Meditation, Terrain Navigating and Item Identification, as 1.6 did.
- **Starting values by key.** A start class names only the skills it starts above 1. The creation screen draws one radio per start class in the space 1.6 gave its three; more than three scroll there.
- **Sexes and heads are content.** `creation.sexes` lists the sexes the creation screen offers, in order: `{ "code", "label", "heads" }`. `code` is what characters are saved with, `label` what the screen, the Bio and the player hub show, and `heads` the heads it may wear, in the order the head arrows step through them (picking the sex shows its first). Each head is drawn from the paperdoll art `Head<n>` (`Head<n>-F2-S` in the preview). Classic's are 1.6's: `{ "code": 1, "label": "Male", "heads": [1, 3, 4, 5, 6, 9, 10] }` and `{ "code": 2, "label": "Female", "heads": [2, 7, 8, 11] }`, beside the MALE and FEMALE the screen's art spells out; any other list is written over those words, two rows at a time, scrolling beyond. The server refuses a sex the world lacks or a head that sex does not have; a character saved with a sex later removed keeps it (the Bio leaves it blank). Adding a head needs its paperdoll frames: a pack's (Classic's eleven; the Minimal pack's `Head1` and `Head2`), or `Head<n>` uploaded on a running server's Pictures & Sounds page ([Worn layers](running-a-server.md#worn-layers)).
- How each skill rises is content: its [progression](#progression).
- The skills the engine reads for a mechanic (parrying, the crafts and so on) are named in `bindings.json`, below.
- A class's `statBonus` (for example `{ "dex": 3 }`) is added to the stats of every character in that class while they are in it; change it and every such character follows.
- A class's `promotion.skillGrants` lists skills (by `skill` key) that the promotion raises to a roll of 1 to 10; a skill already higher keeps its value. `data:build` refuses a key not in `skills`.

### Progression

How a skill rises is content. Each skill picks a **model**, and each model has settings by **source**: the engine events that train skills. World **defaults** (`classes.json` `progression.defaults`) apply to every skill, and a skill's own `progression` overrides them field by field.

```json
"progression": {
  "line": "You have advanced in the art of {skill}!",
  "tables": { "wisdomBonus": { "stat": "wisdom", "start": 30, "tiers": [{ "above": 5, "add": -5 }, …] } },
  "curves": {},
  "defaults": {
    "chance": {
      "kill": { "roll": [{ "op": "set", "value": "skill" }, { "op": "add", "value": "wisdomBonus" }], "cap": "faction", "monsterCap": true },
      "shot": { "roll": [{ "op": "set", "value": "skill" }], "cap": 100 },
      "defend": { "roll": [{ "op": "set", "value": "skill" }], "cap": 100 },
      "cast": { "roll": [{ "op": "set", "value": "skill" }], "cap": "mage" }
    },
    "xp": {}
  }
}
```

**Sources.** Which skills a source trains is decided elsewhere; the progression decides how:

| Source | When | Which skills | `chance` guard and dice (code, as 1.6 had them) |
|---|---|---|---|
| `kill` | the holder kills a monster | the weapon's `skillGain.weaponSkills` row, in its order | 0 < skill < cap; then the roll; then the monster's cap (`monsterCap`) and `requires` |
| `shot` | each arrow shot | the bound `archery`, and `martialArts` with a crossbow | 0 < skill < cap; then the roll |
| `defend` | struck by a player or monster | the bound `parry` (also on a shield) or `block` | the roll first, then 0 < skill < cap and `requires` |
| `cast` | each of your own casts | the bound `magery`, then the spell's `school` | 0 < skill < cap; then the roll |
| `gather` | each harvest success at a node that `gains`, and each cast of the line | the node's `skill`; the bound `fishing` | `min` ≤ skill < cap; then the roll |
| `craft` | each craft that makes something | the craft's bound skill | `min` ≤ skill < cap; then the roll |
| `hit` | each melee, arrow or spell hit that does damage, PvP included | the weapon's skills (melee, arrows) or the spell's school | 0 < skill < cap; then the roll |

A skill with no settings for a source never trains from it and rolls nothing. Classic sets no `hit` settings.

**The `chance` model** is 1.6's: one point when `random(n) = 1`. Its settings are `{ roll, cap, requires?, monsterCap?, min? }`: `roll` is the [formula](#formulas) for `n`; `cap` the value the skill must stay below, `"faction"` (the faction perk `skillCap`), `"mage"` (the perk `mageCap`) or a number; `requires` `{ skill, above }` another skill over a value, tested after the roll (Classic: Thrust needs Slash over 30, Block needs Parry over 50); `monsterCap` (kill only) also needs the skill below the killed monster's cap (`monsters.json` `skillCaps`); `min` (gather and craft) the lowest value that rolls (0 when left out; the other sources need the skill above 0). A skill's own settings replace the default's fields one by one, and `false` turns a source off: `{ "model": "chance", "on": { "kill": { "cap": 70 }, "shot": false } }`.

**The `xp` model** gives XP per action, with no chance roll: `{ "model": "xp", "curve": "<name>", "cap"?, "on"? }`, its settings by source `{ xp, requires? }`. `xp` is a formula; a harvest node's `xp`, a craft row's `xp` (a cooking recipe, a smithing repair, an alchemy sand or a carpentry result) and a monster's `skillXp` replace it for that action. The skill's level is its value, so every rule that reads the skill reads the level, and the level follows the XP through the curve, never past `cap` (a cap as above), the curve's own `cap`, or 100. A level-up prints the advance line once per level. On the Skills page an `xp` skill's row shows its XP in the hover tip, `212 / 404 XP`, in full up to 99,999 and then to three figures, `13.0M / 14.4M XP`; a `chance` skill's row shows none, as 1.6's page.

**Curves** (`progression.curves`, by name; the format character levels will share in #42): `{ counting, table?, formula?, cap? }`. Leaving level L takes `table[L]` while the table lasts, then the formula (which may read only `level`, L). With `counting: "perLevel"` that is the XP from L to L + 1, counted from 0 within each level with leftovers carried (1.6's character levels: 30, then 400, then `400 + 2 × level`); with `"total"` it is the running total that reaches L + 1 (RuneScape's 83, 174, 276 …). The publish check refuses a curve that leaves a level below its cap uncovered, falls, rolls dice or passes 10¹² XP.

**XP is saved** as each skill's running total beside its value (`character_skills.xp`). Switching a skill from `chance` to `xp` starts its XP at its level's total; switching back keeps the value and leaves the XP unread; changing a curve keeps the level and holds the XP inside its range. None of these lowers a skill.

**The advance line** is `progression.line`, the same for every skill and source, `{skill}` being the skill's display name.

**Teaching items** (`item-rules.json` `use.skillBooks`): reading one uses it up only when it teaches: at its `upTo` or the skill's own cap, or when its formula gives nothing this read, it says there is nothing more to learn and stays. On a `chance` skill it adds `points` (a formula), never past `upTo`; on an `xp` skill it gives `xp` (or, without one, the points), the level never passing `upTo`. Classic's books add `1 + random(5)` up to 77.

#### Formulas

A formula is a number, or rows like attack power's tiers (but with the value written as text) applied in order to a result that starts at 0: `{ "when"?: ["<name> <op> <n>", …], "op": "set" | "add" | "subtract" | "multiply", "value": <number>, "random(n)", "a + random(n)" or <name> }`. A row applies when every `when` condition holds (`<` or `>`), and rolls its dice only then, in row order. A name is a stat (`strength`, `stamina`, `intelligence`, `wisdom`, `dexterity`), `skill` (the skill being trained), any skill by key, `level`, `tier` (the tool's tier; 0 without one), `damage` (a hit's damage, capped at what the target had left; `hit` only) or a **stat table** from `progression.tables`: `{ stat, start, tiers: [{ above, add }] }`, `start` plus every tier's `add` whose `above` the stat (or `level`) is over. Classic's `wisdomBonus` is 1.6's: 30, less 5, 7, 8, 5, 2 and 3 as Wisdom passes 5, 10, 15, 20, 22 and 23, so higher Wisdom makes kill gains likelier. The publish check refuses unknown names, `damage` outside a hit, a roll or XP amount that can never reach 1, and one that can pass 10⁹. A roll that falls below 1 for some characters is allowed: for them that source never gains, as 1.6's own Thrust roll (`40 − Stamina + skill + W`) did at a high enough Stamina. Teaching items' formulas are checked the same way. There is no scripting: a new kind of source is a new release.

#### Example: an XP world

Mining on a RuneScape-style curve to level 10 (a longer table, or a formula, goes further), 25 XP a rock, 70 for gold ore's rock:

```json
"curves": { "runescape": { "counting": "total", "table": [0, 83, 174, 276, 388, 512, 650, 801, 969, 1154], "cap": 10 } },
"defaults": { "chance": { … }, "xp": { "gather": { "xp": 25 }, "hit": { "xp": [{ "op": "set", "value": "damage" }, { "op": "multiply", "value": 4 }] } } }
```

with `{ "skill": "Mining", "progression": { "model": "xp", "curve": "runescape" } }` on the skill and `"xp": 70` on the gold rock's harvest node. The `hit` default gives every `xp`-model weapon skill 4 XP per point of damage; with `requires` rows on the bigger weapons ([Requirements](#requirements)), the skill gates the damage and the damage pays the XP.

### Example: a new gathering skill, from the Control Panel

Skills and gathering are edited on the Control Panel's **Skills & Classes** and **Gathering & Crafting** pages ([Running a server](running-a-server.md#the-skills--classes-page)), which write the rows above into the content draft. To add Quarrying, an XP skill trained by breaking quarry stone with tiered picks:

1. **Skills → New skill**: key `Quarrying` (one word: formulas name skills by their key, and it never changes), progression **XP and levels**, level curve `quarry` (a new curve). **Make it in the draft.** In its form, set the curve (say a table `0, 100, 100, 150` and the formula `200` past it); give the **Gather** source **its own settings** with the XP rows `set 10`, `multiply tier`; give Fighters a start value if you like. The preview shows the XP each level takes and how many actions each level costs, at the tool tier you pick.
2. **Items → New item**: `Bronze Pick` and `Iron Pick`, each copying the Mining Hammer; in each form, under its tool use, **Mine** at tier 1 and tier 2, sharing the counter `Pick`.
3. **Gathering → + New harvestable tile**: on a layer-2 tile, tool action **Mine**, turning into the spent tile, skill **Quarrying**, each harvest trains it, a new drop table `Quarry stone` (an item, 1 in N). The **Odds** tab shows, for each Quarrying value and pick tier, the swings per harvest, its chance, the drops and the XP each harvest gives.
4. Publish on the Publish Changes page. Breaking the stone with the Iron Pick gives 20 XP a success, twice the Bronze Pick's.

The pages write ordinary rows: `{ "skill": "Quarrying", "progression": { "model": "xp", "curve": "quarry", "on": { "gather": { "xp": [{ "op": "set", "value": 10 }, { "op": "multiply", "value": "tier" }] } } } }` in `skills`, the `quarry` curve in `progression.curves`, the two picks' definitions, and the node and its table in `gather.json`.

The editors combine the mechanics the engine has: a new kind of activity, such as swimming across water, needs code. To remove a skill, its form's **Remove…** lists everything that names it (skill books' formulas included) and the characters with a value stored; each reference is cleared or pointed at another skill, and characters keep their values.

## Bindings (`bindings.json`)

`packages/data/content/bindings.json` names the content the engine needs for its mechanics, so no mechanic depends on a 1.6 name in code. A binding a world leaves out turns its mechanic off. The currency is the exception: the [content contract](#the-content-contract) requires one.

Each top-level field is one row, edited on the Control Panel's page for it (the currency, cannon and bodies on Game Rules' **Currency and bodies**, the start on Skills & Classes' **New characters**, the skills on **Skills the game uses**):

| Row | What it holds | Classic | Left out |
|---|---|---|---|
| `currency` | `item`: the item a character carries as their purse ("gold" in the engine's words). A pile on the ground is named with its amount and the item's key, `15 Gold` (only that form: with a currency named `Coin`, an item named `Silver Coin` stays an item), and the purse, trades, shops, drops, `/drop 50 Gold`, NPC drop lines (`INV|50 Gold`) and treasure rows all read it | `Gold` | refused at publish |
| `start` | `hp`, `sp`: a new character's full vitals; `bag`: its first bag lines (`item`, `qty`), at most 15 | 20 and 20; 2 Apple, 1 Knife | required (the bag may be empty) |
| `cannon` | `ammo`: the item each cannon shot spends (a [vehicle](#vehicles-housesjson-vehicles) with `cannon`: Classic's Battleship) | `Cannonball` | the cannon never fires ("You have no cannonballs!") |
| `bodies` | the `Chars` body numbers the engine puts on a player: `morph` (Morph's table), `tree` (Nature Shift), `smoke` (Smoke Bomb, drawn as nothing to others). A rider shows its [vehicle row](#vehicles-housesjson-vehicles)'s `rider` | 30-41; 80; 100 | that spell does nothing |
| `skills` | the skills the engine reads, below | 1.6's skills | that mechanic is off |

Notes on the single bindings:

- **Changing the currency strands old piles.** Piles already on the ground, and NPC drop lines, treasure rows and Assassin prizes written as `<n> Gold`, keep the old name, which is then an ordinary item name that does not exist. The publish check names every content line that breaks; fix those in the same draft. The three pile pictures (`SmallGold`, `MediumGold`, `LargeGold`) are the engine's, whatever the currency is called.
- **Morph's table** is a list of `{ "above": n, "body": b }` rows. The spell rolls the [`balance.json`](#balance-balancejson) `buffs.morph` amount (Classic's `3 + power + random(5)`), and the last row whose `above` the roll is over picks the body.
- **A body is what peers see.** Each vehicle's rider needs its own body, and no spell body may be a rider's, or clients would draw a player as riding. The publish check refuses both, and a smoke body equal to the tree body.
- **Items named here are references.** Removing Apple, Knife, Cannonball or Gold on the Control Panel lists these rows among its uses: a start bag line or the cannon's ammo can be dropped by the cleanup, and the currency can only be replaced.

`skills` binds the skills the engine reads, by skill key:

| Binding | What reads it | Unbound |
|---|---|---|
| `parry`, `block` | the dodge rolls against player and monster hits, and their gains | no parrying or blocking: no roll is made |
| `archery`, `martialArts` | the gains on an arrow shot (`martialArts` with a crossbow) | that gain never rolls (Smoke Bomb's Martial Arts is its spell school, below) |
| `staffFighting` | the power of the fireballs a staff swings | just [`balance.json`](#balance-balancejson) `castPower.staffFireball` (Classic's `1 + random(3)`) |
| `magery` | the tiers of every cast's base power, and the Magery gain | no Magery tiers; no gain |
| `fishing` | the catch bands, the gain and the cast itself | no fishing: the pole is only a weapon |
| `blacksmithing`, `cooking`, `alchemy`, `carpentry` | the four crafts' timers, results and gains | that craft's button does nothing |

A binding that names a skill which does not exist is named at start and refused at every publish until it is fixed. Classic binds each to its 1.6 skill. The spell schools are each spell's `school` and `power` (see [Spells](#spells-spellsjson)). The gathering skills are each harvest node's `skill` and the swing ladders' `skill` (see [Tools and gathering](#tools-and-gathering)). How each of these skills rises is its [progression](#progression).

## The content contract

What a world must have before it can run. It is checked:

- at every publish, undo and "take the pack's version" on the Publish Changes page, which are refused while anything is missing;
- when Server Settings are saved: a start, fallback or jail point that cannot hold a player is refused (a point already broken does not stop other settings being saved);
- at start, where anything missing is printed (the server still starts, so the operator can fix it), and by `bun run maps:check`.

A world must have:

| What | Where | Rule |
|---|---|---|
| A currency | `bindings.json` `currency` | an item that exists, is not retired, and is named by its exact key |
| A start class | `classes.json` `startClasses` | at least one |
| A skill | `classes.json` `skills` | at least one |
| Start, fallback and jail points | Server Settings: Starting map, Fallback map, Jail | each on a map that exists, on a tile walkable on foot with nothing in a new character's way (no item from `item-rules.json` `ground.blocks`, and no skill or level platform from `ground.platforms`); and the start and fallback never on the jail's map (any spelling of it: `x00y0` is `x0y0`) |
| Riders told apart | `houses.json` `vehicles` | each vehicle's `rider` body is its own, and none is the tree's, the smoke's or a Morph row's |

The points are judged with the content being published, so a draft that takes a tile off `tiles.json` `walkable` is refused if a point stands on it. The jail's map holds whoever stands on it (no edges, exits or Portal, and anyone not serving a sentence is moved off), so a start there would put every new character in jail, and a fallback there would send released prisoners back in: a settings save that moves a start or fallback point onto the jail's map, or the jail onto theirs, is refused under the setting it changed. Every other binding and setting is optional, and so are the 1.6-shaped tables ([What a world may leave out](#what-a-world-may-leave-out)). The church bell's map is the **Church bell map** setting (`bellMap`; empty means no bell), which Classic servers start at x999y999.

## Starting a world: Classic or Minimal

Every world runs on a pack, chosen when its database is created (`SSO_CONTENT`; see [Choosing your starting content](running-a-server.md#choosing-your-starting-content)). There is no world without one.

| | Classic (`classic`, the default) | Minimal (`minimal`) |
|---|---|---|
| Source | `packages/data/content/` | `packages/data/minimal/` |
| Built pack | `packages/data/packs/classic/` | `packages/data/packs/minimal/` |
| Content | 1.6's, every table filled | the bare minimum: the start class Novice, one skill (`Fighting`, trained by unarmed kills), the currency `Gold`, the tiles `G1` (grass), `G3` (empty) and `5A` (shadow), Male and Female with one head each; no monster, NPC, spell, shop, quest, house, faction or casino game, and every [optional table](#what-a-world-may-leave-out) left out |
| Art | 1.6's, plus `assets/added/` | the few pictures it needs, listed in `minimal/pictures.json` and packed by `bun run assets:build` from the same sources as Classic's (copies of 1.6's) |
| World | its [world seed](#world-seeds): 1.6's 27 distributed maps, start `x1000y992` (6, 4), fallback (5, 5), jail `x0y0` (4, 4), bell `x999y999` | its [world seed](#world-seeds): an all-grass start at `x0y0` and an all-grass jail at `x50y50` |

`bun run data:build` validates and versions both packs the same way: each has a source `pack.json`, and a content change bumps its version. Every kind of art and sound a world draws or plays can be uploaded on a running server's Pictures & Sounds page: item pictures, worn layers, monster bodies, spell effects, tiles and sounds ([Art and sounds](running-a-server.md#art-and-sounds)).

**Building your own game on Minimal.** On a running server, use the Control Panel's [content pages](running-a-server.md#how-the-content-pages-work): every row the Minimal pack has can be changed or removed, and new rows (skills, classes, items, monsters, NPC files, spells, recipes, harvest nodes) are added the same way as on Classic. The contract keeps the world playable: a draft that removes the last start class or skill, or the currency, is refused. To change the pack itself (a fork), edit `packages/data/minimal/` and rebuild, as with Classic's content files.

**The pictures the engine names.** The engine draws a player from paperdoll layers it names itself, `BIM` (the shadow), `DEFBOD` (the bare body), `Bare Feet` and `Head<n>`, and a currency pile from `SmallGold`, `MediumGold` and `LargeGold` (by amount, whatever the currency is called). Like the [engine fixtures](#item-behaviours), the engine owns these names and a pack supplies their art; a pack that leaves one out draws nothing there. A running server's operators can upload over them (the currency's piles from its [Picture panel](running-a-server.md#item-pictures), the worn layers under [Worn layers](running-a-server.md#worn-layers); `BIM` is one picture, not a frame set, and stays the pack's). Both shipped packs carry them. The game frame (panels, menus, fonts, cursors, the interface clicks) is the engine's own art, served whatever pack a world runs.

### World seeds

A pack's manifest may name a world seed (`"world": "world.json"`), the world a new database created with that pack starts from (schema: `packages/data/schema/world.ts`):

```json
{
  "maps": [
    { "map": "x0y0", "title": "Grassland", "layers": [[...12 rows...], [...], [...], [...]] },
    { "map": "x50y50", "title": "Jail", "layers": [...], "flags": { "canFight": "O", "isIndoors": "O", "canPvp": "O" } }
  ],
  "startPoint": { "map": "x0y0", "x": 1, "y": 1 },
  "fallbackPoint": { "map": "x0y0", "x": 1, "y": 1 },
  "jailPoint": { "map": "x50y50", "x": 1, "y": 1 },
  "bellMap": null
}
```

Each map is a grid map (`x<n>y<n>`, whole numbers, negatives allowed) with its title (which may be empty), four 17×12 layers as the seed map has them, and its switches (`"O"` turns fighting, indoors or PvP off; all on when left out). A map may also carry the rest of the World Editor's fields, each empty when left out: `fctSpwn` among the switches (the faction whose member spawns in the roster's place), `exit1` and `exit2` (`{ "mx", "my", "x", "y" }`, with `"house": 1` or `2` for a house's interior), `signs` (three texts), `fog` (`{ "tex", "blend", "r", "g", "b" }`), `roster` (up to four `{ "slot", "species", "x", "y" }`, the placed monsters and their home tiles; nothing is live until one spawns) and `items` (up to 20 placed `{ "item", "x", "y", "qty" }`: a pile of more than one gives its count as `qty`, except the currency and crystals, which carry it in their name as the editor saves them, `"3 Gold"`; `"2 Apple"` is refused). Fog `blend` runs 0-255, as in the editor. An exit only works where its map has an `Exit` or `Exit2` item to step on, so a seed that wants working exits places those items too. The points must stand on the seed's own maps, and the start and fallback not on the jail's. The seed is applied once, when the server creates the database: from then on the maps are the world's (the World Editor's) and the points are Server Settings, so a pack update never moves them. Where nothing is stored, the engine's own points are the Minimal pack's: start and fallback at `x0y0` (1, 1), jail at `x50y50` (1, 1).

## Art and sound

The atlases are built per pack: Classic's into `packages/data/packs/classic/art/`, and the Minimal pack's few pictures (named in `packages/data/minimal/pictures.json`, by atlas group and lower-case key) into `packages/data/packs/minimal/art/`. The server serves only the art of the packs a world has installed, so a Minimal world sends no other 1.6 picture or sound.

Original extracted assets are indexed in [assets/original/usage.md](../assets/original/usage.md); do not edit `assets/original/`.

Corrections to original art live in [assets/original-sidecars.json](../assets/original-sidecars.json), keyed `<cast>/<member name>` (`Chars/31-F1-N`), with the same correction fields as an added file's sidecar (today `mirrored`). A test pins its contents, so change it together with that test.

Place new art and audio in [assets/added/](../assets/added/README.md) with a matching JSON sidecar next to each file (see [assets/added/README.md](../assets/added/README.md) for exact folder names, colour-key rules, registration points, and sidecar schemas):

- **Item icons:** PNG + sidecar in `items/`, named after the item's key (or its `sprite`); `"icon": "added"` in `items.json` has a data test check the file. An item has a picture when the atlas draws its `sprite`, or its key: `icon` is a record of where Classic's came from, and a new item may leave it out.
- **Spell FX:** `fx/<member>-<n>.png` (and `fx/x<member>-<n>.png` for trails listed in `TRAILS` in `packages/shared/src/rules/spells/spellfx.ts`).
- **Tiles:** 32×32 PNG + sidecar in `tiles/` plus a `tiles.json` row.
- **Sounds:** WAV or MP3 + sidecar in `sounds/`, referenced by name in `spells.json`, `gather.json`, `casino.json` or `item-rules.json` `swing.sounds`.
- **North frames:** draw paperdoll layers and bodies as seen from behind, with the right hand on the viewer's right. A north frame copied from an original keeps 1.6's mirror; set `"mirrored": true` on every north frame of that layer or body and the build flips them.

Hit rectangles for `fx`, `bodies`, and `items` are computed from the images and their registration points by `bun run data:build` (which writes the Classic pack's `rects.json`; `assets:build` only builds the atlases). After adding art, run both; `data:check` in the gate fails on a stale `rects.json`.

## Pack format

A content pack is a folder. The release ships two, Classic and Minimal, under `packages/data/packs/`. An exported pack is one file holding the same parts ([Exported pack files](#exported-pack-files)).

```text
<pack>/
  manifest.json      id, name, version, format, sso, contentHash, and optionally art, files, world
  data/<dataset>.json one file per dataset, each checked against its schema (packages/data/schema/)
  art/               built atlases, sounds and index.json (manifest "art"; Classic and Minimal)
  files/art/<sha256>.png          files the pack's art rows name (manifest "files")
  files/sounds/<sha256>.<ext>     wav, mp3 or ogg
  world.json         the maps and points a new world starts from (manifest "world")
```

| Manifest field | Meaning |
|---|---|
| `id` | The permanent id (`classic`): lower-case letters, digits and dashes. The pack owns the keys of the rows it defines. |
| `name`, `version` | What operators see; `version` is `major.minor.patch`, bumped whenever the data changes (`data:build` bumps the shipped packs' patch). |
| `format` | The pack layout: `1` for a folder, `2` for an exported pack file. |
| `sso` | The Second Star Online release the pack was made for (`1.10`). |
| `contentHash` | The first 16 hex digits of the SHA-256 of the pack's data at this version. |
| `art` | Optional: the folder of built atlases (`bun run assets:build` makes Classic's and Minimal's). |
| `files` | Optional: the folder of the files the pack's `data/art.json` rows name. |
| `world` | Optional: the world seed file. |
| `builtOn` | An exported pack's: the packs installed under it when it was exported, with their versions. |
| `exportedAt` | An exported pack's: when it was exported. |

A pack may leave dataset files out: the installed packs are merged in order, and only the merge must have every dataset a world needs, so an add-on pack installed over Classic may hold just the files it changes. (That is not the same as [What a world may leave out](#what-a-world-may-leave-out), which is about optional tables inside the datasets.) `data/art.json` is always optional. Its rows have the same shape as the `art` rows operators write on the Pictures & Sounds page ([Art and sounds](running-a-server.md#art-and-sounds)): item pictures, worn layers, bodies, spell effect runs, tiles and sounds, each naming its file by the SHA-256 of its bytes. Those files sit in the pack's `files/` folder under that hash; a pack without a `files` folder relies on the server's own upload store (an imported pack's files are stored there when it is imported).

How a pack's art rows behave:

- They are a layer of that pack's art: drawn over its built atlases, under any later pack's, and under the operator's uploads. An operator upload of the same name replaces one, and removing the upload brings the pack's back. The Pictures & Sounds page lists them as the pack's, like its built art.
- Each file is checked against its name when it is first read. A row whose file is missing or does not match draws nothing and is listed on the Publish Changes page under **Find problems → In content**, never as an error in play. The operator can't change a pack's files, so a damaged one never blocks a publish.
- The server's sweep of unused uploads only looks in its own upload store, so it never removes a pack's files. An operator row may name a file only a pack carries.
- Classic and Minimal carry no art rows: their art is their built atlases.
- A row's file is named by its SHA-256, so changing a file's bytes changes the row, and so the pack's `contentHash`: a pack update that changes a picture is a new version.
- `bun run data:build` builds only the shipped packs, from `packages/data/content/`. It keeps a pack folder's `art/` and `files/` as they are, but it doesn't write or check `files/`. Put together a pack of your own (its `data/art.json` and the files it names) as its own folder, or export it from a running server's Packs page.

### Exported pack files

The Control Panel's [Packs page](running-a-server.md#the-packs-page) exports the operator's published changes as one JSON file, `<id>-<version>.ssopack.json`, and imports such files:

```text
{
  "manifest": { "id", "name", "version", "format": 2, "sso", "contentHash", "builtOn", "exportedAt" },
  "data":     { "<dataset file stem>": { only the fields and rows it changes } },
  "removals": [ { "dataset", "part", "key" } ],   // key null for a whole section
  "files":    { "art/<sha256>.png": "<base64>", "sounds/<sha256>.<ext>": "<base64>" }
}
```

- `data` holds only what the pack changes: each field it has is checked against its schema on its own, and the store the installed packs make is checked whole. Rows replace the same keys of the packs under it and add new ones, as a later pack's always do.
- `removals` drop rows of the packs under it, as an operator's removal does.
- `contentHash` is the hash of `data` and `removals` together; a file changed after it was exported is refused. Each file in `files` must match the hash it is named by, and be a PNG or a wav, mp3 or ogg sound.
- Installed, the pack's files go into the server's upload store, and the database keeps the manifest, data and removals.

## The content report

After `bun run data:build`, run:

```sh
bun run content:report <name>
```

The report also searches NPC seed text in `npc-files.json`. Saved NPC edits in a running database can differ from this seed.

The report prints:
- exact catalogue matches across items, fixtures, monsters, and spells;
- every name-rule table whose rows match `<name>`, marking the deciding row with `>`;
- monster and editor lists containing `<name>`;
- an **As an owner** section showing rules triggered solely because a player or guild of that name owns a door, mailbox, vault, board, boat, airship, or newspaper.

A `contains` row also matches longer names holding the name (`<name>#12`, `<name>+3`, `Damaged <name>`). A new name table is picked up automatically; a test fails until it has a description in `packages/server/src/cli/content-report.ts`.

For example, `bun run content:report "Wind Cabinet"` shows why `Wind Cabinet` holds `20` lines instead of `10`:

```
item-rules.json containers.capacity: lines a container holds (last match wins)
    #4 contains "Cabinet" -> capacity=10
  > #5 contains "Wind Cabinet" -> capacity=20
```
