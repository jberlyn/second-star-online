# Social

## What happens in play

A character can join a guild, follow a faction, keep a buddy list and inspect another player's biography. A murder can mark the killer as wanted, which staff can later answer with `/jail` or `/pardon`; Assassin events track scores for eligible kills. The High Score Statue ranks every player on the server.

## Where it lives

- [packages/server/src/systems/social/assassin.ts](../../packages/server/src/systems/social/assassin.ts): controls Assassin events and scoring.
- [packages/server/src/systems/social/bios.ts](../../packages/server/src/systems/social/bios.ts): builds biography responses and saves profiles.
- [packages/server/src/systems/social/factions.ts](../../packages/server/src/systems/social/factions.ts): handles faction messages, bonuses, loyalty and head turn-ins.
- [packages/server/src/systems/social/friends.ts](../../packages/server/src/systems/social/friends.ts): handles buddy commands and presence updates.
- [packages/server/src/systems/social/guilds.ts](../../packages/server/src/systems/social/guilds.ts): handles guild creation, selection, membership and chat.
- [packages/server/src/systems/social/highscores.ts](../../packages/server/src/systems/social/highscores.ts): ranks player scores on each periodic save.
- [packages/server/src/systems/social/murder.ts](../../packages/server/src/systems/social/murder.ts): marks killers and handles pardons.
- [packages/server/src/systems/social/presence.ts](../../packages/server/src/systems/social/presence.ts): announces presence and finds online players.
- [packages/shared/src/rules/social/assassin.ts](../../packages/shared/src/rules/social/assassin.ts): defines event scores and tables.
- [packages/shared/src/rules/social/bios.ts](../../packages/shared/src/rules/social/bios.ts): builds bio fields and validates profile text.
- [packages/shared/src/rules/social/buddies.ts](../../packages/shared/src/rules/social/buddies.ts): parses buddy commands and updates lists.
- [packages/shared/src/rules/social/factions.ts](../../packages/shared/src/rules/social/factions.ts): defines faction membership, power and loyalty rules.
- [packages/shared/src/rules/social/guilds.ts](../../packages/shared/src/rules/social/guilds.ts): defines guild records, selection and membership operations.
- [packages/shared/src/rules/social/highscores.ts](../../packages/shared/src/rules/social/highscores.ts): defines high-score points, ranking and the statue's board.

## How it works

Opening a Guild Center requires standing still directly in front of it; opening it locks movement. Only a member of a guild can view the guild list's selected record, which can be any guild's; creation, invitations, answers, leaving and leadership actions update guild records through server handlers. The server checks membership and leadership for actions and updates online members when the guild changes; an abdicating leader's screen redraws as a member's. A disbanded guild's name, with its vault, Guild Key doors and hall, can be founded again only by the leader who disbanded it. Faction membership and power affect combat, spells and regeneration; loyalty drains while online. A head turned in to a faction leader who would not take the giver stays in the bag and moves no power. Each faction's announcements reach only its online members, so leaving a faction in any way stops them. Login restores faction state, and death and head turn-ins can change consequences or power. Assassin event state controls whether kills score, a wanted victim included, and maintains the event's rankings, ties included, and an all-time legends table. A credited killer must still be online when the victim’s death lock ends; Lightning makes qualifying melee hits lethal and its deaths flag no one. Ending an event awards configured prizes to up to the first four places, stopping at the first blank prize; an offline winner's prize goes into their stored bag. With each periodic save the server works out the score of every player whose role lacks `noHighScores` (the bio score: every skill, HPmax and SPmax, with no upper limit) and ranks it into the High Score Statue's top ten, keeping each player's best; the table is stored through [high-score persistence](../../packages/server/src/persistence/highscores.ts) and its texts are in [social content](../../packages/data/content/social.json).

Buddy commands change the account's list; entry and login/logout presence notify appropriate online players; with `announcePresence` (on by default) logon and logoff updates go to everyone online, and `presenceChatLines` also prints them in chat. Guild chat (`/g`) shares the chat cooldown and honours ignore lists, and `/invite` invites a player to the guild. Bio requests build a view from the target's state and profile. Death can invoke murder and faction consequences; arena defeat does not mark a killer. A wanted player is attacked by Officers even on maps where fighting is off, and a Holy Shield hits only wanted players. Staff with `/pardon` can pardon a wanted player they outrank, or anyone if their role has `overrule`; pardoning yourself also needs the `pardonSelf` permission. A jail sentence is stored as an end time and runs in real time whether or not the prisoner is online; dying in jail does not reset it (see [world](world.md)). Chat commands route to these handlers; [chat](chat.md) covers ignore and instant messages, and [progression](progression.md) covers medal checks.

## Differences from 1.6

See the [social bugs fixed](../differences-from-fso.md#social). Killing a wanted player never flags you, which is [kept on purpose](../differences-from-fso.md#killing-a-wanted-player-never-flags-you). Unavailable original controls are not revived. See the [server-side social changes](../differences-from-fso.md#server-side-social).
