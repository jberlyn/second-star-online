# Parry

Parry gives a chance to avoid a melee hit entirely, from monsters and players alike. It rises as you are attacked, and above 50 it lets Block rise.

| | |
|---|---|
| Kind | Defence |
| Starting value | 1 |
| Rises from | Being attacked; the Parry Book |
| Cap | 100; 77 from books |
| Medal | Medal of Evasion at 90: +1 Stamina |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Being attacked in melee**, by a monster or a player. Parry rolls `random(Parry) = 1` while it is from 1 to 99 when a hit lands, when you parry and when a Holy Shield stops the hit (its `defend` progression, `train` in [progress.ts](../../../packages/shared/src/rules/progression/progress.ts)). Neither the combat cap nor the monster cap applies.
- **The Parry Book** adds 2 to 6 (`1 + random(5)`) while Parry is below 77.

## What it does

Each melee hit on you first tries a parry. The chance is 1 in r, where r falls as Parry rises:

| Parry | Chance |
|---|---|
| 20 or less | 1 in 90 |
| Above 20 | 1 in 85 |
| Above 30 | 1 in 80 |
| Above 40 | 1 in 70 |
| Above 50 | 1 in 60 |
| Above 60 | 1 in 50 |
| Above 70 | 1 in 40 |
| Above 80 | 1 in 35 |
| Above 90 | 1 in 31 |
| Above 96 | 1 in 24 |

A member of the Adventurer faction has better odds: 11 in r against monsters and 5 in r against players (the faction's `monsterDodge` and `pvpParry` perks in [social.json](../../../packages/data/content/social.json)). A class can carry the same perks, which add to the faction's; no Classic class does (see [classes](../../modding.md#classes)). A parried hit does no damage and cannot break armour. If the parry fails, [Block](block.md) is tried next. Parry does not stop spells.

Parry above 50 is needed for Block to rise.

## Connected systems

- **Combat:** monster hits (`monsterHitsPlayer`, [combat.ts](../../../packages/shared/src/rules/combat/combat.ts)) and player hits (`pvpHit`, [armour.ts](../../../packages/shared/src/rules/combat/armour.ts)).
- **Social:** the Adventurer faction bonus.
- **Crafting:** the Parry Book is a Cauldron ingredient (with a Ruby Ring, it makes a Ring of Quickness).
- **Bio titles:** Fighter (above 25), Grunt (above 45).

## Differences from 1.6

- [Parry and block work from the first skill point](../../differences-from-fso.md#parry-and-block-work-from-the-first-skill-point): in 1.6 the chance against monsters was 1 in 3000 until Parry passed 10.
- [Holy Shield decides before the dodge rolls](../../differences-from-fso.md#holy-shield-decides-before-the-dodge-rolls).

## Balance notes

- Parry and Block together are a large part of an Adventurer's PvP defence: with both above 96 an Adventurer avoids about 57% of player hits.
- Parry rises fastest at low values and on characters who get hit often.
