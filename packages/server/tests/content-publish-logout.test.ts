/**
 * "Log everyone out while publishing" (issue #40): a publish that asks for it logs every player but
 * the publishing admin out the usual way (each saved), refuses every way in while it runs with
 * `TEXT.publishing`, and releases the lock however the publish ends. The publish log and the audit
 * entry say how many were logged out. A publish without it keeps the live path (content-cleanup).
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { inGameSchema, installContent, type ServerMsg, TEXT } from "@secondstaronline/shared";

import { ContentService } from "../src/content/service.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { findCharacterById } from "../src/persistence/characters.ts";
import { upsertDraftRow } from "../src/persistence/content.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { listMaps } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

describe("log everyone out while publishing", () => {
  let db: Db;
  let sent: { to: string; msg: ServerMsg }[];
  let kicked: { id: string; text: string }[];
  let faults: string[];
  let service: ContentService;
  let game: Game;
  const wall = Date.UTC(2026, 10, 25, 12, 0, 0);
  let t = 0;
  let ips = 0;

  beforeEach(() => setup());
  /** A fresh world: its database, content service and game. */
  function setup() {
    db = openDatabase();
    migrate(db);
    sent = [];
    kicked = [];
    faults = [];
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
      rng: NEVER_PUSH,
      // No gateway: the kick is recorded, and the game takes the player off the map itself.
      kick: (id, text) => kicked.push({ id, text }),
      onFault: (where) => faults.push(where),
    });
    live = game;
  }

  const createMsg = (name: string) => ({
    t: "create" as const,
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
  });

  async function make(name: string, role?: string, online = true) {
    ips += 1;
    await game.create(createMsg(name), `10.0.2.${ips}`);
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

  function intent(id: string, msg: unknown) {
    game.intent(id, inGameSchema.parse(msg));
  }
  const last = <T extends ServerMsg["t"]>(to: string, tt: T) =>
    sent.filter((s) => s.to === to && s.msg.t === tt).at(-1)?.msg as
      | Extract<ServerMsg, { t: T }>
      | undefined;

  /** Puts a harmless change in the draft. */
  function draftSomething(god: { accountId: string; name: string }) {
    const r = service.draftSet(
      { accountId: god.accountId, name: god.name },
      { dataset: "casino", part: "slots", key: null },
      "set",
      { ...service.publishedContent().casino.slots, cost: 25 },
    );
    expect(r.ok).toBe(true);
  }

  const publishAudit = () =>
    db
      .query<{ after: string }, []>(
        "SELECT after FROM audit_log WHERE command = 'content publish' ORDER BY id DESC",
      )
      .get();

  /** Every way in, tried while the publish runs: each answer, once it settles. */
  function tryEveryWayIn(characterId: string, name: string) {
    return {
      login: game.login(name, "pw", "10.0.0.9"),
      create: game.create(createMsg("Newcomer"), "10.0.3.1"),
      resume: game.refusal(characterId, "10.0.0.9"),
      enter: game.enter(characterId, true, "10.0.0.9"),
    };
  }

  test("other players, staff and the Control Panel included, are logged out with the message and saved", async () => {
    const god = await make("God", "administrator");
    const mod = await make("Mod", "administrator");
    const al = await make("Al");
    const bo = await make("Bo", undefined, false);
    intent(mod.characterId, { t: "controlPanelOpen" });
    expect(game.world.players.get(mod.characterId)?.editing).toBeTruthy();
    const alP = game.world.players.get(al.characterId);
    if (!alP) {
      throw new Error("Al is not online");
    }
    alP.char.hunger = 1234;
    draftSomething(god);
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "Cheaper ale",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    expect(last(god.characterId, "contentResult")).toMatchObject({ ok: true });
    expect(last(god.characterId, "contentResult")?.text).toContain("2 players were logged out");
    // Only the publishing admin stays.
    expect([...game.world.players.keys()]).toEqual([god.characterId]);
    expect(kicked.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: mod.characterId, text: TEXT.publishing },
        { id: al.characterId, text: TEXT.publishing },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(kicked.some((k) => k.id === bo.characterId)).toBe(false);
    // Saved as at a normal logout.
    expect(findCharacterById(db, al.characterId)?.hunger).toBe(1234);
    // The publish log and the audit entry say so, and how many.
    // Apart from the world's cleanup lines, so Undo does not warn of a cleanup that never ran.
    expect(service.history()[0]?.cleanup).toEqual([]);
    expect(service.history()[0]?.loggedOut).toBe(2);
    expect(JSON.parse(publishAudit()?.after ?? "null")).toEqual({
      rows: ["casino/slots"],
      loggedOut: 2,
    });
    // The lock is gone: they log in again.
    expect((await game.login("Al", "pw", "10.0.0.1")).ok).toBe(true);
    expect(game.enter(al.characterId, false, "10.0.0.1")).toBe(true);
  });

  test("every way in is refused during the publish and accepted after it commits", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    draftSomething(god);
    const publish = service.publish.bind(service);
    let during: ReturnType<typeof tryEveryWayIn> | null = null;
    service.publish = (...args) => {
      during = tryEveryWayIn(al.characterId, "Al");
      return publish(...args);
    };
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    expect(last(god.characterId, "contentResult")).toMatchObject({ ok: true });
    const d = during as ReturnType<typeof tryEveryWayIn> | null;
    expect(await d?.login).toEqual({ ok: false, text: TEXT.publishing });
    expect(await d?.create).toEqual({ ok: false, text: TEXT.publishing });
    expect(d?.resume).toBe(TEXT.publishing);
    expect(d?.enter).toBe(false);
    // After: each is accepted.
    expect(game.refusal(al.characterId, "10.0.0.9")).toBeNull();
    expect((await game.login("Al", "pw", "10.0.0.1")).ok).toBe(true);
    expect(await game.create(createMsg("Later"), "10.0.3.2")).toEqual({ ok: true });
    expect(game.enter(al.characterId, false, "10.0.0.1")).toBe(true);
  });

  test("a publish that rolls back releases the lock too, and the logged-out players stay saved", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const alP = game.world.players.get(al.characterId);
    if (!alP) {
      throw new Error("Al is not online");
    }
    alP.char.hunger = 777;
    draftSomething(god);
    let during: ReturnType<typeof tryEveryWayIn> | null = null;
    service.publish = () => {
      during = tryEveryWayIn(al.characterId, "Al");
      throw new Error("write failed");
    };
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    // The throw is a fault: the admin is logged out with the server error, as for any intent.
    expect(kicked.at(-1)).toEqual({ id: god.characterId, text: TEXT.serverError });
    const d = during as ReturnType<typeof tryEveryWayIn> | null;
    expect(await d?.login).toEqual({ ok: false, text: TEXT.publishing });
    expect(d?.resume).toBe(TEXT.publishing);
    expect(d?.enter).toBe(false);
    // Al's logout committed before the publish, so the rollback keeps the save.
    expect(findCharacterById(db, al.characterId)?.hunger).toBe(777);
    // Unlocked.
    expect(game.refusal(al.characterId, "10.0.0.9")).toBeNull();
    expect((await game.login("Al", "pw", "10.0.0.1")).ok).toBe(true);
    expect(game.enter(al.characterId, false, "10.0.0.1")).toBe(true);
  });

  test("a publish refused before its checks (a changed draft) logs nobody out", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    draftSomething(god);
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: "0000000000000000",
      logoutEveryone: true,
    });
    expect(last(god.characterId, "contentResult")).toMatchObject({ ok: false });
    expect(game.world.players.has(al.characterId)).toBe(true);
    expect(kicked).toEqual([]);
  });

  test("a draft that fails its checks logs nobody out", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    // A schema the draft breaks: the Content page shows it, and Publish would be refused.
    upsertDraftRow(db, {
      dataset: "casino",
      part: "slots",
      key: null,
      op: "set",
      data: { cost: "free" },
      authorAccountId: god.accountId,
      author: "God",
      updatedAt: "x",
    });
    expect(service.check().length).toBeGreaterThan(0);
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    expect(last(god.characterId, "contentResult")).toMatchObject({ ok: false });
    expect(game.world.players.has(al.characterId)).toBe(true);
    expect(kicked).toEqual([]);
  });

  test("a player without the permission logs nobody out", async () => {
    const al = await make("Al");
    const bo = await make("Bo");
    intent(al.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: "0000000000000000",
      logoutEveryone: true,
    });
    expect(game.world.players.has(bo.characterId)).toBe(true);
    expect(kicked).toEqual([]);
    expect(
      db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM cheat_log").get()?.n,
    ).toBeGreaterThan(0);
  });

  test("a publish with a removal does the same to the world with nobody else online", async () => {
    /** Publishes a purge of the Ruby Rings an offline player holds; what it did, and the bag. */
    async function purge(logoutEveryone: boolean) {
      const god = await make("God", "administrator");
      const bo = await make("Bo", undefined, false);
      db.query(
        "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
      ).run(`inv-${bo.characterId}`, bo.characterId, 15, "Ruby Ring", 3);
      const r = service.draftRemoval(
        { accountId: god.accountId, name: god.name },
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
      expect(r.ok).toBe(true);
      intent(god.characterId, {
        t: "contentPublish",
        seq: 1,
        summary: "",
        draftRev: service.draftRev(),
        ...(logoutEveryone ? { logoutEveryone } : {}),
      });
      expect(last(god.characterId, "contentResult")).toMatchObject({ ok: true });
      expect(kicked).toEqual([]);
      return {
        cleanup: service.history()[0]?.cleanup ?? [],
        loggedOut: service.history()[0]?.loggedOut,
        rings:
          db
            .query<{ n: number }, [string]>(
              "SELECT COUNT(*) AS n FROM inventory WHERE character_id = ? AND item = 'Ruby Ring'",
            )
            .get(bo.characterId)?.n ?? -1,
      };
    }
    const alone = await purge(true);
    expect(alone.loggedOut).toBe(0);
    expect(alone.cleanup.length).toBeGreaterThan(0);
    expect(alone.rings).toBe(0);
    // The same purge in a fresh world, without the logout.
    setup();
    const live = await purge(false);
    expect(live.rings).toBe(0);
    expect(live.loggedOut).toBeNull();
    expect(alone.cleanup).toEqual(live.cleanup);
  });
  test("a logout whose save fails stops the publish: nothing is published and the admin is told whose", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    draftSomething(god);
    const draftRev = service.draftRev();
    db.run(
      `CREATE TRIGGER no_save BEFORE UPDATE ON characters WHEN OLD.id = '${al.characterId}' BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
    );
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev,
      logoutEveryone: true,
    });
    const r = last(god.characterId, "contentResult");
    expect(r).toMatchObject({ ok: false, seq: 1 });
    expect(r?.text).toContain("saving Al failed");
    expect(r?.text).toContain("nothing was published");
    // Nothing published: the draft waits as it was.
    expect(service.history()).toEqual([]);
    expect(service.draftRev()).toBe(draftRev);
    // Al was disconnected with the server error (they reload from their last save).
    expect(kicked).toEqual([{ id: al.characterId, text: TEXT.serverError }]);
    expect(game.world.players.has(god.characterId)).toBe(true);
    // The lock is released.
    db.run("DROP TRIGGER no_save");
    expect(game.refusal(al.characterId, "10.0.0.9")).toBeNull();
    expect((await game.login("Al", "pw", "10.0.0.1")).ok).toBe(true);
    expect(game.enter(al.characterId, false, "10.0.0.1")).toBe(true);
  });

  test("a draft failing a check the overview adds (a tile a map still uses) logs nobody out", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const map = listMaps(db)[0];
    const onMap = (map?.layers[0][0] ?? "").split(" ")[0] as string;
    expect(onMap).not.toBe("");
    const cat = service.publishedContent().tiles.catalogue;
    expect(
      service.draftSet(
        { accountId: god.accountId, name: god.name },
        { dataset: "tiles", part: "catalogue", key: null },
        "set",
        cat.filter((t) => t.code.toLowerCase() !== onMap.toLowerCase()),
      ).ok,
    ).toBe(true);
    // Not one of the draft's own checks: the overview adds it, as the publish does.
    expect(service.draftMapProblems(game.contentWorld).length).toBeGreaterThan(0);
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    const r = last(god.characterId, "contentResult");
    expect(r).toMatchObject({ ok: false });
    expect(r?.problems?.some((p) => p.message.includes(`tile ${onMap} is taken out`))).toBe(true);
    expect(game.world.players.has(al.characterId)).toBe(true);
    expect(kicked).toEqual([]);
  });

  test("a fault inside the real publish after its content write rolls the content back; the logout saves stay and entry reopens", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bo = await make("Bo", undefined, false);
    db.query(
      "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
    ).run("inv-bo", bo.characterId, 15, "Ruby Ring", 3);
    const alP = game.world.players.get(al.characterId);
    if (!alP) {
      throw new Error("Al is not online");
    }
    alP.char.hunger = 4321;
    expect(
      service.draftRemoval(
        { accountId: god.accountId, name: god.name },
        {
          kind: "item",
          key: "Ruby Ring",
          content: "remove",
          copies: "purge",
          replacement: null,
          refundGold: 0,
        },
        game.contentWorld,
      ).ok,
    ).toBe(true);
    const hashBefore = service.store().hash;
    const cw = game.contentWorld;
    const apply = cw.apply.bind(cw);
    let during: ReturnType<typeof tryEveryWayIn> | null = null;
    // The world's cleanup runs inside the publish's transaction, after the content rows and the
    // publish log are written and the new store is built.
    Object.assign(cw, {
      apply: (...args: Parameters<typeof cw.apply>) => {
        apply(...args);
        during = tryEveryWayIn(al.characterId, "Al");
        throw new Error("write failed");
      },
    });
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    Object.assign(cw, { apply });
    expect(kicked.at(-1)).toEqual({ id: god.characterId, text: TEXT.serverError });
    // Locked while it ran.
    const d = during as ReturnType<typeof tryEveryWayIn> | null;
    expect(d).not.toBeNull();
    expect(await d?.login).toEqual({ ok: false, text: TEXT.publishing });
    expect(d?.resume).toBe(TEXT.publishing);
    expect(d?.enter).toBe(false);
    // The content rolled back: the store, the log, the ring and Bo's copies are as they were.
    expect(service.store().hash).toBe(hashBefore);
    expect(service.history()).toEqual([]);
    expect(service.publishedContent().items.items.some((i) => i.name === "Ruby Ring")).toBe(true);
    expect(
      db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM inventory WHERE character_id = ? AND item = 'Ruby Ring'",
        )
        .get(bo.characterId)?.n,
    ).toBe(1);
    // Al's logout save committed before the publish and survives it.
    expect(findCharacterById(db, al.characterId)?.hunger).toBe(4321);
    // Entry reopens.
    expect(game.refusal(al.characterId, "10.0.0.9")).toBeNull();
    expect((await game.login("Al", "pw", "10.0.0.1")).ok).toBe(true);
    expect(game.enter(al.characterId, false, "10.0.0.1")).toBe(true);
  });
  test("a trade in progress with someone logged out is cancelled; the admin stays out of it", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    const bo = await make("Bo");
    const godP = game.world.players.get(god.characterId);
    const alP = game.world.players.get(al.characterId);
    if (!godP || !alP) {
      throw new Error("not online");
    }
    alP.map = godP.map;
    intent(god.characterId, { t: "tradeOpen", id: al.characterId });
    intent(al.characterId, { t: "tradeOpen", id: bo.characterId });
    expect(godP.trade).toBeTruthy();
    expect(game.world.trades.size).toBeGreaterThan(0);
    draftSomething(god);
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    expect(last(god.characterId, "contentResult")).toMatchObject({ ok: true });
    expect(godP.trade).toBeFalsy();
    expect(game.world.trades.size).toBe(0);
    expect(last(god.characterId, "trade")).toEqual({ t: "trade", trade: null });
  });

  test("the draft's removals say how many places in the world hold each", async () => {
    const god = await make("God", "administrator");
    const bo = await make("Bo", undefined, false);
    db.query(
      "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
    ).run("inv-bo", bo.characterId, 15, "Ruby Ring", 3);
    const actor = { accountId: god.accountId, name: god.name };
    for (const [key, copies, replacement] of [
      ["Ruby Ring", "purge", null],
      ["Champions Shield", "replace", "Chain Helm"],
    ] as const) {
      expect(
        service.draftRemoval(
          actor,
          { kind: "item", key, content: "remove", copies, replacement, refundGold: 0 },
          game.contentWorld,
        ).ok,
      ).toBe(true);
    }
    const removals = service.removals(game.contentWorld);
    expect(removals.find((r) => r.key === "Ruby Ring")?.inWorld).toBeGreaterThan(0);
    // Nobody holds the other one: no reason to suggest logging everyone out for it.
    expect(removals.find((r) => r.key !== "Ruby Ring")?.inWorld).toBe(0);
  });

  test("a throw in the preflight is a fault: nobody is logged out and the lock is never taken", async () => {
    const god = await make("God", "administrator");
    const al = await make("Al");
    draftSomething(god);
    service.publishPreflight = () => {
      throw new Error("check broke");
    };
    intent(god.characterId, {
      t: "contentPublish",
      seq: 1,
      summary: "",
      draftRev: service.draftRev(),
      logoutEveryone: true,
    });
    expect(faults).toEqual(["intent contentPublish from God"]);
    expect(kicked).toEqual([{ id: god.characterId, text: TEXT.serverError }]);
    expect(game.world.players.has(al.characterId)).toBe(true);
    expect(game.refusal(al.characterId, "10.0.0.9")).toBeNull();
  });
});
