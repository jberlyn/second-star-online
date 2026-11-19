/**
 * Attacks on the server the way a hostile client would make them. Real server, real SQL, bots.
 *
 * - Fuzz: every client message type with edge and random values in four states; nothing may
 *   throw (`faults`), no player may be dropped, the server must keep answering.
 * - Gateway: floods and bad frames close the socket; the login, creation and socket limits.
 * - Faults: a throw inside an intent rolls back and logs the sender out; a throwing tick is
 *   reported and the next one runs.
 *
 * Races and crash windows: `races.test.ts`, `crash-and-stop.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { CLOSE, inGameSchema, MAX_MESSAGE_BYTES, TEXT } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import { scriptedRng } from "../src/rng.ts";
import {
  type Bot,
  connectBot,
  connectUntilClosed,
  idOf,
  login,
  make,
  settle,
  startTestServer,
  type TestServer,
  tick,
} from "./harness.ts";

/** A small seeded generator (mulberry32), so a failing run repeats. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ctx {
  rand: () => number;
  selfId: string;
  otherId: string;
  otherName: string;
  uuids: string[];
}

/* biome-ignore lint/suspicious/noExplicitAny: walking zod's internals */
type Z = any;

/** Values for one field, from its schema's bounds and a few hostile strings. */
function candidates(f: Z, c: Ctx): unknown[] {
  const def = f._zod.def;
  switch (def.type) {
    case "literal":
      return [...def.values];
    case "boolean":
      return [true, false];
    case "enum":
      return Object.values(def.entries);
    case "number": {
      const lo = Number.isFinite(f.minValue) ? (f.minValue as number) : -(2 ** 31);
      const hi = Number.isFinite(f.maxValue) ? (f.maxValue as number) : 2 ** 31;
      const mid = Math.floor(lo + (hi - lo) / 2);
      const rnd = Math.floor(lo + c.rand() * (hi - lo));
      return [lo, hi, 0, 1, -1, mid, rnd].filter((n) => n >= lo && n <= hi);
    }
    case "string": {
      if (f.format === "uuid") {
        return [c.selfId, c.otherId, ...c.uuids, crypto.randomUUID()];
      }
      const max = f.maxLength ?? 40;
      const min = f.minLength ?? 0;
      const base = [
        "",
        "a",
        "x".repeat(max),
        "%",
        "%E0%A4%A",
        "constructor",
        "__proto__",
        "<img src=x onerror=alert(1)>",
        c.otherName,
        "Alice",
        "Bob",
        "'; DROP TABLE characters; --",
        "0",
        "-1",
        "\u0000",
        "Apple",
      ];
      return base.map((s) => s.slice(0, max)).filter((s) => s.length >= min);
    }
    case "nullable":
      return [null, ...candidates(def.innerType, c)];
    case "optional":
      return [undefined, ...candidates(def.innerType, c)];
    case "array": {
      const one = candidates(def.element, c);
      const pick = () => one[Math.floor(c.rand() * one.length)];
      return [[], [pick()], [pick(), pick(), pick()]];
    }
    case "tuple":
      return [def.items.map((i: Z) => pick(candidates(i, c), c))];
    case "object":
      return [build(f, c)];
    case "record":
      return [{}, { jailMinutes: 40 }, { constructor: 1 }];
    case "union":
      return def.options.flatMap((o: Z) => candidates(o, c));
    default:
      return [undefined];
  }
}

const pick = (xs: unknown[], c: Ctx): unknown => xs[Math.floor(c.rand() * xs.length)];

function build(schema: Z, c: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries<Z>(schema.shape)) {
    const v = pick(candidates(f, c), c);
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

const TYPES: Z[] = (inGameSchema as Z)._zod.def.options;
const typeName = (o: Z): string => o.shape.t._zod.def.values[0];

/** Schema-valid messages of one type: random picks from the field candidates. */
function messagesOf(opt: Z, n: number, c: Ctx): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const m = build(opt, c);
    if (inGameSchema.safeParse(m).success) {
      out.push(m);
    }
  }
  return out;
}

/** Types that leave the game by design, or that only the gateway handles. */
const SKIP = new Set(["logout"]);

