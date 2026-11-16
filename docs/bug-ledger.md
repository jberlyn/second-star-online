# Bug ledger

Gameplay bugs in First Star Online 1.6 that Second Star Online **keeps on purpose**. The policy is to keep every gameplay bug and to close only the exploits that harm the server or other players. Each entry says what a player notices, what 1.6 did, where the behaviour lives in the code, and which tests pin it. At the end, "Not in SSO" lists what 1.6 did that cannot happen under server authority, and what 1.6 never reached.

- Exploits that were closed live in [`docs/divergences.md`](divergences.md), not here.

**Entry shape.** A kept bug:

```
### A weaker player still shoves you
- **What you notice:** walk into a player who is standing still and now and then (1 blocked step in 25)
  you push them a tile. If you are weaker than them they read "… is too weak", and then
  "… shoves you out of the way." and move anyway.
- **In 1.6 and SSO:** the "too weak" check prints its line but doesn't stop the shove. Immortals and
  players whose keys are held by a window are never pushed.
- **In the code:** `packages/server/src/systems/movement/push.ts` (`pushOnMe`)
- **Pinned by:** `kept bug: a weaker pusher is 'too weak' and still shoves` (packages/server/tests/push.test.ts); `walking into a standing player can push them` (packages/server/e2e/chat-and-presence.test.ts)
```

And an item under "Not in SSO":

```
- **The airship picture lingered after death.** 1.6 left a dead rider drawn as the airship until each
  viewer's screen happened to reset it (a 1-in-50 roll per frame). SSO's server resets it for everyone
  at the moment of death (`packages/server/src/systems/vehicles/airship.ts`, `vehicleDeath`).
```

The `In the code:` paths and identifiers are checked by the gate (`tests/doc-paths.test.ts`). Every kept bug should name the tests that pin it.

## Index

| Section | Kept bugs |
|---|---|
| [admin](#admin) | 9 |
| [casino](#casino) | 14 |
| [chat](#chat) | 10 |
| [client](#client) | 18 |
| [combat](#combat) | 28 |
| [crafting](#crafting) | 28 |
| [economy](#economy) | 32 |
| [housing](#housing) | 20 |
| [inventory](#inventory) | 33 |
| [mail](#mail) | 16 |
| [monsters](#monsters) | 21 |
| [movement](#movement) | 7 |
| [progression](#progression) | 11 |
| [social](#social) | 17 |
| [spells](#spells) | 25 |
| [vehicles](#vehicles) | 1 |
| [world](#world) | 5 |
| [Not in SSO](#not-in-sso) | 41 |
| **Total** | **336** |

## admin

### An immortal's warp keyword catches any broadcast containing it
- **What you notice:** when an immortal sets a `/warpscript` keyword, any player whose broadcast contains it is warped to the immortal.
- **In 1.6 and SSO:** the match is a plain substring test on every broadcast. SSO does the same, on the server's whole broadcast line, `<name> broadcasts "<text>"`, so the speaker's name and the word "broadcasts" match too: `/warpscript broad` warps every broadcaster. Every online immortal's keyword is checked, in login order, and the last warp wins.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`warpscriptOnBroadcast`), `packages/shared/src/rules/admin/admin.ts` (`warpscriptMatches`)
- **Pinned by:** `contains, ignoring case, on the whole server line` and `kept bug: the speaker's name and the word 'broadcasts' match too` (packages/shared/tests/admin/admin.test.ts); `a broadcast containing the keyword warps the speaker to the immortal` (packages/server/tests/admin.test.ts)

### Moderators get only part of the admin commands
- **What you notice:** moderators can use `/kick`, `/warp`, `/warptome`, `/warpmeto`, `/jail`, `/IPlookup` and `/Location`, but not `/ban`, `/drop`, `/BanIP`, `/Pardon` or `-chat`.
- **In 1.6 and SSO:** that is the original's split. SSO reproduces it with a role table, and the denials keep their texts, including the "Only immortals can warp players." on `/warp` and `/warpmeto` that moderators never see.
- **In the code:** `packages/shared/src/rules/admin/admin.ts` (`ADMIN_ROLES`, `mayRun`)
- **Pinned by:** `kept bug: moderators may kick, warp, jail, look up IPs and see their location, nothing else` (packages/shared/tests/admin/admin.test.ts); `a moderator may warp, jail, kick, look up and locate, but not ban` (packages/server/tests/admin.test.ts)

### The World Editor's Fat brush stops short of the right and lower edges
- **What you notice:** in the World Editor, the Fat brush paints its plus shape fully, except that the right arm is missing in column 13 and beyond, and the lower arm in row 10 and beyond. The left and upper arms reach the edge.
- **In 1.6 and SSO:** the brush only checks the right and lower arms against the bounds of an older, smaller map (12 columns by 9 rows). SSO does the same.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`paint`)
- **Pinned by:** `kept bug: the Fat brush stops at column 12 and row 9 (the right and lower neighbours are bounded by 13 and 10)` (packages/shared/tests/admin/worldedit.test.ts)

### The World Editor's A faction box doesn't clear W
- **What you notice:** in the World Editor, ticking A leaves W ticked, so both can be on at once. Ticking W or M clears the other two boxes.
- **In 1.6 and SSO:** A's branch clears M twice and never W. Saving writes the last ticked of W, M and A, so A wins. SSO does the same.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`clickFaction`, `factionFlag`)
- **Pinned by:** `W and M clear the others; kept bug: A does not clear W` (packages/shared/tests/admin/worldedit.test.ts); `the flag boxes write field 12; SAFE AREA loads from item 1` (packages/client/tests/worldeditor.test.ts)

### The World Editor's lit S button jumps to layer 3
- **What you notice:** in the World Editor, clicking the S layer button when it is already lit selects layer 3 and lights it, without unlighting S. Clicking a lit 1, 2 or 3 does nothing.
- **In 1.6 and SSO:** only the unlit layer buttons have scripts, except the lit S one, which selects layer 3. SSO does the same.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`clickLayer`)
- **Pinned by:** `kept bug: the lit S button selects layer 3 and stays lit` (packages/shared/tests/admin/worldedit.test.ts)

### The World Editor's exit panels keep the last map's exits
- **What you notice:** in the World Editor, loading a map with no exit leaves the exit panel showing the previous map's values, and saving writes them into the new map.
- **In 1.6 and SSO:** loading fills the exit fields only when the map has that exit. SSO does the same, in the editor screen.
- **In the code:** `packages/shared/src/rules/admin/worldedit.ts` (`exitFieldsAfterLoad`)
- **Pinned by:** `kept bug: exit panels keep the last map's exits (a map without an exit leaves the panel as it was)` (packages/shared/tests/admin/worldedit.test.ts); `kept bug: a map with no exit keeps the last map's exit fields` (packages/client/tests/worldeditor.test.ts)

### The NPC editor's LOAD drops lines and first characters
- **What you notice:** in the NPC editor, LOAD shows only the file's first 100 lines, leaves out empty lines, and drops the first character of any line that doesn't start with T, P, B, S, R, G, F or I. A player shop's `OWN|` line comes back as `WN|`. Saving writes back what the box holds, so a LOAD and SAVE renumbers the file's lines and cuts it at 100.
- **In 1.6 and SSO:** the loader strips what it takes for a leftover line-feed from each line, but it also removes real first characters. SSO does the same, in the editor screen. The editor's lists hold no player shop, and SSO refuses a save with `WN|` as an unknown tag, so a typed `OWN|` line shows as `WN|` and must be retyped to save again.
- **In the code:** `packages/shared/src/rules/admin/npcfile.ts` (`showNpcScript`)
- **Pinned by:** `kept bug: LOAD drops a first character other than T P B S R G F I; OWN| becomes WN|` and `kept bug: LOAD drops empty lines and shows lines 1-100 only` (packages/shared/tests/admin/npcfile.test.ts); `LOAD's reply goes through the NPC-show script` (packages/client/tests/npceditor.test.ts)

### A `-` line or `/warpscript` from a non-immortal stays in the chat box
- **What you notice:** if you type a line starting with `-`, such as "- hello" or "-)", or a `/warpscript` command, and you are not an immortal, nothing is sent and the line stays in the chat box.
- **In 1.6 and SSO:** the chat send leaves without clearing the box for anyone but an immortal. SSO does the same: the server answers with a restore message that puts the line back in the chat input.
- **In the code:** `packages/server/src/systems/admin/commands.ts` (`adminChat`, `handleAdmin`)
- **Pinned by:** `kept bug: anyone else's - line sends nothing and stays typed` and `kept bug: anyone else's line stays typed` (packages/server/tests/admin.test.ts)

### Admin chat looks like ordinary chat
- **What you notice:** an immortal's message to the admins shows up white, like local chat, not in a special colour, and a reader inside a house, below its tenth row, reads "You hear a muffled voice." instead. A sender in a house must be at row 7 or above. Readers who ignore the sender don't see it.
- **In 1.6 and SSO:** admin chat is sent as an ordinary line, so it is coloured, muffled and filtered like one. SSO does the same, the reader's ignore list included.
- **In the code:** `packages/shared/src/rules/admin/admin.ts` (`formatAdminChat`, `adminChatRefusedInHouse`)
- **Pinned by:** `an immortal's line reaches immortals and moderators in white, the sender included` and `kept bug: a reader in a house at y > 10 hears a muffled voice; the sender must be at y ≤ 7` and `kept bug: admin chat is a sqa, so a reader ignoring the sender misses it` (packages/server/tests/admin.test.ts)

## casino

### The slots row 2-3-2 pays 80
- **What you notice:** three reels showing 2-3-2 pay 80, and 4-4-4 pays 50. Over all possible reels the machine gives back about 76.6 % of what is put in.
- **In 1.6 and SSO:** the same payout table; SSO rolls the reels with the server's random numbers.
- **In the code:** `packages/shared/src/rules/casino/casino.ts` (`slotPayout`, `slotReels`)
- **Pinned by:** `2-3-2 pays 80 and 4-4-4 pays 50; RTP 245/64 over all 64 reels` (packages/shared/tests/casino/casino.test.ts)

### Blackjack aces drop 10 each at once, then may add 11
- **What you notice:** a hand's total can look odd with several aces: A-A shows 13, A-A-9 shows 11, A-A-A shows 14, A-5 shows 16 and 10-9-5 shows 24.
- **In 1.6 and SSO:** aces count 11. If the total goes over 21, 10 is taken off for every ace at once, and then, still in that case, 11 is added back if the result is under 11. The server totals hands with the same routine.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`handTotal`)
- **Pinned by:** `the Ace routine: A-A 13, A-A-9 11, A-A-A 14, A-5 16, 10-9-5 24` (packages/shared/tests/casino/blackjack.test.ts)

### Both blackjack hands bust and the higher bust still wins
- **What you notice:** if both players bust with different totals, the "draw" line prints once and the higher bust wins the stake anyway. Equal busts print the draw line twice and nobody wins; equal totals that did not bust print it once.
- **In 1.6 and SSO:** the draw message is sent but the settlement carries on to compare the totals. SSO has the same order of outcomes and the same lines.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`outcome`); `packages/server/src/systems/casino/blackjack.ts` (`settle`)
- **Pinned by:** `the outcome lines: 25 v 23 draw then P1, 24 v 24 two draws, 18 v 18 one draw, 22 v 17 P2, 17 v 19 P2` (packages/shared/tests/casino/blackjack.test.ts); `kept bug: both bust, different totals: one draw line then the higher bust wins the stake` and `kept bug: equal busts print the draw line twice and refund; an equal non-bust hand once` (packages/server/tests/blackjack.test.ts)

### Blackjack cards are equally likely and the lower bid is the stake
- **What you notice:** each card drawn is one of ten values with the same chance, so a 10 is no more common than an Ace. The game is played for the lower of the two bids, and a bid of 0 gives a free game.
- **In 1.6 and SSO:** a card is a random pick of ten, the stake is the lower bid, and the server ignored amounts below 1. SSO does the same.
- **In the code:** `packages/shared/src/rules/casino/blackjack.ts` (`drawCard`, `stake`, `bidCheck`)
- **Pinned by:** `drawCard is random(10) + 50, crd51 = 11 and crd60 = 10` and `the stake is the lower bid; 0 is a free game` (packages/shared/tests/casino/blackjack.test.ts)

### Checkers has no multi-jump and no forced capture
- **What you notice:** a jump is one move and your turn then passes, even if another jump is available. You are never forced to capture. A side that still has pieces but no legal move cannot move, and play waits until someone closes the window; only having no piece left on the board loses.
- **In 1.6 and SSO:** the original's move rules worked this way. SSO validates moves on the server with the same rules and the same win test.
- **In the code:** `packages/shared/src/rules/casino/checkers.ts` (`checkersMove`, `loser`); `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `no multi-jump: a jump is one move, the turn passes after it` and `the loser is the side with no piece on the board; blocked sides do not lose` (packages/shared/tests/casino/checkers.test.ts); `kept bug: no multi-jump, no win by blocking: pieces left means play goes on` (packages/server/tests/checkers.test.ts)

### The high score total leaves out eight skills and ties never rank
- **What you notice:** the number that goes on the high score board adds up most of your skills but leaves out eight of them, and a score tying an existing one does not rank. A ranked score replaces your own entry even when it is lower.
- **In 1.6 and SSO:** the total comes from a misspelt variable in the bio sum, and ranking needs a strictly higher score. SSO uses the same sum and ranking.
- **In the code:** `packages/shared/src/rules/casino/casino.ts` (`highScorePoints`, `submitsScore`); `packages/shared/src/rules/social/bios.ts` (`bioScore`); `packages/shared/src/rules/social/assassin.ts` (`rankEntry`)
- **Pinned by:** `the high score ranks with your own entry blanked, ties never rank, and your entry can drop` and `the points are the bio's sum, skipping the eight typo'd skills` (packages/shared/tests/casino/casino.test.ts); `kept bug: the score drops the eight skills of the misspelt-variable line` pins the sum itself (packages/shared/tests/social/friends-bios-medals.test.ts)

### The blackjack "wrong spot" text goes quiet after your first table
- **What you notice:** click a blackjack table from the wrong spot and you are told you must be standing beside it, but only the first time. Once you have opened any slot panel or blackjack table, that text never shows again until you log in again. Checkers always says it.
- **In 1.6 and SSO:** a flag set by the first slot panel or blackjack table is never cleared until the client restarts, and the text only shows while it is unset. Checkers has no such flag. SSO does the same per login: the flag is cleared when the player is cleared on a login or a resume.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjSit`, `casinoShown`)
- **Pinned by:** `kept bug: the wrong-spot text shows once, then goes silent, also after a slot panel` (packages/server/tests/blackjack.test.ts)

### A blackjack or checkers seat stays when you change map
- **What you notice:** if you respawn or warp while seated at a blackjack or checkers table, the table is still up. You can walk around and still finish the hand from there.
- **In 1.6 and SSO:** the table's screen is only hidden by Leave, and the game group is named by the table's position with no map in it. A map load frees your keys but not the screen. The checkers window is its own window, joined on the old map. SSO keeps the seat and the screen, frees walking, and lets play go on from anywhere.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjTableOf`); `packages/server/src/systems/casino/checkers.ts` (`ckTableOf`)
- **Pinned by:** `kept bug: the seat stays across a map change; walking is freed and the hand finishes` (packages/server/tests/blackjack.test.ts); `kept bug: the window stays across a map change and play goes on` (packages/server/tests/checkers.test.ts)

### The first checkers player sees the start line twice
- **What you notice:** when a second player sits down, the player who was already there reads "*** The Checkers Game Has Started. It's <Black>'s (black) turn." twice. The newcomer reads it once.
- **In 1.6 and SSO:** the newcomer's join reply reaches the first player after both sides are known, and each copy prints the line. SSO does the same.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckSit`)
- **Pinned by:** `kept bug: the first player sees the start line twice, the newcomer once` (packages/server/tests/checkers.test.ts)

### The loser of a checkers game moves first in the next
- **What you notice:** after a win the board resets and the loser is to move first, with no start line printed.
- **In 1.6 and SSO:** the winning move's "your turn" message to the loser arrives after the board reset, and nothing sets the turn back to Black. SSO does the same.
- **In the code:** `packages/server/src/systems/casino/checkers.ts` (`ckMove`)
- **Pinned by:** `a capture, then a king, then the win line from the loser to the map` (packages/server/tests/checkers.test.ts)

### A five-card blackjack hand can keep hitting to no effect
- **What you notice:** with five cards in your hand you can keep pressing Hit. Nothing happens: no card, no text and no sound.
- **In 1.6 and SSO:** a hit with five cards fills no card slot and the hand total is only worked out when a slot fills. SSO does the same: a sixth hit does nothing and draws no card.
- **In the code:** `packages/server/src/systems/casino/blackjack.ts` (`bjHit`)
- **Pinned by:** `kept bug: a five-card hand can keep hitting with nothing happening` (packages/server/tests/blackjack.test.ts)

### A slot pull without 5 gold closes the panel, then complains
- **What you notice:** pull the lever with under 5 gold and the slot panel closes first, and only then do you read "You don't have enough gold to play!".
- **In 1.6 and SSO:** the client closes the panel when you are short, and the server's not-enough-gold line arrives after. SSO closes the panel and then prints that line.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`)
- **Pinned by:** `kept bug: a short slot pull closes the panel before the gold line` (packages/server/tests/casino.test.ts)

### The slot panel stays open across a map change and pulls anywhere
- **What you notice:** if you warp or respawn with the slot panel open, it is still up, you can walk with it open, and the lever still works wherever you are.
- **In 1.6 and SSO:** the panel is a set of sprites that only Close hides, drawing a new map frees your keys, and the pull has no position test. SSO keeps the panel open across a map change, the map load frees walking, and a pull needs only an open, idle panel.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotPull`)
- **Pinned by:** `kept bug: the slot panel stays open across a map change and pulls anywhere` (packages/server/tests/casino.test.ts); `kept bug: the panel stays open when the map changes: nothing but Close and the server close it` (packages/client/tests/slots.test.ts)

### Only an item named exactly "Slot Machine" plays
- **What you notice:** an item called "Slot Machine 2" does nothing when you click it or press Ctrl, though it counts as a slot machine for the click.
- **In 1.6 and SSO:** the click sends any name containing "Slot Machine" on, but the game itself tests for the exact name. SSO does the same.
- **In the code:** `packages/server/src/systems/casino/slots.ts` (`slotOpen`)
- **Pinned by:** `kept bug: only an item named exactly 'Slot Machine' plays; 'Slot Machine 2' routes and says nothing` (packages/server/tests/casino.test.ts)

## chat

### /help only looks at the first word after it
- **What you notice:** Type /help followed by a topic of two words and you get nothing useful: only the word right after /help is looked up, so two-word topics have no help.
- **In 1.6 and SSO:** 1.6 took word 2 of the line as the topic, and SSO looks it up the same way. With no topic the topic is "Help".
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`), `packages/server/src/systems/chat/chat.ts` (`helpReply`)
- **Pinned by:** `/help: word 2 only, 'Help' when absent, any case` (packages/shared/tests/chat/chat.test.ts); `kept bug: only word 2 is sent, so two-word topics have no help` (packages/server/tests/chat.test.ts); `kept bug: /help topics, a missing topic, and a two-word topic` (packages/server/e2e/chat-and-presence.test.ts)

### Instant-message windows are never freed
- **What you notice:** Closing an IM window does not free it: it keeps its sender and text, and the next message from that person reopens it. After ten different senders, an eleventh takes a random window and wipes the conversation in it.
- **In 1.6 and SSO:** 1.6 picked the window already holding the sender, else the lowest free one, else a random one of ten, and nothing ever reset a slot. SSO does the same, in the page.
- **In the code:** `packages/shared/src/rules/chat/im.ts` (`pickImSlot`), `packages/client/src/ui/im.ts` (`createImWindows`)
- **Pinned by:** `kept bug: slots are never freed; the 11th sender takes random(10) and clears it` (packages/shared/tests/chat/im.test.ts); `kept bug: closing keeps the slot and its text; the next IM reopens it` and `kept bug: the 11th sender takes random(10) and clears it` (packages/client/tests/im.test.ts)

### Ignoring someone twice keeps two entries, and unignore removes one
- **What you notice:** /ignore adds whatever you typed without checking it. /unignore always says "Removed ...", but if the same name is listed twice in a row, one copy survives.
- **In 1.6 and SSO:** 1.6 deleted matches while stepping through the list and skipped the line after each deletion, so of two adjacent copies one stayed. SSO does the same on the stored list.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`ignoreAdd`, `ignoreRemove`)
- **Pinned by:** `kept bug: unignore skips the line after each deletion, so one of two adjacent copies survives` (packages/shared/tests/chat/im.test.ts)

### Only the first 50 names on your ignore list work
- **What you notice:** If your ignore list is long, names past the 50th no longer silence chat or broadcasts, and names past the 40th no longer block instant messages.
- **In 1.6 and SSO:** 1.6 tested only the first 50 lines of the list for chat and broadcasts and the first 40 for IMs. SSO does the same.
- **In the code:** `packages/shared/src/rules/chat/ignore.ts` (`IGNORE_WINDOW`, `ignores`)
- **Pinned by:** `kept bug: only the first 50 entries count, 40 for IMs` (packages/shared/tests/chat/im.test.ts); `kept bug: only the first 50 entries count for chat` and `kept bug: only the first 40 entries count for IMs` (packages/server/tests/im.test.ts)

### Guild Chat without a guild drops you from your current room
- **What you notice:** Choose Guild Chat when you have no guild and you read "You don't belong to a guild!", but you have already left the room you were in. You no longer hear it and the other members' lists drop you.
- **In 1.6 and SSO:** 1.6 left the old room before checking for a guild, and the chat window stayed up. SSO does the same, except that your later lines go nowhere, because the server checks room membership.
- **In the code:** `packages/server/src/systems/chat/rooms.ts` (`enterRoom`)
- **Pinned by:** `kept bug: Guild Chat with no guild leaves your room first; your lines then go nowhere` (packages/server/tests/im.test.ts)

### An away message of "off" is off, and an empty one replies blank
- **What you notice:** Set an away message of "off" in any case and you are told it is turned on, but nobody who messages you gets a reply. Set an empty away message and every IM is answered with an empty message.
- **In 1.6 and SSO:** 1.6 answered IMs while the away text was anything other than OFF, ignoring case. SSO does the same.
- **In the code:** `packages/shared/src/rules/chat/im.ts` (`awayAnswers`)
- **Pinned by:** `kept bug: an away text of off (any case) is off; an empty one is on` (packages/shared/tests/chat/im.test.ts); `kept bug: an away text of OFF answers nothing; an empty one answers empty` (packages/server/tests/im.test.ts)

### /me works where talking is blocked, and guild chat skips ignore lists
- **What you notice:** Inside a house on the lower rows, plain talk is refused, but /me still goes through. Guild chat is heard even by members who have the speaker on their ignore list.
- **In 1.6 and SSO:** 1.6 applied the house rule only to plain talk and never consulted the ignore list for guild chat. SSO does the same.
- **In the code:** `packages/server/src/systems/chat/chat.ts` (`handleChat`), `packages/server/src/systems/social/guilds.ts` (`guildChat`)
- **Pinned by:** `kept bug: in a house at y > 10 you cannot talk; /me still goes` (packages/server/tests/chat.test.ts); `kept bug: guild chat never consults an ignore list` (packages/server/tests/guilds.test.ts).

### A broadcast gets through with under a second of cooldown left
- **What you notice:** Shout again just before the wait is over and it goes through, because the wait is counted in whole seconds and under one second reads as none.
- **In 1.6 and SSO:** 1.6 rounded the remaining time down, so with 1 to 19 frames left the broadcast was allowed; 1.6 never showed this, because its cooldown was cleared for registered players. SSO applies the cooldown, so the rounding now matters, and the effective cooldown is 981 frames. A failed shout from jail still starts the cooldown.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`broadcastRefusal`)
- **Pinned by:** `kept bug: under 20 frames left reads 0 seconds and lets the broadcast through` (packages/shared/tests/chat/chat.test.ts); `kept bug: with fewer than 20 frames left the broadcast goes through` (packages/server/tests/chat.test.ts)

### A line of only spaces says an empty quote
- **What you notice:** Type some spaces and press Enter and everyone on the map sees `Bob says ""`.
- **In 1.6 and SSO:** 1.6 stripped the spaces but still sent the line with nothing between the quotes. SSO does the same.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`parseChatLine`, `formatSay`)
- **Pinned by:** `kept bug: a line of only spaces still says an empty quote` (packages/shared/tests/chat/chat.test.ts)

### Password= keeps one of two forbidden characters in a row
- **What you notice:** Set a password with two forbidden characters side by side (for example two spaces) and one of them stays in the password: `Password=a  b` becomes `a b`.
- **In 1.6 and SSO:** 1.6 stripped spaces, slashes, colons and backslashes in four passes that skip the character sliding into place after each deletion. SSO runs the same four passes on the server.
- **In the code:** `packages/shared/src/rules/chat/chat.ts` (`passwordFrom`)
- **Pinned by:** `kept bug: Password= strips space, slash, colon and backslash and keeps one of two in a row` (packages/shared/tests/chat/chat.test.ts); `kept bug: Password= keeps one of two forbidden characters in a row` (packages/server/tests/password-db.test.ts)

## client

### The World Editor's sign panel hides the exit panel's map X field
- **What you notice:** in the World Editor, clicking the sign panel while exit panel 1 is open hides exit 1's map X field (and two neighbouring fields), and the map X field stays hidden until you leave the editor. Its text is kept and still saved.
- **In 1.6 and SSO:** the sign panel's background has a script that swaps one of those fields' sprites to a blank picture and hides them. SSO does the same, in the editor screen.
- **In the code:** `packages/client/src/ui/worldeditor.ts` (`exitXGone`)
- **Pinned by:** `kept bug: the sign panel's background breaks exit 1's map X field` (packages/client/tests/worldeditor.test.ts)

### A monster's hit on you shows just a number
- **What you notice:** when a monster hits you, a number floats up but there is no splat picture and no hit sound, unlike a player's hit.
- **In 1.6 and SSO:** the message for a monster hit is one field short of the player-hit message, so the floating text reads the wrong fields and only the number shows. In SSO the hit event for a monster hit carries the number in colour 6, and the client draws no splat and plays no sound.
- **In the code:** `packages/client/src/model.ts` (`applyDelta`)
- **Pinned by:** `kept bug: a monster's hit on you shows the number in colour 6 with no splat and no sound` (packages/client/tests/combat.test.ts)

### The sell OK button stays on top of the buy list
- **What you notice:** open a shop's sell list and then its buy list, and the sell OK button stays shown over the buy list. Press it on a buy line and the server answers "Error in trying to sell!" unless the shopkeeper buys that item at that same price.
- **In 1.6 and SSO:** the buy list shows one OK button and the sell list another drawn above it, and neither hides the other; only CANCEL hides both. SSO has the same buttons: the sell request names the selected line, and the server checks the shopkeeper's buy line for that item and price as 1.6 did.
- **In the code:** `packages/client/src/ui/shop.ts` (`createShopWindow`); `packages/server/src/systems/economy/shop.ts` (`npcSell`)
- **Pinned by:** `kept bug: after a sell list the sell OK stays shown over the buy list` (packages/client/tests/npcs.test.ts); `the refusals in order: errsel, too few, none` (packages/server/tests/economy.test.ts)

### The × by an empty Ring box still clicks
- **What you notice:** on the Inventory tab, clicking the × beside an empty equipment box does nothing and makes no sound, except beside the Ring box, which plays the click and still does nothing.
- **In 1.6 and SSO:** the other five boxes check for an empty slot before their click; the Ring box clicks first and checks after. SSO does the same.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `kept bug: the empty Ring × clicks, sending nothing` (packages/client/tests/panel.test.ts)

### Item menu buttons click before they check anything
- **What you notice:** Use, Equip, Drop and the swapped Cook, Mix, Build, Smith and Open buttons always play the click, even when the action is then refused or locked out. Give is silent.
- **In 1.6 and SSO:** each of those handlers plays the click as its first statement, before the key lock, the item pause and every refusal. SSO does the same: a refused or locked action still clicks, the Cook, Mix, Build, Smith and Open buttons that are not yet built click too, and Give is silent.
- **In the code:** `packages/client/src/ui/panel.ts` (`createPanel`)
- **Pinned by:** `kept bug: the item menu clicks before its locks and refusals; Give is silent` (packages/client/tests/panel.test.ts)

### Buying and selling in a shop make no cash sound
- **What you notice:** a purchase or a sale is heard only as the OK button's click; the cash sound never plays.
- **In 1.6 and SSO:** the cash sound was only wired to messages the server never sent, or to a handler nothing called because the message is handled on the spot. SSO also plays no cash sound for a shop purchase or sale.
- **In the code:** `packages/client/src/ui/shop.ts` (`createShopWindow`)
- **Pinned by:** `kept bug: a buy and a sale play only the OK click, never cash` (packages/client/tests/npcs.test.ts)

### Slot machine sounds can cut off other sounds
- **What you notice:** the slot machine sound plays on a random one of four sound channels, so it can cut off a spell, a monster hit or the church bell that was playing there.
- **In 1.6 and SSO:** the pull picks its channel at random. SSO does the same for the slot machine. Rain is not built, since no map could have rain in 1.6.
- **In the code:** `packages/client/src/sfx.ts` (`spellSounds`)
- **Pinned by:** `kept bug: the Slot Machine sound picks random(4) before the BSmith roll` (packages/client/tests/slots.test.ts)

### Closing the mail list with a draft open breaks the Use button
- **What you notice:** Close the mail list while the compose pane is open and the Use button in your bag does nothing at all, until you close the compose pane or enter the game again.
- **In 1.6 and SSO:** 1.6's list CLOSE left the compose pane's flag on, and the Use button quietly exits while that flag is on. SSO does the same: the flag outlives the list and the app's Use handler exits while it is set.
- **In the code:** `packages/client/src/ui/mail.ts` (`composeUp`), `packages/client/src/app.ts` (`createPanel`)
- **Pinned by:** `an unsent draft survives WRITE, and list CLOSE with the compose up leaves Use dead; reopen shows it` (packages/client/tests/mail-boards.test.ts)

### A draft or read pane reappears when you next open the mailbox
- **What you notice:** Close the mail list with the compose or read pane open, and the next time you open a mailbox that pane is back, with your draft or the old message still in it.
- **In 1.6 and SSO:** 1.6's panes exist only on the mail screen, so closing the list took them off the stage but kept their flag. SSO draws a pane only while its flag is on and the mail screen is up.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `an unsent draft survives WRITE, and list CLOSE with the compose up leaves Use dead; reopen shows it` (packages/client/tests/mail-boards.test.ts)

### Deleting a message leaves it on screen, so a second Delete removes the next
- **What you notice:** Press DELETE and the message is removed from the list, but the read pane still shows it and the selection stays on the same line number. Press DELETE again and the next message goes too.
- **In 1.6 and SSO:** 1.6 removed the selected item and rebuilt the list without clearing the selection or the read pane. SSO does the same and sends the message's own id with each delete.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `DELETE twice removes the next message with the read pane unchanged` (packages/client/tests/mail-boards.test.ts)

### An unsent mail draft is kept
- **What you notice:** Press WRITE and the compose pane shows whatever you left in the three fields. Only a send clears them.
- **In 1.6 and SSO:** 1.6 never cleared the fields except on a send. SSO does the same. A send the server refuses, such as the chat wait, also keeps the draft.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `an unsent draft survives WRITE, and list CLOSE with the compose up leaves Use dead; reopen shows it` and `kept bug: a refused send (no mailSent) keeps the draft with the compose open` (packages/client/tests/mail-boards.test.ts)

### The read pane shows the sender on the TO: line
- **What you notice:** When you read a message, the line labelled TO: holds the name of whoever sent it.
- **In 1.6 and SSO:** 1.6 reused the compose pane's art for reading, with the sender in its TO field. SSO does the same.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `READ with nothing selected does nothing; with a line it fills the read pane` (packages/client/tests/mail-boards.test.ts)

### The mail list has no scroll bar
- **What you notice:** The From and Subject columns are fixed boxes. Only the lines that fit are shown, and you cannot scroll to the rest.
- **In 1.6 and SSO:** 1.6 used fixed-size boxes with no scroll bar. SSO does the same: about 20 lines show. The box holds at most 50 messages, so the rest can be reached by deleting the ones above.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `kept bug: the list columns are fixed 271-px boxes with no scroll bar` (packages/client/tests/mail-boards.test.ts)

### Opening the mail list covers the chat entry
- **What you notice:** With the mail list up, you cannot click into the chat entry box, because a blocker sits over it.
- **In 1.6 and SSO:** 1.6 showed a blocker over the chat entry along with the list. SSO does the same.
- **In the code:** `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `the chat blocker follows the list; CLOSE unlocks, leaves frame 72 and tells the server` (packages/client/tests/mail-boards.test.ts); `the stage places the mail and board at their rects; the blocker covers the chat entry only while the list is up` (packages/client/tests/shells.test.ts)

### A new photo overwrites a cancelled painting
- **What you notice:** Cancel a painting, then take a photo, and the photo's crop replaces the picture you cancelled.
- **In 1.6 and SSO:** 1.6 wrote the photo into the same image a cancelled canvas keeps. SSO does the same: the crop overwrites the client's one shared picture.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`), `packages/shared/src/rules/mail/paint.ts` (`photoCrop`)
- **Pinned by:** `a good shot hides the lens, redraws, crops 64×64 around the tap and saves a photo` (packages/client/tests/art-news.test.ts)

### You can paint on a painting you are viewing
- **What you notice:** Open someone's painting in the viewer, hold the mouse down on it and your current tool paints on the picture.
- **In 1.6 and SSO:** 1.6 left the paint behaviour on the viewer's picture. SSO does the same, on your own client's copy only.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `kept bug: a pointer down on the viewed image paints on it at (mouse − top-left) / 4` (packages/client/tests/art-news.test.ts)

### The colour picker picks up whatever is on screen under it
- **What you notice:** Hold the picker over any part of the paint screen and it takes that pixel's colour, whatever is drawn there.
- **In 1.6 and SSO:** 1.6 read the colour straight from the screen. SSO reads the paint screen's art with the preview drawn over it.
- **In the code:** `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `the colour pick reads the paint screen's art, or the preview where it lies over it` (packages/client/tests/art-news.test.ts)

### At 1 HP or SP the bar's number disappears off the right edge, and above 180 it spills left
- **What you notice:** When your HP or SP drops to 1 (or single digits near it), the white number beside the bar disappears off the right edge of the window. Above ~180 HP or SP, the number spills left out of the bar cutout onto the wooden panel border.
- **In 1.6 and SSO:** 1.6's bar loader caps the fill offset at 200 (`locH = 871 − min(value, 200)`) and puts the 34-px right-aligned number field at `locH − 102` on channels 318–319, above the panel and frame strips. At `1`, the field sits at `x = 768..802` so the right-aligned digit lands past the 800-px stage edge; at `200+`, it sits at `x = 569..603`, visible over the panel border. SSO places the bars and number fields in the same channels with only the 800×600 stage clipping them.
- **In the code:** `packages/client/src/ui/bars.ts` (`createBars`), `packages/client/src/ui/shells.ts` (`createGameView`)
- **Pinned by:** `kept bug: at 1 HP/SP the number sits past the 800-px stage edge; above 200 the fill caps and the number spills left` (packages/client/tests/combat.test.ts)

## combat

### "You cannot fight here!" repeats while attack is held
- **What you notice:** on a map where fighting is not allowed, holding the attack key sends "You cannot fight here!" over and over rather than once. In SSO's chat you see one line with a growing ×N count, because identical lines are collapsed.
- **In 1.6 and SSO:** the message is sent every frame the key is held. SSO sends it on every rejected tick; the chat window collapses identical consecutive lines.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`)
- **Pinned by:** `kept bug: off an arena tile on a no-fight map, every held frame says it` (packages/server/tests/monsters.test.ts)

### Hold stops walking but not attacking
- **What you notice:** while a Hold spell has you rooted, you can't walk or turn, but you can still swing.
- **In 1.6 and SSO:** the attack key is checked before the Hold gate on movement. SSO does the same: the Hold counter gates steps and turns only, and the attack poll runs regardless.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`)
- **Pinned by:** `kept bug: Hold stops walking but not attacking: the key is polled before the Hold gate` (packages/server/tests/melee.test.ts)

### Axes wait 15 frames between swings below Axe Fighting 90
- **What you notice:** with an axe, every swing is followed by a wait of 15 frames instead of the normal 14 until your Axe Fighting reaches 90. At 90 and above you get the normal wait (10 with the Ring of Quickness).
- **In 1.6 and SSO:** the axe skill steps are checked from low to high, from 25 frames at the lowest skills down to 15, and the last step that matches wins. So every skill below 90 ends on 15. SSO runs the same ladder in the same order.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`swingCooldowns`)
- **Pinned by:** `kept bug: axe cascade gives AtDelay 15 below AxeFighting 90, so 16 frames` (packages/shared/tests/combat/combat.test.ts)

### A fishing pole swings slowly even with the Ring of Quickness
- **What you notice:** a Fishing Pole always makes you wait 20 frames between swings, and the Ring of Quickness does not shorten it.
- **In 1.6 and SSO:** the pole's wait is set after the ring's speed-up has been applied, so it overwrites it. SSO sets them in the same order.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`swingCooldowns`)
- **Pinned by:** `kept bug: fishing pole ignores the Ring of Quickness, 21 frames` (packages/shared/tests/combat/combat.test.ts)

### Holding the attack key swings one frame slower than the cooldown
- **What you notice:** if you hold Tab, you swing once every 15 frames by default, one more than the 14-frame cooldown.
- **In 1.6 and SSO:** the game only marks you as ready to attack at the start of a frame where the cooldown has already reached 0, which is after the previous frame's countdown and before it checks the key. So a held key attacks every cooldown plus one frames. SSO's server runs its steps in the same order and checks whether the key is held on every tick.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`tickAttackTimers`); `packages/server/src/systems/combat/melee.ts` (`pollAttack`)
- **Pinned by:** `kept bug: holding attack swings every AtDelay + 1 = 15 frames` (packages/shared/tests/combat/combat.test.ts)

### Big monsters can only be hit through the tile you face
- **What you notice:** the Overlord and the Mutant Worm are wider than one tile, but you can only hit their extra tiles when you are facing them. A big monster whose extra tiles sit under your own feet is missed.
- **In 1.6 and SSO:** the extra tiles are tested only against the tile you face. The test against your own tile uses the monster's main tile only. SSO does the same tests on the server's positions.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`meleeReaches`, `FOOTPRINT_CELLS`)
- **Pinned by:** `kept bug: the 3x2 footprint is tested only on the faced tile` (packages/shared/tests/combat/combat.test.ts)

### A bow with no arrows melees for 1; with no crystals it wastes the swing
- **What you notice:** swing a bow with no arrows and you simply hit for 1 as in melee. With arrows but no crystal of the right colour, the swing is lost: you wait the cooldown, your attack bar resets and you leave combat.
- **In 1.6 and SSO:** the attack power is set to 1 and the swing carries on as a normal melee hit when there are no arrows. With arrows but no crystal, the swing ends after the cooldown and bar reset. SSO does the same.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`attackPower`)
- **Pinned by:** `bow without arrows melees for 1` (packages/shared/tests/combat/combat.test.ts); `bow with arrows and no crystal wastes the swing` (packages/shared/tests/combat/combat.test.ts)

### A player who just stepped away is hit by a swing at the wrong tile
- **What you notice:** if a player is part-way through a step, your swing can hit them on a tile they are not near, and can miss them on the tile they just left.
- **In 1.6 and SSO:** the check for the victim's old tile reads the old Y coordinate twice and compares it with both the X and the Y of the tile you face. SSO does the same while the victim is mid-step, with the same rule for comparing text and numbers as the original had.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pvpSwing`)
- **Pinned by:** `kept bug: the victim's old-tile test uses the old Y twice: a victim stepping from (9,4) is hit by a swing at (4,4)`; `kept bug: a victim who has just left the faced tile is missed when its old Y is not the faced X` (packages/server/tests/melee.test.ts)

### Parry and Block rolls start out almost never succeeding
- **What you notice:** at very low Parry or Block skill, monsters almost never get parried or blocked. Against players the odds start from a draw out of 90 for any skill.
- **In 1.6 and SSO:** against monsters the Parry and Block draws are out of 3000 until the skill is above 10, then step down through the skill ladder. Against players Parry starts from a draw out of 90 whatever the skill. SSO ports both ladders.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`dodgeRoll`); `packages/shared/src/rules/combat/armour.ts` (`pvpDodge`)
- **Pinned by:** `kept bug: parry and block are random(3000) until the skill is over 10` (packages/shared/tests/combat/combat.test.ts). `PvP parry: base random(90), then one draw per threshold passed` (packages/shared/tests/inventory/inventory.test.ts).

