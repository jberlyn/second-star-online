# Crafting

## What happens in play

A player equips a gathering tool and swings at the right tile; the tool, skill and random roll determine what happens.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- Matches masterwork names to their base items and resolves craft upgrades. [masterwork.ts](../../packages/shared/src/rules/crafting/masterwork.ts)
- Interpolates success chances between the skill levels a recipe or gathering rule specifies. [odds.ts](../../packages/shared/src/rules/crafting/odds.ts)
- [packages/server/src/systems/crafting/craft.ts](../../packages/server/src/systems/crafting/craft.ts): starts and advances crafting jobs.
- [packages/server/src/systems/crafting/gather.ts](../../packages/server/src/systems/crafting/gather.ts): handles gathering, planting, treasure and regrowth.
- [packages/shared/src/rules/crafting/craft.ts](../../packages/shared/src/rules/crafting/craft.ts): defines crafting jobs and outcomes.
- [packages/shared/src/rules/crafting/gather.ts](../../packages/shared/src/rules/crafting/gather.ts): defines tool, farming, fishing and regrowth rules.
- [packages/shared/src/rules/crafting/recipes.ts](../../packages/shared/src/rules/crafting/recipes.ts): defines recipe stations, recipe checks, odds, time and one craft's outcome.
- [packages/server/src/systems/crafting/recipes.ts](../../packages/server/src/systems/crafting/recipes.ts): runs the crafting window, Make X and recipe books.
- [packages/client/src/ui/crafting.ts](../../packages/client/src/ui/crafting.ts): draws the crafting window.
- [packages/server/src/persistence/recipes.ts](../../packages/server/src/persistence/recipes.ts): saves and loads the recipes a character has learned.
- [packages/client/src/ui/gathering-page.ts](../../packages/client/src/ui/gathering-page.ts), [packages/client/src/ui/recipe-preview.ts](../../packages/client/src/ui/recipe-preview.ts) and [packages/client/src/ui/masterwork-preview.ts](../../packages/client/src/ui/masterwork-preview.ts): the Control Panel's Gathering list and the recipe and masterwork previews on the **Gathering & Crafting** page.

Entry points:

- `packages/shared/src/rules/crafting/gather.ts` (`regrowthFrame`).
- `packages/server/src/systems/crafting/craft.ts` (`craftIntent`, `craftStep`).
- `packages/server/src/systems/crafting/gather.ts` (`preSwing`, `toolSwing`, `regrowthStep`).
- `packages/server/src/systems/crafting/recipes.ts` (`openRecipeWindow`, `recipeMakeIntent`, `recipeStep`, `readRecipeBook`).

## How it works

Gathering checks the equipped tool and target tile, uses counters and action timing, and can change map tiles or award resources. Fishing checks water and direction, and each tile allows a few catches before the fisher has to fish from another tile; farming plants seeds, waters tiles and lets regrowth advance on world ticks. Treasure searches and rumours use their own rules. Skill gain is rolled by the relevant action.

Crafting starts from an item and its station or tool, then runs a timed job. Smithing includes repair and masterwork; cooking, mixing and building have their own results, including alchemy and carpentry. A cauldron combines two exact ingredients among its stored contents. The editable recipes and rules are in [craft content](../../packages/data/content/craft.json) and [gathering content](../../packages/data/content/gather.json).

### Gathering and the world

A swing passes through common action timing and then selects a tool rule. A harvest node the gatherer cannot work yet says why once per press: its `requires` row (a skill, the level or a class) is unmet, or the tool's tier is below the node's. Axe, shovel, hoe and mining tools inspect the appropriate tile and use a per-tool counter, so each success takes the table's number of hits, then roll the drop; a node with `odds` instead succeeds on a chance by skill each swing (`swingHarvests`), a node with `depletes` is used up only 1 time in that many successes (`harvestUsesUp`), and one with `respawn` waits on the map (`respawns`, saved to `tile_respawns`) until its tile turns back. Every swing that strikes a node with a `strikeFx` queues that run on the tile for the whole map, as a cast queues fishing's splash. Fishing checks the water in front of the player on either layer and waits for its cast delay; every cast shows and plays the content's `fishing.castFx` and `castSound` to the map, and trains the skill for the cast, the catch or both as `fishing.trains` says (a catch can carry its own XP). The allowance belongs to the tile fished from and outlasts a logout. A world that binds no Fishing skill has no fishing; seeds and water change only eligible tiles, and a seed is used up only when it is planted. Regrowth runs once per map per frame, and an empty map catches up when someone arrives. Treasure searches consult the map and dug tile. Gathering and crafting skill gain use their own roll rules. The server mutates the map and bag after these shared decisions. The harvest nodes, fishing, farming and the hit counters are edited on the Control Panel's **Gathering & Crafting → Gathering** tab, which shows each skill value's and tool tier's odds worked out by the game's own rules (`gatherPreview`, `fishingPreview`).

