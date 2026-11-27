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

Equip any weapon whose name contains "Axe" and swing at a tree (tile `S3` on layer 2). Each swing at a tree throws up wood chips that everyone on the map sees (the node's `strikeFx`) and counts down the axe's hits ([gathering hits](README.md#gathering-hits)); the last one fells it, turning it into a stump (`P3`). An Axe and a Gold Axe share one count. A felled tree drops Logs one time in three, at any skill (the tree's harvest node and its `Logs` yield in [gather.json](../../../packages/data/content/gather.json); `rollYield` in [gather.ts](../../../packages/shared/src/rules/crafting/gather.ts)). Stumps grow back over time through world regrowth.

A world can make trees work differently: a skill or tool tier to chop one, a chance on every swing in place of the hit count, a tree that gives several harvests before it falls, a set time to grow back, and a log chance that changes with the skill. Classic sets none of these; see [What a world can change](README.md#what-a-world-can-change).

How fast you swing is set by [Axe Fighting](axe-fighting.md), not Lumberjacking.

## How it rises

Each felled tree rolls `random(12) = 1` while Lumberjacking is from 0 to 99 (see the Lumberjacking progression row in [classes.json](../../../packages/data/content/classes.json)). It rolls whether or not the tree drops Logs.

## Connected systems

- **Crafting:** Logs are [Carpentry](carpentry.md)'s material.
- **World:** regrowth turns stumps back into trees (`regrowth` in gather.json).
- **Bio titles:** Apprentice Lumberjack (above 10), Novice Lumberjack (above 40), Master Lumberjack (above 90).

See the [crafting guide](../crafting.md).

## Differences from 1.6

- [Gathering at skill 0 drops items](../../differences-from-fso.md#gathering-at-skill-0-drops-items).
- [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).
- [Chopping and mining throw up chips](../../differences-from-fso.md#chopping-and-mining-throw-up-chips).
- [A tool's first success takes the full number of hits](../../differences-from-fso.md#a-tools-first-success-takes-the-full-number-of-hits).
- [The bio score counts all its listed skills](../../differences-from-fso.md#the-bio-score-counts-all-its-listed-skills): Lumberjacking did not count in 1.6.

## Balance notes

- Lumberjacking only changes swings per tree. Log yield per tree is fixed at 1 in 3.