### A swing that also hits a monster never hurts a player
- **What you notice:** if one swing hits a monster, no player takes damage from it, even if one stands on the same tile.
- **In 1.6 and SSO:** the monster damage added to the Attack message leaves a field that other players read as an arrow shot, so they skip the player-hit check. SSO does the same: a swing that damages any monster hits no player.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`workAttack`)
- **Pinned by:** `kept bug: a swing that also hits a monster deals no PvP damage` (packages/server/tests/inventory.test.ts)

### With Block at 0, players never block each other's hits
- **What you notice:** a player with no Block skill can never block a player's hit. Only Faction 3 players can block at 0.
- **In 1.6 and SSO:** the player-versus-player block roll has no starting draw, so at Block 0 it keeps the value left over from the parry roll, which is at least 2. Faction 3's subtraction and re-roll is the only way it can come out as a block. SSO ports it literally.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`pvpDodge`)
- **Pinned by:** `kept bug: PvP Block 0 never blocks` (packages/shared/tests/inventory/inventory.test.ts)

### Holy Shield wins only after the dodge rolls have been spent
- **What you notice:** a player or monster who hits an innocent standing on a Holy Shield gets "Shield" as the result, but the parry and block dice were rolled first and used up.
- **In 1.6 and SSO:** the shield check comes after the parry and block draws in both the player and the monster hit handlers. The draws are consumed and then the Shield outcome wins. SSO draws in the same order.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`pvpHit`); `packages/shared/src/rules/combat/combat.ts` (`monsterHitsPlayer`)
- **Pinned by:** `kept bug: an innocent on a Holy Shield's exact spot gets Shield after the parry and block draws` (packages/server/tests/spells.test.ts)

### The message about a missing green crystal says "geen"
- **What you notice:** a bow with Green Arrows and no green crystal prints "You don't have any geen crystals left!"
- **In 1.6 and SSO:** the original text has this typo, and SSO prints the same text.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`attackPower`)
- **Pinned by:** `kept bug: "geen crystals"` (packages/shared/tests/inventory/inventory.test.ts)

### The Adventurer's parry and block bonus hardly helps against players
- **What you notice:** Faction 3 players get a parry and block bonus, but against other players it barely changes anything. Against monsters it helps a lot.
- **In 1.6 and SSO:** the bonus subtracts 4 (parry) or 10 (block) from the draw, and a result below 1 is re-rolled from a draw out of 90 rather than clamped to 1. A chance of 1 in N only rises to about 1.04 in N for parry or 1.11 in N for block. Against monsters the same subtraction clamps to 1, which gives about 11 in N. SSO ports both literally.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`pvpDodge`); `packages/shared/src/rules/combat/combat.ts` (`dodgeRoll`)
- **Pinned by:** `kept bug: faction-3 parry/block bonus nearly void in PvP: a draw pushed below 1 is re-rolled as random(90), not clamped to 1 as against monsters` (packages/shared/tests/inventory/inventory.test.ts)

### A negative defense bonus cuts damage you take
- **What you notice:** a negative defense bonus does not make you take more damage; it lowers the damage as well.
- **In 1.6 and SSO:** when the bonus is below 0 it is added to the attack power, which makes it smaller, the opposite of what the sign suggests. SSO does the same.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`randomAndDefense`)
- **Pinned by:** `kept bug: negative DefenseBonus also reduces damage` (packages/shared/tests/combat/combat.test.ts)

### Ice and fire armour change the shown damage, not what you lose
- **What you notice:** wearing elemental armour against the Yeti, Snow Serpent, Snow Demon or Fire Demon changes the floating number you see, but you lose the full amount of hit points anyway.
- **In 1.6 and SSO:** the hit points are taken off before the Ice and Fire modifiers are worked out, and those only change the number shown. SSO subtracts first, then computes the displayed number with the modifiers.
- **In the code:** `packages/shared/src/rules/combat/combat.ts` (`monsterHitShown`)
- **Pinned by:** `monster hit shown after the HP loss: elemental vs "a Yeti"` (packages/shared/tests/inventory/inventory.test.ts)

### No monster is protected from armour-breaking
- **What you notice:** every monster can break your armour, including the ones the game meant to exclude.
- **In 1.6 and SSO:** the exclusion list holds bare monster names, but the check is handed the name with "a " in front, so nothing ever matches. SSO lets every monster break armour.
- **In the code:** `packages/shared/src/rules/combat/armour.ts` (`rollArmourBreak`)
- **Pinned by:** `kept bug: the armour exclusion list never matches "a <name>"` (packages/shared/tests/inventory/inventory.test.ts)

