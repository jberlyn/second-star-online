# Crafting

## What happens in play

A player equips a gathering tool and swings at the right tile; the tool, skill and random roll determine what happens.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/crafting/craft.ts](../../packages/server/src/systems/crafting/craft.ts): starts and advances crafting jobs.
- [packages/server/src/systems/crafting/gather.ts](../../packages/server/src/systems/crafting/gather.ts): handles gathering, planting, treasure and regrowth.
- [packages/shared/src/rules/crafting/craft.ts](../../packages/shared/src/rules/crafting/craft.ts): defines crafting jobs and outcomes.
- [packages/shared/src/rules/crafting/gather.ts](../../packages/shared/src/rules/crafting/gather.ts): defines tool, farming, fishing and regrowth rules.

Entry points:

- `packages/shared/src/rules/crafting/gather.ts` (`regrowthFrame`).
- `packages/server/src/systems/crafting/craft.ts` (`craftIntent`, `craftStep`).
- `packages/server/src/systems/crafting/gather.ts` (`toolSwing`).

## How it works

Gathering checks the equipped tool and target tile, uses counters and action timing, and can change map tiles or award resources. Fishing checks water and direction; farming plants seeds, waters tiles and lets regrowth advance on world ticks. Treasure searches and rumours use their own rules. Skill gain is rolled by the relevant action.

Crafting starts from an item and its station or tool, then runs a timed job. Smithing includes repair and masterwork; cooking, mixing and building have their own results, including alchemy and carpentry. A cauldron combines two exact ingredients among its stored contents. The editable recipes and rules are in [craft content](../../packages/data/content/craft.json) and [gathering content](../../packages/data/content/gather.json).

### Gathering and the world

A swing passes through common action timing and then selects a tool rule. Axe, shovel, hoe and mining tools inspect the appropriate tile and use a per-tool counter, so each success takes the table's number of hits, then roll the drop. Fishing checks the water in front of the player on either layer and waits for its cast delay; seeds and water change only eligible tiles, and a seed is used up only when it is planted. Regrowth runs once per map per frame, and an empty map catches up when someone arrives. Treasure searches consult the map and dug tile. Gathering and crafting skill gain use their own roll rules. The server mutates the map and bag after these shared decisions.

### Crafting jobs

A craft is selected from the bag and started only when its station, tool, skill and recipe allow it; starting takes nothing. The server maintains per-player timers and advances the jobs in their defined order. At completion `finishCraft` takes the materials by exact name, rolls the failure (cooking, alchemy, carpentry), and adds the result only if it fits in the bag; a failure uses up the materials. The held tool (Blacksmith Hammer, Saw, alchemy sand) is never used up. Masterwork changes an eligible item according to its roll. Cauldrons use the contents of a container, and built containers receive server IDs. The recipe and tool values live in the editable content files linked above; the code handles the order and effects. Crafts end at logout and on a map change.

## Kept bugs and differences

Crafting has no kept bugs. The former ones are fixed and listed with the other differences from 1.6.

See the [crafting kept bugs](../bug-ledger.md#crafting) and [crafting differences](../divergences.md#crafting) for the specific player-visible cases.

