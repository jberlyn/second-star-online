# Blessing

Blessing is the healing school. It strengthens the heals and the supportive spells, and it is the Priest's skill.

| | |
|---|---|
| Kind | Magic |
| Starting value | 1 |
| Rises from | Casting healing spells; the Priest promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting** Minor Heal, Major Heal, Replenish, Diminish Hunger or Holy Shield rolls `random(Blessing) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting).
- **Promotion to Priest** raises it to a roll of 1 to 10 if it is lower.

## What it does

Adds to the power of Minor Heal, Major Heal, Bless, Haste and Diminish Hunger: +2 above 0, then +1 above 10, 20, 30, 50, 70, 80, 90 and 97, up to +10 (`tiered` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)). This is on top of [Magery](magery.md)'s base power.

## Connected systems

- **Spells:** see the [spells guide](../spells.md).
- **Progression:** heals restore HP; Diminish Hunger feeds you.
- **Promotion:** Wizard (from Priest) needs Blessing 30.

## Differences from 1.6

- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills): Priest now grants Blessing.
- [The bio score counts every skill](../../differences-from-fso.md#the-bio-score-counts-every-skill): Blessing did not count in 1.6.

## Balance notes

- Replenish and Holy Shield train Blessing but get no power from it; Bless and Haste get power from it but do not train it.
- Wizard needs Blessing 30, which is also the cap outside the Mage faction, so a Priest outside it qualifies only by reaching the cap.
