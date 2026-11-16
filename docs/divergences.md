# Divergences from First Star Online

Second Star Online aims to play exactly like First Star Online 1.6. This ledger explains deliberate differences, what a player notices, and why they exist. Gameplay bugs that SSO keeps are in [bug-ledger.md](bug-ledger.md).

Every deliberate gameplay difference is recorded here with the code that implements it. Add or update an entry in the same change as the difference.

Kinds are **Architecture** (server authority and related design), **Exploit closed**, **Limit lifted**, **Platform**, **World content**, and **Bug fixed**. **Other** covers a remaining deliberate difference that does not fit those kinds.

An entry uses this shape; `Pinned by` is optional:

```markdown
### Example difference
- **Kind:** Architecture
- **What you notice:** What a player sees.
- **1.6:** What the original did.
- **SSO:** What SSO does instead.
- **Why:** The reason for the difference.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `example test name` (packages/server/tests/example.test.ts)
```

| Code folder | Entries |
|---|---:|
| [admin](#admin) | 29 |
| [casino](#casino) | 6 |
| [chat](#chat) | 7 |
| [combat](#combat) | 10 |
| [core](#core) | 34 |
| [crafting](#crafting) | 8 |
| [economy](#economy) | 18 |
| [housing](#housing) | 7 |
| [inventory](#inventory) | 13 |
| [mail](#mail) | 11 |
| [monsters](#monsters) | 4 |
| [movement](#movement) | 4 |
| [progression](#progression) | 4 |
| [social](#social) | 16 |
| [spells](#spells) | 10 |
| [vehicles](#vehicles) | 2 |
| [world](#world) | 8 |
| **Total** | **191** |

## admin

### Only the server can warp, jail, push or kick
- **Kind:** Exploit closed
- **What you notice:** Warps, jail, pushes and kicks come from validated game actions or administrator commands.
- **1.6:** Any client could send messages that warped, pushed, jailed or disconnected another player; jail release was a self-warp.
- **SSO:** Only the server applies these effects after validating the action or command.
- **Why:** Peers could otherwise teleport, jail or disconnect other players.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminWarp`, `handleAdmin`), `packages/server/src/systems/movement/push.ts` (`pushOnMe`)

### Server-side roles, admin commands and editors
- **Kind:** Exploit closed
- **What you notice:** Administrative commands and editing are available according to your account's role; operators can inspect an audit trail.
- **1.6:** Administrative gates lived in the client, while the server accepted map, item, tile and ban-list writes without checking authority.
- **SSO:** Account roles and server-parsed commands control access. Editor writes are validated and versioned. Admin commands, world and NPC editor saves, setting changes and role changes are recorded in `audit_log` with actor, command, target, before and after; newspaper saves are not recorded; `bun run admin:audit [n]` reads it.
- **Why:** Without server checks anyone could rewrite the world and ban lists.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/systems/admin/worldedit.ts` (`applySave`)

### Login and account-creation limits
- **Kind:** Exploit closed
- **What you notice:** Too many login failures, new characters or simultaneous connections from an address cause a temporary refusal.
- **1.6:** The game scripts did not limit password attempts or character creation. The Multiuser Server had a configurable total connection limit subject to its license; the archived configuration left that setting commented out.
- **SSO:** Failed logins are counted per address (IPv6 per /64) and account-and-address for five minutes, creations per address for an hour, and open connections per address. The settings `loginFailsPerIp` (20), `loginFailsPerAccount` (5), `createsPerIp` (3) and `socketsPerIp` (10) set the limits; zero disables one. The respective messages are “Too many failed logins. Please wait a few minutes and try again.”, “Too many new characters from this address. Please try again later.” and “Too many connections from this address.” The last also closes the socket with code 4006. Moderators and immortals bypass the per-address login refusal and stop counting toward open sockets after login. Only two password hashes run at once. Counters are in memory and reset on restart; an attempt counts before hashing, so simultaneous sockets cannot evade a limit. The original missing-name and wrong-password replies remain distinct.
- **Why:** Limits hinder password guessing, mass account creation and exhausting memory with password hashes.
- **In the code:** `packages/server/src/systems/admin/login-limits.ts` (`allowLoginFromIp`, `allowLoginToAccount`, `allowCreate`)

### Admin channel membership enforced
- **Kind:** Exploit closed
- **What you notice:** Immortals and moderators can read and post admin chat (`-text`) in a dedicated colour; ordinary players cannot.
- **1.6:** Any client could request membership in the administrators' group, and only immortals could post.
- **SSO:** The server chooses who receives and can post to admin chat (both staff roles), and delivers it in `CHAT_COLOR.admin`.
- **Why:** Other players could otherwise listen to staff conversations.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminChat`)

### World editor exits and texts are checked
- **Kind:** Exploit closed
- **What you notice:** The world editor refuses invalid exits, long signs and headers, and unavailable tiles or monsters.
- **1.6:** Exit fields, signs and headers were free text written into the map file. An exit could name any map or tile, including one off screen.
- **SSO:** An exit is empty or has whole-number map coordinates and a tile on the map (1–17, 1–12). House-map coordinates may instead use matching `H1` or `H2` prefixes. Signs have at most 1,000 characters and headers 200. Tiles must be on the palette and monsters on the editor's lists.
- **Why:** The server validates editor writes before they change the world.
- **In the code:** `packages/server/src/systems/admin/worldedit.ts` (`saveError`, `applySave`)

### NPC editor checks its files
- **Kind:** Exploit closed
- **What you notice:** An immortal selects a listed NPC in the editor; invalid files are refused with a reason, and a successful save warns about lines that have no effect in play.
- **1.6:** Anyone could load a file by an unchecked NPC name. Save was gated by the client and an immortals-name lookup, and wrote arbitrary field content under the supplied name. Saving or loading before selecting a name used a leftover or empty name. A backtick truncated text and `*` or `^` broke the NPC bundle; item names, numbers and tags were unchecked.
- **SSO:** Load and save require an immortal in the editor and a name on its monster or NPC list; selecting no name sends nothing. The server checks each line and refuses backticks, `*`, `^`, tags other than the twelve upper-case tags used by the archive, second `|` separators, malformed or out-of-range numbers on `SEL|`, `BUY|`, `INV|`, `GLD|` and `TRN|` lines, unknown items, a second `GLD|`, more than 100 lines or lines over 255 characters. `INV|` chances start at 1; other numeric fields start at 0, and the inventory line accepts gold, crystals and fixtures as well as catalogue items and archived spellings. After “NPC has been successfully saved.”, warnings identify lines beyond the windows that read them (`SEL|` and `INV|` after 80, `GLD|` after 60 or 80, `RND|` after 20), non-crystal `SEL|` lines from line 17, inert `FLG|` and `SPL|` values, and `TRN|` classes without a promotion branch. Each save versions the previous file.
- **Why:** Server validation prevents arbitrary file access and invalid data; warnings make silent original rules visible to operators.
- **In the code:** `packages/server/src/systems/admin/npcedit.ts` (`loadNpc`, `saveNpc`), `packages/shared/src/rules/admin/npcfile.ts` (`checkNpcFile`)

### Only server systems create items
- **Kind:** Exploit closed
- **What you notice:** Items come from game systems such as loot, crafting, shops, quests or operator actions.
- **1.6:** Multiple messages let clients ask the server to create items. An immortal's `/drop` accepted any Inventory cast member, including screen art, scripts, fields, saved copies, facing frames and junk, while refusing singular crystal names and some real items without Inventory members.
- **SSO:** Loot, gathering, crafting, shops, quests and admin create items using their own rules. An immortal's `/drop` and World Editor placements accept `N gold` or an Inventory cast member that is a catalogue item with an icon or a fixture such as a vault, chest, sign or door. They refuse non-item cast members; like 1.6 they refuse singular crystal names and items without Inventory members such as Gold Armor and Rune Sword.
- **Why:** An arbitrary client request could mint items, and non-item cast members would produce objects the game cannot use.
- **In the code:** `packages/server/src/systems/admin/drop.ts` (`droppableName`, `handleDrop`), `packages/server/src/systems/crafting/craft.ts` (`craftStep`)

### Peer sigils replaced by server events; peer kicks, warps and gold removed
- **Kind:** Exploit closed
- **What you notice:** Kicks, warps and transfers come from server-validated events.
- **1.6:** Several peer messages acted on any sender's word and could kick, warp or enrich another player.
- **SSO:** Typed server events replace those messages; the dangerous peer sigils are gone.
- **Why:** Any player could otherwise kick, warp or give gold to anyone.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminWarp`), `packages/server/src/systems/inventory/items.ts` (`goldIntent`)

### No IP addresses exposed
- **Kind:** Exploit closed
- **What you notice:** IP lookups are available only to authorized staff.
- **1.6:** The server address lookup was open to everyone and `/IPlookup` was gated only by the client.
- **SSO:** Addresses stay server-side and lookup is restricted to staff.
- **Why:** Players' network addresses are private.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)

### NPC edits apply at once
- **Kind:** Architecture
- **What you notice:** Saving an NPC file applies its changes immediately and closes any open Bio or shop list for that NPC.
- **1.6:** The server reread NPC files on each buy, sale, gift and kill, but clients kept the map's copy for Bio, shop buttons, chatter and flags until the next map load. An open shop list remained unchanged; a buy used the name and the client-supplied price.
- **SSO:** The server holds NPC files, so a save changes all uses immediately. Open Bio windows and shop lists for that NPC close because their lines may no longer exist. A player shop's `set` and `remove` close them too when they move lines.
- **Why:** Per-client NPC copies were a peer-to-peer artefact; a stale list could otherwise buy by a line number the file no longer contains.
- **In the code:** `packages/server/src/systems/admin/npcedit.ts` (`saveNpc`, `closeNpcWindows`), `packages/server/src/systems/economy/playershop.ts` (`shopCommand`)
- **Pinned by:** `divergence: set closes the shopkeeper's open lists and Bio windows` (packages/server/tests/playershop-db.test.ts)

### Inert admin tools
- **Kind:** Architecture
- **What you notice:** The inaccessible original monster-drop editor, minimap and other inert tools are absent; monster drops can still be edited as NPC `INV|` lines.
- **1.6:** SaveMonDrops, RPG, LoadMiniMap and ClearChest had no server handler. The big world map and AdminWarp movie were unreachable; the monster-drop editor's destination label did not exist, the minimap lacked its members and renderer, and the World Editor's weather list was off stage.
- **SSO:** These inert tools are not implemented and rain is not offered. The NPC editor supplies monster-drop editing through `INV|` lines.
- **Why:** Original features that never worked remain omitted.
- **In the code:** `packages/server/src/systems/admin/npcedit.ts` (`saveNpc`)

### Admin set-class tool
- **Kind:** Architecture
- **What you notice:** An immortal can use `/setclass <name> <class name or 1-26>` on an online or offline character, and receives a confirmation such as “Bob is now a Ninja.”
- **1.6:** Six classes had no promotion entry: Swordsman, Brawler, Ninja, Warlock, Death Knight and Gladiator. Administrators changed class by editing the raw character file.
- **SSO:** The command accepts any of the 26 classes without regard to case and changes only the class code, not skills. Promotion rules are unchanged.
- **Why:** The raw file editor is removed, so operators need a replacement for the only original route to those classes.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)

### Admin commands say when a name is not online
- **Kind:** Architecture
- **What you notice:** An administrator receives a useful refusal when a command cannot act, after the original command echo.
- **1.6:** The client printed its echo and sent the request whether or not the target was online; malformed warp lines were sent unchanged and the administrator heard nothing further.
- **SSO:** The original echo is followed as applicable by “Bob is not online.”, “There is no character called Bob.”, warp usage for a non-tile coordinate, “You cannot ban yourself.”, “Only an immortal can kick an immortal.” or “Only an immortal can do that to an immortal.” A moderator cannot kick an immortal, nor use IP lookup, jail, warp, warptome or ban on one; warpmeto still moves the moderator.
- **Why:** The server can report failed actions, and an immortal's address and editor session should not be controlled by a moderator.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)

### Role and unban chat commands
- **Kind:** Architecture
- **What you notice:** An immortal can change another account's role with `/role <name> player|moderator|immortal`, and immortals or moderators can unban with `/unban <name>`.
- **1.6:** Roles were lines in an immortals file edited with the File Editor; unbanning meant removing a prefix from the character file.
- **SSO:** A role change takes effect immediately in the admin menu, chat and role table; changing one's own role is refused. For anyone else `/role` is local chat, as in 1.6. `bun run admin:role` remains available to create the first immortal.
- **Why:** Roles now live on accounts and the File Editor is gone.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)

### Banned players are told at once
- **Kind:** Architecture
- **What you notice:** A player banned while online is disconnected with “YOU ARE BANNED FROM PLAYING HERE ON THIS ACCOUNT!!”, and sees the same alert on later login attempts.
- **1.6:** Ban kicked the player to the title without text; the next login showed that alert. The server checked the password before the client's ban response.
- **SSO:** The account is flagged, an online player is disconnected with the alert, and later logins are refused with it after the password check.
- **Why:** The server kick is reliable and the alert explains it.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/game.ts` (`login`)

### World editor saves keep loot and player drops
- **Kind:** Limit lifted
- **What you notice:** Saving a map in the World Editor leaves loot and player drops that appeared while it was open.
- **1.6:** Save rewrote the entire 20-slot item file from the editor's loaded sprites, wiping loot and drops that arrived after loading.
- **SSO:** The editor shows and saves only placed items, including operator placements and `/drop`, at most 20; loot and player drops are untouched.
- **Why:** The 20-item ground limit is lifted and saving a map should not destroy players' items.
- **In the code:** `packages/server/src/systems/admin/worldedit.ts` (`applySave`)

### Seeded jail and enforced confinement
- **Kind:** World content and server authority
- **What you notice:** `/jail` works on a fresh server. The stone jail at x0y0 has barred cells, an enclosed perimeter, no exits, and no landing pads. Prisoners arrive at tile 4,4 and remain until their sentence ends or an administrator warps them out.
- **1.6:** Used the archived Jail map. Portal and death respawn could bypass the sentence.
- **SSO:** A migration adds a validated jail landscape if x0y0 is absent, preserving operator-authored jails. Portal, map exits and edge crossings cannot leave x0y0. Death revives prisoners at 4,4 without restarting their sentence. The jail does not overwrite a character's ordinary respawn point. Administrator warps and timed release remain available. A deleted jail still produces the missing-map refusal.
- **Why:** A fresh server needs a working jail, and confinement must not depend on a prisoner's spells or inventory.
- **In the code:** `packages/data/content/jail-map.json`, `packages/server/src/persistence/seed-map.ts` (`jailMapSql`), `packages/server/src/systems/world/tick.ts` (`portal`, `takeExit`, `crossMapEdge`, `respawn`), `packages/server/src/systems/world/world.ts` (`enterRoom`)
- **Pinned by:** `the seeded jail encloses every walkable area and has no exits or landing pads`; `jail blocks Portal and exits while keeping the sentence and normal respawn point`; `death revives a prisoner in jail without restarting the sentence; expiry still releases`; `every jail edge refuses a map crossing, even for an arriving airship rider` (packages/server/tests/jail.test.ts); `the seeded jail confines Bob until his sentence ends` (packages/server/e2e/admin-and-settings.test.ts)

### Roster chat commands for operators
- **Kind:** World content
- **What you notice:** An immortal can inspect or change the four monster roster slots with `/roster`; the World Editor can also set them.
- **1.6:** A GM placed up to four monsters with the World Editor; there was no roster chat command.
- **SSO:** `/roster` lists the roster, `/roster <1-4> <species>` sets a slot and `/roster <1-4> clear` clears it. For other players these lines are local chat. The command remains useful for species the editor's lists do not offer; a slot set through it has no editor tile and appears on row 1 under its slot number. The first immortal comes from `bun run admin:role`.
- **Why:** Operators needed a way to place monsters before the editor existed.
- **In the code:** `packages/server/src/systems/admin/roster.ts` (`handleRoster`)

### Spawn chat command for operators
- **Kind:** World content
- **What you notice:** An immortal can spawn a roster slot's species immediately on the faced tile with `/spawn <1-4>`.
- **1.6:** There was no spawn command. NPCs in a roster spawned at one thirtieth of a monster's rate, taking about ten minutes on average for a player alone on the map.
- **SSO:** The command reports “Spawned a <name> in roster slot <n>.” For anyone other than an immortal it is local chat.
- **Why:** Operators needed a way to place shopkeepers and bankers before the NPC editor existed.
- **In the code:** `packages/server/src/systems/admin/spawn.ts` (`handleSpawn`)

### Staff /drop takes a count
- **Kind:** World content
- **What you notice:** An immortal or moderator can use `/drop <n> <item>` to place a stack of up to 9,999 items at once.
- **1.6:** `/drop` put one name on the ground. Gold and crystal piles carried a count; another pile gave one item. A bare dropped crystal name parsed into a useless quantity and item name.
- **SSO:** The command puts one pile on the faced tile, with crystals in their “<n> <Colour> Crystals” form and other stacking Inventory items carrying a quantity. Crates, cabinets, Wind Cabinets and Cauldrons take no count: a counted pile would grant several under one ID, and a bare one gets an ID when it enters a bag. A shop purchase of several still puts the whole count on one line under one ID (bug ledger). A bare crystal name is a pile of one; the World Editor shows and saves the count.
- **Why:** Operators can stock the world without dropping items one at a time, and bare crystal piles work.
- **In the code:** `packages/server/src/systems/admin/drop.ts` (`parseDrop`, `handleDrop`)

### /warpscript matches whole keywords in broadcast content only
- **Kind:** Bug fixed
- **What you notice:** `/warpscript` triggers only on whole-word/token matches inside the broadcast message itself, and at most one matching staff member warps the speaker.
- **1.6:** Tested substring inclusion against `<name> broadcasts "<text>"`, so speaker names, `"broadcasts"`, and partial words matched, and every matching immortal warped in login order.
- **SSO:** `warpscriptMatches` performs case-insensitive whole-token matching on the broadcast message content only, and `warpscriptOnBroadcast` stops after the first matching online non-editing staff member in login order.
- **Why:** Prevents accidental warps from names, protocol text, or substrings, and avoids multiple warps on one broadcast.
- **In the code:** `packages/shared/src/rules/admin/admin.ts` (`warpscriptMatches`), `packages/server/src/systems/admin/commands.ts` (`warpscriptOnBroadcast`), `packages/server/src/systems/chat/chat.ts` (`handleChat`)
- **Pinned by:** `matches whole keyword tokens ignoring case in the broadcast message content`, `prevents accidental substring triggers` (packages/shared/tests/admin/admin.test.ts); `speaker name, protocol wrapper, and substrings do not trigger /warpscript`, `multiple matching staff: deterministic single winner (first in login order)` (packages/server/tests/admin.test.ts)

### Moderators share the original admin commands and admin chat
- **Kind:** Bug fixed
- **What you notice:** Moderators can use `/ban`, `/unban`, `/BanIP`, `/unbanip`, `/pardon`, `/drop`, `/CheatFile`, `/Inventory`, `/save`, `/Refresh`, `/warpscript`, and `-text` admin chat, in addition to kick, warp, jail, IP lookup, and location. `/role`, `/setclass`, `/roster`, `/spawn`, and editors remain immortal-only, and moderators still cannot act on immortals.
- **1.6:** Only a subset of admin commands worked for moderators, and `-text` was immortal-only.
- **SSO:** `ADMIN_ROLES`, `handleDrop`, `readsAdminChat`, and `warpscriptOnBroadcast` grant moderators the full original command set and admin chat while keeping server authority and player denials.
- **Why:** Completes the moderator moderation toolkit without expanding editor or role-management access.
- **In the code:** `packages/shared/src/rules/admin/admin.ts` (`ADMIN_ROLES`, `mayRun`, `readsAdminChat`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`, `adminChat`), `packages/server/src/systems/admin/drop.ts` (`handleDrop`)
- **Pinned by:** `moderators can use all 1.6 admin commands and /unban; /role and /setclass stay immortal-only` (packages/shared/tests/admin/admin.test.ts); `a moderator may run all 1.6 admin commands and /unban, but not /role or /setclass` (packages/server/tests/admin.test.ts)

### World editor Fat brush reaches the full 17 × 12 map
- **Kind:** Bug fixed
- **What you notice:** The World Editor's Fat brush paints all four arms of its plus shape up to the full 17 × 12 map edges.
- **1.6:** Right and lower arms were bounded by an older 12 × 9 map size.
- **SSO:** `paint` bounds all four arms by `MAP_WIDTH` and `MAP_HEIGHT`.
- **Why:** Fixes incomplete painting near the right and bottom edges of the map.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`paint`)
- **Pinned by:** `the Fat brush bounds all four arms by the full 17 × 12 map dimensions` (packages/shared/tests/admin/worldedit.test.ts)

### World editor faction checkboxes are mutually exclusive
- **Kind:** Bug fixed
- **What you notice:** Ticking W, M, or A in the World Editor clears the other two boxes.
- **1.6:** Ticking A cleared M twice and left W ticked.
- **SSO:** `clickFaction` clears the other two boxes on every faction toggle.
- **Why:** Prevents ambiguous multi-faction checkbox states.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`clickFaction`)
- **Pinned by:** `W, M and A are mutually exclusive` (packages/shared/tests/admin/worldedit.test.ts); `faction checkboxes W, M and A are mutually exclusive in the editor UI` (packages/client/tests/worldeditor.test.ts)

### World editor lit S layer button stays on layer S
- **Kind:** Bug fixed
- **What you notice:** Clicking the already-lit S layer button in the World Editor keeps layer S selected and only S lit.
- **1.6:** Clicking lit S switched to layer 3 and lit 3 without unlighting S.
- **SSO:** `clickLayer` is a no-op when any already-lit layer button is clicked.
- **Why:** Makes all four layer buttons behave consistently.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`clickLayer`)
- **Pinned by:** `layer buttons select their layer; clicking any lit layer button (including S) is stable` (packages/shared/tests/admin/worldedit.test.ts); `clicking lit layer S stays on layer S and keeps only S lit` (packages/client/tests/worldeditor.test.ts)

### World editor resets exit fields when loading a map without exits
- **Kind:** Bug fixed
- **What you notice:** Loading a map that has no exit clears the World Editor's exit fields instead of keeping the previous map's exits.
- **1.6:** Absent exits left the previous map's exit fields populated, so saving wrote stale exits into the new map.
- **SSO:** `exitFieldsAfterLoad` resets to `EMPTY_EXIT_FIELDS` when an exit is `null`.
- **Why:** Prevents accidentally copying exits from an earlier map onto a new map on save.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`exitFieldsAfterLoad`)
- **Pinned by:** `loading a map without an exit resets the exit fields so saving does not recreate a stale exit` (packages/shared/tests/admin/worldedit.test.ts); `loading a map with no exit resets the exit fields so saving does not recreate a stale exit` (packages/client/tests/worldeditor.test.ts)

### NPC editor LOAD displays complete script text losslessly
- **Kind:** Bug fixed
- **What you notice:** Loading an NPC in the NPC Editor displays every line losslessly, including `OWN|`, empty lines, lines past 100, and all first characters; save validation and limits still apply on save.
- **1.6:** LOAD dropped empty lines, truncated at 100 lines, and stripped any leading character other than `T P B S R G F I` (turning `OWN|` into `WN|`).
- **SSO:** `showNpcScript` returns all lines losslessly without truncation or character stripping.
- **Why:** Prevents silent data loss when inspecting and re-saving NPC scripts.
- **In the code:** `packages/shared/src/rules/admin/npcfile.ts` (`showNpcScript`)
- **Pinned by:** `lossless display: preserves OWN|, all first characters, empty lines, and >100 lines` (packages/shared/tests/admin/npcfile.test.ts); `LOAD's reply displays lossless complete text including OWN|, empty lines, and >100 lines` (packages/client/tests/npceditor.test.ts)

### Unauthorized admin chat and /warpscript show a refusal and clear input
- **Kind:** Bug fixed
- **What you notice:** When a player types `-text` or `/warpscript`, they see an explicit refusal in chat and the chat input clears.
- **1.6:** Both commands exited without sending and left the typed text stuck in the input box.
- **SSO:** `adminChat` and `handleAdmin` reply with `ADMIN_TEXT.adminChatDenied` or `ADMIN_TEXT.warpscriptDenied` and do not send `restore`.
- **Why:** Gives clear feedback and avoids leaving failed commands stuck in the input field.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminChat`, `handleAdmin`)
- **Pinned by:** `a player's - line gets an explicit denial and clears input (no restore)` and `a player gets an explicit denial and cleared input (no restore); moderators can set it` (packages/server/tests/admin.test.ts)

### Admin chat uses a dedicated channel without muffling or ignore filtering
- **Kind:** Bug fixed
- **What you notice:** Admin chat (`-text`) renders in a distinct green colour (`CHAT_COLOR.admin`), reaches only staff (immortals and moderators), works from anywhere inside houses, and is never muffled or dropped by ignore lists.
- **1.6:** Admin chat used an ordinary local-chat `sqa` message, so it appeared white, failed below row 7 in houses, muffled below row 10, and was dropped by ignore lists.
- **SSO:** `adminChat` sends directly to all online staff in `CHAT_COLOR.admin` without house restrictions, `heardSqa`, or `hears`.
- **Why:** Staff communication should be visually distinct and reliable regardless of position or ignore lists.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminChat`), `packages/shared/src/rules/chat/chat.ts` (`CHAT_COLOR`)
- **Pinned by:** `both immortals and moderators post to staff in CHAT_COLOR.admin; players excluded` and `admin chat has no house sender restriction, no muffling, and no ignore filtering` (packages/server/tests/admin.test.ts)

## casino

### Blackjack dealt, escrowed and settled by the server
- **Kind:** Exploit closed
- **What you notice:** Blackjack bids are held when locked, and leaving during a hand forfeits the stake to the opponent.
- **1.6:** Clients dealt their own cards, and a settlement message could name any winner and loser; no gold was held in escrow.
- **SSO:** The server deals using the same distribution and applies the original outcome rules. Each bid is held from the purse at lock and excess is returned when the stake is set; saved gold includes the hold until settlement. Leaving mid-hand or disconnecting past the configurable grace, 30 seconds by default, forfeits the stake to the opponent, who sees “<user> has left the table!”. Returning within the grace restores the table.
- **Why:** A forged settlement could drain another player's gold or choose cards.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjBid`, `bjLeave`, `bjReturn`, `bjTick`)
- **Pinned by:** `divergence: gold drops at the lock, the excess returns when both lock, four cards P1 P1 P2 P2`, `divergence: mid-hand Leave forfeits the stake to the opponent` and `divergence: past the grace the stake is forfeit: the opponent gains, the dropped player's saved row loses the hold` (packages/server/tests/blackjack.test.ts); `a flush mid-hand writes gold + the held stake; a forfeit past the grace moves the stake in SQL` (packages/server/tests/casino-db.test.ts)

### Checkers moves checked by the server
- **Kind:** Exploit closed
- **What you notice:** Only the seated player whose turn it is can make a legal step or jump.
- **1.6:** Any client in the group could send a move for either side's pieces.
- **SSO:** The server holds the board and turn and accepts only a legal move by the seated side on its turn; the other rules are those of 1.6.
- **Why:** A forged message could move the other player's pieces or impersonate a seat.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `only on your turn, only the legal move; the new turn goes to both views` (packages/server/tests/checkers.test.ts)

### Slot pulls paced by the 30-frame spin
- **Kind:** Exploit closed
- **What you notice:** A slot pull settles after the 30-frame spin and another cannot start while it is spinning.
- **1.6:** A client could send unlimited payout requests without starting the slot machine.
- **SSO:** The server accepts a pull only while the panel is open and idle and settles it 30 ticks later.
- **Why:** Trusting client timing allowed requests to be spammed and load the server.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`, `slotTick`)

### High-score points computed by the server
- **Kind:** Exploit closed
- **What you notice:** The leaderboard score reflects your character's skills and is submitted on each periodic save.
- **1.6:** Clients could submit any integer as a high score; ordinary clients submitted only one time in three.
- **SSO:** The server computes the original formula from authoritative skills and submits each periodic save.
- **Why:** A modified client could otherwise submit fake leaderboard scores.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`submitHighScore`)

### A taken casino seat is refused
- **Kind:** Bug fixed
- **What you notice:** Trying to occupy an already taken Blackjack or Checkers side says “That seat is taken.”
- **1.6:** Two players could take one side and a third could join, leaving screens with different pairings.
- **SSO:** Each side holds one player and a second player is refused.
- **Why:** A single server-held seat cannot have the conflicting peer-to-peer occupants.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjSit`), `packages/server/src/systems/casino/checkers.ts` (`ckSit`)
- **Pinned by:** `divergence: a taken seat, a third player, a longer name, and an open casino screen all refuse` (packages/server/tests/blackjack.test.ts)

### A slot pull whose gold is gone by the result
- **Kind:** Bug fixed
- **What you notice:** If you have less than five gold when a slot spin ends, it stops and says “You don't have enough gold to play!” without charging you.
- **1.6:** Gold was checked on the pull but charged 1.5 seconds later. If it was lost in between, the server sent nothing and the panel remained stuck until the client restarted.
- **SSO:** The result settles once at the end. Insufficient gold costs nothing, returns the lever and stops the reels while leaving the panel open.
- **Why:** The stuck panel was a peer-to-peer timing artefact; each pull still changes gold once.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotTick`)

## chat

### Server-formatted chat and server-managed channels
- **Kind:** Exploit closed
- **What you notice:** Chat names and channel membership come from the server; an ignored player's messages are filtered for the reader.
- **1.6:** Clients built their own “X says …” text and could join administrator, guild and faction groups by hand.
- **SSO:** The server stamps the speaker and controls faction, guild and room membership. Each reader's ignore list filters what the ignored player's client sent in 1.6: say, `/me`, admin lines, broadcasts, IMs, the Overlord line, Radar and Inxition read-outs, and faction announcements. It also filters NPC replies relayed by that player, including quest slots 2–4, treasure rumours, faction-leader replies and their shop's stock list.
- **Why:** Client-supplied names and group joins allowed impersonation and eavesdropping.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/chat/rooms.ts` (`enterRoom`), `packages/server/src/systems/chat/ignore.ts` (`hears`)

### Chat rate limits
- **Kind:** Exploit closed
- **What you notice:** Repeated chat, IM, room, mail and board actions may be refused temporarily, with remaining time shown and the original input retained where applicable.
- **1.6:** Broadcasting had no cooldown because registration was forced on, and there was no flood control. A refused broadcast remained typed.
- **SSO:** Everyone uses the original unregistered broadcast cooldown of 1,000 frames (50 seconds) and its refusal. Local chat, `/me`, guild chat, IM, room lines, mail sends and board posts share a new 60-frame (3-second) cooldown. A refusal says “You cannot chat yet - N seconds remaining.” with seconds rounded up. Refused chat, IM and room text returns to its input; refused mail and board text stays open. A player-shop command still runs under the local cooldown and is not put back, so Enter cannot run it twice. Away replies do not use the cooldown. Lines are capped at 200 characters, there is no profanity filter, and all limits are operator settings.
- **Why:** Spam harms players and the server.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/chat/im.ts` (`imIntent`)
- **Pinned by:** `divergence: under the chat cooldown the command runs and the line is not put back` (packages/server/tests/playershop-db.test.ts); `divergence: it shares the chat cooldown` (packages/server/tests/guilds.test.ts); `divergence: it shares the chat cooldown; a refused line goes back` and `divergence: room lines share the chat cooldown, refused back into the room's input` (packages/server/tests/im.test.ts)

### Rooms check membership on the server
- **Kind:** Exploit closed
- **What you notice:** Guild Chat belongs to your current guild and Admin Chat to immortals; losing that membership silently removes you from the room while leaving its window open.
- **1.6:** Anyone could join the underlying groups by hand. Guild Chat used the client's guild field, and the Admin Chat client disconnected non-immortals. A player otherwise stayed until closing the window.
- **SSO:** The server holds membership. A non-immortal's Admin Chat join is ignored and logged without a disconnect; exile, disbanding or demotion removes room membership immediately, and a line typed from outside a room goes nowhere.
- **Why:** Client-controlled room membership allowed eavesdropping on guild and admin conversations.
- **In the code:** `packages/server/src/systems/chat/rooms.ts` (`enterRoom`, `roomMembership`, `roomSay`)
- **Pinned by:** `divergence: Guild Chat is your guild's room; losing the guild drops you silently` and `divergence: a demoted immortal leaves Admin Chat` (packages/server/tests/im.test.ts)

### Ignore list capped at 100
- **Kind:** Exploit closed
- **What you notice:** A 101st ignore is refused with “Your ignore list is full.”
- **1.6:** The list had no limit, but only lines 1–50 filtered ordinary messages, lines 1–40 filtered IMs, and `/unignore` reached lines 1–100.
- **SSO:** The account's ignore list holds at most 100 entries.
- **Why:** Entries past line 100 could neither work nor be removed, and the list is stored per account.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`ignoreAdd`)
- **Pinned by:** `the list holds 100; the 101st is refused` (packages/shared/tests/chat/im.test.ts)

### Password change via account flow
- **Kind:** Architecture
- **What you notice:** `Password=<new>` changes your account password without displaying it. Empty passwords or those longer than 64 characters are refused.
- **1.6:** The command edited a local field, echoed the new password in chat and uploaded it with the character sheet.
- **SSO:** The already logged-in session changes the account password without asking for the old password. Success says “Password has been changed.”; an empty or too-long password says “Your password was not changed.”
- **Why:** Passwords no longer live in character data, and echoing one would leak it into chat logs.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`)

### Away auto-reply loop broken
- **Kind:** Bug fixed
- **What you notice:** When two away players message each other, each logs the other's away reply once and the replies stop.
- **1.6:** Two away players automatically replied to each other indefinitely.
- **SSO:** An IM to an away player is logged and answered unless it is itself an auto-reply or comes from that same player.
- **Why:** An unbounded message storm harms the server.
- **In the code:** `packages/server/src/systems/chat/im.ts` (`deliverIm`)
- **Pinned by:** `divergence: two away players do not loop; each logs the other's reply once` (packages/server/tests/im.test.ts)

### IM to someone offline says so
- **Kind:** Bug fixed
- **What you notice:** Sending an IM to an offline name says “<name> is not online.” in the main chat.
- **1.6:** The message was silently lost; `/msg` still printed its outgoing echo.
- **SSO:** The offline line follows the `/msg` echo, a Send from IMsend (which still closes) or a reply from an IM window.
- **Why:** A silently lost message looks like being ignored.
- **In the code:** `packages/server/src/systems/chat/im.ts` (`msgCommand`, `imIntent`)
- **Pinned by:** `divergence: to someone not online, the echo then '<name> is not online.'` and `divergence: not online is said for IMsend and replies too` (packages/server/tests/im.test.ts)

## combat

### Server computes melee damage
- **Kind:** Exploit closed
- **What you notice:** The server decides how much damage your melee attack deals and who gets credit for a kill.
- **1.6:** The attacker sent calculated attack power and damage for each client to apply and credit.
- **SSO:** The client sends whether attack is held; the server rolls attack power and damage and credits the kill.
- **Why:** A modified client could otherwise deal arbitrary damage or give someone else credit.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`, `workAttack`)

### Server owns positions in hit tests
- **Kind:** Exploit closed
- **What you notice:** Attacks hit according to the server's record of where the attacker and target are.
- **1.6:** Receivers trusted the attacker's reported position, facing and weapon.
- **SSO:** Hit tests use server positions, facing and equipment.
- **Why:** A forged position or weapon could let someone attack from anywhere or impersonate an elemental weapon.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`, `pvpSwing`)

### Server-side cooldowns and power bar
- **Kind:** Exploit closed
- **What you notice:** Attack timing and the power bar are governed by the server.
- **1.6:** Attack delay, action delay and the power bar were held on the client.
- **SSO:** The server counts ticks; an attack pressed a few ticks early can be latched for the next permitted attack.
- **Why:** Client-controlled timing allowed speed and power hacks.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`), `packages/shared/src/rules/combat/combat.ts` (`tickAttackTimers`, `startSwing`)

### Server checks crystals before shots and casts
- **Kind:** Exploit closed
- **What you notice:** A shot or cast that needs a crystal consumes one from your bag.
- **1.6:** The client checked its local count and sent a removal afterwards.
- **SSO:** The server checks and removes the crystal with the shot or cast.
- **Why:** A modified client could otherwise shoot or cast without spending crystals.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`), `packages/server/src/systems/spells/cast.ts` (`castIntent`)

### Server rolls equipment breaks
- **Kind:** Exploit closed
- **What you notice:** Equipment can break with the original odds during combat.
- **1.6:** The client rolled for a break and reported the equipment slot.
- **SSO:** The server makes the roll using the original odds.
- **Why:** A modified client could omit break reports.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`smash`), `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`)

### Loot rolled by the server on observed kills
- **Kind:** Exploit closed
- **What you notice:** A monster's loot is rolled once when it dies and appears on its tile.
- **1.6:** A client could repeatedly request a drop naming the loot table, map and coordinates without a kill; each successful drop still needed an empty loot slot.
- **SSO:** The server runs the same algorithm once per kill, using the killed monster's species and tile.
- **Why:** A forged client could repeatedly create loot from any table without killing a monster.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`smash`), `packages/server/src/systems/spells/collide.ts` (`checkForDead`)

### Bow lock clears immediately
- **Kind:** Architecture
- **What you notice:** A bow's next shot is limited by its attack delay rather than an extra network round trip after a crystal is spent.
- **1.6:** A 40-frame item action pause after a shot cleared on the server's inventory reply, one round trip later.
- **SSO:** The crystal is removed in the same tick and attack delay controls the cadence.
- **Why:** The server has no inventory round trip to wait for.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`)

### No per-swing target slot limit
- **Kind:** Limit lifted
- **What you notice:** Every monster in the map instance can be considered by a melee swing.
- **1.6:** Melee tested only monster sprite slots 180–183.
- **SSO:** Every monster in the map instance is a candidate.
- **Why:** The per-screen sprite caps have been lifted.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`)

