# Casino

## What happens in play

Two players sit at a blackjack table, lock bids and play a hand; the server holds their stakes and settles the result.

## Where it lives

Shared rules calculate outcomes; server systems apply them to world and player state.

- [packages/server/src/systems/casino/blackjack.ts](../../packages/server/src/systems/casino/blackjack.ts): holds bids, deals and settles hands.
- [packages/server/src/systems/casino/checkers.ts](../../packages/server/src/systems/casino/checkers.ts): handles seats and validates checkers moves.
- [packages/server/src/systems/casino/index.ts](../../packages/server/src/systems/casino/index.ts): coordinates casino leave, return and ticking.
- [packages/server/src/systems/casino/slots.ts](../../packages/server/src/systems/casino/slots.ts): runs slot spins.
- [packages/server/src/systems/casino/tables.ts](../../packages/server/src/systems/casino/tables.ts): identifies tables and builds player views.
- [packages/shared/src/rules/casino/blackjack.ts](../../packages/shared/src/rules/casino/blackjack.ts): defines cards, bids and hand outcomes.
- [packages/shared/src/rules/casino/casino.ts](../../packages/shared/src/rules/casino/casino.ts): defines slot rules and click gates.
- [packages/shared/src/rules/casino/checkers.ts](../../packages/shared/src/rules/casino/checkers.ts): defines board moves and promotion.

Entry points:

- `packages/server/src/systems/casino/index.ts` (`casinoTick`).
- `packages/shared/src/rules/casino/blackjack.ts` (`handTotal`).

## How it works

Slots check the machine and player state, run the spin on ticks, and settle the reels against the player's gold. Tables are identified by map and coordinates, with a seat for each side. Blackjack validates bids, holds the locked gold, returns any excess over the matched stake and deals on the server. Cards, totals and the outcome use shared rules; the server sends each seat its view and eventually resets the table.

A player who leaves during a hand forfeits; a disconnected seat has a grace period before it is dropped. Saved gold includes a held stake while the hand is unresolved. Checkers has no stake: the server validates ownership, moves and turns, advances the board and handles promotion. The server decides and settles these games rather than trusting a player's client.

### Slots and tables

A slot panel has an idle state and a spin countdown. A pull is allowed only when the panel is open, idle, and the player is standing in front of a slot machine (a pull from anywhere else closes the panel); the server enforces the spin interval and computes the reels and payout. If the player's gold is under 5 (either on pull or when the spin settles), the server refuses the pull/settlement, returns the lever, and leaves the panel open. A map change closes the panel. The slot values are editable in [casino content](../../packages/data/content/casino.json).

At a blackjack table, a seat is tied to the table's map and tile. Joining resets the table and releases any held bids. After both players lock positive integer bids, the lower bid is the stake and excess is returned. Cards are drawn from a 13-rank shoe (4/13 chance of a 10-value card) with replacement, Aces reduce from 11 to 1 one at a time, a 5-card hand stands automatically, and both hands busting is a draw. A draw returns the held stake; a win transfers it. A disconnect retains the blackjack seat for the configured grace period, after which an unfinished hand is forfeited; a return during grace restores its view. Leaving before the deal releases holds, and changing map leaves the seat.

For checkers, the server stores the pieces, turn, and multi-jump continuation (`jumpFrom`) while the client keeps its own selection and turn marker. A move must belong to the moving side and pass the shared move rules (enforcing forced capture, multi-jump continuation, and win by blocking). Closing, disconnecting, or changing map frees a checkers seat; on a win, the board resets with Black moving first.

## Differences from 1.6

Fixes include `4-4-4` paying 80 and `2-3-2` paying 50; blackjack's 13-rank shoe, positive bids, single-Ace reduction, draw on double bust, automatic stand on 5 cards and persistent wrong-spot text; checkers' forced capture, multi-jump, win by blocking, single start line and Black first on rematch; slots accepting `"Slot Machine"` variants, keeping the panel open on short gold and requiring you to stand at a machine; and map changes closing every casino panel and seat.

See the [casino bugs fixed](../differences-from-fso.md#casino) and [server-side casino changes](../differences-from-fso.md#server-side-casino).
