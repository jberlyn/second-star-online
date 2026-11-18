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
| [admin](#admin) | 34 |
| [casino](#casino) | 20 |
| [chat](#chat) | 17 |
| [combat](#combat) | 34 |
| [core](#core) | 55 |
| [crafting](#crafting) | 8 |
| [economy](#economy) | 49 |
| [housing](#housing) | 27 |
| [inventory](#inventory) | 43 |
| [mail](#mail) | 11 |
| [monsters](#monsters) | 4 |
| [movement](#movement) | 4 |
| [progression](#progression) | 4 |
| [social](#social) | 16 |
| [spells](#spells) | 10 |
| [vehicles](#vehicles) | 3 |
| [world](#world) | 8 |
| **Total** | **324** |

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

### Staff chat membership enforced
- **Kind:** Exploit closed
- **What you notice:** Immortals and moderators can read and post staff chat (`-text`) in a dedicated colour; ordinary players cannot.
- **1.6:** Any client could request membership in the administrators' group, and only immortals could post.
- **SSO:** The server chooses who receives and can post to staff chat (both staff roles), and delivers it in `CHAT_COLOR.staff`.
- **Why:** Other players could otherwise listen to staff conversations.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`staffChat`)

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
- **SSO:** Load and save require an immortal in the editor and a name on its monster or NPC list; selecting no name sends nothing. The server checks each line and refuses backticks, `*`, `^`, tags other than the twelve upper-case tags used by the archive, second `|` separators, malformed or out-of-range numbers on `SEL|`, `BUY|`, `INV|`, `GLD|` and `TRN|` lines, unknown items, a second `GLD|`, more than 100 lines or lines over 255 characters. `INV|` chances start at 1; other numeric fields start at 0, and the inventory line accepts gold, crystals and fixtures as well as catalogue items and archived spellings. After “NPC has been successfully saved.”, warnings identify inert `FLG|` and `SPL|` values, and `TRN|` classes without a promotion branch. Each save versions the previous file.
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
- **SSO:** Addresses stay server-side and lookup is restricted to staff. The login addresses the server keeps for IP bans are shown only to immortals.
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
- **SSO:** The original echo is followed as applicable by “Bob is not online.”, “There is no character called Bob.”, warp usage for a non-tile coordinate, “You cannot ban yourself.”, “Only an immortal can kick an immortal.”, “Only an immortal can do that to an immortal.” or “Only an immortal can do that to staff.” A moderator cannot kick an immortal, nor use IP lookup, warp or warptome on one, and can ban, jail or pardon players only; warpmeto still moves the moderator. `/ban` and `/jail` work on offline characters. IP bans are immortal-only, and only the staff member who made a ban or jail, or an immortal, can change or lift it.
- **Why:** The server can report failed actions, and an immortal's address and editor session should not be controlled by a moderator.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)

### Role and unban chat commands
- **Kind:** Architecture
- **What you notice:** An immortal can change another account's role with `/role <name> player|moderator|immortal`, and immortals or moderators can unban with `/unban <name> [reason]`, though only the staff member who made a ban, or an immortal, can lift it.
- **1.6:** Roles were lines in an immortals file edited with the File Editor; unbanning meant removing a prefix from the character file.
- **SSO:** A role change takes effect immediately in the admin menu, chat and role table; changing one's own role is refused. For anyone else `/role` is local chat, as in 1.6. `bun run admin:role` remains available to create the first immortal.
- **Why:** Roles now live on accounts and the File Editor is gone.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)

### Banned players are told at once
- **Kind:** Architecture
- **What you notice:** A player banned while online is disconnected with “YOU ARE BANNED FROM PLAYING HERE ON THIS ACCOUNT!!” followed by when the ban ends (“Banned until 2026-11-20 14:00 UTC.” or “This ban is permanent.”), and sees the same alert on later login attempts. The reason a moderator gave is never shown to the player.
- **1.6:** Ban kicked the player to the title without text; the next login showed that alert. The server checked the password before the client's ban response.
- **SSO:** The account is flagged, an online player is disconnected with the alert, and later logins are refused with it after the password check. A timed ban lifts itself when it ends.
- **Why:** The server kick is reliable and the alert explains it; the end tells the player when to come back, while the reason stays an internal staff record.
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
- **What you notice:** `/jail` works on a fresh server. The stone jail at x0y0 has barred cells, an enclosed perimeter, no exits, and no landing pads. Prisoners arrive at tile 4,4 and remain until their sentence ends or staff use `/unjail`.
- **1.6:** Used the archived Jail map. Portal and death respawn could bypass the sentence.
- **SSO:** A migration adds a validated jail landscape if x0y0 is absent, preserving operator-authored jails. Portal, map exits and edge crossings cannot leave x0y0. Death revives prisoners at 4,4 and their sentence runs on. The jail does not overwrite a character's ordinary respawn point. Staff warps cannot take a prisoner out or put a player in (see [stored sentences](#jail-sentences-are-stored-and-run-in-real-time)). A deleted jail still produces the missing-map refusal.
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

### Immortal /drop takes a count
- **Kind:** World content
- **What you notice:** An immortal can use `/drop <n> <item>` to place a stack of up to 9,999 items at once.
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

### Moderators share the original moderation commands and staff chat
- **Kind:** Bug fixed
- **What you notice:** Moderators can use `/ban`, `/unban`, `/unjail` and `/pardon` on players, `/banlist`, `/CheatFile`, `/Inventory`, `/save`, `/Refresh`, `/warpscript`, and `-text` staff chat, in addition to kick, warp, jail, IP lookup, and location. `/BanIP`, `/unbanip`, `/drop`, `/role`, `/setclass`, `/roster`, `/spawn`, and editors remain immortal-only, and moderators still cannot act on immortals.
- **1.6:** Only a subset of admin commands worked for moderators, and `-text` was immortal-only.
- **SSO:** `ADMIN_ROLES`, `usesStaffChat`, and `warpscriptOnBroadcast` grant moderators the original moderation command set and staff chat while keeping server authority and player denials. Item creation and IP bans are too dangerous for a moderator role: `handleDrop` and `ADMIN_ROLES` keep them immortal-only, and `/unban` lifts only a ban the moderator made (`mayChange`).
- **Why:** Completes the moderator moderation toolkit without letting moderators mint items, change IP bans, or undo an immortal's ban.
- **In the code:** `packages/shared/src/rules/admin/admin.ts` (`ADMIN_ROLES`, `mayRun`, `usesStaffChat`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`, `staffChat`), `packages/server/src/systems/admin/drop.ts` (`handleDrop`), `packages/shared/src/rules/admin/moderation.ts` (`mayChange`)
- **Pinned by:** `moderators keep the moderation commands; IP bans, /role and /setclass stay immortal-only` (packages/shared/tests/admin/admin.test.ts); `a moderator may run the moderation commands, but not IP bans, /role or /setclass`, `SSO: a moderator may not lift a ban an immortal made`, `a moderator cannot lift a ban an immortal made` (packages/server/tests/admin.test.ts); `only immortals drop items or gold; moderators and players do nothing` (packages/server/tests/inventory.test.ts)

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
- **SSO:** `showNpcScript` returns all lines losslessly without truncation or character stripping. A file over 100 lines also brings an alert that SAVE refuses more than 100 and how many lines to remove.
- **Why:** Prevents silent data loss when inspecting and re-saving NPC scripts.
- **In the code:** `packages/shared/src/rules/admin/npcfile.ts` (`showNpcScript`); `packages/server/src/systems/admin/npcedit.ts` (`loadNpc`)
- **Pinned by:** `lossless display: preserves OWN|, all first characters, empty lines, and >100 lines` (packages/shared/tests/admin/npcfile.test.ts); `LOAD's reply displays lossless complete text including OWN|, empty lines, and >100 lines` (packages/client/tests/npceditor.test.ts); `SSO: a file over the save limit loads in full with a warning that SAVE will refuse it` (packages/server/tests/npcedit.test.ts)

### Unauthorized staff chat and /warpscript show a refusal and clear input
- **Kind:** Bug fixed
- **What you notice:** When a player types `-text` or `/warpscript`, they see an explicit refusal in chat and the chat input clears.
- **1.6:** Both commands exited without sending and left the typed text stuck in the input box.
- **SSO:** `staffChat` and `handleAdmin` reply with `ADMIN_TEXT.staffChatDenied` or `ADMIN_TEXT.warpscriptDenied` and do not send `restore`.
- **Why:** Gives clear feedback and avoids leaving failed commands stuck in the input field.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`staffChat`, `handleAdmin`)
- **Pinned by:** `a player's - line gets an explicit denial and clears input (no restore)` and `a player gets an explicit denial and cleared input (no restore); moderators can set it` (packages/server/tests/admin.test.ts)

### Staff chat uses a dedicated channel without muffling or ignore filtering
- **Kind:** Bug fixed
- **What you notice:** Staff chat (`-text`) renders in a distinct green colour (`CHAT_COLOR.staff`) as `<... Name tells the staff "text"`, reaches only staff (immortals and moderators), works from anywhere inside houses, and is never muffled or dropped by ignore lists.
- **1.6:** The channel was called admin chat and its lines read `<... Name tells the admins "text"`. It used an ordinary local-chat `sqa` message, so it appeared white, failed below row 7 in houses, muffled below row 10, and was dropped by ignore lists.
- **SSO:** `staffChat` sends directly to all online staff in `CHAT_COLOR.staff` without house restrictions, `heardSqa`, or `hears`. It is called staff chat, and its lines say "tells the staff", because moderators use it as well as immortals and "Admin Chat" names the immortals-only Game menu room.
- **Why:** Staff communication should be visually distinct and reliable regardless of position or ignore lists.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`staffChat`), `packages/shared/src/rules/chat/chat.ts` (`CHAT_COLOR`)
- **Pinned by:** `both immortals and moderators post to staff in CHAT_COLOR.staff; players excluded` and `staff chat has no house sender restriction, no muffling, and no ignore filtering` (packages/server/tests/admin.test.ts)

### Bans and jails carry a reason, a length and the maker's rank
- **Kind:** Exploit closed
- **What you notice:** `/ban`, `/jail` and `/banip` take an optional duration (`30m`, `12h`, `7d`, `2w`, `perm`) and reason after the name, such as `/ban Berlyn 3d being a rude person`; without a duration the server settings decide. Bans, jails and pardons by a moderator reach players only. Only the staff member who made a ban or jail, or an immortal, can change its length or lift it.
- **1.6:** A ban was a prefix on the character file with no reason, end or author; any administrator could add or remove it.
- **SSO:** Each action stores its maker's account, name and rank at that moment, the reason and the end. A re-ban by its maker or an immortal replaces the length; anyone else is refused with “Bob was banned by Alice; ask Alice or an immortal.” A lapsed ban or jail stops nobody.
- **Why:** Moderators could otherwise overwrite an immortal's ban with their own and then lift it, and changes of role later would change who may lift an old ban. Staff with different views settle them together rather than overriding each other.
- **In the code:** `packages/shared/src/rules/admin/moderation.ts` (`mayTarget`, `mayChange`, `parseModerationArgs`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/persistence/moderation.ts` (`recordModeration`)
- **Pinned by:** `regression: a moderator's /ban cannot overwrite an immortal's ban to lift it`, `a moderator changes only their own ban; an immortal changes any`, `a moderator may not ban, jail or pardon another moderator` (packages/server/tests/admin.test.ts); `a ban keeps its maker's rank at the time: a demoted immortal's ban stays theirs` (packages/server/tests/moderation-db.test.ts)

### Moderation history and /banlist
- **Kind:** Architecture
- **What you notice:** `/banlist` lists the bans and jails in force (and, for immortals, IP bans); `/banlist <name>` shows a character's standing, last ten moderation actions with their reasons and, for immortals, their login addresses; `/banlist <address>` (immortals) shows an address's ban and who has played from it.
- **1.6:** The bans lived in character files and a bans file, with no history and no in-game list.
- **SSO:** Every ban, unban, IP ban, jail, release and pardon is a row in `moderation_log`, kept after the action ends.
- **Why:** Staff need to see why someone was banned and by whom before changing it.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/persistence/moderation.ts` (`moderationHistory`)
- **Pinned by:** `moderators see bans and jails; immortals also see IP bans`, `/banlist <name>: standing, history and (immortals) addresses` (packages/server/tests/admin.test.ts)

### IP bans are checked, cover an IPv6 /64 and act at once
- **Kind:** Exploit closed
- **What you notice:** `/banip` accepts a character name (their last login address, or every address with `all`) or a valid address, and refuses anything else. Sessions from the address are disconnected immediately, and it cannot log in or create characters until the ban ends (30 days by default). Immortals are never stopped by an IP ban.
- **1.6:** `/BanIP` wrote any text to the bans file and the ban was never enforced.
- **SSO:** Addresses are stored in their standard form; an IPv6 ban covers the /64, matching the login limits. The server keeps each account's login addresses for `addressHistoryDays`. The check runs after the password, so that an immortal behind a banned address can still log in.
- **Why:** Unvalidated text could ban nothing or an unintended address, an IPv6 user could step to a neighbouring address, and an operator must not lock themselves out.
- **In the code:** `packages/shared/src/rules/admin/moderation.ts` (`canonicalIp`, `ipKey`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`), `packages/server/src/game.ts` (`login`, `create`, `refusal`), `packages/server/src/persistence/moderation.ts` (`noteAddress`)
- **Pinned by:** `an IP ban disconnects every session from that address except an immortal's`, `/banip <name> bans the latest address, or all of them; an immortal is never IP banned`, `divergence: an IP ban refuses a login from that address after the password` (packages/server/tests/admin.test.ts); `IP bans cover the IPv6 /64, refuse creation and resume, and never stop an immortal` (packages/server/tests/moderation-db.test.ts)

### Jail sentences are stored and run in real time
- **Kind:** Bug fixed
- **What you notice:** A jail sentence lasts the given minutes, hours or days (10 minutes by default) of real time, whether or not the prisoner stays online, and relogging does not restart it. `/jail` works on an offline character, who arrives in jail at their next login. `/unjail` ends a sentence early; staff warps cannot take a prisoner out or put a player in.
- **1.6:** The sentence was a frame counter (8000 frames by default) in the client that restarted on every arrival in the jail, counted only while online, started at 10000 on a login, and kept counting after an administrator warped the prisoner out.
- **SSO:** Each sentence is stored with its end. A prisoner online when it ends goes to the start point; one offline goes there at their next login. The setting is `jailMinutes`.
- **Why:** A sentence that restarts on every login, or that pauses offline, cannot be timed by staff, and a warp-out left the timer meaningless.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`jailTick`, `releaseFromJail`), `packages/server/src/game.ts` (`enter`), `packages/server/src/systems/admin/commands.ts` (`handleAdmin`)
- **Pinned by:** `divergence: the sentence is stored and ends at its time, then releases to the start point`, `divergence: staff warps neither take a prisoner out nor put a player in; /unjail releases` (packages/server/tests/admin.test.ts); `a sentence survives logout and restart, and one that ends offline releases at login` (packages/server/tests/moderation-db.test.ts)

### NPC files are read in full
- **Kind:** Bug fixed
- **What you notice:** Every line of an NPC file counts: a monster can drop any `INV|` item listed in its file, an NPC can say any `RND|` chatter line, and the Bio shows every `BIO|` and `PRO|` line. The NPC editor no longer warns about where a line sits. A file is still at most 100 lines.
- **1.6:** Each reader looked at its own window of the file: monster drops at lines 1-80, chatter at lines 1-20 and the Bio at lines 1-100 (and the shop at 1-80, gold gifts at 1-60). A line past its window did nothing. No archived file reached a window's end; the longest has 21 lines.
- **SSO:** The parser reads the whole file for every tag. The 100-line cap on saved files stays, to bound storage.
- **Why:** The windows were 1.6 reader limits with no gameplay purpose, and only surprised operators writing long files.
- **In the code:** `packages/shared/src/rules/admin/npcfile.ts` (`parseNpcFile`, `checkNpcFile`, `NPC_MAX_LINES`); `packages/shared/src/rules/monsters/loot.ts` (`rollLoot`)
- **Pinned by:** `bug fixed: INV| counts on any line, past line 80 too`; `bug fixed: RND| counts on any line, past line 20 too`; `warned: inert tags only; no line is outside a reader's window` (packages/shared/tests/admin/npcfile.test.ts); `bug fixed: a chatter line past line 20 saves with no warning, and is said` (packages/server/e2e/npc-editor.test.ts)

## casino

### Blackjack dealt, escrowed and settled by the server
- **Kind:** Exploit closed
- **What you notice:** Blackjack bids are held when locked, and leaving during a hand forfeits the stake to the opponent.
- **1.6:** Clients dealt their own cards, and a settlement message could name any winner and loser; no gold was held in escrow.
- **SSO:** The server deals from a 13-rank shoe (`1..9` and 4/13 `10`-value) and applies standard bust/draw outcome rules. Each bid is held from the purse at lock and excess is returned when the stake is set; saved gold includes the hold until settlement. Leaving mid-hand or disconnecting past the configurable grace, 30 seconds by default, forfeits the stake to the opponent, who sees “<user> has left the table!”. Returning within the grace restores the table.
- **Why:** A forged settlement could drain another player's gold or choose cards.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjBid`, `bjLeave`, `bjReturn`, `bjTick`)
- **Pinned by:** `divergence: gold drops at the lock, the excess returns when both lock, four cards P1 P1 P2 P2`, `divergence: mid-hand Leave forfeits the stake to the opponent` and `divergence: past the grace the stake is forfeit: the opponent gains, the dropped player's saved row loses the hold` (packages/server/tests/blackjack.test.ts); `a flush mid-hand writes gold + the held stake; a forfeit past the grace moves the stake in SQL` (packages/server/tests/casino-db.test.ts)

### Checkers moves checked by the server
- **Kind:** Exploit closed
- **What you notice:** Only the seated player whose turn it is can make a legal step or jump.
- **1.6:** Any client in the group could send a move for either side's pieces.
- **SSO:** The server holds the board and turn and accepts only a legal move by the seated side on its turn, enforcing forced capture, multi-jump continuation, blocked-side loss, single start line, and Black moving first.
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
- **SSO:** The server computes the high-score points from authoritative skills (`bioScore` plus the 8 formerly dropped skills) and ranks each periodic save with tie-friendly ordering.
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

### Three Pigs (4-4-4) pays 80 and 2-3-2 pays 50
- **Kind:** Bug fixed
- **What you notice:** Three Pigs (`4-4-4`) pay 80 gross, and `2-3-2` pays 50 gross.
- **1.6:** `2-3-2` paid 80 and `4-4-4` paid 50.
- **SSO:** Swaps the two bonuses in `casino.json` so `4-4-4` pays 80 and `2-3-2` pays 50.
- **Why:** Three Pigs (`S4`) are the top jackpot symbol on the reels.
- **In the code:** `packages/data/content/casino.json`; `packages/shared/src/rules/casino/casino.ts` (`slotPayout`)
- **Pinned by:** `4-4-4 pays 80 and 2-3-2 pays 50; RTP 245/64 over all 64 reels` (packages/shared/tests/casino/casino.test.ts)

### Blackjack aces reduce one at a time
- **Kind:** Bug fixed
- **What you notice:** Multiple aces drop from 11 to 1 one at a time as needed (`A-A` = 12, `A-A-9` = 21, `A-A-A` = 13).
- **1.6:** Over 21, 10 was subtracted for every ace at once and 11 added back if under 11 (`A-A` = 13, `A-A-9` = 11, `A-A-A` = 14).
- **SSO:** Reduces one Ace by 10 at a time while the total exceeds 21.
- **Why:** Standard blackjack ace valuation prevents invalid totals like `A-A-9` = 11.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`handTotal`)
- **Pinned by:** `handTotal reduces Aces one at a time: A-A 12, A-A-9 21, A-A-A 13, A-5 16, 10-9-5 24` (packages/shared/tests/casino/blackjack.test.ts)

### Both blackjack hands busting is a draw
- **Kind:** Bug fixed
- **What you notice:** When both players bust, a single draw line prints and both stakes are refunded.
- **1.6:** Different-total busts printed a draw line and still awarded the pot to the higher bust; equal busts printed the draw line twice.
- **SSO:** Returns a single `["draw"]` when both hands bust or totals are equal.
- **Why:** A busted hand cannot win the pot.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`outcome`); `packages/server/src/systems/casino/blackjack.ts` (`settle`)
- **Pinned by:** `outcome: both bust is a single draw; bust loses; higher non-bust wins` (packages/shared/tests/casino/blackjack.test.ts); `both bust, different totals: single draw line and refund` (packages/server/tests/blackjack.test.ts)

### Blackjack uses a 13-rank shoe and requires positive bids
- **Kind:** Bug fixed
- **What you notice:** Ten-value cards occur with 4/13 probability, and bids must be positive integers (`>= 1`).
- **1.6:** Cards were uniform over 10 values (1/10 for 10) and non-numeric or `0` bids started a free game.
- **SSO:** Draws from 13 ranks (`10..13` map to 10-value) and rejects bids `< 1` or non-numeric strings.
- **Why:** Matches standard card odds and prevents forcing free hands with invalid bids.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`drawCard`, `bidCheck`, `stake`)
- **Pinned by:** `drawCard draws from 13 ranks: 1..9 map to 51..59, 10..13 map to 60` and `bidCheck: <= 0 or non-numeric is none, 100000 is max, gold short is poor` (packages/shared/tests/casino/blackjack.test.ts)

### Checkers enforces forced capture, multi-jump, and win by blocking
- **Kind:** Bug fixed
- **What you notice:** You must jump when a capture is available, a jumping piece continues jumping while more jumps exist (unless crowned), and a blocked side with no legal moves loses.
- **1.6:** Steps were allowed when a jump existed, turns ended after one jump, and blocked sides did not lose.
- **SSO:** Validates forced capture and `jumpFrom` multi-jump continuation and treats a blocked side as losing.
- **Why:** Standard checkers rules prevent stalemates and skipped captures.
- **In the code:** `packages/shared/src/rules/casino/checkers.ts` (`checkersMove`, `loser`, `pieceHasJump`, `sideHasJump`, `sideHasMove`); `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `forced capture and multi-jump: steps are blocked when a jump exists, and jumpFrom restricts to the jumping piece` (packages/shared/tests/casino/checkers.test.ts); `multi-jump keeps the turn on the jumping piece; forced capture blocks steps; blocking a side wins` (packages/server/tests/checkers.test.ts)

### High score points restore the eight dropped skills and ties rank after the tied slot
- **Kind:** Bug fixed
- **What you notice:** The 8 skills formerly dropped from `bioScore` (`Lumberjacking`, `Archery`, `Blessing`, `Musicianship`, `Illusion`, `Punch`, `Fire`, `Wind`) count toward the high-score board, ties rank right after the tied entry, and your own lower score never replaces a higher entry.
- **1.6:** Eight skills were omitted by a typo, ties failed to rank, and blanking your own entry allowed a lower score to overwrite it.
- **SSO:** Sums both `counted` and `lost` skills (`bioScore` plus the 8 formerly dropped skills) for `highScorePoints` and uses `rankHighScore` for tie-friendly ranking.
- **Why:** Reflects full character progression and preserves personal bests.
- **In the code:** `packages/shared/src/rules/casino/casino.ts` (`highScorePoints`, `rankHighScore`); `packages/server/src/systems/casino/slots.ts` (`submitHighScore`)
- **Pinned by:** `the points include bioScore plus the eight formerly dropped skills` and `rankHighScore places ties right after the tied slot and keeps a higher existing score` (packages/shared/tests/casino/casino.test.ts)

### Blackjack wrong-spot text always shows
- **Kind:** Bug fixed
- **What you notice:** Clicking a blackjack table from the wrong tile always tells you to stand beside it.
- **1.6:** Opening any slot panel or blackjack table silenced the wrong-spot message for the rest of the session.
- **SSO:** Always returns the wrong-spot message regardless of prior casino panels.
- **Why:** Players should always get feedback when clicking from an invalid tile.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjSit`)
- **Pinned by:** `the wrong-spot text shows every time, even after opening a table or slot panel` (packages/server/tests/blackjack.test.ts)

### Changing map closes any active casino seat or slot panel
- **Kind:** Bug fixed
- **What you notice:** Warping, respawning, or opening an editor closes any open slot panel, blackjack seat, or checkers seat.
- **1.6:** Casino windows and seats stayed active across map changes and could be played from another map.
- **SSO:** Closes slot panels and leaves blackjack/checkers seats on map change or editor entry, and rejects table actions off-map. Leaving mid-hand this way, including by dying and respawning, forfeits the blackjack stake to the opponent (credited offline if they are in the reconnect grace).
- **Why:** Prevents playing or holding seats from other maps.
- **In the code:** `packages/server/src/systems/casino/index.ts` (`casinoMapChange`); `packages/server/src/systems/casino/blackjack.ts` (`bjTableOf`); `packages/server/src/systems/casino/checkers.ts` (`ckTableOf`, `ckClose`); `packages/server/src/systems/casino/slots.ts` (`slotMapLeave`, `slotPull`); `packages/server/src/systems/world/tick.ts` (`warp`); `packages/server/src/systems/admin/worldedit.ts` (`leaveForEditor`); `packages/client/src/app.ts`
- **Pinned by:** `the slot panel closes on a map change and a pull away from a machine closes it` (packages/server/tests/casino.test.ts); `a map change leaves the blackjack seat, closes the window, and forfeits a mid-hand stake` (packages/server/tests/blackjack.test.ts); `a map change closes the checkers window and frees the seat` (packages/server/tests/checkers.test.ts)

### Checkers start line is sent once to each player
- **Kind:** Bug fixed
- **What you notice:** When a second player joins checkers, both players see the start line once.
- **1.6:** The first player received the start line twice.
- **SSO:** Sends the start line once to each seated player.
- **Why:** Removes duplicate chat output on game start.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckSit`)
- **Pinned by:** `both players see the start line once` (packages/server/tests/checkers.test.ts)

### Black moves first on a checkers rematch
- **Kind:** Bug fixed
- **What you notice:** After a checkers win, the board resets with Black moving first and both players see the start line.
- **1.6:** The loser moved first on the reset board with no start line.
- **SSO:** Resets `turn` to `1` (Black) and sends the start line to both seated players.
- **Why:** Standard checkers rules have Black open every game.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `a capture, then a king, then the win line from the loser to the map` (packages/server/tests/checkers.test.ts)

### A five-card blackjack hand stands automatically
- **Kind:** Bug fixed
- **What you notice:** Drawing a fifth card in blackjack automatically stands your hand.
- **1.6:** A player with five cards could keep pressing Hit with no effect.
- **SSO:** Stands automatically in `bjHit` once `hand.length >= BJ_HAND_SIZE`.
- **Why:** Avoids a dead-end state where Hit does nothing.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjHit`)
- **Pinned by:** `a five-card hand stands automatically and cannot hit again` (packages/server/tests/blackjack.test.ts)

### A slot pull without 5 gold keeps the panel open
- **Kind:** Bug fixed
- **What you notice:** Pulling the slot lever with under 5 gold returns the lever and prints the message while leaving the panel open.
- **1.6:** The panel closed before printing the not-enough-gold message.
- **SSO:** Emits `slotResult` with `reels: null` and `SLOT_TEXT.poor` while keeping `p.slot` open.
- **Why:** Consistent with mid-spin insufficient gold handling.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`)
- **Pinned by:** `a short slot pull returns the lever and prints the gold line without closing the panel` (packages/server/tests/casino.test.ts)

### Slot pulls require standing in front of a machine
- **Kind:** Bug fixed
- **What you notice:** Pulling the lever when no longer in front of a slot machine closes the panel.
- **1.6:** `slotPull` did not check position, allowing pulls from anywhere.
- **SSO:** Verifies `slotOpenCheck` against a slot machine on `room.map` during `slotPull` and closes the panel if not in front of one.
- **Why:** Prevents remote slot pulls after moving or warping.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`)
- **Pinned by:** `the slot panel closes on a map change and a pull away from a machine closes it` (packages/server/tests/casino.test.ts)

### Any item containing "Slot Machine" plays
- **Kind:** Bug fixed
- **What you notice:** Variant names like `"Slot Machine 2"` open and play when clicked or activated with Ctrl.
- **1.6:** Routing matched `"Slot Machine"` by substring, but `slotOpen` required an exact name match.
- **SSO:** Click routing (`clickGate`) and Ctrl routing (`ctrlGate`) match `"Slot Machine"` by substring, and `slotOpen`/`slotPull` use `isSlotMachine` (`lingoContains`) to match the same items.
- **Why:** Aligns the handler with click/Ctrl routing.
- **In the code:** `packages/shared/src/rules/casino/casino.ts` (`isSlotMachine`); `packages/server/src/systems/casino/slots.ts` (`slotOpen`, `slotPull`)
- **Pinned by:** `any item containing 'Slot Machine' opens and plays, including 'Slot Machine 2'` (packages/server/tests/casino.test.ts)

## chat

### Server-formatted chat and server-managed channels
- **Kind:** Exploit closed
- **What you notice:** Chat names and channel membership come from the server; an ignored player's messages are filtered for the reader.
- **1.6:** Clients built their own “X says …” text and could join administrator, guild and faction groups by hand.
- **SSO:** The server stamps the speaker and controls faction, guild and room membership. Each reader's ignore list filters what the ignored player's client sent in 1.6: say, `/me`, admin lines, broadcasts, IMs, guild chat, the Overlord line, Radar and Inxition read-outs, and faction announcements. It also filters NPC replies relayed by that player, including quest slots 2–4, treasure rumours, faction-leader replies and their shop's stock list.
- **Why:** Client-supplied names and group joins allowed impersonation and eavesdropping.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/chat/rooms.ts` (`enterRoom`), `packages/server/src/systems/chat/ignore.ts` (`hears`)

### Chat rate limits
- **Kind:** Exploit closed
- **What you notice:** Repeated chat, IM, room, mail and board actions may be refused temporarily, with remaining time shown and the original input retained where applicable.
- **1.6:** Broadcasting had no cooldown because registration was forced on, and there was no flood control. A refused broadcast remained typed.
- **SSO:** Everyone uses the original unregistered broadcast cooldown of 1,000 frames (50 seconds) and its refusal. Local chat, `/me`, guild chat, IM, room lines, mail sends and board posts share a new 60-frame (3-second) cooldown. A refusal says “You cannot chat yet - N seconds remaining.” with seconds rounded up. Refused chat, IM and room text returns to its input; refused mail and board text stays open. A player-shop command is never said aloud, so it costs no cooldown and runs under one. Away replies do not use the cooldown. Lines are capped at 200 characters, there is no profanity filter, and all limits are operator settings.
- **Why:** Spam harms players and the server.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/chat/im.ts` (`imIntent`)
- **Pinned by:** `bug fixed: a command costs no chat cooldown and runs under one` (packages/server/tests/playershop-db.test.ts); `divergence: it shares the chat cooldown` (packages/server/tests/guilds.test.ts); `divergence: it shares the chat cooldown; a refused line goes back` and `divergence: room lines share the chat cooldown, refused back into the room's input` (packages/server/tests/im.test.ts)

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
- **SSO:** The account's ignore list holds at most 100 entries, and every entry filters chat, broadcasts and IMs.
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

### /help looks up the whole topic
- **Kind:** Bug fixed
- **What you notice:** `/help basic commands` shows the Basic Commands file, and `/help` with no topic still shows Help.
- **1.6:** Only the second word after `/help` was looked up, so six of the seventeen shipped help files, whose topics have two words, could not be reached. SSO did the same.
- **SSO:** The whole rest of the line is the topic, with surrounding spaces trimmed; no topic means “Help”.
- **Why:** The shipped two-word help files should be reachable by their own names.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`), `packages/server/src/systems/chat/chat.ts` (`helpReply`)
- **Pinned by:** `/help: the whole topic, 'Help' when absent, any case` (packages/shared/tests/chat/chat.test.ts); `the whole topic is sent, so two-word topics have help` (packages/server/tests/chat.test.ts); `/help topics, a missing topic, and a two-word topic` (packages/server/e2e/chat-and-presence.test.ts); `all 17 files are reachable by their full topic name, one word or two` (packages/data/tests/data.test.ts)

### Closing an IM window frees its slot
- **Kind:** Bug fixed
- **What you notice:** Closing an IM window ends that conversation. The next IM from anyone takes the freed slot and starts with an empty window; a random window is replaced only when all ten are open.
- **1.6:** Closing a window kept its sender and text in the slot, so the next IM from that sender reopened the old conversation. An eleventh sender took a random window and wiped it even when another window had been closed.
- **SSO:** The window frees its slot when it closes. `pickImSlot` then finds the lowest free slot, and the reopened window clears its field and log.
- **Why:** Closing a conversation should not keep it alive or make the next sender overwrite an unrelated one.
- **In the code:** `packages/client/src/ui/im.ts` (`createImWindows`), `packages/shared/src/rules/chat/im.ts` (`pickImSlot`)
- **Pinned by:** `closing frees the slot; the next IM in it starts with a clean window`, `closing a slot makes a later sender reuse it instead of taking random(10)`, and `with all ten slots held, the 11th sender takes random(10) and clears it` (packages/client/tests/im.test.ts); `with every slot held, the 11th sender takes random(10) and clears it` (packages/shared/tests/chat/im.test.ts)

### /ignore keeps one entry and /unignore removes every copy
- **Kind:** Bug fixed
- **What you notice:** Ignoring the same name again, in any case, leaves one entry. Unignoring a name removes every copy at once.
- **1.6:** `/ignore` appended whatever was typed, duplicates included. `/unignore` stepped forward through the list and skipped the line that moved into each deleted position, so of two adjacent copies one survived. SSO did the same on the stored list.
- **SSO:** `/ignore` adds a name only when it is not already present, compared without case, and `/unignore` filters out all matching entries.
- **Why:** Duplicates fill the 100-entry cap, and an unignore that leaves a copy looks broken.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`ignoreAdd`, `ignoreRemove`)
- **Pinned by:** `add keeps one entry, ignoring case, and accepts the empty name once`, `a duplicate is still accepted when the list is full and does not grow it` and `unignore removes every matching copy, adjacent or apart` (packages/shared/tests/chat/im.test.ts); `the texts and the stored list, shared by the account's characters` (packages/server/tests/im.test.ts)

### Every ignore-list entry filters chat and IMs
- **Kind:** Bug fixed
- **What you notice:** A name anywhere on the ignore list silences that player's chat, broadcasts and instant messages, up to the 100-entry cap.
- **1.6:** Only lines 1–50 filtered `sqa` lines and broadcasts, and only lines 1–40 filtered IMs, so later entries did nothing. SSO did the same.
- **SSO:** Every entry on the list is checked for every delivery path; the list is still capped at 100.
- **Why:** An entry the game accepts should work, and `/unignore` already reached line 100.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`ignores`), `packages/server/src/systems/chat/ignore.ts` (`hears`)
- **Pinned by:** `every entry counts, not just the first 50 for chat or 40 for IMs` (packages/shared/tests/chat/im.test.ts); `an entry past the first 50 still blocks chat` and `an entry past the first 40 still blocks IMs` (packages/server/tests/im.test.ts)

### Guild Chat with no guild keeps your current room
- **Kind:** Bug fixed
- **What you notice:** Choosing Guild Chat without a guild says “You don't belong to a guild!” and leaves you in the room you were already in, still hearing and sending its lines.
- **1.6:** The old room was left before the guild check, so the refusal ejected you and the room window stayed up while your later lines went nowhere. SSO did the same.
- **SSO:** The guild check runs before `leaveRoom`; with no guild the membership and the other members' rosters are untouched.
- **Why:** Refusing one room should not remove you from another.
- **In the code:** `packages/server/src/systems/chat/rooms.ts` (`enterRoom`)
- **Pinned by:** `Guild Chat with no guild says so but leaves your current room alone` (packages/server/tests/im.test.ts)

### An away message of "off" or an empty one turns away off
- **Kind:** Bug fixed
- **What you notice:** Setting the away text to “off” in any case, or to nothing, prints the OFF line, stores no away message and answers no IM.
- **1.6:** Away answered whenever the text was anything other than “OFF” ignoring case, so “off” printed ON but answered nothing, and an empty text answered every IM with an empty message. SSO did the same.
- **SSO:** `setAway` applies the chat length limit first. `awayAnswers` then treats null, empty and “OFF” as off; `setAway` stores null and prints the OFF line for those.
- **Why:** The ON/OFF line and the actual away state should agree, and an empty auto-reply is noise.
- **In the code:** `packages/shared/src/rules/chat/im.ts` (`awayAnswers`), `packages/server/src/systems/chat/im.ts` (`setAway`)
- **Pinned by:** `an away text of off (any case) or an empty one is off` (packages/shared/tests/chat/im.test.ts); `OFF in any case or an empty text turns away off instead of answering` and `the chat limit is applied before the off test` (packages/server/tests/im.test.ts)

### /me follows the house rule, and guild chat honours ignore lists
- **Kind:** Bug fixed
- **What you notice:** On the lower rows of a house, `/me` is refused just like plain talk. A guild member who ignores the speaker no longer hears that speaker's `/g` lines.
- **1.6:** The house rule applied only to plain talk, so `/me` still went through, and guild chat never consulted ignore lists. SSO did the same.
- **SSO:** `handleChat` applies the house rule to both say and `/me`. A player's `/g` line is filtered by each reader's ignore list; the guild system's own lines are not.
- **Why:** Talking restrictions and ignore choices should not be bypassed by another chat route.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/social/guilds.ts` (`guildChat`)
- **Pinned by:** `in a house at y > 10 neither talk nor /me goes, and neither starts the cooldown` (packages/server/tests/chat.test.ts); `guild chat is filtered by each member's ignore list` (packages/server/tests/guilds.test.ts)

### A broadcast cooldown covers its whole 1000 frames
- **Kind:** Bug fixed
- **What you notice:** A broadcast is refused for the full 50 seconds; the last fraction of a second no longer lets a shout through.
- **1.6:** The remaining time was rounded down to whole seconds, so with 1–19 frames left it read 0 and the broadcast went through. 1.6 never showed this because its cooldown was cleared for registered players; SSO applied the cooldown, making its effective length 981 frames.
- **SSO:** Seconds round up, so any positive remainder refuses and the broadcast waits the full 1,000 frames.
- **Why:** The configured cooldown should be the actual cooldown.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`broadcastRefusal`)
- **Pinned by:** `broadcast: seconds round up, so any positive remainder refuses` (packages/shared/tests/chat/chat.test.ts); `the full 1000-frame cooldown applies, including its last 19 frames` (packages/server/tests/chat.test.ts); `a broadcast reaches everyone in yellow; the next waits 1000 frames` (packages/server/e2e/chat-and-presence.test.ts)

### A line of only spaces sends nothing
- **Kind:** Bug fixed
- **What you notice:** Pressing Enter on spaces sends no chat line, and no one sees `Bob says ""`.
- **1.6:** It stripped the spaces but still sent the line with an empty quote. SSO did the same.
- **SSO:** A local-chat line that is empty after whitespace is dropped and does not start the chat cooldown.
- **Why:** An empty quote is noise and costs the sender a cooldown.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`, `formatSay`)
- **Pinned by:** `a line of only spaces sends nothing` (packages/shared/tests/chat/chat.test.ts); `a line of only spaces sends nothing and starts no cooldown` (packages/server/tests/chat.test.ts)

### Password= removes every forbidden character
- **Kind:** Bug fixed
- **What you notice:** Spaces, slashes, colons and backslashes are all removed from a new password, including adjacent ones and one at the start: `Password= a  b` becomes `ab`.
- **1.6:** Four forward stripping passes skipped the character that slid into place after each deletion, so one of two adjacent forbidden characters survived. SSO ran the same passes.
- **SSO:** `passwordFrom` removes every space, `/`, `:` and `\` from the password text.
- **Why:** The stored password should match the sanitised password the player is told about, without a hidden leftover character.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`passwordFrom`)
- **Pinned by:** `Password= strips every space, slash, colon and backslash` (packages/shared/tests/chat/chat.test.ts); `Password= removes adjacent and leading forbidden characters` (packages/server/tests/password-db.test.ts)

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

### HP and SP bars fill by percentage with hover text
- **Kind:** Other
- **What you notice:** Each HP and SP bar fills its wooden slot from left to right. Full HP or SP fills the slot even when the maximum is 20, and losing half the points leaves half the bar. Hovering a bar shows `current / max` centred on it; otherwise the bar has no number.
- **1.6:** The bar loader slid fixed 205-px track and fill sprites leftward from the stage's right edge using the raw value, capped at 200. A character with 20 maximum HP showed only a short bar at full health, while one with 1000 maximum HP filled the slot. The right-aligned number also disappeared past the stage's right edge at 1 HP/SP and spilled left of the cutout above 200.
- **SSO:** The HP and SP tracks stay in the 189-px transparent slot of Internal #186 (stage x 600-789) and the fills grow from its left edge by `value / max`, with no 200 cap; the original 205-px fill art is clipped to the slot, and the depleted part of the slot is plain black instead of 1.6's darker red and blue track sprites. The text is a centred `current / max` field shown only while that bar is hovered, so it cannot leave the cutout. The power bar keeps 1.6's sliding behaviour.
- **Why:** A bar's length should show how much of the stat remains, not how large the stat's maximum happens to be.
- **In the code:** `packages/client/src/ui/bars.ts` (`createBars`, `setVitals`), `packages/client/src/styles.css` (`.bar-track`, `.bar-fill`, `.bar-hover`, `.bar-value`), `packages/client/src/ui/shells.ts` (`createGameView`)
- **Pinned by:** `HP and SP fill the wooden slot left to right by percentage; the text reads current / max`; `a full bar is full at any maximum, and values above 200 are not capped`; `each bar's text field sits in that bar's own hover zone` (packages/client/tests/combat.test.ts)

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
- **SSO:** The server lists qualifying walkable tiles that are not arena tiles and not taken by a player, monster or blocking item, and picks one with the seeded RNG. With none, it handles quit and death as described above.
- **Why:** A shared server cannot keep a hang; direct selection also avoids the former capped roll loop returning an invalid tile.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`arenaExits`, `pickArenaExit`), `packages/server/src/systems/combat/arena.ts` (`quitArena`)
- **Pinned by:** `divergence: with no passing tile quit says nothing and stays put`; `divergence: an arena death with no passing tile keeps the player in place, at HP and SP 1, and says the line` (packages/server/tests/arena.test.ts); `divergence: no passing tile → null, where 1.6's exit loop never ended` (packages/shared/tests/combat/arena.test.ts)

### "You cannot fight here!" is said once per press
- **Kind:** Bug fixed
- **What you notice:** Holding attack on a map where fighting is not allowed says "You cannot fight here!" once. Releasing and pressing again says it again.
- **1.6:** The line was sent on every frame the key was held, so SSO's chat showed one line with a climbing ×N count.
- **SSO:** `pollAttack` records the refusal in `attackRefused` and says it only once until the key is released or pressed again (`setAttackHeld`).
- **Why:** A message repeated thirty times a second is noise, not information.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`, `setAttackHeld`)
- **Pinned by:** `bug fixed: off an arena tile on a no-fight map, a held key says it once per press` (packages/server/tests/monsters.test.ts)

### Hold stops attacks as well as steps
- **Kind:** Bug fixed
- **What you notice:** While a Hold spell roots you, you can neither walk nor swing. A key held through the Hold swings once the Hold ends.
- **1.6:** The attack key was polled before the Hold gate, so a held player could still swing.
- **SSO:** `pollAttack` returns before the swing while the Hold counter runs, and the browser's swing prediction agrees.
- **Why:** Hold is meant to pin the target in place; swinging freely undid most of its point.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`); `packages/client/src/model.ts` (`predictSwing`)
- **Pinned by:** `bug fixed: Hold stops attacking as well as walking` (packages/server/tests/melee.test.ts)

### Axe and Mining Hammer speeds follow their skill ladders
- **Kind:** Bug fixed
- **What you notice:** An axe swings slowly at low Axe Fighting and speeds up as it rises: 25 frames below 10, 22 at 10-19, and so on to 15 at 80-89, then the normal 14 (10 with the Ring of Quickness) from 90. A Mining Hammer swings every 15 frames below Mining 10 and one frame faster per 10 skill, down to 7 frames from Mining 80 on.
- **1.6:** Both ladders were tested from low to high with the last matching step winning, so every axe user below 90 got 15 frames and every hammer user below 90 got 7, and a hammer at 90 and above fell back to the normal 14.
- **SSO:** `swingCooldowns` takes the first matching step of each ladder, and the hammer keeps its fastest step from Mining 80 on.
- **Why:** The ladders were plainly written to reward skill; the order made the skill irrelevant and slowed the best miners down.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`swingCooldowns`, `ladderStep`)
- **Pinned by:** `bug fixed: the axe ladder slows low Axe Fighting, 25 frames at 0 down to 15 at 80-89`; `bug fixed: a Mining Hammer speeds up with Mining, 15 frames at 0 down to 7 from 80`; `Ring of Quickness sets 10/10 before the axe ladder` (packages/shared/tests/combat/combat.test.ts)

### The Ring of Quickness speeds up a fishing pole
- **Kind:** Bug fixed
- **What you notice:** A Fishing Pole waits 20 frames between casts, or 16 with the Ring of Quickness.
- **1.6:** The pole's 20 frames were set after the ring's speed-up and overwrote it.
- **SSO:** `swingCooldowns` takes the ring's 4-frame speed-up off the pole's 20, and the cast in `preSwing` uses that delay.
- **Why:** The ring promises quicker swings with any weapon.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`swingCooldowns`); `packages/server/src/systems/crafting/gather.ts` (`preSwing`)
- **Pinned by:** `bug fixed: the Ring of Quickness shortens a fishing pole's 20 frames to 16` (packages/shared/tests/combat/combat.test.ts); `bug fixed: the Ring of Quickness shortens a cast's AtDelay from 20 to 16` (packages/server/tests/gather.test.ts)

### A held attack swings at the cooldown's own pace
- **Kind:** Bug fixed
- **What you notice:** Holding attack swings every 14 frames by default (10 with the Ring of Quickness), matching the cooldown. The power bar's tiers also arrive a frame sooner.
- **1.6:** The frame script re-armed the attack before counting the delay down, so a held key swung every cooldown plus one frames.
- **SSO:** `tickAttackTimers` counts the delay down first and re-arms on the frame it reaches 0. The browser runs the same function.
- **Why:** The cooldown number should be the actual wait.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`tickAttackTimers`)
- **Pinned by:** `bug fixed: holding attack swings every AtDelay = 14 frames, not 15`; `tiers come from the member windows: +0 until t+38, +3, +5 from t+63, +7 from t+88` (packages/shared/tests/combat/combat.test.ts)

### Big monsters can be hit on any of their tiles
- **Kind:** Bug fixed
- **What you notice:** The Overlord and the Mutant Worm can be hit on any of their six tiles, including one under your own feet.
- **1.6:** The extra tiles were tested against the faced tile only, so a big monster whose extra tile was under you was missed.
- **SSO:** `meleeReaches` tests every tile of the footprint against both your tile and the faced tile.
- **Why:** If you are standing in the monster, your swing should reach it.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`meleeReaches`, `FOOTPRINT_CELLS`)
- **Pinned by:** `bug fixed: the 3x2 footprint is tested on my own tile as well as the faced tile` (packages/shared/tests/combat/combat.test.ts)

### A bow without arrows or crystals refuses the shot
- **Kind:** Bug fixed
- **What you notice:** Swinging a bow with no arrows says "You don't have any arrows!"; with arrows but no crystal of their colour it says "You don't have any <colour> crystals left!". Either way nothing else happens: no swing, no cooldown, and your power bar keeps its charge. The line is said once per press.
- **1.6:** With no arrows the bow meleed for 1. With no crystal the swing was wasted: the cooldown ran, the power bar reset and you left combat.
- **SSO:** `bowRefusal` is checked in `workAttack` before `startSwing`; the browser's prediction makes the same check.
- **Why:** Running out of ammunition should stop the shot, not cost you a swing or turn the bow into a stick.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`bowRefusal`, `NO_ARROWS_TEXT`); `packages/server/src/systems/combat/melee.ts` (`workAttack`); `packages/client/src/model.ts` (`predictSwing`)
- **Pinned by:** `bug fixed: a bow with no arrows, or no crystal for them, is refused before the swing` (packages/shared/tests/combat/combat.test.ts); `bug fixed: a bow with no arrows is refused once per press, with no cooldown`; `bug fixed: a bow with arrows but no crystal is refused before the swing, keeping the bar`; `an off-hand that only contains "Arrows" counts as no arrows` (packages/server/tests/melee.test.ts)

### A stepping player is hit on the tile they are leaving
- **Kind:** Bug fixed
- **What you notice:** A player part-way through a step can be hit on the tile they just left, and a swing never hits a player who is nowhere near it.
- **1.6:** The old-tile test read the victim's old Y twice and compared it with both coordinates of the faced tile.
- **SSO:** `pvpSwing` compares the faced tile with the victim's real previous tile.
- **Why:** The test was meant to catch a victim still visibly on their old tile.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pvpSwing`)
- **Pinned by:** `bug fixed: a victim part-way through a step is hit on the tile it is leaving`; `bug fixed: a swing at (4,4) no longer hits a victim stepping from (9,4)` (packages/server/tests/melee.test.ts)

### Parry and block work from the first skill point
- **Kind:** Bug fixed
- **What you notice:** Against monsters, a new character parries or blocks about 1 hit in 90 until the skill passes 20, as against players. Against players, Block 0 can block, and the Adventurer's bonus raises the odds against players as much as against monsters. This is a large PvP balance shift: an Adventurer with Parry and Block above 96 avoids about 57% of player hits, against about 9% in 1.6.
- **1.6:** Against monsters the draws were out of 3000 until the skill was over 10. Against players Block had no starting draw, so Block 0 never blocked, and the Adventurer's subtraction re-rolled a result below 1 as a fresh draw out of 90 instead of clamping it to 1.
- **SSO:** `dodgeRoll` starts from `random(90)`. `pvpDodgeRoll` gives parry and block the same starting draw and clamps the Adventurer's result to 1.
- **Why:** The ladders were meant to start from a small chance, not none, and the faction bonus was meant to help in both fights.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`dodgeRoll`); `packages/shared/src/rules/combat/armour.ts` (`pvpDodgeRoll`)
- **Pinned by:** `bug fixed: parry and block start from random(90), not random(3000)` (packages/shared/tests/combat/combat.test.ts); `bug fixed: the faction-3 parry/block bonus clamps a draw pushed below 1 to 1 in PvP, as against monsters`; `bug fixed: PvP Block 0 can block`; `PvP parry: base random(90), then one draw per threshold passed` (packages/shared/tests/inventory/inventory.test.ts)

### A swing that hits a monster also hits players
- **Kind:** Bug fixed
- **What you notice:** A melee swing hurts a player on the tile even if it also hits a monster.
- **1.6:** The monster damage added to the Attack message left a field other players read as an arrow shot, so they skipped the player-hit check.
- **SSO:** `workAttack` always runs `pvpSwing` for a melee swing.
- **Why:** The message format, not a game rule, decided the outcome.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`, `pvpSwing`)
- **Pinned by:** `bug fixed: a swing that also hits a monster still hurts a player on the tile` (packages/server/tests/inventory.test.ts)

