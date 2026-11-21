# Modding

Game data lives as JSON files in [packages/data/content/](../packages/data/content/README.md). Each file is validated against its strict Zod schema in [packages/data/schema/](../packages/data/schema/) (unknown or missing fields fail the build) and compiled into committed TypeScript modules in `packages/data/src/generated/`. A few rules that span files or rows are checked by the tests in `packages/data/tests/` rather than by the build (noted below), so run the gate after editing.

The [public image](running-a-server.md#docker-compose-recommended) is ready to host the standard game. In-game map, NPC, and settings edits persist in your database without rebuilding. To change the content files, assets, or code described below, clone the repository and build a custom image; these files are baked into the image and are not hot-reloaded at runtime.

The starter landscape is defined in [seed-map.json](../packages/data/content/seed-map.json), the enclosed Jail in [jail-map.json](../packages/data/content/jail-map.json), and the church bell map in [church-map.json](../packages/data/content/church-map.json). Each supplies a map title and four 17×12 tile layers. The seed map fills a fresh world; the Jail and Church are added where those coordinates are absent. Rebuild data and your image after changing them. Existing worlds keep their saved maps; use the in-game World Editor to change those. Keep the configured spawn and respawn tiles walkable.

## Workflow and validation

1. Edit the relevant JSON file in [packages/data/content/](../packages/data/content/README.md) (and add any new art or audio under [assets/added/](../assets/added/README.md)).
2. Regenerate the typed data modules:

   ```sh
   bun run data:build
   ```

3. If you added or changed art or sounds, rebuild the sprite atlases and sound index:

   ```sh
   bun run assets:build
   ```

4. Check for unintended name-rule collisions with `bun run content:report <name>` (see [The content report](#the-content-report)).
5. Run the relevant tests and the full verification gate:

   ```sh
   bun run gate
   ```

6. If you run the server with Docker, use the repository’s source-build `docker-compose.yml` (which builds `second-star-online:local`) and rebuild before restarting: the container bakes the generated modules, asset atlases, and prebuilt client into the image at build time, so mounted or edited JSON files are not hot-reloaded at runtime:

   ```sh
   docker compose up -d --build
   ```

Release baseline rows are fingerprinted in `packages/data/tests/content-baseline.json`; the corresponding test detects changed, removed or reordered rows. For intentional changes, review and update only the affected fingerprints and relevant behavior documentation.

## Ordered name tables

The original engine classified items, monsters, and spells by testing their names in script order using case-insensitive exact equality (`exact`) or substring matching (`contains`). In SSO, those tests are stored as ordered `{ "match": "exact" | "contains", "pattern": "...", ...result }` rows. Each table uses one of five combination rules:

- **First match wins:** the first matching row supplies the result.
- **Last match wins:** every row is tested in order and the last match overrides earlier ones.
- **Any match:** the table acts as a boolean list (`true` if any row matches).
- **Every match adds:** all matching rows' numeric bonuses or effects are summed.
- **In order:** every matching row applies, one after another in file order (`paperdoll.aliases`, where each row can rename the result of the one before).

Because `contains` tests the entire name string, it also matches runtime-generated names (`Crate#123`, `5 Blue Crystals`, `Long Sword+3`, `Damaged Helm`) and owner-prefixed fixtures (a player named `"Crate"` owns `"Crate's Door"`). Use `exact` when you want to match only a single name. Two tables also extend `exact` to masterworks: an exact row in `classes.json` `skillGain.weaponSkills` or an exact skill block in `attpower.json` also matches the `+1` to `+N` masterworks that `craft.json` `stations.smith.masterwork` makes from that weapon.

## Items (`items.json`, `item-rules.json`, `attpower.json`)

| Table (`item-rules.json`) | Decides | Wins | Result and default |
|---|---|---|---|
| `equip.slots` | Equipment slot | Last | `slot` (`LeftHand` is weapon hand); default `No` (not equippable) |
| `equip.strength` | Strength needed to equip | Last | `strength`; default `0` |
| `equip.twoHanded` | Two-handed weapons | Any | Boolean |
| `equip.murder` | The item that needs the murder flag (a single row, not a list) | Match | Boolean |
| `use.usable`, `use.effects`, `use.messages` | Food and potion use behaviour | See schema | Healing/messages |
| `use.silent` | Use does and says nothing (keys, deeds, seeds, `Map`) | Any | Boolean |
| `use.refusals` | The line Use shows for an item it does not accept (burned food) | Last | `text`; default "You cannot use the X." |
| `use.books` | Mysticism needed for a spell book | Last | `mysticism`; default `1` |
| `use.skillBooks` | Combat-skill books | First | `skill` raised and `shown` name |
| `menu` | Item menu button in place of Equip | Last | `Cook`, `Mix`, `Build`, `Smith`, or `Storage`; default `Equip` |
| `paperdoll.aliases` | Worn item sprite name | In order, per `layer` | `becomes` sprite name; default is the item's own name |
| `ground.blocks` | Ground items that block players and monsters; one the world placed cannot be picked up | Any | Boolean |
| `ground.platforms` | Blocks until a skill or level reaches `atLeast` | Any | `needs` skill or `level` |
| `ground.overlays` | Animated overlay on a ground item | First | `overlay`; default none |
| `ground.layers` | Draw layer | First | `hidden`, `overChars`, or `overLayer3`; default items layer |
| `ground.offsets` | Pixel offset from tile | First | `dx`, `dy`; default `0, 0` |
| `pickup.ctrlTexts` | Line Ctrl says on a fixture | First | `text`; `unpause` ends Ctrl's pause |
| `containers.capacity` | Lines a container holds | Last | `capacity`; default `containers.defaultCapacity` |
| `containers.uniqueIds` | Containers assigned a `#id` in a bag | Any | Boolean |
| `gear` | Stat bonus from worn item | Every match adds | `power` (`spell`, `blackArts`, `martialArts`, `attack`), `add`, `slot` |
| `swing.cooldowns` | Swing delays for a worn item | Last | `atDelay`, `actionDelay`; default `14, 14` |
| `swing.sounds` | Swing sound by weapon | First | Sound name or `null` (silent); default `swordswing` |
| `armour.*`, `breaks.*` | Armour mitigation and breakage | See schema | Mitigation / broken form |

### Dynamic and owner-name effects

Some keywords are handled directly in game logic or formulas without a table row:

| Word in the name | Effect |
|---|---|
| `Axe`, `Mining` | Axe and mining swing-speed cascades by skill |
| `Fishing` | Fishing swing delay |
| `bow` | Bow behaviour (arrows, crystals, bow skill block) |
| `Bow` with `Arrows` in off-hand | Arrow firing |
| `Crossbow` | Martial Arts gain for crossbows |
| `Key`, `Deed`, `Seeds` | Key, deed, and seed interactions (and `use.silent`) |
| `Door`, `door` | Silent door/exit gates |
| `Invis` (body armour) | Hides the wearer's name |
| ` Chest` (with leading space) | Openable chest |
| `+N` at the end (`Long Sword+3`) | Adds `N` to attack power |

Notes carried over from the code:

- **`use.silent`:** `Map` stays although no item has `"Map"` in its name, so its Use text can never show. The Ocarina is not on the list: the server plays its tune.
- **Platforms (`ground.platforms`):** the Experience Platform's step gate is level `21`, and its text says so. All four platforms' Ctrl text ends Ctrl's pause (`unpause`), as does the Street Lamp's.
- **Book table order:** the book Dexterity table (`use.books`) is `contains` and the last match wins, so `"Firebolt"` comes after `"Bolt"`.
- **Spell defense (`armour.spell`):** each row adds its `delta` to the spell damage a player wearing the item takes (positive for metal, negative for robes), and `magicShield` is added while Magic Shield runs.

### Adding an item

Add a catalogue entry to `packages/data/content/items.json`, plus rows in `item-rules.json` and `attpower.json` for any behaviour its name does not already match. Most rows match a specific weapon name, not a word: `equip.slots` has a `contains` row for each sword ("Long Sword", "Short Sword", …) and no row for "Sword" alone. So `"Elven Long Sword"` inherits the Long Sword's slot, attack power, Strength and kill training through those `contains` rows, and the generic Sword skill block, but not the Long Sword's Heavy Arms tiers, which are an `exact` block (it still needs a `paperdoll.aliases` row to be drawn as one), but `"Elven Sword"` matches no slot row and cannot be equipped until you add one; a novel name like `"Moonblade"` needs every row. Run `bun run content:report "<name>"` to see which rows a name picks up.

What still needs code: a new mechanic (an item that does something no table expresses), a new carried container's bag picture and sell swap, a new owner-named fixture, and anything whose name is built at run time.

#### Example: Moonblade

This illustrative example adds a sword `"Moonblade"` (`9 + random(6)` base power, Strength `15`, `LeftHand`, drawn on the paperdoll as `Broad Sword`):

1. **Catalogue (`items.json`, `items`):**

   ```json
   { "name": "Moonblade", "icon": { "member": 3, "castLib": 9, "asset": "bitmaps/165605_Broad_Sword.png" } }
   ```

   To use custom art instead of reusing an original icon, set `"icon": "added"` and place `items/Moonblade.png` and its sidecar under `assets/added/`.

2. **Slot (`item-rules.json`, `equip.slots`, appended at end):**

   ```json
   { "match": "exact", "pattern": "Moonblade", "slot": "LeftHand" }
   ```

3. **Attack power (`attpower.json`, `attPower.base`, appended at end):**

   ```json
   { "match": "contains", "pattern": "Moonblade", "expr": "9 + random(6)", "flat": 9, "randomN": 6 }
   ```

4. **Strength requirement (`item-rules.json`, `equip.strength`):**

   ```json
   { "match": "exact", "pattern": "Moonblade", "strength": 15 }
   ```

5. **Paperdoll alias (`item-rules.json`, `paperdoll.aliases`):**

   ```json
   { "layer": "weapon", "match": "exact", "pattern": "Moonblade", "becomes": "Broad Sword" }
   ```

**Intentional omissions in this example:**
- **Skill bonus to attack:** `attpower.json` `skillBlocks` adds Slash and sword-skill tiers to names containing "Sword", so `"Moonblade"` gets only its base roll, the Strength tiers and the Thrust block every weapon gets, unless renamed (e.g. `"Moonblade Sword"`) or given a `skillBlocks` entry.
- **Kill training:** which skills a kill trains comes from `classes.json` `skillGain.weaponSkills`; with no row there, a kill with `"Moonblade"` trains nothing. Add `{ "weapon": "Moonblade", "match": "exact", "skills": ["Slash", "Thrust", "Swordsmanship", "Fencing"] }`.
- **Breaking:** items break only if listed in `breaks.weapon.items` and `breaks.damaged`.

## Tiles (`tiles.json`)

`packages/data/content/tiles.json` contains `walkable` (the 2-character walkable code whitelist), `catalogue` (tile codes and flags), and `defaults` (`ground`, `empty`, `shadow`, `editorTile`).

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
| `ground` | Blank-map layer 1 ground | `H1` |
| `empty` | Blank-map layers 2 and 3, house footprint layer 2, house demolish reset | `G3` |
| `shadow` | Blank-map layer S shadow and the layer-3 `(7, 6)` mark | `5A` |
| `editorTile` | Initial selected tile when opening the World Editor | `G1` |

- **Walk whitelist (`walkable`):** every code in `walkable` must be exactly 2 characters.
- **Checked by tests, not the build:** the schema accepts any non-empty tile `code`; the rule that an added tile's code is 2 characters and unique in any case is enforced by `packages/data/tests/data.test.ts`, so run `bun run test` (or `bun run gate`) as well as `data:build`.
- **Other tile codes live with their systems:** tool tile changes and fishing water in `gather.json`, the newspaper stand (`K2`) in `social.json`, and rough terrain and house tiles in `houses.json`.
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

`packages/data/content/monsters.json` defines species stats (`monsters`), `editorLists`, ordered `rules`, `casting` (`spells`, the `SPL|` monster spell definitions, and `neverCasts`), `meleeAffinities` (weapon-against-monster damage changes), `skillCaps`, and `generic` (the body, hit points and defense a name not in `monsters` falls back to). See [Monsters guide](guides/monsters.md) for runtime behaviour and NPC script tags.

| Table (`monsters.json`) | Decides | Wins | Result and default |
|---|---|---|---|
| `rules.sea` | Species that spawn and move only on `sea` tiles | Any | Default land rules |
| `rules.footprint` | 3×2 wide monsters | Any | Default 1×1 |
| `rules.hostile` | Species off `editorLists.worldEditor.monsters` that walk toward players | Any | Default wanders |
| `rules.officer` | Attacks wanted players on no-fight maps | Any | Default skips no-fight maps |
| `rules.sparesInnocent` | Never hits an innocent player | Any | Default attacks anyone |
| `rules.clearsBlock` | Never blocks a player's step (`blockPCCheck`); clears no other block | Any | Default blocks its tile |
| `rules.killXp` | Melee/spell kill XP override after the ring | First | `xp`; default species `xpMelee`/`xpSpell` |
| `rules.killBroadcasts` | Server broadcast when a player kills the monster, by melee or spell (`{}` = killer name) | First | `text`; default none |
| `rules.namesSelf` | Click says `"This is <name>."` instead of opening Bio | Any | Default opens Bio |
| `rules.noQuests` | Gives no quests in `askForQuest` | Any | Default checks quest lines |
| `casting.neverCasts` | Never casts monster spells (`contains`) | Any | Default casts its `SPL|` tags |

Two lists in `editorLists` also drive gameplay:
- `worldEditor.monsters`: a whole entry (ignoring case) walks toward players; add species that should chase but stay off the editor list to `rules.hostile`. A name the list contains as text (`contains`) gets no quests and gives no treasure rumours, so `"Dragon"` is caught there through `"Dragon Hatchling"`.
- `npcEditor.npcs`: spawns only when `random(60) <= 2`. The test is `contains` over the whole list, so a name that appears inside a longer entry is caught too.

Every species row needs an `hp`. Its `attack` may be `null`: the species never melees.

### Adding a monster or NPC

1. Add a species record to `monsters.json` `monsters` (`bodyInMainChars: true` when its body has art).
2. Add its NPC file in `npc-files.json` (or via the NPC Editor; no file means it never moves and has no Bio).
3. Add its name to `editorLists.worldEditor` (`monsters` or `npcs`) and the matching list in `editorLists.npcEditor`.
4. Add a `skillCaps.byBody` row if it uses a new body number (default is `85`).
5. Add rows to `rules` or `casting.neverCasts` if it needs a behaviour its name does not already match, and add body art if it uses a new body.

### Body-number traps

These body numbers have rules of their own, all tested by equality (1.6 tested the member name as text, so a body ending in the same digits matched too; SSO compares the number):

- `90` (Spikes) and `99` (Holy Shield) never move and are not clickable; `92` (Web) never moves, is not clickable, never attacks and traps players who walk into it; `91` is the Pig (a click or Ctrl on the faced tile grabs it).
- `90` is destroyed by Dispel Illusions.
- `99` protects an innocent player standing on it from melee (`HitMe`); spells never test it.
- `61` is hurt by Minor Heal and Major Heal instead of healed.
- `36` is healed by Splash, `47` by Crush and `45` by Firebolt; Fireball does only `random(3)` to `45`.

Give a new species one of these numbers only if you want that rule.

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

Body `32` is the Wolf's, so the Frost Wolf reuses its art; a body with no art in the atlases would leave the monster invisible (its `<body>-f2-s` key is also missing from the generated `rects.ts`, which is a quick way to check).

`npc-files.json` is not only a seed: the server loads it at every start as the base NPC store, then applies the `npc_files` rows saved by the NPC Editor on top. So a rebuilt image changes every NPC that has no saved NPC Editor edit, on existing servers too.

### Shops and other NPC lines

An NPC's shop is lines in its NPC file (`npc-files.json`, or the NPC Editor on a running server), one `TAG|data` per line:

- `SEL|<item>:<price>:<stock>`: an item the NPC sells, at `price` gold, with `stock` left (the server lowers it as players buy).
- `BUY|<item>:<price>`: an item the NPC buys from players for `price` gold.
- `GLD|<n>`: the shopkeeper's till; purchases and gifts fill it and sales pay from it. Without one it starts at 0.
- `TRN|<class>:<price>`: a class promotion the NPC trains.
- The other tags: `BIO|` and `PRO|` (Bio window), `INV|` (monster drops), `RND|` (chatter), `FLG|` (`Still`, `Passive`), `SPL|` (monster spells), `BNK|` (banker) and `OWN|`.

The NPC Editor checks these forms when you save; see the [economy guide](guides/economy.md) for how shops trade.

## Other content files

These files have no worked example here; their schemas in [packages/data/schema/](../packages/data/schema/) document every field, and the matching [system guide](guides/README.md) describes what they do in play.

- **`gather.json`:** `gathering` (tools, the tiles they work on, finds by skill, regrowth, fishing water) and `skillGain` (the gathering and crafting skill rolls: chance, the skill range and the advance line).
- **`craft.json`:** `stations`: what each crafting station makes, from what, and at what skill.
- **`houses.json`:** house deeds and types, placement and building, doors, keys and switches, containers, resting regeneration and monthly decay.
- **`social.json`:** factions and their rules, murder, the Assassin's Game, high scores, guilds, chat rooms, buddies, Bios, medals, mail, boards, art tools and the newspaper.
- **`casino.json`:** the Slot Machine, Blackjack and Checkers tables, including their sounds.
- **`quests.json`:** the quest lines that seed a fresh database's `quests` table (`current`) and the pools a replacement quest is drawn from (`pools`).
- **`help.json`:** the help topics `/help <topic>` shows, with their lines.

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
- `fx`: array of FX runs (`member` unique across all rows, `effect` naming a run of the spell's `effect`, `frames`, `lastFrame`, `projectile`, `sounds` as `{ name, ch }[]`).

To add a new spell with an existing effect, you also need:
- an `id` that no other spell uses, or `null` (spellbooks are saved by name, so either persists; the schema only refuses a repeated non-null id);
- a book item in `items.json` (its `icon` can be `null`; a book is read whatever its icon), and optionally a `use.books` Mysticism requirement in `item-rules.json`;
- FX art `<member>-<n>` and hit rects (`fx/` under `assets/added/`; rects are generated by `bun run data:build`);
- sounds whose `name` is in the built sound list (`packages/data/build/assets-lib/select.ts` `SOUNDS`) or added under `sounds/` in `assets/added/`.

- **Validation:** [packages/data/schema/spells.ts](../packages/data/schema/spells.ts) restricts `effect` to `IMPLEMENTED_SPELL_EFFECTS` (the 36 original implemented effects) and requires every `fx[].effect` on a new spell to name an FX run of that original spell. Arbitrary `effect` names are rejected at `data:build`.

### Example: Ice Shard (reusing `Firebolt`)

Add to the end of `spells.json` `spells`:

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

And add its book item to `items.json` `items` (`"icon": "added"` gives it a picture; `null` would leave it without one, but it can still be read):

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
- `packages/shared/src/rules/spells/spells.ts`: `spellPower` (school bonus), `spellHitOnMonster` (monster hit), `playerSpellAmount` (player hit), `spellImp` (`IMP_EXITS`, `SCHOOL_ROWS`), and `directional` / `boltForm` / `fireballForm` if directional.
- `packages/shared/src/rules/spells/spellfx.ts`: `AT_CLICK` / `FROM_CASTER` in `placeFx`, and `TRAILS` if the effect leaves a trail.
- `packages/server/src/systems/spells/cast.ts`: `castIntent` (safe-map, directional, or Portal-style checks), and `planSummon` if it summons a creature.
- `packages/server/src/systems/spells/collide.ts`: `playerCollision` and `monsterHits`.
- `packages/server/src/systems/spells/buffs.ts`: if the effect applies a timed buff or debuff.
- `packages/client/src/playfield.ts`: draw-order or trail handling if special.

## Skills (`classes.json`)

`packages/data/content/classes.json` defines:

- `classes`: each class's `code`, `name`, optional `statBonus` and `promotion` (its `skillGrants`, and `statChanges`, an SPmax floor applied before the grants);
- `skills` (1-based `index` and `skill`) and `skillPanel` (`name` and 1-based `index` shown on the Skills page);
- `creation`: the new-character screen's data, including `creation.startingSkills["1"|"2"|"3"].values`, the starting skills of each starting class;
- `skillGain.weaponSkills`: which skills a kill trains for each weapon (`weapon`, `match`, `skills`).

- Shorter `startingSkills` `values` arrays are padded to `skills.length` with `NEW_SKILL_VALUE` (`1`).
- Existing characters saved with fewer skill rows load `1` for any newly added skill and persist it on their next save.
- Which skills a weapon trains is data (`classes.json` `skillGain.weaponSkills`), as are the gathering and crafting gain rows (`gather.json` `skillGain`), but each skill's roll is a handler in code (`RULES` in `packages/shared/src/rules/progression/skillgain.ts`, the cast gains in `packages/shared/src/rules/spells/spells.ts`, and the gathering and crafting systems that name their skill). So an added skill rises only via an `item-rules.json` `use.skillBooks` row, a promotion's `skillGrants`, or code.
- A class's `statBonus` (for example `{ "dex": 3 }`) is added to the stats of every character in that class while they are in it; change it and every such character follows.
- A class's `promotion.skillGrants` lists skills (by `skill` name) that the promotion raises to a roll of 1 to 10; a skill already higher keeps its value. `data:build` refuses a name not in `skills`.

### Example: Swimming

Append to `classes.json` `skills`:

```json
{ "index": 39, "skill": "Swimming" }
```

And to `classes.json` `skillPanel`:

```json
{ "name": "Swimming", "index": 39 }
```

## Art and sound

Original extracted assets are indexed in [assets/original/usage.md](../assets/original/usage.md); do not edit `assets/original/`.

Corrections to original art live in [assets/original-sidecars.json](../assets/original-sidecars.json), keyed `<cast>/<member name>` (`Chars/31-F1-N`), with the same correction fields as an added file's sidecar (today `mirrored`). A test pins its contents, so change it together with that test.

Place new art and audio in [assets/added/](../assets/added/README.md) with a matching JSON sidecar next to each file (see [assets/added/README.md](../assets/added/README.md) for exact folder names, colour-key rules, registration points, and sidecar schemas):

- **Item icons:** `"icon": "added"` in `items.json`, PNG + sidecar in `items/`.
- **Spell FX:** `fx/<member>-<n>.png` (and `fx/x<member>-<n>.png` for trails listed in `TRAILS` in `packages/shared/src/rules/spells/spellfx.ts`).
- **Tiles:** 32×32 PNG + sidecar in `tiles/` plus a `tiles.json` row.
- **Sounds:** WAV or MP3 + sidecar in `sounds/`, referenced by name in `spells.json`, `gather.json`, `casino.json` or `item-rules.json` `swing.sounds`.
- **North frames:** draw paperdoll layers and bodies as seen from behind, with the right hand on the viewer's right. A north frame copied from an original keeps 1.6's mirror; set `"mirrored": true` on every north frame of that layer or body and the build flips them.

Hit rectangles for `fx`, `bodies`, and `items` are computed from the images and their registration points by `bun run data:build` (which writes `rects.ts`; `assets:build` only builds the atlases). After adding art, run both; `data:check` in the gate fails on a stale `rects.ts`.

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
