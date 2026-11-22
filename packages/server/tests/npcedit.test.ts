/**
 * The NPC editor on the server and the NPC file store every NPC reader goes through, with sim
 * tests and real SQL.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { monsters: monstersData, npcFiles: npcFilesData } = classicData;

import npcsData from "@secondstaronline/data/test-fixtures/npc-expectations";
import {
  ADMINISTRATOR,
  buildContentStore,
  checkNpcFile,
  content,
  editorLines,
  installContent,
  NPC_EDITOR_MONSTERS,
  NPC_EDITOR_NPCS,
  rollLoot,
  type ServerMsg,
  showNpcScript,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadShop } from "../src/persistence/economy.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadNpcFiles, npcFileVersions } from "../src/persistence/npcfiles.ts";
import { loadNpc, openNpcEditor, saveNpc } from "../src/systems/admin/npcedit.ts";
import { openEditor } from "../src/systems/admin/worldedit.ts";
import { giveGoldToNpc } from "../src/systems/economy/intents.ts";
import { ledgerFromTemplate, type ShopLedger } from "../src/systems/economy/shop.ts";
import type { ItemCtx } from "../src/systems/inventory/items.ts";
import { authorPath } from "../src/systems/monsters/ai.ts";
import { hasFlag, npcData, npcFileNamed, setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { Player, Room, World, WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

const casino = { graceTicks: 600, addGoldOffline: () => {} };

const imm = (map: WorldMap, x = 6, y = 6) => {
  const p = player("imm", map, x, y);
  p.role = ADMINISTRATOR;
  return p;
};

/** The ledger an NPC has now, without making one (as the game's `ledgerOf`). */
const ledgerOf = (world: World) => (npc: string) => world.shops.get(npc) ?? null;

function scene() {
  const map = testMap("x1000y992");
  const { world, join, run } = setup([map]);
  const p = player("p", map, 5, 5);
  const i = imm(map);
  join(p);
  join(i);
  return { map, world, p, i, run };
}

function stand(map: WorldMap, slot: number, name: string, x: number, y: number) {
  const s = map.slots[slot - 1];
  if (!s) {
    throw new Error("slot");
  }
  s.species = name;
  s.live = {
    name,
    hp: 10,
    x,
    y,
    facing: "S",
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  };
  return s.live;
}

describe("the NPC file store (packages/data npcfiles)", () => {
  test("every original file parses to the records the data build ships (the NPC and monster records)", () => {
    const store = setup([]).world.npcs;
    for (const f of npcFilesData.files) {
      const p = npcFileNamed(store, f.name);
      const n = npcsData.npcs.find((x) => x.name === f.name);
      expect(
        p && {
          name: p.name,
          bio: p.bio,
          profile: p.profile,
          chatter: p.chatter,
          sells: p.sells,
          buys: p.buys,
          gold: p.gold,
          banker: p.banker,
        },
      ).toEqual(n ?? null);
      const loot = npcsData.lootTables.find((t) => t.npc === f.name)?.lines ?? [];
      expect([f.name, p?.loot]).toEqual([f.name, loot]);
      const m = npcsData.monsterParses.find((x) => x.name.toLowerCase() === f.name.toLowerCase());
      if (m) {
        expect([f.name, p?.flags, p?.spells, !p?.empty]).toEqual([
          f.name,
          m.flags,
          m.spells,
          m.npcData,
        ]);
      }
    }
  });

  test("every list NPC's original file re-saves as LOAD shows it (no refusal)", () => {
    for (const f of npcFilesData.files) {
      const listed = [...NPC_EDITOR_MONSTERS, ...NPC_EDITOR_NPCS].some(
        (n) => n.toLowerCase() === f.name.toLowerCase(),
      );
      if (listed) {
        const c = checkNpcFile(editorLines(showNpcScript(f.text)));
        expect([f.name, c.error]).toEqual([f.name, null]);
      }
    }
  });

  test("bug fixed: ledgers: GLD| counts wherever it is, and no GLD| is a till of 0", () => {
    const store = setup([]).world.npcs;
    const lines = [...Array.from({ length: 80 }, () => "BIO|x"), "GLD|5", "SEL|Apple:10:3"];
    const f = setNpcFile(store, "Amber", lines.join("\r"));
    expect(ledgerFromTemplate(f)).toMatchObject({ gold: 5, goldLine: 81 });
    const none = setNpcFile(store, "Merius", "SEL|Damaged Armor:10:999");
    expect(ledgerFromTemplate(none)).toMatchObject({ gold: 0, goldLine: null });
  });
});