### Attack input as a hold state with an early-press latch
- **Kind:** Platform
- **What you notice:** A quick attack press just before the attack rearms can still produce a swing.
- **1.6:** Tab was polled every frame, so a tap that ended before rearming was lost.
- **SSO:** The server polls held attack each tick and latches presses up to two ticks, or 100 ms, before rearming.
- **Why:** The latch allows for network jitter.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`setAttackHeld`, `pollAttack`)
- **Pinned by:** `SSO: a tap is latched for ${ATTACK_LATCH_TICKS} ticks: it swings if the attack re-arms by then`; `SSO: a tap older than the latch is lost, as 1.6's keyPressed poll lost it` (packages/server/tests/melee.test.ts)

### Arena exit never hangs
- **Kind:** Bug fixed
- **What you notice:** If an arena map has no suitable exit tile, quitting does nothing; an arena death leaves you in place at 1 HP and SP and shows the defeated line.
- **1.6:** Quitting or arena death repeatedly rolled until it found 799 tiles that were neither arena nor blocked and used the last. With no qualifying tile the client looped forever.
- **SSO:** The server lists qualifying walkable tiles using the original rows-1–9 arena test and picks one with the seeded RNG, preserving the odds. With none, it handles quit and death as described above.
- **Why:** A shared server cannot keep a hang; direct selection also avoids the former capped roll loop returning an invalid tile.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`arenaExits`, `pickArenaExit`), `packages/server/src/systems/combat/arena.ts` (`quitArena`)
- **Pinned by:** `divergence: with no passing tile quit says nothing and stays put`; `divergence: an arena death with no passing tile keeps the player in place, at HP and SP 1, and says the line` (packages/server/tests/arena.test.ts); `divergence: no passing tile → null, where 1.6's exit loop never ended` (packages/shared/tests/combat/arena.test.ts)

