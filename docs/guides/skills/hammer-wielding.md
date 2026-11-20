# Hammer Wielding

Hammer Wielding gives the largest attack bonus of any weapon skill, to every weapon whose name contains "Hammer", tools included.

| | |
|---|---|
| Kind | Weapon |
| Starting value | 1 |
| Rises from | Melee kills with a hammer; the Barbarian promotion |
| Cap | [Combat cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Melee kills** with the Hammer, Thor's Hammer, Mining Hammer, Ice Hammer, Fire Hammer or Blacksmith Hammer. The chance is 1 in (40 − Stamina + Hammer Wielding + W); see [melee kills](README.md#melee-kills). The War Hammer trains nothing.
- **Promotion to Barbarian** raises it to a roll of 1 to 10 if it is lower.

## What it does

Attack power with any weapon whose name contains "Hammer": +1 above 10, 15, 20, 30, 45, 50 and 60, then +2 above 70, 80 and 90, up to +13. [Heavy Arms](heavy-arms.md) adds to the same weapons.

## Connected systems

- **Combat:** attack power ("Hammer" block in [attpower.json](../../../packages/data/content/attpower.json)).
- **Gathering and crafting:** the Mining, Ice and Fire Hammers and the Blacksmith Hammer are tools, and killing with them trains this skill.
- **Bio titles:** Hammer Wielder (above 30), Hammer Master (above 90).

## Differences from 1.6

- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills): Barbarian now grants Hammer Wielding.

## Balance notes

- The War Hammer benefits from the skill but cannot train it.
- High Stamina slows gains; with Stamina at or above 40 + skill + W it cannot rise from kills.
