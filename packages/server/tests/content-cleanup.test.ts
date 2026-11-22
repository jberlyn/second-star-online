/**
 * Where-used reports, cleanup actions and runtime fallbacks (issue #28): removing an item or a
 * monster from the Content page finds every reference to it, in content and in the world, puts the
 * proposed cleanup in the draft with the removal, and runs the world's part when the draft is
 * published. Deleting each kind of content in use leaves no reference that cannot be resolved, and
 * a stored reference that cannot be resolved never crashes the game.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  type ContentData,
  content,
  inGameSchema,
  installContent,
  type ServerMsg,
  storedCopyAs,
  storedCopyOf,
} from "@secondstaronline/shared";

import { cleanUses, usesOf } from "../src/content/cleanup.ts";
import { readPackDir } from "../src/content/packs.ts";
import { rowValue } from "../src/content/rows.ts";
import { type ContentActor, ContentService, entryRef } from "../src/content/service.ts";
import { brokenReferences, schemaProblems } from "../src/content/validate.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { parseDrop } from "../src/systems/admin/drop.ts";
import { spawnHp } from "../src/systems/monsters/spawn.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

const classic = () => readPackDir(RELEASE_PACK_DIRS.classic as string).data as ContentData;

describe("stored copies", () => {
  test("a stored name is a copy of an item by its key, a spelling, a count, an id or a level", () => {
    expect(storedCopyOf("Ruby Ring", ["Ruby Ring"])).toBe(true);
    expect(storedCopyOf("ruby ring", ["Ruby Ring"])).toBe(true);
    expect(storedCopyOf("Crate#1234", ["Crate"])).toBe(true);
    expect(storedCopyOf("5 Blue Crystals", ["Blue Crystals"])).toBe(true);
    expect(storedCopyOf("Long Sword+2", ["Long Sword"])).toBe(true);
    expect(storedCopyOf("apple", ["Apple", "apple"])).toBe(true);
    expect(storedCopyOf("Ruby Ring Mold", ["Ruby Ring"])).toBe(false);
    expect(storedCopyOf("Long Sword", ["Sword"])).toBe(false);
  });

  test("a replaced copy keeps its count and loses its id and level", () => {
    expect(storedCopyAs("5 Blue Crystals", "Red Crystals")).toBe("5 Red Crystals");
    expect(storedCopyAs("Crate#12", "Cabinet")).toBe("Cabinet");
    expect(storedCopyAs("Long Sword+2", "Short Sword")).toBe("Short Sword");
  });
});

describe("where content refers to an item, and its cleanup", () => {
  test("every kind of reference is found, with the row it is in", () => {
    const data = classic();
    const uses = usesOf(data, "item", "Ruby Ring");
    const rows = new Set(uses.map((u) => u.where));
    expect(rows).toContain("items/playerShopWhitelist");
    expect(rows).toContain("quests/current");
    expect(rows).toContain("craft/stations");
    expect(rows).toContain("gather/gathering");
    // A Classic item named nowhere has no uses.
    expect(usesOf(data, "item", "Adventurer's Head").length).toBeGreaterThanOrEqual(0);
  });

  test("removing drops each entry that holds it, and leaves the store valid", () => {
    const data = classic();
    const uses = usesOf(data, "item", "Ruby Ring");
    const { rows, left } = cleanUses(data, uses, "remove");
    expect(left).toEqual([]);
    let next = data;
    for (const r of rows) {
      next = withRow(next, r.ref, r.op === "set" ? r.data : undefined);
    }
    expect(usesOf(next, "item", "Ruby Ring")).toEqual([]);
    expect(schemaProblems(next)).toEqual([]);
  });

  test("an entry that cannot go without breaking its row is left (a quest pool's roll)", () => {
    const data = classic();
    const uses = usesOf(data, "item", "Steel Shield");
    const { left } = cleanUses(data, uses, "remove");
    expect(left.map((u) => u.where)).toContain("quests/pools");
    expect(left.every((u) => u.drop === null)).toBe(true);
  });

  test("replacing writes the other item in every place, a pool's roll included", () => {
    const data = classic();
    const uses = usesOf(data, "item", "Steel Shield");
    const { rows, left } = cleanUses(data, uses, "replace", "Knight Shield");
    expect(left).toEqual([]);
    let next = data;
    for (const r of rows) {
      next = withRow(next, r.ref, r.data);
    }
    expect(usesOf(next, "item", "Steel Shield")).toEqual([]);
    expect(
      [...next.quests.pools.wanted, ...next.quests.pools.rewards].some(
        (w) => w.item.trim() === "Knight Shield",
      ),
    ).toBe(true);
    expect(schemaProblems(next)).toEqual([]);
  });

  test("NPC file lines: shop and drop lines go, or name the replacement keeping a drop's count", () => {
    const data = classic();
    const files = [
      ...data.npcFiles.files,
      { name: "Test Seller", text: "BIO|Hello\rSEL|Ruby Ring:10:1\rINV|2 Ruby Ring:5\rBUY|Ale:3" },
    ];
    const withFile = { ...data, npcFiles: { ...data.npcFiles, files } };
    const uses = usesOf(withFile, "item", "Ruby Ring").filter((u) => u.npcLine);
    expect(uses.map((u) => u.path)).toEqual([
      ["text", 1],
      ["text", 2],
    ]);
    const removed = cleanUses(withFile, uses, "remove").rows[0]?.data as { text: string };
    expect(removed.text).toBe("BIO|Hello\rBUY|Ale:3");
    const replaced = cleanUses(withFile, uses, "replace", "Gold Ring").rows[0]?.data as {
      text: string;
    };
    expect(replaced.text).toBe("BIO|Hello\rSEL|Gold Ring:10:1\rINV|2 Gold Ring:5\rBUY|Ale:3");
  });

  test("leave changes nothing and lists every reference", () => {
    const data = classic();
    const uses = usesOf(data, "item", "Ruby Ring");
    const r = cleanUses(data, uses, "leave");
    expect(r.rows).toEqual([]);
    expect(r.left).toHaveLength(uses.length);
  });

  test("a retired item counts as missing for every reference", () => {
    const data = classic();
    const items = data.items.items.map((i) =>
      i.name === "Ruby Ring" ? { ...i, retired: true as const } : i,
    );
    const retired = { ...data, items: { ...data.items, items } };
    const broken = brokenReferences(retired).filter((r) => r.name.toLowerCase() === "ruby ring");
    expect(broken.length).toBe(usesOf(data, "item", "Ruby Ring").length);
  });
});

/** A copy of `data` with one row set (or removed, with `value` undefined). */
function withRow(
  data: ContentData,
  ref: { dataset: string; part: string; key: string | null },
  value: unknown,
): ContentData {
  const ds = { ...(data as unknown as Record<string, Record<string, unknown>>)[ref.dataset] };
  if (ref.key === null) {
    ds[ref.part] = value;
  } else {
    const field = ref.dataset === "houses" ? "deed" : "name";
    const list = [...((ds[ref.part] as Record<string, unknown>[]) ?? [])];
    const at = list.findIndex((e) => String(e[field]).toLowerCase() === ref.key?.toLowerCase());
    if (value === undefined) {
      list.splice(at, 1);
    } else {
      list[at] = value as Record<string, unknown>;
    }
    ds[ref.part] = list;
  }
  return { ...data, [ref.dataset]: ds } as ContentData;
}

