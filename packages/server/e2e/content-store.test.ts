/**
 * Bot script for the live content store (issue #27): the server serves its published store as a
 * hashed file and names the hash at login. Alice, an administrator, changes the banking help topic
 * on the Content page: the draft is not live; once published, `/help banking` answers with the new
 * text for Bob at once, both clients are told the new hash, and the hashed file has the change. She
 * undoes the publish and everything is back. Bob, a player, may not use the Content page.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { content, type ServerMsg } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import { recentCheats } from "../src/persistence/admin.ts";
import {
  type Bot,
  chats,
  connectBot,
  login,
  make,
  settle,
  startTestServer,
  type TestServer,
} from "./harness.ts";

type Result = Extract<ServerMsg, { t: "contentResult" }>;
type Overview = Extract<ServerMsg, { t: "contentOverview" }>;

describe("the live content store", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let seq = 0;

  const ask = async <T extends ServerMsg>(
    bot: Bot,
    msg: Record<string, unknown>,
    t: T["t"],
  ): Promise<T> => {
    const s = ++seq;
    bot.send({ ...msg, seq: s } as never);
    return (await bot.waitFor((m) => m.t === t && "seq" in m && m.seq === s)) as T;
  };
  const fetchJson = async (path: string) => {
    const res = await fetch(new URL(path, server.url));
    return {
      status: res.status,
      cache: res.headers.get("cache-control"),
      body: res.ok ? await res.json() : null,
    };
  };

  beforeAll(async () => {
    server = startTestServer();
    for (const name of ["Alice", "Bob"]) {
      const bot = await connectBot(server.wsUrl);
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.close();
    }
    const acc = server.db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE name = ?")
      .get("Alice");
    setRole(server.db, acc?.account_id ?? "", "administrator", "2026-11-04T00:00:00.000Z");
    alice = await login(server, "Alice");
    bob = await login(server, "Bob");
  });

  afterAll(async () => {
    alice?.close();
    bob?.close();
    await server?.stop();
  });

  test("the login names the published store's hash, and the server serves that store", async () => {
    const welcome = alice.inbox.find((m) => m.t === "welcome");
    const hash = welcome?.t === "welcome" ? welcome.content : undefined;
    expect(hash).toBe(content().hash);
    const current = await fetchJson("/content/current.json");
    expect(current.body).toEqual({ hash });
    expect(current.cache).toBe("no-store");
    const file = await fetchJson(`/content/${hash}.json`);
    expect(file.cache).toContain("immutable");
    expect(file.body.hash).toBe(hash);
    expect(file.body.data.items.items.length).toBe(content().items.items.length);
    // The NPC files and collision rects stay on the server.
    expect(file.body.data.npcFiles).toBeUndefined();
    expect((await fetchJson("/content/0000000000000000.json")).status).toBe(404);
  });

  test("a player may not use the Content page", async () => {
    bob.send({ t: "contentOverview", seq: 1 });
    await settle();
    expect(bob.inbox.some((m) => m.t === "contentOverview")).toBe(false);
    expect(recentCheats(server.db, 5).some((c) => c.name === "Bob")).toBe(true);
  });

  test("a published edit changes the game live, and every client is told the new store", async () => {
    const before = content().hash;
    const row = await ask<Extract<ServerMsg, { t: "contentRow" }>>(
      alice,
      { t: "contentRow", dataset: "help", part: "topics", key: "banking.txt" },
      "contentRow",
    );
    expect(row.row?.status).toBe("pack");
    const topic = {
      ...(row.row?.published as Record<string, unknown>),
      lines: ["The bank is closed today."],
    };
    const drafted = await ask<Result>(
      alice,
      {
        t: "contentDraft",
        dataset: "help",
        part: "topics",
        key: "banking.txt",
        op: "set",
        data: topic,
      },
      "contentResult",
    );
    expect(drafted.ok).toBe(true);
    // A draft is not live.
    bob.send({ t: "chat", text: "/help banking" });
    await settle();
    expect(chats(bob)).not.toContain("The bank is closed today.");

    const overview = await ask<Overview>(alice, { t: "contentOverview" }, "contentOverview");
    expect(overview.overview.draft).toHaveLength(1);
    expect(overview.overview.problems).toEqual([]);
    expect(overview.overview.packs[0]).toMatchObject({ id: "classic", name: "Classic" });
    const seen = overview.overview.draft.map(({ dataset, part, key, updatedAt }) => ({
      dataset,
      part,
      key,
      updatedAt,
    }));
    const published = await ask<Result>(
      alice,
      { t: "contentPublish", summary: "Close the bank", seen },
      "contentResult",
    );
    expect(published.ok).toBe(true);
    const hash = content().hash;
    expect(hash).not.toBe(before);

    // Both clients are told the new hash...
    for (const bot of [alice, bob]) {
      const msg = await bot.waitFor((m) => m.t === "content");
      expect(msg).toEqual({ t: "content", hash });
    }
    // ...the hashed file has the change...
    const file = await fetchJson(`/content/${hash}.json`);
    expect(
      file.body.data.help.topics.find((t: { file: string }) => t.file === "banking.txt").lines,
    ).toEqual(["The bank is closed today."]);
    // ...and the server plays by it at once.
    bob.send({ t: "chat", text: "/help banking" });
    await settle();
    expect(chats(bob)).toContain("The bank is closed today.");

    // A client logging in now is told the new hash.
    bob.close();
    bob = await login(server, "Bob");
    const welcome = bob.inbox.find((m) => m.t === "welcome");
    expect(welcome?.t === "welcome" ? welcome.content : "").toBe(hash);

    // Undo puts it back.
    const history = await ask<Overview>(alice, { t: "contentOverview" }, "contentOverview");
    const id = history.overview.history[0]?.id as string;
    const undone = await ask<Result>(alice, { t: "contentUndo", id }, "contentResult");
    expect(undone.ok).toBe(true);
    expect(content().hash).toBe(before);
    bob.inbox.length = 0;
    bob.send({ t: "chat", text: "/help banking" });
    await settle();
    expect(chats(bob)).not.toContain("The bank is closed today.");
  });
});
