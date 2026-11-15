/**
 * The personal vault. A ground fixture named `Vault` opens your own vault (`<you>.txt`); nobody
 * else's.
 */
import {
  bagText,
  FACING_DELTA,
  filledLines,
  invAdd,
  lingoContains,
  type Rng,
} from "@secondstaronline/shared";

import type { GroundItem, Outgoing, Player } from "../world/world.ts";

/** "Vault" holds 15 lines (the personal file `<name>.txt` gets the default 15). */
export const VAULT_CAPACITY = 15;

export const VAULT_TEXT = {
  open: "You open your vault to see what's inside...",
  notInFront: "You see your vault, but you must be standing in front of it to use it.",
  container: "You cannot store a container!",
  drop: (item: string) => `You drop a ${item} into the container.`,
  full: "This is too full to store anything else!",
  carrying: "You are carrying too much to withdraw this item.",
} as const;

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

/**
 * The vault click: the vault must be the tile you face, with you standing still (the sprite
 * pixels). Opening locks the keys and makes the open container the player's own, and the server
 * returns the file.
 */
export function openVault(p: Player, g: GroundItem): Outgoing[] {
  const [dx, dy] = FACING_DELTA[p.facing];
  if (p.stepFrames > 0 || g.x !== p.x + dx || g.y !== p.y + dy) {
    return [tell(p, VAULT_TEXT.notInFront)];
  }
  p.vaultOpen = true;
  p.container = null;
  p.keyLock = true;
  p.shop = null;
  // 1.6's vault-opened reply set its modify flag and cleared the item-action pause.
  p.itemPause = 0;
  return [
    { to: p.id, msg: { t: "vault", items: [...p.char.vault], open: true } },
    tell(p, VAULT_TEXT.open),
  ];
}

/**
 * Drop while facing the Vault: a container is refused; otherwise the client prints its line before
 * the server's capacity test, and one unit goes in. The open list is not refreshed.
 */
export function depositVault(p: Player, slot: number): Outgoing[] {
  const line = p.char.bag[slot - 1];
  if (!line) {
    return [];
  }
  const item = line.item;
  if (["Cabinet", "Crate", "Cauldron"].some((c) => lingoContains(item, c))) {
    // 1.6's 425-frame item-action pause and modify flag cleared were locals here: no lock.
    return [tell(p, VAULT_TEXT.container)];
  }
  const out = [tell(p, VAULT_TEXT.drop(item))];
  if (p.char.vault.length >= VAULT_CAPACITY) {
    out.push(tell(p, VAULT_TEXT.full));
    return out;
  }
  line.qty -= 1;
  if (line.qty <= 0) {
    p.char.bag[slot - 1] = null;
  }
  p.char.vault.push(item);
  p.char.storeDirty = true;
  p.invDirty = true;
  return out;
}

/**
 * The vault window's OK on a line:
 * - the first withdraw unlocks the keys, so you can walk off and keep taking;
 * - the client's bag test: more than 14 lines and no `<item>-` in the bag text;
 * - a ` Crystals` line is re-split into "Crystals " (a kept 1.6 bug: every colour merges into one
 *   worthless item);
 * - `InvAdd` stacks only on an exact name, so a bag whose only room is a substring match ("Orc Pot
 *   Pie" for "Pie") adds nothing, yet the line is still deleted (a kept 1.6 bug: withdrawing into
 *   a full bag can destroy the item). The window's list loses the line.
 */
export function withdrawVault(p: Player, index: number, rng: Rng): Outgoing[] {
  if (!p.vaultOpen) {
    return [];
  }
  p.keyLock = false;
  const item = p.char.vault[index - 1];
  if (item === undefined || item === "") {
    return [];
  }
  if (filledLines(p.char.bag) > 14 && !lingoContains(bagText(p.char.bag), `${item}-`)) {
    return [tell(p, VAULT_TEXT.carrying)];
  }
  let add = item;
  if (lingoContains(item, " Crystals")) {
    const words = item.split(" ");
    add = `${words[1] ?? ""} ${words[2] ?? ""}`;
  }
  const r = invAdd(p.char, add, 1, rng);
  if (r.kind !== "full") {
    p.invDirty = true;
  }
  p.char.vault.splice(p.char.vault.indexOf(item), 1);
  p.char.storeDirty = true;
  return [{ to: p.id, msg: { t: "vault", items: [...p.char.vault], open: false } }];
}
