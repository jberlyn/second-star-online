/**
 * Removing a vehicle with its cleanup (issues #44 and #28): where it is used (the deeds that build
 * it, the characters riding it, the parked ones), and what the publish does to them: riders land
 * where they are and parked ones become their deed, or both switch to another vehicle.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { buildContentStore, installContent, type ServerMsg } from "@secondstaronline/shared";

import { type ContentActor, ContentService } from "../src/content/service.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import type { GroundItem, Player } from "../src/systems/world/world.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

let db: Db;
let service: ContentService;
let game: Game;
let sent: { to: string; msg: ServerMsg }[];
const wall = Date.UTC(2026, 10, 25, 12, 0, 0);
let t = 0;
let ips = 0;

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
    onFault: (where, err) => {
      throw new Error(`${where}: ${String(err)}`);
    },
  });
  live = game;
});

async function make(name: string, online = true) {
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
    `10.0.3.${ips}`,
  );
  const l = await game.login(name, "pw", "10.0.0.1");
  if (!l.ok) {
    throw new Error(l.text);
  }
  if (online) {
    game.enter(l.characterId, false, "10.0.0.7");
  }
  return l;
}

/** Ann rides a Boat online, Bo rides one offline, and Ann's other Boat is parked by her. */
async function scene() {
  const god = await make("God", false);
  setRole(db, god.accountId, "administrator", new Date(wall).toISOString());
  game.enter(god.characterId, false, "10.0.0.7");
  const actor: ContentActor = { accountId: god.accountId, name: "God" };
  const ann = await make("Ann");
  const bo = await make("Bo", false);
  const a = game.world.players.get(ann.characterId) as Player;
  a.vehicle = "Boat";
  a.hull = 40;
  a.spell.body = 55;
  db.run("UPDATE characters SET vehicle = 'Boat', hull = 50 WHERE id = ?", [bo.characterId]);
  const parked: GroundItem = {
    id: "parked-1",
    item: "Ann's Boat",
    x: 3,
    y: 3,
    kind: "drop",
    expiresAt: null,
    ownerId: ann.characterId,
    hull: 12,
    parkedAt: wall,
    facing: "W",
  };
  a.map.ground.push(parked);
  // Written with the next save, as a parked vehicle is.
  game.world.groundLog.push({ mapId: a.map.id, add: parked });
  const stored = () =>
    db
      .query<{ vehicle: string | null; hull: number | null }, [string]>(
        "SELECT vehicle, hull FROM characters WHERE id = ?",
      )
      .get(bo.characterId);
  return { actor, a, stored };
}

describe("where a vehicle is used", () => {
  test("the deeds that build it, who rides it and where it is parked", async () => {
    const { a } = await scene();
    const u = service.usage("vehicle", "Boat", game.contentWorld);
    expect(u.ok).toBe(true);
    if (!u.ok) {
      return;
    }
    expect(u.value.uses.map((x) => [x.where, x.name, x.removable])).toEqual([
      ["houses/deeds/Boat Deed → vehicle", "Boat", true],
    ]);
    expect(u.value.world.map((p) => [p.place, p.count, p.holderCount])).toEqual([
      ["aboard", 2, 2],
      ["parked", 1, 1],
    ]);
    expect(u.value.world[0]?.holders.sort()).toEqual(["Ann", "Bo"]);
    expect(u.value.world[1]?.holders).toEqual([a.map.name]);
  });
});

