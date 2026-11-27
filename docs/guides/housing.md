# Housing

## What happens in play

Using a deed enters placement mode; the player chooses a location and the server checks whether the house can be built there.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/housing/doors.ts](../../packages/server/src/systems/housing/doors.ts): handles keys, switches and relocking.
- [packages/server/src/systems/housing/houses.ts](../../packages/server/src/systems/housing/houses.ts): handles placement, house clocks and demolition.
- [packages/shared/src/rules/housing/doors.ts](../../packages/shared/src/rules/housing/doors.ts): defines key, door and switch rules.
- [packages/shared/src/rules/housing/houses.ts](../../packages/shared/src/rules/housing/houses.ts): defines placement, house plans and decay.
- [packages/client/src/ui/placement.ts](../../packages/client/src/ui/placement.ts) and [packages/client/src/ui/house-art.ts](../../packages/client/src/ui/house-art.ts): draw the placement preview, and upload one on the House types form.

Entry points:

- `packages/shared/src/rules/housing/houses.ts` (`checkPlacement`, `planHouse`, `sweep`).
- `packages/server/src/systems/housing/houses.ts` (`useDeed`, `placeHouseIntent`, `monthCheck`, `demolish`).
- `packages/server/src/systems/housing/doors.ts` (`useKey`, `switchClick`, `relockStep`).

## How it works

The deed determines the house type and placement preview. Placement checks terrain and obstacles, then the house plan creates an interior and its map name. Owner and guild checks control relevant house actions; house refresh and decay run over time, and resting restores resources. Guild halls have placement and guild requirements. The original land system was inactive and is omitted.

Keys and switches affect matching doors, with relocking handled on ticks. House containers and vaults hand off to economy, while mailboxes and boards use their own systems. The server validates changes instead of accepting arbitrary map edits. House records are stored through [house persistence](../../packages/server/src/persistence/houses.ts).

### Placement and records

Using an eligible deed starts placement; a deed whose `use` is `nothing` says its text and is kept (the Classic pack has none), and the vehicle deeds build their vehicles instead (see [vehicles](vehicles.md)). The house type's anchor offsets place its footprint relative to the hovered tile. Classic types start one column left and one row up. The placement checks run in order: map edges, terrain (in Classic, every footprint tile must be 8R, 8U or 8V on layer 1 and G3 on layer 2), overlap (anything standing on a footprint tile, the builder included), available exit slots and guild requirements. A refusal leaves placement active. On success the server creates the outdoor exit and items, creates the interior, consumes the deed, changes eligible tiles and records the blueprint and house list before refreshing the map. If interior creation fails, the preliminary map changes are rolled back. House types and their sizes come from [house content](../../packages/data/content/houses.json).

While placing, the client draws the house type's placement preview over the hovered tile. A Classic house draws its built-in `Houses` picture (`ghost.member`, placed by the type's anchor and shift). A type with `ghost.picture` draws that item picture instead, with its anchor on the footprint's top-left corner (`ghostPicturePoint`). On the Control Panel, **Houses & Vehicles → House types** has a Placement preview panel above each type's form: it uploads a PNG drawn 32 pixels to a tile, starts it with its bottom-left on the building's bottom-left so a taller picture rises above it, and saves the picture (an `art/items` row named `<house> (placement)`) and the type's `ghost.picture` to the draft together. A publish that would take that picture away while a house type still names it is refused. With this, a new house type (a third guild hall, say) is all content: the type, its deed row, its deed item and picture, its tiles on **Pictures & Sounds → Tiles**, and the deed in an NPC's shop on **Creatures & NPCs → Talk & Shops**. Footprints are 3 or 5 tiles wide and 3 tall.

The shared map helpers generate the interior name from the outdoor coordinates and selected exit slot. Ownership and guild information are used for the room's drop and access rules; vaults use the economy system, while mailboxes and boards use mail and board persistence. Each house has its own blueprint and list entry, named by its interior. A guild hall's blueprint also names its guild by id; the hall is the guild's, not its builder's (see [social](social.md)). A login and each online player's clock check refresh that player's houses, and every hall of their guild, to this month (`YYYY-MM`); the first clock check of each day runs the decay sweep, which demolishes each house whose last refresh was two or more calendar months ago. Demolition removes the house's tiles, exit, mailbox or street lamp, interior and vault, and updates the map at once; a hall's demolition leaves its builder's House Vault, and its guild's vault stays while the guild does. Disbanding a guild demolishes every hall it has and empties its Guild Vault (the Disband button warns first, and refuses while the vault holds items; `demolishHalls` in `packages/server/src/systems/social/guild-halls.ts`). At start, a hall built before halls named their guild is matched to it by its Guild Vault, and a hall whose guild is disbanded or gone is demolished. The clock check comes every `decay.clockFrames` (1,230) frames for each online player, and `decay.staleAfterMonths` (2) sets how old a house may get. Rest regeneration is separately rolled while inside, and skipped while dead. An admin can revoke a house or transfer it to another character from the Control Panel's player hub (see the [Admin guide](admin.md#houses-in-the-hub)).

The furniture items (`furnitureDrop.items`; Classic: Alchemy Lab, Anvil, Blackjack Table, Checkers Table, Slot Machine and Stove) can be put down only in a building that is yours: a personal house is its owner's by its blueprint, whatever its header says, and a guild hall its guild's members' by the guild's id (`dropFlag`, `houseDrop`); any other room keeps the header test (`headDrop`). A Small Shop's build also makes its shopkeeper (see [economy](economy.md)). The numbers and texts for placing, building, decay, keys, switches, relocking and resting are rows of the house content, edited on the **Houses & Vehicles** page's Building and Doors, keys and chests tabs.

### Doors and switches

A key acts on the faced door and changes only that door. House and guild keys remain in the bag and pause 100 frames; a coloured key is spent when it opens its door (closing is free) and also pauses 100. A switch must be faced while standing still; a refused click changes nothing. A switch flips only itself and opens or closes every switch door on the map. Every door change sets the map's relock to 200 frames, after which coloured, switch, player and guild doors close and ON switches turn off. The timer keeps running while the map is empty.

## Differences from 1.6

See the [housing bugs fixed](../differences-from-fso.md#housing) and [server-side housing changes](../differences-from-fso.md#server-side-housing).
