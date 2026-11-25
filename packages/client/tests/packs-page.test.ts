/**
 * The Control Panel's Packs page (issue #34): it lists the installed packs, posts a chosen pack
 * file with a ticket it asked for, shows what the file would change before anything does, and
 * applies it only when asked (installing only when the server said it could).
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { ContentPackPreview, ContentPacksView } from "@secondstaronline/shared";

import { createPacksPage } from "../src/ui/packs-page.ts";

afterEach(() => document.body.replaceChildren());

const VIEW: ContentPacksView = {
  packs: [
    {
      id: "classic",
      name: "Classic",
      version: "1.0.14",
      source: "release",
      sso: "1.10",
      state: "loaded",
    },
    {
      id: "frost",
      name: "Frost",
      version: "1.0.0",
      source: "imported",
      sso: "1.13",
      state: "next start",
    },
  ],
  leftOut: null,
  release: "1.13",
};

const PREVIEW: ContentPackPreview = {
  importId: "6f1c1a52-2f0a-4b0e-9a55-0d4c8d3f9c11",
  manifest: {
    id: "frost",
    name: "Frost",
    version: "1.1.0",
    sso: "1.13",
    builtOn: [{ id: "classic", version: "1.0.14" }],
    exportedAt: "2026-11-25T00:00:00.000Z",
  },
  files: 1,
  added: ["items/items/Frost Sword"],
  changed: [],
  removed: ["help/topics/old"],
  unchanged: 0,
  overYourChanges: [],
  overTheDraft: [],
  install: { ok: false, errors: ["frost v1.1.0: a clash"], updates: "1.0.0" },
  merge: { problems: [] },
};

function page() {
  const sent: unknown[] = [];
  const posts: { url: string; ticket: string | null }[] = [];
  const p = createPacksPage(
    {
      view: (seq) => sent.push({ t: "view", seq }),
      apply: (seq, importId, mode) => sent.push({ t: "apply", seq, importId, mode }),
      remove: (seq, id) => sent.push({ t: "remove", seq, id }),
      ticket: (seq) => {
        sent.push({ t: "ticket", seq });
        // The server's answer, as the app routes it.
        queueMicrotask(() =>
          p.receive({ t: "contentUploadTicket", seq, ticket: "tk", maxBytes: 1 }),
        );
      },
    },
    async (url, init) => {
      posts.push({
        url,
        ticket: new Headers(init?.headers).get("x-upload-ticket"),
      });
      return new Response(JSON.stringify({ ok: true, preview: PREVIEW }), { status: 200 });
    },
  );
  document.body.append(p.el);
  return { p, sent, posts };
}

describe("the Packs page", () => {
  test("lists the packs; another page's ticket is not taken", () => {
    const t = page();
    t.p.onShow();
    const seq = (t.sent[0] as { seq: number }).seq;
    expect(t.p.receive({ t: "contentPacks", seq, view: VIEW })).toBe(true);
    expect(t.p.el.textContent).toContain("In play from the next start");
    expect(t.p.el.querySelectorAll('[data-action="packs-remove"]')).toHaveLength(1);
    expect(t.p.receive({ t: "contentUploadTicket", seq: 3, ticket: "x", maxBytes: 1 })).toBe(false);
  });

  test("a checked file shows what it changes; nothing is applied until asked; install waits for ok", async () => {
    const t = page();
    const input = t.p.el.querySelector<HTMLInputElement>('[data-action="packs-import-file"]');
    Object.defineProperty(input, "files", {
      value: [new File(["{}"], "frost-1.1.0.ssopack.json")],
    });
    t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-import-check"]')?.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(t.posts).toEqual([{ url: "/upload/pack", ticket: "tk" }]);
    expect(t.sent.some((m) => (m as { t: string }).t === "apply")).toBe(false);
    expect(t.p.el.textContent).toContain("Frost v1.1.0");
    expect(t.p.el.textContent).toContain("frost v1.1.0: a clash");
    const install = t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-install"]');
    expect(install?.disabled).toBe(true);
    t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-merge"]')?.click();
    expect(t.sent.at(-1)).toMatchObject({ t: "apply", importId: PREVIEW.importId, mode: "merge" });
  });
});