## core

### No per-screen cap on players, monsters or ground items
- **Kind:** Limit lifted
- **What you notice:** Everyone on a map is drawn, even when more than 15 other players are present; ground items likewise have no fixed slot cap. Monsters still have the original density.
- **1.6:** A screen had channels for 15 other players, five monsters or NPCs and 20 ground items. A sixteenth other player was invisible until a channel became free and they re-entered or you changed maps. Invisible players could not be clicked or given to and you walked through them; their melee, spell effects and sounds still reached you, but their arrows, swing animation and swing sound did not. The fifteenth drawn player never moved on screen; a name could take two channels and leave a nameless ghost body. Only the first four monster slots spawned, each from its own roster entry; monsters remained until killed.
- **SSO:** No fixed player or ground-item cap replaces the original limits: the map's tiles and server capacity are the practical limits. Every player on a map is drawn. The monster roster has up to four slots, each allowing one live monster with the original spawn odds. See [performance](performance.md) for measurements.
- **Why:** The original limits came from Director sprite channels rather than game design. The explicit monster population rule preserves the density that players saw.
- **In the code:** `packages/client/src/playfield.ts` (`createPlayfield`), `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`)

### Runs in a web browser
- **Kind:** Platform
- **What you notice:** The classic game runs in a browser, with draggable windows and a frame that scales to the browser window. On a phone or tablet the same layout appears and taps act as clicks; walking still needs a keyboard.
- **1.6:** The game ran as an 800×600 Windows Shockwave projector with Director sub-windows.
- **SSO:** The game uses one layout. Instant messages, biographies, Who, trade, the newspaper and other sub-windows become floating draggable windows. The frame scales to fit, including fractional scales when a whole number will not fit; the sharp-pixels setting restricts it to whole numbers. Small windows scale the same frame down. Live browser text uses the original font, size and colour, so glyphs differ slightly from Windows bitmap text.
- **Why:** A browser page cannot be a Windows projector; one classic layout keeps the game faithful to 1.6.
- **In the code:** `packages/client/src/app.ts` (`relayout`), `packages/client/src/ui/window.ts` (`createWindowLayer`)

### File editor and path-based file access removed
- **Kind:** Exploit closed
- **What you notice:** Operators use a Settings window instead of a file editor. It groups settings with explanations, marks and counts changes, offers defaults, and shows durations for frame, millisecond and minute values.
- **1.6:** File transfer could read or write paths under the data directory, including parent paths. Map, NPC and character-loading messages could read arbitrary files; character viewing could return passwords. No 1.6 client sent the character-viewing message, although the admin guide described `/view name`.
- **SSO:** Data is addressed by ID rather than arbitrary paths, and character viewing is omitted. The Settings window is a plain SSO panel in the former File Editor menu position; the original had no settings screen. Save validates values in the window and again on the server, refuses the whole save with the error on the setting, and applies successful changes to everyone online immediately, as `/Refresh` does. Revert reloads server values.
- **Why:** Arbitrary server file reads and writes let a client expose or alter data. Explanations remain visible rather than relying on hover.
- **In the code:** `packages/client/src/ui/settings.ts` (`createSettingsWindow`), `packages/server/src/settings.ts` (`applySettingValues`)

### IP bans and lookups use the socket
- **Kind:** Exploit closed
- **What you notice:** A banned address is refused at login, while IP lookup is available to moderators and immortals.
- **1.6:** IP sorting trusted the client-reported address and used substring matching; anyone could call the server's IP lookup. The IP ban did nothing because its response had no client handler and its marker files were never read.
- **SSO:** `/BanIP` and `/unbanIP` work. A banned address is refused before the password check with the original unshown “You are banned from playing on this server.”; existing sessions are not kicked. The address comes from the socket, or from the nth rightmost `X-Forwarded-For` entry when the operator configures `SSO_PROXY_HOPS=n` for n trusted proxies. The nearest proxy appends the rightmost entry; a client can forge entries farther left. The former `trustForwardedFor` setting is removed. `/IPlookup` is restricted to moderators and immortals.
- **Why:** Trusting a client address allowed ban evasion and exposed IP addresses; an ineffective ban provided no protection.
- **In the code:** `packages/server/src/gateway/server.ts` (`clientIp`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)

### Character state server-owned; no character upload
- **Kind:** Exploit closed
- **What you notice:** Your character's stats, skills, level, class and gold are maintained by the server.
- **1.6:** A client could upload its entire character file for the server to write.
- **SSO:** Character state belongs to the server; the client sends intents.
- **Why:** An uploaded sheet could set arbitrary character values.
- **In the code:** `packages/server/src/game.ts` (`createGame`)

### All amounts are validated positive integers
- **Kind:** Exploit closed
- **What you notice:** Transactions reject invalid item counts and gold amounts.
- **1.6:** Negative values in buying, selling, banking, giving, spell costs, registering, dropping gold and trade could create gold or items.
- **SSO:** Counts and amounts are whole numbers at least 1, with banking allowing zero and gold drops limited to 9,999. The schema and transaction both check them; trade gold can be zero.
- **Why:** Negative amounts could mint gold or items.
- **In the code:** `packages/shared/src/protocol/economy.ts` (`buySchema`, `sellSchema`, `tradeOfferSchema`), `packages/shared/src/protocol/inventory.ts` (`goldSchema`)
- **Pinned by:** `SSO: counts and amounts are integers ≥ 1 at the schema, gold drop ≤ 9999, trade gold ≥ 0` (packages/shared/tests/protocol/protocol.test.ts)

### Dropped connections resume for 30 seconds; a second login replaces the first
- **Kind:** Architecture
- **What you notice:** A brief disconnect can automatically resume your session, while signing in elsewhere disconnects the older connection.
- **1.6:** A dropped connection ended the session with “Disconnected!” and required logging in again at the title screen; there was no resume.
- **SSO:** The character leaves the map immediately and is saved when a connection drops. For the configured `resumeGraceMs`, 30 seconds by default, the client can reconnect with a token and no password as a resumed session rather than a login. A new login to an online account disconnects the older connection with “You logged in from somewhere else.”
- **Why:** Wi-Fi interruptions, network changes and sleeping tabs should not force a full login or leave a forgotten session blocking the account.
- **In the code:** `packages/server/src/game.ts` (`createGame`)

### Server errors log the player out
- **Kind:** Architecture
- **What you notice:** If an action fails unexpectedly, the affected player is logged out with “Something went wrong on the server, so you were logged out. Please log in again.”
- **1.6:** In a test of a malformed network message, the shipped client showed “Script Error. Continue?” and froze until answered. Yes resumed play; No quit the client. Other error types were not tested.
- **SSO:** Intents, ticks, map entry and exit run in SQL transactions. A thrown error rolls back its writes, is logged, writes a cheat-log line “Server error on <message>” and logs out the affected player; their next login reloads the database state. A failed tick is logged and the next tick runs; 20 consecutive tick errors save and exit the server.
- **Why:** The shared server must survive errors without committing a half-completed action.
- **In the code:** `packages/server/src/game.ts` (`createGame`)

### Client anti-cheat replaced by server validation
- **Kind:** Architecture
- **What you notice:** Invalid client actions are refused or logged by the server rather than relying on a client to ban itself.
- **1.6:** The client used ciphers, self-ban, name and equipment shadow checks, echoes and a per-minute speed check. Anyone could write a cheater report.
- **SSO:** Schema validation, per-tick gates, rate limits and a server-written cheat log replace those client self-bans. `/CheatFile` shows the original “<name> - at IP <ip> - <reason>” format. The log records editor or Settings intents from non-immortals, editor load/save outside the editor, malformed frames and flooding. Its reasons include “Attempted Admin Access”, “Attempting to get Admin access”, “Sending bad messages” and “Flooding”. There are no automatic kicks.
- **Why:** The client has no authoritative state to protect.
- **In the code:** `packages/server/src/game.ts` (`editingOk`, `createGame`)

