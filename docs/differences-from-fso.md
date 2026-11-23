# Differences from First Star Online 1.6

Second Star Online is a remake of First Star Online 1.6 that fixes its exploits and bugs but keeps the feel of the original. This document records every deliberate difference from 1.6: what a player notices, what 1.6 did, what SSO does instead and why. It also records the 1.6 bugs SSO keeps on purpose.

## Policy

- **Keep the feel.** The art, sound, interface, world content and the way the game plays stay as they were in 1.6.
- **Fix unintended bugs.** Behaviour the original developer plainly did not mean (typos, misspelt names, checks that never run, values thrown away) is fixed, even when players got used to it. Operators tune content values for their own servers.
- **Close exploits.** The server owns game state and validates every client intent, so no player can harm the server or other players.
- **Keep some bugs on purpose.** When fixing a bug would be a design change rather than a correction, it is kept and listed under [Kept on purpose](#kept-on-purpose) with the reason.
- **Record design changes.** Deliberate changes to how the game plays are listed under [Design changes](#design-changes).

Record a difference in the same change as the code, as **Bug fixed** or under Kept on purpose when it resolves a 1.6 bug. Name its pinning tests `bug fixed: …` or `kept on purpose: …`. A pin in `packages/server/e2e/` names a step of a scripted scenario: each e2e file plays one story in order, so run the whole file to check that step, not the step alone by name.

Kinds are **Bug fixed**, **Kept on purpose**, **Architecture** (server authority and related design), **Exploit closed**, **Limit lifted**, **World content**, **Platform** (the move to a browser and a modern server), and **Other** for a remaining deliberate change.

An entry uses this shape; `Pinned by` is optional:

```markdown
#### Example difference
- **Kind:** Bug fixed
- **What you notice:** What a player sees.
- **1.6:** What the original did.
- **SSO:** What SSO does instead.
- **Why:** The reason for the difference.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `example test name` (packages/server/tests/example.test.ts)
```

| Section | Entries |
|---|---:|
| [Design changes](#design-changes) | 82 |
| [Fixed bugs](#fixed-bugs) | 300 |
| [Kept on purpose](#kept-on-purpose) | 12 |
| [Server authority and exploits](#server-authority-and-exploits) | 137 |
| [Not in SSO](#not-in-sso) | 40 |
| **Total** | **571** |

By system (the code folder that holds the change):

| System | Bugs fixed | Server authority and exploits |
|---|---:|---:|
| admin | [14](#admin) | [24](#server-side-admin) |
| casino | [16](#casino) | [3](#server-side-casino) |
| chat | [12](#chat) | [7](#server-side-chat) |
| combat | [27](#combat) | [7](#server-side-combat) |
| core | [3](#core) | [9](#server-side-core) |
| crafting | [28](#crafting) | [8](#server-side-crafting) |
| economy | [35](#economy) | [15](#server-side-economy) |
| housing | [19](#housing) | [6](#server-side-housing) |
| inventory | [36](#inventory) | [11](#server-side-inventory) |
| mail | [25](#mail) | [11](#server-side-mail) |
| monsters | [20](#monsters) | [3](#server-side-monsters) |
| movement | [5](#movement) | [4](#server-side-movement) |
| progression | [9](#progression) | [4](#server-side-progression) |
| social | [21](#social) | [9](#server-side-social) |
| spells | [24](#spells) | [9](#server-side-spells) |
| vehicles | [4](#vehicles) | [1](#server-side-vehicles) |
| world | [2](#world) | [6](#server-side-world) |

## Design changes

Deliberate changes to how the game plays, what it contains, or where it runs.

### Limits lifted

#### World editor saves keep loot and player drops
- **Kind:** Limit lifted
- **What you notice:** Saving a map in the World Editor leaves loot and player drops that appeared while it was open.
- **1.6:** Save rewrote the entire 20-slot item file from the editor's loaded sprites, wiping loot and drops that arrived after loading.
- **SSO:** The editor shows and saves only placed items, including operator placements and `/drop`, at most 20; loot and player drops are untouched.
- **Why:** The 20-item ground limit is lifted and saving a map should not destroy players' items.
- **In the code:** `packages/server/src/systems/admin/worldedit.ts` (`applySave`)
- **Pinned by:** `save: the placed monsters become the roster and live monsters at full HP; loot stays` (packages/server/tests/worldedit.test.ts); `design change: the editor shows and replaces only placed items, at most 20; loot and drops stay` (packages/server/tests/ledger-pins-d.test.ts)

#### No per-swing target slot limit
- **Kind:** Limit lifted
- **What you notice:** Every monster in the map instance can be considered by a melee swing.
- **1.6:** Melee tested only monster sprite slots 180–183.
- **SSO:** Every monster in the map instance is a candidate.
- **Why:** The per-screen sprite caps have been lifted.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`)
- **Pinned by:** `design change: a swing considers every live monster in the map instance` (packages/server/tests/ledger-pins-d.test.ts)

#### No per-screen cap on players, monsters or ground items
- **Kind:** Limit lifted
- **What you notice:** Everyone on a map is drawn, even when more than 15 other players are present; ground items likewise have no fixed slot cap. Monsters still have the original density.
- **1.6:** A screen had channels for 15 other players, five monsters or NPCs and 20 ground items. A sixteenth other player was invisible until a channel became free and they re-entered or you changed maps. Invisible players could not be clicked or given to and you walked through them; their melee, spell effects and sounds still reached you, but their arrows, swing animation and swing sound did not. The fifteenth drawn player never moved on screen; a name could take two channels and leave a nameless ghost body. Only the first four monster slots spawned, each from its own roster entry; monsters remained until killed.
- **SSO:** No fixed player or ground-item cap replaces the original limits: the map's tiles and server capacity are the practical limits. Every player on a map is drawn. The monster roster has up to four slots, each allowing one live monster with the original spawn odds. See [performance](performance.md) for measurements.
- **Why:** The original limits came from Director sprite channels rather than game design. The explicit monster population rule preserves the density that players saw.
- **In the code:** `packages/client/src/playfield.ts` (`createPlayfield`), `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`)
- **Pinned by:** `design change: every one of 36 other players and 40 ground items on a map can be clicked` (packages/client/tests/ledger-pins-d.test.ts); `kept on purpose: slot 5 never spawns: a roster has four slots` (packages/server/tests/monsters.test.ts); `design change: a slot with a live monster never spawns a second` (packages/server/tests/ledger-pins-d.test.ts)

#### Shop window lists every SEL line
- **Kind:** Limit lifted
- **What you notice:** A shop list includes every sale line and scrolls when it is longer than the visible box.
- **1.6:** The server listed `SEL|` lines only from the first 30 file lines; later ones were buyable only by a crafted name. No archived shop had such a line after line 20.
- **SSO:** The window lists every `SEL|` line and buying names the listed line. The List and Prices fields show about 13 lines and scroll when longer.
- **Why:** Operators author shops, and a hidden but buyable line was a window-size limitation.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`shopListIntent`), `packages/server/src/systems/economy/shop.ts` (`buyList`)
- **Pinned by:** `design change: a SEL line past file line 30 is listed and bought by its line` (packages/server/tests/ledger-pins-d.test.ts); `design change: a 40-line list shows every row and OK buys the clicked row's line` (packages/client/tests/ledger-pins-d.test.ts)

#### Houses build regardless of ground items
- **Kind:** Limit lifted
- **What you notice:** A house deed can be placed even when more than 17 ground items are on the screen.
- **1.6:** More than 17 ground items refused the deed with “This room is too crowded…”.
- **SSO:** Placement has no ground-item count check; the limit of two houses per map remains.
- **Why:** The ground-item cap is lifted, so the count no longer protects the original 20 slots.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`)
- **Pinned by:** `SSO: a deed builds with 25 items on the ground; 1.6 refused more than 17` (packages/server/tests/houses-db.test.ts)

#### No per-map ground-item slot limit
- **Kind:** Limit lifted
- **What you notice:** Ground items and loot can appear even when the old 20-item screen limit would have been full.
- **1.6:** A map's item file had 20 slots and loot used only slots 1–8. The client also refused gives and gathering drops when 20 items were on screen.
- **SSO:** The ground list has no fixed slot limit, those refusals are removed and loot always drops. Monster loot decays instead, as described under “Monster loot decays”.
- **Why:** The old limit came from Director sprite channels.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`addGround`)
- **Pinned by:** `design change: loot drops on a map already holding more than 20 ground items` (packages/server/tests/ledger-pins-d.test.ts); `design change: a give onto a map already holding 25 ground items lands and is grabbed`; `design change: a felled tree drops its logs on a map already holding 25 ground items` (packages/server/tests/ledger-pins-e.test.ts)

#### Monster loot decays
- **Kind:** Limit lifted
- **What you notice:** Monster loot and gathered items disappear after the configured time, 30 minutes by default. Player drops and operator-placed items do not decay.
- **1.6:** The server did not expire ground items; the map's 20 item slots bounded them.
- **SSO:** Loot and gathering drops, including logs, crystals, chunks, fish, produce and treasure, expire after an operator-set time. Player drops and admin placements never expire.
- **Why:** Without the ground-item cap, generated loot would accumulate without bound. Gathering also creates items from nothing, and 1.6's fishing allowance could be refilled forever by pressing an arrow key. Player drops remain because players used house floors for storage.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`decayLoot`), `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)
- **Pinned by:** `a killed Slime drops 2 Gold on its tile, as loot that decays after 30 minutes` (packages/server/tests/inventory.test.ts); `loot past its time is deleted when its map loads` (packages/server/tests/inventory-db.test.ts)

#### Monster population: one live monster per roster slot, sprite cap removed
- **Kind:** Limit lifted
- **What you notice:** Monsters refill each map's authored roster without a sprite-channel cap, while the original maximum density remains.
- **1.6:** Monster sprites occupied slots 180–184. Each slot spawned only its own roster entry, the fifth never spawned, and monsters did not despawn, so a screen saturated at four or fewer.
- **SSO:** An authored roster has at most four slots and each holds at most one live monster. Spawn attempts reproduce per-client rolls once per player, up to 15 players, with the same refill maths: two passes a tick, each passing a 1-in-80 gate (solo; the odds fall as more players share the screen, flattening at 7) and then a 1-in-5 roll, so about 10/q seconds on average solo, where q is the share of tiles the slot's monster may stand on. With more than 15 players, a random 15 roll each tick. There is no sprite cap.
- **Why:** The sprite cap was technical, but one live monster per slot preserved the density players saw. Without it an idle screen would gain roughly 12 monsters a minute indefinitely.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`, `spawnLadder`), `packages/server/src/systems/world/tick.ts` (`emulated`, `MAX_EMULATED_PLAYERS`, `actorPass`)
- **Pinned by:** `design change: a slot with a live monster never spawns a second`; `design change: spawn rolls run per player, two passes a tick, capped at 15 players` (packages/server/tests/ledger-pins-d.test.ts); `bug fixed: ladders: spawn 80…1300 by players, move 30…600 and 600 from the 8th on`; `gate, tile, random(5), pause: a Slime spawns on its rolled tile with pause 30`; `kept on purpose: slot 5 never spawns: a roster has four slots` (packages/server/tests/monsters.test.ts)

#### No 11-spell FX cap
- **Kind:** Limit lifted
- **What you notice:** More than eleven spell effects can be visible at once without replacing an older effect.
- **1.6:** Each client had eleven spell sprite channels.
- **SSO:** There is no fixed spell-effect cap.
- **Why:** The old limit came from Director sprite channels.
- **In the code:** `packages/server/src/systems/spells/fx.ts` (`freeSlot`, `placeQueued`), `packages/client/src/model.ts` (`applySnapshot`)
- **Pinned by:** `design change: fifteen effects on one map take fifteen slots, none replaced` (packages/server/tests/ledger-pins-d.test.ts)

#### Airship item caps removed
- **Kind:** Limit lifted
- **What you notice:** You can build or park an airship, boat or battleship even if 20 items are on the ground.
- **1.6:** Building or parking a vehicle was refused when the map had 20 ground items, with a too-many-items message.
- **SSO:** Neither the deeds nor unboarding has that cap.
- **Why:** The cap came from ground-item sprite channels.
- **In the code:** `packages/server/src/systems/vehicles/vehicles.ts` (`vehicleDeed`, `unboardVehicle`)
- **Pinned by:** `SSO: no 20-item cap at the deed or at the unboard` (packages/server/tests/vehicles.test.ts)

#### High scores have no upper limit
- **Kind:** Limit lifted
- **What you notice:** Every player's score can reach the High Score Statue, however large. Roles holding `noHighScores` (administrators by default) are still left off.
- **1.6:** A score of five digits or more was never submitted.
- **SSO:** No limit. A legitimate character can't come near 10,000 with the shipped caps, so this changes nothing on a stock server; on a server whose operator raises skill levels or caps, the board shows the higher scores.
- **Why:** The limit only guarded against edited characters, which the server's own score makes impossible, and it would hide the best players on a server with higher caps.
- **In the code:** `packages/server/src/systems/social/highscores.ts` (`submitHighScore`), `packages/shared/src/rules/social/highscores.ts` (`highScorePoints`)
- **Pinned by:** `no cap: a five-digit score counts` (packages/shared/tests/social/highscores.test.ts); `submitted on the save tick only; administrators skipped; five-digit scores count` (packages/server/tests/highscores.test.ts)

### World content and operator tools

#### Seeded jail and enforced confinement
- **Kind:** World content
- **What you notice:** `/jail` works on a fresh server. The stone jail at x0y0 has barred cells, an enclosed perimeter, no exits, and no landing pads. Prisoners arrive at tile 4,4 and remain until their sentence ends or staff use `/unjail`.
- **1.6:** Used the archived Jail map. Portal and death respawn could bypass the sentence.
- **SSO:** A migration adds a validated jail landscape if x0y0 is absent, preserving operator-authored jails. Portal, map exits and edge crossings cannot leave x0y0. Death revives prisoners at 4,4 and their sentence runs on. The jail does not overwrite a character's ordinary respawn point. Staff warps cannot take a prisoner out or put a player in (see [stored sentences](#jail-sentences-are-stored-and-run-in-real-time)). A deleted jail still produces the missing-map refusal.
- **Why:** A fresh server needs a working jail, and confinement must not depend on a prisoner's spells or inventory.
- **In the code:** `packages/data/content/jail-map.json`, `packages/server/src/persistence/seed-map.ts` (`jailMapSql`), `packages/server/src/systems/world/tick.ts` (`portal`, `takeExit`, `crossMapEdge`, `respawn`), `packages/server/src/systems/world/world.ts` (`enterRoom`)
- **Pinned by:** `the seeded jail encloses every walkable area and has no exits or landing pads`; `jail blocks Portal and exits while keeping the sentence and normal respawn point`; `death revives a prisoner in jail without restarting the sentence; expiry still releases`; `every jail edge refuses a map crossing, even for an arriving airship rider` (packages/server/tests/jail.test.ts); `the seeded jail confines Bob until his sentence ends` (packages/server/e2e/admin-and-settings.test.ts)

#### Control Panel
- **Kind:** World content
- **What you notice:** Admin → Control Panel swaps the game for a full-page dashboard. Its header has Return to Game, Friends, Who's Online, Send IM (with a count of IMs that came in), the chat rooms, Player Settings and Return To Title Screen; its sidebar lists the admin pages your role may use, starting with Server Settings, Characters, the Activity Log and Content, then the World Editor and NPC Editor. Floating windows open over it at their own size. You stay online but leave the map while you are there, as in the World Editor, and come back where you stood.
- **1.6:** There was no admin dashboard. An immortal's admin tools were the Admin menu's World Editor, NPC Editor and File Editor, each a screen or window in the game's 800×600 frame.
- **SSO:** The Control Panel is part of the client, using the same login and session. It opens for a role holding a permission with a Control Panel page (today Server Settings, Characters, the Activity Log and Content; see [Staff look characters up in a player hub, not their files](#staff-look-characters-up-in-a-player-hub-not-their-files), [The server logs what players do with items, gold and their time](#the-server-logs-what-players-do-with-items-gold-and-their-time) and [Operators change the game's content live, from the Control Panel](#operators-change-the-games-content-live-from-the-control-panel)); the server checks again and logs a refused request to the cheat log. Opening it leaves the map like the editors do: everyone there sees you go, trades, shops and held actions are cancelled and nothing on it ticks for you. Moving between the Control Panel and the classic editors never puts you back on the map in between. The classic menu bar belongs to the 800×600 frame, so it is not shown in the Control Panel. A page with unsaved changes asks before Return to Game, another page or an editor. The Server Settings window became the Control Panel's Server Settings page. Roles also get a permission for editing characters, which the player hub's Edit tab uses, and one for editing content, which the Content page uses.
- **Why:** Admin work needs full-page tables and forms that do not fit a floating window scaled with the game, and the Control Panel is where content, character and log tools will go (issue #22).
- **In the code:** `packages/client/src/ui/control-panel.ts` (`createControlPanel`), `packages/client/src/ui/control-panel-kit.ts`, `packages/server/src/systems/admin/control-panel.ts` (`openControlPanel`), `packages/server/src/systems/admin/worldedit.ts` (`leaveForEditor`, `mayEdit`), `packages/shared/src/rules/admin/permissions.ts` (`canOpenControlPanel`)
- **Pinned by:** `a player gets nothing; an admin leaves the room, stops ticking and gets the Control Panel`; `moving between the Control Panel and the editors never puts the admin back on the map`; `a player's controlPanelOpen is refused and written to the cheat log`; `a role that loses its Control Panel permissions is sent back to the game` (packages/server/tests/control-panel.test.ts); `the Control Panel replaces the game and its menu bar; Return to Game brings the game back`; `floating windows open over the Control Panel at their own size, and IMs are counted`; `unsaved changes ask before Return to Game, another page or a classic tool` (packages/client/tests/control-panel.test.ts); `every role that held every permission gets the new ones; the seeded roles match the defaults` (packages/server/tests/roles.test.ts)

#### Roster chat commands for operators
- **Kind:** World content
- **What you notice:** An administrator can inspect or change the four monster roster slots with `/roster`; the World Editor can also set them.
- **1.6:** A GM placed up to four monsters with the World Editor; there was no roster chat command.
- **SSO:** `/roster` lists the roster, `/roster <1-4> <species>` sets a slot and `/roster <1-4> clear` clears it. For anyone else they are an unknown command. The command remains useful for species the editor's lists do not offer; a slot set through it has no editor tile and appears on row 1 under its slot number. The first administrator comes from `bun run admin:role`.
- **Why:** Operators needed a way to place monsters before the editor existed.
- **In the code:** `packages/server/src/systems/admin/roster.ts` (`handleRoster`)
- **Pinned by:** `an administrator lists, sets and clears slots; the change is saved`; `SSO: anyone else is told it is an unknown command; nothing is said` (packages/server/tests/monsters-db.test.ts)

#### Spawn chat command for operators
- **Kind:** World content
- **What you notice:** An administrator can spawn a roster slot's species immediately on the faced tile with `/spawn <1-4>`.
- **1.6:** There was no spawn command. NPCs in a roster spawned at one thirtieth of a monster's rate, taking about ten minutes on average for a player alone on the map.
- **SSO:** The command reports “Spawned a <name> in roster slot <n>.” (“an” before a vowel) For anyone other than an administrator it is an unknown command.
- **Why:** Operators needed a way to place shopkeepers and bankers before the NPC editor existed.
- **In the code:** `packages/server/src/systems/admin/spawn.ts` (`handleSpawn`)
- **Pinned by:** `/spawn: an administrator places a slot's species on the faced tile at once; the slot is saved`; `/spawn: facing off the map is refused; anyone else is told it is an unknown command` (packages/server/tests/monsters-db.test.ts)

#### Staff /drop takes a count
- **Kind:** World content
- **What you notice:** An administrator can use `/drop <n> <item>` to place a stack of up to 9,999 items at once.
- **1.6:** `/drop` put one name on the ground. Gold and crystal piles carried a count; another pile gave one item. A bare dropped crystal name parsed into a useless quantity and item name.
- **SSO:** The command puts one pile on the faced tile, with crystals in their “<n> <Colour> Crystal” form and other stacking Inventory items carrying a quantity. Crates, cabinets, Wind Cabinets and Cauldrons take no count: a counted pile would grant several under one ID, and a bare one gets an ID when it enters a bag. A shop purchase of several gives each container its own line and ID (see [Every bought container gets its own id](#every-bought-container-gets-its-own-id)). A bare crystal name is a pile of one; the World Editor shows and saves the count.
- **Why:** Operators can stock the world without dropping items one at a time, and bare crystal piles work.
- **In the code:** `packages/server/src/systems/admin/drop.ts` (`parseDrop`, `handleDrop`)
- **Pinned by:** `SSO: a count from 1 to 9,999 on any stacking Inventory item`; `SSO: a bare crystal name is a pile of 1`; `/drop 20 Apple is one pile that adds 20 to the stack` (packages/server/tests/inventory.test.ts); `placed items take /drop's names; a counted pile round-trips` (packages/server/tests/worldedit.test.ts)

#### New characters start on the operator's start point
- **Kind:** World content
- **What you notice:** A new character starts at the server's configured start point, on the seed map by default.
- **1.6:** The character file started at x1000y992 tile 6,4; a server override was commented out. The death-respawn seed was x0y102 tile 5,5.
- **SSO:** The starting map (`startPoint`) and the fallback map (`fallbackPoint`, replacing `Starting Map.txt`) are operator settings; see [Every character has a respawn point](#every-character-has-a-respawn-point).
- **Why:** Archived maps are not shipped, so the original Test map and Brinkston are absent on a fresh server.
- **In the code:** `packages/server/src/game.ts` (`create`)
- **Pinned by:** `SSO: new characters start on the operator's start point setting, default x1000y992 (6, 4) on the seed map` (packages/server/tests/world.test.ts)

#### Monsters without art are not placeable
- **Kind:** World content
- **What you notice:** The monster editor does not offer monsters whose walking art is missing.
- **1.6:** Stone Skull, Dragon, Ogre, the Strippers and Overlord, bodies 500, 501, 503, 855–857 and 988, have no front-walk bitmap in the character cast and would have been invisible if placed.
- **SSO:** Their stats, loot and experience remain in the monster data, but the editor does not offer them.
- **Why:** An invisible monster never worked as a visible feature; an operator can enable one if art is added.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`), `packages/server/src/systems/admin/roster.ts` (`handleRoster`)
- **Pinned by:** `design change: the editor lists offer no art-less body; their data stays` (packages/server/tests/ledger-pins-d.test.ts); `an administrator lists, sets and clears slots; the change is saved` (packages/server/tests/monsters-db.test.ts)

#### The seed map keeps its archived Slime roster
- **Kind:** World content
- **What you notice:** A fresh server's seed map has a Slime to fight.
- **1.6:** The Test map at x1000y992 had a Slime in roster slot 1.
- **SSO:** Willowbrook Wilds, the forest-and-lake seed map at the same grid position, starts with that roster; operators can change it with `/roster`. The [seed roster migration](../packages/server/migrations/20261105_03_monsters.sql) inserts it.
- **Why:** Although archived maps are not shipped, the roster is the original one for that map position.
- **In the code:** `packages/server/src/persistence/migrations.ts` (`runMigrations`)
- **Pinned by:** `x1000y992 keeps its original roster, slot 1 Slime` (packages/server/tests/monsters-db.test.ts); `the seed map is named Willowbrook Wilds; a title already given is kept` (packages/server/tests/migrations.test.ts)

#### Archived maps not shipped; seeded starter, jail and church
- **Kind:** World content
- **What you notice:** A fresh server starts with Willowbrook Wilds, the enclosed Jail at x0y0, and the Church of the Bells at x999y999; its operators build the rest of the world.
- **1.6:** The server shipped 27 maps with item and monster sidecars, although community servers generally made their own worlds in the World Editor.
- **SSO:** The starting landscape comes from `packages/data/content/seed-map.json` and is applied only when the original map migration creates a new world. The Jail and Church come from validated content files and are added only where those coordinates are absent, preserving operator-authored maps. Existing saved maps are otherwise preserved. Spawn and respawn tiles are clear, and every walkable tile on the seed map is connected. Operators author further maps, monster rosters and NPC placements with the in-game editors. Game rules and catalogues ship as data; there is no original-format map importer.
- **Why:** Most community servers did not use the default world, and much of its placement data is missing from the archive; the jail and bell map are required by server rules.
- **In the code:** `packages/server/src/persistence/seed-map.ts` (`seedMapSql`, `jailMapSql`, `churchMapSql`), `packages/server/src/systems/admin/worldedit.ts` (`applySave`)
- **Pinned by:** `Willowbrook Wilds has a 17×12 lake, forest and rocks with empty upper layers`; `the start (6,4) and respawn (5,5) tiles are walkable, trees are not, every edge is reachable` (packages/server/tests/world.test.ts); `upgrades preserve both the old seed landscape and operator-authored maps` (packages/server/tests/migrations.test.ts); `the seeded jail encloses every walkable area and has no exits or landing pads` (packages/server/tests/jail.test.ts); `the seeded church is the validated Church of the Bells at x999y999 with no exits` (packages/server/tests/church.test.ts)

#### Hard-coded world references become operator settings
- **Kind:** World content
- **What you notice:** Treasure maps, portals and the hazard map remain dormant until the operator configures them for the server's world.
- **1.6:** Treasure used one of 21 hard-coded maps; the portal read a settings file whose archived target was missing, and hazards targeted a hard-coded map. None of the named treasure maps was archived.
- **SSO:** Treasure map lists, portal destinations and the hazard map are settings, empty by default. The item roll, dig and hazard rules are unchanged.
- **Why:** Those original map references do not exist in an operator-built world.
- **In the code:** `packages/server/src/settings.ts` (`defaultSettings`), `packages/server/src/systems/crafting/gather.ts` (`resetTreasure`)
- **Pinned by:** `design change: treasure maps, portal targets and the hazard map are empty by default` (packages/server/tests/ledger-pins-d.test.ts); `another map never finds it, and no list means no treasure` (packages/server/tests/gather.test.ts); `bug fixed: Portal with no destination is refused before SP and crystals are spent` (packages/server/tests/spells.test.ts)

#### Optional logon/logoff chat lines
- **Kind:** World content
- **What you notice:** By default login and logout update the Friends window without printing a chat line; players can opt into logon/logoff lines for friends only or for everyone in Settings → Chat.
- **1.6:** Presence messages updated an open Friends window but printed nothing in chat.
- **SSO:** Presence events always update the Friends window, and each player's `presenceChatLines` preference (`off`, `friends`, or `everyone`, default `off`) decides whether “<name> has logged on.” and “<name> has logged off.” also print in chat.
- **Why:** Players can choose visible announcements (or restrict them to friends) while the default matches 1.6.
- **In the code:** `packages/server/src/systems/social/presence.ts` (`presenceOut`), `packages/shared/src/rules/core/preferences.ts` (`defaultPlayerPrefs`)
- **Pinned by:** `per-player presenceChatLines prints logon and logoff lines for everyone or friends only` (packages/server/e2e/chat-and-presence.test.ts)

#### Seeded church bell map
- **Kind:** World content
- **What you notice:** A fresh server has the Church of the Bells at x999y999, the enclosed sanctuary where the church bell sounds. It has no exits or landing pads; players reach it by an operator warp.
- **1.6:** The bell rang for players on the hard-wired map x999y999.
- **SSO:** A migration adds the validated church landscape if x999y999 is absent, preserving operator-authored maps there. The map is fully enclosed, so walking cannot reach it or leak through its edges into a nonexistent neighbour. The bell's timer and sound behavior are unchanged.
- **Why:** The hard-wired bell map should exist on a fresh server.
- **In the code:** `packages/data/content/church-map.json`, `packages/server/src/persistence/seed-map.ts` (`churchMapSql`), `packages/server/src/systems/spells/hazards.ts` (`CHURCH_MAP`, `serverTimer`)
- **Pinned by:** `the seeded church is the validated Church of the Bells at x999y999 with no exits` (packages/server/tests/church.test.ts); `the church bell rings at the 20th run to x999y999, Churchy:5:200` (packages/server/tests/spells.test.ts)

#### Burned food and Cooked Meat
- **Kind:** World content
- **What you notice:** A burned meal leaves a charred version of its raw food: Burned Orc Meat, Burned Cyclops Meat, Burned Yeti Meat, Burned Meat, Burned Fish, Burned Trout, Burned Catfish, Burned Swordfish, Burned Squid or Burned Pig. Burned food stacks, cannot be cooked and has no use yet; trying to eat it says "That doesn't look very tasty." and keeps it. Raw Meat now has an icon, is dropped by Wolves (one of a Wolf's five loot lines, which rolls 1 in 5, so about 1 in 25 kills), can be eaten raw ("You eat some raw meat. You're disgusting.") and cooks into Cooked Meat.
- **1.6:** A burn printed its line and kept the raw food (see [Every craft takes its materials when it finishes](#every-craft-takes-its-materials-when-it-finishes)). There was no burned food. Raw Meat had no icon, no source and no recipe, though the item menu offered Cook for any name containing "Meat".
- **SSO:** Each cooking recipe in `craft.json` names its `burned` result, which a burn adds through the same full-bag check as a success. The burned icons, Raw Meat's and Cooked Meat's are the original raw-food icons recoloured (`tools/recolour-icon.ts`). The item menu offers Cook to the four meats by exact name, so burned meat has no Cook button. The new `use.refusals` table in `item-rules.json` gives burned food its line. Cooked Meat restores 9 + random(5) HP and 3200 Hunger, and Raw Meat 3 + random(3) HP and 1800 Hunger, like the other raw meats. The Wolf drop is in the seed NPC file, so a server whose Wolf file was saved in the NPC Editor keeps its own drops.
- **Why:** A burn should cost the raw food and leave something to show for it, and every item with a Cook button should cook.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`finishCraft`, `burnedResult`); `packages/shared/src/rules/inventory/equip.ts` (`useItem`); `packages/data/content/craft.json`, `items.json`, `item-rules.json`, `npc-files.json`; `assets/added/items/`
- **Pinned by:** `every cookable has a burned form: a catalogue item with art and no Cook button`; `Raw Meat cooks into Cooked Meat and burns into Burned Meat` (packages/shared/tests/crafting/craft.test.ts); `burned food is refused with its own line and kept`; `Raw Meat is eaten like the other raw meats; Cooked Meat like a cooked meal` (packages/shared/tests/inventory/inventory.test.ts)

### Browser platform

#### Attack input as a hold state with an early-press latch
- **Kind:** Platform
- **What you notice:** A quick attack press just before the attack rearms can still produce a swing.
- **1.6:** Tab was polled every frame, so a tap that ended before rearming was lost.
- **SSO:** The server polls held attack each tick and latches presses up to two ticks, or 100 ms, before rearming.
- **Why:** The latch allows for network jitter.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`setAttackHeld`, `pollAttack`)
- **Pinned by:** `SSO: a tap is latched for ${ATTACK_LATCH_TICKS} ticks: it swings if the attack re-arms by then`; `SSO: a tap older than the latch is lost, as 1.6's keyPressed poll lost it` (packages/server/tests/melee.test.ts)

#### Runs in a web browser
- **Kind:** Platform
- **What you notice:** The classic game runs in a browser, with draggable windows and a frame that scales to the browser window. On a phone or tablet the same layout appears and taps act as clicks; walking still needs a keyboard.
- **1.6:** The game ran as an 800×600 Windows Shockwave projector with Director sub-windows.
- **SSO:** The game uses one layout. Instant messages, biographies, Who, trade, the newspaper and other sub-windows become floating draggable windows. The frame scales to fit, including fractional scales when a whole number will not fit; the sharp-pixels setting restricts it to whole numbers. Small windows scale the same frame down. Live browser text uses the original font, size and colour, so glyphs differ slightly from Windows bitmap text.
- **Why:** A browser page cannot be a Windows projector; one classic layout keeps the game faithful to 1.6.
- **In the code:** `packages/client/src/app.ts` (`relayout`), `packages/client/src/ui/window.ts` (`createWindowLayer`)
- **Pinned by:** `desktop scale fills the window; sharp pixels forces whole numbers`; `a window smaller than 800×600 gets the classic layout scaled down: 700×400 → scale 400/620` (packages/client/tests/shells.test.ts); `floats at the original size scaled with the frame` (packages/client/tests/chat.test.ts); `design change: a sub-movie window floats in its own layer and drags by its title bar` (packages/client/tests/ledger-pins-d.test.ts)

#### A connection that falls far behind is reconnected
- **Kind:** Platform
- **What you notice:** If your connection falls far behind, it closes and immediately resumes with a fresh map view; other players see you leave and return.
- **1.6:** In a test with a paused receiver, the server queued outgoing data and dropped later messages once its buffer filled, while the client stayed connected. A separate client-side queue also had a 100-unread-message limit in an authoring test.
- **SSO:** When roughly 1 MB of updates waits for a connection, about a minute of crowded-map traffic, the server closes it with code 4007 and the client resumes as after a dropped connection.
- **Why:** A slow connection would otherwise fall minutes behind and could eventually lose updates, showing players who are no longer there.
- **In the code:** `packages/server/src/gateway/server.ts` (`sendWs`)
- **Pinned by:** `a socket with 2 MB waiting is closed with 4007, resumes, and the others see it leave and return` (packages/server/e2e/fell-behind.test.ts)

#### Title and login screens in a browser
- **Kind:** Platform
- **What you notice:** The title screen is a remade red-curtain backdrop with a Second Star Online logo, offering only Load Character and New Character, with a footer naming the original First Star Online 1.6 by unFun Games; those two choices work, and login and creation messages appear in an in-page box with OK.
- **1.6:** Exit quit the Windows projector, Server Editor opened a server-address entry and Game Setup opened local preferences; frame 10 showed an advert for the original website. Login and creation messages were Windows alerts with an OS beep. Credits were unreachable; the post-creation frames referenced a missing Story member and showed nothing before returning to the title.
- **SSO:** The title shows only Load Character and New Character; Game Setup, Exit, Server Editor and the advert are not offered, and the unFun Games credits and version line are replaced by a footer crediting the original. Sound is controlled in the in-game menu. A page connects to the server that served it, so the server picker has no screen. Messages use the original text in an in-page OK box without the alert beep. The unreachable credits, unavailable post-creation movie and unreachable later frames are omitted.
- **Why:** A browser page cannot quit or launch local tools, the advertised site no longer exists, the remake carries its own name while crediting the game it recreates, and native browser alerts block the page and vary by browser.
- **In the code:** `packages/client/src/ui/screens.ts` (`titleScreen`), `packages/client/src/ui/alert.ts` (`showAlert`), `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `the title offers only its two choices and credits the original instead of unFun Games`; `title actions call their corresponding callbacks` (packages/client/tests/ui-actions.test.ts); `design change: a login message is an in-page box with OK, never the browser's alert` (packages/client/tests/ledger-pins-d.test.ts)

#### In-game sound effects switch
- **Kind:** Platform
- **What you notice:** Game → Settings → Sound switches sound effects on or off (including on the title screen), alongside Master, Combat, Spells and World volume sliders, IM and friend-logon chimes, and a background-tab toggle.
- **1.6:** Sound effects were switched in the title screen's Game Setup and stored in local preferences per server; the default was on.
- **SSO:** Sound effects default to on, save per account on the server and cache in the browser for pre-login screens.
- **Why:** SSO does not offer the original Game Setup and a browser player needs volume and mute controls without logging out.
- **In the code:** `packages/client/src/ui/player-settings.ts` (`createPlayerSettingsWindow`), `packages/client/src/audio.ts` (`createAudio`)
- **Pinned by:** `design change: Sound Effects defaults to on on the title screen and the browser remembers it` (packages/client/tests/ledger-pins-d.test.ts); `divergence: off silences everything, 1.6's ungated sounds too` (packages/client/tests/sound.test.ts); `out of the game only what works there shows: the title has Game with Settings; login and creation add Return To Title Screen` (packages/client/tests/gamemenu.test.ts)

#### In-game menu
- **Kind:** Platform
- **What you notice:** The game has a Windows-style menu above the game, with Game and Chat, plus Admin for administrators. The items are regrouped by what they are for, items with hotkeys show their keybind on the right, and there is no Quit Game.
- **1.6:** The projector had a native Windows menu above the stage from program start, with File, Edit, Game and Plugins. Immortals received an Admin menu. Return To Title Screen and Quit were in File; preferences were on the title-screen Game Setup.
- **SSO:** The classic grey bar scales above the 800×600 stage without covering original click targets. Game contains Open Friend's List, Who's Online, Send Instant Message, Edit Newspaper, Settings and Return To Title Screen. Chat contains the four rooms, then Admin Chat for an administrator, then Clear Chat Text. Admin, for an administrator, sits after Chat and contains Control Panel, World Editor, NPC Editor, Return To Game and three Assassin commands, which are sent without confirmation. File, Edit, Quit Game and the MP3 player are omitted. Out of the game the bar shows only what works there: the title screen has Game with Settings alone, and the login and creation screens add Return To Title Screen; the other items, Chat and Admin appear once a character is in play. Return To Title Screen logs out, or leaves the login or creation screen. Clicking outside an open menu closes it. There is no Alt/F10 access, and the game continues drawing while a menu is open.
- **Why:** Browser scaling, controls and player preferences need a clean home. A page cannot close its own tab, so Quit Game could only log out to a screen asking the player to close it, which Return To Title Screen and the tab's own close button already cover. With Quit Game gone, File and Edit would each hold a single item, so the items are grouped by purpose: Game holds character/social tools, Settings and Return To Title Screen, Chat holds rooms (including Admin Chat), and Admin keeps only tools and events. Server Settings lives in the Control Panel (see [Control Panel](#control-panel)). Items that need a character are hidden rather than greyed before entry, so the title screen offers nothing that cannot work there.
- **In the code:** `packages/client/src/ui/gamemenu.ts` (`desktopMenus`)
- **Pinned by:** `no menu offers Quit Game: a page cannot close its own tab`, `an administrator gets Admin after Chat, and Admin Chat among the rooms`, `out of the game only what works there shows: the title has Game with Settings; login and creation add Return To Title Screen` (packages/client/tests/gamemenu.test.ts)

#### Scroll bars appear only when there is text to scroll
- **Kind:** Platform
- **What you notice:** The chat box and spellbook list show no scroll bar while their text fits; the bar appears in the same place once there is more text than the box shows.
- **1.6:** Director drew the `#scroll` field's bar beside the chat and spellbook fields at all times, even when empty.
- **SSO:** The bar sits where Director drew it but only shows when the text overflows. Its room stays reserved, so text does not reflow when it appears.
- **Why:** An empty track beside an empty box reads as a broken control in a browser, and the bar has nothing to do until there is text to scroll.
- **In the code:** `packages/client/src/styles.css` (`.director-scroll`, `.chat-log`)
- **Pinned by:** `divergence: the scroll bar shows only when there is text to scroll, in a gutter kept for it` (packages/client/tests/chat.test.ts)

#### Sound waits for your first click or key press
- **Kind:** Platform
- **What you notice:** Sound starts on your first click or key press, and that click is audible; a sound requested before then or before its file loads is skipped.
- **1.6:** Sounds could play from projector startup.
- **SSO:** Audio files load with the page. The first gesture starts audio, and later presses resume audio paused by the browser in the background. Earlier sounds are skipped rather than played late.
- **Why:** Browsers require a gesture before audio, and skipping delayed sounds keeps them in step with their causes.
- **In the code:** `packages/client/src/audio.ts` (`createAudio`)
- **Pinned by:** `every sound loads at page load; nothing plays before the first gesture, whose own click is heard`; `a sound not yet decoded, or not built, is skipped, never played late` (packages/client/tests/sound.test.ts)

#### Security headers and production mode
- **Kind:** Platform
- **What you notice:** A production server sends a minified browser client with security headers.
- **1.6:** The game was a Windows projector rather than a web page.
- **SSO:** `bun run start` sends `X-Content-Type-Options: nosniff` and a narrow Content Security Policy on every response, allowing only its own scripts and no plugins or `<base>`. An operator may add `frame-ancestors` with `SSO_FRAME_ANCESTORS`. `bun run dev` uses live reload and sends no CSP.
- **Why:** Framing and injected content are risks for a public web page.
- **In the code:** `packages/server/src/gateway/server.ts` (`securityHeaders`, `startGateway`)
- **Pinned by:** `serves /, /index.html, JS, CSS, PNG and /assets/ with MIME types and security headers` (packages/server/tests/gateway.test.ts); `design change: the CSP allows only own scripts, no plugins or <base>; frame-ancestors only when set`; `design change: production puts the headers on every response, a 404 too; development sends no CSP` (packages/server/tests/ledger-pins-d.test.ts)

#### Repeated identical chat lines collapse
- **Kind:** Platform
- **What you notice:** Consecutive repetitions of “You cannot fight here!” and “Your feet are stuck in the web, you cannot move!” show once with a ×N counter; other chat lines print each time.
- **1.6:** Per-frame refusal text appended a line every frame, and all other repeated lines were appended too.
- **SSO:** The server still emits each rejected tick. Only those two held-key texts collapse in the chat display; any other line interrupts the run.
- **Why:** Twenty identical lines a second would clear the six-line chat view; the underlying server events are unchanged.
- **In the code:** `packages/client/src/ui/chat.ts` (`createChatLog`), `packages/shared/src/rules/chat/chat.ts` (`REPEATING_LINES`)
- **Pinned by:** `divergence: identical lines in a row collapse with ×N; anything between starts a new line` and `a skill gain line prints every time, as 1.6 (5× "You have advanced in the art of Block!")` (packages/client/tests/chat.test.ts)

#### Chat and spellbook scroll with the browser's bar, in Director's place
- **Kind:** Platform
- **What you notice:** Chat and the spellbook use browser scrollbars beside their text fields, in Director's place; the bars use the browser's appearance and show only when there is text to scroll (see [Scroll bars appear only when there is text to scroll](#scroll-bars-appear-only-when-there-is-text-to-scroll)).
- **1.6:** Director drew an always-on bar outside each field: chat at x 765–780 and y 455–545, and spellbook at x 775–790.
- **SSO:** Each box is 19 pixels wider than its text field, leaving a 3-pixel gap and a 16-pixel bar in the same place; Firefox supplies its own bar width. Clicking the gap beside the spellbook field does nothing, as it was outside the original sprite. Previously the browser bar sat inside the field and left an empty strip outside.
- **Why:** Browser scrolling already supports the wheel, and its bar belongs where the original frame leaves room.
- **In the code:** `packages/client/src/ui/stage.ts` (`DIRECTOR_BAR_W`), `packages/client/src/ui/spellbook.ts` (`createSpellbook`)
- **Pinned by:** `the list box leaves the field 164 px of text and room for the bar at x 775-790` (packages/client/tests/spells.test.ts)

#### The chat entry sits in the chat frame's lower well
- **Kind:** Platform
- **What you notice:** The chat input's text sits inside the frame's lower field with equal padding on both sides and a little extra room from the left frame edge.
- **1.6:** The score put `sendchat` at (20, 560) as a 756×20 field, and Director drew its text from the field's top margin.
- **SSO:** The input box spans x 21–781 and y 556–576 inside the lower well of Internal #191/#186 (its interior is x 18–780, y 554–573). A browser input centres its single line and adds about 3 px at its inline start, so a matching 3 px right inset keeps the text margin equal on both sides; a 3 px extra left inset gives the text more room from the frame. The box starts 2 px below the well's top so the glyphs sit optically level in the field.
- **Why:** Using the score's text rect put the browser's centred line below the well and its padding to the right, so the entry text did not line up with the frame. The user requested the alignment, then the 2 px downward nudge, equal side insets, and a little more left margin.
- **In the code:** `packages/client/src/ui/shells.ts` (`createGameView`)
- **Pinned by:** `the stage puts the playfield and chat at their rects (frame 63)` (packages/client/tests/shells.test.ts)

#### Modern controls by default, with Classic and Custom rebinds in Settings
- **Kind:** Platform
- **What you notice:** By default you walk with W A S D, turn in place with Shift + W A S D, attack with Space, pick up or use with E, and open tabs/windows with C, I, K, B, F and O, keeping the right hand on the mouse. Game → Settings → Controls lets you switch back to Classic 1.6 (arrows, Alt + arrow, Tab, Ctrl, with extra hotkeys unbound) or rebind any action to Custom primary and secondary keys.
- **1.6:** Arrows walked, Alt + arrow turned, Tab attacked and Ctrl picked up or used, so both hands sat on the keyboard and clicking an NPC, a container or the inventory meant leaving the arrows. Keys could not be rebound.
- **SSO:** Modern (the default), Classic and Custom control sets are stored per account on the server and cached in the browser. Modern and Custom read physical key positions (`e.code`), so keys sit in the same place on AZERTY; Classic matches 1.6 by key name. Rebinding steals conflicts cleanly with an Undo link, reserves Meta and Escape, warns when Ctrl is paired with W, T or N, and displays active hotkeys subtly on tab tooltips and right-aligned in the top menu bar. In every layout directions resolve Left > Right > Up > Down, attacks hit the faced tile, clicking and spell casting are unchanged, and switching layout releases held keys.
- **Why:** Most players now expect W A S D and key rebinding in a browser game. Remapping inputs does not alter the server's game rules, keeping the 1.6 feel intact while preserving Classic verbatim.
- **In the code:** `packages/shared/src/rules/core/preferences.ts` (`rebindKey`), `packages/client/src/input.ts` (`LAYOUTS`, `keyDown`, `matchOneShotAction`), `packages/client/src/ui/player-settings.ts` (`createPlayerSettingsWindow`), `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `W A S D walk, with the same L > R > U > D priority`, `Shift + W A S D turns in place`, `Space is one attack hold state`, `E sends the action once per press`, `keys are read by position, so AZERTY's Z, Q, S, D walk`, `the classic keys do nothing; Tab and Alt are kept from the browser`, `nothing saved, or an unknown value, is Modern`, `switching layout releases what the old one held` (packages/client/tests/input.test.ts); `Game → Settings offers Modern, Classic and Custom Controls, Modern by default, and remembers the choice` (packages/client/tests/gamemenu.test.ts); `key rebinding steals duplicate keys with Undo, warns on Ctrl+W, and rejects Meta`, `Modern hotkeys switch tabs, toggle Friends/Who, and tab tooltips show subtle key hints` (packages/client/tests/player-settings.test.ts)

#### Player Settings window
- **Kind:** Platform
- **What you notice:** Game → Settings opens a six-page Player Settings window (Controls, Display, Sound, Chat, Social & privacy, Accessibility) with search, per-option descriptions, Save and Revert, and per-account persistence across browsers.
- **1.6:** The title screen's Game Setup offered only basic local switches (sound effects and server address); there were no volume sliders, chat sizing/timestamps, NPC chatter filter, privacy restrictions, ignore-list UI, colour-blind bars or larger tooltips.
- **SSO:** Preferences are stored per account (`account_preferences`) and mirrored to `localStorage` for pre-login screens, with floating window positions cached per browser and clamped to the viewport. The server enforces `imFrom` (staff always allowed), `tradeFrom`, `guildInvitesFrom`, `showNpcChatter`, `presenceChatLines` and live ignore-list sync; the client applies game size, damage numbers, master/combat/spells/world volumes, IM/friend-logon chimes, background-tab audio, chat text size/timestamps, colour-blind Amber/Sky-Cyan health & spell bars and larger hover tips.
- **Why:** Gives players modern comfort, privacy and accessibility controls without changing 1.6's underlying gameplay rules.
- **In the code:** `packages/shared/src/rules/core/preferences.ts`, `packages/server/src/persistence/preferences.ts`, `packages/client/src/ui/player-settings.ts` (`createPlayerSettingsWindow`)
- **Pinned by:** `prefsSave persists per account, replies prefsResult, and reloads on next login`, `imFrom=friends blocks strangers with a notice, allows friends, and always allows staff`, `tradeFrom blocks strangers or everyone and informs the requester`, `guildInvitesFrom blocks strangers or everyone and tells the guild leader`, `showNpcChatter hides ambient NPC chatter without hiding Radar/Inxition readouts` (packages/server/tests/preferences.test.ts); `lists all 6 pages, searches across options and keybinds, and confirms unsaved changes`, `bars apply colour-blind palette while preserving pixelated .art class`, `chat applies text size and retroactive timestamps without altering /logchat text`, `audio applies master + category volumes, background tab mute, and notification chimes` (packages/client/tests/player-settings.test.ts)

#### Clicking a game button leaves the keyboard available for play
- **Kind:** Platform
- **What you notice:** Clicking a game button leaves the keyboard available for movement and combat. A text field still takes the keyboard when focused, and focusing one releases held movement and attack keys.
- **1.6:** This browser focus behavior did not apply to the native projector.
- **SSO:** A primary pointer press on a game button leaves it unfocused and blurs the active field. A secondary press leaves focus alone.
- **Why:** A focused browser button can react to Space after a click.
- **In the code:** `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `a clicked game button does not keep focus, so Space cannot press it again`, `a secondary pointer press on a game button leaves the text field focused`, `focusing another game text field releases movement and attack` (packages/client/tests/chat.test.ts)

#### / opens chat with the slash typed
- **Kind:** Platform
- **What you notice:** In either layout, pressing / opens the chat input with the slash already typed, ready for a command such as /who. A draft kept with Escape stays, with the slash added after it.
- **1.6:** The chat field always had the keyboard, so / was typed straight into it.
- **SSO:** Since chat opens with Enter, / outside the input would otherwise do nothing (or open Firefox's quick find); it now opens the input and types the slash.
- **Why:** Commands start with /, and a shortcut keeps them one key away now that letters walk in Modern.
- **In the code:** `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `/ opens the input with the slash typed`, `/ after Escape keeps the kept draft and adds the slash` (packages/client/tests/chat.test.ts)

#### Chat opens with Enter
- **Kind:** Platform
- **What you notice:** Enter opens chat; while it is open, arrows, Home and End move the caret without walking. Enter sends and closes, while Escape closes and keeps the text.
- **1.6:** The chat field always had the keyboard, so arrow keys walked the character and moved the caret at the same time.
- **SSO:** Chat opens with Enter and captures those editing keys until closed.
- **Why:** This separates typing from walking and leaves room for other key bindings later.
- **In the code:** `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `Enter opens the input; arrows then walk nothing; Enter sends and closes it` (packages/client/tests/chat.test.ts)

#### Equipment icons, × markers and the paperdoll centred on their boxes
- **Kind:** Platform
- **What you notice:** Equipment icons, unequip markers and the character preview are centered on their boxes.
- **1.6:** The six equipment icons sat at locs x 646/746 and y 281/320/359 with their own registration points, near box centres x 643/743 and y 297/336/375. The 15×14 unequip markers sat about two pixels above the rows, three pixels from the left boxes and seven from the right; their own rectangles were clickable. The paperdoll sprite’s rectangle began at [673, 319].
- **SSO:** Each icon bitmap is centered in its box. The 15×14 markers are centered on rows and placed eight pixels outside both sides; the boxes themselves do not click. The preview moves so the bare character's drawn pixels sit at stage x 676–710, y 306–359 in the middle box; added gear does not move it.
- **Why:** The user requested centered icons. Director drew unstretched sprites at their own bitmap size and registration point, not the score's stale 32×32 size.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `design change: each icon's bitmap is centred in its box; the × markers centre on the rows, 8 px out` (packages/client/tests/ledger-pins-d.test.ts); `the × beside a box takes the item off; the icon does not click (score frame 63: channels 354-359 carry the remove-button names, sprites 75-80 nothing)`; `the Head × is shown and works` (packages/client/tests/panel.test.ts); `design change: the bare character's pixels sit centred in x 676-710, y 306-359; gear does not move it` (packages/client/tests/ledger-pins-e.test.ts)

#### Stats icons centred on their rows and evenly spaced
- **Kind:** Platform
- **What you notice:** The Level row's head and the stat icons line up with their labels and values, and every row has the same spacing.
- **1.6:** The six icons were one 24×177 cast-member bitmap drawn at its registration point at [635, 124]. Its glyphs were unevenly spaced, with row centres near y 131, 161, 195, 228, 261 and 291 on the stage, so the icons kept their own spacing rather than the text's.
- **SSO:** The bitmap's glyphs are clipped apart and each icon is centered on its row. Level (in 1.6's gold row, see [Gold moves to the Inventory tab](#gold-moves-to-the-inventory-tab-and-level-takes-its-row-on-stats)) and the five stats share a 30-pixel row grid, with icon centres at y 133.5, 163.5, 193.5, 223.5, 253.5 and 283.5; the label and value fields start on the same rows. The strip's gold glyph is no longer drawn.
- **Why:** The user requested the icons centered with their text and evenly spaced. The strip's baked-in spacing did not match the 30-pixel text grid, so each icon drifted a little further from its label down the column.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `the six stat icons are centred on the rows and evenly spaced, the head first` (packages/client/tests/panel.test.ts)

#### The four panel tabs share one row and an even pitch
- **Kind:** Platform
- **What you notice:** The Stats, Inventory, Skills and Spellbook icons sit on one horizontal row with equal gaps, and the larger icon for the open tab centres on the same point as its small icon.
- **1.6:** The four bitmaps include their wooden background and were drawn at their own stage rects: small-icon centres near (634.5, 36), (678.5, 34), (720, 33) and (763, 30.5), so the row sagged upward to the right. The larger open-tab icons at #206-#209 were separate opaque crops with their own centres, and the small glyphs were also baked into the panel bitmap Internal #186.
- **SSO:** The build cuts each tab bitmap out of its wood with a hand-drawn mask traced along the glyph's outline, and erases the four baked copies from #186. The small and large versions of each tab are centred at y 34 on x 634, 677, 720 and 763 (a 43-pixel pitch), and every click target is a 40×40 box on that centre.
- **Why:** The user requested the tab icons aligned like the stats icons. Because the source bitmaps were opaque crops, moving them without keying the wood would have dragged rectangular patches along and left the old baked glyphs showing.
- **In the code:** `packages/data/src/panel-tabs.ts` (the row and each icon's crop box); `packages/data/build/assets-lib/panel-tab-masks.ts` (the masks); `packages/data/build/assets-lib/panel-tabs.ts` (applying them and the #186 fill); `packages/client/src/ui/panel.ts` (`createPanel`); `packages/client/src/ui/shells.ts` (`frameArt`)
- **Pinned by:** `the four tab icons share a row and an even pitch` (packages/client/tests/panel.test.ts); `building twice gives identical bytes` and `every tab icon has a mask that covers its crop box` (packages/data/tests/assets.test.ts)

#### The panel wood below the page has no strip seam
- **Kind:** Platform
- **What you notice:** The grain in the wood under the Stats, Inventory and Skills pages runs straight across, with no step in its lines.
- **1.6:** Internal #186's wood was pasted together from strips, and two joins were a pixel out: below the page area (rows 279-439 of the bitmap, stage y 279-439), every grain line stepped down 1 px at stage x 636|637, and on rows 392-439 also stepped up at x 625|626.
- **SSO:** The build shifts the 11 columns between the joins (stage x 626-636) down. Where only the right join was out, the 1 px is spread across them, a twelfth per column; where both were out, the strip moves a whole pixel. The shift eases out over the rows below.
- **Why:** The user reported the steps as misaligned wood under the right panel.
- **In the code:** `packages/data/build/assets-lib/panel-tabs.ts` (`mendPanelSeam`, `PANEL_SEAM`)
- **Pinned by:** `the mended wood lines up across the strip` (packages/data/tests/assets.test.ts)

#### World Editor sign panel text and OK align inside its frame
- **Kind:** Platform
- **What you notice:** The sign text field sits inside the World Editor sign frame, and the panel shows one crisp OK.
- **1.6:** The score put the editable `SignText` field at (26,20) inside the sign panel, 228×54, and the 31×19 Internal #91 bitmap's top-left at (228,69) over the OK baked into Internal #10.
- **SSO:** The textarea starts at (24,24) with a 13px line height, clear of the frame's top border. Internal #91 is drawn at its natural 31×19 size at (233,72), exactly over the baked OK, inside the same 39×29 hit area.
- **Why:** A browser textarea starts its text at the top of its box, unlike Director's field inset, so the score's rect put text against the top border. Stretching the OK bitmap to the sprite's 39×29 box offset its glyph and left the baked OK showing beside it.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`), `packages/client/src/styles.css` (`.we-sign`)
- **Pinned by:** `the sign panel's text field and OK patch line up with Internal #10` (packages/client/tests/worldeditor.test.ts)

#### /logchat becomes a browser download
- **Kind:** Platform
- **What you notice:** `/logchat` downloads the main chat since login or Clear Chat Text. When typed in a room it downloads that room's log, then confirms in the main chat.
- **1.6:** The command wrote chat to a local Director preferences file.
- **SSO:** A browser download uses the second word as its filename, or `chatlog.txt` when absent, and prints “Logging the chat to file.”
- **Why:** Browsers have no Director preferences folder.
- **In the code:** `packages/client/src/app.ts` (`saveTextFile`, `runApp`)
- **Pinned by:** `design change: /logchat downloads the main chat as chatlog.txt or the named file, then says so` (packages/client/tests/ledger-pins-d.test.ts); `Enter sends the line; /logchat saves the room log; closing leaves` (packages/client/tests/im.test.ts)

#### Sub-movie windows as floating windows
- **Kind:** Platform
- **What you notice:** IM, Friends, Bio, newspaper and other separate windows float above the game and can be dragged while the game continues behind them.
- **1.6:** IM, Away, Who, Friends, chat, Bio, newspaper and checkers used Director movie-in-a-window windows.
- **SSO:** Those screens use draggable floating windows with original art. Mail, message boards, the paint screen and painting viewer draw at their stage positions; the newspaper reader and editor are floating windows with close boxes only.
- **Why:** Browsers have no Director movie windows; floating windows fill that role.
- **In the code:** `packages/client/src/ui/window.ts` (`createWindowLayer`)
- **Pinned by:** `design change: a sub-movie window floats in its own layer and drags by its title bar` (packages/client/tests/ledger-pins-d.test.ts); `floats at the original size scaled with the frame` (packages/client/tests/chat.test.ts); `the paint screen is 414×293 at (91, 72), the 4× image 256×256 at (242, 81), the viewer 229×87 at (330, 166)` (packages/client/tests/art-news.test.ts)

#### Local MP3 player dropped
- **Kind:** Platform
- **What you notice:** The in-game local MP3 player is unavailable.
- **1.6:** The MP3 player sub-movie played local files.
- **SSO:** It is not provided.
- **Why:** It has no gameplay role and browsers cannot access local music folders that way.
- **In the code:** `packages/client/src/ui/gamemenu.ts` (`desktopMenus`)

#### A photo shows the playfield only
- **Kind:** Platform
- **What you notice:** A photo contains the map, sprites and effects, but not open windows or name tags.
- **1.6:** A photo cropped whatever the stage showed in the lens rectangle, including windows and name tags.
- **SSO:** The client redraws the playfield without the lens and crops its canvas; windows and DOM name tags are separate page elements.
- **Why:** A browser has no Director stage image to copy.
- **In the code:** `packages/client/src/ui/paint.ts` (`takePhoto`)
- **Pinned by:** `a good shot hides the lens, redraws, crops 64×64 around the tap and saves a photo` (packages/client/tests/art-news.test.ts)

#### The Friends window opens only from the menu
- **Kind:** Platform
- **What you notice:** The Friends window opens when you choose Game → Open Friend's List, rather than appearing automatically on entry.
- **1.6:** Frame 50 opened Friends at every game entry and again on an admin's Return To Game; the menu reopened it.
- **SSO:** The server fills the Friends lines at entry and Return To Game and keeps them current while the window is closed; the menu opens the window.
- **Why:** A window popping up at every login gets in the way, and the list is one menu item away.
- **In the code:** `packages/server/src/systems/social/friends.ts` (`friendsEntry`), `packages/client/src/ui/gamemenu.ts` (`desktopMenus`)
- **Pinned by:** `divergence: game entry fills the Friends window but opens it at no size; a player's bio opens the Bio window` (packages/client/tests/npceditor.test.ts)

#### Buddy and ignore lists per account on the server
- **Kind:** Platform
- **What you notice:** Your buddy and ignore lists follow your account across logins and devices and are shared by its characters.
- **1.6:** Buddies were saved in a local preference named for the server IP and shared by characters on that computer. The ignore list existed only for the session and cleared at login.
- **SSO:** Both lists are stored per account. Ignores persist across logins using the original text form and quirks; buddies preserve the original list items and tests, and the server keeps Friends-window lines from sessions. The windows remain.
- **Why:** Browsers lack Director's local preferences file, and persistent ignores protect players from repeat harassment.
- **In the code:** `packages/server/src/systems/social/friends.ts` (`friendsEntry`, `friendsCommand`), `packages/server/src/systems/chat/ignore.ts` (`ignoreCommand`)
- **Pinned by:** `divergence: the list follows the account across logins and fills the window at entry; others are untouched` (packages/server/tests/buddies-db.test.ts); `the list follows the account across logins; other accounts are untouched` (packages/server/tests/ignores-db.test.ts)

#### Death busy-wait becomes a 27-frame input lock
- **Kind:** Platform
- **What you notice:** After death the playfield goes black and holds its picture for 27 frames while the rest of the world, side panel and chat keep running; then the respawn map appears.
- **1.6:** A busy wait froze the whole client for 80 timer ticks. The playfield went black in one frame and lit again around 2.5 seconds later on the respawn map, including about one further second for the warp round trip and map load.
- **SSO:** The dead player's intents are ignored for 27 frames, about 1.33 seconds. During that lock the map layers are black, ground items are gone, and players and monsters hold their death-frame picture. The side panel, bars and chat continue updating; the extra network-loading black time is not copied.
- **Why:** A shared server cannot block, and freezing other players was never intended.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`tick`), `packages/client/src/playfield.ts` (`createPlayfield`)
- **Pinned by:** `death: the dying player gets { t: "death" } after the tick's vitals, once, and nobody else does` (packages/server/tests/monsters.test.ts); `death: black for one draw, then frozen until the respawn map is drawn` (packages/client/tests/death-stage.test.ts)

### Other design changes

#### Building furniture requires facing a Carpentry Bench
- **Kind:** Other
- **What you notice:** Building from Logs requires facing a Carpentry Bench while standing still. Operators place the bench in the World Editor before players can build.
- **1.6:** Building required a Saw and Logs and could start anywhere.
- **SSO:** Build checks the Carpentry Bench before checking the Saw and Carpentry skill. The Carpentry Bench is a fixed station whose saw moves while someone builds at it.
- **Why:** Carpentry needs a workstation like the other crafts.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startBuild`)
- **Pinned by:** `design change: carpentry requires facing a Carpentry Bench before checking the Saw` (packages/shared/tests/crafting/craft.test.ts)

#### Crafting stations animate only while in use
- **Kind:** Other
- **What you notice:** A Stove, Anvil, Alchemy Lab or Carpentry Bench stands still until someone crafts at it. While a player crafts facing it, everyone on the map sees it work: the Stove's fire flickers and its flue smokes, the Anvil throws sparks and its quench bucket ripples, the Alchemy Lab bubbles and the bench's saw moves. It stops when the craft finishes or is interrupted. Campfires, torches, fountains, crystals and other scenery still animate all the time.
- **1.6:** The Alchemy Lab bubbled all the time, whether or not anyone used it. The Stove and Anvil were still pictures.
- **SSO:** The Stove and Anvil have four-frame overlays (`SV`, `AN`) like the Alchemy Lab (`AL`) and Carpentry Bench (`WB`). Those four stations are listed in `ground.inUse`, so their overlays draw only on a tile a crafting player faces. The server tells the map when a player starts or stops crafting with a `craft` event, and a player arriving on a map sees anyone already crafting there with `crafting` set. A craft ends when the crafter dies or is moved or turned off the spot.
- **Why:** A moving station shows at a glance that someone is crafting there, and every station behaves the same.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`stationInUse`), `packages/server/src/systems/crafting/craft.ts` (`craftShownChange`), `packages/client/src/playfield.ts` (`createPlayfield`), `packages/data/content/item-rules.json` (`inUse`)
- **Pinned by:** `design change: the crafting stations animate only in use; scenery always does` (packages/shared/tests/inventory/ground.test.ts); `design change: the map hears a craft start on the next tick and its end on the last frame` (packages/server/tests/craft.test.ts); `design change: a craft event animates the station the crafter faces, until it stops` (packages/client/tests/model.test.ts); `design change: a Stove's overlay draws only while you craft facing it; a Campfire's always` (packages/client/tests/station-overlay.test.ts)

#### Ctrl and item clicks answer at once
- **Kind:** Other
- **What you notice:** After Ctrl, or a click on a container, mailbox, casino table, Guild Center, guild board, newspaper stand, statue or high score list, your next item action waits only a fifth of a second (4 frames). Boarding and getting off an airship, boat or battleship no longer hold Ctrl for 2 seconds. A Ctrl pressed during that short pause is kept and runs when it ends. A Ctrl during a switch's or key's longer pause is still ignored.
- **1.6:** Ctrl and those clicks set a 40-frame pause (20 for newspapers, statues and high scores), and Ctrl also waited for the server's reply before it would act again. A pickup's inventory reply ended the pause after one round trip, but presses with no reply, such as boarding, getting off, signs and lamps, waited the full 2 seconds, and any press inside it was ignored.
- **SSO:** Ctrl and those clicks pause `ACTION_PAUSE` (4) frames. The client sends one action per key press, the server answers in the same tick and checks every action, and the gateway limits message rates, so the long pause had nothing left to guard. The 4 frames absorb a double press. A Ctrl pressed during it sets `actionQueued`, and the press runs when the pause ends. The click pauses are the data values `containers.clickPause` and the statues' `pause`.
- **Why:** The 2-second wait came from waiting on the network. Without the network round trip it made boarding and quick actions feel unresponsive and dropped presses with no message.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`ACTION_PAUSE`), `packages/server/src/systems/inventory/items.ts` (`actionIntent`), `packages/server/src/game.ts` (`tick`), `packages/client/src/model.ts` (`pressAction`)
- **Pinned by:** `SSO: Ctrl pauses ACTION_PAUSE frames, so boarding and getting off take a fifth of a second`, `SSO: a Ctrl pressed inside the short action pause runs when it ends`, `SSO: a Ctrl pressed during a long pause (a switch or a key) is dropped, as in 1.6` (packages/server/tests/vehicles-db.test.ts); `SSO: Ctrl sets the 4-frame item-action pause: Use waits it out` (packages/server/tests/inventory.test.ts)

#### Staff can wear their role in chat
- **Kind:** Other
- **What you notice:** With the Role tags setting on, a staff member's lines show their role's name before their name, such as `[Admin] Berlyn says "hi"`, in local chat, `/me`, broadcasts, chat rooms, guild chat and staff chat. Players' lines are unchanged. It is off by default.
- **1.6:** Nothing in chat showed who was staff.
- **SSO:** `taggedName` puts the role's display name in brackets before the speaker's name when the `roleTags` setting is on. IMs keep the plain name, because it is where a reply goes, and ignore lists still match the plain name.
- **Why:** Players can tell staff from impostors when the operator wants them to.
- **In the code:** `packages/shared/src/rules/admin/permissions.ts` (`taggedName`), `packages/server/src/systems/chat/chat.ts` (`handleChat`)
- **Pinned by:** `role tags: off by default; on, staff speak as [Role] Name and players as themselves` (packages/server/tests/roles.test.ts); `the tag is the role's name, only when the setting is on and the speaker has a role` (packages/shared/tests/admin/permissions.test.ts)

#### Moderators play by the same rules as players
- **Kind:** Other
- **What you notice:** A moderator moderates other players but gets no advantage in play: `/warp`, `/warptome`, `/warpmeto` and `/warpscript` are unknown commands to them, and a moderator role that an operator grants `/pardon` still cannot pardon themselves. An administrator can still warp and pardon anyone, themselves included.
- **1.6:** Moderators could warp themselves anywhere, pull players to them, follow a friend with `/warpmeto` and clear their own murder flag with `/pardon`.
- **SSO:** Each role is a set of permissions (`DEFAULT_ROLES` are the ones a new server starts with). The default moderator's leaves out the warps, and pardoning or warping yourself needs its own permission (`pardonSelf`, `warpSelf`) that only administrators hold by default. Moderators keep one exemption: the per-address login limit never refuses them, so staff behind a shared address can still log in during a flood of bad logins.
- **Why:** Moderators are players who moderate. Warps and self-pardons let them travel or escape the murder penalty in a way other players cannot.
- **In the code:** `packages/shared/src/rules/admin/permissions.ts` (`DEFAULT_ROLES`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `a moderator has no tools or gameplay exemptions except the login-limit bypass` (packages/shared/tests/admin/permissions.test.ts); `a moderator may run the moderation commands, but not IP bans or /setclass`, `divergence: /warpscript is an unknown command to players and moderators; administrators set it`, `divergence: a moderator cannot pardon or warp themselves; an administrator can` (packages/server/tests/admin.test.ts)

#### Pardons, IP lookups, saves and settings reloads are administrators'
- **Kind:** Other
- **What you notice:** By default `/pardon`, `/IPlookup`, `/save` and `/Refresh` are unknown commands to a moderator. Administrators keep them, and an operator can grant any of them to a role on the Roles page. A server upgraded from v1.11.0 loses them from its Moderator role only if the operator never changed that role's permissions.
- **1.6:** Moderators could look up any player's address with `/IPlookup` and clear murder flags with `/pardon`.
- **SSO:** The default `MODERATOR` role leaves out `pardon`, `iplookup`, `save` and `refresh`. The `20261121_45_moderator_defaults.sql` migration removes them from a stored `moderator` role whose permissions are still exactly the v1.11.0 seed, in any order, and leaves an edited role alone.
- **Why:** A pardon undoes the murder penalty and an IP lookup shows a player's address, so both are trusted actions. Saving and reloading settings are server upkeep, not moderation.
- **In the code:** `packages/shared/src/rules/admin/permissions.ts` (`MODERATOR`), `packages/server/migrations/20261121_45_moderator_defaults.sql`
- **Pinned by:** `moderators keep the moderation commands; IP bans, warps, /setclass, /cheatfile, /pardon, /iplookup, /save and /refresh are administrators'` (packages/shared/tests/admin/admin.test.ts); `divergence: /pardon, /IPlookup, /save and /Refresh are administrators' by default` (packages/server/tests/admin.test.ts); `divergence: an untouched moderator role loses /pardon, /iplookup, /save and /refresh`, `a moderator role the operator has edited is left as it is` (packages/server/tests/roles.test.ts)

#### Mutes
- **Kind:** Other
- **What you notice:** Staff can `/mute <name> [duration] [reason]` a player (10 minutes by default, the `muteLength` setting) and `/unmute` them. A muted player is told in the chat box until when, and again each time they try to talk or log in. They cannot use local chat, `/me`, broadcasts, IMs, guild chat, chat rooms, staff chat, mail or board posts, but can still send an IM to staff to ask why. Player-shop commands are refused too. Their away text answers staff only. They are told when it ends.
- **1.6:** There was no way to silence a player short of a ban or the jail.
- **SSO:** A mute is stored on the account like a ban and runs in real time like a sentence, offline too; it follows the same rank and ownership rules as bans and jails (`mayTarget`, `mayChange`), and `/banlist` lists it. Every way of talking asks `silenced` first, and so do player-shop commands, which are typed into chat. Staff chat asks it too: a muted staff member cannot post there, while a jailed one still can (it reaches only staff, like an IM to staff).
- **Why:** Spam and abuse in chat call for something lighter than a ban that still stops it at once.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`mute`, `unmute`), `packages/server/src/systems/chat/speech.ts` (`silenced`), `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/world/tick.ts` (`muteTick`), `packages/server/src/persistence/moderation.ts` (`accountMute`)
- **Pinned by:** `SSO: /mute silences a player everywhere but IMs to staff, until it lapses`, `only the staff member who muted, or an administrator, changes or lifts a mute; staff are out of reach`, `an offline account can be muted; /banlist shows mutes; players cannot /mute` (packages/server/tests/admin.test.ts); `mutes and unmutes come from the moderation log, once each, with their reasons` (packages/server/tests/auditlog.test.ts); `a mute survives logout and restart and is told at login; one that ends offline is gone` (packages/server/tests/moderation-db.test.ts); `SSO: a muted staff member cannot post staff chat`; `a jailed staff member keeps staff chat, like an IM to staff`; `SSO: a mute stops player-shop commands too; a prisoner still runs them` (packages/server/tests/staff-chat-moderation.test.ts)

#### Prisoners are told their sentence and talk only nearby
- **Kind:** Other
- **What you notice:** A jailed player reads "You have been jailed until …" when jailed and at each login. In jail they can talk with local chat and `/me`, which reach others in the jail, and send IMs to staff. Broadcasts still fail as in 1.6, and IMs to other players, guild chat, chat rooms, mail and board posts are refused with "You are in jail: only those near you and staff can hear you."
- **1.6:** The prisoner was moved without a word, and only broadcasts were stopped.
- **SSO:** `silenced` refuses a prisoner's lines beyond the jail map, except IMs to staff.
- **Why:** A prisoner should know why they were moved and for how long, and should be cut off from the world while still able to ask staff about it.
- **In the code:** `packages/server/src/systems/chat/speech.ts` (`silenced`), `packages/server/src/systems/admin/commands.ts` (`jail`)
- **Pinned by:** `divergence: a prisoner is told the sentence, talks only on the jail map, and may IM staff` (packages/server/tests/admin.test.ts); `a prisoner is told the sentence at login` (packages/server/tests/moderation-db.test.ts); `the seeded jail confines Bob until his sentence ends` (packages/server/e2e/admin-and-settings.test.ts)

#### Administrators skip the chat and broadcast waits
- **Kind:** Other
- **What you notice:** An administrator can talk, IM, post and broadcast without waiting for the chat or broadcast cooldown. Everyone else, moderators included, waits as before.
- **1.6:** The waits applied to everyone, so an operator making announcements waited 50 seconds between broadcasts.
- **SSO:** `chatWait` and `broadcastWait` read 0 for a role with `bypassChatCooldown` or `bypassBroadcastCooldown`.
- **Why:** The waits stop players flooding chat; operators making announcements or answering many players at once are not the problem they solve.
- **In the code:** `packages/server/src/systems/chat/speech.ts` (`chatWait`, `broadcastWait`)
- **Pinned by:** `divergence: an administrator skips the chat and broadcast cooldowns; everyone else waits` (packages/server/tests/admin.test.ts); `delivered to the room, refused by the cooldown, and out of a room; an administrator skips the cooldown` (packages/server/tests/chatlog.test.ts)

#### The fishing allowance belongs to the tile you fish from
- **Kind:** Other
- **What you notice:** A tile gives at most 5 catches. After that, a cast from it catches nothing and gains no skill, and the chat says "The fish have stopped biting here. Try fishing from another spot." once each time you start fishing. Fishing from any other tile, on this map or another, starts with 5 again. Turning on the spot and logging out and back in don't refill it.
- **1.6:** Each player had one allowance of 5, filled at login and meant to refill when an arrow press turned you. The refill compared the facing letter ("W") with a direction word ("Left"), so it never matched and every arrow press refilled it, a step into a wall included. A run-out allowance said nothing. Even with that comparison fixed, turning back and forth between two directions without leaving the tile refilled it forever, and so did logging in again.
- **SSO:** The server remembers each character's allowance and the tile it belongs to (`fishingSpots`), across logouts, until the server restarts. A cast from the same tile uses what is left there. A cast from any other tile starts a fresh allowance. Movement no longer touches it.
- **Why:** The allowance exists to stop unattended fishing, and a macro could beat both 1.6's rule and the fixed turn rule without moving. Having to change tiles beats that while barely affecting someone fishing by hand. The message tells a player why the fish stopped biting, which 1.6 never did. The skill gain rate is unchanged and is part of the skill levelling balance pass (#18).
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`fishingSpot`, `FISHING_STOPPED_TEXT`); `packages/server/src/systems/crafting/gather.ts` (`preSwing`); `packages/data/content/gather.json` (`stoppedText`)
- **Pinned by:** `design change: the allowance belongs to a tile; only another tile refills it` (packages/shared/tests/crafting/gather.test.ts); `design change: turning does not refill a tile's allowance; fishing from another does`; `design change: logging out and back in does not refill a tile's allowance`; `design change: a fished-out tile says so once while the line is held` (packages/server/tests/gather.test.ts)

#### No hit blink
- **Kind:** Other
- **What you notice:** After a hit your character stays drawn; the damage number shows the hit. For about 1 second (40 calls, two a tick) further monster hits are still ignored.
- **1.6:** Each call for the player sprite while the hit counter ran flipped its visibility on your own screen. With two calls a frame the flips mostly cancelled, so a hit either hid your character for the whole second or showed no blink at all.
- **SSO:** The counter still gives the same immunity, but nothing hides your sprite, and the `you` message no longer carries a hidden flag.
- **Why:** The blink was distracting and, as 1.6 drew it, unreliable; the damage numbers already show the hit.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`tick`), `packages/client/src/playfield.ts` (`createPlayfield`)
- **Pinned by:** `design change: a monster hit starts 40 calls of i-frames and never hides your sprite` (packages/server/tests/monsters.test.ts); `a melee hit starts the victim's i-frames; no sprite is hidden on anyone's screen` (packages/server/tests/melee.test.ts); `design change: the local player is always drawn; no hit blink hides it` (packages/client/tests/death-stage.test.ts)

#### HP, SP and XP bars fill by percentage, and hovering one shows its value
- **Kind:** Other
- **What you notice:** Each HP, SP and XP bar fills its wooden slot from left to right. Full HP or SP fills the slot even when the maximum is 20, and losing half the points leaves half the bar. The third slot, which held 1.6's power bar, is a flat green XP bar toward your next level. Hovering a bar shows that bar's value, centred on it, such as `20 / 20 HP`, `20 / 20 SP` or `100 / 300 XP`; the other bars and unhovered bars have no numbers. Aboard a vehicle the HP bar shows its hull, such as `Hull 30 / 40`.
- **1.6:** The bar loader slid fixed 205-px track and fill sprites leftward from the stage's right edge using the raw value, capped at 200. A character with 20 maximum HP showed only a short bar at full health, while one with 1000 maximum HP filled the slot. The right-aligned number also disappeared past the stage's right edge at 1 HP/SP and spilled left of the cutout above 200. There was no XP bar: XP showed only as the level-up line.
- **SSO:** The HP, SP and XP tracks stay in the 189-px transparent slots of Internal #186 (stage x 600-789; y 70-74, 85-89 and 101-105) and the fills grow from the left edge by `value / max`, with no 200 cap; the original 205-px HP and SP fill art is clipped to the slot, and the depleted part of each slot is plain black instead of 1.6's darker red and blue track sprites. The XP bar reads the server's vitals: the XP held toward the next level over the XP that level needs. A level-up empties it and carries the remainder; saved XP at or past its destination shows a full bar until the next level check, and a destination of 0 shows an empty one. There is no level cap. Numbers above 999 carry thousands separators. The text fields show only while a bar is hovered, so they cannot leave the cutout.
- **Why:** A bar's length should show how much of the stat remains, not how large the stat's maximum happens to be. With the power bar gone, its slot shows progress that players otherwise had no way to see.
- **In the code:** `packages/client/src/ui/bars.ts` (`createBars`, `setVitals`), `packages/client/src/styles.css` (`.bar-track`, `.bar-fill`, `.xp-fill`, `.bar-hover`, `.bar-value`, `.bar-hovered`), `packages/client/src/ui/shells.ts` (`createGameView`)
- **Pinned by:** `HP and SP fill the wooden slot left to right by percentage; the text reads current / max`; `a full bar is full at any maximum, and values above 200 are not capped`; `design change: no power bar; the third slot is a flat green XP bar toward the next level`; `the XP bar empties on a level-up, shows full past its destination, and never divides by 0`; `design change: hovering a bar shows only that bar's value, centred on it`; `aboard a vehicle the HP bar shows the hull; SP and XP stay the player's` (packages/client/tests/combat.test.ts)

#### No power bar
- **Kind:** Other
- **What you notice:** There is no power bar and no reason to wait between swings: every swing hits with the same attack power however long you waited. Argon's Fist and the Purple Potion still add their +1 attack power while they last.
- **1.6:** After each swing the bar refilled one point a frame once the attack re-armed (two a frame under Argon's Fist or a Purple Potion), and the next swing added +3, +5 or +7 to its attack power once the bar passed 25, 50 or 75. With the default 14-frame cooldown that was +3 from 38 frames (1.9 s) after the last swing, +5 from 63 (3.15 s) and +7 from 88 (4.4 s); under Argon's Fist +3 from 26 frames, +5 from 38 and +7 from 51. A held key always swung at +0. The bonus went into melee damage against monsters and players and into the power of an arrow shot.
- **SSO:** `startSwing` only sets the cooldowns and `tickAttackTimers` only re-arms; the swing's attack power is `attackPower` alone, and the `swing` message carries no tier. No other tuning replaces the bonus.
- **Why:** The bar rewarded waiting out a timer rather than playing, and its slot now shows XP.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`AttackTimers`, `tickAttackTimers`, `startSwing`); `packages/server/src/systems/combat/melee.ts` (`workAttack`); `packages/client/src/model.ts` (`predictSwing`)
- **Pinned by:** `design change: waiting between swings charges nothing; a swing only sets the cooldowns` (packages/shared/tests/combat/combat.test.ts); `design change: no power bar: a swing after a long wait hits a player as hard as a held one` (packages/server/tests/melee.test.ts); `design change: no power bar: waiting adds nothing; holding swings every 14 frames for 2; the 14 HP Slime dies on the 8th hit for 23 XP` (packages/server/e2e/monsters-and-melee.test.ts)

#### Gold moves to the Inventory tab, and Level takes its row on Stats
- **Kind:** Other
- **What you notice:** The Inventory tab shows your gold on a line under the bag, centred above your equipment: the bag's small gold picture and the amount with thousands separators. Clicking the gold opens the drop/give dialog (its hover tip says so); there is no separate drop button. The bag sits where it did in 1.6. The Stats tab no longer shows gold; its top row reads your Level, with your character's head (hairstyle, or the helmet you wear) in the icon column. There is no hunger display.
- **1.6:** Gold was the top row of the Stats tab, with its drop button and a gold-coin glyph, and the level appeared nowhere on the panel.
- **SSO:** The gold row sits at y 238-258 with no box, in the gap 1.6 left between the bag (its last quantity field ends at y 232) and the equipment boxes (y 280), centred on the equipment boxes and paperdoll (stage x 693.5). The 15 bag slots keep 1.6's rows (y 116, 153 and 190). The Level row keeps the old gold row's place, value and label columns, and the 30-pixel pitch; its head is the front-facing paperdoll head layer, or the worn helmet's layer, cropped to its pixels, shown 21 pixels tall (the height of the Strength and Mysticism icons, at most 24 wide, proportions kept, pixels unsmoothed) and centred on the icon column. Clothing that hides the head on the paperdoll leaves the Stats portrait visible.
- **Why:** Gold is something you carry and spend from the bag, and the level is the stat players most want to see.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`, `setLevel`, `GOLD_ROW`); `packages/shared/src/rules/inventory/paperdoll.ts` (`portraitLayers`); `packages/client/src/styles.css` (`.gold-row`)
- **Pinned by:** `design change: gold sits in a row under the bag on Inventory, centred on the equipment, and clicking it opens the gold dialog`; `the SmallGold picture is drawn from the bag's own item art, not the large pile`; `the bag keeps 1.6's rows, and the gold row fits between the full bag and the equipment`; `design change: Level sits above Strength in Gold's old row, on the value and label columns` (packages/client/tests/panel.test.ts); `design change: the Level row's head is the hairstyle or equipped helmet` (packages/shared/tests/inventory/inventory.test.ts)

#### Hover tips name tabs, items, players, NPCs, monsters, ground items, and the trees, rocks and crops you gather
- **Kind:** Other
- **What you notice:** Resting the mouse on one of the four panel tabs, an item in your bag or equipment boxes, another player, an NPC, a monster or yourself shows its name in a small purple-framed box just below the pointer. On the map it also names the things you gather from: a tree, a rock, a crop, and what each turns into. A stack adds its size, such as `Apple (2)`. The box follows the mouse and goes when the pointer leaves the thing it names. A touch shows nothing.
- **1.6:** Only the playfield had hover text: the bare name of the player or monster under the mouse, in bold 12 px white Arial floating above the pointer (sprite 156). The tabs, bag items, worn items and ground items had no names anywhere, so a new player had to click each tab or item to learn what it was.
- **SSO:** One hover tip serves the whole game and replaces sprite 156's floating name. It is built from 1.6's own parts: the item menu's purple frame (Inventory #50) around a half see-through black middle, with the whole box slightly see-through, and 9 px white Arial with a 1 px black shadow, a size under the item menu's title. Its top-left corner sits level with the pointer and 20 px below it; at the stage's right edge it slides left, and at the bottom it flips above the pointer. It hides while the item menu, the player menu or the amount dialog ("Drop how many …?") is open or an item is pressed or dragged, and a player in an Invis body is still `???`. On the playfield it also names the ground items under the mouse, which 1.6 never named: loose items with their quantity (`15 Gold`), parked vehicles with their owner, and the fixtures and scenery a player can see and click. A player or monster under the mouse is named alone, even standing on items. When a tile holds several items, the tip names the newest, the item a click or Ctrl takes, and counts the rest on a second line (`+3 more items`, `+1 more item`), so the box stays two lines however big the pile. Both lines use the tip's plain 9 px lettering. It never names map links, overlays or markers (`Exit`, `Exit2`, the Rays, `Cloud`, `Chimney`, `Dragon Rock`, `DungeonAlpha`, a `Lair`; `ground.tipless`), and it tidies some names (`ground.tipNames`): the `#id` goes (`Painting#12` is "Painting"), `Sign 1` is "Sign", `BlueCrystal` is "Blue Crystal", and an open door is named as the door. With nothing else under the mouse, it names the layer-2 tile there when the tile has a `catalogue[].name` in `tiles.json`, which 1.6 never did. The tiles you gather from are named, along with what they turn into: `Tree` and `Tree Stump`, `Rock` and `Rubble`, `Ice Block` and `Broken Ice`, `Fire Rock` and `Fire Rubble`, `Hole`, `Farmland` and `Tilled Soil`, and each crop as a seedling (`Corn Seedling`) and a plant (`Corn Plant`, `Rose Bush`). The plant is not just `Corn`, so the tip tells it apart from the Corn it drops. Plain ground, water and decorative tiles stay unnamed, so most of the map shows no tip, and a named tile only tells you what you could already see. Any named item on the tile is named instead, so a log on a stump names the log.
- **Why:** New players could not tell what the tab icons or items were, or which of the many tree and rock tiles a tool works on. A small box drawn from the original menu art keeps the tips part of the interface, and using the same box everywhere is clearer than two styles.
- **In the code:** `packages/client/src/ui/hovertip.ts` (`createHoverTips`, `moreItems`), `packages/client/src/ui/panel.ts` (`createPanel`), `packages/client/src/app.ts` (`runApp`, `hoverName`, `hoverText`), `packages/client/src/playfield.ts` (`pickAll`), `packages/shared/src/rules/inventory/ground.ts` (`groundTipName`), `packages/data/content/item-rules.json` (`tipless`, `tipNames`), `packages/shared/src/rules/core/tiles.ts` (`tileName`), `packages/data/content/tiles.json` (`catalogue[].name`), `packages/client/src/styles.css` (`.hover-tip`)
- **Pinned by:** `design change: hovering a tab or a bag item shows its name in a purple box below the pointer`; `design change: a touch shows no tip, and a press, the item menu or a drag hides it`; `design change: a worn item names itself in its equipment box; an empty box names nothing`; `design change: the tip stays on the stage, sliding left at the right edge and flipping up at the bottom` (packages/client/tests/panel.test.ts); `design change: the character under the mouse is named in the hover tip, not drawn on the map`; `design change: the player menu a click opens hides the tip until it closes`; `design change: the amount dialog hides the tip until it closes`; `design change: a dialog opened from the keyboard takes down a tip that was already up`; `design change: a pile names the item a click takes and counts the rest`; `design change: a big pile stays two lines, however much lies on the tile` (packages/client/tests/hover-tips.test.ts); `hover: monsters, players, yourself and ground items show a name`; `design change: hover lists each named ground item on the tile, newest first`; `design change: a tree, rock or crop under the mouse is named when nothing else is`; `hover: a player in an "Invis" body shows ???` (packages/client/tests/playfield-clicks.test.ts); `design change: trees, rocks and crops are named, and so is what they turn into`; `design change: every tile a tool, seed or watering changes has a name, before and after`; `design change: plain ground, water and unknown tiles have no name` (packages/shared/tests/core/tiles.test.ts); `design change: loose items, vehicles and fixtures are named as they are, quantity included`; `design change: exits, Rays, clouds, chimneys and markers are never named`; `design change: tidied names drop the #id, the sign number and the open state` (packages/shared/tests/inventory/ground.test.ts)

#### A click on a player standing on items opens the player menu
- **Kind:** Other
- **What you notice:** Clicking a player who stands on items opens the player menu, as it does anywhere else. The items under them can be taken with Ctrl, or by clicking once the player moves.
- **1.6:** A click tested the ground items' sprites before the players', so clicking a player standing on an item picked up the item, or did nothing for a silent one such as a Ray.
- **SSO:** A click tests monsters, then players, then the ground items on the tile, newest first. The hover tip follows the same order and names a player alone.
- **Why:** A click should act on what is drawn under the mouse and named in the tip; a player on top of an item hid it.
- **In the code:** `packages/client/src/playfield.ts` (`pick`, `pickAll`)
- **Pinned by:** `design change: a player standing on items takes the click and the tip alone` (packages/client/tests/playfield-clicks.test.ts)

#### Password= replies after the change
- **Kind:** Other
- **What you notice:** A password change confirms success only after the new hash is stored; failure says “Your password could not be changed. Please try again.”
- **1.6:** The command printed its reply immediately.
- **SSO:** Hashing completes before the success line; a password change also ends the character's other resume tokens. An account logs in only to its first character, so these are all of the account's sessions.
- **Why:** The reply reflects the actual result, and a stolen session cannot outlive a password change.
- **In the code:** `packages/server/src/game.ts` (`changePassword`)
- **Pinned by:** `Password= changes the account password and never echoes it` (packages/server/tests/password-db.test.ts)

#### Train button on the NPC Bio window
- **Kind:** Other
- **What you notice:** A trainer's Bio has a Train button beside Sell. It opens a class-and-price list without a quantity field; OK trains and Cancel closes it.
- **1.6:** The Train sprite was empty in every frame and shown only in World Editor frames. Nothing called the unused class-purchase handler; a roster NPC's Bio had only Buy and Sell.
- **SSO:** A Bio shows Train when the NPC file has a line beginning `TRN|`. The button is drawn in the Buy/Sell style at [118, 253, 169, 270]. Every training line is listed, a zero or missing price trains free and a line without a class branch does nothing. The Bio's NPC speaks in the four messages, the list remains open after promotion, and OK displays PROCESSING until the server answers.
- **Why:** Promotions need a trainer, and the original never had a working one.
- **In the code:** `packages/client/src/ui/bio.ts` (`createBioWindow`), `packages/server/src/systems/economy/intents.ts` (`trainIntent`)
- **Pinned by:** `divergence: the Train button shows only with train: true, never in a player's bio` and `divergence: the Train click asks for the train list and closes the window` and `divergence: the train list has no quantity field; OK sends the row's line, even at price 0` (packages/client/tests/npcs.test.ts)

#### The amount dialog's buttons sit on its panel and its title is centred
- **Kind:** Other
- **What you notice:** In the gold and crystal amount dialog, the X and OK buttons sit straight on the dark panel, and the question is centred vertically in the top box with the same inset on both sides.
- **1.6:** The OK and Cancel art (Internal #120 and #126) used ink 36 with palette colour 169 (#3333CC) as their background, which neither image contains. Nothing was keyed out, so both buttons appeared in pure black boxes on the panel's #101010. The title field (#125) sat high and to the left in the top box at [245, 197, 436, 229].
- **SSO:** Both buttons are keyed on black at build time. The title fills the top box's interior [236, 195, 463, 230] with an 8-px inset and is centred vertically.
- **Why:** The black boxes and the off-centre text made the dialog look broken. The art and its positions are otherwise unchanged.
- **In the code:** `packages/data/build/assets-lib/key.ts` (`ruleForUsage`), `packages/client/src/ui/amount.ts` (`createAmountDialog`), `packages/client/src/styles.css` (`.amount-dialog .amount-title`)
- **Pinned by:** `UI rule follows the most-used score appearance, then keyHint` (packages/data/tests/assets.test.ts); `divergence: the title fills the top box's interior, not 1.6's high-left field` (packages/client/tests/panel.test.ts)

#### Every character has a respawn point
- **Kind:** Other
- **What you notice:** A new character's respawn point is the tile they started on, so dying before you find a respawn map returns you to the starting map. Entering a map flagged no fighting, indoors and no PvP (O-O-O) replaces it, as in 1.6. A death or the end of a jail sentence takes you to your respawn point. If your place is gone (you log in after your saved map was deleted, or you were saved inside a house that decayed) you go to the server's fallback map instead, never to your respawn point.
- **1.6:** A respawn point was saved only on an O-O-O map, and none of the 27 original maps was one, so until an operator's shrine saved one, every death went to `Starting Map.txt` (x0y102 5,5). A missing map sent you to the start map's (5,5), and the jail's end sent you to the start point.
- **SSO:** Character creation stores the `startPoint` tile as the respawn point. A death or jail release goes there, or to the `fallbackPoint` setting if its map was deleted. A lost place always goes to `fallbackPoint`. `startPoint` is used only for new characters. Travel someone chooses (an exit, an edge, `/warp`, a Portal) never falls back: it is refused. Operators can list exits and setting points that lead nowhere with `bun run maps:check`. A migration renames the old `respawnPoint` setting to `fallbackPoint` and gives characters without a respawn point its tile.
- **Why:** Operators built tutorial islands that new characters start on, left through a main-world shrine. A server-wide death point could only serve one side: pointed at the island it sent veterans back with main-world items, and pointed at the main world it let new players skip the island. Starting with a respawn point keeps each player on their side. A lost place uses the fallback map rather than the respawn point, so it can never carry a player back to where they started.
- **In the code:** `packages/server/src/persistence/characters.ts` (`insertCharacter`), `packages/server/src/systems/world/tick.ts` (`respawnTarget`, `fallbackTarget`, `releaseFromJail`), `packages/server/src/game.ts` (`deleteInterior`), `packages/server/src/cli/map-check.ts` (`mapCheck`)
- **Pinned by:** `SSO: a death or release goes to your respawn point, else the fallback point; a lost place goes to the fallback point`, `SSO: a tutorial island keeps new players until they leave through a shrine, and nothing sends them back`, `SSO: new characters start on the operator's start point setting, default x1000y992 (6, 4) on the seed map` (packages/server/tests/world.test.ts); `SSO: offline characters saved in a deleted interior go to the fallback point, not their respawn point` (packages/server/tests/houses-db.test.ts); `divergence: the sentence is stored and ends at its time, then releases to the respawn point` (packages/server/tests/admin.test.ts); `fallback_point renames the Respawn point setting and gives characters without a respawn point its tile` (packages/server/tests/migrations.test.ts); `lists dangling exits, Exit tiles with no exit set and setting points on missing maps` (packages/server/tests/map-check.test.ts)

#### Class stat points come from your current class
- **Kind:** Other
- **What you notice:** A Druid plays with +3 Dexterity, Wisdom and Intelligence, a Bard +1 Wisdom and a Barbarian +1 Strength, for as long as they are in that class. If an operator changes your class, its points go and the new class's come.
- **1.6:** A promotion added its stat points to the stored stats once, and they stayed whatever happened to the class later.
- **SSO:** Each class's points are its `statBonus` in `classes.json`, added to your allocated stats (with any medals' points) wherever stats are used, and never stored. The upgrade takes the shipped points of each character's current class back off the stored stats, so promoted characters keep the stats they had.
- **Why:** Calculated points let operators rebalance classes and have every character follow; see [issue #15](https://github.com/jberlyn/second-star-online/issues/15).
- **In the code:** `packages/shared/src/rules/progression/stats.ts` (`classStatBonus`, `effectiveStats`), `packages/server/src/systems/world/world.ts` (`statsOf`), `packages/shared/src/rules/progression/promotion.ts` (`promoteClass`)
- **Pinned by:** `Druid +3 Dex/Wis/Int, Bard +1 Wis, Barbarian +1 Str; other classes none`; `calculated from the current class: a promotion stores no stat points` (packages/shared/tests/progression/promotion.test.ts); `a Druid plays with +3 Dex, Wis and Int and a Blacksmithing medal's points; neither is stored` (packages/server/tests/friends.test.ts); `calculated_class_stats takes the current class's promotion points off the stored stats` (packages/server/tests/migrations.test.ts)

#### Medals and their stat points come from your skills
- **Kind:** Other
- **What you notice:** Every skill at 90 or more shows its medal on your bio and adds its medal's points to your stats; for example, Blacksmithing at 90 gives +2 Strength and +2 Stamina. If the skill drops below 90, the medal and the points go. A skill set past 90, even by an operator, counts at once. Reaching 90 in play still prints the medal's line. Medals show in the medal table's order.
- **1.6:** A medal was granted once, when a skill was saved at exactly 90: its id was added to the character's `Medals` field and its points to the stored stats for good. A skill that skipped 90, or one already at its maximum, never earned it.
- **SSO:** Nothing is granted or stored. Your stored stats are the points you allocated; the rules, the Stats tab and the bio use those plus your class's points and the points of every medal your skills hold. The upgrade takes each held medal's points back off the stored stats and drops the `Medals` field, so a character keeps the same stats while its skills stay at 90 or more.
- **Why:** A medal marks mastery of a skill, so it should follow the skill; a calculated bonus cannot be missed, duplicated or left behind.
- **In the code:** `packages/shared/src/rules/progression/medals.ts` (`heldMedals`, `medalField`, `newMedalLines`), `packages/shared/src/rules/progression/stats.ts` (`effectiveStats`), `packages/server/src/systems/world/world.ts` (`statsOf`), `packages/server/src/systems/progression/medals.ts` (`medalCheck`), `packages/server/src/systems/social/bios.ts` (`bioSource`)
- **Pinned by:** `90 or more holds a medal, 89 does not`; `the stats played with are the allocated stats plus the bonus; the input is untouched` (packages/shared/tests/social/friends-bios-medals.test.ts); `a skill lowered below 90 loses its medal and its point; back at 90 it returns`; `a skill already at 90 or more at login holds its medal and point without a line` (packages/server/tests/friends.test.ts); `a medal and its point come from the saved skill; the stored stats stay as allocated` (packages/server/tests/buddies-db.test.ts); `calculated_medals takes each held medal's points off the stored stats and drops the field` (packages/server/tests/migrations.test.ts)

#### No Agility, Speed or Aim
- **Kind:** Other
- **What you notice:** A character has five stats: Strength, Stamina, Mysticism, Intelligence and Wisdom. Hit and spell points regenerate at the rate every character had with Speed 1, which nothing in 1.6 could change.
- **1.6:** Each character file also saved Agility, Speed and Aim. The creation screen left them at 1 and nothing in the game raised them. Only Speed was read, by the regen timer (`60 − Speed + 90`), so regen ran at its Speed 1 rate for everyone.
- **SSO:** The three stats are not saved or shown, and the regen timer works as Speed 1: a target of 149, or 144 down to 99 for an Adventurer. A class's stat points no longer include Agility or Speed; the upgrade removes them from the operator's content changes. Editor log lines from before keep their Agility and Speed changes, and an undo passes over them.
- **Why:** Stats nobody could raise only cluttered the character record and the editor.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`regenTarget`), `packages/shared/src/rules/progression/creation.ts` (`startingCharacter`), `packages/server/migrations/20261122_57_drop_unused_stats.sql`
- **Pinned by:** `no Speed stat: the regen target is 149, less 5·(bonus + 1) for an Adventurer` (packages/shared/tests/progression/progression.test.ts); `only the five stats the screen raises are kept` (packages/shared/tests/progression/creation.test.ts); `divergence: drop_unused_stats keeps every character and drops Agility, Speed and Aim, class points too` (packages/server/tests/migrations.test.ts); `an old edit that changed Agility or Speed still reads and undoes the rest` (packages/server/tests/character-edit.test.ts)

#### Drop and Give ask how many of a stack
- **Kind:** Other
- **What you notice:** Drop or Give on a stack of more than one item opens the amount dialog, titled "Drop how many Long Sword?" or "Give how many …", with 1 filled in and selected. A single item goes at once, as before, and so does a single crystal, which 1.6 still asked about. Dropped items land as one pile, and picking it up returns them all. A vault or container takes as many as fit, then says it is full. Asking for more than you hold reads "You don't have that many of the Long Sword!".
- **1.6:** Drop and Give moved one unit per click, so emptying a stack took a click per item. Only crystals and gold had the amount dialog, and crystals opened it even when you held one.
- **SSO:** `drop` and `give` carry an optional amount `n` (1 if absent). The pile is one ground item with a count (`qty`), as an operator's `/drop` makes. A Give receiver reads "A is giving you 3 Long Sword." A lone crystal sends `crystals` with `n` 1 without the dialog. A Newspaper Kit or a piece of furniture still goes down one at a time, and a Give to an NPC is a quest hand-in, which takes one.
- **Why:** Moving a stack one click at a time was tedious, and the bag had no other way to split a stack.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`), `packages/client/src/ui/amount.ts` (`stackTitle`), `packages/server/src/systems/inventory/items.ts` (`dropIntent`, `giveIntent`), `packages/server/src/systems/economy/vault.ts` (`depositVault`), `packages/server/src/systems/economy/containers.ts` (`depositContainer`)
- **Pinned by:** `divergence: Drop and Give on a stack of more than one ask how many; a single item goes at once`; `divergence: a stack asks how many of its item, starting at 1 and selected`; `divergence: Drop and Give on a single crystal go at once, without the amount dialog` (packages/client/tests/panel.test.ts); `divergence: Drop with an amount leaves one pile of that many; picking it up returns them all`; `divergence: Drop or Give asking for more than the stack holds is refused`; `divergence: Give with an amount offers one pile, and the target grabs all of it` (packages/server/tests/inventory.test.ts); `divergence: a deposit with an amount stores that many lines, as many as fit` (packages/server/tests/economy.test.ts); `divergence: Drop with an amount stores that many, as many as fit, brewing after each` (packages/server/tests/craft.test.ts)

#### Drag to rearrange the bag, or onto an equipment box to wear it
- **Kind:** Other
- **What you notice:** Press on a bag item and drag it. Its picture follows the pointer, and letting go over another slot swaps the two items, or moves the item if that slot is empty. Letting go over the equipment box the item is worn in equips it, as the menu's Equip does; any other box, or an item that cannot be worn, puts it back, as does letting go anywhere else, and a press that barely moves still opens the item menu.
- **1.6:** A new item took the lowest empty slot and could only be moved by dropping it and picking it up again. Equipping was only through the item menu.
- **SSO:** The client sends `arrange` with both slots, and the server swaps the two lines. It refuses while you are dead or loading, and during a trade, whose offer names its items by slot. Nothing is dragged while the bag is locked. A drop on the item's own box sends the usual `equip`, so the server makes every equip check (strength, two-handed, vile) and swaps out what was worn.
- **Why:** Players want to keep their bag in an order of their choosing, and dragging gear onto the paperdoll is what they expect from other games.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`), `packages/shared/src/rules/inventory/inventory.ts` (`arrangeBag`), `packages/server/src/systems/inventory/items.ts` (`arrangeIntent`)
- **Pinned by:** `dragging a slot onto another sends both slots, and the click after it opens no menu`; `a press that moves less than 4 pixels is still a click`; `letting go off the bag, or on the same slot, sends nothing`; `an empty slot cannot be picked up, and nothing moves while the bag is locked`; `an item let go on its own equipment box is equipped`; `an item let go on another item's box, or one that cannot be worn, goes back`; `nothing is equipped by dragging while the bag is locked` (packages/client/tests/panel.test.ts); `two filled slots change places; a line moves to an empty slot`; `an empty source, the same slot, a trade in progress or a loading player change nothing` (packages/server/tests/inventory.test.ts)

#### A death never lowers your maximum HP or SP
- **Kind:** Other
- **What you notice:** Dying never costs maximum HP or SP, on any map, wanted or not; "*** Your downfall in battle has caused you to become weakened." is gone. Characters weakened before the upgrade get their maximums back.
- **1.6:** Every death outside an arena had a one in five chance (always, if you were wanted) of lowering maximum HP and SP by 1 each, down to 2. The roll was probably meant for PvP maps only: the death routine forced its `DeathPenalty` flag, which elsewhere holds the map's PvP setting, to X just before testing it.
- **SSO:** No death lowers either maximum. The upgrade raises maximum HP and SP to 19 + level wherever they are lower, the value a character never weakened has, since both start at 20 and only a level raises them; nothing is lowered. Faction exile is still checked on death, but only a maximum already below a faction's line can trigger it.
- **Why:** Levelling is the only way to raise maximum HP and SP, and near the top levels cost too much to win them back, so one unlucky death could undo long-term progress, exile a faction member or block a promotion. Permanent loss is a poor experience in an online game, and PvP risk comes from death drops instead (see [Operators choose whose deaths drop](#operators-choose-whose-deaths-drop-and-by-default-only-a-wanted-characters-do)).
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`); `packages/server/migrations/20261119_39_restore_death_penalty.sql`
- **Pinned by:** `divergence: a death never lowers HPmax or SPmax, wanted or not` (packages/shared/tests/progression/progression.test.ts); `death: HP and SP 1, facing south, then the death text to everyone and the respawn warp` (packages/server/tests/monsters.test.ts); `divergence: restore_death_penalty raises max HP and SP to 19 + level, never lowering them` (packages/server/tests/migrations.test.ts); `divergence: a wanted player's deaths never lower HPmax or SPmax, on a PvP map or not` (packages/server/tests/monsters.test.ts)

#### Vehicles have their own hull
- **Kind:** Other
- **What you notice:** Riding an airship, boat or battleship, your HP bar shows its hull ("Hull 78 / 80"). An arrow or harmful spell that hits you takes a fixed 2 off the hull, and a battleship's cannonball 14 to 16, never touching your HP, however strong the attacker. When the hull runs out you die as if killed aboard: the airship is lost and everyone reads "\*\*\* Bob's airship was shot down by Ann. Bob fell from the sky." in place of the death line; a ship's line is "\*\*\* Bob's boat was sunk by Ann. Bob was claimed by the waters." A parked vehicle slowly repairs, 1 point a minute, and you board it with the hull it has regained.
- **1.6:** Riders took hits on their own HP, so a high-level character's airship was as tough as the character.
- **SSO:** `characters.hull` holds a rider's hull and `ground_items.hull` and `parked_at` a parked vehicle's. `HULL_MAX` (a boat's is 60, an airship's 80 and a battleship's 150), `HULL_HIT_DAMAGE` (2) and `HULL_REPAIR_PER_MINUTE` (1) set the full hull, the damage per hit and the repair. A sinking counts as a kill: the attacker is credited and flagged as for any player kill.
- **Why:** A vehicle is something you own and protect, not a reflection of your level, and its fights should depend on the vehicle and not on who rides it. Issue #2 builds boats and battleships on the same hulls.
- **In the code:** `packages/shared/src/rules/vehicles/vehicles.ts` (`HULL_MAX`, `boardingHull`, `sunkText`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`), `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/server/src/systems/vehicles/vehicles.ts`, `packages/server/migrations/20261120_43_vehicle_hulls.sql`
- **Pinned by:** `SSO: a new airship boards with a full hull, and the HP bar shows it`; `SSO: parking keeps the hull and the time; boarding again repairs a point a minute`; `SSO: a player's spell wears a rider's hull by a fixed 2, never the rider's HP`; `SSO: the hull running out kills the rider; the airship is lost and everyone hears it` (packages/server/tests/vehicles.test.ts); `SSO: the hull running out sinks the boat and everyone hears it` (packages/server/tests/ships.test.ts); `SSO: a parked hull regains repairPerMinute for each whole minute, up to full`; `SSO: the shot-down line names the attacker when there is one` (packages/shared/tests/vehicles/vehicles.test.ts)

#### Arenas are for players on foot
- **Kind:** Other
- **What you notice:** An airship, boat or battleship over arena tiles is not in the arena. On a map with PvP off, players cannot hurt you there, a death there is a normal death that loses the vehicle, and `quit` does nothing.
- **1.6:** Arena tiles turned PvP on for whoever stood on them, a rider included, and an arena defeat kept the airship.
- **SSO:** A rider is judged by the map's PvP flag alone (`pvpOff`), its death skips the arena defeat (`checkDeath`), and `quitCheck` is silent aboard. Riders still cannot challenge.
- **Why:** An arena is a fight between players on foot. Vehicles mixing into it raised edge cases (a ship shelling the arena from outside, a rider's defeat on a tile it only flew over) with no good answer.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`pvpOff`), `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/shared/src/rules/combat/arena.ts` (`quitCheck`)
- **Pinned by:** `divergence: over an arena tile a rider follows the map's PvP flag alone`; `divergence: over an arena tile a rider dies a normal death and loses the airship` (packages/server/tests/vehicles.test.ts); `divergence: a death aboard over an arena tile is a normal death, not an arena defeat` (packages/server/tests/arena.test.ts); `divergence: a rider over a 6P tile is not in the arena, so quit is silent` (packages/shared/tests/combat/arena.test.ts)

#### Operators choose whose deaths drop, and by default only a wanted character's do
- **Kind:** Other
- **What you notice:** By default a death drops nothing from your bag or purse unless you are wanted for murder. A wanted character's death drops some of their gold (up to all of it) or one random bag item, never crystals, where they died. An operator can instead make every death drop, as in 1.6, only deaths at another player's hands, or none at all, and can set what drops, a gold cap and a level below which nothing drops. A faction member killed on a PvP map still drops their faction's head.
- **1.6:** With "Chars Drop Items On Death" on (the default), every death outside an arena dropped either up to 200 gold (any amount if wanted) or a random bag item. Off dropped nothing, and immortals always dropped.
- **SSO:** Four settings on the Items page replace the on/off one. "Drops on death" (`deathDrops`) is Off, Wanted only (the default), Killed by a player (the last hit credited to another player, or wanted) or Everyone. "What drops on death" (`deathDropKind`) is gold or an item (1.6's coin toss), gold only or items only. "Most gold dropped on death" (`deathDropGoldCap`, 200) caps a death's gold unless wanted, redrawn as in 1.6; 0 is no cap. "No drops below level" (`deathDropMinLevel`, 0) protects characters below that level unless wanted. An administrator drops on every death, whatever the settings. Dying aboard an airship, and every death in a Lightning game, still drops nothing. A server that had turned drops off is set to Off on upgrade.
- **Why:** Losing gear to a monster punishes players who only fight monsters, for no gain, so the default keeps the drop where it is earned: on a murderer's death. Servers differ in how harsh they want death to be, so the operator chooses, from 1.6's rules to none.
- **In the code:** `packages/shared/src/rules/monsters/loot.ts` (`dropsOnDeath`, `rollDeathDrop`), `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/server/src/settings.ts` (`deathDropRules`), `packages/server/migrations/20261119_40_death_drop_settings.sql`
- **Pinned by:** `divergence: whose deaths drop: off, wanted only (the default), killed by a player, everyone`; `divergence: below the protected level nothing drops, unless wanted`; `divergence: what drops: gold only, or items only, with no coin toss`; `gold over the cap is redrawn as random(cap), unless wanted or the cap is 0` (packages/shared/tests/inventory/inventory.test.ts); `divergence: a death that is not wanted drops nothing, gold or items`; `divergence: Killed by a player drops on a player's kill, not a monster's`; `divergence: Everyone drops on any death; Off drops nothing, even when wanted` (packages/server/tests/inventory.test.ts); `divergence: death_drop_settings turns Drops on death off where drops were off` (packages/server/tests/migrations.test.ts); `a choice is a list of its labels; Save sends the value and Reset names the default` (packages/client/tests/settings.test.ts)

## Fixed bugs

1.6 gameplay bugs that SSO fixes, by system.

### admin

#### /warp refuses a map that does not exist
- **Kind:** Bug fixed
- **What you notice:** `/warp Bob x77y77 2 2` to a map that is not there replies "There is no map x77y77." and Bob stays where he is.
- **1.6:** The warp went ahead and the missing map sent Bob to the start point.
- **SSO:** The map is checked before anything moves.
- **Why:** A typo in a staff command should not move a player somewhere unrelated.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`, `adminWarp`)
- **Pinned by:** `bug fixed: /warp to a map that does not exist is refused and moves no one` (packages/server/tests/admin.test.ts)

#### /warpscript matches whole keywords in broadcast content only
- **Kind:** Bug fixed
- **What you notice:** `/warpscript` triggers only on whole-word/token matches inside the broadcast message itself, and at most one matching staff member warps the speaker.
- **1.6:** Tested substring inclusion against `<name> broadcasts "<text>"`, so speaker names, `"broadcasts"`, and partial words matched, and every matching immortal warped in login order.
- **SSO:** `warpscriptMatches` performs case-insensitive whole-token matching on the broadcast message content only, and `warpscriptOnBroadcast` stops after the first matching online staff member in login order who holds the `warpscript` permission, is not in an editor, does not ignore the speaker and is not outranked by them, and (for a speaker who is not staff) is not on the jail map.
- **Why:** Prevents accidental warps from names, protocol text, or substrings, and avoids multiple warps on one broadcast.
- **In the code:** `packages/shared/src/rules/admin/admin.ts` (`warpscriptMatches`), `packages/server/src/systems/admin/commands.ts` (`warpscriptOnBroadcast`), `packages/server/src/systems/chat/chat.ts` (`handleChat`)
- **Pinned by:** `matches whole keyword tokens ignoring case in the broadcast message content`, `prevents accidental substring triggers` (packages/shared/tests/admin/admin.test.ts); `speaker name, protocol wrapper, and substrings do not trigger /warpscript`, `multiple matching staff: deterministic single winner (first in login order)` (packages/server/tests/admin.test.ts)

#### Moderators share the original moderation commands and staff chat
- **Kind:** Bug fixed
- **What you notice:** Moderators can use `/ban`, `/unban`, `/jail`, `/unjail`, `/mute` and `/unmute` on players, `/banlist`, `/Inventory`, and `-text` staff chat, in addition to kick and location. `/BanIP`, `/unbanip`, `/CheatFile`, `/chatlog`, `/auditlog`, `/drop`, `/setclass`, `/roster`, `/spawn`, the warps and editors are administrators' by default, and moderators still cannot act on administrators. (Moderators lost the warps, `/pardon` and `/IPlookup` on purpose: see [Moderators play by the same rules as players](#moderators-play-by-the-same-rules-as-players) and [Pardons, IP lookups, saves and settings reloads are administrators'](#pardons-ip-lookups-saves-and-settings-reloads-are-administrators).)
- **1.6:** Only a subset of admin commands worked for moderators, and `-text` was immortal-only.
- **SSO:** The default `MODERATOR` role grants the moderation command set and `isStaff` gives them staff chat, while keeping server authority and player denials. Item creation and IP bans are too dangerous for a moderator role: the moderator's permissions leave out `drop` and `banip`, and `/unban` lifts only a ban the moderator made (`mayChange`).
- **Why:** Completes the moderator moderation toolkit without letting moderators mint items, change IP bans, or undo an administrator's ban.
- **In the code:** `packages/shared/src/rules/admin/permissions.ts` (`MODERATOR`, `can`, `isStaff`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`, `staffChat`), `packages/server/src/systems/admin/drop.ts` (`handleDrop`), `packages/shared/src/rules/admin/moderation.ts` (`mayChange`)
- **Pinned by:** `moderators keep the moderation commands; IP bans, warps, /setclass, /cheatfile, /pardon, /iplookup, /save and /refresh are administrators'` (packages/shared/tests/admin/admin.test.ts); `a moderator may run the moderation commands, but not IP bans or /setclass`, `SSO: a moderator may not lift a ban an administrator made`, `a moderator cannot lift a ban an administrator made` (packages/server/tests/admin.test.ts); `only administrators drop items or gold; moderators and players do nothing` (packages/server/tests/inventory.test.ts)

#### World editor Fat brush reaches the full 17 × 12 map
- **Kind:** Bug fixed
- **What you notice:** The World Editor's Fat brush paints all four arms of its plus shape up to the full 17 × 12 map edges.
- **1.6:** Right and lower arms were bounded by an older 12 × 9 map size.
- **SSO:** `paint` bounds all four arms by `MAP_WIDTH` and `MAP_HEIGHT`.
- **Why:** Fixes incomplete painting near the right and bottom edges of the map.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`paint`)
- **Pinned by:** `the Fat brush bounds all four arms by the full 17 × 12 map dimensions` (packages/shared/tests/admin/worldedit.test.ts)

#### World editor faction checkboxes are mutually exclusive
- **Kind:** Bug fixed
- **What you notice:** Ticking W, M, or A in the World Editor clears the other two boxes.
- **1.6:** Ticking A cleared M twice and left W ticked.
- **SSO:** `clickFaction` clears the other two boxes on every faction toggle.
- **Why:** Prevents ambiguous multi-faction checkbox states.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`clickFaction`)
- **Pinned by:** `W, M and A are mutually exclusive` (packages/shared/tests/admin/worldedit.test.ts); `faction checkboxes W, M and A are mutually exclusive in the editor UI` (packages/client/tests/worldeditor.test.ts)

#### World editor lit S layer button stays on layer S
- **Kind:** Bug fixed
- **What you notice:** Clicking the already-lit S layer button in the World Editor keeps layer S selected and only S lit.
- **1.6:** Clicking lit S switched to layer 3 and lit 3 without unlighting S.
- **SSO:** `clickLayer` is a no-op when any already-lit layer button is clicked.
- **Why:** Makes all four layer buttons behave consistently.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`clickLayer`)
- **Pinned by:** `layer buttons select their layer; clicking any lit layer button (including S) is stable` (packages/shared/tests/admin/worldedit.test.ts); `clicking lit layer S stays on layer S and keeps only S lit` (packages/client/tests/worldeditor.test.ts)

#### World editor resets exit fields when loading a map without exits
- **Kind:** Bug fixed
- **What you notice:** Loading a map that has no exit clears the World Editor's exit fields instead of keeping the previous map's exits.
- **1.6:** Absent exits left the previous map's exit fields populated, so saving wrote stale exits into the new map.
- **SSO:** `exitFieldsAfterLoad` resets to `EMPTY_EXIT_FIELDS` when an exit is `null`.
- **Why:** Prevents accidentally copying exits from an earlier map onto a new map on save.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`exitFieldsAfterLoad`)
- **Pinned by:** `loading a map without an exit resets the exit fields so saving does not recreate a stale exit` (packages/shared/tests/admin/worldedit.test.ts); `loading a map with no exit resets the exit fields so saving does not recreate a stale exit` (packages/client/tests/worldeditor.test.ts)

#### NPC editor LOAD displays complete script text losslessly
- **Kind:** Bug fixed
- **What you notice:** Loading an NPC in the NPC Editor displays every line losslessly, including `OWN|`, empty lines, lines past 100, and all first characters; save validation and limits still apply on save.
- **1.6:** LOAD dropped empty lines, truncated at 100 lines, and stripped any leading character other than `T P B S R G F I` (turning `OWN|` into `WN|`).
- **SSO:** `showNpcScript` returns all lines losslessly without truncation or character stripping. A file over 100 lines also brings an alert that SAVE refuses more than 100 and how many lines to remove.
- **Why:** Prevents silent data loss when inspecting and re-saving NPC scripts.
- **In the code:** `packages/shared/src/rules/admin/npcfile.ts` (`showNpcScript`); `packages/server/src/systems/admin/npcedit.ts` (`loadNpc`)
- **Pinned by:** `lossless display: preserves OWN|, all first characters, empty lines, and >100 lines` (packages/shared/tests/admin/npcfile.test.ts); `LOAD's reply displays lossless complete text including OWN|, empty lines, and >100 lines` (packages/client/tests/npceditor.test.ts); `SSO: a file over the save limit loads in full with a warning that SAVE will refuse it` (packages/server/tests/npcedit.test.ts)

#### Unauthorized staff chat shows a refusal and clears input
- **Kind:** Bug fixed
- **What you notice:** When a player types `-text`, they see an explicit refusal in chat and the chat input clears.
- **1.6:** The line exited without sending and left the typed text stuck in the input box.
- **SSO:** `staffChat` replies with `ADMIN_TEXT.staffChatDenied` and does not send `restore`. (`/warpscript` once did the same; it is now an unknown command to players, see [Unknown commands are never said aloud](#unknown-commands-are-never-said-aloud).)
- **Why:** Gives clear feedback and avoids leaving failed commands stuck in the input field.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`staffChat`)
- **Pinned by:** `a player's - line gets an explicit denial and clears input (no restore)` (packages/server/tests/admin.test.ts)

#### Staff chat uses a dedicated channel without muffling or ignore filtering
- **Kind:** Bug fixed
- **What you notice:** Staff chat (`-text`) renders in a distinct green colour (`CHAT_COLOR.staff`) as `<... Name tells the staff "text"`, reaches only staff (administrators and moderators), works from anywhere inside houses, and is never muffled or dropped by ignore lists.
- **1.6:** The channel was called admin chat and its lines read `<... Name tells the admins "text"`. It used an ordinary local-chat `sqa` message, so it appeared white, failed below row 7 in houses, muffled below row 10, and was dropped by ignore lists.
- **SSO:** `staffChat` sends directly to all online staff in `CHAT_COLOR.staff` without house restrictions, `heardSqa`, or `hears`. It is called staff chat, and its lines say "tells the staff", because moderators use it as well as administrators and "Admin Chat" names the administrators-only Game menu room.
- **Why:** Staff communication should be visually distinct and reliable regardless of position or ignore lists.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`staffChat`), `packages/shared/src/rules/chat/chat.ts` (`CHAT_COLOR`)
- **Pinned by:** `both administrators and moderators post to staff in CHAT_COLOR.staff; players excluded` and `staff chat has no house sender restriction, no muffling, and no ignore filtering` (packages/server/tests/admin.test.ts)

#### Jail sentences are stored and run in real time
- **Kind:** Bug fixed
- **What you notice:** A jail sentence lasts the given minutes, hours or days (10 minutes by default) of real time, whether or not the prisoner stays online, and relogging does not restart it. `/jail` works on an offline character, who arrives in jail at their next login. `/unjail` ends a sentence early; staff warps cannot take a prisoner out or put a player in.
- **1.6:** The sentence was a frame counter (8000 frames by default) in the client that restarted on every arrival in the jail, counted only while online, started at 10000 on a login, and kept counting after an administrator warped the prisoner out.
- **SSO:** Each sentence is stored with its end. A prisoner online when it ends goes to their respawn point (see [Every character has a respawn point](#every-character-has-a-respawn-point)); one offline goes there at their next login. The setting is `jailSentence`.
- **Why:** A sentence that restarts on every login, or that pauses offline, cannot be timed by staff, and a warp-out left the timer meaningless.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`jailTick`, `releaseFromJail`), `packages/server/src/game.ts` (`enter`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `divergence: the sentence is stored and ends at its time, then releases to the respawn point`, `divergence: staff warps neither take a prisoner out nor put a player in; /unjail releases` (packages/server/tests/admin.test.ts); `a sentence survives logout and restart, and one that ends offline releases at login` (packages/server/tests/moderation-db.test.ts)

#### NPC files are read in full
- **Kind:** Bug fixed
- **What you notice:** Every line of an NPC file counts: a monster can drop any `INV|` item listed in its file, an NPC can say any `RND|` chatter line, and the Bio shows every `BIO|` and `PRO|` line. The NPC editor no longer warns about where a line sits. A file is still at most 100 lines.
- **1.6:** Each reader looked at its own window of the file: monster drops at lines 1-80, chatter at lines 1-20 and the Bio at lines 1-100 (and the shop at 1-80, gold gifts at 1-60). A line past its window did nothing. No archived file reached a window's end; the longest has 21 lines.
- **SSO:** The parser reads the whole file for every tag. The 100-line cap on saved files stays, to bound storage.
- **Why:** The windows were 1.6 reader limits with no gameplay purpose, and only surprised operators writing long files.
- **In the code:** `packages/shared/src/rules/admin/npcfile.ts` (`parseNpcFile`, `checkNpcFile`, `NPC_MAX_LINES`); `packages/shared/src/rules/monsters/loot.ts` (`rollLoot`)
- **Pinned by:** `bug fixed: INV| counts on any line, past line 80 too`; `bug fixed: RND| counts on any line, past line 20 too`; `warned: inert tags only; no line is outside a reader's window` (packages/shared/tests/admin/npcfile.test.ts); `bug fixed: a chatter line past line 20 saves with no warning, and is said` (packages/server/e2e/npc-editor.test.ts)

#### World Editor palette: empty slots are blank
- **Kind:** Bug fixed
- **What you notice:** Empty World Editor palette slots are blank and cannot be clicked.
- **1.6:** Page 10 stopped at member 589; its last 11 slots retained whichever tiles had previously occupied those sprites and could still be painted.
- **SSO:** Empty slots on every page are blank and unclickable. Added tiles without a member fill page 10's slots 50–60 first, followed by pages of 60. Without added tiles, only those last 11 page-10 slots visibly change.
- **Why:** Stale slots duplicated tiles from earlier pages and depended on the route to page 10.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`), `packages/shared/src/rules/admin/worldedit.ts` (`palettePageOf`, `palettePagesOf`)
- **Pinned by:** `empty palette slots are blank and unclickable on every page; added tiles fill page 10 first` (packages/client/tests/worldeditor.test.ts)

#### The World Editor's sign panel leaves the exit fields alone
- **Kind:** Bug fixed
- **What you notice:** Clicking the sign panel while exit panel 1 is open no longer hides exit 1's map X field or its neighbours.
- **1.6:** The sign panel's background had a script that swapped exit 1's map X sprite to a blank picture and hid it and two neighbouring fields until you left the editor.
- **SSO:** The sign panel's background is plain art with no click.
- **Why:** The exit fields should stay editable while signs are edited.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`)
- **Pinned by:** `divergence: the sign panel's background leaves exit 1's map X field alone` (packages/client/tests/worldeditor.test.ts)

### casino

#### A taken casino seat is refused
- **Kind:** Bug fixed
- **What you notice:** Trying to occupy an already taken Blackjack or Checkers side says “That seat is taken.”
- **1.6:** Two players could take one side and a third could join, leaving screens with different pairings.
- **SSO:** Each side holds one player and a second player is refused.
- **Why:** A single server-held seat cannot have the conflicting peer-to-peer occupants.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjSit`), `packages/server/src/systems/casino/checkers.ts` (`ckSit`)
- **Pinned by:** `divergence: a taken seat, a third player, a longer name, and an open casino screen all refuse` (packages/server/tests/blackjack.test.ts); `a taken seat, a third player, a longer name, an open screen all refuse` (packages/server/tests/checkers.test.ts)

#### A slot pull whose gold is gone by the result
- **Kind:** Bug fixed
- **What you notice:** If you have less than five gold when a slot spin ends, it stops and says “You don't have enough gold to play!” without charging you.
- **1.6:** Gold was checked on the pull but charged 1.5 seconds later. If it was lost in between, the server sent nothing and the panel remained stuck until the client restarted.
- **SSO:** The result settles once at the end. Insufficient gold costs nothing, returns the lever and stops the reels while leaving the panel open.
- **Why:** The stuck panel was a peer-to-peer timing artefact; each pull still changes gold once.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotTick`)
- **Pinned by:** `gold gone during the spin charges nothing, prints the line, reels null` (packages/server/tests/casino.test.ts)

#### Three Pigs (4-4-4) pays 80 and 2-3-2 pays 50
- **Kind:** Bug fixed
- **What you notice:** Three Pigs (`4-4-4`) pay 80 gross, and `2-3-2` pays 50 gross.
- **1.6:** `2-3-2` paid 80 and `4-4-4` paid 50.
- **SSO:** Swaps the two bonuses in `casino.json` so `4-4-4` pays 80 and `2-3-2` pays 50.
- **Why:** Three Pigs (`S4`) are the top jackpot symbol on the reels.
- **In the code:** `packages/data/content/casino.json`; `packages/shared/src/rules/casino/casino.ts` (`slotPayout`)
- **Pinned by:** `4-4-4 pays 80 and 2-3-2 pays 50; RTP 245/64 over all 64 reels` (packages/shared/tests/casino/casino.test.ts)

#### Blackjack aces reduce one at a time
- **Kind:** Bug fixed
- **What you notice:** Multiple aces drop from 11 to 1 one at a time as needed (`A-A` = 12, `A-A-9` = 21, `A-A-A` = 13).
- **1.6:** Over 21, 10 was subtracted for every ace at once and 11 added back if under 11 (`A-A` = 13, `A-A-9` = 11, `A-A-A` = 14).
- **SSO:** Reduces one Ace by 10 at a time while the total exceeds 21.
- **Why:** Standard blackjack ace valuation prevents invalid totals like `A-A-9` = 11.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`handTotal`)
- **Pinned by:** `handTotal reduces Aces one at a time: A-A 12, A-A-9 21, A-A-A 13, A-5 16, 10-9-5 24` (packages/shared/tests/casino/blackjack.test.ts)

#### Both blackjack hands busting is a draw
- **Kind:** Bug fixed
- **What you notice:** When both players bust, a single draw line prints and both stakes are refunded.
- **1.6:** Different-total busts printed a draw line and still awarded the pot to the higher bust; equal busts printed the draw line twice.
- **SSO:** Returns a single `["draw"]` when both hands bust or totals are equal.
- **Why:** A busted hand cannot win the pot.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`outcome`); `packages/server/src/systems/casino/blackjack.ts` (`settle`)
- **Pinned by:** `outcome: both bust is a single draw; bust loses; higher non-bust wins` (packages/shared/tests/casino/blackjack.test.ts); `both bust, different totals: single draw line and refund` (packages/server/tests/blackjack.test.ts)

#### Blackjack uses a 13-rank shoe and requires positive bids
- **Kind:** Bug fixed
- **What you notice:** Ten-value cards occur with 4/13 probability, and bids must be positive integers (`>= 1`).
- **1.6:** Cards were uniform over 10 values (1/10 for 10) and non-numeric or `0` bids started a free game.
- **SSO:** Draws from 13 ranks (`10..13` map to 10-value) and rejects bids `< 1` or non-numeric strings.
- **Why:** Matches standard card odds and prevents forcing free hands with invalid bids.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`drawCard`, `bidCheck`, `stake`)
- **Pinned by:** `drawCard draws from 13 ranks: 1..9 map to 51..59, 10..13 map to 60` and `bidCheck: <= 0 or non-numeric is none, 100000 is max, gold short is poor` (packages/shared/tests/casino/blackjack.test.ts)

#### Checkers enforces forced capture, multi-jump, and win by blocking
- **Kind:** Bug fixed
- **What you notice:** You must jump when a capture is available, a jumping piece continues jumping while more jumps exist (unless crowned), and a blocked side with no legal moves loses.
- **1.6:** Steps were allowed when a jump existed, turns ended after one jump, and blocked sides did not lose.
- **SSO:** Validates forced capture and `jumpFrom` multi-jump continuation and treats a blocked side as losing.
- **Why:** Standard checkers rules prevent stalemates and skipped captures.
- **In the code:** `packages/shared/src/rules/casino/checkers.ts` (`checkersMove`, `loser`, `pieceHasJump`, `sideHasJump`, `sideHasMove`); `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `forced capture and multi-jump: steps are blocked when a jump exists, and jumpFrom restricts to the jumping piece` (packages/shared/tests/casino/checkers.test.ts); `multi-jump keeps the turn on the jumping piece; forced capture blocks steps; blocking a side wins` (packages/server/tests/checkers.test.ts)

#### Blackjack wrong-spot text always shows
- **Kind:** Bug fixed
- **What you notice:** Clicking a blackjack table from the wrong tile always tells you to stand beside it.
- **1.6:** Opening any slot panel or blackjack table silenced the wrong-spot message for the rest of the session.
- **SSO:** Always returns the wrong-spot message regardless of prior casino panels.
- **Why:** Players should always get feedback when clicking from an invalid tile.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjSit`)
- **Pinned by:** `the wrong-spot text shows every time, even after opening a table or slot panel` (packages/server/tests/blackjack.test.ts)

#### Changing map closes any active casino seat or slot panel
- **Kind:** Bug fixed
- **What you notice:** Warping, respawning, or opening an editor closes any open slot panel, blackjack seat, or checkers seat.
- **1.6:** Casino windows and seats stayed active across map changes and could be played from another map.
- **SSO:** Closes slot panels and leaves blackjack/checkers seats on map change or editor entry, and rejects table actions off-map. Leaving mid-hand this way, including by dying and respawning, forfeits the blackjack stake to the opponent (credited offline if they are in the reconnect grace).
- **Why:** Prevents playing or holding seats from other maps.
- **In the code:** `packages/server/src/systems/casino/index.ts` (`casinoMapChange`); `packages/server/src/systems/casino/blackjack.ts` (`bjTableOf`); `packages/server/src/systems/casino/checkers.ts` (`ckTableOf`, `ckClose`); `packages/server/src/systems/casino/slots.ts` (`slotMapLeave`, `slotPull`); `packages/server/src/systems/world/tick.ts` (`warp`); `packages/server/src/systems/admin/worldedit.ts` (`leaveForEditor`); `packages/client/src/app.ts`
- **Pinned by:** `the slot panel closes on a map change and a pull away from a machine closes it` (packages/server/tests/casino.test.ts); `a map change leaves the blackjack seat, closes the window, and forfeits a mid-hand stake` (packages/server/tests/blackjack.test.ts); `a map change closes the checkers window and frees the seat` (packages/server/tests/checkers.test.ts)

#### Checkers start line is sent once to each player
- **Kind:** Bug fixed
- **What you notice:** When a second player joins checkers, both players see the start line once.
- **1.6:** The first player received the start line twice.
- **SSO:** Sends the start line once to each seated player.
- **Why:** Removes duplicate chat output on game start.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckSit`)
- **Pinned by:** `both players see the start line once` (packages/server/tests/checkers.test.ts)

#### Black moves first on a checkers rematch
- **Kind:** Bug fixed
- **What you notice:** After a checkers win, the board resets with Black moving first and both players see the start line.
- **1.6:** The loser moved first on the reset board with no start line.
- **SSO:** Resets `turn` to `1` (Black) and sends the start line to both seated players.
- **Why:** Standard checkers rules have Black open every game.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `a capture, then a king, then the win line from the loser to the map` (packages/server/tests/checkers.test.ts)

#### A five-card blackjack hand stands automatically
- **Kind:** Bug fixed
- **What you notice:** Drawing a fifth card in blackjack automatically stands your hand.
- **1.6:** A player with five cards could keep pressing Hit with no effect.
- **SSO:** Stands automatically in `bjHit` once `hand.length >= BJ_HAND_SIZE`.
- **Why:** Avoids a dead-end state where Hit does nothing.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjHit`)
- **Pinned by:** `a five-card hand stands automatically and cannot hit again` (packages/server/tests/blackjack.test.ts)

#### A slot pull without 5 gold keeps the panel open
- **Kind:** Bug fixed
- **What you notice:** Pulling the slot lever with under 5 gold returns the lever and prints the message while leaving the panel open.
- **1.6:** The panel closed before printing the not-enough-gold message.
- **SSO:** Emits `slotResult` with `reels: null` and `SLOT_TEXT.poor` while keeping `p.slot` open.
- **Why:** Consistent with mid-spin insufficient gold handling.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`)
- **Pinned by:** `a short slot pull returns the lever and prints the gold line without closing the panel` (packages/server/tests/casino.test.ts)

#### Slot pulls require standing in front of a machine
- **Kind:** Bug fixed
- **What you notice:** Pulling the lever when no longer in front of a slot machine closes the panel.
- **1.6:** `slotPull` did not check position, allowing pulls from anywhere.
- **SSO:** Verifies `slotOpenCheck` against a slot machine on `room.map` during `slotPull` and closes the panel if not in front of one.
- **Why:** Prevents remote slot pulls after moving or warping.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`)
- **Pinned by:** `the slot panel closes on a map change and a pull away from a machine closes it` (packages/server/tests/casino.test.ts)

#### Any item containing "Slot Machine" plays
- **Kind:** Bug fixed
- **What you notice:** Variant names like `"Slot Machine 2"` open and play when clicked or activated with Ctrl.
- **1.6:** Routing matched `"Slot Machine"` by substring, but `slotOpen` required an exact name match.
- **SSO:** Click routing (`clickGate`) and Ctrl routing (`ctrlGate`) match `"Slot Machine"` by substring, and `slotOpen`/`slotPull` use `isSlotMachine` (`lingoContains`) to match the same items.
- **Why:** Aligns the handler with click/Ctrl routing.
- **In the code:** `packages/shared/src/rules/casino/casino.ts` (`isSlotMachine`); `packages/server/src/systems/casino/slots.ts` (`slotOpen`, `slotPull`)
- **Pinned by:** `any item containing 'Slot Machine' opens and plays, including 'Slot Machine 2'` (packages/server/tests/casino.test.ts)

#### The slot machine sound has a channel of its own
- **Kind:** Bug fixed
- **What you notice:** Pulling a slot machine no longer cuts off a spell, a monster hit or the church bell.
- **1.6:** The pull's sound played on a random one of channels 1-4, cutting off whatever was playing there.
- **SSO:** The pull's sound plays on channel 6, which nothing else uses.
- **Why:** A slot machine should not silence other sounds.
- **In the code:** `packages/client/src/sfx.ts` (`spellSounds`)
- **Pinned by:** `divergence: the Slot Machine sound plays on its own channel 6 and rolls only random(2)` (packages/client/tests/slots.test.ts)

### chat

#### Away auto-reply loop broken
- **Kind:** Bug fixed
- **What you notice:** When two away players message each other, each logs the other's away reply once and the replies stop.
- **1.6:** Two away players automatically replied to each other indefinitely.
- **SSO:** An IM to an away player is logged and answered unless it is itself an auto-reply or comes from that same player.
- **Why:** An unbounded message storm harms the server.
- **In the code:** `packages/server/src/systems/chat/im.ts` (`deliverIm`)
- **Pinned by:** `divergence: two away players do not loop; each logs the other's reply once` (packages/server/tests/im.test.ts)

#### IM to someone offline says so
- **Kind:** Bug fixed
- **What you notice:** Sending an IM to an offline name says “<name> is not online.” in the main chat.
- **1.6:** The message was silently lost; `/msg` still printed its outgoing echo.
- **SSO:** The offline line follows the `/msg` echo, a Send from IMsend (which still closes) or a reply from an IM window.
- **Why:** A silently lost message looks like being ignored.
- **In the code:** `packages/server/src/systems/chat/im.ts` (`msgCommand`, `imIntent`)
- **Pinned by:** `divergence: to someone not online, the echo then '<name> is not online.'` and `divergence: not online is said for IMsend and replies too` (packages/server/tests/im.test.ts)

#### /help looks up the whole topic
- **Kind:** Bug fixed
- **What you notice:** `/help basic commands` shows the Basic Commands file, and `/help` with no topic still shows Help.
- **1.6:** Only the second word after `/help` was looked up, so six of the seventeen shipped help files, whose topics have two words, could not be reached. SSO did the same.
- **SSO:** The whole rest of the line is the topic, with surrounding spaces trimmed; no topic means “Help”.
- **Why:** The shipped two-word help files should be reachable by their own names.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`), `packages/server/src/systems/chat/chat.ts` (`helpReply`)
- **Pinned by:** `/help: the whole topic, 'Help' when absent, any case` (packages/shared/tests/chat/chat.test.ts); `the whole topic is sent, so two-word topics have help` (packages/server/tests/chat.test.ts); `/help topics, a missing topic, and a two-word topic` (packages/server/e2e/chat-and-presence.test.ts); `all 17 files are reachable by their full topic name, one word or two` (packages/data/tests/data.test.ts)

#### Closing an IM window frees its slot
- **Kind:** Bug fixed
- **What you notice:** Closing an IM window ends that conversation. The next IM from anyone takes the freed slot and starts with an empty window; a random window is replaced only when all ten are open.
- **1.6:** Closing a window kept its sender and text in the slot, so the next IM from that sender reopened the old conversation. An eleventh sender took a random window and wiped it even when another window had been closed.
- **SSO:** The window frees its slot when it closes. `pickImSlot` then finds the lowest free slot, and the reopened window clears its field and log.
- **Why:** Closing a conversation should not keep it alive or make the next sender overwrite an unrelated one.
- **In the code:** `packages/client/src/ui/im.ts` (`createImWindows`), `packages/shared/src/rules/chat/im.ts` (`pickImSlot`)
- **Pinned by:** `closing frees the slot; the next IM in it starts with a clean window`, `closing a slot makes a later sender reuse it instead of taking random(10)`, and `with all ten slots held, the 11th sender takes random(10) and clears it` (packages/client/tests/im.test.ts); `with every slot held, the 11th sender takes random(10) and clears it` (packages/shared/tests/chat/im.test.ts)

#### /ignore keeps one entry and /unignore removes every copy
- **Kind:** Bug fixed
- **What you notice:** Ignoring the same name again, in any case, leaves one entry. Unignoring a name removes every copy at once.
- **1.6:** `/ignore` appended whatever was typed, duplicates included. `/unignore` stepped forward through the list and skipped the line that moved into each deleted position, so of two adjacent copies one survived. SSO did the same on the stored list.
- **SSO:** `/ignore` adds a name only when it is not already present, compared without case, and `/unignore` filters out all matching entries.
- **Why:** Duplicates fill the 100-entry cap, and an unignore that leaves a copy looks broken.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`ignoreAdd`, `ignoreRemove`)
- **Pinned by:** `add keeps one entry, ignoring case, and accepts the empty name once`, `a duplicate is still accepted when the list is full and does not grow it` and `unignore removes every matching copy, adjacent or apart` (packages/shared/tests/chat/im.test.ts); `the texts and the stored list, shared by the account's characters` (packages/server/tests/im.test.ts)

#### Every ignore-list entry filters chat and IMs
- **Kind:** Bug fixed
- **What you notice:** A name anywhere on the ignore list silences that player's chat, broadcasts and instant messages, up to the 100-entry cap.
- **1.6:** Only lines 1–50 filtered `sqa` lines and broadcasts, and only lines 1–40 filtered IMs, so later entries did nothing. SSO did the same.
- **SSO:** Every entry on the list is checked for every delivery path; the list is still capped at 100.
- **Why:** An entry the game accepts should work, and `/unignore` already reached line 100.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`ignores`), `packages/server/src/systems/chat/ignore.ts` (`hears`)
- **Pinned by:** `every entry counts, not just the first 50 for chat or 40 for IMs` (packages/shared/tests/chat/im.test.ts); `an entry past the first 50 still blocks chat` and `an entry past the first 40 still blocks IMs` (packages/server/tests/im.test.ts)

#### Guild Chat with no guild keeps your current room
- **Kind:** Bug fixed
- **What you notice:** Choosing Guild Chat without a guild says “You don't belong to a guild!” and leaves you in the room you were already in, still hearing and sending its lines.
- **1.6:** The old room was left before the guild check, so the refusal ejected you and the room window stayed up while your later lines went nowhere. SSO did the same.
- **SSO:** The guild check runs before `leaveRoom`; with no guild the membership and the other members' rosters are untouched.
- **Why:** Refusing one room should not remove you from another.
- **In the code:** `packages/server/src/systems/chat/rooms.ts` (`enterRoom`)
- **Pinned by:** `Guild Chat with no guild says so but leaves your current room alone` (packages/server/tests/im.test.ts)

#### An away message of "off" or an empty one turns away off
- **Kind:** Bug fixed
- **What you notice:** Setting the away text to “off” in any case, or to nothing, prints the OFF line, stores no away message and answers no IM.
- **1.6:** Away answered whenever the text was anything other than “OFF” ignoring case, so “off” printed ON but answered nothing, and an empty text answered every IM with an empty message. SSO did the same.
- **SSO:** `setAway` applies the chat length limit first. `awayAnswers` then treats null, empty and “OFF” as off; `setAway` stores null and prints the OFF line for those.
- **Why:** The ON/OFF line and the actual away state should agree, and an empty auto-reply is noise.
- **In the code:** `packages/shared/src/rules/chat/im.ts` (`awayAnswers`), `packages/server/src/systems/chat/im.ts` (`setAway`)
- **Pinned by:** `an away text of off (any case) or an empty one is off` (packages/shared/tests/chat/im.test.ts); `OFF in any case or an empty text turns away off instead of answering` and `the chat limit is applied before the off test` (packages/server/tests/im.test.ts)

#### /me follows the house rule, and guild chat honours ignore lists
- **Kind:** Bug fixed
- **What you notice:** On the lower rows of a house, `/me` is refused just like plain talk. A guild member who ignores the speaker no longer hears that speaker's `/g` lines.
- **1.6:** The house rule applied only to plain talk, so `/me` still went through, and guild chat never consulted ignore lists. SSO did the same.
- **SSO:** `handleChat` applies the house rule to both say and `/me`. A player's `/g` line is filtered by each reader's ignore list; the guild system's own lines are not.
- **Why:** Talking restrictions and ignore choices should not be bypassed by another chat route.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/social/guilds.ts` (`guildChat`)
- **Pinned by:** `in a house at y > 10 neither talk nor /me goes` (packages/server/tests/chat.test.ts); `guild chat is filtered by each member's ignore list` (packages/server/tests/guilds.test.ts)

#### A broadcast cooldown covers its whole 1000 frames
- **Kind:** Bug fixed
- **What you notice:** A broadcast is refused for the full 50 seconds; the last fraction of a second no longer lets a shout through.
- **1.6:** The remaining time was rounded down to whole seconds, so with 1–19 frames left it read 0 and the broadcast went through. 1.6 never showed this because its cooldown was cleared for registered players; SSO applied the cooldown, making its effective length 981 frames.
- **SSO:** Seconds round up, so any positive remainder refuses and the broadcast waits the full 1,000 frames.
- **Why:** The configured cooldown should be the actual cooldown.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`broadcastRefusal`)
- **Pinned by:** `broadcast: seconds round up, so any positive remainder refuses` (packages/shared/tests/chat/chat.test.ts); `the full 1000-frame cooldown applies, including its last 19 frames` (packages/server/tests/chat.test.ts); `a broadcast reaches everyone in yellow; the next waits 1000 frames` (packages/server/e2e/chat-and-presence.test.ts)

#### A line of only spaces sends nothing
- **Kind:** Bug fixed
- **What you notice:** Pressing Enter on spaces sends no chat line, and no one sees `Bob says ""`.
- **1.6:** It stripped the spaces but still sent the line with an empty quote. SSO did the same.
- **SSO:** A local-chat line that is empty after whitespace is dropped and does not start the chat cooldown.
- **Why:** An empty quote is noise and costs the sender a cooldown.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`)
- **Pinned by:** `a line of only spaces sends nothing` (packages/shared/tests/chat/chat.test.ts); `a line of only spaces sends nothing and starts no cooldown` (packages/server/tests/chat.test.ts)

#### Password= removes every forbidden character
- **Kind:** Bug fixed
- **What you notice:** Spaces, slashes, colons and backslashes are all removed from a new password, including adjacent ones and one at the start: `Password= a  b` becomes `ab`.
- **1.6:** Four forward stripping passes skipped the character that slid into place after each deletion, so one of two adjacent forbidden characters survived. SSO ran the same passes.
- **SSO:** `passwordFrom` removes every space, `/`, `:` and `\` from the password text.
- **Why:** The stored password should match the sanitised password the player is told about, without a hidden leftover character.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`passwordFrom`)
- **Pinned by:** `Password= strips every space, slash, colon and backslash` (packages/shared/tests/chat/chat.test.ts); `Password= removes adjacent and leading forbidden characters` (packages/server/tests/password-db.test.ts)

### combat

#### Arena exit never hangs
- **Kind:** Bug fixed
- **What you notice:** If an arena map has no suitable exit tile, quitting does nothing; an arena death leaves you in place at 1 HP and SP and shows the defeated line.
- **1.6:** Quitting or arena death repeatedly rolled until it found 799 tiles that were neither arena nor blocked and used the last. With no qualifying tile the client looped forever.
- **SSO:** The server lists qualifying walkable tiles that are not arena tiles and not taken by a player, monster or blocking item, and picks one with the seeded RNG. With none, it handles quit and death as described above.
- **Why:** A shared server cannot keep a hang; direct selection also avoids the former capped roll loop returning an invalid tile.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`arenaExits`, `pickArenaExit`), `packages/server/src/systems/combat/arena.ts` (`quitArena`)
- **Pinned by:** `divergence: with no passing tile quit says nothing and stays put`; `divergence: an arena death with no passing tile keeps the player in place, at HP and SP 1, and says the line` (packages/server/tests/arena.test.ts); `divergence: no passing tile → null, where 1.6's exit loop never ended` (packages/shared/tests/combat/arena.test.ts)

#### "You cannot fight here!" is said once per press
- **Kind:** Bug fixed
- **What you notice:** Holding attack on a map where fighting is not allowed says "You cannot fight here!" once, and so does a quick tap. Releasing and pressing again says it again.
- **1.6:** The line was sent on every frame the key was held, so SSO's chat showed one line with a climbing ×N count.
- **SSO:** `pollAttack` records the refusal in `attackRefused` and says it only once until the key is released or pressed again (`setAttackHeld`). The refusal also answers the press, so a tap released before the next tick, which the press latch keeps for a couple of ticks, is not refused a second time.
- **Why:** A message repeated thirty times a second is noise, not information.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`, `setAttackHeld`)
- **Pinned by:** `bug fixed: off an arena tile on a no-fight map, a held key says it once per press`; `bug fixed: on a no-fight map a tap, released before the next tick, says it once` (packages/server/tests/monsters.test.ts)

#### Hold stops attacks as well as steps
- **Kind:** Bug fixed
- **What you notice:** While a Hold spell roots you, you can neither walk nor swing. A key held through the Hold swings once the Hold ends.
- **1.6:** The attack key was polled before the Hold gate, so a held player could still swing.
- **SSO:** `pollAttack` returns before the swing while the Hold counter runs, and the browser's swing prediction agrees.
- **Why:** Hold is meant to pin the target in place; swinging freely undid most of its point.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`); `packages/client/src/model.ts` (`predictSwing`)
- **Pinned by:** `bug fixed: Hold stops attacking as well as walking` (packages/server/tests/melee.test.ts)

#### Axe and Mining Hammer speeds follow their skill ladders
- **Kind:** Bug fixed
- **What you notice:** An axe swings slowly at low Axe Fighting and speeds up as it rises: 25 frames below 10, 22 at 10-19, and so on to 15 at 80-89, then the normal 14 (10 with the Ring of Quickness) from 90. A Mining Hammer swings every 15 frames below Mining 10 and one frame faster per 10 skill, down to 7 frames from Mining 80 on.
- **1.6:** Both ladders were tested from low to high with the last matching step winning, so every axe user below 90 got 15 frames and every hammer user below 90 got 7, and a hammer at 90 and above fell back to the normal 14.
- **SSO:** `swingCooldowns` takes the first matching step of each ladder, and the hammer keeps its fastest step from Mining 80 on.
- **Why:** The ladders were plainly written to reward skill; the order made the skill irrelevant and slowed the best miners down.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`swingCooldowns`, `ladderStep`)
- **Pinned by:** `bug fixed: the axe ladder slows low Axe Fighting, 25 frames at 0 down to 15 at 80-89`; `bug fixed: a Mining Hammer speeds up with Mining, 15 frames at 0 down to 7 from 80`; `Ring of Quickness sets 10/10 before the axe ladder` (packages/shared/tests/combat/combat.test.ts)

#### The Ring of Quickness speeds up a fishing pole
- **Kind:** Bug fixed
- **What you notice:** A Fishing Pole waits 20 frames between casts, or 16 with the Ring of Quickness.
- **1.6:** The pole's 20 frames were set after the ring's speed-up and overwrote it.
- **SSO:** `swingCooldowns` takes the ring's 4-frame speed-up off the pole's 20, and the cast in `preSwing` uses that delay.
- **Why:** The ring promises quicker swings with any weapon.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`swingCooldowns`); `packages/server/src/systems/crafting/gather.ts` (`preSwing`)
- **Pinned by:** `bug fixed: the Ring of Quickness shortens a fishing pole's 20 frames to 16` (packages/shared/tests/combat/combat.test.ts); `bug fixed: the Ring of Quickness shortens a cast's AtDelay from 20 to 16` (packages/server/tests/gather.test.ts)

#### A held attack swings at the cooldown's own pace
- **Kind:** Bug fixed
- **What you notice:** Holding attack swings every 14 frames by default (10 with the Ring of Quickness), matching the cooldown.
- **1.6:** The frame script re-armed the attack before counting the delay down, so a held key swung every cooldown plus one frames.
- **SSO:** `tickAttackTimers` counts the delay down first and re-arms on the frame it reaches 0. The browser runs the same function.
- **Why:** The cooldown number should be the actual wait.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`tickAttackTimers`)
- **Pinned by:** `bug fixed: holding attack swings every AtDelay = 14 frames, not 15` (packages/shared/tests/combat/combat.test.ts)

#### Big monsters can be hit on any of their tiles
- **Kind:** Bug fixed
- **What you notice:** The Overlord and the Mutant Worm can be hit on any of their six tiles, including one under your own feet.
- **1.6:** The extra tiles were tested against the faced tile only, so a big monster whose extra tile was under you was missed.
- **SSO:** `meleeReaches` tests every tile of the footprint against both your tile and the faced tile.
- **Why:** If you are standing in the monster, your swing should reach it.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`meleeReaches`, `FOOTPRINT_CELLS`)
- **Pinned by:** `bug fixed: the 3x2 footprint is tested on my own tile as well as the faced tile` (packages/shared/tests/combat/combat.test.ts)

#### A bow without arrows or crystals refuses the shot
- **Kind:** Bug fixed
- **What you notice:** Swinging a bow with no arrows says "You don't have any arrows!"; with arrows but no crystal of their colour it says "You don't have any <colour> crystals left!". Either way nothing else happens: no swing and no cooldown. The line is said once per press.
- **1.6:** With no arrows the bow meleed for 1. With no crystal the swing was wasted: the cooldown ran, the power bar reset and you left combat.
- **SSO:** `bowRefusal` is checked in `workAttack` before `startSwing`; the browser's prediction makes the same check.
- **Why:** Running out of ammunition should stop the shot, not cost you a swing or turn the bow into a stick.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`bowRefusal`, `NO_ARROWS_TEXT`); `packages/server/src/systems/combat/melee.ts` (`workAttack`); `packages/client/src/model.ts` (`predictSwing`)
- **Pinned by:** `bug fixed: a bow with no arrows, or no crystal for them, is refused before the swing` (packages/shared/tests/combat/combat.test.ts); `bug fixed: a bow with no arrows is refused once per press, with no cooldown`; `bug fixed: a bow with arrows but no crystal is refused before the swing, with no cooldown`; `an off-hand that only contains "Arrows" counts as no arrows` (packages/server/tests/melee.test.ts)

#### A stepping player is hit on the tile they are leaving
- **Kind:** Bug fixed
- **What you notice:** A player part-way through a step can be hit on the tile they just left, and a swing never hits a player who is nowhere near it.
- **1.6:** The old-tile test read the victim's old Y twice and compared it with both coordinates of the faced tile.
- **SSO:** `pvpSwing` compares the faced tile with the victim's real previous tile.
- **Why:** The test was meant to catch a victim still visibly on their old tile.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pvpSwing`)
- **Pinned by:** `bug fixed: a victim part-way through a step is hit on the tile it is leaving`; `bug fixed: a swing at (4,4) no longer hits a victim stepping from (9,4)` (packages/server/tests/melee.test.ts)

#### Parry and block work from the first skill point
- **Kind:** Bug fixed
- **What you notice:** Against monsters, a new character parries or blocks about 1 hit in 90 until the skill passes 20, as against players. Against players, Block 0 can block, and the Adventurer's bonus now helps against players too (minus 10 on block, as against monsters, and minus 4 on parry, against minus 10 against monsters). This is a large PvP balance shift: an Adventurer with Parry and Block above 96 avoids about 57% of player hits, against about 9% in 1.6.
- **1.6:** Against monsters the draws were out of 3000 until the skill was over 10. Against players Block had no starting draw, so Block 0 never blocked, and the Adventurer's subtraction re-rolled a result below 1 as a fresh draw out of 90 instead of clamping it to 1.
- **SSO:** `dodgeRoll` starts from `random(90)`. `pvpDodgeRoll` gives parry and block the same starting draw and clamps the Adventurer's result to 1.
- **Why:** The ladders were meant to start from a small chance, not none, and the faction bonus was meant to help in both fights.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`dodgeRoll`); `packages/shared/src/rules/combat/armour.ts` (`pvpDodgeRoll`)
- **Pinned by:** `bug fixed: parry and block start from random(90), not random(3000)` (packages/shared/tests/combat/combat.test.ts); `bug fixed: the faction-3 parry/block bonus clamps a draw pushed below 1 to 1 in PvP, as against monsters`; `bug fixed: PvP Block 0 can block`; `PvP parry: base random(90), then one draw per threshold passed` (packages/shared/tests/inventory/inventory.test.ts)

#### A swing that hits a monster also hits players
- **Kind:** Bug fixed
- **What you notice:** A melee swing hurts a player on the tile even if it also hits a monster.
- **1.6:** The monster damage added to the Attack message left a field other players read as an arrow shot, so they skipped the player-hit check.
- **SSO:** `workAttack` always runs `pvpSwing` for a melee swing.
- **Why:** The message format, not a game rule, decided the outcome.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`, `pvpSwing`)
- **Pinned by:** `bug fixed: a swing that also hits a monster still hurts a player on the tile` (packages/server/tests/inventory.test.ts)

#### Holy Shield decides before the dodge rolls
- **Kind:** Bug fixed
- **What you notice:** An innocent standing on a Holy Shield gets "Shield" straight away; no parry or block dice are thrown away first.
- **1.6:** The shield check came after the parry and block draws in both hit handlers.
- **SSO:** `pvpHit` and `monsterHitsPlayer` return "Shield" before any draw.
- **Why:** Spent draws changed the luck of every later roll for nothing.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`pvpHit`); `packages/shared/src/rules/combat/combat.ts` (`monsterHitsPlayer`)
- **Pinned by:** `bug fixed: an innocent on a Holy Shield gets Shield before any draw` (packages/shared/tests/combat/combat.test.ts); `bug fixed: a Holy Shield gives Shield in PvP before any draw` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: an innocent on a Holy Shield's exact spot gets Shield before any parry or block draw` (packages/server/tests/spells.test.ts)

#### The green crystal message is spelt right
- **Kind:** Bug fixed
- **What you notice:** A bow with Green Arrows and no green crystal says "You don't have any green crystals left!"
- **1.6:** The text said "geen".
- **SSO:** `outOfCrystalsText` spells every colour from its name.
- **Why:** A typo.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`outOfCrystalsText`)
- **Pinned by:** `bug fixed: "green crystals", not "geen"` (packages/shared/tests/inventory/inventory.test.ts)

#### A negative defense bonus adds damage
- **Kind:** Bug fixed
- **What you notice:** A negative defense bonus makes you take more damage.
- **1.6:** A negative bonus was added to the attack power, which made it smaller.
- **SSO:** `randomAndDefense` subtracts the bonus whatever its sign.
- **Why:** The sign should mean what it says.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`randomAndDefense`)
- **Pinned by:** `bug fixed: a negative DefenseBonus adds damage` (packages/shared/tests/combat/combat.test.ts)

#### Ice and fire armour change the hit points you lose
- **Kind:** Bug fixed
- **What you notice:** Elemental armour against the Yeti, Snow Serpent, Snow Demon or Fire Demon changes the hit points you lose, and the floating number shows that amount.
- **1.6:** The hit points were taken off first; the Ice and Fire modifiers only changed the number shown.
- **SSO:** `monsterHitsPlayer` applies the elemental rows after the armour rows, as the player hit does, before the loss.
- **Why:** The armour was meant to protect, and the number shown should be the damage taken.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`monsterHitsPlayer`); `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`)
- **Pinned by:** `bug fixed: ice armour against a Yeti cuts the hit points lost` (packages/shared/tests/combat/combat.test.ts)

#### The armour-break exclusions work
- **Kind:** Bug fixed
- **What you notice:** The Slime, Wolf, Imp, Cow, Pig, Shark, Squid, Dragon Snake and Fire Demon never break your armour.
- **1.6:** The exclusion list held bare names but was handed "a <name>", so nothing ever matched.
- **SSO:** `rollArmourBreak` drops the "a " before testing the list.
- **Why:** The list was written so these monsters would not break armour; it had no effect only because of the name mismatch.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`rollArmourBreak`)
- **Pinned by:** `bug fixed: the armour exclusion list matches "a <name>"` (packages/shared/tests/inventory/inventory.test.ts)

#### An Adventurer's armour bonus follows the Adventurers' standing
- **Kind:** Bug fixed
- **What you notice:** An Adventurer takes 1 less damage from each hit while the Adventurers' faction bonus is above 0, and 2 less above 6, whatever the Warriors' standing.
- **1.6:** The faction reduction read the Warriors' bonus for Adventurers too, so an Adventurer's armour rose and fell with the rival faction's standing.
- **SSO:** `factionRows` reads the Adventurer bonus (`f3Bonus`) for an Adventurer and the Warrior bonus (`f2Bonus`) for a Warrior.
- **Why:** Every other Adventurer perk reads the Adventurers' own bonus; reading the Warriors' was a slip.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`factionRows`)
- **Pinned by:** `bug fixed: an Adventurer's faction armour reads the Adventurer bonus, not the Warrior one` (packages/shared/tests/combat/combat.test.ts)

#### Administrators take no damage of any kind
- **Kind:** Bug fixed
- **What you notice:** Another player's swing, a harmful spell, a Whirlwind and starving do nothing to an administrator, just as monsters do nothing.
- **1.6:** The monster hit handler exited for immortals; the player-versus-player one and the spell collision had no such check, so an immortal could be killed by a player or a spell.
- **SSO:** Every source of damage asks whether the victim's role has the `invulnerable` permission: `pvpSwing` skips such a victim, `playerCollision` lands no harmful spell or Whirlwind on them, and `regenStep` takes no HP for starving.
- **Why:** Invulnerability should be the same against everything.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pvpSwing`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`), `packages/server/src/systems/progression/vitals.ts` (`regenStep`)
- **Pinned by:** `bug fixed: administrators take no PvP damage` (packages/server/tests/inventory.test.ts); `administrators take no monster damage` (packages/server/tests/monsters.test.ts); `bug fixed: a role that takes no damage is untouched by harmful spells and Whirlwind` (packages/server/tests/spells.test.ts); `costs a player HP, and an invulnerable role none` (packages/server/tests/invulnerable.test.ts)

#### Weapon attack power matches the right weapons
- **Kind:** Bug fixed
- **What you notice:** A book no longer hits like a Bo, a Mining Hammer hits for its own 2 to 5 base, Archery below 30 sets the bow's power by your own step (and 30 gets the +1 that 31 used to), and the Gold Sword's Heavy Arms bonus is counted once (+6 at 100).
- **1.6:** The Bo's row matched any name containing "Bo", the hammer's row was spelt "Minng Hammer", the three Archery resets all applied below 10 (the last winning) with nothing at exactly 30, and the Gold Sword had two Heavy Arms blocks.
- **SSO:** The Bo's base row is an exact match, which `attackPower` honours; the hammer's row is spelt right; the Archery tiers are ranges with the first add at 30; the duplicate Gold Sword block is gone.
- **Why:** Each was a slip in the table, not a design.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`attackPower`, `tierApplies`); `packages/data/content/attpower.json`
- **Pinned by:** `bug fixed: the "Bo" row matches only the Bo, not books and bows`; `bug fixed: a Mining Hammer rolls its base row 2 + random(3)`; `bug fixed: the Archery tiers are steps, and Archery 30 gets its +1`; `bug fixed: Gold Sword's HeavyArms block runs once: +6 at HeavyArms 100` (packages/shared/tests/combat/combat.test.ts)

#### Arena tiles wait for the re-arm like any swing
- **Kind:** Bug fixed
- **What you notice:** On a no-fight map, holding attack on an arena tile swings at the same pace as on a fight map.
- **1.6:** The arena-tile branch swung without checking that you were ready, on the frame the cooldown reached 0 and before the bar block ran, so every swing repeated the last power-bar tier (SSO has [no power bar](#no-power-bar)).
- **SSO:** `pollAttack` requires the attack to be armed on an arena tile too.
- **Why:** An arena tile should follow the same attack rules as a fight map.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`, `onArenaTile`)
- **Pinned by:** `bug fixed: on a no-fight map an arena tile waits for the re-arm like any swing` (packages/server/tests/monsters.test.ts)

#### An arena is any map with a 6P tile on layer 1
- **Kind:** Bug fixed
- **What you notice:** A map counts as an arena when it has an arena tile anywhere on layer 1, including the first and last columns and rows 10 to 12. Standing on such a tile is an arena tile, and a death there is an arena death. A `6P` on another layer, or "6P" written in a sign or the title, does not make an arena.
- **1.6:** The challenge searched the raw map record for " 6P " with spaces around it, which missed a tile at either end of a row and accepted one on another layer, in a sign or in the title, which the challenge could then never find. The tile test read another field of the map record for rows 10 to 12, so those were never arena tiles.
- **SSO:** `hasArena` and `isArenaTile` read layer 1's 12 rows with `layer1Tile`.
- **Why:** The check and the search must agree on what an arena tile is.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`hasArena`, `isArenaTile`, `arenaTiles`)
- **Pinned by:** `bug fixed: a 6P only in column 1 or 17 is an arena`; `bug fixed: a 6P on another layer, or 6P in a sign or title, is not an arena`; `bug fixed: arena tiles on rows 10-12 are arena tiles` (packages/shared/tests/combat/arena.test.ts); `bug fixed: arena tiles on rows 10-12 are arena tiles` (packages/server/tests/monsters.test.ts)

#### A challenge always lands on a free arena tile or says why not
- **Kind:** Bug fixed
- **What you notice:** A challenge on an arena always puts you on one of its tiles, never one another player, a monster or a blocking item already holds. If every arena tile is taken it says "There is no room in the arena!". Quitting, or dying in the arena, never puts you on another player's tile either.
- **1.6:** The challenge made 799 random tries over the whole 17 × 12 record and gave up silently when none landed on an arena tile (about 2% of the time with one tile). Neither the challenge nor the exit checked who stood on the tile.
- **SSO:** `findArenaTile` picks uniformly among the free arena tiles with one roll; `pickArenaExit` skips taken tiles. `arenaTileTaken` answers for players, monsters and blocking ground items.
- **Why:** A silent failure looks like a broken command, and two players on one tile is not a fair fight.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`findArenaTile`, `pickArenaExit`); `packages/server/src/systems/combat/arena.ts` (`challenge`, `quitArena`, `arenaTileTaken`); `packages/server/src/systems/progression/vitals.ts` (`checkDeath`)
- **Pinned by:** `bug fixed: one uniform roll over the 6P tiles, never a silent miss`; `bug fixed: a taken tile is never picked; every tile taken gives null` (packages/shared/tests/combat/arena.test.ts); `bug fixed: a challenge never puts you on a tile a player or a blocking item holds`; `bug fixed: quit never puts you on another player's tile` (packages/server/tests/arena.test.ts)

#### Hold and the death wait stop the arena words
- **Kind:** Bug fixed
- **What you notice:** A Held player who types `Challenge`, or `quit` while standing on an arena tile, is told "You cannot do that while you are held." (`quit` off an arena tile is ignored as before). A player waiting to respawn is ignored.
- **1.6:** The arena commands tested only whether you were mid-step, so a Held player could quit out of the Hold and a dead one could challenge.
- **SSO:** `challengeCheck` and `quitCheck` refuse while Held or dead.
- **Why:** Typing a word should not escape a Hold or a death.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`challengeCheck`, `quitCheck`); `packages/server/src/systems/combat/arena.ts` (`challenge`, `quitArena`)
- **Pinned by:** `bug fixed: Hold and the death wait stop the arena words` (packages/shared/tests/combat/arena.test.ts); `bug fixed: Hold and the death wait stop the arena words` (packages/server/tests/arena.test.ts)

#### A monster's loot drops where it is drawn
- **Kind:** Bug fixed
- **What you notice:** A monster killed while stepping drops its loot on the tile it is drawn nearest: the tile it is leaving for the first half of the step, the one it is entering after that.
- **1.6:** The drop used the step's destination from the moment the step began.
- **SSO:** `monsterDrawnTile` picks the tile for melee and spell kills.
- **Why:** Loot should appear where you saw the monster die.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`monsterDrawnTile`); `packages/server/src/systems/combat/melee.ts` (`smash`); `packages/server/src/systems/spells/collide.ts` (`checkForDead`)
- **Pinned by:** `bug fixed: loot lands on the tile the monster is drawn nearest` (packages/server/tests/inventory.test.ts); `bug fixed: a spell kill drops the loot on the tile the monster is drawn nearest` (packages/server/tests/spells.test.ts)

#### Every death in a Lightning game is penalty-free
- **Kind:** Bug fixed
- **What you notice:** During a Lightning game no death takes the drop, the head or exile, whether it came from a melee hit, an arrow, a spell or a monster.
- **1.6:** Only the melee hit checked for a Lightning game.
- **SSO:** `checkDeath` runs the penalty-free death for any death while `lightningGame` is set.
- **Why:** The game announces that all death penalties are off.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`); `packages/server/src/systems/world/tick.ts`
- **Pinned by:** `bug fixed: during a Lightning game every death is penalty-free, not only a melee hit`; `outside a Lightning game the same death takes every penalty` (packages/server/tests/assassin.test.ts); `bug fixed: a Lightning game's death drops no faction head and exiles no one`; `outside a Lightning game a faction member's death drops the head and exiles` (packages/server/tests/assassin.test.ts)

#### A rider must land before challenging
- **Kind:** Bug fixed
- **What you notice:** Typing Challenge while riding an airship says "You must land your airship before making a challenge." and leaves you where you are. On a boat or battleship it says "You must leave your boat before making a challenge." (or "battleship").
- **1.6:** Challenge never looked at vehicles, so a rider entered the arena still flying, where it could not swing or cast and monster melee could not reach it.
- **SSO:** The challenge is refused aboard; the line is SSO's own. A rider over arena tiles is not in the arena at all (see [Arenas are for players on foot](#arenas-are-for-players-on-foot)).
- **Why:** An arena fight is meant to be on foot.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`challengeCheck`), `packages/server/src/systems/combat/arena.ts` (`challenge`)
- **Pinned by:** `bug fixed: a rider must land before making a challenge`; `the challenge refusal names the ship a rider is on, not the airship` (packages/shared/tests/combat/arena.test.ts); `bug fixed: a rider cannot challenge; over an arena tile, quit does nothing` (packages/server/tests/arena.test.ts)

#### A masterwork keeps its weapon's skill bonus
- **Kind:** Bug fixed
- **What you notice:** A Sword of Hope +1 hits as hard from Heavy Arms as a plain Sword of Hope.
- **1.6:** The attack-power skill blocks for the Long Sword, Sword of Hope, Gold Sword, Broad Sword, Katana, Scimitar, Bo and Unholy Lance named the weapon exactly, so the Sword of Hope +1 lost its Heavy Arms tiers.
- **SSO:** An exact skill block also covers the masterworks made from its weapon.
- **Why:** The masterwork is meant to be the better sword, not a weaker one.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`attackPower`), `packages/shared/src/rules/crafting/masterwork.ts` (`weaponIs`)
- **Pinned by:** `bug fixed: Sword of Hope +1 gets the Heavy Arms bonus of the Sword of Hope` (packages/shared/tests/progression/weapon-skills.test.ts)

### core

#### Sound off silences everything
- **Kind:** Bug fixed
- **What you notice:** Turning sound off silences every game sound.
- **1.6:** Several sound paths ignored the switch, including swings, tool hits, gathering, damage-number sounds and rain; a player still heard swings and player-versus-player hits with sound off.
- **SSO:** Sound off silences all sounds; sound on leaves play unchanged.
- **Why:** A player switching sound off in a browser expects silence, and the change does not affect gameplay.
- **In the code:** `packages/client/src/audio.ts` (`createAudio`)
- **Pinned by:** `divergence: off silences everything, 1.6's ungated sounds too` (packages/client/tests/sound.test.ts)

#### The church bell leaves channel 5's volume alone
- **Kind:** Bug fixed
- **What you notice:** After the church bell, the damage-number sound and the rest of channel 5 play at their normal volume.
- **1.6:** The bell set channel 5's volume to 200 and nothing reset it, so every later sound on that channel played at the bell's volume for the rest of the session.
- **SSO:** A volume sent with a sound applies to that sound alone.
- **Why:** The bell's volume was meant for the bell.
- **In the code:** `packages/client/src/audio.ts` (`playAll`, `createAudio`)
- **Pinned by:** `bug fixed: a sound's own volume plays that sound alone at it; the channel keeps its volume` (packages/client/tests/sound.test.ts)

#### Characters face away holding their weapon in the right hand
- **Kind:** Bug fixed
- **What you notice:** Walking north, your character holds the shield in the left hand and swings with the right, matching the other three facings. Most monsters and NPCs turn the same way from behind: the Orc and Orc Lord raise their right arm to attack.
- **1.6:** The back views were drawn as if seen from the front. Facing north the shield showed in the right hand and the sword in the left, and the body's attack arm was on the wrong side, so every character looked left-handed from behind. Most monster and NPC back views had the same mirror.
- **SSO:** The asset build flips every north frame marked `"mirrored": true` before packing the atlas. Original art is marked in `assets/original-sidecars.json`, which holds the same correction fields as an added file's sidecar. Every original paperdoll layer's north frames are marked; a layer flips about the body's centre line. The north frames of 34 bodies are marked; each body flips about the centre line of its standing north frame, so it faces away from where it stood, and its hit rects move with it. The Lizard Warrior, Elf and Dwarf already held their weapon correctly from behind and are not marked, nor are the bodies whose north frame copies the south one (the Slimes, Dragon Hatchling, Death, Demons, Ghoul, Snared Loah, Ghost, Illusionary Spikes, Web, Holy Shield, Squid, Mutant Worm, Snow Demon and the bush). Asymmetric back-of-head details, such as some hairstyles, flip with the body. Added art drawn the 1.6 way is marked in its own sidecar, as the boot and bare-feet layers are.
- **Why:** One character should not change hands when it turns around.
- **In the code:** `assets/original-sidecars.json`; `packages/data/build/assets-lib/mirror.ts` (`mirrorPaperdoll`, `centreLine2`, `mirrorBody`, `checkMirroredFlags`), `packages/data/build/assets-lib/original-sidecars.ts` (`checkOriginalSidecars`), `packages/data/build/assets.ts` (`buildAssets`), `packages/data/build/data.ts` (`renderRects`)
- **Pinned by:** `bug fixed: from behind, a character holds the shield in the left hand and the weapon in the right`, `original sidecars: every paperdoll north frame and the listed bodies' north frames are mirrored, nothing else` and `added art marked mirrored is flipped in the atlas and its hit rect` (packages/data/tests/assets.test.ts)

### crafting

#### A tool's first success takes the full number of hits
- **Kind:** Bug fixed
- **What you notice:** Gathering takes the number of hits per success that the skill table gives, the first time too. Each gathering tool keeps its own count, so swapping hammers does not finish another hammer's count. Every axe counts as the one Axe tool, so the Axe and Gold Axe share a count.
- **1.6:** There was one counter per tool family. It was reloaded only when it dropped below 1, and success came at exactly 1, so the first success came one hit early. All three hammers shared one mining counter.
- **SSO:** The count is loaded when it is empty, each hit takes one, and the hit that empties it succeeds. Counts are kept per entry in the gathering-tool table (an entry can match several items, as Axe does) and start empty at each login.
- **Why:** Every success should cost what the table says, and one tool's work should not carry over to another.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`hitCounter`, `newGatherCounters`)
- **Pinned by:** `bug fixed: every success takes exactly the table's number of hits, the first too`; `bug fixed: each hammer keeps its own count` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: 18 swings fell a tree, as the table says: the stump, treefalling, logs and the skill line` (packages/server/tests/gather.test.ts)

#### Gathering at skill 0 drops items
- **Kind:** Bug fixed
- **What you notice:** With Lumberjacking at 0 a felled tree can drop Logs, and with Mining at 0 a broken rock can drop crystals, ore or a chunk.
- **1.6:** The drop rolls were made, but each drop was guarded by "skill above 0".
- **SSO:** The guard is gone; a skill of 0 uses the lowest row of each table.
- **Why:** New gatherers should get something for their work.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`rollLogs`, `rollMiningFind`, `rollChunk`)
- **Pinned by:** `bug fixed: Lumberjacking 0 drops logs like any other skill`; `bug fixed: Mining 0 finds crystals, ore and chunks` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: Lumberjacking 0 fells trees, drops logs and can rise` (packages/server/tests/gather.test.ts)

#### Ore odds improve with Mining
- **Kind:** Bug fixed
- **What you notice:** The chance of Iron, Steel or Star ore rises with Mining skill, from Iron 1 in 100 at skill 0 to 1 in 25 from 90 up. At 97 and above the odds stay at their best instead of dropping Iron.
- **1.6:** The odds were a cascade of "skill below N" tests in which the last true one won, so every skill below 97 got the same odds (Iron 1 in 25, Steel 1 in 55, Star 1 in 155). At 97 and above the pool was left unset, so Iron never dropped while Steel became 1 in 30 and Star 1 in 130.
- **SSO:** The tightest "below N" row the skill is under sets the Iron pool; Steel adds 30 and Star adds 100 more. From 97 up the last row (25) applies.
- **Why:** Mining skill should matter, and should never make an ore impossible.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`orePool`, `rollMiningFind`)
- **Pinned by:** `bug fixed: ore odds improve as Mining rises, and never get worse at 97` (packages/shared/tests/crafting/gather.test.ts)

#### Fishing at skill 0 can catch fish
- **Kind:** Bug fixed
- **What you notice:** With Fishing at 0 you catch Raw Fish at the same odds as Fishing 1, and the skill can rise.
- **1.6:** The fishing check was only set up above 0, so the catch roll could never succeed at 0, and the skill-raising helper also needed the skill above 0.
- **SSO:** Skill 0 uses the first row of the catch table (1 in 30).
- **Why:** A new fisher should be able to start.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`fishCheck`, `castLine`)
- **Pinned by:** `bug fixed: Fishing 0 catches at the lowest skill's odds and can rise` (packages/shared/tests/crafting/gather.test.ts)

#### Seeds are kept when they cannot be planted
- **Kind:** Bug fixed
- **What you notice:** Using seeds on a tile that cannot grow them, or facing off the edge of the map, reads "…isn't going to grow anything here!" and keeps the seed.
- **1.6:** The planting routine exited on the wrong tile but the item removal was sent anyway. Off the map the tile read as empty, which passed the test, so it printed "You plant the seeds." while the server refused the change.
- **SSO:** A seed is used up only when the tilled soil (`SL`) actually changes. Anything else, including off the map, gives the wrong-ground line.
- **Why:** Players should not lose seeds to a planting that did nothing.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`plantSeeds`); `packages/shared/src/rules/crafting/gather.ts` (`canPlant`); `packages/server/src/systems/inventory/items.ts` (`useIntent`)
- **Pinned by:** `bug fixed: seeds plant only on SL; off the map nothing can be planted` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: seeds are kept on a wrong tile or off the map; they plant on SL` (packages/server/tests/gather.test.ts)

#### The shovel checks the ground under every tile
- **Kind:** Bug fixed
- **What you notice:** The shovel digs only where the first-layer ground under the tile is grass or earth (`G1`, `H1` or `O1`), on every row of the map. It no longer digs holes over water, and the top-right tile of the top row can be dug.
- **1.6:** The shovel read a word of the one-line map data, which was empty below row 1, and empty text passed the test. So the check applied only on the top row, where column 17 straddled the `#` joining two layers and never matched.
- **SSO:** The shovel reads the first-layer tile at the dug position and tests it against the same three codes. Off the map nothing can be dug.
- **Why:** The ground restriction was meant to apply everywhere.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`shovelLayer1Ok`)
- **Pinned by:** `bug fixed: the shovel checks the ground under every tile, on every row` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: the shovel will not dig G3 over water on any row` (packages/server/tests/gather.test.ts)

#### Crafting at skill 10 can fail
- **Kind:** Bug fixed
- **What you notice:** A craft at skill exactly 10 can fail, with the same 1 in 3 chance as lower skills.
- **1.6:** The failure table had a "below 10" row and an "above 10" row, so 10 matched neither and never failed.
- **SSO:** The first row covers skills up to and including 10.
- **Why:** No single skill value should be immune to failure.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`failurePool`, `rollFailure`)
- **Pinned by:** `bug fixed: crafting skill exactly 10 can fail, at the odds of the skills below it` (packages/shared/tests/crafting/craft.test.ts)

#### Blacksmithing only gets faster with skill
- **Kind:** Bug fixed
- **What you notice:** Smithing takes 500 frames at skill 10 or less, then 460, 400 and so on down to 12, so a higher skill never waits longer.
- **1.6:** The smithing timer was 300 frames, then 460 above 10 and 400 above 20, so smiths with skill 11 to 30 waited longer than beginners.
- **SSO:** The base timer is 500, so the table only ever decreases.
- **Why:** Practice should never make smithing slower.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`craftTimer`)
- **Pinned by:** `bug fixed: Blacksmithing only ever gets faster as the skill rises` (packages/shared/tests/crafting/craft.test.ts); `starts with the line, the lock and Swordhit3; done on the 500th frame` (packages/server/tests/craft.test.ts)

#### Every craft takes its materials when it finishes
- **Kind:** Bug fixed
- **What you notice:** Starting a craft takes nothing. When it finishes, it takes its materials: the damaged item and chunk, the raw food, the Potion Bottle and crystal, or the Logs. A failure uses them up: a burned meal leaves its burned food (see [Burned food](#burned-food-and-cooked-meat)), and a bad potion or a ruined build makes nothing.
- **1.6:** Cooking and smithing took their inputs at completion, and a burn exited before the raw food was taken, so a burned meal kept its food. Alchemy and carpentry took their inputs at the start, so their failures lost them.
- **SSO:** `finishCraft` takes every material by exact name at completion. Failures use them up the same way for cooking, alchemy and carpentry. If a material is gone by then, the craft ends silently, as a repair with no chunk already did. A burn whose burned food has no room in the bag is treated like a success with no room: "Your inventory is too crowded!", and nothing is taken.
- **Why:** Failures should cost the same in every craft, and crafts that end early should lose nothing.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`finishCraft`, `startCraft`)
- **Pinned by:** `bug fixed: a burned meal uses up its raw food and makes its burned form`; `a burn on a full bag says so, makes nothing and keeps the raw stack`; `a failed brew uses up the bottle and the crystal`; `bug fixed: 'You built a Chair!'; a failure says so and uses the Logs` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: alchemy takes the bottle and crystal at completion; the sand stays in hand`; `carpentry: Logs taken at completion, 'You built a Crate!', the result minted an id` (packages/server/tests/craft.test.ts)

#### Yeti Meat cooks into a Yeti Burger
- **Kind:** Bug fixed
- **What you notice:** Cooking Yeti Meat makes a Yeti Burger.
- **1.6:** The server's recipe table mapped Yeti Meat to itself.
- **SSO:** The recipe gives the existing Yeti Burger item.
- **Why:** Cooking should change the food.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cookResult`)
- **Pinned by:** `bug fixed: Yeti Meat cooks into a Yeti Burger` (packages/shared/tests/crafting/craft.test.ts)

#### Masterwork rolls are even and the Knight's Sword repairs
- **Kind:** Bug fixed
- **What you notice:** A repaired Chain Helm or Steel Shield gets its +1 on one roll, like every other single-bonus item. A broken Knight's Sword becomes "Damaged Sword, Knight", which repairs into a Knight's Sword with a Chunk of Steel. Starting a repair on an item with no repair says "You don't know how to repair that."
- **1.6:** Chain Helm and Steel Shield gave +1 on two rolls. The table had a Leather Armor +1 row, but Leather Armor never breaks, so it could never come up. A Knight's Sword broke into "Damaged Sword, Knight's", but the repair looked for "Damaged Sword, Knight", so it ended with "Your  is ready!" and kept its inputs.
- **SSO:** Each masterwork bonus has one roll, and the dead Leather Armor row is gone. The armour break uses the "Damaged Sword, Knight" name that has art, and the artless "Damaged Sword, Knight's" is not in the Classic pack: the upgrade renames old copies to "Damaged Sword, Knight". The Smith button refuses an item with no repair.
- **Why:** Every masterwork row should be reachable, and every damaged item that breaks should be repairable.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`masterwork`, `repairResult`, `smithChunk`); `packages/data/content/item-rules.json` (`breaks`)
- **Pinned by:** `bug fixed: each masterwork bonus has one roll, and every row can come up`; `bug fixed: a broken Knight's Sword repairs`; `an item with no repair cannot be started` (packages/shared/tests/crafting/craft.test.ts)

#### Only alchemy sand mixes a potion
- **Kind:** Bug fixed
- **What you notice:** Mixing needs one of the six sands held in the right hand. Holding anything else, such as a Catfish Sandwich, gives "You must be holding some alchemist sand in your hand to mix the potion!" and keeps your keys free.
- **1.6:** The gate only checked that the held item's name contained " Sand", so a Catfish Sandwich passed with no crystal. The brew then reused the session's last potion, or a Bad Potion after a failed start, and before any brew it printed nothing and left the keys locked until the next map load.
- **SSO:** The held item must equal one of the six sands, which also picks the potion and the crystal. No last potion is kept.
- **Why:** A sandwich should not brew free potions or lock the player's keys.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startMix`)
- **Pinned by:** `bug fixed: only a real sand mixes; a Catfish Sandwich is refused` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: a Catfish Sandwich cannot stand in for sand; the keys stay free` (packages/server/tests/craft.test.ts)

#### Building furniture needs Carpentry 1
- **Kind:** Bug fixed
- **What you notice:** With Carpentry below 1 the Build button reads "You aren't skilled in carpentry, you'd just ruin the logs". New characters start at 1.
- **1.6:** Build checked only the Saw, so any Carpentry skill could build.
- **SSO:** Carpentry follows cooking's rule: the skill must be at least `minSkill` (1).
- **Why:** Carpentry should need the skill, like the other crafts.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startBuild`)
- **Pinned by:** `bug fixed: carpentry needs the Saw and Carpentry 1, like cooking's skill rule` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: carpentry needs Carpentry 1` (packages/server/tests/craft.test.ts)

#### The cauldron matches exact ingredients and keeps the rest
- **Kind:** Bug fixed
- **What you notice:** A cauldron brews when it holds both ingredients of a recipe, each by its exact name: an Axe works, a Gold Axe does not. The brew swaps the two ingredients for the result and leaves everything else inside. The recipe that needs a Magic Shield Book (with a White Robe, for a Wizard's Robe) now works; the other made a Magic Shield item with no picture and is gone (see [Items nobody could get, or could only get without a picture, are gone](#items-nobody-could-get-or-could-only-get-without-a-picture-are-gone)). Anyone with that cauldron open sees the new contents at once.
- **1.6:** The recipes were "contains" tests over all the stored text, the last matching recipe won, and a success overwrote everything inside with the result. Two recipes needed a "Magic Shield Spell Book" that no one could get. The open window was not refreshed, so after a brew its old lines took nothing.
- **SSO:** `cauldronBrew` checks recipes in order by exact name, the first match wins, and it removes one of each ingredient. A brew refreshes the list of every player with that cauldron open.
- **Why:** Players should not lose unrelated items to a brew, and every recipe should be possible.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cauldronBrew`); `packages/server/src/systems/economy/containers.ts` (`depositContainer`)
- **Pinned by:** `a brew needs both ingredients and swaps them for the result`; `bug fixed: ingredients match by exact name; the Magic Shield Book recipe works`; `bug fixed: no recipe brews the artless Magic Shield item` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: a hit says so to the depositor only and keeps the other contents`; `bug fixed: a brew refreshes the list of anyone with the Cauldron open`; `bug fixed: the Magic Shield Book recipe brews, and 'Axe' means an Axe` (packages/server/tests/craft.test.ts)

#### Crafts take exactly the named item
- **Kind:** Bug fixed
- **What you notice:** Cooking a Pig takes the Pig and never touches a Cooked Pig stack elsewhere in your bag.
- **1.6:** The removal took from the first bag slot whose text contained the item name and a dash, then wrote the line back under the shorter name, so "Cooked Pig-3" could become "Pig-2".
- **SSO:** Every crafting removal matches the whole item name.
- **Why:** Crafting should not rename other items.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`takeByName`, `firstSlotNamed`)
- **Pinned by:** `bug fixed: cooking a Pig takes the Pig, never a Cooked Pig` (packages/shared/tests/crafting/craft.test.ts)

#### A full bag stops the craft from finishing
- **Kind:** Bug fixed
- **What you notice:** If a finished craft's result has nowhere to go, you read "Your inventory is too crowded!", nothing is taken, nothing is made and there is no skill roll.
- **1.6:** Cooking and smithing printed "Your <item> is ready!" and rolled the skill even though nothing was added. Alchemy and carpentry had already taken their inputs, so the result was simply lost.
- **SSO:** `finishCraft` tries the whole change on a copy of the bag and keeps it only if the result fits.
- **Why:** The game should not report a craft that made nothing, or destroy materials for it.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`finishCraft`)
- **Pinned by:** `bug fixed: a full bag says so, makes nothing and keeps the raw stack`; `bug fixed: a full bag keeps the Logs and makes nothing` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: a full bag says so, with no skill roll and no 'is ready!'; the inputs stay` (packages/server/tests/craft.test.ts)

#### Each cook rolls its own burn
- **Kind:** Bug fixed
- **What you notice:** Whether a meal burns depends only on that cook's own roll.
- **1.6:** The food chosen for a cook was kept for the session, and a failed start set it to "Bad Food". Any name without its own food row, such as Raw Meat, kept it, so Raw Meat burned every time after one failure. With no earlier cook it read "Your  is ready!" with a blank name.
- **SSO:** The failure roll happens once, at completion. The Cook button refuses an item with no recipe ("You don't know how to cook that."); every Cook button has one, now that Raw Meat cooks into Cooked Meat (see [Burned food](#burned-food-and-cooked-meat)).
- **Why:** One failure should not doom later cooks, and an uncookable item should say so.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startCraft`, `cookResult`)
- **Pinned by:** `bug fixed: each cook rolls its own burn` (packages/shared/tests/crafting/craft.test.ts); `every item with a Cook button has a recipe, so the no-recipe refusal never shows` (packages/shared/tests/crafting/craft.test.ts)

#### Building says "You built a ..."
- **Kind:** Bug fixed
- **What you notice:** A finished build reads "You built a Chair!".
- **1.6:** The message read "Your built a Chair!".
- **SSO:** The text is corrected in the crafting data.
- **Why:** Typo.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`CRAFT_TEXT`)
- **Pinned by:** `bug fixed: 'You built a Chair!'; a failure says so and uses the Logs` (packages/shared/tests/crafting/craft.test.ts)

#### A map change ends a craft
- **Kind:** Bug fixed
- **What you notice:** If you change map while smithing, cooking, mixing or building, whether by a warp, an exit or a death, the craft stops and you read "You stop what you were making." Nothing has been taken, so nothing is lost.
- **1.6:** Nothing reset the crafting counters on a map change, death or warp, and loading a map freed the keys, so you could walk around while the craft ran and it finished wherever you were.
- **SSO:** `enterRoom` ends any running craft with `cancelCrafts`. A death ends it sooner, on the frame after the player dies and before the respawn moves them (see "A crafter can be shoved, which ends the craft").
- **Why:** A craft should need you to stay at the station.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`cancelCrafts`); `packages/server/src/systems/world/world.ts` (`enterRoom`)
- **Pinned by:** `bug fixed: a map change ends the craft, says so, and loses nothing`; `a map change with no craft running says nothing` (packages/server/tests/craft.test.ts)

#### A crafter can be shoved, which ends the craft
- **Kind:** Bug fixed
- **What you notice:** While you craft you stay in place: walking and turning are refused until it finishes. Another player can still push you a tile as usual, and being pushed off the spot or turned away from the station ends the craft with "You stop what you were making." So does dying or being hopped into or out of an arena. Nothing has been taken, so nothing is lost.
- **1.6:** Starting a craft locked the keys, and the shove skipped players whose keys were locked, so a crafter could not be pushed.
- **SSO:** The shove ignores a lock held only by a craft (a window holding the keys still stops it). A shove that moves the crafter ends every running craft and frees the keys, as a map change does. On the next frame, a craft also ends if the crafter is no longer standing and facing as they were when it started (a shove into a wall turns them, an arena challenge or defeat hops them) or has died, so nothing finishes during the death lock. Other players see the crafter stop crafting at once. A running craft holds the player in its own right: walking, turning, swinging and starting a second craft are refused while it runs, even if a window close with no window open (a shop Cancel, a board close, a guild Leave) clears the key lock.
- **Why:** Crafting should not make a player immovable, and a craft should need you to stay at the station.
- **In the code:** `packages/server/src/systems/movement/push.ts` (`pushOnMe`); `packages/server/src/systems/crafting/craft.ts` (`isCrafting`, `stopCraftsOnMove`, `craftStep`)
- **Pinned by:** `bug fixed: a crafter can be shoved, which ends the craft and frees the keys`; `bug fixed: a shove into a wall that only turns the crafter ends the craft`; `bug fixed: a crafter who dies stops crafting; nothing finishes during the death lock or after`; `bug fixed: a hop off the spot (an arena challenge or defeat) ends the craft`; `a crafter cannot walk or turn away: the craft's key lock holds them in place`; `a stray Cancel or board close mid-craft frees nothing: no walking, swinging or second craft`; `one craft at a time: a second is refused even with the keys cleared`; `a window's key lock still stops a shove` (packages/server/tests/craft.test.ts)

#### Regrowth runs at one rate on every map
- **Kind:** Bug fixed
- **What you notice:** Trees, rock, ice, holes and farm produce grow back at the same rate however many players are on the map. A map nobody visited catches up, up to an hour's worth, when someone arrives. Regrowth no longer pauses after a death or an exit warp.
- **1.6:** Every client on the map rolled the regrowth checks each frame, so more players meant faster regrowth and an empty map never regrew. The six regrowth checks also waited out a 400-frame timer after the roller's death or exit warp.
- **SSO:** The server rolls once per map per frame, the rate one player gave in 1.6. A map whose room was unloaded runs the frames it missed, up to 72,000, when it next ticks. The death and warp timer is gone.
- **Why:** Regrowth should not depend on crowding a map or on who died.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`regrowthStep`); `packages/shared/src/rules/crafting/gather.ts` (`regrowthFrame`, `REGROWTH_CATCH_UP_FRAMES`)
- **Pinned by:** `bug fixed: one random(600) per map per frame, however many players are there`; `bug fixed: an empty map catches up on the frames it missed, up to an hour`; `bug fixed: a stump regrows on a roll under 6, even right after a death or exit warp` (packages/server/tests/gather.test.ts)

#### Gathering and crafting skills rise from 0
- **Kind:** Bug fixed
- **What you notice:** A gathering or crafting skill at 0 can rise through use.
- **1.6:** All nine skill-raising handlers required the skill to be above 0, and nothing else raised these skills from 0.
- **SSO:** The handlers roll from 0 to 99.
- **Why:** A skill at 0 should be trainable.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`skillGainRule`, `rollSkillGain`)
- **Pinned by:** `bug fixed: a skill at 0 can rise; 100 is the cap` (packages/shared/tests/crafting/gather.test.ts); `the skill line follows 'is ready!'; a skill of 0 can rise` (packages/server/tests/craft.test.ts)

#### The Watering Bucket counts only useful swings
- **Kind:** Bug fixed
- **What you notice:** Only a swing at a seeded tile counts toward watering it. Swings at grass, or off the map, count nothing.
- **1.6:** The bucket counted every swing before looking at the tile, so a success could land on an unseeded tile and be wasted.
- **SSO:** The swing counts only when the faced tile can be watered.
- **Why:** Watering should not waste progress.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)
- **Pinned by:** `bug fixed: the Watering Bucket counts only swings at a seeded tile` (packages/server/tests/gather.test.ts)

#### Gathering mid-step drops its item
- **Kind:** Bug fixed
- **What you notice:** Swinging a tool or casting a line while mid-step drops the logs, find or fish on the changed tile, as standing still does.
- **1.6:** The swing worked from the destination tile, but the drop needed you to be standing still, so the tile changed and the skill could rise with nothing dropped.
- **SSO:** The drop no longer checks the step.
- **Why:** A successful swing should give its item.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`toolSwing`); `packages/shared/src/rules/crafting/gather.ts` (`castLine`)
- **Pinned by:** `bug fixed: a fell mid-step drops its logs on the felled tile`; `bug fixed: a cast mid-step catches like any other` (packages/server/tests/gather.test.ts)

#### Water on either layer can be fished
- **Kind:** Bug fixed
- **What you notice:** Water drawn on the first or the second layer can be fished, so D2 water works.
- **1.6:** Fishing read the first layer only, so water that exists only on layer 2 (D2) never gave a fish.
- **SSO:** Fishing tests the faced tile on both layers against the water codes.
- **Why:** Water that looks the same should fish the same.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`isFishingWater`, `FISHING_LAYERS`); `packages/server/src/systems/crafting/gather.ts` (`preSwing`)
- **Pinned by:** `bug fixed: W1, N1, D2 and I2 are water on either layer; the offsets of the cast` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: water drawn only on layer 2 (D2) can be fished` (packages/server/tests/gather.test.ts)

#### Fishing skill-ups do not use the anti-macro allowance
- **Kind:** Bug fixed
- **What you notice:** A tile's fishing allowance is spent only by catches, so earning Fishing skill does not run it down.
- **1.6:** A skill-up took one from the allowance, as a catch did.
- **SSO:** Only a catch spends it. The skill roll still runs only while the allowance lasts.
- **Why:** Getting better at fishing should not cut fishing short.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`castLine`, `ANTI_MACRO_START`)
- **Pinned by:** `bug fixed: only a catch spends the anti-macro counter; the Imp rolls every cast` (packages/shared/tests/crafting/gather.test.ts)

#### Asking about "the treasure" gets an answer
- **Kind:** Bug fixed
- **What you notice:** A line starting with "the treasure" triggers the treasure rumour, like "treasure" and "any treasure".
- **1.6:** The trigger compared the first word with the two words "the treasure", so it could never be true.
- **SSO:** The test checks the first two words.
- **Why:** The trigger was meant to work.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`asksAboutTreasure`)
- **Pinned by:** `bug fixed: the keywords, including a line starting "the treasure"` (packages/shared/tests/crafting/gather.test.ts)

#### The cauldron no longer fizzles on every deposit
- **Kind:** Bug fixed
- **What you notice:** Putting an ingredient in a cauldron that completes nothing just shows the drop line; a completed recipe still says so.
- **1.6:** Every deposit that completed no recipe, even the first ingredient, printed "The cauldron bubbles...but then fizzles out."
- **SSO:** Only a brew prints a cauldron line.
- **Why:** The fizzle read as a failure when nothing had gone wrong.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`depositContainer`); `packages/shared/src/rules/crafting/craft.ts` (`cauldronBrew`)
- **Pinned by:** `bug fixed: a deposit that completes nothing does not fizzle` (packages/server/tests/craft.test.ts)

### economy

#### Trade accept checks the partner's map
- **Kind:** Bug fixed
- **What you notice:** Accept checks whether your trade partner is still on the same map.
- **1.6:** Accept tested the sprite slot after the partner's. With only one other player on screen it always refused with “<name> is no longer in your area, you cannot trade.”
- **SSO:** That line is used only if the partner is no longer on the map; in practice a map change ends the trade first.
- **Why:** The client-slot check made one-on-one trades impossible.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`acceptTrade`, `leaveTrade`)
- **Pinned by:** `bug fixed: an accept checks that the partner is still on your map` (packages/server/tests/npcs-trade.test.ts)

#### Quest chests add their refill, and a Wind Chest takes drops
- **Kind:** Bug fixed
- **What you notice:** Now and then a quest chest gains an item; whatever was already in it stays. Dropping an item while facing a Wind Chest stores it, as with the other chests. Like every placed chest, a quest chest is one container that anyone facing it can use.
- **1.6:** The refill (1 in 4000 per save) overwrote the chest with its one item, wiping what players had left there. The client had no drop route for the Wind Chest, so a drop read "the floor is too crowded".
- **SSO:** The refill item is added when the chest has room and skipped when it is full. The Wind Chest is on the drop routes by exact name. The roll and its odds are unchanged.
- **Why:** A random roll should not destroy what players stored, and one of six chests should not refuse deposits.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`saveClockStep`, `dropRoute`); `packages/shared/src/rules/housing/doors.ts` (`questChestRefill`)
- **Pinned by:** `bug fixed: after 400 frames a 1-in-350 save rolls 1 in 4000; the refill is added to the chest`; `bug fixed: a full quest chest keeps what it holds`; `bug fixed: Drop routes: the six chests by name take items, the Wind Chest too; a bare Crate is crowded` (packages/server/tests/doors.test.ts)

#### A container with something in it cannot be sold
- **Kind:** Bug fixed
- **What you notice:** Selling a Crate, Cabinet or Wind Cabinet that still holds items is refused: the shopkeeper says "Empty that out before you sell it to me." An empty one sells as before, and if you carry several of that kind the empty one goes first.
- **1.6:** The sale removed the bag line but never cleared the stored contents, which stayed unreachable unless a later container happened to roll the same id.
- **SSO:** The sale checks the container's storage first. An empty container's storage row is deleted with the sale.
- **Why:** Selling should never silently destroy what a player stored.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`, `sellName`); `packages/server/src/systems/economy/intents.ts` (`sellIntent`)
- **Pinned by:** `bug fixed: a container with something stored in it is refused, and an empty one is sold first` (packages/server/tests/economy.test.ts); `bug fixed: a container with contents is refused; an empty one sells and its storage row goes` (packages/server/tests/economy-db.test.ts)

#### Every bought container gets its own id
- **Kind:** Bug fixed
- **What you notice:** Buying several Crates, Cabinets, Wind Cabinets or Cauldrons at once gives one bag line per container, each with its own storage. You need an empty bag line for each.
- **1.6:** The purchase added the whole count in one call, so the line got one random id; giving one away left two players sharing the same storage.
- **SSO:** Each container is added on its own line with a fresh id, rolled again if that id is already in storage, in an online bag or earlier in the same purchase.
- **Why:** Separate containers should have separate contents.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`); `packages/shared/src/rules/inventory/inventory.ts` (`invAdd`, `isUniqueContainer`); `packages/server/src/systems/economy/intents.ts` (`buyIntent`)
- **Pinned by:** `bug fixed: each bought container gets its own line and its own unused id` (packages/server/tests/economy.test.ts)

#### A shopkeeper's till starts at 0 without a gold line, and counts anywhere in the file
- **Kind:** Bug fixed
- **What you notice:** The Fire, Water and Wind God books cost their listed price, and the gold goes into the shopkeeper's till. Selling to a shopkeeper pays from its till; one whose till is empty says "<Name> says "I'm sorry but I can't afford to buy that."" and you keep the item. Gold handed to a shopkeeper always goes into its till.
- **1.6:** Only a shopkeeper with a `GLD|` line among its first 80 lines charged or paid: one without gave goods away (after checking you could afford them) and took sold items for nothing. A gift counted only with a `GLD|` line among the first 60 lines.
- **SSO:** No `GLD|` line means a till of 0. Purchases fill it, sales pay from it, and gifts add to it. Once it holds gold, the file the NPC editor loads (and a player shop's rewrite) shows a `GLD|` line. The `GLD|` line counts wherever it is, so the NPC editor no longer warns about its position.
- **Why:** A listed price should be charged, a sale should never take an item for nothing, and the line limits were 1.6 reader windows with no gameplay purpose.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`ledgerFromTemplate`, `npcBuy`, `npcSell`); `packages/server/src/systems/economy/intents.ts` (`giveGoldToNpc`); `packages/shared/src/rules/admin/npcfile.ts` (`liveNpcText`, `checkNpcFile`)
- **Pinned by:** `bug fixed: a shopkeeper with no GLD line charges the price into a till that starts at 0`; `bug fixed: a shopkeeper with no GLD line pays from its till, refusing while it is empty` (packages/server/tests/economy.test.ts); `bug fixed: ledgers: GLD| counts wherever it is, and no GLD| is a till of 0`; `bug fixed: gold given goes into the till wherever GLD| is, or into a till from 0 without one` (packages/server/tests/npcedit.test.ts); `bug fixed: a till filled without a GLD| line shows as one in the live file` (packages/shared/tests/admin/npcfile.test.ts); `bug fixed: the Fire God's book costs its 100 gold, though he keeps no gold line` (packages/server/e2e/npcs-shops-trade.test.ts)

#### Any listed item can be bought, the Fortress Guild Hall Deed included
- **Kind:** Bug fixed
- **What you notice:** The Smithy sells the Fortress Guild Hall Deed. Any item on a shop list can be bought, whatever line of the shop's file it sits on, and buying one item never takes another's stock.
- **1.6:** The buy routine shared one counter between two nested loops, so a non-crystal sale line at file line 17 or later always answered "out of stock" (and stalled the server for up to its stock count), and lines past 80 could not be bought. A match below line 17 jumped ahead, which also stopped a prefix match from taking Trout Fillet's stock.
- **SSO:** The purchase uses the chosen line alone: its price, its stock and its item. The NPC editor no longer warns about sale lines from line 17 or after line 80.
- **Why:** Items a shop lists should be for sale.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`); `packages/shared/src/rules/admin/npcfile.ts` (`checkNpcFile`)
- **Pinned by:** `bug fixed: the Fortress Guild Hall Deed (Smithy line 17) can be bought`; `buying Trout takes only Trout's stock, not Trout Fillet's` (packages/server/tests/economy.test.ts); `warned: inert tags only; no line is outside a reader's window` (packages/shared/tests/admin/npcfile.test.ts)

#### Every purchase and sale is thanked
- **Kind:** Bug fixed
- **What you notice:** Each purchase and each sale gets one "<Name> says "Thanks for the business!"", whether or not the shopkeeper also sells the item.
- **1.6:** The thanks was sent only while walking the shopkeeper's own sale lines, so a sale of an item the shop did not stock got none, and a purchase was never confirmed except by the bag changing.
- **SSO:** One thanks, by name, for every completed purchase or sale.
- **Why:** A trade that went through should say so.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`, `npcSell`, `SHOP_TEXT`)
- **Pinned by:** `bug fixed: a sale to a shopkeeper who does not stock the item is thanked too`; `price × count from the line, charged from GLD into the NPC's gold` (packages/server/tests/economy.test.ts)

#### Selling Trout restocks only Trout
- **Kind:** Bug fixed
- **What you notice:** Selling Trout or Catfish to Akadius, or Swordfish or Squid to Krista or Lir, restocks only that item, with one thanks.
- **1.6:** Every sale line that merely started with the sold item's name was restocked and thanked, so Trout Fillet, Catfish Sandwich, Swordfish Steak and Squid Platter gained stock and the thanks printed twice.
- **SSO:** The sale line for exactly that item is restocked.
- **Why:** Selling one item should not create stock of another.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`)
- **Pinned by:** `bug fixed: selling Trout restocks only Trout and thanks once` (packages/server/tests/economy.test.ts)

#### Shopkeeper refusals name the shopkeeper
- **Kind:** Bug fixed
- **What you notice:** "Sorry but I'm out of that particular item." and "I'm sorry but I can't afford to buy that." start with the shopkeeper's name.
- **1.6:** The name came from an on-screen sprite that was empty in every game screen, so each line began with a blank.
- **SSO:** The server names the shop's NPC.
- **Why:** A line that starts with a gap reads as broken.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`SHOP_TEXT`, `npcBuy`, `npcSell`)
- **Pinned by:** `bug fixed: count over stock names the shopkeeper`; `bug fixed: an NPC whose gold would go negative names itself` (packages/server/tests/economy.test.ts)

#### A full bag has no room for a Pie because it holds an Orc Pot Pie
- **Kind:** Bug fixed
- **What you notice:** Buying an item into a full bag works only when the bag holds a stack of exactly that item; otherwise you read "You don't have enough room in your inventory!" and nothing changes.
- **1.6:** The room test passed when the bag text merely contained the item's name, but the add stacked only on an exact name, so Amber took the stock and the gold went nowhere while no Pie arrived.
- **SSO:** The room test uses the same exact-name rule as the add.
- **Why:** A purchase should either deliver the item or not happen.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `bug fixed: a full bag holding 'Orc Pot Pie' has no room for a 'Pie'; nothing changes` (packages/server/tests/economy.test.ts)

#### The bank says what it did, and why it refused
- **Kind:** Bug fixed
- **What you notice:** A deposit reads "You deposit N gold. You now have M gold in the bank." and a withdrawal "You withdraw N gold. You now have M gold in the bank." Asking for more than you have says "You don't have that much gold to deposit." or "You don't have that much gold in the bank.", and a missing amount shows how to type the command.
- **1.6:** Both failures and a missing amount were silent, and a withdrawal answered with the deposit's line; the withdrawal messages were never sent.
- **SSO:** Each outcome has its own line.
- **Why:** Silence after a command looks like lag or a lost message.
- **In the code:** `packages/server/src/systems/economy/bank.ts` (`runBank`, `BANK_TEXT`); `packages/server/src/systems/economy/intents.ts` (`bankChat`)
- **Pinned by:** `bug fixed: a deposit and a withdrawal each say what they did, and every failure says why` (packages/server/tests/economy.test.ts)

#### The bank needs a living banker
- **Kind:** Bug fixed
- **What you notice:** The bank commands work only while Cril, Andero or another banker is alive on your map; otherwise "You cannot bank here!"
- **1.6:** The check read the roster loaded with the map, which a death did not clear, so the bank worked with the banker dead or never spawned.
- **SSO:** A banker counts while its roster slot has a live NPC.
- **Why:** A dead banker should not keep the bank open.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`canBank`, `bankChat`)
- **Pinned by:** `bug fixed: the bank needs a living banker on the map; else 'You cannot bank here!'` (packages/server/tests/economy.test.ts); `bug fixed: the bank needs a living banker: off the roster, or rostered but not spawned, 'You cannot bank here!'` (packages/server/e2e/npcs-shops-trade.test.ts)

#### Gold given to an NPC reads correctly
- **Kind:** Bug fixed
- **What you notice:** Handing gold to an NPC shows "*** Offering the <n> gold to <Name>." and then `<Name> says "Thanks for the gold!"` with its closing quote.
- **1.6:** The offer line had a double space before "to", and the reply was missing its closing quote.
- **SSO:** Both lines are written as intended.
- **Why:** Typo fixes.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`giveGoldToNpc`); `packages/server/src/systems/monsters/npc.ts` (`NPC_TEXT`)
- **Pinned by:** `bug fixed: the offer line, then 'Thanks for the gold!' with its closing quote; the NPC's GLD grows` (packages/server/tests/npcs-trade.test.ts)

#### Both traders accept, and may change their offers
- **Kind:** Bug fixed
- **What you notice:** Your offer stays editable after you press Trade; press Trade again to change it. Once both offers are in, both players get an Accept button (the partner's sits left of their Trade button). The trade goes through when both have accepted, and both read "The trade is complete." Changing an offer clears both acceptances and tells the partner. Whoever cancels reads "You cancel the trade."
- **1.6:** An offer locked once sent and its Trade button hid. Only the starter had Accept, and the partner agreed only by sending an offer. A completed trade printed nothing, and a partner who cancelled was told nothing.
- **SSO:** The server keeps each side's acceptance, cleared by any change of either offer, and settles on the second. The partner's Accept reuses the original Accept art.
- **Why:** Both players should agree to the final offers, and should be able to fix a mistake without cancelling.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`offerTrade`, `acceptTrade`, `cancelTrade`); `packages/client/src/ui/trade.ts` (`createTradeWindow`)
- **Pinned by:** `bug fixed: A offers, B offers, both accept: one move, and both are told it is complete`; `bug fixed: either side can change its offer, which clears both acceptances`; `bug fixed: Cancel: whoever cancels hears 'You cancel the trade.', the partner 'Trade cancelled.'` (packages/server/tests/npcs-trade.test.ts); `bug fixed: B has an Accept of its own once both offers are in` (packages/client/tests/npcs.test.ts)

#### Withdrawing into a full bag is refused instead of destroying the item
- **Kind:** Bug fixed
- **What you notice:** Taking a Pie out of storage into a full bag that holds an "Orc Pot Pie" reads "You are carrying too much to withdraw this item." and the Pie stays where it was.
- **1.6:** The room test passed on any bag text containing the item's name, but the add needed an exact name, so nothing arrived and the line was still deleted.
- **SSO:** Withdrawal uses the exact-name room rule, and the stored line is removed only once the item is in the bag.
- **Why:** Storage should never destroy an item.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`withdrawVault`); `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)
- **Pinned by:** `bug fixed: withdrawing 'Pie' into a full bag holding 'Orc Pot Pie' is refused and keeps the Pie` (packages/server/tests/economy.test.ts); `bug fixed: withdrawing 'Pie' into a full bag holding 'Orc Pot Pie' is refused and keeps the Pie` (packages/server/tests/craft.test.ts)

#### A vault stays where you opened it
- **Kind:** Bug fixed
- **What you notice:** An open vault or container keeps your keys locked until you press Cancel, so you stay in front of it. While it is open you can Drop items from your bag straight into it, and its list updates. Each take says "You take a <item> out of the container.", and the drop line appears only when the item went in. Changing map closes the window.
- **1.6:** Opening locked the keys and the bag ignored clicks, so nothing could be stored through the window; the first take freed the keys and you could walk off and keep withdrawing from afar. A take printed nothing, and the drop line printed before the capacity check, even when the item was refused.
- **SSO:** Takes leave the window open and the keys locked, so you cannot walk or be shoved; Drop with a window open deposits into it; the server closes the window on a map change. The list is refreshed for everyone viewing it after any deposit or take.
- **Why:** A storage window should work like one, and should not be usable from across the map.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`openVault`, `withdrawVault`, `depositVault`); `packages/server/src/systems/economy/containers.ts` (`depositContainer`, `withdrawContainer`); `packages/server/src/systems/inventory/items.ts` (`dropIntent`); `packages/client/src/app.ts` (`startApp`)
- **Pinned by:** `bug fixed: a withdrawal keeps the window open and the keys locked, says so, and stacks on an exact name`; `bug fixed: deposit checks the capacity before the drop line; containers refused; an open list is refreshed` (packages/server/tests/economy.test.ts); `bug fixed: with a container open, Drop stores into it and everyone with it open sees the item` (packages/server/tests/craft.test.ts); `bug fixed: a take keeps the keys locked, so you cannot walk off with the window open` (packages/server/tests/doors.test.ts); `an open container holds you in place: after a take you still cannot be shoved` (packages/server/tests/craft.test.ts)

#### Removing a player-shop item removes only that item
- **Kind:** Bug fixed
- **What you notice:** "<Shopkeeper> remove Apple" removes the Apple's sale and buy lines and nothing else: Apple Pie, the profile and the gold line stay. A name that is not for sale, such as a single letter, is refused.
- **1.6:** Every non-empty line among the first 30 containing the name was dropped, whatever its kind, and empty lines and lines past 30 were lost. Another item's stock could block the removal.
- **SSO:** The item is matched by its exact name; only its stock decides whether it can go.
- **Why:** One command should change one item.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`removeItem`)
- **Pinned by:** `RemoveItem: not selling, in stock, removed`; `bug fixed: removing Apple leaves Apple Pie and every other line` (packages/shared/tests/economy/playershop.test.ts)

#### Pricing a player-shop item changes only that item
- **Kind:** Bug fixed
- **What you notice:** Setting a price updates that item where it stands in the list, keeping its stock; a new item is added at the end. Setting "Fish" leaves "Fish Sticks" alone, and an owner called Alex can sell Ale.
- **1.6:** Lines 1-30 were rebuilt without every line containing the item's name (the owner line included), the last matching sale line's stock moved to the new line, empty lines and lines past 30 were lost, and a re-priced item moved to the end.
- **SSO:** The item's own sale and buy lines are rewritten in place; every other line stays.
- **Why:** One command should change one item.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`)
- **Pinned by:** `bug fixed: SetPrices touches only the item's own lines; Alex keeps his OWN| line`; `bug fixed: setting Fish leaves Fish Sticks, its stock and its place alone`; `bug fixed: re-pricing keeps the item's stock and its place in the list`; `bug fixed: empty lines and lines past 30 are kept` (packages/shared/tests/economy/playershop.test.ts)

#### A player shop's ten-item limit counts every item
- **Kind:** Bug fixed
- **What you notice:** A player shop sells at most ten items, counted over its whole file; re-pricing an item it already sells is always allowed.
- **1.6:** Only sale lines among the first 30 lines counted, and any sale line starting with the name counted as the same item.
- **SSO:** Every sale line counts, and "already for sale" means exactly that name.
- **Why:** The limit should not depend on where lines sit.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`, `SHOP_MAX_ITEMS`)
- **Pinned by:** `bug fixed: max 10 counts every SEL line in the file; a re-priced item is not new` (packages/shared/tests/economy/playershop.test.ts)

#### The seventh player-shop item can be bought
- **Kind:** Bug fixed
- **What you notice:** All of a player shop's items can be bought, the seventh and later included.
- **1.6:** A new shop's seventh sale line fell on file line 18, past the NPC buy routine's line-17 limit, so it always answered out of stock.
- **SSO:** Purchases use the chosen line wherever it is (see "Any listed item can be bought").
- **Why:** A shop should sell what it lists.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`); `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `the seventh item lands on line 18, where it can be bought` (packages/shared/tests/economy/playershop.test.ts); `bug fixed: the seventh item, on line 18, can be bought` (packages/server/tests/playershop-db.test.ts)

#### Shop commands are not said aloud
- **Kind:** Bug fixed
- **What you notice:** A shop command (set, remove, register, inventory, profile, title) is answered by the shopkeeper without your line being said to the room, and costs no chat cooldown. Like talk, it works only where you can speak in a house (y 10 or less).
- **1.6:** The line was said to the room as ordinary chat first, and the command still ran deeper in the house where talking was refused.
- **SSO:** A recognised command is handled before the line would be said; the house rule applies first.
- **Why:** Running your shop should not broadcast your prices or tills, and should follow the house's talk rule.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`); `packages/server/src/systems/economy/playershop.ts` (`shopCommand`)
- **Pinned by:** `bug fixed: a command is answered without being said aloud; at y > 10 it is refused like talk`; `bug fixed: a command costs no chat cooldown and runs under one` (packages/server/tests/playershop-db.test.ts)

#### A player shop's stock list goes to the owner only
- **Kind:** Bug fixed
- **What you notice:** The inventory command tells the till and each item's stock to the owner alone.
- **1.6:** The stock lines were sent so the owner's client repeated them to the room.
- **SSO:** All the lines go to the owner.
- **Why:** The stock is the owner's business.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`shopStockLines`); `packages/server/src/systems/economy/playershop.ts` (`shopCommand`)
- **Pinned by:** `bug fixed: Inventory tells the till and the stock to the owner alone` (packages/server/tests/playershop-db.test.ts)

#### Player-shop register and stock lines read correctly
- **Kind:** Bug fixed
- **What you notice:** The till line is `<N> says "I have <g> gold in the register..."` with its closing quote, and each stock line reads `<N> says "I have 3 Chunk of Iron in stock."`.
- **1.6:** The till line had no closing quote, and a plain "s" was added to every name unless the stock was 1 ("Chunk of Irons", "Fishs").
- **SSO:** The lines close their quote and name each item as it is.
- **Why:** Typo and grammar fixes.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`SHOP_TEXT`)
- **Pinned by:** `bug fixed: the till line has its closing quote; the stock lines name each item as it is` (packages/shared/tests/economy/playershop.test.ts)

#### Storage on a carried container says what it opened
- **Kind:** Bug fixed
- **What you notice:** Pressing Storage on a carried Crate, Cabinet, Wind Cabinet or Cauldron prints "You open the <kind> to see what's inside...".
- **1.6:** The button built its line only for a Cabinet or a Chest, so a Crate or Cauldron opened silently.
- **SSO:** Every kind gets the line, with its id stripped.
- **Why:** Consistent feedback.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`storageIntent`)
- **Pinned by:** `bug fixed: Storage on a Crate, Cabinet, Wind Cabinet or Cauldron says what it opened` (packages/server/tests/craft.test.ts)

#### Player shops can stock crystals
- **Kind:** Bug fixed
- **What you notice:** "<Shopkeeper> set Blue Crystal=30,15" works for every crystal colour.
- **1.6:** The shop's allow-list names crystals in the singular ("Blue Crystal"), but every bag and NPC holds "<colour> Crystals", so none was ever accepted.
- **SSO:** Crystals are named in the singular, as the list names them (see [Crystals are named in the singular](#crystals-are-named-in-the-singular)).
- **Why:** The list clearly meant to allow crystals.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`onShopWhitelist`)
- **Pinned by:** `set: the whitelist, case ignored, the name as typed` (packages/shared/tests/economy/playershop.test.ts)

#### Crystals come out of storage as themselves
- **Kind:** Bug fixed
- **What you notice:** Withdrawing a Blue Crystal (or any colour) from a vault or container gives back a Blue Crystal.
- **1.6:** A line containing " Crystals" was split on spaces and words 2 and 3 joined, giving a worthless "Crystals " item.
- **SSO:** The stored line is added unchanged.
- **Why:** Storage should return what was stored.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`withdrawVault`); `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)
- **Pinned by:** `bug fixed: a crystal line comes back as the same crystals` (packages/server/tests/economy.test.ts); `bug fixed: a crystal line comes back out of a container as the same crystals` (packages/server/tests/craft.test.ts)

#### Quest replies are heard by the whole map
- **Kind:** Bug fixed
- **What you notice:** Asking for a quest, every NPC's "Bring me a…" reply is heard by everyone on the map, as your question was, and closes its quote; "Sorry but I don't need anything right now." ends with a full stop.
- **1.6:** Slot 1's reply went to the asker alone while slots 2-4 and slot 1's "Sorry…" went to the map, "Bring me a…" had no closing quote, and the "Sorry…" line no full stop.
- **SSO:** Every reply goes to the map, and the texts in `social.json` are complete. An NPC answers only for quest lines that name it exactly.
- **Why:** One rule for every NPC.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`sayQuest`); `packages/server/src/systems/economy/quests.ts` (`askForQuest`)
- **Pinned by:** `bug fixed: every quest reply is heard by the map, closes its quote and ends its sentence` (packages/shared/tests/social/factions.test.ts); `bug fixed: SayQuest: every slot's reply is heard by the map, with its closing quote` (packages/server/tests/factions.test.ts)

#### Quest lines match exactly, and the first match wins
- **Kind:** Bug fixed
- **What you notice:** An NPC takes an item only for a quest line naming exactly that NPC and that item. Giving Stephie a Fish no longer pays her Fishle reward.
- **1.6:** The last of the first 40 lines containing "<NPC>:<item>" won, so any line whose text contained yours could pay.
- **SSO:** The NPC and item fields are compared exactly (case and surrounding spaces ignored), and the first matching line is used.
- **Why:** Quests should want what they say.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questMatch`)
- **Pinned by:** `bug fixed: quest lines match the NPC and item exactly, and the first match wins` (packages/shared/tests/social/factions.test.ts); `bug fixed: Fish given to Stephie is not her Fishle; nothing is taken` (packages/server/tests/factions.test.ts)

#### A quest hand-in leaves your stack names alone
- **Kind:** Bug fixed
- **What you notice:** The item comes off the slot you gave it from, and the reward stacks only on a stack of exactly its name, so no stack is renamed.
- **1.6:** The given item came off the first slot containing its name and that slot was rewritten under the given name (a Gold Fish stack given as Fish became Fish); the reward did the same to the first slot containing its name.
- **SSO:** Taking and stacking use the chosen slot and exact names.
- **Why:** A hand-in should not change other items.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questTake`, `questReward`)
- **Pinned by:** `bug fixed: the item comes off the slot you gave from, which keeps its name`; `bug fixed: the reward stacks on its exact name, keeping the stack's spelling, else the lowest empty slot` (packages/shared/tests/social/factions.test.ts)

#### A quest reward with no room stops the hand-in
- **Kind:** Bug fixed
- **What you notice:** With a full bag and nowhere for the reward, the NPC says `"You have no room in your bag for my reward."` and nothing is taken. Giving the last of a stack frees its slot for the reward.
- **1.6:** The reward overwrote whatever was left of the stack you gave from.
- **SSO:** Room is checked before anything is taken.
- **Why:** A reward should never destroy items.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questRoom`, `questReward`); `packages/server/src/systems/economy/quests.ts` (`questGive`, `QUEST_TEXT`)
- **Pinned by:** `bug fixed: a reward to a full bag has no room unless the given stack empties` (packages/shared/tests/social/factions.test.ts); `bug fixed: a reward with no room is refused and nothing is taken` (packages/server/tests/factions.test.ts)

#### Every new quest names an NPC
- **Kind:** Bug fixed
- **What you notice:** Every quest line has an NPC who will take it; the archive's nameless ":Steel Key:Trumpet" is replaced with a new quest when the server starts.
- **1.6:** The NPC was picked by a 44-way roll in which roll 29 named nobody, writing a line starting with a bare colon that no NPC would answer. A wanted item could carry a trailing space ("Silver Token ").
- **SSO:** The NPC is picked evenly among the 43 named NPCs and item names are trimmed. On load or first seeding, any stored line that names no NPC is rerolled and saved.
- **Why:** A quest nobody can hand in is a dead line.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`findNewQuest`, `questLineUnanswerable`); `packages/server/src/game.ts` (`createGame`)
- **Pinned by:** `bug fixed: FindNewQuest always names an NPC, each named one equally likely` (packages/shared/tests/social/factions.test.ts); `a quest turn-in writes the bag and the rerolled line, which survive a restart` (packages/server/tests/factions-db.test.ts)

#### A shop shows only the OK for the open list
- **Kind:** Bug fixed
- **What you notice:** After a sell list, a buy list shows the buy OK alone, so pressing OK buys.
- **1.6:** The buy and sell lists each showed their own OK and neither hid the other, so a sell OK stayed drawn over a later buy list and answered "Error in trying to sell!".
- **SSO:** A buy or train list shows the buy OK and hides the sell OK; a sell list does the reverse; the vault hides the sell OK.
- **Why:** The OK on screen should act on the list on screen.
- **In the code:** `packages/client/src/ui/shop.ts` (`createShopWindow`)
- **Pinned by:** `divergence: each list shows only its own OK, so a buy list after a sell list buys` (packages/client/tests/npcs.test.ts)

#### Buying and selling in a shop play the cash sound
- **Kind:** Bug fixed
- **What you notice:** A completed purchase or sale plays the cash sound after the OK's click. A refused one plays only the click.
- **1.6:** The cash sound was wired only to messages the server never sent, or to a handler nothing called.
- **SSO:** The server's `processed` reply carries `ok` for a completed buy or sale, and the shop window plays `cash` on channel 4 for it.
- **Why:** A completed deal should be heard.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`buyIntent`, `sellIntent`), `packages/client/src/ui/shop.ts` (`createShopWindow`)
- **Pinned by:** `divergence: a completed buy and sale play cash; a refused one only the OK click` (packages/client/tests/npcs.test.ts); `buying three Apples from Amber, then selling one back, each answered processed ok` (packages/server/e2e/npcs-shops-trade.test.ts)

#### A player shop's till counts anywhere in the file
- **Kind:** Bug fixed
- **What you notice:** `register` and `inventory` find the shop's gold wherever its `GLD|` line sits.
- **1.6:** Both commands read the `GLD|` line only among the file's first 30 lines, while a sale credited it anywhere.
- **SSO:** Both read every `GLD|` line in the file, as the NPC till does. New shop files still put it on line 5. The profile command still reads lines 1–30.
- **Why:** The till a sale pays into should be the till the owner can see and take.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`register`, `shopStockLines`)
- **Pinned by:** `bug fixed: Register pays from a till line past line 30`; `bug fixed: Inventory reports a till line past line 30` (packages/shared/tests/economy/playershop-till.test.ts)

#### Handing in a head takes the head you gave
- **Kind:** Bug fixed
- **What you notice:** Giving a faction leader a head takes it from the bag slot you chose.
- **1.6:** The chosen slot only had to hold a head; one was taken from the first slot that contained one.
- **SSO:** The head comes off the chosen slot.
- **Why:** Players choose what they give.
- **In the code:** `packages/server/src/systems/economy/quests.ts` (`questGive`)
- **Pinned by:** `bug fixed: turn-in takes the head you gave, not the first in the bag` (packages/server/tests/factions.test.ts)

### housing

#### The Small Farm lands where the other houses do
- **Kind:** Bug fixed
- **What you notice:** The Small Farm's ghost and the farm it builds sit in the same place relative to your cursor as the Large House's.
- **1.6:** The step that moves the anchor up a row tested for the misspelt "Small Fam", so the farm kept the hovered row and was drawn and built one row lower.
- **SSO:** Every house anchors one column left and one row up of the hovered tile; the farm's ghost moves up with it.
- **Why:** The misspelling was a typo, not a design.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`houseAnchor`, `ghostRect`)
- **Pinned by:** `bug fixed: the Small Farm anchors one up and one left like every house, its ghost to match` (packages/shared/tests/housing/houses.test.ts)

#### The whole footprint is checked for terrain
- **Kind:** Bug fixed
- **What you notice:** A 5-wide house is refused when any of its 15 tiles is rough ground, not just the left three columns.
- **1.6:** The ground test read a map line whose last two columns came back empty and counted only the first three columns against a fixed pass mark of 9.
- **SSO:** Every footprint tile's layer-1 code must be a build code.
- **Why:** Houses could stand half over water or rock.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `bug fixed: layer 1 is checked on every column of a 5-wide house` (packages/shared/tests/housing/houses.test.ts)

#### Houses can be anchored on rows 8 and 9
- **Kind:** Bug fixed
- **What you notice:** A house can be placed with its top row on row 8 or 9, as the edge rule allows.
- **1.6:** The ground test read rows 10 and 11 by item number from the map record, landing on the NPC and monster fields, which never matched.
- **SSO:** Every footprint row reads the map's own layer 1.
- **Why:** The bottom of every map was unbuildable by accident.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `bug fixed: a house can be anchored on rows 8 and 9; its rows 10 and 11 read the map` (packages/shared/tests/housing/houses.test.ts)

#### 8V counts as house ground
- **Kind:** Bug fixed
- **What you notice:** Ground of type 8V can be built on, like 8R and 8U.
- **1.6:** The ground test was a text match against `*8R*8U*8V` with no closing star, so `*8V*` never matched.
- **SSO:** Each code is compared whole, case ignored.
- **Why:** 8V is listed as house ground; the missing star dropped it.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `bug fixed: 8V counts as house ground like 8R and 8U, matched whole` (packages/shared/tests/housing/houses.test.ts)

#### Only what is on the footprint is in the way
- **Kind:** Bug fixed
- **What you notice:** Items, monsters and players next to the house, and the builder standing beside it, no longer block placement. Something on a footprint tile still does.
- **1.6:** The ghost's bounding rectangle, which sits a pixel or two right of and above the footprint, was tested against item, monster and player sprites, so neighbours and the builder's own sprite counted.
- **SSO:** The server tests the footprint's tiles against the tiles items, monsters (a wide monster's three) and players (and a walker's next tile) stand on.
- **Why:** Placement should match what the ghost covers.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`checkPlacement`, `inFootprint`), `packages/server/src/systems/housing/houses.ts` (`obstacleTiles`)
- **Pinned by:** `bug fixed: only something on the footprint itself is in the way` (packages/shared/tests/housing/houses.test.ts); `bug fixed: standing beside the footprint is not in the way` (packages/server/tests/houses-db.test.ts)

#### A demolished Small Shop takes its street lamp
- **Kind:** Bug fixed
- **What you notice:** When a Small Shop decays, its street lamp goes too.
- **1.6:** The lamp was dropped one row lower than the place recorded for it, and demolition removed by exact match, so it was never found.
- **SSO:** The lamp is recorded where it is dropped. The upgrade moves the lamp in existing shops' records down a row to match.
- **Why:** Demolition should leave nothing of the house behind.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`planHouse`), `packages/server/migrations/20261118_30_house_decay.sql`
- **Pinned by:** `bug fixed: the Small Shop's lamp is recorded where it is dropped, so demolition finds it` (packages/shared/tests/housing/houses.test.ts); `bug fixed: a Small Shop's street lamp goes with it`; `the migration names each list entry's house, gives its month a year and moves the shop lamp` (packages/server/tests/houses-db.test.ts)

#### Decay takes only the stale house, and counts the year
- **Kind:** Bug fixed
- **What you notice:** A house decays on its own; the owner's other houses are judged separately. A house whose owner was last seen in this month a year ago decays.
- **1.6:** The remover matched every list entry with the owner's name, and months were compared with no year.
- **SSO:** Each list entry names its house (by interior) and stores its month with the year (`YYYY-MM`). A house goes once its owner was last seen two or more calendar months ago (`decay.staleAfterMonths`). The upgrade gives existing entries this year, or last year for a month later than this one.
- **Why:** One stale entry should not cost an owner every house, and a year-old visit is not recent.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`sweep`, `monthIndex`), `packages/server/src/systems/housing/houses.ts` (`demolish`)
- **Pinned by:** `bug fixed: a stale house goes alone; the owner's other houses and the year count` (packages/shared/tests/housing/houses.test.ts); `a stale owner's house is demolished by the day's sweep: tiles revert, Exit and mailbox go, the interior is deleted` (packages/server/tests/houses-db.test.ts)

#### The decay sweep's removals stay removed
- **Kind:** Bug fixed
- **What you notice:** After a sweep, the list holds only the houses still standing.
- **1.6:** The sweep looped over an old copy of the list and each removal rewrote the list from that copy, so earlier removals came back as entries for houses that were gone.
- **SSO:** The sweep removes every demolished house's entries at once.
- **Why:** Zombie entries were demolished again on later sweeps.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`sweep`)
- **Pinned by:** `bug fixed: every house the sweep removes stays removed` (packages/shared/tests/housing/houses.test.ts)

#### Each house keeps its own blueprint
- **Kind:** Bug fixed
- **What you notice:** If you own two houses on one map, demolishing them restores the ground under both.
- **1.6:** One blueprint was saved per owner and map, so a second house overwrote the first's.
- **SSO:** Blueprints are keyed by the house's interior. Records already overwritten on an older server cannot be recovered; those houses keep standing.
- **Why:** A lost blueprint left a house that could never be cleared.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`, `demolish`)
- **Pinned by:** `bug fixed: two houses on one map are two entries, judged apart` (packages/shared/tests/housing/houses.test.ts); `bug fixed: two houses by one owner on one map keep a blueprint each, and both are reverted` (packages/server/tests/houses-db.test.ts)

#### House decay sweeps once a day
- **Kind:** Bug fixed
- **What you notice:** Stale houses are removed at the first clock check of each day (in the decay time zone), whoever is online, rather than at random while you play.
- **1.6:** Every date message (twice at login, then about once a minute for each online client) rolled 1 in 50 for a sweep, so busier servers swept far more often.
- **SSO:** Each clock check still refreshes its player's houses, and a login is one check; the sweep runs once per calendar day.
- **Why:** Decay should not depend on how many people are online.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`monthCheck`, `houseClockStep`)
- **Pinned by:** `bug fixed: the sweep runs once a day, not on every clock check`; `an owner's own login refreshes their entries before the sweep` (packages/server/tests/houses-db.test.ts)

#### The dead do not rest
- **Kind:** Bug fixed
- **What you notice:** Resting on a house map (rows 1 to 10) no longer heals you while you are dead.
- **1.6:** The house rest-healing had no death check.
- **SSO:** Rest regeneration skips a player in the death lock.
- **Why:** Healing a corpse made no sense and changed what the respawn restored.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`restRegen`)
- **Pinned by:** `bug fixed: the dead do not rest` (packages/server/tests/houses-db.test.ts)

#### Your own stations are always yours
- **Kind:** Bug fixed
- **What you notice:** Ctrl carries off your own Stove, Anvil or Alchemy Lab, even after a station elsewhere showed its line. A click shows the station's line wherever it stands (see "A click uses a station or casino table; Ctrl carries off your own").
- **1.6:** A click set the "don't pick this up" flag but never cleared it; only Drop reset it.
- **SSO:** Whether you are on your own premises is worked out from the room you are in on every Ctrl.
- **Why:** Whether a station is yours depends on where it stands, not on what you clicked before.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`headDrop`), `packages/server/src/systems/inventory/items.ts` (`actionIntent`)
- **Pinned by:** `a room whose header names you is 0; anywhere else is 1` (packages/shared/tests/housing/houses.test.ts); `bug fixed: a click on your own Anvil shows its line; Ctrl carries it off, even after a refusal elsewhere` (packages/server/tests/houses-db.test.ts)

#### Coloured keys are spent only when they open
- **Kind:** Bug fixed
- **What you notice:** A coloured key is used up when it opens its door; closing the door with it is free. Each turn pauses 100 frames (see [A coloured key pauses like a house key](#a-coloured-key-pauses-like-a-house-key)).
- **1.6:** The key routine spent the key on every use, so one door cost two keys.
- **SSO:** Only an opening turn spends the key.
- **Why:** Doors relock by themselves, so a second key to close one was pure loss.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`keyConsumed`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `bug fixed: a coloured key is spent opening its door, not closing it; Keys.txt has no Inf` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a coloured key is spent opening its door, not closing it; it pauses 100` (packages/server/tests/doors.test.ts)

#### A coloured key pauses like a house key
- **Kind:** Bug fixed
- **What you notice:** After a coloured key (Steel, Emerald, Fire, Gold or Wooden) turns its door, your next item action waits 100 frames (5 seconds), as after a house key or a switch, not 21 seconds.
- **1.6:** A coloured key set a 425-frame pause that the server's reply to the spent key ended one round trip later. A key the server never spends (`:Inf` in `Keys.txt`) got no reply and held you for the full 21 seconds.
- **SSO:** Coloured keys pause `keys.colouredPause` (100), the same as `keys.housePause`.
- **Why:** The 425 frames were a wait for a network reply, not a designed delay; with nothing to end it the pause held your bag for 21 seconds. The 100 frames still stop rapid door flipping.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`keyPause`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `bug fixed: a coloured key is spent opening its door, not closing it; it pauses 100` (packages/server/tests/doors.test.ts)

#### A key or switch changes only what you use it on
- **Kind:** Bug fixed
- **What you notice:** Opening a Steel Door opens that door only; flipping a switch flips that switch only (its switch doors on the map still open or close together). Bob's House Key no longer opens Jimbob's Door.
- **1.6:** Every item on the map whose name contained the old name was renamed.
- **SSO:** A key renames the door you face and a switch renames itself, by item. A switch's doors and the relock still change every door of an exact name.
- **Why:** One door should not unlock a whole map, nor one owner's key another's house.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`renameTargets`, `switchFlip`), `packages/server/src/systems/housing/doors.ts` (`useKey`, `switchClick`, `renameDoors`)
- **Pinned by:** `bug fixed: a map-wide rename matches whole names only` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a key opens only the Steel Door you face`; `bug fixed: Bob's House Key leaves Jimbob's Door alone`; `bug fixed: a switch flips only itself` (packages/server/tests/doors.test.ts)

#### Player and guild doors relock
- **Kind:** Bug fixed
- **What you notice:** A house or guild hall door opened with a key shuts by itself 200 frames after the map's last door change, like coloured and switch doors.
- **1.6:** The close-all routine listed only switch and coloured doors.
- **SSO:** The relock also turns "<owner>'s Opened Door" back into "<owner>'s Door".
- **Why:** An open house door stayed open for anyone until its owner came back.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`closeAllDoors`, `closedName`), `packages/server/src/systems/housing/doors.ts` (`relockStep`)
- **Pinned by:** `bug fixed: CloseAllDoors closes coloured, switch, player and guild doors and ON switches` (packages/shared/tests/housing/doors.test.ts); `bug fixed: player and guild doors relock like the others` (packages/server/tests/doors.test.ts)

#### House and Guild Keys pause after each turn
- **Kind:** Bug fixed
- **What you notice:** After a House Key or Guild Key turns a door you wait 100 frames before the next item action, as after a switch. The key stays in your bag.
- **1.6:** These keys went straight to the door change with no action pause, so a door could be flipped every frame.
- **SSO:** They pause 100 frames (`keys.housePause`) and are still never spent. Being kept is intended: the key is how an owner gets in.
- **Why:** Rapid toggling flooded the map with door changes.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`keyPause`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `bug fixed: House and Guild Keys are kept and pause 100 after each turn` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a House Key pauses 100 after each turn and is kept`; `bug fixed: a Guild Key pauses 100 and is kept` (packages/server/tests/doors.test.ts)

#### A refused switch click changes nothing
- **Kind:** Bug fixed
- **What you notice:** Clicking a switch from across the room gives the "standing in front of it" line and nothing else; the map's doors keep their timing.
- **1.6:** The relock countdown was started at 100 before the adjacency check.
- **SSO:** Nothing is armed until the switch actually flips.
- **Why:** A refused action should not shut other players' doors.
- **In the code:** `packages/server/src/systems/housing/doors.ts` (`switchClick`)
- **Pinned by:** `bug fixed: a refused switch click leaves the relock alone` (packages/server/tests/doors.test.ts)

#### Doors close on their own timer, whoever is on the map
- **Kind:** Bug fixed
- **What you notice:** Doors close 200 frames after they were last changed. Arriving on a map does not change when they close, and doors on a map nobody is on still close on time.
- **1.6:** Loading a map started a 150-frame countdown, and an empty map counted nothing, so its doors stayed open until someone arrived.
- **SSO:** Arrival sets nothing. When a map empties its timer is kept as the tick it falls due; when the map is next loaded the doors close then, or on the first frame if that tick has passed. Doors found open with no timer (after a restart) close on the first frame.
- **Why:** Door timing should not depend on who walks in.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`RELOCK_FRAMES`, `anyOpenDoor`), `packages/server/src/systems/world/world.ts` (`enterRoom`, `leaveRoom`)
- **Pinned by:** `bug fixed: arriving on a map leaves a running relock alone`; `bug fixed: doors on a map nobody is on still close on time` (packages/server/tests/doors.test.ts)

### inventory


#### Nothing is dropped from an airship
- **Kind:** Bug fixed
- **What you notice:** Aboard an airship, dropping gold, crystals or a Pig is refused with the same "from the sky" line as any other item. Aboard a boat or battleship the line is 1.6's "You can't drop this into the ocean!". Giving to a player in front still works.
- **1.6:** The sky test sat after the gold and crystal handling and after the Pig, so those three still fell from the airship.
- **SSO:** The gold and crystal dialogs' drop path and the Pig drop make the same vehicle test as Drop.
- **Why:** The rule is that nothing leaves the bag in the sky; the test was simply in the wrong place.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`, `crystalsIntent`, `goldIntent`)
- **Pinned by:** `bug fixed: aboard an airship items, gold and crystals are all refused 'from the sky'` (packages/server/tests/vehicles.test.ts); `bug fixed: nothing is dropped into the ocean` (packages/server/tests/ships.test.ts); `bug fixed: a pig is refused from an Airship and kept` (packages/server/tests/pigs-orbs-webs.test.ts)

#### Ctrl aboard an airship takes what is in front
- **Kind:** Bug fixed
- **What you notice:** Riding an airship, boat or battleship, Ctrl picks up or uses the item or Pig in front of you, as on foot. With nothing in front, Ctrl unboards.
- **1.6:** Ctrl tested for the airship before anything else and only ever tried to unboard; only a mouse click could pick anything up.
- **SSO:** Ctrl first grabs a Pig or Snow Demon on the faced tile; failing that it uses or takes the item there, and it unboards when there is neither. A monster Ctrl cannot grab does not stop the unboarding, and for a wide monster only its anchor tile counts.
- **Why:** The key did one thing aboard and another on foot for no reason a player could see.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`actionIntent`), `packages/server/src/systems/vehicles/vehicles.ts` (`unboardVehicle`)
- **Pinned by:** `bug fixed: Ctrl aboard an airship takes what is in front, and unboards when nothing is` (packages/server/tests/vehicles.test.ts); `bug fixed: Ctrl aboard takes a Pig in front; any other monster with no item lets Ctrl unboard` (packages/server/tests/vehicles.test.ts)

#### The Experience Platform names the level it checks
- **Kind:** Bug fixed
- **What you notice:** A click or Ctrl on the Experience Platform says "You must be level 21 or higher to pass this platform.", which is what lets you through.
- **1.6:** The text said you must be over 30 hit points, but the gate checked level 21.
- **SSO:** The gate is unchanged and both texts (`clickFixtures` in `houses.json`, `pickup.ctrlTexts` in `item-rules.json`) name the level.
- **Why:** The text sent players after the wrong goal.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`blocksPlayer`, `clickGate`, `ctrlGate`)
- **Pinned by:** `bug fixed: the Experience Platform names the level it checks (21 passes)` (packages/shared/tests/inventory/inventory.test.ts)

#### Ctrl waits while a window holds the keys
- **Kind:** Bug fixed
- **What you notice:** With a window open that holds your keys, such as your mailbox, Ctrl does nothing, so it no longer reopens the open mailbox. Once the window closes, Ctrl works again.
- **1.6:** Ctrl waited only for the item pause and the map load, not the key lock, so it read, opened or picked up behind an open window.
- **SSO:** Ctrl waits on the same key lock as Use, Equip, Drop and the click. The client does not start Ctrl's pause while the keys are held.
- **Why:** The key lock is there to stop actions behind a window; Ctrl slipped past it.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`paused`, `actionIntent`), `packages/client/src/model.ts` (`pressAction`)
- **Pinned by:** `bug fixed: Ctrl does nothing while a window holds the key lock or the map loads`; `bug fixed: Ctrl does not reopen an open mailbox; it opens again once closed` (packages/server/tests/mail-boards.test.ts)

#### A stuffed player keeps the food
- **Kind:** Bug fixed
- **What you notice:** At or above the hunger limit, using food or a potion says only "You're stuffed!" and the item stays in your bag. The bite that fills you up says just its eat line.
- **1.6:** Eating while stuffed gave nothing and still used the item up. "You're stuffed!" also followed the bite that crossed the limit.
- **SSO:** Hunger at or above 35000 refuses the use before any effect; "You're stuffed!" is that refusal's line. A new character starts stuffed, so they eat once their hunger has dropped.
- **Why:** Losing food for nothing was a trap, and the line on the filling bite read as a refusal.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`, `STUFFED`)
- **Pinned by:** `bug fixed: a stuffed player is refused and keeps the food`; `bug fixed: the bite that fills you only says the eat line; "You're stuffed!" is the refusal` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: a stuffed player is refused and keeps the food` (packages/server/tests/inventory.test.ts)

#### Purple Potion says its line once and waits for hunger
- **Kind:** Bug fixed
- **What you notice:** Drinking a Purple Potion prints "The power of argon flows through your body." once. A stuffed player is refused it like any other potion.
- **1.6:** The line was added twice, and the attack boost sat outside the hunger guard, so it worked when stuffed.
- **SSO:** The line is added once, and the boost goes through the same stuffed refusal.
- **Why:** The doubled line was a slip, and one potion ignoring the hunger rule was inconsistent.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`)
- **Pinned by:** `bug fixed: Purple Potion says its line once and is refused when stuffed` (packages/shared/tests/inventory/inventory.test.ts)

#### Holy Water and newspapers stop monsters
- **Kind:** Bug fixed
- **What you notice:** A monster cannot walk onto a tile holding Holy Water or a newspaper stand, as a player cannot.
- **1.6:** The monsters' blocking list left out those two rows that the players' list had.
- **SSO:** Players and monsters share one list (`ground.blocks` in `item-rules.json`).
- **Why:** The two lists were meant to match; the missing rows were an omission.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`blocksMonster`)
- **Pinned by:** `bug fixed: Holy Water and newspapers stop monsters as they stop players` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: a blocking item on the anchor tile aborts a monster's path: a statue, Holy Water, a newspaper stand` (packages/server/tests/inventory.test.ts)

#### A refused Pig stays in the bag
- **Kind:** Bug fixed
- **What you notice:** Dropping a Pig where it cannot stand, including off any edge of the map, says "You can't drop an animal here!" and the Pig stays in your bag.
- **1.6:** The Pig left the bag before the summon checked the tile, so a pig dropped on a tile monsters cannot stand on, or north from the top row, was silently lost. Off the other edges the drop did nothing and said nothing.
- **SSO:** Every test the summon makes runs before the Pig leaves the bag. A blocked tile says the line above; a map whose four monster slots are all live says "It's too crowded to drop any pigs here!".
- **Why:** Losing a pig without a word was never meant.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pigDrop`), `packages/server/src/systems/spells/cast.ts` (`summonPig`)
- **Pinned by:** `bug fixed: a faced tile off the map at the side, bottom or top → "You can't drop an animal here!", the pig kept` (packages/server/tests/pigs-orbs-webs.test.ts)

#### A Pig drops only when other items can
- **Kind:** Bug fixed
- **What you notice:** During the short pause after using an item, or mid-step, a Pig is refused like every other item.
- **1.6:** The Pig test came before the pause, vehicle and mid-step tests, so a Pig dropped when nothing else could.
- **SSO:** The Pig test comes after them.
- **Why:** The order was an accident and let pigs skip the rules every item follows.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`, `pigDrop`)
- **Pinned by:** `bug fixed: a pig waits out the item pause and the step like any other item` (packages/server/tests/pigs-orbs-webs.test.ts)

#### Only the Bo is wielded as a Bo
- **Kind:** Bug fixed
- **What you notice:** Books and the Boat Deed can no longer be equipped. The Bo still goes in the left hand.
- **1.6:** The left-hand rule for the Bo matched any name containing "Bo", so every book and the Boat Deed could be wielded, and a book hit like a bow.
- **SSO:** The rule matches the name "Bo" exactly (`equip.slots` in `item-rules.json`). Bows and boots have their own rules and are unchanged.
- **Why:** The rule was written for one weapon.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`)
- **Pinned by:** `bug fixed: only the Bo itself matches "Bo"; books and the Boat Deed cannot be equipped` (packages/shared/tests/inventory/inventory.test.ts)

#### A Catfish Sandwich cannot be equipped
- **Kind:** Bug fixed
- **What you notice:** A Catfish Sandwich can no longer be wielded in the right hand. Alchemy sands still can.
- **1.6:** The right-hand rule meant for sand matched any name containing " Sand", including "Catfish Sandwich".
- **SSO:** A later rule makes the Catfish Sandwich "No" (`equip.slots` in `item-rules.json`).
- **Why:** Food is not held in the hand.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`)
- **Pinned by:** `bug fixed: a Catfish Sandwich cannot be equipped; alchemy sand still goes in the right hand` (packages/shared/tests/inventory/inventory.test.ts)

#### The Dragon Sword can be wielded
- **Kind:** Bug fixed
- **What you notice:** A Dragon Sword goes in the left hand with Strength 26, hits for 12 plus up to 8, and is drawn with the Fire Sword's art.
- **1.6:** No rule gave the Dragon Sword a slot, attack power or picture, so Equip refused it.
- **SSO:** `item-rules.json` gives it a slot, a strength requirement and a paperdoll alias, `attpower.json` an attack row (the last of its `contains` rows), and `classes.json` a kill skill-gain row (Slash, Thrust, Swordsmanship, Fencing). The Dragon Sword still only appears if an operator hands one out.
- **Why:** An item that exists should be usable for what it is.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`, `strengthRequirement`)
- **Pinned by:** `bug fixed: the Dragon Sword is wielded in the left hand` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: the Dragon Sword and Steel Scimitar train the sword skills` (packages/shared/tests/progression/weapon-skills.test.ts); `bug fixed: the Dragon Sword hits for 12 plus up to 8 and is drawn with the Fire Sword's art` (packages/shared/tests/inventory/inventory.test.ts)

#### "You cannot equip the …" ends with a full stop
- **Kind:** Bug fixed
- **What you notice:** The line for an item that cannot be equipped ends with a full stop.
- **1.6:** The line was built with nothing after the item's name.
- **SSO:** The line ends with ".".
- **Why:** Every other line of its kind has one.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`EQUIP_TEXT`)
- **Pinned by:** `bug fixed: "You cannot equip the ..." ends with a full stop` (packages/shared/tests/inventory/inventory.test.ts)

#### Equipping into a full slot swaps
- **Kind:** Bug fixed
- **What you notice:** Equipping an item into a slot that already holds something swaps them: the worn item goes back into your bag. If the bag has no room for it, you read "You are carrying too much to swap this for what you're wearing!" and nothing changes.
- **1.6:** The server refused with "You have to remove the current item you're wearing to equip this!", so every change of gear took two steps.
- **SSO:** The worn item needs a stack, an empty line, or the line the new item leaves.
- **Why:** The two-step change was friction with no purpose.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`checkEquip`), `packages/server/src/systems/inventory/items.ts` (`equipIntent`)
- **Pinned by:** `bug fixed: an occupied slot is no refusal (the server swaps)` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: equipping into a full slot swaps, the worn item back in the bag`; `bug fixed: a swap needs room for the worn item; a full bag refuses and changes nothing` (packages/server/tests/inventory.test.ts)

#### No key is on the usable list
- **Kind:** Bug fixed
- **What you notice:** Nothing changes in play: a key is used only on a door.
- **1.6:** The five coloured keys were on the usable list, as if they could be eaten like food, but Use sent every key to the door handler first, so those rows were dead.
- **SSO:** The keys are off the usable list (`use.usable` in `item-rules.json`), so the data says what the game does.
- **Why:** A modder reading the list would expect keys to be consumed.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `bug fixed: no key is on the usable list; Use sends a key to the door rule only` (packages/server/tests/doors.test.ts)

#### A full bag takes an item it can stack
- **Kind:** Bug fixed
- **What you notice:** With all 15 bag lines used, a click on a ground item you already carry picks it up onto that stack, as Ctrl does. Receiving a give works the same way.
- **1.6:** The click's bag test overwrote its stack test, so a full bag always looked full to a click and to a give; Ctrl tested correctly.
- **SSO:** Click, Ctrl and a received give share one bag test.
- **Why:** Ctrl and the click disagreed about the same bag.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`bagFull`, `pickupIntent`, `receiveGive`)
- **Pinned by:** `bug fixed: a full bag takes a clicked item it holds a stack of, as Ctrl does` (packages/server/tests/inventory.test.ts); `bug fixed: a full bag receives a given item it holds a stack of` (packages/server/tests/inventory.test.ts)

#### Picking up takes one item
- **Kind:** Bug fixed
- **What you notice:** When identical items lie on one tile, picking one up leaves the others there.
- **1.6:** Pickup cleared every entry with the same name on the tile and granted one, so the rest vanished.
- **SSO:** Pickup removes only the entry taken.
- **Why:** The others were destroyed for nothing.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`grab`)
- **Pinned by:** `bug fixed: picking up takes the one entry and leaves its twins on the tile` (packages/server/tests/inventory.test.ts)

#### Items share a tile
- **Kind:** Bug fixed
- **What you notice:** You can drop an item, gold or crystals onto a tile that already holds ordinary items, up to 10. A tile holding something that stands in the way, such as a Table or a fixture, or one already holding 10 items, is "too crowded". Dropping onto a chest, crate or vault still stores the item in it.
- **1.6:** A player's drop was refused on any tile holding any item, though loot and gathered items landed on occupied tiles.
- **SSO:** A player's drop is refused only on a tile with a blocking item (`ground.blocks`) or 10 items.
- **Why:** Loot already shared tiles; refusing only the player was inconsistent. The cap keeps a tile from becoming a dump.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`tileCrowded`, `TILE_ITEM_CAP`, `dropIntent`, `crystalsIntent`, `goldIntent`)
- **Pinned by:** `bug fixed: items share a tile; a fixture or a full tile is too crowded` (packages/server/tests/inventory.test.ts)

#### A click opens a crate or cabinet; Ctrl carries it
- **Kind:** Bug fixed
- **What you notice:** Clicking a Crate, Cabinet or Wind Cabinet opens it, like a chest. Ctrl picks it up, keeping its contents, if your Strength is 15 for a crate or 19 for a cabinet; otherwise you read "You're not strong enough to pick this up!".
- **1.6:** The click fell through to pickup and never reached the chest-opening code, and Ctrl opened it before its Strength tests, which could never be reached.
- **SSO:** The click opens; Ctrl's Strength tests decide the pickup.
- **Why:** Both paths existed; each was reaching the other's half.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clickGate`, `ctrlGate`)
- **Pinned by:** `bug fixed: a click opens a crate or cabinet; Ctrl picks it up with Strength 15 or 19` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a click opens a Crate on the floor; Ctrl picks it up with its id and contents` (packages/server/tests/doors.test.ts)

#### A click uses a station or casino table; Ctrl carries off your own
- **Kind:** Bug fixed
- **What you notice:** Clicking a Stove, Anvil, Alchemy Lab, Slot Machine, Blackjack Table or Checkers Table always shows its line or plays its game, in your own house too. Ctrl picks one up on your own premises (your house or your guild's hall) and uses it anywhere else.
- **1.6:** In your own house the click picked a station or table up and Ctrl played it; elsewhere Ctrl took a station from anyone's house or the town.
- **SSO:** The click always uses; Ctrl takes only where the room's header names you or your guild. A painting follows the same rule: a click views it and Ctrl takes it.
- **Why:** The same click did opposite things by location, and Ctrl could carry off stations that were not yours.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clickGate`, `ctrlGate`), `packages/server/src/systems/inventory/items.ts` (`actionIntent`)
- **Pinned by:** `bug fixed: a click plays a casino game anywhere; Ctrl carries one off only from your own premises` (packages/shared/tests/casino/casino.test.ts); `bug fixed: a click on an Anvil, Stove or Alchemy Lab shows its line anywhere; Ctrl takes yours` (packages/shared/tests/housing/houses.test.ts); `a click views a painting and Ctrl takes it, as a click uses and Ctrl carries` (packages/shared/tests/inventory/inventory.test.ts)

#### World fixtures are fixed in place
- **Kind:** Bug fixed
- **What you notice:** A fixture the world placed, such as a Copy Machine, Large Rock, Table, Campfire, Piano, statue, "Universal" fixture, painting or platform, cannot be picked up by a click or Ctrl: you read "This is fixed in place; you can't pick it up.". A Table you crafted and dropped can still be carried off. A click on a Piano now says "This is a piano." as Ctrl does.
- **1.6:** Neither pickup path excluded those fixtures, so players could carry off the town's furniture; a click also took the Piano.
- **SSO:** An item placed by the world editor or an administrator's `/drop` that is on the blocking list (`ground.blocks`) or is a platform is fixed in place.
- **Why:** Players could strip shared scenery from the world.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`fixedInPlace`, `clickGate`), `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `actionIntent`)
- **Pinned by:** `bug fixed: a fixture the world placed is fixed in place; a player's own is not` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: a fixture the world placed is not picked up by a click or Ctrl; a player's is` (packages/server/tests/inventory.test.ts)

#### Boots are drawn on your character
- **Kind:** Bug fixed
- **What you notice:** Leather, Chain, Plate and Gold Boots show on your character's feet, for you and for everyone who sees you. With nothing on your feet you walk barefoot, in the same skin colour as your hands, shaded where they meet your trousers.
- **1.6:** The character was drawn from every equipment slot except the feet, and the game had no boot art; every body, the default one and each armour, painted dark shoes on the feet.
- **SSO:** The paperdoll draws the Feet slot over the body. The boot layers are new art in `assets/added/paperdoll/`, made from the default body's feet in each boot's colours; facing north or south a pair has a dark seam between the feet and a lighter cuff. An empty Feet slot draws the `Bare Feet` layer, the same silhouette in skin colour with its top row in the heads' skin shadow, so the feet sit under the trouser hem, over the painted shoes. Gloves are worn in the Ring slot and drawn from it, as before.
- **Why:** Worn boots should be seen.
- **In the code:** `packages/shared/src/rules/inventory/paperdoll.ts` (`normaliseLook`, `paperdollLayers`)
- **Pinned by:** `bug fixed: boots are drawn over the body from the Feet slot; gloves are worn in the Ring slot` and `SSO: with no boots the feet are bare, over whatever shoes the body paints` (packages/shared/tests/inventory/inventory.test.ts); `every frame of the default body has bare feet to cover its painted shoes` (packages/data/tests/assets.test.ts)

#### Crystals are dropped or given by the button you chose
- **Kind:** Bug fixed
- **What you notice:** Drop on crystals asks "Drop how many …?" and drops them on the faced tile even when a player stands there; Give asks "Give how many …?" and hands them to the player in front, or says you must be standing in front of someone. Gold has one button, so it still gives to a player in front and otherwise drops.
- **1.6:** Both buttons opened the same window, whose OK gave whenever a player was in front.
- **SSO:** The crystal request carries the button (`mode`).
- **Why:** Pressing Drop and having the crystals given away ignored the player's choice.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`crystalsIntent`), `packages/client/src/ui/amount.ts` (`crystalTitle`)
- **Pinned by:** `bug fixed: Give on crystals gives them, naming the pile, to the player in front`; `bug fixed: Drop on crystals drops them even facing a player` (packages/server/tests/inventory.test.ts); `crystals keep the last amount; the saved field text is 2` (packages/client/tests/panel.test.ts)

#### Give lines name the gold and crystals
- **Kind:** Bug fixed
- **What you notice:** Giving gold reads "*** Offering the 50 gold to Bob." and Bob reads "Alice is giving you 50 Gold.". Giving crystals reads "*** Offering the 4 Red Crystal to Bob.".
- **1.6:** The gold line named only the amount ("Offering the 50 to Bob"), the crystal line left a blank ("Offering the  to Bob"), and the receiver read "a 50 Gold".
- **SSO:** The lines name the pile, in the wording of the NPC gold line.
- **Why:** The lines did not say what was given.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`GIVE_TEXT`, `receiveGive`)
- **Pinned by:** `bug fixed: give says 'Offering the 50 gold to B.'; B has it at once`; `bug fixed: a gold give says "A is giving you 50 Gold."` (packages/server/tests/inventory.test.ts)

#### A given painting is named without its number
- **Kind:** Bug fixed
- **What you notice:** When someone gives you a painting, you read "Bob is giving you a Painting.", as the giver's line names it.
- **1.6:** The receiver's line used the stored name with its "#" number ("a Painting#12"), while the giver's line stripped it.
- **SSO:** The receiver's line strips the number too.
- **Why:** The number is an internal id.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`receiveGive`)
- **Pinned by:** `bug fixed: a given painting is named without its # number` (packages/server/tests/inventory.test.ts)

#### The amount window's OK always clicks
- **Kind:** Bug fixed
- **What you notice:** OK in the gold and crystal amount window clicks every time you press it, whether you give, drop or are refused.
- **1.6:** The click came only on the drop path, so a give, even a successful one, was silent.
- **SSO:** The window plays the click on every OK press.
- **Why:** A button that clicks only sometimes feels broken.
- **In the code:** `packages/client/src/ui/amount.ts` (`createAmountDialog`)
- **Pinned by:** `bug fixed: OK clicks on every press, give, drop or refusal alike` (packages/client/tests/sound.test.ts)

#### A placed clock goes round once an hour
- **Kind:** Bug fixed
- **What you notice:** A clock's hand points at the minute: a new face every 5 minutes, once round each hour.
- **1.6:** The face table stepped every 3 minutes up to :35 and every 2 after, so the hand went round twice an hour, faster the second time.
- **SSO:** The face is the minute divided by five.
- **Why:** A clock should tell the time.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clockFace`)
- **Pinned by:** `bug fixed: a placed clock's hand goes round once an hour, a face every 5 minutes` (packages/shared/tests/inventory/ground.test.ts)

#### Ctrl on the Mage Master Platform ends the pause
- **Kind:** Bug fixed
- **What you notice:** Ctrl on the Mage Master Platform prints its line and frees you at once, like the other platforms.
- **1.6:** The Mage Master branch exited without ending the 40-frame item pause the others ended.
- **SSO:** Its `pickup.ctrlTexts` row in `item-rules.json` ends the pause.
- **Why:** One platform out of four behaving differently was a slip.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`ctrlGate`)
- **Pinned by:** `bug fixed: Ctrl on the Mage Master Platform says its line and ends the pause like the others` (packages/shared/tests/inventory/ground.test.ts)

#### Ctrl reads a newspaper whatever its owner is called
- **Kind:** Bug fixed
- **What you notice:** Ctrl on "Doorman's Newspaper", or any stand whose owner's name holds "door" or "exit", reads it as a click does.
- **1.6:** Ctrl tested for a door or exit name before a newspaper, so those stands were silent.
- **SSO:** Ctrl tests for a newspaper stand first.
- **Why:** A player's name should not decide whether their paper can be read.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`ctrlGate`)
- **Pinned by:** `bug fixed: Ctrl reads Doorman's Newspaper; the newspaper test comes before door/exit` (packages/shared/tests/mail/art-news.test.ts); `bug fixed: Ctrl reads 'Doorman's Newspaper' as a click does` (packages/server/tests/art-news.test.ts)

#### The × beside an empty Ring box is silent
- **Kind:** Bug fixed
- **What you notice:** Clicking the × beside any empty equipment box, the Ring box included, makes no sound.
- **1.6:** The Ring box's × played the click before testing for an empty slot; the other five tested first.
- **SSO:** Every × exits silently on an empty slot, then clicks after its locks.
- **Why:** The six boxes should behave alike.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `divergence: the empty Ring × is silent like the other boxes, sending nothing` (packages/client/tests/panel.test.ts)

#### Item menu buttons click only when the action goes ahead
- **Kind:** Bug fixed
- **What you notice:** Use, Equip, Drop, Give and the Cook, Mix, Build, Smith and Storage buttons click when their action goes ahead. They are silent under the key lock or the item pause, for Use while the mail compose pane is up, and for a craft button with nothing behind it. Give now clicks like the others.
- **1.6:** Each handler played the click as its first statement, before the key lock, the item pause and every refusal; Give never clicked.
- **SSO:** A button checks the client's own refusal first, then sends the action, and clicks only when the key lock and the item pause allow it. The server still makes its own checks.
- **Why:** The click should confirm an action, not a refusal.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`), `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `divergence: the item menu clicks only past its locks and the client's refusals; Give too` and `divergence: a Use the client refuses makes no click` (packages/client/tests/panel.test.ts)

#### Ctrl takes the top item of a pile, as a click does
- **Kind:** Bug fixed
- **What you notice:** On a tile holding several items, Ctrl takes the one drawn on top, the same one a click takes and the hover tip names first. An item dropped on a map's exit tile can be taken with Ctrl.
- **1.6:** Ctrl acted on the first item in the map's list, the oldest on the tile, while a click took the newest, so the two answered with different items. An exit, the oldest item on its tile, kept Ctrl silent there whatever lay on top of it.
- **SSO:** Ctrl acts on the newest item on the faced tile, passing over an exit unless nothing else is there.
- **Why:** Ctrl and a click on the same pile should take the same item, the one a player can see.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`actionIntent`)
- **Pinned by:** `bug fixed: Ctrl takes the newest item on the faced tile, as a click does, passing over an exit` (packages/server/tests/inventory.test.ts)

#### Click and Ctrl pass over a Ray to the item under it
- **Kind:** Bug fixed
- **What you notice:** An item lying where a Ray or another unnamed marker was placed after it can be clicked or taken with Ctrl, and it is the item the hover tip names.
- **1.6:** A click and (on a tile with no exit) Ctrl acted on the newest thing on the tile. A Ray placed on top of an item answered both with silence, so the item under it could not be picked up while the Ray stayed.
- **SSO:** Click and Ctrl act on the newest item the hover tip names, passing over the markers it never names (`tipless`). On a tile holding only markers they act on the newest, as before.
- **Why:** A marker players cannot see should not hide the item they can.
- **In the code:** `packages/client/src/playfield.ts` (`pickAll`), `packages/server/src/systems/inventory/items.ts` (`actionIntent`), `packages/data/content/item-rules.json` (`tipless`)
- **Pinned by:** `bug fixed: a click passes over a Ray to the item under it` (packages/client/tests/playfield-clicks.test.ts); `bug fixed: Ctrl passes over a Ray to the item under it` (packages/server/tests/inventory.test.ts)

#### Crystals are named in the singular
- **Kind:** Bug fixed
- **What you notice:** Crystals are "Blue Crystal", "Red Crystal" and so on, like every other item: you hold 8 Blue Crystal as you hold 8 Long Sword, and a pile on the ground is "5 Blue Crystal", as gold is "15 Gold". Shops, drops, mining, spells, alchemy and the player-shop list all use the singular. A spell or a bow spends the crystal itself: an item that only has the words in its name is never spent.
- **1.6:** Crystals were the only items with a plural name, "Blue Crystals". Each colour was also listed a second time in the singular, with no picture and nothing that made it: the player-shop list and Coched's shop named the singular, so neither worked. Spells and bows took any bag line containing "<Colour> Cry", and the other crystal checks tested whether a name contained "Crystals".
- **SSO:** The Classic pack keeps one item per colour under the singular name, drawn with the plural's art (`sprite`); the plural spellings stay as archived spellings, so old names still resolve. Every crystal check matches the whole name (`crystalColour`, `crystalPile`). The upgrade renames saved crystals and merges two stacks of a colour into one, and a copy in a spelling it missed still counts as that crystal and picks up singular.
- **Why:** The duplicate singular entries broke the shop list and Coched's shop, and the "contains" checks would spend or protect an item that only mentions a crystal.
- **In the code:** `packages/shared/src/rules/inventory/inventory.ts` (`crystalColour`, `crystalPile`, `pileToItem`), `packages/shared/src/rules/spells/spells.ts` (`crystalLine`), `packages/shared/src/rules/combat/attpower.ts` (`crystalSlotIn`), `packages/server/migrations/20261122_56_singular_crystals.sql`
- **Pinned by:** `bug fixed: crystals are named in the singular and matched by their whole name` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: crystal loading takes the last bag line holding that crystal, by its whole name` (packages/shared/tests/spells/spells.test.ts); `bug fixed: a bow with no arrows, or no crystal for them, is refused before the swing` (packages/shared/tests/combat/combat.test.ts); `bug fixed: the crystals are the six singular items, with their art and the old plurals` (packages/server/tests/classic-pack.test.ts); `bug fixed: /drop 50 Blue Crystal picks up as 50 onto the crystal stack` (packages/server/tests/inventory.test.ts); `bug fixed: singular_crystals renames saved crystals, merges their stacks and is safe to run again on the world` (packages/server/tests/migrations.test.ts)

#### Crystals go into an open vault or container
- **Kind:** Bug fixed
- **What you notice:** With a vault or container window open, Drop on crystals puts them in it, one line per crystal, as many as fit, as Drop does with any other stack; a full vault says so and the rest stay in your bag.
- **1.6:** The open window locked the bag, so nothing could be stored by Drop (see [Drop and Give ask how many of a stack](#drop-and-give-ask-how-many-of-a-stack)). SSO let other items in, but the crystal dialog still dropped on the faced tile, which the vault itself fills, so it said the floor was too crowded.
- **SSO:** The crystal dialog's Drop stores in the open vault or container before it looks at the tile. A vault still holds one item per line.
- **Why:** Storing crystals should work as it does for every other item.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`crystalsIntent`)
- **Pinned by:** `bug fixed: the crystal dialog's Drop stores crystals in an open vault, a line each, as many as fit`; `bug fixed: the crystal dialog's Drop stores crystals in an open container` (packages/server/tests/inventory.test.ts)

#### Items nobody could get, or could only get without a picture, are gone
- **Kind:** Bug fixed
- **What you notice:** Nothing in the Classic pack hands you an item with no picture or asks you for one you could never get. Merius sells nothing; the Gold and Dark Chests no longer refill with the Hammer, Laser Sword or Green Laser Sword; no quest asks for a Damaged Helm, Water Orb or Ocarina or rewards a Scimitar; the cauldron no longer turns a Magic Shield Book and a Small Shield into a Magic Shield item. Copies you already hold of those six items stay and work.
- **1.6:** 47 items had no picture. Some could still be got and showed as a blank: Damaged Armor (Merius), the Scimitar (a quest reward), the Hammer, Laser Sword and Green Laser Sword (quest chest refills), the Magic Shield (a cauldron recipe SSO made work) and Coched's "red crystal". Others could never be got at all, though quests asked for some of them: Dantan's quest and the quest pool wanted a Water Orb, a Damaged Helm or an Ocarina.
- **SSO:** The Classic pack drops every item with no picture and no source, with the rule rows, shop-list entries and quest rolls that named only them: the Crown, the Cyclops, Imp, Lizard and Pig Costumes, the Damaged Helm, Shield and Sword, "Damaged Sword, Knight's" (see [Masterwork rolls are even and the Knight's Sword repairs](#masterwork-rolls-are-even-and-the-knights-sword-repairs)), the Dark Shield and Dark Staff, the Fawn Cap and Ice Cap, the Gold Armor, Boots, Helm and Shield, the Rune Armor, Helm, Shield and Sword, the Red Laser Sword, the White Tiara, the Magic Shield Spell Book, the Poison Dart Book, the duplicate singular crystals, and these three, recorded so they can come back to Classic with art and a source:
  - **The Ocarina.** SSO had made it play a short authored tune to everyone on the map when used (an added sound, ocarina.wav, removed here and kept in the git history), but nobody could get one.
  - **The Earth, Fire, Water and Wind Orbs**, the pieces of the orb war 1.6 never finished (see [Features 1.6 never reached](#features-16-never-reached)).
  - **The Stone Guild Hall Deed.** It had no art, template or builder; SSO's Use said "The Stone Guild Hall cannot be built yet, so this deed can't be used." and kept it (building it is [#10](https://github.com/jberlyn/second-star-online/issues/10)). A deed whose `use` is `nothing` still works that way for an operator's own content.

  Damaged Armor, the Scimitar, the Hammer, the Laser Sword, the Green Laser Sword and the Magic Shield item are retired instead, since players may hold them, and their sources are removed. An NPC shop whose saved ledger still lists a retired item neither shows nor sells it. Items with a picture but no source in the data stay: operators hand them out with their NPCs, monsters, quests and maps. A stored quest line that asks for or gives an item the catalogue no longer has, or has retired, is rolled again at start.
- **Why:** An item you cannot see or cannot get is a 1.6 bug, not part of its feel, and a quest that can never be finished wastes a quest line.
- **In the code:** `packages/data/content/items.json`, `packages/shared/src/rules/economy/quests.ts` (`questLineUnanswerable`), `packages/server/src/game.ts` (`createGame`), `packages/server/src/systems/economy/intents.ts` (`buyIntent`)
- **Pinned by:** `bug fixed: everything content hands out or asks for has a picture and can still be made`; `bug fixed: an item with no picture is drawn by the engine or retired` (packages/server/tests/classic-pack.test.ts); `bug fixed: an NPC shop neither lists nor sells a retired item a saved ledger still holds` (packages/server/tests/ledger-pins-b.test.ts); `bug fixed: no quest asks for or gives an item nobody can get`; `the archive's lines, padded to 40; Dantan's Water Orb line is gone (bug fixed)` (packages/shared/tests/social/factions.test.ts); `bug fixed: the Stone Guild Hall Deed is not in the Classic pack (no art, no source)` (packages/shared/tests/housing/houses.test.ts); `bug fixed: the Ocarina, which nobody could get, is not in the Classic pack, nor its tune` (packages/server/tests/art-news.test.ts)

### mail

#### A mail pane's Close keeps you still while the list is up
- **Kind:** Bug fixed
- **What you notice:** Closing the compose or read pane, or sending a message, leaves the mail list on screen and your character standing still. Closing the list lets you walk again.
- **1.6:** The pane's CLOSE, and a send, cleared the input lock while the list stayed on screen.
- **SSO:** The keys stay locked for as long as the list is up; only the list's CLOSE unlocks them.
- **Why:** Walking with the mailbox list still open left a window behind that no longer belonged to where you stood.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailUiIntent`, `mailSend`), `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `bug fixed: composeClose keeps the lock with the list up; close unlocks and takes it down`, `bug fixed: a send keeps the keys locked while the list is up` (packages/server/tests/mail-boards.test.ts); `bug fixed: either pane's CLOSE hides both panes; the list and the lock stay up`, `bug fixed: SEND waits for mailSent; then the line, cleared and hidden, still locked` (packages/client/tests/mail-boards.test.ts)

#### A reply adds "Re: " once
- **Kind:** Bug fixed
- **What you notice:** Replying to a message whose subject already starts "Re: " keeps the subject as it is.
- **1.6:** "Re: " went in front of the subject every time, so replies stacked "Re: Re: ".
- **SSO:** "Re: " is added only when the subject does not already start with it, ignoring case.
- **Why:** Stacked prefixes pushed the real subject out of the list column.
- **In the code:** `packages/shared/src/rules/mail/mail.ts` (`replySubject`)
- **Pinned by:** `bug fixed: replySubject adds Re: once` (packages/shared/tests/mail/mail-boards.test.ts); `bug fixed: REPLY locks, answers the sender and adds Re: only once` (packages/client/tests/mail-boards.test.ts)

#### Mail goes once to each name, to at most 7 people
- **Kind:** Bug fixed
- **What you notice:** A name typed twice gets one copy. Addressing more than 7 different people says "*** A message can go to at most 7 people." and sends nothing, keeping your draft. "*** Sending Mail..." prints for every send that goes through.
- **1.6:** The send read items 1 to 7 of the To field, so extra names were dropped unseen, a repeated name got two copies, and the line printed only when item 1 was filled.
- **SSO:** The non-empty names are taken once each, ignoring case; more than 7 is refused with a line on the client and the server.
- **Why:** Silently dropping recipients and duplicating mail confused senders.
- **In the code:** `packages/shared/src/rules/mail/mail.ts` (`mailRecipients`), `packages/server/src/systems/mail/mail.ts` (`mailSend`), `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `bug fixed: more than seven different names is too many`, `bug fixed: a repeated name counts once, ignoring case` (packages/shared/tests/mail/mail-boards.test.ts); `bug fixed: a repeated name gets one copy; more than 7 names is refused with a line` (packages/server/tests/mail-boards.test.ts); `bug fixed: a To with no item 1 sends and prints the line`, `bug fixed: more than 7 names says so and sends nothing; repeats count once` (packages/client/tests/mail-boards.test.ts)

#### Every space and star leaves a mail's To field
- **Kind:** Bug fixed
- **What you notice:** Spaces and stars are removed from the To field however many there are in a row.
- **1.6:** The strip deleted while stepping forward, which skipped the next character, so runs of four or more left one behind.
- **SSO:** Every space and star is removed.
- **Why:** A leftover space or star made a name match nobody.
- **In the code:** `packages/shared/src/rules/mail/mail.ts` (`stripMailTo`)
- **Pinned by:** `bug fixed: long runs of spaces and stars are removed completely` (packages/shared/tests/mail/mail-boards.test.ts); `bug fixed: every space and star is stripped from To` (packages/server/tests/mail-boards.test.ts)

#### A board post shows on the open board
- **Kind:** Bug fixed
- **What you notice:** Press Post and the board stays open, reloaded with your post at the end and scrolled to it, and the post field emptied.
- **1.6:** Post hid the window and sent the post with nothing reloaded, so you saw your post only on the next open.
- **SSO:** The server answers a post with the reloaded board.
- **Why:** Players could not tell whether a post had gone through.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`), `packages/client/src/ui/board.ts` (`createBoardWindow`)
- **Pinned by:** `bug fixed: a post is appended in 1.6's format and the open board reloads with it` (packages/server/tests/mail-boards.test.ts); `bug fixed: Post keeps the lock; the server's reload shows the post, scrolled to it` (packages/client/tests/mail-boards.test.ts); `Alice, away from Town Square's board, hears the position line; in front her post reloads it` (packages/server/e2e/mail-and-boards.test.ts)

#### A refused board post keeps your keys locked
- **Kind:** Bug fixed
- **What you notice:** Press Post with nothing to post and you get the alert with the board still open and your character still standing in front of it.
- **1.6:** Post cleared the input lock before checking the text.
- **SSO:** A post does not touch the lock; only Close frees the keys.
- **Why:** You could walk away from a board that was still open.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`), `packages/client/src/ui/board.ts` (`createBoardWindow`)
- **Pinned by:** `bug fixed: a refused post (no letter or digit) alerts and keeps the keys locked` (packages/server/tests/mail-boards.test.ts)

#### A map change closes the message board
- **Kind:** Bug fixed
- **What you notice:** Leaving the map with a board open closes it, and nothing more can be posted to it.
- **1.6:** The board was hidden only on game entry, so it stayed open on the next map and a post went to the last board opened.
- **SSO:** Entering a map forgets the open board on the server and closes its window on the client.
- **Why:** A board read on one map could be posted to from anywhere.
- **In the code:** `packages/server/src/systems/world/world.ts` (`enterRoom`), `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`)
- **Pinned by:** `bug fixed: a map change closes the board` (packages/server/tests/mail-boards.test.ts)

#### A guild board opens for its members, in front of it
- **Kind:** Bug fixed
- **What you notice:** A hall's board opens only when you stand in front of it, facing it, and belong to its guild; it then locks your keys like Town Square's. Others hear "You see the message board, but you must be standing in front of it to read it." or "Only members of this guild can read its board."
- **1.6:** The board tested only that you stood in rows 1 to 7 of whatever map you were on, never your guild, and did not lock the keys.
- **SSO:** The server tests the tile in front, then membership of the guild named on the board (`The <guild>'s Board`), and locks the keys.
- **Why:** Anyone could read a guild's board from the top of any map.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardOpen`), `packages/shared/src/rules/mail/mail.ts` (`boardMember`, `standingInFront`)
- **Pinned by:** `bug fixed: a hall's board opens for its members from in front, locks, pause 4`, `bug fixed: a hall's board is refused to a non-member and from away` (packages/server/tests/mail-boards.test.ts); `bug fixed: a hall's board belongs to its guild's members` (packages/shared/tests/mail/mail-boards.test.ts); `the Knights' board: Carol is refused from away, King until he joins; then it locks and posts` (packages/server/e2e/mail-and-boards.test.ts)

#### Town Square's board opens from in front of it
- **Kind:** Bug fixed
- **What you notice:** Clicking the Town Square board opens it only when you stand in front of it, facing it, as Ctrl already needed. From elsewhere you hear "You see the message board, but you must be standing in front of it to read it."
- **1.6:** The click had no distance or facing test.
- **SSO:** The click and Ctrl share the in-front test.
- **Why:** The board opened, and locked your keys, from across the map.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardOpen`)
- **Pinned by:** `bug fixed: Town Square by click needs you in front: locks, no pause` (packages/server/tests/mail-boards.test.ts)

#### Pure white paints with the brushes
- **Kind:** Bug fixed
- **What you notice:** With pure white picked, all four brushes paint white.
- **1.6:** The brush was drawn as a white shape with white treated as transparent, so white left no mark.
- **SSO:** Every colour blends in the same way, white included.
- **Why:** There was no way to paint white highlights except Fill.
- **In the code:** `packages/shared/src/rules/mail/paint.ts` (`paintAt`)
- **Pinned by:** `bug fixed: pure white paints with every brush` (packages/shared/tests/mail/art-news.test.ts)

#### A Canvas is spent when the painting is saved
- **Kind:** Bug fixed
- **What you notice:** Using a Canvas opens the paint screen and leaves the Canvas in your bag. Cancel keeps your picture, and the next Canvas reopens it; Save takes one Canvas.
- **1.6:** Use removed the Canvas before you painted; a cancel then kept the picture, and the next Canvas reopened it without being removed.
- **SSO:** The Canvas leaves the bag only when a painting is saved, so a cancel costs nothing and no reopen is free.
- **Why:** Which Canvas was spent depended on whether you had cancelled.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`useCanvas`, `artSaveIntent`)
- **Pinned by:** `bug fixed: Use keeps the Canvas and opens the paint screen under the lock`, `bug fixed: a cancel costs no Canvas; the picture reopens and the save spends one`, `bug fixed: a save with no Canvas left in the bag is ignored` (packages/server/tests/art-news.test.ts)

#### A Film is spent when the photo is saved
- **Kind:** Bug fixed
- **What you notice:** Using a Film shows the lens and leaves the Film in your bag. Cancelling the shot with a bag click, or shooting with a full bag, keeps it; a saved photo takes one Film. Using a Film sets no item-action pause, so your bag works at once.
- **1.6:** Use removed the Film before the shot, so a cancelled or refused photo lost it. Use also set a 425-frame pause that the server's reply to the spent Film ended one round trip later.
- **SSO:** The Film leaves the bag only when a photo is saved. With no reply to end it, the 425-frame pause would have held the bag for 21 seconds, so Use on a Film sets none.
- **Why:** Players lost film for photos they never got.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`useFilm`, `artSaveIntent`)
- **Pinned by:** `bug fixed: with a Camera ('camera' passes) the Film is kept, the lens appears, no pause`, `bug fixed: using a second Film spends nothing; one saved photo spends one Film`, `bug fixed: a full bag refuses the photo and keeps the Film` (packages/server/tests/art-news.test.ts)

#### A viewed painting stays out of your canvas
- **Kind:** Bug fixed
- **What you notice:** Viewing a painting and then reopening a cancelled canvas shows your own picture, not the one you viewed. An item with no stored picture shows an empty viewer.
- **1.6:** The viewer and the canvas shared one image, so a viewed painting reopened in the canvas and Save stored it under your name.
- **SSO:** The viewer has an image of its own.
- **Why:** It let a player claim someone else's painting as their own.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `bug fixed: a cancelled canvas reopens on your own picture, not a viewed painting`, `bug fixed: a viewed item with no picture shows none, not the last one viewed` (packages/client/tests/art-news.test.ts)

#### Paintings and photos on the ground are viewed from in front
- **Kind:** Bug fixed
- **What you notice:** Clicking a painting or photo on the ground opens it only when you stand in front of it, facing it. From elsewhere you hear "You see the Painting, but you must be standing in front of it to view it." (or "the photo").
- **1.6:** The click had no distance, facing or adjacency test.
- **SSO:** The server tests the tile in front before opening the viewer.
- **Why:** Art across the map opened and locked your keys.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`viewArt`), `packages/server/src/systems/inventory/items.ts` (`pickupIntent`)
- **Pinned by:** `bug fixed: a ground click views only from in front, and clears the pause` (packages/server/tests/art-news.test.ts)

#### Newspapers are read from in front of the stand
- **Kind:** Bug fixed
- **What you notice:** Clicking a newspaper stand opens the paper only when you stand in front of it, facing it. From elsewhere you hear "You see the newspaper, but you must be standing in front of it to read it."
- **1.6:** The click had no distance or facing test.
- **SSO:** The click and Ctrl share the in-front test.
- **Why:** A stand anywhere on the map could be read.
- **In the code:** `packages/server/src/systems/mail/newspapers.ts` (`readNewspaper`)
- **Pinned by:** `bug fixed: a click from away is refused with the line and pause 4`, `a click from in front reads: the line, pause 4, the fields, null for a missing or non-numeric photo` (packages/server/tests/art-news.test.ts)

#### Players write their own newspaper
- **Kind:** Bug fixed
- **What you notice:** Game > Edit Newspaper opens the editor for every player. What you save is what your stand (`<you>'s Newspaper`) shows.
- **1.6:** Only an immortal's menu opened the editor, so a player's stand from a Newspaper Kit was always blank.
- **SSO:** Edit Newspaper sits on the Game menu, and the server loads and saves the player's own paper.
- **Why:** The Newspaper Kit was useless to the players who bought it.
- **In the code:** `packages/server/src/systems/mail/newspapers.ts` (`newspaperLoadIntent`, `newspaperSaveIntent`), `packages/client/src/ui/gamemenu.ts` (`desktopMenus`)
- **Pinned by:** `bug fixed: a player saves to their own paper, loads it, and their stand shows it` (packages/server/tests/art-news.test.ts); `the Game and Chat items: Open Friend's List, Send Instant Message, Edit Newspaper, the four rooms, Clear Chat Text` (packages/client/tests/npceditor.test.ts)

#### Closing the mail list closes its panes
- **Kind:** Bug fixed
- **What you notice:** Closing the mail list with the compose or read pane open closes those panes too. The Use button keeps working, and the next mailbox opens on the list alone.
- **1.6:** The list's CLOSE kept the panes' flags on. The Use button quietly exited while the compose flag was on, and the panes came back at the next open.
- **SSO:** The list's CLOSE clears both panes' flags and the draft.
- **Why:** A closed mailbox should leave nothing behind.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `divergence: list CLOSE closes both panes and drops the draft; reopen shows the list alone` (packages/client/tests/mail-boards.test.ts)

#### Deleting a message clears the selection and its read pane
- **Kind:** Bug fixed
- **What you notice:** After DELETE, no line is selected, so a second DELETE removes nothing until you pick another message. A read pane showing the deleted message closes.
- **1.6:** DELETE rebuilt the list without clearing the selection or the read pane, so a second DELETE removed the next message.
- **SSO:** DELETE clears the selection, and closes the read pane when it shows the deleted message. A read pane showing another message stays.
- **Why:** One DELETE should remove one message.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `divergence: DELETE clears the selection and closes the read pane showing that message` (packages/client/tests/mail-boards.test.ts)

#### WRITE starts an empty draft
- **Kind:** Bug fixed
- **What you notice:** Pressing WRITE opens an empty compose pane. While the pane is already open, WRITE keeps what is in it, and a send the server refuses also keeps it.
- **1.6:** The three fields were cleared only by a send, so WRITE showed whatever was left from before.
- **SSO:** WRITE clears the fields when the compose pane is not already up. Closing the list also drops the draft.
- **Why:** A new message should start blank.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `divergence: WRITE starts an empty draft; a second WRITE keeps the open one` and `a refused send (no mailSent) keeps the draft with the compose open` (packages/client/tests/mail-boards.test.ts)

#### The read pane labels the sender FROM:
- **Kind:** Bug fixed
- **What you notice:** When you read a message, the sender's name sits on a line labelled FROM:.
- **1.6:** The read pane reused the compose pane's art, so the sender sat under its TO: label.
- **SSO:** A patch of the pane's purple with FROM: in white outlined capitals covers the art's TO:.
- **Why:** The label should name what the line shows.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`), `packages/client/src/styles.css` (`.mail-read-label`)
- **Pinned by:** `READ with nothing selected does nothing; with a line it fills the read pane` (packages/client/tests/mail-boards.test.ts)

#### The mail list scrolls
- **Kind:** Bug fixed
- **What you notice:** The Subject column has a scroll bar and the From column scrolls with it, so all of a full mailbox can be reached.
- **1.6:** The columns were fixed boxes with no scroll bar, so only about 20 of up to 50 messages could be seen.
- **SSO:** Both 271-pixel columns scroll; Subject shows a thin bar and From follows it line for line.
- **Why:** Every stored message should be reachable without deleting the ones above it.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`), `packages/client/src/styles.css` (`.mail-lines`)
- **Pinned by:** `divergence: the 271-px list columns scroll, the From column following the Subject bar` (packages/client/tests/mail-boards.test.ts)

#### The mail list leaves the chat entry usable
- **Kind:** Bug fixed
- **What you notice:** With the mail list up you can still click into the chat entry box.
- **1.6:** A blocker (Internal #203, channel 366) covered the chat entry while the list was up.
- **SSO:** No blocker is drawn.
- **Why:** Reading mail should not stop you chatting.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`), `packages/client/src/ui/shells.ts` (`createGameView`)
- **Pinned by:** `divergence: with every pane up, nothing in the mail screen reaches the chat entry` (packages/client/tests/mail-boards.test.ts); `divergence: the stage places the mail and board at their rects, and nothing blocks the chat entry` (packages/client/tests/shells.test.ts)

#### A photo leaves a cancelled painting alone
- **Kind:** Bug fixed
- **What you notice:** Cancel a painting, take a photo, and the next Canvas still reopens your painting.
- **1.6:** The photo was written into the same image a cancelled canvas keeps.
- **SSO:** A photo is cropped into an image of its own and saved from there. A viewed painting has an image of its own too (see [A viewed painting stays out of your canvas](#a-viewed-painting-stays-out-of-your-canvas)).
- **Why:** Taking a photo should not destroy unrelated work.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `divergence: a photo leaves a cancelled painting alone` and `a good shot hides the lens, redraws, crops 64×64 around the tap and saves a photo` (packages/client/tests/art-news.test.ts)

#### A painting in the viewer cannot be painted on
- **Kind:** Bug fixed
- **What you notice:** Holding the mouse down on a painting you are viewing does nothing to it.
- **1.6:** The viewer's picture kept the paint screen's paint behaviour, so the current tool painted on it.
- **SSO:** The viewer's picture takes no pointer input; a mouse release anywhere still closes the viewer.
- **Why:** Viewing should not change the picture.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `divergence: a pointer down on the viewed image paints nothing` (packages/client/tests/art-news.test.ts)

#### The colour picker reads only the palette and the painting
- **Kind:** Bug fixed
- **What you notice:** The held picker takes a colour from the palette strip, the preview or the large painting. Dragged over the tools, the frame or anything else, it keeps the current colour.
- **1.6:** The picker read the colour straight from the screen, wherever the pointer was.
- **SSO:** The picker reads the art inside the palette strip's border (stage 132-230 × 328-355), or the painting's pixel under the preview or the 4× image, and nothing else.
- **Why:** Picking a colour should not pick up the screen's decoration.
- **In the code:** `packages/client/src/ui/paint.ts` (`PAINT_RECTS`, `createPaintUi`)
- **Pinned by:** `divergence: the colour pick reads only the palette strip, the preview and the 4× image` (packages/client/tests/art-news.test.ts)

### monsters

#### A monster with only loot lines opens no window
- **Kind:** Bug fixed
- **What you notice:** Clicking a monster such as a Slime does nothing, and your keys stay free.
- **1.6:** The click only checked that the monster had an NPC file, and a Slime's loot lines counted, so it opened an empty window titled with its name, with no buttons, that held your keys until you closed it.
- **SSO:** The Bio opens only when the file has bio or profile lines, or a shop or trainer.
- **Why:** The empty window had nothing in it and only locked the player in place.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`, `hasBio`)
- **Pinned by:** `bug fixed: a Slime's loot-only file opens no window and leaves the keys free` (packages/server/tests/npcs-trade.test.ts)

#### Every roster slot waits after planning a walk
- **Kind:** Bug fixed
- **What you notice:** The monster in the second roster slot waits a moment after each walk is planned, like the others.
- **1.6:** After a walk was planned, slots 1, 3 and 4 waited 30 frames before they could be picked again and slot 2 waited 0. It showed when no step of the walk could start, or a step stopped on an item.
- **SSO:** Every slot waits 30 frames.
- **Why:** One slot moving more often than the others was a slip in a per-slot copy of the same code.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`moverPass`)
- **Pinned by:** `bug fixed: every slot waits 30 after authoring when no step can start` (packages/server/tests/monsters.test.ts)

#### Every sea creature spawns at sea
- **Kind:** Bug fixed
- **What you notice:** Merius, Krommie, Jelstar, Mellanie and Minmaye appear in the sea and swim, like the Squid, Shark and Mizella.
- **1.6:** A misspelt name in the spawn check made those five use the land spawn rules, while their movement treated them as sea creatures, so they appeared on dry land and never took a step.
- **SSO:** Spawning and movement read one list, `rules.sea` in `monsters.json`, so a sea creature needs water for both.
- **Why:** A sea creature stranded on land was a typo, not a design.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`refusesTile`), `packages/server/src/systems/monsters/ai.ts` (`nextStep`)
- **Pinned by:** `bug fixed: every sea creature spawns only on water` (packages/server/tests/monsters.test.ts)

#### Big monsters never spawn inside walls
- **Kind:** Bug fixed
- **What you notice:** An Overlord or Mutant Worm near the right or bottom edge of a screen no longer appears overlapping a wall.
- **1.6:** When the chosen tile was past column 12 or row 9, the spawn check said "fine" before it checked the 3 by 2 tiles a big monster covers.
- **SSO:** The footprint is checked wherever the monster lands. A footprint cell off the screen still never refuses, as when it walks.
- **Why:** The early exit skipped a check the code plainly meant to make.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`refusesTile`)
- **Pinned by:** `bug fixed: the footprint test runs wherever the anchor is` (packages/server/tests/monsters.test.ts)

#### Monsters never spawn on crafting stations or other blocking items
- **Kind:** Bug fixed
- **What you notice:** A monster no longer appears standing on an Anvil, Carpentry Bench, Stove, Alchemy Lab, statue, door, chest or any other item that stops walkers. Ordinary items on the ground, players and other monsters still do not stop a spawn.
- **1.6:** The spawn check looked only at the map's tiles, so a monster could appear on top of a blocking item that it could not have walked onto. Standing there, it covered the station a player had to face to craft.
- **SSO:** A spawn tile is refused when it, or any tile a 3 by 2 monster covers, holds an item on the `ground.blocks` list in `item-rules.json`, the same list that stops monsters walking.
- **Why:** A monster should not appear where it could never walk, and one standing on a station blocked crafting until someone killed it.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`refusesTile`)
- **Pinned by:** `bug fixed: no monster spawns on a blocking item such as a crafting station` (packages/server/tests/monsters.test.ts)

#### A failed roll for an NPC skips only its own slot
- **Kind:** Bug fixed
- **What you notice:** When a screen's spawner rolls for an NPC and the extra roll fails, the other empty slots still get their turn.
- **1.6:** A failed roll for a monster on the NPC list left the spawn routine altogether, skipping the later slots that frame.
- **SSO:** The failed slot is skipped and the pass goes on.
- **Why:** The extra roll was meant to make NPCs rare, not to hold back every other monster.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`)
- **Pinned by:** `bug fixed: a failed NPC roll skips only its own slot` (packages/server/tests/monsters.test.ts)

#### Every species has hit points
- **Kind:** Bug fixed
- **What you notice:** Shopkeepers, Gods and the other NPCs that 1.6 gave no hit points arrive with 1, so any hit that lands kills them, as it usually did in 1.6.
- **1.6:** The spawn code's hit point table listed only the monsters and a few NPCs (the Officer, Angela, Trianus and Corin among them); any other species kept what the slot held before. In SSO that was the hit points the slot's last monster died with (below zero), or 0, so the first hit killed them.
- **SSO:** Every species row in `monsters.json` must have an `hp`; the rows 1.6's table missed have 1. A name not in the data at all starts with 1 too (`DEFAULT_HP`), and so does a player shop's new shopkeeper, which 1.6's NPC creator gave 128. The slot no longer keeps the last occupant's hit points, and the `last_hp` column is dropped.
- **Why:** A monster that arrives already below zero, or with a dead monster's leftovers, was never meant.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnHp`, `DEFAULT_HP`), `packages/shared/src/rules/economy/playershop.ts` (`SHOPKEEPER`), `packages/server/migrations/20261118_31_drop_last_hp.sql`
- **Pinned by:** `bug fixed: every species has hit points; 1.6's unlisted ones and unknown names get 1` (packages/server/tests/monsters.test.ts); `a Small Shop's build writes its shopkeeper: file, owner and roster slot 1 at (10, 4) with 1 HP` (packages/server/tests/playershop-db.test.ts); `bug fixed: a slot's new monster starts at its species' hit points, not the last occupant's` (packages/server/tests/monsters.test.ts)

#### Hostile monsters are listed by name
- **Kind:** Bug fixed
- **What you notice:** A Dragon still walks toward players, and now so does the Overlord.
- **1.6:** The check asked whether the hostile list contained the monster's name as text, not whether the name was an entry: a Dragon walked toward players because "Dragon" is inside "Dragon Hatchling", while the Overlord, on no list, just wandered.
- **SSO:** A monster leans toward players when its name is a whole entry of the World Editor's monster list, ignoring case, or matches the new `rules.hostile` list in `monsters.json`, which holds Dragon and Overlord. The other uses of that list (quests, treasure rumours, shop names) still test by text, as before.
- **Why:** Hostility decided by an accident of spelling left the Overlord, the evil a kill broadcast celebrates, wandering harmlessly.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`leansToward`)
- **Pinned by:** `bug fixed: the hostile list is matched by whole entries; Dragon and Overlord lean by rule` (packages/server/tests/monsters.test.ts)

#### Crowded screens keep the monsters' pauses
- **Kind:** Bug fixed
- **What you notice:** On a screen with nine or more players monsters still stop between walks, as they do with eight.
- **1.6:** The chance that a monster was picked to plan a walk got steadily rarer from 1 to 8 players (a pick every 30 to 600 frames), then at the 9th player jumped back to one every 50 frames, so on a crowded screen monsters moved almost all the time.
- **SSO:** From the 8th player on it stays at one in 600 for each player's roll.
- **Why:** The ladder exists to keep a screen's total movement steady as players join; the drop at the 9th was a missing rung.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`moveLadder`)
- **Pinned by:** `bug fixed: ladders: spawn 80…1300 by players, move 30…600 and 600 from the 8th on` (packages/server/tests/monsters.test.ts)

#### A hostile monster follows the player it chases
- **Kind:** Bug fixed
- **What you notice:** A hostile monster walking toward you turns to follow when you move, instead of heading for where you stood when it set off.
- **1.6:** The whole path was worked out when the walk was planned, aimed at where the player whose game started it stood at that moment.
- **SSO:** The walk records the player and the number of steps; each step leans toward where that player stands as the step starts. If they leave the map the walk ends.
- **Why:** A chase that ignores its target's moves only looked like a chase while the player stood still.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`authorPath`, `leanDir`, `nextStep`)
- **Pinned by:** `bug fixed: each chase step aims at where its player stands now`, `a hostile walk leans toward the author by pixel position`, `a chase ends when its player leaves the map` (packages/server/tests/monsters.test.ts)

#### A monster with no attack entry never melees
- **Kind:** Bug fixed
- **What you notice:** Shopkeepers, Gods and other NPCs with no attack value of their own no longer hit you for 35 on a map where fighting is allowed.
- **1.6:** The attack table started every monster at 35 and then set the value for each name it listed. Every NPC it missed, Angela, Trianus and Corin included, hit for 35, more than most monsters. The Officer is listed at 35 on purpose.
- **SSO:** A species whose `attack` is `null` in `monsters.json` (the names 1.6's attack table did not list), or a name not in the data at all, never melees. Every listed monster keeps its value, the Officer's 35 included.
- **Why:** The default made bystanders the hardest hitters on a fight map.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttackValue`, `monsterAttack`)
- **Pinned by:** `bug fixed: a name with no attack entry never melees` (packages/server/tests/monsters.test.ts)

#### The Snared Loah hits for 18
- **Kind:** Bug fixed
- **What you notice:** The Snared Loah hits as hard as its table row says, 18, not 35.
- **1.6:** The attack table spelled the name "Snared Load", so the Snared Loah never matched its row and got the default 35.
- **SSO:** The Snared Loah's `attack` in `monsters.json` is 18.
- **Why:** A typo, not a balance choice.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttackValue`)
- **Pinned by:** `bug fixed: the Snared Loah hits for its own 18` (packages/server/tests/monsters.test.ts)

#### Only a Pig's body is grabbed as a Pig
- **Kind:** Bug fixed
- **What you notice:** Clicking a Snow Demon, or pressing Ctrl facing one, does nothing pig-like.
- **1.6:** The click looked for "91-" anywhere in a monster's picture name, and the Snow Demon's picture 891 contains it, so it ran the Pig grab, and Ctrl grabbed a faced Snow Demon into your bag as a Pig.
- **SSO:** The Pig, Spikes, Web and Holy Shield click rules, the never-moves rule for Spikes, Web and Holy Shield, the web trap a walker is caught in, and the melee Holy Shield test all compare the body number exactly.
- **Why:** The text test caught a body number it was never written for.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`, `ctrlPig`), `packages/server/src/systems/monsters/slots.ts` (`neverMoves`, `BODY`), `packages/shared/src/rules/movement/movement.ts` (`isWebBody`), `packages/server/src/systems/spells/geometry.ts` (`onHolyShield`)
- **Pinned by:** `bug fixed: a Snow Demon is no Pig: a click opens nothing and Ctrl grabs nothing` (packages/server/tests/npcs-trade.test.ts); `bug fixed: only body 92 is a Web` (packages/shared/tests/spells/body-numbers.test.ts)

#### Clicking a Pig grabs that Pig
- **Kind:** Bug fixed
- **What you notice:** Clicking a Pig on the tile you face puts it in your bag; clicking one elsewhere does nothing. A full bag says so without starting the wait before your next grab, and a bag with a Pig stack takes another. Killing or removing a monster no longer changes anyone's wait.
- **1.6:** Clicking any Pig, however far away, grabbed whatever stood on your faced tile, even a Dragon or a shopkeeper, which left with no XP or loot. The 500-frame wait started before the bag test, a bag whose text contained "Pig" (even "Cooked Pig") skipped that test, and every monster removed or killed set every player's wait on the map to 20.
- **SSO:** The click grabs only the clicked Pig, and only when it stands on your faced tile. The bag test asks whether a Pig fits (a Pig stack or a free line); the wait starts when the grab goes through. Removals leave the wait alone.
- **Why:** The grab took the wrong creature and let a player clear any monster or shopkeeper for free; the bag test and the waits misfired.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`, `grabPig`, `cancelSlot`, `PIG_GRAB_FRAMES`)
- **Pinned by:** `bug fixed: clicking a Pig grabs only that Pig, on your faced tile; a removal leaves pig countdowns alone`, `bug fixed: a monster leaving its slot leaves everyone's pig countdown alone`, `bug fixed: a full bag refuses the grab without starting the countdown; a Pig stack takes it` (packages/server/tests/npcs-trade.test.ts)

#### NPC chatter comes on a steady interval
- **Kind:** Bug fixed
- **What you notice:** A God speaks one of its lines every 150 seconds while players are on its map, whether one player is there or twenty. Everyone on the map sees the line.
- **1.6:** Each player's game rolled the chatter separately, on a ladder meant to make each roll rarer as players joined. It read the player list from the wrong copy of a text member, which held only "King" and a return, so every roll was 1 in 400 (1 in 6,000 frames with its first roll) and a crowded screen heard a line from every player's roll.
- **SSO:** Each talking NPC counts down once per tick and speaks when it reaches 0. The interval is the operator setting `npcChatter` (default 150 s, 1.6's average with one player).
- **Why:** The ladder never worked, and a steady rate is what it was trying to give.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`chatterTick`), `packages/server/src/systems/world/tick.ts` (`tick`)
- **Pinned by:** `bug fixed: a talking NPC speaks once per interval, whatever the crowd; then the line`, `bug fixed: the tick says it once to the whole map, however many players are on it` (packages/server/tests/npcs-trade.test.ts)

#### Players and monsters block monsters
- **Kind:** Bug fixed
- **What you notice:** A monster no longer walks through you, another monster or a static NPC. A hostile monster that reaches you stops beside you. Riders block nothing, as they block no player.
- **1.6:** A monster's step checked only blocked tiles, the screen edge and water, so monsters passed through players and each other and could share a tile.
- **SSO:** A step onto a tile where a player stands, or that another monster covers (all six tiles of an Overlord or Mutant Worm), is skipped like a step into a wall; a big monster's own footprint is tested too.
- **Why:** Walking through solid things broke the picture the rest of the game draws, where players cannot walk through monsters.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`nextStep`, `occupied`, `monsterCells`)
- **Pinned by:** `bug fixed: players and other monsters block a monster's step`, `bug fixed: a 3×2 monster's footprint blocks and is blocked` (packages/server/tests/monsters.test.ts)

#### A calm monster keeps walking
- **Kind:** Bug fixed
- **What you notice:** A Passive monster that has not been provoked no longer freezes for a beat now and then on a map where fighting is allowed.
- **1.6:** Its attack roll was a 1-in-10 draw, and on a 1 its whole step routine ended early, skipping that frame's walk tick.
- **SSO:** An attack roll never touches the monster's walk.
- **Why:** The stall came from an early exit placed before the walk code, not from any rule about calm monsters.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`), `packages/server/src/systems/world/tick.ts` (`tick`)
- **Pinned by:** `bug fixed: an unprovoked Passive monster's random(10) = 1 does not hold up its walk` (packages/server/tests/monsters.test.ts)

#### Death blames the monster that last hurt you
- **Kind:** Bug fixed
- **What you notice:** "*** Bob was just killed by a Slime." names a monster whose hit counted, never one whose hit was ignored while you blinked.
- **1.6:** The monster hit handler recorded the attacker's name before the blink check exited.
- **SSO:** The name is recorded only once the blink check has passed.
- **Why:** An ignored hit should leave no trace.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`)
- **Pinned by:** `bug fixed: a roll ignored while you blink names no one` (packages/server/tests/monsters.test.ts)

#### A monster's hit on you shows the splat and plays the hit sound
- **Kind:** Bug fixed
- **What you notice:** When a monster hits you, the number floats up over a splat and the hit sound plays, as for a player's hit. Shield, Parry and Block stay silent.
- **1.6:** The monster-hit message was one field short of the player-hit message, so the floating text read the wrong fields and only the number showed.
- **SSO:** A monster's damage floatie carries the splat flag, so the client draws the splat and plays `hitsound` on channel 5.
- **Why:** Monster damage should be as visible and audible as player damage.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`), `packages/server/src/systems/world/tick.ts` (`tick`), `packages/client/src/model.ts` (`applyDelta`)
- **Pinned by:** `divergence: a monster's hit on you shows the number with the splat and hitsound` and `a Parry, Block or Shield floatie has no splat and no sound` (packages/client/tests/combat.test.ts); `a Slime next to you hits on random(10) = 1; the floatie is colour 6 with i-frames after` (packages/server/tests/monsters.test.ts)

#### A death drop is a random item from your bag
- **Kind:** Bug fixed
- **What you notice:** When a death drops an item, it is one of the items in their bag at random, from any line. Crystals never drop; an item that only has the word in its name, such as a Crystal Axe, can.
- **1.6:** The game counted the filled lines among 1 to 8 and picked a line number up to that count, so with gaps in your bag the pick could land on an empty line and nothing dropped, and lines 9 to 15 never dropped. A crystal stack picked dropped nothing, by an explicit check.
- **SSO:** The pick is one of the bag's lines other than the six colours of crystal (matched by whole name, not by "contains"), every line counting, with the same single draw; one unit of it drops.
- **Why:** The count was meant to pick among the items you carry. The crystal check was deliberate and stays, but a crystal stack no longer uses up the drop.
- **In the code:** `packages/shared/src/rules/monsters/loot.ts` (`rollDeathDrop`, `isCrystal`)
- **Pinned by:** `bug fixed: the death drop picks one of the bag's items at random; crystals never` (packages/shared/tests/inventory/inventory.test.ts)

### movement

#### A weaker player cannot shove you
- **Kind:** Bug fixed
- **What you notice:** When a weaker player walks into you and the 1-in-25 push roll hits, you read "… attempts to shove you out of the way but is too weak." and stay where you are.
- **1.6:** The strength check printed the "too weak" line and then fell through, so you also read "… shoves you out of the way." and were moved anyway.
- **SSO:** A pusher weaker than you only prints the "too weak" line. An equal or stronger pusher shoves you as before.
- **Why:** The check printed its refusal and so plainly meant to stop the shove.
- **In the code:** `packages/server/src/systems/movement/push.ts` (`pushOnMe`), `packages/shared/src/rules/chat/chat.ts` (`pushLines`)
- **Pinned by:** `bug fixed: a weaker pusher is 'too weak' and does not shove` (packages/server/tests/push.test.ts); `bug fixed: a weaker pusher's line says only that they are too weak` (packages/shared/tests/chat/chat.test.ts)

#### Only an Overlord or Mutant Worm blocks three tiles wide
- **Kind:** Bug fixed
- **What you notice:** A Slime or any other small monster blocks only its own tile, even when an Overlord or Mutant Worm is in a lower monster slot on the map, or was there earlier.
- **1.6:** The three-wide flag was set by an Overlord or Mutant Worm and never reset while the slots were checked in order, so every monster in a higher slot blocked three wide too, even after the big monster had died.
- **SSO:** Each slot is three wide only if its own monster is an Overlord or Mutant Worm.
- **Why:** The width belongs to the big monsters' art; leaking it to later slots was a missing reset.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`blockPCCheck`)
- **Pinned by:** `bug fixed: only an Overlord or Mutant Worm itself is three wide, in any slot`; `bug fixed: a remembered dead Overlord in slot 1 does not widen slot 2` (packages/shared/tests/movement/movement.test.ts); `bug fixed: a Slime in slot 2 is one wide after an Overlord in slot 1, dead or alive`; `an Overlord in a higher slot still blocks three wide` (packages/server/tests/blocking.test.ts)

#### A Web or Holy Shield no longer clears the way through players and monsters
- **Kind:** Bug fixed
- **What you notice:** You can walk onto a Web or Holy Shield, but standing players and other monsters block you as usual whether or not one is on the map.
- **1.6:** The Web or Holy Shield test cleared the block flag whatever had set it, looking only at the slot's name, so with one in a slot you walked through players and through monsters in lower slots. The name outlived the monster, so a dead Web still did it.
- **SSO:** A Web or Holy Shield never blocks its own tile and clears nothing else. A push roll on a blocked step against a standing player still happens.
- **Why:** The test was meant to let you step onto these summons, not to switch off blocking for the whole map.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`blockPCCheck`)
- **Pinned by:** `bug fixed: a Web or Holy Shield never blocks but clears nothing else`; `bug fixed: a remembered dead Holy Shield clears no player`; `bug fixed: a Web does not clear an Overlord's three-wide block` (packages/shared/tests/movement/movement.test.ts); `bug fixed: a remembered Web in slot 2 does not let you walk through a Slime in slot 1`; `a live Web or Holy Shield on the target is walked onto`; `bug fixed: a Web in slot 4 does not let you walk onto a standing player; the roll still shoves` (packages/server/tests/blocking.test.ts)

#### The web message prints once a press
- **Kind:** Bug fixed
- **What you notice:** Standing on a web tile, "Your feet are stuck in the web, you cannot move!" prints once when you press a direction, not on every tick while you hold it. Release and press again, change direction, or get shoved off and webbed again, and it prints again.
- **1.6:** The web test ran on every move attempt while a direction was held and printed the line each time, flooding the chat.
- **SSO:** The line prints on the first refused attempt of a press. The web still only counts on your own tile, still leaves your facing as it was, and a rider still ignores webs.
- **Why:** The repeat came from running a one-off message inside the held-key loop.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`setHeld`, `carryOut`)
- **Pinned by:** `bug fixed: the web message prints once a press, not every attempt while held`; `bug fixed: a scheduled client's web refusals print once until the key changes` (packages/server/tests/pigs-orbs-webs.test.ts)

#### Players walking between tiles block each other
- **Kind:** Bug fixed
- **What you notice:** A player who is mid-step blocks the tile they are stepping onto, so two players can no longer end up on the same tile. The tile they are leaving is free at once.
- **1.6:** Blocking compared exact sprite positions, and a moving player's sprite is between tiles, so only standing players blocked.
- **SSO:** Every other non-rider player blocks their logical tile, moving or not; your client predicts the same. Only standing players can be pushed.
- **Why:** Two players sharing a tile was never meant to happen.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`walkWorld`), `packages/client/src/model.ts` (`walkWorld`)
- **Pinned by:** `bug fixed: a player mid-step blocks the tile it steps onto; two never end on one tile`; `the tile a moving player leaves is free at once` (packages/server/tests/world.test.ts); `bug fixed: a moving player blocks the tile it steps onto` (packages/server/e2e/login-and-walk.test.ts)

### progression

#### The left head arrow steps back
- **Kind:** Bug fixed
- **What you notice:** On the new character screen the right arrow shows the next head and the left arrow the previous one.
- **1.6:** Both arrows ran the same script, so each stepped forward through the heads.
- **SSO:** The left arrow steps back through the same cycle, wrapping from the first head to the last.
- **Why:** A pair of opposite arrows that both go forward is a slip, not a feature.
- **In the code:** `packages/shared/src/rules/progression/creation.ts` (`nextHead`, `prevHead`), `packages/client/src/ui/screens.ts` (`creationScreen`)
- **Pinned by:** `bug fixed: the left arrow steps back through the cycle` (packages/shared/tests/progression/creation.test.ts)

#### Spare XP carries over a level-up
- **Kind:** Bug fixed
- **What you notice:** XP past what a level needs counts toward the next one, and a kill big enough for several levels gives them all, with "You have become more powerful!" once for each. A level-up still does not heal you.
- **1.6:** The level check reset XP to 0 and was a single test, so the overflow was lost and a kill gave at most one level.
- **SSO:** The check repeats while XP reaches the amount needed, taking that amount off each time; each level adds 1 to maximum HP and SP as before.
- **Why:** Throwing away earned XP was a shortcut in the level check, not a rule.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`checkLevelUp`), `packages/server/src/systems/combat/melee.ts` (`smash`), `packages/server/src/systems/spells/collide.ts` (`checkForDead`)
- **Pinned by:** `bug fixed: the overflow carries over and a big kill can raise several levels; no heal`; `short of the XP needed, nothing changes` (packages/shared/tests/progression/progression.test.ts); `bug fixed: XP overflow carries over and a kill can raise several levels` (packages/server/tests/monsters.test.ts)

#### Class promotions give their skills
- **Kind:** Bug fixed
- **What you notice:** A promotion raises the skills its class was meant to start with to a roll of 1 to 10: Grunt Thrust, Illusionist Illusion, Wizard Wizardry, Sorcerer Sorcery, Paladin Fencing and Magery, Dragoon Block and Fencing, Priest Blessing, Necromancer Black Arts, Bard Musicianship, Barbarian Hammer Wielding, the four elemental Mages their element, and Archer Archery. Druid has none. A skill already above the roll keeps its value.
- **1.6:** Each promotion set its skill to `random(10)`, but the character refresh then reloaded every skill from the saved field, so no promotion ever gave a skill. The grant also overwrote the skill, so it could have lowered one.
- **SSO:** The grants are in `classes.json` (`skillGrants`); the server applies them and saves the class, gold and skills in one write. The anti-cheat ban a changed roll could trigger in 1.6 does not exist in SSO.
- **Why:** The grant code is plainly meant to run; the reload that undid it was an accident of order. How classes and promotions should work and balance is open in [issue #15](https://github.com/jberlyn/second-star-online/issues/15).
- **In the code:** `packages/shared/src/rules/progression/promotion.ts` (`promoteClass`), `packages/server/src/systems/economy/intents.ts` (`trainIntent`), `packages/server/src/persistence/characters.ts` (`savePromotion`)
- **Pinned by:** `bug fixed: each promotion raises its skills to a roll of 1-10`; `a grant never lowers a skill already above the roll`; `Druid grants no skill` (packages/shared/tests/progression/promotion.test.ts); `bug fixed: after a reconnect the class, gold and granted Thrust hold` (packages/server/e2e/promotions.test.ts)

#### Regeneration never stalls
- **Kind:** Bug fixed
- **What you notice:** Hit and spell points regenerate every period while Hunger is above 500, whatever your hunger did before. With Hunger from 50 to 500 a period passes with no change, and starving below 50 still takes 1 of each down to 1.
- **1.6:** The counter reset only when it exactly equalled its target and a regen (Hunger above 500) or starvation (below 50) happened. A period with Hunger in between, or a target lowered below the counter, left it climbing past the target, so regen and starvation stopped until the next login.
- **SSO:** The counter resets every time it reaches the target, whatever the hunger. It still starts at 1 at login and is raised first, so regen fires every 148 frames (target 149).
- **Why:** The reset was meant to start each period; tying it to the effect was an oversight.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`regenTick`), `packages/server/src/systems/progression/vitals.ts` (`regenStep`)
- **Pinned by:** `bug fixed: a period with 50 <= Hunger <= 500 passes with no change and regen goes on`; `bug fixed: a counter already past a lowered target fires on the next frame` (packages/shared/tests/progression/progression.test.ts)

#### Each hunger warning prints once
- **Kind:** Bug fixed
- **What you notice:** "You are very hungry.", "You are extremely hungry, you need to eat." and "You are starving!" each appear once as hunger drops past them.
- **1.6:** The check ran every frame and printed whenever hunger equalled a warning value, while hunger drops on only about a third of frames, so each warning printed about three times.
- **SSO:** A warning prints on the frame hunger drops onto its value.
- **Why:** The warnings were meant to mark the moment hunger reaches each level.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`hungerTick`, `HUNGER_WARNINGS`)
- **Pinned by:** `bug fixed: a warning prints once, on the frame hunger drops onto the value`; `bug fixed: over many frames each warning prints exactly once` (packages/shared/tests/progression/progression.test.ts)

#### Mage skills cap the same from kills and casts
- **Kind:** Bug fixed
- **What you notice:** A Mage faction member with a bonus of 3 can raise Mage skills to 90 by killing as well as by casting.
- **1.6:** The kill path capped Mage skills at 80 at that bonus and the cast path at 90; the tables agreed at every other bonus (30 outside the faction, then 50, 60, 70 and 100).
- **SSO:** Both paths use one table, with 90 at bonus 3.
- **Why:** Two copies of one table drifted apart. SSO takes the higher value so no character ends up above its cap.
- **In the code:** `packages/shared/src/rules/progression/skillgain.ts` (`mageSkillCap`, `skillCaps`), `packages/shared/src/rules/spells/spells.ts` (`castMageCap`)
- **Pinned by:** `bug fixed: a Mage faction bonus of 3 caps Mage skill at 90 from kills and casts alike` (packages/shared/tests/spells/spells.test.ts)

#### A death long after the last hit credits no one
- **Kind:** Bug fixed
- **What you notice:** A death that comes more than 2 seconds after the last hit names no killer ("… was just killed.") and flags no one, however recently someone hit you before that.
- **1.6:** The last attacker was cleared only at death and login, so a death nobody caused named and flagged whoever had hit you last, however long ago.
- **SSO:** Every hit restarts a short window (`KILL_CREDIT_TICKS`, 40 ticks); a death after it has passed forgets the last attacker before the death line, the murder flag and the Assassin points. In SSO starving stops at 1 HP, as in 1.6, so this guards any death no hit caused.
- **Why:** A kill should be credited to the hit that caused it.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`, `ageLastHit`, `KILL_CREDIT_TICKS`), `packages/server/src/systems/social/murder.ts` (`flagKiller`)
- **Pinned by:** `bug fixed: a death long after the last hit credits no one`; `a death within the credit window still credits the hit` (packages/server/tests/factions.test.ts); `bug fixed: a death long after the last hit earns its old attacker no Assassin points`; `a death within the credit window earns the attacker Assassin points` (packages/server/tests/factions.test.ts)

#### The skills list stops at its first and last rows
- **Kind:** Bug fixed
- **What you notice:** On the Skills page, the up arrow does nothing when the first skill is at the top, and the down arrow stops when the last skill reaches the bottom. The press that reaches the end moves only as far as it, so the list never slides off into empty wood.
- **1.6:** Each arrow press moved both columns 32 px with no limit, so you could scroll the whole list out of view in either direction and had to press back to find it.
- **SSO:** Presses still move 32 px, but the offset is held between the first row 3 px inside the top of the clip and the last row 3 px inside its bottom.
- **Why:** Scrolling past the list's ends shows nothing; the missing bound was an oversight.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `bug fixed: the skills list stops at its first and last rows` (packages/client/tests/panel.test.ts)

#### Every wieldable sword trains its skills on a kill
- **Kind:** Bug fixed
- **What you notice:** Killing a monster with a Steel Scimitar, a Dragon Sword or a masterwork such as Knight's Sword +2 can raise Slash, Thrust, Swordsmanship and the weapon's other skills, as its plain or sister weapon does.
- **1.6:** The kill skill-gain table named some weapons exactly. The Steel Scimitar had no row, and an exact row such as Knight's Sword missed the `+1` to `+4` masterworks a repair makes, so those weapons trained nothing on a kill.
- **SSO:** `classes.json` `skillGain.weaponSkills` has Steel Scimitar and Dragon Sword rows (Slash, Thrust, Swordsmanship, Fencing, as the Star and Pharaoh Swords), and an exact row also covers the masterworks made from its weapon, read from `craft.json` `stations.smith.masterwork`.
- **Why:** A better copy of a weapon, or a weapon the game hands out, training nothing was never intended.
- **In the code:** `packages/shared/src/rules/progression/skillgain.ts` (`weaponSkillList`), `packages/shared/src/rules/crafting/masterwork.ts` (`weaponIs`, `masterworkBase`)
- **Pinned by:** `bug fixed: the Dragon Sword and Steel Scimitar train the sword skills`; `bug fixed: a masterwork trains what its base weapon trains` (packages/shared/tests/progression/weapon-skills.test.ts)

### social

#### Guild names lose ; ` and '
- **Kind:** Bug fixed
- **What you notice:** Semicolons, backticks and apostrophes are removed from a new guild name; if nothing remains, the game says “This guild name is already taken!”
- **1.6:** The create button's sanitiser kept those characters. The server cut semicolons, a backtick broke later guild saves, and an apostrophe made a hall's door owner differ from its guild-key owner. An empty name created a nameless file.
- **SSO:** The original sanitiser runs first, including its adjacent-character behavior, then all three characters are removed. An empty result gets the original alert used after the first empty name existed. The name field stops at its original 210-pixel width, and the server refuses forged inputs longer than 100 characters.
- **Why:** These characters broke guilds in 1.6; the other surviving characters are harmless in server rows.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`sanitiseGuildName`), `packages/server/src/systems/social/guilds.ts` (`guildCreate`)
- **Pinned by:** `SSO also removes every semicolon, backtick and apostrophe; other marks and trailing spaces stay` (packages/shared/tests/social/guilds.test.ts); `divergence: an empty name after the sanitiser gets the same alert` (packages/server/tests/guilds.test.ts)

#### A player named like a monster can be flagged
- **Kind:** Bug fixed
- **What you notice:** A player named Orc, Elf or another monster-list name can become wanted and earn Assassin points like any other player.
- **1.6:** The murder and Assassin messages were skipped when the last hitter's name equalled one of the first 60 monster-list lines. Monster names did not match that form, but players with such names were spared.
- **SSO:** A kill is credited by player ID. A player with a monster-list name can be flagged; monsters never are.
- **Why:** A name chosen at creation should not make a player immune to the murder flag.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`), `packages/server/src/systems/social/assassin.ts` (`scoreKill`)
- **Pinned by:** `a player named like a monster is flagged like anyone` (packages/server/tests/factions.test.ts); `bug fixed: a player named like a monster earns points like anyone` (packages/server/tests/assassin.test.ts)

#### A normal Assassin's game ends Lightning
- **Kind:** Bug fixed
- **What you notice:** Starting a normal Assassin's game turns Lightning mode off for everyone.
- **1.6:** A normal start did not send the message to turn Lightning off. If it replaced a Lightning game, online clients kept Lightning's one-hit, penalty-free death for landed player melee hits while the server scored the game normally. Arrows, spells and monster attacks still killed by their usual rules.
- **SSO:** The current game mode determines whether Lightning is active, so a normal start ends it.
- **Why:** A game announced as normal should play as a normal game.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`setAssassinMode`, `lightningOn`)
- **Pinned by:** `a normal start ends Lightning; one hit no longer kills` (packages/server/tests/assassin.test.ts)

#### An Assassin's game with no scorer awards nothing
- **Kind:** Bug fixed
- **What you notice:** Ending an Assassin's game with no scorers announces the end but gives no wins or prizes.
- **1.6:** An empty game printed blank winner names and counted an all-time win for an empty name.
- **SSO:** The end prints “*** The assassin's game has ended!!!” and “*** Check back soon for yet another assassin's game.” only. With one or two scorers, missing places still print blank as in 1.6 and get nothing.
- **Why:** A game with no scorer should not award an empty-name win.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`endGame`)
- **Pinned by:** `an end nobody scored in names no winner, counts no win and gives nothing`; `an end with one scorer prints the missing places blank and gives them nothing` (packages/server/tests/assassin.test.ts)


#### A guild line keeps its first character
- **Kind:** Bug fixed
- **What you notice:** Nothing in ordinary play: every guild line reads as it is stored.
- **1.6:** The guild loader deleted the first character of any line that did not start with a letter, on your own guild's lines at login, on every change and on the guild screen. Honest data always started with a letter, so only odd names or damaged files showed it.
- **SSO:** The loader drops empty lines and keeps every other line whole.
- **Why:** The strip guarded nothing and could only damage a line.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`loadGuildLines`)
- **Pinned by:** `bug fixed: a line not starting with a letter keeps its first character; empty lines go` (packages/shared/tests/social/guilds.test.ts)

#### Only a disbanded guild's leader may found its name again
- **Kind:** Bug fixed
- **What you notice:** After a guild disbands, anyone else who tries to found a guild of the same name is told "This guild name is already taken!". The leader who disbanded it may found it again, and gets back its Guild Vault, Guild Key doors and hall.
- **1.6:** Anyone could found a guild with a disbanded guild's name and inherit what it left behind, because vaults, doors and halls are all found by guild name. Nobody was warned.
- **SSO:** The disbanded row keeps its last leader, and only that character may reuse the name. Former members are still kicked at their next login, as for any re-founded guild.
- **Why:** A stranger should not walk into a dead guild's vault and hall; its leader re-founding it is the one case where taking them back is right. How guilds should own their halls, doors and vaults is open in [issue #16](https://github.com/jberlyn/second-star-online/issues/16).
- **In the code:** `packages/server/src/systems/social/guilds.ts` (`guildCreate`), `packages/server/src/systems/economy/containers.ts` (`mayUseContainer`)
- **Pinned by:** `bug fixed: only the leader who disbanded a guild may found its name again`; `a guild of the same name created again: an old member is kicked at login` (packages/server/tests/guilds.test.ts); `create, join, exile and disband are written with the fields; a restart reads them` (packages/server/tests/guilds-db.test.ts)

#### Abdicating names the new leader and redraws your screen
- **Kind:** Bug fixed
- **What you notice:** Abdicating prints "*** Abdicating to <new leader>", and your Guild Center redraws as a member's screen, with you as the last member. Exiling a member, or any redraw of the screen, clears the selected member, so Abdicate needs a fresh selection.
- **1.6:** The line named the guild, the leader's screen stayed up with its leader buttons, and the selected member survived an exile, so Abdicate could try to crown someone who had just been exiled.
- **SSO:** The line names the new leader, the server sends the redrawn screen, and the client clears its selection whenever the member list changes. The server still checks leadership and membership on every action.
- **Why:** The confirmation should say who leads now, and a screen should not offer buttons its viewer can no longer use.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`abdicateGuild`), `packages/server/src/systems/social/guilds.ts` (`guildAction`), `packages/client/src/ui/guildcenter.ts` (`createGuildCenter`)
- **Pinned by:** `bug fixed: abdicate crowns the target, re-adds the old leader last and names the new leader` (packages/shared/tests/social/guilds.test.ts); `bug fixed: abdicate names the new leader and redraws the old leader's screen as a member's` (packages/server/tests/guilds.test.ts); `bug fixed: an exile clears the selection, so Abdicate cannot crown the exiled member`; `bug fixed: a redrawn screen clears the selection` (packages/client/tests/guildcenter.test.ts)

#### Each faction hears only its own announcements
- **Kind:** Bug fixed
- **What you notice:** "*** The Mage faction has become stronger thanks to <name>." and the other factions' announcements reach only that faction's online members. Leaving a faction in any way, including exile at death, stops them at once.
- **1.6:** All three factions shared one @Faction channel, so every member heard every faction's announcements. The loyalty kick left the channel but a death exile did not, so an exiled player kept hearing it until the next login.
- **SSO:** A faction's channel is its online members, worked out when a line is sent, so there is nothing to join or leave.
- **Why:** A faction's announcements are its own business; one shared channel and a forgotten leave were oversights.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`toFactionChannel`, `giveHead`), `packages/shared/src/rules/social/factions.ts` (`exileAtDeath`)
- **Pinned by:** `a rival head to Angela: said to the map, power moved, joined, announced to the Mages, bonuses for all`; `bug fixed: exile below the line on death also leaves the faction channel` (packages/server/tests/factions.test.ts); `Bob gives the head to Angela: power moves, he joins, only the Mages hear it` (packages/server/e2e/social.test.ts)

#### A faction at 200 power or more keeps its bonus
- **Kind:** Bug fixed
- **What you notice:** A faction's members keep a bonus of 9 once its power reaches 200, as they had from 80.
- **1.6:** The bonus cascade had no row for 200 or more, so nothing matched and the bonus fell to 0.
- **SSO:** 80 or more gives 9, however high the power goes. Lower powers give what they did.
- **Why:** Growing stronger should never take a faction's bonus away.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`factionBonus`)
- **Pinned by:** `bug fixed: the faction bonus cascade's last true row wins, and 200 or more gives 9` (packages/shared/tests/social/factions.test.ts)

#### A head a faction leader would refuse stays in your bag
- **Kind:** Bug fixed
- **What you notice:** Give a rival faction's head to a leader whose faction would not take you (too weak, or already in another faction) and the leader says why ("You need more experience to join us." or the other-faction line); you keep the head and no power moves. A member giving a rival head to its own leader, or a fit newcomer, is handled as before. A head of the leader's own faction is still taken, with the leader's line about disposing of it.
- **1.6:** The server took the head and moved the power before the client decided whether you could join, so a refused joiner lost the head and still made the leader's faction stronger.
- **SSO:** The server asks whether the leader's faction would take you before anything leaves the bag.
- **Why:** A refusal should cost nothing. Disposing of a fallen member's head is what the leader's own line says, so it stays.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`headRefusal`, `giveHead`), `packages/shared/src/rules/social/factions.ts` (`joinRefusal`), `packages/server/src/systems/economy/quests.ts` (`questGive`)
- **Pinned by:** `bug fixed: a joiner who would be refused keeps the head and moves no power`; `a member turning a rival head in to its own leader adds time and moves power` (packages/server/tests/factions.test.ts); `joinRefusal: members and fit newcomers pass; the weak and other factions' members are refused`; `turn-in: own head wasted; a rival head moves 1 power when the rival has any` (packages/shared/tests/social/factions.test.ts)

#### The Warriors take no one they would exile
- **Kind:** Bug fixed
- **What you notice:** Trianus refuses anyone with fewer than 60 maximum hit points, so a new Warrior is never exiled at the next death.
- **1.6:** Every faction took joiners above 49 maximum hit points, but the Warriors exile anyone below 60 at each death, so a Warrior who joined at 50-59 was thrown out at the next death.
- **SSO:** The Warriors' join line is above 59 (`joinHpMaxAbove` in `social.json`); the Mages' and Adventurers' stay above 49.
- **Why:** A faction's own entry test should not admit someone its exile test rejects.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`joinFaction`, `exileAtDeath`)
- **Pinned by:** `bug fixed: the Warriors take no one below their exile line of 60`; `no faction's join line is below its exile line` (packages/shared/tests/social/factions.test.ts)

#### Faction leader lines close their quotes
- **Kind:** Bug fixed
- **What you notice:** Angela, Trianus and Corin's answers about their faction's power end with a closing quote.
- **1.6:** The three power lines had no closing quote.
- **SSO:** The texts in `social.json` are complete.
- **Why:** Typos.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`sayFaction`)
- **Pinned by:** `bug fixed: faction leader lines close their quote` (packages/shared/tests/social/factions.test.ts)

#### Assassin points follow the bands at equal ratings and 1800 or more
- **Kind:** Bug fixed
- **What you notice:** A kill between equal combat ratings pays the victim's band, as for a stronger killer, and a deciding rating of 1800 or more pays the top band (70, or 100 for a weaker killer). Before, those kills paid the victim's whole rating, often hundreds or thousands of points.
- **1.6:** The comparison had no row for equal ratings or a rating past its last band, so the score fell through to the victim's raw rating.
- **SSO:** A killer at least as strong as the victim is paid from the victim's band; a rating past the last band takes the last band.
- **Why:** The ladders cap a kill's worth; falling through to the raw rating let one kill outscore a whole game.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`compareAss`)
- **Pinned by:** `bug fixed: equal ratings pay the victim's band; a rating of 1800 or more takes the last band` (packages/shared/tests/social/assassin.test.ts)

#### Assassin tables rank ties and give the fourth prize
- **Kind:** Bug fixed
- **What you notice:** A score equal to a table entry ranks just below it, so it makes the current and all-time tables whenever there is room. The fourth line of the Assassin prizes setting goes to fourth place.
- **1.6:** The ranking used strict comparisons, so a score equal to any entry, even with empty slots below, never made the table. Only prizes 1-3 were given, so the fourth line never was.
- **SSO:** A new score goes after every entry with an equal or higher score. Prizes 1-4 go to the first four places, still stopping at the first blank. The end lines still name the top three.
- **Why:** A tie is still a score, and a prize line an operator fills should be given.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`rankEntry`, `prizesGiven`), `packages/server/src/systems/social/assassin.ts` (`endGame`)
- **Pinned by:** `bug fixed: a tie ranks just below the entry it ties`; `bug fixed: the archive's prizes; 1-4 given, a blank stops the rest` (packages/shared/tests/social/assassin.test.ts)

#### A tied Assassin total replaces your old entry
- **Kind:** Bug fixed
- **What you notice:** If your new total ties someone's entry, the table shows your new total below theirs. With Bob 40 and Alice 30, Alice reaching 40 shows Bob 40, Alice 40.
- **1.6:** Your entry was blanked only in the copy being ranked, and a tie never ranked, so the table kept your old, lower total.
- **SSO:** Your old entry is dropped before your new total is ranked.
- **Why:** The table should show what each player has scored.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`rankEntry`)
- **Pinned by:** `bug fixed: a tied total replaces the player's old entry (Bob 40, Alice 30 → Alice 40)` (packages/shared/tests/social/assassin.test.ts); `bug fixed: a tied total replaces the old table entry, below the entry it ties` (packages/server/tests/assassin.test.ts)

#### Lightning kills flag no one
- **Kind:** Bug fixed
- **What you notice:** A kill while a Lightning Assassin's game runs pays its 10 points but does not make the killer wanted.
- **1.6:** The Lightning game announces "all death penalties are OFF", but its deaths still sent the wanted flag.
- **SSO:** While a Lightning game runs, the end of a death lock flags no one; the Assassin points are paid as before.
- **Why:** A game that tells everyone to kill on sight, with penalties off, should not brand its players murderers.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`), `packages/server/src/systems/social/assassin.ts` (`lightningOn`)
- **Pinned by:** `bug fixed: the kill pays 10 after the death line and flags no one` (packages/server/tests/assassin.test.ts); `at the end of his lock Alice receives 10 points, after the death line, and is not wanted` (packages/server/e2e/social.test.ts)

#### Closing your bio keeps your profile as written
- **Kind:** Bug fixed
- **What you notice:** Closing your own Bio window saves your profile exactly as typed, periods and semicolons included; closing it unedited changes nothing. A colon or slash refuses the save with "You can't have a : in your profile!" (or the same with a slash).
- **1.6:** Every close saved the box after one forward pass each deleting colons, slashes, periods and semicolons, so the profile lost its punctuation even unedited. Of two adjacent characters the second survived, so "a:b" saved as "ab" while "a::b" was refused.
- **SSO:** Nothing is deleted: any colon or slash refuses the save, and an unchanged profile is not saved or checked at all.
- **Why:** Saving should not rewrite what the player wrote; the alerts show colons and slashes were meant to be refused, not silently removed.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`saveProfile`), `packages/server/src/systems/social/bios.ts` (`profileSave`)
- **Pinned by:** `bug fixed: periods and semicolons are kept`; `bug fixed: any colon or slash refuses the save, none is silently removed` (packages/shared/tests/social/friends-bios-medals.test.ts); `bug fixed: the profile is written as typed, periods and semicolons kept`; `bug fixed: closing an unedited profile writes and alerts nothing, even with an old colon` (packages/server/tests/friends.test.ts); `bug fixed: closing your own bio writes the profile as typed` (packages/server/tests/buddies-db.test.ts)

#### Each bio clears all its medal slots
- **Kind:** Bug fixed
- **What you notice:** Looking at a bio with fewer medals after one with more shows only its own medals; the last four slots no longer keep the earlier bio's.
- **1.6:** Each bio cleared only the first ten of the strip's fourteen slots, and the strip persisted between bios.
- **SSO:** Every slot is cleared before the medals are drawn.
- **Why:** A bio should show its own medals only.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`medalStrip`), `packages/client/src/ui/bio.ts` (`createBioWindow`)
- **Pinned by:** `bug fixed: each bio clears all 14 slots and draws from slot 1` (packages/shared/tests/social/friends-bios-medals.test.ts); `bug fixed: a bio with fewer medals clears slots 11-14 too` (packages/client/tests/friends-bio.test.ts)

#### The bio score counts all its listed skills
- **Kind:** Bug fixed
- **What you notice:** A bio's score now includes Lumberjacking, Archery, Blessing, Musicianship, Illusion, Punch, Fire and Wind, so scores rise for anyone with those skills. The High Score table scores by the bio score, so it changes the same way (see the next entry).
- **1.6:** The second line of the score's sum assigned to a misspelt variable, so those eight skills never counted.
- **SSO:** The score sums every skill on its list (`bios.score.counted` in `social.json`: 33 skills, HPmax and SPmax). Meditation, Terrain Navigating, Item Identification, Shoveling and Farming were never on 1.6's list and still do not count.
- **Why:** A misspelt variable, not a design.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`bioScore`), `packages/shared/src/rules/social/highscores.ts` (`highScorePoints`)
- **Pinned by:** `bug fixed: the score counts every listed skill, HPmax and SPmax` (packages/shared/tests/social/friends-bios-medals.test.ts)

#### High scores count the bio score's skills and rank ties after the tied entry
- **Kind:** Bug fixed
- **What you notice:** The High Score Statue's points are the bio score's sum: every skill on its list, HPmax and SPmax. A tie ranks right after the entry it ties, and your own lower score never replaces your higher entry.
- **1.6:** The score left out eight skills (Lumberjacking, Archery, Blessing, Musicianship, Illusion, Punch, Fire and Wind) through a misspelt variable, ties failed to rank, and blanking your own entry let a lower score overwrite it.
- **SSO:** `highScorePoints` is the bio score, which now counts every skill on its list, and `rankHighScore` ranks ties after the tied entry and keeps a personal best.
- **Why:** The board should reflect a whole character and keep each player's best.
- **In the code:** `packages/shared/src/rules/social/highscores.ts` (`highScorePoints`, `rankHighScore`), `packages/server/src/systems/social/highscores.ts` (`submitHighScore`)
- **Pinned by:** `the points are the bio score: its listed skills, HPmax and SPmax`; `rankHighScore places ties right after the tied slot and keeps a higher existing score` (packages/shared/tests/social/highscores.test.ts)

#### Any friend can be removed
- **Kind:** Bug fixed
- **What you notice:** `/friends remove` works on any name on your list, the 190th and later included.
- **1.6:** The removal searched only the first 190 list items, the first of which is always empty, so names past the 189th could not be removed; the rebuild also dropped names past the 199th.
- **SSO:** The removal finds the name anywhere on the list and keeps every other name in order.
- **Why:** Loop bounds, not a limit anyone chose; SSO's own cap of 199 names is separate.
- **In the code:** `packages/shared/src/rules/social/buddies.ts` (`buddyRemove`)
- **Pinned by:** `bug fixed: any name on the list can be removed, the 190th and later too`; `bug fixed: a removal keeps every other name, in order, past the 199th too` (packages/shared/tests/social/friends-bios-medals.test.ts)

### spells

#### Portal with nowhere to go cannot be cast
- **Kind:** Bug fixed
- **What you notice:** When the server has no Portal destination whose map exists, casting Portal says "The portal will not open." and costs neither SP nor crystals. A portal already open whose destinations have all gone moves no one.
- **1.6:** Portal always opened; with no valid destination its warp sent everyone who stepped in to the start point. 1.6's only destination, `xbrinkybrink`, was not a map, so Portal always did.
- **SSO:** The cast checks the `portalTargets` setting first, and a portal picks only among destinations whose maps exist.
- **Why:** A spell that silently sends players to the start point is a broken destination, not a feature.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`), `packages/server/src/systems/world/tick.ts` (`portalOpen`)
- **Pinned by:** `bug fixed: Portal with no destination is refused before SP and crystals are spent`; `bug fixed: a portal whose targets' maps are all missing moves no one` (packages/server/tests/spells.test.ts)

#### A cast click must land on the playfield
- **Kind:** Bug fixed
- **What you notice:** A spell is cast only by clicking on the playfield; a click in the margin around it does nothing.
- **1.6:** The cast took any click with 8 < H < 580 and 5 < V < 420, a band of up to 22 pixels around the playfield [30, 31, 574, 415].
- **SSO:** The client and the server both take a click only inside the playfield rectangle.
- **Why:** The margin was a loose bounds check, not a place to aim; clicks there named tiles off the map.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`inCastBounds`), `packages/server/src/systems/spells/cast.ts` (`castIntent`), `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `bug fixed: a cast click must be on the playfield [30, 31, 574, 415]` (packages/shared/tests/spells/spells.test.ts); `bug fixed: the server takes a cast click only on the playfield [30, 31, 574, 415]` (packages/server/tests/spells.test.ts); `bug fixed: the point must be on the playfield, not 1.6's wider 8 < H < 580, 5 < V < 420` (packages/client/tests/cast.test.ts)

#### A refused cast costs nothing
- **Kind:** Bug fixed
- **What you notice:** A cast that is refused, for any reason, leaves you free to cast again at once and spends no SP or crystals.
- **1.6:** The 20-frame cast delay was set before the checks for map loading, harmful spells, an empty selection, SP and crystals; Portal's player test and the summons' tests ran after SP and crystals were taken.
- **SSO:** Every refusal comes first; only a cast that goes ahead sets the delay and takes its cost.
- **Why:** Charging for a cast that never happened was an ordering accident.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `bug fixed: only a cast that goes ahead sets the delay; a refused one costs nothing` (packages/server/tests/spells.test.ts)

#### Portal is refused only near another player, before it costs anything
- **Kind:** Bug fixed
- **What you notice:** You can open a Portal on yourself. Casting it on another player says "You cannot cast this close to another person." and spends nothing.
- **1.6:** The test looped over every player sprite, the caster's own included, and ran after SP and crystals were taken.
- **SSO:** The test leaves out the caster and runs before the cost.
- **Why:** "Another person" never meant you, and a refused cast should not be paid for.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `bug fixed: Portal is refused near another player before SP and crystals are spent, and opens on the caster` (packages/server/tests/spells.test.ts)

#### Spells with no effect are refused before they cost anything
- **Kind:** Bug fixed
- **What you notice:** Casting Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon or Identify says "This spell has no power." and spends no SP, crystals or delay.
- **1.6:** These spells had costs but no effect: the cast placed no FX and nothing read them. Haste's flag and Replenish's heal sat in a handler nothing called. The first six took SP and crystals for nothing; Identify had no cost and did nothing silently.
- **SSO:** They stay learnable and listed, but the cast is refused before anything is spent. No effect is invented for them.
- **Why:** Taking a player's SP and crystals for a spell that cannot do anything is a bug; giving them effects 1.6 never had would be new content.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`isInert`), `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `bug fixed: the spells 1.6 gave no effect are inert, by name or effect` (packages/shared/tests/spells/spells.test.ts); `bug fixed: Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon and Identify are refused before anything is spent` (packages/server/tests/spells.test.ts)

#### Smoke Bomb in a body named "Ninja" costs 25
- **Kind:** Bug fixed
- **What you notice:** Smoke Bomb costs 25 SP whatever you wear, except the Ninja Outfit (17) and Royal Ninja Uniform (13).
- **1.6:** The cost was set to 25 only when the body was not exactly "Ninja", so a body named "Ninja" left the cost at 0, which ended the cast: Smoke Bomb could not be cast at all.
- **SSO:** The "Ninja" row is gone; such a body pays the normal 25.
- **Why:** The test was a slip for the ninja bodies; it was never meant to make the spell uncastable.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spCost`)
- **Pinned by:** `bug fixed: Smoke Bomb costs 25 in a body named exactly "Ninja", like any other body` (packages/shared/tests/spells/spells.test.ts)

#### Fireball and Wind Wave get their school bonus
- **Kind:** Bug fixed
- **What you notice:** Fire skill adds to Fireball's power and Wind skill to Wind Wave's, as they do for Firebolt and Whirlwind.
- **1.6:** The spell was renamed to its directional form ("FireballL", "Wind waveR") before the power code looked for "Fireball" and "wind wave", so neither matched.
- **SSO:** Power is worked out on the spell's own name, then the cast is renamed.
- **Why:** The power code plainly lists both spells under their schools.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spellPower`), `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `bug fixed: Fireball and Wind Wave get their school bonus by the base name` (packages/shared/tests/spells/spells.test.ts); `bug fixed: Fireball and Wind Wave cast with their school bonus` (packages/server/tests/spells.test.ts)

#### Bolt and Wind Wave train their school; free fireballs train nothing
- **Kind:** Bug fixed
- **What you notice:** Casting Bolt can raise Wrath, and Wind Wave can raise Wind. A Fire Staff or Firesword fireball, which costs nothing, no longer raises Magery or Fire.
- **1.6:** The skill gain was given the directional name and compared it exactly with "Bolt" and "Wind Wave", so they never trained; it matched "Fireball" with `contains`, so the free weapon fireballs trained Magery and Fire.
- **SSO:** A directional name trains its base spell's school, and the weapons' fireballs skip the skill gain.
- **Why:** Every spell lists its school in the skill gain; free swings were never meant to train magic.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`baseSpell`, `spellImp`), `packages/server/src/systems/spells/cast.ts` (`swingFireballs`), `packages/server/src/systems/spells/fx.ts` (`placeQueued`)
- **Pinned by:** `bug fixed: Bolt and Wind Wave raise their school from their directional names` (packages/shared/tests/spells/spells.test.ts); `bug fixed: a Fire Staff fireball trains no skill` (packages/server/tests/spells.test.ts); `bug fixed: a Firesword fireball trains no skill; a cast Fireball with the same rolls does` (packages/server/tests/spells.test.ts)

#### Armour and Magic Shield change spell damage
- **Kind:** Bug fixed
- **What you notice:** Robes, some helms and some shields lower the damage arrows, Crush, Meteor, Fireball, Bolt and Wind Wave do to you; metal armour, plate helms and steel shields raise it. Magic Shield takes 5 off while it runs.
- **1.6:** Those branches called the spell-defense lookup (`GetSpellDef`), which held these rows, Magic Shield's −5 and a closing `random(3)`, but it changed only a by-value copy, so the damage never changed.
- **SSO:** The lookup's result is the damage: each worn item's row is added, Magic Shield takes 5 off, a positive amount gains `random(3)`, and anything below 1 becomes `random(3)`. Firebolt and Splash skip it, as in 1.6. The rows are data (`armour.spell` in item-rules.json).
- **Why:** The lookup was written to apply and only failed by a Lingo parameter mistake; Magic Shield had no effect at all without it.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spellDefense`, `playerSpellAmount`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `bug fixed: robes and Magic Shield lower spell damage; metal armour raises it` (packages/shared/tests/spells/spells.test.ts); `bug fixed: armour and Magic Shield change the spell damage you take` (packages/server/tests/spells.test.ts)

#### Hold obeys the PvP flag
- **Kind:** Bug fixed
- **What you notice:** A player's Hold does not root another player on a map where player fighting is off.
- **1.6:** The Hold branch tested only for a vehicle and for its own caster.
- **SSO:** A player's Hold is spared where PvP is off, like the harmful spells; a monster's Hold still lands.
- **Why:** Rooting another player is player-versus-player play.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `bug fixed: Hold obeys the PvP flag: a player's Hold roots no one where PvP is off` (packages/server/tests/spells.test.ts); `a player's Hold roots another player where PvP is on`; `bug fixed: a monster's Hold still roots a player where PvP is off` (packages/server/tests/spells.test.ts)

#### Your own spell no longer shields you from others
- **Kind:** Bug fixed
- **What you notice:** Standing in your own harmful spell, or a vehicle-blocked Morph, Nature Shift, Smoke Bomb or Hold, no longer stops other spells from reaching you that frame.
- **1.6:** Each of those cases left the whole collision handler, so FX in later slots were never checked.
- **SSO:** Such a case skips only that FX; the others are still checked.
- **Why:** An `exit` meant for one spell was never meant to cancel the rest.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `bug fixed: your own harmful spell skips only itself; a later FX still lands on you` (packages/server/tests/spells.test.ts)

#### A buff cast again refreshes it
- **Kind:** Bug fixed
- **What you notice:** Casting Stone Skin, Magic Shield or Argon's Fist again while it runs restarts its time; it never adds to the bonus or the time. A Purple Potion's Argon's Fist works the same way.
- **1.6:** Stone Skin added 1 to the defense bonus and 30 times its power to its counter on each cast, Magic Shield added 70 times its power, and Argon's Fist added 400 frames, so recasting stacked them. Hold and Firesword were set, not added.
- **SSO:** Each counter takes the longer of what is left and the new cast's time, and Stone Skin's bonus is 1.
- **Why:** Stacking turned repeated casts into an unbounded defense bonus; Hold and Firesword show the refresh the spells were meant to have.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`, `argonsFist`), `packages/server/src/systems/inventory/items.ts` (`useIntent`)
- **Pinned by:** `bug fixed: a buff cast again restarts its time and never adds: Stone Skin, Magic Shield, Argon's Fist` (packages/server/tests/spells.test.ts)

#### Radar reports a player once
- **Kind:** Bug fixed
- **What you notice:** A Radar passing over a player prints one line about them.
- **1.6:** The Radar branch ran on every frame of its animation, sending a chat line each time (5 in SSO, where the FX steps twice a frame).
- **SSO:** Each Radar reports each player it touches once.
- **Why:** A wall of repeated lines was a side effect of the frame loop, not the spell.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `bug fixed: Radar on a player sends one line` (packages/server/tests/spells.test.ts)

#### Meteor hits a monster twice
- **Kind:** Bug fixed
- **What you notice:** A Meteor hits a monster on both of its impact frames.
- **1.6:** Monsters were hit on Meteor's frames 13 and 19, but the first hit started a 16-frame lockout that the second fell inside.
- **SSO:** The FX that set the lockout may hit again on a different hit frame; any other spell still waits it out.
- **Why:** The second hit frame was written to land.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`monsterHits`)
- **Pinned by:** `bug fixed: Meteor hits a monster on both its hit frames, 13 and 19`; `a second Meteor inside the lockout still misses: only the FX that set it hits again` (packages/server/tests/spells.test.ts)

#### A summon that cannot go ahead costs nothing
- **Kind:** Bug fixed
- **What you notice:** A summon on a full map (four live monsters) or on a tile a monster cannot stand on, a Raise Dead away from a grave or where fighting is off, says "You cannot summon here!" and spends nothing. Summon Creature still works where fighting is off, and Web, Illusionary Spikes and Holy Shield, which are harmful spells, get "You cannot cast harmful spells here!" there instead.
- **1.6:** Each summon's tests ran after SP and crystals were taken, and most failed silently.
- **SSO:** The summon is planned before the cost and refused with the existing line.
- **Why:** A summon that never appears should not be paid for.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`planSummon`, `castIntent`)
- **Pinned by:** `bug fixed: with four live monsters a summon is refused before SP and crystals are spent`; `bug fixed: a summon on a blocked tile is refused before anything is spent` (packages/server/tests/spells.test.ts)

#### Summons read a tile's own blocked entry; Raise Dead needs a fight map
- **Kind:** Bug fixed
- **What you notice:** Summon Creature, Holy Shield and a dropped Pig are refused only on a tile that is actually blocked; x1y1 is no longer blocked because x1y10 is. Raise Dead is refused where fighting is off.
- **1.6:** The blocked test looked for "x<X>y<Y>" without its closing `*`, so a short tile name matched the start of a longer one. Web, Spikes and Holy Shield tested the no-fight flag; Raise Dead did not, so a hostile Zombie could be raised in town.
- **SSO:** The test reads the tile's own entry. Raise Dead joins the no-fight test; Summon Creature does not, as its Pig or Cow harms no one.
- **Why:** The missing `*` was a typo; a Zombie in town is the harm the other summons' test prevents.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`npcBlocked`, `planSummon`, `summonPig`)
- **Pinned by:** `bug fixed: the summons read a tile's own blocked entry: x1y1 is open when only x1y10 is blocked`; `bug fixed: Raise Dead is refused where fighting is off; Summon Creature is not` (packages/server/tests/spells.test.ts); `bug fixed: pig drop reads the tile's own entry, so x1y1 is open when only x1y10 is blocked` (packages/server/tests/pigs-orbs-webs.test.ts)

#### Spell books ask for the right Dexterity
- **Kind:** Bug fixed
- **What you notice:** The Argon's Fist Book needs Dexterity 10 and every Bolt book 24.
- **1.6:** The table spelt "Argon's First", so the book matched nothing and needed 1, and its Bolt row matched only a book named exactly "Bolt Book".
- **SSO:** The rows read "Argon's Fist" and `contains` "Bolt" (Firebolt's later row still wins for Firebolt books).
- **Why:** Both were typos.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`bookDex`)
- **Pinned by:** `bug fixed: the Dex table's typos: Argon's Fist Book needs 10, any Bolt book 24` (packages/shared/tests/spells/spells.test.ts)

#### Books teach what they say, and stay when they teach nothing
- **Kind:** Bug fixed
- **What you notice:** The Radar Book teaches Radar, and a book with no picture is read like any other. A book for a spell you know, or a combat book at 77 or more, says so and stays in your bag. Reading a Bolt Book uses up that book. A combat book never takes a skill past 77.
- **1.6:** The book routine had no line for Radar or Haste. The Poison Dart Book had no inventory picture, so using it stopped before reading. The server removed the first bag line containing "<name>-" before the routine ran, so a book that taught nothing was lost and a Bolt Book could use up a Firebolt Book above it. A combat book added `1 + random(5)` below 77, reaching up to 82.
- **SSO:** Radar and Haste have book rows; any book can be read; the book read is the one used up, and only when it teaches something; a combat book stops at 77.
- **Why:** Each was an omission or an ordering slip; 77 is the limit the book routine tests.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`runBook`, `SKILL_BOOK_CAP`), `packages/server/src/systems/spells/learn.ts` (`readBook`)
- **Pinned by:** `bug fixed: the Radar and Haste books teach their spells`; `bug fixed: combat books add 1 + random(5) below 77 and stop at 77` (packages/shared/tests/spells/spells.test.ts); `bug fixed: reading a Bolt Book uses up that Bolt Book, not a Firebolt Book above it`; `bug fixed: a book is kept when the spell is already known`; `bug fixed: a skill book is kept when the skill is 77 or more and it teaches nothing`; `bug fixed: a book with no picture is read like any other book`; `bug fixed: the Radar Book teaches Radar` (packages/server/tests/spells.test.ts)

#### The spellbook is saved in full
- **Kind:** Bug fixed
- **What you notice:** Every spell you learn stays in your spellbook across saves and logins, Identify and the thirtieth line onward included. Clicking the list no longer drops a line.
- **1.6:** The save wrote at most 29 lines as encode ids, and Identify had none; the list was rebuilt from the save before each save and learn and on every click.
- **SSO:** Spellbooks are saved by name with no line limit (migration 34 lifts the table's 29-line check), and the client keeps its list as the server sent it.
- **Why:** Losing learned spells on save was a limit of 1.6's encoding, not a rule.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`savedSpellbook`), `packages/client/src/ui/spellbook.ts` (`createSpellbook`)
- **Pinned by:** `bug fixed: the saved spellbook keeps every spell, Identify and the 30th line included` (packages/shared/tests/spells/spells.test.ts); `bug fixed: a click keeps the list as it is, a learned Identify included` (packages/client/tests/spells.test.ts); `bug fixed: after a relog the spellbook is kept, Identify included` (packages/server/e2e/spells.test.ts)

#### Monster spells reach you where PvP is off, spells provoke, and only monsters block monster spells
- **Kind:** Bug fixed
- **What you notice:** On a fight map with player fighting off, a monster's harmful spell hurts you. Hitting a Passive monster with a harmful spell provokes it, as a melee hit does. A player whose name contains "18" no longer stops the monsters' spells.
- **1.6:** Every spell on a player passed the PvP check, monsters' too. Only melee set the provoked flag. Any cast whose caster's name contained "18" (meant for monster sprites 180-183) blocked monster spells for 30 frames.
- **SSO:** The PvP check spares only players' spells; a player's harmful spell on a Passive monster provokes it for everyone on the map; only a monster's own cast sets the block.
- **Why:** The PvP flag is about players fighting players; the "18" test was a shortcut for monster casters.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`, `monsterHits`), `packages/server/src/systems/spells/fx.ts` (`isMonsterCaster`, `placeQueued`)
- **Pinned by:** `bug fixed: the Snow Serpent's Whirlwind drains you with PvP off too: the flag is for players' spells`; `bug fixed: a player's harmful spell provokes a Passive monster for everyone here`; `bug fixed: a player with 18 in the name does not block monster spells` (packages/server/tests/spells.test.ts)

#### A spell kill says "You have become more powerful!"
- **Kind:** Bug fixed
- **What you notice:** Levelling up from a spell kill prints the same line as a melee kill.
- **1.6:** The spell path had its own line with a stray "a": "You have become a more powerful!"
- **SSO:** Both paths use the melee line. The spell XP table and the missing kill skill gain are unchanged; the kill broadcast is a separate fix (see [An Overlord killed by a spell is announced](#an-overlord-killed-by-a-spell-is-announced)).
- **Why:** A typo.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`checkForDead`)
- **Pinned by:** `bug fixed: a spell kill pays the spell XP table and the melee level-up line` (packages/server/tests/spells.test.ts)

#### Spell heals stop at a monster's own hit points
- **Kind:** Bug fixed
- **What you notice:** Healing a monster with a spell never takes it past its full hit points: a Pig stays at 1.
- **1.6:** HP was capped after a spell from a table that defaulted to 200 with a few named exceptions, so most monsters could be healed far above their maximum.
- **SSO:** The cap is the species' own hit points; the separate `healCap` column is gone from the monster data.
- **Why:** The cap was a maximum-HP check with an incomplete table.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`checkForDead`)
- **Pinned by:** `bug fixed: a spell heal stops at the monster's own hit points: a Pig stays at 1` (packages/server/tests/spells.test.ts)

#### An Overlord killed by a spell is announced
- **Kind:** Bug fixed
- **What you notice:** Killing the Overlord with a spell sends "*** ** * All hail <you> who has rid the world of an evil overlord!" to everyone, as a melee kill does.
- **1.6:** Only the melee kill routine sent the kill broadcast; the spell kill routine paid XP and dropped loot but announced nothing.
- **SSO:** The spell death check sends the `monsters.json` `rules.killBroadcasts` line to every player who does not ignore the killer, as the melee kill does. Kill skill gain stays with melee, since it follows the weapon.
- **Why:** The announcement celebrates the Overlord's death, not the way it died.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`checkForDead`), `packages/server/src/systems/world/tick.ts` (`tick`)
- **Pinned by:** `bug fixed: an Overlord killed by a spell is announced to everyone who hears the killer` (packages/server/tests/spell-kill-broadcast.test.ts)

#### A Shark is not a Ghoul to fire spells
- **Kind:** Bug fixed
- **What you notice:** Firebolt hurts a Shark instead of healing it, and a Fireball does full damage to it.
- **1.6:** The monster hit check looked for text such as "45-" in the monster's picture name. The Shark's picture 445 contains "45-", so it healed from Firebolt and took only `random(3)` from a Fireball, like the Ghoul (body 45). The same text tests for "36-", "47-", "61-" and "90-" would have caught any body ending in those digits.
- **SSO:** The hit check compares the body number exactly.
- **Why:** The text test caught a body number it was never written for.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spellHitOnMonster`, `memberBody`)
- **Pinned by:** `bug fixed: a Shark (body 445) is not healed by Firebolt like a Ghoul (body 45)`; `bug fixed: a Shark takes a Fireball's full damage; a Ghoul takes random(3)` (packages/shared/tests/spells/body-numbers.test.ts)

### vehicles

#### Airship landing pads work on map rows 10–12
- **Kind:** Bug fixed
- **What you notice:** You can build and unboard an Airship on `J2` landing pads on rows 10 to 12 of a map, just as on rows 1 to 9.
- **1.6:** The dock check read fields 1–12 of the `#`-delimited map record, where fields 10–12 held non-tile data instead of layer-1 rows, so `J2` pads on rows 10–12 were never recognised.
- **SSO:** `isDock` reads layer 1 via `layer1Tile` across all 12 map rows (`1..MAP_HEIGHT`), as `isArenaTile` does for arena tiles.
- **Why:** Allows landing pads placed on the bottom three rows of a map to work for building and parking airships.
- **In the code:** `packages/shared/src/rules/vehicles/vehicles.ts` (`layer1Tile`, `isDock`)
- **Pinned by:** `a J2 pad on rows 10-12 counts for building and unboarding` (packages/shared/tests/vehicles/vehicles.test.ts); `a pad on row 10 counts for building` (packages/server/tests/vehicles.test.ts); `a pad on row 10 lets you off` (packages/server/tests/vehicles.test.ts)

#### Boats and Battleships can be built and sailed
- **Kind:** Bug fixed
- **What you notice:** A Boat Deed or Battleship Deed builds the ship on the open water you face. From the shore you face it and press Ctrl or click it to board, as its owner. It sails at walking pace, only on water. To get off, face a free tile of land and press Ctrl: you step ashore and the ship stays parked, bobbing at its mooring and facing the way you left it. Boarding, you face the way it lies. A battleship rider is body 56, a boat rider body 55.
- **1.6:** The whole boat flow was written (building on W1, N1, D2 or I2, boarding, parking, and the lines), but the deed handler exited before calling the builder, so the deeds did nothing. Nothing gave a ship a water-only walk grid, so it could have sailed over land, and the cast had no body-55 or body-56 frames.
- **SSO:** The deeds build their ships. A ship moves on its own grid: layer-1 tiles flagged `sea` (W1, N1, D2, I2, V2), read as sea monsters read them, so the shoreline art drawn on layer 2 over the water does not stop it. It blocks like a walker, as 1.6 wrote it, and a parked ship blocks too. Getting off needs a tile a walker could step onto: walkable, not an exit, and free of players, monsters and blocking items. 1.6 checked a fixed list of ground tiles. The lines are 1.6's, except that a battleship is called a battleship and not a boat. The rider art (`packages/data/build/art/ships.ts`) is built from the docked BoatPic and BattleshipPic, as 1.6's Airship rider frames reuse AirshipPic: east is the docked sprite, west its mirror, and north and south are cut from its own pixels, so a ship looks the same parked and ridden, on the same pixels (1.6 pastes a ground picture 1 px into its tile, and the frames allow for it). It rides a slow swell: F1 to F4, each held 0.4 s (`SHIP_SWELL_TICKS`), standing or sailing, where the Airship's frames change every tick. A parked ship bobs too: it draws as its rider's frame on the same clock (`mooredShipMember`), so boarding keeps the swell's phase. It keeps the facing it was built or left with (`ground_items.facing`, sent as `GroundView.facing`; none faces east, the docked picture's way), and its rider takes that facing on boarding, so boarding moves no pixel of it. Hulls, sinking and arenas follow [Vehicles have their own hull](#vehicles-have-their-own-hull) and [Arenas are for players on foot](#arenas-are-for-players-on-foot).
- **Why:** The ships were designed, written and sold as deeds in 1.6, and stopped short only of being switched on ([#2](https://github.com/jberlyn/second-star-online/issues/2)). Without a water grid a ship would cross land, and a fixed tile list would miss newer tiles.
- **In the code:** `packages/shared/src/rules/vehicles/vehicles.ts` (`shipDeedCheck`, `shipUnboardCheck`, `VEHICLE_BODY`), `packages/shared/src/rules/core/walk.ts` (`shipWalkGrid`), `packages/server/src/systems/vehicles/vehicles.ts`, `packages/server/src/systems/movement/movement.ts` (`walkWorld`), `packages/client/src/playfield.ts` (`bodyFrame`), `packages/server/migrations/20261121_44_ship_vehicles.sql`, `packages/server/migrations/20261121_46_parked_ship_facing.sql`
- **Pinned by:** `bug fixed: a Boat Deed builds the boat on the faced water and is used up`; `from the shore: you move onto the boat, body 55, a full hull of 60`; `a ship sails only on water, at walking pace`; `onto the faced shore: you step ashore and the boat parks with its hull`; `divergence: a ship crosses a map edge only onto water; an airship onto anything` (packages/server/tests/ships.test.ts); `bug fixed: the Boat and Battleship Deeds build their ships` (packages/shared/tests/housing/houses.test.ts); `SSO: a ship sails on sea tiles, shoreline art on layer 2 included`; `divergence: getting off needs a tile a walker could take, not 1.6's fixed list` (packages/shared/tests/vehicles/vehicles.test.ts); `bug fixed: a Boat Deed away from water says so and is kept` (packages/server/tests/houses-db.test.ts); `SSO: a ship rides a slow swell, F1 to F4 every 0.4 s, standing or sailing`; `SSO: a moored ship bobs on the riders' swell, facing the way it was left` (packages/client/tests/vehicles.test.ts); `SSO: a new ship faces out to sea, the way its builder looked`; `SSO: a ship parks facing the way it was left, and boarding takes that facing`; `SSO: a ship parked before facing was kept, or placed by an operator, faces east` (packages/server/tests/ships.test.ts); `SSO: a parked ship's facing round-trips; none faces east; nothing else is allowed` (packages/server/tests/vehicles-db.test.ts); `the east frame lands on the docked picture's pixels, so boarding moves nothing` (packages/data/tests/assets.test.ts)

#### A rider can see whose vehicle it is
- **Kind:** Bug fixed
- **What you notice:** Riding an airship, boat or battleship, clicking a parked vehicle (or pressing Ctrl facing one) tells you whose it is, "You see Bob's battleship.", as it does on foot. It never boards it.
- **1.6:** The airship click returned before any text while you rode an airship, so clicking another vehicle from aboard did nothing.
- **SSO:** `boardCheck` answers `see` for any rider, so the server sends the same line a player on foot gets when not facing the vehicle.
- **Why:** Looking at things is harmless, and with boats and battleships parked along a shore, a sailor needs to tell whose ship is whose.
- **In the code:** `packages/shared/src/rules/vehicles/vehicles.ts` (`boardCheck`), `packages/server/src/systems/vehicles/vehicles.ts` (`vehicleClick`)
- **Pinned by:** `divergence: already aboard, a click only says whose it is` (packages/shared/tests/vehicles/vehicles.test.ts); `divergence: already aboard, a click on another airship says whose it is` (packages/server/tests/vehicles.test.ts); `divergence: a click on a parked ship from aboard says whose it is` (packages/server/tests/ships.test.ts)

#### The Battleship's cannon fires
- **Kind:** Bug fixed
- **What you notice:** Aboard a battleship, the attack key fires a cannonball straight ahead, one shot a press, with the `cannonball` sound and a broadside from the ship. Each shot uses one Cannonball from your bag ("You have no cannonballs!" without one), and the cannon takes about 5 seconds to reload. The ball flies from 48 px in front of the ship until it hits the first player, monster or vehicle in its way, reaches a tile an airship could not cross, or leaves the screen. It takes 14 to 16 off a player's HP, whatever their armour, or off the hull of a vehicle they ride, and the same off a monster. Where the map's PvP is off it passes over players, arena tiles included, and it never hits the ship that fired it. A parked vehicle stops it unharmed. The Cannonball item shows a smaller 13 px icon. A boat has no cannon.
- **1.6:** The cast handler could place `CannonballL/R/U/D` and `Battleship CannonballL/R/U/D` 48 px from the caster with the `cannonball` sound and a `kill1` flash, and the spell collision took 9 + power + random(3) off a player's HP, but nothing ever cast them, so the battleship never fired.
- **SSO:** A battleship rider's attack poll fires `CannonballShot<dir>` (`pollCannon`) on a fight map, spending the first Cannonball. The shot moves 5 px a `stepFrame` call (10 px a drawn frame) and is tested along the stretch its shadow has crossed, from the edge of the ship's tile, so it neither steps over something right beside the ship nor hits someone standing in the next row. It never counts as an arena hit, as [arenas are for players on foot](#arenas-are-for-players-on-foot); a sinking it causes is a kill like any other. The numbers are code constants (`CANNON_RELOAD_FRAMES`, `CANNONBALL_OFFSET`, `CANNONBALL_STEP_PX`, `cannonDamage`). The shot's art and the new icon are made by `packages/data/build/art/cannonball.ts` from the 1.6 icon; the 1.6 frames and icon stay in the atlases.
- **Why:** The battleship was built for its cannon, and 1.6 wrote all but the trigger ([#2](https://github.com/jberlyn/second-star-online/issues/2)). Ammunition and a reload keep shelling costly, and a fixed damage, like the hulls', makes a ship's fight depend on the ship and not on its rider's level.
- **In the code:** `packages/shared/src/rules/vehicles/cannon.ts`, `packages/shared/src/rules/spells/spellfx.ts` (`placeFx`, `stepFx`), `packages/server/src/systems/combat/melee.ts` (`pollCannon`), `packages/server/src/systems/spells/cast.ts` (`fireCannonball`), `packages/server/src/systems/spells/collide.ts` (`cannonballHits`), `packages/server/src/systems/spells/fx.ts` (`placeQueued`), `packages/client/src/playfield.ts` (`shownFrame`), `assets/added/fx/`, `assets/added/items/CannonballBag.png`
- **Pinned by:** `bug fixed: the attack key fires a cannonball 48 px out along the facing, spending one`; `SSO: one shot a press, and none again until the 5 second reload ends`; `SSO: with no Cannonball nothing fires, said once a press`; `SSO: it stops at the first player and takes 14-16 HP off them, armour or not`; `SSO: aboard, the shot comes off the hull, and running it out sinks the ship`; `SSO: where the map's PvP is off it passes over players, even on arena tiles`; `SSO: it hits a monster for 14-16, whatever its defense`; `SSO: it hits a monster right beside the ship, short of where the ball appears`; `SSO: it does not hit someone in the next row as it passes`; `SSO: it stops at a tile an Airship cannot cross` (packages/server/tests/cannon.test.ts); `SSO: a cannonball does 14 to 16`; `SSO: the shot moves 5 px a step and spins a frame each drawn frame`; `SSO: the Cannonball shows its 13 px picture in the bag and on the ground` (packages/shared/tests/vehicles/cannon.test.ts); `SSO: a cannonball shot plays cannonball on 4, shows the rider's firing frames and stops on fxend` (packages/client/tests/spells.test.ts)

### world

#### An exit to a missing map leaves you where you are
- **Kind:** Bug fixed
- **What you notice:** Stepping on an exit whose map is not there (or that has no destination set) leaves you on it and says "You cannot go that way." once, as a blocked edge does.
- **1.6:** A missing map sent you to the start map's (5,5) and reloaded the whole map.
- **SSO:** The exit is refused; nothing is saved or reloaded.
- **Why:** An unfinished or broken exit should not teleport players across the world.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`takeExit`)
- **Pinned by:** `bug fixed: an exit with no target, or to a missing map, leaves you on it and says so once` (packages/server/tests/worldedit.test.ts)

#### Walking off the screen's edge is stopped by a wall or a missing map
- **Kind:** Bug fixed
- **What you notice:** You cannot walk off the edge of the screen when the matching tile on the next map is a wall or water, or when there is no map beyond the edge; you turn to face the edge and stay, as you would at a wall, and read "You cannot go that way." once for the key press.
- **1.6:** The step that crossed the edge never checked the tile it landed on, so you could arrive inside a wall or on water. With no map beyond, the server's empty map reply warped you to the start point and reloaded the map.
- **SSO:** The server checks that the next map exists and that the wrapped tile is walkable on it (the Airship's grid when you ride one, and water only aboard a boat or battleship). Otherwise the crossing is refused; others see you turn. The line, SSO's own, prints once a press like the web line (not again when the key comes up and steps sent while it was held are still checked), so a player at the edge of the world knows it is not a bug.
- **Why:** Every other step checks its destination; skipping the check on an edge let players walk into walls, and the edge of the world should feel like a wall rather than a teleport.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`crossMapEdge`)
- **Pinned by:** `bug fixed: an unwalkable wrapped tile refuses the crossing, as a wall would`; `bug fixed: an edge with no map beyond is refused, as a wall would`; `SSO: a refused edge says why, once a press`; `SSO: a refused edge is not said again on release, by steps still queued`; `walking off an edge onto an existing neighbour keeps the wrapped tile` (packages/server/tests/world.test.ts); `bug fixed: walking off an edge with no map beyond is refused, as a wall would` (packages/server/e2e/login-and-walk.test.ts); `bug fixed: a refused crossing is a turn the others on the map see`; `bug fixed: a rider's crossing tests the wrapped tile on the Airship grid` (packages/server/tests/world.test.ts)

## Kept on purpose

1.6 bugs that SSO keeps because fixing them would change the game's design rather than correct a mistake.

### Every new character starts with 20 hit points and 20 spell points
- **Kind:** Kept on purpose
- **What you notice:** the character you build always begins at HP 20/20 and SP 20/20, whatever the class, including Fighters, whose creation screen showed 0 SP.
- **1.6:** The creation screen rolled HP as Strength plus a random number up to Stamina and worked out SP (0 for a Fighter), then threw the rolls away and saved the fixed numbers 20, 20, 20, 20.
- **SSO:** The same: every class starts at 20/20/20/20.
- **Why:** Rolled vitals would reward deleting and remaking a character until it rolled the best health. If starting vitals change, each class would get fixed values as a balance change, never a roll.
- **In the code:** `packages/shared/src/rules/progression/creation.ts` (`startingCharacter`)
- **Pinned by:** `kept on purpose: vitals are the literal 20/20/20/20 for every class, Fighter included` (packages/shared/tests/progression/creation.test.ts)

### A map holds four monsters
- **Kind:** Kept on purpose
- **What you notice:** Nothing: a map's roster has four slots, so no screen ever holds more than four spawned monsters.
- **1.6:** Spells and arrows looped over five monster sprites but melee over four, and code for a fifth roster slot sat switched off. No map ever filled a fifth slot and it never spawned.
- **SSO:** Each map has exactly four roster slots (sprites 180-183), in the World Editor, the protocol and the database.
- **Why:** Four monsters a map is the game as it was played and designed; the fifth slot's code was a leftover, not an intended feature, so it is not added.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`MonsterSlot`)
- **Pinned by:** `kept on purpose: slot 5 never spawns: a roster has four slots` (packages/server/tests/monsters.test.ts)

### NPC windows open from anywhere on the screen
- **Kind:** Kept on purpose
- **What you notice:** Clicking an NPC anywhere on your screen opens its window, however far away it stands.
- **1.6:** The click had no range check.
- **SSO:** The same: no range check.
- **Why:** NPCs walk, so a range would make a shopkeeper's window come and go as it wanders; clicking across the screen is how the game was played.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`)
- **Pinned by:** `kept on purpose: an NPC's Bio opens from anywhere on the screen` (packages/server/tests/npcs-trade.test.ts)

### Dying aboard an airship loses it
- **Kind:** Kept on purpose
- **What you notice:** If you die while riding an airship, boat or battleship, or its hull runs out, the vehicle is gone and no deed comes back. Your bag and gold stay with you. A faction head still drops on a PvP map.
- **1.6:** Death cleared the vehicle and switched the item and gold drop off. The body reverted to the walker late on each player's screen.
- **SSO:** The same, except the body reverts at once for everyone, on the server.
- **Why:** Taking a vehicle through a PvP area, or past monsters that cast spells, is a risk the rider takes; losing it is the price of dying there.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/server/src/systems/vehicles/vehicles.ts` (`vehicleDeath`)
- **Pinned by:** `kept on purpose: dying aboard an airship loses it and drops nothing; the faction head still drops`; `kept on purpose: a Lightning death aboard loses the airship too`; `SSO: the hull running out kills the rider; the airship is lost and everyone hears it` (packages/server/tests/vehicles.test.ts); `SSO: the hull running out sinks the boat and everyone hears it`; `a death aboard loses the ship and drops nothing` (packages/server/tests/ships.test.ts)

### Killing a wanted player never flags you
- **Kind:** Kept on purpose
- **What you notice:** Killing someone who is already wanted does not make you wanted. Any other player kill does, wherever the death happens, unless a Lightning game is running. An arena death never flags anyone.
- **1.6:** The killer was flagged only when the victim was not wanted and had last been hit by a player.
- **SSO:** The same, on the server, crediting the killer by id and only for a hit within the kill-credit window.
- **Why:** The wanted flag marks murderers, and hunting down a murderer is the game's form of justice, not murder. The flag follows the kill, not the map's PvP setting, because a murder is a murder wherever it happens.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`)
- **Pinned by:** `kept on purpose: killing a wanted player never flags the killer`; `an arena death never flags` (packages/server/tests/factions.test.ts)

### Standing in a Whirlwind drains 1 SP a frame
- **Kind:** Kept on purpose
- **What you notice:** While you overlap someone's Whirlwind your SP drops by 1 every frame, with no hit blink.
- **1.6:** The Whirlwind branch took 1 SP each frame and started no blink; the spell list describes it as "sucks the spell points out of a player".
- **SSO:** The same, though now only a player's Whirlwind is spared where PvP is off.
- **Why:** The steady drain over the whirlwind's short life is the spell's effect; one point per cast would make it useless.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept on purpose: Whirlwind drains 1 SP a frame of overlap, no flicker` (packages/server/tests/spells.test.ts)

### Firesword does nothing for a player without a sword
- **Kind:** Kept on purpose
- **What you notice:** Firesword on a player whose weapon is not a sword prints "You feel a warmth you haven't felt before, but feel it has not assisted you." and does nothing else. A recast on a sword restarts its time.
- **1.6:** The same; the spell is described as turning "an ordinary sword into a flaming sword".
- **SSO:** The same.
- **Why:** 1.6 wrote a line for exactly this case: the spell has nothing to set alight.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept on purpose: Firesword without a sword: the warmth line, no counter; a recast refreshes P·40` (packages/server/tests/spells.test.ts)

### The seed map and new maps do not save a respawn point
- **Kind:** Kept on purpose
- **What you notice:** Only maps with **SAFE AREA**, **INDOOR** and **NO PVP** all ticked (O-O-O) save your respawn point. The seed map and a new World Editor map's defaults do not; houses' and guild halls' interiors and the Church do.
- **1.6:** The same rule, and no original map was O-O-O, so the respawn point never moved on its own. Operators built shrines: an exit to a small hidden O-O-O map whose arrival tile is an exit straight back, which saved the point as the player passed through.
- **SSO:** The same rule. A new character's respawn point is the starting map (see [Every character has a respawn point](#every-character-has-a-respawn-point)), and shrines work as they did.
- **Why:** Saving on an outdoor fighting map would move every player's respawn point as they walked about, and operators' shrines and tutorial islands depend on only O-O-O maps saving it.
- **In the code:** `packages/server/src/systems/world/world.ts` (`enterRoom`)
- **Pinned by:** `kept on purpose: the seed map and new-map defaults do not save a respawn point`, `SSO: a tutorial island keeps new players until they leave through a shrine, and nothing sends them back` (packages/server/tests/world.test.ts)

### Raise Dead's Zombie rises on the tile below the grave
- **Kind:** Kept on purpose
- **What you notice:** Clicking a grave, or the tile just below one, raises the Zombie on the tile below the grave.
- **1.6:** `RaiseDead` set a drop-down flag on a grave click and a stay-here flag on a click below a grave, and placed the Zombie below the grave for both.
- **SSO:** The same; the blocked-tile and no-fight tests are fixed (see the spells bug fixes).
- **Why:** The two flags show the drop below the grave was designed, and graves are not tiles a monster stands on.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`planSummon`)
- **Pinned by:** `kept on purpose: Raise Dead raises the Zombie on the tile below a grave, from the grave or the tile below` (packages/server/tests/spells.test.ts)

### Passive monsters heal passers-by
- **Kind:** Kept on purpose
- **What you notice:** A Passive monster you have not provoked, such as Acrostia, casts its heals and buffs on you.
- **1.6:** The heal and buff handlers had their own branch for a Passive, unprovoked monster that aimed the spell at the player.
- **SSO:** The same.
- **Why:** The branch was written on purpose: friendly healers tend to travellers.
- **In the code:** `packages/server/src/systems/spells/monsterspells.ts` (`castOne`)
- **Pinned by:** `kept on purpose: an unprovoked Passive Acrostia casts Major Heal at you` (packages/server/tests/spells.test.ts)

### A monster's Fireball or Wind Wave flies in a random direction
- **Kind:** Kept on purpose
- **What you notice:** A monster's Fireball or Wind Wave leaves it in one of the four directions at random, not necessarily at you.
- **1.6:** The handlers drew `random(4)` for the direction.
- **SSO:** The same.
- **Why:** The random spray is how those monsters were written to fight; aiming would make them far deadlier.
- **In the code:** `packages/server/src/systems/spells/monsterspells.ts` (`castOne`)
- **Pinned by:** `kept on purpose: a monster's Fireball flies in a random(4) direction from it, not at you` (packages/server/tests/spells.test.ts)

### Alchemy sand is a tool and is never used up
- **Kind:** Kept on purpose
- **What you notice:** You mix a potion and the sand is still in your hand afterwards. The Potion Bottle and the crystal are used up.
- **1.6:** The sand only had to be held, which can look like a bug in a game where every other ingredient is used up.
- **SSO:** The same. Every craft uses up its materials and keeps its tool: the Blacksmith Hammer, the Saw, and for alchemy the held sand. Shops price sand at 100 to 200 gold against 23 to 35 for a potion, which fits a tool rather than a material. Operators can change those prices.
- **Why:** Using up the sand on every mix would make alchemy cost far more than it earns.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startMix`, `finishCraft`)
- **Pinned by:** `kept on purpose: completion takes the bottle and the crystal; the held sand is a tool` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: alchemy takes the bottle and crystal at completion; the sand stays in hand` (packages/server/tests/craft.test.ts)

## Server authority and exploits

Changes that move authority from the client to the server and close exploits that let a player harm the server or other players, by system.

### Server-side admin

#### Only the server can warp, jail, push or kick
- **Kind:** Exploit closed
- **What you notice:** Warps, jail, pushes and kicks come from validated game actions or administrator commands.
- **1.6:** Any client could send messages that warped, pushed, jailed or disconnected another player; jail release was a self-warp.
- **SSO:** Only the server applies these effects after validating the action or command.
- **Why:** Peers could otherwise teleport, jail or disconnect other players.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminWarp`, `handleAdmin`), `packages/server/src/systems/movement/push.ts` (`pushOnMe`)
- **Pinned by:** `SSO: a player's admin command is answered as an unknown one, privately, and does nothing`; `/warp echoes and moves the target to the map and tile`; `/kick echoes, then the target reads the kick line and is disconnected with 1.6's kick alert` (packages/server/tests/admin.test.ts); `a hit prints the shove line to the victim only and moves it one step` (packages/server/tests/push.test.ts); `SSO: no client message warps, pushes, jails, kicks or pays another player` (packages/shared/tests/ledger-pins-a.test.ts)

#### Server-side roles, admin commands and editors
- **Kind:** Exploit closed
- **What you notice:** Administrative commands and editing are available according to your account's role; operators can inspect an audit trail.
- **1.6:** Administrative gates lived in the client, while the server accepted map, item, tile and ban-list writes without checking authority.
- **SSO:** Each account's role grants permissions, and the server checks the permission for each command and editor. Editor writes are validated and versioned. Admin commands that act on a player or the world (not `/inventory`, `/location` or `/banlist`, and `/iplookup` only when the player is online), world and NPC editor saves, setting changes and role changes are recorded in `audit_log` with actor, command, target, before and after; newspaper saves are not recorded; `bun run admin:audit [n]` reads it.
- **Why:** Without server checks anyone could rewrite the world and ban lists.
- **In the code:** `packages/shared/src/rules/admin/permissions.ts` (`can`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/systems/admin/worldedit.ts` (`applySave`)
- **Pinned by:** `an administrator holds every permission and an account with no role none` (packages/shared/tests/admin/permissions.test.ts); `SSO: a player's admin command is answered as an unknown one, privately, and does nothing` (packages/server/tests/admin.test.ts); `a role edit applies to everyone online who holds it at once, and is audited` (packages/server/tests/roles.test.ts); `a map round-trips exits, signs, fog and header; versions are kept` (packages/server/tests/worldedit.test.ts); `a save writes the file and its old version and drops the stored ledger; a restart loads it` (packages/server/tests/npcedit.test.ts); `every admin action is in the audit log` (packages/server/e2e/admin-and-settings.test.ts); `SSO: /inventory, /location, /banlist and an offline /iplookup are not audited; an online /iplookup is` (packages/server/tests/ledger-pins-a.test.ts); `SSO: World Editor and NPC Editor saves are in audit_log; a newspaper save is not` (packages/server/tests/ledger-pins-e.test.ts)

#### Login and account-creation limits
- **Kind:** Exploit closed
- **What you notice:** Too many login failures, new characters or simultaneous connections from an address cause a temporary refusal.
- **1.6:** The game scripts did not limit password attempts or character creation. The Multiuser Server had a configurable total connection limit subject to its license; the archived configuration left that setting commented out.
- **SSO:** Failed logins are counted per address (IPv6 per /64) and account-and-address for five minutes, creations per address for an hour, and open connections per address. The settings `loginFailsPerIp` (20), `loginFailsPerAccount` (5) and `createsPerIp` (3), and the environment variable `SSO_SOCKETS_PER_IP` (10), set the limits; zero disables one. The respective messages are “Too many failed logins. Please wait a few minutes and try again.”, “Too many new characters from this address. Please try again later.” and “Too many connections from this address.” The last also closes the socket with code 4006. A role with `bypassLoginLimits` (moderators and administrators by default) gets past a spent address only while its account has no failed login from that address in the window: one honest try, not a run of guesses at a staff password. Such a role also stops counting toward open sockets after login. Only two password hashes run at once. Counters are in memory and reset on restart; an attempt counts before hashing, so simultaneous sockets cannot evade a limit. The original missing-name and wrong-password replies remain distinct.
- **Why:** Limits hinder password guessing, mass account creation and exhausting memory with password hashes.
- **In the code:** `packages/server/src/systems/admin/login-limits.ts` (`allowLoginFromIp`, `allowLoginToAccount`, `allowCreate`), `packages/server/src/game.ts` (`login`)
- **Pinned by:** `SSO: a staff account still gets in from a spent address`; `SSO: a spent address gets one try at a staff account, not a run of guesses` (packages/server/tests/login-limits-staff.test.ts); `20 failures from one address refuse the 21st, any account; the window ends them`; `5 wrong passwords lock the pair; another address and another account are free; a success clears` (packages/server/tests/login-limits.test.ts)

#### Staff chat membership enforced
- **Kind:** Exploit closed
- **What you notice:** Administrators and moderators can read and post staff chat (`-text`) in a dedicated colour; ordinary players cannot.
- **1.6:** Any client could request membership in the administrators' group, and only immortals could post.
- **SSO:** The server chooses who receives and can post to staff chat (both staff roles), and delivers it in `CHAT_COLOR.staff`.
- **Why:** Other players could otherwise listen to staff conversations.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`staffChat`)
- **Pinned by:** `a player's - line gets an explicit denial and clears input (no restore)`; `both administrators and moderators post to staff in CHAT_COLOR.staff; players excluded` (packages/server/tests/admin.test.ts); `the Staff page makes Mo a moderator at once; both staff roles post and read staff chat in CHAT_COLOR.staff` (packages/server/e2e/admin-and-settings.test.ts)

#### World editor exits and texts are checked
- **Kind:** Exploit closed
- **What you notice:** The world editor refuses invalid exits, long signs and headers, and unavailable tiles or monsters.
- **1.6:** Exit fields, signs and headers were free text written into the map file. An exit could name any map or tile, including one off screen.
- **SSO:** An exit is empty or has whole-number map coordinates and a tile on the map (1–17, 1–12). House-map coordinates may instead use matching `H1` or `H2` prefixes. Signs have at most 1,000 characters and headers 200. Tiles must be on the palette and monsters on the editor's lists. An exit with one field left blank is refused rather than read as 0, and the editor refuses it before sending, with the server's line (“An exit needs a whole-number map and a tile on the map.”).
- **Why:** The server validates editor writes before they change the world.
- **In the code:** `packages/server/src/systems/admin/worldedit.ts` (`saveError`, `applySave`), `packages/shared/src/rules/admin/worldedit.ts` (`exitFromFields`, `exitError`), `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`)
- **Pinned by:** `SSO: an exit needs whole-number map coordinates and a tile on the map, or matching H1/H2 prefixes`; `SSO: signs hold at most 1,000 characters and the header 200`; `SSO: tiles off the palette and monsters off the editor's lists are refused` (packages/server/tests/ledger-pins-a.test.ts); `the save is checked: palette codes, 12 rows of 17, listed monsters, ≤ 20 items, fog` (packages/shared/tests/admin/worldedit.test.ts); `bug fixed: an exit with one field left blank is no number, not map 0` (packages/shared/tests/admin/worldedit.test.ts); `bug fixed: an exit with a blank map field is refused before sending, with the server's line` (packages/client/tests/worldeditor.test.ts)

#### NPC editor checks its files
- **Kind:** Exploit closed
- **What you notice:** An administrator selects a listed NPC in the editor; invalid files are refused with a reason, and a successful save warns about lines that have no effect in play.
- **1.6:** Anyone could load a file by an unchecked NPC name. Save was gated by the client and an immortals-name lookup, and wrote arbitrary field content under the supplied name. Saving or loading before selecting a name used a leftover or empty name. A backtick truncated text and `*` or `^` broke the NPC bundle; item names, numbers and tags were unchecked.
- **SSO:** Load and save require an administrator in the editor and a name on its monster or NPC list; selecting no name sends nothing. The server checks each line and refuses backticks, `*`, `^`, tags other than the twelve upper-case tags used by the archive, second `|` separators, malformed or out-of-range numbers on `SEL|`, `BUY|`, `INV|`, `GLD|` and `TRN|` lines, unknown items, a second `GLD|`, more than 100 lines or lines over 255 characters. `INV|` chances start at 1; other numeric fields start at 0, and the inventory line accepts gold, crystals and fixtures as well as catalogue items and archived spellings. After “NPC has been successfully saved.”, warnings identify inert `FLG|` and `SPL|` values, and `TRN|` classes without a promotion branch. Each save versions the previous file.
- **Why:** Server validation prevents arbitrary file access and invalid data; warnings make silent original rules visible to operators.
- **In the code:** `packages/server/src/systems/admin/npcedit.ts` (`loadNpc`, `saveNpc`), `packages/shared/src/rules/admin/npcfile.ts` (`checkNpcFile`)
- **Pinned by:** `refused: backtick, * and ^`; `refused: unknown or lower-case tags, a second |, more than 100 lines, long lines`; `refused: unknown items, bad numbers, two GLD| lines`; `accepted: archived spellings, N Gold, N crystals, fixtures, BUY's ignored third field`; `warned: inert tags only; no line is outside a reader's window` (packages/shared/tests/admin/npcfile.test.ts); `a list name with no file loads empty; unlisted names, no name and players outside the editor get nothing`; `a refused save says why and changes nothing`; `a save replaces the file, drops the ledger, closes the NPC's windows and lists warnings under the alert`; `a save writes the file and its old version and drops the stored ledger; a restart loads it`; `a player's npcSave is ignored` (packages/server/tests/npcedit.test.ts)

#### Only server systems create items
- **Kind:** Exploit closed
- **What you notice:** Items come from game systems such as loot, crafting, shops, quests or operator actions.
- **1.6:** Multiple messages let clients ask the server to create items. An immortal's `/drop` accepted any Inventory cast member, including screen art, scripts, fields, saved copies, facing frames and junk, while refusing singular crystal names and some real items without Inventory members.
- **SSO:** Loot, gathering, crafting, shops, quests and admin create items using their own rules. An administrator's `/drop` and World Editor placements accept `N gold` or an Inventory cast member that is a catalogue item with an icon or a fixture such as a vault, chest, sign or door. They refuse non-item cast members and, like 1.6, items without Inventory members such as a bare Crate. Crystals take their singular names (see [Crystals are named in the singular](#crystals-are-named-in-the-singular)).
- **Why:** An arbitrary client request could mint items, and non-item cast members would produce objects the game cannot use.
- **In the code:** `packages/server/src/systems/admin/drop.ts` (`droppableName`, `handleDrop`), `packages/server/src/systems/crafting/craft.ts` (`craftStep`)
- **Pinned by:** `only administrators drop items or gold; moderators and players do nothing`; `/drop takes only Inventory cast members`; `SSO: a count from 1 to 9,999 on any stacking Inventory item` (packages/server/tests/inventory.test.ts); `placed items take /drop's names; a counted pile round-trips` (packages/server/tests/worldedit.test.ts); `SSO: every item intent names bag slots, counts or ground ids, never an item`; `SSO: the only free text a client sends is chat, mail, names and the editors' fields` (packages/shared/tests/ledger-pins-e.test.ts)

#### Peer sigils replaced by server events; peer kicks, warps and gold removed
- **Kind:** Exploit closed
- **What you notice:** Kicks, warps and transfers come from server-validated events.
- **1.6:** Several peer messages acted on any sender's word and could kick, warp or enrich another player.
- **SSO:** Typed server events replace those messages; the dangerous peer sigils are gone.
- **Why:** Any player could otherwise kick, warp or give gold to anyone.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminWarp`), `packages/server/src/systems/inventory/items.ts` (`goldIntent`)
- **Pinned by:** `SSO: no client message warps, pushes, jails, kicks or pays another player` (packages/shared/tests/ledger-pins-a.test.ts); `SSO: a player's admin command is answered as an unknown one, privately, and does nothing` (packages/server/tests/admin.test.ts); `bug fixed: a gold give says "A is giving you 50 Gold."`; `more than you have: 'You don't have enough gold!' for both paths` (packages/server/tests/inventory.test.ts)

#### No IP addresses exposed
- **Kind:** Exploit closed
- **What you notice:** IP lookups are available only to authorized staff.
- **1.6:** The server address lookup was open to everyone and `/IPlookup` was gated only by the client.
- **SSO:** Addresses stay server-side and lookup is restricted to staff. The login addresses the server keeps for IP bans are shown only to administrators.
- **Why:** Players' network addresses are private.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `SSO: a player's admin command is answered as an unknown one, privately, and does nothing`; `a moderator may run the moderation commands, but not IP bans or /setclass`; `moderators see bans and jails; administrators also see IP bans`; `/banlist <name>: standing, history and (administrators) addresses` (packages/server/tests/admin.test.ts)

#### NPC edits apply at once
- **Kind:** Architecture
- **What you notice:** Saving an NPC file applies its changes immediately and closes any open Bio or shop list for that NPC.
- **1.6:** The server reread NPC files on each buy, sale, gift and kill, but clients kept the map's copy for Bio, shop buttons, chatter and flags until the next map load. An open shop list remained unchanged; a buy used the name and the client-supplied price.
- **SSO:** The server holds NPC files, so a save changes all uses immediately. Open Bio windows and shop lists for that NPC close because their lines may no longer exist. A player shop's `set` and `remove` close them too when they move lines.
- **Why:** Per-client NPC copies were a peer-to-peer artefact; a stale list could otherwise buy by a line number the file no longer contains.
- **In the code:** `packages/server/src/systems/admin/npcedit.ts` (`saveNpc`, `closeNpcWindows`), `packages/server/src/systems/economy/playershop.ts` (`shopCommand`)
- **Pinned by:** `divergence: set closes the shopkeeper's open lists and Bio windows` (packages/server/tests/playershop-db.test.ts); `a save applies at once: flags, drops, an empty file` (packages/server/tests/npcedit.test.ts)

#### Inert admin tools
- **Kind:** Architecture
- **What you notice:** The inaccessible original monster-drop editor, minimap and other inert tools are absent; monster drops can still be edited as NPC `INV|` lines.
- **1.6:** SaveMonDrops, RPG, LoadMiniMap and ClearChest had no server handler. The big world map and AdminWarp movie were unreachable; the monster-drop editor's destination label did not exist, the minimap lacked its members and renderer, and the World Editor's weather list was off stage.
- **SSO:** These inert tools are not implemented and rain is not offered. The NPC editor supplies monster-drop editing through `INV|` lines.
- **Why:** Original features that never worked remain omitted.
- **In the code:** `packages/server/src/systems/admin/npcedit.ts` (`saveNpc`)
- **Pinned by:** `SSO: 1.6's inert admin tools have no message: SaveMonDrops, RPG, LoadMiniMap, ClearChest` (packages/shared/tests/ledger-pins-a.test.ts); `a save applies at once: flags, drops, an empty file` (packages/server/tests/npcedit.test.ts); `the Slime's drops are its INV| lines: INV|5 Gold:1 always drops 5 Gold` (packages/server/e2e/npc-editor.test.ts)

#### Admin set-class tool
- **Kind:** Architecture
- **What you notice:** An administrator can use `/setclass <name> <class name or 1-26>` on an online or offline character, and receives a confirmation such as “Bob is now a Ninja.”
- **1.6:** Six classes had no promotion entry: Swordsman, Brawler, Ninja, Warlock, Death Knight and Gladiator. Administrators changed class by editing the raw character file.
- **SSO:** The command accepts any of the 26 classes without regard to case and changes only the class code, not skills. Promotion rules are unchanged.
- **Why:** The raw file editor is removed, so operators need a replacement for the only original route to those classes.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `SSO: /setclass takes all 26 classes in any case, records before and after, and leaves skills alone` (packages/server/tests/ledger-pins-a.test.ts); `by name ignoring case and spaces, or by code` (packages/shared/tests/admin/admin.test.ts); `/setclass sets the class code by name or number`; `/setclass writes the class code, online or not` (packages/server/tests/admin.test.ts)

#### Admin commands say when a name is not online
- **Kind:** Architecture
- **What you notice:** An administrator receives a useful refusal when a command cannot act, after the original command echo.
- **1.6:** The client printed its echo and sent the request whether or not the target was online; malformed warp lines were sent unchanged and the administrator heard nothing further.
- **SSO:** The original echo is followed as applicable by “Bob is not online.”, “There is no character called Bob.”, warp usage for a non-tile coordinate, “You cannot ban yourself.”, “You cannot kick someone who outranks you.”, “You cannot do that to someone who outranks you.” or “You can only do that to someone you outrank.” Staff cannot kick someone who outranks them, nor use IP lookup, warp or warptome on them, and can ban, jail, mute or pardon only those they outrank (a role with `overrule` excepted); warpmeto still moves the staff member. `/ban` and `/jail` work on offline characters. IP bans are administrators' by default, and only the staff member who made a ban or jail, or a role with `overrule`, can change or lift it.
- **Why:** The server can report failed actions, and a senior staff member's address and editor session should not be controlled by a junior one.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `SSO: an offline name and a bad line get a line after the echo`; `SSO: a moderator cannot kick or ban an administrator`; `SSO: a moderator cannot look up, jail or mute an administrator`; `/ban flags the account and disconnects with the login refusal's text`; `an offline character can be jailed; the sentence waits for their login`; `a moderator changes only their own ban; an administrator changes any`; `a moderator may not ban, jail or pardon another moderator` (packages/server/tests/admin.test.ts)

#### Operators define the staff roles; unban is a chat command
- **Kind:** Architecture
- **What you notice:** The operator decides what each staff role may do. The Roles page of the Control Panel's Server Settings edits each role's name, rank and permissions (every command, tool and gameplay exemption is a box to tick) and adds or deletes roles; its Staff page gives an account a role or takes it away. A new server starts with Moderator (`moderator`) and Admin (`administrator`); an account with no role is an ordinary player. Staff can unban with `/unban <name> [reason]`, though only the staff member who made a ban, or a role with `overrule`, can lift it.
- **1.6:** Two fixed ranks: immortals, listed in an immortals file edited with the File Editor, and moderators. What each could do was written into the client. Unbanning meant removing a prefix from the character file.
- **SSO:** Roles live in the database's `roles` table and belong to accounts. A change applies at once to everyone online who holds the role, and the client receives only its permissions, to choose its menus; the server checks every request. At least one role must keep every permission, nobody can change their own role, and every role edit and assignment is audited. There is no in-game `/role` command; `bun run admin:role <name> <role|none>` makes the first administrator and is the way back in. Upgrading from 1.10 turns immortals into administrators and players into accounts with no role.
- **Why:** Different servers want different staff, and an operator should not need to change code to decide what a moderator may do. The File Editor is gone.
- **In the code:** `packages/shared/src/rules/admin/permissions.ts` (`can`), `packages/server/src/game.ts` (`roleSave`), `packages/client/src/ui/settings-roles.ts` (`createRolesPage`)
- **Pinned by:** `a role edit applies to everyone online who holds it at once, and is audited`, `some role always keeps every permission; your own role is not yours to change`, `immortal becomes administrator, player no role, and moderation rows keep role names` (packages/server/tests/roles.test.ts); `/role is gone: an administrator is told it is an unknown command` (packages/server/tests/admin.test.ts)

#### Banned players are told at once
- **Kind:** Architecture
- **What you notice:** A player banned while online is disconnected with “YOU ARE BANNED FROM PLAYING HERE ON THIS ACCOUNT!!” followed by when the ban ends (“Banned until 2026-11-20 14:00 UTC.” or “This ban is permanent.”), and sees the same alert on later login attempts. The reason a moderator gave is never shown to the player.
- **1.6:** Ban kicked the player to the title without text; the next login showed that alert. The server checked the password before the client's ban response.
- **SSO:** The account is flagged, an online player is disconnected with the alert, and later logins are refused with it after the password check. A timed ban lifts itself when it ends.
- **Why:** The server kick is reliable and the alert explains it; the end tells the player when to come back, while the reason stays an internal staff record.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/game.ts` (`login`)
- **Pinned by:** `/ban flags the account and disconnects with the login refusal's text`; `a banned account's login is refused with 1.6's alert until /unban` (packages/server/tests/admin.test.ts); `a timed ban refuses login with its end, and lapses on time` (packages/server/tests/moderation-db.test.ts)

#### Bans and jails carry a reason, a length and the maker's role
- **Kind:** Exploit closed
- **What you notice:** `/ban`, `/jail` and `/banip` take an optional duration (`30m`, `12h`, `7d`, `2w`, `perm`) and reason after the name, such as `/ban Berlyn 3d being a rude person`; without a duration the server settings decide. Bans, jails and pardons by a moderator reach players only. Only the staff member who made a ban or jail, or an administrator, can change its length or lift it.
- **1.6:** A ban was a prefix on the character file with no reason, end or author; any administrator could add or remove it.
- **SSO:** Each action stores its maker's account, name and role at that moment, the reason and the end; who may change it is decided by the maker's account, not the stored role. A re-ban by its maker or an administrator replaces the length; anyone else is refused with “Bob was banned by Alice; ask Alice or a senior staff member.” A lapsed ban or jail stops nobody.
- **Why:** Moderators could otherwise overwrite an administrator's ban with their own and then lift it, and tying the right to the maker's account means a later change of role does not change who may lift an old ban. Staff with different views settle them together rather than overriding each other.
- **In the code:** `packages/shared/src/rules/admin/moderation.ts` (`mayTarget`, `mayChange`, `parseModerationArgs`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/persistence/moderation.ts` (`recordModeration`)
- **Pinned by:** `regression: a moderator's /ban cannot overwrite an administrator's ban to lift it`, `a moderator changes only their own ban; an administrator changes any`, `a moderator may not ban, jail or pardon another moderator` (packages/server/tests/admin.test.ts); `a ban keeps its maker's role name at the time, and a demoted administrator's ban stays theirs` (packages/server/tests/moderation-db.test.ts)

#### Moderation history and /banlist
- **Kind:** Architecture
- **What you notice:** `/banlist` lists the bans, jails and mutes in force (and, for administrators, IP bans); bans page 10 at a time, while jails, mutes and IP bans show the first 10; `/banlist <name>` shows a character's standing, last ten moderation actions with their reasons and, for administrators, their login addresses; `/banlist <address>` (administrators) shows an address's ban and who has played from it.
- **1.6:** The bans lived in character files and a bans file, with no history and no in-game list.
- **SSO:** Every staff ban, unban, IP ban, jail, release, mute, unmute and pardon is a row in `moderation_log`, kept after the action ends. A ban, IP ban, jail or mute that runs out on its own gets a lift row too (`unban`, `unipban`, `unjail` or `unmute` by `system`, reason "Expired", dated when it ended), written once a minute and at startup, online or not.
- **Why:** Staff need to see why someone was banned and by whom before changing it.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/persistence/moderation.ts` (`moderationHistory`, `expireModeration`), `packages/server/src/game.ts` (`tick`)
- **Pinned by:** `moderators see bans and jails; administrators also see IP bans`, `/banlist <name>: standing, history and (administrators) addresses` (packages/server/tests/admin.test.ts); `SSO: a ban, sentence or mute that runs out is logged as ended by the server, online or not` (packages/server/tests/moderation-db.test.ts)

#### IP bans are checked, cover an IPv6 /64 and act at once
- **Kind:** Exploit closed
- **What you notice:** `/banip` accepts a character name (their last login address, or every address with `all`) or a valid address, and refuses anything else. Sessions from the address are disconnected immediately, and it cannot log in or create characters until the ban ends (30 days by default). Administrators are never stopped by an IP ban.
- **1.6:** `/BanIP` wrote any text to the bans file and the ban was never enforced.
- **SSO:** Addresses are stored in their standard form; an IPv6 ban covers the /64, matching the login limits. The server keeps each account's login addresses for `addressHistory`. The check runs after the password, so that an administrator behind a banned address can still log in.
- **Why:** Unvalidated text could ban nothing or an unintended address, an IPv6 user could step to a neighbouring address, and an operator must not lock themselves out.
- **In the code:** `packages/shared/src/rules/admin/moderation.ts` (`canonicalIp`, `ipKey`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/game.ts` (`login`, `create`, `refusal`), `packages/server/src/persistence/moderation.ts` (`noteAddress`)
- **Pinned by:** `an IP ban disconnects every session from that address except an administrator's`, `/banip <name> bans the latest address, or all of them; an administrator is never IP banned`, `divergence: an IP ban refuses a login from that address after the password` (packages/server/tests/admin.test.ts); `IP bans cover the IPv6 /64, refuse creation and resume, and never stop an administrator` (packages/server/tests/moderation-db.test.ts)

#### Administrators read what staff did with /auditlog
- **Kind:** Architecture
- **What you notice:** An administrator types `/auditlog <name> [count]` (default 10, at most 100) to see the newest staff actions taken by that character's account or done to that character, oldest first, such as `2026-11-18 09:14:02 UTC Mod /jail Bob (until 2026-11-18 09:44:02 UTC, "spamming")` or `2026-11-18 10:02:45 UTC King /setclass Bob: 1 -> 7`.
- **1.6:** There was no record of staff actions, so nobody could check what a GM had done.
- **SSO:** `auditTrail` merges the audit log (admin commands, editor saves, setting and role changes, `/chatlog`, `/cheatfile` and `/auditlog` looks) with the moderation log (bans, jails, IP bans and pardons, with their reasons and ends), leaving out the audit log's own copy of each moderation action. Matching by account covers all of a staff member's characters. Each lookup is audited. Moderators and players are told it is an unknown command.
- **Why:** Administrators need to review moderators' actions and a player's history without shell access to the server.
- **In the code:** `packages/shared/src/rules/admin/auditlog.ts` (`parseAuditlogArgs`, `auditlogLine`), `packages/server/src/persistence/admin.ts` (`auditTrail`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `an administrator sees what a moderator did and what was done to a player, with reasons; the lookup is audited`; `/auditlog is an administrator's: a moderator or a player is told it is unknown, and nothing is audited` (packages/server/tests/auditlog.test.ts)

#### Staff look characters up in a player hub, not their files
- **Kind:** Architecture
- **What you notice:** The Control Panel's **Characters** page finds characters by part of their name, online or not, and opens a player hub: class, level, vitals, stats and skills, where they are and their respawn point, gold, bank, bag, worn gear, vault, spellbook and houses, what is in force (ban, jail, mute, and IP bans on their addresses) with the moderation history, their newest chat lines and login addresses, and a link to their Activity Log timeline. Its buttons kick, ban, jail and mute, and lift each, with a length and a reason.
- **1.6:** Staff read a character by opening its text file in the File Editor, which also showed the password. The guide's `/view name` had no client. Moderation was typed in chat.
- **SSO:** The hub reads an online character from the live game, so it is never a save behind, and an offline one from the database; both show the same sheet. It needs the `characterView` permission (administrators by default), and the chat lines, addresses and IP bans in it need `/chatlog` and `/banip`, as their commands do (without `/banip` an IP ban in the history shows without its address, as on `/banlist`). Every hub read is written to the audit log. Each moderation button runs its chat command's own code, with that command's permission, rank checks and logs; a ban, jail or mute from the hub also needs a reason. Its Edit tab changes the character (see [Staff edit characters in the player hub, through the server](#staff-edit-characters-in-the-player-hub-through-the-server)).
- **Why:** Tracing abuse means seeing a player's state, moderation and history in one place, without file access (issue #26).
- **In the code:** `packages/server/src/systems/admin/characters.ts` (`characterHub`, `searchRows`, `liveSheet`, `storedSheet`), `packages/server/src/persistence/hub.ts`, `packages/server/src/systems/admin/commands.ts` (`moderate`), `packages/shared/src/rules/admin/characters.ts` (`hubArgs`), `packages/client/src/ui/characters.ts`
- **Pinned by:** `an online character's hub is read live, and reads the same from the database once they leave`; `the chat log and addresses come only with chatlog and banip; every read is audited`; `a player without characterView gets nothing and is written to the cheat log`; `Ban from the hub runs /ban: it is logged with its reason, the player is kicked and the hub shows it`; `each button needs its command's permission; the command's rank checks still apply`; `IP bans in force and the address in an IP ban's history row are /banip's alone` (packages/server/tests/characters.test.ts); `a ban needs a reason, asks first, then sends the length and reason and reloads when done` (packages/client/tests/characters.test.ts)

#### Staff edit characters in the player hub, through the server
- **Kind:** Architecture
- **What you notice:** The player hub's **Edit** tab changes a character's class, level, experience, HP, SP, hunger, faction, wanted flag, stats, skills, gold, bank, bag, worn gear, vault, spellbook, position, respawn point, sex and head, online or offline, with a required reason. The **Edits** tab lists every edit with who made it, why, and each value before and after, and undoes one.
- **1.6:** Staff changed a character by editing its text file in the File Editor. Nothing was checked, so a typo could break the character, and nothing was logged. Editing an online player's file was overwritten by their next save.
- **SSO:** Edits go through the authoritative server, never straight to the database. An online character changes in the live game, their client updates at once and they are saved straight away; a move warps them, and a new head redraws on their map without one. An offline character's saved record is rewritten in one transaction. Every value must be one the game could hold (stats 1–20, skills 1–100, items, spells and maps that exist, at most 15 vault lines); experience needed and HP and SP max follow the level, one point of each max per level, rather than being typed. Worn gear must follow the wear rules unless the admin ticks a logged override. Gold, items and position wait while the player trades or holds a casino seat (one kept after a dropped connection too), a jailed player or one in an editor cannot be moved, and only staff can be put on the jail map. An edit made over a stale hub is refused, including when a level change would recalculate experience, HP or SP that moved since. An item with its own storage (a Crate's `#id`) can be moved but never copied or typed in. Undo puts an edit's old values back only while every value it set is unchanged, the result still fits the character, and no gear it puts back breaks the wear rules. Edits need the `characterEditor` permission (administrators by default); each is kept in `character_edits` and the audit log, and the gold and items it moved are `admin` events in the activity log. Houses are not edited here yet (issue #36).
- **Why:** Fixing a character after abuse or an exploit should not need file access, and should never create a state the game could not produce (issue #26).
- **In the code:** `packages/server/src/systems/admin/character-edit.ts` (`prepareEdit`, `prepareUndo`, `applyLive`, `logEdit`), `packages/server/src/game.ts` (`applyEdit`), `packages/server/src/persistence/character-edits.ts`, `packages/shared/src/rules/admin/character-edit.ts` (`deriveEdit`, `editErrors`, `wearBreaks`, `undoConflicts`), `packages/client/src/ui/character-editor.ts`
- **Pinned by:** `an online edit lands on the live character, reaches their client and is saved at once`; `an offline edit is written to the database and is there at their next login`; `a value out of the game's limits, a stale hub and no reason are refused`; `gear that breaks the wear rules needs the override, which is logged`; `undo puts the old values back, and refuses once something it set has moved`; `a seat kept for a dropped blackjack player holds their gold and place`; `an item with its own storage can't be typed in or copied`; `undo refuses a state that no longer fits, and never puts back overridden gear silently`; `viewing is not editing: characterView alone gets no edit and is written to the cheat log` (packages/server/tests/character-edit.test.ts); `Save sends only what changed, with what the hub showed, after asking; then reloads` (packages/client/tests/characters.test.ts)

#### Operators change the game's content live, from the Control Panel
- **Kind:** Architecture
- **What you notice:** The Control Panel's **Content** page lists every item, monster, NPC file, spell, rule and text table, and changes, adds or removes them in a shared draft that goes live for every player at once when published, without a restart. A publish can be undone as a whole. An item or monster can be renamed for players (its `display`) or drawn with another's art (its `sprite`) while every copy players hold keeps working.
- **1.6:** Content was the server's and client's text files and Director casts. Changing it meant editing files by hand and restarting, with nothing checked, and a renamed item broke every copy already held.
- **SSO:** The 1.6 content ships in each release as the Classic pack, read from the release and never copied into the database; the operator's changes are a layer on top, stored per row with the pack row each was based on, so a release's fixes reach every row the operator has not changed and a changed row the release also changed shows a notice. Before anything goes live it is checked against the schemas, the key and name rules, the skills characters are saved with and the references between rows (NPC Editor saves included), then tried out in every rule. The client bundles no content: it fetches the published store by its hash at start and after each publish. An item's key never changes; players see its display name. It needs the `contentEditor` permission (administrators by default), and every publish, undo and pack-update answer is in the audit log.
- **Why:** Running a server means fixing and adding content without a code change or a restart, and without being able to break saved characters (issue #27).
- **In the code:** `packages/server/src/content/service.ts` (`ContentService`), `packages/server/src/content/validate.ts` (`checkStore`), `packages/server/src/content/rows.ts`, `packages/shared/src/content/store.ts` (`content`, `onContent`), `packages/client/src/content.ts` (`createContentSync`), `packages/client/src/ui/content-page.ts`
- **Pinned by:** `a published edit changes the store, and the publish swaps it in`; `undoes a publish as a whole`; `a changed row the operator customised keeps their version and shows a notice` (packages/server/tests/content-store.test.ts); `a publish swaps the store in, and the rules see it` (packages/client/tests/content.test.ts)

#### Removing content in use cleans up after itself
- **Kind:** Architecture
- **What you notice:** Removing an item or a monster on the Content page first shows where it is used (who holds copies, which maps spawn it, which shops, drops, recipes and quests name it), then asks what to clean up. By default an item players hold is retired: their copies stay and work, but no more can be made. An item can instead be purged (with gold back for each copy) or replaced, and a monster's spawns cleared or replaced and its live ones despawned.
- **1.6:** Removing an item or a monster meant deleting it from the files by hand. Copies players held, shops that sold it, drops that gave it and maps that spawned it were left naming something that no longer existed, with nothing to find or fix them.
- **SSO:** The cleanup goes into the draft with the removal and is checked like any change; what happens to the world runs when the draft is published, as part of the publish, and is logged in the activity log and the publish history. A reference nothing resolves (from a database edit or an older server) never crashes the game: an unknown item shows by its name with no picture, an unknown monster spawns as a stand-in with the Generic body and 1 HP, and both are listed on the Content page's Problems and printed at start.
- **Why:** Operators should be able to remove content without leaving broken references behind or breaking saved characters (issue #28).
- **In the code:** `packages/server/src/content/cleanup.ts` (`usesOf`, `cleanUses`), `packages/server/src/content/service.ts` (`draftRemoval`, `removals`, `problems`), `packages/server/src/systems/admin/content-world.ts` (`createContentWorld`), `packages/client/src/ui/content-usage.ts`
- **Pinned by:** `retiring (the default): copies stay and work, no more can be made, the content goes`; `purging: every copy goes, online and offline, with gold back for each held one`; `a monster: its roster slots clear, live ones despawn, its NPC file goes`; `stored references nothing resolves load, play and are listed as problems` (packages/server/tests/content-cleanup.test.ts); `Remove offers the cleanup with its defaults: remove the entries, retire the copies` (packages/client/tests/content-page.test.ts)

#### The server logs what players do with items, gold and their time
- **Kind:** Architecture
- **What you notice:** The Control Panel's **Activity Log** page shows a character's timeline (every item and gold movement, kill, death, level and skill gain, login with its address, logout and map change) and an item's flow (every movement of that item across all players, with totals gained and lost by type). A player or item named in a row opens their own timeline or flow.
- **1.6:** The server kept no record of what players did. Tracing a dupe, a scam or real-money trading meant asking players or reading character files by hand.
- **SSO:** Each system that moves a player's items or gold, or decides a kill, a death or a map change, logs one event per change: trades (both sides), drops, pickups (naming the player who dropped the item), gives, NPC and player shops, the bank, the vault, containers, crafting, gathering, using up an item, quest hand-ins, training, casino bets and wins, prizes, death drops, items breaking, monster loot and admin `/drop`. Levels, skills and class changes are compared once a tick. Items are recorded by name and quantity, not as individual copies. Events are buffered and written once a tick, like the chat log, to the `activity_log` table, which outlives deleted characters. Once a tick the server also compares what each player carries with what the log says they carry, and writes any difference as an **Unlogged change**, so a missed source or a dupe still shows up. Reading the log needs the `activityLog` permission, and every read is audited. Rows are kept for `activityLogRetention` (default 180 days).
- **Why:** Admins need to trace abuse, exploits and real-money trading: who gave what to whom, where an item came from and where gold went (issue #25).
- **In the code:** `packages/server/src/systems/admin/activity.ts` (`logActivity`, `checkHoldings`, `checkProgress`), `packages/server/src/persistence/activity.ts`, `packages/shared/src/rules/admin/activity.ts`, `packages/client/src/ui/activity-log.ts`, `packages/server/src/game.ts` (`activityQuery`)
- **Pinned by:** `a change no system logged is written as unlogged, once, and the ledger follows it`; `levels, classes and skills that went up are logged; the first check only notes them`; `a warp logs the map change, where it came from and why`; `a login names the address and a logout follows it, both on the character's timeline`; `reading the log needs its permission: a player or moderator is cheat-logged and gets nothing`; `every read is audited, a further page too` (packages/server/tests/activity.test.ts); `a player named in a row opens their timeline; an item opens its flow` (packages/client/tests/activity-log.test.ts)

### Server-side casino

#### Blackjack dealt, escrowed and settled by the server
- **Kind:** Exploit closed
- **What you notice:** Blackjack bids are held when locked, and leaving during a hand forfeits the stake to the opponent.
- **1.6:** Clients dealt their own cards, and a settlement message could name any winner and loser; no gold was held in escrow.
- **SSO:** The server deals from a 13-rank shoe (`1..9` and 4/13 `10`-value) and applies standard bust/draw outcome rules. Each bid is held from the purse at lock and excess is returned when the stake is set; saved gold includes the hold until settlement. Leaving mid-hand or disconnecting past the configurable grace, 30 seconds by default, forfeits the stake to the opponent, who sees “<user> has left the table!”. Returning within the grace restores the table.
- **Why:** A forged settlement could drain another player's gold or choose cards.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjBid`, `bjLeave`, `bjReturn`, `bjTick`)
- **Pinned by:** `divergence: gold drops at the lock, the excess returns when both lock, four cards P1 P1 P2 P2`, `divergence: mid-hand Leave forfeits the stake to the opponent` and `divergence: past the grace the stake is forfeit: the opponent gains, the dropped player's saved row loses the hold` (packages/server/tests/blackjack.test.ts); `a flush mid-hand writes gold + the held stake; a forfeit past the grace moves the stake in SQL` (packages/server/tests/casino-db.test.ts)

#### Checkers moves checked by the server
- **Kind:** Exploit closed
- **What you notice:** Only the seated player whose turn it is can make a legal step or jump.
- **1.6:** Any client in the group could send a move for either side's pieces.
- **SSO:** The server holds the board and turn and accepts only a legal move by the seated side on its turn, enforcing forced capture, multi-jump continuation, blocked-side loss, single start line, and Black moving first.
- **Why:** A forged message could move the other player's pieces or impersonate a seat.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `only on your turn, only the legal move; the new turn goes to both views` (packages/server/tests/checkers.test.ts); `forced capture and multi-jump: steps are blocked when a jump exists, and jumpFrom restricts to the jumping piece`; `men move forward only, kings four ways`; `the loser is the side with no piece on the board or no legal move` (packages/shared/tests/casino/checkers.test.ts)

#### Slot pulls paced by the 30-frame spin
- **Kind:** Exploit closed
- **What you notice:** A slot pull settles after the 30-frame spin and another cannot start while it is spinning.
- **1.6:** A client could send unlimited payout requests without starting the slot machine.
- **SSO:** The server accepts a pull only while the panel is open and idle and settles it 30 ticks later.
- **Why:** Trusting client timing allowed requests to be spammed and load the server.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`, `slotTick`)
- **Pinned by:** `the FX is queued at the player; the result comes 30 ticks later, not 29`; `a second pull mid-spin and a pull with the panel closed are ignored` (packages/server/tests/casino.test.ts)

### Server-side chat

#### Server-formatted chat and server-managed channels
- **Kind:** Exploit closed
- **What you notice:** Chat names and channel membership come from the server; an ignored player's messages are filtered for the reader.
- **1.6:** Clients built their own “X says …” text and could join administrator, guild and faction groups by hand.
- **SSO:** The server stamps the speaker and controls faction, guild and room membership. Each reader's ignore list filters what the ignored player's client sent in 1.6: say, `/me`, broadcasts, IMs, guild chat, the Overlord line, Radar and Inxition read-outs, and faction announcements. Staff chat is not filtered, so staff always hear each other. It also filters NPC replies relayed by that player, including quest slots 2–4, treasure rumours, faction-leader replies and their shop's stock list.
- **Why:** Client-supplied names and group joins allowed impersonation and eavesdropping.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/chat/rooms.ts` (`enterRoom`), `packages/server/src/systems/chat/ignore.ts` (`hears`)
- **Pinned by:** `goes to everyone on the map, the speaker included, in white` (packages/server/tests/chat.test.ts); `say and /me: the ignorer misses them, everyone else hears`; `broadcasts, by the speaker`; `an ignored sender's IM vanishes; the sender sees only the echo`; `a relayed aqs line (quests, rumours, leaders, shop list): the asker's ignorers miss it`; `the faction announcement, Radar and Inxition lines and the like`; `divergence: Guild Chat is your guild's room; losing the guild drops you silently` (packages/server/tests/im.test.ts); `staff chat has no house sender restriction, no muffling, and no ignore filtering` (packages/server/tests/admin.test.ts)

#### Chat rate limits
- **Kind:** Exploit closed
- **What you notice:** Repeated chat, IM, room, mail and board actions may be refused temporarily, with remaining time shown and the original input retained where applicable.
- **1.6:** Broadcasting had no cooldown because registration was forced on, and there was no flood control. A refused broadcast remained typed.
- **SSO:** Everyone uses the original unregistered broadcast cooldown of 1,000 frames (50 seconds) and its refusal. Local chat, `/me`, guild chat, IM, room lines, mail sends and board posts share a new 60-frame (3-second) cooldown. A line the house rule refuses still starts it, since it is logged and can rouse the NPCs' quest, treasure and faction replies. A refusal says “You cannot chat yet - N seconds remaining.” with seconds rounded up. Refused chat, IM and room text returns to its input; refused mail and board text stays open. A player-shop command is never said aloud, so it costs no cooldown and runs under one. Away replies do not use the cooldown. Lines are capped at 200 characters, there is no profanity filter, and all limits are operator settings.
- **Why:** Spam harms players and the server.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/chat/im.ts` (`imIntent`)
- **Pinned by:** `bug fixed: a command costs no chat cooldown and runs under one` (packages/server/tests/playershop-db.test.ts); `SSO: a line the house rule refuses still starts the cooldown` (packages/server/tests/chat.test.ts); `divergence: it shares the chat cooldown` (packages/server/tests/guilds.test.ts); `divergence: it shares the chat cooldown; a refused line goes back` and `divergence: room lines share the chat cooldown, refused back into the room's input` (packages/server/tests/im.test.ts)

#### Rooms check membership on the server
- **Kind:** Exploit closed
- **What you notice:** Guild Chat belongs to your current guild and Admin Chat to administrators; losing that membership silently removes you from the room while leaving its window open.
- **1.6:** Anyone could join the underlying groups by hand. Guild Chat used the client's guild field, and the Admin Chat client disconnected non-immortals. A player otherwise stayed until closing the window.
- **SSO:** The server holds membership. A join to Admin Chat without the `adminChat` permission is ignored and logged without a disconnect; exile, disbanding or demotion removes room membership immediately, and a line typed from outside a room goes nowhere.
- **Why:** Client-controlled room membership allowed eavesdropping on guild and admin conversations.
- **In the code:** `packages/server/src/systems/chat/rooms.ts` (`enterRoom`, `roomMembership`, `roomSay`)
- **Pinned by:** `divergence: Guild Chat is your guild's room; losing the guild drops you silently` and `divergence: a demoted administrator leaves Admin Chat` (packages/server/tests/im.test.ts)

#### Ignore list capped at 100
- **Kind:** Exploit closed
- **What you notice:** A 101st ignore is refused with “Your ignore list is full.”
- **1.6:** The list had no limit, but only lines 1–50 filtered ordinary messages, lines 1–40 filtered IMs, and `/unignore` reached lines 1–100.
- **SSO:** The account's ignore list holds at most 100 entries, and every entry filters chat, broadcasts and IMs.
- **Why:** Entries past line 100 could neither work nor be removed, and the list is stored per account.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`ignoreAdd`)
- **Pinned by:** `the list holds 100; the 101st is refused` (packages/shared/tests/chat/im.test.ts)

#### Unknown commands are never said aloud
- **Kind:** Exploit closed
- **What you notice:** A line starting with a command word (`/` then a letter) that is not a command, or is a staff command you may not use, is answered privately with “Unknown command "/word".” and handed back to the input to fix. Nothing is said to the map or room and no chat cooldown is charged. `/me` in a chat room is unknown too.
- **1.6:** An unrecognised command was said as local chat or room text, so typos went to everyone on the map. Staff commands answered a player with “Only immortals can ban players.” and similar, or said nothing, and SSO's own `/role`, `/roster` and `/spawn` were said aloud: either way a player could find the staff commands by trying them.
- **SSO:** `parseChatLine` and `parseRoomLine` return `unknown` for a command word that is no command, and `handleChat` gives the same reply for any admin command, `/drop`, `/spawn` or `/roster` the typist's role may not run. The 1.6 denial lines are gone. A slash that does not begin a command word, such as `/o\` or `and/or`, is still talk. Unknown commands are not written to the chat log, since nothing was said.
- **Why:** Typos should not be broadcast, and a player should not be able to tell a staff command from a typo.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`commandWord`, `unknownCommandText`, `parseChatLine`), `packages/shared/src/rules/chat/rooms.ts` (`parseRoomLine`), `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/chat/rooms.ts` (`roomSay`)
- **Pinned by:** `SSO: a command word that is no command is unknown, never said; other slashes are talk` (packages/shared/tests/chat/chat.test.ts); `a typo is told to the typist alone, given back to fix, costs no cooldown and is not logged` and `a slash that is not a command word is still talk` (packages/server/tests/chat.test.ts); `SSO: a player's admin command is answered as an unknown one, privately, and does nothing` (packages/server/tests/admin.test.ts); `SSO: /me or a typo in a room is an unknown command, told only to the typist and given back` (packages/server/tests/im.test.ts)

#### The server logs player communication
- **Kind:** Architecture
- **What you notice:** Administrators can read back what a player said, including IMs and lines that were refused, with `/chatlog <name>`; operators can search it with `bun run admin:chatlog`.
- **1.6:** The server kept no record of chat. IMs went peer to peer, so the server never saw them, and the only log was the file a player saved with `/logchat`, which staff could not check and the player could edit.
- **SSO:** Every line a player writes to others (say, `/me`, broadcasts, IMs and automatic away replies, away texts, guild chat, chat rooms, staff chat and Bio profiles) is written to the `chat_log` table with its time, channel, sender, destination, exact text and outcome: delivered, or refused by the cooldown, house rule or jail, dropped by the recipient's ignore list, sent to someone not online, and so on. Say, `/me` and broadcasts also count how many others read the line, ignored it or heard it muffled. Administrators read every channel with `/chatlog`; each lookup is audited. Lines are kept for `chatLogRetention` (default 90 days). Commands and `Password=` lines are not logged. Players are not shown a notice; operators disclose it in their own terms. A line delivered nowhere (an away text, a room line typed out of a room, staff chat refused to a player) is logged at most once per chat cooldown, on a log-only timer, so it cannot flood the log and never delays the player.
- **Why:** Moderators could not confirm harassment, scam or threat reports, check a player's history before acting, or review an incident.
- **In the code:** `packages/server/src/systems/chat/log.ts` (`logChat`), `packages/server/src/persistence/chatlog.ts`, `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/cli/admin-chatlog.ts`, `packages/shared/src/rules/admin/chatlog.ts`, `packages/server/src/systems/chat/rooms.ts` (`roomSay`), `packages/server/src/systems/chat/im.ts` (`setAway`)
- **Pinned by:** `a delivered say: the words, the map and how many others heard it`; `/msg: delivered, ignored, not online and refused by the cooldown`; `an away text and the automatic away reply are logged`; `/chatlog: an administrator reads a player's lines and the IMs sent to them; the lookup is audited`; `/chatlog is an administrator's: a moderator or a player who types it is told it is unknown` (packages/server/tests/chatlog.test.ts); `every /g line is in the chat log: delivered, refused by the cooldown, with no guild` (packages/server/tests/guilds.test.ts); `SSO: a room line out of a room is logged once per chat cooldown`; `SSO: staff chat refused to a player is logged once per chat cooldown, and still refused`; `SSO: an away text is logged once per chat cooldown, though each one is set` (packages/server/tests/chat-log-flood.test.ts)

#### Password change via account flow
- **Kind:** Architecture
- **What you notice:** `Password=<new>` changes your account password without displaying it. Empty passwords, those longer than 64 characters, and a line longer than the chat cap (`chatMaxChars`) are refused rather than cut. Spaces, `/`, `:` and `\` are removed, as in 1.6 (see [Password= removes every forbidden character](#password-removes-every-forbidden-character)).
- **1.6:** The command edited a local field, echoed the new password in chat and uploaded it with the character sheet.
- **SSO:** The already logged-in session changes the account password without asking for the old password. Success says “Password has been changed.”; an empty or too-long password, or a line the chat cap would cut, says “Your password was not changed.”
- **Why:** Passwords no longer live in character data, and echoing one would leak it into chat logs.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`)
- **Pinned by:** `an empty or 65-character Password= is refused` (packages/server/tests/password-db.test.ts); `SSO: a Password= line longer than the chat cap is refused, not cut` (packages/server/tests/staff-chat-moderation.test.ts)

### Server-side combat

#### Server computes melee damage
- **Kind:** Exploit closed
- **What you notice:** The server decides how much damage your melee attack deals and who gets credit for a kill.
- **1.6:** The attacker sent calculated attack power and damage for each client to apply and credit.
- **SSO:** The client sends whether attack is held; the server rolls attack power and damage and credits the kill.
- **Why:** A modified client could otherwise deal arbitrary damage or give someone else credit.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`, `workAttack`)
- **Pinned by:** `SSO: the attack intent is the key's hold state only: no damage, power, target, position or weapon` (packages/shared/tests/ledger-pins-a.test.ts); `a seeded Slime fight: bare hands kill it, the kill gives 23 XP at level 1` (packages/server/tests/monsters.test.ts)

#### Server owns positions in hit tests
- **Kind:** Exploit closed
- **What you notice:** Attacks hit according to the server's record of where the attacker and target are.
- **1.6:** Receivers trusted the attacker's reported position, facing and weapon.
- **SSO:** Hit tests use server positions, facing and equipment.
- **Why:** A forged position or weapon could let someone attack from anywhere or impersonate an elemental weapon.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`, `pvpSwing`)
- **Pinned by:** `SSO: the attack intent is the key's hold state only: no damage, power, target, position or weapon` (packages/shared/tests/ledger-pins-a.test.ts); `bug fixed: a victim part-way through a step is hit on the tile it is leaving`; `bug fixed: a swing at (4,4) no longer hits a victim stepping from (9,4)` (packages/server/tests/melee.test.ts)

#### Server-side cooldowns
- **Kind:** Exploit closed
- **What you notice:** Attack timing is governed by the server.
- **1.6:** Attack delay, action delay and the power bar were held on the client. SSO has [no power bar](#no-power-bar).
- **SSO:** The server counts ticks; an attack pressed a few ticks early can be latched for the next permitted attack.
- **Why:** Client-controlled timing allowed speed and power hacks.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`), `packages/shared/src/rules/combat/combat.ts` (`tickAttackTimers`, `startSwing`)
- **Pinned by:** `SSO: a tap is latched for ${ATTACK_LATCH_TICKS} ticks: it swings if the attack re-arms by then`; `SSO: a tap older than the latch is lost, as 1.6's keyPressed poll lost it` (packages/server/tests/melee.test.ts); `bug fixed: holding attack swings every AtDelay = 14 frames, not 15` (packages/shared/tests/combat/combat.test.ts)

#### Server checks crystals before shots and casts
- **Kind:** Exploit closed
- **What you notice:** A shot or cast that needs a crystal consumes one from your bag.
- **1.6:** The client checked its local count and sent a removal afterwards.
- **SSO:** The server checks and removes the crystal with the shot or cast.
- **Why:** A modified client could otherwise shoot or cast without spending crystals.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`), `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `bug fixed: a bow with arrows but no crystal is refused before the swing, with no cooldown`; `a bow with Blue Arrows and a crystal shoots an arrow and spends the crystal, hitting nothing in melee` (packages/server/tests/melee.test.ts); `not enough SP and too few crystals: the messages`; `SP and crystals are taken from the last crystal line` (packages/server/tests/spells.test.ts)

#### Server rolls equipment breaks
- **Kind:** Exploit closed
- **What you notice:** Equipment can break with the original odds during combat.
- **1.6:** The client rolled for a break and reported the equipment slot.
- **SSO:** The server makes the roll using the original odds.
- **Why:** A modified client could omit break reports.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`smash`), `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`)
- **Pinned by:** `a weapon break on a monster hit: the damaged form and the line` (packages/server/tests/inventory.test.ts); `SSO: a monster's hit rolls the armour break on the server with the original odds` (packages/server/tests/ledger-pins-a.test.ts); `odds 1 + 3·Sta + 600 (+500 weapons) plus the hunger terms` (packages/shared/tests/inventory/inventory.test.ts)

#### Loot rolled by the server on observed kills
- **Kind:** Exploit closed
- **What you notice:** A monster's loot is rolled once when it dies and appears on its tile.
- **1.6:** A client could repeatedly request a drop naming the loot table, map and coordinates without a kill; each successful drop still needed an empty loot slot.
- **SSO:** The server runs the same algorithm once per kill, using the killed monster's species and tile.
- **Why:** A forged client could repeatedly create loot from any table without killing a monster.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`smash`), `packages/server/src/systems/spells/collide.ts` (`checkForDead`)
- **Pinned by:** `a killed Slime drops 2 Gold on its tile, as loot that decays after 30 minutes`; `bug fixed: loot lands on the tile the monster is drawn nearest` (packages/server/tests/inventory.test.ts); `bug fixed: a spell kill drops the loot on the tile the monster is drawn nearest` (packages/server/tests/spells.test.ts)

#### Bow lock clears immediately
- **Kind:** Architecture
- **What you notice:** A bow's next shot is limited by its attack delay rather than an extra network round trip after a crystal is spent.
- **1.6:** A 40-frame item action pause after a shot cleared on the server's inventory reply, one round trip later.
- **SSO:** The crystal is removed in the same tick and attack delay controls the cadence.
- **Why:** The server has no inventory round trip to wait for.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`)
- **Pinned by:** `SSO: a bow spends its crystal in the tick it shoots, and its attack delay alone sets the cadence` (packages/server/tests/ledger-pins-a.test.ts); `a bow with Blue Arrows and a crystal shoots an arrow and spends the crystal, hitting nothing in melee` (packages/server/tests/melee.test.ts)

### Server-side core

#### File editor and path-based file access removed
- **Kind:** Exploit closed
- **What you notice:** Operators use a Server Settings page in the Control Panel instead of a file editor. It has a sidebar of pages grouped by what an operator is doing and a search across every setting; each setting shows its explanation, changes are marked and counted, defaults are offered, and lengths of time are typed as time (`30s`, `5m`, `7d`).
- **1.6:** File transfer could read or write paths under the data directory, including parent paths. Map, NPC and character-loading messages could read arbitrary files; character viewing could return passwords. No 1.6 client sent the character-viewing message, although the admin guide described `/view name`.
- **SSO:** Data is addressed by ID rather than arbitrary paths, and the character-viewing message is gone. Staff look characters up in the Control Panel's player hub instead (see [Staff look characters up in a player hub, not their files](#staff-look-characters-up-in-a-player-hub-not-their-files)), which never sends a password. Server Settings is a plain SSO page in the Control Panel, which took the File Editor's place on the Admin menu; the original had no settings screen. Each page is saved on its own: Save validates the page's values in the browser and again on the server, refuses the whole save with the error on the setting, and applies successful changes to everyone online immediately, as `/Refresh` does. Leaving a page, or the Control Panel page, with unsaved changes asks first and discards them. Revert reloads server values. Server infrastructure (save interval, reconnect grace, connections per address) is set with `SSO_*` environment variables instead.
- **Why:** Arbitrary server file reads and writes let a client expose or alter data. Explanations remain visible rather than relying on hover.
- **In the code:** `packages/client/src/ui/settings.ts` (`createSettingsPanel`), `packages/server/src/settings.ts` (`applySettingValues`)
- **Pinned by:** `Settings: an administrator's save is stored, audited and applied at once; rules go to everyone`; `Settings: a bad value refuses the whole save with its key and label` (packages/server/tests/admin.test.ts); `Save sends only the open page's values; Revert asks again`; `leaving a page with unsaved changes asks; Keep editing stays, Discard goes`; `leaving with unsaved changes asks; Keep editing stays, Discard goes on` (packages/client/tests/settings.test.ts); `server infrastructure is not a setting: no row, and stored values are ignored` (packages/server/tests/world.test.ts); `SSO: no client message carries a file path or asks to view a character` (packages/shared/tests/ledger-pins-e.test.ts); `SSO: an NPC Editor load names an NPC by id; a path names nothing and reads nothing` (packages/server/tests/ledger-pins-e.test.ts)

#### IP bans and lookups use the socket
- **Kind:** Exploit closed
- **What you notice:** IP bans use the real connection address, and IP lookup is available only to staff holding `/iplookup`.
- **1.6:** IP sorting trusted the client-reported address and used substring matching; anyone could call the server's IP lookup. The IP ban did nothing because its response had no client handler and its marker files were never read.
- **SSO:** `/BanIP` and `/unbanIP` work and are administrators' by default. A banned address is refused with the original unshown “You are banned from playing on this server.” (when and how is in [IP bans are checked, cover an IPv6 /64 and act at once](#ip-bans-are-checked-cover-an-ipv6-64-and-act-at-once)). The address comes from the socket, or from the nth rightmost `X-Forwarded-For` entry when the operator configures `SSO_PROXY_HOPS=n` for n trusted proxies. The nearest proxy appends the rightmost entry; a client can forge entries farther left. The former `trustForwardedFor` setting is removed. `/IPlookup` needs its permission, which moderators and administrators hold by default.
- **Why:** Trusting a client address allowed ban evasion and exposed IP addresses; an ineffective ban provided no protection.
- **In the code:** `packages/server/src/gateway/server.ts` (`clientIp`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `0 hops is the socket; a forged header is ignored`; `1 hop is the right-most entry, which the client cannot forge`; `2 hops is the second from the right; too few entries fall back to the socket` (packages/server/tests/login-limits.test.ts); `divergence: an IP ban refuses a login from that address after the password`; `a moderator may run the moderation commands, but not IP bans or /setclass` (packages/server/tests/admin.test.ts)

#### Character state server-owned; no character upload
- **Kind:** Exploit closed
- **What you notice:** Your character's stats, skills, level, class and gold are maintained by the server.
- **1.6:** A client could upload its entire character file for the server to write.
- **SSO:** Character state belongs to the server; the client sends intents.
- **Why:** An uploaded sheet could set arbitrary character values.
- **In the code:** `packages/server/src/game.ts` (`createGame`)
- **Pinned by:** `SSO: no in-game message carries character state, so a character cannot be uploaded` (packages/shared/tests/ledger-pins-b.test.ts); `garbage is dropped, not fatal` (packages/server/e2e/login-and-walk.test.ts)

#### All amounts are validated positive integers
- **Kind:** Exploit closed
- **What you notice:** Transactions reject invalid item counts and gold amounts.
- **1.6:** Negative values in buying, selling, banking, giving, spell costs, registering, dropping gold and trade could create gold or items.
- **SSO:** Counts and amounts are whole numbers at least 1, with banking allowing zero and gold drops limited to 9,999. The schema and transaction both check them; trade gold can be zero.
- **Why:** Negative amounts could mint gold or items.
- **In the code:** `packages/shared/src/protocol/economy.ts` (`buySchema`, `sellSchema`, `tradeOfferSchema`), `packages/shared/src/protocol/inventory.ts` (`goldSchema`)
- **Pinned by:** `SSO: counts and amounts are integers ≥ 1 at the schema, gold drop ≤ 9999, trade gold ≥ 0` (packages/shared/tests/protocol/protocol.test.ts); `commands by word 1, any case; the amount after one space; bad amounts read as none` (packages/server/tests/economy.test.ts); `register below 1 is silent` (packages/shared/tests/economy/playershop.test.ts); `SSO: every spell costs a whole SP amount of at least 0 in any armour and a crystal count of at least 1; the cast message carries no cost` (packages/shared/tests/spells/spells.test.ts)

#### Dropped connections resume for 30 seconds; a second login replaces the first
- **Kind:** Architecture
- **What you notice:** A brief disconnect can automatically resume your session, while signing in elsewhere disconnects the older connection.
- **1.6:** A dropped connection ended the session with “Disconnected!” and required logging in again at the title screen; there was no resume.
- **SSO:** The character leaves the map immediately and is saved when a connection drops. For the configured `SSO_RECONNECT_GRACE`, 30 seconds by default, the client can reconnect with a token and no password as a resumed session rather than a login. A new login to an online account disconnects the older connection with “You logged in from somewhere else.”
- **Why:** Wi-Fi interruptions, network changes and sleeping tabs should not force a full login or leave a forgotten session blocking the account.
- **In the code:** `packages/server/src/game.ts` (`createGame`)
- **Pinned by:** `a dropped connection can resume with its token, keeping its facing`; `an expired resume token is refused`; `a second login to the same account replaces the first` (packages/server/e2e/login-and-walk.test.ts)

#### Server errors log the player out
- **Kind:** Architecture
- **What you notice:** If an action fails unexpectedly, the affected player is logged out with “Something went wrong on the server, so you were logged out. Please log in again.”
- **1.6:** In a test of a malformed network message, the shipped client showed “Script Error. Continue?” and froze until answered. Yes resumed play; No quit the client. Other error types were not tested.
- **SSO:** Intents, ticks, map entry and exit run in SQL transactions. A thrown error rolls back its writes, is logged to the server's error output with the message type and the player's name (not to the cheat log, since a bug is not cheating) and logs out the affected player; their next login reloads the database state. A failed tick is logged and the next tick runs; 20 consecutive tick errors save and exit the server.
- **Why:** The shared server must survive errors without committing a half-completed action.
- **In the code:** `packages/server/src/game.ts` (`createGame`)
- **Pinned by:** `the sender is logged out with the new text and nothing is written; the other bot plays on`; `a throw that escapes the game in the gateway logs the player out, no ghost`; `a throwing tick returns false, tickNow says so, and the next tick runs` (packages/server/e2e/hostile-messages.test.ts); `SSO: an intent that throws logs its sender out with the server-error text; nothing is written`; `SSO: 20 throwing ticks in a row save everyone and exit; a good tick resets the count` (packages/server/tests/ledger-pins-e.test.ts)

#### Client anti-cheat replaced by server validation
- **Kind:** Architecture
- **What you notice:** Invalid client actions are refused or logged by the server rather than relying on a client to ban itself.
- **1.6:** The client used ciphers, self-ban, name and equipment shadow checks, echoes and a per-minute speed check. Anyone could write a cheater report.
- **SSO:** Schema validation, per-tick gates, rate limits and a server-written cheat log replace those client self-bans. `/CheatFile` shows the original “<name> - at IP <ip> - <reason>” format. The log records editor or Settings intents from roles without the permission, editor load/save outside the editor, malformed frames and flooding. Its reasons include “Attempted Admin Access”, “Attempting to get Admin access”, “Sending bad messages” and “Flooding”. There are no automatic kicks. `/CheatFile` is administrators' by default, and each look is written to the audit log, since the lines show players' addresses.
- **Why:** The client has no authoritative state to protect.
- **In the code:** `packages/server/src/game.ts` (`editingOk`, `createGame`)
- **Pinned by:** `the cheat log: admin intents from anyone else are refused and written`; `/Inventory, /CheatFile, /save and /Refresh; SSO audits /CheatFile, whose lines show addresses` (packages/server/tests/admin.test.ts); `SSO: flooding and malformed frames are written to the cheat log with the sender's name` (packages/server/tests/ledger-pins-b.test.ts)

#### Monster persistence restored after restart
- **Kind:** Architecture
- **What you notice:** Monsters survive server restarts and remain frozen on maps without players.
- **1.6:** Each map's monster file stored live monsters, which were restored when a player entered.
- **SSO:** Per-map monster slots are stored in the database and restored on startup; AI ticks only when players are present.
- **Why:** This preserves the observable behaviour without client-written files.
- **In the code:** `packages/server/src/persistence/monsters.ts` (`loadSlots`, `saveSlots`)
- **Pinned by:** `a damaged Slime comes back where it was, with its HP` (packages/server/tests/monsters-db.test.ts); `SSO: monster AI runs only on a map with players; an empty map spawns nothing` (packages/server/tests/ledger-pins-b.test.ts)

#### House interiors are named maps
- **Kind:** Architecture
- **What you notice:** A house interior uses its original-style map name, and the World Editor can show and accept it.
- **1.6:** The interior was a map file named like `xH1<mx>yH1<my>` or `xH2…`, and the outdoor exit named its map and entry tile.
- **SSO:** A map row at the outdoor map's grid position has house slot 1 or 2 and the same name. An exit may name a house map and the editor shows and accepts the `H1<mx>` form. The map header appears under the playfield, as in 1.6.
- **Why:** Maps are database rows keyed by grid position.
- **In the code:** `packages/server/src/persistence/maps.ts` (`findMapByCoords`), `packages/server/src/systems/admin/worldedit.ts` (`editorView`)
- **Pinned by:** `a Small House on x1000y992: exit field, items, tiles, interior, deed and records in one write` (packages/server/tests/houses-db.test.ts); `SSO: an exit to a house map shows as H1<mx>/H1<my> and is read back as that house` (packages/shared/tests/ledger-pins-b.test.ts)

### Server-side crafting

#### Crafting and gathering run on the server
- **Kind:** Exploit closed
- **What you notice:** Crafting and gathering use your tool, materials, station, skill and time in the game.
- **1.6:** The client controlled tile edits, drop rolls, timers, failure rolls, masterwork skill and station checks.
- **SSO:** The client sends attack and craft intents; the server checks the tool, station, inputs, skill and timer and makes the rolls.
- **Why:** Client-controlled checks allowed free items, faster crafting and selecting the best masterwork pool.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftIntent`, `craftStep`), `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)
- **Pinned by:** `starts with the line, the lock and Swordhit3; done on the 500th frame`; `mid-step there is no anvil in front`; `bug fixed: carpentry needs Carpentry 1` (packages/server/tests/craft.test.ts); `bug fixed: 18 swings fell a tree, as the table says: the stump, treefalling, logs and the skill line` (packages/server/tests/gather.test.ts)

#### Treasure is found on the exact map and the dug tile
- **Kind:** Exploit closed
- **What you notice:** A successful dig can find treasure on its actual map and at the tile dug.
- **1.6:** The client sent a map name and pixel coordinates. The server matched the map by substring and dropped the item in ground slots 1–8 at those coordinates, without checking that a dig occurred.
- **SSO:** A successful dig on the exact treasure map rolls `random(5)` and drops on the dug tile. The ground cap and its slots 1–8 restriction are lifted; `treasureMaps` supplies the operator's map list.
- **Why:** A forged client could claim any map and position.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`toolSwing`, `resetTreasure`)
- **Pinned by:** `a dig on the treasure's map finds it on random(5) = 1 and hides a new one`; `another map never finds it, and no list means no treasure` (packages/server/tests/gather.test.ts)

#### A repair needs its chunk at completion
- **Kind:** Exploit closed
- **What you notice:** If the metal chunk is gone when a repair finishes, the repair ends without a message or a skill roll.
- **1.6:** A stale chunk search let a repair finish after the chunk was removed; it reduced the damaged item's slot again and renamed it to the chunk. A stack of three damaged items could become a chunk and a repaired item, while a stack of two lost both and still repaired. Loading a map freed the keys mid-craft, allowing the chunk to be dropped first.
- **SSO:** A missing chunk ends completion silently, just as a missing damaged item already did. Nothing is taken.
- **Why:** The original could create chunks from nothing.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`)
- **Pinned by:** `divergence: a chunk dropped mid-craft repairs nothing and says nothing` (packages/server/tests/craft.test.ts); `divergence: a chunk gone at completion rolls no skill, though a finished repair on the same rolls does` (packages/server/tests/craft.test.ts)

#### Crafting and gather state lives on the server
- **Kind:** Architecture
- **What you notice:** Crafting and gathering timers advance with the server's game frames.
- **1.6:** Counters, anti-macro state, crafting timers and the key lock were client globals advanced every frame.
- **SSO:** The server advances per-character state at 20 ticks per second, keeping the original frame counts.
- **Why:** The server owns the game state.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`), `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)
- **Pinned by:** `starts with the line, the lock and Swordhit3; done on the 500th frame`; `divergence: a craft ends at logout; a new session starts with none` (packages/server/tests/craft.test.ts); `bug fixed: 18 swings fell a tree, as the table says: the stump, treefalling, logs and the skill line` (packages/server/tests/gather.test.ts)

#### Regrowth rolls run on the server
- **Kind:** Architecture
- **What you notice:** Gathering sites and farm produce regrow on the server's clock.
- **1.6:** Each client on the map drew a number from 1 to 600 each frame, except while a map was loading, to decide which regrowth and produce checks to run, then edited tiles.
- **SSO:** The server makes the draw itself, once per map per frame, and sends the tile changes (see "Regrowth runs at one rate on every map").
- **Why:** The server owns tile changes.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`regrowthStep`)
- **Pinned by:** `bug fixed: one random(600) per map per frame, however many players are there`; `bug fixed: a stump regrows on a roll under 6, even right after a death or exit warp` (packages/server/tests/gather.test.ts)

#### Built containers get server ids
- **Kind:** Architecture
- **What you notice:** A built crate or cabinet has its own container contents.
- **1.6:** The client appended a random number to a built Crate, Cabinet or Wind Cabinet, so two could share the same vault file.
- **SSO:** The server mints a unique increasing ID; World Editor Cauldrons use the same minter. Only built and placed containers are minted: a bare container added to a bag from a purchase, loot or gift gets a random ID instead, and a purchase rolls again for an ID already in use (see [Cauldrons get unique ids](#cauldrons-get-unique-ids) and [Every bought container gets its own id](#every-bought-container-gets-its-own-id)).
- **Why:** Each container needs its own contents and clients must not choose server file names.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`mintContainerId`)
- **Pinned by:** `carpentry: Logs taken at completion, 'You built a Crate!', the result minted an id`; `an exact Cauldron gets an id on save; one with an id keeps it` (packages/server/tests/craft.test.ts); `bug fixed: each bought container gets its own line and its own unused id` (packages/server/tests/economy.test.ts); `SSO: the server mints unique increasing container ids, whatever the clock says` (packages/server/tests/ledger-pins-b.test.ts)

#### Crafts end at logout
- **Kind:** Architecture
- **What you notice:** A craft ends on logout. Nothing has been taken yet, so nothing is lost.
- **1.6:** Crafting counters lived on the client. Quitting stopped them; cooking and smithing had taken nothing yet, while alchemy and carpentry inputs were already gone.
- **SSO:** The server runs the craft during the session and ends it at logout. Every craft takes its materials when it finishes (see "Every craft takes its materials when it finishes"), so an ended craft loses nothing.
- **Why:** Craft state is not kept across sessions in the saved character.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`), `packages/server/src/systems/world/world.ts` (`removePlayer`)
- **Pinned by:** `divergence: a craft ends at logout and takes nothing; the next session starts with none` (packages/server/tests/inventory-db.test.ts)

#### Cauldrons get unique ids
- **Kind:** Architecture
- **What you notice:** A Cauldron placed in the World Editor has its own container ID and retains it on later saves.
- **1.6:** A World Editor save gave a bare Cauldron a random ID and kept an existing one; random IDs could collide. A carried Cauldron kept no ID and opened the shared Cauldron file. No Cauldron was placed in archived maps.
- **SSO:** A placed Cauldron receives a unique minted ID, and so would a crafted one, though no recipe makes a Cauldron today. Other bare Cauldrons added to a bag, such as purchases, loot or gifts, instead get a random ID as crates and cabinets do, so only placed ones are guaranteed unique. A purchase of several puts each Cauldron on its own line under a random ID not already in use (see [Every bought container gets its own id](#every-bought-container-gets-its-own-id)).
- **Why:** Container ownership needs a separate container for each placed or crafted Cauldron.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`mintContainerId`), `packages/shared/src/rules/inventory/inventory.ts` (`invAdd`)
- **Pinned by:** `an exact Cauldron gets an id on save; one with an id keeps it` (packages/server/tests/craft.test.ts); `bug fixed: each bought container gets its own line and its own unused id` (packages/server/tests/economy.test.ts); `SSO: two bare Cauldrons placed in one World Editor save get different minted ids` (packages/server/tests/ledger-pins-b.test.ts); `SSO: a crafted Cauldron enters the bag with a minted id; a second gets a new one` (packages/server/tests/ledger-pins-e.test.ts)

### Server-side economy

#### Guild vault access is checked at each take
- **Kind:** Exploit closed
- **What you notice:** If you leave a guild while its vault is open, the window closes when you try to take something. A carried crate or cabinet behaves the same once it leaves your bag, for example after you give it away.
- **1.6:** A guild vault stayed usable after leaving the guild because the client decided who could open it. A storage window continued to name a crate after its owner gave, traded, sold or dropped it, so the old owner could still take its contents.
- **SSO:** Every take checks whether the player may still use the container. If access has gone, nothing is taken and the window closes.
- **Why:** A forged client could otherwise keep withdrawing from a former guild vault or a container it had handed over.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)
- **Pinned by:** `a take re-checks the guild: a member expelled with the vault open takes nothing` (packages/server/tests/craft.test.ts); `SSO: a carried Cabinet or Crate given away: the giver's open window takes nothing and closes` (packages/server/tests/ledger-pins-e.test.ts)

#### Promotions charge gold on the server
- **Kind:** Exploit closed
- **What you notice:** A promotion charges its listed gold price when your character qualifies.
- **1.6:** The client checked the promotion and subtracted the price. The server did not charge, so the next character update restored the gold; no screen used its unused purchase message.
- **SSO:** The server checks the NPC roster, training line, class, requirement and gold and writes the price and new class together.
- **Why:** The client intended to charge for eligible promotions, but the original allowed free or illegal promotions.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`trainIntent`)
- **Pinned by:** `a promotion writes class, gold and stats; texts, then heal2, then processed`; `a refused one changes nothing and still sends processed; no branch sends only processed`; `refused when the NPC left the roster, or with no train list open` (packages/server/tests/promotion-db.test.ts); `noFunds: price = gold + 1 refuses, price = gold passes` (packages/shared/tests/progression/promotion.test.ts)

#### Shop prices come from the server
- **Kind:** Exploit closed
- **What you notice:** Buying or selling uses the price listed by the shop.
- **1.6:** The client supplied the price for purchases and sales. Affordability used that price and sales accepted a prefix of the listed price.
- **SSO:** The client sends the NPC, line and count; the server supplies the price.
- **Why:** A modified client could manipulate prices.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`buyIntent`, `sellIntent`)
- **Pinned by:** `price × count from the line, charged from GLD into the NPC's gold`; `pays the BUY price from GLD, takes the count, returns the stock and thanks` (packages/server/tests/economy.test.ts); `SSO: a buy, sell or train names the line and count; a client price is refused` (packages/shared/tests/ledger-pins-b.test.ts)

#### Bank accounts belong to their character
- **Kind:** Exploit closed
- **What you notice:** Bank commands use your character's own account.
- **1.6:** Deposit, withdrawal and balance requests named a file supplied by the client.
- **SSO:** The bank account belongs to the session character.
- **Why:** A forged file name could withdraw from another player's account.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`bankChat`), `packages/server/src/systems/economy/bank.ts` (`runBank`)
- **Pinned by:** `SSO: the bank account is the session character's own; another's deposit is not yours` (packages/server/tests/ledger-pins-b.test.ts); `after a relog: gold, bag, bank, vault and Amber's stock persist` (packages/server/e2e/npcs-shops-trade.test.ts)

#### House vault access
- **Kind:** Exploit closed
- **What you notice:** You can open and use a personal, house or guild vault only when its rules allow you; a refused house or guild vault says “You can't open a vault that's not yours!”
- **1.6:** Chest and vault requests had no ownership or position check. A house door was its only protection.
- **SSO:** Placed containers must be faced; a carried crate or cabinet is opened from the bag. A personal or house vault belongs to its owner by exact name; a House Key opens only its holder's door. A guild vault belongs to its named guild's members, and only a disbanded guild's last leader may found its name again, getting its vault back (see [Only a disbanded guild's leader may found its name again](#only-a-disbanded-guilds-leader-may-found-its-name-again)). A carried crate or cabinet belongs to its carrier, while placed crates, cabinets and chests, quest chests and the Cauldron can be used by anyone facing them. A forbidden house or guild vault answers with the SSO refusal, modeled on the mailbox's ownership line; standing away from it gives the original standing-in-front line instead. A forbidden deposit is refused before the drop line and takes nothing. An open vault or container keeps the keys locked until Cancel and closes on a map change, so it is never used from elsewhere (see "A vault stays where you opened it").
- **Why:** Anyone could otherwise read and loot any vault.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`mayUseContainer`, `openContainer`, `depositContainer`, `withdrawContainer`), `packages/server/src/systems/economy/vault.ts` (`openVault`)
- **Pinned by:** `Alice opens her House Vault; Bob gets the refusal`; `Bob's Drop into Alice's vault is refused before the drop line; nothing is taken`; `a guild vault refuses anyone outside the guild, and opens for a member`; `a click not in front gives the line and pauses 4` (packages/server/tests/doors.test.ts); `a carried crate is the carrier's: once it leaves the bag its window takes nothing` (packages/server/tests/craft.test.ts); `a House Key opens and closes only its holder's door` (packages/shared/tests/housing/doors.test.ts)

#### Trades are server sessions with two accepts
- **Kind:** Exploit closed
- **What you notice:** A trade exchanges both offers together after both players agree.
- **1.6:** The accepting client supplied both player names and both lists, and the server checked neither identity nor consent.
- **SSO:** The server holds a trade between two players on the same map and keeps each submitted offer within what that player holds. Both players press Accept once both offers are in (see "Both traders accept, and may change their offers"). One transaction moves both sides or neither.
- **Why:** A forged trade could steal gold or move items without the other player's consent.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`offerTrade`, `acceptTrade`, `settle`)
- **Pinned by:** `bug fixed: A offers, B offers, both accept: one move, and both are told it is complete`; `bug fixed: either side can change its offer, which clears both acceptances`; `a failed move changes nothing and tells both` (packages/server/tests/npcs-trade.test.ts); `a trade offering more gold than A has, then A spends it: nothing is created` (packages/server/e2e/races.test.ts)

#### A trade cannot be taken over
- **Kind:** Exploit closed
- **What you notice:** A new trade offer to a player already trading is refused with “Trade cancelled.”
- **1.6:** Another player's offer could replace an open trade's partner, another sender could fill the initiator's column, and selecting someone else during a trade redirected later messages and the server move.
- **SSO:** A player in a trade cannot be offered another.
- **Why:** Other players could interfere with or redirect a trade.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`offerTrade`)
- **Pinned by:** `a third player cannot take B over; a trader leaving ends it for both` (packages/server/tests/npcs-trade.test.ts)

#### Player shops are owned by id and validated
- **Kind:** Exploit closed
- **What you notice:** A player shop belongs to its owner and uses server-checked stock, prices and till.
- **1.6:** A client could overwrite an NPC and map monster file, exploit substring owner matching, supply prices and stock unchecked, use a negative register amount, or collect from nothing if the first 30 lines lacked a till. A client also chose the map for a title, and tag text inside a profile counted as a tag.
- **SSO:** The server rerolls the original shopkeeper-name generator while its result matches any NPC file or monster-list entry. Ownership uses character ID; the shop map is the speaker's, and `title` requires the house owner. Prices are 1–9999, items use the 204-line whitelist, at most 10 sale lines are allowed, and Register must be at least 1. A missing till says “I don't have that much gold!”; only lines beginning with the tag count as stock.
- **Why:** Forged ownership and malformed prices or tills allowed system merchant takeovers and gold creation.
- **In the code:** `packages/server/src/systems/economy/playershop.ts` (`createShopkeeper`, `shopCommand`)
- **Pinned by:** `a taken name or a monster-list name is rolled again`, `with no GLD line Register refuses; 1.6 paid from nothing` (packages/shared/tests/economy/playershop.test.ts); `owned by id: a character whose name is inside the owner's is no owner` (packages/server/tests/playershop-db.test.ts)

#### Vault and mailbox access needs adjacency and ownership as designed
- **Kind:** Exploit closed
- **What you notice:** You must face a vault or mailbox to open it, and may check only your own mailbox.
- **1.6:** Chest, vault deposit and mailbox requests could name files remotely. The mailbox had a refusal line for another player's box, but there was no vault form of that line.
- **SSO:** The faced tile must contain the vault or mailbox. Another player's House Vault says “You can't open a vault that's not yours!”, modeled on “You can't check mail that's not yours!”.
- **Why:** A forged remote request could steal items or read another player's mail.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`openContainer`), `packages/server/src/systems/mail/mail.ts` (`mailOpen`)
- **Pinned by:** `Alice opens her House Vault; Bob gets the refusal`; `a click not in front gives the line and pauses 4` (packages/server/tests/doors.test.ts); `out of place, a stranger hears the position line first`; `in front but not the owner: 'not yours'` (packages/server/tests/mail-boards.test.ts); `SSO: Alice's own House Vault does not open from two tiles away` (packages/server/tests/doors.test.ts)

#### Promotion leaves the skills page in order
- **Kind:** Architecture
- **What you notice:** Your skills page remains aligned after a promotion.
- **1.6:** A promotion appended each granted skill and value to one list while leaving the separate amounts list unchanged, misaligning the panel until restart.
- **SSO:** The skills panel is a fixed table indexed by skill. A promotion raises each granted skill to at least random(10) in its own row, so nothing can misalign.
- **Why:** There are no separate lists to misalign.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`trainIntent`), `packages/shared/src/rules/progression/promotion.ts` (`promoteClass`)
- **Pinned by:** `bug fixed: each promotion raises its skills to a roll of 1-10`; `a grant never lowers a skill already above the roll` (packages/shared/tests/progression/promotion.test.ts)

#### Trades end when a trader leaves
- **Kind:** Architecture
- **What you notice:** An open trade is cancelled if either player changes map or disconnects, or if either closes the trade window. The remaining player sees “Trade cancelled.”
- **1.6:** A map change, death, logout or partner leaving did not close the trade window; its close box did not notify the partner.
- **SSO:** A map change, including death's respawn, a disconnect or closing the window ends the server-held trade.
- **Why:** A trade held by the server cannot outlive one of its traders.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`leaveTrade`, `cancelTrade`)
- **Pinned by:** `a third player cannot take B over; a trader leaving ends it for both`; `bug fixed: Cancel: whoever cancels hears 'You cancel the trade.', the partner 'Trade cancelled.'` (packages/server/tests/npcs-trade.test.ts); `a trade ends for Alice when Bob leaves` (packages/server/e2e/npcs-shops-trade.test.ts); `SSO: a map change ends the server-held trade for both traders` (packages/server/tests/ledger-pins-b.test.ts)

#### Shop presence is the map's roster
- **Kind:** Architecture
- **What you notice:** A shop purchase works while the NPC whose Bio you opened is in the map's roster, whether or not it is alive. (The bank needs a living banker; see "The bank needs a living banker".)
- **1.6:** Shop OK checked whether the clicked slot's data had changed; after a map change it did nothing until a map loaded data into that slot, then traded with the old NPC by name.
- **SSO:** Shop OK does nothing unless the originally opened NPC remains in the current map's roster.
- **Why:** A line-based purchase needs that NPC; another map's stale client slot was a peer-to-peer artefact.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`inRoster`, `buyIntent`)
- **Pinned by:** `SSO: Shop OK does nothing once the opened NPC has left the map's roster` (packages/server/tests/ledger-pins-b.test.ts); `refused when the NPC left the roster, or with no train list open` (packages/server/tests/promotion-db.test.ts)

#### Quest chests refill on the server's save clock
- **Kind:** Architecture
- **What you notice:** Quest chests refill on the periodic character save clock, slightly less often than in 1.6.
- **1.6:** Each character upload rolled for a refill, including roughly sixty event-triggered saves and periodic saves: after a 400-frame block, each frame had a one-in-350 chance of a save.
- **SSO:** Each online player has a server-side periodic save clock; periodic saves roll for refill, but event saves do not.
- **Why:** The server owns the character sheet and receives no character uploads.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`saveClockStep`)
- **Pinned by:** `bug fixed: after 400 frames a 1-in-350 save rolls 1 in 4000; the refill is added to the chest` (packages/server/tests/doors.test.ts); `a quest chest refill is written with the tick` (packages/server/tests/doors-db.test.ts)

#### Quests are server rows
- **Kind:** Architecture
- **What you notice:** Quest turn-ins update the server's quest list; the NPC comes from your map.
- **1.6:** Quests were read and rewritten in a 40-line settings file, which could also be edited with the File Editor.
- **SSO:** A 40-line quests table is seeded from the archived file at first start and turn-ins reroll lines as in 1.6. There is no settings form because the game rewrites the lines itself; the server takes the NPC from the map rather than a client message.
- **Why:** Quest state belongs to the server.
- **In the code:** `packages/server/src/systems/economy/quests.ts` (`questGive`), `packages/server/src/persistence/social.ts` (`loadQuestLines`, `saveQuestLine`)
- **Pinned by:** `the first start seeds the archive's powers and quest lines`; `a quest turn-in writes the bag and the rerolled line, which survive a restart` (packages/server/tests/factions-db.test.ts); `a quest item: the reward, thanks to the map, the line rerolled` (packages/server/tests/factions.test.ts)

#### Shop decay deletes the shopkeeper and its till
- **Kind:** Architecture
- **What you notice:** When a shop interior is removed, its shopkeeper, stock and till go with it.
- **1.6:** Decay left the shop NPC file, till, stock and interior monster file behind. Only a later Small Shop on the same map and slot replaced the shopkeeper; the old file remained on disk.
- **SSO:** Deleting the interior through decay or building a new house on the same map and slot deletes the shopkeeper's NPC file, ledger and owner row.
- **Why:** The gold and stock are unreachable after demolition, so their rows need not remain.
- **In the code:** `packages/server/src/systems/economy/playershop.ts` (`forgetShops`)
- **Pinned by:** `a demolished shop's shopkeeper, file, till and owner row are deleted with the interior` (packages/server/tests/playershop-db.test.ts)

### Server-side housing

#### Server clock drives house decay
- **Kind:** Exploit closed
- **What you notice:** House decay follows the server's calendar and the operator's configured time zone.
- **1.6:** Any client supplied the shared calendar month; a forged month sent repeatedly could demolish every house.
- **SSO:** The server gets the date using `houseDecayTimeZone`, UTC by default. An owner's houses are refreshed at login and every 1,230 frames while they are online; the sweep runs once a day (see "House decay sweeps once a day").
- **Why:** A forged client could otherwise wipe players' houses.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`monthCheck`, `houseClockStep`)
- **Pinned by:** `bug fixed: the sweep runs once a day, not on every clock check`; `an owner's own login refreshes their entries before the sweep` (packages/server/tests/houses-db.test.ts); `SSO: an online player's house clock is due every 1,230 frames`; `SSO: house decay reads the date in the operator's houseDecayTimeZone` (packages/server/tests/ledger-pins-b.test.ts)

#### Houses, maps and items written only by the server
- **Kind:** Exploit closed
- **What you notice:** Building a house, using a key and changing the world are performed through validated game actions.
- **1.6:** House, map, item, tile, monster and door writes accepted requests from any client.
- **SSO:** The server validates use, house-placement and key intents and performs the writes.
- **Why:** Unchecked writes allowed arbitrary world edits, item creation and forced demolition.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `a refusal keeps placement on and builds nothing` (packages/server/tests/houses-db.test.ts); `the wrong key, no door, or mid-step: silent and nothing spent` (packages/server/tests/doors.test.ts); `only doors and switches are renamed (exploit 3 closed)` (packages/shared/tests/housing/doors.test.ts); `SSO: a placement click without the deed's Use first builds nothing and spends nothing` (packages/server/tests/ledger-pins-b.test.ts)

#### The header names its owner exactly
- **Kind:** Exploit closed
- **What you notice:** House furniture permissions use the full owner name, or the exact name of your guild hall.
- **1.6:** The header test accepted a name followed by apostrophe-s anywhere in the header, so Bob could pass the test in “Jimbob's House” and place furniture or take Jimbob's Stove, Anvil and Alchemy Lab.
- **SSO:** A personal header must begin with “<name>'s ”; a guild hall header must equal “Hall of the <guild>”, so a guild its last leader founds again under that name matches the old hall (see [Only a disbanded guild's leader may found its name again](#only-a-disbanded-guilds-leader-may-found-its-name-again)).
- **Why:** One player's name inside another's allowed theft of furniture.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`headDrop`)
- **Pinned by:** `your guild's hall is 0` (packages/shared/tests/housing/houses.test.ts); `SSO: the header must begin with '<name>'s ' or equal 'Hall of the <guild>'` (packages/shared/tests/ledger-pins-b.test.ts)

#### Door relock is one server timer per map
- **Kind:** Architecture
- **What you notice:** Doors relock according to a shared timer for the map.
- **1.6:** Each client counted down and sent its own close. A door change set each client to 200 frames, an arriving client started at 150 and a switch clicker at 100; the earliest closed the doors. An empty map counted nothing.
- **SSO:** One timer per map: every door or switch change sets it to 200. Arriving and refused switch clicks set nothing, and the timer keeps running while the map is empty (see the "Bug fixed" entries below).
- **Why:** The server model has no peers running separate countdowns.
- **In the code:** `packages/server/src/systems/housing/doors.ts` (`switchClick`, `relockStep`)
- **Pinned by:** `a Steel Door opened by key shuts 200 frames later, and every client sees it`; `bug fixed: arriving on a map leaves a running relock alone`; `bug fixed: doors on a map nobody is on still close on time`; `bug fixed: a refused switch click leaves the relock alone` (packages/server/tests/doors.test.ts)

#### Decay deletes the demolished house's interior and vault
- **Kind:** Architecture
- **What you notice:** A demolished house's lost interior and vault are removed; if someone is inside, its interior is deleted when they leave.
- **1.6:** Decay removed the house record and reverted the outdoor tiles, but the now-unreachable interior map and vault file stayed on disk. A missing map returned a character to the start point.
- **SSO:** The sweep also deletes the interior, its items and the house vault contents. An occupied interior waits until its occupant leaves, while a logged-out character saved there moves to the fallback map (see [Every character has a respawn point](#every-character-has-a-respawn-point)).
- **Why:** The contents were unreachable either way; the server need not keep unreachable rows forever.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`demolish`)
- **Pinned by:** `a stale owner's house is demolished by the day's sweep: tiles revert, Exit and mailbox go, the interior is deleted`; `SSO: offline characters saved in a deleted interior go to the fallback point, not their respawn point` (packages/server/tests/houses-db.test.ts); `SSO: decay deletes the House Vault's contents, and an occupied interior waits for its occupant` (packages/server/tests/ledger-pins-b.test.ts)

#### Demolition shows at once
- **Kind:** Architecture
- **What you notice:** When a house is demolished, people on the map immediately see the reverted tiles and the removed exit and mailbox.
- **1.6:** Demolition rewrote the map and items files without notifying players, who saw the house until they reloaded the map.
- **SSO:** The server sends the map and item changes at once.
- **Why:** The server owns one map, so what players see needs to match where they can walk.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`demolish`)
- **Pinned by:** `SSO: a player on the map sees the demolition at once: the tiles revert and the Exit and mailbox go` (packages/server/tests/houses-db.test.ts)

### Server-side inventory

#### Server derives the equip slot and checks requirements
- **Kind:** Exploit closed
- **What you notice:** Equipping an item uses the correct equipment slot and checks whether your character can wear it.
- **1.6:** The client supplied the slot type and checked strength, two-handed equipment and the murder flag; ownership was checked by substring.
- **SSO:** The client names a bag slot. The server reads the item, derives the equipment slot using the original rules and checks strength, two-handed equipment and the murder flag.
- **Why:** A forged slot and substring ownership check allowed arbitrary items in equipment slots.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`equipIntent`)
- **Pinned by:** `SSO: the server derives the slot and refuses gear the strength, hands or murder flag do not allow` (packages/server/tests/ledger-pins-c.test.ts); `the slot table: Knife LeftHand, Leather Armor Body, Apple No`; `strength comes first`; `two-handed rules`; `murder gear needs the flag` (packages/shared/tests/inventory/inventory.test.ts)

#### Removals address an exact item in a named slot
- **Kind:** Exploit closed
- **What you notice:** Removing an item from your bag addresses the selected slot and exact item name.
- **1.6:** Inventory deletion and its callers matched item names by substring.
- **SSO:** Removals use the bag-slot index and exact name; selling to an NPC takes the first bag line whose name matches exactly, ignoring case. The game rule tables retain their original substring semantics.
- **Why:** Substring deletion could destroy or rename the wrong item and create a name outside the catalogue.
- **In the code:** `packages/shared/src/rules/inventory/inventory.ts` (`invDelSlot`), `packages/server/src/systems/economy/trade.ts` (`take`), `packages/server/src/systems/economy/shop.ts` (`npcSell`)
- **Pinned by:** `removal is by slot, blanking at 0` (packages/shared/tests/inventory/inventory.test.ts); `SSO: a sale to an NPC takes the first line whose name matches exactly, ignoring case` (packages/server/tests/ledger-pins-c.test.ts); `bug fixed: picking up takes the one entry and leaves its twins on the tile` (packages/server/tests/inventory.test.ts)

#### Map, ground and container files are resolved by the server
- **Kind:** Exploit closed
- **What you notice:** The game resolves ground items, vaults, banks and minimaps from your current character and location.
- **1.6:** Clients supplied the names of ground, vault, bank and minimap files.
- **SSO:** The server resolves the relevant state from the character's map, position, faced entity and account.
- **Why:** Client-supplied file names enabled remote pickup, vault looting, bank theft and path traversal.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pickupIntent`), `packages/server/src/systems/economy/containers.ts` (`openContainer`)
- **Pinned by:** `SSO: a pickup finds the item id only on the player's own map` (packages/server/tests/ledger-pins-c.test.ts); `Alice opens her House Vault; Bob gets the refusal` (packages/server/tests/doors.test.ts)

#### Pickup and give require adjacency on the current map
- **Kind:** Exploit closed
- **What you notice:** You can pick up or give an item only when it is in reach on your current map.
- **1.6:** Ground pickup had no position check, and giving depended on the recipient's client.
- **SSO:** Pickup uses the orthogonally adjacent or faced tile on the player's map; a player receiving a give must stand on the faced tile. A quest NPC can receive a give from one or two tiles ahead.
- **Why:** A forged client could take items from any map.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `giveIntent`)
- **Pinned by:** `click pickup needs an orthogonal neighbour, never your own tile`; `give with no one in front` (packages/server/tests/inventory.test.ts); `SSO: a give reaches only a player on the faced tile; a quest NPC takes it from two tiles ahead` (packages/server/tests/ledger-pins-c.test.ts)

#### Peer messages cannot grant gold or items
- **Kind:** Exploit closed
- **What you notice:** Gold and items change through server-handled game actions.
- **1.6:** Several peer messages changed client state based only on the sender's word.
- **SSO:** There are no peer-to-peer state messages.
- **Why:** The server owns game state.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`giveIntent`, `goldIntent`)
- **Pinned by:** `give: one unit on the target's tile, grabbed 60 frames later`; `divergence: Drop or Give asking for more than the stack holds is refused`; `more than you have: 'You don't have enough gold!' for both paths` (packages/server/tests/inventory.test.ts)

#### Consumable effects and item breaks are rolled by the server
- **Kind:** Exploit closed
- **What you notice:** The server applies food and potion effects and equipment break rolls.
- **1.6:** The client applied consumable effects, selected break slots and could request that the right hand be cleared.
- **SSO:** The server applies effects and break rolls; the right-hand clearing request is removed.
- **Why:** The server owns character and equipment state.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`), `packages/server/src/systems/combat/melee.ts` (`smash`)
- **Pinned by:** `eating an apple: one unit spent, HP up, hunger up, the line`; `a weapon break on a monster hit: the damaged form and the line` (packages/server/tests/inventory.test.ts)

#### Newspaper stands only on K2 tiles
- **Kind:** Exploit closed
- **What you notice:** A newspaper stand kit can be placed only on a K2 tile; another tile says “You can't put a newspaper stand here!” and keeps the kit.
- **1.6:** The client checked the faced layer-1 tile before dropping a kit, but the server did not, so a forged request could place a stand anywhere.
- **SSO:** The server performs the same faced-tile test.
- **Why:** A hand-sent request could otherwise place a stand on any free tile.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`)
- **Pinned by:** `divergence: not K2: 'You can't put a newspaper stand here!' and the Kit is kept` (packages/server/tests/art-news.test.ts)

#### Use/equip answered without the long pauses
- **Kind:** Architecture
- **What you notice:** Using or equipping an item completes without the old network wait.
- **1.6:** An item-action pause of 425 or 325 frames held the action until a server reply, which normally ended it much earlier.
- **SSO:** The server resolves the action in the same tick and the reply ends the pause as before.
- **Why:** The delay waited on network latency rather than being a designed timer.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`, `equipIntent`)
- **Pinned by:** `SSO: Use and Equip are resolved at once and leave no item pause` (packages/server/tests/ledger-pins-c.test.ts)

#### Ground items sit on whole tiles
- **Kind:** Architecture
- **What you notice:** Left and Right Rays are drawn offset from their tiles, whether placed in the editor or dropped.
- **1.6:** The World Editor placed a Left or Right Ray 15 pixels right and 10 pixels up from the clicked tile and stored its pixel position; a dropped Ray sat on its tile.
- **SSO:** Ground items are stored by tile and every Ray is drawn at the editor offset.
- **Why:** The server stores tiles rather than pixels; Rays are scenery normally placed in the editor.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`addGround`), `packages/shared/src/rules/inventory/ground.ts` (`groundDrawOffset`)
- **Pinned by:** `drop puts one unit on the faced tile` (packages/server/tests/inventory.test.ts); `Rays sit 15 px right and 10 px up of their tile` (packages/shared/tests/admin/worldedit.test.ts)

#### No click pause after picking up an item
- **Kind:** Architecture
- **What you notice:** Picking up a ground item does not delay the next item click; walking is unaffected. Clicking a guild hall's board pauses item clicks for only a fifth of a second.
- **1.6:** A ground item or own-board click set a pause up to 40 frames, usually ended by the server's reply after one round trip. The town Message Boards exited before setting it, and walking was never held.
- **SSO:** There is no pause after a pickup. A guild hall's board keeps a 4-frame click pause (see [A guild board opens for its members, in front of it](#a-guild-board-opens-for-its-members-in-front-of-it)). The server processes one item action per character at a time and answers in the same tick; the switch and key pauses remain, and Ctrl's and the other click pauses are 4 frames (see [Ctrl and item clicks answer at once](#ctrl-and-item-clicks-answer-at-once)).
- **Why:** The old pause waited for the network and play feels the same without it.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `actionIntent`), `packages/server/src/systems/mail/boards.ts` (`boardOpen`)
- **Pinned by:** `bug fixed: picking up takes the one entry and leaves its twins on the tile`; `SSO: Ctrl sets the 4-frame item-action pause: Use waits it out` (packages/server/tests/inventory.test.ts); `bug fixed: a hall's board opens for its members from in front, locks, pause 4` (packages/server/tests/mail-boards.test.ts)

#### Ground items and containers have server ids
- **Kind:** Architecture
- **What you notice:** Ground items and containers retain their familiar names and visible `#n` suffixes.
- **1.6:** Ground entries were identified by name and pixel-position strings and containers by file names supplied by the client.
- **SSO:** Ground items and containers are server entities with IDs; their names remain for display.
- **Why:** Server IDs allow safe addressing of authoritative state.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`addGround`), `packages/server/src/systems/economy/containers.ts` (`openContainer`)
- **Pinned by:** `bug fixed: picking up takes the one entry and leaves its twins on the tile` (packages/server/tests/inventory.test.ts); `bug fixed: each bought container gets its own line and its own unused id` (packages/server/tests/economy.test.ts)

### Server-side mail

#### Mail is sent only from a mailbox
- **Kind:** Exploit closed
- **What you notice:** You must have your mailbox open to send mail; once you close it, open it again to send more.
- **1.6:** The compose pane, and therefore its send action, was available only after loading mail at a mailbox.
- **SSO:** The server refuses a send unless the player's mailbox is open (from opening it until the list's CLOSE or a map change, which also closes the mail screen), and logs a cheat line. A pane's CLOSE or REPLY leaves it open.
- **Why:** A forged client could otherwise send mail from anywhere.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`, `mailUiIntent`), `packages/server/src/game.ts` (`createGame`, the cheat line), `packages/server/src/systems/world/world.ts` (`enterRoom`), `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `SSO: closing the mailbox ends sending until it is opened again`; `a pane's CLOSE or REPLY keeps the mailbox open`; `SSO: a map change ends the mailbox session, so a send from elsewhere is refused` (packages/server/tests/mail-gate.test.ts); `a send with no mailbox opened this session stores nothing` (packages/server/tests/mail-boards.test.ts)

#### Mail reaches existing characters only
- **Kind:** Exploit closed
- **What you notice:** Sending to a name with no character is silently dropped; the sender still sees “*** Sending Mail...”.
- **1.6:** Sending mail appended to the file named by the client, creating it even if no such character existed; a relative path could reach another data file. The original did not confirm delivery.
- **SSO:** The server looks up the character name without regard to case and drops mail to a missing character silently.
- **Why:** Arbitrary names allowed path traversal and unbounded mailboxes for nonexistent characters.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`)
- **Pinned by:** `the sender is stamped, an unknown name is dropped and mailSent still goes` (packages/server/tests/mail-boards.test.ts); `names are found ignoring case, with the stored spelling`; `a send through the game reaches a character who is offline` (packages/server/tests/mail-boards-db.test.ts)

#### Boards open only from the board clicked
- **Kind:** Exploit closed
- **What you notice:** A board window shows the board you clicked, and posts go to that board.
- **1.6:** Clients could name any board to load or save, including guild boards from anywhere.
- **SSO:** The server opens only the board that was clicked or faced, from the tile in front of it (a hall's board for its guild's members only), and posts only to the open board.
- **Why:** A forged request could read or write a hall board from a distance.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardOpen`, `boardPostIntent`)
- **Pinned by:** `bug fixed: Town Square by click needs you in front: locks, no pause`; `bug fixed: a hall's board is refused to a non-member and from away`; `a post goes to the board that is open` (packages/server/tests/mail-boards.test.ts)

#### Mail sender stamped, mailbox writes restricted
- **Kind:** Exploit closed
- **What you notice:** Mail shows the sending character's name, and you can delete only your own messages.
- **1.6:** The client supplied the sender and could overwrite any mailbox.
- **SSO:** The server stamps the sender and restricts deletes to the player's own messages.
- **Why:** A forged sender or mailbox write enabled impersonation and mailbox wiping.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`, `mailDelete`)
- **Pinned by:** `the sender is stamped, an unknown name is dropped and mailSent still goes`; `only your own message; another's id does nothing` (packages/server/tests/mail-boards.test.ts); `delete removes only the owner's own row` (packages/server/tests/mail-boards-db.test.ts)

#### Message boards are append-only
- **Kind:** Exploit closed
- **What you notice:** A new board post is added to the existing board in the original `From:` format.
- **1.6:** Each post uploaded the whole board, and anyone could overwrite any board.
- **SSO:** The server appends the post.
- **Why:** Whole-board overwrites allowed vandalism and lost posts.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`)
- **Pinned by:** `bug fixed: a post is appended in 1.6's format and the open board reloads with it`; `a post is cut to 300 and a board keeps 200` (packages/server/tests/mail-boards.test.ts)

#### Uploaded images validated
- **Kind:** Exploit closed
- **What you notice:** Paintings and photos must be valid 64×64 PNG images to save.
- **1.6:** Raw image media of any size was written directly to the art directory.
- **SSO:** The server accepts only non-interlaced PNGs exactly 64×64, with 8-bit RGB or RGBA channels, checked chunks and CRCs, and at most the operator's `artBytesMax` limit, 16,384 bytes by default and at most. It gives each image a unique ID and silently drops invalid uploads.
- **Why:** Unbounded or malformed images could abuse disk and memory or be served to other players.
- **In the code:** `packages/server/src/systems/mail/upload-check.ts` (`isPng`), `packages/server/src/systems/mail/art.ts` (`artSaveIntent`), `packages/server/src/settings.ts` (`artBytesMax`)
- **Pinned by:** `the largest artBytesMax fits the upload message, so the setting always takes effect` (packages/server/tests/art-limit.test.ts)

#### A newspaper is saved under its writer's name
- **Kind:** Exploit closed
- **What you notice:** Saving a newspaper writes your own paper, the one your stand shows.
- **1.6:** The save carried the paper's name, and the server did not check it, so a client could overwrite anyone's paper.
- **SSO:** The server saves the paper under the name of the character who sent it.
- **Why:** A forged save could otherwise rewrite another player's newspaper.
- **In the code:** `packages/server/src/systems/mail/newspapers.ts` (`newspaperSaveIntent`)
- **Pinned by:** `bug fixed: a player saves to their own paper, loads it, and their stand shows it` (packages/server/tests/art-news.test.ts)

#### Mail, board and newspaper size caps
- **Kind:** Exploit closed
- **What you notice:** Long mail and board posts are shortened, and old mailbox messages or board posts are removed when their limits are reached.
- **1.6:** The server had no limits beyond the approximately 2 MB messaging cap.
- **SSO:** Operator defaults are 2,000 characters per mail body, 50 messages per mailbox, 200 posts per board and 300 characters per board post. Longer bodies and posts are cut; the oldest messages and posts are dropped. Newspaper fields are schema-bounded, with one paper per character: photo IDs 20 characters, body 4,000 and each of the other five fields 500.
- **Why:** Unbounded stored content and payloads served to other players could exhaust resources.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`), `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`), `packages/shared/src/protocol/mail.ts` (`newspaperSaveSchema`)
- **Pinned by:** `the body is cut to 2,000 characters`; `the 51st message drops the oldest`; `a post is cut to 300 and a board keeps 200` (packages/server/tests/mail-boards.test.ts); `SSO: a newspaper save holds photo ids of 20 characters, a 4,000-character body and 500 for each other field` (packages/shared/tests/ledger-pins-c.test.ts); `bug fixed: a player saves to their own paper, loads it, and their stand shows it` (packages/server/tests/art-news.test.ts)

#### One painting or photo per canvas or film
- **Kind:** Exploit closed
- **What you notice:** Each saved painting or photo uses one canvas or film. A second save without another is ignored.
- **1.6:** Saving needed no canvas or film, and a second Save in an open screen stored another painting.
- **SSO:** Using a Canvas or Film arms one save on the server; the save takes one Canvas or Film from the bag, a save that is not armed or finds none in the bag is ignored, and the arming clears on game entry.
- **Why:** A modified client could otherwise store unlimited images for free.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`useCanvas`, `useFilm`, `artSaveIntent`)
- **Pinned by:** `divergence: a second save and a save with no canvas are ignored` (packages/server/tests/art-news.test.ts); `divergence: an armed save whose Canvas or Film has left the bag is ignored` (packages/server/tests/art-news.test.ts)

#### Art is never lost to a full bag
- **Kind:** Exploit closed
- **What you notice:** If your bag is full, saving art says “You are carrying too much...” and keeps the Canvas or Film.
- **1.6:** The server stored the image and reported success, but the inventory addition lost the item when the bag was full.
- **SSO:** Before storing the image, the server refuses a save when more than 14 of bag lines 1–15 are filled, using the original carrying-too-much line and keeping the Canvas or Film.
- **Why:** The original could store an image that nobody held.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`artSaveIntent`)
- **Pinned by:** `divergence: a full bag is refused with the line and the canvas kept` (packages/server/tests/art-news.test.ts)

#### Art is viewed from the item, not by id
- **Kind:** Exploit closed
- **What you notice:** Clicking a painting or using one from your bag opens its image. A painting with an unknown ID opens a blank viewer showing “Author: ”.
- **1.6:** A client could ask to view any painting ID, and the path-built file name could read another file.
- **SSO:** The server reads the ID from the clicked ground item or used bag line; a hand-typed ID is not accepted.
- **Why:** A forged ID enabled path traversal and access to art the player did not hold.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`viewArt`)
- **Pinned by:** `divergence: an unknown id opens the viewer with no author and no picture` (packages/server/tests/art-news.test.ts)

### Server-side monsters

#### Monster state is server-owned
- **Kind:** Exploit closed
- **What you notice:** Monster positions, health and deaths come from the same server state for everyone.
- **1.6:** Monster messages were relayed without validation and a client could write monster state to a file.
- **SSO:** Only the server spawns, moves, damages, kills and persists monsters.
- **Why:** A modified client could otherwise spawn, teleport or delete monsters for everyone.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`), `packages/server/src/systems/monsters/ai.ts` (`moverPass`)
- **Pinned by:** `gate, tile, random(5), pause: a Slime spawns on its rolled tile with pause 30`; `blocked steps are skipped at no cost; a started step sets the pause to 90`; `a seeded Slime fight: bare hands kill it, the kill gives 23 XP at level 1` (packages/server/tests/monsters.test.ts); `a damaged Slime comes back where it was, with its HP` (packages/server/tests/monsters-db.test.ts)

#### Monster damage, monster attacks, XP and level computed on the server
- **Kind:** Exploit closed
- **What you notice:** Monster attacks, damage and the experience and levels awarded for kills are calculated by the server.
- **1.6:** Attackers calculated melee damage, victims rolled monster attacks, and the client managed experience and levels.
- **SSO:** The server performs those calculations using the original formulas.
- **Why:** Modified clients could award themselves rewards or ignore hits.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`), `packages/server/src/systems/combat/melee.ts` (`smash`)
- **Pinned by:** `a Slime next to you hits on random(10) = 1; the floatie is colour 6 with i-frames after`; `a seeded Slime fight: bare hands kill it, the kill gives 23 XP at level 1`; `bug fixed: XP overflow carries over and a kill can raise several levels` (packages/server/tests/monsters.test.ts)

#### One monster walk grid for every player
- **Kind:** Architecture
- **What you notice:** Monsters use the same walking grid regardless of the vehicles players are riding.
- **1.6:** Each client built its own monster blocked-tile grid. Layer 2 was checked on foot and in an Airship, but never added on a Boat or Battleship.
- **SSO:** The server's monster uses the on-foot grid regardless of players' vehicles.
- **Why:** One authoritative monster needs one grid; on foot is how most players saw its movement.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`nextStep`)
- **Pinned by:** `SSO: a monster walks the on-foot grid even with an Airship rider on the map` (packages/server/tests/ledger-pins-c.test.ts)

### Server-side movement

#### Authoritative server
- **Kind:** Architecture
- **What you notice:** Monster health agrees between players, and each monster attack is rolled once for everyone.
- **1.6:** Clients calculated combat, damage, XP, movement and collision, and every client on a map ran monster AI; the server stored and relayed results. Separately rolled spell damage let players see different monster health values, and each client rolled monster attacks against itself.
- **SSO:** The server computes those results and clients send their intended actions.
- **Why:** Server authority makes every player use the same game state and prevents clients from supplying their own results.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`movePlayer`), `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`)
- **Pinned by:** `a held arrow steps every 8 ticks and peers are told 16 calls` (packages/server/tests/world.test.ts); `gate, tile, random(5), pause: a Slime spawns on its rolled tile with pause 30` (packages/server/tests/monsters.test.ts); `SSO: no client message reports a result: hit points, damage, XP, level, a kill or a monster's state`; `SSO: the attack intent is the key's hold state only: no damage, power, target, position or weapon` (packages/shared/tests/ledger-pins-a.test.ts); `a fireball at a monster is placed next frame and hits in that frame's actor passes on FireballU-1 for 4 + P + random(3)` (packages/server/tests/spells.test.ts); `a seeded Slime fight: bare hands kill it, the kill gives 23 XP at level 1` (packages/server/tests/monsters.test.ts); `SSO: no client message field carries a result: hit points, damage, XP, level, a kill or a score` (packages/shared/tests/ledger-pins-e.test.ts)

#### Server-authoritative tile movement
- **Kind:** Exploit closed
- **What you notice:** Your client predicts your steps; the server corrects them when necessary.
- **1.6:** Each client decided collision, step timing, edge wrapping and exits, and peers trusted its movement messages.
- **SSO:** The server evaluates movement from input at 20 ticks a second.
- **Why:** Trusting the client allowed players to move too fast, pass through walls and teleport.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`movePlayer`)
- **Pinned by:** `a tick is 50 ms` (packages/server/tests/tick-loop.test.ts); `a held arrow steps every 8 ticks and peers are told 16 calls`; `a press shorter than one tick still steps once (the step impulse)` (packages/server/tests/world.test.ts)

#### Movement relay queue removed
- **Kind:** Exploit closed
- **What you notice:** Other players' movement comes from the server.
- **1.6:** The relay queue accepted a client-supplied movement payload naming a map and player.
- **SSO:** The server broadcasts moves; the relay queue is removed.
- **Why:** Anyone could forge another player's movement.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`movePlayer`)
- **Pinned by:** `a held arrow steps every 8 ticks and peers are told 16 calls` (packages/server/tests/world.test.ts); `others see the pushed player's step` (packages/server/tests/push.test.ts)

#### Turn-in-place visible to others immediately
- **Kind:** Architecture
- **What you notice:** Other players see your new facing as soon as you turn in place.
- **1.6:** An Alt-turn sent no message; peers saw the new facing only on the next move.
- **SSO:** The server broadcasts facing changes.
- **Why:** The server owns facing for attacks and Ctrl actions, so it sends the current direction.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`announce`)
- **Pinned by:** `turn in place is broadcast; the mover gets 'you', not a delta` (packages/server/tests/world.test.ts); `turn in place: no step, and the other player sees the new facing` (packages/server/e2e/login-and-walk.test.ts)

### Server-side progression

#### Server applies damage, mitigation, i-frames and death
- **Kind:** Exploit closed
- **What you notice:** Damage, protection, brief hit immunity and death are calculated by the server.
- **1.6:** The victim's client handled damage, spell collisions and death checks.
- **SSO:** These calculations run on the server.
- **Why:** A modified client could ignore damage, Hold or death.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `a melee hit starts the victim's i-frames; no sprite is hidden on anyone's screen` (packages/server/tests/melee.test.ts); `bug fixed: armour and Magic Shield change the spell damage you take`; `damage only where PvP is on; the victim flickers 40 frames` (packages/server/tests/spells.test.ts); `death: HP and SP 1, facing south, then the death text to everyone and the respawn warp` (packages/server/tests/monsters.test.ts)

#### Character creation validated by the UI rules
- **Kind:** Exploit closed
- **What you notice:** A new character's starting stats must fit the character creation rules.
- **1.6:** The interface allowed at most 50 assigned points and a maximum of 20 per stat, while a separate client-only check allowed a sum up to 66.
- **SSO:** The server enforces stats from 1 to 20, a five-stat total at most 55, and the name rules.
- **Why:** A modified client could create a 66-point or otherwise arbitrary character.
- **In the code:** `packages/shared/src/rules/progression/creation.ts` (`creationError`)
- **Pinned by:** `letters only, any case`; `50 points, each of the five stats 1..20`; `other fields and the starting bag` (packages/shared/tests/progression/creation.test.ts); `creation re-checks the screen's rules on the server` (packages/server/tests/world.test.ts)

#### Regen, hunger, food and death run on the server
- **Kind:** Exploit closed
- **What you notice:** Regeneration, hunger and the consequences of death continue according to the server's game state.
- **1.6:** The client managed regeneration, hunger, food and death.
- **SSO:** The server ticks each online character and applies death, penalties and drops.
- **Why:** A modified client could skip penalties, regenerate at will or avoid starvation.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`regenStep`, `hungerStep`, `checkDeath`)
- **Pinned by:** `regen every 74 frames at target 149` (packages/server/tests/retime.test.ts); `SSO: the server tick spends hunger on random(3) = 1, and only then` (packages/server/tests/ledger-pins-c.test.ts); `eating an apple: one unit spent, HP up, hunger up, the line` (packages/server/tests/inventory.test.ts); `death: HP and SP 1, facing south, then the death text to everyone and the respawn warp` (packages/server/tests/monsters.test.ts); `wanted, no gold: a random bag line is picked; one unit goes on the death tile` (packages/server/tests/inventory.test.ts)

#### The regen counter restarts at login, not on a resumed connection
- **Kind:** Architecture
- **What you notice:** The regeneration counter starts again at login, but not when a dropped connection resumes the same session.
- **1.6:** The counter restarted with its timer sprite, such as after a client restart or relogin.
- **SSO:** The counter belongs to the play session and resets at login, not a resumed session.
- **Why:** There is no timer sprite on the server; login is the equivalent boundary.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`regenStep`), `packages/server/src/systems/world/world.ts` (`sessionCombatState`)
- **Pinned by:** `a resumed session keeps the regen counter; a login resets it` (packages/server/tests/monsters-db.test.ts)

### Server-side social

#### Guilds stored as server rows
- **Kind:** Exploit closed
- **What you notice:** Guild actions use current membership and leadership, and accepting an invitation requires the inviter to remain online and in charge.
- **1.6:** Clients could overwrite or delete guild files, join without an invitation and use path-like guild names to read other files, including character files containing passwords. An ex-leader's open screen still allowed exile, abdication and disbanding, and could crown a stale selection. A peer accept sent after its leader left was lost.
- **SSO:** Guild and member rows and each character's Guild field are written together. Each action checks current membership and leadership, names resolve to rows rather than paths, and Accept requires a pending invitation from an online current leader. A disbanded row remains so offline members can be told on login, and only its last leader may create its name again, reusing the old row's id and so its vault, Guild Key doors and hall (see [the fix](#only-a-disbanded-guilds-leader-may-found-its-name-again)).
- **Why:** Unchecked file and action requests allowed guild hijacking, forgery, disclosure and disbanding.
- **In the code:** `packages/server/src/systems/social/guilds.ts` (`guildAction`, `guildAnswer`, `guildCreate`)
- **Pinned by:** `divergence: a stale target (exiled since) is refused`, `divergence: ACCEPT after the inviter left joins nothing` (packages/server/tests/guilds.test.ts); `create, join, exile and disband are written with the fields; a restart reads them` (packages/server/tests/guilds-db.test.ts); `bug fixed: only the leader who disbanded a guild may found its name again` (packages/server/tests/guilds.test.ts)

#### Faction membership and power are server state
- **Kind:** Exploit closed
- **What you notice:** Faction membership, bonuses and power follow your character and real head turn-ins.
- **1.6:** Joining was performed by the client after a forgeable peer message, and heads could be created by a drop request.
- **SSO:** The server holds membership, timer, bonuses and faction powers. Heads come only from deaths and loot. A rival head refreshes every online player's bonus, like the original faction broadcast made clients request again.
- **Why:** Forged messages and items could grant free bonuses or alter faction power.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`giveHead`, `refreshBonuses`)
- **Pinned by:** `a rival head to Angela: said to the map, power moved, joined, announced to the Mages, bonuses for all`; `a member drops its head on a PvP-X map before its item drop, whatever killed it`; `the count drains per frame, warns at 20000 and kicks at 1, leaving the channel` (packages/server/tests/factions.test.ts)

#### Murder flag and pardons are server-only
- **Kind:** Exploit closed
- **What you notice:** A credited killer can become wanted; staff with `/pardon` can pardon an online player they outrank.
- **1.6:** Any client could send wanted or pardon messages to any player. A message to an absent killer was lost.
- **SSO:** On an innocent player's non-arena death, at the end of the death lock, the server credits the recorded last player to hit them by player ID and applies the flag, even if another cause dealt the final blow, provided the hit landed within 40 ticks (2 seconds) of the death (see [A death long after the last hit credits no one](#a-death-long-after-the-last-hit-credits-no-one)). A player who has logged off is not flagged, nor is anyone during a Lightning Assassin's game. A staff `/Pardon` says “<name> is not online.” if the named player is absent.
- **Why:** Forged messages could frame an innocent player or pardon oneself.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`, `pardon`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `an unflagged victim flags its killer at the end of the lock, naming the victim`; `a death within the credit window still credits the hit`; `a killer who has left is not flagged (1.6's message to an absent name was lost)` (packages/server/tests/factions.test.ts); `bug fixed: the kill pays 10 after the death line and flags no one` (packages/server/tests/assassin.test.ts); `SSO: /Pardon of a name that is not online says "<name> is not online."` (packages/server/tests/ledger-pins-c.test.ts)

#### Assassin points computed by the server
- **Kind:** Exploit closed
- **What you notice:** Assassin points come from deaths credited by the server and are announced just after the death line.
- **1.6:** A client could submit any number of points or forge the score message. A message to a killer who had left was lost.
- **SSO:** The server applies the original comparison to the recorded last player to hit the victim, by player ID, at the end of the death lock. The hit must have landed within 40 ticks of the death, even if something else dealt the final blow; a player who has logged off earns nothing. The one-hit Lightning flag comes from the server's game mode.
- **Why:** Forged scores could win prizes.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`scoreKill`, `lightningOn`)
- **Pinned by:** `a normal game pays CompareAss on the victim's rating; the total adds up; a wanted victim counts`; `a killer who has logged off earns nothing; nor does a monster or yourself` (packages/server/tests/assassin.test.ts); `a death within the credit window earns the attacker Assassin points`; `bug fixed: a death long after the last hit earns its old attacker no Assassin points` (packages/server/tests/factions.test.ts); `one landed melee hit kills: HP held at 1, no drop, head, penalty or exile` (packages/server/tests/assassin.test.ts)

#### Bios composed by the server
- **Kind:** Exploit closed
- **What you notice:** Asking for a Bio shows the target's items, title, score and disguises; editing your own profile happens through your Bio window.
- **1.6:** The target's client composed its Bio, and any incoming Bio message opened a window without a request. A forged message naming the recipient opened their editable layout with the sender's text and saved that text on close.
- **SSO:** The server composes the Bio from the target's state using the original contents and sends it only in response to a request. Your profile changes through your own Bio window.
- **Why:** Forged messages enabled fake Bios and profile rewrites.
- **In the code:** `packages/server/src/systems/social/bios.ts` (`bioRequest`, `profileSave`)
- **Pinned by:** `the requester sees the target's bio drawn; own is false for someone else` (packages/server/tests/friends.test.ts)

#### Profiles are capped
- **Kind:** Exploit closed
- **What you notice:** A profile can contain up to 500 characters.
- **1.6:** Typing stopped when the limited profile field filled its 271×102 pixel box in Arial 12 bold; nothing else bounded the text.
- **SSO:** The box accepts at most 500 characters, and the server cuts longer text to 500 before saving.
- **Why:** A pixel limit in the client is not a server storage limit.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`saveProfile`)
- **Pinned by:** `capped at 500 characters` (packages/shared/tests/social/friends-bios-medals.test.ts)

#### Friends list capped at 199
- **Kind:** Exploit closed
- **What you notice:** An addition that would exceed 199 names is refused with “Your friends list is full.” A colon in a name can add several names at once, and the whole addition is refused if it would exceed the limit.
- **1.6:** Adding a buddy had no limit; removal searched only items 1–190 and rebuilt from items 1–200, dropping names past the 199th at the next removal.
- **SSO:** The account's list holds at most the 199 names kept by the original rebuild.
- **Why:** Each addition rewrites the stored account list, so an unbounded flood could eventually stall the server.
- **In the code:** `packages/shared/src/rules/social/buddies.ts` (`buddyAdd`)
- **Pinned by:** `divergence: the list holds 199 names; an add past that is refused` (packages/shared/tests/social/friends-bios-medals.test.ts)

#### Assassin's game state is server rows
- **Kind:** Architecture
- **What you notice:** Assassin scores, legends, game mode and prizes persist on the server; the all-time table starts empty on a fresh server.
- **1.6:** The game used separate files for mode, each player's score and wins, two top-ten tables and prizes. A winner's prize was written into the winner's item file.
- **SSO:** Server rows store the game, current and all-time tables, player scores and legends; ordered entries keep character IDs and name copies. Prizes come from the `assassinPrizes` setting, and an offline winner's prize is written to the stored bag. No old all-time standings are seeded.
- **Why:** The server owns the state, and the archive's all-time names belonged to players without characters on this server.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`setAssassinMode`, `endGame`)
- **Pinned by:** `nothing seeded: STOP and empty tables; the state round-trips in order`; `an end writes an offline winner's prize into its stored bag` (packages/server/tests/assassin-db.test.ts); `the end: lines, a win, STOP, prizes 1-3 (online ones added to the bag, offline ones written)` (packages/server/tests/assassin.test.ts)

#### High-score points computed by the server
- **Kind:** Exploit closed
- **What you notice:** The High Score Statue's score reflects your character's skills and is checked on each periodic save.
- **1.6:** Clients could submit any integer as a high score; ordinary clients submitted only one time in three.
- **SSO:** The server computes the points from authoritative skills and ranks them on each periodic save.
- **Why:** A modified client could otherwise submit fake leaderboard scores.
- **In the code:** `packages/server/src/systems/social/highscores.ts` (`submitHighScore`)
- **Pinned by:** `submitted on the save tick only; administrators skipped; five-digit scores count` (packages/server/tests/highscores.test.ts)

### Server-side spells

#### Server-created spells only
- **Kind:** Exploit closed
- **What you notice:** Casting uses your character's spellbook, power and available resources.
- **1.6:** Receivers trusted the reported caster, positions and spell power; the client checked spell points, spellbook, delay and whether the cast was harmful.
- **SSO:** The server validates the spell and target intent and computes spell power.
- **Why:** A forged client could cast as another player at arbitrary power.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `a spell not in your spellbook does nothing at all, not even the delay`; `bug fixed: the server takes a cast click only on the playfield [30, 31, 574, 415]`; `bug fixed: Fireball and Wind Wave cast with their school bonus` (packages/server/tests/spells.test.ts)

#### Server-side spell learning
- **Kind:** Exploit closed
- **What you notice:** A book that passes the Dexterity check teaches its spell or skill and is used up; one that teaches nothing stays in your bag.
- **1.6:** The client checked Dexterity, appended the spell and uploaded the spellbook.
- **SSO:** The server performs the Dexterity check, appends the spell and consumes the book.
- **Why:** A modified client could grant itself any spell.
- **In the code:** `packages/server/src/systems/spells/learn.ts` (`readBook`)
- **Pinned by:** `Dex too low: the refusal, the book kept`; `read and learned, the book used up` (packages/server/tests/spells.test.ts)

#### No effect triggers without a cast
- **Kind:** Exploit closed
- **What you notice:** Portals, body changes, created food and weapon fireballs arise from game actions the server has validated.
- **1.6:** Messages could trigger a portal exit without a portal, change or restore another player's body, grant food, or send Fire Staff and Firesword fireballs.
- **SSO:** The server triggers effects only from validated state.
- **Why:** A forged client could teleport for free, change another player's body, create items or deal free damage.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`, `swingFireballs`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`, `setBody`), `packages/server/src/systems/world/tick.ts` (`portal`)
- **Pinned by:** `a spell not in your spellbook does nothing at all, not even the delay`; `bug fixed: Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon and Identify are refused before anything is spent`; `stepping into the portal's frame 3 warps you to random(count) of the operator's targets` (packages/server/tests/spells.test.ts); `SSO: no client message sets a body, makes food or fires an effect; a cast names only the spell and the point` (packages/shared/tests/ledger-pins-a.test.ts); `SSO: no client message field sets a body, makes food or fires an effect` (packages/shared/tests/ledger-pins-e.test.ts)

#### Monster spells and summons authored by the server
- **Kind:** Exploit closed
- **What you notice:** Monster spells and summoned monsters come from the server.
- **1.6:** Clients sent the messages for monster spells and summons.
- **SSO:** Only the server creates them.
- **Why:** Any client could otherwise cast as a monster or spawn monsters.
- **In the code:** `packages/server/src/systems/spells/monsterspells.ts` (`monsterSpells`)
- **Pinned by:** `the Server Spirit casts only into the hazard map's room`; `kept on purpose: an unprovoked Passive Acrostia casts Major Heal at you`; `Summon Creature: a Pig in the first free slot; Cow at Sorcery > 39` (packages/server/tests/spells.test.ts)

#### Hold cannot target players on safe maps
- **Kind:** Exploit closed
- **What you notice:** Casting Hold off an arena tile on a safe map is refused with “You cannot cast harmful spells here!” before spending spell points, crystals or the cast delay.
- **1.6:** Hold was not in the harmful set and had no player-versus-player check. A player could repeatedly cast it to hold another player indefinitely in town. It had no effect on monsters.
- **SSO:** Hold is refused like a harmful spell when the caster is off an arena tile on a safe map; fight maps are unchanged.
- **Why:** Repeatedly holding another player in town enabled griefing.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `harmful spells and Hold are refused on a safe map before SP is spent`; `a player's Hold roots another player where PvP is on` (packages/server/tests/spells.test.ts)

#### One authoritative monster HP and one roll per hit
- **Kind:** Architecture
- **What you notice:** Players see the same monster health and each hit is rolled once.
- **1.6:** Each client had its own monster HP and made its own spell-damage rolls.
- **SSO:** Each map has a single authoritative monster instance.
- **Why:** The server owns monster state.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`monsterHits`), `packages/server/src/systems/combat/melee.ts` (`smash`)
- **Pinned by:** `a fireball at a monster is placed next frame and hits in that frame's actor passes on FireballU-1 for 4 + P + random(3)`; `a second Meteor inside the lockout still misses: only the FX that set it hits again` (packages/server/tests/spells.test.ts); `a seeded Slime fight: bare hands kill it, the kill gives 23 XP at level 1` (packages/server/tests/monsters.test.ts)

#### Server collision geometry
- **Kind:** Architecture
- **What you notice:** Spell collisions use the server's view of player and monster positions.
- **1.6:** Every client tested sprite rectangles for its own player and for monsters.
- **SSO:** The server evaluates the same rectangle tests once, using member rectangles and registration points from asset metadata.
- **Why:** Collision is server-authoritative.
- **In the code:** `packages/server/src/systems/spells/geometry.ts` (`playerRect`, `monsterRect`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`, `monsterHits`)
- **Pinned by:** `a hit rect for a standing rider cycles F2, F3, F1 with the tick` (packages/server/tests/vehicles.test.ts); `a fireball at a monster is placed next frame and hits in that frame's actor passes on FireballU-1 for 4 + P + random(3)` (packages/server/tests/spells.test.ts)

#### Hazard timer on ticks
- **Kind:** Architecture
- **What you notice:** Environmental hazards run on the server's regular tick schedule.
- **1.6:** A 350 ms server timeout drove hazard messages.
- **SSO:** The hazard timer runs every seven ticks.
- **Why:** The simulation runs at 20 ticks a second.
- **In the code:** `packages/server/src/systems/spells/hazards.ts` (`serverTimer`)
- **Pinned by:** `SSO: the hazard timer runs once every seven ticks` (packages/server/tests/ledger-pins-c.test.ts)

#### Summons stay on the map
- **Kind:** Architecture
- **What you notice:** No summon or dropped pig lands off the 17×12 map.
- **1.6:** The cast area extended far enough beyond the 17×12 playfield that clicking its right or bottom edge could place a monster on column 18 or row 13.
- **SSO:** A cast click must be on the playfield, and a summon whose tile is off the map is refused before anything is spent; a pig dropped toward an edge stays in the bag.
- **Why:** Server monsters live on map tiles; an off-map monster could not be reached or saved.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`, `planSummon`, `summonPig`), `packages/shared/src/rules/spells/spells.ts` (`inCastBounds`), `packages/server/src/systems/inventory/items.ts` (`pigDrop`)
- **Pinned by:** `bug fixed: the server takes a cast click only on the playfield [30, 31, 574, 415]` (packages/server/tests/spells.test.ts); `bug fixed: Raise Dead on a grave in the bottom row is refused before anything is spent: the Zombie would be off the map` (packages/server/tests/spells.test.ts); `bug fixed: a faced tile off the map at the side, bottom or top → "You can't drop an animal here!", the pig kept` (packages/server/tests/pigs-orbs-webs.test.ts)

### Server-side vehicles

#### Vehicles converted by the server
- **Kind:** Exploit closed
- **What you notice:** Unboarding turns your airship, boat or battleship into your vehicle item. Ownership follows your character, including after a rename.
- **1.6:** Unboarding named the item to create; ownership compared the text before the apostrophe in the item name with the player's name.
- **SSO:** The server builds, boards and parks every vehicle and converts it to the owner's item. Ownership is recorded by character ID while the item's name remains `<name>'s Airship` (or `'s Boat`, `'s Battleship`). Items without an owner ID, such as an operator drop or World Editor placement, use the original name test.
- **Why:** A client could create arbitrary items, while name-only ownership could let a renamed or look-alike character board someone else's vehicle.
- **In the code:** `packages/server/src/systems/vehicles/vehicles.ts` (`vehicleClick`, `unboardVehicle`)
- **Pinned by:** `builds on the faced J2, consumes one deed, owner id recorded, no text`; `Ctrl facing it: you hop onto its tile, no step, body 57, the text`; `Ctrl on a pad parks the airship under you, the paperdoll returns, no text`; `another player's airship: not yours; facing away: you see`; `an item with no owner id falls back to the 1.6 name test` (packages/server/tests/vehicles.test.ts); `SSO: ownership follows the character id, not the name: a renamed owner still boards` (packages/server/tests/vehicles.test.ts)

### Server-side world

#### Respawn point and portal exit decided by the server
- **Kind:** Exploit closed
- **What you notice:** Portals and respawns take you to the destination selected by the game.
- **1.6:** The client could send an arbitrary respawn map and tile or request a portal exit at will.
- **SSO:** The server evaluates the same rules and determines the destinations.
- **Why:** Players could set arbitrary respawn points and farm portal warps.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`respawn`, `portal`)
- **Pinned by:** `SSO: a death or release goes to your respawn point, else the fallback point; a lost place goes to the fallback point`; `SSO: the server records the respawn point on entering an O-O-O map; the client sends none` (packages/server/tests/world.test.ts); `stepping into the portal's frame 3 warps you to random(count) of the operator's targets` (packages/server/tests/spells.test.ts)

#### Respawn point derived by the server
- **Kind:** Exploit closed
- **What you notice:** Entering an O-O-O map other than the jail records your respawn point at its entry tile.
- **1.6:** The client could write an arbitrary respawn destination.
- **SSO:** The server records the point when a player enters an O-O-O map, except the jail map.
- **Why:** A modified client could otherwise set an arbitrary respawn teleport.
- **In the code:** `packages/server/src/systems/world/world.ts` (`enterRoom`)
- **Pinned by:** `SSO: the server records the respawn point on entering an O-O-O map; the client sends none` (packages/server/tests/world.test.ts)

#### Map loading lock
- **Kind:** Architecture
- **What you notice:** Movement waits while a new map loads, and your character cannot be hit during that loading period.
- **1.6:** The keys stayed locked until the map's items were drawn; the arriving client did not run monster attacks before its map was drawn.
- **SSO:** The server holds a loading state until the client says the map is ready or 100 ticks pass; a loading player cannot be hit.
- **Why:** The server owns the input gate.
- **In the code:** `packages/server/src/systems/world/world.ts` (`enterRoom`), `packages/server/src/systems/world/tick.ts` (`tick`)
- **Pinned by:** `loading: no movement until mapReady or 100 ticks` (packages/server/tests/world.test.ts); `SSO: a player still loading the map is not hit by a monster beside it` (packages/server/tests/ledger-pins-c.test.ts)

#### Exactly two actor passes per frame
- **Kind:** Architecture
- **What you notice:** On occasional frames, walking, monster steps, attack rolls, hit immunity and regeneration run one or more calls slower than they could in 1.6.
- **1.6:** Director 8.5 ran an actor pass for each frame transition or stage update. The play frame normally triggered two passes, but redraw, exit and death handlers could add passes. A measured run had 452 frames with two passes, 28 with three, one with four and two with five.
- **SSO:** Every frame runs exactly two passes in the original order: frame counters, first pass, key poll and second pass. Extra passes are not modeled.
- **Why:** The extra calls depended on client display redraws; reproducing them would tie server timing to the original display plumbing.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`tick`), `packages/client/src/model.ts` (`clientTick`)
- **Pinned by:** `the key poll runs between the two actor passes` (packages/client/tests/model.test.ts); `a held arrow steps every 8 ticks and peers are told 16 calls` (packages/server/tests/world.test.ts)

#### Per-client AI rolls become per-player server rolls
- **Kind:** Architecture
- **What you notice:** Monster spawning, movement, spells and NPC chatter scale with the number of players on the map.
- **1.6:** Every client's frame made its own rolls for spawning, movement authoring, monster spells and NPC chatter, using player-count ladders.
- **SSO:** One authoritative map instance makes each roll once per player on the map, up to 15, targeting that player.
- **Why:** This preserves aggregate rates and per-player targeting without client authority.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`emulated`, `tick`)
- **Pinned by:** `SSO: each player on the map makes the spawn roll, up to 15` (packages/server/tests/ledger-pins-c.test.ts); `bug fixed: ladders: spawn 80…1300 by players, move 30…600 and 600 from the 8th on` (packages/server/tests/monsters.test.ts)

#### The death save holds the respawn tile
- **Kind:** Architecture
- **What you notice:** After respawning, a crash does not restore you to the tile where you died.
- **1.6:** The death script saved the character before the warp reply arrived, leaving the death map and tile in the file until the next save. A crash before then returned the player to the death location.
- **SSO:** The server moves the player and saves the respawn place in one step.
- **Why:** The old file state was a race between client save and server warp; the server now owns position.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`respawn`)
- **Pinned by:** `SSO: the tick that moves a dead player to the respawn tile also saves them` (packages/server/tests/ledger-pins-c.test.ts)

## Not in SSO

What 1.6 did that cannot happen under server authority, and what 1.6 built but never reached.

### Leftovers of peer-to-peer play

1.6 ran each player's game on their own computer, so it had quirks that cannot exist when the server is in charge. They need no fix in SSO.

- **The airship picture lingered after death.** 1.6 left a dead rider drawn as the airship until each viewer's screen happened to reset it, a 1-in-50 roll per frame. SSO's server resets it for everyone at the moment of death (`packages/server/src/systems/vehicles/vehicles.ts`, `vehicleDeath`).
- **Other players' steps were batched through a relay queue.** 1.6 sent a step directly only when exactly one other player was present; with two or more it relayed steps in 350 ms batches, duplicating some and dropping others when the queue was long. SSO's server broadcasts each step in the tick it happens, so nothing is needed.
- **Sprite-slot miscounts in the player and monster lists.** 1.6 counted players, blocked tiles and clicked names by reading fixed sprite slots, and a few slots were miscounted or wired to the wrong name field. SSO has no sprite slots, so nothing is needed.
- **The warp's input lock sat in a local variable.** 1.6 set its keyboard lock for a warp in a variable that did nothing outside that one routine; it was harmless because the hidden playfield blocked moves anyway. SSO's server holds a loading lock while you change map, so nothing is needed.
- **Several admin commands misbehaved in small ways.** 1.6 warped an admin twice for some flag pairs, showed location and IP lookups twice to someone flagged both immortal and moderator, needed an extra server access level to kick, overwrote the admin's own IP during a lookup, left a kick reply with no handler, stacked the banned prefix on repeated bans, made a file for a ban on a name that does not exist, and left stray `**` gaps in the IP ban list. SSO checks each command's permission once and the server does the kicking and banning, so none of this exists.
- **Each screen kept its own monster hit points.** 1.6 had every client apply melee damage and roll spell damage to its own copy of a monster's hit points, so the copies drifted apart and two players could each be awarded the kill. SSO has one authoritative monster, one roll and one killer.
- **Each client rolled monster attacks against itself.** 1.6 had every client roll monster attacks and spells against its own player. SSO's server rolls once per monster and player pair, with the same probabilities.
- **A twelfth spell effect cancelled an older one.** 1.6 had eleven spell-effect sprite slots; with all busy, a new spell reused the first and cancelled the old effect. SSO has [no such cap on effects](#no-11-spell-fx-cap).
- **Monster-hit floating numbers vanished in a crowd.** With two or more other players on screen, 1.6 routed the floating hit number through the relay queue without the map prefix, so the queue misfiled it and nobody saw it. SSO sends floating numbers as server events to the whole map, so they always show.
- **Spell damage differed between screens.** 1.6 had every client roll spell effects on monsters on its own, so monster hit points differed between players. SSO keeps one server value.
- **A duplicate monster spawner gave 10-XP kills.** 1.6 recorded a monster's name for the kill check before checking whether the slot was taken, and compared some slots to another monster's name, so after a duplicate spawn a later kill failed the name check and gave only 10 XP. SSO has one spawner and no duplicates, and drops the name check.
- **A stale monster save file brought dead monsters back.** 1.6 saved monsters at random moments, so the file could predate kills and the dead came back after a restart. SSO writes monster state on every spawn and death (`packages/server/src/systems/monsters/spawn.ts`, `spawnPass`).
- **The client banned itself on odd values.** 1.6 had the client ban its own player when hit points, level, skill or experience looked too high, and quit on a suspected speed hack. SSO does not need this because the server owns those values.
- **Client-side gold and item grants were overwritten.** 1.6 let some client-side routines add gold or items locally, and the next inventory update from the server overwrote them. SSO's client draws only what the server says, so nothing is needed.
- **A drop blanked the bag line and some replies kept the lock.** 1.6 blanked a whole bag line on screen after a drop until the next inventory update, and some replies, including refusals, sent nothing that cleared the item-action wait. SSO's client shows only server state and refusals answer at once.
- **Arriving viewers did not see gloves.** 1.6's arrival messages carried body, head, feet, both hands and head number but no ring slot, so a player arriving on a map saw no gloves until the wearer next changed equipment. SSO's look always carries all six slots, so nothing is needed.
- **The item action lock waited on the server.** 1.6 blocked further item actions on the client after equip, drop, use, planting or crafting until an inventory update arrived, and any chat line from anyone could clear it early. Only after a burned meal did it outlast the craft. SSO has one pending item action per character, cleared when processed, and crafting sets no extra pause.
- **Ground sprites and giving were drawn by peer messages.** 1.6 drew and removed ground sprites through room chat messages, and a give waited a fixed number of ticks before grabbing. SSO's server broadcasts ground changes and times the give-grab itself, so nothing is needed.
- **Gathering ran on every client.** 1.6 ran each gathering swing on all clients and passed tile changes to others with a message that had a substring-matching bug. SSO's server applies and broadcasts tile changes, so nothing is needed.
- **The trade window scrambled text and misjudged who was nearby.** 1.6 scrambled vowels in trade lists and names, which also lowercased capital vowels so a traded "Apple" arrived as "apple", and its test for the partner being on screen read the wrong sprite slot, so with one other player on screen Accept always said "<name> is no longer in your area, you cannot trade." SSO's server holds the session, names keep their case, and Accept checks the partner is on your map (`packages/server/src/systems/economy/trade.ts`, `acceptTrade`).
- **Relocking a door was sent once per player in the room.** 1.6 had every client in the room count down and send its own door-relock message. SSO has one server timer per map, so nothing is needed.
- **A guild exile dropped late joiners.** 1.6 rebuilt the whole guild file from the leader's open screen, so anyone who joined since was dropped, and other members' copies went stale. SSO changes guild rows one member at a time on the server (`packages/server/src/systems/social/guilds.ts`, `guildAction`).
- **Some guild names broke their file.** 1.6's name cleaner left one of two adjacent special characters, and a colon then cut the name at the server while the others made an illegal file path. SSO stores guilds as rows, so such a name is stored and works (`packages/server/src/systems/social/guilds.ts`, `guildCreate`).
- **The slot machine panel could stick.** In 1.6, if your gold went away between starting a pull and its result, the server exited silently and the panel could be neither pulled nor closed until the client restarted; three result handlers also set a misspelled flag that had no effect. SSO does not build either: the result always answers (`packages/server/src/systems/casino/slots.ts`, `slotTick`).
- **Blackjack tables on different maps could share a game.** 1.6 named a table's group by its screen position without the map, so tables at the same position on different maps joined one game. SSO's table instance includes the map (`packages/server/src/systems/casino/tables.ts`, `tableKey`).
- **A checkers move hid another player's sprite.** 1.6 moved one main-stage sprite off screen on every checkers move, which was the sprite of the fifth other player nearby, who vanished until they moved. SSO has no sprite slots, so nothing is needed.
- **Two players could take one seat, or three sit at a table.** 1.6 did nothing to stop two players taking the same side or a third joining, so each screen showed a different pairing and a newcomer's name landed in the wrong field. SSO's server holds the seats and a taken side says "That seat is taken." (`packages/server/src/systems/casino/blackjack.ts`, `bjSit`).
- **A blackjack bid reset on leaving never ran.** 1.6 blanked the leaver's name and then compared against that blank name before resetting the bid, so the reset never ran. SSO's server blanks the leaver's seat and field itself, so nothing is needed.
- **One client settled blackjack.** 1.6 had only the first player's client total the hands and send the result. SSO's server settles the hand (`packages/server/src/systems/casino/blackjack.ts`, `settle`).
- **The player who stayed could move alone in checkers.** 1.6 blanked the quitter's name and reset the board but not the stayer's turn, so the stayer could make one move alone. SSO's board waits for a new opponent and nobody moves until one sits.
- **Text containing a semicolon was silently dropped.** 1.6's server split routed text at semicolons and dropped it unless the first item was the sender's name, a sender check built on a text protocol. SSO authenticates the sender per session, so the check does not exist and text containing a semicolon is delivered.
- **Mail delete could hit the wrong message.** 1.6 mixed up the raw mail list with the filtered display when deleting, and re-uploaded the whole mailbox, so a delete could erase newer mail. SSO deletes message rows by id (`packages/server/src/systems/mail/mail.ts`, `mailDelete`).
- **Painting ids could collide.** 1.6 gave each painting a random id from a large range, so two could collide and one overwrote the other. SSO issues unique ids (`packages/server/src/systems/mail/art.ts`, `artSaveIntent`).
- **An ignored chat line still unlocked the bag.** 1.6 ended the client's wait for a server reply before checking whether the speaker was ignored, so an ignored player's line still unlocked it. SSO's server holds no such wait, and an ignored line is simply not sent.
- **The Friends window trusted any online notice.** 1.6 added a name to your Friends window when any client said it was online, unchecked, and skipped a buddy whose name was part of one already shown, so a listed "JimBob" hid a buddy "Bob". SSO's server keeps the window's lines from its own sessions, and an online buddy shows once, by exact name (`packages/server/src/systems/social/friends.ts`, `friendsPresence`).
- **Buddies deep in the online list never matched.** 1.6 cleaned quotes and brackets from only the first 800 characters of the online-users reply, so buddies listed further in never matched. SSO's server fills the window from its own roster and reads the first 200 names online, as 1.6 did (`packages/server/src/systems/social/friends.ts`, `friendsEntry`).
- **Closing a player's bio freed the keys.** 1.6 cleared the keyboard lock on every close of the bio window, so closing a player's bio ended a craft's lock or a death lock on that client. SSO's server holds every lock, so closing a player's bio frees nothing (an NPC's bio still ends its own lock) (`packages/server/src/systems/monsters/npc.ts`, `closeBio`).
- **Mail and post text lost or split characters.** 1.6 stripped asterisks from a body when sending, let a bar split a message into phantom list lines, and cut the rest of a mail or board at a backtick. SSO stores messages as rows, so every character is kept.
- **A backtick in a newspaper field shifted later fields.** 1.6 joined the nine newspaper fields with backticks and split them again on reading, so a backtick typed in a field moved every later item, and a semicolon made the server drop the save. SSO sends the fields as separate values, so every character is kept (`packages/server/src/systems/mail/newspapers.ts`, `newspaperSaveIntent`).

### Features 1.6 never reached

These were built into 1.6 but could never be reached in play, so SSO does the same and does not build them.

- **The elemental orb war never worked.** 1.6 was designed so that an orb dropped on an elemental platform shifted the balance of power between the four mage classes, but nothing connected it: no platform existed, nothing saved the balance and no monster dropped an orb, so an orb dropped as an ordinary item. The four orbs had no picture and no way to be got either, so they are not in the Classic pack (see [Items nobody could get, or could only get without a picture, are gone](#items-nobody-could-get-or-could-only-get-without-a-picture-are-gone)), and SSO does not build the war; it is a candidate to build after release, with orbs that have art.
