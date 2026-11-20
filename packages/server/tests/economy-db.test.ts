/**
 * Persistence (real SQL on in-memory SQLite): an NPC's ledger, the bank and the
 * personal vault survive a restart; a purchase writes the buyer and the NPC together.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { loadContainers, saveContainer } from "../src/persistence/containers.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadBank, loadShop, loadVault, saveShop } from "../src/persistence/economy.ts";
import { loadInventory, saveInventory } from "../src/persistence/inventory.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
});

const game = (): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => "2026-11-05T00:00:00.000Z",
    rng: rngByN(),
    minute: () => 0,
  });

async function makeChar(g: Game, name: string): Promise<string> {
  await g.create({
    t: "create",
    name,
    password: "pw",
    sex: 1,
    head: 1,
    classCode: 1,
    str: 11,
    sta: 11,
    int: 11,
    wis: 11,
    dex: 11,
  });
  const l = await g.login(name, "pw");
  if (!l.ok) {
    throw new Error(l.text);
  }
  return l.characterId;
}

const texts = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

describe("economy persistence", () => {
  test("ledger round trip", () => {
    saveShop(
      db,
      {
        npc: "Amber",
        gold: 5,
        lines: [{ line: 4, kind: "SEL", item: "Apple", price: 10, stock: 3 }],
      },
      "now",
    );
    expect(loadShop(db, "Amber")).toEqual({
      npc: "Amber",
      gold: 5,
      lines: [{ line: 4, kind: "SEL", item: "Apple", price: 10, stock: 3 }],
    });
    expect(loadShop(db, "Cril")).toBeNull();
  });

  test("a purchase, a deposit and a vault deposit are saved, and the NPC's stock is reloaded after a restart", async () => {
    let g = game();
    const id = await makeChar(g, "Al");
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(id);
    setRole(db, acc?.account_id ?? "", "administrator", "2026-11-05T00:00:00.000Z");
    db.run("UPDATE characters SET gold = 1000 WHERE id = ?", [id]);
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "chat", text: "/roster 1 Amber" });
    g.intent(id, { t: "chat", text: "/roster 2 Cril" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    g.intent(id, { t: "chat", text: "/spawn 2" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "buy" });
    g.intent(id, { t: "buy", line: 4, count: 3 });
    // CANCEL ends the shop's key lock.
    g.intent(id, { t: "shopCancel" });
    expect(loadInventory(db, id).gold).toBe(970);
    expect(loadShop(db, "Amber")?.lines.find((l) => l.line === 4)?.stock).toBe(10028);
    expect(loadShop(db, "Amber")?.gold).toBe(107537424 + 30);
    g.intent(id, { t: "chat", text: "/deposit 100" });
    expect(texts(id)).toContain("You deposit 100 gold. You now have 100 gold in the bank.");
    expect(loadBank(db, id)).toBe(100);
    expect(loadInventory(db, id).gold).toBe(870);
    // Face a Vault and drop an Apple in.
    g.intent(id, { t: "chat", text: "/drop Vault" });
    const slot = loadInventory(db, id).bag.findIndex((l) => l?.item === "Apple") + 1;
    g.intent(id, { t: "drop", slot });
    expect(loadVault(db, id)).toEqual(["Apple"]);
    g.leave(id);

    g = game();
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "buy" });
    const rows = sent.filter((m) => m.msg.t === "shop").at(-1)?.msg;
    expect(rows).toMatchObject({ t: "shop", mode: "buy" });
    g.intent(id, { t: "buy", line: 4, count: 1 });
    expect(loadShop(db, "Amber")?.lines.find((l) => l.line === 4)?.stock).toBe(10027);
    sent.length = 0;
    g.intent(id, { t: "chat", text: "/balance" });
    expect(texts(id)).toEqual(["You have 100 gold in the bank."]);
  });
});

describe("selling a container", () => {
  test("bug fixed: a container with contents is refused; an empty one sells and its storage row goes", async () => {
    saveContainer(db, "Crate#4242", ["Apple", "Pie"]);
    const g = game();
    const id = await makeChar(g, "Al");
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(id);
    setRole(db, acc?.account_id ?? "", "administrator", "2026-11-05T00:00:00.000Z");
    const inv = loadInventory(db, id);
    inv.bag[0] = { item: "Crate#4242", qty: 1 };
    saveInventory(db, id, inv, "2026-11-05T00:00:00.000Z");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    // Kanta buys Crates: `BUY|Crate:15` is file line 11.
    g.intent(id, { t: "chat", text: "/roster 1 Kanta" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "sell" });
    g.intent(id, { t: "sell", line: 11, count: 1 });
    expect(texts(id)).toContain('Kanta says "Empty that out before you sell it to me."');
    expect(loadInventory(db, id).bag[0]).toEqual({ item: "Crate#4242", qty: 1 });
    expect(loadContainers(db).get("Crate#4242")).toEqual(["Apple", "Pie"]);
    // Emptied, it sells, and nothing is left behind under its name.
    g.world.containers.set("Crate#4242", []);
    g.intent(id, { t: "sell", line: 11, count: 1 });
    const after = loadInventory(db, id);
    expect(after.bag.some((l) => l?.item.startsWith("Crate"))).toBe(false);
    expect(after.gold).toBe(inv.gold + 15);
    expect(loadContainers(db).get("Crate#4242")).toBeUndefined();
    expect(g.world.containers.has("Crate#4242")).toBe(false);
  });
});
