/**
 * A TCP relay that stands between load bots and the server and delays what passes: a fixed
 * delay plus seeded jitter each way, and optional stalls, to stand in for home and mobile
 * connections. It moves bytes, so the WebSocket upgrade and every frame pass
 * untouched; order is kept, as TCP would. A stall or a byte-rate cap pauses the upstream
 * socket, so the server sees real TCP backpressure (the plan's `WebSocket.pause()` exists only
 * on the server side of Bun's API).
 *
 * Runnable as its own process: `bun src/relay.ts <port> <serverHost:port> <profile> [seed]`.
 */
import type { Socket } from "bun";

export interface Profile {
  name: string;
  /** One-way delay in ms, each direction; the round trip is twice this. */
  baseMs: number;
  /** Uniform jitter of ± this many ms on each message. */
  jitterMs: number;
  /** A stall of `minMs`-`maxMs` about every `everyMs`, in both directions. */
  stall?: { everyMs: number; minMs: number; maxMs: number };
  /** Caps the server-to-client direction (bytes a second) and so backs the server up. */
  downBytesPerSec?: number;
}

/** 0, 100, 150 and 250 ms round trips (the targets read the 150 ms one). */
export const PROFILES: Record<string, Profile> = {
  lan: { name: "lan", baseMs: 0, jitterMs: 0 },
  home: { name: "home", baseMs: 50, jitterMs: 15 },
  p150: { name: "p150", baseMs: 75, jitterMs: 20 },
  mobile: {
    name: "mobile",
    baseMs: 125,
    jitterMs: 40,
    stall: { everyMs: 120_000, minMs: 1000, maxMs: 3000 },
  },
  slow: { name: "slow", baseMs: 50, jitterMs: 15, downBytesPerSec: 4096 },
};

/** A small seeded generator (mulberry32), so a run repeats. */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Payload = string | Uint8Array;
const sizeOf = (p: Payload) => (typeof p === "string" ? p.length : p.byteLength);

/**
 * One direction of one link. `push` queues a message to be released after the delay; release
 * times never go backwards, so order is kept. `onBacklog(over)` is told when the queued bytes
 * pass or fall back under `budgetBytes`, so the caller can pause the sender.
 */
export class DelayPipe {
  private queue: { at: number; payload: Payload }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRelease = 0;
  private nextFree = 0;
  private queuedBytes = 0;
  private over = false;
  stallUntil = 0;

