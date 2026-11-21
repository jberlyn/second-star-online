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

Books can teach spells, and a book is used up only when it teaches something. Reading any book first needs its Dexterity; a combat skill book adds 1 plus `random(5)` to its skill, stopping at 77 (`SKILL_BOOK_CAP`). Casting checks the caster and spell requirements, including costs and any needed materials. A rider cannot cast. The server checks the selected spell and that the click is on the playfield, then makes every refusal (harmful spells on protected ground, spells with no effect, SP, crystals, Portal near another player or with no open destination, a summon other than Summon Creature where fighting is off, Raise Dead with no grave on the clicked tile or the one above, a summon off the map or onto a blocked tile, and any summon when all four roster slots are live) before it starts the action delay and removes the crystals and spell points. Shared rules calculate power and effects, while server handlers apply them. Cast messages are queued and placed during a later world tick; effects advance and their sprite geometry determines collisions with players or monsters. Collision handlers apply damage, healing and other effects; the spell-defense rows in the item rules (`armour.spell`) and Magic Shield (minus 5) change the damage a player takes from Arrows, Crush, Meteor, Fireball, Bolt and Wind Wave; Firebolt and Splash ignore them. A harmful spell or arrow on a rider wears the vehicle's hull by a fixed 2 instead (`HULL_HIT_DAMAGE`; see [vehicles](vehicles.md)). Combat and progression handle the resulting deaths and rewards.

Buffs and transformations use timers and server state. A summon uses the first free monster roster slot; monster spells are chosen in the mover pass for an emulated player. The server timer runs every 7 ticks (350 ms): it casts the Server Spirit's fireballs and bolts into the `hazardMap` setting's map (unset by default, so none) and counts the church bell, which plays on map `x999y999` whether or not a hazard map is set. A Firesword recast replaces the power and timer of the one running, so a weaker recast can shorten it. The client draws and plays sounds for received effects, but the server decides outcomes. Spell content is maintained in [the editable data](../../packages/data/content/).

## Differences

Among the spell fixes, refused casts cost nothing, armour and Magic Shield change spell damage, schools train and empower every spell, buffs refresh rather than stack, and books, summons and monster spells behave as 1.6 meant. A few odd behaviours stay on purpose (the Whirlwind drain, the Firesword line, Raise Dead's drop below the grave, Passive healers, monsters' random fireballs). The server authors spells and checks their collision; Hold is refused on protected maps. See the [spell bug fixes](../differences-from-fso.md#spells), [kept behaviours](../differences-from-fso.md#kept-on-purpose) and [server-side spell changes](../differences-from-fso.md#server-side-spells).
