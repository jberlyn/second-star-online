# Admin

## What happens in play

Staff hold a role that the operator defines: by default a moderator can kick, ban, jail and mute players, while an administrator can also warp, edit the world and change the server's settings and roles. The server checks the role's permissions before it acts.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/admin/commands.ts](../../packages/server/src/systems/admin/commands.ts): routes privileged commands and audit.
- [packages/server/src/systems/admin/drop.ts](../../packages/server/src/systems/admin/drop.ts): validates and places admin item drops.
- [packages/server/src/systems/admin/login-limits.ts](../../packages/server/src/systems/admin/login-limits.ts): tracks login and account-creation limits.
- [packages/server/src/systems/admin/npcedit.ts](../../packages/server/src/systems/admin/npcedit.ts): loads and saves NPC editor data.
- [packages/server/src/systems/admin/roster.ts](../../packages/server/src/systems/admin/roster.ts): builds map roster replies.
- [packages/server/src/systems/admin/spawn.ts](../../packages/server/src/systems/admin/spawn.ts): handles privileged spawning.
- [packages/server/src/systems/admin/worldedit.ts](../../packages/server/src/systems/admin/worldedit.ts): loads, validates and applies map edits.
- [packages/server/src/persistence/moderation.ts](../../packages/server/src/persistence/moderation.ts): stores the moderation log, bans, IP bans, jails, mutes and login addresses.
- [packages/server/src/persistence/roles.ts](../../packages/server/src/persistence/roles.ts): stores the role definitions and lists who holds them.
- [packages/server/src/cli/set-role.ts](../../packages/server/src/cli/set-role.ts): `bun run admin:role`, which gives an account a role from the command line.
- [packages/client/src/ui/settings-roles.ts](../../packages/client/src/ui/settings-roles.ts): the Server Settings window's Roles and Staff pages.
- [packages/shared/src/rules/admin/admin.ts](../../packages/shared/src/rules/admin/admin.ts): lists the admin commands and their helpers.
- [packages/shared/src/rules/admin/auditlog.ts](../../packages/shared/src/rules/admin/auditlog.ts): parses and prints `/auditlog` (10 entries by default, up to 100).
- [packages/shared/src/rules/admin/chatlog.ts](../../packages/shared/src/rules/admin/chatlog.ts): parses and prints `/chatlog` (20 lines by default, up to 100).
- [packages/shared/src/rules/admin/permissions.ts](../../packages/shared/src/rules/admin/permissions.ts): defines the permissions, the default roles, the role checks and the chat tag.
- [packages/shared/src/rules/admin/moderation.ts](../../packages/shared/src/rules/admin/moderation.ts): decides who may ban, jail or pardon whom, and reads durations, reasons and addresses.
- [packages/shared/src/rules/admin/npcfile.ts](../../packages/shared/src/rules/admin/npcfile.ts): parses and validates NPC files.
- [packages/shared/src/rules/admin/worldedit.ts](../../packages/shared/src/rules/admin/worldedit.ts): defines editor data and map validation.

Entry points:

- `packages/server/src/systems/admin/commands.ts` (`handleAdmin`).
- `packages/shared/src/rules/admin/permissions.ts` (`can`).

## How it works

The server routes administration requests through `handleAdmin` and checks permissions using `can`. Commands also record audit information. Login limits track attempts by IP and account and limit character creation.

### Roles

A role has an id, a display name, a rank and a set of permissions: one per admin command and tool, plus the gameplay exemptions (takes no damage, never hungry, cannot be pushed, off the high scores, not stopped by IP bans or login limits, drops on every death, and skips the chat or broadcast cooldown). The operator's roles live in the database's `roles` table; a new server starts with `moderator` (Moderator, rank 1) and `administrator` (Admin, rank 2). An account holds at most one role, and an account with none is an ordinary player: rank 0, no permissions. Any role makes an account staff, so it reads and posts staff chat and can be sent IMs by jailed and muted players. Nothing checks a role by name. The client receives only its permissions, to decide which menus to show, and the server checks every request.

