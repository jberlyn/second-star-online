/**
 * World events as content (issue #3): an operator builds a contest of their own on the World Events
 * page (a counter, an offering and a counter perk) and publishes it; the publish checks the names it
 * uses, the live counters follow the store, and the offering plays.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { Offering, WorldCounter } from "@secondstaronline/data";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { type ContentData, installContent, type ServerMsg } from "@secondstaronline/shared";

import { type ContentActor, ContentService } from "../src/content/service.ts";
import { classProblems, eventProblems } from "../src/content/validate.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { loadCounters } from "../src/persistence/counters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import type { Player } from "../src/systems/world/world.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

let db: Db;
let service: ContentService;
let game: Game;
let sent: { to: string; msg: ServerMsg }[];
const wall = Date.UTC(2026, 10, 27, 12, 0, 0);
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
    onPublish: (store, restoring) => {
      installContent(store);
      live?.contentPublished(store.hash, restoring);
    },
    classesInUse: () => live?.classesInUse() ?? new Map(),
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

async function make(name: string) {
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
  return l;
}

async function admin(): Promise<ContentActor> {
  const god = await make("God");
  setRole(db, god.accountId, "administrator", new Date(wall).toISOString());
  return { accountId: god.accountId, name: "God" };
}

const WELL: WorldCounter = { name: "Wishes", start: 0, min: 0, max: 3 };
const COIN: Offering = {
  name: "Apple in the fountain",
  item: "Apple",
  onto: "Fountain",
  checks: [{ counter: "Wishes", atMost: 2, refusal: "The fountain is full of apples." }],
  changes: [{ counter: "Wishes", add: 1 }],
  message: "The {item} sinks into the {onto}.",
  announce: [{ text: "{player} made a wish." }],
};

function draft(actor: ContentActor, part: "counters" | "offerings", key: string, row: unknown) {
  const r = service.draftSet(actor, { dataset: "events", part, key }, "set", row);
  expect(r.ok ? "ok" : r.error).toBe("ok");
}

describe("an operator's world event", () => {
  test("design change: a counter and an offering drafted on the World Events page play once published", async () => {
    const actor = await admin();
    draft(actor, "counters", "Wishes", WELL);
    draft(actor, "offerings", COIN.name, COIN);
    const done = service.publish(
      actor,
      service.draftRev(),
      "A wishing fountain",
      game.contentWorld,
    );
    expect(done.ok ? "ok" : done.error).toBe("ok");
    // The new counter starts at its start, and is saved.
    expect(game.world.counters.Wishes).toBe(0);
    game.tick();
    expect(loadCounters(db).Wishes).toBe(0);
    // Ann drops an Apple facing a placed Fountain.
    const ann = await make("Ann");
    game.enter(ann.characterId, false, "10.0.0.7");
    game.intent(ann.characterId, { t: "mapReady" });
    const a = game.world.players.get(ann.characterId) as Player;
    a.facing = "E";
    a.map.ground.push({
      id: "f",
      item: "Fountain",
      x: a.x + 1,
      y: a.y,
      kind: "admin",
      expiresAt: null,
    });
    a.char.bag[0] = { item: "Apple", qty: 1 };
    sent.length = 0;
    game.intent(ann.characterId, { t: "drop", slot: 1 });
    const said = sent.flatMap((m) =>
      m.to === ann.characterId && m.msg.t === "chat" ? [m.msg.text] : [],
    );
    expect(said).toEqual(["The Apple sinks into the Fountain.", "Ann made a wish."]);
    expect(game.world.counters.Wishes).toBe(1);
    expect(loadCounters(db).Wishes).toBe(1);
  });

  test("design change: narrowing a counter's bounds brings its live value inside them at the publish", async () => {
    const actor = await admin();
    game.world.counters = { ...game.world.counters, Fire: 90 };
    const fire = service.publishedContent().events.counters.find((c) => c.name === "Fire");
    draft(actor, "counters", "Fire", { ...fire, max: 50 });
    const done = service.publish(actor, service.draftRev(), "A lower ceiling", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
    expect(game.world.counters.Fire).toBe(50);
    game.tick();
    expect(loadCounters(db).Fire).toBe(50);
  });

  test("the publish refuses an offering whose item does not exist", async () => {
    const actor = await admin();
    draft(actor, "offerings", "Ghost", {
      ...COIN,
      name: "Ghost",
      item: "Ghost Apple",
      checks: [],
      changes: [],
    });
    const done = service.publish(actor, service.draftRev(), "A ghost", game.contentWorld);
    expect(done.ok).toBe(false);
    expect(
      service
        .check()
        .map((p) => p.message)
        .join("\n"),
    ).toContain("Ghost Apple");
  });
});

describe("the publish checks", () => {
  test("every counter an offering or perk names must exist, and every class by code", () => {
    const d = structuredClone(service.publishedContent()) as ContentData;
    expect(eventProblems(d)).toEqual([]);
    expect(classProblems(d)).toEqual([]);
    d.events.offerings.push({ ...COIN, announce: [{ text: "x", classes: [997] }] });
    d.events.perks.push({
      name: "Ghostly",
      counter: "Ghosts",
      kind: "melee",
      classes: [998],
      from: 0,
      every: 1,
      value: 1,
    });
    expect(eventProblems(d).map((p) => [p.where, p.message])).toEqual([
      [
        "events/offerings/Apple in the fountain",
        "names the counter Wishes, which is not a counter: add it on the Counters tab or pick one there",
      ],
      [
        "events/offerings/Apple in the fountain",
        "names the counter Wishes, which is not a counter: add it on the Counters tab or pick one there",
      ],
      [
        "events/perks/Ghostly",
        "names the counter Ghosts, which is not a counter: add it on the Counters tab or pick one there",
      ],
    ]);
    expect(classProblems(d).map((p) => p.message)).toEqual([
      "is announced to class 997, which is not a class: pick from the Classes tab's list",
      "is only for class 998, which is not a class: pick from the Classes tab's list",
    ]);
  });
});
