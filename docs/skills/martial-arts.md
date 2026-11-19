# Martial Arts

Martial Arts is the ninja's skill. It boosts bare hands, the Katana, Scimitar, Bo and crossbows, and it sets the strength of Smoke Bomb. Casting and crossbow shots raise it to 100 whatever your faction.

| | |
|---|---|
| Kind | Weapon and magic |
| Starting value | 1 |
| Rises from | Melee kills; Smoke Bomb casts; crossbow shots |
| Cap | [Combat cap](README.md#caps) on kills; 100 from casts and shots |
| Medal | Oraku's sash at 90: +1 Strength, +2 Intelligence, +1 Wisdom |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Melee kills** with no weapon, the Katana, the Scimitar or the Bo. The chance is 1 in (Martial Arts + W); see [melee kills](README.md#melee-kills).
- **Casting Smoke Bomb** rolls `random(Martial Arts) = 1` up to 100 (after the usual Magery roll); see [casting](README.md#casting).
- **Each crossbow shot** rolls `random(Martial Arts) = 1` up to 100, alongside Archery.

## What it does

**Attack power:**

| Weapon | Above 10 | 20 | 40 | 60 | 70 | 90 | 98 | Most |
|---|---|---|---|---|---|---|---|---|
| No weapon | | +1 | +1 | +1 | +1 | +1 | +1 | +6 |
| Katana | +1 | +1 | +1 | +1 | | +1 | +1 | +6 |
| Scimitar | +1 | +1 | +1 | | +1 | +2 | +2 | +8 |
| Bo | +1 | +1 | +1 | | +1 | +1 | +1 | +6 |

Crossbows start lower and climb with Martial Arts: the Wooden Crossbow takes −4, then +1 above every ten from 10 to 90 (net up to +5); the Silver Crossbow takes −6, then +1 above 10 to 60, +2 above 70 and 80, and 1 to 4 above 90 (net +5 to +8).

**Smoke Bomb power** replaces the usual spell power: 25 below 10, 35 from 10, 45 from 20, 55 from 30, 60 from 40, 70 from 50, 100 from 60, 200 from 70, 350 from 80 and 500 from 90, plus 60 in a Ninja Outfit or 80 in a Royal Ninja Uniform (`martialArts` in [spells.ts](../../packages/shared/src/rules/spells/spells.ts)). The power is the number of frames the Smoke Bomb lasts.

## Connected systems

- **Combat:** attack power ([attpower.json](../../packages/data/content/attpower.json)).
- **Spells:** Smoke Bomb power and gains; see the [spells guide](../guides/spells.md).
- **Inventory:** the Ninja Outfit and Royal Ninja Uniform add Smoke Bomb power and lower its SP cost.
- **Promotion:** Paladin (from Ninja) needs Martial Arts 35.
- **Bio titles:** Apprentice Ninja (above 10), Novice Ninja (above 40), Master Ninja (above 90).
- **World:** the Ninja Master Platform blocks you until Martial Arts 90.

## Differences from 1.6

- [Smoke Bomb in a body named "Ninja" costs 25](../differences-from-fso.md#smoke-bomb-in-a-body-named-ninja-costs-25).

## Balance notes

- Like Archery, it can reach 100 outside the Warrior faction, through Smoke Bomb or a crossbow.
- Smoke Bomb power jumps steeply from 60 upwards (100, 200, 350, 500).
