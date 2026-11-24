/**
 * Named containers: the Cauldron, placed crates, cabinets and chests, house and guild vaults, and a
 * carried Crate, Cabinet, Wind Cabinet or Cauldron. They share the personal vault's window (with
 * no title). Access: a house vault is its owner's, a guild vault its guild's members', a carried
 * container its carrier's; everything placed is anyone's who faces it. Quest chests are one
 * container per chest type, refilled on the save clock.
 */
import {
  addSlotFor,
  CRAFT_TEXT,
  cauldronBrew,
  content,
  displayName,
  FACING_DELTA,
  hasBehaviour,
  invAdd,
  isEngineFixture,
  isFixtureKind,
  isGoldName,
  isStorageContainer,
  isUniqueContainer,
  itemLabel,
  lastMatch,
  lingoEq,
  menuAction,
  periodicSave,
  QUEST_SAVE_BLOCK,
  questChestRefill,
  type Rng,
  withoutId,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import type { GroundItem, Outgoing, Player, World } from "../world/world.ts";
import { VAULT_TEXT } from "./vault.ts";

/** The capacity by name, `contains` cascade, last wins. */
export function containerCapacity(name: string): number {
  const C = content().itemRules.containers;
  // Tested without a carried container's `#id`: `Crate#12` holds what a Crate holds.
  return lastMatch(C.capacity, withoutId(name))?.capacity ?? C.defaultCapacity;
}

export const CONTAINER_TEXT = {
  /** The chest click: the `#id` is stripped; a House Vault reads "You open <name>". */
  open: (name: string) =>
    isFixtureKind(name, "houseVault")
      ? `You open ${name} to see what's inside...`
      : `You open the ${itemLabel(name)} to see what's inside...`,
  /** The line for a click from the wrong spot: the `#id` is not stripped. */
  notInFront: (name: string) =>
    isFixtureKind(name, "houseVault")
      ? `You see ${name}, but you must be standing in front of it to use it.`
      : `You see the ${name}, but you must be standing in front of it to use it.`,
  /** SSO, after the mailbox's "You can't check mail that's not yours!" */
  notYours: "You can't open a vault that's not yours!",
  /** SSO: a carried container with no `#id` of its own (it would share its storage). */
  shared: "This can't hold anything: it has no storage of its own.",
  /** SSO: a stack of containers with no `#id` and no free bag line to take one out onto. */
  makeRoom: "Make room in your bag to open one of these.",
} as const;

/**
 * Who may open or fill a container: `<owner>'s House Vault` only its owner, by exact name; `The
 * <guild>'s Guild Vault` the members of that guild, by name (a disbanded guild's vault opens again
 * only if its last leader founds it anew: `guildCreate`); the rest anyone.
 */
export function mayUseContainer(p: Player, name: string): boolean {
  if (isFixtureKind(name, "guildVault")) {
    return p.guild !== "" && lingoEq(name, `The ${p.guild}'s Guild Vault`);
  }
  if (isFixtureKind(name, "houseVault")) {
    return lingoEq(name, `${p.name}'s House Vault`);
  }
  return true;
}

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

const linesOf = (world: World, name: string): string[] => world.containers.get(name) ?? [];

function write(world: World, name: string, lines: string[]): void {
  world.containers.set(name, lines);
  world.containersDirty.add(name);
}

/** The window opens: the vault window, the keys locked, the pause cleared. */
function show(world: World, p: Player, name: string, carried = false): Outgoing {
  const shown = [...linesOf(world, name)];
  p.container = carried ? { name, shown, carried } : { name, shown };
  p.vaultOpen = false;
  p.shop = null;
  p.keyLock = true;
  // 1.6's vault-opened reply also set its modify flag and cleared the item-action pause.
  p.itemPause = 0;
  return { to: p.id, msg: { t: "vault", items: shown, open: true } };
}

/**
 * A click or Ctrl on a container: standing in front and facing it opens it, else "You see the …,
 * but you must be standing in front of it to use it."; then the access rule. Ctrl itself finds
 * nothing mid-step, so the "standing in front" line comes only from a click.
 */
export function openContainer(world: World, p: Player, g: GroundItem): Outgoing[] {
  const [dx, dy] = FACING_DELTA[p.facing];
  if (p.stepFrames > 0 || g.x !== p.x + dx || g.y !== p.y + dy) {
    return [tell(p, CONTAINER_TEXT.notInFront(g.item))];
  }
  if (!mayUseContainer(p, g.item)) {
    return [tell(p, CONTAINER_TEXT.notYours)];
  }
  return [show(world, p, g.item), tell(p, CONTAINER_TEXT.open(g.item))];
}

/**
 * The item menu's Storage: exits while the keys are locked or an item action is pausing, no
 * selection test, the open container is the bag name with its `#id`, then "You open the <kind> to
 * see what's inside..." for every kind (1.6 built a line only for a Cabinet, so a Crate or Cauldron
 * printed nothing). A chest cannot be carried in 1.6 (no item code; a click or Ctrl opens one), so
 * its Storage path is never reached.
 */
export function storageIntent(world: World, p: Player, slot: number, rng?: Rng): Outgoing[] {
  const line = p.char.bag[slot - 1];
  if (!line || menuAction(line.item) !== "Storage" || p.keyLock || p.itemPause > 0) {
    return [];
  }
  if (p.deadLock > 0 || p.loading > 0 || hasBehaviour(line.item, "chest")) {
    return [];
  }
  // A carried container keeps its storage under its own `#id`. One held from before its item was
  // given one (an operator turned a definition's per-copy id on) gets its id now, so copies never
  // share one inventory; a stack gives one copy its id on a line of its own.
  if (!line.item.includes("#")) {
    if (!rng || !isUniqueContainer(line.item)) {
      return [tell(p, CONTAINER_TEXT.shared)];
    }
    const named = freshContainerName(world, p, line.item, rng);
    if (line.qty <= 1) {
      line.item = named;
    } else {
      const free = p.char.bag.indexOf(null);
      if (free < 0) {
        return [tell(p, CONTAINER_TEXT.makeRoom)];
      }
      line.qty -= 1;
      p.char.bag[free] = { item: named, qty: 1 };
      p.invDirty = true;
      return [show(world, p, named, true), tell(p, CONTAINER_TEXT.open(named))];
    }
    p.invDirty = true;
  }
  return [show(world, p, line.item, true), tell(p, CONTAINER_TEXT.open(line.item))];
}

/** A container name `<name>#<n>` no container, bag or vault line holds yet. */
function freshContainerName(world: World, p: Player, name: string, rng: Rng): string {
  const held = (n: string) =>
    world.containers.has(n) ||
    p.char.bag.some((l) => l !== null && lingoEq(l.item, n)) ||
    p.char.vault.some((v) => lingoEq(v, n));
  let named = `${withoutId(name)}#${rng.random(999999)}`;
  for (let i = 0; i < 20 && held(named); i++) {
    named = `${withoutId(name)}#${rng.random(999999)}`;
  }
  return named;
}

/**
 * Drop while facing a container, or with its window open: a container is refused, a full one says
 * so, else one unit goes in and the drop line prints (1.6 printed it before the capacity test).
 * Then a Cauldron runs its recipes: a brew swaps its ingredients for the result and says so to the
 * depositor; a deposit that completes nothing says nothing more (1.6 "fizzled" on every one). The
 * list of anyone with the container open is refreshed.
 */
export function depositContainer(
  world: World,
  p: Player,
  slot: number,
  name: string,
  n = 1,
): Outgoing[] {
  const line = p.char.bag[slot - 1];
  if (!line) {
    return [];
  }
  // Someone else's house vault, or a guild vault, refuses before the drop line and takes nothing.
  if (!mayUseContainer(p, name)) {
    return [tell(p, CONTAINER_TEXT.notYours)];
  }
  const item = line.item;
  if (isStorageContainer(item)) {
    return [tell(p, VAULT_TEXT.container)];
  }
  if (linesOf(world, name).length >= containerCapacity(name)) {
    return [tell(p, VAULT_TEXT.full)];
  }
  // One unit at a time, as many as fit: a Cauldron tries its recipes after each one.
  const out: Outgoing[] = [];
  let count = 0;
  let brews = 0;
  while (count < n && line.qty > 0) {
    const lines = linesOf(world, name);
    if (lines.length >= containerCapacity(name)) {
      break;
    }
    line.qty -= 1;
    count += 1;
    const next = [...lines, item];
    const brewed = hasBehaviour(name, "cauldron") ? cauldronBrew(next) : null;
    write(world, name, brewed ?? next);
    if (brewed !== null) {
      brews += 1;
    }
  }
  if (line.qty <= 0) {
    p.char.bag[slot - 1] = null;
  }
  p.invDirty = true;
  logActivity(world, p, "container", {
    other: displayName(name),
    item,
    qty: -count,
    details: { container: name, brews: brews || null },
  });
  out.push(tell(p, count > 1 ? VAULT_TEXT.dropMany(count, item) : VAULT_TEXT.drop(item)));
  for (let i = 0; i < brews; i++) {
    out.push(tell(p, CRAFT_TEXT.puff));
  }
  if (count < n) {
    out.push(tell(p, VAULT_TEXT.full));
  }
  out.push(...refreshViewers(world, name));
  return out;
}

/** Everyone with `name` open sees its current contents. */
function refreshViewers(world: World, name: string): Outgoing[] {
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    if (o.container && lingoEq(o.container.name, name)) {
      o.container.shown = [...linesOf(world, name)];
      out.push({ to: o.id, msg: { t: "vault", items: [...o.container.shown], open: false } });
    }
  }
  return out;
}