### Monster persistence restored after restart
- **Kind:** Architecture
- **What you notice:** Monsters survive server restarts and remain frozen on maps without players.
- **1.6:** Each map's monster file stored live monsters, which were restored when a player entered.
- **SSO:** Per-map monster slots are stored in the database and restored on startup; AI ticks only when players are present.
- **Why:** This preserves the observable behaviour without client-written files.
- **In the code:** `packages/server/src/persistence/monsters.ts` (`loadSlots`, `saveSlots`)

### House interiors are named maps
- **Kind:** Architecture
- **What you notice:** A house interior uses its original-style map name, and the World Editor can show and accept it.
- **1.6:** The interior was a map file named like `xH1<mx>yH1<my>` or `xH2…`, and the outdoor exit named its map and entry tile.
- **SSO:** A map row at the outdoor map's grid position has house slot 1 or 2 and the same name. An exit may name a house map and the editor shows and accepts the `H1<mx>` form. The map header appears under the playfield, as in 1.6.
- **Why:** Maps are database rows keyed by grid position.
- **In the code:** `packages/server/src/persistence/maps.ts` (`findMapByCoords`), `packages/server/src/systems/admin/worldedit.ts` (`editorView`)

### A connection that falls far behind is reconnected
- **Kind:** Platform
- **What you notice:** If your connection falls far behind, it closes and immediately resumes with a fresh map view; other players see you leave and return.
- **1.6:** In a test with a paused receiver, the server queued outgoing data and dropped later messages once its buffer filled, while the client stayed connected. A separate client-side queue also had a 100-unread-message limit in an authoring test.
- **SSO:** When roughly 1 MB of updates waits for a connection, about a minute of crowded-map traffic, the server closes it with code 4007 and the client resumes as after a dropped connection.
- **Why:** A slow connection would otherwise fall minutes behind and could eventually lose updates, showing players who are no longer there.
- **In the code:** `packages/server/src/gateway/server.ts` (`sendWs`)
- **Pinned by:** `a socket with 2 MB waiting is closed with 4007, resumes, and the others see it leave and return` (packages/server/e2e/fell-behind.test.ts)

### Title and login screens in a browser
- **Kind:** Platform
- **What you notice:** The original title art appears in the browser; Load Character and New Character work, and login and creation messages appear in an in-page box with OK.
- **1.6:** Exit quit the Windows projector, Server Editor opened a server-address entry and Game Setup opened local preferences; frame 10 showed an advert for the original website. Login and creation messages were Windows alerts with an OS beep. Credits were unreachable; the post-creation frames referenced a missing Story member and showed nothing before returning to the title.
- **SSO:** Only Load Character and New Character respond on the title screen; Game Setup art remains inert, while Exit, Server Editor and the advert are not offered. Sound is controlled in the in-game menu. A page connects to the server that served it, so the server picker has no screen. Messages use the original text in an in-page OK box without the alert beep. The unreachable credits, unavailable post-creation movie and unreachable later frames are omitted.
- **Why:** A browser page cannot quit or launch local tools, the advertised site no longer exists, and native browser alerts block the page and vary by browser.
- **In the code:** `packages/client/src/ui/alert.ts` (`showAlert`), `packages/client/src/app.ts` (`runApp`)

### In-game sound effects switch
- **Kind:** Platform
- **What you notice:** Options → Sound Effects switches sound immediately, including on the title screen, and the browser remembers the setting.
- **1.6:** Sound effects were switched in the title screen's Game Setup and stored in local preferences per server; the default was on.
- **SSO:** The menu option defaults to on and is saved per browser.
- **Why:** SSO does not offer the original Game Setup and a browser player needs to mute without logging out.
- **In the code:** `packages/client/src/ui/gamemenu.ts` (`desktopMenus`), `packages/client/src/audio.ts` (`createAudio`)

### In-game menu
- **Kind:** Platform
- **What you notice:** The game has a Windows-style menu above the game, with File, Edit, Game and Options, plus Admin for immortals.
- **1.6:** The projector had a native Windows menu above the stage from program start, with File, Edit, Game and Plugins. Immortals received an Admin menu. Return To Title Screen and Quit were in File; preferences were on the title-screen Game Setup.
- **SSO:** The classic grey bar scales above the 800×600 stage without covering original click targets. Admin sits between Edit and Game; Options adds Sharp Pixels Only and Sound Effects. The MP3 player remains omitted. Admin contains World Editor, NPC Editor, Settings, Edit Newspaper, Admin Chat, Return To Game and three Assassin commands, which are sent without confirmation. Game contains Friends, IM and the four rooms; Edit contains Clear Chat Text. Character-dependent items are greyed before entry, while File and Options work everywhere. Return To Title Screen logs out or shows the title before login. Quit logs out and shows “You can close this tab now.” and “Click to return to the title screen.” Clicking outside an open menu closes it. There is no Alt/F10 access, and the game continues drawing while a menu is open.
- **Why:** Browser scaling and logout need controls, and a page cannot close its own tab.
- **In the code:** `packages/client/src/ui/gamemenu.ts` (`desktopMenus`)

### Sound waits for your first click or key press
- **Kind:** Platform
- **What you notice:** Sound starts on your first click or key press, and that click is audible; a sound requested before then or before its file loads is skipped.
- **1.6:** Sounds could play from projector startup.
- **SSO:** Audio files load with the page. The first gesture starts audio, and later presses resume audio paused by the browser in the background. Earlier sounds are skipped rather than played late.
- **Why:** Browsers require a gesture before audio, and skipping delayed sounds keeps them in step with their causes.
- **In the code:** `packages/client/src/audio.ts` (`createAudio`)

### Security headers and production mode
- **Kind:** Platform
- **What you notice:** A production server sends a minified browser client with security headers.
- **1.6:** The game was a Windows projector rather than a web page.
- **SSO:** `bun run start` sends `X-Content-Type-Options: nosniff` and a narrow Content Security Policy on every response, allowing only its own scripts and no plugins or `<base>`. An operator may add `frame-ancestors` with `SSO_FRAME_ANCESTORS`. `bun run dev` uses live reload and sends no CSP.
- **Why:** Framing and injected content are risks for a public web page.
- **In the code:** `packages/server/src/gateway/server.ts` (`securityHeaders`, `startGateway`)

### Repeated identical chat lines collapse
- **Kind:** Platform
- **What you notice:** Consecutive repetitions of “You cannot fight here!” and “Your feet are stuck in the web, you cannot move!” show once with a ×N counter; other chat lines print each time.
- **1.6:** Per-frame refusal text appended a line every frame, and all other repeated lines were appended too.
- **SSO:** The server still emits each rejected tick. Only those two held-key texts collapse in the chat display; any other line interrupts the run.
- **Why:** Twenty identical lines a second would clear the six-line chat view; the underlying server events are unchanged.
- **In the code:** `packages/client/src/ui/chat.ts` (`createChatLog`), `packages/shared/src/rules/chat/chat.ts` (`REPEATING_LINES`)
- **Pinned by:** `divergence: identical lines in a row collapse with ×N; anything between starts a new line` and `a skill gain line prints every time, as 1.6 (5× "You have advanced in the art of Block!")` (packages/client/tests/chat.test.ts)

### Chat and spellbook scroll with the browser's bar, in Director's place
- **Kind:** Platform
- **What you notice:** Chat and the spellbook have always-visible browser scrollbars beside their text fields; the bars use the browser's appearance.
- **1.6:** Director drew an always-on bar outside each field: chat at x 765–780 and y 455–545, and spellbook at x 775–790.
- **SSO:** Each box is 19 pixels wider than its text field, leaving a 3-pixel gap and a 16-pixel bar in the same place; Firefox supplies its own bar width. Clicking the gap beside the spellbook field does nothing, as it was outside the original sprite. Previously the browser bar sat inside the field and left an empty strip outside.
- **Why:** Browser scrolling already supports the wheel, and its bar belongs where the original frame leaves room.
- **In the code:** `packages/client/src/ui/stage.ts` (`DIRECTOR_BAR_W`), `packages/client/src/ui/spellbook.ts` (`createSpellbook`)
- **Pinned by:** `the list box leaves the field 164 px of text and room for the bar at x 775-790` (packages/client/tests/spells.test.ts)

### Chat opens with Enter
- **Kind:** Platform
- **What you notice:** Enter opens chat; while it is open, arrows, Home and End move the caret without walking. Enter sends and closes, while Escape closes and keeps the text.
- **1.6:** The chat field always had the keyboard, so arrow keys walked the character and moved the caret at the same time.
- **SSO:** Chat opens with Enter and captures those editing keys until closed.
- **Why:** This separates typing from walking and leaves room for other key bindings later.
- **In the code:** `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `Enter opens the input; arrows then walk nothing; Enter sends and closes it` (packages/client/tests/chat.test.ts)

### Equipment icons, × markers and the paperdoll centred on their boxes
- **Kind:** Platform
- **What you notice:** Equipment icons, unequip markers and the character preview are centered on their boxes.
- **1.6:** The six equipment icons sat at locs x 646/746 and y 281/320/359 with their own registration points, near box centres x 643/743 and y 297/336/375. The 15×14 unequip markers sat about two pixels above the rows, three pixels from the left boxes and seven from the right; their own rectangles were clickable. The paperdoll sprite’s rectangle began at [673, 319].
- **SSO:** Each icon bitmap is centered in its box. The 15×14 markers are centered on rows and placed eight pixels outside both sides; the boxes themselves do not click. The preview moves so the bare character's drawn pixels sit at stage x 676–710, y 306–359 in the middle box; added gear does not move it.
- **Why:** The user requested centered icons. Director drew unstretched sprites at their own bitmap size and registration point, not the score's stale 32×32 size.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)

### /logchat becomes a browser download
- **Kind:** Platform
- **What you notice:** `/logchat` downloads the main chat since login or Clear Chat Text. When typed in a room it downloads that room's log, then confirms in the main chat.
- **1.6:** The command wrote chat to a local Director preferences file.
- **SSO:** A browser download uses the second word as its filename, or `chatlog.txt` when absent, and prints “Logging the chat to file.”
- **Why:** Browsers have no Director preferences folder.
- **In the code:** `packages/client/src/app.ts` (`saveTextFile`, `runApp`)

### Sub-movie windows as floating windows
- **Kind:** Platform
- **What you notice:** IM, Friends, Bio, newspaper and other separate windows float above the game and can be dragged while the game continues behind them.
- **1.6:** IM, Away, Who, Friends, chat, Bio, newspaper and checkers used Director movie-in-a-window windows.
- **SSO:** Those screens use draggable floating windows with original art. Mail, message boards, the paint screen and painting viewer draw at their stage positions; the newspaper reader and editor are floating windows with close boxes only.
- **Why:** Browsers have no Director movie windows; floating windows fill that role.
- **In the code:** `packages/client/src/ui/window.ts` (`createWindowLayer`)

### Local MP3 player dropped
- **Kind:** Platform
- **What you notice:** The in-game local MP3 player is unavailable.
- **1.6:** The MP3 player sub-movie played local files.
- **SSO:** It is not provided.
- **Why:** It has no gameplay role and browsers cannot access local music folders that way.
- **In the code:** `packages/client/src/ui/gamemenu.ts` (`desktopMenus`)

### A photo shows the playfield only
- **Kind:** Platform
- **What you notice:** A photo contains the map, sprites and effects, but not open windows or name tags.
- **1.6:** A photo cropped whatever the stage showed in the lens rectangle, including windows and name tags.
- **SSO:** The client redraws the playfield without the lens and crops its canvas; windows and DOM name tags are separate page elements.
- **Why:** A browser has no Director stage image to copy.
- **In the code:** `packages/client/src/ui/paint.ts` (`takePhoto`)
- **Pinned by:** `a good shot hides the lens, redraws, crops 64×64 around the tap and saves a photo` (packages/client/tests/art-news.test.ts)

### New characters start on the operator's start point
- **Kind:** World content
- **What you notice:** A new character starts at the server's configured start point, on the seed map by default.
- **1.6:** The character file started at x1000y992 tile 6,4; a server override was commented out. The death-respawn seed was x0y102 tile 5,5.
- **SSO:** The start and death-respawn points are operator settings, replacing `Starting Map.txt`.
- **Why:** Archived maps are not shipped, so the original Test map and Brinkston are absent on a fresh server.
- **In the code:** `packages/server/src/game.ts` (`create`)
- **Pinned by:** `SSO: new characters start on the operator's start point setting, default x1000y992 (6, 4) on the seed map` (packages/server/tests/world.test.ts)

### Monsters without art are not placeable
- **Kind:** World content
- **What you notice:** The monster editor does not offer monsters whose walking art is missing.
- **1.6:** Stone Skull, Dragon, Ogre, the Strippers and Overlord, bodies 500, 501, 503, 855–857 and 988, have no front-walk bitmap in the character cast and would have been invisible if placed.
- **SSO:** Their stats, loot and experience remain in the monster data, but the editor does not offer them.
- **Why:** An invisible monster never worked as a visible feature; an operator can enable one if art is added.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`), `packages/server/src/systems/admin/roster.ts` (`handleRoster`)

### The seed map keeps its archived Slime roster
- **Kind:** World content
- **What you notice:** A fresh server's seed map has a Slime to fight.
- **1.6:** The Test map at x1000y992 had a Slime in roster slot 1.
- **SSO:** Willowbrook Wilds, the forest-and-lake seed map at the same grid position, starts with that roster; operators can change it with `/roster`. The [seed roster migration](../packages/server/migrations/20261105_03_monsters.sql) inserts it.
- **Why:** Although archived maps are not shipped, the roster is the original one for that map position.
- **In the code:** `packages/server/src/persistence/migrations.ts` (`runMigrations`)

### Archived maps not shipped; seeded starter, jail and church
- **Kind:** World content
- **What you notice:** A fresh server starts with Willowbrook Wilds, the enclosed Jail at x0y0, and the Church of the Bells at x999y999; its operators build the rest of the world.
- **1.6:** The server shipped 27 maps with item and monster sidecars, although community servers generally made their own worlds in the World Editor.
- **SSO:** The starting landscape comes from `packages/data/content/seed-map.json` and is applied only when the original map migration creates a new world. The Jail and Church come from validated content files and are added only where those coordinates are absent, preserving operator-authored maps. Existing saved maps are otherwise preserved. Spawn and respawn tiles are clear, and every walkable tile on the seed map is connected. Operators author further maps, monster rosters and NPC placements with the in-game editors. Game rules and catalogues ship as data; there is no original-format map importer.
- **Why:** Most community servers did not use the default world, and much of its placement data is missing from the archive; the jail and bell map are required by server rules.
- **In the code:** `packages/server/src/persistence/seed-map.ts` (`seedMapSql`, `jailMapSql`, `churchMapSql`), `packages/server/src/systems/admin/worldedit.ts` (`applySave`)
- **Pinned by:** `Willowbrook Wilds has a 17×12 lake, forest and rocks with empty upper layers`; `the start (6,4) and respawn (5,5) tiles are walkable, trees are not, every edge is reachable` (packages/server/tests/world.test.ts); `upgrades preserve both the old seed landscape and operator-authored maps` (packages/server/tests/migrations.test.ts); `the seeded jail encloses every walkable area and has no exits or landing pads` (packages/server/tests/jail.test.ts); `the seeded church is the validated Church of the Bells at x999y999 with no exits` (packages/server/tests/church.test.ts)

### Hard-coded world references become operator settings
- **Kind:** World content
- **What you notice:** Treasure maps, portals and the hazard map remain dormant until the operator configures them for the server's world.
- **1.6:** Treasure used one of 21 hard-coded maps; the portal read a settings file whose archived target was missing, and hazards targeted a hard-coded map. None of the named treasure maps was archived.
- **SSO:** Treasure map lists, portal destinations and the hazard map are settings, empty by default. The item roll, dig and hazard rules are unchanged.
- **Why:** Those original map references do not exist in an operator-built world.
- **In the code:** `packages/server/src/settings.ts` (`defaultSettings`), `packages/server/src/systems/crafting/gather.ts` (`resetTreasure`)

### Sound off silences everything
- **Kind:** Bug fixed
- **What you notice:** Turning sound off silences every game sound.
- **1.6:** Several sound paths ignored the switch, including swings, tool hits, gathering, damage-number sounds and rain; a player still heard swings and player-versus-player hits with sound off.
- **SSO:** Sound off silences all sounds; sound on leaves play unchanged.
- **Why:** A player switching sound off in a browser expects silence, and the change does not affect gameplay.
- **In the code:** `packages/client/src/audio.ts` (`createAudio`)
- **Pinned by:** `divergence: off silences everything, 1.6's ungated sounds too` (packages/client/tests/sound.test.ts)

