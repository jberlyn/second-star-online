/**
 * Bot script: Alice, an immortal, paints two `J2` pads through the World Editor's SAVE and drops an
 * Airship Deed beside herself. She uses it facing a pad (the airship appears, the deed is gone);
 * Bob, standing next to it, is told it is not his; Alice boards with Ctrl (body 57 for Bob), flies
 * over water in 8-frame steps, is refused a drop "from the sky" and a landing off a pad, parks on
 * the second pad, boards again, and logs back in still aboard.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg, DeltaEvent, EditorMap, ServerMsg } from "@secondstaronline/shared";

import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, face, settle, startTestServer, type TestServer } from "./harness.ts";

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

/** No spawns, moves, attacks or pushes. */
const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

type Editor = Extract<ServerMsg, { t: "editor"; editing: true }>;
type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;
const isEditor = (m: ServerMsg): m is Editor => m.t === "editor" && m.editing;
const isSnapshot = (m: ServerMsg): m is Snapshot => m.t === "snapshot";

/** Replaces the code at column `x` of a layer row. */
const withCode = (row: string, x: number, code: string) => {
  const words = row.split(" ");
  words[x - 1] = code;
  return words.join(" ");
};

describe("the Airship", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let seq = 0;

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const chats = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
  const deltas = (bot: Bot): DeltaEvent[] =>
    bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
  const lastInv = (bot: Bot) => bot.inbox.filter((m) => m.t === "inv").at(-1);
  const step = (bot: Bot, dir: "L" | "R" | "U" | "D", turn = false) =>
    bot.send({ t: "step", seq: ++seq, dir, turn });

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
      "UPDATE accounts SET role = 'immortal' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 6, y = 4 WHERE name = 'Bob'");
  });
  afterAll(async () => {
    await server.stop();
  });

  test("pads are painted through the World Editor's SAVE: J2 at (6,5) and (9,5), water at (7,5)", async () => {
    alice = await login("Alice");
    face(server, "Alice", "N"); // staging: 1.6 logs in facing south
    bob = await login("Bob");
    face(server, "Bob", "N"); // staging: 1.6 logs in facing south
    alice.send({ t: "editOpen" });
    const ed: Editor = await alice.waitFor(isEditor);
    const m: EditorMap = structuredClone(ed.map);
    let row = m.layers[0][4] ?? "";
    row = withCode(withCode(withCode(row, 6, "J2"), 9, "J2"), 7, "W1");
    m.layers[0][4] = row;
    alice.send({ t: "editSave", map: m });
    await alice.waitFor((x) => x.t === "alert");
    alice.clear();
    alice.send({ t: "editClose" });
    await alice.waitFor(isSnapshot);
    alice.send({ t: "mapReady" });
    await settle();
    bob.clear();
  });

  test("Use on the deed facing the pad builds Alice's Airship and spends the deed", async () => {
    alice.clear();
    alice.send({ t: "chat", text: "/drop Airship Deed" }); // lands on the faced tile (6,5)
    await tick(1);
    alice.send({ t: "action" }); // Ctrl takes it
    await tick(1);
    const inv = lastInv(alice);
    const slot = (inv?.inv.bag.findIndex((l) => l?.item === "Airship Deed") ?? -1) + 1;
    expect(slot).toBeGreaterThan(0);
    await tick(41); // the 40-frame item pause
    alice.clear();
    bob.clear();
    alice.send({ t: "use", slot });
    await tick(1);
    const gadd = deltas(alice).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(gadd.map((g) => [g.name, g.x, g.y])).toEqual([["Alice's Airship", 6, 5]]);
    expect(lastInv(alice)?.inv.bag.some((l) => l?.item === "Airship Deed")).toBe(false);
  });

  test("Bob, adjacent and facing it, is told it is not his", async () => {
    bob.clear();
    step(bob, "D", true); // turn to face south: the airship is on (6,5)
    await tick(1);
    const id = (await findAirshipId()) ?? "";
    bob.send({ t: "pickup", id });
    await tick(1);
    expect(chats(bob)).toContain("You can't get on an Airship that's not yours!");
  });

  const findAirshipId = async (): Promise<string | null> => {
    const row = server.db
      .query<{ id: string }, []>("SELECT id FROM ground_items WHERE item = 'Alice''s Airship'")
      .get();
    return row?.id ?? null;
  };

  test("Ctrl facing it boards: body 57 for Bob, Alice on the airship's tile", async () => {
    await tick(41);
    alice.clear();
    bob.clear();
    alice.send({ t: "action" });
    await tick(1);
    expect(chats(alice)).toContain("You board your Airship...");
    expect(deltas(bob)).toContainEqual({ e: "body", id: expect.any(String), body: 57 });
    const you = alice.inbox.filter((m) => m.t === "you").at(-1);
    expect(you).toMatchObject({ self: { x: 6, y: 5, frames: 0 } });
    const row = server.db
      .query<{ vehicle: string | null; x: number; y: number }, []>(
        "SELECT vehicle, x, y FROM characters WHERE name = 'Alice'",
      )
      .get();
    expect(row).toEqual({ vehicle: "Airship", x: 6, y: 5 });
  });

  test("flies over water in 8-frame steps", async () => {
    alice.clear();
    bob.clear();
    step(alice, "R");
    await tick(1);
    const moves = deltas(bob).flatMap((e) => (e.e === "move" ? [e] : []));
    expect(moves).toHaveLength(1);
    expect([moves[0]?.toX, moves[0]?.toY, moves[0]?.frames]).toEqual([7, 5, 8]); // over the water
    await tick(8);
  });

  test("a drop is refused from the sky; a landing off a pad is refused", async () => {
    await tick(41); // the boarding's item pause
    alice.clear();
    alice.send({ t: "drop", slot: 1 }); // the starting Apple
    await tick(1);
    expect(chats(alice)).toContain("You can't drop this from the sky!");
    await tick(41);
    alice.clear();
    alice.send({ t: "action" });
    await tick(1);
    expect(chats(alice)).toContain("You cannot get off here.");
  });

  test("Ctrl on the second pad parks the airship under her and the paperdoll returns", async () => {
    step(alice, "R");
    await tick(9);
    step(alice, "R");
    await tick(9);
    await tick(41);
    bob.clear();
    alice.clear();
    alice.send({ t: "action" });
    await tick(1);
    const gadd = deltas(alice).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(gadd.map((g) => [g.name, g.x, g.y])).toEqual([["Alice's Airship", 9, 5]]);
    expect(deltas(bob)).toContainEqual({ e: "body", id: expect.any(String), body: null });
    const row = server.db
      .query<{ vehicle: string | null }, []>("SELECT vehicle FROM characters WHERE name = 'Alice'")
      .get();
    expect(row?.vehicle).toBeNull();
  });

  test("board again, disconnect, log in: still aboard, body 57", async () => {
    step(alice, "L");
    await tick(17);
    step(alice, "R", true); // turn to face the airship on (9,5)
    await tick(1);
    await tick(41);
    alice.clear();
    alice.send({ t: "action" });
    await tick(1);
    expect(chats(alice)).toContain("You board your Airship...");
    alice.close();
    await settle();
    const again = await connectBot(server.wsUrl);
    again.send({ t: "login", name: "Alice", password: "secret" });
    const snap = await again.waitFor(isSnapshot);
    expect(snap.you.body).toBe(57);
    expect([snap.self.x, snap.self.y]).toEqual([9, 5]);
  });
});
