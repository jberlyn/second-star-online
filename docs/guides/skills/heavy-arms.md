# Heavy Arms

Heavy Arms is the skill for big weapons: axes, hammers and the larger swords. It only starts rising from kills once Thrust is above 60.

| | |
|---|---|
| Kind | Weapon |
| Starting value | 1 |
| Rises from | Melee kills; the Heavy Arms Book |
| Cap | [Combat cap](README.md#caps) on kills; 77 from books |
| Medal | The Golden Hammer at 90: +2 Strength |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Melee kills** with any axe, Blacksmith Hammer, Broad Sword, Dark Sword, Fire Hammer, Fire Sword, Hammer, Ice Hammer, Ice Sword, Knight's Sword, Long Sword, Mining Hammer, Rune Sword, Sword of Hope, Thor's Hammer or Unholy Lance. The chance is 1 in (Heavy Arms + W), and a gain also needs Thrust above 60. See [melee kills](README.md#melee-kills).
- **The Heavy Arms Book** adds 1 to 5 while Heavy Arms is below 77. It is the practical way to start, since kills cannot raise it until Thrust passes 60.

## What it does

Attack power with these weapons:

| Weapon | Above 10 | 20 | 40 | 60 | 70 | 90 | 98 | Most |
|---|---|---|---|---|---|---|---|---|
| Any "Axe", any "Hammer", Long Sword, Sword of Hope, Gold Sword | +1 | +1 | | +1 | +1 | +1 | +1 | +6 |
| Broad Sword | +1 | +1 | +1 | | +1 | +1 | +1 | +6 |

## Connected systems

- **Combat:** attack power (`skillBlocks` in [attpower.json](../../../packages/data/content/attpower.json)).
- **Bio titles:** Gladiator (above 70 with Thrust above 60).

## Differences from 1.6

- [Weapon attack power matches the right weapons](../../differences-from-fso.md#weapon-attack-power-matches-the-right-weapons): the Gold Sword's Heavy Arms block runs once and the Mining Hammer row is spelt right.
- [Books teach what they say, and stay when they teach nothing](../../differences-from-fso.md#books-teach-what-they-say-and-stay-when-they-teach-nothing).

## Balance notes

- Several weapons train Heavy Arms without benefiting from it (Knight's Sword, Rune Sword, Ice Sword, Fire Sword, Dark Sword, Unholy Lance), and the Gold Sword benefits without training it.
- A Mining Hammer trains Heavy Arms and gets its bonus, through the "Hammer" block.
