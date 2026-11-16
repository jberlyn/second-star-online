/** Entry points the gateway, the item clicks and the tick use for the casino tables. */
import type { Outgoing, Player, World } from "../world/world.ts";
import { bjDisconnect, bjLeave, bjReturn, bjTick, type CasinoDeps } from "./blackjack.ts";
import { ckClose, ckDisconnect } from "./checkers.ts";
import { slotMapLeave } from "./slots.ts";

export type { CasinoDeps } from "./blackjack.ts";

/** `game.leave`: a drop, before the player leaves the world. */
export function casinoLeave(world: World, p: Player, deps: CasinoDeps): Outgoing[] {
  return [...bjDisconnect(world, p, deps), ...ckDisconnect(world, p)];
}

/** A map change or editor entry closes any open slot panel, blackjack seat, or checkers seat. */
export function casinoMapChange(world: World, p: Player, deps: CasinoDeps): Outgoing[] {
  return [...slotMapLeave(p), ...bjLeave(world, p, deps), ...ckClose(world, p)];
}

/** `game.enter`: a resume or a login inside the grace takes the seat back. */
export function casinoReturn(world: World, p: Player): Outgoing[] {
  return bjReturn(world, p);
}

/** The world tick step: the 40-frame reset and the reconnect grace. */
export function casinoTick(world: World, deps: CasinoDeps): Outgoing[] {
  const out: Outgoing[] = [];
  for (const table of [...world.casinoTables.values()]) {
    if (table.game === "blackjack") {
      out.push(...bjTick(world, table, deps));
    }
  }
  return out;
}
