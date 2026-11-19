# Fire

Fire is the Fire Mage's element. It strengthens the fire spells, and it is the only element that also strengthens weapons: anything with "Fire" in its name.

| | |
|---|---|
| Kind | Magic (element) |
| Starting value | 1 |
| Rises from | Casting fire spells; the Fire Mage promotion |
| Cap | [Mage cap](README.md#caps) |
| Medal | The Scorched Torch at 90: +2 Dexterity, +1 Intelligence |
| Counts towards | Bio score, high scores |

## How it rises

- **Casting** Fireball (in any direction), Firesword or Firebolt rolls `random(Fire) = 1` while it is above 0 and below the Mage cap; see [casting](README.md#casting). The free fireballs from a Fire Staff or a burning sword train nothing.
- **Promotion to Fire Mage** raises it to a roll of 1 to 10 if it is lower.

## What it does

- **Spell power** of Fireball, Firesword and Firebolt: +2 above 0, then +1 above 10, 20, 30, 50 and 70, +2 above 80 and +4 above 97, up to +12 (`elemental` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)). Firesword lasts 40 frames per point of power, and while it lasts each sword swing also launches a fireball.
- **Attack power** of any weapon whose name contains "Fire" (the Fire Sword, Fire Staff and Fire Hammer): +1 above 10, 20, 30 and 40, +2 above 60, 70 and 80, and 1 to 4 above 90, up to +14.

## Connected systems

- **Spells:** see the [spells guide](../spells.md).
- **Combat:** weapon attack power ("Fire" block in [attpower.json](../../../packages/data/content/attpower.json)).

## Differences from 1.6

- [Fireball and Wind Wave get their school bonus](../../differences-from-fso.md#fireball-and-wind-wave-get-their-school-bonus).
- [Bolt and Wind Wave train their school; free fireballs train nothing](../../differences-from-fso.md#bolt-and-wind-wave-train-their-school-free-fireballs-train-nothing).
- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills).
- [The bio score counts every skill](../../differences-from-fso.md#the-bio-score-counts-every-skill): Fire did not count in 1.6.

## Balance notes

- The weapon bonus is one of the largest skill bonuses in the game, yet no weapon trains Fire; it rises only by casting.
- The Fire Mage class itself adds no power. 1.6 read an element bonus for the matching elemental Mage that nothing ever set, and SSO does not build it. The same is true of the other three elements.