Roles are edited on the Server Settings window's Roles page and given to accounts on its Staff page, both gated by the `settings` permission, or with `bun run admin:role <name> <role|none>` (and `--list`). There is no in-game command for it. A change applies at once to everyone online who holds the role: they get their new permissions, a `/warpscript` they may no longer use is cleared, and they leave an editor or Admin Chat they may no longer use (`applyRole`). Deleting a role leaves its accounts with no role. At least one role must keep every permission (`rolesError`), and nobody can change their own role on the Staff page, so the server can always be run; the command line can always give a role. Every role edit, deletion and assignment is written to the audit log.

The Chat page's Role tags setting (off by default) puts the speaker's role name before their name in local chat, `/me`, broadcasts, chat rooms, guild chat and staff chat: `[Admin] Berlyn says "hi"` (`taggedName`). IMs keep the plain name, since it is the address a reply goes to, and ignore lists still match the plain name.

A roster reports map contents; spawn and drop requests validate their names and amounts. World and NPC editors are restricted and validate submitted data before saving it. World editor saves apply to the server's map state; NPC edits check the file and refresh windows that display the edited NPC. Read paths expose information without giving the reader permission to edit it. The historical monster-drop editor and Justicars are not revived.

### Permissions, tools and persistence

By default moderators and administrators share the moderation commands (`/kick`, `/ban`, `/unban`, `/pardon`, `/jail`, `/unjail`, `/mute`, `/unmute`, `/IPlookup`, `/banlist`, `/Location`, `/Inventory`, `/save` and `/Refresh`), and all staff can post to and read `-text` staff chat. A moderator is an ordinary player who moderates others: the warps (`/warp`, `/warptome`, `/warpmeto`, `/warpscript`) are administrators', and only an administrator may pardon or warp themselves (`pardonSelf`, `warpSelf`). IP bans (`/BanIP` and `/unbanip`), `/chatlog`, `/auditlog`, `/CheatFile` (audited on each use), `/drop`, `/setclass`, `/roster`, `/spawn`, and the World Editor, NPC Editor, and Server Settings windows are administrators' too. A command anyone lacks the permission for is answered as an unknown command. `/kick`, `/IPlookup`, `/warp` and `/warptome` refuse a target who outranks the staff member, so staff of equal rank can still kick or look up each other; `/pardon`, like the bans, jails and mutes below, needs the staff member to outrank the target (`mayTarget`). `/warpscript` never warps a speaker who outranks the staff member. Commands use the account's role as it stands, and administrative actions use [admin persistence](../../packages/server/src/persistence/admin.ts) for account lookups and audit rows. A missing target or jail map is reported rather than silently trusting a supplied destination.

### Bans, jails and IP bans

`/ban`, `/jail`, `/mute` and `/banip` take an optional duration and reason after the name. Durations such as `30m`, `7d` and `perm` are parsed by `parseModerationArgs`; a missing one uses the `banLength`, `jailSentence`, `muteLength` or `ipBanLength` setting. Every staff action is written to the moderation log with the staff member's name and the name of their role at that moment, and the bans, IP bans, jails and mutes in force are kept in their own tables until they end. A jail sentence or mute that runs out by itself writes no log row of its own; the row that set it already records when it ends. `/banlist` pages its bans 10 at a time and lists the first 10 jails and mutes; IP bans and addresses appear only for a role with `/banip`. Staff can ban, jail, mute or pardon only those they outrank, and a role with `overrule` (administrators) can act on anyone but themselves (`mayTarget`). Only the staff member who made a ban, jail or mute, or a role with `overrule`, can change its length or lift it (`mayChange`), so a moderator can no longer overwrite an administrator's ban to lift it.

