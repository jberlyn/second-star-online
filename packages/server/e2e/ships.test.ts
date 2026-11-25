/**
 * Bot script: Alice, an administrator, paints a strait of water (row 5, columns 7-14) through the
 * World page's save. Bob builds a Boat from the north shore and boards it; Alice builds a
 * Battleship from the west shore and boards it (body 56 for Bob). She sails at walking pace, is
 * stopped by the land and refused a drop "into the ocean", then fires her cannon east down the
 * strait: each shot spends a Cannonball, plays as `CannonballShotR` from her ship, and takes 16 off
 * Bob's hull. The fourth sinks him and everyone reads the line. With no Cannonballs left the cannon
 * says so. She sails back, gets off onto the shore (the ship parks on the water), boards again and
 * logs back in still aboard.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  type CreateMsg,
  cannonReloadFrames,
  type EditorMap,
  type ServerMsg,
} from "@secondstaronline/shared";

import type { Rng } from "../src/rng.ts";
import {
  type Bot,
  chats,
  connectBot,
  deltas,
  face,
  idOf,
  lastInv,
  pageMap,
  pageSave,
  settle,
  startTestServer,
  type TestServer,
  tick as tickOn,
} from "./harness.ts";

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

/** No spawns, moves, attacks or pushes; every cannonball rolls the top of random(3), 16. */
const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;
const isSnapshot = (m: ServerMsg): m is Snapshot => m.t === "snapshot";

/** Bag slot (1-based) the deed and the Cannonballs are put in before login. */
const DEED_SLOT = 10;
const BALL_SLOT = 11;

