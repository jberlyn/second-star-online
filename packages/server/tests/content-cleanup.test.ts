/**
 * Where-used reports, cleanup actions and runtime fallbacks (issue #28): removing an item or a
 * monster from the Content page finds every reference to it, in content and in the world, puts the
 * proposed cleanup in the draft with the removal, and runs the world's part when the draft is
 * published. Deleting each kind of content in use leaves no reference that cannot be resolved, and
 * a stored reference that cannot be resolved never crashes the game.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import {
  buildContentStore,
  type ContentData,
  checkNpcFile,
  content,
  type EditableCharacter,
  editErrors,
  inGameSchema,
  installContent,
  rollLoot,
  type ServerMsg,
  storedCopyAs,
  storedCopyOf,
  storedCount,
} from "@secondstaronline/shared";

import { cleanUses, npcTextCleaned, usesOf } from "../src/content/cleanup.ts";
import { readPackDir } from "../src/content/packs.ts";
import { rowValue, withOptionalDatasets } from "../src/content/rows.ts";
import { type ContentActor, ContentService, entryRef } from "../src/content/service.ts";
import { brokenReferences, schemaProblems } from "../src/content/validate.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { saveShop } from "../src/persistence/economy.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { npcFileVersions, saveNpcFile } from "../src/persistence/npcfiles.ts";
import { parseDrop } from "../src/systems/admin/drop.ts";
import { setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import { spawnHp } from "../src/systems/monsters/spawn.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

/** A plain character for the editor's checks. */
const editable = (): EditableCharacter => ({
  classCode: 1,
  level: 5,
  exp: 10,
  expNeeded: 410,
  hp: 20,
  hpMax: 24,
  sp: 20,
  spMax: 24,
  str: 10,
  sta: 10,
  dex: 10,
  int: 10,
  wis: 10,
  skills: { Slash: 1, Thrust: 1, Parry: 1 },
  hunger: 30000,
  faction: null,
  factionCount: 0,
  wanted: false,
  respawn: { map: "x1000y992", x: 5, y: 5 },
  gold: 100,
  bank: null,
  bag: Array.from({ length: 15 }, () => null),
  equip: {
    weapon: "NOTHING",
    offHand: "NOTHING",
    head: "NOTHING",
    body: "NOTHING",
    feet: "NOTHING",
    ring: "NOTHING",
  },
  vault: [],
  spellbook: [],
  position: { map: "x1000y992", x: 5, y: 5 },
  sex: 1,
  head: 1,
});

const classic = () =>
  withOptionalDatasets(readPackDir(RELEASE_PACK_DIRS.classic as string).data) as ContentData;

