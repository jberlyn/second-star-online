# Bug ledger

Gameplay bugs in First Star Online 1.6 that Second Star Online **keeps on purpose**. The policy is to keep every gameplay bug and to close only the exploits that harm the server or other players. Each entry says what a player notices, what 1.6 did, where the behaviour lives in the code, and which tests pin it. At the end, "Not in SSO" lists what 1.6 did that cannot happen under server authority, and what 1.6 never reached.

- Exploits that were closed live in [`docs/divergences.md`](divergences.md), not here.

**Entry shape.** A kept bug:

```
### A weaker player still shoves you
- **What you notice:** walk into a player who is standing still and now and then (1 blocked step in 25)
  you push them a tile. If you are weaker than them they read "… is too weak", and then
  "… shoves you out of the way." and move anyway.
- **In 1.6 and SSO:** the "too weak" check prints its line but doesn't stop the shove. Immortals and
  players whose keys are held by a window are never pushed.
- **In the code:** `packages/server/src/systems/movement/push.ts` (`pushOnMe`)
- **Pinned by:** `kept bug: a weaker pusher is 'too weak' and still shoves` (packages/server/tests/push.test.ts); `walking into a standing player can push them` (packages/server/e2e/chat-and-presence.test.ts)
```

And an item under "Not in SSO":

```
- **The airship picture lingered after death.** 1.6 left a dead rider drawn as the airship until each
  viewer's screen happened to reset it (a 1-in-50 roll per frame). SSO's server resets it for everyone
  at the moment of death (`packages/server/src/systems/vehicles/airship.ts`, `vehicleDeath`).
```

The `In the code:` paths and identifiers are checked by the gate (`tests/doc-paths.test.ts`). Every kept bug should name the tests that pin it.

## Index

