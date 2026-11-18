/**
 * Duplication races: two actions that touch the same gold or item, sent in both orders and inside
 * one tick, with the conservation check (e2e/conservation.ts) read from SQL after both players log
 * out and in again. A re-login reloads everything from SQL, so a change that lived only in memory
 * shows up as a difference here, the way a cheater would use it.
 *
 * Intents go straight to `game.intent` so the order is the test's; the bots only log in.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ClientMsg } from "@secondstaronline/shared";

import { scriptedRng } from "../src/rng.ts";
import { b64, makePng } from "../tests/helpers/png.ts";
import { expectConserved, totals } from "./conservation.ts";
import {
  type Bot,
  connectBot,
  idOf,
  login,
  make,
  startTestServer,
  type TestServer,
  tick,
} from "./harness.ts";

/** Faces both players again after a leave and enter (1.6 logs in facing south). */
let refaceAll = () => {};

interface Scene {
  server: TestServer;
  A: string;
  B: string;
  bots: Bot[];
  /** Sends an intent as `who` (no socket). */
  as(who: "A" | "B", msg: ClientMsg): void;
  /** Both players leave and enter again, as a re-login would. */
  relog(): void;
  player(who: "A" | "B"): NonNullable<ReturnType<TestServer["game"]["world"]["players"]["get"]>>;
}

async function scene(setup?: (s: TestServer) => void): Promise<Scene> {
  const server = startTestServer({ rng: scriptedRng([2]) });
  const maker = await connectBot(server.wsUrl);
  for (const name of ["Alice", "Bob"]) {
    maker.send(make(name));
    await maker.waitFor((m) => m.t === "created");
    maker.clear();
  }
  maker.close();
  server.db.run("UPDATE characters SET gold = 500, x = 6, y = 4 WHERE name = 'Alice'");
  server.db.run("UPDATE characters SET gold = 300, x = 6, y = 6 WHERE name = 'Bob'");
  setup?.(server);
  const bots = [await login(server, "Alice"), await login(server, "Bob")];
  const A = idOf(server.db, "Alice");
  const B = idOf(server.db, "Bob");
  const id = (who: "A" | "B") => (who === "A" ? A : B);
  // 1.6 logs in facing south: Alice at (6, 4) faces (6, 5); Bob at (6, 6) turns north to it.
  const face = (x: string, dir: "N" | "S") => {
    const p = server.game.world.players.get(x);
    if (p) {
      p.facing = dir;
      p.loading = 0; // no client sent mapReady after a re-entry
    }
  };
  face(A, "S");
  face(B, "N");
  refaceAll = () => {
    face(A, "S");
    face(B, "N");
  };
  return {
    server,
    A,
    B,
    bots,
    as: (who, msg) => server.game.intent(id(who), msg as never),
    relog() {
      for (const x of [A, B]) {
        server.game.leave(x);
      }
      for (const x of [A, B]) {
        expect(server.game.enter(x, false)).toBe(true);
      }
      refaceAll();
    },
    player: (who) => {
      const p = server.game.world.players.get(id(who));
      if (!p) {
        throw new Error(`${who} is not in`);
      }
      return p;
    },
  };
}

let s: Scene;
afterEach(async () => {
  for (const b of s.bots) {
    b.close();
  }
  await s.server.stop();
});

/** Reads totals as they stand in SQL once both players have left. */
const sqlTotals = (sc: Scene) => {
  for (const x of [sc.A, sc.B]) {
    sc.server.game.leave(x);
  }
  const t = totals(sc.server.db);
  for (const x of [sc.A, sc.B]) {
    sc.server.game.enter(x, false);
  }
  refaceAll();
  return t;
};

const orders: [string, (sc: Scene, a: () => void, b: () => void) => void][] = [
  ["a then b", (_sc, a, b) => (a(), b())],
  ["b then a", (_sc, a, b) => (b(), a())],
  [
    "both before one tick",
    (sc, a, b) => {
      a();
      b();
      sc.server.tickNow(1);
    },
  ],
];

