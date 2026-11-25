/**
 * Bot script: Alice, an administrator, opens the Control Panel's World page (issue #33, the World
 * Editor's successor; Bob sees her leave), paints the seed map,
 * ticks SAFE AREA, writes a sign and a header, places an Exit to x1001y992, a Sign 1 and a Slime,
 * and saves: Bob gets the map again with all of it. She loads x1001y992 (blank), saves it as a new
 * map, and returns to the game where she stood. Bob reads the sign with Ctrl, walks onto the Exit
 * and arrives on x1001y992. A save from a player is ignored.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { type CreateMsg, type EditorMap, type ServerMsg, TEXT } from "@secondstaronline/shared";

import { countMapVersions, findMapByCoords } from "../src/persistence/maps.ts";
import type { Rng } from "../src/rng.ts";
import {
  type Bot,
  connectBot,
  face,
  pageMap,
  pageSave,
  settle,
  startTestServer,
  type TestServer,
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

/** No spawns, moves, attacks or pushes. */
const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;
const isSnapshot = (m: ServerMsg): m is Snapshot => m.t === "snapshot";

describe("the World Editor", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let edited: EditorMap;
  let revision: string | null = null;

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
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 9, y = 6 WHERE name = 'Bob'");
  });
  afterAll(async () => {
    await server.stop();
  });

  test("only an administrator opens the World page; Bob sees Alice leave", async () => {
    alice = await login("Alice");
    bob = await login("Bob");
    face(server, "Bob", "N"); // staging: 1.6 logs in facing south
    expect(
      alice.inbox.some((m) => m.t === "permissions" && m.permissions.includes("contentEditor")),
    ).toBe(true);
    bob.clear();
    bob.send({ t: "contentMaps", seq: 1, mx: 1000, my: 992 });
    await settle();
    expect(bob.inbox.some((m) => m.t === "contentMaps")).toBe(false);
    const ed = await pageMap(alice, { mx: 1000, my: 992 });
    expect([ed.map.mx, ed.map.my, ed.revision !== null]).toEqual([1000, 992, true]);
    await bob.waitFor((m) => m.t === "delta" && m.events.some((e) => e.e === "leave"));
    edited = ed.map;
    revision = ed.revision;
  });

  test("a save writes the map, the roster and the placed items; Bob gets it again", async () => {
    const m = structuredClone(edited);
    m.layers[0][1] = m.layers[0][1]?.replace(/^G1 G1/, "G1 W1") ?? "";
    m.flags.canFight = "O";
    m.header = "Town";
    m.signs = ["Welcome to town", "", ""];
    m.exit1 = { mx: 1001, my: 992, x: 3, y: 3 };
    m.items = [
      { name: "Exit", x: 8, y: 6 },
      { name: "Sign 1", x: 9, y: 5 },
    ];
    m.mobs = [{ name: "Slime", x: 14, y: 3 }, null, null, null];
    bob.clear();
    alice.clear();
    await pageSave(alice, m, revision);
    const snap = await bob.waitFor(isSnapshot);
    expect(snap.map.layers[0][1]?.startsWith("G1 W1")).toBe(true);
    expect(snap.map.signs[0]).toBe("Welcome to town");
    expect(snap.map.title).toBe("Town");
    expect(snap.ground.map((g) => [g.name, g.x, g.y])).toEqual([
      ["Exit", 8, 6],
      ["Sign 1", 9, 5],
    ]);
    expect(snap.monsters.map((x) => [x.name, x.x, x.y])).toEqual([["Slime", 14, 3]]);
    // The old map is kept as a version.
    const rec = findMapByCoords(server.db, 1000, 992);
    expect(rec?.flags.canFight).toBe("O");
    expect(rec && countMapVersions(server.db, rec.id)).toBe(1);
  });

  test("a save from a player is ignored", async () => {
    const m = structuredClone(edited);
    m.header = "Bob's town";
    bob.send({ t: "contentMapSave", seq: 2, map: m, expect: null });
    await settle();
    expect(findMapByCoords(server.db, 1000, 992)?.title).toBe("Town");
  });

  test("a missing map opens blank; a save creates it", async () => {
    alice.clear();
    const ed = await pageMap(alice, { mx: 1001, my: 992 });
    expect(ed.revision).toBeNull();
    expect(ed.map.layers[0][0]?.startsWith("H1")).toBe(true);
    const fresh = structuredClone(ed.map);
    fresh.layers[0] = fresh.layers[0].map((r) => r.replaceAll("H1", "G1"));
    fresh.flags.canFight = "X";
    await pageSave(alice, fresh, null);
    expect(findMapByCoords(server.db, 1001, 992)).not.toBeNull();
  });

  test("Return To Game puts Alice back where she stood", async () => {
    alice.clear();
    bob.clear();
    alice.send({ t: "editClose" });
    const snap = await alice.waitFor(isSnapshot);
    expect([snap.map.name, snap.self.x, snap.self.y]).toEqual(["x1000y992", 6, 6]);
    await bob.waitFor((m) => m.t === "delta" && m.events.some((e) => e.e === "enter"));
    alice.send({ t: "mapReady" });
  });

  test("Ctrl facing a sign shows its text", async () => {
    bob.clear();
    bob.send({ t: "action" }); // Bob is turned north (face), at (9, 6): the sign is on (9, 5)
    const sign = await bob.waitFor((m) => m.t === "sign");
    expect(sign).toEqual({ t: "sign", n: 1 });
  });

  test("walking onto the Exit warps Bob to exit 1", async () => {
    bob.clear();
    bob.send({ t: "step", seq: 1, dir: "L", turn: false });
    await tick(20);
    const snap = await bob.waitFor(isSnapshot);
    expect([snap.map.name, snap.self.x, snap.self.y]).toEqual(["x1001y992", 3, 3]);
  });
});