### World Editor palette: empty slots are blank
- **Kind:** Bug fixed
- **What you notice:** Empty World Editor palette slots are blank and cannot be clicked.
- **1.6:** Page 10 stopped at member 589; its last 11 slots retained whichever tiles had previously occupied those sprites and could still be painted.
- **SSO:** Empty slots on every page are blank and unclickable. Added tiles without a member fill page 10's slots 50–60 first, followed by pages of 60. Without added tiles, only those last 11 page-10 slots visibly change.
- **Why:** Stale slots duplicated tiles from earlier pages and depended on the route to page 10.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`)
- **Pinned by:** `empty palette slots are blank and unclickable on every page; added tiles fill page 10 first` (packages/client/tests/worldeditor.test.ts)

### Password= replies after the change
- **Kind:** Other
- **What you notice:** A password change confirms success only after the new hash is stored; failure says “Your password could not be changed. Please try again.”
- **1.6:** The command printed its reply immediately.
- **SSO:** Hashing completes before the success line; a password change also ends the account's other resume tokens.
- **Why:** The reply reflects the actual result, and a stolen session cannot outlive a password change.
- **In the code:** `packages/server/src/game.ts` (`changePassword`)

### Train button on the NPC Bio window
- **Kind:** Other
- **What you notice:** A trainer's Bio has a Train button beside Sell. It opens a class-and-price list without a quantity field; OK trains and Cancel closes it.
- **1.6:** The Train sprite was empty in every frame and shown only in World Editor frames. Nothing called the unused class-purchase handler; a roster NPC's Bio had only Buy and Sell.
- **SSO:** A Bio shows Train when the NPC file has a line beginning `TRN|`. The button is drawn in the Buy/Sell style at [118, 253, 169, 270]. Every training line is listed, a zero or missing price trains free and a line without a class branch does nothing. The Bio's NPC speaks in the four messages, the list remains open after promotion, and OK displays PROCESSING until the server answers.
- **Why:** Promotions need a trainer, and the original never had a working one.
- **In the code:** `packages/client/src/ui/bio.ts` (`createBioWindow`), `packages/server/src/systems/economy/intents.ts` (`trainIntent`)
- **Pinned by:** `divergence: the Train button shows only with train: true, never in a player's bio` and `divergence: the Train click asks for the train list and closes the window` and `divergence: the train list has no quantity field; OK sends the row's line, even at price 0` (packages/client/tests/npcs.test.ts)

## crafting

### Crafting and gathering run on the server
- **Kind:** Exploit closed
- **What you notice:** Crafting and gathering use your tool, materials, station, skill and time in the game.
- **1.6:** The client controlled tile edits, drop rolls, timers, failure rolls, masterwork skill and station checks.
- **SSO:** The client sends attack and craft intents; the server checks the tool, station, inputs, skill and timer and makes the rolls.
- **Why:** Client-controlled checks allowed free items, faster crafting and selecting the best masterwork pool.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftIntent`, `craftStep`), `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)

### Treasure is found on the exact map and the dug tile
- **Kind:** Exploit closed
- **What you notice:** A successful dig can find treasure on its actual map and at the tile dug.
- **1.6:** The client sent a map name and pixel coordinates. The server matched the map by substring and dropped the item in ground slots 1–8 at those coordinates, without checking that a dig occurred.
- **SSO:** A successful dig on the exact treasure map rolls `random(5)` and drops on the dug tile. The ground cap and its slots 1–8 restriction are lifted; `treasureMaps` supplies the operator's map list.
- **Why:** A forged client could claim any map and position.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`toolSwing`, `resetTreasure`)

### A repair needs its chunk at completion
- **Kind:** Exploit closed
- **What you notice:** If the metal chunk is gone when a repair finishes, the repair ends without a message or a skill roll.
- **1.6:** A stale chunk search let a repair finish after the chunk was removed; it reduced the damaged item's slot again and renamed it to the chunk. A stack of three damaged items could become a chunk and a repaired item, while a stack of two lost both and still repaired. Loading a map freed the keys mid-craft, allowing the chunk to be dropped first.
- **SSO:** A missing chunk ends completion silently, just as a missing damaged item already did. Nothing is taken.
- **Why:** The original could create chunks from nothing.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`)
- **Pinned by:** `divergence: a chunk dropped mid-craft repairs nothing and says nothing` (packages/server/tests/craft.test.ts)

### Crafting and gather state lives on the server
- **Kind:** Architecture
- **What you notice:** Crafting and gathering timers advance with the server's game frames.
- **1.6:** Counters, anti-macro state, crafting timers and the key lock were client globals advanced every frame.
- **SSO:** The server advances per-character state at 20 ticks per second, keeping the original frame counts.
- **Why:** The server owns the game state.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`), `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)

### Regrowth rolls run on the server
- **Kind:** Architecture
- **What you notice:** Gathering sites regrow at a rate affected by how many players are on the map.
- **1.6:** Each client on the map drew a number from 1 to 600 each frame, except while a map was loading, to decide which regrowth and produce checks to run, then edited tiles.
- **SSO:** The server makes the same draw once per player on the map per frame, skipping players whose maps are loading.
- **Why:** The server owns tile changes while preserving the population-dependent rate.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`regrowthStep`)

### Built containers get server ids
- **Kind:** Architecture
- **What you notice:** A built crate or cabinet has its own container contents.
- **1.6:** The client appended a random number to a built Crate, Cabinet or Wind Cabinet, so two could share the same vault file.
- **SSO:** The server mints a unique increasing ID; World Editor Cauldrons use the same minter. Only built and placed containers are minted: a bare container added to a bag from a purchase, loot or gift gets a random ID instead, which can collide, and a bought stack shares one (see Cauldrons get unique ids and the bug ledger).
- **Why:** Each container needs its own contents and clients must not choose server file names.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`mintContainerId`)

### Crafts end at logout
- **Kind:** Architecture
- **What you notice:** A craft continues across map changes and death but ends on logout. Inputs already taken are not returned.
- **1.6:** Crafting counters lived on the client. Quitting stopped them; cooking and smithing had taken nothing yet, while alchemy and carpentry inputs were already gone.
- **SSO:** The server runs the craft during the session and ends it at logout, keeping inputs already taken.
- **Why:** Craft state is not kept across sessions in the saved character.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`), `packages/server/src/systems/world/world.ts` (`removePlayer`)
- **Pinned by:** `divergence: a craft ends at logout; a new session starts with none` (packages/server/tests/craft.test.ts)

### Cauldrons get unique ids
- **Kind:** Architecture
- **What you notice:** A World Editor placed or crafted Cauldron has its own container ID and retains it on later saves.
- **1.6:** A World Editor save gave a bare Cauldron a random ID and kept an existing one; random IDs could collide. A carried Cauldron kept no ID and opened the shared Cauldron file. No Cauldron was placed in archived maps.
- **SSO:** A placed or crafted Cauldron receives a unique minted ID. Other bare Cauldrons added to a bag, such as purchases, loot or gifts, instead get a random ID as crates and cabinets do, so only placed and crafted ones are guaranteed unique. A purchase of several puts the whole count on one line under one random ID, so those Cauldrons share storage, and the random ID can collide with another container or an orphaned one (bug ledger).
- **Why:** Container ownership needs a separate container for each placed or crafted Cauldron.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`mintContainerId`), `packages/shared/src/rules/inventory/inventory.ts` (`invAdd`)

## economy

### Guild vault access is checked at each take
- **Kind:** Exploit closed
- **What you notice:** If you leave a guild while its vault is open, the window closes when you try to take something. A carried crate or cabinet behaves the same after it leaves your bag.
- **1.6:** A guild vault stayed usable after leaving the guild because the client decided who could open it. A storage window continued to name a crate after its owner gave, traded, sold or dropped it, so the old owner could still take its contents.
- **SSO:** Every take checks whether the player may still use the container. If access has gone, nothing is taken and the window closes.
- **Why:** A forged client could otherwise keep withdrawing from a former guild vault or a container it had handed over.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)

### Promotions charge gold on the server
- **Kind:** Exploit closed
- **What you notice:** A promotion charges its listed gold price when your character qualifies.
- **1.6:** The client checked the promotion and subtracted the price. The server did not charge, so the next character update restored the gold; no screen used its unused purchase message.
- **SSO:** The server checks the NPC roster, training line, class, requirement and gold and writes the price and new class together.
- **Why:** The client intended to charge for eligible promotions, but the original allowed free or illegal promotions.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`trainIntent`)

### Shop prices come from the server
- **Kind:** Exploit closed
- **What you notice:** Buying or selling uses the price listed by the shop.
- **1.6:** The client supplied the price for purchases and sales. Affordability used that price and sales accepted a prefix of the listed price.
- **SSO:** The client sends the NPC, line and count; the server supplies the price.
- **Why:** A modified client could manipulate prices.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`buyIntent`, `sellIntent`)

### Bank accounts belong to their character
- **Kind:** Exploit closed
- **What you notice:** Bank commands use your character's own account.
- **1.6:** Deposit, withdrawal and balance requests named a file supplied by the client.
- **SSO:** The bank account belongs to the session character.
- **Why:** A forged file name could withdraw from another player's account.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`bankChat`), `packages/server/src/systems/economy/bank.ts` (`runBank`)

### House vault access
- **Kind:** Exploit closed
- **What you notice:** You can open and use a personal, house or guild vault only when its rules allow you; a refused house or guild vault says “You can't open a vault that's not yours!”
- **1.6:** Chest and vault requests had no ownership or position check. A house door was its only protection.
- **SSO:** Placed containers must be faced; a carried crate or cabinet is opened from the bag. A personal or house vault belongs to its owner by exact name; a House Key opens only its holder's door. A guild vault belongs to its named guild's members, so a later guild created under the same name inherits the old vault's contents (bug ledger). A carried crate or cabinet belongs to its carrier, while placed crates, cabinets and chests, quest chests and the Cauldron can be used by anyone facing them. For a forbidden house or guild vault the original standing-in-front line appears before the SSO refusal, modeled on the mailbox's ownership line. A forbidden deposit is refused before the drop line and takes nothing. The original remote withdrawal after the initial successful opening remains.
- **Why:** Anyone could otherwise read and loot any vault.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`mayUseContainer`, `openContainer`, `depositContainer`, `withdrawContainer`), `packages/server/src/systems/economy/vault.ts` (`openVault`)

### Trades are server sessions with two accepts
- **Kind:** Exploit closed
- **What you notice:** A trade exchanges both offers together after both players agree.
- **1.6:** The accepting client supplied both player names and both lists, and the server checked neither identity nor consent.
- **SSO:** The server holds a trade between two players on the same map and keeps each submitted offer within what that player holds. As in the original flow, the recipient presses Trade and the initiator presses Accept. One transaction moves both sides or neither.
- **Why:** A forged trade could steal gold or move items without the other player's consent.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`offerTrade`, `acceptTrade`, `settle`)

### A trade cannot be taken over
- **Kind:** Exploit closed
- **What you notice:** A new trade offer to a player already trading is refused with “Trade cancelled.”
- **1.6:** Another player's offer could replace an open trade's partner, another sender could fill the initiator's column, and selecting someone else during a trade redirected later messages and the server move.
- **SSO:** A player in a trade cannot be offered another.
- **Why:** Other players could interfere with or redirect a trade.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`openTrade`)

### Player shops are owned by id and validated
- **Kind:** Exploit closed
- **What you notice:** A player shop belongs to its owner and uses server-checked stock, prices and till.
- **1.6:** A client could overwrite an NPC and map monster file, exploit substring owner matching, supply prices and stock unchecked, use a negative register amount, or collect from nothing if the first 30 lines lacked a till. A client also chose the map for a title, and tag text inside a profile counted as a tag.
- **SSO:** The server rerolls the original shopkeeper-name generator while its result matches any NPC file or monster-list entry. Ownership uses character ID; the shop map is the speaker's, and `title` requires the house owner. Prices are 1–9999, items use the 204-line whitelist, at most 10 sale lines are allowed, and Register must be at least 1. A missing till says “I don't have that much gold!”; only lines beginning with the tag count as stock.
- **Why:** Forged ownership and malformed prices or tills allowed system merchant takeovers and gold creation.
- **In the code:** `packages/server/src/systems/economy/playershop.ts` (`createShopkeeper`, `shopCommand`)
- **Pinned by:** `a taken name or a monster-list name is rolled again`, `with no GLD line Register refuses; 1.6 paid from nothing` (packages/shared/tests/economy/playershop.test.ts); `owned by id: a character whose name is inside the owner's is no owner` (packages/server/tests/playershop-db.test.ts)

### Stall-free handling of the deep-SEL-line buy
- **Kind:** Exploit closed
- **What you notice:** Trying to buy an affected non-crystal item from a deep sale line produces the original refusal without freezing the server.
- **1.6:** Buying a non-crystal `SEL|` line at file line 17 or later spun the single-threaded server for up to the stock count; one deed had 300,000 stock.
- **SSO:** The same refusal is computed directly.
- **Why:** Repeating a request that stalls the server harms every player, even though the gameplay outcome is kept.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`)

### Vault and mailbox access needs adjacency and ownership as designed
- **Kind:** Exploit closed
- **What you notice:** You must face a vault or mailbox to open it, and may check only your own mailbox.
- **1.6:** Chest, vault deposit and mailbox requests could name files remotely. The mailbox had a refusal line for another player's box, but there was no vault form of that line.
- **SSO:** The faced tile must contain the vault or mailbox. Another player's House Vault says “You can't open a vault that's not yours!”, modeled on “You can't check mail that's not yours!”.
- **Why:** A forged remote request could steal items or read another player's mail.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`openContainer`), `packages/server/src/systems/mail/mail.ts` (`mailOpen`)

### Promotion leaves the skills page in order
- **Kind:** Architecture
- **What you notice:** Your skills page remains aligned after a promotion.
- **1.6:** A promotion appended each granted skill and value to one list while leaving the separate amounts list unchanged, misaligning the panel until restart.
- **SSO:** The skills panel is a fixed table and promotion changes no skill.
- **Why:** There are no separate lists to misalign.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`trainIntent`)

### Trades end when a trader leaves
- **Kind:** Architecture
- **What you notice:** An open trade is cancelled if either player changes map or disconnects, or if either closes the trade window. The remaining player sees “Trade cancelled.”
- **1.6:** A map change, death, logout or partner leaving did not close the trade window; its close box did not notify the partner.
- **SSO:** A map change, including death's respawn, a disconnect or closing the window ends the server-held trade.
- **Why:** A trade held by the server cannot outlive one of its traders.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`leaveTrade`, `cancelTrade`)

### Shop and bank presence is the map's roster
- **Kind:** Architecture
- **What you notice:** A bank is available if a banker is in the map roster. A shop purchase works while the NPC whose Bio you opened is in that roster, whether or not it is alive.
- **1.6:** Banking checked the NPC data for the map's four roster slots. Shop OK checked whether the clicked slot's data had changed; after a map change it did nothing until a map loaded data into that slot, then traded with the old NPC by name.
- **SSO:** The bank keeps the original roster check. Shop OK does nothing unless the originally opened NPC remains in the current map's roster.
- **Why:** A line-based purchase needs that NPC; another map's stale client slot was a peer-to-peer artefact.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`inRoster`, `canBank`, `buyIntent`)

### Quest chests refill on the server's save clock
- **Kind:** Architecture
- **What you notice:** Quest chests refill on the periodic character save clock, slightly less often than in 1.6.
- **1.6:** Each character upload rolled for a refill, including roughly sixty event-triggered saves and periodic saves: after a 400-frame block, each frame had a one-in-350 chance of a save.
- **SSO:** Each online player has a server-side periodic save clock; periodic saves roll for refill, but event saves do not.
- **Why:** The server owns the character sheet and receives no character uploads.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`saveClockStep`)

### Quests are server rows
- **Kind:** Architecture
- **What you notice:** Quest turn-ins update the server's quest list; the NPC comes from your map.
- **1.6:** Quests were read and rewritten in a 40-line settings file, which could also be edited with the File Editor.
- **SSO:** A 40-line quests table is seeded from the archived file at first start and turn-ins reroll lines as in 1.6. There is no settings form because the game rewrites the lines itself; the server takes the NPC from the map rather than a client message.
- **Why:** Quest state belongs to the server.
- **In the code:** `packages/server/src/systems/economy/quests.ts` (`questGive`), `packages/server/src/persistence/social.ts` (`loadQuestLines`, `saveQuestLine`)

### Shop decay deletes the shopkeeper and its till
- **Kind:** Architecture
- **What you notice:** When a shop interior is removed, its shopkeeper, stock and till go with it.
- **1.6:** Decay left the shop NPC file, till, stock and interior monster file behind. Only a later Small Shop on the same map and slot replaced the shopkeeper; the old file remained on disk.
- **SSO:** Deleting the interior through decay or building a new house on the same map and slot deletes the shopkeeper's NPC file, ledger and owner row.
- **Why:** The gold and stock are unreachable after demolition, so their rows need not remain.
- **In the code:** `packages/server/src/systems/economy/playershop.ts` (`forgetShops`)
- **Pinned by:** `a demolished shop's shopkeeper, file, till and owner row are deleted with the interior` (packages/server/tests/playershop-db.test.ts)

