import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  BJ_MAX_BID,
  buildContentStore,
  CONTENT_FORMAT,
  type ContentData,
  type ContentStore,
  content,
  installContent,
  type ServerMsg,
} from "@secondstaronline/shared";

import {
  type ContentFile,
  createContentSync,
  fetchContent,
  storeFromFile,
} from "../src/content.ts";

const classic = buildContentStore(classicData as ContentData);
afterEach(() => installContent(classic));

/** A content file for Classic with the blackjack bid limit changed, as a publish would make. */
function fileWith(maxBid: number, hash: string, format = CONTENT_FORMAT): ContentFile {
  const data = structuredClone(classicData) as Partial<ContentData>;
  delete data.npcFiles;
  delete data.rects;
  delete data.art;
  (data.casino as ContentData["casino"]).blackjack!.maxBid = maxBid;
  return { format, hash, data: data as ContentFile["data"] };
}

/** A fetch that serves the given files by hash, and `current.json`. */
function server(files: Record<string, ContentFile>, current: string) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    asked.push(url);
    if (url === "/content/current.json") {
      return Response.json({ hash: current });
    }
    const hash = url.replace("/content/", "").replace(".json", "");
    const f = files[hash];
    return f ? Response.json(f) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

const welcome = (hash?: string): ServerMsg => ({
  t: "welcome",
  protocol: 1,
  id: "me",
  name: "Me",
  token: "00000000-0000-7000-8000-000000000000",
  resumed: false,
  rules: { chatMaxChars: 120 },
  ...(hash ? { content: hash } : {}),
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the client's content", () => {
  test("is fetched from the server: the current hash, then the hashed file", async () => {
    const { fetchImpl, asked } = server({ abc: fileWith(7, "abc") }, "abc");
    const store = await fetchContent(null, fetchImpl);
    expect(asked).toEqual(["/content/current.json", "/content/abc.json"]);
    expect(store.hash).toBe("abc");
    expect(store.casino.blackjack!.maxBid).toBe(7);
    // The server-only datasets are empty on the client.
    expect(store.npcFiles.files).toEqual([]);
  });

  test("a file in another format asks for a reload", () => {
    expect(() => storeFromFile(fileWith(7, "abc", CONTENT_FORMAT + 1))).toThrow();
  });

  test("a publish swaps the store in, and the rules see it", async () => {
    const { fetchImpl } = server({ pub1: fileWith(5, "pub1") }, "pub1");
    const handled: string[] = [];
    const sync = createContentSync({ handle: (m) => handled.push(m.t), fetch: fetchImpl });
    sync.receive({ t: "content", hash: "pub1" });
    expect(sync.syncing).toBe(true);
    sync.receive({ t: "death" });
    // Messages wait for the new store.
    expect(handled).toEqual([]);
    await settle();
    await settle();
    expect(content().hash).toBe("pub1");
    expect(BJ_MAX_BID).toBe(5);
    expect(handled).toEqual(["death"]);
  });

  test("a login naming another store fetches it before the login is handled", async () => {
    const { fetchImpl, asked } = server({ dep: fileWith(9, "dep") }, "dep");
    const seen: { t: string; maxBid: number }[] = [];
    const sync = createContentSync({
      handle: (m) => seen.push({ t: m.t, maxBid: content().casino.blackjack!.maxBid }),
      fetch: fetchImpl,
    });
    sync.receive(welcome("dep"));
    await settle();
    await settle();
    expect(asked).toEqual(["/content/dep.json"]);
    expect(seen).toEqual([{ t: "welcome", maxBid: 9 }]);
  });

  test("a login naming the store the client has fetches nothing", () => {
    const { fetchImpl, asked } = server({}, "x");
    const installed: ContentStore[] = [];
    installContent(buildContentStore(classicData as ContentData, "same"));
    const handled: string[] = [];
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      install: (s) => installed.push(s),
    });
    sync.receive(welcome("same"));
    sync.receive(welcome());
    expect(handled).toEqual(["welcome", "welcome"]);
    expect(asked).toEqual([]);
  });

  test("a store that cannot be fetched is tried again while the messages wait", async () => {
    const files: Record<string, ContentFile> = {};
    const { fetchImpl } = server(files, "x");
    const handled: string[] = [];
    const timers: (() => void)[] = [];
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      warn: () => {},
      later: (_ms, fn) => timers.push(fn),
    });
    sync.receive(welcome("h1"));
    sync.receive({ t: "death" });
    await settle();
    await settle();
    // Still waiting: nothing is handled against the old store while a retry is due.
    expect(handled).toEqual([]);
    expect(sync.syncing).toBe(true);
    files.h1 = fileWith(3, "h1");
    timers.shift()?.();
    await settle();
    await settle();
    expect(content().hash).toBe("h1");
    expect(handled).toEqual(["welcome", "death"]);
  });

  test("once the retries are spent the messages go through, and the store is fetched in the background", async () => {
    const files: Record<string, ContentFile> = {};
    const { fetchImpl } = server(files, "x");
    const handled: string[] = [];
    const warned: string[] = [];
    const timers: (() => void)[] = [];
    let installed = 0;
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      warn: (t) => warned.push(t),
      retryDelays: [],
      later: (_ms, fn) => timers.push(fn),
      installed: () => {
        installed++;
      },
    });
    sync.receive(welcome("h1"));
    await settle();
    await settle();
    expect(handled).toEqual(["welcome"]);
    expect(warned).toHaveLength(1);
    expect(content().hash).toBe("");
    // The background retry fails too, and is tried again.
    timers.shift()?.();
    await settle();
    await settle();
    await settle();
    expect(content().hash).toBe("");
    expect(timers).toHaveLength(1);
    files.h1 = fileWith(3, "h1");
    timers.shift()?.();
    await settle();
    await settle();
    expect(content().hash).toBe("h1");
    expect(installed).toBe(1);
  });

  test("a fetch that hangs counts as failed", async () => {
    const hang = (async (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("timed out")));
      })) as unknown as typeof fetch;
    const handled: string[] = [];
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: hang,
      warn: () => {},
      retryDelays: [],
      later: () => {},
      timeoutMs: 5,
    });
    sync.receive(welcome("h1"));
    await new Promise((r) => setTimeout(r, 30));
    expect(handled).toEqual(["welcome"]);
  });

  test("a client too old for the server's content reloads", async () => {
    const { fetchImpl } = server({ new: fileWith(1, "new", CONTENT_FORMAT + 1) }, "new");
    let reloaded = 0;
    const sync = createContentSync({
      handle: () => {},
      fetch: fetchImpl,
      reload: () => {
        reloaded++;
      },
    });
    sync.receive({ t: "content", hash: "new" });
    await settle();
    await settle();
    expect(reloaded).toBe(1);
  });
});

