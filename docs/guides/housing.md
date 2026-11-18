# Housing

## What happens in play

Using a deed enters placement mode; the player chooses a location and the server checks whether the house can be built there.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/housing/doors.ts](../../packages/server/src/systems/housing/doors.ts): handles keys, switches and relocking.
- [packages/server/src/systems/housing/houses.ts](../../packages/server/src/systems/housing/houses.ts): handles placement, house clocks and demolition.
- [packages/shared/src/rules/housing/doors.ts](../../packages/shared/src/rules/housing/doors.ts): defines key, door and switch rules.
- [packages/shared/src/rules/housing/houses.ts](../../packages/shared/src/rules/housing/houses.ts): defines placement, house plans and decay.

Entry points:

- `packages/shared/src/rules/housing/houses.ts` (`checkPlacement`, `planHouse`, `sweep`).
- `packages/server/src/systems/housing/houses.ts` (`placeHouseIntent`).
- `packages/server/src/systems/housing/doors.ts` (`useKey`).

## How it works

The deed determines the house type and placement preview. Placement checks terrain and obstacles, then the house plan creates an interior and its map name. Owner and guild checks control relevant house actions; house refresh and decay run over time, and resting restores resources. Guild halls have placement and guild requirements. The original land system was inactive and is omitted.

Keys and switches affect matching doors, with relocking handled on ticks. House containers and vaults hand off to economy, while mailboxes and boards use their own systems. The server validates changes instead of accepting arbitrary map edits. House records are stored through [house persistence](../../packages/server/src/persistence/houses.ts).

### Placement and records

Using an eligible deed starts placement; Boat, Battleship and Stone Guild Hall deeds say they cannot be built yet and are kept. Every house anchors one column left and one row up of the hovered tile. The placement checks run in order: map edges, terrain (every footprint tile must be 8R, 8U or 8V on layer 1 and G3 on layer 2), overlap (anything standing on a footprint tile, the builder included), available exit slots and guild requirements. A refusal leaves placement active. On success the server creates the outdoor exit and items, creates the interior, consumes the deed, changes eligible tiles and records the blueprint and house list before refreshing the map. If interior creation fails, the preliminary map changes are rolled back. House types and their sizes come from [house content](../../packages/data/content/houses.json).

The shared map helpers generate the interior name from the outdoor coordinates and selected exit slot. Ownership and guild information are used for the room's drop and access rules; vaults use the economy system, while mailboxes and boards use mail and board persistence. Each house has its own blueprint and list entry, named by its interior. A login and each online player's clock check refresh that player's houses to this month (`YYYY-MM`); the first clock check of each day runs the decay sweep, which demolishes each house whose owner was last seen two or more calendar months ago. Demolition removes the house's tiles, exit, mailbox or street lamp, interior and vault, and updates the map at once. Rest regeneration is separately rolled while inside, and skipped while dead.

### Doors and switches

A key acts on the faced door and changes only that door. House and guild keys remain in the bag and pause 100 frames; a coloured key is spent when it opens its door (closing is free) and pauses 425. A switch must be faced while standing still; a refused click changes nothing. A switch flips only itself and opens or closes every switch door on the map. Every door change sets the map's relock to 200 frames, after which coloured, switch, player and guild doors close and ON switches turn off. The timer keeps running while the map is empty.

## Kept bugs and differences

Housing has no kept bugs; every former entry is fixed and listed under the housing differences.

See the [housing kept bugs](../bug-ledger.md#housing) and [housing differences](../divergences.md#housing) for the specific player-visible cases.