### Holy Shield decides before the dodge rolls
- **Kind:** Bug fixed
- **What you notice:** An innocent standing on a Holy Shield gets "Shield" straight away; no parry or block dice are thrown away first.
- **1.6:** The shield check came after the parry and block draws in both hit handlers.
- **SSO:** `pvpHit` and `monsterHitsPlayer` return "Shield" before any draw.
- **Why:** Spent draws changed the luck of every later roll for nothing.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`pvpHit`); `packages/shared/src/rules/combat/combat.ts` (`monsterHitsPlayer`)
- **Pinned by:** `bug fixed: an innocent on a Holy Shield gets Shield before any draw` (packages/shared/tests/combat/combat.test.ts); `bug fixed: a Holy Shield gives Shield in PvP before any draw` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: an innocent on a Holy Shield's exact spot gets Shield before any parry or block draw` (packages/server/tests/spells.test.ts)

### The green crystal message is spelt right
- **Kind:** Bug fixed
- **What you notice:** A bow with Green Arrows and no green crystal says "You don't have any green crystals left!"
- **1.6:** The text said "geen".
- **SSO:** `outOfCrystalsText` spells every colour from its name.
- **Why:** A typo.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`outOfCrystalsText`)
- **Pinned by:** `bug fixed: "green crystals", not "geen"` (packages/shared/tests/inventory/inventory.test.ts)

