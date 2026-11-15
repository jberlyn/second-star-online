# Chat

## What happens in play

A player can speak locally, broadcast to a wider audience, or send another player a private message. Each route has its own checks.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/chat/chat.ts](../../packages/server/src/systems/chat/chat.ts): routes chat and commands.
- [packages/server/src/systems/chat/ignore.ts](../../packages/server/src/systems/chat/ignore.ts): checks and updates ignore lists.
- [packages/server/src/systems/chat/im.ts](../../packages/server/src/systems/chat/im.ts): delivers private messages and away replies.
- [packages/server/src/systems/chat/rooms.ts](../../packages/server/src/systems/chat/rooms.ts): manages room membership and messages.
- [packages/shared/src/rules/chat/chat.ts](../../packages/shared/src/rules/chat/chat.ts): parses commands and formats chat.
- [packages/shared/src/rules/chat/ignore.ts](../../packages/shared/src/rules/chat/ignore.ts): defines ignore list and window matching.
- [packages/shared/src/rules/chat/im.ts](../../packages/shared/src/rules/chat/im.ts): parses private messages and selects windows.
- [packages/shared/src/rules/chat/rooms.ts](../../packages/shared/src/rules/chat/rooms.ts): defines room names and room-line parsing.

Entry points:

- `packages/server/src/systems/chat/chat.ts` (`handleChat`).
- `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`).

## How it works

The shared parser recognises commands and formatting; the server routes each recognised command to its handler. Ordinary speech, emotes and broadcasts have different audiences and cooldown checks. House and jail locations impose further restrictions. Admin and guild commands hand off to those systems. Recognition does not mean every historical command executes: some are dropped, and `/logchat` is client behaviour rather than a server logging switch.

Private messages use the recipient's session and away state. Ignore checks apply the relevant chat or message window before delivery, with the list stored for the account. Room membership determines who receives a room line; leaving and rejoining update membership. The server sends messages, while the shared rules parse and format them.

### Channels and delivery

Local speech and emotes are sent to the map; broadcasts reach a wider audience. The server truncates input to the configured maximum before parsing, applies separate chat and broadcast cooldowns, and checks house and jail restrictions on the applicable routes. It also hands recognised bank, quest, faction and shop lines to those systems. Some lines that look like commands instead fall through to ordinary speech when the relevant privilege or invitation is absent.

Ignore lists belong to the account and are saved through [ignore persistence](../../packages/server/src/persistence/ignores.ts). The first 50 entries are checked for chat and the first 40 for private messages. Ignoring yourself does not suppress server-originated messages, and rooms, guild chat and trade are not filtered. Private messages to an offline player return a notice; away replies do not answer other automatic replies, preventing a loop. Room membership is held by the server: entering one room leaves the previous one, closing or disconnecting leaves it, and messages reach all members including the sender and dead players.

## Kept bugs and differences

Ignore lists can contain duplicate names, and only the first 50 names affect chat delivery and the first 40 affect private messages. A player can use an emote where ordinary speech is blocked; guild chat does not use the ignore filter.

See the [chat kept bugs](../bug-ledger.md#chat) and [chat differences](../divergences.md#chat) for the specific player-visible cases.