describe("opening the editor", () => {
  test("a player gets nothing; an administrator leaves the map; the World Editor opens from it without leaving again", () => {
    const { world, map, p, i } = scene();
    expect(openNpcEditor(world, p, casino)).toEqual([]);
    const out = openNpcEditor(world, i, casino);
    expect(out.some((o) => o.to === "p" && o.msg.t === "delta")).toBe(true);
    expect(out.some((o) => o.to === "imm" && o.msg.t === "npcEditor")).toBe(true);
    expect(i.editing).toBe("npc");
    expect(world.rooms.get(map.name)?.players).toEqual([p]);
    const we = openEditor(world, i, () => map, { mx: 1000, my: 992 }, casino);
    expect(we.map((o) => o.msg.t)).toEqual(["editor"]);
    expect(i.editing).toBe("world");
    expect(openNpcEditor(world, i, casino).map((o) => o.msg.t)).toEqual(["npcEditor"]);
  });
});

describe("LOAD", () => {
  test("the file with the shop's live stock and gold written in", () => {
    const { world, i } = scene();
    openNpcEditor(world, i, casino);
    const amber = npcFileNamed(world.npcs, "Amber");
    if (!amber) {
      throw new Error("Amber");
    }
    const live: ShopLedger = ledgerFromTemplate(amber);
    live.gold = 107537454;
    const apple = live.lines.find((l) => l.line === 4);
    if (apple) {
      apple.stock = 10028;
    }
    world.shops.set("Amber", live);
    const out = loadNpc(world, i, "amber", ledgerOf(world));
    expect(out).toEqual([
      {
        to: "imm",
        msg: {
          t: "npcScript",
          name: "Amber",
          text: "BIO|Name: Amber\rBIO|Class: Casino Manager\rGLD|107537454\rSEL|Apple:10:10028\rBUY|Apple:5\rSEL|Ale:10:9604\rBUY|Ale:5\rSEL|Pie:10:5771\rBUY|Pie:5",
        },
      },
    ]);
  });

  test("a list name with no file loads empty; unlisted names, no name and players outside the editor get nothing", () => {
    const { world, p, i } = scene();
    expect(loadNpc(world, i, "Amber", ledgerOf(world))).toEqual([]); // not in the editor
    openNpcEditor(world, i, casino);
    expect(loadNpc(world, i, "Oraku", ledgerOf(world))[0]?.msg).toEqual({
      t: "npcScript",
      name: "Oraku",
      text: "",
    });
    expect(loadNpc(world, i, "Cuche", ledgerOf(world))).toEqual([]); // a player shop's file
    expect(loadNpc(world, i, "", ledgerOf(world))).toEqual([]);
    expect(loadNpc(world, p, "Amber", ledgerOf(world))).toEqual([]);
  });
});

describe("LOAD of a long file", () => {
  test("SSO: a file over the save limit loads in full with a warning that SAVE will refuse it", () => {
    const { world, i } = scene();
    openNpcEditor(world, i, casino);
    const text = Array.from({ length: 103 }, (_, n) => `BIO|Line ${n + 1}`).join("\r");
    setNpcFile(world.npcs, "Amber", text);
    const out = loadNpc(world, i, "Amber", ledgerOf(world));
    expect(out.map((o) => o.msg)).toEqual([
      { t: "npcScript", name: "Amber", text },
      {
        t: "alert",
        text: "This file has 103 lines. An NPC file holds at most 100 lines, so remove 3 before saving.",
      },
    ]);
    // At the limit there is no warning.
    setNpcFile(world.npcs, "Amber", text.split("\r").slice(0, 100).join("\r"));
    expect(loadNpc(world, i, "Amber", ledgerOf(world)).map((o) => o.msg.t)).toEqual(["npcScript"]);
  });
});