### A negative defense bonus adds damage
- **Kind:** Bug fixed
- **What you notice:** A negative defense bonus makes you take more damage.
- **1.6:** A negative bonus was added to the attack power, which made it smaller.
- **SSO:** `randomAndDefense` subtracts the bonus whatever its sign.
- **Why:** The sign should mean what it says.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`randomAndDefense`)
- **Pinned by:** `bug fixed: a negative DefenseBonus adds damage` (packages/shared/tests/combat/combat.test.ts)

### Ice and fire armour change the hit points you lose
- **Kind:** Bug fixed
- **What you notice:** Elemental armour against the Yeti, Snow Serpent, Snow Demon or Fire Demon changes the hit points you lose, and the floating number shows that amount.
- **1.6:** The hit points were taken off first; the Ice and Fire modifiers only changed the number shown.
- **SSO:** `monsterHitsPlayer` applies the elemental rows after the armour rows, as the player hit does, before the loss.
- **Why:** The armour was meant to protect, and the number shown should be the damage taken.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`monsterHitsPlayer`); `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`)
- **Pinned by:** `bug fixed: ice armour against a Yeti cuts the hit points lost` (packages/shared/tests/combat/combat.test.ts)

### The armour-break exclusions work
- **Kind:** Bug fixed
- **What you notice:** The Slime, Wolf, Imp, Cow, Pig, Shark, Squid, Dragon Snake and Fire Demon never break your armour.
- **1.6:** The exclusion list held bare names but was handed "a <name>", so nothing ever matched.
- **SSO:** `rollArmourBreak` drops the "a " before testing the list.
- **Why:** The list was written so these monsters would not break armour; it had no effect only because of the name mismatch.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`rollArmourBreak`)
- **Pinned by:** `bug fixed: the armour exclusion list matches "a <name>"` (packages/shared/tests/inventory/inventory.test.ts)

### Immortals take no damage from players
- **Kind:** Bug fixed
- **What you notice:** Another player's swing does nothing to an immortal, just as monsters do nothing.
- **1.6:** The monster hit handler exited for immortals; the player-versus-player one had no such check.
- **SSO:** `pvpSwing` skips immortal victims.
- **Why:** Immortality should be the same against everyone.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pvpSwing`)
- **Pinned by:** `bug fixed: immortals take no PvP damage` (packages/server/tests/inventory.test.ts); `immortals take no monster damage` (packages/server/tests/monsters.test.ts)

### Weapon attack power matches the right weapons
- **Kind:** Bug fixed
- **What you notice:** A book no longer hits like a Bo, a Mining Hammer hits for its own 2 to 5 base, Archery below 30 sets the bow's power by your own step (and 30 gets the +1 that 31 used to), and the Gold Sword's Heavy Arms bonus is counted once (+6 at 100).
- **1.6:** The Bo's row matched any name containing "Bo", the hammer's row was spelt "Minng Hammer", the three Archery resets all applied below 10 (the last winning) with nothing at exactly 30, and the Gold Sword had two Heavy Arms blocks.
- **SSO:** The Bo's base row is an exact match, which `attackPower` honours; the hammer's row is spelt right; the Archery tiers are ranges with the first add at 30; the duplicate Gold Sword block is gone.
- **Why:** Each was a slip in the table, not a design.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`attackPower`, `tierApplies`); `packages/data/content/attpower.json`
- **Pinned by:** `bug fixed: the "Bo" row matches only the Bo, not books and bows`; `bug fixed: a Mining Hammer rolls its base row 2 + random(3)`; `bug fixed: the Archery tiers are steps, and Archery 30 gets its +1`; `bug fixed: Gold Sword's HeavyArms block runs once: +6 at HeavyArms 100` (packages/shared/tests/combat/combat.test.ts)

### Arena tiles wait for the re-arm like any swing
- **Kind:** Bug fixed
- **What you notice:** On a no-fight map, holding attack on an arena tile swings at the same pace as on a fight map, and the power bar resets after each swing.
- **1.6:** The arena-tile branch swung without checking that you were ready, on the frame the cooldown reached 0 and before the bar block ran, so every swing repeated the last bar tier.
- **SSO:** `pollAttack` requires the attack to be armed on an arena tile too.
- **Why:** An arena should not let a held key keep a full power bar.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`, `onArenaTile`)
- **Pinned by:** `bug fixed: on a no-fight map an arena tile waits for the re-arm like any swing` (packages/server/tests/monsters.test.ts)

### An arena is any map with a 6P tile on layer 1
- **Kind:** Bug fixed
- **What you notice:** A map counts as an arena when it has an arena tile anywhere on layer 1, including the first and last columns and rows 10 to 12. Standing on such a tile is an arena tile, and a death there is an arena death. A `6P` on another layer, or "6P" written in a sign or the title, does not make an arena.
- **1.6:** The challenge searched the raw map record for " 6P " with spaces around it, which missed a tile at either end of a row and accepted one on another layer, in a sign or in the title, which the challenge could then never find. The tile test read another field of the map record for rows 10 to 12, so those were never arena tiles.
- **SSO:** `hasArena` and `isArenaTile` read layer 1's 12 rows with `layer1Tile`.
- **Why:** The check and the search must agree on what an arena tile is.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`hasArena`, `isArenaTile`, `arenaTiles`)
- **Pinned by:** `bug fixed: a 6P only in column 1 or 17 is an arena`; `bug fixed: a 6P on another layer, or 6P in a sign or title, is not an arena`; `bug fixed: arena tiles on rows 10-12 are arena tiles` (packages/shared/tests/combat/arena.test.ts); `bug fixed: arena tiles on rows 10-12 are arena tiles` (packages/server/tests/monsters.test.ts)

### A challenge always lands on a free arena tile or says why not
- **Kind:** Bug fixed
- **What you notice:** A challenge on an arena always puts you on one of its tiles, never one another player, a monster or a blocking item already holds. If every arena tile is taken it says "There is no room in the arena!". Quitting, or dying in the arena, never puts you on another player's tile either.
- **1.6:** The challenge made 799 random tries over the whole 17 × 12 record and gave up silently when none landed on an arena tile (about 2% of the time with one tile). Neither the challenge nor the exit checked who stood on the tile.
- **SSO:** `findArenaTile` picks uniformly among the free arena tiles with one roll; `pickArenaExit` skips taken tiles. `arenaTileTaken` answers for players, monsters and blocking ground items.
- **Why:** A silent failure looks like a broken command, and two players on one tile is not a fair fight.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`findArenaTile`, `pickArenaExit`); `packages/server/src/systems/combat/arena.ts` (`challenge`, `quitArena`, `arenaTileTaken`); `packages/server/src/systems/progression/vitals.ts` (`checkDeath`)
- **Pinned by:** `bug fixed: one uniform roll over the 6P tiles, never a silent miss`; `bug fixed: a taken tile is never picked; every tile taken gives null` (packages/shared/tests/combat/arena.test.ts); `bug fixed: a challenge never puts you on a tile a player or a blocking item holds`; `bug fixed: quit never puts you on another player's tile` (packages/server/tests/arena.test.ts)

### Hold and the death wait stop the arena words
- **Kind:** Bug fixed
- **What you notice:** A Held player who types `Challenge` or `quit` is told "You cannot do that while you are held." A player waiting to respawn is ignored.
- **1.6:** The arena commands tested only whether you were mid-step, so a Held player could quit out of the Hold and a dead one could challenge.
- **SSO:** `challengeCheck` and `quitCheck` refuse while Held or dead.
- **Why:** Typing a word should not escape a Hold or a death.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`challengeCheck`, `quitCheck`); `packages/server/src/systems/combat/arena.ts` (`challenge`, `quitArena`)
- **Pinned by:** `bug fixed: Hold and the death wait stop the arena words` (packages/shared/tests/combat/arena.test.ts); `bug fixed: Hold and the death wait stop the arena words` (packages/server/tests/arena.test.ts)

### A monster's loot drops where it is drawn
- **Kind:** Bug fixed
- **What you notice:** A monster killed while stepping drops its loot on the tile it is drawn nearest: the tile it is leaving for the first half of the step, the one it is entering after that.
- **1.6:** The drop used the step's destination from the moment the step began.
- **SSO:** `monsterDrawnTile` picks the tile for melee and spell kills.
- **Why:** Loot should appear where you saw the monster die.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`monsterDrawnTile`); `packages/server/src/systems/combat/melee.ts` (`smash`); `packages/server/src/systems/spells/collide.ts` (`checkForDead`)
- **Pinned by:** `bug fixed: loot lands on the tile the monster is drawn nearest` (packages/server/tests/inventory.test.ts)

