# Chat

## What happens in play

A player can speak locally, broadcast to a wider audience, or send another player a private message. Each route has its own checks.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/chat/chat.ts](../../packages/server/src/systems/chat/chat.ts): routes chat and commands.
- [packages/server/src/systems/chat/ignore.ts](../../packages/server/src/systems/chat/ignore.ts): checks and updates ignore lists.
- [packages/server/src/systems/chat/im.ts](../../packages/server/src/systems/chat/im.ts): delivers private messages and away replies.
- [packages/server/src/systems/chat/rooms.ts](../../packages/server/src/systems/chat/rooms.ts): manages room membership and messages.
- [packages/server/src/systems/chat/log.ts](../../packages/server/src/systems/chat/log.ts): records each line in the chat log.
- [packages/server/src/systems/chat/speech.ts](../../packages/server/src/systems/chat/speech.ts): decides mutes, the prisoner's limits and the cooldowns.
- [packages/shared/src/rules/chat/chat.ts](../../packages/shared/src/rules/chat/chat.ts): parses commands and formats chat.
- [packages/shared/src/rules/chat/ignore.ts](../../packages/shared/src/rules/chat/ignore.ts): defines ignore-list matching.
- [packages/shared/src/rules/chat/im.ts](../../packages/shared/src/rules/chat/im.ts): parses private messages and selects windows.
- [packages/shared/src/rules/chat/rooms.ts](../../packages/shared/src/rules/chat/rooms.ts): defines room names and room-line parsing.

Entry points:

- `packages/server/src/systems/chat/chat.ts` (`handleChat`).
- `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`).

## How it works

The shared parser recognises commands and formatting; the server routes each recognised command to its handler. Ordinary speech, emotes and broadcasts have different audiences and cooldown checks. House and jail locations, mutes and the jail sentence impose further restrictions. Admin and guild commands hand off to those systems. Recognition does not mean every historical command executes: some are dropped, and `/logchat` is client behaviour rather than a server logging switch (the server logs chat regardless; see [The chat log](#the-chat-log)).

Private messages use the recipient's session and away state. Ignore checks apply to every entry on the account's list before delivery. Room membership determines who receives a room line; leaving and rejoining update membership. The server sends messages, while the shared rules parse and format them.

### Channels and delivery

Local speech and emotes are sent to the map; broadcasts reach a wider audience. The server truncates input to the configured maximum before parsing, applies separate chat and broadcast cooldowns, and checks house and jail restrictions on the applicable routes; a line the house rule refuses still costs the chat cooldown. A role with `bypassChatCooldown` or `bypassBroadcastCooldown` skips that cooldown (`chatWait`, `broadcastWait`). It also hands recognised bank, quest, treasure-rumour, faction and shop lines to those systems, and handles `Challenge` and `quit` (the arena), `Password=`, `/friends`, `who` and `/help` itself; shop commands run before the line is said and are never said aloud, though a mute refuses them too.

Every way of talking asks [`silenced`](../../packages/server/src/systems/chat/speech.ts) first. A muted player says nothing anywhere, staff chat included, and is told until when; a prisoner is heard only on the jail map, in local chat and `/me`, and a broadcast from the jail only shouts to no one ("You shout but no one can hear you!"). Either may still send an IM to staff. With the Role tags setting on, a staff member's role name goes before their name in local chat, `/me`, broadcasts, rooms, guild chat and staff chat; IMs and ignore lists use the plain name (see the [Admin guide](admin.md#roles)). A line whose first word looks like a command (`/` then a letter) but is not one, or is a staff command the typist may not use, is never said: only the typist sees “Unknown command "/word".” and the line returns to the input. `accept` and `reject` without a pending guild invitation are still ordinary speech.

Ignore lists belong to the account and are saved through [ignore persistence](../../packages/server/src/persistence/ignores.ts). Every entry is checked for chat, broadcasts and private messages. Ignoring yourself does not suppress server-originated messages, and chat rooms and trade are not filtered. Guild chat is filtered when a player sends it, but not the guild system's own lines. Private messages to an offline player return a notice; away replies do not answer other automatic replies, preventing a loop. Room membership is held by the server: entering one room leaves the previous one, closing or disconnecting leaves it, and messages reach all members including the sender and dead players. Choosing Guild Chat without a guild leaves your current room untouched.

### The chat log

Every line a player writes to others is logged on the server, delivered or refused: local say, `/me`, broadcasts, IMs and automatic away replies, away texts, guild chat, room lines, staff chat and saved Bio profiles. Each system appends one entry with [`logChat`](../../packages/server/src/systems/chat/log.ts) at the point it decides what becomes of the line (delivered, cooldown, house rule, jail, muted, ignored, not online, and so on). For say, `/me` and broadcasts, `audienceCounts` also records how many others read it, ignored it or heard it muffled. The entries collect in `world.chatLog`; the game stamps each with the time its intent ended and writes the batch to `chat_log` ([chat log persistence](../../packages/server/src/persistence/chatlog.ts)) at the start of the next tick, in its own transaction, so chat adds no SQL to the intent and a failed tick keeps the log. Commands and `Password=` are never logged. Staff read the log with `/chatlog` (see the [Admin guide](admin.md)) and operators with `bun run admin:chatlog`; `chatLogRetention` prunes it hourly.

## Differences from 1.6

Fixes cover full-topic `/help`, freed IM slots, deduplicated ignore entries that all filter, Guild Chat keeping the current room, off or empty away text, `/me` under the house rule, guild chat honouring ignore, the full broadcast cooldown, blank chat lines, and every forbidden password character. See the [chat bugs fixed](../differences-from-fso.md#chat) and [server-side chat changes](../differences-from-fso.md#server-side-chat).