/**
 * The window's OK on a container's line: the window stays open and the keys locked until CANCEL
 * (1.6 freed them on the first take). The client names the line by its place in the list it
 * shows; the server takes the first stored line **equal** to it, or nothing; one unit, into a stack
 * of exactly that name or an empty line, else "You are carrying too much…" and nothing moves. A
 * crystal line comes back as itself. Everyone with the container open sees the new list.
 */
export function withdrawContainer(world: World, p: Player, index: number, rng: Rng): Outgoing[] {
  const c = p.container;
  if (!c) {
    return [];
  }
  // A take re-checks who may use the container: a player expelled from a guild with its vault open
  // takes nothing and the window closes. 1.6 had no such case. A crate or cabinet opened from the
  // bag is the carrier's: once given, traded, sold or dropped, its window takes nothing more and
  // closes (in 1.6 the open container kept its name, so the old owner could empty it).
  const stillCarried = !c.carried || p.char.bag.some((l) => l !== null && lingoEq(l.item, c.name));
  if (!stillCarried || !mayUseContainer(p, c.name)) {
    p.container = null;
    p.keyLock = false;
    return [{ to: p.id, msg: { t: "vault", items: [], open: false, closed: true } }];
  }
  const item = c.shown[index - 1];
  if (item === undefined || item === "") {
    return [];
  }
  const lines = [...linesOf(world, c.name)];
  const at = lines.findIndex((l) => lingoEq(l, item));
  if (at < 0) {
    c.shown = [...lines];
    return [{ to: p.id, msg: { t: "vault", items: [...c.shown], open: false } }];
  }
  if (addSlotFor(p.char.bag, item) < 0 && !isGoldName(item)) {
    return [tell(p, VAULT_TEXT.carrying)];
  }
  const r = invAdd(p.char, item, 1, rng);
  logActivity(world, p, "container", {
    other: displayName(c.name),
    ...(r.kind === "gold" ? { gold: r.amount } : { item, qty: 1 }),
    details: { container: c.name },
  });
  p.invDirty = true;
  lines.splice(at, 1);
  write(world, c.name, lines);
  return [...refreshViewers(world, c.name), tell(p, VAULT_TEXT.take(item))];
}