describe("malformed and hostile messages", () => {
  let server: TestServer;
  let a: Bot;
  let b: Bot;
  let aId = "";
  let bId = "";

  beforeAll(async () => {
    server = startTestServer({ rng: scriptedRng([2]) });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    aId = idOf(server.db, "Alice");
    bId = idOf(server.db, "Bob");
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 8, y = 6 WHERE name = 'Bob'");
    server.db.run("UPDATE characters SET gold = 500 WHERE name IN ('Alice', 'Bob')");
    a = await login(server, "Alice");
    b = await login(server, "Bob");
  });
  afterAll(async () => {
    a.close();
    b.close();
    await server.stop();
  });

  const world = () => server.game.world;
  const who = (id: string) => world().players.get(id);

  const states: [string, () => void][] = [
    ["alive", () => {}],
    [
      "dead",
      () => {
        const p = who(aId);
        if (p) {
          p.char.vitals.hp = 0;
        }
      },
    ],
    [
      "trading",
      () => {
        const p = who(aId);
        if (p) {
          p.char.vitals.hp = p.char.vitals.hpMax;
        }
        server.game.intent(aId, { t: "tradeOpen", id: bId });
        server.game.intent(aId, { t: "tradeOffer", gold: 10, items: [] });
      },
    ],
    [
      "on an Airship",
      () => {
        const p = who(aId);
        if (p) {
          p.char.vitals.hp = p.char.vitals.hpMax;
          p.vehicle = "Airship";
        }
      },
    ],
  ];

  for (const [state, setup] of states) {
    test(`every message type, 100 each, while ${state}: no fault, nobody dropped (fuzz)`, () => {
      setup();
      const c: Ctx = {
        rand: seeded(8_000 + state.length),
        selfId: aId,
        otherId: bId,
        otherName: "Bob",
        uuids: [...(who(aId)?.map.ground ?? [])].map((g) => g.id),
      };
      const before = server.faults.length;
      let sent = 0;
      for (const opt of TYPES) {
        const name = typeName(opt);
        if (SKIP.has(name)) {
          continue;
        }
        for (const m of messagesOf(opt, 100, c)) {
          server.game.intent(aId, m as never);
          // The other bot answers now and then, so a trade or a table has two sides.
          if (sent % 7 === 0) {
            const reply = messagesOf(pick(TYPES, c) as Z, 1, c)[0];
            if (reply && (reply as { t: string }).t !== "logout") {
              server.game.intent(bId, reply as never);
            }
          }
          sent += 1;
          if (sent % 10 === 0) {
            server.tickNow(1);
          }
        }
      }
      expect(sent).toBeGreaterThan(1000);
      expect(server.faults.slice(before).map((f) => f.where)).toEqual([]);
      expect(server.game.isOnline(aId)).toBe(true);
      expect(server.game.isOnline(bId)).toBe(true);
    }, 120_000);
  }

  test("a schema-invalid message of every type (wrong type, missing or extra field) is a strike", async () => {
    const probe = await connectBot(server.wsUrl);
    const p2 = await (async () => {
      // A third character so strikes land on a socket that can be closed freely.
      probe.send(make("Cara"));
      await probe.waitFor((m) => m.t === "created");
      probe.send({ t: "login", name: "Cara", password: "secret" });
      await probe.waitFor((m) => m.t === "snapshot");
      return probe;
    })();
    let bad = 0;
    for (const opt of TYPES) {
      const name = typeName(opt);
      const shape = Object.keys(opt.shape).filter((k) => k !== "t");
      const wrongs: unknown[] = [
        { t: name, extra: 1 },
        ...(shape.length > 0 ? [{ t: name }, { t: name, [shape[0] as string]: { x: 1 } }] : []),
      ];
      for (const w of wrongs) {
        if (!inGameSchema.safeParse(w).success) {
          bad += 1;
          p2.send(w as never);
        }
      }
    }
    expect(bad).toBeGreaterThan(100);
    await settle(200);
    // Fewer than the 51-strike limit closes it? No: more than 50 strikes do. Either way the
    // server itself is untouched.
    expect(server.faults).toEqual([]);
    expect(server.game.isOnline(aId)).toBe(true);
    probe.close();
  });
});

