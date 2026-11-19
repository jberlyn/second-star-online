# Blacksmithing

Blacksmithing repairs damaged weapons and armour at an anvil, with a chance of a masterwork. It never fails, and higher skill repairs faster and makes masterworks more often.

| | |
|---|---|
| Kind | Crafting |
| Starting value | 1 |
| Rises from | Repairing items |
| Cap | 100 |
| Medal | The gold medal at 90: +2 Strength, +2 Stamina |
| Counts towards | Bio score, high scores |

## How it works

Face an Anvil with a Blacksmith Hammer in your weapon hand, a bag no more than 14 slots full, and a damaged item and its chunk in the bag. Most items take a Chunk of Iron; some take Steel, Star, Ice or Fire (`stations.smith.chunks` in [craft.json](../../../packages/data/content/craft.json)). Use the damaged item to start. The repair takes:

| Blacksmithing | Frames |
|---|---|
| 10 or less | 500 |
| 11 to 20 | 460 |
| 21 to 30 | 400 |
| 31 to 40 | 350 |
| 41 to 50 | 340 |
| 51 to 60 | 320 |
| 61 to 70 | 240 |
| 71 to 80 | 150 |
| 81 to 90 | 110 |
| 91 to 98 | 40 |
| Above 98 | 12 |

The repair uses the item and the chunk and makes the whole item. Some items can come out as a masterwork with a `+N`: each outcome is one number in `random(pool)`, where the pool is 250 up to 50, then 100, 90, 80, 70 and 50, and 35 above 98 (`masterworkPool`). The Knight's Sword has four outcomes (+1 to +4), the War Helm three, the Plate Armor, Knight Shield and Star Sword two, and the Chain Helm, Steel Shield, Small Shield, Ice Helm, Sword of Hope and Pharaoh Shield one. A weapon's `+N` adds to its attack power.

## How it rises

Each repair rolls `random(9) = 1` while Blacksmithing is from 0 to 99 (`SmithImp`).

## Connected systems

- **Combat:** armour breaks into damaged items when you are hit; repairing them is how they return. Masterworks are stronger.
- **Gathering:** chunks from [Mining](mining.md).
- **Combat:** killing with the Blacksmith Hammer trains [Hammer Wielding](hammer-wielding.md) and [Heavy Arms](heavy-arms.md).

See the [crafting guide](../crafting.md).

## Differences from 1.6

- [Blacksmithing only gets faster with skill](../../differences-from-fso.md#blacksmithing-only-gets-faster-with-skill).
- [Every craft takes its materials when it finishes](../../differences-from-fso.md#every-craft-takes-its-materials-when-it-finishes).
- [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).

## Balance notes

- The gold medal ties with Farming's as the second-largest (4 stat points), and Blacksmithing has no bio title.
- The masterwork pool does not improve until above 50: up to then a Knight's Sword masterwork is 4 in 250.
