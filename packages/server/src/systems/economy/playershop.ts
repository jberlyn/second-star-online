/**
 * Player shops. A Small Shop's build makes its shopkeeper; its owner runs it with commands said in
 * chat. Buying and selling are the ordinary shop (shop.ts): 1.6's NPC buy and sell handlers never read
 * `OWN|`.
 *
 * A command works on the file as it stands now, with the till and stock written in (`liveNpcText`),
 * and the rewritten file becomes the NPC file and the source of a new ledger, so stock and gold
 * carry over; an NPC editor save still resets the ledger.
 */
import {
  CHAT_COLOR,
  lingoEq,
  liveNpcText,
  npcLines,
  parseShopCommand,
  profile,
  type Rng,
  register,
  removeItem,
  rollShopkeeperName,
  SHOP_TEXT,
  SHOPKEEPER,
  setPrices,
  shopkeeperFile,
  shopStockLines,
} from "@secondstaronline/shared";

import { closeNpcWindows } from "../admin/npcedit.ts";
import { npcFileNamed, setNpcFile } from "../monsters/npcfiles.ts";
import type { Outgoing, Player, PlayerShop, World, WorldMap } from "../world/world.ts";
import { ledgerFromTemplate, type ShopLedger } from "./shop.ts";

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/**
 * The shopkeeper of a new Small Shop: a name rolled until it is free, its file, and roster slot 1
 * of the interior holding it live at (10, 4) with 128 HP. The caller writes the file, the slot and
 * the shop in the build's transaction. Null when no free name came up.
 */
export function createShopkeeper(
  world: World,
  interior: WorldMap,
  owner: Player,
  rng: Rng,
): PlayerShop | null {
  const name = rollShopkeeperName(
    rng,
    (n) => npcFileNamed(world.npcs, n) !== null || world.playerShops.has(n.toLowerCase()),
  );
  const slot = interior.slots[SHOPKEEPER.slot - 1];
  if (!name || !slot) {
    return null;
  }
  setNpcFile(world.npcs, name, shopkeeperFile(owner.name, name));
  world.shops.delete(name);
  slot.species = name;
  slot.live = {
    name,
    hp: SHOPKEEPER.hp,
    x: SHOPKEEPER.x,
    y: SHOPKEEPER.y,
    // 1.6 drew a loaded monster facing south.
    facing: "S",
    anim: 0,
    fromX: SHOPKEEPER.x,
    fromY: SHOPKEEPER.y,
    queue: [],
    hitCountb: 0,
  };
  slot.home = null;
  slot.lastHp = null;
  slot.pause = 0;
  slot.dirty = true;
  const shop: PlayerShop = { npc: name, ownerId: owner.id, interior: interior.name };
  world.playerShops.set(name.toLowerCase(), shop);
  return shop;
}

/** Forgets the shops of a deleted interior (their rows go with it). */
export function forgetShops(world: World, interior: string): void {
  for (const [key, s] of world.playerShops) {
    if (lingoEq(s.interior, interior)) {
      world.playerShops.delete(key);
      world.npcs.delete(s.npc.toLowerCase());
      world.shops.delete(s.npc);
    }
  }
}

/** What a command writes, in one transaction. */
export interface ShopWrite {
  /** The rewritten NPC file and its new ledger. */
  file: { npc: string; text: string; ledger: ShopLedger } | null;
  /** The owner's gold changed (Register). */
  gold: boolean;
  /** A house map's new header (`Header`). */
  title: { map: WorldMap; text: string } | null;
}

export interface ShopCommandResult {
  /** The line was a shop command (the client would have handled it, even silently). */
  ran: boolean;
  out: Outgoing[];
  write: ShopWrite | null;
}

/**
 * The shop command in a typed line, before it would be said: a line that is a command is never said
 * aloud (1.6 said it to the room first). `ledgerOf` gives the NPC's ledger (made from its file on
 * first use), so the file is read as the server holds it.
 */
export function shopCommand(
  world: World,
  p: Player,
  typed: string,
  ledgerOf: (npc: string) => ShopLedger | null,
): ShopCommandResult {
  const line = typed.startsWith(" ") ? typed.slice(1) : typed;
  const cmd = parseShopCommand(
    line,
    p.map.name,
    p.map.slots.map((s) => s.live?.name ?? null),
  );
  if (!cmd) {
    return { ran: false, out: [], write: null };
  }
  const done = (out: Outgoing[], write: ShopWrite | null = null): ShopCommandResult => ({
    ran: true,
    out,
    write,
  });
  if (cmd.kind === "silent") {
    return done([]);
  }
  if (cmd.kind === "refused") {
    return done([tell(p, cmd.text)]);
  }
  if (cmd.kind === "title") {
    // 1.6 tested whether the map header's owner field contained the speaker's name. SSO asks the
    // house record, by id, and the map is the one the speaker stands on. No refresh: the header
    // shows on the next load.
    const mine = [...world.houses.values()].some(
      (h) => lingoEq(h.interior, p.map.name) && h.ownerId === p.id,
    );
    if (!mine) {
      return done([tell(p, SHOP_TEXT.noTitle)]);
    }
    p.map.title = cmd.text;
    return done([tell(p, SHOP_TEXT.title)], {
      file: null,
      gold: false,
      title: { map: p.map, text: cmd.text },
    });
  }
  const npc = cmd.npc;
  const owner = world.playerShops.get(npc.toLowerCase())?.ownerId === p.id;
  const f = npcFileNamed(world.npcs, npc);
  const lines = owner && f ? npcLines(liveNpcText(f, ledgerOf(f.name))) : [];
  const commit = (next: string[]): ShopWrite["file"] => {
    const name = f?.name ?? npc;
    const text = next.join("\r");
    const ledger = ledgerFromTemplate(setNpcFile(world.npcs, name, text));
    world.shops.set(name, ledger);
    return { npc: name, text, ledger };
  };
  switch (cmd.kind) {
    case "set":
    case "remove": {
      const r =
        cmd.kind === "set"
          ? setPrices(lines, owner, npc, cmd.item, cmd.sell, cmd.buy)
          : removeItem(lines, owner, npc, cmd.item);
      if (!r.lines) {
        return done([tell(p, r.text)]);
      }
      const file = commit(r.lines);
      // The lines moved: open lists and Bios of this shopkeeper close.
      return done([...closeNpcWindows(world, file?.npc ?? npc), tell(p, r.text)], {
        file,
        gold: false,
        title: null,
      });
    }
    case "register": {
      const r = register(lines, owner, npc, cmd.amount);
      if (!r.lines) {
        return done([tell(p, r.text)]);
      }
      const file = commit(r.lines);
      p.char.gold += r.paid;
      p.invDirty = true;
      return done([tell(p, r.text)], { file, gold: true, title: null });
    }
    case "inventory":
      // The till and the stock go to the owner alone (1.6 said the stock to the room).
      return done(shopStockLines(lines, owner, npc).map((t) => tell(p, t)));
    case "profile": {
      const r = profile(lines, owner, npc, cmd.text);
      if (!r?.lines) {
        return done([]);
      }
      return done([tell(p, r.text)], { file: commit(r.lines), gold: false, title: null });
    }
  }
}
