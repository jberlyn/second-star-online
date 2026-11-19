# Archery

Archery is the bow skill. It rises with every arrow you shoot, to 100 whatever your faction, and below 30 it decides a bow's damage on its own.

| | |
|---|---|
| Kind | Weapon |
| Starting value | Ranger 20, others 1 |
| Rises from | Arrow shots; the Archer promotion |
| Cap | 100 |
| Medal | Silver arrow trophy at 90: +1 Intelligence |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Each arrow shot** rolls `random(Archery) = 1` while Archery is from 1 to 99 (`gainOnShot` in [melee.ts](../../packages/server/src/systems/combat/melee.ts)). A shot needs a bow, arrows of a colour in the off hand and a crystal of that colour, which it uses up. Neither the combat cap nor the monster cap applies, and the shot need not hit anything.
- **Promotion to Archer** raises Archery to a roll of 1 to 10 if it is lower.

Bows and crossbows are listed among the weapons that train Archery on a kill, but arrows fly as spell effects, so an arrow kill never runs the [kill gain](README.md#melee-kills).

## What it does

The attack power of any weapon whose name contains "bow" (bows and crossbows):

| Archery | Power |
|---|---|
| Below 10 | Set to 1 + random(2) |
| 10 to 19 | Set to 2 + random(3) |
| 20 to 29 | Set to 3 + random(4) |
| 30 or more | The bow's own power, arrows and rings, +1 above 29, 40, 50, 60, 70, 80 and 90 (up to +7) |

A Steel Bow adds a further +1 above 70, 80 and 90. Thrust and the power bar are added afterwards. Arrow bonuses run from +1 (Blue) to +7 (White), and the Bowmaster's Ring adds +4 with a bow.

## Connected systems

- **Combat:** bow attack power (the "bow" block in [attpower.json](../../packages/data/content/attpower.json)) and arrow shots ([cast.ts](../../packages/server/src/systems/spells/cast.ts), `shootArrow`).
- **Economy:** each shot uses a crystal.
- **Bio titles:** Apprentice Archer (above 30), Master Archer (above 95).

## Differences from 1.6

- [Weapon attack power matches the right weapons](../differences-from-fso.md#weapon-attack-power-matches-the-right-weapons): the Archery tiers are steps rather than a cascade with a gap at 30, and the Bo's row no longer matches bows.
- [A bow without arrows or crystals refuses the shot](../differences-from-fso.md#a-bow-without-arrows-or-crystals-refuses-the-shot).
- [Class promotions give their skills](../differences-from-fso.md#class-promotions-give-their-skills): Archer now grants Archery.

## Balance notes

- Below 30, the "set" rows replace everything added before them, so the bow, arrows, ring, Strength and faction make no difference until Archery 30.
- Archery is the only weapon skill that ignores both the faction cap and the monster cap; its limit is crystals.
- Crossbows also train [Martial Arts](martial-arts.md) on each shot, and their power depends on Martial Arts as well.
