# Swordsmanship

Swordsmanship adds attack power to swords and opens the way to Fencing. It rises only once Slash is above 50.

| | |
|---|---|
| Kind | Weapon |
| Starting value | 1 |
| Rises from | Melee kills |
| Cap | [Combat cap](README.md#caps) |
| Medal | The Swordsman Plaque at 90: +3 Strength, +2 Stamina |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

**Melee kills** with the Bo, Broad Sword, Dark Scimitar, Dark Sword, Dragon Sword, Fire Sword, Gold Sword, Ice Sword, Katana, Knight's Sword, Laser Sword, Long Sword, Pharaoh Sword, Scimitar, Short Sword, Star Sword, Steel Scimitar, Sword of Hope or Unholy Lance. The chance is 1 in (25 − Stamina + Swordsmanship + W), and a gain also needs Slash above 50. See [melee kills](README.md#melee-kills). A masterwork trains what its weapon trains.

## What it does

Attack power with any weapon whose name contains "Sword": +1 above 20, +1 above 40, +1 above 60, +1 above 80 and +2 above 90, up to +6.

Swordsmanship above 20 is needed for [Fencing](fencing.md) to rise.

## Connected systems

- **Combat:** attack power (the "Sword" block in [attpower.json](../../../packages/data/content/attpower.json)).
- **Promotion:** Dragoon (from Swordsman) needs Swordsmanship 40.
- **Bio titles:** Swordsman (above 50 with Slash above 60), Master Swordsman (above 90 with Fencing and Slash above 80).

## Differences from 1.6

- [Every wieldable sword trains its skills on a kill](../../differences-from-fso.md#every-wieldable-sword-trains-its-skills-on-a-kill): the Steel Scimitar, Dragon Sword and masterworks trained nothing in 1.6.
- [Medals and their stat points come from your skills](../../differences-from-fso.md#medals-and-their-stat-points-come-from-your-skills).

## Balance notes

- The Swordsman Plaque is the largest medal, worth 5 stat points.
- Each point of Stamina takes one off the roll's n, so gains come faster as Stamina rises. Once Stamina reaches 25 + Swordsmanship + W, n falls below 1 and kills cannot raise it at all, so a character with high Stamina and Wisdom can find a low Swordsmanship stuck.
- The Katana, Scimitar, Bo, Dark Scimitar and Unholy Lance train it but do not contain "Sword", so they get no bonus from it.