### Every death in a Lightning game is penalty-free
- **Kind:** Bug fixed
- **What you notice:** During a Lightning game no death takes the drop, the head, the stat penalty or exile, whether it came from a melee hit, an arrow, a spell or a monster.
- **1.6:** Only the melee hit checked for a Lightning game.
- **SSO:** `checkDeath` runs the penalty-free death for any death while `lightningGame` is set.
- **Why:** The game announces that all death penalties are off.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`); `packages/server/src/systems/world/tick.ts`
- **Pinned by:** `bug fixed: during a Lightning game every death is penalty-free, not only a melee hit`; `outside a Lightning game the same death takes every penalty` (packages/server/tests/assassin.test.ts)

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
- **SSO:** `/BanIP` and `/unbanIP` work and are immortal-only. A banned address is refused before the password check with the original unshown “You are banned from playing on this server.”; existing sessions are not kicked. The address comes from the socket, or from the nth rightmost `X-Forwarded-For` entry when the operator configures `SSO_PROXY_HOPS=n` for n trusted proxies. The nearest proxy appends the rightmost entry; a client can forge entries farther left. The former `trustForwardedFor` setting is removed. `/IPlookup` is restricted to moderators and immortals.
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
- **What you notice:** The title screen is a remade red-curtain backdrop with a Second Star Online logo, offering only Load Character and New Character, with a footer naming the original First Star Online 1.6 by unFun Games; those two choices work, and login and creation messages appear in an in-page box with OK.
- **1.6:** Exit quit the Windows projector, Server Editor opened a server-address entry and Game Setup opened local preferences; frame 10 showed an advert for the original website. Login and creation messages were Windows alerts with an OS beep. Credits were unreachable; the post-creation frames referenced a missing Story member and showed nothing before returning to the title.
- **SSO:** The title shows only Load Character and New Character; Game Setup, Exit, Server Editor and the advert are not offered, and the unFun Games credits and version line are replaced by a footer crediting the original. Sound is controlled in the in-game menu. A page connects to the server that served it, so the server picker has no screen. Messages use the original text in an in-page OK box without the alert beep. The unreachable credits, unavailable post-creation movie and unreachable later frames are omitted.
- **Why:** A browser page cannot quit or launch local tools, the advertised site no longer exists, the remake carries its own name while crediting the game it recreates, and native browser alerts block the page and vary by browser.
- **In the code:** `packages/client/src/ui/screens.ts` (`titleScreen`), `packages/client/src/ui/alert.ts` (`showAlert`), `packages/client/src/app.ts` (`runApp`)

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

### The chat entry sits in the chat frame's lower well
- **Kind:** Platform
- **What you notice:** The chat input's text sits inside the frame's lower field with equal padding on both sides and a little extra room from the left frame edge.
- **1.6:** The score put `sendchat` at (20, 560) as a 756×20 field, and Director drew its text from the field's top margin.
- **SSO:** The input box spans x 21–781 and y 556–576 inside the lower well of Internal #191/#186 (its interior is x 18–780, y 554–573). A browser input centres its single line and adds about 3 px at its inline start, so a matching 3 px right inset keeps the text margin equal on both sides; a 3 px extra left inset gives the text more room from the frame. The box starts 2 px below the well's top so the glyphs sit optically level in the field.
- **Why:** Using the score's text rect put the browser's centred line below the well and its padding to the right, so the entry text did not line up with the frame. The user requested the alignment, then the 2 px downward nudge, equal side insets, and a little more left margin.
- **In the code:** `packages/client/src/ui/shells.ts` (`createGameView`)
- **Pinned by:** `the stage puts the playfield and chat at their rects (frame 63)` (packages/client/tests/shells.test.ts)

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

### Stats icons centred on their rows and evenly spaced
- **Kind:** Platform
- **What you notice:** The gold and stat icons line up with their labels and values, and every row has the same spacing.
- **1.6:** The six icons were one 24×177 cast-member bitmap drawn at its registration point at [635, 124]. Its glyphs were unevenly spaced, with row centres near y 131, 161, 195, 228, 261 and 291 on the stage, so the icons kept their own spacing rather than the text's.
- **SSO:** The bitmap's glyphs are clipped apart and each icon is centered on its row. Gold and the five stats share a 30-pixel row grid, with icon centres at y 133.5, 163.5, 193.5, 223.5, 253.5 and 283.5; the label and value fields start on the same rows.
- **Why:** The user requested the icons centered with their text and evenly spaced. The strip's baked-in spacing did not match the 30-pixel text grid, so each icon drifted a little further from its label down the column.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `the six stat icons are centred on the rows and evenly spaced` (packages/client/tests/panel.test.ts)

### The four panel tabs share one row and an even pitch
- **Kind:** Platform
- **What you notice:** The Stats, Inventory, Skills and Spellbook icons sit on one horizontal row with equal gaps, and the larger icon for the open tab centres on the same point as its small icon.
- **1.6:** The four bitmaps include their wooden background and were drawn at their own stage rects: small-icon centres near (634.5, 36), (678.5, 34), (720, 33) and (763, 30.5), so the row sagged upward to the right. The larger open-tab icons at #206-#209 were separate opaque crops with their own centres, and the small glyphs were also baked into the panel bitmap Internal #186.
- **SSO:** The build cuts each tab bitmap out of its wood with a hand-drawn mask traced along the glyph's outline, and erases the four baked copies from #186. The small and large versions of each tab are centred at y 34 on x 634, 677, 720 and 763 (a 43-pixel pitch), and every click target is a 40×40 box on that centre.
- **Why:** The user requested the tab icons aligned like the stats icons. Because the source bitmaps were opaque crops, moving them without keying the wood would have dragged rectangular patches along and left the old baked glyphs showing.
- **In the code:** `packages/data/src/panel-tabs.ts` (the row and each icon's crop box); `packages/data/build/assets-lib/panel-tab-masks.ts` (the masks); `packages/data/build/assets-lib/panel-tabs.ts` (applying them and the #186 fill); `packages/client/src/ui/panel.ts` (`createPanel`); `packages/client/src/ui/shells.ts` (`frameArt`)
- **Pinned by:** `the four tab icons share a row and an even pitch` (packages/client/tests/panel.test.ts); `building twice gives identical bytes` and `every tab icon has a mask that covers its crop box` (packages/data/tests/assets.test.ts)

### The panel wood below the page has no strip seam
- **Kind:** Platform
- **What you notice:** The grain in the wood under the Stats, Inventory and Skills pages runs straight across, with no step in its lines.
- **1.6:** Internal #186's wood was pasted together from strips, and two joins were a pixel out: below the page area (rows 279-439 of the bitmap, stage y 279-439), every grain line stepped down 1 px at stage x 636|637, and on rows 392-439 also stepped up at x 625|626.
- **SSO:** The build shifts the 11 columns between the joins (stage x 626-636) down. Where only the right join was out, the 1 px is spread across them, a twelfth per column; where both were out, the strip moves a whole pixel. The shift eases out over the rows below.
- **Why:** The user reported the steps as misaligned wood under the right panel.
- **In the code:** `packages/data/build/assets-lib/panel-tabs.ts` (`mendPanelSeam`, `PANEL_SEAM`)
- **Pinned by:** `the mended wood lines up across the strip` (packages/data/tests/assets.test.ts)

### World Editor sign panel text and OK align inside its frame
- **Kind:** Platform
- **What you notice:** The sign text field sits inside the World Editor sign frame, and the panel shows one crisp OK.
- **1.6:** The score put the editable `SignText` field at (26,20) inside the sign panel, 228×54, and the 31×19 Internal #91 bitmap's top-left at (228,69) over the OK baked into Internal #10.
- **SSO:** The textarea starts at (24,24) with a 13px line height, clear of the frame's top border. Internal #91 is drawn at its natural 31×19 size at (233,72), exactly over the baked OK, inside the same 39×29 hit area.
- **Why:** A browser textarea starts its text at the top of its box, unlike Director's field inset, so the score's rect put text against the top border. Stretching the OK bitmap to the sprite's 39×29 box offset its glyph and left the baked OK showing beside it.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`), `packages/client/src/styles.css` (`.we-sign`)
- **Pinned by:** `the sign panel's text field and OK patch line up with Internal #10` (packages/client/tests/worldeditor.test.ts)

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

### The World Editor's sign panel leaves the exit fields alone
- **Kind:** Bug fixed
- **What you notice:** Clicking the sign panel while exit panel 1 is open no longer hides exit 1's map X field or its neighbours.
- **1.6:** The sign panel's background had a script that swapped exit 1's map X sprite to a blank picture and hid it and two neighbouring fields until you left the editor.
- **SSO:** The sign panel's background is plain art with no click.
- **Why:** The exit fields should stay editable while signs are edited.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`createWorldEditor`)
- **Pinned by:** `divergence: the sign panel's background leaves exit 1's map X field alone` (packages/client/tests/worldeditor.test.ts)

### A monster's hit on you shows the splat and plays the hit sound
- **Kind:** Bug fixed
- **What you notice:** When a monster hits you, the number floats up over a splat and the hit sound plays, as for a player's hit. Shield, Parry and Block stay silent.
- **1.6:** The monster-hit message was one field short of the player-hit message, so the floating text read the wrong fields and only the number showed.
- **SSO:** A monster's damage floatie carries the splat flag, so the client draws the splat and plays `hitsound` on channel 5.
- **Why:** Monster damage should be as visible and audible as player damage.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`), `packages/server/src/systems/world/tick.ts` (`tick`), `packages/client/src/model.ts` (`applyDelta`)
- **Pinned by:** `divergence: a monster's hit on you shows the number with the splat and hitsound` and `a Parry, Block or Shield floatie has no splat and no sound` (packages/client/tests/combat.test.ts); `a Slime next to you hits on random(10) = 1` (packages/server/tests/monsters.test.ts)

### A shop shows only the OK for the open list
- **Kind:** Bug fixed
- **What you notice:** After a sell list, a buy list shows the buy OK alone, so pressing OK buys.
- **1.6:** The buy and sell lists each showed their own OK and neither hid the other, so a sell OK stayed drawn over a later buy list and answered "Error in trying to sell!".
- **SSO:** A buy or train list shows the buy OK and hides the sell OK; a sell list does the reverse; the vault hides the sell OK.
- **Why:** The OK on screen should act on the list on screen.
- **In the code:** `packages/client/src/ui/shop.ts` (`createShopWindow`)
- **Pinned by:** `divergence: each list shows only its own OK, so a buy list after a sell list buys` (packages/client/tests/npcs.test.ts)

### The × beside an empty Ring box is silent
- **Kind:** Bug fixed
- **What you notice:** Clicking the × beside any empty equipment box, the Ring box included, makes no sound.
- **1.6:** The Ring box's × played the click before testing for an empty slot; the other five tested first.
- **SSO:** Every × exits silently on an empty slot, then clicks after its locks.
- **Why:** The six boxes should behave alike.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `divergence: the empty Ring × is silent like the other boxes, sending nothing` (packages/client/tests/panel.test.ts)

### Item menu buttons click only when the action goes ahead
- **Kind:** Bug fixed
- **What you notice:** Use, Equip, Drop, Give and the Cook, Mix, Build, Smith and Storage buttons click when their action goes ahead. They are silent under the key lock or the item pause, for Use while the mail compose pane is up, and for a craft button with nothing behind it. Give now clicks like the others.
- **1.6:** Each handler played the click as its first statement, before the key lock, the item pause and every refusal; Give never clicked.
- **SSO:** A button checks the client's own refusal first, then sends the action, and clicks only when the key lock and the item pause allow it. The server still makes its own checks.
- **Why:** The click should confirm an action, not a refusal.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`), `packages/client/src/app.ts` (`runApp`)
- **Pinned by:** `divergence: the item menu clicks only past its locks and the client's refusals; Give too` and `divergence: a Use the client refuses makes no click` (packages/client/tests/panel.test.ts)

### Buying and selling in a shop play the cash sound
- **Kind:** Bug fixed
- **What you notice:** A completed purchase or sale plays the cash sound after the OK's click. A refused one plays only the click.
- **1.6:** The cash sound was wired only to messages the server never sent, or to a handler nothing called.
- **SSO:** The server's `processed` reply carries `ok` for a completed buy or sale, and the shop window plays `cash` on channel 4 for it.
- **Why:** A completed deal should be heard.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`buyIntent`, `sellIntent`), `packages/client/src/ui/shop.ts` (`createShopWindow`)
- **Pinned by:** `divergence: a completed buy and sale play cash; a refused one only the OK click` (packages/client/tests/npcs.test.ts); `buying three Apples from Amber, then selling one back, each answered processed ok` (packages/server/e2e/npcs-shops-trade.test.ts)

### The slot machine sound has a channel of its own
- **Kind:** Bug fixed
- **What you notice:** Pulling a slot machine no longer cuts off a spell, a monster hit or the church bell.
- **1.6:** The pull's sound played on a random one of channels 1-4, cutting off whatever was playing there.
- **SSO:** The pull's sound plays on channel 6, which nothing else uses.
- **Why:** A slot machine should not silence other sounds.
- **In the code:** `packages/client/src/sfx.ts` (`spellSounds`)
- **Pinned by:** `divergence: the Slot Machine sound plays on its own channel 6 and rolls only random(2)` (packages/client/tests/slots.test.ts)

### Closing the mail list closes its panes
- **Kind:** Bug fixed
- **What you notice:** Closing the mail list with the compose or read pane open closes those panes too. The Use button keeps working, and the next mailbox opens on the list alone.
- **1.6:** The list's CLOSE kept the panes' flags on. The Use button quietly exited while the compose flag was on, and the panes came back at the next open.
- **SSO:** The list's CLOSE clears both panes' flags and the draft.
- **Why:** A closed mailbox should leave nothing behind.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `divergence: list CLOSE closes both panes and drops the draft; reopen shows the list alone` (packages/client/tests/mail-boards.test.ts)

### Deleting a message clears the selection and its read pane
- **Kind:** Bug fixed
- **What you notice:** After DELETE, no line is selected, so a second DELETE removes nothing until you pick another message. A read pane showing the deleted message closes.
- **1.6:** DELETE rebuilt the list without clearing the selection or the read pane, so a second DELETE removed the next message.
- **SSO:** DELETE clears the selection, and closes the read pane when it shows the deleted message. A read pane showing another message stays.
- **Why:** One DELETE should remove one message.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `divergence: DELETE clears the selection and closes the read pane showing that message` (packages/client/tests/mail-boards.test.ts)

### WRITE starts an empty draft
- **Kind:** Bug fixed
- **What you notice:** Pressing WRITE opens an empty compose pane. While the pane is already open, WRITE keeps what is in it, and a send the server refuses also keeps it.
- **1.6:** The three fields were cleared only by a send, so WRITE showed whatever was left from before.
- **SSO:** WRITE clears the fields when the compose pane is not already up. Closing the list also drops the draft.
- **Why:** A new message should start blank.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `divergence: WRITE starts an empty draft; a second WRITE keeps the open one` and `a refused send (no mailSent) keeps the draft with the compose open` (packages/client/tests/mail-boards.test.ts)

### The read pane labels the sender FROM:
- **Kind:** Bug fixed
- **What you notice:** When you read a message, the sender's name sits on a line labelled FROM:.
- **1.6:** The read pane reused the compose pane's art, so the sender sat under its TO: label.
- **SSO:** A patch of the pane's purple with FROM: in white outlined capitals covers the art's TO:.
- **Why:** The label should name what the line shows.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`), `packages/client/src/styles.css` (`.mail-read-label`)
- **Pinned by:** `READ with nothing selected does nothing; with a line it fills the read pane` (packages/client/tests/mail-boards.test.ts)

### The mail list scrolls
- **Kind:** Bug fixed
- **What you notice:** The Subject column has a scroll bar and the From column scrolls with it, so all of a full mailbox can be reached.
- **1.6:** The columns were fixed boxes with no scroll bar, so only about 20 of up to 50 messages could be seen.
- **SSO:** Both 271-pixel columns scroll; Subject shows a thin bar and From follows it line for line.
- **Why:** Every stored message should be reachable without deleting the ones above it.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`), `packages/client/src/styles.css` (`.mail-lines`)
- **Pinned by:** `divergence: the 271-px list columns scroll, the From column following the Subject bar` (packages/client/tests/mail-boards.test.ts)

### The mail list leaves the chat entry usable
- **Kind:** Bug fixed
- **What you notice:** With the mail list up you can still click into the chat entry box.
- **1.6:** A blocker (Internal #203, channel 366) covered the chat entry while the list was up.
- **SSO:** No blocker is drawn.
- **Why:** Reading mail should not stop you chatting.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`), `packages/client/src/ui/shells.ts` (`createGameView`)
- **Pinned by:** `CLOSE unlocks, leaves frame 72 and tells the server` (packages/client/tests/mail-boards.test.ts); `divergence: the stage places the mail and board at their rects, and nothing blocks the chat entry` (packages/client/tests/shells.test.ts)

### A photo leaves a cancelled painting alone
- **Kind:** Bug fixed
- **What you notice:** Cancel a painting, take a photo, and the next Canvas still reopens your painting.
- **1.6:** The photo was written into the same image a cancelled canvas keeps.
- **SSO:** A photo is cropped into an image of its own and saved from there. A viewed painting still shares the canvas's image (see the bug ledger's mail section).
- **Why:** Taking a photo should not destroy unrelated work.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `divergence: a photo leaves a cancelled painting alone` and `a good shot hides the lens, redraws, crops 64×64 around the tap and saves a photo` (packages/client/tests/art-news.test.ts)

### A painting in the viewer cannot be painted on
- **Kind:** Bug fixed
- **What you notice:** Holding the mouse down on a painting you are viewing does nothing to it.
- **1.6:** The viewer's picture kept the paint screen's paint behaviour, so the current tool painted on it.
- **SSO:** The viewer's picture takes no pointer input; a mouse release anywhere still closes the viewer.
- **Why:** Viewing should not change the picture.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `divergence: a pointer down on the viewed image paints nothing` (packages/client/tests/art-news.test.ts)

### The colour picker reads only the palette and the painting
- **Kind:** Bug fixed
- **What you notice:** The held picker takes a colour from the palette strip, the preview or the large painting. Dragged over the tools, the frame or anything else, it keeps the current colour.
- **1.6:** The picker read the colour straight from the screen, wherever the pointer was.
- **SSO:** The picker reads the art inside the palette strip's border (stage 132-230 × 328-355), or the painting's pixel under the preview or the 4× image, and nothing else.
- **Why:** Picking a colour should not pick up the screen's decoration.
- **In the code:** `packages/client/src/ui/paint.ts` (`PAINT_RECTS`, `createPaintUi`)
- **Pinned by:** `divergence: the colour pick reads only the palette strip, the preview and the 4× image` (packages/client/tests/art-news.test.ts)

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
- **What you notice:** Gathering sites and farm produce regrow on the server's clock.
- **1.6:** Each client on the map drew a number from 1 to 600 each frame, except while a map was loading, to decide which regrowth and produce checks to run, then edited tiles.
- **SSO:** The server makes the draw itself, once per map per frame, and sends the tile changes (see "Regrowth runs at one rate on every map").
- **Why:** The server owns tile changes.
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
- **What you notice:** A craft ends on logout. Nothing has been taken yet, so nothing is lost.
- **1.6:** Crafting counters lived on the client. Quitting stopped them; cooking and smithing had taken nothing yet, while alchemy and carpentry inputs were already gone.
- **SSO:** The server runs the craft during the session and ends it at logout. Every craft takes its materials when it finishes (see "Every craft takes its materials when it finishes"), so an ended craft loses nothing.
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

### A tool's first success takes the full number of hits
- **Kind:** Bug fixed
- **What you notice:** Gathering takes the number of hits per success that the skill table gives, the first time too. Each tool keeps its own count, so swapping hammers does not finish another hammer's count.
- **1.6:** There was one counter per tool family. It was reloaded only when it dropped below 1, and success came at exactly 1, so the first success came one hit early. All three hammers shared one mining counter.
- **SSO:** The count is loaded when it is empty, each hit takes one, and the hit that empties it succeeds. Counts are kept per tool name and start empty at each login.
- **Why:** Every success should cost what the table says, and one tool's work should not carry over to another.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`hitCounter`, `newGatherCounters`)
- **Pinned by:** `bug fixed: every success takes exactly the table's number of hits, the first too`; `bug fixed: each hammer keeps its own count` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: 18 swings fell a tree, as the table says: the stump, treefalling, logs and the skill line` (packages/server/tests/gather.test.ts)

### Gathering at skill 0 drops items
- **Kind:** Bug fixed
- **What you notice:** With Lumberjacking at 0 a felled tree can drop Logs, and with Mining at 0 a broken rock can drop crystals, ore or a chunk.
- **1.6:** The drop rolls were made, but each drop was guarded by "skill above 0".
- **SSO:** The guard is gone; a skill of 0 uses the lowest row of each table.
- **Why:** New gatherers should get something for their work.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`rollLogs`, `rollMiningFind`, `rollChunk`)
- **Pinned by:** `bug fixed: Lumberjacking 0 drops logs like any other skill`; `bug fixed: Mining 0 finds crystals, ore and chunks` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: Lumberjacking 0 fells trees, drops logs and can rise` (packages/server/tests/gather.test.ts)

### Ore odds improve with Mining
- **Kind:** Bug fixed
- **What you notice:** The chance of Iron, Steel or Star ore rises with Mining skill, from Iron 1 in 100 at skill 0 to 1 in 25 from 90 up. At 97 and above the odds stay at their best instead of dropping Iron.
- **1.6:** The odds were a cascade of "skill below N" tests in which the last true one won, so every skill below 97 got the same odds (Iron 1 in 25, Steel 1 in 55, Star 1 in 155). At 97 and above the pool was left unset, so Iron never dropped while Steel became 1 in 30 and Star 1 in 130.
- **SSO:** The tightest "below N" row the skill is under sets the Iron pool; Steel adds 30 and Star adds 100 more. From 97 up the last row (25) applies.
- **Why:** Mining skill should matter, and should never make an ore impossible.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`orePool`, `rollMiningFind`)
- **Pinned by:** `bug fixed: ore odds improve as Mining rises, and never get worse at 97` (packages/shared/tests/crafting/gather.test.ts)

### Fishing at skill 0 can catch fish
- **Kind:** Bug fixed
- **What you notice:** With Fishing at 0 you catch Raw Fish at the same odds as Fishing 1, and the skill can rise.
- **1.6:** The fishing check was only set up above 0, so the catch roll could never succeed at 0, and the skill-raising helper also needed the skill above 0.
- **SSO:** Skill 0 uses the first row of the catch table (1 in 30).
- **Why:** A new fisher should be able to start.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`fishCheck`, `castLine`)
- **Pinned by:** `bug fixed: Fishing 0 catches at the lowest skill's odds and can rise` (packages/shared/tests/crafting/gather.test.ts)

