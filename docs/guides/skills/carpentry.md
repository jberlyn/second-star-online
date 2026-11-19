# Carpentry

Carpentry builds furniture from Logs with a Saw. Higher skill builds faster, fails less and unlocks the containers.

| | |
|---|---|
| Kind | Crafting |
| Starting value | 1 |
| Rises from | Building furniture |
| Cap | 100 |
| Medal | The Bronzed Saw at 90: +1 Intelligence, +1 Wisdom |
| Counts towards | Bio score, high scores |

## How it works

Hold a Saw in your right hand and use Logs. Building needs Carpentry 1 and no station. It takes the [crafting timer's](README.md#crafting-time-and-failure) frames, then rolls for failure; a failed build uses the Logs and makes nothing. What you build depends on your skill (`carpentryResult`, `stations.build.bands` in [craft.json](../../../packages/data/content/craft.json)):

| Carpentry | Result |
|---|---|
| Below 14 | Chair |
| 14 to 24 | Stool |
| 25 to 29 | Table |
| 30 to 49 | Crate, Stool, Chair or Table, evenly |
| 50 to 59 | Crate, Stool, Table, or Chair (2 in 5) |
| 60 to 79 | Crate, Chair, Table, Cabinet, or Stool (2 in 6) |
| 80 or more | Stool, Chair, Table, Cabinet, Wind Cabinet, or Crate (2 in 7) |

Crates, Cabinets and Wind Cabinets are containers and get their own ids.

## How it rises

Each piece built rolls `random(9) = 1` while Carpentry is from 0 to 99 (`CarpentryImp`).

## Connected systems

- **Gathering:** Logs from [Lumberjacking](lumberjacking.md).
- **Economy and housing:** containers store items; furniture furnishes houses. See the [economy](../economy.md) and [housing](../housing.md) guides.
- **Bio titles:** Apprentice Carpenter (above 10), Novice Carpenter (above 40), Master Carpenter (above 90).

See the [crafting guide](../crafting.md).

## Differences from 1.6

- [Building furniture needs Carpentry 1](../../differences-from-fso.md#building-furniture-needs-carpentry-1).
- [Built containers get server ids](../../differences-from-fso.md#built-containers-get-server-ids).
- [Every craft takes its materials when it finishes](../../differences-from-fso.md#every-craft-takes-its-materials-when-it-finishes).
- [Crafting at skill 10 can fail](../../differences-from-fso.md#crafting-at-skill-10-can-fail).
- [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).

## Balance notes

- Below 30 the result is fixed. From 30 the band picks at random, so a higher skill makes containers possible but not certain.
- Building needs no station; a workbench is tracked in [issue #4](https://github.com/jberlyn/second-star-online/issues/4).