### Immortals take damage from players but not from monsters
- **What you notice:** an immortal player is untouched by monsters, but another player's swing still hurts them.
- **In 1.6 and SSO:** the monster hit handler exits for immortals, and the player-versus-player one has no such check. SSO does the same: immortals take PvP melee damage, not monster damage.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pvpSwing`); `packages/server/src/systems/monsters/attack.ts` (`hitMe2`)
- **Pinned by:** `immortals take no monster damage` (packages/server/tests/monsters.test.ts). `kept bug: immortals take PvP damage` (packages/server/tests/inventory.test.ts).

### Weapon name matching gives odd attack power for some items
- **What you notice:** a few items get the wrong attack power. A book is treated like a bow, a Mining Hammer gets no base power and stays at 1, Archery skill 30 gets no bonus at all, and the Gold Sword's Heavy Arms bonus is added twice.
- **In 1.6 and SSO:** the attack power code matches names loosely ("Bo" matches books and bows), has a typo ("Minng Hammer"), resets power for Archery below 30 and has a gap at exactly 30, and runs the Gold Sword's Heavy Arms block twice. SSO ports the original's attack power table literally.
- **In the code:** `packages/shared/src/rules/combat/attpower.ts` (`attackPower`, `tierApplies`)
- **Pinned by:** `kept bug: "Bo" matches books and bows: a book rolls the Bo row 5 + random(8)`; `kept bug: the "Minng Hammer" typo: a Mining Hammer gets no base row and stays at 1`; `kept bug: Archery < 30 resets the bow's power, and Archery = 30 gets no tier at all`; `kept bug: Gold Sword's HeavyArms block runs twice: +11 at HeavyArms 100` (packages/shared/tests/combat/combat.test.ts)

### Holding attack on an arena tile swings every 14 frames
- **What you notice:** on a no-fight map, holding attack on an arena tile swings every 14 frames (10 with the Ring of Quickness), and every swing repeats the last bar tier instead of resetting it.
- **In 1.6 and SSO:** on a no-fight map the arena tile branch swings without checking that you are ready to attack, so it swings on the frame the cooldown reaches 0, before the bar block runs. The swing never resets the bar's picture. SSO polls the key the same way on the server.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`pollAttack`, `onArenaTile`)
- **Pinned by:** `kept bug: on a no-fight map an arena tile swings every 14 frames and repeats the tier` (packages/server/tests/monsters.test.ts)

### Arena tiles at the ends of a row do not make an arena
- **What you notice:** a map whose arena tiles sit only in the first or last column answers a challenge with "This is not an arena!".
- **In 1.6 and SSO:** the arena test needs a space on both sides of the tile marker, and a layer row has none at either end. So a marker only in column 1 or 17 never matches. SSO runs the same test on the pieces of the map record: the 48 layer rows, the three signs and the title.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`recordHasArena`)
- **Pinned by:** `kept bug: a 6P only in column 1 or 17 is not an arena` (packages/shared/tests/combat/arena.test.ts)

### A challenge on some arenas always fails without a word
- **What you notice:** you challenge on a map the game accepts as an arena, but nothing happens and nothing is said.
- **In 1.6 and SSO:** the arena check accepts a marker on layers 2 and up, on rows 10-12, or in a sign or the title. But the search for the tile reads only layer 1, rows 1-9, so all 799 tries miss and there is no message. SSO does the same.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`findArenaTile`, `recordHasArena`)
- **Pinned by:** `kept bug: an arena only on layers 2-S or rows 10-12 passes check 3 and is never found` (packages/shared/tests/combat/arena.test.ts)

### A challenge sometimes fails silently by chance
- **What you notice:** now and then a challenge does nothing and says nothing, even on a good arena. With a single arena tile it happens about 2% of the time.
- **In 1.6 and SSO:** the game makes 799 random tries over the 204 cells of the map record (17 by 12) and gives up quietly if none lands on an arena tile. SSO makes the same tries with its seeded random source.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`findArenaTile`)
- **Pinned by:** `kept bug: one 6P tile fails about 2% of the time` (packages/shared/tests/combat/arena.test.ts)

### Nothing stops two players sharing one arena tile
- **What you notice:** a challenge or a quit can put you on a tile where a player, a monster or a blocking ground item already is.
- **In 1.6 and SSO:** neither the challenge nor the exit tests for anyone or anything on the tile. SSO does the same, so two players can stand on one tile.
- **In the code:** `packages/server/src/systems/combat/arena.ts` (`challenge`, `hopTo`)
- **Pinned by:** `kept bug: nothing checks who stands on the arena tile` (packages/server/tests/arena.test.ts)

### Being held or waiting to respawn does not stop the arena commands
- **What you notice:** a Held player can type quit and leave the Hold, and a player in the wait after death can Challenge. The respawn still warps them when the wait ends.
- **In 1.6 and SSO:** the challenge and quit commands test only whether you are mid-animation. SSO does the same.
- **In the code:** `packages/server/src/systems/combat/arena.ts` (`challenge`, `quitArena`)
- **Pinned by:** `kept bug: Hold and the death wait don't stop the arena words` (packages/server/tests/arena.test.ts)

### Arena tiles on map rows 10 to 12 are never recognised
- **What you notice:** an arena drawn with tiles on rows 10 to 12 of a map does not count as an arena, and a death there is a normal death.
- **In 1.6 and SSO:** the arena test reads the wrong field of the map record for those rows (fields 10 to 12). SSO copies the lookup, which matters only if someone draws an arena on those rows.
- **In the code:** `packages/shared/src/rules/combat/arena.ts` (`isArenaTile`)
- **Pinned by:** `kept bug: arena rows 10-12 are not arena tiles: the test reads map fields 10-12` (packages/server/tests/monsters.test.ts)

### A monster's loot drops on the tile it was heading for
- **What you notice:** a killed monster's loot appears on the tile it was walking into, not the tile it was drawn on.
- **In 1.6 and SSO:** the drop uses the monster's recorded position, which is set to the step's destination when the step starts. SSO drops the loot on the monster's logical tile, which is the same tile.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`rollLoot`, `addGround`); `packages/server/src/systems/spells/collide.ts` (`checkForDead`)
- **Pinned by:** `kept bug: loot lands on the tile the monster was walking into` (packages/server/tests/inventory.test.ts)

### Only melee kills are spared the death penalties in a Lightning game
- **What you notice:** During a Lightning game, a kill by arrow, spell or monster still takes the drop, head, stat penalty and exile, even though the game says all death penalties are off.
- **In 1.6 and SSO:** Only the melee hit in 1.6 checks for a Lightning game; a bow with no arrows swings as melee. SSO does the same.
- **In the code:** `packages/server/src/systems/combat/melee.ts` (`lightning`), `packages/server/src/systems/progression/vitals.ts` (`checkDeath`)
- **Pinned by:** `kept bug: a death that is not a Lightning melee hit takes every penalty` (packages/server/tests/assassin.test.ts)

## crafting

### A tool's hit counter carries over, so the first success comes a hit early
- **What you notice:** gathering takes a set number of hits per success. The first success comes one hit sooner than the table says, and later ones take the full number. All hammers share one mining counter.
- **In 1.6 and SSO:** there is one counter per tool family, reloaded only when it drops below 1, and success happens at exactly 1. SSO uses the same arithmetic but keeps the counters per character, starting at 0 at each login as the client's globals did.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`hitCounter`, `newGatherCounters`)
- **Pinned by:** `kept bug: the first success takes table − 1 hits, later ones the table`; `kept bug: one Mine counter serves all three hammers` (packages/shared/tests/crafting/gather.test.ts)

### Lumberjacking at 0 fells trees but never drops logs
- **What you notice:** with Lumberjacking at 0 you swing and fell trees, but no logs ever drop. Mining at 0 likewise never drops crystals or chunks.
- **In 1.6 and SSO:** the drop roll is made on every fell, but the log drop is guarded by "skill above 0". Mining at 0 is guarded the same way. SSO does the same.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`rollLogs`, `rollMiningFind`, `rollChunk`)
- **Pinned by:** `kept bug: Lumberjacking 0 rolls random(3) but never drops logs`; `Mining 0 rolls the ores and the find but drops nothing` (packages/shared/tests/crafting/gather.test.ts); `kept bug: Lumberjacking 0 fells trees but never drops logs and never rises` (packages/server/tests/gather.test.ts)

### Ore odds do not improve with Mining skill, and 97 changes them
- **What you notice:** at any Mining skill below 97 your chance of Iron, Steel or Star ore stays the same. At 97 and above you never find Iron, but Steel and Star become likelier than before.
- **In 1.6 and SSO:** the odds are a cascade of "skill below N" tests where the last true one wins: Iron 1 in 25, Steel 1 in 55, Star 1 in 155. At 97 and above the base value is left undefined, which the Director 8.5 player treats as 0 when adding 30. Iron then rolls against an undefined range and never hits, Steel is 1 in 30 and Star 1 in 130. SSO does the same: Iron draws from range 0 and never drops.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`rollMiningFind`)
- **Pinned by:** `kept bug: ore odds are constant, Star overrides Steel overrides Iron`; `kept bug: at Mining 97 and above the unset pool counts as zero, giving Steel 1/30 and Star 1/130 but no Iron` (packages/shared/tests/crafting/gather.test.ts)

### A fisher at skill 0 never catches anything
- **What you notice:** with Fishing at 0 you cast and cast and never catch a fish, and the skill never rises.
- **In 1.6 and SSO:** the fishing check is only set up when the skill is above 0, and the skill-raising helper also needs it above 0. The catch roll is left undefined, and Director 8.5 returns a random 32-bit number that is never 1, so it draws once and never succeeds. SSO does the same.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`fishFor`, `castLine`)
- **Pinned by:** `kept bug: Fishing 0 never catches nor rises; the unset chance still consumes one draw` (packages/shared/tests/crafting/gather.test.ts)

### Planting seeds on the wrong ground still uses the seed up
- **What you notice:** you plant a seed on a tile that cannot grow it and read "…isn't going to grow anything here!", but the seed is still gone. Off the edge of the map you read "You plant the seeds." and the map does not change.
- **In 1.6 and SSO:** the planting routine exits on a tile that is not seed ground, but the item removal is sent anyway. Off the map the tile reads as empty, which passes the test, but the server refuses the change. SSO consumes one seed, leaves the tile unchanged and prints the same lines.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`plantSeeds`)
- **Pinned by:** `kept bug: seeds are used on a wrong tile or off the map; they plant on SL` (packages/server/tests/gather.test.ts)

### The shovel only checks the ground layer on the top row
- **What you notice:** the shovel's restriction to certain ground is real only on the top row of the map. On every lower row the check does not apply, and one tile on the top row (column 17) can never be dug.
- **In 1.6 and SSO:** the shovel reads a word of the one-line map data, which is empty below row 1, and an empty text passes the test. On row 1 the word at column 17 straddles the "#" that joins two layers, so it never matches. SSO reads the top row the same way; on rows 2 to 12 it tests only the second layer's `G3` ground.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`shovelLayer1Ok`)
- **Pinned by:** `kept bug: the shovel's layer-1 test is real only on row 1, and (17, 1) never digs` (packages/shared/tests/crafting/gather.test.ts)

### Crafting at skill exactly 10 never fails
- **What you notice:** a craft at skill exactly 10 never fails, while lower and higher skills can.
- **In 1.6 and SSO:** the failure cascade has only a "below 10" and an "above 10" branch, so 10 falls through. SSO uses the same table and draws no random number there.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`failurePool`, `rollFailure`)
- **Pinned by:** `kept bug: crafting skill exactly 10 never fails, and draws nothing` (packages/shared/tests/crafting/craft.test.ts)

### Blacksmithing at 11-20 takes longer than at 10 or less
- **What you notice:** a smith with skill 11 to 20 waits longer for each item than a smith at 10 or below.
- **In 1.6 and SSO:** the smithing timer is 300 frames, then 460 once the skill is above 10, and the table is not reduced again until later. SSO uses the same table of frame counts.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`craftTimer`)
- **Pinned by:** `kept bug: Blacksmithing 11-20 is slower than 10 and below` (packages/shared/tests/crafting/craft.test.ts)

### A burned meal keeps its raw food; failed brews and builds lose theirs
- **What you notice:** when cooking burns, you keep the raw food. When alchemy or carpentry fails, the ingredients are already gone.
- **In 1.6 and SSO:** a burn exits before the raw item is taken, while alchemy and carpentry take their inputs at the start. SSO consumes at the same moments.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cookDone`, `mixDone`, `buildDone`)
- **Pinned by:** `the burn that counts is rolled at completion; a burn sends nothing`; `checks the lab, the sand, the crystal; takes crystal and bottle at the start`; `kept bug: carpentry needs no station and no skill; the Saw before the selection` (packages/shared/tests/crafting/craft.test.ts)

### Cooking Yeti Meat gives Yeti Meat
- **What you notice:** cooking Yeti Meat produces another Yeti Meat, so nothing improves.
- **In 1.6 and SSO:** the original recipe table maps it to itself. SSO uses the same recipe table.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cookDone`)
- **Pinned by:** `kept bug: Yeti Meat cooks into Yeti Meat` (packages/shared/tests/crafting/craft.test.ts)

### Masterwork rolls are uneven and the Knight's Sword cannot be repaired
- **What you notice:** a Chain Helm or Steel Shield gets its +1 bonus on two different rolls, and a Leather Armor +1 can never come up. A broken Knight's Sword becomes "Damaged Sword, Knight's", but the repair looks for "Damaged Sword, Knight", so it cannot be repaired.
- **In 1.6 and SSO:** the masterwork table and the repair names disagree in this way. SSO uses the same tables and names.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`masterwork`, `masterworkPool`, `snx38Result`)
- **Pinned by:** `kept bug: Chain Helm and Steel Shield give +1 on two rolls`; `a damaged name with no repair keeps its inputs, says 'Your  is ready!'` (packages/shared/tests/crafting/craft.test.ts)

### Mixing a potion never uses up the sand
- **What you notice:** you mix a potion and the sand is still in your hand afterwards. The crystal and the chosen item are used up.
- **In 1.6 and SSO:** the sand only has to be held, and only the crystal and the selected item are taken. The Mix button only exists for exactly "Potion Bottle", so in play the item is always a bottle. SSO does the same.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`mixDone`, `startCraft`)
- **Pinned by:** `kept bug: the sand is never consumed` (packages/shared/tests/crafting/craft.test.ts)

### A held Catfish Sandwich can stand in for alchemy sand
- **What you notice:** holding a Catfish Sandwich lets you brew your last potion again with no crystal. If the previous brew failed, the next sandwich brew fails too. Before you have brewed anything this session, nothing is printed and your keys stay locked until the next map load.
- **In 1.6 and SSO:** the gate only checks that the held item contains " Sand", but the crystal checks and the potion choice test exact sand names. A failed start leaves the next potion as "Bad Potion", and with no earlier brew it is undefined. SSO keeps the last potion per character, reset at login, with the same Bad Potion carry-over and key lock.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftIntent`, `lastPotion`); `packages/shared/src/rules/crafting/craft.ts` (`mixDone`)
- **Pinned by:** `kept bug: sandwich alchemy brews the last potion, or a Bad Potion after a failed start`; `kept bug: sandwich alchemy before any brew prints nothing and keeps the keys locked` (packages/shared/tests/crafting/craft.test.ts); `kept bug: sandwich alchemy before any brew keeps the keys until a map load`; `kept bug: a failed brew makes the next sandwich brew fail` (packages/server/tests/craft.test.ts)

### Building furniture needs no workbench and no Carpentry skill
- **What you notice:** if you hold a Saw you can build with Logs anywhere, whatever your Carpentry skill. One Logs is used at the start.
- **In 1.6 and SSO:** Build checks only the Saw. The Build button only exists for exactly "Logs", so in play the item is always Logs. SSO does the same.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`startCraft`, `buildDone`)
- **Pinned by:** `kept bug: carpentry needs no station and no skill; the Saw before the selection` (packages/shared/tests/crafting/craft.test.ts)

### The cauldron matches recipes loosely and the last match wins
- **What you notice:** the cauldron looks for recipe words anywhere in what it holds. "Axe" matches a Gold Axe, a successful brew replaces everything inside, and two recipes need a "Magic Shield Spell Book" that does not exist.
- **In 1.6 and SSO:** the match is a "contains" test over the whole stored text, the last matching recipe wins, and success overwrites all contents. SSO runs the same check on each deposit. The open list is not refreshed, and a withdrawal takes the first line equal to the name the window shows, so after a brew the old lines give nothing.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cauldronBrew`); `packages/server/src/systems/economy/containers.ts` (`depositContainer`, `withdrawContainer`)
- **Pinned by:** `contains on the whole text, the last recipe wins`; `kept bug: 'Axe' matches Gold Axe; the two 'Magic Shield Spell Book' recipes never fire` (packages/shared/tests/crafting/craft.test.ts); `a hit says so to the depositor only and overwrites everything`; `Ctrl opens it; the window is not refreshed; a withdraw takes the line by name` (packages/server/tests/craft.test.ts)

### Cooking a Pig can turn a Cooked Pig back into a Pig
- **What you notice:** with a stack such as "Cooked Pig" earlier in your bag, cooking a Pig turns that stack into Pig and adds a Cooked Pig.
- **In 1.6 and SSO:** the removal takes from the first bag slot whose text contains the item name and a dash, then writes the line back with the rest unchanged. SSO uses the same substring rule for cook and smith completions, the only name-addressed removals it keeps.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`snx38`, `firstSlotContaining`, `takeByName`)
- **Pinned by:** `kept bug: cooking a Pig can turn a Cooked Pig back into a Pig` (packages/shared/tests/crafting/craft.test.ts)

### A full bag still reports the craft as ready
- **What you notice:** you finish smithing or cooking with a full bag and read "Your <item> is ready!" even though nothing was added, and you keep the inputs. This happens only when the result has no matching stack to join and the input is a stack of 2 or more.
- **In 1.6 and SSO:** the completion subtracts in memory, writes only through the add step, which adds nothing to a full bag, then sends the skill roll and the "is ready" line regardless. Alchemy and carpentry inputs are taken at the start, and removing from a full bag adds nothing. SSO does the same.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`); `packages/shared/src/rules/crafting/craft.ts` (`snx38`)
- **Pinned by:** `kept bug: a full bag still says 'is ready!' and keeps the raw stack` (packages/shared/tests/crafting/craft.test.ts); `kept bug: the skill line and 'is ready!' come with a full bag; the inputs stay` (packages/server/tests/craft.test.ts)

### Raw Meat burns after any failed cook until another food resets it
- **What you notice:** after one failed start, cooking Raw Meat burns it every time, until you click a Cyclops Meat, Pig, Orc Meat, Raw Fish or Yeti Meat. If you have never cooked, you read "Your  is ready!" with a blank name.
- **In 1.6 and SSO:** the result is worked out afresh only for nine food names. Any other name keeps the session's last chosen food, which any failed start sets to "Bad Food". SSO keeps a last-food value per character, cleared at login.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`cookDone`); `packages/server/src/systems/crafting/craft.ts` (`craftIntent`, `lastFood`)
- **Pinned by:** `kept bug: Raw Meat burns while the session's chosen food is 'Bad Food'` (packages/shared/tests/crafting/craft.test.ts)

### Building furniture says "Your built a ..."
- **What you notice:** a finished build reads "Your built a Chair!", with the stray "Your".
- **In 1.6 and SSO:** that is the message as written, printed before the Logs are removed. SSO uses the same text.
- **In the code:** `packages/shared/src/rules/crafting/craft.ts` (`CRAFT_TEXT`, `buildDone`)
- **Pinned by:** `kept bug: 'Your built a Chair!'; a failure says so` (packages/shared/tests/crafting/craft.test.ts)

### A craft keeps running through map changes
- **What you notice:** you start smithing or cooking, change map, and the craft still finishes. A map load frees your keys, so you can walk around while it runs.
- **In 1.6 and SSO:** nothing resets the crafting counter on walking, a map change, death or a warp, and the finish rechecks nothing. A map load clears the key lock. SSO does the same, except that logging out ends a craft.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`craftStep`)
- **Pinned by:** `kept bug: crafts survive map changes; a map load frees the keys` (packages/server/tests/craft.test.ts)

### A crafter can't be shoved
- **What you notice:** while you are crafting, other players can't push you.
- **In 1.6 and SSO:** starting a craft locks the player's keys, and the shove skips players whose keys are locked. SSO does the same.
- **In the code:** `packages/server/src/systems/crafting/craft.ts` (`keyLock`), `packages/server/src/systems/movement/push.ts` (`pushOnMe`)
- **Pinned by:** `kept bug: a crafter cannot be shoved` (packages/server/tests/craft.test.ts)

### Regrowth and farm produce speed up with more players on the map
- **What you notice:** trees, rock, ice, holes and farm produce grow back faster the more players are on the map, and an empty map never regrows. For a while after you die or leave by a warp, regrowth waits for you, except farm vegetables.
- **In 1.6 and SSO:** every client rolls a random number out of 600 each frame, with a threshold per kind of thing (for example trees and rock 5, holes 29, produce 9), then 1 in 204 per tile. The six checks wait out a 400-frame timer after a death or exit warp; the vegetable check does not. SSO rolls once per player on the map per frame on the server, with the same gates.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`regrowthFrame`, `REGROWTH_STOP_FRAMES`); `packages/server/src/systems/crafting/gather.ts` (`regrowthStep`)
- **Pinned by:** `one random(600) per player on the map per frame; none on an empty map`; `a stump regrows on a roll under 6, and not while the death respawn timer runs` (packages/server/tests/gather.test.ts); `the checks wait out the post-death respawn timer; DoVeg does not` (packages/shared/tests/crafting/gather.test.ts)

### A gathering or crafting skill at 0 never goes up
- **What you notice:** a skill at 0 never rises through use, even for Smith, Mix and Build, which need no skill to use.
- **In 1.6 and SSO:** all nine skill-raising handlers require the skill to be above 0 and below 100, and nothing else raises these skills from 0. SSO does the same.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`skillGainRule`, `rollSkillGain`)
- **Pinned by:** `kept bug: a skill at 0 never rises, and 100 is the cap` (packages/shared/tests/crafting/gather.test.ts)

### The Watering Bucket counts every swing, wasted or not
- **What you notice:** swinging the bucket at anything, even off the map, counts toward its success, and a success on a tile that is not seeded is wasted.
- **In 1.6 and SSO:** the bucket reads the faced tile but tests nothing before counting its swing. SSO does the same.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`preSwing`)
- **Pinned by:** `kept bug: the Watering Bucket counts every swing, and its success on grass is wasted` (packages/server/tests/gather.test.ts)

### Gathering mid-step changes the tile but drops nothing
- **What you notice:** if you swing a tool while you are mid-step, the tile can change and your skill can roll, but no item drops.
- **In 1.6 and SSO:** the swing works from the destination tile, but the drop requires you to be standing still. SSO does the same.
- **In the code:** `packages/server/src/systems/crafting/gather.ts` (`toolSwing`); `packages/shared/src/rules/crafting/gather.ts` (`castLine`)
- **Pinned by:** `kept bug: a fell mid-step changes the tile and rolls the skill but drops nothing` (packages/server/tests/gather.test.ts); `kept bug: a cast mid-step catches nothing` (packages/shared/tests/crafting/gather.test.ts)

### Only water drawn on the first layer can be fished
- **What you notice:** you can fish in some water tiles but never in others that look the same. Water drawn only on the second layer never gives a fish.
- **In 1.6 and SSO:** fishing reads the first layer only, so W1 (on that layer in 54 maps) and N1 can be fished, and D2, which exists only on layer 2, cannot. SSO does the same.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`isFishingWater`); `packages/server/src/systems/crafting/gather.ts` (`toolSwing`)
- **Pinned by:** `kept bug: D2 is water only on layer 2, which fishing never reads` (packages/server/tests/gather.test.ts)

### Fishing skill-ups use up the anti-macro allowance too
- **What you notice:** each skill-up you earn from fishing counts against the same allowance as a catch, so it runs out sooner.
- **In 1.6 and SSO:** the skill-raising roll runs on every cast into water while the allowance is above 0, and a skill-up takes one from it, as a catch does. SSO does the same.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`castLine`, `ANTI_MACRO_START`)
- **Pinned by:** `a catch and a skill-up each spend the anti-macro counter; the Imp rolls every cast` (packages/shared/tests/crafting/gather.test.ts)

### Asking about "the treasure" gets no answer
- **What you notice:** Say a line that starts with the words "the treasure" and the treasure-hint keyword does not trigger, though similar phrasings do.
- **In 1.6 and SSO:** One of the original's trigger tests could never be true, because it compared the first word to two words. SSO keeps the same trigger list, including the dead one.
- **In the code:** `packages/shared/src/rules/crafting/gather.ts` (`asksAboutTreasure`)
- **Pinned by:** `the keywords; kept bug: the first word can never match "the treasure"` (packages/shared/tests/crafting/gather.test.ts)

## economy

### Quest chests are shared by everyone, and a Wind Chest takes no drops
- **What you notice:** the quest chests are the same for every player, and now and then a save refills one with a single random item, wiping what was inside. Dropping an item facing a Wind Chest gives "floor is too crowded".
- **In 1.6 and SSO:** there is one stored chest per chest type for the whole world. The refill chance is 1 in 4000 per character save, and the new item overwrites the contents. 1.6's client has no way to drop into a Wind Chest. SSO keeps one shared container per chest type and rolls the refill at 1 in 4000 on each periodic save of every online character.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`saveClockStep`, `dropRoute`); `packages/shared/src/rules/housing/doors.ts` (`questChestRefill`)
- **Pinned by:** `a save refills 1 in 4000; random(6) picks the chest; a line overwrites it` (packages/shared/tests/housing/doors.test.ts); `after 400 frames a 1-in-350 save rolls 1 in 4000; the refill overwrites the chest` (packages/server/tests/doors.test.ts); `Drop routes: the five chests by name take items; a Wind Chest or a bare Crate is crowded` (packages/server/tests/doors.test.ts)

