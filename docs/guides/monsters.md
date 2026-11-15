# Monsters

## What happens in play

A monster can appear on a map, move toward a player, attack and leave loot when defeated. Which monsters can appear depends on the map's roster, while active monsters occupy slots in that roster.

## Where it lives

- [packages/server/src/systems/monsters/ai.ts](../../packages/server/src/systems/monsters/ai.ts): selects movers, authors paths and advances walking.
- [packages/server/src/systems/monsters/attack.ts](../../packages/server/src/systems/monsters/attack.ts): calculates and applies monster attacks.
- [packages/server/src/systems/monsters/npc.ts](../../packages/server/src/systems/monsters/npc.ts): handles NPC interactions and chatter.
- [packages/server/src/systems/monsters/npcfiles.ts](../../packages/server/src/systems/monsters/npcfiles.ts): loads and reads NPC data and flags.
- [packages/server/src/systems/monsters/slots.ts](../../packages/server/src/systems/monsters/slots.ts): defines roster slots, live monsters and their views and properties.
- [packages/server/src/systems/monsters/spawn.ts](../../packages/server/src/systems/monsters/spawn.ts): rolls spawn gates and places monsters in slots.
- [packages/shared/src/rules/monsters/loot.ts](../../packages/shared/src/rules/monsters/loot.ts): rolls monster loot and death drops.

Entry points include `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`), `packages/server/src/systems/monsters/ai.ts` (`moverPass`) and `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`).

## How it works

A map has four roster slots, each holding a roster entry and at most one live monster. During an actor pass, eligible players make spawn passes against that one shared set of slots. Population changes the gate odds; emulated spawn and mover rolls are limited to at most 15 players, while attacks test each player. Loading, death and the delay after entry can prevent a player's pass. An empty slot still needs a valid tile, its own roll, any NPC gate and the species' time gate. A faction map can substitute a faction member in the roster for a pass.

Mover selection also uses population and eligible players. A selected monster may author a random path or lean toward the player; its steps advance over time and blocked steps are skipped. Collision uses the map and, for large creatures, a footprint; a blocking ground item ends the remaining path, but players and other monsters do not block it. Attacks are tested against players; the world tick coordinates walking, attacks and spell collisions. Combat and spell handlers apply hits to shared monster health. A monster dies below zero health; a player’s killing hit determines the experience path and the server rolls its loot. A spell kill gives no experience or loot if its player owner is no longer on the map, or if the caster was a monster or server hazard. Slot state is saved on spawn and death and periodically for health and position. NPC data controls properties such as stillness and chatter, and also supplies shops, biographies, spells and loot. Clicking most NPCs with data opens a Bio without a distance check; special bodies and faction members take their own click paths.

## Kept bugs and differences

The original's fifth monster slot never spawned, leaving at most four live monsters on a map. Some large monsters skip a footprint check near the map edge, and some sea creatures use land spawn checks. An unsuccessful NPC spawn roll can end the pass early. See [monster kept bugs](../bug-ledger.md#monsters) and [monster differences](../divergences.md#monsters).

