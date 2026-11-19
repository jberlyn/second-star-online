# Lumberjacking

Lumberjacking is chopping trees with an axe. Higher skill fells a tree in fewer swings; the chance of logs does not change.

| | |
|---|---|
| Kind | Gathering |
| Starting value | 1 |
| Rises from | Felling trees |
| Cap | 100 |
| Medal | The oak medal at 90: +1 Strength |
| Counts towards | Bio score, high scores |

## How it works

Equip any weapon whose name contains "Axe" and swing at a tree (tile `S3` on layer 2). Each swing at a tree counts down the axe's hits ([gathering hits](README.md#gathering-hits)); the last one fells it, turning it into a stump (`P3`). A felled tree drops Logs one time in three, at any skill (`rollLogs`). Stumps grow back over time through world regrowth.

How fast you swing is set by [Axe Fighting](axe-fighting.md), not Lumberjacking.

## How it rises

Each felled tree rolls `random(12) = 1` while Lumberjacking is from 0 to 99 (`LumberjackImp` in [gather.json](../../packages/data/content/gather.json)).

## Connected systems

- **Crafting:** Logs are [Carpentry](carpentry.md)'s material.
- **World:** regrowth turns stumps back into trees (`regrowth` in gather.json).
- **Bio titles:** Apprentice Lumberjack (above 10), Novice Lumberjack (above 40), Master Lumberjack (above 90).

See the [crafting guide](../guides/crafting.md).

## Differences from 1.6

- [Gathering at skill 0 drops items](../differences-from-fso.md#gathering-at-skill-0-drops-items).
- [Gathering and crafting skills rise from 0](../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).
- [The bio score counts every skill](../differences-from-fso.md#the-bio-score-counts-every-skill): Lumberjacking did not count in 1.6.

## Balance notes

- Lumberjacking only changes swings per tree. Log yield per tree is fixed at 1 in 3.