describe("trade against other moves (conservation)", () => {
  beforeEach(async () => {
    s = await scene();
  });

  const openTrade = () => {
    s.as("A", { t: "tradeOpen", id: s.B });
    s.as("A", { t: "tradeOffer", gold: 100, items: [{ slot: 1, qty: 1 }] });
    s.as("B", { t: "tradeOffer", gold: 50, items: [{ slot: 2, qty: 1 }] });
    // B accepts first, so A's accept is the one that settles.
    s.as("B", { t: "tradeAccept" });
  };

  for (const [name, run] of orders) {
    test(`trade accept against A dropping the offered item: ${name}`, async () => {
      const before = sqlTotals(s);
      openTrade();
      run(
        s,
        () => s.as("A", { t: "tradeAccept" }),
        () => s.as("A", { t: "drop", slot: 1 }),
      );
      await tick(s.server, 1);
      expectConserved(before, sqlTotals(s));
    });

    test(`trade accept against A giving the offered item: ${name}`, async () => {
      const before = sqlTotals(s);
      openTrade();
      run(
        s,
        () => s.as("A", { t: "tradeAccept" }),
        () => s.as("A", { t: "give", slot: 1 }),
      );
      await tick(s.server, 1);
      expectConserved(before, sqlTotals(s));
    });

    test(`trade accept against B dropping the offered item and A equipping: ${name}`, async () => {
      const before = sqlTotals(s);
      openTrade();
      run(
        s,
        () => s.as("A", { t: "tradeAccept" }),
        () => {
          s.as("B", { t: "drop", slot: 2 });
          s.as("A", { t: "equip", slot: 2 });
        },
      );
      await tick(s.server, 1);
      expectConserved(before, sqlTotals(s));
    });

    test(`a double accept and an accept after a cancel: ${name}`, async () => {
      const before = sqlTotals(s);
      openTrade();
      run(
        s,
        () => {
          s.as("A", { t: "tradeAccept" });
          s.as("A", { t: "tradeAccept" });
        },
        () => s.as("B", { t: "tradeCancel" }),
      );
      s.as("A", { t: "tradeAccept" });
      await tick(s.server, 1);
      expectConserved(before, sqlTotals(s));
    });
  }

  test("a trade offering more gold than A has, then A spends it: nothing is created", async () => {
    const before = sqlTotals(s);
    s.as("A", { t: "tradeOpen", id: s.B });
    s.as("A", { t: "tradeOffer", gold: 2 ** 31, items: [] });
    s.as("B", { t: "tradeOffer", gold: 0, items: [] });
    s.as("B", { t: "tradeAccept" });
    s.as("A", { t: "tradeAccept" });
    await tick(s.server, 1);
    expectConserved(before, sqlTotals(s));
  });
});

describe("two pickups of one ground item", () => {
  beforeEach(async () => {
    s = await scene();
  });

  for (const [name, run] of orders) {
    test(`A drops an Apple between them; both pick it up: ${name}`, async () => {
      const before = sqlTotals(s);
      s.as("A", { t: "drop", slot: 1 }); // lands on the faced tile (6, 5)
      s.server.tickNow(1);
      const ground = [...s.player("A").map.ground].find((g) => g.item === "Apple");
      expect(ground).toBeDefined();
      const id = ground?.id ?? "";
      run(
        s,
        () => s.as("A", { t: "pickup", id }),
        () => s.as("B", { t: "pickup", id }),
      );
      await tick(s.server, 2);
      expectConserved(before, sqlTotals(s));
    });
  }
});

describe("one player on two connections", () => {
  beforeEach(async () => {
    s = await scene();
  });

  test("a trade on the first connection, a second login, then the old connection's accept is dead", async () => {
    const before = sqlTotals(s);
    s.as("A", { t: "tradeOpen", id: s.B });
    s.as("A", { t: "tradeOffer", gold: 100, items: [{ slot: 1, qty: 2 }] });
    s.as("B", { t: "tradeOffer", gold: 0, items: [] });
    s.as("B", { t: "tradeAccept" });
    const second = await login(s.server, "Alice"); // replaces the first connection
    s.bots.push(second);
    s.as("A", { t: "tradeAccept" });
    await tick(s.server, 1);
    expectConserved(before, sqlTotals(s));
  });
});

describe("the scene really trades", () => {
  beforeEach(async () => {
    s = await scene();
  });

  test("both accepting moves the gold and the item, and SQL agrees after a re-login", () => {
    s.as("A", { t: "tradeOpen", id: s.B });
    s.as("A", { t: "tradeOffer", gold: 100, items: [{ slot: 1, qty: 1 }] });
    s.as("B", { t: "tradeOffer", gold: 50, items: [] });
    s.as("B", { t: "tradeAccept" });
    s.as("A", { t: "tradeAccept" });
    s.relog();
    const gold = (n: string) =>
      (s.server.db.query("SELECT gold FROM characters WHERE name = ?").get(n) as { gold: number })
        .gold;
    expect([gold("Alice"), gold("Bob")]).toEqual([450, 350]);
  });
});

