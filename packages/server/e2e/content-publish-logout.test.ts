/**
 * "Log everyone out while publishing" through the real gateway (issue #40). Alice, an
 * administrator, publishes with the box ticked: Bob, online, gets the alert and his socket closes
 * as a kick, and his resume token is gone, so a resume is refused; he logs in again once it is
 * through. Carol had dropped and is within the reconnect grace: her resume is refused while the
 * publish runs, and works after it. Alice stays.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { CLOSE, type ServerMsg, TEXT } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import {
  type Bot,
  connectBot,
  idOf,
  login,
  make,
  settle,
  startTestServer,
  type TestServer,
} from "./harness.ts";

type Welcome = Extract<ServerMsg, { t: "welcome" }>;

describe("logging everyone out while publishing, through the gateway", () => {
  let server: TestServer;
  let alice: Bot;

  beforeAll(async () => {
    server = startTestServer();
    for (const name of ["Alice", "Bob", "Carol"]) {
      const bot = await connectBot(server.wsUrl);
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.close();
    }
    const acc = server.db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE name = ?")
      .get("Alice");
    setRole(server.db, acc?.account_id ?? "", "administrator", "2026-11-25T00:00:00.000Z");
    alice = await login(server, "Alice");
  });

  afterAll(async () => {
    alice?.close();
    await server?.stop();
  });

  const tokenOf = (bot: Bot) =>
    (bot.inbox.find((m) => m.t === "welcome") as Welcome | undefined)?.token ?? "";

  async function resume(token: string): Promise<ServerMsg> {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "resume", token });
    const answer = await bot.waitFor((m) => m.t === "welcome" || m.t === "denied");
    bot.close();
    await settle();
    return answer;
  }

  test("players are kicked with the alert, their tokens end, and a resume in grace waits for the lock", async () => {
    const bob = await login(server, "Bob");
    const bobToken = tokenOf(bob);
    // Carol drops: her session waits out the reconnect grace, off the map.
    const carol = await login(server, "Carol");
    const carolToken = tokenOf(carol);
    carol.close();
    await carol.closed;
    await settle();
    const carolId = idOf(server.db, "Carol");
    expect(server.game.isOnline(carolId)).toBe(false);

    const actor = { accountId: "x", name: "Alice" };
    expect(
      server.content.draftSet(actor, { dataset: "casino", part: "slots", key: null }, "set", {
        ...server.content.publishedContent().casino.slots,
        cost: 25,
      }).ok,
    ).toBe(true);
    // What a resume of Carol's session gets while the publish runs: the gateway asks the game.
    const publish = server.content.publish.bind(server.content);
    let carolDuring: string | null = null;
    server.content.publish = (...args) => {
      carolDuring = server.game.refusal(carolId, "127.0.0.1");
      return publish(...args);
    };
    alice.send({
      t: "contentPublish",
      seq: 1,
      summary: "Dearer slots",
      draftRev: server.content.draftRev(),
      logoutEveryone: true,
    });
    const result = await alice.waitFor((m) => m.t === "contentResult" && m.seq === 1);
    server.content.publish = publish;
    expect(result).toMatchObject({ ok: true });

    // Bob: the alert, then the kick's close.
    const kicked = await bob.waitFor((m) => m.t === "kicked");
    expect(kicked).toEqual({ t: "kicked", text: TEXT.publishing });
    expect((await bob.closed).code).toBe(CLOSE.kicked.code);
    await settle();
    expect(server.game.isOnline(idOf(server.db, "Bob"))).toBe(false);
    expect(server.game.isOnline(idOf(server.db, "Alice"))).toBe(true);

    // Carol's resume was refused during the lock with the publishing text.
    expect(carolDuring as string | null).toBe(TEXT.publishing);

    // Bob's resume token went with the kick; a password login works now the publish is through.
    expect(await resume(bobToken)).toEqual({ t: "denied", text: TEXT.resumeFailed });
    const again = await login(server, "Bob");
    expect(again.inbox.some((m) => m.t === "welcome")).toBe(true);
    again.close();
    // Carol, still within the grace, resumes.
    expect((await resume(carolToken)).t).toBe("welcome");
    await settle();
  });
});