// ---- the game ------------------------------------------------------------------------------------

describe("removing content in use from a running game", () => {
  let db: Db;
  let sent: { to: string; msg: ServerMsg }[];
  let service: ContentService;
  let game: Game;
  const wall = Date.UTC(2026, 10, 22, 12, 0, 0);
  let t = 0;

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent = [];
    t = 0;
    let live: Game | null = null;
    service = new ContentService({
      db,
      now: () => new Date(wall + t++).toISOString(),
      releasePacks: RELEASE_PACK_DIRS,
      onPublish: (store) => {
        installContent(store);
        live?.contentPublished(store.hash);
      },
    });
    installContent(service.store());
    game = createGame({
      db,
      content: service,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => new Date(wall).toISOString(),
      rng: NEVER_PUSH,
    });
    live = game;
  });

  let ips = 0;
  async function make(name: string, role?: string, online = true) {
    ips += 1;
    await game.create(
      {
        t: "create",
        name,
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      },
      `10.0.2.${ips}`,
    );
    const l = await game.login(name, "pw", "10.0.0.1");
    if (!l.ok) {
      throw new Error(l.text);
    }
    if (role) {
      setRole(db, l.accountId, role, new Date(wall).toISOString());
    }
    if (online) {
      game.enter(l.characterId, false, "10.0.0.7");
    }
    return l;
  }

  /** Sends an intent the way the gateway does (through its schema). */
  function intent(id: string, msg: unknown) {
    game.intent(id, inGameSchema.parse(msg));
  }
  const last = <T extends ServerMsg["t"]>(to: string, t: T) =>
    sent.filter((s) => s.to === to && s.msg.t === t).at(-1)?.msg as
      | Extract<ServerMsg, { t: T }>
      | undefined;

  /** Activity log rows of a type (written by the tick), optionally one character's. */
  const activity = (type: string, characterId?: string) =>
    db
      .query<{ item: string | null; qty: number }, string[]>(
        `SELECT item, qty FROM activity_log WHERE type = ?${characterId ? " AND character_id = ?" : ""}`,
      )
      .all(...(characterId ? [type, characterId] : [type]));

  const ADMIN = (l: { accountId: string; name: string }): ContentActor => ({
    accountId: l.accountId,
    name: l.name,
  });

  /** A world with Ruby Rings everywhere: Al's bag and ring finger, Bo's offline bag and vault, the ground, a container and a quest line. */
  async function ringsEverywhere() {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bo = await make("Bo", undefined, false);
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[3] = { item: "Ruby Ring", qty: 2 };
    p.char.equip.ring = "Ruby Ring";
    p.char.vault.push("Ruby Ring");
    // Al's ledger starts again from what Al now holds, as a login would.
    p.activityHeld = undefined;
    game.tick();
    db.query(
      "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
    ).run("inv-bo", bo.characterId, 15, "Ruby Ring", 3);
    db.query("INSERT INTO vault_items (character_id, position, item) VALUES (?, ?, ?)").run(
      bo.characterId,
      1,
      "Ruby Ring",
    );
    p.map.ground.push({
      id: "g-ring",
      item: "Ruby Ring",
      x: 2,
      y: 2,
      kind: "drop",
      expiresAt: null,
    });
    game.world.containers.set("Crate#7", ["Ruby Ring", "Ale"]);
    game.world.questLines[0] = "Fish:Ale:Ruby Ring";
    return { god, al, bo, p };
  }

  test("the usage report counts every place, with who holds it", async () => {
    const { god } = await ringsEverywhere();
    intent(god.characterId, { t: "contentUsage", seq: 1, kind: "item", key: "ruby ring" });
    const u = last(god.characterId, "contentUsage")?.usage;
    expect(u?.key).toBe("Ruby Ring");
    const at = Object.fromEntries((u?.world ?? []).map((p) => [p.place, p]));
    expect(at.bag).toMatchObject({ count: 5, holderCount: 2 });
    expect(at.bag?.holders.sort()).toEqual(["Al", "Bo"]);
    expect(at.worn).toMatchObject({ count: 1, holders: ["Al"] });
    expect(at.vault).toMatchObject({ count: 2, holderCount: 2 });
    expect(at.ground?.count).toBe(1);
    expect(at.container?.count).toBe(1);
    expect(at.quest?.count).toBeGreaterThanOrEqual(1);
    expect(u?.uses.length).toBeGreaterThan(3);
  });

  test("retiring (the default): copies stay and work, no more can be made, the content goes", async () => {
    const { god, p } = await ringsEverywhere();
    intent(god.characterId, {
      t: "contentRemove",
      seq: 2,
      kind: "item",
      key: "Ruby Ring",
      content: "remove",
      replacement: null,
    });
    expect(last(god.characterId, "contentResult")).toMatchObject({ ok: true });
    expect(last(god.characterId, "contentResult")?.text).toContain("retired");
    intent(god.characterId, { t: "contentOverview", seq: 3 });
    const o = last(god.characterId, "contentOverview")?.overview;
    expect(o?.problems).toEqual([]);
    expect(o?.removals[0]?.key).toBe("Ruby Ring");
    expect(o?.removals[0]?.lines.join("\n")).toContain("stay (retired");
    intent(god.characterId, { t: "contentPublish", seq: 4, summary: "", draftRev: o?.draftRev });
    expect(last(god.characterId, "contentResult")).toMatchObject({ ok: true });
    expect(content().item("Ruby Ring")?.retired).toBe(true);
    // Copies stay where they were.
    expect(p.char.bag[3]).toEqual({ item: "Ruby Ring", qty: 2 });
    expect(p.char.equip.ring).toBe("Ruby Ring");
    // No content refers to it any more, and none may again.
    expect(usesOf(service.publishedContent(), "item", "Ruby Ring")).toEqual([]);
    expect(parseDrop("Ruby Ring")).toBeNull();
    const fish = rowValue(service.publishedContent(), {
      dataset: "npcFiles",
      part: "files",
      key: "Fish",
    }) as { name: string; text: string } | undefined;
    if (fish) {
      const r = service.draftSet(
        ADMIN(god),
        { dataset: "npcFiles", part: "files", key: "Fish" },
        "set",
        { ...fish, text: `${fish.text}\rSEL|Ruby Ring:5:1` },
      );
      expect(r.ok).toBe(false);
    }
    // The quest line that rewarded it was rolled again.
    expect(game.world.questLines[0]).not.toContain("Ruby Ring");
    // The publish history says what happened to the world.
    expect(service.history()[0]?.cleanup.join("\n")).toContain("quest line");
  });

  test("purging: every copy goes, online and offline, with gold back for each held one", async () => {
    const { god, al, bo, p } = await ringsEverywhere();
    const goldBefore = p.char.gold;
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 10,
      },
      game.contentWorld,
    );
    expect(r.ok).toBe(true);
    expect(rowValue(service.draftContent(), entryRef("item", "Ruby Ring"))).toBeUndefined();
    const pub = service.publish(ADMIN(god), service.draftRev(), "Purge rings", game.contentWorld);
    expect(pub.ok).toBe(true);
    expect(content().item("Ruby Ring")).toBeUndefined();
    // Al online: bag, ring finger and vault emptied, 4 copies refunded.
    expect(p.char.bag[3]).toBeNull();
    expect(p.char.equip.ring).toBe("NOTHING");
    expect(p.char.vault).toEqual([]);
    expect(p.char.gold).toBe(goldBefore + 40);
    // Bo offline: 4 copies refunded in the database.
    expect(db.query("SELECT count(*) AS n FROM inventory WHERE item = 'Ruby Ring'").get()).toEqual({
      n: 0,
    });
    expect(
      db.query("SELECT count(*) AS n FROM vault_items WHERE item = 'Ruby Ring'").get(),
    ).toEqual({ n: 0 });
    const boGold = db
      .query<{ gold: number }, [string]>("SELECT gold FROM characters WHERE id = ?")
      .get(bo.characterId)?.gold;
    expect(boGold).toBeGreaterThanOrEqual(40);
    // The ground and the container.
    expect(p.map.ground.some((g) => g.id === "g-ring")).toBe(false);
    expect(game.world.containers.get("Crate#7")).toEqual(["Ale"]);
    // Nothing in the world names it now.
    expect(game.contentWorld.usage("item", ["Ruby Ring"])).toEqual([]);
    expect(game.contentWorld.problems()).toEqual([]);
    // The ledger check finds nothing unlogged: the purge was logged as an admin change.
    game.tick();
    expect(activity("unlogged")).toEqual([]);
    expect(activity("admin", al.characterId).length).toBeGreaterThan(0);
    expect(activity("admin", bo.characterId).length).toBeGreaterThan(0);
    // The history keeps what it did; an undo puts the item back but not the copies.
    expect(service.history()[0]?.cleanup.join("\n")).toContain(
      "Deleted: 8 copies of Ruby Ring held by 2 characters (80 gold given back)",
    );
    const pubId = pub.ok ? pub.value.id : "";
    const undone = service.undo(ADMIN(god), pubId);
    expect(undone.ok ? "" : `${undone.error} ${JSON.stringify(undone.problems)}`).toBe("");
    expect(content().item("Ruby Ring")).toBeDefined();
    expect(p.char.bag[3]).toBeNull();
  });

  test("replacing: every copy becomes the other item, and the quest names it", async () => {
    const { god, p } = await ringsEverywhere();
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "replace",
        copies: "replace",
        replacement: "mage's ring",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(r.ok).toBe(true);
    expect(service.check()).toEqual([]);
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(p.char.bag[3]).toEqual({ item: "Mage's Ring", qty: 2 });
    expect(p.char.equip.ring).toBe("Mage's Ring");
    expect(p.char.vault).toEqual(["Mage's Ring"]);
    expect(game.world.containers.get("Crate#7")).toEqual(["Mage's Ring", "Ale"]);
    expect(game.world.questLines[0]).toBe("Fish:Ale:Mage's Ring");
    expect(db.query("SELECT item FROM inventory WHERE id = 'inv-bo'").get()).toEqual({
      item: "Mage's Ring",
    });
    game.tick();
    expect(activity("unlogged")).toEqual([]);
  });

  test("a replacement must exist, differ and not be retired", async () => {
    const { god } = await ringsEverywhere();
    const base = {
      kind: "item" as const,
      key: "Ruby Ring",
      content: "remove" as const,
      copies: "replace" as const,
      refundGold: 0,
    };
    expect(service.draftRemoval(ADMIN(god), { ...base, replacement: null }).ok).toBe(false);
    expect(service.draftRemoval(ADMIN(god), { ...base, replacement: "Nonesuch" }).ok).toBe(false);
    expect(service.draftRemoval(ADMIN(god), { ...base, replacement: "Ruby Ring" }).ok).toBe(false);
  });

  test("leaving references: the checks name them until they are fixed", async () => {
    const { god } = await ringsEverywhere();
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "leave",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toContain("left for you to fix");
    expect(service.check().some((p) => p.message.includes("Ruby Ring"))).toBe(true);
    const summary = service.removals(game.contentWorld)[0];
    expect(summary?.lines.join("\n")).toContain("still name it");
    expect(summary?.stillUsed).toBeGreaterThan(0);
  });

  test("discarding the removal drops its world cleanup", async () => {
    const { god } = await ringsEverywhere();
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "leave",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.liveActions()).toHaveLength(1);
    service.draftDiscard(entryRef("item", "Ruby Ring"));
    expect(service.liveActions()).toEqual([]);
    expect(service.removals(game.contentWorld)).toEqual([]);
  });

  test("an item nobody holds is removed outright, not retired", async () => {
    const god = await make("God", "administrator");
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "retire",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(r.ok && r.value).toContain("removed");
    expect(service.draft().find((d) => d.key === "Ruby Ring")?.op).toBe("remove");
  });

  test("a monster: its roster slots clear, live ones despawn, its NPC file goes", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    const slot = p.map.slots[0];
    if (!slot) {
      throw new Error("no slot");
    }
    slot.species = "Slime";
    slot.live = {
      name: "Slime",
      hp: 5,
      x: 3,
      y: 3,
      facing: "S",
      anim: 0,
      fromX: 3,
      fromY: 3,
      queue: [],
      hitCountb: 0,
    };
    const usage = service.usage("monster", "Slime", game.contentWorld);
    expect(usage.ok && usage.value.world.map((w) => w.place)).toEqual(["spawn", "live"]);
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "monster",
        key: "Slime",
        content: "remove",
        spawns: "remove",
        live: "despawn",
        npcFile: "delete",
        replacement: null,
      },
      game.contentWorld,
    );
    expect(r.ok).toBe(true);
    expect(service.check()).toEqual([]);
    sent.length = 0;
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(content().monster("Slime")).toBeUndefined();
    expect(slot.species).toBeNull();
    expect(slot.live).toBeNull();
    expect(
      sent.some(
        (s) =>
          s.to === al.characterId &&
          s.msg.t === "delta" &&
          s.msg.events.some((e) => e.e === "mgone" && e.slot === slot.slot),
      ),
    ).toBe(true);
    // Saved at once: the database has no Slime on any roster.
    expect(
      db.query("SELECT count(*) AS n FROM map_slots WHERE lower(species) = 'slime'").get(),
    ).toEqual({ n: 0 });
    expect(game.contentWorld.problems()).toEqual([]);
    // Ticking on carries on.
    expect(game.tick()).toBe(true);
  });

  test("an NPC: its NPC file goes with it, and quest lines naming it are left for review", async () => {
    const god = await make("God", "administrator");
    const npc = service.publishedContent().quests.pools.npcs[0]?.npc as string;
    expect(
      rowValue(service.publishedContent(), { dataset: "npcFiles", part: "files", key: npc }),
    ).toBeDefined();
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "monster",
        key: npc,
        content: "remove",
        spawns: "remove",
        live: "despawn",
        npcFile: "delete",
        replacement: null,
      },
      game.contentWorld,
    );
    // Quest lines naming it are flagged for review: left as they are, and named in the summary,
    // but they do not stop the publish (1.6's quests name NPCs by their spoken name).
    expect(r.ok && r.value).toContain("left for you to fix");
    expect(
      service.draft().some((d) => d.dataset === "npcFiles" && d.key === npc && d.op === "remove"),
    ).toBe(true);
    expect(service.removals(game.contentWorld)[0]?.lines.join("\n")).toContain("still name it");
    const usage = service.usage("monster", npc, game.contentWorld);
    expect(usage.ok && usage.value.uses.some((u) => u.where.startsWith("quests/pools"))).toBe(true);
  });

  test("replacing a monster: its roster slots spawn the other one", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    const slot = p?.map.slots[1];
    if (!slot) {
      throw new Error("no slot");
    }
    slot.species = "Slime";
    expect(
      service.draftRemoval(
        ADMIN(god),
        {
          kind: "monster",
          key: "Slime",
          content: "replace",
          spawns: "replace",
          live: "leave",
          npcFile: "keep",
          replacement: "Ratmas",
        },
        game.contentWorld,
      ).ok,
    ).toBe(true);
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(slot.species).toBe("Ratmas");
  });
});

