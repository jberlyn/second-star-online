# Magery

Magery is the core magic skill. Every spell's power starts from it, and every cast can raise it. Outside the Mage faction it stops at 30.

| | |
|---|---|
| Kind | Magic |
| Starting value | Mage 30, Ranger 10, others 1 |
| Rises from | Casting any spell; the Paladin promotion |
| Cap | [Mage cap](README.md#caps): 30 outside the Mage faction, 50 to 100 inside it |
| Medal | Purple Oracula at 90: +1 Dexterity |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Casting.** Each of your own casts rolls `random(Magery) = 1` while Magery is above 0 and below the Mage cap (`spellImp` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)). Wisdom does not help. The free fireballs from a Fire Staff or Firesword, arrows and other non-spell effects do not count.
- **Promotion to Paladin** raises Magery to a roll of 1 to 10 if it is lower.

Killing monsters does not raise Magery.

## What it does

**Base spell power** for every spell (`basePower`): 1, +1 above 10, 20, 30, 40, 50, 60, 70, 80 and 90 (up to 10). The Mage faction bonus and worn gear add to it: White Robe +2, Wizard's Robe +5, White Tiara +1, Ceramic Armor +5 and Mage's Ring +3 (`gear` in [item-rules.json](../../../packages/data/content/item-rules.json)). A school skill then adds its own bonus; see [Blessing](blessing.md), [Wrath](wrath.md), [Illusion](illusion.md), [Black Arts](black-arts.md) and the elements ([Fire](fire.md), [Water](water.md), [Wind](wind.md), [Earth](earth.md)). Smoke Bomb ignores Magery: [Martial Arts](martial-arts.md) sets its power.

Spell power sets damage and healing, and how long buffs such as Magic Shield, Stone Skin, Firesword and Hold last.

No spell needs Magery to cast. Learning a spell from a book needs Dexterity instead.

## Connected systems

- **Spells:** base power and gains; see the [spells guide](../spells.md).
- **Social:** the Mage faction sets the cap and adds its bonus to spell power.
- **Promotion:** Illusionist (from Mage) and Priest (from Mage or Ranger) need Magery 30; Fire, Water, Wind and Earth Mage (from Paladin, Sorcerer or Death Knight) need Magery 70.
- **Bio titles:** Apprentice Mage (above 20), Novice Mage (above 40), Master Mage (above 90); Sorcerer, Wizard, Necromancer and Death Knight each need Magery above 80.
- **World:** the Mage Master Platform blocks you until Magery 90.

## Differences from 1.6

- [Mage skills cap the same from kills and casts](../../differences-from-fso.md#mage-skills-cap-the-same-from-kills-and-casts).
- [Bolt and Wind Wave train their school; free fireballs train nothing](../../differences-from-fso.md#bolt-and-wind-wave-train-their-school-free-fireballs-train-nothing).
- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills): Paladin now grants Magery.

## Balance notes

- A Mage starts at 30, the cap outside the Mage faction, so a Mage who has not joined the faction never gains Magery.
- The elemental Mage promotions need Magery 70, which takes a Mage faction bonus of 2 or more. The medal and the Mage Master Platform need 90, a bonus of 3 or more.