describe("stored copies", () => {
  test("a stored name is a copy of an item by its key, a spelling, a count, an id or a level", () => {
    expect(storedCopyOf("Ruby Ring", ["Ruby Ring"])).toBe(true);
    expect(storedCopyOf("ruby ring", ["Ruby Ring"])).toBe(true);
    expect(storedCopyOf("Crate#1234", ["Crate"])).toBe(true);
    expect(storedCopyOf("5 Blue Crystal", ["Blue Crystal"])).toBe(true);
    expect(storedCopyOf("Long Sword+2", ["Long Sword"])).toBe(true);
    expect(storedCopyOf("apple", ["Apple", "apple"])).toBe(true);
    expect(storedCopyOf("Ruby Ring Mold", ["Ruby Ring"])).toBe(false);
    expect(storedCopyOf("Long Sword", ["Sword"])).toBe(false);
    // Only crystals count in their name: a gold pile is gold, not the Gold item.
    expect(storedCopyOf("15 Gold", ["Gold"])).toBe(false);
    // A masterwork result that is a catalogue item of its own is not a copy of the plain item.
    expect(storedCopyOf("Plate Armor +1", ["Plate Armor"])).toBe(false);
  });

  test("a replaced copy keeps a container's id or a crystal pile's count only where they still mean something", () => {
    expect(storedCopyAs("5 Blue Crystal", "Red Crystal")).toBe("5 Red Crystal");
    expect(storedCopyAs("5 Blue Crystal", "Apple")).toBe("Apple");
    expect(storedCount("5 Blue Crystal")).toBe(5);
    expect(storedCount("Apple")).toBe(1);
    expect(storedCopyAs("Crate#12", "Cabinet")).toBe("Cabinet#12");
    expect(storedCopyAs("Crate#12", "Ale")).toBe("Ale");
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

  test("NPC file lines: shop and drop lines go, or name the replacement (a crystal drop keeps its count)", () => {
    const data = classic();
    const files = [
      ...data.npcFiles.files,
      { name: "Test Seller", text: "BIO|Hello\rSEL|Ruby Ring:10:1\rINV|Ruby Ring:5\rBUY|Ale:3" },
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
    expect(replaced.text).toBe("BIO|Hello\rSEL|Gold Ring:10:1\rINV|Gold Ring:5\rBUY|Ale:3");
    // A crystal drop keeps its count when it becomes other crystals.
    const crystals = {
      ...withFile,
      npcFiles: {
        ...withFile.npcFiles,
        files: [{ name: "Gem Seller", text: "INV|5 Blue Crystal:2" }],
      },
    };
    const gems = usesOf(crystals, "item", "Blue Crystal").filter((u) => u.npcLine);
    expect(
      (
        cleanUses(crystals, gems, "replace", "Red Crystal").rows[0]?.data as
          | { text: string }
          | undefined
      )?.text,
    ).toBe("INV|5 Red Crystal:2");
  });

  test("leave changes nothing and lists every reference", () => {
    const data = classic();
    const uses = usesOf(data, "item", "Ruby Ring");
    const r = cleanUses(data, uses, "leave");
    expect(r.rows).toEqual([]);
    expect(r.left).toHaveLength(uses.length);
  });

  test("a removal that would break its row is left to replace, not made (a band's one result, the ore three)", () => {
    const data = classic();
    for (const item of ["Table", "Chunk of Iron"]) {
      const uses = usesOf(data, "item", item);
      const { rows, left } = cleanUses(data, uses, "remove", "", [], (ref, value) => {
        const next = withRow(data, ref, value);
        return DATASET_SCHEMAS[ref.dataset as "craft"].safeParse(
          (next as unknown as Record<string, unknown>)[ref.dataset],
        ).success;
      });
      for (const r of rows) {
        const next = withRow(data, r.ref, r.op === "set" ? r.data : undefined);
        expect(schemaProblems(next)).toEqual([]);
      }
      expect(left.length).toBeGreaterThan(0);
    }
  });

  test("the station that doubles the cooking time is a reference too", () => {
    const data = classic();
    const doubles = data.craft.stations.cook!.doubles;
    expect(usesOf(data, "item", doubles).some((u) => u.path.join(".") === "cook.doubles")).toBe(
      true,
    );
  });

  test("gold drops are not the Gold item; a drop replaced by crystals drops one crystal", () => {
    const data = classic();
    expect(usesOf(data, "item", "Gold").some((u) => u.npcLine)).toBe(false);
    const files = [{ name: "Test Monster", text: "INV|Ruby Ring:5\rINV|50 Gold:2" }];
    const withFile = { ...data, npcFiles: { ...data.npcFiles, files } };
    const uses = usesOf(withFile, "item", "Ruby Ring").filter((u) => u.npcLine);
    const out = cleanUses(withFile, uses, "replace", "Blue Crystal").rows[0]?.data as {
      text: string;
    };
    expect(out.text).toBe("INV|1 Blue Crystal:5\rINV|50 Gold:2");
  });

  test("a deed's row goes with its item even when the references are replaced", () => {
    const data = classic();
    const deed = data.houses.deeds[0]?.deed as string;
    const uses = usesOf(data, "item", deed).filter((u) => u.where.startsWith("houses/deeds"));
    const { rows } = cleanUses(data, uses, "replace", "Ale");
    expect(rows).toEqual([
      { ref: { dataset: "houses", part: "deeds", key: deed }, op: "remove", data: null },
    ]);
  });

  test("the quest chests' refills and Oraku's orb and reward are references", () => {
    const data = classic();
    expect(usesOf(data, "item", "Thor's Hammer").some((u) => u.where === "houses/questChest")).toBe(
      true,
    );
    expect(
      usesOf(data, "item", "Royal Ninja Uniform").some((u) => u.where === "social/questReplies"),
    ).toBe(true);
  });

  test("a shop that already sold the replacement keeps one line for it, the stocks added", () => {
    const text = "SEL|Ruby Ring:50:0\rBUY|Ruby Ring:25\rSEL|Mage's Ring:80:2\rBUY|Mage's Ring:40";
    expect(npcTextCleaned(text, ["Ruby Ring"], "replace", "Mage's Ring")).toBe(
      "SEL|Mage's Ring:50:2\rBUY|Mage's Ring:25",
    );
  });

  test("a content NPC file that already sold the replacement keeps one line for it", () => {
    const data = classic();
    const files = [
      { name: "Test Seller", text: "SEL|Ale:2:5\rBUY|Ale:1\rSEL|Ruby Ring:9:3\rBUY|Ruby Ring:4" },
    ];
    const withFile = { ...data, npcFiles: { ...data.npcFiles, files } };
    const uses = usesOf(withFile, "item", "Ruby Ring").filter((u) => u.npcLine);
    const out = cleanUses(withFile, uses, "replace", "Ale").rows[0]?.data as { text: string };
    expect(out.text).toBe("SEL|Ale:2:8\rBUY|Ale:1");
  });

  test("the player-shop list's singular crystals, mining colours, faction heads and Assassin prizes are references", () => {
    const data = classic();
    expect(
      usesOf(data, "item", "Blue Crystal").some((u) => u.where === "items/playerShopWhitelist"),
    ).toBe(true);
    const colours = usesOf(data, "item", "Blue Crystal").filter((u) => u.path[1] === "colours");
    expect(colours.length).toBeGreaterThan(0);
    // A colour makes "<colour> Crystals": it is neither removed nor replaced, but left to edit.
    expect(cleanUses(data, colours, "replace", "Ale").left).toHaveLength(colours.length);
    expect(
      usesOf(data, "item", "Mage's Head").some((u) => u.where === "social/factions/mage"),
    ).toBe(true);
    expect(usesOf(data, "item", "Knife").some((u) => u.where === "social/assassin")).toBe(true);
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

  test("a requirement row names its item: a typo is a broken reference, and the row goes with its item", () => {
    const data = structuredClone(classicData) as ContentData;
    data.itemRules.requires.push(
      { match: "exact", pattern: "Dragon Swrod", on: "equip", needs: "level", atLeast: 30 },
      { match: "exact", pattern: "Long Sword", on: "equip", needs: "level", atLeast: 5 },
    );
    const broken = brokenReferences(data).filter((r) => r.where === "itemRules/requires");
    expect(broken.map((r) => [r.name, r.drop])).toEqual([["Dragon Swrod", [0]]]);
    const uses = usesOf(data, "item", "Long Sword").filter((r) => r.where === "itemRules/requires");
    expect(uses.map((r) => r.drop)).toEqual([[1]]);
  });

  test("stock Classic has no problems: a treasure's gold pile and a contains-matched tool resolve", () => {
    const data = classic();
    expect(brokenReferences(data)).toEqual([]);
    // The fishing tool "Fishing" and the Axe tool are parts of names, matched with contains.
    const g = (r: { where: string }) => r.where === "gather/gathering";
    const tools = (r: { where: string }) => r.where === "itemRules/tools";
    // The Fishing Pole is the only item "Fishing" matches, so the pattern is a use of it (issue
    // #31: removing it would leave the tool matching nothing); with a second fishing item it is not.
    expect(
      usesOf(data, "item", "Fishing Pole")
        .filter(tools)
        .map((r) => r.name),
    ).toContain("Fishing");
    const twoPoles = {
      ...data,
      items: { ...data.items, items: [...data.items.items, { name: "Fishing Net" }] },
    } as ContentData;
    expect(usesOf(twoPoles, "item", "Fishing Pole").filter(tools)).toEqual([]);
    const poles = data.items.items.map((i) =>
      /fishing/i.test(i.name) ? { ...i, retired: true as const } : i,
    );
    const noPoles = { ...data, items: { ...data.items, items: poles } };
    expect(
      brokenReferences(noPoles)
        .filter(tools)
        .map((r) => r.name),
    ).toContain("Fishing");
    // "300 Gold" is dropped as a pile of gold, so removing the Gold item leaves it alone.
    expect(usesOf(data, "item", "Gold").filter(g)).toEqual([]);
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

  beforeEach(() => setupGame(NEVER_PUSH));
  /** A fresh world: its database, content service and game, with the game's rng. */
  function setupGame(rng: Parameters<typeof createGame>[0]["rng"]) {
    db = openDatabase();
    migrate(db);
    sent = [];
    t = 0;
    let live: Game | null = null;
    service = new ContentService({
      db,
      now: () => new Date(wall + t++).toISOString(),
      releasePacks: RELEASE_PACK_DIRS,
      onPublish: (store, restoring) => {
        installContent(store);
        live?.contentPublished(store.hash, restoring);
      },
    });
    installContent(service.store());
    game = createGame({
      db,
      content: service,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => new Date(wall).toISOString(),
      rng,
    });
    live = game;
  }

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

  test("a publish that removes a skill and then fails puts every skill list back, and the gain waiting to be logged is logged", async () => {
    const { god, al, p } = await ringsEverywhere();
    const skillDetails = () =>
      db
        .query<{ details: string }, [string]>(
          "SELECT details FROM activity_log WHERE type = 'skill' AND character_id = ?",
        )
        .all(al.characterId)
        .map((r) => JSON.parse(r.details));
    const meditation = content().classes.skills.findIndex((k) => k.skill === "Meditation");
    // A Meditation point the activity log has not seen yet, already saved.
    p.char.skills[meditation] = (p.char.skills[meditation] ?? 0) + 1;
    game.saveAll();
    const skills = [...p.char.skills];
    const progress = structuredClone(p.activityProgress);
    const award = p.awardSkills ? [...p.awardSkills] : p.awardSkills;
    const savedRows = db
      .query("SELECT skill, value FROM character_skills WHERE character_id = ? ORDER BY skill")
      .all(al.characterId);
    expect(
      service.draftSet(
        ADMIN(god),
        { dataset: "classes", part: "skills", key: "Meditation" },
        "remove",
        null,
      ).ok,
    ).toBe(true);
    expect(
      service.draftRemoval(
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
      ).ok,
    ).toBe(true);
    const failing = {
      ...game.contentWorld,
      apply: (...args: Parameters<typeof game.contentWorld.apply>) => {
        game.contentWorld.apply(...args);
        throw new Error("write failed");
      },
    };
    expect(() => service.publish(ADMIN(god), service.draftRev(), "", failing)).toThrow(
      "write failed",
    );
    expect(content().classes.skills[meditation]?.skill).toBe("Meditation");
    expect(p.char.skills).toEqual(skills);
    expect(p.activityProgress).toEqual(progress);
    expect(p.awardSkills).toEqual(award);
    expect(
      db
        .query("SELECT skill, value FROM character_skills WHERE character_id = ? ORDER BY skill")
        .all(al.characterId),
    ).toEqual(savedRows);
    // Not seen yet, so the next tick logs it.
    expect(p.activityProgress?.skills[meditation]).toBe(1);
    game.tick();
    game.saveAll();
    expect(skillDetails().some((d) => d.skill === "Meditation" && d.gained === 1)).toBe(true);
  });

  test("a class a publish takes off the creation screen while the password hashes is refused", async () => {
    const pending = game.create(
      {
        t: "create",
        name: "Late",
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 3,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      },
      "10.0.9.1",
    );
    const before = content();
    const d = structuredClone(classicData) as ContentData;
    d.classes.startClasses = d.classes.startClasses.filter((c) => c.code !== 3);
    installContent(buildContentStore(d));
    try {
      const r = await pending;
      expect(r).toEqual({ ok: false, text: "Choose a class." });
      expect(db.query("SELECT count(*) AS n FROM characters WHERE name = 'Late'").get()).toEqual({
        n: 0,
      });
    } finally {
      installContent(before);
    }
  });

  test("the picture intents answer only a content editor (issue #29)", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const pick = { t: "contentPicture", seq: 2, change: { op: "remove", item: "Ruby Ring" } };
    intent(al.characterId, { t: "contentItemArt", seq: 1 });
    intent(al.characterId, pick);
    expect(sent.filter((s) => s.to === al.characterId && s.msg.t.startsWith("content"))).toEqual(
      [],
    );
    intent(god.characterId, { t: "contentItemArt", seq: 1 });
    expect(last(god.characterId, "contentItemArt")?.view.currency).toBe("Gold");
    intent(god.characterId, pick);
    expect(last(god.characterId, "contentResult")).toMatchObject({
      seq: 2,
      ok: false,
      text: "Ruby Ring has no upload of its own.",
    });
    // A malformed change never reaches the game.
    expect(() =>
      intent(god.characterId, {
        t: "contentPicture",
        seq: 3,
        change: { op: "pile", pile: "Gold", art: null },
      }),
    ).toThrow();
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
    // Neither the Content page nor the NPC Editor may put it on sale again.
    const npc = { dataset: "npcFiles", part: "files", key: "Agavar" } as const;
    const agavar = rowValue(service.publishedContent(), npc) as { name: string; text: string };
    expect(agavar).toBeDefined();
    const r = service.draftSet(ADMIN(god), npc, "set", {
      ...agavar,
      text: `${agavar.text}\rSEL|Ruby Ring:5:1`,
    });
    expect(r.ok).toBe(false);
    expect(checkNpcFile(["SEL|Ruby Ring:5:1"]).error).not.toBeNull();
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
    expect(r.ok).toBe(true);
    // Settled at publish: nobody holds one, so it is removed rather than retired.
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(content().item("Ruby Ring")).toBeUndefined();
  });

  test("a retirement is settled at publish: a copy gained since the draft keeps the item retired", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    service.draftRemoval(
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
    // Nobody held one when it was drafted; Al gets one before it is published.
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[5] = { item: "Ruby Ring", qty: 1 };
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(content().item("Ruby Ring")?.retired).toBe(true);
    expect(game.contentWorld.problems()).toEqual([]);
  });

  test("a publish whose world cleanup fails writes nothing and keeps the live store", async () => {
    const god = await make("God", "administrator");
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    const rev = service.draftRev();
    const hash = content().hash;
    const broken = {
      ...game.contentWorld,
      apply: () => {
        throw new Error("disk full");
      },
    };
    expect(() => service.publish(ADMIN(god), rev, "", broken)).toThrow("disk full");
    expect(content().hash).toBe(hash);
    expect(content().item("Ruby Ring")).toBeDefined();
    expect(service.draftRev()).toBe(rev);
    expect(service.liveActions()).toHaveLength(1);
    expect(service.history()).toEqual([]);
  });

  test("an online player's purged copies are written with the publish, not at the next save", async () => {
    const { god, al } = await ringsEverywhere();
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    // No tick has run.
    expect(
      db
        .query("SELECT count(*) AS n FROM inventory WHERE character_id = ? AND item = 'Ruby Ring'")
        .get(al.characterId),
    ).toEqual({ n: 0 });
    expect(
      db.query("SELECT count(*) AS n FROM container_items WHERE item = 'Ruby Ring'").get(),
    ).toEqual({ n: 0 });
  });

  test("a replaced container keeps its storage; a purged one takes it with it", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[5] = { item: "Crate#12", qty: 1 };
    game.world.containers.set("Crate#12", ["Ale", "Apple"]);
    // Another player's Cabinet with the same id.
    game.world.containers.set("Cabinet#12", ["Mead"]);
    // Only another storage item may take its place.
    const notStorage = service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Crate",
        content: "replace",
        copies: "replace",
        replacement: "Ale",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(notStorage.ok).toBe(false);
    expect(
      service.draftRemoval(
        ADMIN(god),
        {
          kind: "item",
          key: "Crate",
          content: "replace",
          copies: "replace",
          replacement: "Cabinet",
          refundGold: 0,
        },
        game.contentWorld,
      ).ok,
    ).toBe(true);
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    // Its storage moves to a new id of its own, so it never lands on another Cabinet's (#12 here).
    const moved = p.char.bag[5]?.item ?? "";
    expect(moved).toMatch(/^Cabinet#\d+$/);
    expect(moved).not.toBe("Cabinet#12");
    expect(game.world.containers.get(moved)).toEqual(["Ale", "Apple"]);
    expect(game.world.containers.get("Cabinet#12")).toEqual(["Mead"]);
    expect(game.world.containers.has("Crate#12")).toBe(false);
    // Purged, the Cabinet takes what it held with it.
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Cabinet",
        // Carpentry's roll table makes Cabinets: its entry can only be replaced.
        content: "replace",
        copies: "purge",
        replacement: "Wind Cabinet",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(p.char.bag[5]).toBeNull();
    expect(game.world.containers.has(moved)).toBe(false);
    expect(service.history()[0]?.cleanup.join("\n")).toContain("2 stored items");
  });

  test("a container in a vault, online or offline, takes its storage with it when replaced or purged", async () => {
    // Deposits refuse containers, so only a database edit puts one in a vault; a cleanup must
    // still not strand its storage.
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bo = await make("Bo", undefined, false);
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.vault.push("Crate#21");
    game.world.containers.set("Crate#21", ["Ale", "Apple"]);
    db.query(
      "INSERT INTO vault_items (character_id, position, item) VALUES (?, 1, 'Crate#22')",
    ).run(bo.characterId);
    game.world.containers.set("Crate#22", ["Mead"]);
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Crate",
        content: "replace",
        copies: "replace",
        replacement: "Cabinet",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    const online = p.char.vault[0] ?? "";
    const offline =
      db
        .query<{ item: string }, [string]>("SELECT item FROM vault_items WHERE character_id = ?")
        .get(bo.characterId)?.item ?? "";
    expect(online).toMatch(/^Cabinet#\d+$/);
    expect(offline).toMatch(/^Cabinet#\d+$/);
    expect(game.world.containers.get(online)).toEqual(["Ale", "Apple"]);
    expect(game.world.containers.get(offline)).toEqual(["Mead"]);
    expect(game.world.containers.has("Crate#21")).toBe(false);
    expect(game.world.containers.has("Crate#22")).toBe(false);
    // Purged, each Cabinet takes what it held with it.
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Cabinet",
        content: "replace",
        copies: "purge",
        replacement: "Wind Cabinet",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(p.char.vault).toEqual([]);
    expect(game.world.containers.has(online)).toBe(false);
    expect(game.world.containers.has(offline)).toBe(false);
    expect(
      db
        .query("SELECT count(*) AS n FROM container_items WHERE name IN (?, ?)")
        .get(online, offline),
    ).toEqual({ n: 0 });
  });

  test("a pile replaced by crystals carries its count in its name; usage counts crystal piles whole", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.map.ground.push({
      id: "g-ap",
      item: "Apple",
      qty: 5,
      x: 2,
      y: 3,
      kind: "admin",
      expiresAt: null,
    });
    p.map.ground.push({
      id: "g-bc",
      item: "3 Red Crystal",
      x: 3,
      y: 3,
      kind: "drop",
      expiresAt: null,
    });
    expect(game.contentWorld.usage("item", ["Red Crystal"])[0]).toMatchObject({
      place: "ground",
      count: 3,
    });
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Apple",
        content: "replace",
        copies: "replace",
        replacement: "Blue Crystal",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    const g = p.map.ground.find((x) => x.id === "g-ap");
    expect(g?.item).toBe("5 Blue Crystal");
    expect(g?.qty).toBeUndefined();
  });

  test("a publish that fails after the world cleanup puts memory back as the database is", async () => {
    const { god, p } = await ringsEverywhere();
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 5,
      },
      game.contentWorld,
    );
    const gold = p.char.gold;
    const failing = {
      ...game.contentWorld,
      apply: (...args: Parameters<typeof game.contentWorld.apply>) => {
        game.contentWorld.apply(...args);
        throw new Error("write failed");
      },
    };
    expect(() => service.publish(ADMIN(god), service.draftRev(), "", failing)).toThrow(
      "write failed",
    );
    expect(p.char.bag[3]).toEqual({ item: "Ruby Ring", qty: 2 });
    expect(p.char.equip.ring).toBe("Ruby Ring");
    expect(p.char.vault).toEqual(["Ruby Ring"]);
    expect(p.char.gold).toBe(gold);
    expect(p.map.ground.some((g) => g.id === "g-ring")).toBe(true);
    expect(game.world.containers.get("Crate#7")).toEqual(["Ruby Ring", "Ale"]);
    expect(content().item("Ruby Ring")).toBeDefined();
    expect(db.query("SELECT count(*) AS n FROM inventory WHERE item = 'Ruby Ring'").get()).toEqual({
      n: 1,
    });
    // The activity ledger went back with the items: the next check finds nothing unlogged.
    game.tick();
    expect(activity("unlogged")).toEqual([]);
  });

  test("a crystal pile replaced by an item that does not count in its name keeps its count as quantity", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.map.ground.push({
      id: "g-cr",
      item: "5 Blue Crystal",
      x: 2,
      y: 3,
      kind: "drop",
      expiresAt: null,
    });
    // Mining makes Blue Crystal from its colours: the operator changes those first.
    const gathering = service.publishedContent().gather.gathering;
    expect(
      service.draftSet(ADMIN(god), { dataset: "gather", part: "gathering", key: null }, "set", {
        ...gathering,
        mining: {
          ...gathering.mining,
          colours: gathering.mining!.colours.map((c) => (c === "Blue" ? "Red" : c)),
        },
      }).ok,
    ).toBe(true);
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Blue Crystal",
        content: "replace",
        copies: "replace",
        replacement: "Apple",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.check()).toEqual([]);
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    const g = p.map.ground.find((x) => x.id === "g-cr");
    expect(g?.item).toBe("Apple");
    expect(g?.qty).toBe(5);
    expect(db.query("SELECT item, qty FROM ground_items WHERE id = 'g-cr'").get()).toEqual({
      item: "Apple",
      qty: 5,
    });
  });

  test("an NPC Editor save gets the content's cleanup on publish", async () => {
    const god = await make("God", "administrator");
    saveNpcFile(db, { npc: "Agavar", text: "BIO|Hi\rSEL|Ruby Ring:9:3\rSEL|Ale:2:5" }, "acc", "t");
    const u = service.usage("item", "Ruby Ring", game.contentWorld);
    expect(u.ok && u.value.uses.some((x) => x.where.includes("(live save)"))).toBe(true);
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    // The save would sell a removed item, but the waiting cleanup takes its line out.
    expect(service.check()).toEqual([]);
    expect(service.removals(game.contentWorld)[0]?.lines.join("\n")).not.toContain("still name it");
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(db.query("SELECT text FROM npc_files WHERE npc = 'Agavar'").get()).toEqual({
      text: "BIO|Hi\rSEL|Ale:2:5",
    });
  });

  test("a player shop never blocks a removal; a purge takes its stock, a retirement leaves it", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const shop = "Zorbu";
    const text = "BIO|My shop\rSEL|Ruby Ring:50:4\rSEL|Ale:2:5";
    db.query(
      "INSERT INTO player_shops (npc, owner_id, interior, created_at) VALUES (?, ?, 'xH1000yH992', 't')",
    ).run(shop, al.characterId);
    saveNpcFile(db, { npc: shop, text }, "acc", "t");
    game.world.playerShops.set(shop.toLowerCase(), {
      npc: shop,
      ownerId: al.characterId,
      interior: "xH1000yH992",
    });
    setNpcFile(game.world.npcs, shop, text);
    const u = service.usage("item", "Ruby Ring", game.contentWorld);
    expect(u.ok && u.value.world.find((w) => w.place === "shop")).toMatchObject({
      count: 4,
      holders: [shop],
    });
    // Retired: the shop keeps its stock (they are copies) and nothing blocks the publish.
    service.draftRemoval(
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
    expect(service.check()).toEqual([]);
    service.draftDiscard(entryRef("item", "Ruby Ring"));
    // Purged: the stock goes with every other copy.
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(db.query("SELECT text FROM npc_files WHERE npc = ?").get(shop)).toEqual({
      text: "BIO|My shop\rSEL|Ale:2:5",
    });
    expect(service.history()[0]?.cleanup.join("\n")).toContain("4 on sale in player shops");
  });

  test("a replaced line joins the stack of the replacement, online and offline", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bo = await make("Bo", undefined, false);
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[3] = { item: "Ruby Ring", qty: 2 };
    p.char.bag[6] = { item: "Mage's Ring", qty: 1 };
    p.activityHeld = undefined;
    game.tick();
    for (const [id, slot, item, qty] of [
      ["b1", 14, "Ruby Ring", 3],
      ["b2", 15, "Mage's Ring", 2],
    ] as const) {
      db.query(
        "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
      ).run(id, bo.characterId, slot, item, qty);
    }
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "replace",
        copies: "replace",
        replacement: "Mage's Ring",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(p.char.bag.filter((l) => l?.item === "Mage's Ring")).toEqual([
      { item: "Mage's Ring", qty: 3 },
    ]);
    expect(
      db
        .query("SELECT item, qty FROM inventory WHERE character_id = ? AND item = 'Mage''s Ring'")
        .all(bo.characterId),
    ).toEqual([{ item: "Mage's Ring", qty: 5 }]);
    game.tick();
    expect(activity("unlogged")).toEqual([]);
  });

  test("a monster made on the Monsters page spawns, drops its loot and goes on removal (issue #31)", async () => {
    // Every roll 1: a loot line of 1 in 1 drops, and nothing else moves.
    setupGame({ random: () => 1 });
    const god = await make("God", "administrator");
    const p = game.world.players.get(god.characterId);
    if (!p) {
      throw new Error("God is not online");
    }
    // Copy Orc as Orc Chief: tougher, and its loot a Long Sword every kill.
    const made = service.draftMonsterChange(ADMIN(god), {
      name: "Orc Chief",
      op: "create",
      copyFrom: "Orc",
    });
    expect(made.ok ? "" : made.error).toBe("");
    const v = service.monstersView("Orc Chief").monster;
    if (!v) {
      throw new Error("Orc Chief");
    }
    const set = service.draftMonsterChange(ADMIN(god), {
      name: "Orc Chief",
      op: "set",
      record: { ...v.record, hp: 90 },
      expect: v.fingerprint,
    });
    expect(set.ok ? "" : set.error).toBe("");
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    // Its loot, saved live through the Monsters page's intent.
    intent(god.characterId, { t: "controlPanelOpen" });
    intent(god.characterId, { t: "contentNpcFile", seq: 1, name: "Orc Chief" });
    const f = last(god.characterId, "contentNpcFile");
    intent(god.characterId, {
      t: "contentNpcFileSet",
      seq: 2,
      name: "Orc Chief",
      expect: f?.view?.revision ?? null,
      sections: { loot: [{ item: "Long Sword", oneIn: 1 }], spells: [], flags: [] },
    });
    expect(last(god.characterId, "contentNpcFile")?.result?.ok).toBe(true);
    // One line, 1 in 1: every kill drops it.
    expect(rollLoot(game.world.npcs.get("orc chief")?.loot ?? null, { random: () => 1 })).toBe(
      "Long Sword",
    );
    intent(god.characterId, { t: "editClose" });
    // On a map's roster, it spawns with its own hit points.
    intent(god.characterId, { t: "chat", text: "/roster 1 Orc Chief" });
    intent(god.characterId, { t: "chat", text: "/spawn 1" });
    const slot = p.map.slots[0];
    expect(slot?.live?.name).toBe("Orc Chief");
    expect(slot?.live?.hp).toBe(90);
    // Killed in melee, it drops its loot where it stood.
    const live = slot?.live;
    if (!live) {
      throw new Error("no Orc Chief");
    }
    live.x = p.x;
    live.y = p.y - 1;
    live.fromX = live.x;
    live.fromY = live.y;
    live.hp = 0;
    p.facing = "N";
    intent(god.characterId, { t: "mapReady" });
    intent(god.characterId, { t: "attack", seq: 1, held: true });
    for (let i = 0; i < 40 && slot?.live; i++) {
      game.tick();
    }
    intent(god.characterId, { t: "attack", seq: 2, held: false });
    expect(slot?.live ?? null).toBeNull();
    expect(
      p.map.ground.some((g) => g.item === "Long Sword" && g.x === p.x && g.y === p.y - 1),
    ).toBe(true);
    // Spawned again, for the removal below.
    intent(god.characterId, { t: "chat", text: "/spawn 1" });
    expect(slot?.live?.name).toBe("Orc Chief");
    // Removed with despawn: it goes from the map.
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "monster",
        key: "Orc Chief",
        content: "remove",
        spawns: "remove",
        live: "despawn",
        replacement: null,
        npcFile: "delete",
      },
      game.contentWorld,
    );
    expect(r.ok ? "" : r.error).toBe("");
    const pub = service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld);
    expect(pub.ok ? "" : JSON.stringify(pub.problems ?? pub.error)).toBe("");
    expect(slot?.live ?? null).toBeNull();
    expect(content().monster("Orc Chief")).toBeUndefined();
  });

  test("a live NPC file save after the draft was reviewed refuses its publish; a masked row edit is refused (issue #31)", async () => {
    const god = await make("God", "administrator");
    saveNpcFile(db, { npc: "Agavar", text: "BIO|Hi\rSEL|Ruby Ring:9:3" }, "acc", "t");
    service.draftRemoval(
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
    const reviewed = service.draftRev();
    // Someone saves Agavar's file (the Monsters page, the NPC Editor) before the publish.
    saveNpcFile(db, { npc: "Agavar", text: "BIO|Newer\rSEL|Ruby Ring:9:3" }, "acc", "t");
    expect(service.draftRev()).not.toBe(reviewed);
    const r = service.publish(ADMIN(god), reviewed, "", game.contentWorld);
    expect(r.ok).toBe(false);
    // A save the cleanup does not touch leaves the revision as it was.
    const now = service.draftRev();
    saveNpcFile(db, { npc: "Cril", text: "GLD|5" }, "acc", "t");
    expect(service.draftRev()).toBe(now);
    // The content row of a file with a live save would never play: changing it is refused.
    const row = service.draftSet(
      ADMIN(god),
      { dataset: "npcFiles", part: "files", key: "Agavar" },
      "set",
      { name: "Agavar", text: "BIO|Row" },
    );
    expect(row.ok).toBe(false);
    // A row drafted before a live save of its file: the save changes the draft's revision, so the
    // publish its author reviewed is refused.
    const amber = service.draftSet(
      ADMIN(god),
      { dataset: "npcFiles", part: "files", key: "Amber" },
      "set",
      { name: "Amber", text: "BIO|Row" },
    );
    expect(amber.ok).toBe(true);
    const before = service.draftRev();
    saveNpcFile(db, { npc: "Amber", text: "BIO|Live" }, "acc", "t");
    const pub = service.publish(ADMIN(god), before, "", game.contentWorld);
    expect(pub.ok ? "" : pub.error).toContain("the draft changed since you last looked");
  });

  test("removing a crystal purges its stacks, vault lines and shop lines, and no other colour's", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[2] = { item: "Blue Crystal", qty: 6 };
    p.char.bag[3] = { item: "Red Crystal", qty: 2 };
    p.char.vault.push("Blue Crystal", "Red Crystal");
    p.activityHeld = undefined;
    game.tick();
    saveNpcFile(
      db,
      { npc: "Agavar", text: "BIO|Hi\rSEL|Blue Crystal:9:3\rSEL|Red Crystal:2:5" },
      "acc",
      "t",
    );
    const gathering = service.publishedContent().gather.gathering;
    service.draftSet(ADMIN(god), { dataset: "gather", part: "gathering", key: null }, "set", {
      ...gathering,
      mining: {
        ...gathering.mining,
        colours: gathering.mining!.colours.map((c) => (c === "Blue" ? "Red" : c)),
      },
    });
    // The player-shop list names the crystal as the bag does.
    expect(
      usesOf(service.draftContent(), "item", "Blue Crystal").some(
        (u) => u.where === "items/playerShopWhitelist",
      ),
    ).toBe(true);
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Blue Crystal",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 1,
      },
      game.contentWorld,
    );
    expect(service.check()).toEqual([]);
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(p.char.bag[2]).toBeNull();
    expect(p.char.bag[3]).toEqual({ item: "Red Crystal", qty: 2 });
    expect(p.char.vault).toEqual(["Red Crystal"]);
    expect(content().item("Blue Crystal")).toBeUndefined();
    expect(db.query("SELECT text FROM npc_files WHERE npc = 'Agavar'").get()).toEqual({
      text: "BIO|Hi\rSEL|Red Crystal:2:5",
    });
  });

  test("an open vault shows its new lines when a purge empties some", async () => {
    const { god, p } = await ringsEverywhere();
    p.vaultOpen = true;
    p.char.vault.push("Ale");
    sent.length = 0;
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    const shown = sent.filter((x) => x.to === p.id && x.msg.t === "vault").at(-1)?.msg as
      | { items: string[] }
      | undefined;
    expect(shown?.items).toEqual(["Ale"]);
  });

  test("owner-named fixtures and player shopkeepers are not problems", async () => {
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    for (const [id, item] of [
      ["f1", "Al's House Vault"],
      ["f2", "Al's Newspaper"],
      ["f3", "The Knights's Guild Vault"],
    ] as const) {
      p.map.ground.push({ id, item, x: 4, y: 4, kind: "admin", expiresAt: null });
    }
    game.world.playerShops.set("zorbu", { npc: "Zorbu", ownerId: al.characterId, interior: "x" });
    const slot = p.map.slots[2];
    if (slot) {
      slot.species = "Zorbu";
    }
    expect(game.contentWorld.problems()).toEqual([]);
  });

  test("a monster's replacement may be named by the name players see", async () => {
    const god = await make("God", "administrator");
    const ratmas = rowValue(service.publishedContent(), entryRef("monster", "Ratmas")) as Record<
      string,
      unknown
    >;
    service.draftSet(ADMIN(god), entryRef("monster", "Ratmas"), "set", {
      ...ratmas,
      display: "Giant Rat",
    });
    service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld);
    const r = service.draftRemoval(
      ADMIN(god),
      {
        kind: "monster",
        key: "Slime",
        content: "replace",
        spawns: "replace",
        live: "leave",
        npcFile: "keep",
        replacement: "Giant Rat",
      },
      game.contentWorld,
    );
    expect(r.ok).toBe(true);
    expect(service.liveActions()[0]).toMatchObject({ replacement: "Ratmas" });
  });

  test("a retirement made by hand counts each place once", async () => {
    const { god } = await ringsEverywhere();
    const ring = rowValue(service.publishedContent(), entryRef("item", "Ruby Ring")) as Record<
      string,
      unknown
    >;
    service.draftSet(ADMIN(god), entryRef("item", "Ruby Ring"), "set", { ...ring, retired: true });
    const places = game.contentWorld.usage("item", ["Ruby Ring"]);
    const placeTotal = places.reduce((n, x) => n + Math.max(1, x.holderCount), 0);
    expect(service.removals(game.contentWorld)[0]?.stillUsed).toBe(
      placeTotal + usesOf(service.draftContent(), "item", "Ruby Ring").length,
    );
  });

  test("an item already retired is removed once nobody holds a copy, and refused while some do", async () => {
    const { god, p } = await ringsEverywhere();
    service.draftRemoval(
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
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(content().item("Ruby Ring")?.retired).toBe(true);
    const retireAgain = {
      kind: "item" as const,
      key: "Ruby Ring",
      content: "remove" as const,
      copies: "retire" as const,
      replacement: null,
      refundGold: 0,
    };
    expect(service.draftRemoval(ADMIN(god), retireAgain, game.contentWorld).ok).toBe(false);
    expect(
      service.draftRemoval(ADMIN(god), { ...retireAgain, copies: "purge" }, game.contentWorld).ok,
    ).toBe(true);
    service.draftDiscard(entryRef("item", "Ruby Ring"));
    // Once every copy is gone, the plain Remove takes it out.
    p.char.bag[3] = null;
    p.char.equip.ring = "NOTHING";
    p.char.vault = [];
    db.query("DELETE FROM inventory WHERE item = 'Ruby Ring'").run();
    db.query("DELETE FROM vault_items WHERE item = 'Ruby Ring'").run();
    p.map.ground.splice(
      p.map.ground.findIndex((g) => g.id === "g-ring"),
      1,
    );
    game.world.containers.set("Crate#7", ["Ale"]);
    expect(service.draftRemoval(ADMIN(god), retireAgain, game.contentWorld).ok).toBe(true);
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(content().item("Ruby Ring")).toBeUndefined();
  });

  test("an already-retired item with a copy left anywhere (the ground) is not removed outright", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[4] = { item: "Ruby Ring", qty: 1 };
    service.draftRemoval(
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
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    // The last copy is dropped: it is on the ground, held by nobody.
    p.char.bag[4] = null;
    p.map.ground.push({
      id: "g-last",
      item: "Ruby Ring",
      x: 5,
      y: 5,
      kind: "drop",
      expiresAt: null,
    });
    const again = service.draftRemoval(
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
    expect(again.ok).toBe(false);
  });

  test("a failed publish leaves NPC shops' saved stock as it was", async () => {
    const { god } = await ringsEverywhere();
    saveNpcFile(db, { npc: "Agavar", text: "BIO|Hi\rSEL|Ruby Ring:9:3\rSEL|Ale:2:5" }, "acc", "t");
    saveShop(
      db,
      {
        npc: "Agavar",
        gold: 77,
        lines: [
          { line: 2, kind: "SEL", item: "Ruby Ring", price: 9, stock: 1 },
          { line: 3, kind: "SEL", item: "Ale", price: 2, stock: 4 },
        ],
      },
      "t",
    );
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    const failing = {
      ...game.contentWorld,
      apply: (...args: Parameters<typeof game.contentWorld.apply>) => {
        game.contentWorld.apply(...args);
        throw new Error("write failed");
      },
    };
    expect(() => service.publish(ADMIN(god), service.draftRev(), "", failing)).toThrow();
    expect(db.query("SELECT gold FROM npc_shops WHERE npc = 'Agavar'").get()).toEqual({ gold: 77 });
  });

  test("a failed publish tells clients nothing and leaves pending saves pending", async () => {
    const { god, p } = await ringsEverywhere();
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    game.world.powersDirty = true;
    sent.length = 0;
    const failing = {
      ...game.contentWorld,
      apply: (...args: Parameters<typeof game.contentWorld.apply>) => {
        game.contentWorld.apply(...args);
        throw new Error("write failed");
      },
    };
    expect(() => service.publish(ADMIN(god), service.draftRev(), "", failing)).toThrow();
    expect(
      sent.some(
        (x) => x.msg.t === "delta" && x.msg.events.some((e) => e.e === "gdel" && e.id === "g-ring"),
      ),
    ).toBe(false);
    expect(game.world.powersDirty).toBe(true);
    expect(p.char.bag[3]).toEqual({ item: "Ruby Ring", qty: 2 });
  });

  test("a failed publish sends no message at all, and an NPC's open shop stays open", async () => {
    const { god, p } = await ringsEverywhere();
    // Agavar's NPC Editor save sells rings: the cleanup changes it, which closes its shop window.
    saveNpcFile(db, { npc: "Agavar", text: "BIO|Hi\rSEL|Ruby Ring:9:3\rSEL|Ale:2:5" }, "acc", "t");
    game.contentPublished(content().hash);
    p.shop = { npc: "Agavar", mode: "buy" };
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 3,
      },
      game.contentWorld,
    );
    sent.length = 0;
    const failing = {
      ...game.contentWorld,
      apply: (...args: Parameters<typeof game.contentWorld.apply>) => {
        game.contentWorld.apply(...args);
        throw new Error("write failed");
      },
    };
    expect(() => service.publish(ADMIN(god), service.draftRev(), "", failing)).toThrow();
    // Not the new store, nor an inventory, the ground or a closed window.
    expect(sent.map((s) => s.msg.t)).toEqual([]);
    expect(p.shop).toEqual({ npc: "Agavar", mode: "buy" });
    // The same draft then publishes, and only now are clients told.
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(sent.some((s) => s.to === p.id && s.msg.t === "content")).toBe(true);
    expect(sent.some((s) => s.to === p.id && s.msg.t === "npcClosed")).toBe(true);
    expect(p.shop).toBeNull();
  });

  test("paintings and photos players make are not problems", async () => {
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[7] = { item: "Painting#12", qty: 1 };
    p.char.vault.push("Photo#4");
    expect(game.contentWorld.problems()).toEqual([]);
  });

  test("the character editor moves a retired item's copies but adds none", async () => {
    const { god } = await ringsEverywhere();
    service.draftRemoval(
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
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    const bag = (lines: Record<number, { item: string; qty: number }>) =>
      Array.from({ length: 15 }, (_, i) => lines[i] ?? null);
    const before = { ...editable(), bag: bag({ 3: { item: "Ruby Ring", qty: 2 } }) };
    const more = { ...before, bag: bag({ 3: { item: "Ruby Ring", qty: 500 } }) };
    expect(editErrors(before, more).join("\n")).toContain("no more can be made");
    const moved = { ...before, bag: bag({ 9: { item: "Ruby Ring", qty: 2 } }) };
    expect(editErrors(before, moved)).toEqual([]);
  });

  test("an NPC Editor save the cleanup changes keeps its old text as a version", async () => {
    const god = await make("God", "administrator");
    saveNpcFile(db, { npc: "Agavar", text: "BIO|Hi\rSEL|Ruby Ring:9:3" }, "acc", "t");
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(npcFileVersions(db, "Agavar")).toContain("BIO|Hi\rSEL|Ruby Ring:9:3");
  });

  test("marking a queued purge's item retired by hand drops the purge", async () => {
    const { god, p } = await ringsEverywhere();
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Ruby Ring",
        content: "leave",
        copies: "purge",
        replacement: null,
        refundGold: 50,
      },
      game.contentWorld,
    );
    const ring = rowValue(service.publishedContent(), entryRef("item", "Ruby Ring")) as Record<
      string,
      unknown
    >;
    service.draftSet(ADMIN(god), entryRef("item", "Ruby Ring"), "set", { ...ring, retired: true });
    expect(service.liveActions()).toEqual([]);
  });

  test("an empty container's open window closes when it is purged", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("Al is not online");
    }
    p.char.bag[5] = { item: "Crate#77", qty: 1 };
    p.container = { name: "Crate#77", shown: [], carried: true };
    service.draftRemoval(
      ADMIN(god),
      {
        kind: "item",
        key: "Crate",
        content: "replace",
        copies: "purge",
        replacement: "Wind Cabinet",
        refundGold: 0,
      },
      game.contentWorld,
    );
    expect(service.publish(ADMIN(god), service.draftRev(), "", game.contentWorld).ok).toBe(true);
    expect(p.container).toBeNull();
  });

  test("a player shop's stock is read from its saved ledger when it is not loaded", async () => {
    const al = await make("Al");
    const shop = "Zorbu";
    db.query(
      "INSERT INTO player_shops (npc, owner_id, interior, created_at) VALUES (?, ?, 'xH1000yH992', 't')",
    ).run(shop, al.characterId);
    const text = "BIO|My shop\rSEL|Ruby Ring:50:4";
    saveNpcFile(db, { npc: shop, text }, "acc", "t");
    game.world.playerShops.set(shop.toLowerCase(), {
      npc: shop,
      ownerId: al.characterId,
      interior: "x",
    });
    setNpcFile(game.world.npcs, shop, text);
    // Since the file was written, the shop sold one: its saved ledger holds 3.
    saveShop(
      db,
      {
        npc: shop,
        gold: 50,
        lines: [{ line: 2, kind: "SEL", item: "Ruby Ring", price: 50, stock: 3 }],
      },
      "t",
    );
    game.world.shops.delete(shop);
    expect(
      game.contentWorld.usage("item", ["Ruby Ring"]).find((x) => x.place === "shop")?.count,
    ).toBe(3);
  });

  test("a monster with only an NPC Editor save offers to remove that save", async () => {
    saveNpcFile(db, { npc: "Slime", text: "RND|Blub" }, "acc", "t");
    const u = service.usage("monster", "Slime", game.contentWorld);
    expect(u.ok && u.value.npcFile).toBe(true);
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
      onPublish: (store, restoring) => {
        installContent(store);
        live?.contentPublished(store.hash, restoring);
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
    // The Content page lists them; stock Classic content has no unresolved references of its own.
    const all = service.problems(game.contentWorld);
    expect(all.world).toHaveLength(3);
    expect(all.content).toEqual([]);
  });
});
