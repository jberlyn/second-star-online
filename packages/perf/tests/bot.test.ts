import { afterEach, describe, expect, test } from "bun:test";

import {
  connectBot,
  make,
  startTestServer,
  type TestServer,
} from "@secondstaronline/server/e2e/harness.ts";

import { startBot } from "../src/bot.ts";

let server: TestServer | undefined;
let driver: ReturnType<typeof setInterval> | undefined;
afterEach(async () => {
  clearInterval(driver);
  await server?.stop();
  server = undefined;
});

/** Runs the server's sim at the real 20 Hz, so the bot's own 50 ms timer keeps pace. */
function drive(s: TestServer) {
  driver = setInterval(() => {
    s.clock.advance(50);
    s.tickNow(1);
  }, 50);
}

describe("a load bot", () => {
  test("logs in, walks with the real client model, and counts exactly one snap when the server moves it mid-walk", async () => {
    server = startTestServer();
    const creator = await connectBot(server.wsUrl);
    creator.send(make("Walkaaa"));
    await creator.waitFor((m) => m.t === "created");
    creator.close();

    drive(server);
    const bot = startBot({
      url: server.wsUrl,
      name: "Walkaaa",
      password: "secret",
      role: "walker",
      seed: 4,
    });
    const until = async (f: () => boolean, ms = 5000) => {
      const t0 = Date.now();
      while (!f() && Date.now() - t0 < ms) {
        await Bun.sleep(20);
      }
      expect(f()).toBe(true);
    };
    await until(() => bot.model.self !== null && !bot.model.loading);
    // Let it walk: the first window shows walking ticks, answers and no snaps.
    let walked = 0;
    let snapsBefore = 0;
    let heard = 0;
    await until(() => {
      const w = bot.takeWindow();
      walked += w.walkTicks;
      snapsBefore += w.snapsPredicting;
      heard += w.messagesIn;
      return walked > 20;
    }, 20000);
    expect(heard).toBeGreaterThan(0);
    expect(snapsBefore).toBe(0);

    // The server moves the walker two tiles under its feet: a snap while predicting.
    const p = [...server.game.world.players.values()].find((x) => x.name === "Walkaaa");
    if (!p) {
      throw new Error("not in");
    }
    bot.takeWindow();
    let snaps = 0;
    for (let i = 0; i < 400 && snaps === 0; i++) {
      await Bun.sleep(25);
      if (bot.model.self && bot.model.self.predicted.size > 0 && snaps === 0) {
        p.x = p.x > 8 ? p.x - 3 : p.x + 3;
        p.forceYou = true;
        for (let k = 0; k < 40 && snaps === 0; k++) {
          await Bun.sleep(25);
          snaps = bot.takeWindow().snapsPredicting;
        }
      }
    }
    expect(snaps).toBe(1);
    bot.stop();
  }, 30000);
});