describe("SAVE", () => {
  test("a refused save says why and changes nothing", () => {
    const { world, i } = scene();
    openNpcEditor(world, i, casino);
    const r = saveNpc(world, i, "Amber", "SEL|Fire:5:10\n", ledgerOf(world));
    expect(r.save).toBeNull();
    expect(r.out[0]?.msg).toEqual({
      t: "alert",
      text: 'The NPC was not saved. Line 1: "Fire" is not an item.',
    });
    expect(npcFileNamed(world.npcs, "Amber")?.sells).toHaveLength(3);
  });

  test("a save replaces the file, drops the ledger, closes the NPC's windows and lists warnings under the alert", () => {
    const { world, map, p, i } = scene();
    stand(map, 1, "Amber", 5, 4);
    p.bio = { slot: 1, npc: "Amber" };
    p.keyLock = true;
    world.shops.set("Amber", { npc: "Amber", gold: 1, lines: [], dirty: true });
    openNpcEditor(world, i, casino);
    const text = [
      ...Array.from({ length: 20 }, () => "BIO|x"),
      "RND|Hello",
      "SEL|Apple:3:2",
      "GLD|9",
      "",
    ].join("\n");
    const r = saveNpc(world, i, "amber", text, ledgerOf(world));
    expect(r.save?.npc).toBe("Amber");
    expect(r.save?.text.split("\r")).toHaveLength(23);
    expect(r.save?.previous).toContain("GLD|1"); // LOAD's view of the old file, live gold
    expect(world.shops.has("Amber")).toBe(false);
    expect(npcFileNamed(world.npcs, "Amber")).toMatchObject({ gold: 9, chatter: ["Hello"] });
    expect(p.bio).toBeNull();
    expect(p.keyLock).toBe(false);
    expect(r.out).toContainEqual({ to: "p", msg: { t: "npcClosed" } });
    expect(r.out.at(-1)?.msg).toEqual({
      t: "alert",
      text: "NPC has been successfully saved.",
    });
  });

  test("a save applies at once: flags, drops, an empty file", () => {
    const { world, map, i } = scene();
    openNpcEditor(world, i, casino);
    const author = player("a", map, 1, 1);
    const slime = stand(map, 1, "Slime", 9, 9);
    expect(authorPath(world.npcs, slime, author, rngByN({ 10: [1] }))).not.toBeNull();
    saveNpc(world, i, "Slime", "FLG|Still", ledgerOf(world));
    expect(authorPath(world.npcs, slime, author, rngByN({ 10: [1] }))).toBeNull();
    expect(hasFlag(world.npcs, "slime", "Still")).toBe(true);
    saveNpc(world, i, "Wolf", "INV|5 Gold:1", ledgerOf(world));
    expect(rollLoot(npcFileNamed(world.npcs, "Wolf")?.loot ?? null, rngByN())).toBe("5 Gold");
    expect(npcData(world.npcs, "Andero")).not.toBeNull();
    saveNpc(world, i, "Andero", "", ledgerOf(world));
    expect(npcData(world.npcs, "Andero")).toBeNull(); // EMPTY: no Bio, never moves
    saveNpc(world, i, "Oraku", "BIO|Name: Oraku", ledgerOf(world));
    expect(npcData(world.npcs, "Oraku")?.bio).toEqual(["Name: Oraku"]);
  });

  test("bug fixed: gold given goes into the till wherever GLD| is, or into a till from 0 without one", () => {
    const { world, map, p, i } = scene();
    openNpcEditor(world, i, casino);
    stand(map, 1, "Amber", 5, 4);
    const room = world.rooms.get(map.name) as Room;
    const ctx = (): ItemCtx => ({
      world,
      rng: rngByN(),
      now: 0,
      shop: (npc) => {
        const f = npcFileNamed(world.npcs, npc);
        if (!f) {
          return null;
        }
        const s = world.shops.get(f.name) ?? ledgerFromTemplate(f);
        world.shops.set(f.name, s);
        return s;
      },
    });
    const give = (who: Player) => {
      who.char.gold = 100;
      giveGoldToNpc(ctx(), room, who, 10);
      return world.shops.get("Amber")?.gold;
    };
    saveNpc(
      world,
      i,
      "Amber",
      [...Array.from({ length: 60 }, () => "BIO|x"), "GLD|50"].join("\n"),
      ledgerOf(world),
    );
    expect(give(p)).toBe(60);
    saveNpc(
      world,
      i,
      "Amber",
      [...Array.from({ length: 59 }, () => "BIO|x"), "GLD|50"].join("\n"),
      ledgerOf(world),
    );
    expect(give(p)).toBe(60);
    saveNpc(world, i, "Amber", "BIO|x", ledgerOf(world));
    expect(give(p)).toBe(10);
  });
});

