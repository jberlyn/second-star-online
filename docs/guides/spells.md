# Spells

## What happens in play

A character can learn a spell from a book, then cast it when its requirements are met. A projectile travels through the map and can hit a target; other spells change a character, summon a creature or create an effect on the ground.

## Where it lives

- [packages/server/src/systems/spells/buffs.ts](../../packages/server/src/systems/spells/buffs.ts): advances temporary effects and their timers.
- [packages/server/src/systems/spells/cast.ts](../../packages/server/src/systems/spells/cast.ts): checks casts and creates spell and projectile actions.
- [packages/server/src/systems/spells/collide.ts](../../packages/server/src/systems/spells/collide.ts): applies collisions to players and monsters.
- [packages/server/src/systems/spells/fx.ts](../../packages/server/src/systems/spells/fx.ts): queues, places and advances spell effects.
- [packages/server/src/systems/spells/geometry.ts](../../packages/server/src/systems/spells/geometry.ts): calculates sprite geometry for collision.
- [packages/server/src/systems/spells/hazards.ts](../../packages/server/src/systems/spells/hazards.ts): advances server-timed hazards.
- [packages/server/src/systems/spells/learn.ts](../../packages/server/src/systems/spells/learn.ts): handles learning from books.
- [packages/server/src/systems/spells/monsterspells.ts](../../packages/server/src/systems/spells/monsterspells.ts): handles monster spell choices.
- [packages/shared/src/rules/spells/spellfx.ts](../../packages/shared/src/rules/spells/spellfx.ts): defines effect placement, motion and sprite intersection.
- [packages/shared/src/rules/spells/spells.ts](../../packages/shared/src/rules/spells/spells.ts): defines spell costs, power, targeting and effects.

Entry points include `packages/server/src/systems/spells/cast.ts` (`castIntent`), `packages/server/src/systems/spells/fx.ts` (`placeQueued`) and `packages/server/src/systems/spells/collide.ts` (`playerCollision`).

## How it works

Books can teach spells; casting checks the caster and spell requirements, including costs and any needed materials. A rider cannot cast. The server checks the selected spell and target bounds, then starts the action delay before later checks, so some failed casts still cost that delay. Harmful casts are refused on protected ground; the server checks and removes required crystals and spell points. Shared rules calculate power and effects, while server handlers apply them. Cast messages are queued and placed during a later world tick; effects advance and their sprite geometry determines collisions with players or monsters. Collision handlers apply damage, healing and other effects, with combat and progression handling the resulting deaths and rewards.

Buffs and transformations use timers and server state. A summon uses the first free monster roster slot; monster spells are chosen in the mover pass for an emulated player. The hazard timer uses the configured hazard map and also sends the bell. The client draws and plays sounds for received effects, but the server decides outcomes. Spell content is maintained in [the editable data](../../packages/data/content/).

## Kept bugs and differences

A Portal blocked by a player consumes its cost, and a failed cast can still start the delay, and Fireball and Wind Wave do not receive their school bonus. The server authors spells and checks their collision; Hold is refused on protected maps. See [spell kept bugs](../bug-ledger.md#spells) and [spell differences](../divergences.md#spells) for original quirks and server-side changes.

