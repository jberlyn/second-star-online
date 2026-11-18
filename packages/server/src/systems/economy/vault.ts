/**
 * The personal vault. A ground fixture named `Vault` opens your own vault (`<you>.txt`); nobody
 * else's.
 */
import {
  addSlotFor,
  displayName,
  FACING_DELTA,
  invAdd,
  isGoldName,
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
  drop: (item: string) => `You drop a ${displayName(item)} into the container.`,
  /** A withdrawal (1.6 printed nothing). */
  take: (item: string) => `You take a ${displayName(item)} out of the container.`,
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
 * Drop while facing the Vault, or with the vault window open: a container is refused, a full
 * vault says so, otherwise one unit goes in, the drop line prints and an open list shows it. (1.6
 * printed the drop line before the capacity test and never refreshed the list.)
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
  if (p.char.vault.length >= VAULT_CAPACITY) {
    return [tell(p, VAULT_TEXT.full)];
  }
  line.qty -= 1;
  if (line.qty <= 0) {
    p.char.bag[slot - 1] = null;
  }
  p.char.vault.push(item);
  p.char.storeDirty = true;
  p.invDirty = true;
  const out = [tell(p, VAULT_TEXT.drop(item))];
  if (p.vaultOpen) {
    out.push({ to: p.id, msg: { t: "vault", items: [...p.char.vault], open: false } });
  }
  return out;
}

/**
 * The vault window's OK on a line: the window stays open and the keys stay locked until CANCEL (in
 * 1.6 the first take freed the keys, so you could walk off and keep taking). The item needs a
 * stack of exactly its name or an empty line, else "You are carrying too much…" and the line
 * stays (1.6 let "Orc Pot Pie" pass for "Pie", added nothing and deleted the line). A crystal line
 * comes back as itself (1.6 turned every colour into "Crystals ").
 */
export function withdrawVault(p: Player, index: number, rng: Rng): Outgoing[] {
  if (!p.vaultOpen) {
    return [];
  }
  const item = p.char.vault[index - 1];
  if (item === undefined || item === "") {
    return [];
  }
  if (addSlotFor(p.char.bag, item) < 0 && !isGoldName(item)) {
    return [tell(p, VAULT_TEXT.carrying)];
  }
  invAdd(p.char, item, 1, rng);
  p.invDirty = true;
  p.char.vault.splice(index - 1, 1);
  p.char.storeDirty = true;
  return [
    { to: p.id, msg: { t: "vault", items: [...p.char.vault], open: false } },
    tell(p, VAULT_TEXT.take(item)),
  ];
}
