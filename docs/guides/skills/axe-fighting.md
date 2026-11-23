# Axe Fighting

Axe Fighting makes axes swing faster. It is the only weapon skill that changes speed rather than damage.

| | |
|---|---|
| Kind | Weapon |
| Starting value | 1 |
| Rises from | Melee kills with an axe |
| Cap | [Combat cap](README.md#caps) |
| Medal | None |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

**Melee kills** with any weapon whose name contains "Axe" (Axe, Gold Axe). The chance is 1 in (Axe Fighting + W); see [melee kills](README.md#melee-kills).

## What it does

The attack delay of any weapon containing "Axe", in frames between swings (the `axe` ladder in `item-rules.json` `ladders`, read by `swingCooldowns` in [combat.ts](../../../packages/shared/src/rules/combat/combat.ts)). Other weapons wait 14, or 10 with a Ring of Quickness.

| Axe Fighting | Delay |
|---|---|
| Below 10 | 25 |
| 10 to 19 | 22 |
| 20 to 29 | 21 |
| 30 to 39 | 20 |
| 40 to 49 | 19 |
| 50 to 59 | 18 |
| 60 to 69 | 17 |
| 70 to 79 | 16 |
| 80 to 89 | 15 |
| 90 or more | 14, or 10 with a Ring of Quickness |

Below 90 the ladder replaces the ring's speed-up.

Swinging an axe at a tree is also how [Lumberjacking](lumberjacking.md) works, so Axe Fighting sets how fast you chop.

## Connected systems

- **Combat:** swing speed (`swingCooldowns`); see the [combat guide](../combat.md).
- **Gathering:** chopping speed with an axe.

## Differences from 1.6

- [Axe and Mining Hammer speeds follow their skill ladders](../../differences-from-fso.md#axe-and-mining-hammer-speeds-follow-their-skill-ladders): in 1.6 every Axe Fighting below 90 gave 15.

## Balance notes

- Even at 90 an axe is no faster than any other weapon; below 90 it is slower. Axe Fighting has no medal or title.