### Shop window lists every SEL line
- **Kind:** Limit lifted
- **What you notice:** A shop list includes every sale line and scrolls when it is longer than the visible box.
- **1.6:** The server listed `SEL|` lines only from the first 30 file lines; later ones were buyable only by a crafted name. No archived shop had such a line after line 20.
- **SSO:** The window lists every `SEL|` line and buying names the listed line. The List and Prices fields show about 13 lines and scroll when longer.
- **Why:** Operators author shops, and a hidden but buyable line was a window-size limitation.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`shopListIntent`), `packages/server/src/systems/economy/shop.ts` (`buyList`)

### Trade accept checks the partner's map
- **Kind:** Bug fixed
- **What you notice:** Accept checks whether your trade partner is still on the same map.
- **1.6:** Accept tested the sprite slot after the partner's. With only one other player on screen it always refused with “<name> is no longer in your area, you cannot trade.”
- **SSO:** That line is used only if the partner is no longer on the map; in practice a map change ends the trade first.
- **Why:** The client-slot check made one-on-one trades impossible.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`acceptTrade`, `leaveTrade`)

## housing

### Server clock drives house decay
- **Kind:** Exploit closed
- **What you notice:** House decay follows the server's calendar and the operator's configured time zone.
- **1.6:** Any client supplied the shared calendar month; a forged month sent repeatedly could demolish every house.
- **SSO:** The server gets the month using `houseDecayTimeZone`, UTC by default. The refresh and one-in-50 roll run as the original did: twice at login and every 1,230 frames per online player.
- **Why:** A forged client could otherwise wipe players' houses.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`monthCheck`, `houseClockStep`)

### Houses, maps and items written only by the server
- **Kind:** Exploit closed
- **What you notice:** Building a house, using a key and changing the world are performed through validated game actions.
- **1.6:** House, map, item, tile, monster and door writes accepted requests from any client.
- **SSO:** The server validates use, house-placement and key intents and performs the writes.
- **Why:** Unchecked writes allowed arbitrary world edits, item creation and forced demolition.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`), `packages/server/src/systems/housing/doors.ts` (`useKey`)

### The header names its owner exactly
- **Kind:** Exploit closed
- **What you notice:** House furniture permissions use the full owner name, or the exact name of your guild hall.
- **1.6:** The header test accepted a name followed by apostrophe-s anywhere in the header, so Bob could pass the test in “Jimbob's House” and place furniture or take Jimbob's Stove, Anvil and Alchemy Lab.
- **SSO:** A personal header must begin with “<name>'s ”; a guild hall header must equal “Hall of the <guild>”, so a later guild of that name still matches the old hall (bug ledger).
- **Why:** One player's name inside another's allowed theft of furniture.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`headDrop`)

### Door relock is one server timer per map
- **Kind:** Architecture
- **What you notice:** Doors relock according to a shared timer for the map.
- **1.6:** Each client counted down and sent its own close. A door change set each client to 200 frames, an arriving client started at 150 and a switch clicker at 100; the earliest closed the doors. An empty map counted nothing.
- **SSO:** One timer per map uses the same counts: a change sets 200, while arrival or a switch click takes the smaller of the remaining time and 150 or 100 respectively. The timer leaves with an emptied map.
- **Why:** The server model has no peers running separate countdowns.
- **In the code:** `packages/server/src/systems/housing/doors.ts` (`switchClick`, `relockStep`)

### Decay deletes the demolished house's interior and vault
- **Kind:** Architecture
- **What you notice:** A demolished house's lost interior and vault are removed; if someone is inside, its interior is deleted when they leave.
- **1.6:** Decay removed the house record and reverted the outdoor tiles, but the now-unreachable interior map and vault file stayed on disk. A missing map returned a character to the start point.
- **SSO:** The sweep also deletes the interior, its items and the house vault contents. An occupied interior waits until its occupant leaves, while a logged-out character saved there moves to the start point.
- **Why:** The contents were unreachable either way; the server need not keep unreachable rows forever.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`demolish`)

### Demolition shows at once
- **Kind:** Architecture
- **What you notice:** When a house is demolished, people on the map immediately see the reverted tiles and the removed exit and mailbox.
- **1.6:** Demolition rewrote the map and items files without notifying players, who saw the house until they reloaded the map.
- **SSO:** The server sends the map and item changes at once.
- **Why:** The server owns one map, so what players see needs to match where they can walk.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`demolish`)
- **Pinned by:** `SSO: a player on the map sees the demolition at once: the tiles revert and the Exit and mailbox go` (packages/server/tests/houses-db.test.ts)

### Houses build regardless of ground items
- **Kind:** Limit lifted
- **What you notice:** A house deed can be placed even when more than 17 ground items are on the screen.
- **1.6:** More than 17 ground items refused the deed with “This room is too crowded…”.
- **SSO:** Placement has no ground-item count check; the limit of two houses per map remains.
- **Why:** The ground-item cap is lifted, so the count no longer protects the original 20 slots.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`)
- **Pinned by:** `SSO: a deed builds with 25 items on the ground; 1.6 refused more than 17` (packages/server/tests/houses-db.test.ts)

## inventory

### Server derives the equip slot and checks requirements
- **Kind:** Exploit closed
- **What you notice:** Equipping an item uses the correct equipment slot and checks whether your character can wear it.
- **1.6:** The client supplied the slot type and checked strength, two-handed equipment and the murder flag; ownership was checked by substring.
- **SSO:** The client names a bag slot. The server reads the item, derives the equipment slot using the original rules and checks strength, two-handed equipment and the murder flag.
- **Why:** A forged slot and substring ownership check allowed arbitrary items in equipment slots.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`equipIntent`)

### Removals address an exact item in a named slot
- **Kind:** Exploit closed
- **What you notice:** Removing an item from your bag addresses the selected slot and exact item name.
- **1.6:** Inventory deletion and its callers matched item names by substring.
- **SSO:** Removals use the bag-slot index and exact name; the game rule tables retain their original substring semantics.
- **Why:** Substring deletion could destroy or rename the wrong item and create a name outside the catalogue.
- **In the code:** `packages/shared/src/rules/inventory/inventory.ts` (`invDelSlot`), `packages/server/src/systems/economy/trade.ts` (`take`), `packages/server/src/systems/economy/shop.ts` (`npcSell`)

### Map, ground and container files are resolved by the server
- **Kind:** Exploit closed
- **What you notice:** The game resolves ground items, vaults, banks and minimaps from your current character and location.
- **1.6:** Clients supplied the names of ground, vault, bank and minimap files.
- **SSO:** The server resolves the relevant state from the character's map, position, faced entity and account.
- **Why:** Client-supplied file names enabled remote pickup, vault looting, bank theft and path traversal.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pickupIntent`), `packages/server/src/systems/economy/containers.ts` (`openContainer`)

### Pickup and give require adjacency on the current map
- **Kind:** Exploit closed
- **What you notice:** You can pick up or give an item only when it is in reach on your current map.
- **1.6:** Ground pickup had no position check, and giving depended on the recipient's client.
- **SSO:** Pickup uses the orthogonally adjacent or faced tile on the player's map; a player receiving a give must stand on the faced tile. A quest NPC can receive a give from one or two tiles ahead.
- **Why:** A forged client could take items from any map.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `giveIntent`)

### Peer messages cannot grant gold or items
- **Kind:** Exploit closed
- **What you notice:** Gold and items change through server-handled game actions.
- **1.6:** Several peer messages changed client state based only on the sender's word.
- **SSO:** There are no peer-to-peer state messages.
- **Why:** The server owns game state.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`giveIntent`, `goldIntent`)

### Consumable effects and item breaks are rolled by the server
- **Kind:** Exploit closed
- **What you notice:** The server applies food and potion effects and equipment break rolls.
- **1.6:** The client applied consumable effects, selected break slots and could request that the right hand be cleared.
- **SSO:** The server applies effects and break rolls; the right-hand clearing request is removed.
- **Why:** The server owns character and equipment state.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`), `packages/server/src/systems/combat/melee.ts` (`smash`)

### Newspaper stands only on K2 tiles
- **Kind:** Exploit closed
- **What you notice:** A newspaper stand kit can be placed only on a K2 tile; another tile says “You can't put a newspaper stand here!” and keeps the kit.
- **1.6:** The client checked the faced layer-1 tile before dropping a kit, but the server did not, so a forged request could place a stand anywhere.
- **SSO:** The server performs the same faced-tile test.
- **Why:** A hand-sent request could otherwise place a stand on any free tile.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`)
- **Pinned by:** `divergence: not K2: 'You can't put a newspaper stand here!' and the Kit is kept` (packages/server/tests/art-news.test.ts)

### Use/equip answered without the long pauses
- **Kind:** Architecture
- **What you notice:** Using or equipping an item completes without the old network wait.
- **1.6:** An item-action pause of 425 or 325 frames held the action until a server reply, which normally ended it much earlier.
- **SSO:** The server resolves the action in the same tick and the reply ends the pause as before.
- **Why:** The delay waited on network latency rather than being a designed timer.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`, `equipIntent`)

### Ground items sit on whole tiles
- **Kind:** Architecture
- **What you notice:** Left and Right Rays are drawn offset from their tiles, whether placed in the editor or dropped.
- **1.6:** The World Editor placed a Left or Right Ray 15 pixels right and 10 pixels up from the clicked tile and stored its pixel position; a dropped Ray sat on its tile.
- **SSO:** Ground items are stored by tile and every Ray is drawn at the editor offset.
- **Why:** The server stores tiles rather than pixels; Rays are scenery normally placed in the editor.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`addGround`), `packages/shared/src/rules/inventory/ground.ts` (`groundDrawOffset`)

### No click pause after picking up or opening a board
- **Kind:** Architecture
- **What you notice:** Picking up a ground item or opening your own board does not delay the next item click; walking is unaffected.
- **1.6:** A ground item or own-board click set a pause up to 40 frames, usually ended by the server's reply after one round trip. The town Message Boards exited before setting it, and walking was never held.
- **SSO:** There is no pause on those two paths. The server processes one item action per character at a time and answers in the same tick; container and switch pauses and Ctrl's 40-frame pause remain.
- **Why:** The old pause waited for the network and play feels the same without it.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `actionIntent`)

### Ground items and containers have server ids
- **Kind:** Architecture
- **What you notice:** Ground items and containers retain their familiar names and visible `#n` suffixes.
- **1.6:** Ground entries were identified by name and pixel-position strings and containers by file names supplied by the client.
- **SSO:** Ground items and containers are server entities with IDs; their names remain for display.
- **Why:** Server IDs allow safe addressing of authoritative state.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`addGround`), `packages/server/src/systems/economy/containers.ts` (`openContainer`)

### No per-map ground-item slot limit
- **Kind:** Limit lifted
- **What you notice:** Ground items and loot can appear even when the old 20-item screen limit would have been full.
- **1.6:** A map's item file had 20 slots and loot used only slots 1–8. The client also refused gives and gathering drops when 20 items were on screen.
- **SSO:** The ground list has no fixed slot limit, those refusals are removed and loot always drops. Monster loot decays instead, as described under “Monster loot decays”.
- **Why:** The old limit came from Director sprite channels.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`addGround`)

### Monster loot decays
- **Kind:** Limit lifted
- **What you notice:** Monster loot and gathered items disappear after the configured time, 30 minutes by default. Player drops and operator-placed items do not decay.
- **1.6:** The server did not expire ground items; the map's 20 item slots bounded them.
- **SSO:** Loot and gathering drops, including logs, crystals, chunks, fish, produce and treasure, expire after an operator-set time. Player drops and admin placements never expire.
- **Why:** Without the ground-item cap, generated loot would accumulate without bound. Gathering also creates items from nothing, and the original fishing allowance can be refreshed indefinitely by attempting to walk. Player drops remain because players used house floors for storage.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`decayLoot`), `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)

## mail

### Mail is sent only from a mailbox
- **Kind:** Exploit closed
- **What you notice:** You must open your mailbox before sending mail.
- **1.6:** The compose pane, and therefore its send action, was available only after loading mail at a mailbox.
- **SSO:** The server refuses a send unless the player opened their mailbox in the session, and logs a cheat line.
- **Why:** A forged client could otherwise send mail from anywhere.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`)

### Mail reaches existing characters only
- **Kind:** Exploit closed
- **What you notice:** Sending to a name with no character is silently dropped; the sender still sees “*** Sending Mail...”.
- **1.6:** Sending mail appended to the file named by the client, creating it even if no such character existed; a relative path could reach another data file. The original did not confirm delivery.
- **SSO:** The server looks up the character name without regard to case and drops mail to a missing character silently.
- **Why:** Arbitrary names allowed path traversal and unbounded mailboxes for nonexistent characters.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`)

### Boards open only from the board clicked
- **Kind:** Exploit closed
- **What you notice:** A board window shows the board you clicked, and posts go to that board.
- **1.6:** Clients could name any board to load or save, including guild boards from anywhere.
- **SSO:** The server opens only the clicked Town Square board or a hall board from row 7 or above, and posts only to that board.
- **Why:** A forged request could read or write a hall board from a distance.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardOpen`, `boardPostIntent`)

### Mail sender stamped, mailbox writes restricted
- **Kind:** Exploit closed
- **What you notice:** Mail shows the sending character's name, and you can delete only your own messages.
- **1.6:** The client supplied the sender and could overwrite any mailbox.
- **SSO:** The server stamps the sender and restricts deletes to the player's own messages.
- **Why:** A forged sender or mailbox write enabled impersonation and mailbox wiping.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`, `mailDelete`)

### Message boards are append-only
- **Kind:** Exploit closed
- **What you notice:** A new board post is added to the existing board in the original `From:` format.
- **1.6:** Each post uploaded the whole board, and anyone could overwrite any board.
- **SSO:** The server appends the post.
- **Why:** Whole-board overwrites allowed vandalism and lost posts.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`)

### Uploaded images validated
- **Kind:** Exploit closed
- **What you notice:** Paintings and photos must be valid 64×64 PNG images to save.
- **1.6:** Raw image media of any size was written directly to the art directory.
- **SSO:** The server accepts only non-interlaced PNGs exactly 64×64, with 8-bit RGB or RGBA channels, checked chunks and CRCs, and at most the operator's `artBytesMax` limit, 16,384 bytes by default. It gives each image a unique ID and silently drops invalid uploads.
- **Why:** Unbounded or malformed images could abuse disk and memory or be served to other players.
- **In the code:** `packages/server/src/systems/mail/upload-check.ts` (`isPng`), `packages/server/src/systems/mail/art.ts` (`artSaveIntent`)