/**
 * The periodic save and its quest chest roll for one player: the save-block counter counts down;
 * once 0, `random(350) = 1` saves and resets it to 400; the save rolls the quest chest, which adds
 * its one line to the chest when there is room (1.6 overwrote the chest, wiping what was in it).
 * Like every placed chest, a quest chest is one container that anyone facing it can use.
 */
export function saveClockStep(world: World, p: Player, rng: Rng): void {
  if (p.saveBlock > 0) {
    p.saveBlock -= 1;
    return;
  }
  if (!periodicSave(rng)) {
    return;
  }
  p.saveBlock = QUEST_SAVE_BLOCK;
  const refill = questChestRefill(rng);
  if (refill) {
    const lines = linesOf(world, refill.chest);
    if (lines.length < containerCapacity(refill.chest)) {
      write(world, refill.chest, [...lines, refill.item]);
    }
  }
}

/**
 * Drop's container route for the first item on the faced tile, or null: a house or guild vault (by
 * fixture kind), or a placed container (a cabinet, crate or cauldron with its `#id`) or a chest (by
 * behaviour). Any other engine fixture takes nothing, whatever its owner is called. The personal
 * vault is the caller's, before this. `houses.json` `containers.drop` named the same containers in
 * 1.6's words and is no longer read: a container whose behaviour is taken away takes nothing.
 */
export function dropRoute(g: GroundItem): string | null {
  if (isEngineFixture(g.item)) {
    return isFixtureKind(g.item, "houseVault", "guildVault") ? g.item : null;
  }
  return (g.item.includes("#") && isStorageContainer(g.item)) || hasBehaviour(g.item, "chest")
    ? g.item
    : null;
}
