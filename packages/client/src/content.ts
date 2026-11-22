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

/** Fetches a store: the one with `hash`, or the server's current one. */
export async function fetchContent(
  hash: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<ContentStore> {
  let want = hash;
  if (want === null) {
    const res = await fetchImpl(`${CONTENT_URL}current.json`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("the server sent no content");
    }
    want = ((await res.json()) as { hash: string }).hash;
  }
  const res = await fetchImpl(`${CONTENT_URL}${want}.json`);
  if (!res.ok) {
    throw new Error(`content ${want} is not on the server`);
  }
  return storeFromFile((await res.json()) as ContentFile);
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
}

export interface ContentSync {
  /** Every server message goes through here. */
  receive(msg: ServerMsg): void;
  /** True while a new store is on its way (messages wait). */
  readonly syncing: boolean;
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
 * (that one included) until it is installed, then handles them in order. A fetch that fails
 * keeps the store the client has and lets the messages through.
 */
export function createContentSync(opts: ContentSyncOptions): ContentSync {
  const fetchImpl = opts.fetch ?? fetch;
  const install = opts.install ?? installContent;
  const reload = opts.reload ?? (() => location.reload());
  const warn = opts.warn ?? ((t: string) => console.warn(t));
  const waiting: ServerMsg[] = [];
  let syncing = false;
  let wanted: string | null = null;
  /** A hash whose fetch failed: its messages go through on the store the client has. */
  let failed: string | null = null;

  const drain = () => {
    syncing = false;
    while (waiting.length > 0 && !syncing) {
      const msg = waiting.shift() as ServerMsg;
      step(msg);
    }
  };

  const fetchStore = (hash: string) => {
    syncing = true;
    wanted = hash;
    fetchContent(hash, fetchImpl).then(
      (store) => {
        if (wanted === hash) {
          install(store);
          opts.installed?.(store);
        }
        drain();
      },
      (err: unknown) => {
        if (err instanceof ContentFormatError) {
          reload();
          return;
        }
        failed = hash;
        warn(
          `could not fetch content ${hash}: ${err instanceof Error ? err.message : String(err)}`,
        );
        drain();
      },
    );
  };

  function step(msg: ServerMsg): void {
    const hash = hashOf(msg);
    if (hash !== null && hash !== failed && hash !== (hasContent() ? content().hash : null)) {
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
  };
}
