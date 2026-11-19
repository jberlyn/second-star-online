# Unholy Combat

Unholy Combat is the skill of the dark weapons: the Dark Sword, Dark Scimitar and Unholy Lance. It is capped like a magic skill, not a weapon skill.

| | |
|---|---|
| Kind | Weapon |
| Starting value | 1 |
| Rises from | Melee kills with dark weapons; the Unholy Combat Book |
| Cap | [Mage cap](README.md#caps) on kills (30 outside the Mage faction); 77 from books |
| Medal | None |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Melee kills** with the Dark Sword, Dark Scimitar or Unholy Lance. The chance is 1 in Unholy Combat: Wisdom does not help. See [melee kills](README.md#melee-kills).
- **The Unholy Combat Book** adds 1 to 5 while the skill is below 77. Since books ignore the Mage cap, this is the way past 30 outside the Mage faction.

## What it does

Attack power:

| Weapon | Above 10 | 20 | 40 | 60 | 70 | 90 | 98 | Most |
|---|---|---|---|---|---|---|---|---|
| Any "Dark " weapon | +1 | +1 | +1 | +1 | +1 | +2 | +2 | +9 |
| Unholy Lance | +1 | +1 | +1 | +2 | | +3 | +4 | +12 |

"Dark " with its space matches the Dark Sword, Dark Scimitar and Dark Staff.

## Connected systems

- **Combat:** attack power (`skillBlocks` in [attpower.json](../../../packages/data/content/attpower.json)).
- **Bio titles:** Death Knight (above 60 with Magery above 80).

## Balance notes

- Its kill gain ignores Wisdom, so it is faster than other weapon skills at low Wisdom and slower at high Wisdom.
- The Dark Staff gets the "Dark " bonus but trains Staff Fighting, not Unholy Combat.
- No class grants it, and the Death Knight class has no promotion path.
