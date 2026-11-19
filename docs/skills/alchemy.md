# Alchemy

Alchemy mixes coloured potions at an Alchemy Lab. Higher skill mixes faster and fails less.

| | |
|---|---|
| Kind | Crafting |
| Starting value | 1 |
| Rises from | Mixing potions |
| Cap | 100 |
| Medal | The Golden Bottle at 90: +1 Wisdom |
| Counts towards | Bio score, high scores |

## How it works

Face an Alchemy Lab with a coloured sand in your right hand and a crystal of the same colour in your bag, then use a bottle. The sand decides the potion: Red, Blue, Yellow, Green, Purple or White. The sand is a tool and is never used up; the bottle and one crystal are. The mix takes the [crafting timer's](README.md#crafting-time-and-failure) frames, then rolls for failure; a failed mix uses its materials and makes nothing. There is no minimum skill.

The sands are `stations.mix.sands` in [craft.json](../../packages/data/content/craft.json).

## How it rises

Each potion made rolls `random(15) = 1` while Alchemy is from 0 to 99 (`AlchemyImp`).

## Connected systems

- **Gathering:** crystals come from [Mining](mining.md).
- **Inventory:** potions restore vitals or give effects; see the [inventory guide](../guides/inventory.md).
- **Bio titles:** Apprentice Alchemist (above 25), Novice Alchemist (above 45), Master Alchemist (above 90).

See the [crafting guide](../guides/crafting.md).

## Differences from 1.6

- [Alchemy sand is a tool and is never used up](../differences-from-fso.md#alchemy-sand-is-a-tool-and-is-never-used-up).
- [Only alchemy sand mixes a potion](../differences-from-fso.md#only-alchemy-sand-mixes-a-potion).
- [Every craft takes its materials when it finishes](../differences-from-fso.md#every-craft-takes-its-materials-when-it-finishes).
- [Crafting at skill 10 can fail](../differences-from-fso.md#crafting-at-skill-10-can-fail).
- [Gathering and crafting skills rise from 0](../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).
