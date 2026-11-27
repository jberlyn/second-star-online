# Wind

Wind is the Wind Mage's element. It strengthens Wind Wave and Whirlwind.

| | |
|---|---|
| Kind | Magic (element) |
| Starting value | 1 |
| Rises from | Casting Wind Wave or Whirlwind; the Wind Mage promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting** Wind Wave (in any direction) or Whirlwind rolls `random(Wind) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting).
- **Promotion to Wind Mage** raises it to a roll of 1 to 10 if it is lower.

## What it does

Adds to the power of Wind Wave and Whirlwind: +2 above 0, then +1 above 10, 20, 30, 50 and 70, +2 above 80 and +4 above 97, up to +13 (`power.tables.Wind` in [spells.json](../../../packages/data/content/spells.json)). A player standing in a Whirlwind loses 1 SP a frame whatever its power.

## Connected systems

- **Spells:** see the [spells guide](../spells.md).

## Differences from 1.6

- [Fireball and Wind Wave get their school bonus](../../differences-from-fso.md#fireball-and-wind-wave-get-their-school-bonus).
- [Bolt and Wind Wave train their school; free fireballs train nothing](../../differences-from-fso.md#bolt-and-wind-wave-train-their-school-free-fireballs-train-nothing).
- [Standing in a Whirlwind drains 1 SP a frame](../../differences-from-fso.md#standing-in-a-whirlwind-drains-1-sp-a-frame) (kept on purpose).
- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills).
- [The bio score counts all its listed skills](../../differences-from-fso.md#the-bio-score-counts-all-its-listed-skills): Wind did not count in 1.6.
