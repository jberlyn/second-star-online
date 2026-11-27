# Illusion

Illusion is the Illusionist's school: Morph and Illusionary Spikes.

| | |
|---|---|
| Kind | Magic |
| Starting value | 1 |
| Rises from | Casting Morph or Illusionary Spikes; the Illusionist promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting** Morph or Illusionary Spikes rolls `random(Illusion) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting).
- **Promotion to Illusionist** raises it to a roll of 1 to 10 if it is lower.

## What it does

Adds to the power of Morph and Illusionary Spikes: +2 above 0, then +1 above 10, 20, 30, 50, 70, 80, 90 and 97, up to +10 (`power.tables.Illusion` in [spells.json](../../../packages/data/content/spells.json)). Morph's power, rolled as the balance row `buffs.morph` (Classic: `3 + P + random(5)`), picks the monster you appear as (`morphBody` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)): higher power reaches later bodies in the world's morph table (`bodies.morph` in [bindings.json](../../../packages/data/content/bindings.json)).

## Connected systems

- **Spells:** see the [spells guide](../spells.md). [Wizardry](wizardry.md)'s Dispel Illusions removes a Morph.

## Differences from 1.6

- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills): Illusionist now grants Illusion.
- [The bio score counts all its listed skills](../../differences-from-fso.md#the-bio-score-counts-all-its-listed-skills): Illusion did not count in 1.6.
