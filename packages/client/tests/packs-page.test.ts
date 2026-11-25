/**
 * The Control Panel's Packs page (issue #34): it lists the installed packs, posts a chosen pack
 * file with a ticket it asked for, shows what the file would change before anything does, and
 * applies it only when asked (installing only when the server said it could).
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { ContentPackPreview, ContentPacksView } from "@secondstaronline/shared";

import { createPacksPage, rowText } from "../src/ui/packs-page.ts";

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

function page(preview: ContentPackPreview = PREVIEW) {
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
      return new Response(JSON.stringify({ ok: true, preview }), { status: 200 });
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
    expect(t.p.el.textContent).toContain("In use once the server restarts");
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

  test("each pack is a card in plain words: what it is, whether it is in use, and its tags", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentPacks", seq: (t.sent[0] as { seq: number }).seq, view: VIEW });
    expect(t.p.el.classList.contains("plain-editor")).toBe(true);
    const cards = [...t.p.el.querySelectorAll<HTMLElement>(".packs-card")];
    expect(cards.map((c) => c.dataset.pack)).toEqual(["classic", "frost"]);
    expect(cards[0]?.textContent).toContain("Classic v1.0.14");
    expect(cards[0]?.textContent).toContain("Comes with the game");
    expect(cards[0]?.textContent).toContain("In use");
    // A pack that came with the game can't be removed; an added one can.
    expect(cards[0]?.querySelector('[data-action="packs-remove"]')).toBeNull();
    expect(cards[1]?.textContent).toContain("Added by you");
    expect(cards[1]?.querySelector('[data-action="packs-remove"]')?.textContent).toBe("Remove…");
  });

  test("a checked file says in words what it would do, and offers the update by version", async () => {
    const t = page();
    const input = t.p.el.querySelector<HTMLInputElement>('[data-action="packs-import-file"]');
    Object.defineProperty(input, "files", {
      value: [new File(["{}"], "frost-1.1.0.ssopack.json")],
    });
    t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-import-check"]')?.click();
    await new Promise((r) => setTimeout(r, 10));
    const text = t.p.el.textContent ?? "";
    expect(text).toContain("It would add 1 thing, change 0, and remove 1");
    expect(text).toContain("Frost Sword (items)");
    expect(text).toContain("old (help, topics)");
    expect(
      t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-install"]')?.textContent,
    ).toBe("Update to v1.1.0");
    t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-cancel"]')?.click();
    expect(t.sent.at(-1)).toMatchObject({ t: "apply", mode: "cancel" });
    expect(t.p.el.querySelector<HTMLElement>(".packs-preview")?.hidden).toBe(true);
    expect(t.p.el.querySelector(".balance-status")?.textContent).toBe("Nothing was added.");
  });

  test("a row's path reads as words", () => {
    expect(rowText("items/items/Frost Sword")).toBe("Frost Sword (items)");
    expect(rowText("monsters/definitions/Orc")).toBe("Orc (monsters, definitions)");
    expect(rowText("odd")).toBe("odd");
  });

  test("a message shows next to the button it is about", () => {
    const t = page();
    const check = t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-import-check"]');
    check?.click();
    const status = t.p.el.querySelector(".balance-status");
    expect(status?.textContent).toBe("Choose a pack file first.");
    expect(check?.nextElementSibling).toBe(status);
  });

  test("the preview explains the two choices in the order of their buttons, with short fold titles", async () => {
    const t = page({ ...PREVIEW, overYourChanges: ["items/items/Long Sword"] });
    const input = t.p.el.querySelector<HTMLInputElement>('[data-action="packs-import-file"]');
    Object.defineProperty(input, "files", {
      value: [new File(["{}"], "frost-1.1.0.ssopack.json")],
    });
    t.p.el.querySelector<HTMLButtonElement>('[data-action="packs-import-check"]')?.click();
    await new Promise((r) => setTimeout(r, 10));
    const heads = [...t.p.el.querySelectorAll(".packs-choice h4")].map((h) => h.textContent);
    expect(heads).toEqual(["Add it to my unpublished changes", "Update Frost to v1.1.0"]);
    const summaries = [...t.p.el.querySelectorAll(".packs-preview summary")].map(
      (s) => s.textContent,
    );
    expect(summaries).toContain("Things you've changed yourself (1)");
    expect(t.p.el.querySelector(".packs-preview")?.textContent).toContain(
      "If you install it as a pack, your change stays on top.",
    );
  });
});
