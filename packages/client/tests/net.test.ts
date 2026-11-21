import { afterEach, describe, expect, test } from "bun:test";

import { CLOSE } from "@secondstaronline/shared";

import { connect, connectRetrying, RESUME_DELAY_MS } from "../src/net.ts";

type Listener = (e: { code?: number; data?: string }) => void;

/** A WebSocket stand-in the test drives by hand. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  fire(type: string, e: { code?: number; data?: string } = {}) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(e);
    }
  }
}

const realWebSocket = globalThis.WebSocket;
const realSetTimeout = globalThis.setTimeout;
afterEach(async () => {
  // Let a resume an earlier test scheduled run now, not inside the next test.
  await new Promise((r) => realSetTimeout(r, 5));
  globalThis.WebSocket = realWebSocket;
  globalThis.setTimeout = realSetTimeout;
  FakeSocket.all = [];
});

/** Connects, logs in with a token, closes the socket with `code`; reports whether a resume was scheduled. */
async function closeWith(code: number): Promise<{ resumeDelay: number | null; gone: boolean }> {
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  let resumeDelay: number | null = null;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    resumeDelay = ms ?? 0;
    return realSetTimeout(fn, 0);
  }) as typeof setTimeout;
  const pending = connect("ws://test/ws");
  const sock = FakeSocket.all[0];
  if (!sock) {
    throw new Error("no socket");
  }
  sock.fire("open");
  const conn = await pending;
  let gone = false;
  conn.onGone = () => {
    gone = true;
  };
  sock.fire("message", {
    data: JSON.stringify({ t: "welcome", token: "tok", id: "a", name: "A", protocol: 1 }),
  });
  sock.fire("close", { code });
  return { resumeDelay, gone };
}

describe("net: which close codes resume", () => {
  test("4007 (fell behind) resumes after the usual delay and is not final", async () => {
    expect(CLOSE.behind.code).toBe(4007);
    const r = await closeWith(4007);
    expect(r.gone).toBe(false);
    expect(r.resumeDelay).toBe(RESUME_DELAY_MS);
  });

  test("4006 (too many connections) is final: no resume", async () => {
    const r = await closeWith(CLOSE.tooManyConnections.code);
    expect(r.gone).toBe(true);
    expect(r.resumeDelay).toBeNull();
  });
});

describe("net: a refused resume", () => {
  test("ends the session once with the server's text, closes the socket and asks for Load Character", async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
    const pending = connect("ws://test/ws");
    const first = FakeSocket.all[0]!;
    first.fire("open");
    const conn = await pending;
    const gone: (string | null)[] = [];
    const relogins: (boolean | undefined)[] = [];
    const passed: string[] = [];
    conn.onGone = (text, relogin) => {
      gone.push(text);
      relogins.push(relogin);
    };
    conn.onMessage = (msg) => passed.push(msg.t);
    first.fire("message", {
      data: JSON.stringify({ t: "welcome", token: "tok", id: "a", name: "A", protocol: 1 }),
    });
    first.fire("close", { code: 1006 });
    await new Promise((r) => realSetTimeout(r, 5));
    const second = FakeSocket.all[1]!;
    let closed = false;
    second.close = () => {
      closed = true;
    };
    second.fire("open");
    expect(JSON.parse(second.sent[0]!)).toEqual({ t: "resume", token: "tok" });
    second.fire("message", {
      data: JSON.stringify({ t: "denied", text: "Your session has ended. Please log in again." }),
    });
    // The app goes back to the title through onGone; the game screen never sees a bare `denied`
    // (it would stay up over a socket the server treats as logged out, its Log out ignored).
    expect(gone).toEqual(["Your session has ended. Please log in again."]);
    // Back to Load Character, not the title: the player meant to stay logged in.
    expect(relogins).toEqual([true]);
    expect(passed).toEqual(["welcome"]);
    expect(closed).toBe(true);
    expect(conn.token).toBeNull();
    second.fire("close", { code: 1000 });
    expect(gone).toHaveLength(1);
  });

  test("a denied login (no resume in flight) still reaches the app", async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const pending = connect("ws://test/ws");
    const sock = FakeSocket.all[0]!;
    sock.fire("open");
    const conn = await pending;
    const passed: string[] = [];
    let gone = false;
    conn.onGone = () => {
      gone = true;
    };
    conn.onMessage = (msg) => passed.push(msg.t);
    sock.fire("message", { data: JSON.stringify({ t: "denied", text: "Wrong password." }) });
    expect(passed).toEqual(["denied"]);
    expect(gone).toBe(false);
  });
});

describe("net: a fresh connection while the server restarts", () => {
  test("retries after the usual delay instead of failing for good", async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const delays: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as typeof setTimeout;
    const pending = connectRetrying(() => false, "ws://test/ws");
    // The server is down: the first socket closes without opening.
    FakeSocket.all[0]!.fire("close", { code: 1006 });
    await new Promise((r) => realSetTimeout(r, 5));
    FakeSocket.all[1]!.fire("open");
    const conn = await pending;
    expect(conn).not.toBeNull();
    expect(delays).toEqual([RESUME_DELAY_MS]);
  });

  test("gives up once the app has stopped", async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const pending = connectRetrying(() => true, "ws://test/ws");
    FakeSocket.all[0]!.fire("close", { code: 1006 });
    expect(await pending).toBeNull();
    expect(FakeSocket.all).toHaveLength(1);
  });
});
