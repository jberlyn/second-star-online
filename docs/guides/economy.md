# Economy

## What happens in play

Two players exchange offers, which either can change until the trade is done; once both offers are in, both accept. The server checks the items and gold before settling.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/economy/bank.ts](../../packages/server/src/systems/economy/bank.ts): parses and applies bank commands.
- [packages/server/src/systems/economy/containers.ts](../../packages/server/src/systems/economy/containers.ts): handles named containers, including house and guild vault access and contents.
- [packages/server/src/systems/economy/intents.ts](../../packages/server/src/systems/economy/intents.ts): routes shop, bank, class-trainer and NPC gold actions.
- [packages/server/src/systems/economy/playershop.ts](../../packages/server/src/systems/economy/playershop.ts): manages player shopkeepers and stock.
- [packages/server/src/systems/economy/quests.ts](../../packages/server/src/systems/economy/quests.ts): handles quest items and requests.
- [packages/server/src/systems/economy/shop.ts](../../packages/server/src/systems/economy/shop.ts): maintains NPC shop ledgers and transactions.
- [packages/server/src/systems/economy/trade.ts](../../packages/server/src/systems/economy/trade.ts): locks and settles player trades.
- [packages/server/src/systems/economy/vault.ts](../../packages/server/src/systems/economy/vault.ts): handles personal vault deposits and withdrawals.
- [packages/shared/src/rules/economy/playershop.ts](../../packages/shared/src/rules/economy/playershop.ts): parses shop commands and rewrites stock.
- [packages/shared/src/rules/economy/quests.ts](../../packages/shared/src/rules/economy/quests.ts): defines quest matching and rewards.
- [packages/shared/src/protocol/economy.ts](../../packages/shared/src/protocol/economy.ts): the NPC click, shop, trainer, vault and trade messages.
- [packages/server/src/persistence/playershops.ts](../../packages/server/src/persistence/playershops.ts): stores which shopkeeper belongs to whom and the interior it stands in.
- [packages/client/src/ui/shop.ts](../../packages/client/src/ui/shop.ts) and [packages/client/src/ui/trade.ts](../../packages/client/src/ui/trade.ts): draw the shop and trade windows.

Entry points:

- `packages/server/src/systems/economy/intents.ts` (`buyIntent`, `sellIntent`, `trainIntent`).
- `packages/server/src/systems/economy/trade.ts` (`offerTrade`, `acceptTrade`).
- `packages/server/src/systems/economy/shop.ts` (`npcBuy`).
- `packages/shared/src/rules/economy/playershop.ts` (`parseShopCommand`).

## How it works

NPC shop transactions use server-held ledgers, validate stock and prices, and update the player's holdings. Every shopkeeper has a till: its `GLD|` line wherever it sits in the file, or 0 without one. Purchases and gifts fill it, and sales pay from it (an empty till refuses). Bank commands move gold between purse and bank. Vault and container operations check the relevant access and capacity; player shops have commands for their stock and prices.

For player trades, either player may resend an offer, which clears both acceptances; the trade settles on the second Accept. Settlement checks both holdings and available bag space before applying the exchange; leaving or changing maps cancels the trade. Giving gold to an NPC and giving quest items use separate routes. Persistence for economy and containers lives in [economy persistence](../../packages/server/src/persistence/economy.ts) and [container persistence](../../packages/server/src/persistence/containers.ts).

### NPC shops and storage

Opening a shop uses the NPC whose bio was opened and requires that NPC to remain on the map roster. A purchase or sale identifies a server-owned ledger line: the server takes its item, stock and price from that line, checks the player's holdings and updates both sides. The ledger starts from the NPC file's sale, buy and gold lines. Gold given to an NPC has a separate handler. A Small Shop creates a shopkeeper; the owner's spoken commands rewrite stock and prices while preserving its current till and stock. A player shop may sell only the items on the `playerShopWhitelist` (the Control Panel's **Items → Shop and editor lists** tab). A save on the **Creatures & NPCs → Talk & Shops** tab resets the ledger from the edited file. A trainer's `TRN|` line sells a class promotion through the same window (`trainIntent`; see [progression](progression.md)).

Bank commands operate on the speaker's own character account and require a living banker on the map. A personal vault holds 15 lines. House vaults are for their owner, guild vaults for guild members, carried containers for their carrier, and other placed containers for someone facing them. Quest chests are shared by type and gain an item on the save clock when they have room (`saveClockStep`). A container's capacity comes from the item rules' `containers.capacity` rows by name, the last match winning (`containerCapacity`). Access and capacity checks occur when a player uses storage; an open storage window holds the keys until Cancel, and Drop puts items into it.

After a buy or sale, the [game dispatcher](../../packages/server/src/game.ts) flushes changed holdings immediately. Its persistence transaction writes changed player inventories and dirty banks and personal vaults together with dirty shop ledgers and named containers. Inventory writes use [inventory persistence](../../packages/server/src/persistence/inventory.ts). Sending a trade offer only changes the in-memory session; accepting a trade flushes both participants' changed holdings together after settlement.

### Trading and quests

The initiator opens a trade, sends an offer, and thereby opens the recipient's window. Either player can send or resend an offer, which clears both acceptances, and the trade happens only once both press Accept. The server checks the partner is still on the same map, verifies both offers against current holdings and tests whether the resulting bags fit before applying the transfer. Cancel, departure or a map change ends the session. Quest hand-ins use the NPC on the map and server quest rows, then give a reward or response through the quest rules. The quest pools, a new world's quests, the quest chest and the NPCs' quest replies are edited on the Control Panel's **Quests** page.

## Differences from 1.6

Free goods, unpaid sales, the line-17 deed, locked trade offers, lossy storage and player-shop rewrites, substring quest matching and more are fixed. Server checks prevent a third player taking over a trade.

See the [economy bugs fixed](../differences-from-fso.md#economy) and [server-side economy changes](../differences-from-fso.md#server-side-economy).