### Seeds are kept when they cannot be planted
- **Kind:** Bug fixed
- **What you notice:** Using seeds on a tile that cannot grow them, or facing off the edge of the map, reads "…isn't going to grow anything here!" and keeps the seed.
- **1.6:** The planting routine exited on the wrong tile but the item removal was sent anyway. Off the map the tile read as empty, which passed the test, so it printed "You plant the seeds." while the server refused the change.
- **SSO:** A seed is used up only when the tilled soil (`SL`) actually changes. Anything else, including off the map, gives the wrong-ground line.
- **Why:** Players should not lose seeds to a planting that did nothing.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`plantSeeds`); `packages/shared/src/rules/crafting/gather.ts` (`canPlant`); `packages/server/src/systems/inventory/items.ts` (`useIntent`)
- **Pinned by:** `bug fixed: seeds plant only on SL; off the map nothing can be planted` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: seeds are kept on a wrong tile or off the map; they plant on SL` (packages/server/tests/gather.test.ts)

### The shovel checks the ground under every tile
- **Kind:** Bug fixed
- **What you notice:** The shovel digs only where the first-layer ground under the tile is grass or earth (`G1`, `H1` or `O1`), on every row of the map. It no longer digs holes over water, and the top-right tile of the top row can be dug.
- **1.6:** The shovel read a word of the one-line map data, which was empty below row 1, and empty text passed the test. So the check applied only on the top row, where column 17 straddled the `#` joining two layers and never matched.
- **SSO:** The shovel reads the first-layer tile at the dug position and tests it against the same three codes. Off the map nothing can be dug.
- **Why:** The ground restriction was meant to apply everywhere.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`shovelLayer1Ok`)
- **Pinned by:** `bug fixed: the shovel checks the ground under every tile, on every row` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: the shovel will not dig G3 over water on any row` (packages/server/tests/gather.test.ts)

### Crafting at skill 10 can fail
- **Kind:** Bug fixed
- **What you notice:** A craft at skill exactly 10 can fail, with the same 1 in 3 chance as lower skills.
- **1.6:** The failure table had a "below 10" row and an "above 10" row, so 10 matched neither and never failed.
- **SSO:** The first row covers skills up to and including 10.
- **Why:** No single skill value should be immune to failure.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`failurePool`, `rollFailure`)
- **Pinned by:** `bug fixed: crafting skill exactly 10 can fail, at the odds of the skills below it` (packages/shared/tests/crafting/craft.test.ts)

### Blacksmithing only gets faster with skill
- **Kind:** Bug fixed
- **What you notice:** Smithing takes 500 frames at skill 10 or less, then 460, 400 and so on down to 12, so a higher skill never waits longer.
- **1.6:** The smithing timer was 300 frames, then 460 above 10 and 400 above 20, so smiths with skill 11 to 30 waited longer than beginners.
- **SSO:** The base timer is 500, so the table only ever decreases.
- **Why:** Practice should never make smithing slower.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`craftTimer`)
- **Pinned by:** `bug fixed: Blacksmithing only ever gets faster as the skill rises` (packages/shared/tests/crafting/craft.test.ts); `starts with the line, the lock and Swordhit3; done on the 500th frame` (packages/server/tests/craft.test.ts)

### Every craft takes its materials when it finishes
- **Kind:** Bug fixed
- **What you notice:** Starting a craft takes nothing. When it finishes, it takes its materials: the damaged item and chunk, the raw food, the Potion Bottle and crystal, or the Logs. A failure (a burned meal, a bad potion, a ruined build) uses them up and makes nothing.
- **1.6:** Cooking and smithing took their inputs at completion, and a burn exited before the raw food was taken, so a burned meal kept its food. Alchemy and carpentry took their inputs at the start, so their failures lost them.
- **SSO:** `finishCraft` takes every material by exact name at completion. Failures use them up the same way for cooking, alchemy and carpentry. If a material is gone by then, the craft ends silently, as a repair with no chunk already did.
- **Why:** Failures should cost the same in every craft, and crafts that end early should lose nothing.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`finishCraft`, `startCraft`)
- **Pinned by:** `bug fixed: a burned meal uses up its raw food, like failed brews and builds`; `a failed brew uses up the bottle and the crystal`; `bug fixed: 'You built a Chair!'; a failure says so and uses the Logs` (packages/shared/tests/crafting/craft.test.ts); `alchemy: the bottle and crystal are taken at completion; the sand stays in hand`; `carpentry: Logs taken at completion, 'You built a Crate!', the result minted an id` (packages/server/tests/craft.test.ts)

### Yeti Meat cooks into a Yeti Burger
- **Kind:** Bug fixed
- **What you notice:** Cooking Yeti Meat makes a Yeti Burger.
- **1.6:** The server's recipe table mapped Yeti Meat to itself.
- **SSO:** The recipe gives the existing Yeti Burger item.
- **Why:** Cooking should change the food.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cookResult`)
- **Pinned by:** `bug fixed: Yeti Meat cooks into a Yeti Burger` (packages/shared/tests/crafting/craft.test.ts)

### Masterwork rolls are even and the Knight's Sword repairs
- **Kind:** Bug fixed
- **What you notice:** A repaired Chain Helm or Steel Shield gets its +1 on one roll, like every other single-bonus item. A broken Knight's Sword becomes "Damaged Sword, Knight", which repairs into a Knight's Sword with a Chunk of Steel; an old "Damaged Sword, Knight's" in a bag repairs too. Starting a repair on an item with no repair says "You don't know how to repair that."
- **1.6:** Chain Helm and Steel Shield gave +1 on two rolls. The table had a Leather Armor +1 row, but Leather Armor never breaks, so it could never come up. A Knight's Sword broke into "Damaged Sword, Knight's", but the repair looked for "Damaged Sword, Knight", so it ended with "Your  is ready!" and kept its inputs.
- **SSO:** Each masterwork bonus has one roll, and the dead Leather Armor row is gone. The armour break uses the "Damaged Sword, Knight" name that has art, and the old name has its own chunk and repair rows. The Smith button refuses an item with no repair.
- **Why:** Every masterwork row should be reachable, and every damaged item that breaks should be repairable.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`masterwork`, `repairResult`, `smithChunk`)
- **Pinned by:** `bug fixed: each masterwork bonus has one roll, and every row can come up`; `bug fixed: a broken Knight's Sword repairs, under either damaged name`; `an item with no repair cannot be started` (packages/shared/tests/crafting/craft.test.ts)

### Only alchemy sand mixes a potion
- **Kind:** Bug fixed
- **What you notice:** Mixing needs one of the six sands held in the right hand. Holding anything else, such as a Catfish Sandwich, gives "You must be holding some alchemist sand in your hand to mix the potion!" and keeps your keys free.
- **1.6:** The gate only checked that the held item's name contained " Sand", so a Catfish Sandwich passed with no crystal. The brew then reused the session's last potion, or a Bad Potion after a failed start, and before any brew it printed nothing and left the keys locked until the next map load.
- **SSO:** The held item must equal one of the six sands, which also picks the potion and the crystal. No last potion is kept.
- **Why:** A sandwich should not brew free potions or lock the player's keys.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startMix`)
- **Pinned by:** `bug fixed: only a real sand mixes; a Catfish Sandwich is refused` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: a Catfish Sandwich cannot stand in for sand; the keys stay free` (packages/server/tests/craft.test.ts)

### Building furniture needs Carpentry 1
- **Kind:** Bug fixed
- **What you notice:** With Carpentry below 1 the Build button reads "You aren't skilled in carpentry, you'd just ruin the logs". New characters start at 1. Building still needs no station: a workbench is tracked as a feature in [issue #4](https://github.com/jberlyn/second-star-online/issues/4).
- **1.6:** Build checked only the Saw, so any Carpentry skill could build.
- **SSO:** Carpentry follows cooking's rule: the skill must be at least `minSkill` (1).
- **Why:** Carpentry should need the skill, like the other crafts.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startBuild`)
- **Pinned by:** `bug fixed: carpentry needs the Saw and Carpentry 1, like cooking's skill rule` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: carpentry needs Carpentry 1` (packages/server/tests/craft.test.ts)

### The cauldron matches exact ingredients and keeps the rest
- **Kind:** Bug fixed
- **What you notice:** A cauldron brews when it holds both ingredients of a recipe, each by its exact name: an Axe works, a Gold Axe does not. The brew swaps the two ingredients for the result and leaves everything else inside. The two recipes that need a Magic Shield Book now work. Anyone with that cauldron open sees the new contents at once.
- **1.6:** The recipes were "contains" tests over all the stored text, the last matching recipe won, and a success overwrote everything inside with the result. Two recipes needed a "Magic Shield Spell Book" that no one could get. The open window was not refreshed, so after a brew its old lines took nothing.
- **SSO:** `cauldronBrew` checks recipes in order by exact name, the first match wins, and it removes one of each ingredient. A brew refreshes the list of every player with that cauldron open.
- **Why:** Players should not lose unrelated items to a brew, and every recipe should be possible.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cauldronBrew`); `packages/server/src/systems/economy/containers.ts` (`depositContainer`)
- **Pinned by:** `a brew needs both ingredients and swaps them for the result`; `bug fixed: ingredients match by exact name; the Magic Shield Book recipes work` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: a hit says so to the depositor only and keeps the other contents`; `bug fixed: a brew refreshes the list of anyone with the Cauldron open`; `bug fixed: the Magic Shield Book recipes brew, and 'Axe' means an Axe` (packages/server/tests/craft.test.ts)

### Crafts take exactly the named item
- **Kind:** Bug fixed
- **What you notice:** Cooking a Pig takes the Pig and never touches a Cooked Pig stack elsewhere in your bag.
- **1.6:** The removal took from the first bag slot whose text contained the item name and a dash, then wrote the line back under the shorter name, so "Cooked Pig-3" could become "Pig-2".
- **SSO:** Every crafting removal matches the whole item name.
- **Why:** Crafting should not rename other items.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`takeByName`, `firstSlotNamed`)
- **Pinned by:** `bug fixed: cooking a Pig takes the Pig, never a Cooked Pig` (packages/shared/tests/crafting/craft.test.ts)

### A full bag stops the craft from finishing
- **Kind:** Bug fixed
- **What you notice:** If a finished craft's result has nowhere to go, you read "Your inventory is too crowded!", nothing is taken, nothing is made and there is no skill roll.
- **1.6:** Cooking and smithing printed "Your <item> is ready!" and rolled the skill even though nothing was added. Alchemy and carpentry had already taken their inputs, so the result was simply lost.
- **SSO:** `finishCraft` tries the whole change on a copy of the bag and keeps it only if the result fits.
- **Why:** The game should not report a craft that made nothing, or destroy materials for it.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`finishCraft`)
- **Pinned by:** `bug fixed: a full bag says so, makes nothing and keeps the raw stack`; `bug fixed: a full bag keeps the Logs and makes nothing` (packages/shared/tests/crafting/craft.test.ts); `bug fixed: a full bag says so, with no skill roll and no 'is ready!'; the inputs stay` (packages/server/tests/craft.test.ts)

### Each cook rolls its own burn, and Raw Meat cannot be cooked
- **Kind:** Bug fixed
- **What you notice:** Whether a meal burns depends only on that cook's own roll. Raw Meat, which has no recipe, is refused at the start with "You don't know how to cook that."
- **1.6:** The food chosen for a cook was kept for the session, and a failed start set it to "Bad Food". Any name without its own food row, such as Raw Meat, kept it, so Raw Meat burned every time after one failure. With no earlier cook it read "Your  is ready!" with a blank name.
- **SSO:** The failure roll happens once, at completion, and the Cook button refuses an item with no recipe.
- **Why:** One failure should not doom later cooks, and an uncookable item should say so.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startCraft`, `cookResult`)
- **Pinned by:** `bug fixed: each cook rolls its own burn; Raw Meat cannot be cooked at all` (packages/shared/tests/crafting/craft.test.ts)

### Building says "You built a ..."
- **Kind:** Bug fixed
- **What you notice:** A finished build reads "You built a Chair!".
- **1.6:** The message read "Your built a Chair!".
- **SSO:** The text is corrected in the crafting data.
- **Why:** Typo.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`CRAFT_TEXT`)
- **Pinned by:** `bug fixed: 'You built a Chair!'; a failure says so and uses the Logs` (packages/shared/tests/crafting/craft.test.ts)

### A map change ends a craft
- **Kind:** Bug fixed
- **What you notice:** If you change map while smithing, cooking, mixing or building, whether by a warp, an exit or a death, the craft stops and you read "You stop what you were making." Nothing has been taken, so nothing is lost.
- **1.6:** Nothing reset the crafting counters on a map change, death or warp, and loading a map freed the keys, so you could walk around while the craft ran and it finished wherever you were.
- **SSO:** `enterRoom` ends any running craft with `cancelCrafts`.
- **Why:** A craft should need you to stay at the station.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`cancelCrafts`); `packages/server/src/systems/world/world.ts` (`enterRoom`)
- **Pinned by:** `bug fixed: a map change ends the craft, says so, and loses nothing`; `a map change with no craft running says nothing` (packages/server/tests/craft.test.ts)

### A crafter can be shoved, which ends the craft
- **Kind:** Bug fixed
- **What you notice:** While you craft you stay in place: walking and turning are refused until it finishes. Another player can still push you a tile as usual, and being pushed off the spot ends the craft with "You stop what you were making." Nothing has been taken, so nothing is lost.
- **1.6:** Starting a craft locked the keys, and the shove skipped players whose keys were locked, so a crafter could not be pushed.
- **SSO:** The shove ignores a lock held only by a craft (a window holding the keys still stops it). A shove that moves the crafter ends every running craft and frees the keys, as a map change does. A running craft holds the player in its own right: walking, turning, swinging and starting a second craft are refused while it runs, even if a window close with no window open (a shop Cancel, a board close, a guild Leave) clears the key lock.
- **Why:** Crafting should not make a player immovable, and a craft should need you to stay at the station.
- **In the code:** `packages/server/src/systems/movement/push.ts` (`pushOnMe`); `packages/server/src/systems/crafting/craft.ts` (`isCrafting`, `stopCraftsOnMove`)
- **Pinned by:** `bug fixed: a crafter can be shoved, which ends the craft and frees the keys`; `a crafter cannot walk or turn away: the craft's key lock holds them in place`; `a stray Cancel or board close mid-craft frees nothing: no walking, swinging or second craft`; `one craft at a time: a second is refused even with the keys cleared`; `a window's key lock still stops a shove` (packages/server/tests/craft.test.ts)

### Regrowth runs at one rate on every map
- **Kind:** Bug fixed
- **What you notice:** Trees, rock, ice, holes and farm produce grow back at the same rate however many players are on the map. A map nobody visited catches up, up to an hour's worth, when someone arrives. Regrowth no longer pauses after a death or an exit warp.
- **1.6:** Every client on the map rolled the regrowth checks each frame, so more players meant faster regrowth and an empty map never regrew. The six regrowth checks also waited out a 400-frame timer after the roller's death or exit warp.
- **SSO:** The server rolls once per map per frame, the rate one player gave in 1.6. A map whose room was unloaded runs the frames it missed, up to 72,000, when it next ticks. The death and warp timer is gone.
- **Why:** Regrowth should not depend on crowding a map or on who died.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`regrowthStep`); `packages/shared/src/rules/crafting/gather.ts` (`regrowthFrame`, `REGROWTH_CATCH_UP_FRAMES`)
- **Pinned by:** `bug fixed: one random(600) per map per frame, however many players are there`; `bug fixed: an empty map catches up on the frames it missed, up to an hour`; `bug fixed: a stump regrows on a roll under 6, even right after a death or exit warp` (packages/server/tests/gather.test.ts)

### Gathering and crafting skills rise from 0
- **Kind:** Bug fixed
- **What you notice:** A gathering or crafting skill at 0 can rise through use.
- **1.6:** All nine skill-raising handlers required the skill to be above 0, and nothing else raised these skills from 0.
- **SSO:** The handlers roll from 0 to 99.
- **Why:** A skill at 0 should be trainable.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`skillGainRule`, `rollSkillGain`)
- **Pinned by:** `bug fixed: a skill at 0 can rise; 100 is the cap` (packages/shared/tests/crafting/gather.test.ts); `the skill line follows 'is ready!'; a skill of 0 can rise` (packages/server/tests/craft.test.ts)

### The Watering Bucket counts only useful swings
- **Kind:** Bug fixed
- **What you notice:** Only a swing at a seeded tile counts toward watering it. Swings at grass, or off the map, count nothing.
- **1.6:** The bucket counted every swing before looking at the tile, so a success could land on an unseeded tile and be wasted.
- **SSO:** The swing counts only when the faced tile can be watered.
- **Why:** Watering should not waste progress.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)
- **Pinned by:** `bug fixed: the Watering Bucket counts only swings at a seeded tile` (packages/server/tests/gather.test.ts)

### Gathering mid-step drops its item
- **Kind:** Bug fixed
- **What you notice:** Swinging a tool or casting a line while mid-step drops the logs, find or fish on the changed tile, as standing still does.
- **1.6:** The swing worked from the destination tile, but the drop needed you to be standing still, so the tile changed and the skill could rise with nothing dropped.
- **SSO:** The drop no longer checks the step.
- **Why:** A successful swing should give its item.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`toolSwing`); `packages/shared/src/rules/crafting/gather.ts` (`castLine`)
- **Pinned by:** `bug fixed: a fell mid-step drops its logs on the felled tile`; `bug fixed: a cast mid-step catches like any other` (packages/server/tests/gather.test.ts)

### Water on either layer can be fished
- **Kind:** Bug fixed
- **What you notice:** Water drawn on the first or the second layer can be fished, so D2 water works.
- **1.6:** Fishing read the first layer only, so water that exists only on layer 2 (D2) never gave a fish.
- **SSO:** Fishing tests the faced tile on both layers against the water codes.
- **Why:** Water that looks the same should fish the same.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`isFishingWater`, `FISHING_LAYERS`); `packages/server/src/systems/crafting/gather.ts` (`preSwing`)
- **Pinned by:** `bug fixed: W1, N1, D2 and I2 are water on either layer; the offsets of the cast` (packages/shared/tests/crafting/gather.test.ts); `bug fixed: water drawn only on layer 2 (D2) can be fished` (packages/server/tests/gather.test.ts)

### Fishing skill-ups do not use the anti-macro allowance
- **Kind:** Bug fixed
- **What you notice:** The allowance of casts without moving is spent only by catches, so earning Fishing skill does not run it down.
- **1.6:** A skill-up took one from the allowance, as a catch did.
- **SSO:** Only a catch spends it. The skill roll still runs only while the allowance lasts.
- **Why:** Getting better at fishing should not cut fishing short.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`castLine`, `ANTI_MACRO_START`)
- **Pinned by:** `bug fixed: only a catch spends the anti-macro counter; the Imp rolls every cast` (packages/shared/tests/crafting/gather.test.ts)

### Asking about "the treasure" gets an answer
- **Kind:** Bug fixed
- **What you notice:** A line starting with "the treasure" triggers the treasure rumour, like "treasure" and "any treasure".
- **1.6:** The trigger compared the first word with the two words "the treasure", so it could never be true.
- **SSO:** The test checks the first two words.
- **Why:** The trigger was meant to work.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`asksAboutTreasure`)
- **Pinned by:** `bug fixed: the keywords, including a line starting "the treasure"` (packages/shared/tests/crafting/gather.test.ts)

### Alchemy sand is a tool and is never used up
- **Kind:** Other
- **What you notice:** You mix a potion and the sand is still in your hand afterwards. The Potion Bottle and the crystal are used up.
- **1.6:** The same: the sand only had to be held.
- **SSO:** The same, on purpose. Every craft uses up its materials and keeps its tool: the Blacksmith Hammer, the Saw, and for alchemy the held sand. Shops price sand at 100 to 150 gold against 23 to 35 for a potion, which fits a tool rather than a material. Operators can change those prices. This was listed in the bug ledger until it was reclassified as intended.
- **Why:** Using up the sand on every mix would make alchemy cost far more than it earns.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startMix`, `finishCraft`)
- **Pinned by:** `completion takes the bottle and the crystal; the held sand is a tool` (packages/shared/tests/crafting/craft.test.ts); `alchemy: the bottle and crystal are taken at completion; the sand stays in hand` (packages/server/tests/craft.test.ts)

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
- **SSO:** Placed containers must be faced; a carried crate or cabinet is opened from the bag. A personal or house vault belongs to its owner by exact name; a House Key opens only its holder's door. A guild vault belongs to its named guild's members, so a later guild created under the same name inherits the old vault's contents (bug ledger). A carried crate or cabinet belongs to its carrier, while placed crates, cabinets and chests, quest chests and the Cauldron can be used by anyone facing them. For a forbidden house or guild vault the original standing-in-front line appears before the SSO refusal, modeled on the mailbox's ownership line. A forbidden deposit is refused before the drop line and takes nothing. An open vault or container keeps the keys locked until Cancel and closes on a map change, so it is never used from elsewhere (see "A vault stays where you opened it").
- **Why:** Anyone could otherwise read and loot any vault.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`mayUseContainer`, `openContainer`, `depositContainer`, `withdrawContainer`), `packages/server/src/systems/economy/vault.ts` (`openVault`)

### Trades are server sessions with two accepts
- **Kind:** Exploit closed
- **What you notice:** A trade exchanges both offers together after both players agree.
- **1.6:** The accepting client supplied both player names and both lists, and the server checked neither identity nor consent.
- **SSO:** The server holds a trade between two players on the same map and keeps each submitted offer within what that player holds. Both players press Accept once both offers are in (see "Both traders accept, and may change their offers"). One transaction moves both sides or neither.
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

### Shop presence is the map's roster
- **Kind:** Architecture
- **What you notice:** A shop purchase works while the NPC whose Bio you opened is in the map's roster, whether or not it is alive. (The bank needs a living banker; see "The bank needs a living banker".)
- **1.6:** Shop OK checked whether the clicked slot's data had changed; after a map change it did nothing until a map loaded data into that slot, then traded with the old NPC by name.
- **SSO:** Shop OK does nothing unless the originally opened NPC remains in the current map's roster.
- **Why:** A line-based purchase needs that NPC; another map's stale client slot was a peer-to-peer artefact.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`inRoster`, `buyIntent`)

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

### Quest chests add their refill, and a Wind Chest takes drops
- **Kind:** Bug fixed
- **What you notice:** Now and then a quest chest gains an item; whatever was already in it stays. Dropping an item while facing a Wind Chest stores it, as with the other chests. Like every placed chest, a quest chest is one container that anyone facing it can use.
- **1.6:** The refill (1 in 4000 per save) overwrote the chest with its one item, wiping what players had left there. The client had no drop route for the Wind Chest, so a drop read "the floor is too crowded".
- **SSO:** The refill item is added when the chest has room and skipped when it is full. The Wind Chest is on the drop routes by exact name. The roll and its odds are unchanged.
- **Why:** A random roll should not destroy what players stored, and one of six chests should not refuse deposits.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`saveClockStep`, `dropRoute`); `packages/shared/src/rules/housing/doors.ts` (`questChestRefill`)
- **Pinned by:** `bug fixed: after 400 frames a 1-in-350 save rolls 1 in 4000; the refill is added to the chest`; `bug fixed: a full quest chest keeps what it holds`; `bug fixed: Drop routes: the six chests by name take items, the Wind Chest too; a bare Crate is crowded` (packages/server/tests/doors.test.ts)

### A container with something in it cannot be sold
- **Kind:** Bug fixed
- **What you notice:** Selling a Crate, Cabinet or Wind Cabinet that still holds items is refused: the shopkeeper says "Empty that out before you sell it to me." An empty one sells as before, and if you carry several of that kind the empty one goes first.
- **1.6:** The sale removed the bag line but never cleared the stored contents, which stayed unreachable unless a later container happened to roll the same id.
- **SSO:** The sale checks the container's storage first. An empty container's storage row is deleted with the sale.
- **Why:** Selling should never silently destroy what a player stored.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`, `sellName`); `packages/server/src/systems/economy/intents.ts` (`sellIntent`)
- **Pinned by:** `bug fixed: a container with something stored in it is refused, and an empty one is sold first` (packages/server/tests/economy.test.ts); `bug fixed: a container with contents is refused; an empty one sells and its storage row goes` (packages/server/tests/economy-db.test.ts)