### Selling a crate or cabinet leaves its contents locked away
- **What you notice:** sell a Crate, Cabinet or Wind Cabinet to a shopkeeper and whatever you had stored in it is gone for good: nothing can open or reach it again.
- **In 1.6 and SSO:** the sale looks up the bag line for the container by its base name and removes that line, but the stored contents are never cleared or made reachable again. SSO does the same: the bag line goes and the stored rows stay behind, unreachable.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`, `sellName`)
- **Pinned by:** `kept bug: selling a container orphans its contents: the bag line goes, the container_items rows stay` (packages/server/tests/economy-db.test.ts)

### A shopkeeper with no gold line gives goods away free
- **What you notice:** a few shopkeepers charge nothing: the Fire God, Water God and Wind God books (98 in stock each) and Merius' Damaged Armor. Even so, you must hold enough gold to cover the price first, so a free 100-gold book needs 100 gold in your hand.
- **In 1.6 and SSO:** the buyer is only charged by a shopkeeper who keeps a gold ledger, and these shopkeepers have none. The "can you afford it" test still runs before that. SSO does the same: no gold ledger means no charge, the stock still goes down and the gold test still runs.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `kept bug: no GLD line, nothing charged, but the gold test still needs price × count` (packages/server/tests/economy.test.ts); `kept bug: the Fire God's book costs nothing, but needs 100 gold in hand` (packages/server/e2e/npcs-shops-trade.test.ts)

### A shopkeeper with no gold line pays nothing for what you sell
- **What you notice:** sell an item to a shopkeeper who keeps no gold ledger and the item is taken, but you are paid nothing.
- **In 1.6 and SSO:** the payout only happens for a shopkeeper with a gold ledger; the item is removed either way. SSO does the same.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`)
- **Pinned by:** `kept bug: no GLD line takes the item and pays nothing` (packages/server/tests/economy.test.ts)

### The Fortress Guild Hall Deed always reads as out of stock
- **What you notice:** try to buy the Fortress Guild Hall Deed from the Smithy and you only ever get "Sorry but I'm out of that particular item." Nothing changes hands. The same thing happens for any item (crystals aside) that sits on line 17 or later of a shopkeeper's list.
- **In 1.6 and SSO:** the buy routine used one counter for two nested loops, so a match on line 17 or later was found again and again until the stock ran short, and it always ended in that refusal with nothing written. SSO answers that refusal at once without changing stock and never stalls. A match below line 17 skips ahead to line 17, so buying Trout does not also take Trout Fillet's stock.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `kept bug: the Fortress Guild Hall Deed (Smithy line 17) always answers NEI, nothing written`; `crystals skip the inner loop, so Plone's line-17 White Crystals sell`; `a match below line 17 skips to line 17, so Trout does not also take Trout Fillet's stock` (packages/server/tests/economy.test.ts)

### A sale is only thanked if the shopkeeper also sells that item
- **What you notice:** sell something to a shopkeeper who does not stock it themselves and you get no "thank you" at all. Buying never gets a confirmation line either; you only see the item arrive in your bag.
- **In 1.6 and SSO:** the sale confirmation is only sent while going through the shopkeeper's own stock lines, and the 2003 server never sent a purchase confirmation. SSO does the same. The thanks is a bare "Thanks for the business!" with no shopkeeper name, and a purchase is confirmed only through the inventory update.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`, `SHOP_TEXT`)
- **Pinned by:** `kept bug: BUY without SEL pays but says nothing` (packages/server/tests/economy.test.ts)

### Selling Trout also restocks Trout Fillet and thanks you twice
- **What you notice:** sell Trout or Catfish to Akadius, Swordfish or Squid to Krista, or Squid to Lir, and the shop also restocks Trout Fillet, Catfish Sandwich, Swordfish Steak or Squid Platter. "Thanks for the business!" prints twice.
- **In 1.6 and SSO:** after a sale, every stock line that merely starts with the sold item's name gets the count added and sends its own thanks. SSO matches the same way and prints the same two lines.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcSell`)
- **Pinned by:** `kept bug: selling Trout bumps Trout Fillet's stock too and thanks twice` (packages/server/tests/economy.test.ts)

### Shopkeeper refusals leave a blank where their name should be
- **What you notice:** when a shopkeeper is out of stock or cannot afford what you sell, the line starts with a gap instead of their name: ` says "Sorry but I'm out of that particular item."` or ` says "I'm sorry but I can't afford to buy that."`
- **In 1.6 and SSO:** 1.6 took the name from a spot on the shop screen that is empty in every game screen, so the name came out blank. SSO prints the same lines with no name.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`SHOP_TEXT`, `npcBuy`, `npcSell`)
- **Pinned by:** `count over stock: ' says "Sorry but I'm out of that particular item."', blank name`; `an NPC whose gold would go negative: ' says "I'm sorry but I can't afford to buy that."'` (packages/server/tests/economy.test.ts)

### A full bag lets you buy a Pie because it holds an Orc Pot Pie
- **What you notice:** buy a Pie from Amber with a full bag that holds an "Orc Pot Pie" and the shop lets the purchase go through, yet you get no Pie. You keep your gold and your bag as they were, but Amber's stock drops by one and her gold goes up.
- **In 1.6 and SSO:** the "is there room" test lets a full bag pass when its text merely contains the item's name, but adding to the bag only stacks on an exact name. So nothing is added and the buyer's file is not saved, while Amber's file is. SSO does the same.
- **In the code:** `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `kept bug: a full bag with 'Orc Pot Pie' passes for 'Pie'; InvAdd adds nothing and keeps the gold, but Amber's stock and gold change` (packages/server/tests/economy.test.ts)

### A failed bank deposit or withdrawal says nothing
- **What you notice:** trying to deposit or withdraw more than you have is met with silence. When it does work, both a deposit and a withdrawal reply "You now have N gold in the bank.", so a withdrawal reads like a deposit.
- **In 1.6 and SSO:** the two failure cases exit with no message, and both success paths send the same deposit reply; the withdrawal messages were never sent. SSO has the same messages and the same silences.
- **In the code:** `packages/server/src/systems/economy/bank.ts` (`runBank`, `BANK_TEXT`)
- **Pinned by:** `kept bug: the texts; failures are silent; withdraw says 'You now have' too` (packages/server/tests/economy.test.ts)

### The bank works with a banker on the map roster, dead or not
- **What you notice:** on a map whose roster includes the banker Cril or Andero, the bank commands work whether or not the banker has spawned or is alive. On any other map you read "You cannot bank here!"
- **In 1.6 and SSO:** the bank check looks at the data of the four roster NPCs loaded when you entered the map, and that data is not cleared by a death. SSO lets the bank work while a banker NPC is in your map's roster.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`canBank`, `bankChat`)
- **Pinned by:** `kept bug: the banker only has to be in the map's roster, alive or not; else 'You cannot bank here!'` (packages/server/tests/economy.test.ts)

### The shopkeeper's gold thanks is missing its closing quote
- **What you notice:** hand gold to an NPC and your chat shows "*** Offering the <n> gold  to <Name>." (two spaces before "to"), then `<Name> says "Thanks for the gold!` with no closing quote mark.
- **In 1.6 and SSO:** the NPC's reply is built without the closing quote, after the client's offer line with its double space. SSO prints the same two lines.
- **In the code:** `packages/server/src/systems/economy/intents.ts` (`giveGoldToNpc`); `packages/server/src/systems/monsters/npc.ts` (`NPC_TEXT`)
- **Pinned by:** `the offer line, then 'Thanks for the gold!' with no closing quote; the NPC's GLD grows` (packages/server/tests/npcs-trade.test.ts)

### A trade offer locks once sent, and only the starter can accept
- **What you notice:** once you press Trade your amounts become read-only and the button hides. Only the player who started the trade has an Accept button, so the partner agrees by pressing their own Trade. A completed trade prints nothing, and if the partner cancels, nothing is printed for the partner.
- **In 1.6 and SSO:** the trade window works this way in 1.6. SSO has the same flow, held by the server.
- **In the code:** `packages/server/src/systems/economy/trade.ts` (`offerTrade`, `acceptTrade`, `cancelTrade`); `packages/client/src/ui/trade.ts` (`createTradeWindow`)
- **Pinned by:** `A offers, B sees it and offers, A accepts: one move, no success text`; `Cancel: A hears 'You cancel the trade.', B 'Trade cancelled.'; B's Cancel is silent for B` (packages/server/tests/npcs-trade.test.ts)

### Withdrawing into a full bag can destroy the item
- **What you notice:** you withdraw a Pie from a chest into a full bag that holds an "Orc Pot Pie". The bag looks like it has room, the Pie is removed from the chest, and it never arrives.
- **In 1.6 and SSO:** the room check treats any bag text containing the item name followed by a dash as having room, but adding only stacks on an exact name. So nothing is added, yet the line is still deleted from the chest. SSO does the same.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`withdrawVault`); `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)
- **Pinned by:** `kept bug: withdrawing 'Pie' into a full bag holding 'Orc Pot Pie' destroys it` (packages/server/tests/economy.test.ts)

### After one withdrawal you can walk away with the vault open
- **What you notice:** you open your vault and your keys lock. While it is locked your bag ignores clicks, so you cannot deposit anything. One withdrawal frees you, and then you can walk away and keep withdrawing. A withdrawal prints nothing, while a deposit prints "You drop a <item> into the container." before the capacity check.
- **In 1.6 and SSO:** opening sets the key lock, the window's OK clears it, and only CANCEL closes the window. SSO has the same lock, the same remote withdrawal from your personal vault and the same texts.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`openVault`, `withdrawVault`, `depositVault`)
- **Pinned by:** `withdraw ends the key lock and stacks on an exact name`KeyLockOut`withdraw ends the key lock and stacks on an exact name`; `deposit: the line is printed before the capacity test; containers refused` (packages/server/tests/economy.test.ts)

### Removing a player shop item deletes every line that mentions it
- **What you notice:** removing "Apple" from your shop also removes "Apple Pie", and any profile line that mentions apples. Typing a single letter such as "g" removes every line containing that letter, the gold line included. A line with stock refuses the whole removal.
- **In 1.6 and SSO:** the removal rebuilds the first 30 lines without every non-empty line containing the name, whatever kind of line it is; empty lines and lines past 30 are lost. A matching stock line that still holds stock refuses everything. SSO does the same, reading stock only from the item lines; ownership is kept by id, so dropping the owner line costs the owner nothing.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`removeItem`)
- **Pinned by:** `RemoveItem: not selling, in stock, removed`; `kept bug: removing Apple takes Apple Pie with it` (packages/shared/tests/economy/playershop.test.ts)

### Pricing a player shop item deletes every line that mentions it
- **What you notice:** setting a price for an item deletes every other line in your shop that contains its name, whatever kind of line. Setting "Fish" also drops "Fish Sticks" and takes its stock, and an owner called "Alex" who sets "Ale" loses his own owner line. Empty lines and lines past 30 are lost too.
- **In 1.6 and SSO:** the price command rebuilds the first 30 lines without every non-empty line containing the item and carries over the last matching stock line's stock. Then it adds a sell line and a buy line with the name as you typed it. SSO does the same, but ownership is kept by id, so Alex keeps his shop.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`)
- **Pinned by:** `kept bug: SetPrices drops every line containing the item, OWN| included`; `kept bug: the last matching SEL line's stock moves to the new line`; `kept bug: empty lines and lines past 30 are lost` (packages/shared/tests/economy/playershop.test.ts)

### A player shop's ten-item limit counts lines in the first 30 only
- **What you notice:** a player shop refuses a new item once ten sell lines sit among its first 30 lines. Re-pricing an item already in the file is not new and still works.
- **In 1.6 and SSO:** a new item is refused when ten of lines 1-30 are sell lines; an item whose name already starts a sell line counts as already there. SSO counts the same way.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`, `SHOP_LINES`)
- **Pinned by:** `max 10: ten SEL lines refuse a new item, not a re-priced one` (packages/shared/tests/economy/playershop.test.ts)

### The seventh item in a player shop can never be bought
- **What you notice:** a player shop can only ever sell six items. The seventh is listed, but trying to buy it gives the out-of-stock line. Re-pricing an item also moves it to the end of the list.
- **In 1.6 and SSO:** a new shop starts with the Apple on line 6 and each priced item adds two lines, so the seventh sell line is line 18, past the buy routine's line-17 limit. SSO does the same.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`setPrices`); `packages/server/src/systems/economy/shop.ts` (`npcBuy`)
- **Pinned by:** `kept bug: the seventh item lands on line 18, past NPCBuy's line 17` (packages/shared/tests/economy/playershop.test.ts); `kept bug: the seventh item, on line 18, answers out of stock` (packages/server/tests/playershop-db.test.ts)

### Shop commands are said aloud and also work outside the shop
- **What you notice:** typing a shop command (setting a price, say) says it to the whole room as ordinary chat before the shopkeeper answers. Standing deeper in a house, where chat itself is refused, the command still runs.
- **In 1.6 and SSO:** the command check runs after the line is sent as chat, on every plain line. SSO does the same, and it also runs the command when SSO's chat cooldown refuses the line.
- **In the code:** `packages/server/src/systems/economy/playershop.ts` (`shopCommand`)
- **Pinned by:** `a command is said first, then answered; at y > 10 the line is refused and the command still runs` (packages/server/tests/playershop-db.test.ts)

### A player shop's stock list is said to everyone in the room
- **What you notice:** when the owner asks for the stock, everyone in the shop reads the stock lines, quieted if they stand deeper in a house. The register line goes to the owner only.
- **In 1.6 and SSO:** the stock lines are sent so that the owner's client repeats them to the room as one line of chat. SSO does the same.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`shopStockLines`)
- **Pinned by:** `Inventory: the till to the owner; the stock said to the room, muffled at y > 10` (packages/server/tests/playershop-db.test.ts)

### The register line lacks a closing quote and every item gets an s
- **What you notice:** the shopkeeper's register line `<N> says "I have <g> gold in the register...` has no closing quote. Each stock line adds a plain "s" to the item's name unless the stock is 1, so you read "Chunk of Irons" and "Fishs".
- **In 1.6 and SSO:** the texts are built that way. SSO prints the same texts.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`SHOP_TEXT`)
- **Pinned by:** `kept bug: the till line has no closing quote; every item gets an s` (packages/shared/tests/economy/playershop.test.ts)

### The cauldron fizzles on every deposit that makes nothing
- **What you notice:** each time you put something in a cauldron that does not complete a recipe, even the first ingredient, you read "The cauldron bubbles...but then fizzles out." Nothing is lost.
- **In 1.6 and SSO:** every deposit runs the recipe check and a miss sends that message. SSO does the same.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`depositContainer`); `packages/shared/src/rules/crafting/craft.ts` (`cauldronBrew`)
- **Pinned by:** `kept bug: the cauldron fizzles on every deposit that completes nothing` (packages/server/tests/craft.test.ts)

### Storage on a Crate or Cauldron opens with no message
- **What you notice:** pressing Storage on a Crate or Cauldron opens the window without any line in chat, while a Cabinet or Chest says something.
- **In 1.6 and SSO:** the button builds its text only for a Cabinet or a Chest, then prints the unset text anyway. SSO opens the window with no line.
- **In the code:** `packages/server/src/systems/economy/containers.ts` (`storageIntent`)
- **Pinned by:** `kept bug: Storage on a Crate or Cauldron prints nothing; a Cabinet says so` (packages/server/tests/craft.test.ts)

### Player shops cannot stock crystals
- **What you notice:** a player shop never accepts crystals for sale, whatever the colour.
- **In 1.6 and SSO:** the shop's allow-list tests for exact singular names such as "Blue Crystal", but every bag and NPC item is the plural "<colour> Crystals", so none is ever accepted. SSO uses the same allow-list with no alias.
- **In the code:** `packages/shared/src/rules/economy/playershop.ts` (`onShopWhitelist`)
- **Pinned by:** `set: the whitelist, case ignored, the name as typed` (packages/shared/tests/economy/playershop.test.ts)

### Crystals taken out of a vault turn into "Crystals "
- **What you notice:** crystals you withdraw from a vault come back as a worthless item called "Crystals ", whatever their colour. The vault line is deleted.
- **In 1.6 and SSO:** a vault line such as "Blue Crystals" contains " Crystals", so the withdrawal splits it on spaces and joins words 2 and 3, giving "Crystals ". SSO makes the same name change on withdrawal.
- **In the code:** `packages/server/src/systems/economy/vault.ts` (`withdrawVault`); `packages/server/src/systems/economy/containers.ts` (`withdrawContainer`)
- **Pinned by:** `kept bug: a crystal line comes back as 'Crystals '` (packages/server/tests/economy.test.ts)

### Quest replies are private for one NPC slot and public for the rest
- **What you notice:** Ask for a quest and the NPCs answer: the first NPC's reply is heard only by you, while the replies from the other three slots are heard by everyone on the map. The first NPC's "Sorry..." line also goes to the whole map.
- **In 1.6 and SSO:** 1.6 sent slot 1 as a private line and slots 2-4 to the room. SSO uses the same audiences, including the "Sorry..." line that reaches the map.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`sayQuest`), `packages/server/src/systems/economy/quests.ts` (`askForQuest`)
- **Pinned by:** `kept bug: quest reply audience differs by NPC slot; no closing quote` (packages/shared/tests/social/factions.test.ts)

### Handing in a head takes the first head in your bag
- **What you notice:** Give a leader a head and the one that goes is the first head in your bag, not necessarily the one you picked.
- **In 1.6 and SSO:** 1.6 checks that the slot you named holds a head, then takes one from the first slot that contains it. SSO does the same.
- **In the code:** `packages/server/src/systems/economy/quests.ts` (`questGive`)
- **Pinned by:** `kept bug: turn-in takes the first head in the bag, not the one given` (packages/server/tests/factions.test.ts)

### A quest line matches by substring and the last match wins
- **What you notice:** handing an NPC an item can pay the reward of a different quest line whose text happens to contain yours. Giving Stephie a Fish pays her Fishle reward.
- **In 1.6 and SSO:** the quest giver takes the last of the first 40 quest lines that contains "<NPC>:<item>". SSO does the same over the server's quest lines.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questMatch`)
- **Pinned by:** `kept bug: quest lines match by substring, last match wins` (packages/shared/tests/social/factions.test.ts)

### Handing in a quest item renames the stack it came from
- **What you notice:** a quest turn-in can change the name of a stack: a Gold Fish stack given as Fish becomes a Fish stack. The reward renames the stack it is added to in the same way.
- **In 1.6 and SSO:** the given item comes off the first slot whose text contains the item's name, and the reward goes onto the first slot containing the reward's name. Each slot is rewritten under the name that was used. SSO does the same.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questTake`, `questReward`)
- **Pinned by:** `taking one renames the stack it came from` (packages/shared/tests/social/factions.test.ts)

### A quest reward to a full bag overwrites what you handed over
- **What you notice:** with a full bag and no stack to add the reward to, the reward replaces what is left of the stack you just gave from.
- **In 1.6 and SSO:** with no matching stack and no empty slot, the routine still holds the slot the given item came from, so the reward overwrites it. SSO does the same.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`questReward`)
- **Pinned by:** `kept bug: a quest reward to a full bag replaces what you gave from` (packages/shared/tests/social/factions.test.ts)

### A new quest roll of 29 gives a quest that no NPC will answer
- **What you notice:** now and then a new quest is assigned that no NPC will accept, for example the archived `:Steel Key:Trumpet`.
- **In 1.6 and SSO:** the NPC is picked by a 44-way roll that has no NPC for 29 and picks the same NPC for two rolls, so a reroll can write a line that starts with a bare colon. SSO makes the same rolls.
- **In the code:** `packages/shared/src/rules/economy/quests.ts` (`findNewQuest`)
- **Pinned by:** `FindNewQuest: random(44), random(20), random(20); roll 29 names nobody` (packages/shared/tests/social/factions.test.ts)

## housing

### The Stone Guild Hall Deed does nothing
- **What you notice:** Using a Stone Guild Hall Deed starts no building. You cannot put up a Stone Guild Hall.
- **In 1.6 and SSO:** 1.6 had the deed but no Stone Guild Hall house, template or builder behind it, so using it leads nowhere. SSO does the same: the deed exists and using it does nothing, with no error. 1.6 also left a dead exit behind; SSO does not.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`deedUse`)
- **Pinned by:** `kept bug: the Stone Guild Hall Deed does nothing (no Houses member, template or builder)` (packages/shared/tests/housing/houses.test.ts)

### Boat and Battleship Deeds do nothing when used
- **What you notice:** Using a Boat Deed or a Battleship Deed does nothing.
- **In 1.6 and SSO:** 1.6's deed handler simply exits for both, and the boat-building routine was never called from anywhere, so no boat could be built. SSO does the same.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`deedUse`)
- **Pinned by:** `Boat and Battleship Deeds do nothing` (packages/shared/tests/housing/houses.test.ts)

### The Small Farm builds one row lower than other houses
- **What you notice:** The Small Farm lands one row lower, relative to your cursor, than the other houses do. Its ghost is drawn to match, so it still builds exactly where the ghost shows.
- **In 1.6 and SSO:** 1.6's step that moves the anchor up a row tests for the misspelt name "Small Fam", so the farm keeps the hovered row. SSO does the same: the server applies the one-column shift only for the Small Farm, and the client shifts the ghost the same way.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`houseAnchor`)
- **Pinned by:** `kept bug: the Small Farm keeps the hovered row ('Small Fam'), and its ghost is shifted to match` (packages/shared/tests/housing/houses.test.ts)

### Only 3 columns of a 5-wide house are checked for terrain
- **What you notice:** A 5-wide house can be placed with its two right-hand columns over ground that would not be allowed.
- **In 1.6 and SSO:** 1.6 reads the ground under the house from a map line whose last two columns come back empty, so they never count; the pass mark is a fixed 9 tiles. SSO runs the same test on the server.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `kept bug: layer 1 counts only the first 3 columns of a 5-wide house` (packages/shared/tests/housing/houses.test.ts)

### No house can be anchored on rows 8-9
- **What you notice:** You cannot place a house with its anchor on rows 8 or 9, although the edge rule would allow them.
- **In 1.6 and SSO:** 1.6 reads the ground layer by item number from the map record, and for rows 10 and 11 that lands on the NPC and monster fields, which never match. SSO does the same: the rows above 9 never count for ground.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `kept bug: no house can be anchored on rows 8-9; rows 10-11 read map fields 10-11` (packages/shared/tests/housing/houses.test.ts)

### A tile of type 8V never counts as house ground
- **What you notice:** Ground of type 8V is refused as a house site even though 8R and 8U are fine.
- **In 1.6 and SSO:** 1.6's ground test is a text match that has no closing mark after 8V, so an 8V tile never matches. SSO counts only 8R and 8U.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`terrainOk`)
- **Pinned by:** `kept bug: an 8V tile never counts: "*8R*8U*8V" has no star after 8V, so contains "*8V*" fails` (packages/shared/tests/housing/houses.test.ts)

### The house ghost blocks on items and players beside it
- **What you notice:** Placement is refused when an item or a player stands in the column just right of the house or the row just above it, and also because of your own character.
- **In 1.6 and SSO:** 1.6 tests the ghost's bounding rectangle against item, monster and player sprites; the ghost sits a pixel or two right of and above its footprint, so neighbours count, and so does the builder's own sprite. SSO's server tests the same rectangles.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`ghostRect`), `packages/server/src/systems/housing/houses.ts` (`obstacleRects`)
- **Pinned by:** `kept bug: the ghost's rect catches an item in the column to its right, but not one below` (packages/shared/tests/housing/houses.test.ts); `a refusal keeps placement on and builds nothing` (packages/server/tests/houses-db.test.ts)

