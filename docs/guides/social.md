# Social

## What happens in play

A character can join a guild, follow a faction, keep a buddy list and inspect another player's biography. A murder can mark the killer and lead to jail; Assassin events track scores for eligible kills.

## Where it lives

- [packages/server/src/systems/social/assassin.ts](../../packages/server/src/systems/social/assassin.ts): controls Assassin events and scoring.
- [packages/server/src/systems/social/bios.ts](../../packages/server/src/systems/social/bios.ts): builds biography responses and saves profiles.
- [packages/server/src/systems/social/factions.ts](../../packages/server/src/systems/social/factions.ts): handles faction messages, bonuses, loyalty and head turn-ins.
- [packages/server/src/systems/social/friends.ts](../../packages/server/src/systems/social/friends.ts): handles buddy commands and presence updates.
- [packages/server/src/systems/social/guilds.ts](../../packages/server/src/systems/social/guilds.ts): handles guild creation, selection, membership and chat.
- [packages/server/src/systems/social/murder.ts](../../packages/server/src/systems/social/murder.ts): marks killers and handles pardons.
- [packages/server/src/systems/social/presence.ts](../../packages/server/src/systems/social/presence.ts): announces presence and finds online players.
- [packages/shared/src/rules/social/assassin.ts](../../packages/shared/src/rules/social/assassin.ts): defines event scores and tables.
- [packages/shared/src/rules/social/bios.ts](../../packages/shared/src/rules/social/bios.ts): builds bio fields and validates profile text.
- [packages/shared/src/rules/social/buddies.ts](../../packages/shared/src/rules/social/buddies.ts): parses buddy commands and updates lists.
- [packages/shared/src/rules/social/factions.ts](../../packages/shared/src/rules/social/factions.ts): defines faction membership, power and loyalty rules.
- [packages/shared/src/rules/social/guilds.ts](../../packages/shared/src/rules/social/guilds.ts): defines guild records, selection and membership operations.

## How it works

Opening a Guild Center requires standing still directly in front of it; opening it locks movement. Only members can view the guild list’s selected record; creation, invitations, answers, leaving and leadership actions update guild records through server handlers. The server checks membership and leadership for actions and updates online members when the guild changes. The client retains the selected member after an exile; the server checks the current membership before a later action. Faction membership and power affect combat, spells and regeneration; loyalty drains while online, and turning in heads can change faction power even if joining is refused. Login restores faction state, and death and head turn-ins can change consequences or power. Assassin event state controls whether kills score and maintains rankings. A credited killer must still be online when the victim’s death lock ends; Lightning makes qualifying melee hits lethal. Ending an event awards configured prizes to up to the first three places, stopping at the first blank prize.

Buddy commands change the account's list; entry and login/logout presence notify appropriate online players. Bio requests build a view from the target's state and profile. Death can invoke murder and faction consequences; arena defeat does not mark a killer. An immortal can pardon a wanted player. A jail sentence runs on the server and restarts on entering the jail map. Chat commands route to these handlers; [chat](chat.md) covers ignore and instant messages, and [progression](progression.md) covers medal checks.

## Kept bugs and differences

Guild lines that do not begin with a letter lose their first character, and the abdicating leader’s confirmation names the guild instead of the new leader. All three factions share an announcement channel; unavailable original controls are not revived. See [social kept bugs](../bug-ledger.md#social) and [social differences](../divergences.md#social).

