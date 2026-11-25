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
- [packages/shared/src/content/worn.ts](../../packages/shared/src/content/worn.ts): which layer a worn item draws and which frames the renderer asks a layer for (uploaded worn sets, issue #29).

Entry points:

- `packages/shared/src/rules/inventory/inventory.ts` (`invAdd`).
- `packages/shared/src/rules/inventory/equip.ts` (`checkEquip`).
- `packages/server/src/systems/inventory/items.ts` (`pickupIntent`, `dueGives`, `decayLoot`).

## How it works

A bag has ordered slots and quantities; additions stack where the rules permit and unique containers carry IDs. Equipment matching and its checks run in order. Using an item can consume it or hand the action to another system. The server checks and applies equip, drop and pickup requests, and a give can be delivered after a delay.

Ground items have blocking and drawing rules distinct from bag entries. Monster loot can decay on the ground. Paperdoll rules select layers for equipment and animation frames; they describe appearance rather than changing the bag. The unreachable orb game remains omitted. Inventory and ground state are saved through [inventory persistence](../../packages/server/src/persistence/inventory.ts) and [ground persistence](../../packages/server/src/persistence/ground.ts).

### Bag, equipment and use

The bag has 15 lines. Ordinary items stack by case-insensitive exact name or use the first empty line; gold piles increase gold instead. Containers needing individual storage get IDs, including cauldrons. Equipping derives the slot from the item name and checks requirements before moving one item; an item already in that slot goes back into the bag, so the swap needs room for it. Name rules are ordered and the last matching rule can determine the slot or strength requirement. Item use applies its effects and consumes items according to their rules, with special items delegated to other systems. [Item rules](../../packages/data/content/item-rules.json) contain the editable matching data. An item can instead carry an [item definition](../modding.md#item-definitions) (`items.json` `definitions`, edited on the Control Panel's Items page): `compileDefinitions` in [definitions.ts](../../packages/shared/src/content/definitions.ts) turns it into exact rows for that item and marks the pack's rows that matched it with `except`, which every reader honours through `ruleMatches` (the break lists and `ID_CONTAINERS` test `excepted` themselves). The rules read the compiled tables, so they need no change for a defined item.

### Ground and transfers

Dropping puts an item on the faced tile after the action's checks; ordinary items share a tile up to a cap, and a tile holding something that stands in the way is too crowded. Giving a normal item creates a ground item at the target and schedules its grab 60 frames later; gold, crystals and NPC hand-ins follow their own routes, and the crystal dialog drops or gives by the bag button that opened it. Pickup checks the current map, position and item before moving that one item to the bag. A click uses a thing that does something (opens a crate, plays a casino table, views a painting) and Ctrl carries off the ones that can be moved; a blocking fixture the world placed is never picked up. Ctrl, like every other item action, waits while a window holds the keys. The server records ground changes for persistence and removes expired monster loot on its decay step. Ground objects that block players block monsters too.

The paperdoll combines body, head and equipment layers for the current frame and facing; boots are drawn over the body from authored layers (bare feet when none are worn, covering the shoes every body paints), and an absent layer is skipped. The north frames reach the atlas already flipped the right way round (the art library's `packages/data/src/art/mirror.ts`), so drawing needs no special case for them. `paperdollLayersWith` takes the aliases and behaviours as data, so the Pictures & Sounds page and the publish checks stack a draft's layers exactly as the renderer will once it is published; the frames a layer needs are found by asking it frame by frame. Ground pictures and their draw layers are selected by shared name rules, independently of collision.

## Differences from 1.6

The server checks adjacency and the actual bag slot for item transfers. See the [inventory bugs fixed](../differences-from-fso.md#inventory) and [server-side inventory changes](../differences-from-fso.md#server-side-inventory).
