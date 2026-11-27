# Staff Fighting

Staff Fighting adds attack power to staves and makes the Fire Staff's free fireballs stronger and more frequent. It is capped like a magic skill.

| | |
|---|---|
| Kind | Weapon |
| Starting value | 1 |
| Rises from | Melee kills with a staff |
| Cap | [Mage cap](README.md#caps) (30 outside the Mage faction) |
| Medal | None |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

**Melee kills** with the Wooden Staff, Steel Staff, Lord's Staff or Gold Staff. The chance is 1 in (Staff Fighting + W); see [melee kills](README.md#melee-kills). The Fire Staff trains nothing.

## What it does

- **Attack power** with any weapon whose name contains "Staff": +1 above 5, 10, 20, 40, 50, 60, 80 and 90, up to +8.
- **Fire Staff fireballs.** Each Fire Staff swing may also launch a fireball (`swingFireballs` in [cast.ts](../../../packages/server/src/systems/spells/cast.ts)). Its power is 1 + random(3) (`castPower.staffFireball` in [balance.json](../../../packages/data/content/balance.json)), then +1 above 20, +2 more above 40, +3 more above 80 and +5 more at 100. It flies when random(power) is above 2, so higher power fires more often, and at 100 it always fires. These fireballs train no skill.

## Connected systems

- **Combat:** attack power ("Staff" block in [attpower.json](../../../packages/data/content/attpower.json)).
- **Spells:** the Fire Staff's free fireballs; see the [spells guide](../spells.md). The Fire Staff also gets the [Fire](fire.md) skill's weapon bonus.

## Differences from 1.6

- [Bolt and Wind Wave train their school; free fireballs train nothing](../../differences-from-fso.md#bolt-and-wind-wave-train-their-school-free-fireballs-train-nothing).
- [Mage skills cap the same from kills and casts](../../differences-from-fso.md#mage-skills-cap-the-same-from-kills-and-casts): Staff Fighting's kill gain uses the Mage cap.

## Balance notes

- Outside the Mage faction it stops at 30, so the Fire Staff's fireball tiers above 40 and 80, and the attack tiers above 40, need Mage faction standing.
- The Fire Staff cannot train the skill that powers it; you train on another staff first.