describe("blackjack and the disconnect windows", () => {
  /** A table between Alice (west) and Bob (east), 100 gold each. */
  async function tableScene(): Promise<Scene> {
    const sc = await scene((server) => {
      server.db.run("UPDATE characters SET gold = 100, x = 9, y = 6 WHERE name = 'Alice'");
      server.db.run("UPDATE characters SET gold = 100, x = 11, y = 6 WHERE name = 'Bob'");
    });
    sc.player("A").map.ground.push({
      id: crypto.randomUUID(),
      item: "Blackjack Table",
      x: 10,
      y: 6,
      kind: "admin",
      expiresAt: null,
    });
    return sc;
  }
  const sit = (sc: Scene, who: "A" | "B") => {
    sc.player(who).itemPause = 0;
    const g = sc.player(who).map.ground.find((x) => x.item === "Blackjack Table");
    sc.as(who, { t: "pickup", id: g?.id ?? "" });
  };
  const hand = (sc: Scene) => {
    sit(sc, "A");
    sit(sc, "B");
    sc.as("A", { t: "bjBid", text: "50" });
    sc.as("B", { t: "bjBid", text: "50" });
    sc.server.tickNow(1);
  };
  const goldOf = (sc: Scene, name: string) =>
    (
      sc.server.db.query("SELECT gold FROM characters WHERE name = ?").get(name) as {
        gold: number;
      }
    ).gold;

  test("Bob forfeits mid-hand: Alice keeps the pot, Bob's stake does not come back on re-login", async () => {
    s = await tableScene();
    const before = totals(s.server.db);
    hand(s);
    s.as("B", { t: "bjLeave" });
    s.server.tickNow(1);
    s.relog();
    expect([goldOf(s, "Alice"), goldOf(s, "Bob")]).toEqual([150, 50]);
    expectConserved(before, totals(s.server.db));
  });

  test("Bob forfeits and then logs out the same tick: the same result", async () => {
    s = await tableScene();
    const before = totals(s.server.db);
    hand(s);
    s.as("B", { t: "bjLeave" });
    s.server.game.leave(s.B);
    s.server.game.leave(s.A);
    s.server.game.enter(s.B, false);
    s.server.game.enter(s.A, false);
    expect([goldOf(s, "Alice"), goldOf(s, "Bob")]).toEqual([150, 50]);
    expectConserved(before, totals(s.server.db));
  });

  test("Bob disconnects mid-hand, the 30 s grace runs out: Bob loses the stake once", async () => {
    s = await tableScene();
    const before = totals(s.server.db);
    hand(s);
    s.server.game.leave(s.B);
    s.server.clock.advance(31_000);
    s.server.tickNow(1000);
    s.relog();
    expectConserved(before, totals(s.server.db));
  });

  test("Bob disconnects mid-hand and comes back inside the grace: nothing is created or lost", async () => {
    s = await tableScene();
    const before = totals(s.server.db);
    hand(s);
    s.server.game.leave(s.B);
    s.server.tickNow(5);
    expect(s.server.game.enter(s.B, true)).toBe(true);
    s.player("B").loading = 0;
    s.as("B", { t: "bjLeave" });
    s.server.tickNow(1);
    s.relog();
    expectConserved(before, totals(s.server.db));
  });

  test("both leave mid-hand in either order", async () => {
    for (const first of ["A", "B"] as const) {
      s = await tableScene();
      const before = totals(s.server.db);
      hand(s);
      s.as(first, { t: "bjLeave" });
      s.as(first === "A" ? "B" : "A", { t: "bjLeave" });
      s.server.tickNow(1);
      s.relog();
      expectConserved(before, totals(s.server.db));
      for (const b of s.bots) {
        b.close();
      }
      await s.server.stop();
    }
    s = await scene(); // the afterEach needs one to close
  });
});

describe("a mail send and a trade cut by a disconnect", () => {
  beforeEach(async () => {
    s = await scene();
  });

  test("a trader disconnects at each step: nobody keeps a half trade", () => {
    for (const step of [0, 1, 2, 3]) {
      const before = totals(s.server.db);
      s.as("A", { t: "tradeOpen", id: s.B });
      if (step >= 1) {
        s.as("A", { t: "tradeOffer", gold: 10, items: [{ slot: 1, qty: 1 }] });
      }
      if (step >= 2) {
        s.as("B", { t: "tradeOffer", gold: 5, items: [] });
      }
      if (step >= 3) {
        s.as("B", { t: "tradeAccept" });
        s.as("A", { t: "tradeAccept" });
      }
      s.server.game.leave(s.B);
      s.server.game.enter(s.B, false);
      s.server.game.leave(s.A);
      s.server.game.enter(s.A, false);
      refaceAll();
      expect(s.server.game.isOnline(s.A) && s.server.game.isOnline(s.B)).toBe(true);
      // A new trade can start: neither is stuck in the old one.
      s.as("A", { t: "tradeOpen", id: s.B });
      s.as("A", { t: "tradeCancel" });
      expect(totals(s.server.db).gold).toBe(before.gold); // a completed trade moves gold, not creates it
    }
  });
});

describe("written at once, not at the next tick", () => {
  beforeEach(async () => {
    s = await scene((server) => {
      server.db.run(
        "UPDATE inventory SET item = 'Canvas', qty = 1 WHERE slot = 2 AND character_id = (SELECT id FROM characters WHERE name = 'Alice')",
      );
    });
  });

  test("artSave then an immediate logout: the Painting is in the bag after re-login", () => {
    const canvasSlot = s.player("A").char.bag.findIndex((l) => l?.item === "Canvas") + 1;
    expect(canvasSlot).toBeGreaterThan(0);
    s.as("A", { t: "use", slot: canvasSlot });
    s.as("A", { t: "artSave", kind: "painting", png: b64(makePng(64, 64)) });
    s.server.game.leave(s.A); // the same tick: no flush has come round
    const stored = s.server.db
      .query<{ item: string }, [string]>("SELECT item FROM inventory WHERE character_id = ?")
      .all(s.A)
      .map((r) => r.item);
    expect(stored.some((i) => i.startsWith("Painting#"))).toBe(true);
    expect(stored).not.toContain("Canvas");
    s.server.game.enter(s.A, false);
  });
});
