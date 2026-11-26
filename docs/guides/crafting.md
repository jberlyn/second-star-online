# Crafting

## What happens in play

A player equips a gathering tool and swings at the right tile; the tool, skill and random roll determine what happens.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/crafting/craft.ts](../../packages/server/src/systems/crafting/craft.ts): starts and advances crafting jobs.
- [packages/server/src/systems/crafting/gather.ts](../../packages/server/src/systems/crafting/gather.ts): handles gathering, planting, treasure and regrowth.
- [packages/shared/src/rules/crafting/craft.ts](../../packages/shared/src/rules/crafting/craft.ts): defines crafting jobs and outcomes.
- [packages/shared/src/rules/crafting/gather.ts](../../packages/shared/src/rules/crafting/gather.ts): defines tool, farming, fishing and regrowth rules.
- [packages/shared/src/rules/crafting/recipes.ts](../../packages/shared/src/rules/crafting/recipes.ts): defines recipe stations, recipe checks, odds, time and one craft's outcome.
- [packages/server/src/systems/crafting/recipes.ts](../../packages/server/src/systems/crafting/recipes.ts): runs the crafting window, Make X and recipe books.
- [packages/client/src/ui/crafting.ts](../../packages/client/src/ui/crafting.ts): draws the crafting window.

Entry points:

- `packages/shared/src/rules/crafting/gather.ts` (`regrowthFrame`).
- `packages/server/src/systems/crafting/craft.ts` (`craftIntent`, `craftStep`).
- `packages/server/src/systems/crafting/gather.ts` (`toolSwing`).
- `packages/server/src/systems/crafting/recipes.ts` (`openRecipeWindow`, `recipeMakeIntent`, `recipeStep`, `readRecipeBook`).

## How it works

Gathering checks the equipped tool and target tile, uses counters and action timing, and can change map tiles or award resources. Fishing checks water and direction, and each tile allows a few catches before the fisher has to fish from another tile; farming plants seeds, waters tiles and lets regrowth advance on world ticks. Treasure searches and rumours use their own rules. Skill gain is rolled by the relevant action.

Crafting starts from an item and its station or tool, then runs a timed job. Smithing includes repair and masterwork; cooking, mixing and building have their own results, including alchemy and carpentry. A cauldron combines two exact ingredients among its stored contents. The editable recipes and rules are in [craft content](../../packages/data/content/craft.json) and [gathering content](../../packages/data/content/gather.json).

### Gathering and the world

A swing passes through common action timing and then selects a tool rule. Axe, shovel, hoe and mining tools inspect the appropriate tile and use a per-tool counter, so each success takes the table's number of hits, then roll the drop; a node with `odds` instead succeeds on a chance by skill each swing (`swingHarvests`), a node with `depletes` is used up only 1 time in that many successes (`harvestUsesUp`), and one with `respawn` waits on the map (`respawns`, saved to `tile_respawns`) until its tile turns back. Every swing that strikes a node with a `strikeFx` queues that run on the tile for the whole map, as a cast queues fishing's splash. Fishing checks the water in front of the player on either layer and waits for its cast delay; seeds and water change only eligible tiles, and a seed is used up only when it is planted. Regrowth runs once per map per frame, and an empty map catches up when someone arrives. Treasure searches consult the map and dug tile. Gathering and crafting skill gain use their own roll rules. The server mutates the map and bag after these shared decisions.

### Crafting jobs

Operators must place a **Carpentry Bench** from the World page's items and save the map before players can use carpentry. This applies to new and existing worlds. Place it where players can stand on an adjacent tile and face it.

A craft is selected from the bag and started only when its station, tool, skill and recipe allow it (a recipe's `requires` included); starting takes nothing. The server maintains per-player timers and advances the jobs in their defined order. At completion `finishCraft` takes the materials by exact name, rolls the failure (cooking, alchemy, carpentry: the recipe's own `odds` when it has them, else the shared table), makes a set carpentry recipe's item in place of the bands' roll, and adds the result only if it fits in the bag; a failure uses up the materials. A burn adds the recipe's `burned` food instead, under the same full-bag check; a failed brew or build adds nothing. The held tool (Blacksmith Hammer, Saw, alchemy sand) is never used up. Masterwork changes an eligible item according to its roll. Cauldrons use the contents of a container, and built containers receive server IDs. The recipe and tool values live in the editable content files linked above; the code handles the order and effects. A crafter cannot walk or turn while a craft runs; logging out, a map change or being shoved off the spot ends it.

### Recipe stations

A world can also have recipe stations (`craft.json` `recipeStations` and `recipes`), an SSO addition beside the four Classic crafts; Classic has none, so none of this reaches it. A station is opened by pressing Ctrl while facing one of its `at` items, or by Use on one of its `opens` items in the bag (a knife for fletching). The server sends the crafting window: the station's recipes, each with its state for the player (`recipeState`: not learned, level too low, no good enough tool, missing materials, or ready), and those above the player's level left out when the station or recipe says `hide`. A tool counts when it is held or in the bag, and the best tier of the station's `tools` the player has is used.

Make X (`recipeMakeIntent`) checks the recipe and starts a run of up to 10,000 crafts (All). The keys stay free: each frame `recipeStep` ends the run if the crafter died, moved, turned, changed map or left the station (no longer facing it, or no longer carrying the item that opened it), and an attack or the window's Stop ends it too. When a craft comes due it is checked again (`recipeRefusal`), then `finishRecipe` takes the materials (kept items stay), rolls the recipe's chance with the tool's `tierBonus`, and adds the output or the failure output only if it fits in the bag; a full bag or missing materials end the run with a line. A success trains the recipe's skill (its `xp` for an `xp`-model skill). The next craft's time is worked out again from the skill and tool (`recipeFrames`, with `tierSpeed`).

A recipe with a `book` must be learned: Use on that book teaches every recipe naming it that the player does not know, and uses one up; a book that teaches nothing new is kept. A quest teaches a recipe by giving its book as the reward. Learned recipes are saved per character (`character_recipes`).

## Differences from 1.6

See the [crafting bugs fixed](../differences-from-fso.md#crafting) and [server-side crafting changes](../differences-from-fso.md#server-side-crafting).