describe("publishes in quick succession", () => {
  test("a hash the server no longer has falls back to its current store", async () => {
    const { fetchImpl, asked } = server({ newer: fileWith(4, "newer") }, "newer");
    const store = await fetchContent("gone", fetchImpl);
    expect(store.hash).toBe("newer");
    expect(asked).toEqual(["/content/gone.json", "/content/current.json", "/content/newer.json"]);
  });

  test("a store replaced while it was fetched is settled by the newer one, not fetched again", async () => {
    const { fetchImpl, asked } = server({ newer: fileWith(4, "newer") }, "newer");
    const handled: string[] = [];
    const sync = createContentSync({ handle: (m) => handled.push(m.t), fetch: fetchImpl });
    sync.receive({ t: "content", hash: "gone" });
    sync.receive({ t: "death" });
    await settle();
    await settle();
    await settle();
    expect(content().hash).toBe("newer");
    expect(handled).toEqual(["death"]);
    // The next publish message naming the newer store fetches nothing more.
    sync.receive({ t: "content", hash: "newer" });
    expect(asked.filter((u) => u.endsWith(".json"))).toHaveLength(3);
  });

  test("a hash that failed once is fetched again when a later publish names it (an undo back)", async () => {
    const files: Record<string, ContentFile> = {};
    const { fetchImpl } = server(files, "none");
    const sync = createContentSync({
      handle: () => {},
      fetch: fetchImpl,
      warn: () => {},
      retryDelays: [],
      later: () => {},
    });
    sync.receive({ t: "content", hash: "h1" });
    await settle();
    await settle();
    await settle();
    expect(content().hash).toBe("");
    files.h1 = fileWith(3, "h1");
    sync.receive({ t: "content", hash: "h1" });
    await settle();
    await settle();
    expect(content().hash).toBe("h1");
  });
});

test("a reset drops the dead session's waiting messages and ignores its store when it lands", async () => {
  const { fetchImpl } = server({ late: fileWith(6, "late") }, "late");
  const handled: string[] = [];
  const sync = createContentSync({ handle: (m) => handled.push(m.t), fetch: fetchImpl });
  sync.receive({ t: "content", hash: "late" });
  sync.receive({ t: "death" });
  sync.reset();
  await settle();
  await settle();
  expect(handled).toEqual([]);
  expect(content().hash).toBe("");
  expect(sync.syncing).toBe(false);
  // The next session works as before.
  sync.receive({ t: "death" });
  expect(handled).toEqual(["death"]);
});