### The Small Shop's street lamp survives demolition
- **What you notice:** After a Small Shop is demolished, its street lamp is left standing.
- **In 1.6 and SSO:** 1.6 drops the lamp one row lower than the place it records for it, and demolition removes by exact match, so the lamp is never found. SSO places and records the lamp with the same offsets.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`planHouse`)
- **Pinned by:** `kept bug: the Small Shop's lamp is dropped a row below where it is recorded` (packages/shared/tests/housing/houses.test.ts)

### Decay demolishes every house an owner has, whatever the year
- **What you notice:** When a house decays, all of that owner's houses go, not just the stale one. Months are compared with no year. The house's interior and vaults are left behind.
- **In 1.6 and SSO:** 1.6's remover matches every entry with the owner's name and compares months without a year. SSO follows the same rules on server month records. It differs in one detail: the orphaned interior and vault contents are deleted instead of being left unreachable. The outdoor exit field is left alone, as in 1.6.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`sweep`), `packages/server/src/systems/housing/houses.ts` (`demolish`)
- **Pinned by:** `kept bug: the house remover takes all of an owner's houses; the year is ignored` (packages/shared/tests/housing/houses.test.ts); `a stale owner's house is demolished on the 1/50 roll: tiles revert, Exit and mailbox go, the interior is deleted` (packages/server/tests/houses-db.test.ts); `kept bug: a tile changed since the build is not reverted` (packages/server/tests/houses-db.test.ts)

### The decay sweep brings back houses it already removed
- **What you notice:** After a decay sweep, houses that were removed earlier in the same sweep can still be in the list.
- **In 1.6 and SSO:** 1.6's sweep loops over an old copy of the house list, and each removal rebuilds the list from that copy, undoing earlier removals. SSO reproduces this: the zombie entries stay until a later sweep.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`sweep`)
- **Pinned by:** `kept bug: the sweep rewrites the list from its stale copy, so earlier removals come back` (packages/shared/tests/housing/houses.test.ts)

### A second house on the same map overwrites the first one's blueprint
- **What you notice:** If you own two houses on one map and both are demolished, only the second one's ground is restored.
- **In 1.6 and SSO:** 1.6 saves one blueprint per owner and map, so a second house overwrites the first one's. SSO keeps one blueprint row per owner and map, overwritten the same way.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`demolish`, `placeHouseIntent`)
- **Pinned by:** `kept bug: two houses by one owner on one map share one blueprint, so only the last is reverted` (packages/server/tests/houses-db.test.ts)

### House decay rolls again on every clock check
- **What you notice:** A stale house can be removed at any time you are online, about once a minute of each player's time.
- **In 1.6 and SSO:** 1.6 runs its decay roll (a 1 in 50 chance) on every date message: twice at login and then about every 61 seconds for each online client. SSO has the same trigger per player, driven by the server's clock.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`HOUSE_CLOCK_FRAMES`, `HOUSE_SWEEP_ODDS`), `packages/server/src/systems/housing/houses.ts` (`houseClockStep`)
- **Pinned by:** `a stale owner's house is demolished on the 1/50 roll: tiles revert, Exit and mailbox go, the interior is deleted` (packages/server/tests/houses-db.test.ts); `an owner's own login refreshes their entries before the roll` (packages/server/tests/houses-db.test.ts)

### Resting in a house heals you even when you are dead
- **What you notice:** On a house map, near the top of the map, you slowly regain hit points and spell points, even while dead.
- **In 1.6 and SSO:** 1.6's house rest-healing has no death check. SSO does the same, as part of the server's per-tick step.
- **In the code:** `packages/server/src/systems/housing/houses.ts` (`restRegen`)
- **Pinned by:** `rest regen: on a house map, random(10) = 1 and y < 11 heals 1 HP and 1 SP` (packages/server/tests/houses-db.test.ts)

### Your own stations show their text after a refusal elsewhere
- **What you notice:** After being refused somewhere else, clicking your own Stove, Anvil or Alchemy Lab shows its line instead of picking it up. It stays that way until you next press Drop.
- **In 1.6 and SSO:** In 1.6 a click never clears the "don't pick this up" flag; it is only reset by Drop. SSO keeps the flag per player with the same resets.
- **In the code:** `packages/shared/src/rules/housing/houses.ts` (`headDrop`)
- **Pinned by:** `kept bug: nothing clears a set flag in your own house (nothing ever resets it)` (packages/shared/tests/housing/houses.test.ts)

### Coloured keys are used up on open and again on close
- **What you notice:** A coloured key is spent every time it opens a door and again when it closes it, and the key pauses you for a while.
- **In 1.6 and SSO:** 1.6's key routine spends the key unless the key list marks it infinite, and none are. SSO does the same: one key from the used slot per open and per close, plus a 425-frame pause.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`keyConsumed`, `KEY_PAUSE`), `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `kept bug: coloured keys are consumed on open and on close; Keys.txt has no Inf` (packages/shared/tests/housing/doors.test.ts); `kept bug: a coloured key is spent opening and closing; it pauses 425` (packages/server/tests/doors.test.ts)

### Opening one coloured door or switch changes every one of that name
- **What you notice:** Opening one Steel Door opens every Steel Door on the map, and flipping a switch flips every switch in that state. A player door named Bob's Door also catches Jimbob's Door.
- **In 1.6 and SSO:** 1.6 renames every item on the map whose name contains the old name, which is why the neighbours go too. SSO does the same renaming within the map, for door and switch items only, and shows it at once instead of on the next load.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`renameTargets`, `switchFlip`), `packages/server/src/systems/housing/doors.ts` (`renameDoors`)
- **Pinned by:** `kept bug: opening a coloured door renames every door of that name on the map` (packages/shared/tests/housing/doors.test.ts); `kept bug: a player door rename matches by substring (Bob's Door in Jimbob's Door)` (packages/shared/tests/housing/doors.test.ts); `kept bug: a switch flips every switch of that state on the map` (packages/shared/tests/housing/doors.test.ts); `kept bug: opening one Steel Door opens every Steel Door on the map` (packages/server/tests/doors.test.ts); `kept bug: a switch flips every switch of its state on the map` (packages/server/tests/doors.test.ts)

### Player and guild doors never lock again by themselves
- **What you notice:** Coloured doors and switch doors shut by themselves after a while; a player's or guild's door stays open until someone closes it.
- **In 1.6 and SSO:** 1.6's close-all routine lists only switch and coloured doors. SSO's relock timer skips the player door's opened state.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`closeAllDoors`), `packages/server/src/systems/housing/doors.ts` (`relockStep`)
- **Pinned by:** `kept bug: CloseAllDoors closes coloured and switch doors and ON switches, never player doors` (packages/shared/tests/housing/doors.test.ts); `kept bug: player and guild doors never relock` (packages/server/tests/doors.test.ts)

### House and guild keys work with no pause and are never used up
- **What you notice:** A House Key or Guild Key toggles its door again immediately, and the key stays in your bag.
- **In 1.6 and SSO:** 1.6 sends these keys straight to the door change, with no key spending and no action pause; coloured keys pause for 425 frames. SSO does the same.
- **In the code:** `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `kept bug: house and guild keys work with no pause and are kept` (packages/server/tests/doors.test.ts)

### A refused switch click still starts the doors' relock timer
- **What you notice:** Clicking a switch from across the room does nothing to it, but the map's open coloured and switch doors shut about 100 frames later and its ON switches turn off.
- **In 1.6 and SSO:** 1.6 starts the countdown before checking you are next to the switch. SSO does the same, on the map's timer (the smaller of what is left and 100).
- **In the code:** `packages/server/src/systems/housing/doors.ts` (`switchClick`)
- **Pinned by:** `kept bug: a refused switch click still arms the relock` (packages/server/tests/doors.test.ts)

### Arriving on a map closes its doors a little later
- **What you notice:** Open coloured and switch doors on a map close 150 frames after someone arrives there. A map with nobody on it keeps its doors open until then.
- **In 1.6 and SSO:** 1.6 starts the relock countdown at 150 when a map loads. SSO does the same, on the map's timer.
- **In the code:** `packages/shared/src/rules/housing/doors.ts` (`relockAfter`)
- **Pinned by:** `kept bug: arriving on a map closes its doors 150 frames later` (packages/server/tests/doors.test.ts)

## inventory

### You can still drop gold and crystals from an airship
- **What you notice:** aboard an airship, dropping most items is refused ("from the sky"), but the gold and crystal dialogs still let you drop those.
- **In 1.6 and SSO:** the "can't drop this from the sky" test comes after the gold and crystal handling. SSO does the same: the bag Drop refuses everything else aboard, and the gold and crystal dialogs have no vehicle test.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`)
- **Pinned by:** `kept bug: aboard an airship items are refused 'from the sky' but gold and crystals still drop` (packages/server/tests/vehicles.test.ts)

### Ctrl on an airship only ever unboards
- **What you notice:** while riding an airship, pressing Ctrl always tries to unboard and never picks anything up. Clicking an adjacent item with the mouse still picks it up.
- **In 1.6 and SSO:** Ctrl checks for the airship before the pig grab or any item. SSO does the same.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`actionIntent`), `packages/server/src/systems/vehicles/airship.ts` (`unboardAirship`)
- **Pinned by:** `kept bug: Ctrl aboard an airship only ever unboards; a click still picks up` (packages/server/tests/vehicles.test.ts)

### The Experience Platform says hit points but checks level
- **What you notice:** the Experience Platform tells you that you must be over 30 hit points to pass, but what actually stops you is your level: you need to be level 21 or more.
- **In 1.6 and SSO:** the text and the gate disagree. SSO keeps the same text and the same gate.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`blocksPlayer`, `ctrlGate`)
- **Pinned by:** `kept bug: the Experience Platform says 30 hit points but blocks by level (21 passes)` (packages/shared/tests/inventory/inventory.test.ts)

### Ctrl still works while a window holds the keys
- **What you notice:** with a dialog open that locks your keys, pressing Ctrl still reads or picks up the item you face. It does nothing only while the map is loading.
- **In 1.6 and SSO:** the Ctrl check sits outside the key lock that stops other keys. SSO ignores the dialog lock for this action, but not the map-loading lock.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`actionIntent`)
- **Pinned by:** `kept bug: Ctrl still works while a window holds the key lock, but not while the map loads` (packages/server/tests/mail-boards.test.ts)

### Food is eaten for nothing when you are already stuffed
- **What you notice:** eating while your hunger is at its top gives no benefit, yet the food is still used up.
- **In 1.6 and SSO:** the hunger gain applies only below 35000, but the item is removed regardless. SSO does the same.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`)
- **Pinned by:** `kept bug: eating while stuffed still consumes the item` (packages/shared/tests/inventory/inventory.test.ts)

### Monsters walk over Holy Water and newspapers that stop you
- **What you notice:** a player cannot step onto a tile holding Holy Water or a newspaper, but a monster walks straight over it.
- **In 1.6 and SSO:** the list of ground items that block monsters is missing those two, while the list for players has them. SSO keeps the two separate lists exactly as written.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`blocksMonster`, `blocksPlayer`)
- **Pinned by:** `kept bug: monsters walk onto Holy Water and newspapers` (packages/shared/tests/inventory/inventory.test.ts); `a blocking item on the anchor tile aborts a monster's path` (packages/server/tests/inventory.test.ts)

### A pig dropped on water or on the top row is lost
- **What you notice:** you drop a Pig and nothing appears: no pig and no message, and it is gone from your bag. This happens when you drop it onto a tile monsters cannot stand on (water, when you are in an Airship), or when you face north on the top row of the map.
- **In 1.6 and SSO:** the Pig leaves your bag first, and only then does the summon check whether the tile will do. Facing north on the top row, 1.6 summons the pig on a row above the screen, where the slot reads as free, and the pig is lost there too. SSO keeps the same order and the same silent loss; its summon refuses to place anything off the map.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`pigDrop`); `packages/server/src/systems/spells/cast.ts` (`summonPig`)
- **Pinned by:** `kept bug: a dropped pig is lost on an NPC-blocked tile`; `kept bug: a dropped pig is lost facing north on row 1` (packages/server/tests/pigs-orbs-webs.test.ts)

### A Pig can be dropped when every other item is refused
- **What you notice:** while the short pause after using an item is running, or while you are mid-step, every item you try to drop is refused, except a Pig, which drops anyway. From an Airship you can drop a Pig over water, and it is then lost.
- **In 1.6 and SSO:** the Pig check comes before the pause, the vehicle and the mid-step tests, and it matches the exact name "Pig". Aboard an Airship the blocked-tile list is the airship's own, which is why water is allowed. SSO does the same.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`, `pigDrop`)
- **Pinned by:** `kept bug: a pig drops during the item pause and mid-step`; `kept bug: a pig drops from an Airship onto a pad-free land tile` (packages/server/tests/pigs-orbs-webs.test.ts)

### Books and the Boat Deed are wielded in the left hand like a bow
- **What you notice:** you can equip any book and the Boat Deed into the left hand, and a wielded book hits like a bow. A Book with "Shield" in its name goes in the right hand instead.
- **In 1.6 and SSO:** the slot rules are an ordered list of "name contains" tests, and the one for "Bo" also catches every book, the Boat Deed and any bow without a rule of its own. The Potion Bottle also matches, but its menu offers Mix instead of Equip, so you never reach it. SSO runs the same ordered list with the same case-insensitive match, and the last matching rule wins.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`, `menuAction`)
- **Pinned by:** `kept bug: books and Boat Deed equip LeftHand as a "Bo"` (packages/shared/tests/inventory/inventory.test.ts); `the menu swaps Equip for Cook/Mix/Build/Smith/Storage` (packages/shared/tests/inventory/inventory.test.ts)

### A Catfish Sandwich equips in the right hand
- **What you notice:** you can wield a Catfish Sandwich in your right hand.
- **In 1.6 and SSO:** the right-hand rule meant for alchemy sand matches any name containing " Sand", and "Catfish Sandwich" contains it. SSO uses the same ordered rules.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`)
- **Pinned by:** `kept bug: Catfish Sandwich equips RightHand` (packages/shared/tests/inventory/inventory.test.ts)

### The Dragon Sword cannot be equipped
- **What you notice:** if you ever hold a Dragon Sword, Equip gives you nothing.
- **In 1.6 and SSO:** no slot rule matches its name, so it stays at "No" and cannot be worn. SSO has the same rules; it only matters if the Dragon Sword, which only comes from casting, is shipped.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`equipSlotFor`)
- **Pinned by:** `kept bug: Dragon Sword cannot be equipped` (packages/shared/tests/inventory/inventory.test.ts)

### Equipping into a slot that is already full is refused
- **What you notice:** if the slot already holds something, equipping a new item does not swap them. You read "You have to remove the current item you're wearing to equip this!" and nothing changes.
- **In 1.6 and SSO:** the server replies with that message and writes nothing. SSO's server refuses with the same message whenever the slot is not empty.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`checkEquip`)
- **Pinned by:** `kept bug: an occupied slot is refused, not swapped` (packages/shared/tests/inventory/inventory.test.ts)

### Eating when you are stuffed still uses up the food
- **What you notice:** you eat something while your hunger is at the top and it does nothing for you, yet the item is gone from your bag.
- **In 1.6 and SSO:** the effects only apply while hunger is below the limit (35000), but the removal of the item is always sent. SSO's server takes one unit, applies nothing at or above the limit and says "You're stuffed!".
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`)
- **Pinned by:** `kept bug: eating while stuffed still consumes the item` (packages/shared/tests/inventory/inventory.test.ts)

### Keys on the usable list are never used up like food
- **What you notice:** a key may appear on the list of usable items, but using it only tries a door and never uses it up the way a potion or food is.
- **In 1.6 and SSO:** any name containing "Key" is sent to the key handler and exits before the usable list is looked at, so that part of the list is dead. In SSO key use goes only through the door and key rule.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`useIntent`); `packages/server/src/systems/housing/doors.ts` (`useKey`)
- **Pinned by:** `kept bug: a Steel Key is on the usable list but Use sends it to the door rule, so it is never eaten like a usable item` (packages/server/tests/doors.test.ts)

### A full bag refuses a clicked pickup even if it would stack
- **What you notice:** with all 15 bag lines used, clicking a ground item you already carry is refused, even though it would stack. Gold is the exception, and pressing Ctrl takes it fine.
- **In 1.6 and SSO:** the click's pre-check overwrites its own count with 1 before looking for a matching stack, so a full bag always looks full. The same check runs when someone gives you an item. Ctrl pickup and vault withdrawal test correctly. SSO does the same, for click and tap pickup and for receiving a give.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`clickBagFull`, `pickupIntent`)
- **Pinned by:** `kept bug: a full bag refuses a click on a stackable item, Ctrl takes it` (packages/server/tests/inventory.test.ts)

### Picking up one item clears every identical item on that tile
- **What you notice:** if several identical items lie on the same tile, you pick up one and the rest vanish.
- **In 1.6 and SSO:** pickup blanks every ground entry with the same name on the tile and then grants one. SSO removes all entries with the same name (and quantity) on that tile and grants one.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`grab`)
- **Pinned by:** `kept bug: picking up clears every identical entry on the tile` (packages/server/tests/inventory.test.ts)

### You cannot drop onto a tile that already holds an item
- **What you notice:** facing a tile that has any ordinary item on it, Drop says "You begin to drop this but realize the floor is too crowded." Loot and gathered items still land on occupied tiles.
- **In 1.6 and SSO:** the drop is refused for any non-container item on the faced tile. In SSO the player's drop is refused on an occupied tile, and drops the server creates itself may stack.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`dropIntent`)
- **Pinned by:** `drop puts one unit on the faced tile; a second drop finds it crowded` (packages/server/tests/inventory.test.ts)

### Clicking a crate or cabinet picks it up; only Ctrl opens it
- **What you notice:** with enough Strength, clicking a Crate (15 or more) or a Cabinet or Wind Cabinet (19 or more) picks it up instead of opening it. Pressing Ctrl on it opens it and never picks it up. A picked-up crate keeps its contents.
- **In 1.6 and SSO:** the click falls through to the pickup path and never reaches the chest-opening code, and Ctrl's Strength checks can never be reached. A picked-up crate keeps its id, so its contents go with it. SSO does the same.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clickGate`, `ctrlGate`)
- **Pinned by:** `kept bug: clicking a crate or cabinet picks it up; only Ctrl opens it` (packages/shared/tests/housing/doors.test.ts); `a Crate on the floor opens with Ctrl; a click picks it up with its id and contents` (packages/server/tests/doors.test.ts)

### "You're stuffed!" appears on the bite that fills you
- **What you notice:** the bite that takes your hunger over the limit feeds you and also says "You're stuffed!". A player who is already stuffed still sees the eat line first.
- **In 1.6 and SSO:** effects apply while hunger is under 35000, then the stuffed line prints whenever hunger is over 34999 after the add. SSO prints the lines in the same order.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`)
- **Pinned by:** `kept bug: "You're stuffed!" on the bite that crosses the limit` (packages/shared/tests/inventory/inventory.test.ts)

### Purple Potion says its line twice and works when stuffed
- **What you notice:** drinking a Purple Potion prints "The power of argon flows through your body." twice. It still gives its attack boost when you are stuffed.
- **In 1.6 and SSO:** the attack bonus sits outside the hunger guard, and the line is added in two places. SSO does the same.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useItem`)
- **Pinned by:** `kept bug: Purple Potion prints its line twice and works when stuffed` (packages/shared/tests/inventory/inventory.test.ts)

### "You cannot equip the ..." has no full stop
- **What you notice:** when you cannot equip something, the message ends without a full stop.
- **In 1.6 and SSO:** the message is built as "You cannot equip the " followed by the item name, with nothing after it. SSO uses the same text.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`EQUIP_TEXT`)
- **Pinned by:** `kept bug: Dragon Sword cannot be equipped` (packages/shared/tests/inventory/inventory.test.ts)

### Boots are never drawn on your character
- **What you notice:** equipped boots do not show on your character, and gloves are drawn from the Ring slot.
- **In 1.6 and SSO:** the character is drawn from items 1, 2, 3, 5, 6 and 7 of its render data; item 4, the feet, is never used. SSO uses the same layers.
- **In the code:** `packages/shared/src/rules/inventory/paperdoll.ts` (`normaliseLook`, `paperdollLayers`)
- **Pinned by:** `kept bug: boots are never drawn; gloves come from the Ring slot` (packages/shared/tests/inventory/inventory.test.ts)

### Many fixtures can be picked up, and paintings only with Ctrl
- **What you notice:** a click or Ctrl can pick up things that look fixed in place, such as a Copy Machine, Large Rock, Table, Campfire, most statues and the "Universal" fixtures. Ctrl takes paintings and photos but a click does not, and a click takes the Piano.
- **In 1.6 and SSO:** neither the click path nor the Ctrl pickup path excludes those fixtures, and each path has its own list. SSO keeps the same list for each path.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clickGate`, `ctrlGate`)
- **Pinned by:** `kept bug: Ctrl takes paintings, a click does not` (packages/shared/tests/inventory/inventory.test.ts)

### Dropping crystals while facing a player gives them instead
- **What you notice:** you choose Drop for crystals or gold while a player stands in front of you, and the amount is given to that player instead. Gold always gives when someone is in front.
- **In 1.6 and SSO:** the amount window's OK picks give or drop by whether a player is on the faced tile, not by which button opened it. The gold window has one button for both. SSO does the same for crystals and gold.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`amountPath`); `packages/server/src/systems/inventory/items.ts` (`crystalsIntent`, `goldIntent`)
- **Pinned by:** `kept bug: OK on crystals while facing a player gives them (C120)`; `kept bug: give says 'Offering the 50 to B.' without the word gold; B has it at once` (packages/server/tests/inventory.test.ts)

### The give message names no gold or crystals
- **What you notice:** giving gold reads "*** Offering the 50 to Bob." with no word "gold". Giving crystals reads "*** Offering the  to Bob." with a blank where the name should be.
- **In 1.6 and SSO:** the message is built from a name field that, for gold, holds only the amount, and for crystals is never set. SSO prints the same texts.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`GIVE_TEXT`, `crystalsIntent`, `goldIntent`)
- **Pinned by:** `kept bug: give says 'Offering the 50 to B.' without the word gold; B has it at once`; `kept bug: OK on crystals while facing a player gives them (C120)` (packages/server/tests/inventory.test.ts)

### The gold and crystal amount OK clicks only when you drop
- **What you notice:** pressing OK in the amount window gives no click when you give something to a player, even a successful give. Every drop clicks, even one then refused as mid-step, crowded or blocked.
- **In 1.6 and SSO:** the click comes after the give path and gold's monster exit have returned and before the drop's own refusals. SSO does the same, and client and server pick the branch with the shared `amountPath`.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`amountPath`); `packages/client/src/model.ts` (`amountPath`)
- **Pinned by:** `drop clicks; short, give and the monster exit are silent`; `facing a player while mid-step takes the drop path: it clicks, then the drop stops` (packages/client/tests/sound.test.ts); `balance first, then a player ahead, then gold's monster exit, else the drop` (packages/shared/tests/inventory/inventory.test.ts)

### A given painting shows its # number to the receiver
- **What you notice:** when someone gives you a painting, you read "Bob is giving you a Painting#12.", while the giver's own line has no number.
- **In 1.6 and SSO:** the receiver's line takes the name as stored with no "#" stripping, while the giver's line strips it. SSO uses the ground item's stored name for the receiver.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`receiveGive`, `GIVE_TEXT`)
- **Pinned by:** `kept bug: a given painting is named with its # number` (packages/server/tests/inventory.test.ts)

