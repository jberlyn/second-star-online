/**
 * The content store's row requests as promises, for the Control Panel pages built from content
 * forms (content-area-page.ts): list a part's rows, open one, put a change in the draft or take it
 * out. Each request carries a sequence number from its own range, so its answer is told apart from
 * the Content page's.
 */
import type {
  ContentListing,
  ContentProblemView,
  ContentRowDetail,
  ContentRowRef,
} from "@secondstaronline/shared";

/** What a change's answer says. */
export interface ContentAnswer {
  ok: boolean;
  text: string;
  problems?: ContentProblemView[];
}

/** The messages the requests send (the app sends them to the server). */
export type ContentRequestMsg =
  | { t: "contentList"; seq: number; dataset: string; part: string }
  | ({ t: "contentRow"; seq: number } & ContentRowRef)
  | ({
      t: "contentDraft";
      seq: number;
      op: "set" | "remove" | "revert";
      data: unknown;
      expect?: string;
    } & ContentRowRef)
  | ({ t: "contentDiscard"; seq: number; expect?: string } & ContentRowRef);

/** The answers they take back. */
export type ContentRequestReply =
  | { t: "contentList"; seq: number; listing: ContentListing | null; error?: string }
  | { t: "contentRow"; seq: number; row: ContentRowDetail | null; error?: string }
  | { t: "contentResult"; seq: number; ok: boolean; text: string; problems?: ContentProblemView[] };

export interface ContentRequests {
  list(dataset: string, part: string): Promise<ContentListing>;
  row(ref: ContentRowRef): Promise<ContentRowDetail>;
  draft(
    ref: ContentRowRef,
    op: "set" | "remove" | "revert",
    data: unknown,
    expect?: string,
  ): Promise<ContentAnswer>;
  discard(ref: ContentRowRef, expect?: string): Promise<ContentAnswer>;
  /** Takes an answer that is one of ours: true when it was. */
  receive(msg: { t: string; seq?: number }): boolean;
  /** A new session: every request still waiting fails. */
  reset(): void;
}

/** The first sequence number these requests use (the pages' own counters stay far below it). */
export const REQUEST_SEQ_BASE = 1_500_000_000;

export function createContentRequests(send: (msg: ContentRequestMsg) => void): ContentRequests {
  let seq = REQUEST_SEQ_BASE;
  const waiting = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>();
  const ask = <T>(make: (seq: number) => ContentRequestMsg): Promise<T> =>
    new Promise<T>((ok, fail) => {
      seq = seq >= 2 ** 31 - 1 ? REQUEST_SEQ_BASE : seq + 1;
      waiting.set(seq, { ok: ok as (v: unknown) => void, fail });
      send(make(seq));
    });
  const ref = (r: ContentRowRef) => ({ dataset: r.dataset, part: r.part, key: r.key });
  return {
    list: async (dataset, part) => {
      const m = await ask<Extract<ContentRequestReply, { t: "contentList" }>>((seq) => ({
        t: "contentList",
        seq,
        dataset,
        part,
      }));
      if (!m.listing) {
        throw new Error(m.error ?? "That list could not be loaded.");
      }
      return m.listing;
    },
    row: async (r) => {
      const m = await ask<Extract<ContentRequestReply, { t: "contentRow" }>>((seq) => ({
        t: "contentRow",
        seq,
        ...ref(r),
      }));
      if (!m.row) {
        throw new Error(m.error ?? "That could not be loaded.");
      }
      return m.row;
    },
    draft: async (r, op, data, expect) => {
      const m = await ask<Extract<ContentRequestReply, { t: "contentResult" }>>((seq) => ({
        t: "contentDraft",
        seq,
        ...ref(r),
        op,
        data,
        ...(expect !== undefined ? { expect } : {}),
      }));
      return { ok: m.ok, text: m.text, ...(m.problems ? { problems: m.problems } : {}) };
    },
    discard: async (r, expect) => {
      const m = await ask<Extract<ContentRequestReply, { t: "contentResult" }>>((seq) => ({
        t: "contentDiscard",
        seq,
        ...ref(r),
        ...(expect !== undefined ? { expect } : {}),
      }));
      return { ok: m.ok, text: m.text, ...(m.problems ? { problems: m.problems } : {}) };
    },
    receive(msg) {
      if (typeof msg.seq !== "number") {
        return false;
      }
      const w = waiting.get(msg.seq);
      if (!w) {
        return false;
      }
      waiting.delete(msg.seq);
      w.ok(msg);
      return true;
    },
    reset() {
      for (const w of waiting.values()) {
        w.fail(new Error("The connection was reset."));
      }
      waiting.clear();
    },
  };
}