describe("art published with the content (issue #29)", () => {
  test("a publish naming a new asset index loads the art before the messages that follow", async () => {
    const { fetchImpl } = server({}, "x");
    installContent(buildContentStore(classicData as ContentData, "same"));
    const handled: string[] = [];
    const loads: string[] = [];
    let done: () => void = () => {};
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      assets: (hash) => {
        loads.push(hash);
        return new Promise<void>((r) => {
          done = r;
        });
      },
    });
    sync.receive({ t: "content", hash: "same", assets: "a1" });
    sync.receive({ t: "death" });
    expect(loads).toEqual(["a1"]);
    expect(sync.syncing).toBe(true);
    expect(handled).toEqual([]);
    done();
    await settle();
    expect(handled).toEqual(["death"]);
    // The same index again (a publish that changed no art) loads nothing.
    sync.receive({ t: "content", hash: "same", assets: "a1" });
    sync.receive({ t: "death" });
    expect(loads).toEqual(["a1"]);
    expect(handled).toEqual(["death", "death"]);
  });

  test("art that stalls lets the messages through after the deadline, and is tried again until it loads", async () => {
    const { fetchImpl } = server({}, "x");
    installContent(buildContentStore(classicData as ContentData, "same"));
    const handled: string[] = [];
    const timers: { ms: number; fn: () => void }[] = [];
    const loads: string[] = [];
    let attempt = 0;
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      warn: () => {},
      timeoutMs: 15,
      recoverMs: 40,
      later: (ms, fn) => timers.push({ ms, fn }),
      assets: (hash) => {
        loads.push(hash);
        attempt += 1;
        // The first load never answers; the retry works.
        return attempt === 1 ? new Promise<void>(() => {}) : Promise.resolve();
      },
    });
    sync.receive({ t: "content", hash: "same", assets: "a3" });
    sync.receive({ t: "death" });
    expect(handled).toEqual([]);
    // The deadline passes: the messages go through.
    timers.shift()?.fn();
    expect(handled).toEqual(["death"]);
    // The background retry loads it, and the same index is not loaded a third time.
    timers.shift()?.fn();
    await settle();
    expect(loads).toEqual(["a3", "a3"]);
    sync.receive({ t: "content", hash: "same", assets: "a3" });
    expect(loads).toEqual(["a3", "a3"]);
  });

  test("art that failed is tried again in the background, without holding later messages", async () => {
    const { fetchImpl } = server({}, "x");
    installContent(buildContentStore(classicData as ContentData, "same"));
    const loads: string[] = [];
    const timers: (() => void)[] = [];
    const handled: string[] = [];
    let fail = true;
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      warn: () => {},
      later: (ms, fn) => {
        if (ms > 1000) {
          timers.push(fn);
        }
      },
      recoverMs: 30_000,
      assets: (hash) => {
        loads.push(hash);
        return fail ? Promise.reject(new Error("offline")) : Promise.resolve();
      },
    });
    sync.receive({ t: "content", hash: "same", assets: "a4" });
    await settle();
    // Another message naming it goes straight through while the retry is pending.
    sync.receive({ t: "content", hash: "same", assets: "a4" });
    sync.receive({ t: "death" });
    expect(handled).toEqual(["death"]);
    fail = false;
    timers.at(-1)?.();
    await settle();
    expect(loads).toEqual(["a4", "a4"]);
  });

  test("a login naming other art than the page loaded loads it before the login is handled", async () => {
    const { fetchImpl } = server({}, "x");
    installContent(buildContentStore(classicData as ContentData, "same"));
    const handled: string[] = [];
    let loaded = "a0";
    const loads: string[] = [];
    const sync = createContentSync({
      handle: (m) => handled.push(`${m.t}:${loaded}`),
      fetch: fetchImpl,
      assetsHash: () => loaded,
      assets: async (hash) => {
        loads.push(hash);
        loaded = hash;
      },
    });
    sync.receive({ ...welcome("same"), assets: "a0" } as ServerMsg);
    expect(loads).toEqual([]);
    sync.receive({ ...welcome("same"), assets: "a5" } as ServerMsg);
    await settle();
    expect(loads).toEqual(["a5"]);
    expect(handled).toEqual(["welcome:a0", "welcome:a5"]);
  });

  test("art that cannot be loaded lets the messages through", async () => {
    const { fetchImpl } = server({}, "x");
    installContent(buildContentStore(classicData as ContentData, "same"));
    const handled: string[] = [];
    const warned: string[] = [];
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      warn: (t) => warned.push(t),
      assets: () => Promise.reject(new Error("offline")),
    });
    sync.receive({ t: "content", hash: "same", assets: "a2" });
    sync.receive({ t: "death" });
    await settle();
    expect(handled).toEqual(["death"]);
    expect(warned).toEqual(["could not load the new art: offline"]);
  });
});
