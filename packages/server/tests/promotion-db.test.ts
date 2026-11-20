/**
 * Promotions at a trainer, on real in-memory SQLite.
 * The Trainer is Amber's file replaced in the store with `setNpcFile` (/roster takes only `mlists`
 * species); the four Gods' original files are the real thing.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { closeNpcWindows } from "../src/systems/admin/npcedit.ts";
import { setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
});

const NOW = "2026-11-08T00:00:00.000Z";

const game = (): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => NOW,
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

const TRAINER = ["BIO|A trainer", "TRN|Grunt:100", "TRN|Fire Mage:10000", "TRN|Ninja:5"].join("\r");

/** An administrator Al (Fighter, Slash 30, gold 150) with `npc` in roster slot 1 and spawned. */
async function scene(npc = "Amber") {
  const g = game();
  setNpcFile(g.world.npcs, "Amber", TRAINER);
  const id = await makeChar(g, "Al");
  const acc = db
    .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
    .get(id);
  setRole(db, acc?.account_id ?? "", "administrator", NOW);
  db.run("UPDATE characters SET gold = 150 WHERE id = ?", [id]);
  db.run("UPDATE character_skills SET value = 30 WHERE character_id = ? AND skill = 1", [id]);
  g.enter(id, false);
  g.intent(id, { t: "mapReady" });
  g.intent(id, { t: "chat", text: `/roster 1 ${npc}` });
  g.intent(id, { t: "chat", text: "/spawn 1" });
  sent.length = 0;
  return { g, id };
}

const kinds = (to: string) => sent.filter((m) => m.to === to).map((m) => m.msg.t);
const chats = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const row = (id: string) =>
  db
    .query<{ class_code: number; gold: number; sp_max: number; wis: number }, [string]>(
      "SELECT class_code, gold, sp_max, wis FROM characters WHERE id = ?",
    )
    .get(id);
const skills = (id: string) =>
  db
    .query<{ value: number }, [string]>(
      "SELECT value FROM character_skills WHERE character_id = ? ORDER BY skill",
    )
    .all(id)
    .map((r) => r.value);

describe("the train list", () => {
  test("a Bio with TRN| lines says train: true; the list holds every line with its price", async () => {
    const { g, id } = await scene();
    g.intent(id, { t: "npcClick", slot: 1 });
    expect(sent.find((m) => m.msg.t === "bio")?.msg).toMatchObject({ train: true });
    g.intent(id, { t: "shopList", mode: "train" });
    expect(sent.find((m) => m.msg.t === "shop")?.msg).toEqual({
      t: "shop",
      mode: "train",
      rows: [
        { line: 2, item: "Grunt", price: 100 },
        { line: 3, item: "Fire Mage", price: 10000 },
        { line: 4, item: "Ninja", price: 5 },
      ],
    });
    expect(g.world.players.get(id)?.shop).toEqual({ npc: "Amber", mode: "train" });
  });

  test("the four Gods' original files list their class at 10000", async () => {
    for (const [npc, cls] of [
      ["Fire God", "Fire Mage"],
      ["Water God", "Water Mage"],
      ["Wind God", "Wind Mage"],
      ["Earth God", "Earth Mage"],
    ] as const) {
      sent = [];
      const { g, id } = await scene(npc);
      g.intent(id, { t: "npcClick", slot: 1 });
      g.intent(id, { t: "shopList", mode: "train" });
      const shop = sent.find((m) => m.msg.t === "shop")?.msg;
      expect(shop).toMatchObject({ rows: [{ item: cls, price: 10000 }] });
      g.leave(id);
      db.run("DELETE FROM characters");
      db.run("DELETE FROM accounts");
    }
  });

  test("an NPC without TRN| opens no list; an NPC save closes an open train list", async () => {
    const { g, id } = await scene("Kanta");
    g.intent(id, { t: "npcClick", slot: 1 });
    expect(sent.find((m) => m.msg.t === "bio")?.msg).toMatchObject({ train: false });
    g.intent(id, { t: "shopList", mode: "train" });
    expect(sent.some((m) => m.msg.t === "shop")).toBe(false);

    const s = await scene2();
    s.g.intent(s.id, { t: "npcClick", slot: 1 });
    s.g.intent(s.id, { t: "shopList", mode: "train" });
    const p = s.g.world.players.get(s.id);
    expect(p?.shop?.mode).toBe("train");
    const out = closeNpcWindows(s.g.world, "amber");
    expect(out).toEqual([{ to: s.id, msg: { t: "npcClosed" } }]);
    expect(p?.shop).toBeNull();
  });
});

