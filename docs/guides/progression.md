# Progression

## What happens in play

A new character chooses a class and starting stats. As they defeat monsters, experience can raise their level; skills can improve, and a trainer can promote an eligible character. Hunger, regeneration and death affect the character throughout play.

## Where it lives

- [packages/shared/src/rules/progression/creation.ts](../../packages/shared/src/rules/progression/creation.ts): validates creation choices and builds starting characters.
- [packages/shared/src/rules/progression/progression.ts](../../packages/shared/src/rules/progression/progression.ts): calculates experience, levels, regeneration, hunger and death values.
- [packages/shared/src/rules/progression/promotion.ts](../../packages/shared/src/rules/progression/promotion.ts): parses trainer data and checks promotion.
- [packages/shared/src/rules/progression/skillgain.ts](../../packages/shared/src/rules/progression/skillgain.ts): calculates skill caps and kill-based skill gains.
- [packages/shared/src/rules/progression/medals.ts](../../packages/shared/src/rules/progression/medals.ts): calculates held medals, their stat bonus and the award lines from skills.
- [packages/server/src/systems/progression/vitals.ts](../../packages/server/src/systems/progression/vitals.ts): advances regeneration and hunger and handles death and recovery.
- [packages/server/src/systems/progression/medals.ts](../../packages/server/src/systems/progression/medals.ts): prints a medal's line when a skill reaches 90 in play.

Entry points include `packages/server/src/systems/progression/vitals.ts` (`regenStep`), `packages/server/src/systems/progression/vitals.ts` (`hungerStep`), `packages/server/src/systems/progression/vitals.ts` (`checkDeath`) and `packages/server/src/systems/progression/vitals.ts` (`finishDeath`).

## How it works

Creation validates the name, class and stat choices before producing the starting character. Shared progression rules calculate experience from a kill and check level gains; skill gain uses the fighter, weapon and monster. A trainer’s Bio opens a class list; the server checks the trainer, character and price before charging and applying the promotion, which raises the class's granted skills (`skillGrants` in `classes.json`) to a roll of 1 to 10 without lowering any. Each level reached by a kill adds 1 to maximum health and spell points without healing, and spare experience carries over, so one kill can raise several levels. Mage skills share one cap table for kills and casts. Stats are calculated (`statsOf`): the allocated stats plus the current class's `statBonus` plus the points of every medal held. Medals are not granted: every skill at 90 or more shows its medal on the bio and adds its points, and both go if the skill drops below 90. Reaching 90 in play prints the medal's line.

The world tick advances hunger and checks for death before the first actor pass advances regeneration. Regeneration uses a session counter that resets on login and at the end of every period, whatever the hunger; each hunger warning prints once, as hunger drops onto it. An arena defeat restores one health and spell point and chooses an exit on the same map without the normal death penalty. Normal death handles its messages, drops, the maximum HP and SP penalty (on PvP maps only) and the loss of a rider's airship, and passes faction and murder consequences to the relevant systems; a death more than `KILL_CREDIT_TICKS` after the last hit credits no killer. Respawn restores the character at the selected point after the death sequence. Character attributes, skills and vitals are persisted; timers and counters used to advance the current session are distinct from that stored state.

## Differences from 1.6

See the [progression bugs fixed](../differences-from-fso.md#progression). A death never lowers maximum HP or SP (see [the design change](../differences-from-fso.md#a-death-never-lowers-your-maximum-hp-or-sp)), and by default only a wanted character drops gold or an item; operators choose [whose deaths drop](../differences-from-fso.md#operators-choose-whose-deaths-drop-and-by-default-only-a-wanted-characters-do). Classes and promotions are being rethought in [issue #15](https://github.com/jberlyn/second-star-online/issues/15). Every new character starts at 20 HP and 20 SP whatever the class, which is [kept on purpose](../differences-from-fso.md#every-new-character-starts-with-20-hit-points-and-20-spell-points). The server calculates character growth and runs vitals. See the [server-side progression changes](../differences-from-fso.md#server-side-progression), and [social](social.md) for faction and medal context.