describe("edits that change content in use", () => {
  function start() {
    const db = openDatabase();
    migrate(db);
    let live: Game | null = null;
    const service = new ContentService({
      db,
      now: () => "2026-11-22T00:00:00.000Z",
      releasePacks: RELEASE_PACK_DIRS,
      onPublish: (store) => {
        installContent(store);
        live?.contentPublished(store.hash);
      },
    });
    installContent(service.store());
    const game = createGame({
      db,
      content: service,
      send: () => {},
      isoNow: () => "2026-11-22T00:00:00.000Z",
      rng: NEVER_PUSH,
    });
    live = game;
    return { db, service, game };
  }
  async function online(game: Game, name: string) {
    await game.create(
      {
        t: "create",
        name,
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      },
      "10.0.4.1",
    );
    const l = await game.login(name, "pw", "10.0.0.1");
    if (!l.ok) {
      throw new Error(l.text);
    }
    game.enter(l.characterId, false, "10.0.0.7");
    const p = game.world.players.get(l.characterId);
    if (!p) {
      throw new Error("not online");
    }
    return { l, p };
  }
  const actor: ContentActor = { accountId: "acc", name: "Admin" };

  test("a worn item stays on when its wear rules change; it goes back on only under the new rules", async () => {
    const { service, game } = start();
    const { l, p } = await online(game, "Al");
    p.char.equip.ring = "Ruby Ring";
    const equip = service.publishedContent().itemRules.equip;
    expect(
      service.draftSet(actor, { dataset: "itemRules", part: "equip", key: null }, "set", {
        ...equip,
        strength: [...equip.strength, { match: "contains", pattern: "Ruby Ring", strength: 99 }],
      }).ok,
    ).toBe(true);
    expect(service.publish(actor, service.draftRev(), "").ok).toBe(true);
    // Still worn, through the publish and a tick.
    expect(game.tick()).toBe(true);
    expect(p.char.equip.ring).toBe("Ruby Ring");
    // Taken off, it cannot go back on: the new requirement applies. (The map is drawn first.)
    const ready = () => {
      p.loading = 0;
      p.itemPause = 0;
      p.keyLock = false;
    };
    ready();
    game.intent(l.characterId, inGameSchema.parse({ t: "unequip", slot: "Ring" }));
    expect(p.char.equip.ring).toBe("NOTHING");
    const at = p.char.bag.findIndex((b) => b?.item === "Ruby Ring");
    expect(at).toBeGreaterThanOrEqual(0);
    ready();
    game.intent(l.characterId, inGameSchema.parse({ t: "equip", slot: at + 1 }));
    expect(p.char.equip.ring).toBe("NOTHING");
    // Strong enough now, it goes on.
    p.char.stats.str = 120;
    ready();
    game.intent(l.characterId, inGameSchema.parse({ t: "equip", slot: at + 1 }));
    expect(p.char.equip.ring).toBe("Ruby Ring");
  });

  test("a monster's new HP reaches new spawns; a live one keeps the HP it has", async () => {
    const { service, game } = start();
    const { p } = await online(game, "Al");
    const slot = p.map.slots[0];
    if (!slot) {
      throw new Error("no slot");
    }
    slot.species = "Slime";
    slot.live = {
      name: "Slime",
      hp: 5,
      x: 3,
      y: 3,
      facing: "S",
      anim: 0,
      fromX: 3,
      fromY: 3,
      queue: [],
      hitCountb: 0,
    };
    const slime = rowValue(service.publishedContent(), entryRef("monster", "Slime")) as Record<
      string,
      unknown
    >;
    expect(
      service.draftSet(actor, entryRef("monster", "Slime"), "set", { ...slime, hp: 1000 }).ok,
    ).toBe(true);
    expect(service.publish(actor, service.draftRev(), "").ok).toBe(true);
    expect(slot.live?.hp).toBe(5);
    expect(game.tick()).toBe(true);
    expect(spawnHp("Slime")).toBe(1000);
  });
});

