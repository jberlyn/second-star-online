# Punch

Punch is the bare-handed fighting skill. With no weapon, attack power grows with Punch, Martial Arts and character level.

| | |
|---|---|
| Kind | Weapon |
| Starting value | 1 |
| Rises from | Melee kills with no weapon |
| Cap | [Combat cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

**Melee kills** with nothing in the weapon hand. The chance is 1 in (Punch + W); see [melee kills](README.md#melee-kills). The same kills train [Martial Arts](martial-arts.md).

## What it does

Bare-handed attack power, on top of the base of 1 and the Strength tiers:

| Source | Bonus |
|---|---|
| Punch | +1 above 5, 10, 30, 40, 60, 70 and 90 (up to +7) |
| Martial Arts | +1 above 20, 40, 60, 70, 90 and 98 (up to +6) |
| Level | +1 above 3, 5, 9, 14, 21 and 50 (up to +6) |

## Connected systems

- **Combat:** attack power (the "nothing" block in [attpower.json](../../../packages/data/content/attpower.json)).
- **Bio titles:** Brawler (above 25), Boxer (above 45).

## Balance notes

- Bare hands are the only attack that grows with level.
