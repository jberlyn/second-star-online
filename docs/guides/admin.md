# Admin

## What happens in play

A moderator can inspect a player while an immortal can open the world editor. The server checks the account role before it acts.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/admin/commands.ts](../../packages/server/src/systems/admin/commands.ts): routes privileged commands and audit.
- [packages/server/src/systems/admin/drop.ts](../../packages/server/src/systems/admin/drop.ts): validates and places admin item drops.
- [packages/server/src/systems/admin/login-limits.ts](../../packages/server/src/systems/admin/login-limits.ts): tracks login and account-creation limits.
- [packages/server/src/systems/admin/npcedit.ts](../../packages/server/src/systems/admin/npcedit.ts): loads and saves NPC editor data.
- [packages/server/src/systems/admin/roster.ts](../../packages/server/src/systems/admin/roster.ts): builds map roster replies.
- [packages/server/src/systems/admin/spawn.ts](../../packages/server/src/systems/admin/spawn.ts): handles privileged spawning.
- [packages/server/src/systems/admin/worldedit.ts](../../packages/server/src/systems/admin/worldedit.ts): loads, validates and applies map edits.
- [packages/server/src/persistence/moderation.ts](../../packages/server/src/persistence/moderation.ts): stores the moderation log, bans, IP bans, jails and login addresses.
- [packages/shared/src/rules/admin/admin.ts](../../packages/shared/src/rules/admin/admin.ts): defines role permissions and command helpers.
- [packages/shared/src/rules/admin/moderation.ts](../../packages/shared/src/rules/admin/moderation.ts): decides who may ban, jail or pardon whom, and reads durations, reasons and addresses.
- [packages/shared/src/rules/admin/npcfile.ts](../../packages/shared/src/rules/admin/npcfile.ts): parses and validates NPC files.
- [packages/shared/src/rules/admin/worldedit.ts](../../packages/shared/src/rules/admin/worldedit.ts): defines editor data and map validation.

Entry points:

- `packages/server/src/systems/admin/commands.ts` (`handleAdmin`).
- `packages/shared/src/rules/admin/admin.ts` (`mayRun`).

## How it works

The server routes administration requests through `handleAdmin` and checks permissions using `mayRun`. The three roles are player, moderator and immortal; client flags do not grant authority. Commands also record audit information. Login limits track attempts by IP and account and limit character creation.

A roster reports map contents; spawn and drop requests validate their names and amounts. World and NPC editors are restricted and validate submitted data before saving it. World editor saves apply to the server's map state; NPC edits check the file and refresh windows that display the edited NPC. Read paths expose information without giving the reader permission to edit it. The historical monster-drop editor and Justicars are not revived.

### Permissions, tools and persistence

Moderators and immortals share the original moderation command set (`/kick`, `/ban`, `/unban`, `/pardon`, `/warp`, `/warptome`, `/warpmeto`, `/jail`, `/IPlookup`, `/Location`, `/Inventory`, `/save`, `/Refresh`, and `/warpscript`) plus `/unjail` and `/banlist`, and both staff roles can post to and read `-text` staff chat. IP bans (`/BanIP` and `/unbanip`), `/chatlog`, `/auditlog`, `/CheatFile` (audited on each use), `/drop`, `/role`, `/setclass`, `/roster`, `/spawn`, and the World Editor, NPC Editor, and Settings windows remain immortal-only. Moderators cannot kick, warp, or look up the IP of an immortal. Commands use the current account role, and administrative actions use [admin persistence](../../packages/server/src/persistence/admin.ts) for account lookups and audit rows. A missing target or jail map is reported rather than silently trusting a supplied destination.

### Bans, jails and IP bans

`/ban`, `/jail` and `/banip` take an optional duration and reason after the name. Durations such as `30m`, `7d` and `perm` are parsed by `parseModerationArgs`; a missing one uses the `banMinutes`, `jailMinutes` or `ipBanMinutes` setting. Every action is written to the moderation log with the staff member's name and rank at that moment, and the bans, IP bans and jails in force are kept in their own tables until they end. A moderator can ban, jail or pardon players only, and an immortal can act on anyone but themselves (`mayTarget`). Only the staff member who made a ban or jail, or an immortal, can change its length or lift it (`mayChange`), so a moderator can no longer overwrite an immortal's ban to lift it.

`/chatlog <name> [count] [channel]` prints a character's newest logged chat (see the [Chat guide](chat.md#the-chat-log)), including the IMs sent to them. It is immortal-only (anyone else is told it is an unknown command), it covers every channel, and each lookup is audited.

`/auditlog <name> [count]` prints the newest staff actions (default 10, up to 100) taken by that character's account or done to that character. [`auditTrail`](../../packages/server/src/persistence/admin.ts) merges the audit log with the moderation log, which supplies bans, jails, IP bans and pardons with their reasons, and leaves out the audit log's copy of those. It is immortal-only, and each lookup is audited.

A banned player reads the alert and the ban's end at login; the reason is shown only to staff, through `/banlist`. An account ban and an IP ban are checked after the password, and IP bans never stop an immortal. An IPv6 address bans its /64. The server records the addresses each account logs in from, so `/banip <name>` can ban the latest or every one, and a new IP ban disconnects matching sessions immediately. A jail sentence is stored and runs in real time. An offline prisoner is placed in jail at login, and one whose sentence ended while away goes to their respawn point (the fallback point if its map is gone). `/warp` refuses a map that does not exist. Staff warps cannot move a prisoner out of jail or a player into it.

Staff chat (`-text`) uses a dedicated colour (`CHAT_COLOR.staff`), has no house sender restriction, muffling, or ignore filtering, and reaches only staff recipients. Unauthorized `-text` or `/warpscript` from a player returns an explicit refusal and clears the input. `/warpscript` matches whole keywords in broadcast message content only (ignoring case, never matching speaker names, protocol wrappers, or substrings) and warps the speaker to the first matching online staff member in login order.

Login attempts are counted over five minutes and account creations over an hour; a zero setting disables the corresponding limit. The counts are in memory and reset on restart. A successful password removes that attempt and clears the account-and-address count. The roster command sets one of four map slots; spawn places a rostered creature immediately on the faced tile. The drop command accepts recognised items and bounded counts, and puts the pile on the faced tile.

An immortal entering an editor leaves the map until returning. A world save checks map fields, exits, text and item names, replaces its editor-managed items and roster, and refreshes players on the map; other ground drops and loot are preserved. The Fat brush covers the full 17 × 12 map, faction checkboxes (W/M/A) are mutually exclusive, clicking a lit layer button (including S) keeps that layer selected, and loading a map without an exit resets the exit fields. NPC loading combines the file with live shop stock and gold and displays the complete text losslessly. Saving validates the selected NPC and its lines, replaces its file and resets its shop ledger; open shop and bio windows for it close. The editor lists and validations are in the shared files listed above.

## Differences from 1.6

See the [admin bugs fixed](../differences-from-fso.md#admin) and [server-side admin changes](../differences-from-fso.md#server-side-admin).