### A placed clock goes round twice an hour
- **What you notice:** a clock placed in the world shows a new face every 3 minutes up to :35, then every 2 minutes after, so its hand goes round twice an hour, faster the second time, and never shows the hour.
- **In 1.6 and SSO:** the face table works that way in every place the clock is drawn. SSO uses the same table, drawn by the client from the server's minute.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clockFace`)
- **Pinned by:** `kept bug: a placed clock goes round twice an hour: every 3 minutes up to :35, then every 2` (packages/shared/tests/inventory/ground.test.ts)

### Ctrl on the Mage Master Platform keeps the item pause
- **What you notice:** Ctrl on the Experience, Slash Master or Ninja Master Platform prints its line and frees you at once. On the Mage Master Platform it prints its line, but your next item click waits out the 40-frame (2 second) pause.
- **In 1.6 and SSO:** the other platforms end the pause when they print; the Mage Master branch exits without doing so. SSO does the same: its Ctrl handling returns the Mage Master's text without the unpause flag.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`ctrlGate`)
- **Pinned by:** `kept bug: Ctrl on the Mage Master Platform says its line but keeps the pause` (packages/shared/tests/inventory/ground.test.ts)

### In your own house a click picks up a casino table, Ctrl plays
- **What you notice:** in your own house or your guild's hall, clicking a Slot Machine, Blackjack Table or Checkers Table picks it up, and Ctrl is what plays it.
- **In 1.6 and SSO:** the click only opens a casino game when the "do not drop this" flag is set (off your own premises); otherwise it falls through to pickup. Ctrl has no such test and always runs the game. SSO does the same.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`clickGate`, `ctrlGate`)
- **Pinned by:** `kept bug: casino games in your own house: a click picks up, Ctrl plays` (packages/shared/tests/casino/casino.test.ts); `a click and Ctrl both reach the table, with the click's 40-frame pause first` (packages/server/tests/blackjack.test.ts) and `a click and Ctrl both reach the table, with the click's 40-frame pause first` (packages/server/tests/checkers.test.ts)

### Music never plays, and the Ocarina does nothing
- **What you notice:** No music ever plays. Using an Ocarina gives no sound and no message, and the Ocarina stays in your bag.
- **In 1.6 and SSO:** The original's music routines were empty, and using an Ocarina only called one of them. SSO's Ocarina use does nothing.
- **In the code:** `packages/shared/src/rules/inventory/equip.ts` (`useDeferred`)
- **Pinned by:** `kept bug: music is silent: the Ocarina's use does nothing` (packages/shared/tests/mail/art-news.test.ts); `kept bug: music is silent: using an Ocarina sends nothing, says nothing and keeps the Ocarina` (packages/server/tests/art-news.test.ts)

### Ctrl reopens a mailbox that is already open
- **What you notice:** Press Ctrl facing your mailbox while it is open and you see "You check your mail..." again, as if you had just opened it.
- **In 1.6 and SSO:** 1.6's Ctrl waited only for the item-action pause and not for the input lock, so Ctrl worked with the box open. SSO does the same.
- **In the code:** `packages/server/src/systems/inventory/items.ts` (`ctrlPaused`), `packages/server/src/systems/mail/mail.ts` (`mailOpen`)
- **Pinned by:** `Ctrl reopens under the lock, pause 40` (packages/server/tests/mail-boards.test.ts)

### Ctrl is silent on a stand whose owner's name has 'door' or 'exit'
- **What you notice:** Press Ctrl facing "Doorman's Newspaper" and nothing happens, though clicking the same stand reads it.
- **In 1.6 and SSO:** 1.6 tested Ctrl for a door or exit name, in any case, before testing for a newspaper. SSO does the same.
- **In the code:** `packages/shared/src/rules/inventory/ground.ts` (`ctrlGate`)
- **Pinned by:** `Ctrl: Doorman's Newspaper is silent, door/exit first` (packages/shared/tests/mail/art-news.test.ts); `kept bug: Ctrl is silent on 'Doorman's Newspaper' while a click reads it` (packages/server/tests/art-news.test.ts)

## mail

### Closing a mail pane lets you walk with the list still open
- **What you notice:** Close the compose or read pane inside the mailbox and your character can walk again, though the mail list is still on screen.
- **In 1.6 and SSO:** In 1.6 the pane's CLOSE cleared the input lock and hid only the pane. SSO does the same: the client unlocks and tells the server, which is what actually stops walking.
- **In the code:** `packages/server/src/systems/mail/mail.ts` (`mailUiIntent`), `packages/client/src/ui/mail.ts` (`createMailScreen`)
- **Pinned by:** `composeClose unlocks with the list up; close takes the list down` (packages/server/tests/mail-boards.test.ts); `either CLOSE unlocks and hides both panes, the list stays up` (packages/client/tests/mail-boards.test.ts)

### Replying to a reply gives "Re: Re: "
- **What you notice:** Reply to a message that already starts "Re: " and the subject becomes "Re: Re: ...".
- **In 1.6 and SSO:** 1.6 put "Re: " in front of the old subject every time. SSO does the same.
- **In the code:** `packages/shared/src/rules/mail/mail.ts` (`replySubject`)
- **Pinned by:** `replySubject stacks Re:` (packages/shared/tests/mail/mail-boards.test.ts); `REPLY locks, answers the sender and stacks Re:` (packages/client/tests/mail-boards.test.ts)

### Mail goes to the first 7 names, a repeated name gets two copies
- **What you notice:** Address a message to more than 7 names and the extra ones are ignored. A name typed twice gets two copies. The "*** Sending Mail..." line prints only when the first name in the list is filled, so a To of ",Bob" sends without it.
- **In 1.6 and SSO:** 1.6 read items 1 to 7 of the To field, sent to each non-empty item and printed the line only for item 1. SSO does the same.
- **In the code:** `packages/shared/src/rules/mail/mail.ts` (`mailRecipients`), `packages/server/src/systems/mail/mail.ts` (`mailSend`)
- **Pinned by:** `mailRecipients` (packages/shared/tests/mail/mail-boards.test.ts); `a repeated name gets two copies, items past 7 are ignored` (packages/server/tests/mail-boards.test.ts); `a To with no item 1 sends but prints no line` (packages/client/tests/mail-boards.test.ts)

### Spaces in a mail's To field vanish, but long runs leave one behind
- **What you notice:** Spaces are removed from the To field, so "a b" becomes "ab". A run of four or more spaces (or stars) is not removed completely.
- **In 1.6 and SSO:** 1.6 removed a space and a star at each position while stepping through the field, which skips the next character, so long runs leave some behind. SSO does the same for the To field. It does not keep the same strip on the message body.
- **In the code:** `packages/shared/src/rules/mail/mail.ts` (`stripMailTo`)
- **Pinned by:** `stripMailTo` (packages/shared/tests/mail/mail-boards.test.ts); `spaces and stars are stripped from To` (packages/server/tests/mail-boards.test.ts)

### Posting closes the board without showing your post
- **What you notice:** Press Post and the board window closes with no message and no reload. You see your post only when you next open the board.
- **In 1.6 and SSO:** 1.6 hid the window and sent the post, with nothing reloaded. SSO does the same: the server answers with an empty board.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`)
- **Pinned by:** `a post is appended in 1.6's format, closes the window and a second is ignored` (packages/server/tests/mail-boards.test.ts); `Post unlocks first and sends the field; the server's null closes it` (packages/client/tests/mail-boards.test.ts); `Alice posts on Town Square from anywhere; the window closes and prints nothing` (packages/server/e2e/mail-and-boards.test.ts)

### A refused post frees your keys with the board still open
- **What you notice:** Press Post with nothing to post and you get the alert, but the board stays open and you can walk away from it.
- **In 1.6 and SSO:** 1.6 cleared the input lock before checking the text. SSO does the same.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardPostIntent`)
- **Pinned by:** `a refused post (no letter or digit) alerts, unlocks, and can be retried` (packages/server/tests/mail-boards.test.ts)

### The message board stays open when you change map
- **What you notice:** Leave the map with a board open and it is still open on the next map. A post then goes to the last board you opened.
- **In 1.6 and SSO:** 1.6 hid the board only on game entry. SSO does the same: the window and the server's chosen board survive a map change.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardOpen`, `boardPostIntent`)
- **Pinned by:** `kept bug: a map change leaves the board open and able to post` (packages/server/tests/mail-boards.test.ts)

### A guild board opens for anyone from the top seven rows of any map
- **What you notice:** Click a guild board, or press Ctrl facing it, from any map and you can read it as long as you stand in rows 1 to 7. You need not belong to the guild, and your keys are not locked.
- **In 1.6 and SSO:** 1.6 tested only the row you stood on and never your guild. SSO does the same, except that only the board you actually clicked opens.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardOpen`)
- **Pinned by:** `a hall's board from y <= 7 on any map by a non-member, no lock, pause 40` and `a hall's board from y 8 is refused` (packages/server/tests/mail-boards.test.ts)

### Town Square's board opens from any distance
- **What you notice:** Click the Town Square board from anywhere on the map and it opens at once. Ctrl still needs you to face it.
- **In 1.6 and SSO:** 1.6 ran the click with no distance or facing test, locked the keys and set no pause. SSO does the same for the click, and Ctrl needs the faced tile as in 1.6.
- **In the code:** `packages/server/src/systems/mail/boards.ts` (`boardOpen`)
- **Pinned by:** `Town Square by click: no distance test, locks, no pause` (packages/server/tests/mail-boards.test.ts)

### Pure white paints nothing with the paint brushes
- **What you notice:** With pure white picked, the four brushes leave no mark on the picture. The Fill tool still fills with white.
- **In 1.6 and SSO:** 1.6 drew the brush as a white shape that is treated as transparent, so white never showed. SSO does the same.
- **In the code:** `packages/shared/src/rules/mail/paint.ts` (`paintAt`)
- **Pinned by:** `white paints nothing with the brushes, Fill still fills white (ink 36)` (packages/shared/tests/mail/art-news.test.ts)

### A cancelled canvas reopens for free
- **What you notice:** Cancel out of the paint screen and your picture is kept. The next time you use a Canvas it reopens that picture without using up another Canvas.
- **In 1.6 and SSO:** 1.6 remembered the cancelled picture and exited before removing a canvas. SSO does the same: the server holds the used canvas as a credit until a save spends it or you enter the game, and a Use while it is held is a free reopen.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`useCanvas`)
- **Pinned by:** `kept bug: a cancelled canvas reopens without using another` (packages/server/tests/art-news.test.ts); `kept bug: Cancel keeps the picture and the next Canvas reopens it` (packages/client/tests/art-news.test.ts)

### Film is lost when you cancel a shot or your bag is full
- **What you notice:** Use a Film and then click your bag to cancel, or take the shot with a full bag, and the photo is refused. The film is gone either way.
- **In 1.6 and SSO:** 1.6 used up the film before the shot. SSO does the same.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`useFilm`), `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `a bag click hides it, the film lost` and `kept bug: a full bag after the shot says so and the film is lost` (packages/client/tests/art-news.test.ts)

### A painting you are viewing can be saved as your own
- **What you notice:** View a painting, cancel a canvas, and the canvas reopens showing the viewed painting. Save then stores it under your name.
- **In 1.6 and SSO:** 1.6 showed the viewed picture in the canvas's own image. SSO does the same: the save needs a canvas credit and a free slot like any painting, and stores the client's picture as yours.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`artSaveIntent`), `packages/client/src/ui/paint.ts` (`createPaintUi`)
- **Pinned by:** `kept bug: a cancelled canvas reopens showing a viewed painting, which Save keeps as yours` (packages/client/tests/art-news.test.ts)

### Paintings and photos on the ground can be viewed from anywhere
- **What you notice:** Click a painting or photo lying on the ground and it opens, however far away it is or which way you face.
- **In 1.6 and SSO:** 1.6 had no distance, facing or adjacency test for this click. SSO does the same and reads the id from the clicked item.
- **In the code:** `packages/server/src/systems/mail/art.ts` (`viewArt`), `packages/server/src/systems/inventory/items.ts` (`pickupIntent`)
- **Pinned by:** `kept bug: a ground click views from any distance and clears the pause` (packages/server/tests/art-news.test.ts)

### Newspapers can be read from anywhere
- **What you notice:** Click a newspaper stand and you read it from any distance, facing any way.
- **In 1.6 and SSO:** 1.6 had no distance or facing test for the click. SSO does the same.
- **In the code:** `packages/server/src/systems/mail/newspapers.ts` (`readNewspaper`)
- **Pinned by:** `a click reads: the line, pause 20, the fields, null for a missing or non-numeric photo` (packages/server/tests/art-news.test.ts)

### A player's newspaper stand never shows any text
- **What you notice:** Drop a Newspaper Kit and read the stand: it is blank. Only an immortal can write a paper, so a player's stand never has text.
- **In 1.6 and SSO:** 1.6 read the owner's paper file but only an immortal could save one. SSO does the same.
- **In the code:** `packages/server/src/systems/mail/newspapers.ts` (`newspaperSaveIntent`)
- **Pinned by:** `kept bug: a player's stand stays blank` (packages/server/tests/art-news.test.ts)

## monsters

### NPC windows open from any distance
- **What you notice:** clicking an NPC anywhere on the screen opens its shop window, however far away it stands.
- **In 1.6 and SSO:** the click has no range check. SSO has none either.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`)
- **Pinned by:** `an NPC with data opens its Bio, with no range check, and holds the keys until it closes` (packages/server/tests/npcs-trade.test.ts)

### A monster with only a loot file opens an empty window
- **What you notice:** clicking a monster such as a Slime opens a window titled with its name that has empty fields and no buttons, and your keys stay locked until you close it.
- **In 1.6 and SSO:** the click only checks that the monster has some NPC file, and a Slime's loot lines count. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`)
- **Pinned by:** `kept bug: a Slime's loot-only file opens an empty Bio and locks you` (packages/server/tests/npcs-trade.test.ts)

### A map's fifth monster slot never existed
- **What you notice:** nothing. A map holds at most four monsters from its roster.
- **In 1.6 and SSO:** melee only looped over four of the five monster sprites that spells and arrows loop over, and the fifth slot never spawned anything. SSO has no sprite slots, so nothing shows; a map's roster simply has four slots. It is recorded here so the omission is deliberate.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`MonsterSlot`)
- **Pinned by:** `kept bug: slot 5 never spawns: a roster has four slots` (packages/server/tests/monsters.test.ts)

### Only four monsters can ever stand on a screen
- **What you notice:** no screen ever holds more than four spawned monsters, however the map was set up.
- **In 1.6 and SSO:** 1.6 meant to have a fifth roster slot, but never filled it in and switched off the message that would have shown it, so it never spawned. SSO gives each map exactly four slots.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`MonsterSlot`)
- **Pinned by:** `kept bug: slot 5 never spawns: a roster has four slots` (packages/server/tests/monsters.test.ts)

### The second monster slot waits no time after planning a walk
- **What you notice:** the monster in the second roster slot can be picked to walk again straight away, while the other slots wait a moment after each pick.
- **In 1.6 and SSO:** after a new walk is planned, slots 1, 3 and 4 wait 30 frames before they can be picked again and slot 2 waits 0. The 90-frame pause after each step still applies, so you only see the difference when a planned walk has no step that can start, or when a step stops on an item. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`moverPass`)
- **Pinned by:** `kept bug: slot 2's pause after authoring is 0 when no step can start` (packages/server/tests/monsters.test.ts)

### Five sea creatures turn up stranded on land
- **What you notice:** Merius, Krommie, Jelstar, Mellanie and Minmaye appear on dry land instead of at sea, and then cannot take a single step.
- **In 1.6 and SSO:** a misspelt name in the spawn check makes these five use the land spawn rules, while the movement code correctly treats them as sea creatures and refuses every land step. Only Squid, Shark and Mizella spawn in water. SSO uses the same two tests and the same species lists.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`refusesTile`)
- **Pinned by:** `kept bug: five sea creatures spawn on land; Squid needs water` (packages/server/tests/monsters.test.ts)

### Big monsters can spawn half inside walls on the right and bottom
- **What you notice:** Overlord and Mutant Worm sometimes appear overlapping walls near the right or bottom edge of a screen.
- **In 1.6 and SSO:** when the chosen tile is past column 12 or row 9, the spawn check says "fine" before it checks the 3 by 2 tiles a big monster covers. SSO copies that early exit.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`refusesTile`)
- **Pinned by:** `kept bug: the footprint test is skipped at x > 12 or y > 9` (packages/server/tests/monsters.test.ts)

### One failed roll for a special monster ends the whole spawn pass
- **What you notice:** when a screen's spawner picks a monster from the NPC list and its extra roll fails, the other empty slots do not get their turn that time round.
- **In 1.6 and SSO:** a failed roll for such a monster leaves the spawn routine altogether, skipping the later slots in that frame. SSO does the same within one player's pass.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`)
- **Pinned by:** `kept bug: a failed NPCed roll ends the whole pass` (packages/server/tests/monsters.test.ts)

### A species with no hit point entry spawns with the last monster's HP
- **What you notice:** a monster whose species has no hit point value can arrive with a strange amount, such as a negative one, or none at all.
- **In 1.6 and SSO:** the spawn code sets hit points only for the species it lists, so any other species keeps what the roster slot had before. In SSO that is the hit points the slot's previous monster had when it died (below zero, since that is what death means), or 0 if the slot never held one.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`placeMonster`); `packages/server/src/systems/monsters/slots.ts` (`MonsterSlot`)
- **Pinned by:** `kept bug: a species with no HP entry inherits the slot's last HP` (packages/server/tests/monsters.test.ts)

### Which monsters walk toward you is decided by a substring match
- **What you notice:** a Dragon walks toward players because its name is found inside "Dragon Hatchling", while the Overlord, whose name is not on the list, just wanders.
- **In 1.6 and SSO:** the check asks whether the hostile list contains the monster's name as text, not whether the name is an entry. SSO runs the same test against the same list.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`leansToward`)
- **Pinned by:** `kept bug: the hostile list is matched by contains: Dragon leans via Dragon Hatchling, Overlord wanders` (packages/server/tests/monsters.test.ts)

### With nine or more players on a screen monsters nearly never stop walking
- **What you notice:** on a crowded screen the monsters move almost continuously.
- **In 1.6 and SSO:** the chance that a monster is picked to plan a walk gets steadily better from 1 to 8 players (a pick every 30 to 600 frames), then, at the 9th player, drops back to one every 50 frames. SSO uses the same ladder for each player, up to 15 players.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`moveLadder`)
- **Pinned by:** `ladders: spawn 80…1300 by players, move 30…600 then 50 at the 9th` (packages/server/tests/monsters.test.ts)

### A hostile monster aims at where the triggering player stood
- **What you notice:** when a monster plans a path toward a player, it aims at the spot where that one player was at that moment, not at wherever they go next.
- **In 1.6 and SSO:** the path leans toward the player whose own game started the walk, using positions at planning time. In SSO the player whose roll fired is the one it leans toward, and the whole path is worked out at that tick.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`authorPath`)
- **Pinned by:** `a hostile path leans toward the author by pixel position` (packages/server/tests/monsters.test.ts)

### A monster with no attack entry hits for 35
- **What you notice:** a hostile monster that has no attack value of its own hits you for 35 on a map where fighting is allowed.
- **In 1.6 and SSO:** the attack table falls back to 35 for any name it does not list. Monsters marked Passive do not attack. SSO keeps the same table and default.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttackValue`)
- **Pinned by:** `kept bug: a name with no attack entry hits for 35` (packages/server/tests/monsters.test.ts)

### The Snared Loah hits for 35 instead of 18
- **What you notice:** the Snared Loah hits harder than its table row says.
- **In 1.6 and SSO:** the attack table spells the name "Snared Load", so the Snared Loah never matches its row of 18 and gets the default 35. SSO's monster data simply gives the Snared Loah an attack of 35.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttackValue`)
- **Pinned by:** `kept bug: the "Snared Load" typo in the attack table misses the Snared Loah, which hits for the default 35, not 18` (packages/server/tests/monsters.test.ts)

### Clicking a Snow Demon tries to grab a pig
- **What you notice:** clicking a Snow Demon does what clicking a Pig does: you grab whatever you are facing, and Ctrl grabs a faced Snow Demon as if it were a Pig.
- **In 1.6 and SSO:** the click handler looks for "91-" anywhere in a monster's picture name, and the Snow Demon's picture 891 contains it. SSO keeps the same text test on the picture name.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`, `bodyHas`)
- **Pinned by:** `kept bug: Snow Demon runs the pig grab: its body 891 contains "91-", so a click on it grabs what you face, and Ctrl grabs a faced Snow Demon as a Pig` (packages/server/tests/npcs-trade.test.ts)

### Clicking any pig grabs whatever you are facing
- **What you notice:** click a Pig, even one far across the screen, and you grab whatever stands on the tile you face, such as a Dragon or a shopkeeper, and a Pig goes into your bag. The grabbed creature leaves with no XP and no loot.
- **In 1.6 and SSO:** the click grabs the first roster monster standing exactly on your faced tile without checking what it is. The grab starts its 500-frame cooldown before the bag test, and a bag whose text contains "Pig" (even "Cooked Pig") skips the 15-line check. Whenever a monster is removed or killed, every player on the map has their pig cooldown set to 20. Ctrl does check each candidate's own picture. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`, `grabPig`, `ctrlPig`, `PIG_GRAB_FRAMES`, `PIG_CNCL_FRAMES`)
- **Pinned by:** `kept bug: clicking any Pig grabs whatever stands on your faced tile, here Cril; any Cncl sets everyone's pig countdown to 20`; `the grab's cooldown is set before the bag test; 'Pig' in the bag text skips it` (packages/server/tests/npcs-trade.test.ts)

### Monster chatter almost never speaks, and ignores how crowded the screen is
- **What you notice:** the four Gods are the only NPCs with speech lines, and they speak very rarely: about once in 6,000 frames for each player who has them on screen.
- **In 1.6 and SSO:** the chatter roll reads the list of players from the wrong copy of a text member, which holds only "King" and a return. Its second line is therefore always empty, so all six draws are taken and the last, a 1-in-400 roll, decides. SSO makes the same draws, once per player on the map.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`chatterRoll`)
- **Pinned by:** `random(15), then all six UserList draws with the last, random(400), deciding; then the line (bug ledger)` (packages/server/tests/npcs-trade.test.ts)

### Monsters walk through players, monsters and static NPCs
- **What you notice:** monsters pass through players and other monsters, and a static NPC's tile never stops them, while a blocking item on the ground ends their walk.
- **In 1.6 and SSO:** a step checks only the blocked tiles, the screen edge and water. If an item that blocks lies on the way, the rest of the path is dropped. SSO follows the same rules, so monsters can share a tile.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`nextStep`)
- **Pinned by:** `steps follow back to back, 16 calls = 8 frames each, and players never block them` (packages/server/tests/monsters.test.ts).

### A calm monster loses a walking tick when its attack roll comes up
- **What you notice:** a Passive monster that has not been provoked, on a map where fighting is allowed, now and then freezes for a beat instead of walking on, even though it never attacks.
- **In 1.6 and SSO:** its attack roll is a 1-in-10 draw, and on a 1 the monster's whole step routine ends early, skipping that frame's walk tick. In 1.6 each player's game did this separately, with steps of about 17.8 frames. SSO has one copy of the monster, so the first player's roll each tick decides the stall.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`)
- **Pinned by:** `kept bug: an unprovoked Passive monster's random(10) = 1 skips its walk tick` (packages/server/tests/monsters.test.ts)

### Death blames the last monster whose roll was ignored
- **What you notice:** if you die, the line "*** Bob was just killed by a Slime." can name a monster whose hit was ignored because you were blinking, as long as it was the last to roll against you.
- **In 1.6 and SSO:** the monster hit handler records the attacker's name before the blink check exits. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`hitMe2`)
- **Pinned by:** `kept bug: the last monster to roll against you is blamed, even during i-frames` (packages/server/tests/monsters.test.ts)

