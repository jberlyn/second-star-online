/**
 * Password-manager behaviour: credential fields are released before their screen goes, and
 * in-game fields opt out of autofill.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { ClientMsg, ServerMsg } from "@secondstaronline/shared";

import { type App, runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";

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

let app: App | null = null;
afterEach(() => {
  app?.stop();
  app = null;
  document.body.replaceChildren();
});

function start() {
  const root = document.createElement("div");
  document.body.append(root);
  const sent: ClientMsg[] = [];
  const conn: Connection = {
    send: (m) => sent.push(m),
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  app = runApp(root, fakeAssets, conn);
  const receive = (m: ServerMsg) => conn.onMessage(m);
  const click = (id: string) => root.querySelector<HTMLElement>(`[data-action="${id}"]`)?.click();
  return { root, sent, receive, click };
}

const field = (root: HTMLElement, id: string) => {
  const el = root.querySelector<HTMLInputElement>(`[data-action="${id}"]`);
  if (!el) {
    throw new Error(`no ${id}`);
  }
  return el;
};

describe("password managers", () => {
  test("logging in blurs the focused password before the login screen is removed", () => {
    const { root, sent, receive, click } = start();
    click("title-load-character");
    const password = field(root, "account-password");
    field(root, "account-name").value = "Me";
    password.value = "secret";
    password.focus();
    let blurredWhileAttached = false;
    password.addEventListener("blur", () => {
      blurredWhileAttached = password.isConnected;
    });
    click("login-submit");
    expect(sent).toContainEqual({ t: "login", name: "Me", password: "secret" });
    receive({
      t: "welcome",
      protocol: 1,
      id: "me",
      name: "Me",
      token: "00000000-0000-4000-8000-000000000000",
      resumed: false,
      rules: { chatMaxChars: 200 },
    });
    expect(password.isConnected).toBe(false);
    expect(blurredWhileAttached).toBe(true);
  });

  test("cancelling creation blurs the focused name before the screen is removed", () => {
    const { root, click } = start();
    click("title-new-character");
    const name = field(root, "account-name");
    name.focus();
    let blurredWhileAttached = false;
    name.addEventListener("blur", () => {
      blurredWhileAttached = name.isConnected;
    });
    click("creation-cancel");
    expect(name.isConnected).toBe(false);
    expect(blurredWhileAttached).toBe(true);
  });

  test("credential fields keep autofill; the chat line opts out of it", () => {
    const { root, click, receive } = start();
    click("title-load-character");
    expect(field(root, "account-name").autocomplete).toBe("username");
    expect(field(root, "account-password").autocomplete).toBe("current-password");
    expect(field(root, "account-password").hasAttribute("data-bwignore")).toBe(false);
    receive({
      t: "welcome",
      protocol: 1,
      id: "me",
      name: "Me",
      token: "00000000-0000-4000-8000-000000000000",
      resumed: false,
      rules: { chatMaxChars: 200 },
    });
    const chat = field(root, "chat-input");
    expect(chat.autocomplete).toBe("off");
    for (const attr of ["data-bwignore", "data-1p-ignore", "data-lpignore"]) {
      expect(chat.getAttribute(attr)).toBe("true");
    }
  });
});
