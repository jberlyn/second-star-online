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
- [packages/shared/src/rules/admin/admin.ts](../../packages/shared/src/rules/admin/admin.ts): defines role permissions and command helpers.
- [packages/shared/src/rules/admin/npcfile.ts](../../packages/shared/src/rules/admin/npcfile.ts): parses and validates NPC files.
- [packages/shared/src/rules/admin/worldedit.ts](../../packages/shared/src/rules/admin/worldedit.ts): defines editor data and map validation.

Entry points:

- `packages/server/src/systems/admin/commands.ts` (`handleAdmin`).
- `packages/shared/src/rules/admin/admin.ts` (`mayRun`).

## How it works

The server routes administration requests through `handleAdmin` and checks permissions using `mayRun`. The three roles are player, moderator and immortal; client flags do not grant authority. Commands also record audit information. Login limits track attempts by IP and account and limit character creation.

A roster reports map contents; spawn and drop requests validate their names and amounts. World and NPC editors are restricted and validate submitted data before saving it. World editor saves apply to the server's map state; NPC edits check the file and refresh windows that display the edited NPC. Read paths expose information without giving the reader permission to edit it. The historical monster-drop editor and Justicars are not revived.

### Permissions, tools and persistence

Moderators can kick, warp, jail, look up IPs and see locations; immortals have the remaining privileged commands. Immortals can post to admin chat while moderators can read it. Commands use the current account role, and administrative actions use [admin persistence](../../packages/server/src/persistence/admin.ts) for account lookups and audit rows. A missing target or jail map is reported rather than silently trusting a supplied destination.

Login attempts are counted over five minutes and account creations over an hour; a zero setting disables the corresponding limit. The counts are in memory and reset on restart. A successful password removes that attempt and clears the account-and-address count. The roster command sets one of four map slots; spawn places a rostered creature immediately on the faced tile. The drop command accepts recognised items and bounded counts, and puts the pile on the faced tile.

An immortal entering an editor leaves the map until returning. A world save checks map fields, exits, text and item names, replaces its editor-managed items and roster, and refreshes players on the map; other ground drops and loot are preserved. NPC loading combines the file with live shop stock and gold. Saving validates the selected NPC and its lines, replaces its file and resets its shop ledger; open shop and bio windows for it close. The editor lists and validations are in the shared files listed above.

## Kept bugs and differences

Moderators have only part of the admin command set. An immortal’s warp keyword can match anywhere in a broadcast. The editor also preserves some unusual button and loading behaviour; the linked entries explain it.

See the [admin kept bugs](../bug-ledger.md#admin) and [admin differences](../divergences.md#admin) for the specific player-visible cases.

