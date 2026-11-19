# Water

Water is the Water Mage's element. It strengthens Splash.

| | |
|---|---|
| Kind | Magic (element) |
| Starting value | 1 |
| Rises from | Casting Splash; the Water Mage promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting Splash** rolls `random(Water) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting).
- **Promotion to Water Mage** raises it to a roll of 1 to 10 if it is lower.

## What it does

Adds to Splash's power: +2 above 0, then +1 above 10, 20, 30, 50 and 70, +2 above 80 and +4 above 97, up to +12 (`elemental` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)).

## Connected systems

- **Spells:** see the [spells guide](../spells.md).

## Differences from 1.6

- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills).

## Balance notes

- Water affects a single spell, the narrowest of the four elements.
