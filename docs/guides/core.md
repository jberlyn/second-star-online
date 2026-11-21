# Core

## What happens in play

A tile with an empty code can be treated as walkable because the original substring whitelist accepts the empty word. Other systems reuse these small rules.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/shared/src/rules/core/fighter.ts](../../packages/shared/src/rules/core/fighter.ts): defines fighter, equipment and skill helpers.
- [packages/shared/src/rules/core/lingo.ts](../../packages/shared/src/rules/core/lingo.ts): implements original-style text and numeric helpers.
- [packages/shared/src/rules/core/maps.ts](../../packages/shared/src/rules/core/maps.ts): handles grid and house map names.
- [packages/shared/src/rules/core/patterns.ts](../../packages/shared/src/rules/core/patterns.ts): matches ordered name rules.
- [packages/shared/src/rules/core/tiles.ts](../../packages/shared/src/rules/core/tiles.ts): provides tile flags.
- [packages/shared/src/rules/core/timelength.ts](../../packages/shared/src/rules/core/timelength.ts): parses and prints lengths of time.
- [packages/shared/src/rules/core/walk.ts](../../packages/shared/src/rules/core/walk.ts): builds and queries movement grids.

Entry points:

- `packages/shared/src/rules/core/lingo.ts` (`lingoContains`).
- `packages/shared/src/rules/core/patterns.ts` (`firstMatch`, `lastMatch`).
- `packages/shared/src/rules/core/maps.ts` (`parseHouseMapName`).
- `packages/shared/src/rules/core/walk.ts` (`footWalkGrid`).

## How it works

The shared fighter types describe equipment and faction data and support skill lookup. Lingo helpers preserve case-insensitive comparisons and the original word, integer, division and random conventions. Pattern rows are ordered: some callers select the first match and others the last, so overlapping item names can behave differently.

Map helpers parse grid names and house interiors. Tile flags describe categories such as water and arena tiles; walk helpers build separate foot, Airship and ship grids (a ship's is layer-1 sea water). These are shared calculations, with callers deciding when and how to apply their results. There is no server core folder.

### Names, values and movement

`lingoEq` and `lingoContains` ignore case; the word and integer helpers model the text parsing used by rules that originated in the game. Integer division and the supplied random source have their own helpers. Callers pass an RNG so rules can be tested with a predictable sequence.

A pattern is exact or substring based. `firstMatch` stops at the first matching row and `lastMatch` keeps the last, so the ordering of editable item rules matters. The map helpers distinguish ordinary grid names from house interior names. Tile categories come from [tile content](../../packages/data/content/tiles.json); foot movement uses the whitelist and blocking rules, while an Airship uses its separate blocking grid. The shared module supplies a grid, not authority to move a character.

## Differences from 1.6

Two behaviours of the shared helpers matter to content authors: an empty tile code matches the walk whitelist, and the last matching recipe can win when more than one pattern matches.

See the [core bugs fixed](../differences-from-fso.md#core), [server-side core changes](../differences-from-fso.md#server-side-core) and [movement bugs fixed](../differences-from-fso.md#movement).