  constructor(
    private readonly deliver: (p: Payload) => void,
    private readonly delay: () => number,
    private readonly opts: {
      bytesPerSec?: number;
      budgetBytes?: number;
      onBacklog?: (over: boolean) => void;
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  push(payload: Payload): void {
    const now = this.now();
    let at = Math.max(this.lastRelease, now + this.delay(), this.stallUntil);
    if (this.opts.bytesPerSec) {
      this.nextFree =
        Math.max(this.nextFree, now) + (sizeOf(payload) * 1000) / this.opts.bytesPerSec;
      at = Math.max(at, this.nextFree);
    }
    this.lastRelease = at;
    this.queue.push({ at, payload });
    this.queuedBytes += sizeOf(payload);
    this.checkBacklog();
    this.arm();
  }

  /** A stall: nothing is released before `until`. */
  stall(until: number): void {
    this.stallUntil = Math.max(this.stallUntil, until);
    this.lastRelease = Math.max(this.lastRelease, until);
    for (const q of this.queue) {
      q.at = Math.max(q.at, until);
    }
    this.arm(true);
  }

  get queuedMessages(): number {
    return this.queue.length;
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
  }

  private checkBacklog(): void {
    const budget = this.opts.budgetBytes;
    if (budget === undefined || !this.opts.onBacklog) {
      return;
    }
    const over = this.queuedBytes > budget;
    if (over !== this.over) {
      this.over = over;
      this.opts.onBacklog(over);
    }
  }

  private arm(reset = false): void {
    if (reset && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const head = this.queue[0];
    if (this.timer || !head) {
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.flush();
      },
      Math.max(0, head.at - this.now()),
    );
  }

  private flush(): void {
    const now = this.now();
    let head = this.queue[0];
    while (head && head.at <= now) {
      this.queue.shift();
      this.queuedBytes -= sizeOf(head.payload);
      this.deliver(head.payload);
      head = this.queue[0];
    }
    this.checkBacklog();
    this.arm();
  }
}

export interface RelayOptions {
  port: number;
  /** The server, `host:port`. */
  upstream: string;
  profile: Profile | ((index: number) => Profile);
  seed?: number;
}

export interface Relay {
  port: number;
  connections(): number;
  stop(): void;
}

/** A socket with a write queue: `write` may take only part, the rest goes out on `drain`. */
class Out {
  private pending: Uint8Array[] = [];
  constructor(public socket: Socket<unknown> | null = null) {}
  write(data: Uint8Array): void {
    if (!this.socket) {
      this.pending.push(data);
      return;
    }
    this.pending.push(data);
    this.drain();
  }
  drain(): void {
    while (this.socket && this.pending.length > 0) {
      const head = this.pending[0] as Uint8Array;
      const n = this.socket.write(head);
      if (n < head.byteLength) {
        this.pending[0] = head.subarray(n);
        return;
      }
      this.pending.shift();
    }
  }
}

interface Link {
  index: number;
  client: Socket<unknown>;
  upstream: Socket<unknown> | null;
  toServer: Out;
  toClient: Out;
  up: DelayPipe;
  down: DelayPipe;
  stallTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export function startRelay(options: RelayOptions): Relay {
  const rand = seeded(options.seed ?? 1);
  let count = 0;
  const links = new Set<Link>();
  const [upHost = "127.0.0.1", upPort = "3000"] = options.upstream.split(":");
  const profileOf = (i: number) =>
    typeof options.profile === "function" ? options.profile(i) : options.profile;
  const linkOf = new WeakMap<Socket<unknown>, Link>();

  const closeLink = (link: Link) => {
    if (link.closed) {
      return;
    }
    link.closed = true;
    links.delete(link);
    if (link.stallTimer) {
      clearTimeout(link.stallTimer);
    }
    link.up.stop();
    link.down.stop();
    link.client.end();
    link.upstream?.end();
  };

  const scheduleStall = (link: Link, p: Profile) => {
    const s = p.stall;
    if (!s) {
      return;
    }
    link.stallTimer = setTimeout(
      () => {
        const len = s.minMs + rand() * (s.maxMs - s.minMs);
        const until = Date.now() + len;
        link.up.stall(until);
        link.down.stall(until);
        link.upstream?.pause();
        setTimeout(() => link.upstream?.resume(), len);
        scheduleStall(link, p);
      },
      s.everyMs * (0.5 + rand()),
    );
  };

  const listener = Bun.listen<unknown>({
    hostname: "127.0.0.1",
    port: options.port,
    socket: {
      async open(client) {
        const index = count++;
        const p = profileOf(index);
        const jitter = () => (p.jitterMs ? (rand() * 2 - 1) * p.jitterMs : 0);
        const delay = () => Math.max(0, p.baseMs + jitter());
        const toServer = new Out();
        const toClient = new Out(client);
        const link: Link = {
          index,
          client,
          upstream: null,
          toServer,
          toClient,
          up: new DelayPipe((m) => toServer.write(m as Uint8Array), delay),
          down: new DelayPipe((m) => toClient.write(m as Uint8Array), delay, {
            bytesPerSec: p.downBytesPerSec,
            // A second of the capped budget may wait; past that the server is made to wait.
            budgetBytes: p.downBytesPerSec,
            onBacklog: (over) => (over ? link.upstream?.pause() : link.upstream?.resume()),
          }),
          stallTimer: null,
          closed: false,
        };
        linkOf.set(client, link);
        links.add(link);
        scheduleStall(link, p);
        try {
          const upstream = await Bun.connect<unknown>({
            hostname: upHost,
            port: Number(upPort),
            socket: {
              open(sock) {
                linkOf.set(sock, link);
              },
              data(sock, data) {
                linkOf.get(sock)?.down.push(new Uint8Array(data));
              },
              drain() {
                link.toServer.drain();
              },
              close() {
                // What is queued drains first, then the client is closed.
                setTimeout(() => closeLink(link), p.baseMs + 5);
              },
              error() {},
            },
          });
          link.upstream = upstream;
          toServer.socket = upstream;
          toServer.drain();
        } catch {
          closeLink(link);
        }
      },
      data(client, data) {
        linkOf.get(client)?.up.push(new Uint8Array(data));
      },
      drain(client) {
        linkOf.get(client)?.toClient.drain();
      },
      close(client) {
        const link = linkOf.get(client);
        if (link) {
          closeLink(link);
        }
      },
      error() {},
    },
  });
  return {
    port: listener.port,
    connections: () => links.size,
    stop: () => {
      for (const l of [...links]) {
        closeLink(l);
      }
      listener.stop(true);
    },
  };
}

if (import.meta.main) {
  const [port, upstream, profileName = "lan", seed = "1"] = process.argv.slice(2);
  const profile = PROFILES[profileName];
  if (!port || !upstream || !profile) {
    console.error("usage: bun src/relay.ts <port> <host:port> <lan|home|p150|mobile|slow> [seed]");
    process.exit(1);
  }
  const r = startRelay({ port: Number(port), upstream, profile, seed: Number(seed) });
  console.log(`relay on ${r.port} -> ${upstream} (${profile.name})`);
}
