import { afterEach, describe, expect, test } from "bun:test";

import { DelayPipe, PROFILES, type Relay, seeded, startRelay } from "../src/relay.ts";

let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) {
    s();
  }
  stops = [];
});

/** An echo server on a free port: sends back what it gets, with a timestamp-free body. */
function echo() {
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("no", { status: 426 });
    },
    websocket: {
      message(ws, m) {
        ws.send(m);
      },
    },
  });
  stops.push(() => server.stop(true));
  return server;
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("connect failed")), { once: true });
    stops.push(() => ws.close());
  });
}

function startFor(profile: keyof typeof PROFILES): { relay: Relay; url: string } {
  const e = echo();
  const relay = startRelay({
    port: 0,
    upstream: `127.0.0.1:${e.port}`,
    profile: PROFILES[profile] ?? PROFILES.lan!,
    seed: 3,
  });
  stops.push(() => relay.stop());
  return { relay, url: `ws://127.0.0.1:${relay.port}/` };
}

describe("the delay pipe", () => {
  test("keeps order even when jitter would reorder", async () => {
    const out: string[] = [];
    const rand = seeded(5);
    const pipe = new DelayPipe(
      (p) => out.push(String(p)),
      () => rand() * 40,
    );
    for (let i = 0; i < 30; i++) {
      pipe.push(String(i));
    }
    await new Promise((r) => setTimeout(r, 120));
    expect(out).toEqual(Array.from({ length: 30 }, (_, i) => String(i)));
  });

  test("a stall holds everything until it ends", async () => {
    const out: string[] = [];
    const pipe = new DelayPipe(
      (p) => out.push(String(p)),
      () => 0,
    );
    pipe.stall(Date.now() + 80);
    pipe.push("a");
    await new Promise((r) => setTimeout(r, 40));
    expect(out).toEqual([]);
    await new Promise((r) => setTimeout(r, 80));
    expect(out).toEqual(["a"]);
  });

  test("reports when the queued bytes pass its budget and when they drain", async () => {
    const events: boolean[] = [];
    const pipe = new DelayPipe(
      () => {},
      () => 10,
      {
        budgetBytes: 10,
        onBacklog: (over) => events.push(over),
      },
    );
    pipe.push("0123456789012345");
    expect(events).toEqual([true]);
    await new Promise((r) => setTimeout(r, 40));
    expect(events).toEqual([true, false]);
  });
});

describe("the relay", () => {
  test("the lan profile adds almost nothing", async () => {
    const { url } = startFor("lan");
    const ws = await connect(url);
    const t0 = performance.now();
    const back = new Promise<string>((r) =>
      ws.addEventListener("message", (e) => r(String(e.data)), { once: true }),
    );
    ws.send("ping");
    expect(await back).toBe("ping");
    expect(performance.now() - t0).toBeLessThan(60);
  });

  test("the home profile delays a round trip by 100 ms plus jitter", async () => {
    const { url } = startFor("home");
    const ws = await connect(url);
    // The first message also waits for the upstream socket to open; measure the second.
    const once = () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        ws.addEventListener("message", () => resolve(performance.now() - t0), { once: true });
        ws.send("x");
      });
    await once();
    const ms = await once();
    expect(ms).toBeGreaterThanOrEqual(65);
    expect(ms).toBeLessThan(170);
  });

  test("messages come back in the order they were sent", async () => {
    const { url } = startFor("home");
    const ws = await connect(url);
    const got: string[] = [];
    ws.addEventListener("message", (e) => got.push(String(e.data)));
    for (let i = 0; i < 20; i++) {
      ws.send(String(i));
    }
    await new Promise((r) => setTimeout(r, 400));
    expect(got).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
  });
});