### A death drop picks among the first lines, even when some are empty
- **What you notice:** when you die and drop an item, the pick can land on an empty line of your bag, so nothing drops. A stack of crystals never drops either.
- **In 1.6 and SSO:** the game counts the non-empty lines among 1 to 8 and picks a line number up to that count, not among the filled lines. With gaps in your bag the pick can be empty. SSO does the same.
- **In the code:** `packages/shared/src/rules/monsters/loot.ts` (`rollDeathDrop`)
- **Pinned by:** `kept bug: the death drop picks lines 1 to the filled count` (packages/shared/tests/inventory/inventory.test.ts)

## movement

### A weaker player still shoves you
- **What you notice:** walk into a player who is standing still and now and then (1 blocked step in 25) you push them a tile. If you are weaker than them they read "… is too weak", and then "… shoves you out of the way." and move anyway.
- **In 1.6 and SSO:** the "too weak" check prints its line but doesn't stop the shove. In SSO the server does it, always tries the victim's step with normal collision, and never pushes immortals or players whose keys are held by a window.
- **In the code:** `packages/server/src/systems/movement/push.ts` (`pushOnMe`)
- **Pinned by:** `kept bug: a weaker pusher is 'too weak' and still shoves` (packages/server/tests/push.test.ts); `walking into a standing player can push them` (packages/server/e2e/chat-and-presence.test.ts)

### Stepping off the screen's edge ignores walls
- **What you notice:** walk off the edge of the screen and you arrive on the matching tile of the next map even when that tile is a wall or water.
- **In 1.6 and SSO:** the step that crosses the edge never checks the tile it lands on. SSO does the same.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`attemptMove`, `edgeWrap`)
- **Pinned by:** `kept bug: crossing an edge never checks the wrapped tile` (packages/shared/tests/movement/movement.test.ts); `kept bug: walking off an edge onto an existing neighbour keeps the wrapped tile, unchecked` (packages/server/tests/world.test.ts)

### Later monsters block three tiles wide after an Overlord
- **What you notice:** once an Overlord or Mutant Worm sits in a lower monster slot, the monsters in the higher slots behind it block three tiles wide too, even small ones like a Slime.
- **In 1.6 and SSO:** the three-wide flag is set for an Overlord or Mutant Worm and never reset while the slots are checked in order, so later slots inherit it. SSO does the same, from the first slot whose remembered name is Overlord or Mutant Worm (live or not): every live monster after it blocks its tile and the two to its right, a step off the right edge included.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`blockPCCheck`)
- **Pinned by:** `kept bug: a lower slot is one wide, a higher slot three wide after an Overlord`; `kept bug: a remembered dead Overlord in slot 1 widens slot 2` (packages/shared/tests/movement/movement.test.ts); `kept bug: a Slime in slot 2 is three wide after an Overlord in slot 1, even a dead one`; `Overlord at x = 16 stops a walk off the right edge` (packages/server/tests/blocking.test.ts)

### A Web or Holy Shield clears the way through players and earlier monsters
- **What you notice:** when a Web or Holy Shield is in one of the monster slots, you can walk through standing players and through the monsters in lower slots, though monsters in higher slots can block you again.
- **In 1.6 and SSO:** the Web or Holy Shield test clears the block flag whatever set it, looking only at the slot's name, and the name outlives the monster. SSO keeps this, using each player's remembered slot names; a push that was already rolled still lands.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`blockPCCheck`)
- **Pinned by:** `kept bug: a Web in slot 2 clears a standing player and slot 1, slot 3 still blocks`; `kept bug: a remembered dead Holy Shield still clears` (packages/shared/tests/movement/movement.test.ts); `kept bug: a remembered Web in slot 2 lets you walk through a Slime in slot 1`; `kept bug: a Web in slot 4 lets you walk onto a standing player, and the roll still shoves` (packages/server/tests/blocking.test.ts)

### Any step attempt refills the fishing allowance
- **What you notice:** while fishing, the limit on casts without moving is topped back up to 5 whenever you try to step, even a step into a wall or off the screen.
- **In 1.6 and SSO:** the code meant to refill it only when you turn, but compared facing letters with direction words, so it always refilled. SSO does the same: every move attempt that gets past the turn, the player and item blocks and the mid-step test resets the allowance to 5.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`refreshAntiMacro`)
- **Pinned by:** `kept bug: a step into a wall refreshes the allowance`; `turning in place does not refresh it` (packages/server/tests/gather.test.ts)

### The web message repeats while you hold a direction
- **What you notice:** standing on a web tile, you read "Your feet are stuck in the web, you cannot move!" on every move attempt while a direction is held. A web on any other tile never blocks you.
- **In 1.6 and SSO:** the web only counts when it is exactly on your own tile. SSO checks it every tick while a direction is held, on the walker's own tile only, after the player-block and mid-step tests and before the edge wrap; your facing doesn't change and the fishing allowance is refreshed. A rider ignores webs. A shove runs the same check, so a webbed victim reads the push lines, then the web line, and stays.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`WEB_TEXT`), `packages/server/src/systems/movement/movement.ts` (`walkWorld`)
- **Pinned by:** `kept bug: web message every attempt while an arrow is held`; `web: aboard an Airship webs are ignored`; `web: a web on the next tile is walked onto`; `web: a shoved webbed player reads the push lines, then the web line, and stays`; `web: a refused step refreshes the fishing allowance` (packages/server/tests/pigs-orbs-webs.test.ts)

### Players walking between tiles don't block each other
- **What you notice:** a player blocks you only while standing still. Someone mid-step doesn't, so two players can end up on the same tile.
- **In 1.6 and SSO:** blocking compares exact sprite positions, and other players' sprites animate between tiles. SSO does the same: a player blocks only while not mid-step.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`standingPlayersAt`)
- **Pinned by:** `kept bug: a player mid-step does not block; two players end on one tile` (packages/server/tests/world.test.ts); `kept bug: a moving player does not block: alice steps onto bob's tile` (packages/server/e2e/login-and-walk.test.ts)

## progression

### Dying on an airship loses it and drops nothing
- **What you notice:** if you die while riding an airship, your bag and gold stay with you instead of dropping, the airship is gone, and no deed comes back. The faction head still drops.
- **In 1.6 and SSO:** death clears the vehicle and switches drops off. SSO does the same. The body reverts to the walker at once for everyone, on the server, where 1.6 delayed it on each player's screen.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/server/src/systems/vehicles/airship.ts` (`vehicleDeath`)
- **Pinned by:** `kept bug: dying aboard an airship loses it and drops nothing; the faction head still drops` (packages/server/tests/vehicles.test.ts); `a Lightning death clears it too` (packages/server/tests/vehicles.test.ts)

### Airship riders stay aboard through the arena
- **What you notice:** if you are killed on an arena tile while flying, you are moved out of the arena still flying, with your airship. Challenging and quitting an arena fight also leave you flying.
- **In 1.6 and SSO:** the arena exit runs before the vehicle is cleared, and neither challenge nor quit looks at vehicles. SSO does the same: the death check tests the arena first and returns before the vehicle is cleared, and the exit is drawn from the tiles an Airship may stand on.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`)
- **Pinned by:** `kept bug: an arena death keeps the airship` (packages/server/tests/vehicles.test.ts); `kept bug: a rider challenges and quits still flying` and `a rider's exit is drawn from the Airship grid` (packages/server/tests/arena.test.ts)

### Every new character starts with 20 hit points and 20 spell points
- **What you notice:** the character you build always begins at HP 20/20 and SP 20/20, whatever the class, including Fighters, whose creation screen showed 0 SP.
- **In 1.6 and SSO:** the rolled values are thrown away and the saved record gets the fixed numbers 20, 20, 20, 20. SSO writes the same.
- **In the code:** `packages/shared/src/rules/progression/creation.ts` (`startingCharacter`)
- **Pinned by:** `kept bug: vitals are the literal 20/20/20/20 for every class, Fighter included` (packages/shared/tests/progression/creation.test.ts)

### A level-up wastes spare XP and never raises more than one level
- **What you notice:** when a kill pushes you past the XP you need, the extra is lost, you gain a single level however large the kill, and you are not healed.
- **In 1.6 and SSO:** at level-up the XP counter is reset to 0, and the check is a single test rather than a loop. SSO does the same.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`checkLevelUp`)
- **Pinned by:** `kept bug: overflow is lost, one level per kill, no heal` (packages/shared/tests/progression/progression.test.ts); `kept bug: XP overflow is lost and one level comes per kill` (packages/server/tests/monsters.test.ts)

### A class promotion never gives the skills it was meant to
- **What you notice:** promoting to a new class changes your class, gold and stats, but none of the skill points each promotion was supposed to grant.
- **In 1.6 and SSO:** each promotion sets its skill to a random number from 1 to 10, but the game then reloads every skill from the saved field before saving, which undoes it. A changed roll could also have triggered the anti-cheat ban, which SSO does not have, so there is no ban.
- **In the code:** `packages/shared/src/rules/progression/promotion.ts` (`promoteClass`)
- **Pinned by:** `kept bug: Promotion skill grants are undone: no promotion returns a skill` (packages/shared/tests/progression/promotion.test.ts)

### Hit and spell point regeneration can stop until you log in again
- **What you notice:** when your hunger sits between 50 and 500, regeneration stops for the rest of the session, and starvation damage stops with it.
- **In 1.6 and SSO:** the regen counter resets only when it exactly equals the target, and that happens only on a regen (Hunger above 500) or starvation (below 50) event. In between, or after the target drops below the counter, it never matches again until you log in. SSO keeps a counter per session, resets it only at login, and tests for exact equality every tick. The counter starts at 1 and is raised before the test, so regen fires every 148 frames at speed 1.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`regenTick`); `packages/server/src/systems/progression/vitals.ts` (`regenStep`)
- **Pinned by:** `kept bug: regen stalls for 50 <= Hunger <= 500 and never fires again` (packages/shared/tests/progression/progression.test.ts); `kept bug: a resumed session keeps the regen counter; a login resets it` (packages/server/tests/monsters-db.test.ts)

### The same hunger warning prints several times
- **What you notice:** each hunger warning appears about three times in a row instead of once.
- **In 1.6 and SSO:** the check runs every frame below 2000 and prints whenever hunger exactly equals a warning value, while hunger drops on only about a third of frames, so it sits on each value for several frames. SSO runs the same check every tick.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`hungerTick`, `HUNGER_WARNINGS`)
- **Pinned by:** `kept bug: a warning prints on every frame hunger sits on the value` (packages/shared/tests/progression/progression.test.ts)

### Every normal death has a one in five chance of weakening you
- **What you notice:** a death outside the arena costs 1 off both your maximum HP and maximum SP one time in five, with the weakened message.
- **In 1.6 and SSO:** the code sets the death penalty to "X" just before testing it, which forces the roll for everyone. The intended chance was one in one, for some players. A maximum is only lowered while it is above 2. SSO does the same.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`rollDeathPenalty`)
- **Pinned by:** `kept bug: DeathPenalty is forced, random(5) = 1 → HPmax and SPmax −1 above 2` (packages/shared/tests/progression/progression.test.ts)

### Mage skill caps higher from casting than from killing
- **What you notice:** a Mage faction member with a bonus of 3 can raise the Mage skill to 90 by casting, but only to 80 by killing.
- **In 1.6 and SSO:** the kill path and the cast path each have their own cap table, and they disagree at that bonus. SSO keeps both tables.
- **In the code:** `packages/shared/src/rules/progression/skillgain.ts` (`skillCaps`); `packages/shared/src/rules/spells/spells.ts` (`castMageCap`)
- **Pinned by:** `kept bug: a Mage faction bonus of 3 caps Mage skill at 80 from kills but 90 from casts` (packages/shared/tests/spells/spells.test.ts)

### A death from hunger credits whoever hit you last
- **What you notice:** If you starve, whoever hit you last, however long ago, is named and flagged as your killer.
- **In 1.6 and SSO:** 1.6 clears the last attacker only at death and login, so a death nobody caused still credits them. SSO does the same, keeping the attacker by player.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`hungerStep`, `finishDeath`)
- **Pinned by:** `kept bug: a starvation death credits the last attacker, however long ago` (packages/server/tests/factions.test.ts)

### A medal needs the skill at exactly 90
- **What you notice:** A skill that jumps past 90 without being saved at 90, such as an admin setting it to 95, never earns its medal.
- **In 1.6 and SSO:** 1.6 tests each skill for equal to 90. SSO does the same, checking whenever a player's skills change.
- **In the code:** `packages/shared/src/rules/progression/medals.ts` (`checkForAwards`)
- **Pinned by:** `kept bug: 89 or 91 earns nothing; a medal already held is not given again` (packages/shared/tests/social/friends-bios-medals.test.ts); `kept bug: a skill set past 90 never earns it` (packages/server/tests/friends.test.ts)

## social

### Guild lines that do not start with a letter lose their first character
- **What you notice:** A guild line that begins with something other than a letter comes out one character short. Ordinary guild data never changes.
- **In 1.6 and SSO:** 1.6 tests the first character for a letter and otherwise deletes it. SSO reads the guild header through the same transform: on your own guild's lines at login, on every change and for the guild screen. A guild you only view is read raw. Honest data never changes.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`loadGuildStrip`)
- **Pinned by:** `kept bug: a line not starting with a letter loses its first character; honest data never does` (packages/shared/tests/social/guilds.test.ts)

### Abdicating announces the guild's name, not the new leader's
- **What you notice:** When a leader abdicates, the line reads "*** Abdicating to <guild>", naming the guild. The leader screen stays up unrefreshed, and the old leader becomes the last member.
- **In 1.6 and SSO:** 1.6 keeps the header's alignment and colour, crowns the target, re-adds the old leader as the last member and prints that line. A leader has no Leave button. SSO makes the same row change and prints the same texts; the screen stays as it was, and the client keeps the selected name through an exile as 1.6 did. The server checks leadership on every action, so the stale buttons no longer act and a stale selection is not crowned.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`abdicateGuild`), `packages/client/src/ui/guildcenter.ts` (`abdicate`)
- **Pinned by:** `kept bug: abdicate crowns the target and re-adds the old leader last` (packages/shared/tests/social/guilds.test.ts); `kept bug: abdicate names the guild; the old leader becomes the last member` (packages/server/tests/guilds.test.ts); `kept bug: the abdicate selection survives an exile` (packages/client/tests/guildcenter.test.ts)

### All three factions share one @Faction announcement channel
- **What you notice:** Faction announcements go to a single channel, so members of every faction hear them.
- **In 1.6 and SSO:** 1.6 puts all factions in one @Faction channel. SSO uses one server channel for all faction members: joined at login and on joining, left by the loyalty kick.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`toFactionChannel`)
- **Pinned by:** `Bob gives the head to Angela: power moves, he joins, @Faction hears it` (packages/server/e2e/social.test.ts)

### A faction at power 200 or more gives no bonus
- **What you notice:** Once a faction's power reaches 200, its members' bonus drops to 0.
- **In 1.6 and SSO:** 1.6's bonus table has no row for 200 or more, so the last matching row wins and gives 0. SSO uses the same table.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`factionBonus`)
- **Pinned by:** `kept bug: the faction bonus cascade's last true row wins, so 200 or more gives 0` (packages/shared/tests/social/factions.test.ts)

### A faction head is taken and power moved before the join is refused
- **What you notice:** Hand a head to a faction leader and, if you are too weak to join or already in another faction, you still lose the head and the leader's faction still gains power. A head of the leader's own faction is simply taken for nothing.
- **In 1.6 and SSO:** 1.6's server takes the head and moves the power before the client decides whether you may join. SSO does it in the same order.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`giveHead`), `packages/server/src/systems/economy/quests.ts` (`questGive`)
- **Pinned by:** `kept bug: a refused joiner's head still moves the power` (packages/server/tests/factions.test.ts); `turn-in: own head wasted; a rival head moves 1 power when the rival has any` (packages/shared/tests/social/factions.test.ts)

### An exile on death does not remove you from the faction channel
- **What you notice:** If a death exiles you from a faction, you keep hearing its announcements until you log in again.
- **In 1.6 and SSO:** 1.6's exile path never leaves the channel. SSO does the same.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`exileAtDeath`)
- **Pinned by:** `kept bug: exile below the line after the penalty; the channel is kept` (packages/server/tests/factions.test.ts)

### Assassin points are the victim's raw rating at equal ratings or 1800+
- **What you notice:** A kill between equal ratings, or where the deciding rating is 1800 or more, scores the victim's plain rating.
- **In 1.6 and SSO:** 1.6's comparison has no row for those cases, so the score falls through to the raw rating. SSO computes the same mapping on the server, with the killer's rating as it stands and the victim's after the death penalty.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`compareAss`, `killPoints`)
- **Pinned by:** `kept bug: equal ratings, or a deciding rating of 1800 or more, pay the victim's raw rating` (packages/shared/tests/social/assassin.test.ts)

### Assassin tables ignore ties and never award a fourth prize
- **What you notice:** A score equal to any table entry never makes the table, even when there are empty slots below. Only prizes 1 to 3 are ever given.
- **In 1.6 and SSO:** 1.6 ranks with strict comparisons, and empty slots and your own blanked entry count as 0. SSO does the same for both the current and the all-time table. The prize setting keeps a fourth line that is never given.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`rankEntry`, `prizesGiven`)
- **Pinned by:** `kept bug: a score equal to any entry never ranks, even with empty slots below` and `the archive's prizes; 1-3 given, a blank stops the rest, the fourth is never given` (packages/shared/tests/social/assassin.test.ts)

### Tying an Assassin score leaves the old, lower table entry
- **What you notice:** If your new total ties someone's entry, the table keeps your old, lower total. For example with Bob 40 and Alice 30, Alice reaches 40 and the table still shows Alice 30. The score line still prints.
- **In 1.6 and SSO:** 1.6 blanks your own entry only in the copy it ranks, and a tie never ranks, so nothing is rewritten. SSO does the same.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`rankEntry`)
- **Pinned by:** `kept bug: a tied score leaves the player's old entry (Bob 40, Alice 30 → Alice 40 is not written)` (packages/shared/tests/social/assassin.test.ts); `kept bug: a tied total leaves the old table entry, though the line still prints` (packages/server/tests/assassin.test.ts)

### Lightning kills still flag the killer as wanted
- **What you notice:** In a Lightning game, a one-hit kill makes the killer wanted and pays the Assassin points, even though the death carries no penalties.
- **In 1.6 and SSO:** 1.6's penalty-free Lightning death still sends the wanted flag and the score. SSO does the same: the flag and the points come at the end of the victim's death lock.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`scoreKill`)
- **Pinned by:** `kept bug: the kill still flags the killer and pays 10, after the death line` (packages/server/tests/assassin.test.ts)

### Killing a wanted player never flags you; other kills always do
- **What you notice:** Killing someone who is already wanted does not make you wanted. Any other kill does, on any map, whether or not the PvP flag is on. A death in an arena never flags anyone.
- **In 1.6 and SSO:** 1.6 flags the killer only when the victim is not wanted and was last hit by a player. SSO applies this on the server to resolved kills, credited by player.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`)
- **Pinned by:** `kept bug: killing a wanted player never flags the killer`; `an arena death never flags` (packages/server/tests/factions.test.ts)

### A Warrior who joined at 50-59 hit points is exiled at the next death
- **What you notice:** Join the Warriors with 50 to 59 maximum hit points and your next death throws you out.
- **In 1.6 and SSO:** 1.6 lets anyone with more than 49 join, but its Warrior exile line is below 60, checked at every death outside an arena. SSO does the same.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`exileAtDeath`, `joinFaction`)
- **Pinned by:** `kept bug: a Warrior who joins at 50-59 HP is exiled on the next death` (packages/shared/tests/social/factions.test.ts)

### Faction leader and quest lines lack their closing quote
- **What you notice:** The three lines a faction leader says, and a quest giver's "Bring me a…" line, end without the closing quote mark, and "Sorry but I don't need anything right now" has no full stop.
- **In 1.6 and SSO:** 1.6 left these texts that way. SSO uses the same texts.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`sayFaction`), `packages/shared/src/rules/economy/quests.ts` (`sayQuest`)
- **Pinned by:** `kept bug: faction leader lines lack their closing quote`; `kept bug: quest reply audience differs by NPC slot; no closing quote` (packages/shared/tests/social/factions.test.ts)

### Closing your own bio strips its periods and semicolons
- **What you notice:** Closing your own Bio window removes periods and semicolons from your profile text, even if you did not edit it. A colon or slash that remains refuses the save with "You can't have a : in your profile!" (or the same with a slash).
- **In 1.6 and SSO:** 1.6 saves the box on close, deleting each of those characters in a single forward pass, so of two adjacent ones the second survives. SSO does the same on the server when your own bio closes.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`saveProfile`), `packages/server/src/systems/social/bios.ts` (`profileSave`)
- **Pinned by:** `periods and semicolons are lost on every close` and `one forward pass: of two adjacent characters the second survives` (packages/shared/tests/social/friends-bios-medals.test.ts); `the strip, then the write` (packages/server/tests/friends.test.ts)

### Bio medal slots 11-14 keep the previous bio's medals
- **What you notice:** Look at one bio and then another with fewer medals, and the last four medal slots still show the earlier bio's medals.
- **In 1.6 and SSO:** 1.6 clears only the first ten of the strip's fourteen slots before drawing, and the image persists between bios. SSO does the same in the page's Bio window.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`medalStrip`), `packages/client/src/ui/bio.ts` (`medalStrip`)
- **Pinned by:** `kept bug: each bio clears slots 1-10 and draws from slot 1; slots 11-14 keep the last bio's medals` (packages/shared/tests/social/friends-bios-medals.test.ts); `kept bug: slots 11-14 keep the previous bio's medals` (packages/client/tests/friends-bio.test.ts)

### The bio score leaves out eight skills
- **What you notice:** A bio's score does not count Lumberjacking, Archery, Blessing, Musicianship, Illusion, Punch, Fire or Wind. Hit points and spell points do count, and there is no cap.
- **In 1.6 and SSO:** 1.6's second sum line assigns to a misspelt variable, so those eight skills never count. SSO uses the same sum, on the server.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`bioScore`)
- **Pinned by:** `kept bug: the score drops the eight skills of the misspelt-variable line` (packages/shared/tests/social/friends-bios-medals.test.ts)

### Removing a friend fails from the 190th name on
- **What you notice:** Removing a name past the 189th on your friends list fails with "*** <name> is not on your friend's list!".
- **In 1.6 and SSO:** 1.6 searches only the first 190 list items and the first is an empty piece, so only the first 189 names can be removed; the rebuild keeps the first 200 items. SSO does the same on the stored list.
- **In the code:** `packages/shared/src/rules/social/buddies.ts` (`buddyRemove`)
- **Pinned by:** `kept bug: removing a buddy finds only items 1-190, so the 190th name and later cannot go` and `a removal rebuilds from items 1-200 only: names past the 199th are dropped` (packages/shared/tests/social/friends-bios-medals.test.ts)

## spells

### Spell clicks work outside the playfield
- **What you notice:** you can cast a spell by clicking slightly outside the playfield, in the margin around it, because the accepted area is larger than the playfield.
- **In 1.6 and SSO:** casts are accepted a few pixels beyond the playfield rectangle. SSO's server accepts cast points in the same original area.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`inCastBounds`), `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `cast bounds 8 < H < 580, 5 < V < 420` (packages/shared/tests/spells/spells.test.ts); `kept bug: the spell click area is larger than the playfield [30,31,574,415]: the server takes 8 < H < 580, 5 < V < 420` (packages/server/tests/spells.test.ts)

