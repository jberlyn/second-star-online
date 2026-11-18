# Inventory

## What happens in play

A player picks up a pile, equips a weapon, and later gives an item to someone nearby. The server applies each action to its own state.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/inventory/items.ts](../../packages/server/src/systems/inventory/items.ts): handles item use, equipment, ground items and delayed gives.
- [packages/shared/src/rules/inventory/equip.ts](../../packages/shared/src/rules/inventory/equip.ts): checks equipment and item use.
- [packages/shared/src/rules/inventory/ground.ts](../../packages/shared/src/rules/inventory/ground.ts): defines ground item blocking, pictures and pickup gates.
- [packages/shared/src/rules/inventory/inventory.ts](../../packages/shared/src/rules/inventory/inventory.ts): defines bags, stacking and equipment slots.
- [packages/shared/src/rules/inventory/paperdoll.ts](../../packages/shared/src/rules/inventory/paperdoll.ts): selects character appearance layers.

Entry points:

- `packages/shared/src/rules/inventory/inventory.ts` (`invAdd`).
- `packages/shared/src/rules/inventory/equip.ts` (`checkEquip`).
- `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `dueGives`, `decayLoot`).

## How it works

A bag has ordered slots and quantities; additions stack where the rules permit and unique containers carry IDs. Equipment matching and its checks run in order. Using an item can consume it or hand the action to another system. The server checks and applies equip, drop and pickup requests, and a give can be delivered after a delay.

Ground items have blocking and drawing rules distinct from bag entries. Monster loot can decay on the ground. Paperdoll rules select layers for equipment and animation frames; they describe appearance rather than changing the bag. The unreachable orb game remains omitted. Inventory and ground state are saved through [inventory persistence](../../packages/server/src/persistence/inventory.ts) and [ground persistence](../../packages/server/src/persistence/ground.ts).

### Bag, equipment and use

The bag has 15 lines. Ordinary items stack by case-insensitive exact name or use the first empty line; gold piles increase gold instead. Containers needing individual storage get IDs, including cauldrons. Equipping derives the slot from the item name and checks requirements before moving one item; an item already in that slot goes back into the bag, so the swap needs room for it. Name rules are ordered and the last matching rule can determine the slot or strength requirement. Item use applies its effects and consumes items according to their rules, with special items delegated to other systems. [Item rules](../../packages/data/content/item-rules.json) contain the editable matching data.

### Ground and transfers

Dropping puts an item on the faced tile after the action's checks; ordinary items share a tile up to a cap, and a tile holding something that stands in the way is too crowded. Giving a normal item creates a ground item at the target and schedules its grab 60 frames later; gold, crystals and NPC hand-ins follow their own routes, and the crystal dialog drops or gives by the bag button that opened it. Pickup checks the current map, position and item before moving that one item to the bag. A click uses a thing that does something (opens a crate, plays a casino table, views a painting) and Ctrl carries off the ones that can be moved; a blocking fixture the world placed is never picked up. Ctrl, like every other item action, waits while a window holds the keys. The server records ground changes for persistence and removes expired monster loot on its decay step. Ground objects that block players block monsters too.

The paperdoll combines body, head and equipment layers for the current frame and facing; boots are drawn over the body from authored layers, and an absent layer is skipped. Ground pictures and their draw layers are selected by shared name rules, independently of collision.

## Kept bugs and differences

The inventory has no kept bugs. The server checks adjacency and the actual bag slot for item transfers.

See the [inventory differences](../divergences.md#inventory) for the specific player-visible cases, including every inventory bug SSO fixed.