describe("persistence (real SQL)", () => {
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
      isoNow: () => "2026-11-06T00:00:00.000Z",
      rng: rngByN(),
      minute: () => 0,
    });
  const makeAdministrator = async (g: Game) => {
    await g.create({
      t: "create",
      name: "Al",
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
    const l = await g.login("Al", "pw");
    if (!l.ok) {
      throw new Error(l.text);
    }
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(l.characterId);
    setRole(db, acc?.account_id ?? "", "administrator", "2026-11-06T00:00:00.000Z");
    return l.characterId;
  };

  test("a content publish that removes an NPC's file drops its ledger and closes its windows", async () => {
    let g = game();
    const id = await makeAdministrator(g);
    db.run("UPDATE characters SET gold = 1000 WHERE id = ?", [id]);
    g = game();
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "chat", text: "/roster 1 Amber" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "buy" });
    g.intent(id, { t: "buy", line: 4, count: 3 });
    expect(loadShop(db, "Amber")).not.toBeNull();
    const before = content();
    try {
      installContent(
        buildContentStore({
          ...before,
          npcFiles: { files: before.npcFiles.files.filter((f) => f.name !== "Amber") },
        }),
      );
      sent = [];
      g.contentPublished("x");
      expect(loadShop(db, "Amber")).toBeNull();
      expect(sent.some((m) => m.to === id && m.msg.t === "npcClosed")).toBe(true);
    } finally {
      installContent(before);
    }
  });

  test("a save writes the file and its old version and drops the stored ledger; a restart loads it", async () => {
    let g = game();
    const id = await makeAdministrator(g);
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    // A sale gives Amber a stored ledger first.
    db.run("UPDATE characters SET gold = 1000 WHERE id = ?", [id]);
    g.leave(id);
    g = game();
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "chat", text: "/roster 1 Amber" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "buy" });
    g.intent(id, { t: "buy", line: 4, count: 3 });
    expect(loadShop(db, "Amber")?.lines.find((l) => l.line === 4)?.stock).toBe(10028);

    g.intent(id, { t: "npcEditOpen" });
    g.intent(id, { t: "npcLoad", name: "Amber" });
    const loaded = sent.filter((m) => m.msg.t === "npcScript").at(-1)?.msg;
    expect(loaded).toMatchObject({ t: "npcScript", name: "Amber" });
    expect(loaded && "text" in loaded ? loaded.text : "").toContain("SEL|Apple:10:10028");
    g.intent(id, { t: "npcSave", name: "Amber", text: "BIO|Name: Amber\nGLD|5\nSEL|Apple:7:2\n" });
    expect(sent.at(-1)?.msg).toEqual({ t: "alert", text: "NPC has been successfully saved." });
    expect(loadNpcFiles(db)).toEqual([
      { npc: "Amber", text: "BIO|Name: Amber\rGLD|5\rSEL|Apple:7:2" },
    ]);
    expect(npcFileVersions(db, "Amber")[0]).toContain("SEL|Apple:10:10028");
    expect(loadShop(db, "Amber")).toBeNull();
    g.leave(id);

    g = game();
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "npcEditOpen" });
    g.intent(id, { t: "npcLoad", name: "amber" });
    expect(sent.filter((m) => m.msg.t === "npcScript").at(-1)?.msg).toEqual({
      t: "npcScript",
      name: "Amber",
      text: "BIO|Name: Amber\rGLD|5\rSEL|Apple:7:2",
    });
  });

  test("a player's npcSave is ignored", async () => {
    const g = game();
    const id = await makeAdministrator(g);
    db.run("UPDATE accounts SET role = NULL");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "npcEditOpen" });
    g.intent(id, { t: "npcSave", name: "Amber", text: "GLD|1" });
    expect(loadNpcFiles(db)).toEqual([]);
  });
});
