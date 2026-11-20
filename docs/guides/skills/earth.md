# Earth

Earth is the Earth Mage's element. It strengthens Crush and Stone Skin.

| | |
|---|---|
| Kind | Magic (element) |
| Starting value | 1 |
| Rises from | Casting Crush or Stone Skin; the Earth Mage promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting** Crush or Stone Skin rolls `random(Earth) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting).
- **Promotion to Earth Mage** raises it to a roll of 1 to 10 if it is lower.

## What it does

Adds to the power of Crush and Stone Skin: +2 above 0, then +1 above 10, 20, 30, 50 and 70, +2 above 80 and +4 above 97, up to +13 (`elemental` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)). Stone Skin's defence bonus is fixed; its power sets how long it lasts, 30 frames per point.

## Connected systems

- **Spells:** see the [spells guide](../spells.md).
- **Combat:** Stone Skin's defence bonus lowers the damage you take from melee hits.

## Differences from 1.6

- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills).

## Balance notes

- The cast gain table also has a row for "Earth Shift", but no spell has that name, so the row never matches. Nature Shift, the nearest spell, trains only Magery.
