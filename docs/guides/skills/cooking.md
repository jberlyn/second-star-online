# Cooking

Cooking turns raw meat and fish into meals at a stove or campfire. Higher skill cooks faster and burns less.

| | |
|---|---|
| Kind | Crafting |
| Starting value | 1 |
| Rises from | Cooking meals |
| Cap | 100 |
| Medal | The silver spatula at 90: +1 Stamina |
| Counts towards | Bio score, high scores |

## How it works

Face a Stove or a Campfire and choose Cook on a raw food. Cooking needs a skill of at least 1. The meal takes the [crafting timer's](README.md#crafting-time-and-failure) frames, twice as long at a Campfire, then rolls for a burn at the failure table's odds. A burn uses the raw food and leaves its burned form, which has no use; a success makes the meal.

| Raw | Meal |
|---|---|
| Raw Fish | Fish Sticks |
| Trout | Trout Fillet |
| Catfish | Catfish Sandwich |
| Swordfish | Swordfish Steak |
| Squid | Squid Platter |
| Cyclops Meat | Cyclops Burger |
| Orc Meat | Orc Pot Pie |
| Yeti Meat | Yeti Burger |
| Raw Meat | Cooked Meat |
| Pig | Cooked Pig |

The recipes are `stations.cook.recipes` in [craft.json](../../../packages/data/content/craft.json). A world can give a recipe a skill requirement, its own chance of success by skill in place of the failure table, and its own XP; see [What a world can change](README.md#what-a-world-can-change).

## How it rises

Each meal cooked without burning rolls `random(8) = 1` while Cooking is from 0 to 99 (see the Cooking progression row in [classes.json](../../../packages/data/content/classes.json)), the fastest gain of any crafting skill.

## Connected systems

- **Gathering:** fish from [Fishing](fishing.md); meat from monster loot.
- **Progression:** meals restore HP and hunger; see the [progression guide](../progression.md).
- **Bio titles:** Apprentice Cook (above 10), Novice Cook (above 40), Master Chef (above 90).

See the [crafting guide](../crafting.md).

## Differences from 1.6

- [Burned food and Cooked Meat](../../differences-from-fso.md#burned-food-and-cooked-meat).
- [Each cook rolls its own burn](../../differences-from-fso.md#each-cook-rolls-its-own-burn).
- [Every craft takes its materials when it finishes](../../differences-from-fso.md#every-craft-takes-its-materials-when-it-finishes).
- [Crafting at skill 10 can fail](../../differences-from-fso.md#crafting-at-skill-10-can-fail).
- [Yeti Meat cooks into a Yeti Burger](../../differences-from-fso.md#yeti-meat-cooks-into-a-yeti-burger).
- [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).

## Balance notes

- Cooking does not change what a meal restores, only how quickly and reliably it is made.