### Newspaper editing immortal-only on the server
- **Kind:** Exploit closed
- **What you notice:** Only immortals can save newspaper edits.
- **1.6:** The client menu restricted editing, but the server did not check authority on saves.
- **SSO:** The server checks the player's role.
- **Why:** Any player could otherwise publish a newspaper.
- **In the code:** `packages/server/src/systems/mail/newspapers.ts` (`newspaperSaveIntent`)

### Mail, board and newspaper size caps
- **Kind:** Exploit closed
- **What you notice:** Long mail and board posts are shortened, and old mailbox messages or board posts are removed when their limits are reached.
- **1.6:** The server had no limits beyond the approximately 2 MB messaging cap.
- **SSO:** Operator defaults are 2,000 characters per mail body, 50 messages per mailbox, 200 posts per board and 300 characters per board post. Longer bodies and posts are cut; the oldest messages and posts are dropped. Newspaper fields are schema-bounded because only an immortal edits them: photo IDs 20 characters, body 4,000 and each of the other five fields 500.
- **Why:** Unbounded stored content and payloads served to other players could exhaust resources.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailSend`), `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`), `packages/shared/src/protocol/mail.ts` (`newspaperSaveSchema`)

### One painting or photo per canvas or film
- **Kind:** Exploit closed
- **What you notice:** Each saved painting or photo uses one canvas or film. A second save without another is ignored.
- **1.6:** Saving needed no canvas or film, and a second Save in an open screen stored another painting.
- **SSO:** Using a canvas or film creates a server-held credit; saving spends it, a save without one is ignored, and credits clear on game entry.
- **Why:** A modified client could otherwise store unlimited images for free.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`useCanvas`, `useFilm`, `artSaveIntent`)
- **Pinned by:** `divergence: a second save and a save with no canvas are ignored` (packages/server/tests/art-news.test.ts)

### Art is never lost to a full bag
- **Kind:** Exploit closed
- **What you notice:** If your bag is full, saving art says “You are carrying too much...” and keeps the canvas or film credit.
- **1.6:** The server stored the image and reported success, but the inventory addition lost the item when the bag was full.
- **SSO:** Before storing the image, the server refuses a save when more than 14 of bag lines 1–15 are filled, using the original carrying-too-much line and keeping the credit.
- **Why:** The original could store an image that nobody held.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`artSaveIntent`)
- **Pinned by:** `divergence: a full bag is refused with the line and the canvas kept` (packages/server/tests/art-news.test.ts)

### Art is viewed from the item, not by id
- **Kind:** Exploit closed
- **What you notice:** Clicking a painting or using one from your bag opens its image. A painting with an unknown ID opens a blank viewer showing “Author: ”.
- **1.6:** A client could ask to view any painting ID, and the path-built file name could read another file.
- **SSO:** The server reads the ID from the clicked ground item or used bag line; a hand-typed ID is not accepted.
- **Why:** A forged ID enabled path traversal and access to art the player did not hold.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`viewArt`)
- **Pinned by:** `divergence: an unknown id opens the viewer with no author and no picture` (packages/server/tests/art-news.test.ts)

## monsters

### Monster state is server-owned
- **Kind:** Exploit closed
- **What you notice:** Monster positions, health and deaths come from the same server state for everyone.
- **1.6:** Monster messages were relayed without validation and a client could write monster state to a file.
- **SSO:** Only the server spawns, moves, damages, kills and persists monsters.
- **Why:** A modified client could otherwise spawn, teleport or delete monsters for everyone.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`), `packages/server/src/systems/monsters/ai.ts` (`moverPass`)

### Monster damage, monster attacks, XP and level computed on the server
- **Kind:** Exploit closed
- **What you notice:** Monster attacks, damage and the experience and levels awarded for kills are calculated by the server.
- **1.6:** Attackers calculated melee damage, victims rolled monster attacks, and the client managed experience and levels.
- **SSO:** The server performs those calculations using the original formulas.
- **Why:** Modified clients could award themselves rewards or ignore hits.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`), `packages/server/src/systems/combat/melee.ts` (`smash`)

### One monster walk grid for every player
- **Kind:** Architecture
- **What you notice:** Monsters use the same walking grid regardless of the vehicles players are riding.
- **1.6:** Each client built its own monster blocked-tile grid. Layer 2 was checked on foot and in an Airship, but never added on a Boat or Battleship.
- **SSO:** The server's monster uses the on-foot grid regardless of players' vehicles.
- **Why:** One authoritative monster needs one grid; on foot is how most players saw its movement.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`nextStep`)

### Monster population: one live monster per roster slot, sprite cap removed
- **Kind:** Limit lifted
- **What you notice:** Monsters refill each map's authored roster without a sprite-channel cap, while the original maximum density remains.
- **1.6:** Monster sprites occupied slots 180–184. Each slot spawned only its own roster entry, the fifth never spawned, and monsters did not despawn, so a screen saturated at four or fewer.
- **SSO:** An authored roster has at most four slots and each holds at most one live monster. Spawn attempts reproduce per-client rolls once per player, up to 15 players, with the same refill maths (mean 20/q seconds solo); additional players count as 15. There is no sprite cap.
- **Why:** The sprite cap was technical, but one live monster per slot preserved the density players saw. Without it an idle screen would gain roughly 12 monsters a minute indefinitely.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`, `spawnLadder`)

## movement

### Authoritative server
- **Kind:** Architecture
- **What you notice:** Monster health agrees between players, and each monster attack is rolled once for everyone.
- **1.6:** Clients calculated combat, damage, XP, movement and collision, and every client on a map ran monster AI; the server stored and relayed results. Separately rolled spell damage let players see different monster health values, and each client rolled monster attacks against itself.
- **SSO:** The server computes those results and clients send their intended actions.
- **Why:** Server authority makes every player use the same game state and prevents clients from supplying their own results.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`movePlayer`), `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`)

### Server-authoritative tile movement
- **Kind:** Exploit closed
- **What you notice:** Your client predicts your steps; the server corrects them when necessary.
- **1.6:** Each client decided collision, step timing, edge wrapping and exits, and peers trusted its movement messages.
- **SSO:** The server evaluates movement from input at 20 ticks a second.
- **Why:** Trusting the client allowed players to move too fast, pass through walls and teleport.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`movePlayer`)

### Movement relay queue removed
- **Kind:** Exploit closed
- **What you notice:** Other players' movement comes from the server.
- **1.6:** The relay queue accepted a client-supplied movement payload naming a map and player.
- **SSO:** The server broadcasts moves; the relay queue is removed.
- **Why:** Anyone could forge another player's movement.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`movePlayer`)

### Turn-in-place visible to others immediately
- **Kind:** Architecture
- **What you notice:** Other players see your new facing as soon as you turn in place.
- **1.6:** An Alt-turn sent no message; peers saw the new facing only on the next move.
- **SSO:** The server broadcasts facing changes.
- **Why:** The server owns facing for attacks and Ctrl actions, so it sends the current direction.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`announce`)

## progression

### Server applies damage, mitigation, i-frames and death
- **Kind:** Exploit closed
- **What you notice:** Damage, protection, brief hit immunity and death are calculated by the server.
- **1.6:** The victim's client handled damage, spell collisions and death checks.
- **SSO:** These calculations run on the server.
- **Why:** A modified client could ignore damage, Hold or death.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`)

### Character creation validated by the UI rules
- **Kind:** Exploit closed
- **What you notice:** A new character's starting stats must fit the character creation rules.
- **1.6:** The interface allowed at most 50 assigned points and a maximum of 20 per stat, while a separate client-only check allowed a sum up to 66.
- **SSO:** The server enforces stats from 1 to 20, a five-stat total at most 55, Agility, Speed and Aim of 1, and the name rules.
- **Why:** A modified client could create a 66-point or otherwise arbitrary character.
- **In the code:** `packages/shared/src/rules/progression/creation.ts` (`creationError`)

### Regen, hunger, food and death run on the server
- **Kind:** Exploit closed
- **What you notice:** Regeneration, hunger and the consequences of death continue according to the server's game state.
- **1.6:** The client managed regeneration, hunger, food and death.
- **SSO:** The server ticks each online character and applies death, penalties and drops.
- **Why:** A modified client could skip penalties, regenerate at will or avoid starvation.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`regenStep`, `hungerStep`, `checkDeath`)

### Regen stall resets on relog instead of client restart
- **Kind:** Architecture
- **What you notice:** The regeneration stall counter resets at login, but not when a dropped connection resumes the same session.
- **1.6:** The stalled counter reset when its timer sprite restarted, such as after a client restart or relogin.
- **SSO:** The counter belongs to the play session and resets at login, not a resumed session.
- **Why:** There is no timer sprite on the server; login is the equivalent boundary.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`regenStep`), `packages/server/src/systems/world/world.ts` (`sessionCombatState`)

## social

### Murder flags come from the server
- **Kind:** Exploit closed
- **What you notice:** A murder flag follows an innocent player's death according to the game's server rules; pardons are also server-controlled.
- **1.6:** Any peer could send a wanted or pardon message to any player.
- **SSO:** On an innocent player's non-arena death, the server may flag the recorded last player to hit them, even if that hit was long ago and something else caused the death. Pardons are server-controlled.
- **Why:** A forged message could frame a player or pardon the sender.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`, `pardon`)

### Guilds stored as server rows
- **Kind:** Exploit closed
- **What you notice:** Guild actions use current membership and leadership, and accepting an invitation requires the inviter to remain online and in charge.
- **1.6:** Clients could overwrite or delete guild files, join without an invitation and use path-like guild names to read other files, including character files containing passwords. An ex-leader's open screen still allowed exile, abdication and disbanding, and could crown a stale selection. A peer accept sent after its leader left was lost.
- **SSO:** Guild and member rows and each character's Guild field are written together. Each action checks current membership and leadership, names resolve to rows rather than paths, and Accept requires a pending invitation from an online current leader. A disbanded row remains so offline members can be told on login, and its name can be created again; the new guild reuses the old row's id. Because the vault, Guild Key doors and hall header name the guild, a guild created under that name inherits the old vault's contents, key doors and hall permissions (bug ledger).
- **Why:** Unchecked file and action requests allowed guild hijacking, forgery, disclosure and disbanding.
- **In the code:** `packages/server/src/systems/social/guilds.ts` (`guildAction`, `guildAnswer`, `guildCreate`)
- **Pinned by:** `divergence: a stale target (exiled since) is refused`, `divergence: ACCEPT after the inviter left joins nothing` (packages/server/tests/guilds.test.ts); `create, join, exile and disband are written with the fields; a restart reads them` (packages/server/tests/guilds-db.test.ts); `kept bug: a re-created guild's name opens the old vault, Guild Key door and hall` (packages/server/tests/guilds.test.ts)

### Faction membership and power are server state
- **Kind:** Exploit closed
- **What you notice:** Faction membership, bonuses and power follow your character and real head turn-ins.
- **1.6:** Joining was performed by the client after a forgeable peer message, and heads could be created by a drop request.
- **SSO:** The server holds membership, timer, bonuses and faction powers. Heads come only from deaths and loot. A rival head refreshes every online player's bonus, like the original faction broadcast made clients request again.
- **Why:** Forged messages and items could grant free bonuses or alter faction power.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`giveHead`, `refreshBonuses`)

### Murder flag and pardons are server-only
- **Kind:** Exploit closed
- **What you notice:** A credited killer can become wanted; an immortal can pardon an online player.
- **1.6:** Any client could send wanted or pardon messages to any player. A message to an absent killer was lost.
- **SSO:** At the end of the victim's death lock the server credits the recorded last player to hit them by player ID and applies the flag, even if another cause killed them later. A player who has logged off is not flagged. An immortal's `/Pardon` says “<name> is not online.” if the named player is absent.
- **Why:** Forged messages could frame an innocent player or pardon oneself.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`, `pardon`)

### Assassin points computed by the server
- **Kind:** Exploit closed
- **What you notice:** Assassin points come from deaths credited by the server and are announced just after the death line.
- **1.6:** A client could submit any number of points or forge the score message. A message to a killer who had left was lost.
- **SSO:** The server applies the original comparison to the recorded last player to hit the victim, by player ID, at the end of the death lock. That credit can be stale if something else killed the victim later; a player who has logged off earns nothing. The one-hit Lightning flag comes from the server's game mode.
- **Why:** Forged scores could win prizes.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`scoreKill`, `lightningOn`)

### Bios composed by the server
- **Kind:** Exploit closed
- **What you notice:** Asking for a Bio shows the target's items, title, score and disguises; editing your own profile happens through your Bio window.
- **1.6:** The target's client composed its Bio, and any incoming Bio message opened a window without a request. A forged message naming the recipient opened their editable layout with the sender's text and saved that text on close.
- **SSO:** The server composes the Bio from the target's state using the original contents and sends it only in response to a request. Your profile changes through your own Bio window.
- **Why:** Forged messages enabled fake Bios and profile rewrites.
- **In the code:** `packages/server/src/systems/social/bios.ts` (`bioRequest`, `profileSave`)
- **Pinned by:** `the requester sees the target's bio drawn; own is false for someone else` (packages/server/tests/friends.test.ts)

### Profiles are capped
- **Kind:** Exploit closed
- **What you notice:** A profile can contain up to 500 characters.
- **1.6:** Typing stopped when the limited profile field filled its 271×102 pixel box in Arial 12 bold; nothing else bounded the text.
- **SSO:** The box accepts at most 500 characters, and the server cuts longer text to 500 before saving.
- **Why:** A pixel limit in the client is not a server storage limit.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`saveProfile`)
- **Pinned by:** `capped at 500 characters before the strip` (packages/shared/tests/social/friends-bios-medals.test.ts)

### Friends list capped at 199
- **Kind:** Exploit closed
- **What you notice:** An addition that would exceed 199 names is refused with “Your friends list is full.” A colon in a name can add several names at once, and the whole addition is refused if it would exceed the limit.
- **1.6:** Adding a buddy had no limit; removal searched only items 1–190 and rebuilt from items 1–200, dropping names past the 199th at the next removal.
- **SSO:** The account's list holds at most the 199 names kept by the original rebuild.
- **Why:** Each addition rewrites the stored account list, so an unbounded flood could eventually stall the server.
- **In the code:** `packages/shared/src/rules/social/buddies.ts` (`buddyAdd`)
- **Pinned by:** `divergence: the list holds 199 names; an add past that is refused` (packages/shared/tests/social/friends-bios-medals.test.ts)

### Assassin's game state is server rows
- **Kind:** Architecture
- **What you notice:** Assassin scores, legends, game mode and prizes persist on the server; the all-time table starts empty on a fresh server.
- **1.6:** The game used separate files for mode, each player's score and wins, two top-ten tables and prizes. A winner's prize was written into the winner's item file.
- **SSO:** Server rows store the game, current and all-time tables, player scores and legends; ordered entries keep character IDs and name copies. Prizes come from the `assassinPrizes` setting, and an offline winner's prize is written to the stored bag. No old all-time standings are seeded.
- **Why:** The server owns the state, and the archive's all-time names belonged to players without characters on this server.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`setAssassinMode`, `endGame`)

### The Friends window opens only from the menu
- **Kind:** Platform
- **What you notice:** The Friends window opens when you choose Game → Open Friend's List, rather than appearing automatically on entry.
- **1.6:** Frame 50 opened Friends at every game entry and again on an admin's Return To Game; the menu reopened it.
- **SSO:** The server fills the Friends lines at entry and Return To Game and keeps them current while the window is closed; the menu opens the window.
- **Why:** A window popping up at every login gets in the way, and the list is one menu item away.
- **In the code:** `packages/server/src/systems/social/friends.ts` (`friendsEntry`), `packages/client/src/ui/gamemenu.ts` (`desktopMenus`)
- **Pinned by:** `divergence: game entry fills the Friends window but opens it at no size; a player's bio opens the Bio window` (packages/client/tests/npceditor.test.ts)