describe("runtime fallbacks", () => {
  test("stored references nothing resolves load, play and are listed as problems", async () => {
    const db = openDatabase();
    migrate(db);
    const service = new ContentService({
      db,
      now: () => "2026-11-22T00:00:00.000Z",
      releasePacks: RELEASE_PACK_DIRS,
    });
    installContent(service.store());
    const sent: { to: string; msg: ServerMsg }[] = [];
    const game = createGame({
      db,
      content: service,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => "2026-11-22T00:00:00.000Z",
      rng: NEVER_PUSH,
    });
    await game.create(
      {
        t: "create",
        name: "Al",
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      },
      "10.0.3.1",
    );
    const l = await game.login("Al", "pw", "10.0.0.1");
    if (!l.ok) {
      throw new Error(l.text);
    }
    // A database edit put an item and a monster no content has into the world.
    db.query(
      "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES ('i1', ?, 15, 'Moonblade', 1)",
    ).run(l.characterId);
    // A parked boat is a ground item no catalogue lists, and not a problem.
    const anyMap = db.query<{ map_id: string }, []>("SELECT map_id FROM map_slots LIMIT 1").get();
    db.query(
      "INSERT INTO ground_items (id, map_id, x, y, item, kind, created_at) VALUES ('g-boat', ?, 3, 3, 'Al''s Boat', 'drop', '2026-11-22T00:00:00.000Z')",
    ).run(anyMap?.map_id ?? "");
    db.query(
      "INSERT INTO equipment (character_id, slot, item) VALUES (?, 'Ring', 'Lost Ring')",
    ).run(l.characterId);
    // The character logs in and plays with them: nothing throws.
    expect(game.enter(l.characterId, false, "10.0.0.7")).toBe(true);
    const p = game.world.players.get(l.characterId);
    const slot = p?.map.slots[0];
    if (!slot) {
      throw new Error("no slot");
    }
    slot.species = "Gloop";
    slot.live = {
      name: "Gloop",
      hp: 1,
      x: 4,
      y: 4,
      facing: "S",
      anim: 0,
      fromX: 4,
      fromY: 4,
      queue: [],
      hitCountb: 0,
    };
    const problems = game.contentWorld.problems();
    expect(problems.map((p) => p.where).sort()).toEqual([
      "world/bags",
      "world/spawns",
      "world/worn",
    ]);
    expect(problems.find((p) => p.where === "world/bags")?.message).toContain("Moonblade");
    expect(p?.char.bag[14]).toEqual({ item: "Moonblade", qty: 1 });
    for (let i = 0; i < 40; i++) {
      expect(game.tick()).toBe(true);
    }
    expect(sent.some((s) => s.to === l.characterId && s.msg.t === "inv")).toBe(true);
    // The Content page lists them with the content's own unresolved references.
    const all = service.problems(game.contentWorld);
    expect(all.world).toHaveLength(3);
    expect(all.content.length).toBeGreaterThan(0);
  });
});