### Crafting jobs

Operators must place a **Carpentry Bench** from the World page's items and save the map before players can use carpentry. This applies to new and existing worlds. Place it where players can stand on an adjacent tile and face it.

A craft is selected from the bag and started only when its station, tool, skill and recipe allow it (a recipe's `requires` included); starting takes nothing. The server maintains per-player timers and advances the jobs in their defined order. At completion `finishCraft` takes the materials by exact name, rolls the failure (cooking, alchemy, carpentry: the recipe's own `odds` when it has them, else the shared table), makes a set carpentry recipe's item in place of the bands' roll, and adds the result only if it fits in the bag; a failure uses up the materials. A burn adds the recipe's `burned` food instead, under the same full-bag check; a failed brew or build adds nothing. The held tool (Blacksmith Hammer, Saw, alchemy sand) is never used up. A repair the smithing table has masterworks for rolls its pool (`masterworkPool`, `masterwork`); any other success, a crafting window recipe's included, may come out as one of the item's shared `masterworks` (shared `rollMasterwork`: a chance by the craft's skill, then a pick by weight; an item with no row draws no dice, so Classic rolls as before). Cauldrons use the contents of a container, and built containers receive server IDs. The recipe and tool values live in the editable content files linked above; the code handles the order and effects. A crafter cannot walk or turn while a craft runs; logging out, a map change or being shoved off the spot ends it.

### Recipe stations

A world can also have recipe stations (`craft.json` `recipeStations` and `recipes`), an SSO addition beside the four Classic crafts; Classic has none, so none of this reaches it. A station is opened by pressing Ctrl while facing one of its `at` items, or by Use on one of its `opens` items in the bag (a knife for fletching). The server sends the crafting window: the station's recipes, each with its state for the player (`recipeState`: not learned, level too low, no good enough tool, missing materials, or ready), and those above the player's level or not yet learned left out when the station's or recipe's `aboveLevel` is `hide`. A recipe with `classes` is listed only for those classes (`recipeForClass`). The window is redrawn when the bag changes some other way (`recipeWindowRefresh`), and closing it leaves a running Make X going. A tool counts when it is held or in the bag, and the best tier of the station's `tools` the player has is used.

Make X (`recipeMakeIntent`) checks the recipe and starts a run of up to 10,000 crafts (All). The keys stay free: each frame `recipeStep` ends the run if the crafter died, moved, turned, changed map or left the station (no longer facing it, or no longer carrying the item that opened it), and an attack or the window's Stop ends it too. When a craft comes due it is checked again (`recipeRefusal`), then `finishRecipe` takes the materials (kept items stay), rolls the recipe's chance with the tool's `tierBonus`, and adds the output or the failure output only if it fits in the bag; a full bag or missing materials end the run with a line. A success trains the recipe's skill (its `xp` for an `xp`-model skill). The next craft's time is worked out again from the skill and tool (`recipeFrames`, with `tierSpeed`).

A recipe with a `book` must be learned: Use on that book teaches every recipe naming it that the player does not know, and uses one up; a book that teaches nothing new is kept. A quest teaches a recipe by giving its book as the reward. Learned recipes are saved per character (`character_recipes`).

Recipes, recipe stations and the shared masterworks are edited on the Control Panel's **Gathering & Crafting** page (its Recipes, Recipe stations and Masterworks tabs; the Classic crafting tab holds the four Classic stations and the Cauldron).

## Differences from 1.6

See the [crafting bugs fixed](../differences-from-fso.md#crafting) and [server-side crafting changes](../differences-from-fso.md#server-side-crafting).
