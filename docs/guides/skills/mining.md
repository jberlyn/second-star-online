# Mining

Mining is breaking rock with a hammer for crystals, ore and elemental chunks. Higher skill breaks rock in fewer, faster swings and finds more crystals and better ore.

| | |
|---|---|
| Kind | Gathering |
| Starting value | 1 |
| Rises from | Breaking rock |
| Cap | 100 |
| Medal | Medal of Stone at 90: +1 Strength |
| Counts towards | Bio score, high scores |

## How it works

Each mining tool breaks its own rock on layer 2:

| Tool | Rock | Becomes | Can drop |
|---|---|---|---|
| Mining Hammer | `B8` | `O8` | Crystals or ore |
| Ice Hammer | `1G` | `0Z` | Chunk of Ice, 1 in 130 |
| Fire Hammer | `6O` | `6N` | Chunk of Fire, 1 in 130 |

The three rocks are harvest nodes (`harvest` in [gather.json](../../../packages/data/content/gather.json)), each naming its hammer in `tools`. Every swing that strikes a rock throws chips off it for everyone on the map to see: Rock Chips, Ice Chips or Ember Chips (the node's `strikeFx`). Each hammer keeps its own count of hits. Each swing at the rock counts down the hammer's hits ([gathering hits](README.md#gathering-hits)), and the last one breaks it. A rock broken with the Mining Hammer drops something one time in five (`rollMiningFind`). What it drops:

- **Crystals** (a pile such as "3 Blue Crystal"), by default. The count is a random 1 up to a top that rises with skill: 1 above 0, 2 above 10, 3 above 20, 4 above 50, 5 above 70 and 6 above 90. The colour is drawn from a list that shortens as skill rises, from 30 entries to 12, so rarer colours come up more: at skill 0 every crystal is Blue; from 1 to 10 about half are Blue and 1 in 30 White; above 90, 1 in 4 Blue and 1 in 12 White.
- **Ore**, which replaces the crystals when a roll hits: a Chunk of Iron at 1 in the Iron pool, a Chunk of Steel at 1 in (pool + 30) and a Chunk of Star at 1 in (pool + 130), the rarest winning. The pool falls from 100 below 10 through 95, 90, 80, 75, 60, 50, 40 and 30 to 25 from 90 up (`orePool`).

The Ice and Fire Hammers' chunk chance does not depend on skill (the `Chunk of Ice` and `Chunk of Fire` tables in `yields`).

Broken rock comes back only through world regrowth.

The **Mining Hammer swings faster** with Mining (the `mining` ladder in `item-rules.json` `ladders`, read by `swingCooldowns` in [combat.ts](../../../packages/shared/src/rules/combat/combat.ts)): 15 frames below 10, one frame less for every ten points, down to 7 from 80.

## How it rises

Each broken rock, with any of the three hammers, rolls `random(22) = 1` while Mining is from 0 to 99 (see the Mining progression row in [classes.json](../../../packages/data/content/classes.json)).

## What operators can change

Classic plays as above. On the Control Panel's Gathering & Crafting and Skills & Classes pages an operator can give each rock more, with no code (see [tools and gathering](../../modding.md#tools-and-gathering) and [progression](../../modding.md#progression)):

- **Odds:** a chance by Mining skill that each swing breaks the rock (`odds`), in place of the hit count, with a bonus for a better tool (`tierBonus`).
- **Lasting rocks:** a rock that is used up only 1 time in so many harvests (`depletes`), and one that comes back a set number of seconds after it is used up (`respawn`) instead of waiting for regrowth.
- **Gates:** a Mining value, level or class the rock needs (`requires`), and a lowest tool tier (`tier`, against the `tier` of a hammer's `tools` row).
- **Drops and chips:** another drop table (`yield`), with a chance that changes by skill, and another strike effect, or none.
- **Levels and XP:** Mining on the `xp` model with a level curve, each rock paying its own `xp`.
- **Classes:** a class's own cap and training speed for Mining (see [classes](../../modding.md#classes)).

## Connected systems

- **Crafting:** chunks are [Blacksmithing](blacksmithing.md)'s repair materials and Cauldron ingredients; crystals feed spells, arrows and [Alchemy](alchemy.md).
- **Combat:** the Mining Hammer is also a weapon, and killing with it trains [Hammer Wielding](hammer-wielding.md) and [Heavy Arms](heavy-arms.md).
- **World:** regrowth restores broken rock.
- **Bio titles:** Apprentice Miner (above 10), Novice Miner (above 40), Master Miner (above 90).

See the [crafting guide](../crafting.md).

## Differences from 1.6

- [Ore odds improve with Mining](../../differences-from-fso.md#ore-odds-improve-with-mining).
- [Axe and Mining Hammer speeds follow their skill ladders](../../differences-from-fso.md#axe-and-mining-hammer-speeds-follow-their-skill-ladders).
- [Gathering at skill 0 drops items](../../differences-from-fso.md#gathering-at-skill-0-drops-items).
- [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).
- [A tool's first success takes the full number of hits](../../differences-from-fso.md#a-tools-first-success-takes-the-full-number-of-hits): each hammer keeps its own count.
- [Chopping and mining throw up chips](../../differences-from-fso.md#chopping-and-mining-throw-up-chips).
- [Weapon attack power matches the right weapons](../../differences-from-fso.md#weapon-attack-power-matches-the-right-weapons): the Mining Hammer hits for its own base.

## Balance notes

- Mining has the slowest gain of any gathering or crafting skill (1 in 22).
- It improves four things at once: swings per rock, swing speed, crystal count and colour, and ore odds.