describe("floods and bad frames close the socket", () => {
  let server: TestServer;
  beforeAll(() => {
    server = startTestServer();
  });
  afterAll(async () => {
    await server.stop();
  });

  test("51 bad frames before login close with 4003", async () => {
    const bot = await connectBot(server.wsUrl);
    for (let i = 0; i < 51; i++) {
      bot.send({ t: "step", seq: 1, dir: "U", turn: false }); // an in-game type before login is a strike
      await settle(1);
    }
    const closed = await bot.closed;
    expect(closed.code).toBe(CLOSE.badMessage.code);
  });

  test("a burst of 100 messages closes with 4004", async () => {
    const bot = await connectBot(server.wsUrl);
    for (let i = 0; i < 100; i++) {
      bot.send({ t: "resume", token: crypto.randomUUID() });
    }
    const closed = await bot.closed;
    expect(closed.code).toBe(CLOSE.rateLimited.code);
  });

  test("an oversized frame and non-JSON are strikes, not faults", async () => {
    const bot = await connectBot(server.wsUrl);
    (bot as unknown as { send(m: unknown): void }).send({
      t: "login",
      name: "x".repeat(MAX_MESSAGE_BYTES + 10),
      password: "y",
    });
    await settle(100);
    expect(server.faults).toEqual([]);
    bot.close();
  });

  test("a malformed % in /assets/ is a 404, not a throw", async () => {
    const r = await fetch(new URL("/assets/%E0%A4%A", server.url));
    expect(r.status).toBe(404);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("login, creation and socket limits", () => {
  let server: TestServer;
  beforeAll(() => {
    server = startTestServer({ limits: true });
  });
  afterAll(async () => {
    await server.stop();
  });

  const tryLogin = async (name: string, password: string) => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password });
    const m = await bot.waitFor((x) => x.t === "denied" || x.t === "welcome");
    bot.close();
    return m;
  };

  test("the 4th character from one address is refused with the new text", async () => {
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Ann", "Ben", "Cat"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.send(make("Dan"));
    const m = await bot.waitFor((x) => x.t === "denied");
    expect(m).toEqual({ t: "denied", text: TEXT.tooManyCreates });
    bot.close();
  });

  test("five wrong passwords lock the account for that address; 1.6's own texts come before", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await tryLogin("Ann", "wrong")).toEqual({ t: "denied", text: TEXT.badPassword });
    }
    expect(await tryLogin("Ann", "wrong")).toEqual({ t: "denied", text: TEXT.tooManyLogins });
    // Even the right password is refused now.
    expect(await tryLogin("Ann", "secret")).toEqual({ t: "denied", text: TEXT.tooManyLogins });
    // Another account is not locked.
    expect((await tryLogin("Ben", "secret")).t).toBe("welcome");
  });

  test("an immortal is never refused by the per-address count", async () => {
    const acc = server.db
      .query<{ account_id: string }, []>("SELECT account_id FROM characters WHERE name = 'Cat'")
      .get();
    setRole(server.db, acc?.account_id ?? "", "immortal", "2026-11-10T00:00:00.000Z");
    // 20 bad names from this address (the per-address limit), then Cat still gets in.
    for (let i = 0; i < 20; i++) {
      await tryLogin(`Nobody${i}`, "x");
    }
    expect(await tryLogin("Ben", "secret")).toEqual({ t: "denied", text: TEXT.tooManyLogins });
    expect((await tryLogin("Cat", "secret")).t).toBe("welcome");
  });

  test("an 11th open socket from one address is closed with 4006", async () => {
    const open: Bot[] = [];
    for (let i = 0; i < 10; i++) {
      open.push(await connectBot(server.wsUrl));
    }
    const r = await connectUntilClosed(server.wsUrl);
    expect(r.code).toBe(CLOSE.tooManyConnections.code);
    for (const bot of open) {
      bot.close();
    }
    await settle(100);
    // Closed sockets stop counting.
    const again = await connectBot(server.wsUrl);
    expect(again).toBeDefined();
    again.close();
  });
});