describe("Boats and Battleships", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let seq = 0;

  const tick = (n: number) => tickOn(server, n);
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const step = (bot: Bot, dir: "L" | "R" | "U" | "D", turn = false) =>
    bot.send({ t: "step", seq: ++seq, dir, turn });
  /** A press of the attack key, released a tick later. */
  const fire = async () => {
    alice.send({ t: "attack", seq: ++seq, held: true });
    await tick(1);
    alice.send({ t: "attack", seq: ++seq, held: false });
    await tick(1);
  };
  const balls = () => lastInv(alice)?.bag.find((l) => l?.item === "Cannonball")?.qty ?? 0;
  const hullOf = (bot: Bot) =>
    bot.inbox.flatMap((m) => (m.t === "vitals" ? [m.vitals.hull?.hp ?? null] : [])).at(-1);
  const vehicleOf = (name: string) =>
    server.db
      .query<{ vehicle: string | null }, [string]>("SELECT vehicle FROM characters WHERE name = ?")
      .get(name)?.vehicle ?? null;

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    server.db.run(
      "UPDATE accounts SET role = 'administrator' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    server.db.run("UPDATE characters SET x = 6, y = 5 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 13, y = 4 WHERE name = 'Bob'");
    const give = (name: string, slot: number, item: string, qty: number) =>
      server.db.run(
        "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
        [`${name}-${slot}`, idOf(server.db, name), slot, item, qty],
      );
    give("Alice", DEED_SLOT, "Battleship Deed", 1);
    give("Alice", BALL_SLOT, "Cannonball", 4);
    give("Bob", DEED_SLOT, "Boat Deed", 1);
  });
  afterAll(async () => {
    await server.stop();
  });

  test("a strait of water is painted through the World page's save: row 5, columns 7-14", async () => {
    alice = await login("Alice");
    face(server, "Alice", "E"); // staging: 1.6 logs in facing south
    bob = await login("Bob");
    face(server, "Bob", "S");
    const { map: m, revision } = await pageMap(alice, { mx: 1000, my: 992 });
    const row = (m.layers[0][4] ?? "").split(" ");
    for (let x = 7; x <= 14; x++) {
      row[x - 1] = "W1";
    }
    m.layers[0][4] = row.join(" ");
    await pageSave(alice, m, revision);
    alice.send({ t: "editClose" });
    await alice.waitFor(isSnapshot);
    alice.send({ t: "mapReady" });
    await settle();
    face(server, "Alice", "E");
  });

  test("Bob builds his Boat on the water he faces and boards it: body 55, a hull of 60", async () => {
    bob.clear();
    bob.send({ t: "use", slot: DEED_SLOT });
    await tick(1);
    const gadd = deltas(bob).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(gadd.map((g) => [g.name, g.x, g.y])).toEqual([["Bob's Boat", 13, 5]]);
    await tick(41); // the 40-frame item pause
    alice.clear();
    bob.clear();
    bob.send({ t: "action" });
    await tick(1);
    expect(chats(bob)).toContain("You board your boat...");
    expect(deltas(alice)).toContainEqual({ e: "body", id: idOf(server.db, "Bob"), body: 55 });
    expect(hullOf(bob)).toBe(60);
  });

  test("Alice builds her Battleship and boards it: body 56, a hull of 150", async () => {
    alice.send({ t: "use", slot: DEED_SLOT });
    await tick(1);
    await tick(41);
    alice.clear();
    bob.clear();
    alice.send({ t: "action" });
    await tick(1);
    expect(chats(alice)).toContain("You board your battleship...");
    expect(deltas(bob)).toContainEqual({ e: "body", id: idOf(server.db, "Alice"), body: 56 });
    expect(hullOf(alice)).toBe(150);
    expect(vehicleOf("Alice")).toBe("Battleship");
  });

  test("she sails at walking pace on the water, and the land stops her", async () => {
    bob.clear();
    step(alice, "R");
    await tick(1);
    const moves = deltas(bob).flatMap((e) => (e.e === "move" ? [e] : []));
    expect(moves.map((mv) => [mv.toX, mv.toY, mv.frames])).toEqual([[8, 5, 16]]);
    await tick(16);
    bob.clear();
    step(alice, "U"); // (8,4) is grass
    await tick(17);
    expect(deltas(bob).filter((e) => e.e === "move")).toEqual([]);
  });

  test("a drop is refused: into the ocean", async () => {
    await tick(41); // the boarding's item pause
    alice.clear();
    alice.send({ t: "drop", slot: 1 }); // the starting Apple
    await tick(1);
    expect(chats(alice)).toContain("You can't drop this into the ocean!");
  });

  test("the cannon fires east down the strait, spends a Cannonball and takes 16 off Bob's hull", async () => {
    step(alice, "R", true); // face east, down the strait
    await tick(1);
    alice.clear();
    bob.clear();
    await fire();
    const fx = deltas(bob).find((e) => e.e === "fx");
    expect(fx).toMatchObject({
      e: "fx",
      name: "CannonballShotR",
      caster: idOf(server.db, "Alice"),
    });
    expect(balls()).toBe(3);
    await tick(20); // five tiles at 10 px a frame
    expect(deltas(alice)).toContainEqual(expect.objectContaining({ e: "fxend" }));
    expect(deltas(alice)).toContainEqual(
      expect.objectContaining({ e: "phit", id: idOf(server.db, "Bob"), text: "16" }),
    );
    expect(hullOf(bob)).toBe(44);
  });

  test("a press during the reload fires nothing", async () => {
    await fire();
    expect(balls()).toBe(3);
  });

  test("three more shots sink the Boat, and everyone reads the line", async () => {
    alice.clear();
    for (let n = 0; n < 3; n++) {
      await tick(cannonReloadFrames());
      await fire();
      await tick(20);
    }
    expect(balls()).toBe(0);
    await tick(80); // the death lock, then the respawn sends the line
    expect(chats(alice)).toContain(
      "*** Bob's boat was sunk by Alice. Bob was claimed by the waters.",
    );
    expect(vehicleOf("Bob")).toBeNull();
  });

  test("with no Cannonballs the cannon says so", async () => {
    await tick(cannonReloadFrames());
    alice.clear();
    await fire();
    expect(chats(alice)).toEqual(["You have no cannonballs!"]);
  });

  test("she sails back and gets off onto the shore; the ship parks on the water", async () => {
    step(alice, "L");
    await tick(17);
    step(alice, "L", true); // face the shore at (6,5)
    await tick(1);
    await tick(41);
    alice.clear();
    bob.clear();
    alice.send({ t: "action" });
    await tick(1);
    const gadd = deltas(alice).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(gadd.map((g) => [g.name, g.x, g.y])).toEqual([["Alice's Battleship", 7, 5]]);
    expect(deltas(bob)).toContainEqual({ e: "body", id: idOf(server.db, "Alice"), body: null });
    expect(vehicleOf("Alice")).toBeNull();
  });

  test("board again, disconnect, log in: still aboard, body 56", async () => {
    step(alice, "R", true); // face the ship on (7,5)
    await tick(1);
    await tick(41);
    alice.clear();
    alice.send({ t: "action" });
    await tick(1);
    expect(chats(alice)).toContain("You board your battleship...");
    alice.close();
    await settle();
    const again = await connectBot(server.wsUrl);
    again.send({ t: "login", name: "Alice", password: "secret" });
    const snap = await again.waitFor(isSnapshot);
    expect(snap.you.body).toBe(56);
    expect([snap.self.x, snap.self.y]).toEqual([7, 5]);
  });
});
