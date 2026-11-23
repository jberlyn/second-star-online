import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { setHashOptionsForTests } from "../src/persistence/accounts.ts";
import { TEST_HASH_OPTIONS } from "../tests/helpers/fast-hash.ts";
import {
  connectBot,
  login,
  make,
  settle,
  startTestServer,
  type TestServer,
  tick,
} from "./harness.ts";

// `settle()` waits on the gateway's per-socket counts, not a fixed time: what it promises.
describe("settle", () => {
  let server: TestServer;
  beforeAll(() => {
    server = startTestServer();
  });
  afterAll(async () => {
    await server.stop();
  });

  test("waits out a creation's password hash at the real cost", async () => {
    setHashOptionsForTests(null);
    try {
      const bot = await connectBot(server.wsUrl);
      bot.send(make("Settler"));
      await settle();
      expect(bot.inbox.some((m) => m.t === "created")).toBe(true);
      bot.close();
      await settle();
    } finally {
      setHashOptionsForTests(TEST_HASH_OPTIONS);
    }
  });

  test("a chat line reaches every other bot on the map before it returns", async () => {
    const a = await login(server, "Settler");
    const others = [];
    for (const name of ["Settlerb", "Settlerc"]) {
      const b = await connectBot(server.wsUrl);
      b.send(make(name));
      await b.waitFor((m) => m.t === "created");
      b.close();
      await settle();
      others.push(await login(server, name));
    }
    for (const b of others) {
      b.clear();
    }
    a.send({ t: "chat", text: "hello there" });
    await settle();
    await tick(server, 1);
    for (const b of others) {
      expect(
        b.inbox.some((m) => JSON.stringify(m).includes("hello there")),
        "a chat line arrived",
      ).toBe(true);
    }
    for (const b of [a, ...others]) {
      b.close();
    }
  });

  test("a closed bot stops being waited for once the server has seen it close", async () => {
    const bot = await login(server, "Settler");
    bot.close();
    await bot.closed;
    const started = performance.now();
    await settle();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