### Every bought container gets its own id
- **Kind:** Bug fixed
- **What you notice:** Buying several Crates, Cabinets, Wind Cabinets or Cauldrons at once gives one bag line per container, each with its own storage. You need an empty bag line for each.
- **1.6:** The purchase added the whole count in one call, so the line got one random id; giving one away left two players sharing the same storage.
- **SSO:** Each container is added on its own line with a fresh id, rolled again if that id is already in storage, in an online bag or earlier in the same purchase.
- **Why:** Separate containers should have separate contents.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`); `packages/shared/src/rules/inventory/inventory.ts` (`invAdd`, `isUniqueContainer`); `packages/server/src/systems/economy/intents.ts` (`buyIntent`)
- **Pinned by:** `bug fixed: each bought container gets its own line and its own unused id` (packages/server/tests/economy.test.ts)

### A shopkeeper's till starts at 0 without a gold line, and counts anywhere in the file
- **Kind:** Bug fixed
- **What you notice:** The Fire, Water and Wind God books and Merius' Damaged Armor cost their listed price, and the gold goes into the shopkeeper's till. Selling to a shopkeeper pays from its till; one whose till is empty says "<Name> says "I'm sorry but I can't afford to buy that."" and you keep the item. Gold handed to a shopkeeper always goes into its till.
- **1.6:** Only a shopkeeper with a `GLD|` line among its first 80 lines charged or paid: one without gave goods away (after checking you could afford them) and took sold items for nothing. A gift counted only with a `GLD|` line among the first 60 lines.
- **SSO:** No `GLD|` line means a till of 0. Purchases fill it, sales pay from it, and gifts add to it. Once it holds gold, the file the NPC editor loads (and a player shop's rewrite) shows a `GLD|` line. The `GLD|` line counts wherever it is, so the NPC editor no longer warns about its position.
- **Why:** A listed price should be charged, a sale should never take an item for nothing, and the line limits were 1.6 reader windows with no gameplay purpose.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`ledgerFromTemplate`, `npcBuy`, `npcSell`); `packages/server/src/systems/economy/intents.ts` (`giveGoldToNpc`); `packages/shared/src/rules/admin/npcfile.ts` (`liveNpcText`, `checkNpcFile`)
- **Pinned by:** `bug fixed: a shopkeeper with no GLD line charges the price into a till that starts at 0`; `bug fixed: a shopkeeper with no GLD line pays from its till, refusing while it is empty` (packages/server/tests/economy.test.ts); `bug fixed: ledgers: GLD| counts wherever it is, and no GLD| is a till of 0`; `bug fixed: gold given goes into the till wherever GLD| is, or into a till from 0 without one` (packages/server/tests/npcedit.test.ts); `bug fixed: a till filled without a GLD| line shows as one in the live file` (packages/shared/tests/admin/npcfile.test.ts); `bug fixed: the Fire God's book costs its 100 gold, though he keeps no gold line` (packages/server/e2e/npcs-shops-trade.test.ts)

### Any listed item can be bought, the Fortress Guild Hall Deed included
- **Kind:** Bug fixed
- **What you notice:** The Smithy sells the Fortress Guild Hall Deed. Any item on a shop list can be bought, whatever line of the shop's file it sits on, and buying one item never takes another's stock.
- **1.6:** The buy routine shared one counter between two nested loops, so a non-crystal sale line at file line 17 or later always answered "out of stock" (and stalled the server for up to its stock count), and lines past 80 could not be bought. A match below line 17 jumped ahead, which also stopped a prefix match from taking Trout Fillet's stock.
- **SSO:** The purchase uses the chosen line alone: its price, its stock and its item. The NPC editor no longer warns about sale lines from line 17 or after line 80.
- **Why:** Items a shop lists should be for sale.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`); `packages/shared/src/rules/admin/npcfile.ts` (`checkNpcFile`)
- **Pinned by:** `bug fixed: the Fortress Guild Hall Deed (Smithy line 17) can be bought`; `buying Trout takes only Trout's stock, not Trout Fillet's` (packages/server/tests/economy.test.ts); `warned: inert tags only; no line is outside a reader's window` (packages/shared/tests/admin/npcfile.test.ts)

### Every purchase and sale is thanked
- **Kind:** Bug fixed
- **What you notice:** Each purchase and each sale gets one "<Name> says "Thanks for the business!"", whether or not the shopkeeper also sells the item.
- **1.6:** The thanks was sent only while walking the shopkeeper's own sale lines, so a sale of an item the shop did not stock got none, and a purchase was never confirmed except by the bag changing.
- **SSO:** One thanks, by name, for every completed purchase or sale.
- **Why:** A trade that went through should say so.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`, `npcSell`, `SHOP_TEXT`)
- **Pinned by:** `bug fixed: a sale to a shopkeeper who does not stock the item is thanked too`; `price × count from the line, charged from GLD into the NPC's gold` (packages/server/tests/economy.test.ts)

### Selling Trout restocks only Trout
- **Kind:** Bug fixed
- **What you notice:** Selling Trout or Catfish to Akadius, or Swordfish or Squid to Krista or Lir, restocks only that item, with one thanks.
- **1.6:** Every sale line that merely started with the sold item's name was restocked and thanked, so Trout Fillet, Catfish Sandwich, Swordfish Steak and Squid Platter gained stock and the thanks printed twice.
- **SSO:** The sale line for exactly that item is restocked.
- **Why:** Selling one item should not create stock of another.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`)
- **Pinned by:** `bug fixed: selling Trout restocks only Trout and thanks once` (packages/server/tests/economy.test.ts)

### Shopkeeper refusals name the shopkeeper
- **Kind:** Bug fixed
- **What you notice:** "Sorry but I'm out of that particular item." and "I'm sorry but I can't afford to buy that." start with the shopkeeper's name.
- **1.6:** The name came from an on-screen sprite that was empty in every game screen, so each line began with a blank.
- **SSO:** The server names the shop's NPC.
- **Why:** A line that starts with a gap reads as broken.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`SHOP_TEXT`, `npcBuy`, `npcSell`)
- **Pinned by:** `bug fixed: count over stock names the shopkeeper`; `bug fixed: an NPC whose gold would go negative names itself` (packages/server/tests/economy.test.ts)

### A full bag has no room for a Pie because it holds an Orc Pot Pie
- **Kind:** Bug fixed
- **What you notice:** Buying an item into a full bag works only when the bag holds a stack of exactly that item; otherwise you read "You don't have enough room in your inventory!" and nothing changes.
- **1.6:** The room test passed when the bag text merely contained the item's name, but the add stacked only on an exact name, so Amber took the stock and the gold went nowhere while no Pie arrived.
- **SSO:** The room test uses the same exact-name rule as the add.
- **Why:** A purchase should either deliver the item or not happen.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `bug fixed: a full bag holding 'Orc Pot Pie' has no room for a 'Pie'; nothing changes` (packages/server/tests/economy.test.ts)

### The bank says what it did, and why it refused
- **Kind:** Bug fixed
- **What you notice:** A deposit reads "You deposit N gold. You now have M gold in the bank." and a withdrawal "You withdraw N gold. You now have M gold in the bank." Asking for more than you have says "You don't have that much gold to deposit." or "You don't have that much gold in the bank.", and a missing amount shows how to type the command.
- **1.6:** Both failures and a missing amount were silent, and a withdrawal answered with the deposit's line; the withdrawal messages were never sent.
- **SSO:** Each outcome has its own line.
- **Why:** Silence after a command looks like lag or a lost message.
- **In the code:** `packages/server/src/systems/economy/bank.ts` (`runBank`, `BANK_TEXT`); `packages/server/src/systems/economy/intents.ts` (`bankChat`)
- **Pinned by:** `bug fixed: a deposit and a withdrawal each say what they did, and every failure says why` (packages/server/tests/economy.test.ts)

### The bank needs a living banker
- **Kind:** Bug fixed
- **What you notice:** The bank commands work only while Cril, Andero or another banker is alive on your map; otherwise "You cannot bank here!"
- **1.6:** The check read the roster loaded with the map, which a death did not clear, so the bank worked with the banker dead or never spawned.
- **SSO:** A banker counts while its roster slot has a live NPC.
- **Why:** A dead banker should not keep the bank open.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`canBank`, `bankChat`)
- **Pinned by:** `bug fixed: the bank needs a living banker on the map; else 'You cannot bank here!'` (packages/server/tests/economy.test.ts); `bug fixed: the bank needs a living banker: off the roster, or rostered but not spawned, 'You cannot bank here!'` (packages/server/e2e/npcs-shops-trade.test.ts)

### Gold given to an NPC reads correctly
- **Kind:** Bug fixed
- **What you notice:** Handing gold to an NPC shows "*** Offering the <n> gold to <Name>." and then `<Name> says "Thanks for the gold!"` with its closing quote.
- **1.6:** The offer line had a double space before "to", and the reply was missing its closing quote.
- **SSO:** Both lines are written as intended.
- **Why:** Typo fixes.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`giveGoldToNpc`); `packages/server/src/systems/monsters/npc.ts` (`NPC_TEXT`)
- **Pinned by:** `bug fixed: the offer line, then 'Thanks for the gold!' with its closing quote; the NPC's GLD grows` (packages/server/tests/npcs-trade.test.ts)

### Both traders accept, and may change their offers
- **Kind:** Bug fixed
- **What you notice:** Your offer stays editable after you press Trade; press Trade again to change it. Once both offers are in, both players get an Accept button (the partner's sits left of their Trade button). The trade goes through when both have accepted, and both read "The trade is complete." Changing an offer clears both acceptances and tells the partner. Whoever cancels reads "You cancel the trade."
- **1.6:** An offer locked once sent and its Trade button hid. Only the starter had Accept, and the partner agreed only by sending an offer. A completed trade printed nothing, and a partner who cancelled was told nothing.
- **SSO:** The server keeps each side's acceptance, cleared by any change of either offer, and settles on the second. The partner's Accept reuses the original Accept art.
- **Why:** Both players should agree to the final offers, and should be able to fix a mistake without cancelling.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`offerTrade`, `acceptTrade`, `cancelTrade`); `packages/client/src/ui/trade.ts` (`createTradeWindow`)
- **Pinned by:** `bug fixed: A offers, B offers, both accept: one move, and both are told it is complete`; `bug fixed: either side can change its offer, which clears both acceptances`; `bug fixed: Cancel: whoever cancels hears 'You cancel the trade.', the partner 'Trade cancelled.'` (packages/server/tests/npcs-trade.test.ts); `bug fixed: B has an Accept of its own once both offers are in` (packages/client/tests/npcs.test.ts)

### Withdrawing into a full bag is refused instead of destroying the item
- **Kind:** Bug fixed
- **What you notice:** Taking a Pie out of storage into a full bag that holds an "Orc Pot Pie" reads "You are carrying too much to withdraw this item." and the Pie stays where it was.
- **1.6:** The room test passed on any bag text containing the item's name, but the add needed an exact name, so nothing arrived and the line was still deleted.
- **SSO:** Withdrawal uses the exact-name room rule, and the stored line is removed only once the item is in the bag.
- **Why:** Storage should never destroy an item.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`withdrawVault`); `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)
- **Pinned by:** `bug fixed: withdrawing 'Pie' into a full bag holding 'Orc Pot Pie' is refused and keeps the Pie` (packages/server/tests/economy.test.ts)

### A vault stays where you opened it
- **Kind:** Bug fixed
- **What you notice:** An open vault or container keeps your keys locked until you press Cancel, so you stay in front of it. While it is open you can Drop items from your bag straight into it, and its list updates. Each take says "You take a <item> out of the container.", and the drop line appears only when the item went in. Changing map closes the window.
- **1.6:** Opening locked the keys and the bag ignored clicks, so nothing could be stored through the window; the first take freed the keys and you could walk off and keep withdrawing from afar. A take printed nothing, and the drop line printed before the capacity check, even when the item was refused.
- **SSO:** Takes leave the window open and the keys locked, so you cannot walk or be shoved; Drop with a window open deposits into it; the server closes the window on a map change. The list is refreshed for everyone viewing it after any deposit or take.
- **Why:** A storage window should work like one, and should not be usable from across the map.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`openVault`, `withdrawVault`, `depositVault`); `packages/server/src/systems/economy/containers.ts` (`depositContainer`, `withdrawContainer`); `packages/server/src/systems/inventory/items.ts` (`dropIntent`); `packages/client/src/app.ts` (`startApp`)
- **Pinned by:** `bug fixed: a withdrawal keeps the window open and the keys locked, says so, and stacks on an exact name`; `bug fixed: deposit checks the capacity before the drop line; containers refused; an open list is refreshed` (packages/server/tests/economy.test.ts); `bug fixed: with a container open, Drop stores into it and everyone with it open sees the item` (packages/server/tests/craft.test.ts); `bug fixed: a take keeps the keys locked, so you cannot walk off with the window open` (packages/server/tests/doors.test.ts); `an open container holds you in place: after a take you still cannot be shoved` (packages/server/tests/craft.test.ts)

### Removing a player-shop item removes only that item
- **Kind:** Bug fixed
- **What you notice:** "<Shopkeeper> remove Apple" removes the Apple's sale and buy lines and nothing else: Apple Pie, the profile and the gold line stay. A name that is not for sale, such as a single letter, is refused.
- **1.6:** Every non-empty line among the first 30 containing the name was dropped, whatever its kind, and empty lines and lines past 30 were lost. Another item's stock could block the removal.
- **SSO:** The item is matched by its exact name; only its stock decides whether it can go.
- **Why:** One command should change one item.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`removeItem`)
- **Pinned by:** `RemoveItem: not selling, in stock, removed`; `bug fixed: removing Apple leaves Apple Pie and every other line` (packages/shared/tests/economy/playershop.test.ts)

### Pricing a player-shop item changes only that item
- **Kind:** Bug fixed
- **What you notice:** Setting a price updates that item where it stands in the list, keeping its stock; a new item is added at the end. Setting "Fish" leaves "Fish Sticks" alone, and an owner called Alex can sell Ale.
- **1.6:** Lines 1-30 were rebuilt without every line containing the item's name (the owner line included), the last matching sale line's stock moved to the new line, empty lines and lines past 30 were lost, and a re-priced item moved to the end.
- **SSO:** The item's own sale and buy lines are rewritten in place; every other line stays.
- **Why:** One command should change one item.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`)
- **Pinned by:** `bug fixed: SetPrices touches only the item's own lines; Alex keeps his OWN| line`; `bug fixed: setting Fish leaves Fish Sticks, its stock and its place alone`; `bug fixed: re-pricing keeps the item's stock and its place in the list`; `bug fixed: empty lines and lines past 30 are kept` (packages/shared/tests/economy/playershop.test.ts)

### A player shop's ten-item limit counts every item
- **Kind:** Bug fixed
- **What you notice:** A player shop sells at most ten items, counted over its whole file; re-pricing an item it already sells is always allowed.
- **1.6:** Only sale lines among the first 30 lines counted, and any sale line starting with the name counted as the same item.
- **SSO:** Every sale line counts, and "already for sale" means exactly that name.
- **Why:** The limit should not depend on where lines sit.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`, `SHOP_MAX_ITEMS`)
- **Pinned by:** `bug fixed: max 10 counts every SEL line in the file; a re-priced item is not new` (packages/shared/tests/economy/playershop.test.ts)

### The seventh player-shop item can be bought
- **Kind:** Bug fixed
- **What you notice:** All of a player shop's items can be bought, the seventh and later included.
- **1.6:** A new shop's seventh sale line fell on file line 18, past the NPC buy routine's line-17 limit, so it always answered out of stock.
- **SSO:** Purchases use the chosen line wherever it is (see "Any listed item can be bought").
- **Why:** A shop should sell what it lists.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`); `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `the seventh item lands on line 18, where it can be bought` (packages/shared/tests/economy/playershop.test.ts); `bug fixed: the seventh item, on line 18, can be bought` (packages/server/tests/playershop-db.test.ts)

### Shop commands are not said aloud
- **Kind:** Bug fixed
- **What you notice:** A shop command (set, remove, register, inventory, profile, title) is answered by the shopkeeper without your line being said to the room, and costs no chat cooldown. Like talk, it works only where you can speak in a house (y 10 or less).
- **1.6:** The line was said to the room as ordinary chat first, and the command still ran deeper in the house where talking was refused.
- **SSO:** A recognised command is handled before the line would be said; the house rule applies first.
- **Why:** Running your shop should not broadcast your prices or tills, and should follow the house's talk rule.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`); `packages/server/src/systems/economy/playershop.ts` (`shopCommand`)
- **Pinned by:** `bug fixed: a command is answered without being said aloud; at y > 10 it is refused like talk`; `bug fixed: a command costs no chat cooldown and runs under one` (packages/server/tests/playershop-db.test.ts)

### A player shop's stock list goes to the owner only
- **Kind:** Bug fixed
- **What you notice:** The inventory command tells the till and each item's stock to the owner alone.
- **1.6:** The stock lines were sent so the owner's client repeated them to the room.
- **SSO:** All the lines go to the owner.
- **Why:** The stock is the owner's business.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`shopStockLines`); `packages/server/src/systems/economy/playershop.ts` (`shopCommand`)
- **Pinned by:** `bug fixed: Inventory tells the till and the stock to the owner alone` (packages/server/tests/playershop-db.test.ts)

### Player-shop register and stock lines read correctly
- **Kind:** Bug fixed
- **What you notice:** The till line is `<N> says "I have <g> gold in the register..."` with its closing quote, and each stock line reads `<N> says "I have 3 Chunk of Iron in stock."`.
- **1.6:** The till line had no closing quote, and a plain "s" was added to every name unless the stock was 1 ("Chunk of Irons", "Fishs").
- **SSO:** The lines close their quote and name each item as it is.
- **Why:** Typo and grammar fixes.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`SHOP_TEXT`)
- **Pinned by:** `bug fixed: the till line has its closing quote; the stock lines name each item as it is` (packages/shared/tests/economy/playershop.test.ts)

### The cauldron no longer fizzles on every deposit
- **Kind:** Bug fixed
- **What you notice:** Putting an ingredient in a cauldron that completes nothing just shows the drop line; a completed recipe still says so.
- **1.6:** Every deposit that completed no recipe, even the first ingredient, printed "The cauldron bubbles...but then fizzles out."
- **SSO:** Only a brew prints a cauldron line.
- **Why:** The fizzle read as a failure when nothing had gone wrong.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`depositContainer`); `packages/shared/src/rules/crafting/craft.ts` (`cauldronBrew`)
- **Pinned by:** `bug fixed: a deposit that completes nothing does not fizzle` (packages/server/tests/craft.test.ts)

### Storage on a carried container says what it opened
- **Kind:** Bug fixed
- **What you notice:** Pressing Storage on a carried Crate, Cabinet, Wind Cabinet or Cauldron prints "You open the <kind> to see what's inside...".
- **1.6:** The button built its line only for a Cabinet or a Chest, so a Crate or Cauldron opened silently.
- **SSO:** Every kind gets the line, with its id stripped.
- **Why:** Consistent feedback.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`storageIntent`)
- **Pinned by:** `bug fixed: Storage on a Crate, Cabinet or Cauldron says what it opened` (packages/server/tests/craft.test.ts)

### Player shops can stock crystals
- **Kind:** Bug fixed
- **What you notice:** "<Shopkeeper> set Blue Crystals=30,15" works for every crystal colour.
- **1.6:** The shop's allow-list names crystals in the singular ("Blue Crystal"), but every bag and NPC holds "<colour> Crystals", so none was ever accepted.
- **SSO:** The plural of a listed crystal is accepted too.
- **Why:** The list clearly meant to allow crystals.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`onShopWhitelist`)
- **Pinned by:** `set: the whitelist, case ignored, the name as typed` (packages/shared/tests/economy/playershop.test.ts)

### Crystals come out of storage as themselves
- **Kind:** Bug fixed
- **What you notice:** Withdrawing Blue Crystals (or any colour) from a vault or container gives back Blue Crystals.
- **1.6:** A line containing " Crystals" was split on spaces and words 2 and 3 joined, giving a worthless "Crystals " item.
- **SSO:** The stored line is added unchanged.
- **Why:** Storage should return what was stored.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`withdrawVault`); `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)
- **Pinned by:** `bug fixed: a crystal line comes back as the same crystals` (packages/server/tests/economy.test.ts)

### Quest replies are heard by the whole map
- **Kind:** Bug fixed
- **What you notice:** Asking for a quest, every NPC's "Bring me a…" reply is heard by everyone on the map, as your question was, and closes its quote.
- **1.6:** Slot 1's reply went to the asker alone while slots 2-4 and slot 1's "Sorry…" went to the map, and "Bring me a…" had no closing quote.
- **SSO:** Every reply goes to the map. An NPC answers only for quest lines that name it exactly.
- **Why:** One rule for every NPC.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`sayQuest`); `packages/server/src/systems/economy/quests.ts` (`askForQuest`)
- **Pinned by:** `bug fixed: every quest reply is heard by the map and closes its quote` (packages/shared/tests/social/factions.test.ts); `bug fixed: SayQuest: every slot's reply is heard by the map, with its closing quote` (packages/server/tests/factions.test.ts)

