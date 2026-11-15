# Progression

## What happens in play

A new character chooses a class and starting stats. As they defeat monsters, experience can raise their level; skills can improve, and a trainer can promote an eligible character. Hunger, regeneration and death affect the character throughout play.

## Where it lives

- [packages/shared/src/rules/progression/creation.ts](../../packages/shared/src/rules/progression/creation.ts): validates creation choices and builds starting characters.
- [packages/shared/src/rules/progression/progression.ts](../../packages/shared/src/rules/progression/progression.ts): calculates experience, levels, regeneration, hunger and death values.
- [packages/shared/src/rules/progression/promotion.ts](../../packages/shared/src/rules/progression/promotion.ts): parses trainer data and checks promotion.
- [packages/shared/src/rules/progression/skillgain.ts](../../packages/shared/src/rules/progression/skillgain.ts): calculates skill caps and kill-based skill gains.
- [packages/shared/src/rules/progression/medals.ts](../../packages/shared/src/rules/progression/medals.ts): checks award conditions.
- [packages/server/src/systems/progression/vitals.ts](../../packages/server/src/systems/progression/vitals.ts): advances regeneration and hunger and handles death and recovery.
- [packages/server/src/systems/progression/medals.ts](../../packages/server/src/systems/progression/medals.ts): applies medal awards and sends updates.

Entry points include `packages/server/src/systems/progression/vitals.ts` (`regenStep`), `packages/server/src/systems/progression/vitals.ts` (`hungerStep`), `packages/server/src/systems/progression/vitals.ts` (`checkDeath`) and `packages/server/src/systems/progression/vitals.ts` (`finishDeath`).

## How it works

Creation validates the name, class and stat choices before producing the starting character. Shared progression rules calculate experience from a kill and check level gains; skill gain uses the fighter, weapon and monster. A trainer’s Bio opens a class list; the server checks the trainer, character and price before charging and applying the promotion. Level-up increases maximum health and spell points without healing. The server checks medals when skills change: a qualifying skill must be exactly at 90, so a gain that skips 90 misses the award. A new award also grants its configured stat points.

The world tick advances hunger and checks for death before the first actor pass advances regeneration. Regeneration uses a session counter that resets on login; hunger warnings can repeat while the counter remains at the warning value. An arena defeat restores one health and spell point and chooses an exit on the same map without the normal death penalty. Normal death handles its messages, possible penalties and drops and passes faction and murder consequences to the relevant systems. Respawn restores the character at the selected point after the death sequence. Character attributes, skills and vitals are persisted; timers and counters used to advance the current session are distinct from that stored state.

## Kept bugs and differences

A level-up discards spare experience and raises at most one level; promotion does not grant the intended skills. The server calculates character growth and runs vitals. More details are in [progression kept bugs](../bug-ledger.md#progression) and [progression differences](../divergences.md#progression). See also [social](social.md) for faction and medal context.

