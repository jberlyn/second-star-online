# Farming

Farming is tilling soil with a hoe and watering seeds. The skill changes how many swings tilling and watering take; what grows does not depend on it.

| | |
|---|---|
| Kind | Gathering |
| Starting value | 1 |
| Rises from | Tilling soil |
| Cap | 100 |
| Medal | The earth pendant at 90: +1 Stamina, +3 Intelligence |
| Counts towards | Nothing |

## How it works

1. **Till.** Swing a Hoe at tile `TL` on layer 2. The hoe counts down its hits ([gathering hits](README.md#gathering-hits)), and the last one turns the tile into tilled soil (`SL`).
2. **Plant.** Use seeds on tilled soil: Seeds, Magic Seeds, Premium Seeds, Flower Seeds or Rose Seeds each plant their own crop.
3. **Water.** Swing a Watering Bucket at a seeded tile. It uses the same hit table, by Farming, and only swings at a seeded tile count.
4. **Harvest.** World regrowth drops the produce on watered tiles: Corn, Nectar, Watermelon, Flowers or Roses. It also slowly returns crops and soil to earlier stages.

## How it rises

Each tilled tile rolls `random(12) = 1` while Farming is from 0 to 99 (`FarmingImp`). Watering does not raise it.

## Connected systems

- **Economy and crafting:** produce is food and trade goods.
- **World:** regrowth grows and resets crops (`farming` and `regrowth` in [gather.json](../../../packages/data/content/gather.json)).

See the [crafting guide](../crafting.md).

## Differences from 1.6

- [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).
- [The Watering Bucket counts only useful swings](../../differences-from-fso.md#the-watering-bucket-counts-only-useful-swings).

## Balance notes

- The earth pendant is worth 4 stat points, one of the largest medals, though Farming is not counted in the bio score or high scores and has no title.
