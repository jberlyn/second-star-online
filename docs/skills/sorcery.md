# Sorcery

Sorcery is the summoner's skill. Its only effect is to upgrade Summon Creature's Pig to a Cow.

| | |
|---|---|
| Kind | Magic |
| Starting value | 1 |
| Rises from | Casting Summon Creature; the Sorcerer promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting Summon Creature** rolls `random(Sorcery) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting).
- **Promotion to Sorcerer** raises it to a roll of 1 to 10 if it is lower.

## What it does

Summon Creature summons a Pig, or a Cow with Sorcery above 39 (`summon.skilled` on Summon Creature in [spells.json](../../packages/data/content/spells.json)). Sorcery adds nothing to spell power.

## Connected systems

- **Spells and monsters:** the summon takes the first free monster slot; see the [spells guide](../guides/spells.md) and the [monsters guide](../guides/monsters.md).
- **Bio titles:** Sorcerer (above 60 with Magery above 80).

## Differences from 1.6

- [Class promotions give their skills](../differences-from-fso.md#class-promotions-give-their-skills): Sorcerer now grants Sorcery.
- [A summon that cannot go ahead costs nothing](../differences-from-fso.md#a-summon-that-cannot-go-ahead-costs-nothing).

## Balance notes

- Sorcery 40 is above the cap of 30 outside the Mage faction, so only Mage faction members can summon Cows.
- A Pig has a monster skill cap of 10, but a Cow uses the default of 85, so a summoned Cow is a target that can train weapon skills a long way. See [caps](README.md#caps).