### Handing in a head takes the head you gave
- **Kind:** Bug fixed
- **What you notice:** Giving a faction leader a head takes it from the bag slot you chose.
- **1.6:** The chosen slot only had to hold a head; one was taken from the first slot that contained one.
- **SSO:** The head comes off the chosen slot.
- **Why:** Players choose what they give.
- **In the code:** `packages/server/src/systems/economy/quests.ts` (`questGive`)
- **Pinned by:** `bug fixed: turn-in takes the head you gave, not the first in the bag` (packages/server/tests/factions.test.ts)

### Quest lines match exactly, and the first match wins
- **Kind:** Bug fixed
- **What you notice:** An NPC takes an item only for a quest line naming exactly that NPC and that item. Giving Stephie a Fish no longer pays her Fishle reward.
- **1.6:** The last of the first 40 lines containing "<NPC>:<item>" won, so any line whose text contained yours could pay.
- **SSO:** The NPC and item fields are compared exactly (case and surrounding spaces ignored), and the first matching line is used.
- **Why:** Quests should want what they say.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questMatch`)
- **Pinned by:** `bug fixed: quest lines match the NPC and item exactly, and the first match wins` (packages/shared/tests/social/factions.test.ts); `bug fixed: Fish given to Stephie is not her Fishle; nothing is taken` (packages/server/tests/factions.test.ts)

### A quest hand-in leaves your stack names alone
- **Kind:** Bug fixed
- **What you notice:** The item comes off the slot you gave it from, and the reward stacks only on a stack of exactly its name, so no stack is renamed.
- **1.6:** The given item came off the first slot containing its name and that slot was rewritten under the given name (a Gold Fish stack given as Fish became Fish); the reward did the same to the first slot containing its name.
- **SSO:** Taking and stacking use the chosen slot and exact names.
- **Why:** A hand-in should not change other items.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questTake`, `questReward`)
- **Pinned by:** `bug fixed: the item comes off the slot you gave from, which keeps its name`; `bug fixed: the reward stacks on its exact name, keeping the stack's spelling, else the lowest empty slot` (packages/shared/tests/social/factions.test.ts)

### A quest reward with no room stops the hand-in
- **Kind:** Bug fixed
- **What you notice:** With a full bag and nowhere for the reward, the NPC says `"You have no room in your bag for my reward."` and nothing is taken. Giving the last of a stack frees its slot for the reward.
- **1.6:** The reward overwrote whatever was left of the stack you gave from.
- **SSO:** Room is checked before anything is taken.
- **Why:** A reward should never destroy items.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questRoom`, `questReward`); `packages/server/src/systems/economy/quests.ts` (`questGive`, `QUEST_TEXT`)
- **Pinned by:** `bug fixed: a reward to a full bag has no room unless the given stack empties` (packages/shared/tests/social/factions.test.ts); `bug fixed: a reward with no room is refused and nothing is taken` (packages/server/tests/factions.test.ts)

### Every new quest names an NPC
- **Kind:** Bug fixed
- **What you notice:** Every quest line has an NPC who will take it; the archive's nameless ":Steel Key:Trumpet" is replaced with a new quest when the server starts.
- **1.6:** The NPC was picked by a 44-way roll in which roll 29 named nobody, writing a line starting with a bare colon that no NPC would answer. A wanted item could carry a trailing space ("Silver Token ").
- **SSO:** The NPC is picked evenly among the 43 named NPCs and item names are trimmed. On load or first seeding, any stored line that names no NPC is rerolled and saved.
- **Why:** A quest nobody can hand in is a dead line.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`findNewQuest`, `questLineUnanswerable`); `packages/server/src/game.ts` (`createGame`)
- **Pinned by:** `bug fixed: FindNewQuest always names an NPC, each named one equally likely` (packages/shared/tests/social/factions.test.ts); `a quest turn-in writes the bag and the rerolled line, which survive a restart` (packages/server/tests/factions-db.test.ts)

## housing

### Server clock drives house decay
- **Kind:** Exploit closed
- **What you notice:** House decay follows the server's calendar and the operator's configured time zone.
- **1.6:** Any client supplied the shared calendar month; a forged month sent repeatedly could demolish every house.
- **SSO:** The server gets the date using `houseDecayTimeZone`, UTC by default. An owner's houses are refreshed at login and every 1,230 frames while they are online; the sweep runs once a day (see "House decay sweeps once a day").
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
- **SSO:** One timer per map: every door or switch change sets it to 200. Arriving and refused switch clicks set nothing, and the timer keeps running while the map is empty (see the "Bug fixed" entries below).
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

### Unbuildable deeds say so
- **Kind:** Bug fixed
- **What you notice:** Using a Boat Deed, a Battleship Deed or a Stone Guild Hall Deed says "Boats cannot be built yet, so this deed can't be used." (or the Battleship or Stone Guild Hall version) and keeps the deed.
- **1.6:** The Stone Guild Hall had a deed but no house art, template or builder, and the deed handler exited before the boat builder for the Boat and Battleship, so all three did nothing and said nothing.
- **SSO:** The deeds still build nothing, since there is no art or template to build from, but Use explains why and the deed stays in the bag. The texts are in `houses.json` (`deeds[].text`).
- **Why:** A silent item reads as a broken click. Building them is planned: boats and battleships in [#2](https://github.com/jberlyn/second-star-online/issues/2), the Stone Guild Hall in [#10](https://github.com/jberlyn/second-star-online/issues/10).
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`deedUse`), `packages/server/src/systems/housing/houses.ts` (`useDeed`)
- **Pinned by:** `bug fixed: Boat and Battleship Deeds say they cannot be built`; `bug fixed: the Stone Guild Hall Deed says it cannot be built` (packages/shared/tests/housing/houses.test.ts); `bug fixed: a Boat Deed says it cannot be built and is kept` (packages/server/tests/houses-db.test.ts)

### The Small Farm lands where the other houses do
- **Kind:** Bug fixed
- **What you notice:** The Small Farm's ghost and the farm it builds sit in the same place relative to your cursor as the Large House's.
- **1.6:** The step that moves the anchor up a row tested for the misspelt "Small Fam", so the farm kept the hovered row and was drawn and built one row lower.
- **SSO:** Every house anchors one column left and one row up of the hovered tile; the farm's ghost moves up with it.
- **Why:** The misspelling was a typo, not a design.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`houseAnchor`, `ghostRect`)
- **Pinned by:** `bug fixed: the Small Farm anchors one up and one left like every house, its ghost to match` (packages/shared/tests/housing/houses.test.ts)

### The whole footprint is checked for terrain
- **Kind:** Bug fixed
- **What you notice:** A 5-wide house is refused when any of its 15 tiles is rough ground, not just the left three columns.
- **1.6:** The ground test read a map line whose last two columns came back empty and counted only the first three columns against a fixed pass mark of 9.
- **SSO:** Every footprint tile's layer-1 code must be a build code.
- **Why:** Houses could stand half over water or rock.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `bug fixed: layer 1 is checked on every column of a 5-wide house` (packages/shared/tests/housing/houses.test.ts)

### Houses can be anchored on rows 8 and 9
- **Kind:** Bug fixed
- **What you notice:** A house can be placed with its top row on row 8 or 9, as the edge rule allows.
- **1.6:** The ground test read rows 10 and 11 by item number from the map record, landing on the NPC and monster fields, which never matched.
- **SSO:** Every footprint row reads the map's own layer 1.
- **Why:** The bottom of every map was unbuildable by accident.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `bug fixed: a house can be anchored on rows 8 and 9; its rows 10 and 11 read the map` (packages/shared/tests/housing/houses.test.ts)

### 8V counts as house ground
- **Kind:** Bug fixed
- **What you notice:** Ground of type 8V can be built on, like 8R and 8U.
- **1.6:** The ground test was a text match against `*8R*8U*8V` with no closing star, so `*8V*` never matched.
- **SSO:** Each code is compared whole, case ignored.
- **Why:** 8V is listed as house ground; the missing star dropped it.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `bug fixed: 8V counts as house ground like 8R and 8U, matched whole` (packages/shared/tests/housing/houses.test.ts)

### Only what is on the footprint is in the way
- **Kind:** Bug fixed
- **What you notice:** Items, monsters and players next to the house, and the builder standing beside it, no longer block placement. Something on a footprint tile still does.
- **1.6:** The ghost's bounding rectangle, which sits a pixel or two right of and above the footprint, was tested against item, monster and player sprites, so neighbours and the builder's own sprite counted.
- **SSO:** The server tests the footprint's tiles against the tiles items, monsters (a wide monster's three) and players (and a walker's next tile) stand on.
- **Why:** Placement should match what the ghost covers.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`checkPlacement`, `inFootprint`), `packages/server/src/systems/housing/houses.ts` (`obstacleTiles`)
- **Pinned by:** `bug fixed: only something on the footprint itself is in the way` (packages/shared/tests/housing/houses.test.ts); `bug fixed: standing beside the footprint is not in the way` (packages/server/tests/houses-db.test.ts)

### A demolished Small Shop takes its street lamp
- **Kind:** Bug fixed
- **What you notice:** When a Small Shop decays, its street lamp goes too.
- **1.6:** The lamp was dropped one row lower than the place recorded for it, and demolition removed by exact match, so it was never found.
- **SSO:** The lamp is recorded where it is dropped. The upgrade moves the lamp in existing shops' records down a row to match.
- **Why:** Demolition should leave nothing of the house behind.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`planHouse`), `packages/server/migrations/20261118_30_house_decay.sql`
- **Pinned by:** `bug fixed: the Small Shop's lamp is recorded where it is dropped, so demolition finds it` (packages/shared/tests/housing/houses.test.ts); `bug fixed: a Small Shop's street lamp goes with it`; `the migration names each list entry's house, gives its month a year and moves the shop lamp` (packages/server/tests/houses-db.test.ts)

### Decay takes only the stale house, and counts the year
- **Kind:** Bug fixed
- **What you notice:** A house decays on its own; the owner's other houses are judged separately. A house whose owner was last seen in this month a year ago decays.
- **1.6:** The remover matched every list entry with the owner's name, and months were compared with no year.
- **SSO:** Each list entry names its house (by interior) and stores its month with the year (`YYYY-MM`). A house goes once its owner was last seen two or more calendar months ago (`decay.staleAfterMonths`). The upgrade gives existing entries this year, or last year for a month later than this one.
- **Why:** One stale entry should not cost an owner every house, and a year-old visit is not recent.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`sweep`, `monthIndex`), `packages/server/src/systems/housing/houses.ts` (`demolish`)
- **Pinned by:** `bug fixed: a stale house goes alone; the owner's other houses and the year count` (packages/shared/tests/housing/houses.test.ts); `a stale owner's house is demolished by the day's sweep: tiles revert, Exit and mailbox go, the interior is deleted` (packages/server/tests/houses-db.test.ts)

### The decay sweep's removals stay removed
- **Kind:** Bug fixed
- **What you notice:** After a sweep, the list holds only the houses still standing.
- **1.6:** The sweep looped over an old copy of the list and each removal rewrote the list from that copy, so earlier removals came back as entries for houses that were gone.
- **SSO:** The sweep removes every demolished house's entries at once.
- **Why:** Zombie entries were demolished again on later sweeps.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`sweep`)
- **Pinned by:** `bug fixed: every house the sweep removes stays removed` (packages/shared/tests/housing/houses.test.ts)

### Each house keeps its own blueprint
- **Kind:** Bug fixed
- **What you notice:** If you own two houses on one map, demolishing them restores the ground under both.
- **1.6:** One blueprint was saved per owner and map, so a second house overwrote the first's.
- **SSO:** Blueprints are keyed by the house's interior. Records already overwritten on an older server cannot be recovered; those houses keep standing.
- **Why:** A lost blueprint left a house that could never be cleared.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`, `demolish`)
- **Pinned by:** `bug fixed: two houses on one map are two entries, judged apart` (packages/shared/tests/housing/houses.test.ts); `bug fixed: two houses by one owner on one map keep a blueprint each, and both are reverted` (packages/server/tests/houses-db.test.ts)

### House decay sweeps once a day
- **Kind:** Bug fixed
- **What you notice:** Stale houses are removed at the first clock check of each day (in the decay time zone), whoever is online, rather than at random while you play.
- **1.6:** Every date message (twice at login, then about once a minute for each online client) rolled 1 in 50 for a sweep, so busier servers swept far more often.
- **SSO:** Each clock check still refreshes its player's houses, and a login is one check; the sweep runs once per calendar day.
- **Why:** Decay should not depend on how many people are online.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`monthCheck`, `houseClockStep`)
- **Pinned by:** `bug fixed: the sweep runs once a day, not on every clock check`; `an owner's own login refreshes their entries before the sweep` (packages/server/tests/houses-db.test.ts)

### The dead do not rest
- **Kind:** Bug fixed
- **What you notice:** Resting near the top of a house map no longer heals you while you are dead.
- **1.6:** The house rest-healing had no death check.
- **SSO:** Rest regeneration skips a player in the death lock.
- **Why:** Healing a corpse made no sense and changed what the respawn restored.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`restRegen`)
- **Pinned by:** `bug fixed: the dead do not rest` (packages/server/tests/houses-db.test.ts)

### Your own stations are always yours
- **Kind:** Bug fixed
- **What you notice:** Ctrl carries off your own Stove, Anvil or Alchemy Lab, even after a station elsewhere showed its line. A click shows the station's line wherever it stands (see "A click uses a station or casino table; Ctrl carries off your own").
- **1.6:** A click set the "don't pick this up" flag but never cleared it; only Drop reset it.
- **SSO:** Whether you are on your own premises is worked out from the room you are in on every Ctrl.
- **Why:** Whether a station is yours depends on where it stands, not on what you clicked before.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`headDrop`), `packages/server/src/systems/inventory/items.ts` (`actionIntent`)
- **Pinned by:** `a room whose header names you is 0; anywhere else is 1` (packages/shared/tests/housing/houses.test.ts); `bug fixed: a click on your own Anvil shows its line; Ctrl carries it off, even after a refusal elsewhere` (packages/server/tests/houses-db.test.ts)

### Coloured keys are spent only when they open
- **Kind:** Bug fixed
- **What you notice:** A coloured key is used up when it opens its door; closing the door with it is free. The 425-frame pause stays.
- **1.6:** The key routine spent the key on every use, so one door cost two keys.
- **SSO:** Only an opening turn spends the key.
- **Why:** Doors relock by themselves, so a second key to close one was pure loss.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`keyConsumed`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `bug fixed: a coloured key is spent opening its door, not closing it; Keys.txt has no Inf` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a coloured key is spent opening its door, not closing it; it pauses 425` (packages/server/tests/doors.test.ts)

### A key or switch changes only what you use it on
- **Kind:** Bug fixed
- **What you notice:** Opening a Steel Door opens that door only; flipping a switch flips that switch only (its switch doors on the map still open or close together). Bob's House Key no longer opens Jimbob's Door.
- **1.6:** Every item on the map whose name contained the old name was renamed.
- **SSO:** A key renames the door you face and a switch renames itself, by item. A switch's doors and the relock still change every door of an exact name.
- **Why:** One door should not unlock a whole map, nor one owner's key another's house.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`renameTargets`, `switchFlip`), `packages/server/src/systems/housing/doors.ts` (`useKey`, `switchClick`, `renameDoors`)
- **Pinned by:** `bug fixed: a map-wide rename matches whole names only` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a key opens only the Steel Door you face`; `bug fixed: Bob's House Key leaves Jimbob's Door alone`; `bug fixed: a switch flips only itself` (packages/server/tests/doors.test.ts)

### Player and guild doors relock
- **Kind:** Bug fixed
- **What you notice:** A house or guild hall door opened with a key shuts by itself 200 frames after the map's last door change, like coloured and switch doors.
- **1.6:** The close-all routine listed only switch and coloured doors.
- **SSO:** The relock also turns "<owner>'s Opened Door" back into "<owner>'s Door".
- **Why:** An open house door stayed open for anyone until its owner came back.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`closeAllDoors`, `closedName`), `packages/server/src/systems/housing/doors.ts` (`relockStep`)
- **Pinned by:** `bug fixed: CloseAllDoors closes coloured, switch, player and guild doors and ON switches` (packages/shared/tests/housing/doors.test.ts); `bug fixed: player and guild doors relock like the others` (packages/server/tests/doors.test.ts)

### House and Guild Keys pause after each turn
- **Kind:** Bug fixed
- **What you notice:** After a House Key or Guild Key turns a door you wait 100 frames before the next item action, as after a switch. The key stays in your bag.
- **1.6:** These keys went straight to the door change with no action pause, so a door could be flipped every frame.
- **SSO:** They pause 100 frames (`keys.housePause`) and are still never spent. Being kept is intended: the key is how an owner gets in.
- **Why:** Rapid toggling flooded the map with door changes.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`keyPause`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `bug fixed: House and Guild Keys are kept and pause 100 after each turn` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a House Key pauses 100 after each turn and is kept`; `bug fixed: a Guild Key pauses 100 and is kept` (packages/server/tests/doors.test.ts)

### A refused switch click changes nothing
- **Kind:** Bug fixed
- **What you notice:** Clicking a switch from across the room gives the "standing in front of it" line and nothing else; the map's doors keep their timing.
- **1.6:** The relock countdown was started at 100 before the adjacency check.
- **SSO:** Nothing is armed until the switch actually flips.
- **Why:** A refused action should not shut other players' doors.
- **In the code:** `packages/server/src/systems/housing/doors.ts` (`switchClick`)
- **Pinned by:** `bug fixed: a refused switch click leaves the relock alone` (packages/server/tests/doors.test.ts)

### Doors close on their own timer, whoever is on the map
- **Kind:** Bug fixed
- **What you notice:** Doors close 200 frames after they were last changed. Arriving on a map does not change when they close, and doors on a map nobody is on still close on time.
- **1.6:** Loading a map started a 150-frame countdown, and an empty map counted nothing, so its doors stayed open until someone arrived.
- **SSO:** Arrival sets nothing. When a map empties its timer is kept as the tick it falls due; when the map is next loaded the doors close then, or on the first frame if that tick has passed. Doors found open with no timer (after a restart) close on the first frame.
- **Why:** Door timing should not depend on who walks in.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`RELOCK_FRAMES`, `anyOpenDoor`), `packages/server/src/systems/world/world.ts` (`enterRoom`, `leaveRoom`)
- **Pinned by:** `bug fixed: arriving on a map leaves a running relock alone`; `bug fixed: doors on a map nobody is on still close on time` (packages/server/tests/doors.test.ts)

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

### Nothing is dropped from an airship
- **Kind:** Bug fixed
- **What you notice:** Aboard an airship, dropping gold, crystals or a Pig is refused with the same "from the sky" line as any other item. Giving to a player in front still works.
- **1.6:** The sky test sat after the gold and crystal handling and after the Pig, so those three still fell from the airship.
- **SSO:** The gold and crystal dialogs' drop path and the Pig drop make the same vehicle test as Drop.
- **Why:** The rule is that nothing leaves the bag in the sky; the test was simply in the wrong place.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`, `crystalsIntent`, `goldIntent`)
- **Pinned by:** `bug fixed: aboard an airship items, gold and crystals are all refused 'from the sky'` (packages/server/tests/vehicles.test.ts); `bug fixed: a pig is refused from an Airship and kept` (packages/server/tests/pigs-orbs-webs.test.ts)

### Ctrl aboard an airship takes what is in front
- **Kind:** Bug fixed
- **What you notice:** Riding an airship, Ctrl picks up or uses the item or Pig in front of you, as on foot. With nothing in front, Ctrl unboards.
- **1.6:** Ctrl tested for the airship before anything else and only ever tried to unboard; only a mouse click could pick anything up.
- **SSO:** Ctrl unboards only when the faced tile holds no item and no monster.
- **Why:** The key did one thing aboard and another on foot for no reason a player could see.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`actionIntent`), `packages/server/src/systems/vehicles/airship.ts` (`unboardAirship`)
- **Pinned by:** `bug fixed: Ctrl aboard an airship takes what is in front, and unboards when nothing is` (packages/server/tests/vehicles.test.ts)

### The Experience Platform names the level it checks
- **Kind:** Bug fixed
- **What you notice:** A click or Ctrl on the Experience Platform says "You must be level 21 or higher to pass this platform.", which is what lets you through.
- **1.6:** The text said you must be over 30 hit points, but the gate checked level 21.
- **SSO:** The gate is unchanged and both texts (`clickFixtures` in `houses.json`, `pickup.ctrlTexts` in `item-rules.json`) name the level.
- **Why:** The text sent players after the wrong goal.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`blocksPlayer`, `clickGate`, `ctrlGate`)
- **Pinned by:** `bug fixed: the Experience Platform names the level it checks (21 passes)` (packages/shared/tests/inventory/inventory.test.ts)

