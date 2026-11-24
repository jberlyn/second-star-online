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
- [packages/shared/src/content/bodies.ts](../../packages/shared/src/content/bodies.ts): who draws each body number, the body sheet, frame anchors and checks, and the draft rows an uploaded body writes (issue #29).

Entry points include `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`), `packages/server/src/systems/monsters/ai.ts` (`moverPass`) and `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`).

## How it works

A map has four roster slots, each holding a roster entry and at most one live monster. During an actor pass, eligible players make spawn passes against that one shared set of slots. Population changes the gate odds; emulated spawn and mover rolls are limited to at most 15 players, while attacks test each player. Loading, dying (`dontHitMeAgain`) and the delay after entry can prevent a player's pass. An empty slot still needs its pause at 0 (set to 30 on a spawn or a move pick and to 90 on each step), a valid tile, its own roll, any NPC gate and the species' time gate. A faction map can substitute its faction's `member` species in the roster for a pass. The gate odds, the move pick, a walk's length, each slot's roll, the faction slot pick and the NPC gate are the `monsters` balance row (the Balance page's Monsters card; Classic keeps 1.6's numbers).

Mover selection also uses population and eligible players. A selected monster either draws a random walk or, when it is hostile (a whole entry of the World Editor's monster list, or `rules.hostile`), chases that player, choosing each step toward where they stand as the step starts. Its steps advance over time and blocked steps are skipped. Collision uses the map and, for large creatures, a footprint; players and other monsters block a step too, and a blocking ground item ends the remaining walk. Sea creatures (`rules.sea`) spawn and move only on water. Attacks are tested against players: once a pass, each monster rolls 1 in 10 for each player it reaches. A monster melees only on a map where fighting is on, except an Officer facing a wanted player; a trap (the Web's `trap` flag) or a name with no attack entry never attacks, a `FLG|Passive` NPC attacks only once provoked, a Holy Shield never hits an innocent player, and a rider, a role with `invulnerable` or a player still blinking from a hit takes no blow. The world tick coordinates walking, attacks and spell collisions. Combat and spell handlers apply hits to shared monster health. A monster dies below zero health; a player's killing hit, melee or spell, determines the experience path, sends any kill broadcast (such as the Overlord's) and the server rolls its loot; only a melee kill rolls weapon skill gain. A spell kill gives no experience or loot if its player owner is no longer on the map, or if the caster was a monster or server hazard. Slot state is saved on spawn and death and periodically for health and position. A monster with no NPC data never moves, nor does an `immobile` species (Classic: the Spikes, Web and Holy Shield). The mechanics 1.6 tied to body numbers are species `flags` in `monsters.json` (see the [modding guide](../modding.md#species-flags)). NPC data controls properties such as stillness and chatter, and also supplies shops, biographies, spells and loot. Clicking an NPC whose data has something to show opens its Bio from anywhere on the screen; `unclickable` species and faction members take their own click paths, and clicking a `grabbable` species (Classic: a Pig) on your faced tile, or pressing Ctrl facing it, grabs it as its item, at most once every 500 frames and not into a full bag. An NPC with `RND|` lines says one to the whole map every `npcChatter`. Every species has hit points in `monsters.json` (1 where 1.6 gave none); one with no attack entry never melees.

## Differences from 1.6

The original's fifth monster slot never spawned, and SSO keeps four slots on purpose (see [A map holds four monsters](../differences-from-fso.md#a-map-holds-four-monsters)). See the [monster bugs fixed](../differences-from-fso.md#monsters) and [server-side monster changes](../differences-from-fso.md#server-side-monsters).
