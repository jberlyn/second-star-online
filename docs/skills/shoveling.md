# Shoveling

Shoveling is digging holes with a shovel, which can turn up buried treasure. The skill only changes how many swings a hole takes.

| | |
|---|---|
| Kind | Gathering |
| Starting value | 1 |
| Rises from | Digging holes |
| Cap | 100 |
| Medal | None |
| Counts towards | Nothing |

## How it works

Equip a Shovel and swing at diggable ground: tile `G3` on layer 2, over `G1`, `H1` or `O1` on layer 1. Each swing counts down the shovel's hits ([gathering hits](README.md#gathering-hits)), and the last one digs a hole (`1K`). Holes fill back in through world regrowth.

On the current treasure map, each hole has a 1 in 5 chance of uncovering the treasure, whatever the skill. The treasure then moves to another map from the operator's list, and rumour NPCs can say which map holds it (`treasure` in [gather.json](../../packages/data/content/gather.json)).

## How it rises

Each hole rolls `random(12) = 1` while Shoveling is from 0 to 99 (`ShovelingImp`).

## Connected systems

- **World:** the treasure hunt and regrowth; see the [crafting guide](../guides/crafting.md).

## Differences from 1.6

- [Gathering and crafting skills rise from 0](../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).

## Balance notes

- Shoveling has no medal and no title, and it is not counted in the bio score or high scores.
