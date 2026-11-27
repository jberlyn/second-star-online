# Slash

Slash is the basic edged-weapon skill. Almost every blade, axe and hammer trains it, but it adds attack power only to swords, knives and daggers. It also opens the way to Thrust and Swordsmanship gains.

| | |
|---|---|
| Kind | Weapon |
| Starting value | Fighter 20, Ranger 10, others 1 |
| Rises from | Melee kills; the Slash Book |
| Cap | [Combat cap](README.md#caps) on kills; 77 from books |
| Medal | Medal of Weaponry at 90: +1 Strength |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Melee kills** with any of these weapons: Axe (and any name containing "Axe"), Bo, Broad Sword, Dagger, Dark Scimitar, Dark Sword, Dragon Sword, Fire Sword, Gold Sword, Hammer, Ice Sword, Katana, Knife, Knight's Sword, Laser Sword, Long Sword, Pharaoh Sword, Scimitar, Short Sword, Star Sword, Steel Scimitar, Sword of Hope, Thor's Hammer, Unholy Lance. The chance is 1 in (Slash + W); see [melee kills](README.md#melee-kills). A masterwork trains what its weapon trains (Knight's Sword +2 as the Knight's Sword).
- **The Slash Book** adds 2 to 6 (`1 + random(5)`) while Slash is below 77.

## What it does

Attack power with a weapon whose name contains:

| Weapon | Above 5 | 10 | 20 | 30 | 50 | 70 | 80 | 90 | Most |
|---|---|---|---|---|---|---|---|---|---|
| "Sword" | | +1 | +1 | | | +1 | +1 | +2 | +6 |
| "Knife" | +1 | +1 | | +1 | +1 | | +1 | +2 | +7 |
| "Dagger" | +1 | +1 | | +1 | +1 | | +1 | +1 to 5 | +6 to 10 |

A masterwork keeps these tiers, since its name still contains "Sword".

Slash also gates other gains: Thrust can rise from kills only with Slash above 30, and Swordsmanship only with Slash above 50.

## Connected systems

- **Combat:** attack power ([attpower.json](../../../packages/data/content/attpower.json), `skillBlocks`); see the [combat guide](../combat.md).
- **Promotion:** Grunt (from Fighter) needs Slash 30; Barbarian (from Grunt or Brawler) needs Slash 60.
- **Bio titles:** Fighter (above 25), Grunt (above 45), Swordsman (above 60 with Swordsmanship above 50), Jouster (above 60 with Thrust above 50), Master Swordsman (above 80 with Fencing above 80 and Swordsmanship above 90).
- **World:** the Slash Master Platform blocks you until Slash 90.

## Differences from 1.6

- [Books teach what they say, and stay when they teach nothing](../../differences-from-fso.md#books-teach-what-they-say-and-stay-when-they-teach-nothing): the Slash Book stops at 77.
- [Medals and their stat points come from your skills](../../differences-from-fso.md#medals-and-their-stat-points-come-from-your-skills).
- [Every wieldable sword trains its skills on a kill](../../differences-from-fso.md#every-wieldable-sword-trains-its-skills-on-a-kill): the Steel Scimitar, Dragon Sword and masterworks trained nothing in 1.6.

## Balance notes

- Axes, hammers, the Katana, Scimitar, Bo, Dark Scimitar and Unholy Lance train Slash but gain no attack power from it.
- Fighters start at 20, so they already have the first sword tier (above 10); the second needs Slash above 20.