### Buddy and ignore lists per account on the server
- **Kind:** Platform
- **What you notice:** Your buddy and ignore lists follow your account across logins and devices and are shared by its characters.
- **1.6:** Buddies were saved in a local preference named for the server IP and shared by characters on that computer. The ignore list existed only for the session and cleared at login.
- **SSO:** Both lists are stored per account. Ignores persist across logins using the original text form and quirks; buddies preserve the original list items and tests, and the server keeps Friends-window lines from sessions. The windows remain.
- **Why:** Browsers lack Director's local preferences file, and persistent ignores protect players from repeat harassment.
- **In the code:** `packages/server/src/systems/social/friends.ts` (`friendsEntry`, `friendsCommand`), `packages/server/src/systems/chat/ignore.ts` (`ignoreCommand`)
- **Pinned by:** `divergence: the list follows the account across logins and fills the window at entry; others are untouched` (packages/server/tests/buddies-db.test.ts)

### Optional logon/logoff chat lines
- **Kind:** World content
- **What you notice:** By default login and logout update the Friends window without printing a chat line; an operator can turn announcements on.
- **1.6:** Presence messages updated an open Friends window but printed nothing in chat.
- **SSO:** Presence events go to everyone while `announcePresence` is on, its default. The separate `presenceChatLines` setting is off by default; when enabled it prints “<name> has logged on.” or “<name> has logged off.” Turning `announcePresence` off leaves the Friends window populated only at game entry.
- **Why:** Operators may choose visible announcements while the default matches 1.6.
- **In the code:** `packages/server/src/systems/social/presence.ts` (`presenceOut`)

### Guild names lose ; ` and '
- **Kind:** Bug fixed
- **What you notice:** Semicolons, backticks and apostrophes are removed from a new guild name; if nothing remains, the game says “This guild name is already taken!”
- **1.6:** The create button's sanitiser kept those characters. The server cut semicolons, a backtick broke later guild saves, and an apostrophe made a hall's door owner differ from its guild-key owner. An empty name created a nameless file.
- **SSO:** The original sanitiser runs first, including its adjacent-character behavior, then all three characters are removed. An empty result gets the original alert used after the first empty name existed. The name field stops at its original 210-pixel width, and the server refuses forged inputs longer than 100 characters.
- **Why:** These characters broke guilds in 1.6; the other surviving characters are harmless in server rows.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`sanitiseGuildName`), `packages/server/src/systems/social/guilds.ts` (`guildCreate`)
- **Pinned by:** `SSO also removes every semicolon, backtick and apostrophe; other marks and trailing spaces stay` (packages/shared/tests/social/guilds.test.ts); `divergence: an empty name after the sanitiser gets the same alert` (packages/server/tests/guilds.test.ts)

### A player named like a monster can be flagged
- **Kind:** Bug fixed
- **What you notice:** A player named Orc, Elf or another monster-list name can become wanted and earn Assassin points like any other player.
- **1.6:** The murder and Assassin messages were skipped when the last hitter's name equalled one of the first 60 monster-list lines. Monster names did not match that form, but players with such names were spared.
- **SSO:** A kill is credited by player ID. A player with a monster-list name can be flagged; monsters never are.
- **Why:** A name chosen at creation should not make a player immune to the murder flag.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`), `packages/server/src/systems/social/assassin.ts` (`scoreKill`)

### A normal Assassin's game ends Lightning
- **Kind:** Bug fixed
- **What you notice:** Starting a normal Assassin's game turns Lightning mode off for everyone.
- **1.6:** A normal start did not send the message to turn Lightning off. If it replaced a Lightning game, online clients kept Lightning's one-hit, penalty-free death for landed player melee hits while the server scored the game normally. Arrows, spells and monster attacks still killed by their usual rules.
- **SSO:** The current game mode determines whether Lightning is active, so a normal start ends it.
- **Why:** A game announced as normal should play as a normal game.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`setAssassinMode`, `lightningOn`)

### An Assassin's game with no scorer awards nothing
- **Kind:** Bug fixed
- **What you notice:** Ending an Assassin's game with no scorers announces the end but gives no wins or prizes.
- **1.6:** An empty game printed blank winner names and counted an all-time win for an empty name.
- **SSO:** The end prints “*** The assassin's game has ended!!!” and “*** Check back soon for yet another assassin's game.” only. With one or two scorers, missing places still print blank as in 1.6 and get nothing.
- **Why:** A game with no scorer should not award an empty-name win.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`endGame`)

## spells

### Server-created spells only
- **Kind:** Exploit closed
- **What you notice:** Casting uses your character's spellbook, power and available resources.
- **1.6:** Receivers trusted the reported caster, positions and spell power; the client checked spell points, spellbook, delay and whether the cast was harmful.
- **SSO:** The server validates the spell and target intent and computes spell power.
- **Why:** A forged client could cast as another player at arbitrary power.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)

### Server-side spell learning
- **Kind:** Exploit closed
- **What you notice:** A spellbook that passes the Dexterity check is consumed; it can teach a new spell, or nothing if the book has no matching spell or you already know it.
- **1.6:** The client checked Dexterity, appended the spell and uploaded the spellbook.
- **SSO:** The server performs the Dexterity check, consumes the book and appends the spell.
- **Why:** A modified client could grant itself any spell.
- **In the code:** `packages/server/src/systems/spells/learn.ts` (`readBook`)

### No effect triggers without a cast
- **Kind:** Exploit closed
- **What you notice:** Portals, body changes, created food and weapon fireballs arise from game actions the server has validated.
- **1.6:** Messages could trigger a portal exit without a portal, change or restore another player's body, grant food, or send Fire Staff and Firesword fireballs.
- **SSO:** The server triggers effects only from validated state.
- **Why:** A forged client could teleport for free, change another player's body, create items or deal free damage.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`, `swingFireballs`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`, `setBody`), `packages/server/src/systems/world/tick.ts` (`portal`)

### Monster spells and summons authored by the server
- **Kind:** Exploit closed
- **What you notice:** Monster spells and summoned monsters come from the server.
- **1.6:** Clients sent the messages for monster spells and summons.
- **SSO:** Only the server creates them.
- **Why:** Any client could otherwise cast as a monster or spawn monsters.
- **In the code:** `packages/server/src/systems/spells/monsterspells.ts` (`monsterSpells`)

### Hold cannot target players on safe maps
- **Kind:** Exploit closed
- **What you notice:** Casting Hold off an arena tile on a safe map is refused with “You cannot cast harmful spells here!” before spending spell points or crystals, although the 20-frame cast delay still applies.
- **1.6:** Hold was not in the harmful set and had no player-versus-player check. A player could repeatedly cast it to hold another player indefinitely in town. It had no effect on monsters.
- **SSO:** Hold is refused like a harmful spell when the caster is off an arena tile on a safe map; fight maps are unchanged.
- **Why:** Repeatedly holding another player in town enabled griefing.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)

### One authoritative monster HP and one roll per hit
- **Kind:** Architecture
- **What you notice:** Players see the same monster health and each hit is rolled once.
- **1.6:** Each client had its own monster HP and made its own spell-damage rolls.
- **SSO:** Each map has a single authoritative monster instance.
- **Why:** The server owns monster state.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`monsterHits`), `packages/server/src/systems/combat/melee.ts` (`smash`)

### Server collision geometry
- **Kind:** Architecture
- **What you notice:** Spell collisions use the server's view of player and monster positions.
- **1.6:** Every client tested sprite rectangles for its own player and for monsters.
- **SSO:** The server evaluates the same rectangle tests once, using member rectangles and registration points from asset metadata.
- **Why:** Collision is server-authoritative.
- **In the code:** `packages/server/src/systems/spells/geometry.ts` (`playerRect`, `monsterRect`), `packages/server/src/systems/spells/collide.ts` (`playerCollision`, `monsterHits`)

### Hazard timer on ticks
- **Kind:** Architecture
- **What you notice:** Environmental hazards run on the server's regular tick schedule.
- **1.6:** A 350 ms server timeout drove hazard messages.
- **SSO:** The hazard timer runs every seven ticks.
- **Why:** The simulation runs at 20 ticks a second.
- **In the code:** `packages/server/src/systems/spells/hazards.ts` (`serverTimer`)

### Summons stay on the map
- **Kind:** Architecture
- **What you notice:** A summon aimed beyond the map fails silently while still spending its effect, spell points and crystals. A pig dropped to summon it beyond the map is lost too.
- **1.6:** The cast area extended far enough beyond the 17×12 playfield that clicking its right or bottom edge could place a monster on column 18 or row 13.
- **SSO:** A summon on an off-map tile fails silently as it does for a full roster; a dropped pig summoned at row 0 is lost.
- **Why:** Server monsters live on map tiles; an off-map monster could not be reached or saved.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`summon`, `summonPig`)
- **Pinned by:** `SSO: a summon on a tile off the 17×12 map fails silently, paid for` (packages/server/tests/spells.test.ts)

### No 11-spell FX cap
- **Kind:** Limit lifted
- **What you notice:** More than eleven spell effects can be visible at once without replacing an older effect.
- **1.6:** Each client had eleven spell sprite channels.
- **SSO:** There is no fixed spell-effect cap.
- **Why:** The old limit came from Director sprite channels.
- **In the code:** `packages/server/src/systems/spells/fx.ts` (`freeSlot`, `placeQueued`)

## vehicles

### Vehicles converted by the server
- **Kind:** Exploit closed
- **What you notice:** Unboarding turns your airship into your vehicle item. Ownership follows your character, including after a rename.
- **1.6:** Unboarding named the item to create; ownership compared the text before the apostrophe in the item name with the player's name.
- **SSO:** The server builds, boards and parks the Airship, the only vehicle currently implemented, and converts it to the owner's item. Ownership is recorded by character ID while the item's name remains `<name>'s Airship`. Items without an owner ID, such as an operator drop or World Editor placement, use the original name test.
- **Why:** A client could create arbitrary items, while name-only ownership could let a renamed or look-alike character board someone else's airship.
- **In the code:** `packages/server/src/systems/vehicles/airship.ts` (`airshipClick`, `unboardAirship`)

### Airship item caps removed
- **Kind:** Limit lifted
- **What you notice:** You can build or park an airship even if 20 items are on the ground.
- **1.6:** Building or parking an airship was refused when the map had 20 ground items, with a too-many-items message.
- **SSO:** Neither the deed nor unboarding has that cap.
- **Why:** The cap came from ground-item sprite channels.
- **In the code:** `packages/server/src/systems/vehicles/airship.ts` (`airshipDeed`, `unboardAirship`)
- **Pinned by:** `SSO: no 20-item cap at the deed or at the unboard` (packages/server/tests/vehicles.test.ts)

## world

### Respawn point and portal exit decided by the server
- **Kind:** Exploit closed
- **What you notice:** Portals and respawns take you to the destination selected by the game.
- **1.6:** The client could send an arbitrary respawn map and tile or request a portal exit at will.
- **SSO:** The server evaluates the same rules and determines the destinations.
- **Why:** Players could set arbitrary respawn points and farm portal warps.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`respawn`, `portal`)

### Respawn point derived by the server
- **Kind:** Exploit closed
- **What you notice:** Entering an O-O-O map records your respawn point at its entry tile.
- **1.6:** The client could write an arbitrary respawn destination.
- **SSO:** The server records the point when a player enters an O-O-O map.
- **Why:** A modified client could otherwise set an arbitrary respawn teleport.
- **In the code:** `packages/server/src/systems/world/world.ts` (`enterRoom`)
- **Pinned by:** `SSO: the server records the respawn point on entering an O-O-O map; the client sends none` (packages/server/tests/world.test.ts)

### Map loading lock
- **Kind:** Architecture
- **What you notice:** Movement waits while a new map loads, and your character cannot be hit during that loading period.
- **1.6:** The keys stayed locked until the map's items were drawn; the arriving client did not run monster attacks before its map was drawn.
- **SSO:** The server holds a loading state until the client says the map is ready or 100 ticks pass; a loading player cannot be hit.
- **Why:** The server owns the input gate.
- **In the code:** `packages/server/src/systems/world/world.ts` (`enterRoom`), `packages/server/src/systems/world/tick.ts` (`tick`)

### Exactly two actor passes per frame
- **Kind:** Architecture
- **What you notice:** On occasional frames, walking, monster steps, attack rolls, hit immunity and regeneration run one or more calls slower than they could in 1.6; brief extra hit-blink flashes are absent.
- **1.6:** Director 8.5 ran an actor pass for each frame transition or stage update. The play frame normally triggered two passes, but redraw, exit and death handlers could add passes. A measured run had 452 frames with two passes, 28 with three, one with four and two with five.
- **SSO:** Every frame runs exactly two passes in the original order: frame counters, first pass, key poll and second pass. Extra passes are not modeled.
- **Why:** The extra calls depended on client display redraws; reproducing them would tie server timing to the original display plumbing.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`tick`), `packages/client/src/model.ts` (`clientTick`)
- **Pinned by:** `the key poll runs between the two actor passes` (packages/client/tests/model.test.ts); `a held arrow steps every 8 ticks and peers are told 16 calls` (packages/server/tests/world.test.ts)

### Per-client AI rolls become per-player server rolls
- **Kind:** Architecture
- **What you notice:** Monster spawning, movement, spells and NPC chatter scale with the number of players on the map.
- **1.6:** Every client's frame made its own rolls for spawning, movement authoring, monster spells and NPC chatter, using player-count ladders.
- **SSO:** One authoritative map instance makes each roll once per player on the map, up to 15, targeting that player.
- **Why:** This preserves aggregate rates and per-player targeting without client authority.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`emulated`, `tick`)

### The death save holds the respawn tile
- **Kind:** Architecture
- **What you notice:** After respawning, a crash does not restore you to the tile where you died.
- **1.6:** The death script saved the character before the warp reply arrived, leaving the death map and tile in the file until the next save. A crash before then returned the player to the death location.
- **SSO:** The server moves the player and saves the respawn place in one step.
- **Why:** The old file state was a race between client save and server warp; the server now owns position.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`respawn`)

### Death busy-wait becomes a 27-frame input lock
- **Kind:** Platform
- **What you notice:** After death the playfield goes black and holds its picture for 27 frames while the rest of the world, side panel and chat keep running; then the respawn map appears.
- **1.6:** A busy wait froze the whole client for 80 timer ticks. The playfield went black in one frame and lit again around 2.5 seconds later on the respawn map, including about one further second for the warp round trip and map load.
- **SSO:** The dead player's intents are ignored for 27 frames, about 1.33 seconds. During that lock the map layers are black, ground items are gone, and players and monsters hold their death-frame picture. The side panel, bars and chat continue updating; the extra network-loading black time is not copied.
- **Why:** A shared server cannot block, and freezing other players was never intended.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`tick`), `packages/client/src/playfield.ts` (`createPlayfield`)
- **Pinned by:** `death: the dying player gets { t: "death" } after the tick's vitals, once, and nobody else does` (packages/server/tests/monsters.test.ts); `death: black for one draw, then frozen until the respawn map is drawn` (packages/client/tests/death-stage.test.ts)

### Seeded church bell map
- **Kind:** World content
- **What you notice:** A fresh server has the Church of the Bells at x999y999, the enclosed sanctuary where the church bell sounds. It has no exits or landing pads; players reach it by an operator warp.
- **1.6:** The bell rang for players on the hard-wired map x999y999.
- **SSO:** A migration adds the validated church landscape if x999y999 is absent, preserving operator-authored maps there. The map is fully enclosed, so walking cannot reach it or leak through its edges into a nonexistent neighbour. The bell's timer and sound behavior are unchanged.
- **Why:** The hard-wired bell map should exist on a fresh server.
- **In the code:** `packages/data/content/church-map.json`, `packages/server/src/persistence/seed-map.ts` (`churchMapSql`), `packages/server/src/systems/spells/hazards.ts` (`CHURCH_MAP`, `serverTimer`)
- **Pinned by:** `the seeded church is the validated Church of the Bells at x999y999 with no exits` (packages/server/tests/church.test.ts); `the church bell rings at the 20th run to x999y999, Churchy:5:200` (packages/server/tests/spells.test.ts)
