# Bug ledger

Gameplay bugs in First Star Online 1.6 that Second Star Online has not fixed yet. SSO fixes bugs the original never intended (see the [policy](differences-from-fso.md#policy)), so this ledger is a backlog: each entry says what a player notices, what 1.6 did, where the behaviour lives in the code, and which tests pin it until it is resolved.

When an entry is resolved, remove it here in the same change and record it in [differences-from-fso.md](differences-from-fso.md): as **Bug fixed** when it is fixed, or under [Kept on purpose](differences-from-fso.md#kept-on-purpose), with the reason, when fixing it would be a design change. Rename its pinning tests from `kept bug: …` to `bug fixed: …` or `kept on purpose: …`. Once the ledger is empty it is deleted.

**Entry shape.**

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

The `In the code:` paths and identifiers are checked by the gate (`tests/doc-paths.test.ts`). Every entry should name the tests that pin it.

## Index

| Section | Unfixed bugs |
|---|---|
| [world](#world) | 1 |
| **Total** | **1** |

## world

### The seed map and new-map defaults do not save a respawn point
- **What you notice:** until you visit a map that saves a respawn point, death sends you to the server's configured fallback. The seed map and new World Editor maps with their default flags do not save a point. Entering a no-fight, indoor, no-PvP map, such as a Small Farm, Small Shop or guild-hall interior, saves a point that later deaths use, including deaths outdoors. An operator can also set those flags in the World Editor.
- **In 1.6 and SSO:** a respawn point is saved only when you draw a map flagged as no fighting, indoors and no PvP (written O-O-O), and none of the 27 original maps is flagged that way. SSO uses the same rule on the server, respawning at the operator's setting (by default the map x1000y992, tile 5,5; 1.6 used x0y102) unless the character has a saved O-O-O point.
- **In the code:** `packages/server/src/systems/world/world.ts` (`respawn`); `packages/server/src/systems/world/tick.ts` (`respawnPoint`)
- **Pinned by:** `kept bug: the seed map and new-map defaults do not save a respawn point; death without one uses the configured fallback` (packages/server/tests/world.test.ts)
