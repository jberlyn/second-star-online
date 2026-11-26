# Black Arts

Black Arts is the Necromancer's school: Hold, Raise Dead, Weaken and Poison Dart.

| | |
|---|---|
| Kind | Magic |
| Starting value | 1 |
| Rises from | Casting Hold, Raise Dead, Weaken or Poison Dart; the Necromancer promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting** Hold, Raise Dead, Weaken or Poison Dart rolls `random(Black Arts) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting). The line reads "You have advanced in the Black Arts!"
- **Promotion to Necromancer** raises it to a roll of 1 to 10 if it is lower.

## What it does

Adds to the power of Hold, Raise Dead, Weaken and Poison Dart: +1 above 10, 20, 30, 70 and 90 (up to +5), and +5 more in a Necromancer's Robe (`blackArts` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)). Hold lasts 8 frames per point of power, Weaken 10 and Poison Dart's poison 10, on top of their fixed time.

## Connected systems

- **Spells:** see the [spells guide](../spells.md).
- **Inventory:** the Necromancer's Robe.
- **Bio titles:** Necromancer (above 60 with Magery above 80).

## Differences from 1.6

- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills): Necromancer now grants Black Arts.

- [The spells 1.6 left without an effect work](../../differences-from-fso.md#the-spells-16-left-without-an-effect-work): Weaken and Poison Dart have effects and train Black Arts.

## Balance notes

- The smallest school bonus (+5, against +10 for Blessing, Wrath and Illusion and +13 for the elements), though the robe doubles it.
- Poison Dart trains Martial Arts as well as Black Arts.
