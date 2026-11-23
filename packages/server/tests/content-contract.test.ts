/**
 * The core content contract (issue #37 stage 2): a world needs a currency item, a start class, a
 * skill, and start, fallback and jail points that can hold a player. A publish that breaks it is
 * refused; the bindings' items are references like any other.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import type { ContentData } from "@secondstaronline/shared";

import { cleanUses, usesOf } from "../src/content/cleanup.ts";
import {
  type ContractPoint,
  contractProblems,
  type MapPoint,
  pointProblem,
  pointProblems,
} from "../src/content/contract.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { referencesOf } from "../src/content/validate.ts";
import { upsertContentRow } from "../src/persistence/content.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import type { WorldMap } from "../src/systems/world/world.ts";
import { testMap } from "./helpers/sim.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

const changed = (change: (d: ContentData) => void): ContentData => {
  const d = structuredClone(classicData) as ContentData;
  change(d);
  return d;
};

const messages = (d: ContentData) => contractProblems(d).map((p) => `${p.where}: ${p.message}`);

describe("the content contract", () => {
  test("Classic meets it", () => {
    expect(contractProblems(classicData)).toEqual([]);
  });

  test("a world needs a currency item that exists, is live and is spelled as its key", () => {
    expect(messages(changed((d) => (d.bindings.currency = {})))).toEqual([
      "bindings/currency: the world needs a currency: bind an item as its item",
    ]);
    expect(messages(changed((d) => (d.bindings.currency = { item: "Doubloon" })))).toEqual([
      "bindings/currency: the currency must be an item that exists and is not retired: Doubloon",
    ]);
    const retired = changed((d) => {
      const gold = d.items.items.find((i) => i.name === "Gold");
      if (gold) {
        gold.retired = true;
      }
    });
    expect(messages(retired)).toEqual([
      "bindings/currency: the currency must be an item that exists and is not retired: Gold",
    ]);
    expect(messages(changed((d) => (d.bindings.currency = { item: "gold" })))).toEqual([
      "bindings/currency: spell the currency exactly as its item's key: Gold",
    ]);
  });

  test("a world needs a start class and a skill", () => {
    expect(messages(changed((d) => (d.classes.startClasses = [])))).toEqual([
      "classes/startClasses: the world needs at least one start class",
    ]);
    expect(messages(changed((d) => (d.classes.skills = [])))).toContain(
      "classes/skills: the world needs at least one skill",
    );
  });

  test("each rider has its own body, and no spell puts a rider's body on a player", () => {
    expect(
      messages(
        changed((d) => (d.bindings.bodies.riders = { Boat: 55, Battleship: 55, Airship: 57 })),
      ),
    ).toEqual([
      "bindings/bodies: the Boat and the Battleship riders need different bodies (both are 55)",
    ]);
    expect(
      messages(
        changed((d) => {
          d.bindings.bodies.tree = 57;
          d.bindings.bodies.smoke = 57;
          d.bindings.bodies.morph = [{ above: 0, body: 56 }];
        }),
      ),
    ).toEqual([
      "bindings/bodies: tree is the Airship rider's body (57): give it another",
      "bindings/bodies: smoke is the Airship rider's body (57): give it another",
      "bindings/bodies: morph[0] is the Battleship rider's body (56): give it another",
      "bindings/bodies: the smoke and the tree need different bodies (both are 57)",
    ]);
    // A morph shown as the smoke would hide its player; as the tree, it would read as a tree.
    expect(
      messages(
        changed(
          (d) =>
            (d.bindings.bodies.morph = [
              { above: 0, body: 100 },
              { above: 9, body: 80 },
            ]),
        ),
      ),
    ).toEqual([
      "bindings/bodies: morph[0] is the smoke's body (100): give it another",
      "bindings/bodies: morph[1] is the tree's body (80): give it another",
    ]);
  });
});

describe("the contract's points", () => {
  // A tree at (3, 3), a Fire Pot (which blocks the way) at (4, 4).
  const grass: WorldMap = testMap("x1y1", [[3, 3]]);
  grass.ground = [{ id: "g1", item: "Fire Pot", x: 4, y: 4, kind: "admin", expiresAt: null }];
  const maps = (name: string) => (name === "x1y1" ? grass : null);
  const at = (x: number, y: number, map = "x1y1"): MapPoint => ({ map, x, y });

  test("a point needs a map that exists, a walkable tile and nothing in the way", () => {
    expect(pointProblem(at(5, 5), maps)).toBeNull();
    expect(pointProblem(at(5, 5, "x9y9"), maps)).toBe("x9y9 does not exist");
    expect(pointProblem(at(3, 3), maps)).toBe("x1y1 (3, 3) is not a walkable tile");
    expect(pointProblem(at(4, 4), maps)).toBe("x1y1 (4, 4) is blocked by Fire Pot");
    // A platform a new character cannot pass blocks too (level 21 for the Experience Platform).
    grass.ground.push({
      id: "g2",
      item: "Experience Platform",
      x: 6,
      y: 6,
      kind: "admin",
      expiresAt: null,
    });
    expect(pointProblem(at(6, 6), maps)).toBe("x1y1 (6, 6) is blocked by Experience Platform");
  });

  test("the start, fallback and jail points are each named", () => {
    const points: Record<ContractPoint, MapPoint> = {
      startPoint: at(5, 5),
      fallbackPoint: at(3, 3),
      jailPoint: at(4, 4, "x0y0"),
    };
    expect(pointProblems(points, maps)).toEqual([
      {
        where: "settings/fallbackPoint",
        message: "Fallback map: x1y1 (3, 3) is not a walkable tile",
      },
      { where: "settings/jailPoint", message: "Jail: x0y0 does not exist" },
    ]);
  });
});

describe("publishing", () => {
  const setup = (points?: () => { where: string; message: string }[]) => {
    const db = openDatabase();
    migrate(db);
    let t = 0;
    const service = new ContentService({
      db,
      now: () => new Date(Date.UTC(2026, 10, 23, 0, 0, t++)).toISOString(),
      releasePacks: RELEASE_PACK_DIRS,
      ...(points ? { points } : {}),
    });
    return service;
  };
  const currency = { dataset: "bindings" as const, part: "currency", key: null };

  test("a draft that breaks the contract is refused", () => {
    const service = setup();
    service.draftSet(ADMIN, currency, "set", {});
    // Named first; Classic's treasures and drops (`300 Gold`) now name an item too.
    const problems = service.check();
    expect(problems[0]).toEqual({
      where: "bindings/currency",
      message: "the world needs a currency: bind an item as its item",
    });
    expect(problems.map((p) => p.message)).toContain(
      "names an item that does not exist (or is retired): 300 Gold",
    );
    expect(service.publish(ADMIN, service.draftRev(), "No money").ok).toBe(false);
    service.draftSet(ADMIN, currency, "set", { item: "gold" });
    expect(service.check()).toEqual([
      {
        where: "bindings/currency",
        message: "spell the currency exactly as its item's key: Gold",
      },
    ]);
    // Removing the start bag's Apple and binding no cannon ammo meet the contract.
    service.draftSet(ADMIN, currency, "set", { item: "Gold" });
    service.draftSet(ADMIN, { dataset: "bindings", part: "cannon", key: null }, "set", {});
    service.draftSet(ADMIN, { dataset: "bindings", part: "start", key: null }, "set", {
      hp: 30,
      sp: 5,
      bag: [{ item: "Knife", qty: 1 }],
    });
    expect(service.check()).toEqual([]);
    expect(service.publish(ADMIN, service.draftRev(), "Leaner start").ok).toBe(true);
    expect(service.publishedContent().bindings.start.hp).toBe(30);
  });

  test("an undo that would break the contract is refused", () => {
    // The jail stands on a tile code Classic does not walk on, Z9; a publish makes it walkable.
    const jail = testMap("x0y0", [], (x, y) => (x === 4 && y === 4 ? "Z9" : "G1"));
    const points = () =>
      pointProblems(
        {
          startPoint: { map: "x0y0", x: 5, y: 5 },
          fallbackPoint: { map: "x0y0", x: 5, y: 5 },
          jailPoint: { map: "x0y0", x: 4, y: 4 },
        },
        (name) => (name === "x0y0" ? jail : null),
      );
    const service = setup(points);
    const walkable = { dataset: "tiles" as const, part: "walkable", key: null };
    service.draftSet(ADMIN, walkable, "set", [
      ...service.publishedContent().tiles.walkable,
      { code: "Z9" },
    ]);
    const made = service.publish(ADMIN, service.draftRev(), "Z9 is floor");
    expect(made.ok).toBe(true);
    // Undoing it would leave the jail on a tile nobody can stand on.
    expect(service.undo(ADMIN, made.ok ? made.value.id : "")).toMatchObject({
      ok: false,
      problems: [
        { where: "settings/jailPoint", message: "Jail: x0y0 (4, 4) is not a walkable tile" },
      ],
    });
  });

  test("the points are judged with the next content's tiles", () => {
    // The jail stands on G1 grass; a draft that takes G1 off the walkable list strands it.
    const jail = testMap("x0y0");
    const service = setup(() =>
      pointProblems(
        { startPoint: at(5, 5), fallbackPoint: at(5, 5), jailPoint: at(4, 4) },
        (name) => (name === "x0y0" ? jail : null),
      ),
    );
    function at(x: number, y: number): MapPoint {
      return { map: "x0y0", x, y };
    }
    expect(service.check()).toEqual([]);
    const tiles = { dataset: "tiles" as const, part: "walkable", key: null };
    const walkable = service.publishedContent().tiles.walkable.filter((t) => t.code !== "G1");
    service.draftSet(ADMIN, tiles, "set", walkable);
    expect(service.check().map((p) => `${p.where}: ${p.message}`)).toEqual([
      "settings/startPoint: Starting map: x0y0 (5, 5) is not a walkable tile",
      "settings/fallbackPoint: Fallback map: x0y0 (5, 5) is not a walkable tile",
      "settings/jailPoint: Jail: x0y0 (4, 4) is not a walkable tile",
    ]);
    expect(service.publish(ADMIN, service.draftRev(), "").ok).toBe(false);
  });

  test("a contract broken from the start is named, and the server still starts", () => {
    const db = openDatabase();
    migrate(db);
    // As a database edit (or an older release's publish) could have left it.
    upsertContentRow(db, {
      dataset: "bindings",
      part: "currency",
      key: null,
      op: "set",
      data: {},
      baseHash: null,
      baseData: null,
      updatedBy: "x",
      updatedAt: "x",
    });
    const lines: string[] = [];
    const service = new ContentService({
      db,
      now: () => "x",
      releasePacks: RELEASE_PACK_DIRS,
      log: (l) => lines.push(l),
    });
    expect(service.publishedContent().bindings.currency).toEqual({});
    expect(lines).toContain(
      "content: bindings/currency: the world needs a currency: bind an item as its item (the world does not meet the content contract)",
    );
  });
});

describe("the bindings' items are references", () => {
  test("treasure rows and Assassin prizes read `<n> <currency>` as a pile of this content's currency", () => {
    const coin = changed((d) => {
      d.items.items.push({ name: "Coin", icon: null });
      d.bindings.currency = { item: "Coin" };
      d.social.assassin.prizes.archived = "Long Sword:1000 Coin:500 Gold:Knife";
      d.gather.gathering.treasure.items = ["300 Coin", "300 Gold"];
    });
    const named = referencesOf(coin)
      .filter((r) => r.where === "social/assassin" || r.where === "gather/gathering")
      .map((r) => r.name)
      .filter((n) => /Coin|Gold/.test(n));
    expect(named).toEqual(["300 Gold", "500 Gold"]);
  });

  test("removing an item the start bag or the cannon names drops it there; the currency is replaced", () => {
    const apple = usesOf(classicData, "item", "Apple").filter((u) => u.where === "bindings/start");
    expect(apple.map((u) => u.path)).toEqual([["bag", 0, "item"]]);
    const cleaned = cleanUses(classicData, apple, "remove");
    expect(cleaned.rows.map((r) => r.data)).toEqual([
      { hp: 20, sp: 20, bag: [{ item: "Knife", qty: 1 }] },
    ]);
    const ammo = usesOf(classicData, "item", "Cannonball").filter(
      (u) => u.where === "bindings/cannon",
    );
    expect(cleanUses(classicData, ammo, "remove").rows.map((r) => r.data)).toEqual([{}]);
    const gold = usesOf(classicData, "item", "Gold").filter((u) => u.where === "bindings/currency");
    expect(gold.map((u) => u.drop)).toEqual([null]);
    expect(cleanUses(classicData, gold, "remove").left).toHaveLength(1);
    expect(cleanUses(classicData, gold, "replace", "Shell").rows.map((r) => r.data)).toEqual([
      { item: "Shell" },
    ]);
  });
});