describe("removing a vehicle", () => {
  test("land: riders stand where they were, the parked one becomes its deed, the deed row goes", async () => {
    const { actor, a, stored } = await scene();
    const r = service.draftRemoval(
      actor,
      { kind: "vehicle", key: "Boat", content: "remove", riders: "land", replacement: null },
      game.contentWorld,
    );
    expect(r).toEqual({
      ok: true,
      value: "Boat will be removed when the draft is published; 1 other row changed with it.",
    });
    expect(service.removals(game.contentWorld)).toEqual([
      {
        kind: "vehicle",
        key: "Boat",
        lines: [
          "2 characters aboard land where they are",
          "1 parked one on 1 map becomes Boat Deed where it stands",
        ],
        stillUsed: 0,
        inWorld: 3,
      },
    ]);
    const where = [a.x, a.y];
    const done = service.publish(actor, service.draftRev(), "No boats", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
    expect([a.vehicle, a.hull, a.spell.body, a.x, a.y]).toEqual([null, null, null, ...where]);
    expect(stored()).toEqual({ vehicle: null, hull: null });
    expect(a.map.ground.find((g) => g.id === "parked-1")).toMatchObject({ item: "Boat Deed" });
    expect(a.map.ground.find((g) => g.id === "parked-1")?.hull).toBeUndefined();
    const published = service.publishedContent();
    expect(published.houses.vehicles?.map((v) => v.name)).toEqual(["Battleship", "Airship"]);
    expect(published.houses.deeds.some((d) => d.deed === "Boat Deed")).toBe(false);
    expect(service.history()[0]?.cleanup).toEqual([
      "2 riders of Boat landed where they were",
      "1 parked Boat became Boat Deed",
    ]);
    // Each is an admin change in the activity log, logged as placed (a vehicle is not carried),
    // so the reconciliation sees no gap (#35).
    expect(
      game.world.activity
        .filter((e) => e.type === "admin")
        .map((e) => [e.character, e.item, e.qty, e.details?.placed ?? null])
        .sort(),
    ).toEqual(
      [
        ["Ann", "Boat", 0, -1],
        ["Bo", "Boat", 0, -1],
        [null, "Boat", -1, null],
        [null, "Boat Deed", 1, null],
      ].sort(),
    );
  });

  test("switch: riders and parked ones become another vehicle, and the deed builds it", async () => {
    const { actor, a, stored } = await scene();
    const r = service.draftRemoval(
      actor,
      {
        kind: "vehicle",
        key: "Boat",
        content: "replace",
        riders: "switch",
        replacement: "Battleship",
      },
      game.contentWorld,
    );
    expect(r.ok).toBe(true);
    const done = service.publish(actor, service.draftRev(), "Bigger boats", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
    expect([a.vehicle, a.hull, a.spell.body]).toEqual(["Battleship", 40, 56]);
    expect(stored()).toEqual({ vehicle: "Battleship", hull: 50 });
    expect(a.map.ground.find((g) => g.id === "parked-1")).toMatchObject({
      item: "Ann's Battleship",
      hull: 12,
      facing: "W",
    });
    expect(
      service.publishedContent().houses.deeds.find((d) => d.deed === "Boat Deed"),
    ).toMatchObject({ use: "vehicle", vehicle: "Battleship" });
    // A replacement that is no vehicle is refused before anything goes into the draft.
    expect(
      service.draftRemoval(
        actor,
        {
          kind: "vehicle",
          key: "Airship",
          content: "remove",
          riders: "switch",
          replacement: "Dragon",
        },
        game.contentWorld,
      ),
    ).toEqual({ ok: false, error: "There is no vehicle Dragon." });
  });
});

describe("a vehicle's removal and the item reconciliation (#35)", () => {
  for (const riders of ["land", "switch"] as const) {
    test(`${riders}: a run afterwards flags nothing, the online rider's holdings included`, async () => {
      const { actor, a } = await scene();
      a.vehicleDirty = true;
      a.invDirty = true;
      game.tick();
      const god = [...game.world.players.values()].find((p) => p.name === "God") as Player;
      const run = () => {
        sent = [];
        game.intent(god.id, { t: "reconcileRun", seq: 1 });
        const r = sent.find((x) => x.msg.t === "reconcile")?.msg;
        const latest = r?.t === "reconcile" ? r.runs[0] : undefined;
        if (!latest) {
          throw new Error("no run");
        }
        return latest;
      };
      // The scene's setup is taken in by the first run.
      run();
      const r = service.draftRemoval(
        actor,
        {
          kind: "vehicle",
          key: "Boat",
          content: riders === "land" ? "remove" : "replace",
          riders,
          replacement: riders === "switch" ? "Battleship" : null,
        },
        game.contentWorld,
      );
      expect(r.ok).toBe(true);
      const done = service.publish(actor, service.draftRev(), "", game.contentWorld);
      expect(done.ok ? "ok" : done.error).toBe("ok");
      game.tick();
      const after = run();
      expect(after.rows.filter((x) => x.difference !== 0 || x.unlogged !== 0)).toEqual([]);
      expect(after.mismatches).toBe(0);
      const unlogged = [
        ...game.world.activity.filter((e) => e.type === "unlogged"),
        ...db.query("SELECT * FROM activity_log WHERE type = 'unlogged'").all(),
      ];
      expect(unlogged).toEqual([]);
    });
  }
});

describe("a custom vehicle on real SQLite (issue #44)", () => {
  /** Publishes a Canoe: a second sea-going vehicle with its own deed, picture, rider and hull. */
  function publishCanoe(actor: ContentActor) {
    const set = (dataset: string, part: string, key: string, data: unknown) =>
      expect(service.draftSet(actor, { dataset, part, key } as never, "set", data).ok).toBe(true);
    set("items", "items", "Canoe Deed", { name: "Canoe Deed", icon: null });
    set("houses", "vehicles", "Canoe", {
      name: "Canoe",
      picture: "BoatPic",
      rider: 58,
      hull: 20,
      moves: { over: { flags: ["sea"] } },
      boards: "shore",
    });
    set("houses", "deeds", "Canoe Deed", {
      deed: "Canoe Deed",
      use: "vehicle",
      vehicle: "Canoe",
      house: null,
      text: null,
    });
    const done = service.publish(actor, service.draftRev(), "Canoes", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
  }

  const ready = (p: Player) => {
    p.itemPause = 0;
    p.stepFrames = 0;
  };

  test("built, boarded, saved and ridden again after logging back in; then switched", async () => {
    const god = await make("Godot", false);
    setRole(db, god.accountId, "administrator", new Date(wall).toISOString());
    const actor: ContentActor = { accountId: god.accountId, name: "Godot" };
    publishCanoe(actor);
    const ann = await make("Anna");
    let a = game.world.players.get(ann.characterId) as Player;
    a.loading = 0;
    // Water to her east.
    a.facing = "E";
    const row = (a.map.layers[0][a.y - 1] ?? "").split(" ");
    row[a.x] = "W1";
    a.map.layers[0][a.y - 1] = row.join(" ");
    a.char.bag[0] = { item: "Canoe Deed", qty: 1 };
    ready(a);
    game.intent(ann.characterId, { t: "use", slot: 1 });
    expect(a.map.ground.some((g) => g.item === "Anna's Canoe")).toBe(true);
    ready(a);
    game.intent(ann.characterId, { t: "action" });
    expect([a.vehicle, a.spell.body, a.hull]).toEqual(["Canoe", 58, 20]);
    game.tick();
    expect(
      db.query("SELECT vehicle, hull FROM characters WHERE id = ?").get(ann.characterId),
    ).toEqual({ vehicle: "Canoe", hull: 20 });
    game.leave(ann.characterId);
    const back = await game.login("Anna", "pw", "10.0.0.1");
    if (!back.ok) {
      throw new Error(back.text);
    }
    game.enter(back.characterId, false, "10.0.0.7");
    a = game.world.players.get(back.characterId) as Player;
    expect([a.vehicle, a.spell.body, a.hull]).toEqual(["Canoe", 58, 20]);
    // Removed with a switch to the Boat: she rides a Boat, saved.
    expect(
      service.draftRemoval(
        actor,
        {
          kind: "vehicle",
          key: "Canoe",
          content: "replace",
          riders: "switch",
          replacement: "Boat",
        },
        game.contentWorld,
      ).ok,
    ).toBe(true);
    const done = service.publish(actor, service.draftRev(), "", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
    expect([a.vehicle, a.spell.body]).toEqual(["Boat", 55]);
    game.tick();
    expect(db.query("SELECT vehicle FROM characters WHERE id = ?").get(ann.characterId)).toEqual({
      vehicle: "Boat",
    });
  });

  test("a parked vehicle on a map not loaded becomes its deed with no owner, hull or mooring", async () => {
    const { actor, a } = await scene();
    // Parked on another map, which nobody has loaded.
    const other = db
      .query<{ id: string }, [string]>("SELECT id FROM maps WHERE id != ? LIMIT 1")
      .get(a.map.id);
    if (!other) {
      throw new Error("no second map");
    }
    db.run(
      "INSERT INTO ground_items (id, map_id, x, y, item, qty, kind, expires_at, owner_id, hull, parked_at, facing, created_at) VALUES ('far-1', ?, 4, 4, 'Bo''s Boat', 1, 'drop', NULL, ?, 7, ?, 'N', ?)",
      [other.id, a.id, new Date(wall).toISOString(), new Date(wall).toISOString()],
    );
    a.vehicleDirty = true;
    a.invDirty = true;
    game.tick();
    const god = [...game.world.players.values()].find((p) => p.name === "God") as Player;
    const run = () => {
      sent = [];
      game.intent(god.id, { t: "reconcileRun", seq: 1 });
      const m = sent.find((x) => x.msg.t === "reconcile")?.msg;
      return m?.t === "reconcile" ? m.runs[0] : undefined;
    };
    run();
    const r = service.draftRemoval(
      actor,
      { kind: "vehicle", key: "Boat", content: "remove", riders: "land", replacement: null },
      game.contentWorld,
    );
    expect(r.ok).toBe(true);
    const done = service.publish(actor, service.draftRev(), "", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
    game.tick();
    const after = run();
    expect(after?.rows.filter((x) => x.difference !== 0 || x.unlogged !== 0)).toEqual([]);
    expect(after?.mismatches).toBe(0);
    expect(
      db
        .query(
          "SELECT item, qty, owner_id, hull, parked_at, facing FROM ground_items WHERE id = 'far-1'",
        )
        .get(),
    ).toEqual({
      item: "Boat Deed",
      qty: 1,
      owner_id: null,
      hull: null,
      parked_at: null,
      facing: null,
    });
  });
});

describe("a vehicle's row gone while it is ridden (issue #44)", () => {
  test("an online rider lands at the next tick, logged and saved", async () => {
    const { a } = await scene();
    const without = structuredClone(service.publishedContent());
    without.houses.vehicles = without.houses.vehicles?.filter((v) => v.name !== "Boat");
    without.houses.deeds = without.houses.deeds.filter((d) => d.deed !== "Boat Deed");
    installContent(buildContentStore(without));
    try {
      game.tick();
      expect([a.vehicle, a.hull, a.spell.body]).toEqual([null, null, null]);
      expect(
        game.world.activity.find((e) => e.character === "Ann" && e.type === "admin") ??
          db
            .query("SELECT item, qty FROM activity_log WHERE character = 'Ann' AND type = 'admin'")
            .get(),
      ).toMatchObject({ item: "Boat", qty: 0 });
      game.tick();
      expect(db.query("SELECT vehicle, hull FROM characters WHERE id = ?").get(a.id)).toEqual({
        vehicle: null,
        hull: null,
      });
    } finally {
      installContent(service.store());
    }
  });
});

describe("the vehicles' art and removal checks", () => {
  test("with no upload library, a vehicle's picture and walking frames are checked against the packs' art", async () => {
    const { actor } = await scene();
    const row = (picture: string, rider: number) => ({
      name: "Canoe",
      picture,
      rider,
      hull: 20,
      moves: { over: { flags: ["sea"] } },
      boards: "shore",
    });
    const ref = { dataset: "houses", part: "vehicles", key: "Canoe" } as const;
    expect(service.draftSet(actor, ref, "set", row("NoSuchPic", 4000)).ok).toBe(true);
    const refused = service.publish(actor, service.draftRev(), "", game.contentWorld);
    expect(refused.ok ? [] : (refused.problems ?? []).map((p) => p.message)).toEqual(
      expect.arrayContaining([
        "the parked picture NoSuchPic has no art",
        expect.stringContaining("the rider body 4000 is missing f1-n"),
      ]),
    );
    expect(service.draftSet(actor, ref, "set", row("BoatPic", 58)).ok).toBe(true);
    const done = service.publish(actor, service.draftRev(), "", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
  });

  test("a removal that lands parked ones as their deed needs the deed item to stay", async () => {
    const { actor } = await scene();
    expect(
      service.draftRemoval(
        actor,
        { kind: "vehicle", key: "Boat", content: "remove", riders: "land", replacement: null },
        game.contentWorld,
      ).ok,
    ).toBe(true);
    expect(
      service.draftSet(actor, { dataset: "items", part: "items", key: "Boat Deed" }, "remove", null)
        .ok,
    ).toBe(true);
    const refused = service.publish(actor, service.draftRev(), "", game.contentWorld);
    expect(refused.ok ? [] : (refused.problems ?? []).map((p) => p.message)).toContain(
      "its parked ones become Boat Deed, which the draft no longer has",
    );
  });
});