### Ctrl waits while a window holds the keys
- **Kind:** Bug fixed
- **What you notice:** With a window open that holds your keys, such as your mailbox, Ctrl does nothing, so it no longer reopens the open mailbox. Once the window closes, Ctrl works again.
- **1.6:** Ctrl waited only for the item pause and the map load, not the key lock, so it read, opened or picked up behind an open window.
- **SSO:** Ctrl waits on the same key lock as Use, Equip, Drop and the click. The client does not start Ctrl's pause while the keys are held.
- **Why:** The key lock is there to stop actions behind a window; Ctrl slipped past it.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`paused`, `actionIntent`), `packages/client/src/model.ts` (`pressAction`)
- **Pinned by:** `bug fixed: Ctrl does nothing while a window holds the key lock or the map loads`; `bug fixed: Ctrl does not reopen an open mailbox; it opens again once closed` (packages/server/tests/mail-boards.test.ts)

### A stuffed player keeps the food
- **Kind:** Bug fixed
- **What you notice:** At or above the hunger limit, using food or a potion says only "You're stuffed!" and the item stays in your bag. The bite that fills you up says just its eat line.
- **1.6:** Eating while stuffed gave nothing and still used the item up. "You're stuffed!" also followed the bite that crossed the limit.
- **SSO:** Hunger at or above 35000 refuses the use before any effect; "You're stuffed!" is that refusal's line. A new character starts stuffed, so they eat once their hunger has dropped.
- **Why:** Losing food for nothing was a trap, and the line on the filling bite read as a refusal.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`, `STUFFED`)
- **Pinned by:** `bug fixed: a stuffed player is refused and keeps the food`; `bug fixed: the bite that fills you only says the eat line; "You're stuffed!" is the refusal` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: a stuffed player is refused and keeps the food` (packages/server/tests/inventory.test.ts)

### Purple Potion says its line once and waits for hunger
- **Kind:** Bug fixed
- **What you notice:** Drinking a Purple Potion prints "The power of argon flows through your body." once. A stuffed player is refused it like any other potion.
- **1.6:** The line was added twice, and the attack boost sat outside the hunger guard, so it worked when stuffed.
- **SSO:** The line is added once, and the boost goes through the same stuffed refusal.
- **Why:** The doubled line was a slip, and one potion ignoring the hunger rule was inconsistent.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`)
- **Pinned by:** `bug fixed: Purple Potion says its line once and is refused when stuffed` (packages/shared/tests/inventory/inventory.test.ts)

### Holy Water and newspapers stop monsters
- **Kind:** Bug fixed
- **What you notice:** A monster cannot walk onto a tile holding Holy Water or a newspaper stand, as a player cannot.
- **1.6:** The monsters' blocking list left out those two rows that the players' list had.
- **SSO:** Players and monsters share one list (`ground.blocks` in `item-rules.json`).
- **Why:** The two lists were meant to match; the missing rows were an omission.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`blocksMonster`)
- **Pinned by:** `bug fixed: Holy Water and newspapers stop monsters as they stop players` (packages/shared/tests/inventory/inventory.test.ts); `a blocking item on the anchor tile aborts a monster's path` (packages/server/tests/inventory.test.ts)

### A refused Pig stays in the bag
- **Kind:** Bug fixed
- **What you notice:** Dropping a Pig where it cannot stand, including off any edge of the map, says "You can't drop an animal here!" and the Pig stays in your bag.
- **1.6:** The Pig left the bag before the summon checked the tile, so a pig dropped on a tile monsters cannot stand on, or north from the top row, was silently lost. Off the other edges the drop did nothing and said nothing.
- **SSO:** Every test the summon makes runs before the Pig leaves the bag, and each refusal says the blocked line.
- **Why:** Losing a pig without a word was never meant.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pigDrop`), `packages/server/src/systems/spells/cast.ts` (`summonPig`)
- **Pinned by:** `bug fixed: a faced tile off the map at the side, bottom or top → "You can't drop an animal here!", the pig kept` (packages/server/tests/pigs-orbs-webs.test.ts)

### A Pig drops only when other items can
- **Kind:** Bug fixed
- **What you notice:** During the short pause after using an item, or mid-step, a Pig is refused like every other item.
- **1.6:** The Pig test came before the pause, vehicle and mid-step tests, so a Pig dropped when nothing else could.
- **SSO:** The Pig test comes after them.
- **Why:** The order was an accident and let pigs skip the rules every item follows.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`, `pigDrop`)
- **Pinned by:** `bug fixed: a pig waits out the item pause and the step like any other item` (packages/server/tests/pigs-orbs-webs.test.ts)

### Only the Bo is wielded as a Bo
- **Kind:** Bug fixed
- **What you notice:** Books and the Boat Deed can no longer be equipped. The Bo still goes in the left hand.
- **1.6:** The left-hand rule for the Bo matched any name containing "Bo", so every book and the Boat Deed could be wielded, and a book hit like a bow.
- **SSO:** The rule matches the name "Bo" exactly (`equip.slots` in `item-rules.json`). Bows and boots have their own rules and are unchanged.
- **Why:** The rule was written for one weapon.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`)
- **Pinned by:** `bug fixed: only the Bo itself matches "Bo"; books and the Boat Deed cannot be equipped` (packages/shared/tests/inventory/inventory.test.ts)

### A Catfish Sandwich cannot be equipped
- **Kind:** Bug fixed
- **What you notice:** A Catfish Sandwich can no longer be wielded in the right hand. Alchemy sands still can.
- **1.6:** The right-hand rule meant for sand matched any name containing " Sand", including "Catfish Sandwich".
- **SSO:** A later rule makes the Catfish Sandwich "No" (`equip.slots` in `item-rules.json`).
- **Why:** Food is not held in the hand.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`)
- **Pinned by:** `bug fixed: a Catfish Sandwich cannot be equipped; alchemy sand still goes in the right hand` (packages/shared/tests/inventory/inventory.test.ts)

### The Dragon Sword can be wielded
- **Kind:** Bug fixed
- **What you notice:** A Dragon Sword goes in the left hand with Strength 26, hits for 12 plus up to 8, and is drawn with the Fire Sword's art.
- **1.6:** No rule gave the Dragon Sword a slot, attack power or picture, so Equip refused it.
- **SSO:** `item-rules.json` gives it a slot, a strength requirement and a paperdoll alias, and `attpower.json` an attack row, between the Star Sword and the Pharaoh Sword. The Dragon Sword still only appears if an operator hands one out.
- **Why:** An item that exists should be usable for what it is.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`, `strengthRequirement`)
- **Pinned by:** `bug fixed: the Dragon Sword is wielded in the left hand` (packages/shared/tests/inventory/inventory.test.ts)

### "You cannot equip the …" ends with a full stop
- **Kind:** Bug fixed
- **What you notice:** The line for an item that cannot be equipped ends with a full stop.
- **1.6:** The line was built with nothing after the item's name.
- **SSO:** The line ends with ".".
- **Why:** Every other line of its kind has one.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`EQUIP_TEXT`)
- **Pinned by:** `bug fixed: "You cannot equip the ..." ends with a full stop` (packages/shared/tests/inventory/inventory.test.ts)

### Equipping into a full slot swaps
- **Kind:** Bug fixed
- **What you notice:** Equipping an item into a slot that already holds something swaps them: the worn item goes back into your bag. If the bag has no room for it, you read "You are carrying too much to swap this for what you're wearing!" and nothing changes.
- **1.6:** The server refused with "You have to remove the current item you're wearing to equip this!", so every change of gear took two steps.
- **SSO:** The worn item needs a stack, an empty line, or the line the new item leaves.
- **Why:** The two-step change was friction with no purpose.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`checkEquip`), `packages/server/src/systems/inventory/items.ts` (`equipIntent`)
- **Pinned by:** `bug fixed: an occupied slot is no refusal (the server swaps)` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: equipping into a full slot swaps, the worn item back in the bag`; `bug fixed: a swap needs room for the worn item; a full bag refuses and changes nothing` (packages/server/tests/inventory.test.ts)

### No key is on the usable list
- **Kind:** Bug fixed
- **What you notice:** Nothing changes in play: a key is used only on a door.
- **1.6:** The five coloured keys were on the usable list, as if they could be eaten like food, but Use sent every key to the door handler first, so those rows were dead.
- **SSO:** The keys are off the usable list (`use.usable` in `item-rules.json`), so the data says what the game does.
- **Why:** A modder reading the list would expect keys to be consumed.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `bug fixed: no key is on the usable list; Use sends a key to the door rule only` (packages/server/tests/doors.test.ts)

### A full bag takes an item it can stack
- **Kind:** Bug fixed
- **What you notice:** With all 15 bag lines used, a click on a ground item you already carry picks it up onto that stack, as Ctrl does. Receiving a give works the same way.
- **1.6:** The click's bag test overwrote its stack test, so a full bag always looked full to a click and to a give; Ctrl tested correctly.
- **SSO:** Click, Ctrl and a received give share one bag test.
- **Why:** Ctrl and the click disagreed about the same bag.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`bagFull`, `pickupIntent`, `receiveGive`)
- **Pinned by:** `bug fixed: a full bag takes a clicked item it holds a stack of, as Ctrl does` (packages/server/tests/inventory.test.ts)

### Picking up takes one item
- **Kind:** Bug fixed
- **What you notice:** When identical items lie on one tile, picking one up leaves the others there.
- **1.6:** Pickup cleared every entry with the same name on the tile and granted one, so the rest vanished.
- **SSO:** Pickup removes only the entry taken.
- **Why:** The others were destroyed for nothing.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`grab`)
- **Pinned by:** `bug fixed: picking up takes the one entry and leaves its twins on the tile` (packages/server/tests/inventory.test.ts)

### Items share a tile
- **Kind:** Bug fixed
- **What you notice:** You can drop an item, gold or crystals onto a tile that already holds ordinary items, up to 10. A tile holding something that stands in the way, such as a Table or a fixture, or one already holding 10 items, is "too crowded". Dropping onto a chest, crate or vault still stores the item in it.
- **1.6:** A player's drop was refused on any tile holding any item, though loot and gathered items landed on occupied tiles.
- **SSO:** A player's drop is refused only on a tile with a blocking item (`ground.blocks`) or 10 items.
- **Why:** Loot already shared tiles; refusing only the player was inconsistent. The cap keeps a tile from becoming a dump.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`tileCrowded`, `TILE_ITEM_CAP`, `dropIntent`, `crystalsIntent`, `goldIntent`)
- **Pinned by:** `bug fixed: items share a tile; a fixture or a full tile is too crowded` (packages/server/tests/inventory.test.ts)

### A click opens a crate or cabinet; Ctrl carries it
- **Kind:** Bug fixed
- **What you notice:** Clicking a Crate, Cabinet or Wind Cabinet opens it, like a chest. Ctrl picks it up, keeping its contents, if your Strength is 15 for a crate or 19 for a cabinet; otherwise you read "You're not strong enough to pick this up!".
- **1.6:** The click fell through to pickup and never reached the chest-opening code, and Ctrl opened it before its Strength tests, which could never be reached.
- **SSO:** The click opens; Ctrl's Strength tests decide the pickup.
- **Why:** Both paths existed; each was reaching the other's half.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clickGate`, `ctrlGate`)
- **Pinned by:** `bug fixed: a click opens a crate or cabinet; Ctrl picks it up with Strength 15 or 19` (packages/shared/tests/housing/doors.test.ts); `bug fixed: a click opens a Crate on the floor; Ctrl picks it up with its id and contents` (packages/server/tests/doors.test.ts)

### A click uses a station or casino table; Ctrl carries off your own
- **Kind:** Bug fixed
- **What you notice:** Clicking a Stove, Anvil, Alchemy Lab, Slot Machine, Blackjack Table or Checkers Table always shows its line or plays its game, in your own house too. Ctrl picks one up on your own premises (your house or your guild's hall) and uses it anywhere else.
- **1.6:** In your own house the click picked a station or table up and Ctrl played it; elsewhere Ctrl took a station from anyone's house or the town.
- **SSO:** The click always uses; Ctrl takes only where the room's header names you or your guild. A painting follows the same rule: a click views it and Ctrl takes it.
- **Why:** The same click did opposite things by location, and Ctrl could carry off stations that were not yours.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clickGate`, `ctrlGate`), `packages/server/src/systems/inventory/items.ts` (`actionIntent`)
- **Pinned by:** `bug fixed: a click plays a casino game anywhere; Ctrl carries one off only from your own premises` (packages/shared/tests/casino/casino.test.ts); `bug fixed: a click on an Anvil, Stove or Alchemy Lab shows its line anywhere; Ctrl takes yours` (packages/shared/tests/housing/houses.test.ts); `a click views a painting and Ctrl takes it, as a click uses and Ctrl carries` (packages/shared/tests/inventory/inventory.test.ts)

### World fixtures are fixed in place
- **Kind:** Bug fixed
- **What you notice:** A fixture the world placed, such as a Copy Machine, Large Rock, Table, Campfire, Piano, statue, "Universal" fixture, painting or platform, cannot be picked up by a click or Ctrl: you read "This is fixed in place; you can't pick it up.". A Table you crafted and dropped can still be carried off. A click on a Piano now says "This is a piano." as Ctrl does.
- **1.6:** Neither pickup path excluded those fixtures, so players could carry off the town's furniture; a click also took the Piano.
- **SSO:** An item placed by the world editor or an immortal's `/drop` that is on the blocking list (`ground.blocks`) or is a platform is fixed in place.
- **Why:** Players could strip shared scenery from the world.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`fixedInPlace`, `clickGate`), `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `actionIntent`)
- **Pinned by:** `bug fixed: a fixture the world placed is fixed in place; a player's own is not` (packages/shared/tests/inventory/inventory.test.ts); `bug fixed: a fixture the world placed is not picked up by a click or Ctrl; a player's is` (packages/server/tests/inventory.test.ts)

### Boots are drawn on your character
- **Kind:** Bug fixed
- **What you notice:** Leather, Chain, Plate and Gold Boots show on your character's feet, for you and for everyone who sees you.
- **1.6:** The character was drawn from every equipment slot except the feet, and the game had no boot art.
- **SSO:** The paperdoll draws the Feet slot over the body. The boot layers are new art in `assets/added/paperdoll/`, made from the default body's feet in each boot's colours. Gloves are worn in the Ring slot and drawn from it, as before.
- **Why:** Worn boots should be seen.
- **In the code:** `packages/shared/src/rules/inventory/paperdoll.ts` (`normaliseLook`, `paperdollLayers`)
- **Pinned by:** `bug fixed: boots are drawn over the body from the Feet slot; gloves are worn in the Ring slot` (packages/shared/tests/inventory/inventory.test.ts)

### Crystals are dropped or given by the button you chose
- **Kind:** Bug fixed
- **What you notice:** Drop on crystals asks "Drop how many …?" and drops them on the faced tile even when a player stands there; Give asks "Give how many …?" and hands them to the player in front, or says you must be standing in front of someone. Gold has one button, so it still gives to a player in front and otherwise drops.
- **1.6:** Both buttons opened the same window, whose OK gave whenever a player was in front.
- **SSO:** The crystal request carries the button (`mode`).
- **Why:** Pressing Drop and having the crystals given away ignored the player's choice.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`crystalsIntent`), `packages/client/src/ui/amount.ts` (`crystalTitle`)
- **Pinned by:** `bug fixed: Give on crystals gives them, naming the pile, to the player in front`; `bug fixed: Drop on crystals drops them even facing a player` (packages/server/tests/inventory.test.ts); `crystals keep the last amount; the saved field text is 2` (packages/client/tests/panel.test.ts)

### Give lines name the gold and crystals
- **Kind:** Bug fixed
- **What you notice:** Giving gold reads "*** Offering the 50 gold to Bob." and Bob reads "Alice is giving you 50 Gold.". Giving crystals reads "*** Offering the 4 Red Crystals to Bob.".
- **1.6:** The gold line named only the amount ("Offering the 50 to Bob"), the crystal line left a blank ("Offering the  to Bob"), and the receiver read "a 50 Gold".
- **SSO:** The lines name the pile, in the wording of the NPC gold line.
- **Why:** The lines did not say what was given.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`GIVE_TEXT`, `receiveGive`)
- **Pinned by:** `bug fixed: give says 'Offering the 50 gold to B.'; B has it at once`; `bug fixed: a gold give says "A is giving you 50 Gold."` (packages/server/tests/inventory.test.ts)

### A given painting is named without its number
- **Kind:** Bug fixed
- **What you notice:** When someone gives you a painting, you read "Bob is giving you a Painting.", as the giver's line names it.
- **1.6:** The receiver's line used the stored name with its "#" number ("a Painting#12"), while the giver's line stripped it.
- **SSO:** The receiver's line strips the number too.
- **Why:** The number is an internal id.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`receiveGive`)
- **Pinned by:** `bug fixed: a given painting is named without its # number` (packages/server/tests/inventory.test.ts)

### The amount window's OK always clicks
- **Kind:** Bug fixed
- **What you notice:** OK in the gold and crystal amount window clicks every time you press it, whether you give, drop or are refused.
- **1.6:** The click came only on the drop path, so a give, even a successful one, was silent.
- **SSO:** The window plays the click on every OK press.
- **Why:** A button that clicks only sometimes feels broken.
- **In the code:** `packages/client/src/ui/amount.ts` (`createAmountDialog`)
- **Pinned by:** `bug fixed: OK clicks on every press, give, drop or refusal alike` (packages/client/tests/sound.test.ts)

### A placed clock goes round once an hour
- **Kind:** Bug fixed
- **What you notice:** A clock's hand points at the minute: a new face every 5 minutes, once round each hour.
- **1.6:** The face table stepped every 3 minutes up to :35 and every 2 after, so the hand went round twice an hour, faster the second time.
- **SSO:** The face is the minute divided by five.
- **Why:** A clock should tell the time.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clockFace`)
- **Pinned by:** `bug fixed: a placed clock's hand goes round once an hour, a face every 5 minutes` (packages/shared/tests/inventory/ground.test.ts)

### Ctrl on the Mage Master Platform ends the pause
- **Kind:** Bug fixed
- **What you notice:** Ctrl on the Mage Master Platform prints its line and frees you at once, like the other platforms.
- **1.6:** The Mage Master branch exited without ending the 40-frame item pause the others ended.
- **SSO:** Its `pickup.ctrlTexts` row in `item-rules.json` ends the pause.
- **Why:** One platform out of four behaving differently was a slip.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`ctrlGate`)
- **Pinned by:** `bug fixed: Ctrl on the Mage Master Platform says its line and ends the pause like the others` (packages/shared/tests/inventory/ground.test.ts)

### The Ocarina plays a tune
- **Kind:** Bug fixed
- **What you notice:** Using an Ocarina says "You play a tune on your Ocarina." and plays a short tune that everyone on the map hears. The Ocarina stays in your bag.
- **1.6:** Its use called an empty music routine, so it did nothing and said nothing; the game had no music at all.
- **SSO:** The tune is new sound in `assets/added/sounds/ocarina.wav`. The game still has no background music.
- **Why:** An instrument that makes no sound reads as broken.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`, `OCARINA`), `packages/shared/src/rules/inventory/equip.ts` (`useDeferred`)
- **Pinned by:** `bug fixed: an Ocarina plays its tune to everyone on the map, says so, and is kept` (packages/server/tests/art-news.test.ts); `bug fixed: the Ocarina is not a silent item; the server plays it` (packages/shared/tests/mail/art-news.test.ts)

### Ctrl reads a newspaper whatever its owner is called
- **Kind:** Bug fixed
- **What you notice:** Ctrl on "Doorman's Newspaper", or any stand whose owner's name holds "door" or "exit", reads it as a click does.
- **1.6:** Ctrl tested for a door or exit name before a newspaper, so those stands were silent.
- **SSO:** Ctrl tests for a newspaper stand first.
- **Why:** A player's name should not decide whether their paper can be read.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`ctrlGate`)
- **Pinned by:** `bug fixed: Ctrl reads Doorman's Newspaper; the newspaper test comes before door/exit` (packages/shared/tests/mail/art-news.test.ts); `bug fixed: Ctrl reads 'Doorman's Newspaper' as a click does` (packages/server/tests/art-news.test.ts)

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
- **What you notice:** A credited killer can become wanted; a moderator or immortal can pardon an online player.
- **1.6:** Any client could send wanted or pardon messages to any player. A message to an absent killer was lost.
- **SSO:** At the end of the victim's death lock the server credits the recorded last player to hit them by player ID and applies the flag, even if another cause killed them later. A player who has logged off is not flagged. A staff `/Pardon` says “<name> is not online.” if the named player is absent.
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

### Airship landing pads work on map rows 10–12
- **Kind:** Bug fixed
- **What you notice:** You can build and unboard an Airship on `J2` landing pads on rows 10 to 12 of a map, just as on rows 1 to 9.
- **1.6:** The dock check read fields 1–12 of the `#`-delimited map record, where fields 10–12 held non-tile data instead of layer-1 rows, so `J2` pads on rows 10–12 were never recognised.
- **SSO:** `isDock` reads layer 1 via `layer1Tile` across all 12 map rows (`1..MAP_HEIGHT`), as `isArenaTile` does for arena tiles.
- **Why:** Allows landing pads placed on the bottom three rows of a map to work for building and parking airships.
- **In the code:** `packages/shared/src/rules/vehicles/vehicles.ts` (`layer1Tile`, `isDock`)
- **Pinned by:** `a J2 pad on rows 10-12 counts for building and unboarding` (packages/shared/tests/vehicles/vehicles.test.ts); `a pad on row 10 counts for building` (packages/server/tests/vehicles.test.ts); `a pad on row 10 lets you off` (packages/server/tests/vehicles.test.ts)

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
