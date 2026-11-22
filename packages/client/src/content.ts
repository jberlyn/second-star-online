/**
 * The content store on the client (issue #27). The client bundles no content: it fetches the
 * server's published store as a content-hashed file (`/content/<hash>.json`, cached by the
 * browser like the atlases) when it starts, and again whenever the hash it holds is not the
 * server's: the login message carries the hash (a deploy, or a publish while away), and each
 * publish sends the new one (`content`). Messages that arrive while a new store is on its way wait
 * for it, so nothing is handled against the old one.
 */
import {
  buildContentStore,
  CONTENT_FORMAT,
  type ContentData,
  type ContentStore,
  content,
  hasContent,
  installContent,
  type ServerMsg,
} from "@secondstaronline/shared";

export const CONTENT_URL = "/content/";

/** The file a client fetches: the store's datasets as the server sends them. */
export interface ContentFile {
  format: number;
  hash: string;
  data: Omit<ContentData, "npcFiles" | "rects">;
}

/** The server's store is in a format this client was not built for: reload to get the new client. */
export class ContentFormatError extends Error {}

/** The datasets only the server reads, empty on the client. */
const SERVER_ONLY_EMPTY = {
  npcFiles: { files: [] },
  rects: { fx: {}, chars: {}, items: {} },
} satisfies Pick<ContentData, "npcFiles" | "rects">;

/** Builds the client's store from a fetched file. */
export function storeFromFile(file: ContentFile): ContentStore {
  if (file.format !== CONTENT_FORMAT) {
    throw new ContentFormatError(
      `the server's content is format ${file.format}; this client reads ${CONTENT_FORMAT}`,
    );
  }
  return buildContentStore({ ...file.data, ...SERVER_ONLY_EMPTY } as ContentData, file.hash);
}

/** The server's current hash. */
async function currentHash(fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(`${CONTENT_URL}current.json`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("the server sent no content");
  }
  return ((await res.json()) as { hash: string }).hash;
}

/**
 * Fetches a store: the one with `hash`, or the server's current one. A hash the server no longer
 * has (several publishes went by) falls back to the current store, which is newer.
 */
export async function fetchContent(
  hash: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<ContentStore> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const want = hash !== null && attempt === 0 ? hash : await currentHash(fetchImpl);
    const res = await fetchImpl(`${CONTENT_URL}${want}.json`);
    if (res.ok) {
      return storeFromFile((await res.json()) as ContentFile);
    }
    if (res.status !== 404) {
      throw new Error(`content ${want} could not be fetched (${res.status})`);
    }
  }
  throw new Error("the server's content kept changing while it was fetched");
}

export interface ContentSyncOptions {
  /** Handles one server message (the app's handler). */
  handle(msg: ServerMsg): void;
  fetch?: typeof fetch;
  /** Installs a fetched store (default `installContent`). */
  install?(store: ContentStore): void;
  /** Reloads the page (a client too old for the server's content). */
  reload?(): void;
  /** Runs after a new store is installed. */
  installed?(store: ContentStore): void;
  /** Reports a store that could not be fetched (default `console.warn`). */
  warn?(text: string): void;
  /**
   * The waits before each retry of a fetch that failed, while messages keep waiting (default 1, 3
   * and 9 seconds). Once they are spent the messages go through on the store the client has, and
   * the fetch is tried again every `recoverMs` until the store arrives.
   */
  retryDelays?: readonly number[];
  /** How often a store that could not be fetched is tried again in the background (default 30 s). */
  recoverMs?: number;
  /** How long one fetch may take before it counts as failed (default 15 s). */
  timeoutMs?: number;
  /** Runs `fn` after `ms` (default `setTimeout`). */
  later?(ms: number, fn: () => void): void;
}

export interface ContentSync {
  /** Every server message goes through here. */
  receive(msg: ServerMsg): void;
  /** True while a new store is on its way (messages wait). */
  readonly syncing: boolean;
  /**
   * The connection went: the messages waiting are the dead session's, so they go, and a store
   * still on its way is not installed against the next session's messages.
   */
  reset(): void;
}

/** The hash a message says the server's store has, when it says one. */
function hashOf(msg: ServerMsg): string | null {
  if (msg.t === "welcome") {
    return msg.content ?? null;
  }
  if (msg.t === "content") {
    return msg.hash;
  }
  return null;
}