`/chatlog <name> [count] [channel]` prints a character's newest logged chat (see the [Chat guide](chat.md#the-chat-log)), including the IMs sent to them. It needs the `chatlog` permission (anyone else is told it is an unknown command), it covers every channel, and each lookup is audited.

`/auditlog <name> [count]` prints the newest staff actions (default 10, up to 100) taken by that character's account or done to that character. [`auditTrail`](../../packages/server/src/persistence/admin.ts) merges the audit log with the moderation log, which supplies bans, jails, mutes, IP bans, unmutes and pardons with their reasons, and leaves out the audit log's copy of those. It needs the `auditlog` permission, and each lookup is audited.

A jailed or muted player is told in the chat box until when, at once and at each login. Every way of talking (local chat, `/me`, broadcasts, IMs, guild chat, rooms, staff chat, mail and boards) asks [`silenced`](../../packages/server/src/systems/chat/speech.ts) first: a muted player says nothing, a prisoner is heard only on the jail map, and either may still IM staff. Shop commands are not talk, so a muted shop owner can still run their shop. `chatWait` and `broadcastWait` in the same file let a role with the bypass permissions skip the chat and broadcast cooldowns. A mute is on the account, runs in real time and is lifted by `muteTick` when it ends. A banned player reads the alert and the ban's end at login; the reason is shown only to staff, through `/banlist`. An account ban and an IP ban are checked after the password, and IP bans never stop a role with `bypassIpBan`. An IPv6 address bans its /64. The server records the addresses each account logs in from, so `/banip <name>` can ban the latest or every one, and a new IP ban disconnects matching sessions immediately. A jail sentence is stored and runs in real time. An offline prisoner is placed in jail at login, and one whose sentence ended while away goes to their respawn point (the fallback point if its map is gone). `/warp` refuses a map that does not exist. Staff warps cannot move a prisoner out of jail or a player into it.

Staff chat (`-text`) uses a dedicated colour (`CHAT_COLOR.staff`), has no house sender restriction, muffling, or ignore filtering, and reaches only staff recipients. A muted staff member cannot post to it. `-text` from a non-staff player gets "Only staff can use staff chat." and the input clears; `/warpscript` from anyone without the permission is an unknown command, and the line returns to the input. `/warpscript` matches whole keywords in broadcast message content only (ignoring case, never matching speaker names, protocol wrappers, or substrings) and warps the speaker to the first matching online staff member in login order, skipping staff who are in an editor, ignore the speaker or are outranked by them, and, for a speaker who is not staff, staff on the jail map.

Login attempts are counted over five minutes and account creations over an hour; a zero setting disables the corresponding limit. The counts are in memory and reset on restart. A successful password removes that attempt and clears the account-and-address count. A role with `bypassLoginLimits` is not stopped by an address that has used up its count, but only while its account has no failure from that address in the window, so a spent address gets one try at a staff password, not a run of guesses. The roster command sets one of four map slots; spawn places a rostered creature immediately on the faced tile. The drop command accepts a recognised item, with a count of up to 9,999 for a stack (`DROP_MAX`), or any positive amount of gold, and puts the pile on the faced tile.

A staff member entering an editor leaves the map until returning. A world save checks map fields, exits, text and item names, replaces its editor-managed items and roster, and refreshes players on the map; other ground drops and loot are preserved. The Fat brush paints a plus of five tiles, clipped at the map's edges, faction checkboxes (W/M/A) are mutually exclusive, clicking a lit layer button (including S) keeps that layer selected, and loading a map without an exit resets the exit fields. NPC loading combines the file with live shop stock and gold and displays the complete text losslessly. Saving validates the selected NPC and its lines, replaces its file and resets its shop ledger; open shop and bio windows for it close. The editor lists and validations are in the shared files listed above.

## Differences from 1.6

See the [admin bugs fixed](../differences-from-fso.md#admin) and [server-side admin changes](../differences-from-fso.md#server-side-admin).