### Fireball and Wind Wave never get their school bonus
- **What you notice:** casting Fireball or Wind Wave does not get the extra power that Fire or Wind skill should give.
- **In 1.6 and SSO:** the spell is renamed to its directional form before the power code checks for the school, so the checks for "Fireball" and "wind wave" never match. SSO works out spell power in the same order.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spellPower`)
- **Pinned by:** `kept bug: Fireball and Wind Wave never get the school bonus, they are renamed first` (packages/shared/tests/spells/spells.test.ts)

### Bolt and Wind Wave casts never train their school skill
- **What you notice:** casting Bolt or Wind Wave does not raise the matching school skill. A fireball from the Fire Staff or the Firesword, which costs you nothing, does raise Magery and Fire.
- **In 1.6 and SSO:** the skill-gain step is given the directional name ("BoltR", "Wind waveR") and compares it for an exact match, so those two never match. A fireball name contains "Fireball", so the staff and sword fireballs do match. SSO feeds the directional name to the skill-gain step, and the staff and sword fireballs run it too.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spellImp`); `packages/server/src/systems/spells/cast.ts` (`swingFireballs`)
- **Pinned by:** `kept bug: Bolt and Wind Wave never raise their school; they arrive as BoltR, Wind waveR`; `kept bug: a Fire Staff or Firesword fireball trains Magery and Fire: contains 'Fireball'` (packages/shared/tests/spells/spells.test.ts)

### Armour and Magic Shield never reduce spell damage
- **What you notice:** Magic Shield still shows its message and runs its counter, but armour and Magic Shield do nothing to the damage a spell deals.
- **In 1.6 and SSO:** the spell defense lookup only changes a copy of the value, and its callers ignore the result. It still makes one draw out of 3. SSO makes the draw and applies no reduction.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`playerSpellAmount`)
- **Pinned by:** `kept bug: the spell-defense lookup is a no-op, so armour never lowers spell damage` (packages/server/tests/spells.test.ts)

### Standing in a Whirlwind drains 1 SP every frame
- **What you notice:** while you overlap a Whirlwind your SP drops by 1 on every frame, with no blink to give you a breather.
- **In 1.6 and SSO:** the Whirlwind starts no hit blink, though the whole collision test waits while a blink from something else is running, so another hit pauses the drain. SSO drains once per tick of overlap under the same blink gate.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept bug: Whirlwind drains 1 SP a frame of overlap, no flicker` (packages/server/tests/spells.test.ts)

### Hold roots players even where PvP is off
- **What you notice:** a Hold spell roots a player on a map where player fighting is off.
- **In 1.6 and SSO:** the Hold branch checks only for a vehicle and for the caster. On safe maps SSO differs: Hold cannot target players there (see the divergence list).
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept bug: Hold ignores PvP flags: it roots a player where PvP is off` (packages/server/tests/spells.test.ts)

### Your own harmful spell shields you from other spells
- **What you notice:** while one of your own harmful spells is overlapping you, other spells that should hit you in the same frame can be skipped.
- **In 1.6 and SSO:** a spell that belongs to you, or one blocked because PvP is off, stops the whole spell collision check for you. So do Morph, Nature Shift and Smoke Bomb in a vehicle or as a boss, and Hold in a vehicle or on its caster. Spell effects are checked in slot order, each taking the lowest free slot when placed, so a newer spell can be checked before an older one. SSO takes the lowest free slot number with no cap, checks in slot order, and the first such exit ends your collision for that tick.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`); `packages/server/src/systems/spells/fx.ts` (`freeSlot`)
- **Pinned by:** `kept bug: your own harmful spell exits the whole collision, shielding you from later FX` (packages/server/tests/spells.test.ts); `Morph and Hold do nothing to a rider; Dispel keeps the airship` (packages/server/tests/vehicles.test.ts)

### A spell that fails still makes you wait the cast delay
- **What you notice:** if a cast is refused for any reason, you still wait out the cast delay before the next one.
- **In 1.6 and SSO:** the delay is set before the checks for map visibility, harmful spells, an empty selection, SP and crystals. SSO checks in the same order, so a cast during a map load or the death lock, or with an empty line selected, costs the delay too.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `kept bug: the delay is set before every later check; an empty selection costs it` (packages/server/tests/spells.test.ts)

### Some spells cost SP and crystals but do nothing
- **What you notice:** Poison Dart, Weaken, Bless, Haste, Replenish and Holy Weapon take their SP cost and crystals, and then nothing happens and nothing is drawn.
- **In 1.6 and SSO:** these spells have costs but no effect or visual. SSO does the same.
- **In the code:** `packages/shared/src/rules/spells/spellfx.ts` (`placeFx`)
- **Pinned by:** `kept bug: dead spells cost SP and crystals and show nothing: Bless` (packages/server/tests/spells.test.ts)

### Casting a buff again stacks it
- **What you notice:** casting Stone Skin, Argon's Fist or Magic Shield again before the first ends adds to the bonus and the time. Hold and Firesword are different: recasting only refreshes them.
- **In 1.6 and SSO:** Stone Skin adds 1 to the defense bonus and 30 times its power to the counter, Argon's Fist adds 400 to its counter, and Magic Shield adds 70 times its power. All reset only when the counter reaches 0. Hold (8 times its power) and Firesword (40 times its power) are set rather than added. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`); `packages/server/src/systems/spells/buffs.ts` (`holdDefenseStep`, `swordShieldStep`)
- **Pinned by:** `Stone Skin stacks: the defense bonus + 1 and its counter + P·30, then back to 0`; `kept bug: Firesword without a sword: the warmth line, no counter; a recast refreshes P·40` (packages/server/tests/spells.test.ts)

### A Radar spell on you prints a line every frame
- **What you notice:** standing in someone's Radar effect fills your chat with a line each frame, up to 5 lines in SSO.
- **In 1.6 and SSO:** the Radar effect matches on each of its 10 animation frames and sends a chat line each time. In SSO the effect advances two steps per frame, but the collision test runs once per frame, so it sees every second frame and you get up to 5 lines instead of 10.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`); `packages/shared/src/rules/spells/spells.ts` (`radarText`)
- **Pinned by:** `kept bug: Radar on a player sends a line every frame of overlap, up to 10; the FX flies twice as fast, so 5` (packages/server/tests/spells.test.ts)

### Meteor can only hit a monster once, not twice
- **What you notice:** a Meteor hits a monster on one frame only, though it was set up to hit on a second one.
- **In 1.6 and SSO:** monsters are hit on the Meteor's frames 13 and 19, but the first hit sets a 16-frame lockout that the second frame falls inside. SSO has the same lockout.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`monsterHits`)
- **Pinned by:** `kept bug: Meteor's second hit frame (19) falls inside the first's 16-frame lockout` (packages/server/tests/spells.test.ts)

### A summon with no free monster slot fails silently after you paid
- **What you notice:** if all four monster slots on the map are full, a summon spell does nothing and says nothing, but your SP and crystals are gone.
- **In 1.6 and SSO:** the summon script exits when all the monster sprites are occupied, after the cost was taken. SSO's summons take a free roster slot and fail silently, after payment, when all four are full.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`summon`)
- **Pinned by:** `kept bug: with four live monsters the summon fails silently, paid for` (packages/server/tests/spells.test.ts)

### Two spell books ask for the wrong Dexterity
- **What you notice:** the Argon's Fist Book needs only Dexterity 1, and only an exact "Bolt Book" needs 24.
- **In 1.6 and SSO:** the table misspells "Argon's First" and tests it with "contains", and matches "Bolt Book" exactly. SSO keeps the same table.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`bookDex`)
- **Pinned by:** `kept bug: the Dex table's typos: Argon's Fist Book needs 1, only an exact Bolt Book needs 24` (packages/shared/tests/spells/spells.test.ts)

### Your spellbook keeps 29 lines and loses Identify
- **What you notice:** a spellbook past 29 lines loses the extra spells when saved, and a learned Identify spell vanishes the first time the list is reloaded.
- **In 1.6 and SSO:** the save writes at most 29 lines, and Identify has no saved form. The list is rebuilt from the save before each save and learn and on every click of the spell list. In SSO the server stores only the saved form and trims the live list at each save, and the client trims its list on a click.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`SPELLBOOK_SAVE_LINES`, `savedSpellbook`); `packages/client/src/ui/spellbook.ts` (`createSpellbook`)
- **Pinned by:** `kept bug: savespells keeps 29 lines and drops Identify` (packages/shared/tests/spells/spells.test.ts); `kept bug: a click reloads the list from the save first, so a learned Identify drops out` (packages/client/tests/spells.test.ts); the bot relog test (packages/server/e2e/spells.test.ts)

### Portal takes its cost, then refuses near any player, you included
- **What you notice:** casting Portal near any player is refused, and so is casting it near yourself, after your SP and crystals have already been spent.
- **In 1.6 and SSO:** the cost is taken before the Portal test, and the test loops over all the player sprites, including the caster's own. SSO keeps that order and counts the caster.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `kept bug: Portal is refused near any player, the caster too, after SP and crystals are spent` (packages/server/tests/spells.test.ts)

### Wearing a body armour named "Ninja" makes Smoke Bomb uncastable
- **What you notice:** with a body item named exactly "Ninja", Smoke Bomb costs nothing and cannot be cast at all.
- **In 1.6 and SSO:** the Smoke Bomb cost is 25 only when the body is not "Ninja". A body named exactly "Ninja" leaves the required SP at 0, which makes the cast exit. SSO does the same.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spCost`)
- **Pinned by:** `kept bug: Smoke Bomb costs 0 in a body named exactly "Ninja", so it cannot be cast` (packages/shared/tests/spells/spells.test.ts)

### Some books teach nothing, and some are used up anyway
- **What you notice:** the Radar and Haste books teach nothing. A book for a spell you already know is still used up. A Bolt Book can use up an earlier Firebolt Book in your bag. The Poison Dart Book does nothing. A combat book can take a skill up to 82.
- **In 1.6 and SSO:** the book routine has no line for Radar or Haste. The server consumes the book before the routine runs, and takes the first bag item containing "<name>-", so a Bolt Book can use up an earlier Firebolt Book. The Poison Dart Book has no Inventory member, so using it exits. Combat books add 1 plus a draw out of 5 below skill 77, so a skill can reach 82. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/learn.ts` (`readBook`); `packages/shared/src/rules/spells/spells.ts` (`runBook`)
- **Pinned by:** `kept bug: the Radar and Haste books teach nothing`, `kept bug: combat books add 1 + random(5) below 77, so up to 82` (packages/shared/tests/spells/spells.test.ts); `kept bug: reading a Bolt Book can use up an earlier Firebolt Book`, `kept bug: a book is used up when the spell is already known`, `kept bug: the Poison Dart Book has no Inventory member, so using it does nothing` (packages/server/tests/spells.test.ts)

### Firesword does nothing for a player without a sword
- **What you notice:** if the Firesword hits a player whose left hand holds no sword, you see "You feel a warmth you haven't felt before, but feel it has not assisted you." and nothing else happens.
- **In 1.6 and SSO:** when the left hand does not contain "Sword", the spell prints that line and sets nothing. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept bug: Firesword without a sword: the warmth line, no counter; a recast refreshes P·40` (packages/server/tests/spells.test.ts)

### Summon Creature misreads blocked tiles; Raise Dead lands below the grave
- **What you notice:** Summon Creature can think a tile is blocked because a different tile is (x1y1 is blocked by x1y10 to x1y12). Raise Dead puts the Zombie one tile below a grave, whether you clicked the grave or the tile below it. Neither spell checks the no-fight flag.
- **In 1.6 and SSO:** Summon Creature and Holy Shield look for the tile name as a plain piece of text without a closing mark, so a shorter name matches the start of a longer one. Raise Dead always places the Zombie one tile below the grave. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`npcBlockedSubstring`, `summon`)
- **Pinned by:** `kept bug: Summon Creature's blocked test matches part of the tile name: x1y1 is blocked by x1y10`, `kept bug: Raise Dead raises the Zombie on the tile below a grave` (packages/server/tests/spells.test.ts)

### Monster spells heal you, fly at random and miss with PvP off
- **What you notice:** a Passive monster you have not provoked casts its heals and buffs at you, and spells never provoke it. A monster's Fireball flies in a random direction. Harmful monster spells do nothing to you on a map where PvP is off. Any cast by a name containing "18", a player's too, blocks monster spells for a moment.
- **In 1.6 and SSO:** only melee provokes a monster. A monster's Fireball picks one of four directions at random. Monster spells still pass the victim's PvP check. Any cast whose caster's name contains "18" blocks monster spells for 30 frames. SSO does the same for each emulated player.
- **In the code:** `packages/server/src/systems/spells/monsterspells.ts` (`monsterSpells`, `castOne`); `packages/server/src/systems/spells/fx.ts` (`placeQueued`)
- **Pinned by:** `kept bug: an unprovoked Passive Acrostia casts Major Heal at you`, `kept bug: the Snow Serpent's Whirlwind lands on you but drains nothing with PvP off`, `kept bug: a monster's Fireball flies in a random(4) direction from it, not at you`, `kept bug: a player with 18 in the name blocks monster spells for 30 frames` (packages/server/tests/spells.test.ts)

### Killing with a spell says "You have become a more powerful!"
- **What you notice:** when a spell kill levels you up, the line reads "You have become a more powerful!" with a stray "a". A melee kill says "You have become more powerful!".
- **In 1.6 and SSO:** the spell path has its own level-up text, pays the spell XP table and rolls no kill skill gain. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`checkForDead`, `SPELL_LEVEL_UP_TEXT`)
- **Pinned by:** `a spell kill pays the spell XP table and its own level-up line` (packages/server/tests/spells.test.ts)

### Healing spells lift a monster far above its own maximum
- **What you notice:** a spell that heals a monster can take a Pig, which has 1 hit point, up to 200.
- **In 1.6 and SSO:** hit points are capped only after a spell's effects, using a table with a default of 200 and six named exceptions. SSO applies the cap in the same place with the same table.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`checkForDead`); `packages/shared/src/rules/spells/spells.ts` (`MONSTER_HEAL_CAP_DEFAULT`)
- **Pinned by:** `kept bug: a spell heal lifts a Pig far above its 1 hit point and stops at the default cap of 200` (packages/server/tests/spells.test.ts)

### A book is used up even when it teaches you nothing
- **What you notice:** Read a spell book for a spell you already know, or a skill book when your skill is 77 or more, and you are told there is nothing more to learn or that you already know it. The book is gone anyway.
- **In 1.6 and SSO:** The server removes the book before it works out what it teaches, and the client's message comes afterwards. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/learn.ts` (`readBook`)
- **Pinned by:** `kept bug: a book is used up when the spell is already known`; `kept bug: a skill book is used up when the skill is 77 or more and teaches nothing` (packages/server/tests/spells.test.ts)

### After the church bell, channel 5 stays loud
- **What you notice:** after you hear the church bell once, the damage-number sound and any other sound on that channel play louder for the rest of the session, whether or not sound is on.
- **In 1.6 and SSO:** the bell sets channel 5 to volume 200 and nothing resets it. SSO does the same, per client session: the server's sound message carries the volume, and the client sets it before playing, sound on or off.
- **In the code:** `packages/server/src/systems/spells/hazards.ts` (`serverTimer`), `packages/client/src/audio.ts` (`playAll`)
- **Pinned by:** `kept bug: the church bell leaves channel 5 at volume 200, sound on or off` (packages/client/tests/spells.test.ts); `the church bell rings at the 20th run to x999y999, Churchy:5:200` (packages/server/tests/spells.test.ts)

## vehicles

### Dock and arena tests on map rows 10-12 read the wrong field
- **What you notice:** an Airship pad or dock on rows 10 to 12 of a map never counts, so you can't unboard or use the pad there, and an arena tile there gives an ordinary death.
- **In 1.6 and SSO:** the lookup of a tile's record reads fields 10 to 12 for rows 10 to 12 instead of the tile's own. SSO does the same lookup against the raw map record, in one shared function used by the arena test, the Airship deed's pad test and the unboard test. Boat disembark is not built.
- **In the code:** `packages/shared/src/rules/vehicles/vehicles.ts` (`recordTile`)
- **Pinned by:** `kept bug: a J2 pad on rows 10-12 never counts` (packages/shared/tests/vehicles/vehicles.test.ts); `kept bug: a pad on row 10 never counts` (packages/server/tests/vehicles.test.ts); `kept bug: a pad on row 10 never lets you off` (packages/server/tests/vehicles.test.ts)

## world

### A map that isn't there sends you to the start point
- **What you notice:** walk off an edge with no map beyond, or take a bad exit, and you land on the start tile (5,5) of the starting map, and the whole map reloads.
- **In 1.6 and SSO:** a missing map warps to the start point. In SSO that point is whatever the operator has configured, and the old Test map is not shipped. The whole map reloads, as the original's warp did.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`crossMapEdge`)
- **Pinned by:** `kept bug: walking off an edge with no neighbour lands on the start point` (packages/server/tests/world.test.ts); `kept bug: walking off an edge with no map beyond lands on the start point` (packages/server/e2e/login-and-walk.test.ts)

### An administrator warp out of jail leaves its timer counting
- **What you notice:** The jail sentence is 8000 frames (6 minutes 40 seconds) and restarts on each entry to the jail map. An administrator can warp a prisoner out early; the remaining timer counts down elsewhere without a second release. A prisoner dead when the timer expires is still released.
- **In 1.6 and SSO:** The timer counts on any map but releases only on x0y0. SSO keeps this timer behavior and permits administrator warps, but blocks player escapes through Portal, exits, edges and death respawn; see [enforced confinement](divergences.md#seeded-jail-and-enforced-confinement). Release uses the configured start point. Editing pauses the timer.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`jailTick`)
- **Pinned by:** `kept bug: the sentence is jailFrames from every entry, counted anywhere, and releases only on x0y0 to the start point`; `kept bug: leaving the jail any other way ends it: the sentence runs out off x0y0 and releases nobody; going back in restarts it`; `a prisoner dead when the sentence ends is still released: the dead flag never stops the self-warp` (packages/server/tests/admin.test.ts)

### After a hit your own sprite vanishes for a second instead of blinking
- **What you notice:** after a monster hits you, your own character disappears from your screen for about a second (1.0 s measured on the running 1.6) or never blinks at all, instead of blinking. Other players never see it.
- **In 1.6 and SSO:** each call for the player sprite while the hit blink is running flips its visibility and counts it down by 1, showing it again at 0. The game makes two such calls per frame, so the flips cancel: a hit that leaves an odd number of calls in its frame hides the sprite for the whole 20 frames, and one that leaves an even number never shows a blink. In SSO the player's hidden flag flips where the blink counts down, goes only to its owner, and the client does not draw the local player while it is set. A map load and a body revert show the sprite again.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`actorPass`); `packages/client/src/playfield.ts` (`createPlayfield`)
- **Pinned by:** `kept bug: a monster hit in pass 1 hides your sprite for the whole 20 frames, not a blink` (packages/server/tests/monsters.test.ts)

### The seed map and new-map defaults do not save a respawn point
- **What you notice:** until you visit a map that saves a respawn point, death sends you to the server's configured fallback. The seed map and new World Editor maps with their default flags do not save a point. Entering a no-fight, indoor, no-PvP map, such as a Small Farm, Small Shop or guild-hall interior, saves a point that later deaths use, including deaths outdoors. An operator can also set those flags in the World Editor.
- **In 1.6 and SSO:** a respawn point is saved only when you draw a map flagged as no fighting, indoors and no PvP (written O-O-O), and none of the 27 original maps is flagged that way. SSO uses the same rule on the server, respawning at the operator's setting (by default the map x1000y992, tile 5,5; 1.6 used x0y102) unless the character has a saved O-O-O point.
- **In the code:** `packages/server/src/systems/world/world.ts` (`respawn`); `packages/server/src/systems/world/tick.ts` (`respawnPoint`)
- **Pinned by:** `kept bug: the seed map and new-map defaults do not save a respawn point; death without one uses the configured fallback` (packages/server/tests/world.test.ts)

### The jail sentence restarts every time you arrive in jail
- **What you notice:** Logging back in while jailed restarts your sentence, and a login into jail starts it at 10000 frames rather than the configured length.
- **In 1.6 and SSO:** 1.6 resets the timer on every entry to the jail map. SSO does the same, a login included. A login (not a resumed session) uses 10000, the value 1.6 had before its system settings loaded, rather than the jailFrames setting.
- **In the code:** `packages/server/src/systems/world/world.ts` (`enterRoom`, `addPlayer`, `LOGIN_JAIL_FRAMES`)
- **Pinned by:** `kept bug: the sentence is jailFrames from every entry, counted anywhere, and releases only on x0y0 to the start point`; `a login onto x0y0 starts the sentence at 10000 whatever jailFrames says; a resumed session keeps the entry rule` (packages/server/tests/admin.test.ts)

## Not in SSO

### Leftovers of peer-to-peer play

1.6 ran each player's game on their own computer, so it had quirks that cannot exist when the server is in charge. SSO has nothing to keep for these.

- **The airship picture lingered after death.** 1.6 left a dead rider drawn as the airship until each viewer's screen happened to reset it, a 1-in-50 roll per frame. SSO's server resets it for everyone at the moment of death (`packages/server/src/systems/vehicles/airship.ts`, `vehicleDeath`).
- **Other players' steps were batched through a relay queue.** 1.6 sent a step directly only when exactly one other player was present; with two or more it relayed steps in 350 ms batches, duplicating some and dropping others when the queue was long. SSO's server broadcasts each step in the tick it happens, so nothing is needed.
- **Sprite-slot miscounts in the player and monster lists.** 1.6 counted players, blocked tiles and clicked names by reading fixed sprite slots, and a few slots were miscounted or wired to the wrong name field. SSO has no sprite slots, so nothing is needed.
- **The warp's input lock sat in a local variable.** 1.6 set its keyboard lock for a warp in a variable that did nothing outside that one routine; it was harmless because the hidden playfield blocked moves anyway. SSO's server holds a loading lock while you change map, so nothing is needed.
- **Several admin commands misbehaved in small ways.** 1.6 warped an admin twice for some flag pairs, showed location and IP lookups twice to someone flagged both immortal and moderator, needed an extra server access level to kick, overwrote the admin's own IP during a lookup, left a kick reply with no handler, stacked the banned prefix on repeated bans, made a file for a ban on a name that does not exist, and left stray `**` gaps in the IP ban list. SSO has a single role check and the server does the kicking and banning, so none of this exists.
- **Each screen kept its own monster hit points.** 1.6 had every client apply melee damage and roll spell damage to its own copy of a monster's hit points, so the copies drifted apart and two players could each be awarded the kill. SSO has one authoritative monster, one roll and one killer.
- **Each client rolled monster attacks against itself.** 1.6 had every client roll monster attacks and spells against its own player. SSO's server rolls once per monster and player pair, with the same probabilities.
- **A twelfth spell effect cancelled an older one.** 1.6 had eleven spell-effect sprite slots; with all busy, a new spell reused the first and cancelled the old effect. SSO has [no such cap on effects](divergences.md#no-11-spell-fx-cap).
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

- **The boat tile-collision bypass was never reachable.** 1.6 had code that let a boat skip tile collision, but no boat could be had: the deeds exit when used, no NPC sells one and the art for them is missing. SSO does the same and does not build boats.
- **The elemental orb war never worked.** 1.6 was designed so that an orb dropped on an elemental platform shifted the balance of power between the four mage classes, but nothing connected it: no platform existed, nothing saved the balance and no monster dropped an orb, so an orb dropped as an ordinary item. SSO does the same and does not build the war; it is a candidate to build after release.
- **Pinned by:** `orb drop: a Water Orb lands on the floor like any item`; `orb drop: an orb goes into a container on the faced tile`; `orb drop: aboard an Airship "You can't drop this from the sky!"` (packages/server/tests/pigs-orbs-webs.test.ts)
