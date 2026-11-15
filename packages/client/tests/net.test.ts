import { afterEach, describe, expect, test } from "bun:test";

import { CLOSE } from "@secondstaronline/shared";

import { connect, RESUME_DELAY_MS } from "../src/net.ts";

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
afterEach(() => {
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
