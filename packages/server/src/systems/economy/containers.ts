/**
 * Named containers: the Cauldron, placed crates, cabinets and chests, house and guild vaults, and a
 * carried Crate, Cabinet, Wind Cabinet or Cauldron. They share the personal vault's window (with
 * no title). Access: a house vault is its owner's, a guild vault its guild's members', a carried
 * container its carrier's; everything placed is anyone's who faces it. Quest chests are one
 * container per chest type, refilled on the save clock.
 */
import { houseData, itemRulesData } from "@secondstaronline/data";
import {
  bagText,
  CAULDRON,
  CRAFT_TEXT,
  cauldronBrew,
  displayName,
  FACING_DELTA,
  filledLines,
  invAdd,
  lastMatch,
  lingoContains,
  lingoEq,
  menuAction,
  periodicSave,
  QUEST_SAVE_BLOCK,
  questChestRefill,
  type Rng,
} from "@secondstaronline/shared";

import type { GroundItem, Outgoing, Player, World } from "../world/world.ts";
import { VAULT_TEXT } from "./vault.ts";

/** The capacity by name, `contains` cascade, last wins. */
export function containerCapacity(name: string): number {
  const C = itemRulesData.containers;
  return lastMatch(C.capacity, name)?.capacity ?? C.defaultCapacity;
}

export const CONTAINER_TEXT = {
  /** The chest click: the `#id` is stripped; a House Vault reads "You open <name>". */
  open: (name: string) =>
    lingoContains(name, "House")
      ? `You open ${name} to see what's inside...`
      : `You open the ${displayName(name)} to see what's inside...`,
  /** The line for a click from the wrong spot: the `#id` is not stripped. */
  notInFront: (name: string) =>
    lingoContains(name, "House")
      ? `You see ${name}, but you must be standing in front of it to use it.`
      : `You see the ${name}, but you must be standing in front of it to use it.`,
  cabinet: "You open the cabinet to see what's inside...",
  /** SSO, after the mailbox's "You can't check mail that's not yours!" */
  notYours: "You can't open a vault that's not yours!",
} as const;

/**
 * Who may open or fill a container: `<owner>'s House Vault` only its owner, by exact name; `The
 * <guild>'s Guild Vault` the members of that guild, by name (a disbanded guild's vault opens for a
 * new guild of the same name); the rest anyone.
 */
export function mayUseContainer(p: Player, name: string): boolean {
  if (lingoContains(name, "Guild Vault")) {
    return p.guild !== "" && lingoEq(name, `The ${p.guild}'s Guild Vault`);
  }
  if (lingoContains(name, "House Vault")) {
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
 * selection test, the open container is the bag name with its `#id`, then the cabinet line; a Crate
 * or Cauldron prints nothing (1.6 printed a void chat line). A chest cannot be carried in 1.6 (no
 * item code; a click or Ctrl opens one), so its Storage path is never reached and stays silent.
 */
export function storageIntent(world: World, p: Player, slot: number): Outgoing[] {
  const line = p.char.bag[slot - 1];
  if (!line || menuAction(line.item) !== "Storage" || p.keyLock || p.itemPause > 0) {
    return [];
  }
  if (p.deadLock > 0 || p.loading > 0 || lingoContains(line.item, "Chest")) {
    return [];
  }
  const out = [show(world, p, line.item, true)];
  if (lingoContains(line.item, "Cabinet")) {
    out.push(tell(p, CONTAINER_TEXT.cabinet));
  }
  return out;
}

/**
 * Drop while facing a `Cauldron#`: a container is refused, the drop line prints before the
 * server's tests, a full one says so, one unit goes in; then a Cauldron runs its recipes, whose
 * lines go to the depositor only. The open list is not refreshed.
 */
export function depositContainer(world: World, p: Player, slot: number, name: string): Outgoing[] {
  const line = p.char.bag[slot - 1];
  if (!line) {
    return [];
  }
  // Someone else's house vault, or a guild vault, refuses before the drop line and takes nothing.
  if (!mayUseContainer(p, name)) {
    return [tell(p, CONTAINER_TEXT.notYours)];
  }
  const item = line.item;
  if (["Cabinet", "Crate", "Cauldron"].some((c) => lingoContains(item, c))) {
    return [tell(p, VAULT_TEXT.container)];
  }
  const out = [tell(p, VAULT_TEXT.drop(item))];
  const lines = linesOf(world, name);
  if (lines.length >= containerCapacity(name)) {
    out.push(tell(p, VAULT_TEXT.full));
    return out;
  }
  line.qty -= 1;
  if (line.qty <= 0) {
    p.char.bag[slot - 1] = null;
  }
  p.invDirty = true;
  const next = [...lines, item];
  if (lingoContains(name, "Cauldron")) {
    const result = cauldronBrew(next);
    if (result === null) {
      write(world, name, next);
      out.push(tell(p, CRAFT_TEXT.fizzle));
      return out;
    }
    // A hit overwrites the whole container with the one result.
    write(world, name, [result]);
    out.push(tell(p, CRAFT_TEXT.puff));
    return out;
  }
  write(world, name, next);
  return out;
}

/**
 * The window's OK on a container's line: the first withdraw frees the keys; the client reads the
 * line's name from the list it shows, and the server takes the first line **equal** to it, or
 * nothing; one unit; the client deletes the line from its own list, which is otherwise never
 * refreshed.
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
    return [{ to: p.id, msg: { t: "vault", items: [], open: false } }];
  }
  p.keyLock = false;
  const item = c.shown[index - 1];
  if (item === undefined || item === "") {
    return [];
  }
  if (filledLines(p.char.bag) > 14 && !lingoContains(bagText(p.char.bag), `${item}-`)) {
    return [tell(p, VAULT_TEXT.carrying)];
  }
  c.shown.splice(index - 1, 1);
  const window: Outgoing = { to: p.id, msg: { t: "vault", items: [...c.shown], open: false } };
  const lines = [...linesOf(world, c.name)];
  const at = lines.findIndex((l) => lingoEq(l, item));
  if (at < 0) {
    return [window];
  }
  let add = item;
  if (lingoContains(item, " Crystals")) {
    const words = item.split(" ");
    // Kept bug: 1.6 re-split a withdrawn "Blue Crystals" and got a worthless "Crystals " item, so
    // every colour merged into it.
    add = `${words[1] ?? ""} ${words[2] ?? ""}`;
  }
  if (invAdd(p.char, add, 1, rng).kind !== "full") {
    p.invDirty = true;
  }
  lines.splice(at, 1);
  write(world, c.name, lines);
  return [window];
}

/** Whether Drop facing this ground item deposits into it (its name contains "Cauldron#"). */
export const isDepositCauldron = (g: GroundItem) => lingoContains(g.item, CAULDRON.match);

/**
 * The periodic save and its quest chest roll for one player: the save-block counter counts down;
 * once 0, `random(350) = 1` saves and resets it to 400; the save rolls the quest chest, which
 * **overwrites** the chest with one line (1.6 kept one global chest per type and did the same).
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
    write(world, refill.chest, [refill.item]);
  }
}

/** Drop's container route for the first item on the faced tile, or null. */
export function dropRoute(g: GroundItem): string | null {
  for (const r of houseData.containers.drop) {
    if (r.match === "contains" ? lingoContains(g.item, r.name) : lingoEq(g.item, r.name)) {
      return r.match === "contains" ? g.item : r.name;
    }
  }
  return null;
}