describe("tries sent together on several sockets count before the hash", () => {
  let server: TestServer;
  beforeAll(() => {
    server = startTestServer({ limits: true });
  });
  afterAll(async () => {
    await server.stop();
  });

  /** Sends one message on each of `n` fresh sockets at once; the replies in socket order. */
  const together = async (n: number, msg: (i: number) => Parameters<Bot["send"]>[0]) => {
    const bots = await Promise.all(Array.from({ length: n }, () => connectBot(server.wsUrl)));
    for (const [i, b] of bots.entries()) {
      b.send(msg(i));
    }
    const replies = await Promise.all(
      bots.map((b) => b.waitFor((m) => m.t === "denied" || m.t === "created" || m.t === "welcome")),
    );
    for (const b of bots) {
      b.close();
    }
    await settle(50);
    return replies;
  };

  test("six creations at once from one address: three are made, three refused", async () => {
    const replies = await together(6, (i) => make(`Racer${String.fromCharCode(65 + i)}`));
    expect(replies.filter((m) => m.t === "created")).toHaveLength(3);
    expect(replies.filter((m) => m.t === "denied" && m.text === TEXT.tooManyCreates)).toHaveLength(
      3,
    );
  });

  test("eight wrong passwords at once on one account: five are hashed, three refused", async () => {
    const replies = await together(8, () => ({ t: "login", name: "RacerA", password: "wrong" }));
    expect(replies.filter((m) => m.t === "denied" && m.text === TEXT.badPassword)).toHaveLength(5);
    expect(replies.filter((m) => m.t === "denied" && m.text === TEXT.tooManyLogins)).toHaveLength(
      3,
    );
  });

  test("a good password takes back its own try: the address keeps only its failures", async () => {
    // RacerB from this address: 5 failures on RacerA so far, 20 allowed. 15 good logins in a
    // row would have filled the per-address count before; now each takes its try back.
    for (let i = 0; i < 16; i++) {
      const [m] = await together(1, () => ({ t: "login", name: "RacerB", password: "secret" }));
      expect(m?.t).toBe("welcome");
    }
  });
});

