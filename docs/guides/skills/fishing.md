# Fishing

Fishing is casting a line into water for fish. Higher skill catches more often and catches better fish.

| | |
|---|---|
| Kind | Gathering |
| Starting value | 1 |
| Rises from | Casting a line |
| Cap | 100 |
| Medal | The Golden Rod at 90: +1 Intelligence |
| Counts towards | Bio score, high scores |

## How it works

Equip a weapon whose name contains "Fishing" and swing while facing water (`W1`, `N1`, `D2` or `I2`, on either layer). A Fishing Pole waits 20 frames between casts, less the Ring of Quickness's speed-up. Each cast bites at 1 in n:

| Fishing | Bite chance |
|---|---|
| 10 or less | 1 in 30 |
| 11 to 20 | 1 in 28 |
| 21 to 30 | 1 in 24 |
| 31 to 40 | 1 in 20 |
| 41 to 50 | 1 in 16 |
| 51 to 60 | 1 in 14 |
| 61 to 70 | 1 in 12 |
| 71 to 80 | 1 in 10 |
| 81 to 90 | 1 in 8 |
| Above 90 | 1 in 5 |

You catch one kind of fish for your skill (`fishFor`): Raw Fish below 15, Trout from 15, Catfish from 40, Swordfish from 60 and Squid from 80.

Each tile you fish from allows 5 catches (`antiMacroStart`). Then the fish stop biting there until you fish from a different tile.

## How it rises

Every cast rolls `random(16) = 1` while Fishing is from 0 to 99 and the tile still has catches left (`castLine` in [gather.ts](../../../packages/shared/src/rules/crafting/gather.ts)). A cast need not catch anything to raise the skill.

## Connected systems

- **Crafting:** fish are [Cooking](cooking.md)'s ingredients.
- **Combat:** swing speed and the Ring of Quickness ([combat.ts](../../../packages/shared/src/rules/combat/combat.ts), `swingCooldowns`).
- **Bio titles:** Apprentice Fisherman (above 10), Novice Fisherman (above 40), Master Baiter (above 90).

See the [crafting guide](../crafting.md).

## Differences from 1.6

- [Fishing at skill 0 can catch fish](../../differences-from-fso.md#fishing-at-skill-0-can-catch-fish).
- [Fishing skill-ups do not use the anti-macro allowance](../../differences-from-fso.md#fishing-skill-ups-do-not-use-the-anti-macro-allowance).
- [The fishing allowance belongs to the tile you fish from](../../differences-from-fso.md#the-fishing-allowance-belongs-to-the-tile-you-fish-from).
- [Water on either layer can be fished](../../differences-from-fso.md#water-on-either-layer-can-be-fished).
- [The Ring of Quickness speeds up a fishing pole](../../differences-from-fso.md#the-ring-of-quickness-speeds-up-a-fishing-pole).

## Balance notes

- A higher skill replaces the fish you catch rather than adding to them: a Fishing 90 character catches only Squid.
- Gains come from casts, not catches, so the gain rate does not improve as the bite chance does.
