# Core

## What happens in play

A tile with an empty code can be treated as walkable because the original substring whitelist accepts the empty word. Other systems reuse these small rules.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- Recognizes engine fixtures, including owner-named doors, vaults and vehicles. [fixtures.ts](../../packages/shared/src/rules/core/fixtures.ts)
- Validates account preferences and handles key rebinding. [preferences.ts](../../packages/shared/src/rules/core/preferences.ts)
- Checks content-defined skill, level and class requirements. [requirements.ts](../../packages/shared/src/rules/core/requirements.ts)
- [packages/shared/src/rules/core/fighter.ts](../../packages/shared/src/rules/core/fighter.ts): defines fighter, equipment and skill helpers.
- [packages/shared/src/rules/core/lingo.ts](../../packages/shared/src/rules/core/lingo.ts): implements original-style text and numeric helpers.
- [packages/shared/src/rules/core/maps.ts](../../packages/shared/src/rules/core/maps.ts): handles grid and house map names.
- [packages/shared/src/rules/core/patterns.ts](../../packages/shared/src/rules/core/patterns.ts): matches ordered name rules, leaving out the items a definition decides.
- [packages/shared/src/rules/core/tiles.ts](../../packages/shared/src/rules/core/tiles.ts): provides tile flags, tile defaults and the names the hover tip gives gatherable tiles.
- [packages/shared/src/rules/core/timelength.ts](../../packages/shared/src/rules/core/timelength.ts): parses and prints lengths of time.
- [packages/shared/src/rules/core/walk.ts](../../packages/shared/src/rules/core/walk.ts): builds and queries movement grids.

Entry points:

- `packages/shared/src/rules/core/lingo.ts` (`lingoContains`).
- `packages/shared/src/rules/core/patterns.ts` (`firstMatch`, `lastMatch`).
- `packages/shared/src/rules/core/maps.ts` (`parseHouseMapName`).
- `packages/shared/src/rules/core/walk.ts` (`footWalkGrid`, `airshipWalkGrid`).
- `packages/shared/src/rules/core/requirements.ts` (`requirementMet`, `firstUnmet`).
- `packages/shared/src/rules/core/fixtures.ts` (`engineFixtureKind`).

## How it works

The shared fighter types describe equipment and faction data and support skill lookup. Lingo helpers preserve case-insensitive comparisons and the original word, integer, division and random conventions. Pattern rows are ordered: some callers select the first match and others the last, so overlapping item names can behave differently.

Map helpers parse grid names and house interiors. Tile flags describe categories such as water and arena tiles (`sea`, `airshipBlock`, `dock`, `arena`, `grave`); walk helpers build the foot grid and the `airshipBlock` grid, and each vehicle's own grid comes from its content row (`vehicleWalkGrid` in `packages/shared/src/rules/vehicles/rows.ts`; Classic's ships sail layer-1 sea water). These are shared calculations, with callers deciding when and how to apply their results. There is no server core folder.

### Names, values and movement

`lingoEq` and `lingoContains` ignore case; the word and integer helpers model the text parsing used by rules that originated in the game. Integer division and the supplied random source have their own helpers. Callers pass an RNG so rules can be tested with a predictable sequence.

A pattern is exact or substring based. `firstMatch` stops at the first matching row and `lastMatch` keeps the last, so the ordering of editable item rules matters. The map helpers distinguish ordinary grid names from house interior names. Tile categories come from [tile content](../../packages/data/content/tiles.json); foot movement uses the whitelist and blocking rules, while an Airship uses its separate blocking grid. The shared module supplies a grid, not authority to move a character. `tileName` gives the hover tip a layer-2 tile's name from the tile catalogue's `name` (a gatherable tile, say).

A pattern row can carry `except`: names it no longer matches because an item definition decides that item (`excepted`, honoured by `ruleMatches`); the content store compiles it and it is never stored. The skill helpers in `fighter.ts` find a skill by key (`findSkillIndex`), by the job content binds it to (`boundSkillIndex`, undefined for a binding the world leaves out, so that mechanic trains nothing) and in Skills-page order, since a world's skills are content.

### Requirements, fixtures and lengths of time

A requirement (`requirements.ts`) is a content row `{ needs, atLeast }`: `needs` is a skill key, exactly `level`, or exactly `class` with a list of class codes. `requirementMet` tests one against a character's level, skills and class, and `firstUnmet` returns the first a character fails, with the line to say (`requirementText`). Items (to equip or use), harvest nodes and recipes use them.

An engine fixture (`fixtures.ts`) is a ground item whose name the engine builds or reads itself: a house's `<owner>'s Door`, `Opened Door`, `Mailbox` and `House Vault`, a guild's `Board` and `Guild Vault`, a parked vehicle (`<owner>'s <vehicle>` for any vehicle row), the exits, the three signs and the Street Lamp. `engineFixtureKind` reads the whole name, and no content item may take such a name or have an item behaviour apply to it.

`parseTimeLength` and `formatTimeLength` read and print lengths such as `30s`, `5m` and `1d 12h`, for the Server Settings page and the server's configuration. `preferences.ts` holds the account preferences' schema and defaults, the Modern and Classic key presets and rebinding (`rebindKey`).

## Differences from 1.6

Two behaviours of the shared helpers matter to content authors: an empty tile code matches the walk whitelist, and the last matching recipe can win when more than one pattern matches.

See the [core bugs fixed](../differences-from-fso.md#core), [server-side core changes](../differences-from-fso.md#server-side-core) and [movement bugs fixed](../differences-from-fso.md#movement).
