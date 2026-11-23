/**
 * The personal vault. A ground fixture named `Vault` opens your own vault (`<you>.txt`); nobody
 * else's.
 */
import {
  addSlotFor,
  FACING_DELTA,
  invAdd,
  isGoldName,
  isStorageContainer,
  itemLabel,
  type Rng,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import type { GroundItem, Outgoing, Player, World } from "../world/world.ts";

/** "Vault" holds 15 lines (the personal file `<name>.txt` gets the default 15). */
export const VAULT_CAPACITY = 15;

export const VAULT_TEXT = {
  open: "You open your vault to see what's inside...",
  notInFront: "You see your vault, but you must be standing in front of it to use it.",
  container: "You cannot store a container!",
  drop: (item: string) => `You drop a ${itemLabel(item)} into the container.`,
  /** A deposit of more than one. */
  dropMany: (n: number, item: string) => `You drop ${n} ${itemLabel(item)} into the container.`,
  /** A withdrawal (1.6 printed nothing). */
  take: (item: string) => `You take a ${itemLabel(item)} out of the container.`,
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
export function depositVault(world: World, p: Player, slot: number, n = 1): Outgoing[] {
  const line = p.char.bag[slot - 1];
  if (!line) {
    return [];
  }
  const item = line.item;
  if (isStorageContainer(item)) {
    // 1.6's 425-frame item-action pause and modify flag cleared were locals here: no lock.
    return [tell(p, VAULT_TEXT.container)];
  }
  // Each unit takes a line of its own; as many as fit go in.
  const count = Math.min(n, line.qty, VAULT_CAPACITY - p.char.vault.length);
  if (count <= 0) {
    return [tell(p, VAULT_TEXT.full)];
  }
  logActivity(world, p, "vault", { item, qty: -count });
  line.qty -= count;
  if (line.qty <= 0) {
    p.char.bag[slot - 1] = null;
  }
  for (let i = 0; i < count; i++) {
    p.char.vault.push(item);
  }
  p.char.storeDirty = true;
  p.invDirty = true;
  const out = [tell(p, count > 1 ? VAULT_TEXT.dropMany(count, item) : VAULT_TEXT.drop(item))];
  if (count < n) {
    out.push(tell(p, VAULT_TEXT.full));
  }
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
export function withdrawVault(world: World, p: Player, index: number, rng: Rng): Outgoing[] {
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
  const r = invAdd(p.char, item, 1, rng);
  logActivity(world, p, "vault", r.kind === "gold" ? { gold: r.amount } : { item, qty: 1 });
  p.invDirty = true;
  p.char.vault.splice(index - 1, 1);
  p.char.storeDirty = true;
  return [
    { to: p.id, msg: { t: "vault", items: [...p.char.vault], open: false } },
    tell(p, VAULT_TEXT.take(item)),
  ];
}