| Section | Kept bugs |
|---|---|
| [admin](#admin) | 0 |
| [casino](#casino) | 0 |
| [chat](#chat) | 0 |
| [client](#client) | 0 |
| [combat](#combat) | 0 |
| [crafting](#crafting) | 0 |
| [economy](#economy) | 0 |
| [housing](#housing) | 0 |
| [inventory](#inventory) | 0 |
| [mail](#mail) | 0 |
| [monsters](#monsters) | 21 |
| [movement](#movement) | 7 |
| [progression](#progression) | 11 |
| [social](#social) | 18 |
| [spells](#spells) | 25 |
| [vehicles](#vehicles) | 0 |
| [world](#world) | 5 |
| [Not in SSO](#not-in-sso) | 41 |
| **Total** | **128** |

## admin

No kept bugs (all nine former entries were fixed; see [admin differences](divergences.md#admin)).

## casino

No kept bugs (all fourteen former entries were fixed; see [casino differences](divergences.md#casino)).

## chat

No kept bugs (all ten former entries were fixed; see [chat differences](divergences.md#chat)).

## client

No kept bugs (all seventeen former entries were fixed; see [core differences](divergences.md#core)).

## combat

No kept bugs (all twenty-nine former entries were fixed; see [combat differences](divergences.md#combat)).

## crafting

No kept bugs (twenty-seven former entries were fixed, and the alchemy sand entry was reclassified as intended; see [crafting differences](divergences.md#crafting)).

## economy

No kept bugs (all thirty-three former entries were fixed; see [economy differences](divergences.md#economy)).

## housing

No kept bugs (all twenty former entries were fixed; see [housing differences](divergences.md#housing)).

## inventory

No kept bugs (all thirty-three former entries were fixed; see [inventory differences](divergences.md#inventory)).

## mail

No kept bugs (all sixteen former entries were fixed; see [mail differences](divergences.md#mail)).

## monsters

### NPC windows open from any distance
- **What you notice:** clicking an NPC anywhere on the screen opens its shop window, however far away it stands.
- **In 1.6 and SSO:** the click has no range check. SSO has none either.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`)
- **Pinned by:** `an NPC with data opens its Bio, with no range check, and holds the keys until it closes` (packages/server/tests/npcs-trade.test.ts)

### A monster with only a loot file opens an empty window
- **What you notice:** clicking a monster such as a Slime opens a window titled with its name that has empty fields and no buttons, and your keys stay locked until you close it.
- **In 1.6 and SSO:** the click only checks that the monster has some NPC file, and a Slime's loot lines count. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`)
- **Pinned by:** `kept bug: a Slime's loot-only file opens an empty Bio and locks you` (packages/server/tests/npcs-trade.test.ts)

### A map's fifth monster slot never existed
- **What you notice:** nothing. A map holds at most four monsters from its roster.
- **In 1.6 and SSO:** melee only looped over four of the five monster sprites that spells and arrows loop over, and the fifth slot never spawned anything. SSO has no sprite slots, so nothing shows; a map's roster simply has four slots. It is recorded here so the omission is deliberate.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`MonsterSlot`)
- **Pinned by:** `kept bug: slot 5 never spawns: a roster has four slots` (packages/server/tests/monsters.test.ts)

### Only four monsters can ever stand on a screen
- **What you notice:** no screen ever holds more than four spawned monsters, however the map was set up.
- **In 1.6 and SSO:** 1.6 meant to have a fifth roster slot, but never filled it in and switched off the message that would have shown it, so it never spawned. SSO gives each map exactly four slots.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`MonsterSlot`)
- **Pinned by:** `kept bug: slot 5 never spawns: a roster has four slots` (packages/server/tests/monsters.test.ts)

### The second monster slot waits no time after planning a walk
- **What you notice:** the monster in the second roster slot can be picked to walk again straight away, while the other slots wait a moment after each pick.
- **In 1.6 and SSO:** after a new walk is planned, slots 1, 3 and 4 wait 30 frames before they can be picked again and slot 2 waits 0. The 90-frame pause after each step still applies, so you only see the difference when a planned walk has no step that can start, or when a step stops on an item. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`moverPass`)
- **Pinned by:** `kept bug: slot 2's pause after authoring is 0 when no step can start` (packages/server/tests/monsters.test.ts)

### Five sea creatures turn up stranded on land
- **What you notice:** Merius, Krommie, Jelstar, Mellanie and Minmaye appear on dry land instead of at sea, and then cannot take a single step.
- **In 1.6 and SSO:** a misspelt name in the spawn check makes these five use the land spawn rules, while the movement code correctly treats them as sea creatures and refuses every land step. Only Squid, Shark and Mizella spawn in water. SSO uses the same two tests and the same species lists.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`refusesTile`)
- **Pinned by:** `kept bug: five sea creatures spawn on land; Squid needs water` (packages/server/tests/monsters.test.ts)

### Big monsters can spawn half inside walls on the right and bottom
- **What you notice:** Overlord and Mutant Worm sometimes appear overlapping walls near the right or bottom edge of a screen.
- **In 1.6 and SSO:** when the chosen tile is past column 12 or row 9, the spawn check says "fine" before it checks the 3 by 2 tiles a big monster covers. SSO copies that early exit.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`refusesTile`)
- **Pinned by:** `kept bug: the footprint test is skipped at x > 12 or y > 9` (packages/server/tests/monsters.test.ts)

### One failed roll for a special monster ends the whole spawn pass
- **What you notice:** when a screen's spawner picks a monster from the NPC list and its extra roll fails, the other empty slots do not get their turn that time round.
- **In 1.6 and SSO:** a failed roll for such a monster leaves the spawn routine altogether, skipping the later slots in that frame. SSO does the same within one player's pass.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`spawnPass`)
- **Pinned by:** `kept bug: a failed NPCed roll ends the whole pass` (packages/server/tests/monsters.test.ts)

### A species with no hit point entry spawns with the last monster's HP
- **What you notice:** a monster whose species has no hit point value can arrive with a strange amount, such as a negative one, or none at all.
- **In 1.6 and SSO:** the spawn code sets hit points only for the species it lists, so any other species keeps what the roster slot had before. In SSO that is the hit points the slot's previous monster had when it died (below zero, since that is what death means), or 0 if the slot never held one.
- **In the code:** `packages/server/src/systems/monsters/spawn.ts` (`placeMonster`); `packages/server/src/systems/monsters/slots.ts` (`MonsterSlot`)
- **Pinned by:** `kept bug: a species with no HP entry inherits the slot's last HP` (packages/server/tests/monsters.test.ts)

### Which monsters walk toward you is decided by a substring match
- **What you notice:** a Dragon walks toward players because its name is found inside "Dragon Hatchling", while the Overlord, whose name is not on the list, just wanders.
- **In 1.6 and SSO:** the check asks whether the hostile list contains the monster's name as text, not whether the name is an entry. SSO runs the same test against the same list.
- **In the code:** `packages/server/src/systems/monsters/slots.ts` (`leansToward`)
- **Pinned by:** `kept bug: the hostile list is matched by contains: Dragon leans via Dragon Hatchling, Overlord wanders` (packages/server/tests/monsters.test.ts)

### With nine or more players on a screen monsters nearly never stop walking
- **What you notice:** on a crowded screen the monsters move almost continuously.
- **In 1.6 and SSO:** the chance that a monster is picked to plan a walk gets steadily better from 1 to 8 players (a pick every 30 to 600 frames), then, at the 9th player, drops back to one every 50 frames. SSO uses the same ladder for each player, up to 15 players.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`moveLadder`)
- **Pinned by:** `ladders: spawn 80…1300 by players, move 30…600 then 50 at the 9th` (packages/server/tests/monsters.test.ts)

### A hostile monster aims at where the triggering player stood
- **What you notice:** when a monster plans a path toward a player, it aims at the spot where that one player was at that moment, not at wherever they go next.
- **In 1.6 and SSO:** the path leans toward the player whose own game started the walk, using positions at planning time. In SSO the player whose roll fired is the one it leans toward, and the whole path is worked out at that tick.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`authorPath`)
- **Pinned by:** `a hostile path leans toward the author by pixel position` (packages/server/tests/monsters.test.ts)

### A monster with no attack entry hits for 35
- **What you notice:** a hostile monster that has no attack value of its own hits you for 35 on a map where fighting is allowed.
- **In 1.6 and SSO:** the attack table falls back to 35 for any name it does not list. Monsters marked Passive do not attack. SSO keeps the same table and default.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttackValue`)
- **Pinned by:** `kept bug: a name with no attack entry hits for 35` (packages/server/tests/monsters.test.ts)

### The Snared Loah hits for 35 instead of 18
- **What you notice:** the Snared Loah hits harder than its table row says.
- **In 1.6 and SSO:** the attack table spells the name "Snared Load", so the Snared Loah never matches its row of 18 and gets the default 35. SSO's monster data simply gives the Snared Loah an attack of 35.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttackValue`)
- **Pinned by:** `kept bug: the "Snared Load" typo in the attack table misses the Snared Loah, which hits for the default 35, not 18` (packages/server/tests/monsters.test.ts)

### Clicking a Snow Demon tries to grab a pig
- **What you notice:** clicking a Snow Demon does what clicking a Pig does: you grab whatever you are facing, and Ctrl grabs a faced Snow Demon as if it were a Pig.
- **In 1.6 and SSO:** the click handler looks for "91-" anywhere in a monster's picture name, and the Snow Demon's picture 891 contains it. SSO keeps the same text test on the picture name.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`, `bodyHas`)
- **Pinned by:** `kept bug: Snow Demon runs the pig grab: its body 891 contains "91-", so a click on it grabs what you face, and Ctrl grabs a faced Snow Demon as a Pig` (packages/server/tests/npcs-trade.test.ts)

### Clicking any pig grabs whatever you are facing
- **What you notice:** click a Pig, even one far across the screen, and you grab whatever stands on the tile you face, such as a Dragon or a shopkeeper, and a Pig goes into your bag. The grabbed creature leaves with no XP and no loot.
- **In 1.6 and SSO:** the click grabs the first roster monster standing exactly on your faced tile without checking what it is. The grab starts its 500-frame cooldown before the bag test, and a bag whose text contains "Pig" (even "Cooked Pig") skips the 15-line check. Whenever a monster is removed or killed, every player on the map has their pig cooldown set to 20. Ctrl does check each candidate's own picture. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`clickNpc`, `grabPig`, `ctrlPig`, `PIG_GRAB_FRAMES`, `PIG_CNCL_FRAMES`)
- **Pinned by:** `kept bug: clicking any Pig grabs whatever stands on your faced tile, here Cril; any Cncl sets everyone's pig countdown to 20`; `the grab's cooldown is set before the bag test; 'Pig' in the bag text skips it` (packages/server/tests/npcs-trade.test.ts)

### Monster chatter almost never speaks, and ignores how crowded the screen is
- **What you notice:** the four Gods are the only NPCs with speech lines, and they speak very rarely: about once in 6,000 frames for each player who has them on screen.
- **In 1.6 and SSO:** the chatter roll reads the list of players from the wrong copy of a text member, which holds only "King" and a return. Its second line is therefore always empty, so all six draws are taken and the last, a 1-in-400 roll, decides. SSO makes the same draws, once per player on the map.
- **In the code:** `packages/server/src/systems/monsters/npc.ts` (`chatterRoll`)
- **Pinned by:** `random(15), then all six UserList draws with the last, random(400), deciding; then the line (bug ledger)` (packages/server/tests/npcs-trade.test.ts)

### Monsters walk through players, monsters and static NPCs
- **What you notice:** monsters pass through players and other monsters, and a static NPC's tile never stops them, while a blocking item on the ground ends their walk.
- **In 1.6 and SSO:** a step checks only the blocked tiles, the screen edge and water. If an item that blocks lies on the way, the rest of the path is dropped. SSO follows the same rules, so monsters can share a tile.
- **In the code:** `packages/server/src/systems/monsters/ai.ts` (`nextStep`)
- **Pinned by:** `steps follow back to back, 16 calls = 8 frames each, and players never block them` (packages/server/tests/monsters.test.ts).

### A calm monster loses a walking tick when its attack roll comes up
- **What you notice:** a Passive monster that has not been provoked, on a map where fighting is allowed, now and then freezes for a beat instead of walking on, even though it never attacks.
- **In 1.6 and SSO:** its attack roll is a 1-in-10 draw, and on a 1 the monster's whole step routine ends early, skipping that frame's walk tick. In 1.6 each player's game did this separately, with steps of about 17.8 frames. SSO has one copy of the monster, so the first player's roll each tick decides the stall.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`monsterAttack`)
- **Pinned by:** `kept bug: an unprovoked Passive monster's random(10) = 1 skips its walk tick` (packages/server/tests/monsters.test.ts)

### Death blames the last monster whose roll was ignored
- **What you notice:** if you die, the line "*** Bob was just killed by a Slime." can name a monster whose hit was ignored because you were blinking, as long as it was the last to roll against you.
- **In 1.6 and SSO:** the monster hit handler records the attacker's name before the blink check exits. SSO does the same.
- **In the code:** `packages/server/src/systems/monsters/attack.ts` (`hitMe2`)
- **Pinned by:** `kept bug: the last monster to roll against you is blamed, even during i-frames` (packages/server/tests/monsters.test.ts)

### A death drop picks among the first lines, even when some are empty
- **What you notice:** when you die and drop an item, the pick can land on an empty line of your bag, so nothing drops. A stack of crystals never drops either.
- **In 1.6 and SSO:** the game counts the non-empty lines among 1 to 8 and picks a line number up to that count, not among the filled lines. With gaps in your bag the pick can be empty. SSO does the same.
- **In the code:** `packages/shared/src/rules/monsters/loot.ts` (`rollDeathDrop`)
- **Pinned by:** `kept bug: the death drop picks lines 1 to the filled count` (packages/shared/tests/inventory/inventory.test.ts)

## movement

### A weaker player still shoves you
- **What you notice:** walk into a player who is standing still and now and then (1 blocked step in 25) you push them a tile. If you are weaker than them they read "… is too weak", and then "… shoves you out of the way." and move anyway.
- **In 1.6 and SSO:** the "too weak" check prints its line but doesn't stop the shove. In SSO the server does it, always tries the victim's step with normal collision, and never pushes immortals or players whose keys are held by a window.
- **In the code:** `packages/server/src/systems/movement/push.ts` (`pushOnMe`)
- **Pinned by:** `kept bug: a weaker pusher is 'too weak' and still shoves` (packages/server/tests/push.test.ts); `walking into a standing player can push them` (packages/server/e2e/chat-and-presence.test.ts)

### Stepping off the screen's edge ignores walls
- **What you notice:** walk off the edge of the screen and you arrive on the matching tile of the next map even when that tile is a wall or water.
- **In 1.6 and SSO:** the step that crosses the edge never checks the tile it lands on. SSO does the same.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`attemptMove`, `edgeWrap`)
- **Pinned by:** `kept bug: crossing an edge never checks the wrapped tile` (packages/shared/tests/movement/movement.test.ts); `kept bug: walking off an edge onto an existing neighbour keeps the wrapped tile, unchecked` (packages/server/tests/world.test.ts)

### Later monsters block three tiles wide after an Overlord
- **What you notice:** once an Overlord or Mutant Worm sits in a lower monster slot, the monsters in the higher slots behind it block three tiles wide too, even small ones like a Slime.
- **In 1.6 and SSO:** the three-wide flag is set for an Overlord or Mutant Worm and never reset while the slots are checked in order, so later slots inherit it. SSO does the same, from the first slot whose remembered name is Overlord or Mutant Worm (live or not): every live monster after it blocks its tile and the two to its right, a step off the right edge included.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`blockPCCheck`)
- **Pinned by:** `kept bug: a lower slot is one wide, a higher slot three wide after an Overlord`; `kept bug: a remembered dead Overlord in slot 1 widens slot 2` (packages/shared/tests/movement/movement.test.ts); `kept bug: a Slime in slot 2 is three wide after an Overlord in slot 1, even a dead one`; `Overlord at x = 16 stops a walk off the right edge` (packages/server/tests/blocking.test.ts)

### A Web or Holy Shield clears the way through players and earlier monsters
- **What you notice:** when a Web or Holy Shield is in one of the monster slots, you can walk through standing players and through the monsters in lower slots, though monsters in higher slots can block you again.
- **In 1.6 and SSO:** the Web or Holy Shield test clears the block flag whatever set it, looking only at the slot's name, and the name outlives the monster. SSO keeps this, using each player's remembered slot names; a push that was already rolled still lands.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`blockPCCheck`)
- **Pinned by:** `kept bug: a Web in slot 2 clears a standing player and slot 1, slot 3 still blocks`; `kept bug: a remembered dead Holy Shield still clears` (packages/shared/tests/movement/movement.test.ts); `kept bug: a remembered Web in slot 2 lets you walk through a Slime in slot 1`; `kept bug: a Web in slot 4 lets you walk onto a standing player, and the roll still shoves` (packages/server/tests/blocking.test.ts)

### Any step attempt refills the fishing allowance
- **What you notice:** while fishing, the limit on casts without moving is topped back up to 5 whenever you try to step, even a step into a wall or off the screen.
- **In 1.6 and SSO:** the code meant to refill it only when you turn, but compared facing letters with direction words, so it always refilled. SSO does the same: every move attempt that gets past the turn, the player and item blocks and the mid-step test resets the allowance to 5.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`refreshAntiMacro`)
- **Pinned by:** `kept bug: a step into a wall refreshes the allowance`; `turning in place does not refresh it` (packages/server/tests/gather.test.ts)

### The web message repeats while you hold a direction
- **What you notice:** standing on a web tile, you read "Your feet are stuck in the web, you cannot move!" on every move attempt while a direction is held. A web on any other tile never blocks you.
- **In 1.6 and SSO:** the web only counts when it is exactly on your own tile. SSO checks it every tick while a direction is held, on the walker's own tile only, after the player-block and mid-step tests and before the edge wrap; your facing doesn't change and the fishing allowance is refreshed. A rider ignores webs. A shove runs the same check, so a webbed victim reads the push lines, then the web line, and stays.
- **In the code:** `packages/shared/src/rules/movement/movement.ts` (`WEB_TEXT`), `packages/server/src/systems/movement/movement.ts` (`walkWorld`)
- **Pinned by:** `kept bug: web message every attempt while an arrow is held`; `web: aboard an Airship webs are ignored`; `web: a web on the next tile is walked onto`; `web: a shoved webbed player reads the push lines, then the web line, and stays`; `web: a refused step refreshes the fishing allowance` (packages/server/tests/pigs-orbs-webs.test.ts)

### Players walking between tiles don't block each other
- **What you notice:** a player blocks you only while standing still. Someone mid-step doesn't, so two players can end up on the same tile.
- **In 1.6 and SSO:** blocking compares exact sprite positions, and other players' sprites animate between tiles. SSO does the same: a player blocks only while not mid-step.
- **In the code:** `packages/server/src/systems/movement/movement.ts` (`standingPlayersAt`)
- **Pinned by:** `kept bug: a player mid-step does not block; two players end on one tile` (packages/server/tests/world.test.ts); `kept bug: a moving player does not block: alice steps onto bob's tile` (packages/server/e2e/login-and-walk.test.ts)

## progression

### Dying on an airship loses it and drops nothing
- **What you notice:** if you die while riding an airship, your bag and gold stay with you instead of dropping, the airship is gone, and no deed comes back. The faction head still drops.
- **In 1.6 and SSO:** death clears the vehicle and switches drops off. SSO does the same. The body reverts to the walker at once for everyone, on the server, where 1.6 delayed it on each player's screen.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`), `packages/server/src/systems/vehicles/airship.ts` (`vehicleDeath`)
- **Pinned by:** `kept bug: dying aboard an airship loses it and drops nothing; the faction head still drops` (packages/server/tests/vehicles.test.ts); `a Lightning death clears it too` (packages/server/tests/vehicles.test.ts)

### Airship riders stay aboard through the arena
- **What you notice:** if you are killed on an arena tile while flying, you are moved out of the arena still flying, with your airship. Challenging and quitting an arena fight also leave you flying.
- **In 1.6 and SSO:** the arena exit runs before the vehicle is cleared, and neither challenge nor quit looks at vehicles. SSO does the same: the death check tests the arena first and returns before the vehicle is cleared, and the exit is drawn from the tiles an Airship may stand on.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`checkDeath`)
- **Pinned by:** `kept bug: an arena death keeps the airship` (packages/server/tests/vehicles.test.ts); `kept bug: a rider challenges and quits still flying` and `a rider's exit is drawn from the Airship grid` (packages/server/tests/arena.test.ts)

### Every new character starts with 20 hit points and 20 spell points
- **What you notice:** the character you build always begins at HP 20/20 and SP 20/20, whatever the class, including Fighters, whose creation screen showed 0 SP.
- **In 1.6 and SSO:** the rolled values are thrown away and the saved record gets the fixed numbers 20, 20, 20, 20. SSO writes the same.
- **In the code:** `packages/shared/src/rules/progression/creation.ts` (`startingCharacter`)
- **Pinned by:** `kept bug: vitals are the literal 20/20/20/20 for every class, Fighter included` (packages/shared/tests/progression/creation.test.ts)

### A level-up wastes spare XP and never raises more than one level
- **What you notice:** when a kill pushes you past the XP you need, the extra is lost, you gain a single level however large the kill, and you are not healed.
- **In 1.6 and SSO:** at level-up the XP counter is reset to 0, and the check is a single test rather than a loop. SSO does the same.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`checkLevelUp`)
- **Pinned by:** `kept bug: overflow is lost, one level per kill, no heal` (packages/shared/tests/progression/progression.test.ts); `kept bug: XP overflow is lost and one level comes per kill` (packages/server/tests/monsters.test.ts)

### A class promotion never gives the skills it was meant to
- **What you notice:** promoting to a new class changes your class, gold and stats, but none of the skill points each promotion was supposed to grant.
- **In 1.6 and SSO:** each promotion sets its skill to a random number from 1 to 10, but the game then reloads every skill from the saved field before saving, which undoes it. A changed roll could also have triggered the anti-cheat ban, which SSO does not have, so there is no ban.
- **In the code:** `packages/shared/src/rules/progression/promotion.ts` (`promoteClass`)
- **Pinned by:** `kept bug: Promotion skill grants are undone: no promotion returns a skill` (packages/shared/tests/progression/promotion.test.ts)

### Hit and spell point regeneration can stop until you log in again
- **What you notice:** when your hunger sits between 50 and 500, regeneration stops for the rest of the session, and starvation damage stops with it.
- **In 1.6 and SSO:** the regen counter resets only when it exactly equals the target, and that happens only on a regen (Hunger above 500) or starvation (below 50) event. In between, or after the target drops below the counter, it never matches again until you log in. SSO keeps a counter per session, resets it only at login, and tests for exact equality every tick. The counter starts at 1 and is raised before the test, so regen fires every 148 frames at speed 1.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`regenTick`); `packages/server/src/systems/progression/vitals.ts` (`regenStep`)
- **Pinned by:** `kept bug: regen stalls for 50 <= Hunger <= 500 and never fires again` (packages/shared/tests/progression/progression.test.ts); `kept bug: a resumed session keeps the regen counter; a login resets it` (packages/server/tests/monsters-db.test.ts)

### The same hunger warning prints several times
- **What you notice:** each hunger warning appears about three times in a row instead of once.
- **In 1.6 and SSO:** the check runs every frame below 2000 and prints whenever hunger exactly equals a warning value, while hunger drops on only about a third of frames, so it sits on each value for several frames. SSO runs the same check every tick.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`hungerTick`, `HUNGER_WARNINGS`)
- **Pinned by:** `kept bug: a warning prints on every frame hunger sits on the value` (packages/shared/tests/progression/progression.test.ts)

### Every normal death has a one in five chance of weakening you
- **What you notice:** a death outside the arena costs 1 off both your maximum HP and maximum SP one time in five, with the weakened message.
- **In 1.6 and SSO:** the code sets the death penalty to "X" just before testing it, which forces the roll for everyone. The intended chance was one in one, for some players. A maximum is only lowered while it is above 2. SSO does the same.
- **In the code:** `packages/shared/src/rules/progression/progression.ts` (`rollDeathPenalty`)
- **Pinned by:** `kept bug: DeathPenalty is forced, random(5) = 1 → HPmax and SPmax −1 above 2` (packages/shared/tests/progression/progression.test.ts)

### Mage skill caps higher from casting than from killing
- **What you notice:** a Mage faction member with a bonus of 3 can raise the Mage skill to 90 by casting, but only to 80 by killing.
- **In 1.6 and SSO:** the kill path and the cast path each have their own cap table, and they disagree at that bonus. SSO keeps both tables.
- **In the code:** `packages/shared/src/rules/progression/skillgain.ts` (`skillCaps`); `packages/shared/src/rules/spells/spells.ts` (`castMageCap`)
- **Pinned by:** `kept bug: a Mage faction bonus of 3 caps Mage skill at 80 from kills but 90 from casts` (packages/shared/tests/spells/spells.test.ts)

### A death from hunger credits whoever hit you last
- **What you notice:** If you starve, whoever hit you last, however long ago, is named and flagged as your killer.
- **In 1.6 and SSO:** 1.6 clears the last attacker only at death and login, so a death nobody caused still credits them. SSO does the same, keeping the attacker by player.
- **In the code:** `packages/server/src/systems/progression/vitals.ts` (`hungerStep`, `finishDeath`)
- **Pinned by:** `kept bug: a starvation death credits the last attacker, however long ago` (packages/server/tests/factions.test.ts)

### A medal needs the skill at exactly 90
- **What you notice:** A skill that jumps past 90 without being saved at 90, such as an admin setting it to 95, never earns its medal.
- **In 1.6 and SSO:** 1.6 tests each skill for equal to 90. SSO does the same, checking whenever a player's skills change.
- **In the code:** `packages/shared/src/rules/progression/medals.ts` (`checkForAwards`)
- **Pinned by:** `kept bug: 89 or 91 earns nothing; a medal already held is not given again` (packages/shared/tests/social/friends-bios-medals.test.ts); `kept bug: a skill set past 90 never earns it` (packages/server/tests/friends.test.ts)

## social

### Guild lines that do not start with a letter lose their first character
- **What you notice:** A guild line that begins with something other than a letter comes out one character short. Ordinary guild data never changes.
- **In 1.6 and SSO:** 1.6 tests the first character for a letter and otherwise deletes it. SSO reads the guild header through the same transform: on your own guild's lines at login, on every change and for the guild screen. A guild you only view is read raw. Honest data never changes.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`loadGuildStrip`)
- **Pinned by:** `kept bug: a line not starting with a letter loses its first character; honest data never does` (packages/shared/tests/social/guilds.test.ts)

### Re-creating a disbanded guild's name inherits its vault, doors and hall
- **What you notice:** after a guild disbands, found a new guild with the same name and it gets what the old one left behind: the old Guild Vault's contents, Guild Key doors and permission to place furniture in its hall. You need not have belonged to the old guild, and nobody is warned.
- **In 1.6 and SSO:** vault contents, guild doors and the hall header are all found by guild name. Disbanding leaves the vault and the hall in place, so a new guild of the same name matches them. 1.6 kept vault files in the world and wrote `!DISBAND!` over the guild file; SSO keeps the disbanded row and a new guild of that name reuses it. In both, the old guild's name can be created again.
- **In the code:** `packages/server/src/systems/social/guilds.ts` (`guildCreate`, `guildAction`), `packages/server/src/systems/economy/containers.ts` (`mayUseContainer`), `packages/shared/src/rules/housing/doors.ts` (`turnKey`), `packages/shared/src/rules/housing/houses.ts` (`headDrop`)
- **Pinned by:** `kept bug: a re-created guild's name opens the old vault, Guild Key door and hall` (packages/server/tests/guilds.test.ts); `a guild of the same name created again: an old member is kicked at login` (packages/server/tests/guilds.test.ts)

### Abdicating announces the guild's name, not the new leader's
- **What you notice:** When a leader abdicates, the line reads "*** Abdicating to <guild>", naming the guild. The leader screen stays up unrefreshed, and the old leader becomes the last member.
- **In 1.6 and SSO:** 1.6 keeps the header's alignment and colour, crowns the target, re-adds the old leader as the last member and prints that line. A leader has no Leave button. SSO makes the same row change and prints the same texts; the screen stays as it was, and the client keeps the selected name through an exile as 1.6 did. The server checks leadership on every action, so the stale buttons no longer act and a stale selection is not crowned.
- **In the code:** `packages/shared/src/rules/social/guilds.ts` (`abdicateGuild`), `packages/client/src/ui/guildcenter.ts` (`abdicate`)
- **Pinned by:** `kept bug: abdicate crowns the target and re-adds the old leader last` (packages/shared/tests/social/guilds.test.ts); `kept bug: abdicate names the guild; the old leader becomes the last member` (packages/server/tests/guilds.test.ts); `kept bug: the abdicate selection survives an exile` (packages/client/tests/guildcenter.test.ts)

### All three factions share one @Faction announcement channel
- **What you notice:** Faction announcements go to a single channel, so members of every faction hear them.
- **In 1.6 and SSO:** 1.6 puts all factions in one @Faction channel. SSO uses one server channel for all faction members: joined at login and on joining, left by the loyalty kick.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`toFactionChannel`)
- **Pinned by:** `Bob gives the head to Angela: power moves, he joins, @Faction hears it` (packages/server/e2e/social.test.ts)

### A faction at power 200 or more gives no bonus
- **What you notice:** Once a faction's power reaches 200, its members' bonus drops to 0.
- **In 1.6 and SSO:** 1.6's bonus table has no row for 200 or more, so the last matching row wins and gives 0. SSO uses the same table.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`factionBonus`)
- **Pinned by:** `kept bug: the faction bonus cascade's last true row wins, so 200 or more gives 0` (packages/shared/tests/social/factions.test.ts)

### A faction head is taken and power moved before the join is refused
- **What you notice:** Hand a head to a faction leader and, if you are too weak to join or already in another faction, you still lose the head and the leader's faction still gains power. A head of the leader's own faction is simply taken for nothing.
- **In 1.6 and SSO:** 1.6's server takes the head and moves the power before the client decides whether you may join. SSO does it in the same order.
- **In the code:** `packages/server/src/systems/social/factions.ts` (`giveHead`), `packages/server/src/systems/economy/quests.ts` (`questGive`)
- **Pinned by:** `kept bug: a refused joiner's head still moves the power` (packages/server/tests/factions.test.ts); `turn-in: own head wasted; a rival head moves 1 power when the rival has any` (packages/shared/tests/social/factions.test.ts)

### An exile on death does not remove you from the faction channel
- **What you notice:** If a death exiles you from a faction, you keep hearing its announcements until you log in again.
- **In 1.6 and SSO:** 1.6's exile path never leaves the channel. SSO does the same.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`exileAtDeath`)
- **Pinned by:** `kept bug: exile below the line after the penalty; the channel is kept` (packages/server/tests/factions.test.ts)

### Assassin points are the victim's raw rating at equal ratings or 1800+
- **What you notice:** A kill between equal ratings, or where the deciding rating is 1800 or more, scores the victim's plain rating.
- **In 1.6 and SSO:** 1.6's comparison has no row for those cases, so the score falls through to the raw rating. SSO computes the same mapping on the server, with the killer's rating as it stands and the victim's after the death penalty.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`compareAss`, `killPoints`)
- **Pinned by:** `kept bug: equal ratings, or a deciding rating of 1800 or more, pay the victim's raw rating` (packages/shared/tests/social/assassin.test.ts)

### Assassin tables ignore ties and never award a fourth prize
- **What you notice:** A score equal to any table entry never makes the table, even when there are empty slots below. Only prizes 1 to 3 are ever given.
- **In 1.6 and SSO:** 1.6 ranks with strict comparisons, and empty slots and your own blanked entry count as 0. SSO does the same for both the current and the all-time table. The prize setting keeps a fourth line that is never given.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`rankEntry`, `prizesGiven`)
- **Pinned by:** `kept bug: a score equal to any entry never ranks, even with empty slots below` and `the archive's prizes; 1-3 given, a blank stops the rest, the fourth is never given` (packages/shared/tests/social/assassin.test.ts)

### Tying an Assassin score leaves the old, lower table entry
- **What you notice:** If your new total ties someone's entry, the table keeps your old, lower total. For example with Bob 40 and Alice 30, Alice reaches 40 and the table still shows Alice 30. The score line still prints.
- **In 1.6 and SSO:** 1.6 blanks your own entry only in the copy it ranks, and a tie never ranks, so nothing is rewritten. SSO does the same.
- **In the code:** `packages/shared/src/rules/social/assassin.ts` (`rankEntry`)
- **Pinned by:** `kept bug: a tied score leaves the player's old entry (Bob 40, Alice 30 → Alice 40 is not written)` (packages/shared/tests/social/assassin.test.ts); `kept bug: a tied total leaves the old table entry, though the line still prints` (packages/server/tests/assassin.test.ts)

### Lightning kills still flag the killer as wanted
- **What you notice:** In a Lightning game, a one-hit kill makes the killer wanted and pays the Assassin points, even though the death carries no penalties.
- **In 1.6 and SSO:** 1.6's penalty-free Lightning death still sends the wanted flag and the score. SSO does the same: the flag and the points come at the end of the victim's death lock.
- **In the code:** `packages/server/src/systems/social/assassin.ts` (`scoreKill`)
- **Pinned by:** `kept bug: the kill still flags the killer and pays 10, after the death line` (packages/server/tests/assassin.test.ts)

### Killing a wanted player never flags you; other kills always do
- **What you notice:** Killing someone who is already wanted does not make you wanted. Any other kill does, on any map, whether or not the PvP flag is on. A death in an arena never flags anyone.
- **In 1.6 and SSO:** 1.6 flags the killer only when the victim is not wanted and was last hit by a player. SSO applies this on the server to resolved kills, credited by player.
- **In the code:** `packages/server/src/systems/social/murder.ts` (`flagKiller`)
- **Pinned by:** `kept bug: killing a wanted player never flags the killer`; `an arena death never flags` (packages/server/tests/factions.test.ts)

### A Warrior who joined at 50-59 hit points is exiled at the next death
- **What you notice:** Join the Warriors with 50 to 59 maximum hit points and your next death throws you out.
- **In 1.6 and SSO:** 1.6 lets anyone with more than 49 join, but its Warrior exile line is below 60, checked at every death outside an arena. SSO does the same.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`exileAtDeath`, `joinFaction`)
- **Pinned by:** `kept bug: a Warrior who joins at 50-59 HP is exiled on the next death` (packages/shared/tests/social/factions.test.ts)

### Faction leader and quest lines lack their closing quote
- **What you notice:** The three lines a faction leader says end without the closing quote mark, and a quest giver's "Sorry but I don't need anything right now" has no full stop. (The quest giver's "Bring me a…" line now closes its quote; see [economy differences](divergences.md#economy).)
- **In 1.6 and SSO:** 1.6 left these texts that way. SSO uses the same texts.
- **In the code:** `packages/shared/src/rules/social/factions.ts` (`sayFaction`), `packages/shared/src/rules/economy/quests.ts` (`sayQuest`)
- **Pinned by:** `kept bug: faction leader lines lack their closing quote`; `bug fixed: every quest reply is heard by the map and closes its quote` (packages/shared/tests/social/factions.test.ts)

### Closing your own bio strips its periods and semicolons
- **What you notice:** Closing your own Bio window removes periods and semicolons from your profile text, even if you did not edit it. A colon or slash that remains refuses the save with "You can't have a : in your profile!" (or the same with a slash).
- **In 1.6 and SSO:** 1.6 saves the box on close, deleting each of those characters in a single forward pass, so of two adjacent ones the second survives. SSO does the same on the server when your own bio closes.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`saveProfile`), `packages/server/src/systems/social/bios.ts` (`profileSave`)
- **Pinned by:** `periods and semicolons are lost on every close` and `one forward pass: of two adjacent characters the second survives` (packages/shared/tests/social/friends-bios-medals.test.ts); `the strip, then the write` (packages/server/tests/friends.test.ts)

### Bio medal slots 11-14 keep the previous bio's medals
- **What you notice:** Look at one bio and then another with fewer medals, and the last four medal slots still show the earlier bio's medals.
- **In 1.6 and SSO:** 1.6 clears only the first ten of the strip's fourteen slots before drawing, and the image persists between bios. SSO does the same in the page's Bio window.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`medalStrip`), `packages/client/src/ui/bio.ts` (`medalStrip`)
- **Pinned by:** `kept bug: each bio clears slots 1-10 and draws from slot 1; slots 11-14 keep the last bio's medals` (packages/shared/tests/social/friends-bios-medals.test.ts); `kept bug: slots 11-14 keep the previous bio's medals` (packages/client/tests/friends-bio.test.ts)

### The bio score leaves out eight skills
- **What you notice:** A bio's score does not count Lumberjacking, Archery, Blessing, Musicianship, Illusion, Punch, Fire or Wind. Hit points and spell points do count, and there is no cap.
- **In 1.6 and SSO:** 1.6's second sum line assigns to a misspelt variable, so those eight skills never count. SSO uses the same sum, on the server.
- **In the code:** `packages/shared/src/rules/social/bios.ts` (`bioScore`)
- **Pinned by:** `kept bug: the score drops the eight skills of the misspelt-variable line` (packages/shared/tests/social/friends-bios-medals.test.ts)

### Removing a friend fails from the 190th name on
- **What you notice:** Removing a name past the 189th on your friends list fails with "*** <name> is not on your friend's list!".
- **In 1.6 and SSO:** 1.6 searches only the first 190 list items and the first is an empty piece, so only the first 189 names can be removed; the rebuild keeps the first 200 items. SSO does the same on the stored list.
- **In the code:** `packages/shared/src/rules/social/buddies.ts` (`buddyRemove`)
- **Pinned by:** `kept bug: removing a buddy finds only items 1-190, so the 190th name and later cannot go` and `a removal rebuilds from items 1-200 only: names past the 199th are dropped` (packages/shared/tests/social/friends-bios-medals.test.ts)

## spells

### Spell clicks work outside the playfield
- **What you notice:** you can cast a spell by clicking slightly outside the playfield, in the margin around it, because the accepted area is larger than the playfield.
- **In 1.6 and SSO:** casts are accepted a few pixels beyond the playfield rectangle. SSO's server accepts cast points in the same original area.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`inCastBounds`), `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `cast bounds 8 < H < 580, 5 < V < 420` (packages/shared/tests/spells/spells.test.ts); `kept bug: the spell click area is larger than the playfield [30,31,574,415]: the server takes 8 < H < 580, 5 < V < 420` (packages/server/tests/spells.test.ts)

### Fireball and Wind Wave never get their school bonus
- **What you notice:** casting Fireball or Wind Wave does not get the extra power that Fire or Wind skill should give.
- **In 1.6 and SSO:** the spell is renamed to its directional form before the power code checks for the school, so the checks for "Fireball" and "wind wave" never match. SSO works out spell power in the same order.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spellPower`)
- **Pinned by:** `kept bug: Fireball and Wind Wave never get the school bonus, they are renamed first` (packages/shared/tests/spells/spells.test.ts)

### Bolt and Wind Wave casts never train their school skill
- **What you notice:** casting Bolt or Wind Wave does not raise the matching school skill. A fireball from the Fire Staff or the Firesword, which costs you nothing, does raise Magery and Fire.
- **In 1.6 and SSO:** the skill-gain step is given the directional name ("BoltR", "Wind waveR") and compares it for an exact match, so those two never match. A fireball name contains "Fireball", so the staff and sword fireballs do match. SSO feeds the directional name to the skill-gain step, and the staff and sword fireballs run it too.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spellImp`); `packages/server/src/systems/spells/cast.ts` (`swingFireballs`)
- **Pinned by:** `kept bug: Bolt and Wind Wave never raise their school; they arrive as BoltR, Wind waveR`; `kept bug: a Fire Staff or Firesword fireball trains Magery and Fire: contains 'Fireball'` (packages/shared/tests/spells/spells.test.ts)

### Armour and Magic Shield never reduce spell damage
- **What you notice:** Magic Shield still shows its message and runs its counter, but armour and Magic Shield do nothing to the damage a spell deals.
- **In 1.6 and SSO:** the spell defense lookup only changes a copy of the value, and its callers ignore the result. It still makes one draw out of 3. SSO makes the draw and applies no reduction.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`playerSpellAmount`)
- **Pinned by:** `kept bug: the spell-defense lookup is a no-op, so armour never lowers spell damage` (packages/server/tests/spells.test.ts)

### Standing in a Whirlwind drains 1 SP every frame
- **What you notice:** while you overlap a Whirlwind your SP drops by 1 on every frame, with no blink to give you a breather.
- **In 1.6 and SSO:** the Whirlwind starts no hit blink, though the whole collision test waits while a blink from something else is running, so another hit pauses the drain. SSO drains once per tick of overlap under the same blink gate.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept bug: Whirlwind drains 1 SP a frame of overlap, no flicker` (packages/server/tests/spells.test.ts)

### Hold roots players even where PvP is off
- **What you notice:** a Hold spell roots a player on a map where player fighting is off.
- **In 1.6 and SSO:** the Hold branch checks only for a vehicle and for the caster. On safe maps SSO differs: Hold cannot target players there (see the divergence list).
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept bug: Hold ignores PvP flags: it roots a player where PvP is off` (packages/server/tests/spells.test.ts)

### Your own harmful spell shields you from other spells
- **What you notice:** while one of your own harmful spells is overlapping you, other spells that should hit you in the same frame can be skipped.
- **In 1.6 and SSO:** a spell that belongs to you, or one blocked because PvP is off, stops the whole spell collision check for you. So do Morph, Nature Shift and Smoke Bomb in a vehicle or as a boss, and Hold in a vehicle or on its caster. Spell effects are checked in slot order, each taking the lowest free slot when placed, so a newer spell can be checked before an older one. SSO takes the lowest free slot number with no cap, checks in slot order, and the first such exit ends your collision for that tick.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`); `packages/server/src/systems/spells/fx.ts` (`freeSlot`)
- **Pinned by:** `kept bug: your own harmful spell exits the whole collision, shielding you from later FX` (packages/server/tests/spells.test.ts); `Morph and Hold do nothing to a rider; Dispel keeps the airship` (packages/server/tests/vehicles.test.ts)

### A spell that fails still makes you wait the cast delay
- **What you notice:** if a cast is refused for any reason, you still wait out the cast delay before the next one.
- **In 1.6 and SSO:** the delay is set before the checks for map visibility, harmful spells, an empty selection, SP and crystals. SSO checks in the same order, so a cast during a map load or the death lock, or with an empty line selected, costs the delay too.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `kept bug: the delay is set before every later check; an empty selection costs it` (packages/server/tests/spells.test.ts)

### Some spells cost SP and crystals but do nothing
- **What you notice:** Poison Dart, Weaken, Bless, Haste, Replenish and Holy Weapon take their SP cost and crystals, and then nothing happens and nothing is drawn.
- **In 1.6 and SSO:** these spells have costs but no effect or visual. SSO does the same.
- **In the code:** `packages/shared/src/rules/spells/spellfx.ts` (`placeFx`)
- **Pinned by:** `kept bug: dead spells cost SP and crystals and show nothing: Bless` (packages/server/tests/spells.test.ts)

### Casting a buff again stacks it
- **What you notice:** casting Stone Skin, Argon's Fist or Magic Shield again before the first ends adds to the bonus and the time. Hold and Firesword are different: recasting only refreshes them.
- **In 1.6 and SSO:** Stone Skin adds 1 to the defense bonus and 30 times its power to the counter, Argon's Fist adds 400 to its counter, and Magic Shield adds 70 times its power. All reset only when the counter reaches 0. Hold (8 times its power) and Firesword (40 times its power) are set rather than added. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`); `packages/server/src/systems/spells/buffs.ts` (`holdDefenseStep`, `swordShieldStep`)
- **Pinned by:** `Stone Skin stacks: the defense bonus + 1 and its counter + P·30, then back to 0`; `kept bug: Firesword without a sword: the warmth line, no counter; a recast refreshes P·40` (packages/server/tests/spells.test.ts)

### A Radar spell on you prints a line every frame
- **What you notice:** standing in someone's Radar effect fills your chat with a line each frame, up to 5 lines in SSO.
- **In 1.6 and SSO:** the Radar effect matches on each of its 10 animation frames and sends a chat line each time. In SSO the effect advances two steps per frame, but the collision test runs once per frame, so it sees every second frame and you get up to 5 lines instead of 10.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`); `packages/shared/src/rules/spells/spells.ts` (`radarText`)
- **Pinned by:** `kept bug: Radar on a player sends a line every frame of overlap, up to 10; the FX flies twice as fast, so 5` (packages/server/tests/spells.test.ts)

### Meteor can only hit a monster once, not twice
- **What you notice:** a Meteor hits a monster on one frame only, though it was set up to hit on a second one.
- **In 1.6 and SSO:** monsters are hit on the Meteor's frames 13 and 19, but the first hit sets a 16-frame lockout that the second frame falls inside. SSO has the same lockout.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`monsterHits`)
- **Pinned by:** `kept bug: Meteor's second hit frame (19) falls inside the first's 16-frame lockout` (packages/server/tests/spells.test.ts)

### A summon with no free monster slot fails silently after you paid
- **What you notice:** if all four monster slots on the map are full, a summon spell does nothing and says nothing, but your SP and crystals are gone.
- **In 1.6 and SSO:** the summon script exits when all the monster sprites are occupied, after the cost was taken. SSO's summons take a free roster slot and fail silently, after payment, when all four are full.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`summon`)
- **Pinned by:** `kept bug: with four live monsters the summon fails silently, paid for` (packages/server/tests/spells.test.ts)

### Two spell books ask for the wrong Dexterity
- **What you notice:** the Argon's Fist Book needs only Dexterity 1, and only an exact "Bolt Book" needs 24.
- **In 1.6 and SSO:** the table misspells "Argon's First" and tests it with "contains", and matches "Bolt Book" exactly. SSO keeps the same table.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`bookDex`)
- **Pinned by:** `kept bug: the Dex table's typos: Argon's Fist Book needs 1, only an exact Bolt Book needs 24` (packages/shared/tests/spells/spells.test.ts)

### Your spellbook keeps 29 lines and loses Identify
- **What you notice:** a spellbook past 29 lines loses the extra spells when saved, and a learned Identify spell vanishes the first time the list is reloaded.
- **In 1.6 and SSO:** the save writes at most 29 lines, and Identify has no saved form. The list is rebuilt from the save before each save and learn and on every click of the spell list. In SSO the server stores only the saved form and trims the live list at each save, and the client trims its list on a click.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`SPELLBOOK_SAVE_LINES`, `savedSpellbook`); `packages/client/src/ui/spellbook.ts` (`createSpellbook`)
- **Pinned by:** `kept bug: savespells keeps 29 lines and drops Identify` (packages/shared/tests/spells/spells.test.ts); `kept bug: a click reloads the list from the save first, so a learned Identify drops out` (packages/client/tests/spells.test.ts); the bot relog test (packages/server/e2e/spells.test.ts)

### Portal takes its cost, then refuses near any player, you included
- **What you notice:** casting Portal near any player is refused, and so is casting it near yourself, after your SP and crystals have already been spent.
- **In 1.6 and SSO:** the cost is taken before the Portal test, and the test loops over all the player sprites, including the caster's own. SSO keeps that order and counts the caster.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`castIntent`)
- **Pinned by:** `kept bug: Portal is refused near any player, the caster too, after SP and crystals are spent` (packages/server/tests/spells.test.ts)

### Wearing a body armour named "Ninja" makes Smoke Bomb uncastable
- **What you notice:** with a body item named exactly "Ninja", Smoke Bomb costs nothing and cannot be cast at all.
- **In 1.6 and SSO:** the Smoke Bomb cost is 25 only when the body is not "Ninja". A body named exactly "Ninja" leaves the required SP at 0, which makes the cast exit. SSO does the same.
- **In the code:** `packages/shared/src/rules/spells/spells.ts` (`spCost`)
- **Pinned by:** `kept bug: Smoke Bomb costs 0 in a body named exactly "Ninja", so it cannot be cast` (packages/shared/tests/spells/spells.test.ts)

### Some books teach nothing, and some are used up anyway
- **What you notice:** the Radar and Haste books teach nothing. A book for a spell you already know is still used up. A Bolt Book can use up an earlier Firebolt Book in your bag. The Poison Dart Book does nothing. A combat book can take a skill up to 82.
- **In 1.6 and SSO:** the book routine has no line for Radar or Haste. The server consumes the book before the routine runs, and takes the first bag item containing "<name>-", so a Bolt Book can use up an earlier Firebolt Book. The Poison Dart Book has no Inventory member, so using it exits. Combat books add 1 plus a draw out of 5 below skill 77, so a skill can reach 82. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/learn.ts` (`readBook`); `packages/shared/src/rules/spells/spells.ts` (`runBook`)
- **Pinned by:** `kept bug: the Radar and Haste books teach nothing`, `kept bug: combat books add 1 + random(5) below 77, so up to 82` (packages/shared/tests/spells/spells.test.ts); `kept bug: reading a Bolt Book can use up an earlier Firebolt Book`, `kept bug: a book is used up when the spell is already known`, `kept bug: the Poison Dart Book has no Inventory member, so using it does nothing` (packages/server/tests/spells.test.ts)

### Firesword does nothing for a player without a sword
- **What you notice:** if the Firesword hits a player whose left hand holds no sword, you see "You feel a warmth you haven't felt before, but feel it has not assisted you." and nothing else happens.
- **In 1.6 and SSO:** when the left hand does not contain "Sword", the spell prints that line and sets nothing. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`playerCollision`)
- **Pinned by:** `kept bug: Firesword without a sword: the warmth line, no counter; a recast refreshes P·40` (packages/server/tests/spells.test.ts)

### Summon Creature misreads blocked tiles; Raise Dead lands below the grave
- **What you notice:** Summon Creature can think a tile is blocked because a different tile is (x1y1 is blocked by x1y10 to x1y12). Raise Dead puts the Zombie one tile below a grave, whether you clicked the grave or the tile below it. Neither spell checks the no-fight flag.
- **In 1.6 and SSO:** Summon Creature and Holy Shield look for the tile name as a plain piece of text without a closing mark, so a shorter name matches the start of a longer one. Raise Dead always places the Zombie one tile below the grave. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/cast.ts` (`npcBlockedSubstring`, `summon`)
- **Pinned by:** `kept bug: Summon Creature's blocked test matches part of the tile name: x1y1 is blocked by x1y10`, `kept bug: Raise Dead raises the Zombie on the tile below a grave` (packages/server/tests/spells.test.ts)

### Monster spells heal you, fly at random and miss with PvP off
- **What you notice:** a Passive monster you have not provoked casts its heals and buffs at you, and spells never provoke it. A monster's Fireball flies in a random direction. Harmful monster spells do nothing to you on a map where PvP is off. Any cast by a name containing "18", a player's too, blocks monster spells for a moment.
- **In 1.6 and SSO:** only melee provokes a monster. A monster's Fireball picks one of four directions at random. Monster spells still pass the victim's PvP check. Any cast whose caster's name contains "18" blocks monster spells for 30 frames. SSO does the same for each emulated player.
- **In the code:** `packages/server/src/systems/spells/monsterspells.ts` (`monsterSpells`, `castOne`); `packages/server/src/systems/spells/fx.ts` (`placeQueued`)
- **Pinned by:** `kept bug: an unprovoked Passive Acrostia casts Major Heal at you`, `kept bug: the Snow Serpent's Whirlwind lands on you but drains nothing with PvP off`, `kept bug: a monster's Fireball flies in a random(4) direction from it, not at you`, `kept bug: a player with 18 in the name blocks monster spells for 30 frames` (packages/server/tests/spells.test.ts)

### Killing with a spell says "You have become a more powerful!"
- **What you notice:** when a spell kill levels you up, the line reads "You have become a more powerful!" with a stray "a". A melee kill says "You have become more powerful!".
- **In 1.6 and SSO:** the spell path has its own level-up text, pays the spell XP table and rolls no kill skill gain. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`checkForDead`, `SPELL_LEVEL_UP_TEXT`)
- **Pinned by:** `a spell kill pays the spell XP table and its own level-up line` (packages/server/tests/spells.test.ts)

### Healing spells lift a monster far above its own maximum
- **What you notice:** a spell that heals a monster can take a Pig, which has 1 hit point, up to 200.
- **In 1.6 and SSO:** hit points are capped only after a spell's effects, using a table with a default of 200 and six named exceptions. SSO applies the cap in the same place with the same table.
- **In the code:** `packages/server/src/systems/spells/collide.ts` (`checkForDead`); `packages/shared/src/rules/spells/spells.ts` (`MONSTER_HEAL_CAP_DEFAULT`)
- **Pinned by:** `kept bug: a spell heal lifts a Pig far above its 1 hit point and stops at the default cap of 200` (packages/server/tests/spells.test.ts)

### A book is used up even when it teaches you nothing
- **What you notice:** Read a spell book for a spell you already know, or a skill book when your skill is 77 or more, and you are told there is nothing more to learn or that you already know it. The book is gone anyway.
- **In 1.6 and SSO:** The server removes the book before it works out what it teaches, and the client's message comes afterwards. SSO does the same.
- **In the code:** `packages/server/src/systems/spells/learn.ts` (`readBook`)
- **Pinned by:** `kept bug: a book is used up when the spell is already known`; `kept bug: a skill book is used up when the skill is 77 or more and teaches nothing` (packages/server/tests/spells.test.ts)

### After the church bell, channel 5 stays loud
- **What you notice:** after you hear the church bell once, the damage-number sound and any other sound on that channel play louder for the rest of the session, whether or not sound is on.
- **In 1.6 and SSO:** the bell sets channel 5 to volume 200 and nothing resets it. SSO does the same, per client session: the server's sound message carries the volume, and the client sets it before playing, sound on or off.
- **In the code:** `packages/server/src/systems/spells/hazards.ts` (`serverTimer`), `packages/client/src/audio.ts` (`playAll`)
- **Pinned by:** `kept bug: the church bell leaves channel 5 at volume 200, sound on or off` (packages/client/tests/spells.test.ts); `the church bell rings at the 20th run to x999y999, Churchy:5:200` (packages/server/tests/spells.test.ts)

## vehicles

No kept bugs (the former entry was fixed; see [vehicle differences](divergences.md#vehicles)).

## world

### A map that isn't there sends you to the start point
- **What you notice:** walk off an edge with no map beyond, or take a bad exit, and you land on the start tile (5,5) of the starting map, and the whole map reloads.
- **In 1.6 and SSO:** a missing map warps to the start point. In SSO that point is whatever the operator has configured, and the old Test map is not shipped. The whole map reloads, as the original's warp did.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`crossMapEdge`)
- **Pinned by:** `kept bug: walking off an edge with no neighbour lands on the start point` (packages/server/tests/world.test.ts); `kept bug: walking off an edge with no map beyond lands on the start point` (packages/server/e2e/login-and-walk.test.ts)

### After a hit your own sprite vanishes for a second instead of blinking
- **What you notice:** after a monster hits you, your own character disappears from your screen for about a second (1.0 s measured on the running 1.6) or never blinks at all, instead of blinking. Other players never see it.
- **In 1.6 and SSO:** each call for the player sprite while the hit blink is running flips its visibility and counts it down by 1, showing it again at 0. The game makes two such calls per frame, so the flips cancel: a hit that leaves an odd number of calls in its frame hides the sprite for the whole 20 frames, and one that leaves an even number never shows a blink. In SSO the player's hidden flag flips where the blink counts down, goes only to its owner, and the client does not draw the local player while it is set. A map load and a body revert show the sprite again.
- **In the code:** `packages/server/src/systems/world/tick.ts` (`actorPass`); `packages/client/src/playfield.ts` (`createPlayfield`)
- **Pinned by:** `kept bug: a monster hit in pass 1 hides your sprite for the whole 20 frames, not a blink` (packages/server/tests/monsters.test.ts)

### The seed map and new-map defaults do not save a respawn point
- **What you notice:** until you visit a map that saves a respawn point, death sends you to the server's configured fallback. The seed map and new World Editor maps with their default flags do not save a point. Entering a no-fight, indoor, no-PvP map, such as a Small Farm, Small Shop or guild-hall interior, saves a point that later deaths use, including deaths outdoors. An operator can also set those flags in the World Editor.
- **In 1.6 and SSO:** a respawn point is saved only when you draw a map flagged as no fighting, indoors and no PvP (written O-O-O), and none of the 27 original maps is flagged that way. SSO uses the same rule on the server, respawning at the operator's setting (by default the map x1000y992, tile 5,5; 1.6 used x0y102) unless the character has a saved O-O-O point.
- **In the code:** `packages/server/src/systems/world/world.ts` (`respawn`); `packages/server/src/systems/world/tick.ts` (`respawnPoint`)
- **Pinned by:** `kept bug: the seed map and new-map defaults do not save a respawn point; death without one uses the configured fallback` (packages/server/tests/world.test.ts)

## Not in SSO

### Leftovers of peer-to-peer play

1.6 ran each player's game on their own computer, so it had quirks that cannot exist when the server is in charge. SSO has nothing to keep for these.

- **The airship picture lingered after death.** 1.6 left a dead rider drawn as the airship until each viewer's screen happened to reset it, a 1-in-50 roll per frame. SSO's server resets it for everyone at the moment of death (`packages/server/src/systems/vehicles/airship.ts`, `vehicleDeath`).
- **Other players' steps were batched through a relay queue.** 1.6 sent a step directly only when exactly one other player was present; with two or more it relayed steps in 350 ms batches, duplicating some and dropping others when the queue was long. SSO's server broadcasts each step in the tick it happens, so nothing is needed.
- **Sprite-slot miscounts in the player and monster lists.** 1.6 counted players, blocked tiles and clicked names by reading fixed sprite slots, and a few slots were miscounted or wired to the wrong name field. SSO has no sprite slots, so nothing is needed.
- **The warp's input lock sat in a local variable.** 1.6 set its keyboard lock for a warp in a variable that did nothing outside that one routine; it was harmless because the hidden playfield blocked moves anyway. SSO's server holds a loading lock while you change map, so nothing is needed.
- **Several admin commands misbehaved in small ways.** 1.6 warped an admin twice for some flag pairs, showed location and IP lookups twice to someone flagged both immortal and moderator, needed an extra server access level to kick, overwrote the admin's own IP during a lookup, left a kick reply with no handler, stacked the banned prefix on repeated bans, made a file for a ban on a name that does not exist, and left stray `**` gaps in the IP ban list. SSO has a single role check and the server does the kicking and banning, so none of this exists.
- **Each screen kept its own monster hit points.** 1.6 had every client apply melee damage and roll spell damage to its own copy of a monster's hit points, so the copies drifted apart and two players could each be awarded the kill. SSO has one authoritative monster, one roll and one killer.
- **Each client rolled monster attacks against itself.** 1.6 had every client roll monster attacks and spells against its own player. SSO's server rolls once per monster and player pair, with the same probabilities.
- **A twelfth spell effect cancelled an older one.** 1.6 had eleven spell-effect sprite slots; with all busy, a new spell reused the first and cancelled the old effect. SSO has [no such cap on effects](divergences.md#no-11-spell-fx-cap).
- **Monster-hit floating numbers vanished in a crowd.** With two or more other players on screen, 1.6 routed the floating hit number through the relay queue without the map prefix, so the queue misfiled it and nobody saw it. SSO sends floating numbers as server events to the whole map, so they always show.
- **Spell damage differed between screens.** 1.6 had every client roll spell effects on monsters on its own, so monster hit points differed between players. SSO keeps one server value.
- **A duplicate monster spawner gave 10-XP kills.** 1.6 recorded a monster's name for the kill check before checking whether the slot was taken, and compared some slots to another monster's name, so after a duplicate spawn a later kill failed the name check and gave only 10 XP. SSO has one spawner and no duplicates, and drops the name check.
- **A stale monster save file brought dead monsters back.** 1.6 saved monsters at random moments, so the file could predate kills and the dead came back after a restart. SSO writes monster state on every spawn and death (`packages/server/src/systems/monsters/spawn.ts`, `spawnPass`).
- **The client banned itself on odd values.** 1.6 had the client ban its own player when hit points, level, skill or experience looked too high, and quit on a suspected speed hack. SSO does not need this because the server owns those values.
- **Client-side gold and item grants were overwritten.** 1.6 let some client-side routines add gold or items locally, and the next inventory update from the server overwrote them. SSO's client draws only what the server says, so nothing is needed.
- **A drop blanked the bag line and some replies kept the lock.** 1.6 blanked a whole bag line on screen after a drop until the next inventory update, and some replies, including refusals, sent nothing that cleared the item-action wait. SSO's client shows only server state and refusals answer at once.
- **Arriving viewers did not see gloves.** 1.6's arrival messages carried body, head, feet, both hands and head number but no ring slot, so a player arriving on a map saw no gloves until the wearer next changed equipment. SSO's look always carries all six slots, so nothing is needed.
- **The item action lock waited on the server.** 1.6 blocked further item actions on the client after equip, drop, use, planting or crafting until an inventory update arrived, and any chat line from anyone could clear it early. Only after a burned meal did it outlast the craft. SSO has one pending item action per character, cleared when processed, and crafting sets no extra pause.
- **Ground sprites and giving were drawn by peer messages.** 1.6 drew and removed ground sprites through room chat messages, and a give waited a fixed number of ticks before grabbing. SSO's server broadcasts ground changes and times the give-grab itself, so nothing is needed.
- **Gathering ran on every client.** 1.6 ran each gathering swing on all clients and passed tile changes to others with a message that had a substring-matching bug. SSO's server applies and broadcasts tile changes, so nothing is needed.
- **The trade window scrambled text and misjudged who was nearby.** 1.6 scrambled vowels in trade lists and names, which also lowercased capital vowels so a traded "Apple" arrived as "apple", and its test for the partner being on screen read the wrong sprite slot, so with one other player on screen Accept always said "<name> is no longer in your area, you cannot trade." SSO's server holds the session, names keep their case, and Accept checks the partner is on your map (`packages/server/src/systems/economy/trade.ts`, `acceptTrade`).
- **Relocking a door was sent once per player in the room.** 1.6 had every client in the room count down and send its own door-relock message. SSO has one server timer per map, so nothing is needed.
- **A guild exile dropped late joiners.** 1.6 rebuilt the whole guild file from the leader's open screen, so anyone who joined since was dropped, and other members' copies went stale. SSO changes guild rows one member at a time on the server (`packages/server/src/systems/social/guilds.ts`, `guildAction`).
- **Some guild names broke their file.** 1.6's name cleaner left one of two adjacent special characters, and a colon then cut the name at the server while the others made an illegal file path. SSO stores guilds as rows, so such a name is stored and works (`packages/server/src/systems/social/guilds.ts`, `guildCreate`).
- **The slot machine panel could stick.** In 1.6, if your gold went away between starting a pull and its result, the server exited silently and the panel could be neither pulled nor closed until the client restarted; three result handlers also set a misspelled flag that had no effect. SSO does not build either: the result always answers (`packages/server/src/systems/casino/slots.ts`, `slotTick`).
- **Blackjack tables on different maps could share a game.** 1.6 named a table's group by its screen position without the map, so tables at the same position on different maps joined one game. SSO's table instance includes the map (`packages/server/src/systems/casino/tables.ts`, `tableKey`).
- **A checkers move hid another player's sprite.** 1.6 moved one main-stage sprite off screen on every checkers move, which was the sprite of the fifth other player nearby, who vanished until they moved. SSO has no sprite slots, so nothing is needed.
- **Two players could take one seat, or three sit at a table.** 1.6 did nothing to stop two players taking the same side or a third joining, so each screen showed a different pairing and a newcomer's name landed in the wrong field. SSO's server holds the seats and a taken side says "That seat is taken." (`packages/server/src/systems/casino/blackjack.ts`, `bjSit`).
- **A blackjack bid reset on leaving never ran.** 1.6 blanked the leaver's name and then compared against that blank name before resetting the bid, so the reset never ran. SSO's server blanks the leaver's seat and field itself, so nothing is needed.
- **One client settled blackjack.** 1.6 had only the first player's client total the hands and send the result. SSO's server settles the hand (`packages/server/src/systems/casino/blackjack.ts`, `settle`).
- **The player who stayed could move alone in checkers.** 1.6 blanked the quitter's name and reset the board but not the stayer's turn, so the stayer could make one move alone. SSO's board waits for a new opponent and nobody moves until one sits.
- **Text containing a semicolon was silently dropped.** 1.6's server split routed text at semicolons and dropped it unless the first item was the sender's name, a sender check built on a text protocol. SSO authenticates the sender per session, so the check does not exist and text containing a semicolon is delivered.
- **Mail delete could hit the wrong message.** 1.6 mixed up the raw mail list with the filtered display when deleting, and re-uploaded the whole mailbox, so a delete could erase newer mail. SSO deletes message rows by id (`packages/server/src/systems/mail/mail.ts`, `mailDelete`).
- **Painting ids could collide.** 1.6 gave each painting a random id from a large range, so two could collide and one overwrote the other. SSO issues unique ids (`packages/server/src/systems/mail/art.ts`, `artSaveIntent`).
- **An ignored chat line still unlocked the bag.** 1.6 ended the client's wait for a server reply before checking whether the speaker was ignored, so an ignored player's line still unlocked it. SSO's server holds no such wait, and an ignored line is simply not sent.
- **The Friends window trusted any online notice.** 1.6 added a name to your Friends window when any client said it was online, unchecked, and skipped a buddy whose name was part of one already shown, so a listed "JimBob" hid a buddy "Bob". SSO's server keeps the window's lines from its own sessions, and an online buddy shows once, by exact name (`packages/server/src/systems/social/friends.ts`, `friendsPresence`).
- **Buddies deep in the online list never matched.** 1.6 cleaned quotes and brackets from only the first 800 characters of the online-users reply, so buddies listed further in never matched. SSO's server fills the window from its own roster and reads the first 200 names online, as 1.6 did (`packages/server/src/systems/social/friends.ts`, `friendsEntry`).
- **Closing a player's bio freed the keys.** 1.6 cleared the keyboard lock on every close of the bio window, so closing a player's bio ended a craft's lock or a death lock on that client. SSO's server holds every lock, so closing a player's bio frees nothing (an NPC's bio still ends its own lock) (`packages/server/src/systems/monsters/npc.ts`, `closeBio`).
- **Mail and post text lost or split characters.** 1.6 stripped asterisks from a body when sending, let a bar split a message into phantom list lines, and cut the rest of a mail or board at a backtick. SSO stores messages as rows, so every character is kept.
- **A backtick in a newspaper field shifted later fields.** 1.6 joined the nine newspaper fields with backticks and split them again on reading, so a backtick typed in a field moved every later item, and a semicolon made the server drop the save. SSO sends the fields as separate values, so every character is kept (`packages/server/src/systems/mail/newspapers.ts`, `newspaperSaveIntent`).

### Features 1.6 never reached

These were built into 1.6 but could never be reached in play, so SSO does the same and does not build them.

- **The boat tile-collision bypass was never reachable.** 1.6 had a complete boat flow (building, boarding, movement and unboarding) and the server accepted a dropped `'s Boat` or `'s Battleship`, but the deed handler exited before it called the boat builder, no NPC sold either deed, and the character cast had no body-55 or body-56 frames. Staging a boat by hand shows the ground `BoatPic` and lets its owner click it, but boarding raises a Script Error after the server has already removed the boat from the map. SSO does the same and does not build boats.
- **The elemental orb war never worked.** 1.6 was designed so that an orb dropped on an elemental platform shifted the balance of power between the four mage classes, but nothing connected it: no platform existed, nothing saved the balance and no monster dropped an orb, so an orb dropped as an ordinary item. SSO does the same and does not build the war; it is a candidate to build after release.
- **Pinned by:** `orb drop: a Water Orb lands on the floor like any item`; `orb drop: an orb goes into a container on the faced tile`; `orb drop: aboard an Airship "You can't drop this from the sky!"` (packages/server/tests/pigs-orbs-webs.test.ts)
