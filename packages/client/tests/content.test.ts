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
  (data.casino as ContentData["casino"]).blackjack.maxBid = maxBid;
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
    expect(store.casino.blackjack.maxBid).toBe(7);
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
      handle: (m) => seen.push({ t: m.t, maxBid: content().casino.blackjack.maxBid }),
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

  test("a store that cannot be fetched keeps the old one and lets messages through", async () => {
    const { fetchImpl } = server({}, "x");
    const handled: string[] = [];
    const warned: string[] = [];
    const sync = createContentSync({
      handle: (m) => handled.push(m.t),
      fetch: fetchImpl,
      warn: (t) => warned.push(t),
    });
    sync.receive(welcome("gone"));
    await settle();
    await settle();
    expect(handled).toEqual(["welcome"]);
    expect(warned).toHaveLength(1);
    expect(content().hash).toBe("");
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
    const sync = createContentSync({ handle: () => {}, fetch: fetchImpl, warn: () => {} });
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