/** A second scene on a fresh database. */
async function scene2() {
  db = openDatabase();
  migrate(db);
  sent = [];
  return scene();
}

describe("the train OK", () => {
  test("a promotion writes class, gold and stats; texts, then heal2, then processed", async () => {
    const { g, id } = await scene();
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "train" });
    sent.length = 0;
    const before = skills(id);
    g.intent(id, { t: "train", line: 2 });
    expect(chats(id)).toEqual(["Amber: Congratulations, you are now a Grunt!"]);
    expect(kinds(id).filter((k) => ["chat", "sound", "processed"].includes(k))).toEqual([
      "chat",
      "sound",
      "processed",
    ]);
    expect(sent.find((m) => m.msg.t === "sound")?.msg).toEqual({
      t: "sound",
      name: "heal2",
      ch: 3,
    });
    expect(row(id)).toMatchObject({ class_code: 4, gold: 50 });
    expect(loadInventory(db, id).gold).toBe(50);
    expect(skills(id)).toEqual(before); // the grants are undone
    // Again: learned all, no change.
    sent.length = 0;
    g.intent(id, { t: "train", line: 2 });
    expect(chats(id)).toEqual(["Amber: You have learned all there is to the art of the Grunt."]);
    expect(row(id)?.gold).toBe(50);
  });

  test("a refused one changes nothing and still sends processed; no branch sends only processed", async () => {
    const { g, id } = await scene();
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "train" });
    sent.length = 0;
    g.intent(id, { t: "train", line: 3 });
    expect(chats(id)).toEqual(["Amber: It is impossible for a Fighter to learn this."]);
    expect(kinds(id)).toEqual(["chat", "processed"]);
    sent.length = 0;
    g.intent(id, { t: "train", line: 4 });
    expect(kinds(id)).toEqual(["processed"]);
    sent.length = 0;
    g.intent(id, { t: "train", line: 1 }); // not a TRN| line
    expect(kinds(id)).toEqual(["processed"]);
    expect(row(id)).toMatchObject({ class_code: 1, gold: 150 });
  });

  test("refused when the NPC left the roster, or with no train list open", async () => {
    const { g, id } = await scene();
    g.intent(id, { t: "train", line: 2 }); // no list
    expect(sent).toEqual([]);
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "train" });
    g.intent(id, { t: "chat", text: "/roster 1 Kanta" });
    sent.length = 0;
    g.intent(id, { t: "train", line: 2 });
    expect(sent).toEqual([]);
    expect(row(id)?.class_code).toBe(1);
  });

  test("a promotion survives a restart; /setclass on an online player is what the next one reads", async () => {
    const { g, id } = await scene();
    g.leave(id);
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "chat", text: "/setclass Al Mage" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "train" });
    sent.length = 0;
    g.intent(id, { t: "train", line: 3 }); // Fire Mage from Mage: not allowed
    expect(chats(id)).toEqual(["Amber: It is impossible for a Mage to learn this."]);
    g.intent(id, { t: "chat", text: "/setclass Al Ninja" });
    sent.length = 0;
    g.intent(id, { t: "train", line: 3 }); // now a Ninja: still not in Fire Mage's list
    expect(chats(id)).toEqual(["Amber: It is impossible for a Ninja to learn this."]);
    g.intent(id, { t: "chat", text: "/setclass Al Fighter" });
    sent.length = 0;
    g.intent(id, { t: "train", line: 2 });
    expect(chats(id)).toEqual(["Amber: Congratulations, you are now a Grunt!"]);
    g.leave(id);
    expect(row(id)).toMatchObject({ class_code: 4, gold: 50 });
  });
});
