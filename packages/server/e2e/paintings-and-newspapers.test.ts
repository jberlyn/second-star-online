/**
 * Bot script: paintings, photos and newspapers.
 *
 * Alice, holding a Canvas, a Camera, a Film and a Newspaper Kit, paints (a valid 64×64 PNG, sent as
 * a 16 KB frame the gateway allows only while she holds a canvas) and gets `Painting#<id>`, drops
 * it; Bob, in front of it, clicks it on the ground and sees "Author: Alice" and the picture. Alice equips the Camera,
 * uses Film and saves a photo. King, an immortal, saves a newspaper whose photo 1 is Alice's
 * painting and stands `King's Newspaper` on the map by hand (a Kit works only on a `K2` tile, which
 * no shipped map has); Bob, in front of it, reads it with photo 1 and two hidden slots. Alice's Kit off a `K2` tile
 * is refused. Dave, holding nothing, is closed for sending an art-sized frame.
 *
 * The bags are filled through the world (the pickup path is not what this test is about).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { CLOSE, type CreateMsg, type ServerMsg } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import type { Db } from "../src/persistence/database.ts";
import type { Rng } from "../src/rng.ts";
import { b64, makePng } from "../tests/helpers/png.ts";
import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

const make = (name: string): CreateMsg => ({
  t: "create",
  name,
  password: "secret",
  sex: 1,
  head: 1,
  classCode: 1,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
});

// `random(n)` is n, except the art ids, which count up from 500 so each save gets its own.
let artSeq = 500;
const rng: Rng = { random: (n) => (n === 9_999_999 ? ++artSeq : n >= 1 ? n : 0) };

const idOf = (db: Db, name: string) =>
  (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;
function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}
const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const msgsOf = <T extends ServerMsg["t"]>(bot: Bot, t: T) =>
  bot.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

const PNG = makePng(64, 64, { noise: 3 });

describe("paintings, photos and newspapers", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let king: Bot;
  let seq = 0;

  const tick = async (n: number) => {
    await settle();
    server.clock.advance(Math.ceil(n * 50));
    server.tickNow(n);
    await settle();
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m: ServerMsg) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const step = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: false });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(20);
    bot.send({ t: "mapReady" });
    await tick(1);
  };
  const turn = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: true });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(2);
  };
  const who = (name: string) => {
    const p = [...server.game.world.players.values()].find((x) => x.name === name);
    if (!p) {
      throw new Error(`${name} is not in`);
    }
    return p;
  };
  const bagSlot = (name: string, item: string) =>
    who(name).char.bag.findIndex((l) => l?.item.toLowerCase().startsWith(item.toLowerCase())) + 1;
  const groundOf = (name: string, item: string) =>
    who(name).map.ground.find((g) => g.item === item)?.id ?? "";

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "King", "Dave"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 12, 9);
    place(db, "Bob", 11, 7);
    place(db, "King", 12, 6);
    place(db, "Dave", 4, 8);
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(idOf(db, "King"));
    setRole(db, acc?.account_id ?? "", "immortal", "2026-11-07T00:00:00.000Z");
    alice = await login("Alice");
    bob = await login("Bob");
    king = await login("King");
    const a = who("Alice");
    ["Canvas", "Camera", "Film", "Newspaper Kit"].forEach((item, i) => {
      a.char.bag[i] = { item, qty: 1 };
    });
    a.invDirty = true;
  });

  afterAll(() => {
    for (const b of [alice, bob, king]) {
      b?.close();
    }
    server?.stop();
  });

  test("Alice uses the Canvas, paints and saves; Painting#<id> arrives in her bag", async () => {
    alice.clear();
    alice.send({ t: "use", slot: bagSlot("Alice", "Canvas") });
    await settle();
    expect(msgsOf(alice, "paint")).toEqual([{ t: "paint", reopen: false }]);
    expect(who("Alice").keyLock).toBe(true);
    alice.clear();
    // 16 KB of base64 in one frame: allowed only because she holds a canvas.
    alice.send({ t: "artSave", kind: "painting", png: b64(PNG) });
    await settle();
    expect(msgsOf(alice, "artSaved")).toEqual([{ t: "artSaved", kind: "painting" }]);
    expect(who("Alice").keyLock).toBe(false);
    expect(bagSlot("Alice", "Painting#")).toBeGreaterThan(0);
    const row = server.db
      .query<{ author: string; kind: string }, []>("SELECT author, kind FROM art")
      .get();
    expect(row).toEqual({ author: "Alice", kind: "painting" });
  });

  test("a second save from the same canvas is ignored", async () => {
    alice.clear();
    alice.send({ t: "artSave", kind: "painting", png: b64(PNG) });
    await settle();
    expect(msgsOf(alice, "artSaved")).toEqual([]);
    const n = server.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM art").get();
    expect(n?.n).toBe(1);
  });

  test("Alice drops the painting; Bob, in front of it, clicks it and sees Author: Alice", async () => {
    await turn(alice, "U");
    alice.send({ t: "drop", slot: bagSlot("Alice", "Painting#") });
    await tick(30);
    const name = who("Alice").map.ground.find((g) => g.item.startsWith("Painting#"))?.item ?? "";
    expect(name).toMatch(/^Painting#\d+$/);
    // From (11, 7) it is out of reach; from (11, 8), facing it at (12, 8), it opens.
    bob.clear();
    bob.send({ t: "pickup", id: groundOf("Bob", name) });
    await settle();
    expect(lines(bob)).toEqual([
      "You see the Painting, but you must be standing in front of it to view it.",
    ]);
    await step(bob, "D");
    await turn(bob, "R");
    bob.clear();
    bob.send({ t: "pickup", id: groundOf("Bob", name) });
    await settle();
    expect(lines(bob)).toEqual(["You view the Painting, please wait..."]);
    const art = msgsOf(bob, "art")[0];
    expect(art?.author).toBe("Alice");
    expect(art?.png).toBe(b64(PNG));
    expect(who("Bob").keyLock).toBe(true);
    bob.send({ t: "viewClose" });
    await settle();
    expect(who("Bob").keyLock).toBe(false);
  });

  test("Alice equips the Camera, uses Film and saves a photo", async () => {
    await tick(30);
    alice.clear();
    alice.send({ t: "use", slot: bagSlot("Alice", "Film") });
    await settle();
    expect(lines(alice)).toEqual(["You must equip a camera to take a picture!"]);
    alice.send({ t: "equip", slot: bagSlot("Alice", "Camera") });
    await settle();
    alice.clear();
    alice.send({ t: "use", slot: bagSlot("Alice", "Film") });
    await settle();
    expect(msgsOf(alice, "lens")).toEqual([{ t: "lens" }]);
    alice.send({ t: "artSave", kind: "photo", png: b64(PNG) });
    await settle();
    expect(msgsOf(alice, "artSaved")).toEqual([{ t: "artSaved", kind: "photo" }]);
    expect(bagSlot("Alice", "Photo#")).toBeGreaterThan(0);
  });

  test("King saves a newspaper with Alice's painting as photo 1; Bob reads the stand", async () => {
    const id = server.db
      .query<{ id: number }, []>("SELECT id FROM art WHERE kind = 'painting'")
      .get()?.id;
    king.send({ t: "newspaperLoad" });
    await settle();
    expect(msgsOf(king, "newspaperEdit")[0]).toMatchObject({ photos: ["", "", ""] });
    king.send({
      t: "newspaperSave",
      photos: [String(id), "Photo Number", ""],
      texts: ["The Daily Star", "Vol 1", "Body", "Left", "Right", "Footer"],
    });
    await settle();
    // Bob's save writes his own paper, not King's.
    bob.send({
      t: "newspaperSave",
      photos: ["", "", ""],
      texts: ["x", "x", "x", "x", "x", "x"],
    });
    await settle();
    // The stand goes on the tile above Bob, at (11, 7), and he turns to face it.
    who("King").map.ground.push({
      id: crypto.randomUUID(),
      item: "King's Newspaper",
      x: 11,
      y: 7,
      kind: "admin",
      expiresAt: null,
    });
    await turn(bob, "U");
    await tick(30);
    bob.clear();
    bob.send({ t: "pickup", id: groundOf("Bob", "King's Newspaper") });
    await settle();
    expect(lines(bob)).toEqual(["You view the newspaper"]);
    const paper = msgsOf(bob, "newspaper")[0];
    expect(paper?.texts).toEqual(["The Daily Star", "Vol 1", "Body", "Left", "Right", "Footer"]);
    expect(paper?.photos).toEqual([b64(PNG), null, null]);
  });

  test("Alice's Kit on a tile that is not K2 is refused and kept", async () => {
    await tick(430); // Use Film's 425-frame pause
    await turn(alice, "L"); // the painting lies on the tile above her
    alice.clear();
    alice.send({ t: "drop", slot: bagSlot("Alice", "Newspaper Kit") });
    await settle();
    expect(lines(alice)).toEqual(["You can't put a newspaper stand here!"]);
    expect(bagSlot("Alice", "Newspaper Kit")).toBeGreaterThan(0);
  });

  test("a player with no canvas or film who sends art-sized frames is struck and closed (gateway allowance)", async () => {
    const dave = await login("Dave");
    // Every frame is struck (over 1 KB, no credit); past 50 strikes the connection is closed.
    // The clock moves between batches so the flood limit does not close it first.
    for (let batch = 0; batch < 4; batch++) {
      for (let i = 0; i < 15; i++) {
        dave.send({ t: "artSave", kind: "painting", png: "A".repeat(20_000) });
      }
      await settle();
      server.clock.advance(10_000);
    }
    const closed = await Promise.race([
      dave.closed,
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    expect(closed?.code).toBe(CLOSE.badMessage.code);
  });
});
