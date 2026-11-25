/**
 * The content row requests (ui/content-requests.ts): answers find their request by number, and a
 * page asking for many rows never has more than a few waiting at once, so a publish refreshing
 * every form can't spend the connection's message allowance in one burst (the gateway closes a
 * connection that floods).
 */
import { expect, test } from "bun:test";

import {
  type ContentRequestMsg,
  createContentRequests,
  MAX_IN_FLIGHT,
  REQUEST_SEQ_BASE,
} from "../src/ui/content-requests.ts";

const rowAnswer = (seq: number, part: string) => ({
  t: "contentRow" as const,
  seq,
  row: {
    dataset: "social",
    part,
    key: null,
    keyField: null,
    readOnly: false,
    status: "pack" as const,
    pack: {},
    published: {},
    draft: null,
  },
});

test("only a few requests wait at once; the rest go as answers come", async () => {
  const sent: ContentRequestMsg[] = [];
  const r = createContentRequests((m) => sent.push(m));
  const parts = Array.from({ length: 20 }, (_, i) => `part${i}`);
  const answers = parts.map((part) => r.row({ dataset: "social", part, key: null }));
  expect(sent).toHaveLength(MAX_IN_FLIGHT);
  // Each answer lets the next request go, until every one has been asked and answered.
  for (let i = 0; i < sent.length; i++) {
    const m = sent[i] as ContentRequestMsg & { part: string };
    expect(m.seq).toBeGreaterThan(REQUEST_SEQ_BASE);
    expect(r.receive(rowAnswer(m.seq, m.part))).toBe(true);
    expect(sent.length - (i + 1)).toBeLessThanOrEqual(MAX_IN_FLIGHT);
  }
  expect(sent).toHaveLength(20);
  expect((await Promise.all(answers)).map((row) => row.part)).toEqual(parts);
});

test("an answer that is not ours is left for the Content page; a reset fails every request", async () => {
  const sent: ContentRequestMsg[] = [];
  const r = createContentRequests((m) => sent.push(m));
  expect(r.receive({ t: "contentRow", seq: 3 })).toBe(false);
  const waiting = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    r.row({ dataset: "social", part: `p${i}`, key: null }).catch((e: Error) => e.message),
  );
  r.reset();
  expect(new Set(await Promise.all(waiting))).toEqual(new Set(["The connection was reset."]));
});
