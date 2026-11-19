# Block

Block is a second chance to avoid a melee hit after Parry fails. It needs no shield, and it rises only while Parry is above 50.

| | |
|---|---|
| Kind | Defence |
| Starting value | 1 |
| Rises from | Being attacked, with Parry above 50; the Dragoon promotion |
| Cap | 100 |
| Medal | The Shield Crest at 90: +2 Wisdom |
| Counts towards | Bio score, high scores |

## How it rises

- **Being attacked in melee**, by a monster or a player. Block rolls `random(Block) = 1` while it is from 1 to 99 and Parry is above 50, when a hit lands and when you block (`rollBlockGain` in [combat.ts](../../../packages/shared/src/rules/combat/combat.ts)).
- **Promotion to Dragoon** raises Block to a roll of 1 to 10 if it is lower.

## What it does

When a melee hit is not parried, Block is tried with the same ladder as [Parry](parry.md): 1 in 90 up to 20, falling to 1 in 24 above 96. A member of the Adventurer faction blocks at 11 in r against monsters and players. A blocked hit does no damage.

## Connected systems

- **Combat:** monster and player hits ([combat.ts](../../../packages/shared/src/rules/combat/combat.ts), [armour.ts](../../../packages/shared/src/rules/combat/armour.ts)).
- **Social:** the Adventurer faction bonus.

## Differences from 1.6

- [Parry and block work from the first skill point](../../differences-from-fso.md#parry-and-block-work-from-the-first-skill-point): in 1.6, Block 0 never blocked against players.
- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills): Dragoon now grants Block.

## Balance notes

- No shield is needed, and shields do not affect Block.
- Block is not part of the combat rating, though Parry is.
- Until Parry reaches 51, Block stays where it started (usually 1) unless the Dragoon promotion raises it.
