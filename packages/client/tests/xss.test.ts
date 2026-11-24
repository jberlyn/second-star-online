/**
 * Player text can't make elements. Each view that shows another player's words (chat,
 * mail, board, Who, a player's bio, an instant message) is fed markup and must show it as text:
 * no `img`, `script` or `iframe` element appears inside it, and no attribute on any element in
 * it carries an event handler. (`tests/no-innerhtml.test.ts` in the repo root bans the markup APIs.)
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import { createBioWindow } from "../src/ui/bio.ts";
import { createBoardWindow } from "../src/ui/board.ts";
import { createChatLog } from "../src/ui/chat.ts";
import { appendLine } from "../src/ui/im.ts";
import { createMailScreen } from "../src/ui/mail.ts";
import { createWhoWindow } from "../src/ui/who.ts";
import { createWindowLayer } from "../src/ui/window.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
  hash: null,
  reload: async () => [],
  onReload: () => {},
};

const EVIL = [
  '<img src=x onerror="window.pwned=1">',
  '"><script>window.pwned=1</script>',
  "<iframe src=javascript:window.pwned=1></iframe>",
  "<svg onload=window.pwned=1>",
];

/** Nothing inside `root` was made from the text: no active element, no handler attribute. */
function expectInert(root: HTMLElement, what: string) {
  expect(
    root.querySelectorAll("script, iframe, svg, object, embed").length,
    `${what}: element`,
  ).toBe(0);
  for (const el of root.querySelectorAll("*")) {
    for (const attr of el.getAttributeNames()) {
      expect(attr.startsWith("on"), `${what}: ${attr}`).toBe(false);
    }
  }
  expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
}

/** The `img` elements the view itself draws (art) are fine; the ones whose src is the text are not. */
const strayImgs = (root: HTMLElement) =>
  [...root.querySelectorAll("img")].filter((i) => (i.getAttribute("src") ?? "") === "x");

describe("player text is shown as text", () => {
  test("the chat log", () => {
    const log = createChatLog();
    document.body.replaceChildren(log.el);
    for (const t of EVIL) {
      log.add(t, 0);
    }
    expectInert(log.el, "chat");
    expect(strayImgs(log.el)).toEqual([]);
    expect(log.el.textContent).toContain("<img src=x");
  });

  test("an instant message line", () => {
    const el = document.createElement("div");
    document.body.replaceChildren(el);
    for (const t of EVIL) {
      appendLine(el, t);
    }
    expectInert(el, "im");
    expect(strayImgs(el)).toEqual([]);
  });

  test("the mail list and a read message (sender, subject and body)", () => {
    const m = createMailScreen(fakeAssets, {
      ui: () => {},
      send: () => {},
      del: () => {},
      say: () => {},
      lock: () => {},
      frame: () => {},
      sound: () => {},
    });
    document.body.replaceChildren(m.el);
    m.show(EVIL.map((t, i) => ({ id: i + 1, from: t, subject: t, body: t })));
    for (const row of m.el.querySelectorAll<HTMLElement>(".mail-row")) {
      row.click();
    }
    expectInert(m.el, "mail");
    expect(strayImgs(m.el)).toEqual([]);
  });

  test("the message board", () => {
    const b = createBoardWindow(fakeAssets, { post: () => {}, close: () => {}, lock: () => {} });
    document.body.replaceChildren(b.el);
    b.show({ topic: EVIL[0] as string, text: EVIL.join("\n"), lock: false });
    expectInert(b.el, "board");
    expect(strayImgs(b.el)).toEqual([]);
  });

  test("the Who list", () => {
    const layer = createWindowLayer();
    document.body.replaceChildren(layer.el);
    const w = createWhoWindow(fakeAssets, layer, { im: () => {}, profile: () => {} });
    w.show(EVIL);
    expectInert(layer.el, "who");
    expect(strayImgs(layer.el)).toEqual([]);
  });

  test("a player's bio, profile and medals", () => {
    const layer = createWindowLayer();
    document.body.replaceChildren(layer.el);
    const bio = createBioWindow(fakeAssets, layer, { list: () => {}, closed: () => {} });
    bio.showPlayer({
      title: EVIL[0] as string,
      bio: EVIL,
      profile: EVIL.join(" "),
      medals: EVIL,
      own: false,
    });
    expectInert(layer.el, "bio");
    expect(strayImgs(layer.el)).toEqual([]);
  });
});