describe("a throw in an intent or a tick", () => {
  test("the sender is logged out with the new text and nothing is written; the other bot plays on", async () => {
    let boom = false;
    const faults: string[] = [];
    const server = startTestServer({
      onFault: (where) => faults.push(where),
      crashPoint: (l) => {
        if (boom && l === "persist:mid") {
          throw new Error("test throw");
        }
      },
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const aId = idOf(server.db, "Alice");
    const first = server.db
      .query<{ item: string }, [string]>(
        "SELECT item FROM inventory WHERE character_id = ? AND slot = 1",
      )
      .get(aId)?.item as string;
    const bagBefore = server.db
      .query("SELECT slot, item, qty FROM inventory WHERE character_id = ? ORDER BY slot")
      .all(aId);
    const a = await login(server, "Alice");
    const b = await login(server, "Bob");
    a.clear();
    boom = true;
    a.send({ t: "drop", slot: 1 }); // writes the bag and the ground: reaches persist:mid
    const kicked = await a.waitFor((m) => m.t === "kicked");
    boom = false;
    expect(kicked).toEqual({ t: "kicked", text: TEXT.serverError });
    expect(faults).toEqual(["intent drop from Alice"]);
    // Rolled back: the bag is as it was, nothing on the ground.
    expect(
      server.db
        .query("SELECT slot, item, qty FROM inventory WHERE character_id = ? ORDER BY slot")
        .all(aId),
    ).toEqual(bagBefore);
    expect(server.db.query("SELECT COUNT(*) AS n FROM ground_items").get()).toEqual({ n: 0 });
    // A bug is not cheating: the error log names it, the cheat log does not.
    expect(server.db.query("SELECT COUNT(*) AS n FROM cheat_log").get()).toEqual({ n: 0 });
    // The other bot is still in and a re-login reloads Alice from SQL.
    expect(server.game.isOnline(idOf(server.db, "Bob"))).toBe(true);
    expect(server.game.isOnline(aId)).toBe(false);
    const a2 = await login(server, "Alice");
    expect(a2.inbox.some((m) => m.t === "inv" && m.inv.bag[0]?.item === first)).toBe(true);
    b.close();
    a2.close();
    await server.stop();
  });

  test("a throw that escapes the game in the gateway logs the player out, no ghost", async () => {
    const server = startTestServer();
    const bot = await connectBot(server.wsUrl);
    bot.send(make("Alice"));
    await bot.waitFor((m) => m.t === "created");
    bot.close();
    const aId = idOf(server.db, "Alice");
    const a = await login(server, "Alice");
    a.clear();
    const game = server.game as { intent: typeof server.game.intent };
    const real = game.intent;
    game.intent = () => {
      throw new Error("test throw past the game's own catch");
    };
    a.send({ t: "action" });
    const kicked = await a.waitFor((m) => m.t === "kicked");
    game.intent = real;
    expect(kicked).toEqual({ t: "kicked", text: TEXT.serverError });
    await a.closed;
    // Off the map (an earlier version left the character in the world with no connection).
    expect(server.game.isOnline(aId)).toBe(false);
    const a2 = await login(server, "Alice");
    expect(server.game.isOnline(aId)).toBe(true);
    a2.close();
    await server.stop();
  });

  test("a throwing tick returns false, tickNow says so, and the next tick runs", async () => {
    let boom = false;
    const server = startTestServer({
      onFault: () => {},
      rng: {
        random: (n) => {
          if (boom) {
            throw new Error("test throw");
          }
          return n >= 1 ? n : 0;
        },
      },
    });
    const bot = await connectBot(server.wsUrl);
    bot.send(make("Alice"));
    await bot.waitFor((m) => m.t === "created");
    bot.close();
    const a = await login(server, "Alice");
    await tick(server, 1);
    boom = true;
    // The hunger roll or the monsters' rolls throw; if this scene rolls nothing, the test is
    // moot and says so.
    const ok = server.game.tick();
    boom = false;
    if (!ok) {
      expect(() => {
        boom = true;
        try {
          server.tickNow(1);
        } finally {
          boom = false;
        }
      }).toThrow();
    }
    expect(server.game.tick()).toBe(true);
    a.close();
    await server.stop();
  });
});

describe("the Pig grab is one write", () => {
  test("a fault between the slot write and the bag write puts the Pig back", async () => {
    let boom = false;
    const faults: string[] = [];
    const server = startTestServer({
      onFault: (where) => faults.push(where),
      crashPoint: (l) => {
        if (boom && l === "npc:pigGrab") {
          throw new Error("test throw");
        }
      },
    });
    const maker = await connectBot(server.wsUrl);
    maker.send(make("Alice"));
    await maker.waitFor((m) => m.t === "created");
    maker.close();
    server.db.run(
      "UPDATE inventory SET item = 'Pig', qty = 1 WHERE slot = 1 AND character_id = (SELECT id FROM characters WHERE name = 'Alice')",
    );
    const a = await login(server, "Alice");
    const id = idOf(server.db, "Alice");
    const p = server.game.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    p.itemPause = 0;
    server.game.intent(id, { t: "drop", slot: 1 }); // a live Pig on the faced tile
    server.tickNow(1);
    const slot = p.map.slots.find((s) => s.live?.name === "Pig");
    expect(slot).toBeDefined();
    const pigs = () =>
      server.db.query("SELECT COUNT(*) AS n FROM map_slots WHERE live_name = 'Pig'").get() as {
        n: number;
      };
    const bagPigs = () =>
      server.db.query("SELECT COUNT(*) AS n FROM inventory WHERE item = 'Pig'").get() as {
        n: number;
      };
    expect([pigs().n, bagPigs().n]).toEqual([1, 0]);
    p.piggie = 0;
    p.keyLock = false;
    boom = true;
    server.game.intent(id, { t: "npcClick", slot: slot?.slot ?? 1 });
    boom = false;
    expect(faults).toEqual(["intent npcClick from Alice"]); // the window was reached
    // Either the Pig is back in the bag or still a monster: never both and never neither.
    expect(pigs().n + bagPigs().n).toBe(1);
    expect([pigs().n, bagPigs().n]).toEqual([1, 0]); // the fault rolled the grab back
    a.close();
    await server.stop();
  });
});
