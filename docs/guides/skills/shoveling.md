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

Equip a Shovel and swing at diggable ground: tile `G3` on layer 2, over `G1`, `H1` or `O1` on layer 1. Each swing counts down the shovel's hits ([gathering hits](README.md#gathering-hits)), and the last one digs a hole (`1K`). Holes fill back in through world regrowth. The diggable ground is a harvest node (`harvest` in [gather.json](../../../packages/data/content/gather.json)): its `under` lists the three grounds and its `treasure` mark makes each hole a treasure check. It drops nothing of its own and shows no strike effect.

On the current treasure map, each hole has a 1 in 5 chance of uncovering the treasure, whatever the skill. The treasure then moves to another map from the operator's list (the treasure maps setting), with a new item drawn from the treasure list, and rumour NPCs can say which map holds it (`gathering.treasure` in gather.json). While that setting is empty nothing is buried.

## How it rises

Each hole rolls `random(12) = 1` while Shoveling is from 0 to 99 (see the Shoveling progression row in [classes.json](../../../packages/data/content/classes.json)).

## What operators can change

Classic plays as above. On the Control Panel's Gathering & Crafting and Skills & Classes pages an operator can change the dig, with no code (see [tools and gathering](../../modding.md#tools-and-gathering) and [progression](../../modding.md#progression)): a chance by Shoveling skill that each swing digs (`odds`, with `tierBonus` for a better shovel) in place of the hit count; ground used up only 1 time in so many digs (`depletes`) or filled back in after a set number of seconds (`respawn`); a skill value, level, class or tool tier the ground needs (`requires`, `tier`); a drop table (`yield`) and a strike effect (`strikeFx`); and Shoveling on the `xp` model with a level curve. That gives Shoveling's value more to do than count swings.

## Connected systems

- **World:** the treasure hunt and regrowth; see the [crafting guide](../crafting.md).

## Differences from 1.6

- [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).
- [A tool's first success takes the full number of hits](../../differences-from-fso.md#a-tools-first-success-takes-the-full-number-of-hits).
- [The shovel checks the ground under every tile](../../differences-from-fso.md#the-shovel-checks-the-ground-under-every-tile).
- [Asking about "the treasure" gets an answer](../../differences-from-fso.md#asking-about-the-treasure-gets-an-answer).

## Balance notes

- Shoveling has no medal and no title, and it is not counted in the bio score or high scores.