/**
 * Follows the server's store: a message naming another hash fetches it and holds every message
 * (that one included) until it is installed, then handles them in order. A fetch that fails is
 * tried again a few times while the messages wait; after that they go through on the store the
 * client has, and the fetch keeps being tried in the background until the store arrives, so a
 * client is never left on old rules for good.
 */
export function createContentSync(opts: ContentSyncOptions): ContentSync {
  const baseFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  // A fetch that hangs counts as failed, so it is tried again instead of holding messages for ever.
  const fetchImpl = ((url: string, init?: RequestInit) =>
    baseFetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })) as unknown as typeof fetch;
  const retryDelays = opts.retryDelays ?? [1000, 3000, 9000];
  const recoverMs = opts.recoverMs ?? 30_000;
  const later = opts.later ?? ((ms: number, fn: () => void) => void setTimeout(fn, ms));
  const install = opts.install ?? installContent;
  const reload = opts.reload ?? (() => location.reload());
  const warn = opts.warn ?? ((t: string) => console.warn(t));
  const waiting: ServerMsg[] = [];
  let syncing = false;
  let wanted: string | null = null;
  /**
   * Hashes answered while the waiting messages drain: one a newer store replaced while it was
   * fetched, or one whose fetch failed (its messages go through on the store the client has rather
   * than wait for ever). Forgotten once the queue is empty, so a later message naming that hash
   * (an undo back to it, a reconnect) fetches it again.
   */
  const settled = new Set<string>();
  /** Counts connections: a fetch begun under an earlier one is ignored when it lands. */
  let generation = 0;
  /** A store the client gave up waiting for, still fetched in the background. */
  let behind: string | null = null;

  const installStore = (store: ContentStore) => {
    install(store);
    opts.installed?.(store);
  };

  /** Tries the store the client is behind on again, now and then, until it arrives. */
  const recover = (hash: string, gen: number) => {
    later(recoverMs, () => {
      if (gen !== generation || behind !== hash || syncing) {
        return;
      }
      fetchContent(hash, fetchImpl).then(
        (store) => {
          if (gen !== generation || behind !== hash || syncing) {
            return;
          }
          behind = null;
          if (!hasContent() || content().hash !== store.hash) {
            installStore(store);
          }
        },
        (err: unknown) => {
          if (gen !== generation) {
            return;
          }
          if (err instanceof ContentFormatError) {
            reload();
            return;
          }
          recover(hash, gen);
        },
      );
    });
  };

  const drain = () => {
    syncing = false;
    while (waiting.length > 0 && !syncing) {
      const msg = waiting.shift() as ServerMsg;
      step(msg);
    }
    if (!syncing) {
      settled.clear();
    }
  };

  const fetchStore = (hash: string, attempt = 0) => {
    syncing = true;
    wanted = hash;
    behind = null;
    const gen = generation;
    fetchContent(hash, fetchImpl).then(
      (store) => {
        if (gen !== generation) {
          return;
        }
        if (wanted === hash) {
          installStore(store);
          // The server may have sent a newer store than the one asked for; either way the asked
          // hash is answered.
          settled.add(hash);
        }
        drain();
      },
      (err: unknown) => {
        if (gen !== generation) {
          return;
        }
        if (err instanceof ContentFormatError) {
          reload();
          return;
        }
        const wait = retryDelays[attempt];
        if (wait !== undefined) {
          later(wait, () => {
            if (gen === generation && wanted === hash) {
              fetchStore(hash, attempt + 1);
            }
          });
          return;
        }
        settled.add(hash);
        warn(
          `could not fetch content ${hash}, so the game runs on the content it has until it can: ${err instanceof Error ? err.message : String(err)}`,
        );
        behind = hash;
        recover(hash, gen);
        drain();
      },
    );
  };

  function step(msg: ServerMsg): void {
    const hash = hashOf(msg);
    if (hash !== null && !settled.has(hash) && hash !== (hasContent() ? content().hash : null)) {
      waiting.unshift(msg);
      fetchStore(hash);
      return;
    }
    if (msg.t !== "content") {
      opts.handle(msg);
    }
  }

  return {
    receive(msg) {
      if (syncing) {
        waiting.push(msg);
        return;
      }
      step(msg);
    },
    get syncing() {
      return syncing;
    },
    reset() {
      generation += 1;
      waiting.length = 0;
      settled.clear();
      syncing = false;
      wanted = null;
      behind = null;
    },
  };
}
