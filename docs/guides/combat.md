# Combat

## What happens in play

Holding an attack builds power; a swing can hit a nearby monster or another player if the relevant rules allow it.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/combat/arena.ts](../../packages/server/src/systems/combat/arena.ts): handles arena challenge and exit.
- [packages/server/src/systems/combat/melee.ts](../../packages/server/src/systems/combat/melee.ts): handles melee attacks and their effects.
- [packages/shared/src/rules/combat/arena.ts](../../packages/shared/src/rules/combat/arena.ts): defines arena checks and placement.
- [packages/shared/src/rules/combat/armour.ts](../../packages/shared/src/rules/combat/armour.ts): calculates player mitigation and equipment break rolls.
- [packages/shared/src/rules/combat/attpower.ts](../../packages/shared/src/rules/combat/attpower.ts): assembles attack power.
- [packages/shared/src/rules/combat/combat.ts](../../packages/shared/src/rules/combat/combat.ts): defines swing timing, reach and damage helpers.
- [packages/shared/src/rules/combat/gear.ts](../../packages/shared/src/rules/combat/gear.ts): provides equipment-derived combat values.

Entry points:

- `packages/shared/src/rules/combat/armour.ts` (`pvpHit`).
- `packages/server/src/systems/combat/melee.ts` (`pollAttack`).
- `packages/server/src/systems/combat/arena.ts` (`challenge`).

## How it works

Attack timers gate swings and the power bar contributes to attack power. Equipment, skills and other fighter attributes feed the assembled attack; reach and targeting decide which target receives it. Monster damage and player-versus-player damage use different paths. The PvP path applies its own gates and mitigation, including defensive outcomes, armour and random defence. Equipment breaks only in fights with monsters: the weapon rolls when you hit one, and the armour when one hits you. Invulnerability prevents repeated hits during its protected interval.

A lethal hit passes credit and consequences to the relevant monster or player lifecycle. Spells and progression have their own systems; melee does not own those lifecycles. Arena challenges check eligibility and locate an arena and exit rather than making every map a fighting area.

### From input to damage

On a fight map, or on an arena tile of a no-fight map, a held attack swings when its cooldown permits; elsewhere on a no-fight map the refusal is said once per press. Hold stops swings as well as steps, and a bow with no arrows or no matching crystal is refused before the swing starts. The attack bar and the equipped weapon affect the swing's power and timing. Shared gear and attack-power rules read the fighter's equipment and skills, while server melee uses the player's actual position and facing to find targets.

The monster and PvP paths differ. Against another player, the shared mitigation path can produce parry, block or shield outcomes before damage; armour, elemental and faction modifiers and a random defence roll contribute. Invulnerability and the target's state affect whether a hit is accepted. A hit on a monster passes damage and kill processing to the monster system; player deaths, murder consequences, spell effects and progression have their own handlers. A swing that reaches both a monster and a player hits both. A role with the `invulnerable` permission takes no damage from either path, or from spells and starving.

Arena challenge and quit are chat-triggered actions. Shared checks determine whether the challenge can proceed, pick a free arena tile and select an exit; the server moves the players and never puts one on a tile another player, a monster or a blocking item holds. Hold and the wait after death refuse a challenge, and `quit` on an arena tile; `quit` while mid-step says to stand still, and `quit` standing off an arena tile does nothing. An Airship rider cannot challenge and is never in the arena, even over its tiles, so `quit` aboard does nothing. The server's arena exit selection avoids hanging if an exit cannot be found.

## Differences from 1.6

See the [combat bugs fixed](../differences-from-fso.md#combat) and [server-side combat changes](../differences-from-fso.md#server-side-combat).
