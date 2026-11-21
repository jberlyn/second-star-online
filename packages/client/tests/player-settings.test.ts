/**
 * Player Settings window (ui/player-settings.ts), custom key rebinding, hotkeys, display/sound/
 * chat/accessibility preferences and floating window position persistence.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import {
  type ClientMsg,
  defaultPlayerPrefs,
  presetBindings,
  rebindKey,
  type ServerMsg,
} from "@secondstaronline/shared";

import { type App, runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import { type AudioCtx, createAudio } from "../src/audio.ts";
import { createInputState, keyDown, keyUp, matchOneShotAction, setLayout } from "../src/input.ts";
import { createModel } from "../src/model.ts";
import type { Connection } from "../src/net.ts";
import { createPlayfield } from "../src/playfield.ts";
import { SOUND, soundCategory, spellSounds } from "../src/sfx.ts";
import { createBars } from "../src/ui/bars.ts";
import { createChatLog } from "../src/ui/chat.ts";
import { createImWindows } from "../src/ui/im.ts";
import { createPlayerSettingsWindow } from "../src/ui/player-settings.ts";
import { createWindowLayer } from "../src/ui/window.ts";
import { menuClick, openMenu, SNAPSHOT } from "./helpers/menu-helpers.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

const welcome: ServerMsg = {
  t: "welcome",
  protocol: 1,
  id: "me",
  name: "Me",
  token: "00000000-0000-4000-8000-000000000000",
  resumed: false,
  rules: { chatMaxChars: 200 },
};

let apps: App[] = [];
afterEach(() => {
  for (const a of apps) {
    a.stop();
  }
  apps = [];
  localStorage.clear();
  document.body.replaceChildren();
});

function startInGame() {
  const sent: ClientMsg[] = [];
  const conn: Connection = {
    send: (m) => sent.push(m),
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  const root = document.createElement("div");
  document.body.append(root);
  apps.push(runApp(root, fakeAssets, conn));
  conn.onMessage(welcome);
  conn.onMessage(SNAPSHOT);
  return { root, sent, receive: (m: ServerMsg) => conn.onMessage(m) };
}

describe("Player Settings window UI", () => {
  test("lists all 6 pages, searches across options and keybinds, and confirms unsaved changes", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const savedPatches: unknown[] = [];
    const w = createPlayerSettingsWindow(layer, {
      save: (p) => savedPatches.push(p),
      ignoreAdd: () => {},
      ignoreRemove: () => {},
    });
    w.open(defaultPlayerPrefs(), [], true);

    const pages = [...w.window.el.querySelectorAll<HTMLElement>(".settings-link")].map(
      (b) => b.dataset.page,
    );
    expect(pages).toEqual(["controls", "display", "sound", "chat", "social", "accessibility"]);

    // Search finds options across pages and jumps directly to them.
    const search = w.window.el.querySelector<HTMLInputElement>(".settings-search");
    if (search) {
      search.value = "colour-blind";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const res = w.window.el.querySelector<HTMLButtonElement>(".settings-result");
    expect(res?.dataset.key).toBe("colorblindBars");
    res?.click();
    expect(w.page).toBe("accessibility");

    // Edit an option, attempt to switch page → unsaved changes confirmation appears.
    const cb = w.window.el.querySelector<HTMLInputElement>(
      '[aria-label="Colour-blind health & spell bars"]',
    );
    if (cb) {
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    w.window.el.querySelector<HTMLButtonElement>('.settings-link[data-page="sound"]')?.click();
    expect(w.window.el.querySelector(".settings-confirm")?.hasAttribute("hidden")).toBe(false);
    // Keep editing stays on Accessibility.
    w.window.el.querySelector<HTMLButtonElement>(".settings-stay")?.click();
    expect(w.page).toBe("accessibility");
    // Save sends only the changed field.
    w.window.el.querySelector<HTMLButtonElement>(".settings-save")?.click();
    expect(savedPatches).toEqual([{ colorblindBars: true }]);
    // Saving immediately advances the window's baseline, so switching pages asks no discard prompt.
    w.window.el.querySelector<HTMLButtonElement>('.settings-link[data-page="sound"]')?.click();
    expect(w.page).toBe("sound");
    w.dispose();
  });

  test("preserves unsaved edits across sync/re-open, keeps confirm open, and rolls back failed saves", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const savedReqs: { patch: unknown; id: number }[] = [];
    const w = createPlayerSettingsWindow(layer, {
      save: (patch, id) => savedReqs.push({ patch, id }),
      ignoreAdd: () => {},
      ignoreRemove: () => {},
    });
    const base = defaultPlayerPrefs();
    w.open(base, [], true);
    w.window.el.querySelector<HTMLButtonElement>('.settings-link[data-page="display"]')?.click();

    // Edit Show damage numbers without saving.
    const dmg = w.window.el.querySelector<HTMLInputElement>('[aria-label="Show damage numbers"]')!;
    dmg.checked = false;
    dmg.dispatchEvent(new Event("change", { bubbles: true }));

    // Re-opening Settings while already open raises it without wiping the unsaved edit.
    w.open(base, [], true);
    expect(dmg.checked).toBe(false);

    // An unrelated server sync (e.g. another session toggling lowHealthWarning) updates untouched
    // rows while preserving the unsaved edit.
    w.sync({ ...base, lowHealthWarning: false }, [], true);
    expect(dmg.checked).toBe(false);
    expect(
      w.window.el.querySelector<HTMLInputElement>('[aria-label="Low health warning"]')?.checked,
    ).toBe(false);

    // Open the discard prompt; another sync must not close it.
    w.window.el.querySelector<HTMLButtonElement>('.settings-link[data-page="sound"]')?.click();
    expect(w.isConfirmOpen()).toBe(true);
    w.sync({ ...base, lowHealthWarning: true }, [], true);
    expect(w.isConfirmOpen()).toBe(true);
    w.window.el.querySelector<HTMLButtonElement>(".settings-stay")?.click();

    // Save sends minimal patch, then server rejects -> baseline rolls back, edit stays in DOM.
    w.window.el.querySelector<HTMLButtonElement>(".settings-save")?.click();
    expect(savedReqs).toEqual([{ patch: { showDamageNumbers: false }, id: 1 }]);
    w.saveResult(false, "Could not save settings.", 1, { ...base, lowHealthWarning: true });
    expect(dmg.checked).toBe(false);
    expect(w.window.el.querySelector(".settings-status")?.textContent).toBe(
      "Could not save settings.",
    );
    expect(
      w.window.el
        .querySelector('[data-key="showDamageNumbers"]')
        ?.classList.contains("settings-changed"),
    ).toBe(true);
    w.dispose();
  });

  test("key capture rejects empty code, ignores composing/repeat, cancels on blur/outside click, and per-row reset offers Undo", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    let captureStarts = 0;
    const w = createPlayerSettingsWindow(layer, {
      save: () => {},
      ignoreAdd: () => {},
      ignoreRemove: () => {},
      onCaptureStart: () => {
        captureStarts++;
      },
    });
    w.open(defaultPlayerPrefs(), [], true);

    const actionBtn = () =>
      w.window.el.querySelector<HTMLButtonElement>(
        '.pset-key-btn[data-bind="action"][data-slot="0"]',
      )!;
    actionBtn().click();
    expect(captureStarts).toBe(1);
    expect(w.isCapturing()).toBe(true);

    // Repeat and composing events are ignored while listening.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", code: "KeyX", repeat: true }));
    expect(w.isCapturing()).toBe(true);
    // Empty `e.code` is rejected rather than storing dead `e.key`.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Dead", code: "" }));
    expect(w.isCapturing()).toBe(false);
    expect(actionBtn().textContent).toBe("E");

    // Clicking outside stops capture; blur stops capture.
    actionBtn().click();
    expect(w.isCapturing()).toBe(true);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(w.isCapturing()).toBe(false);

    actionBtn().click();
    expect(w.isCapturing()).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(w.isCapturing()).toBe(false);

    // Move Space from Attack to Action, then Reset Attack row -> steals Space back WITH Undo banner.
    actionBtn().click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    const attackRow = w.window.el.querySelector('[data-key="bind:attack"]')!;
    attackRow.querySelector<HTMLButtonElement>(".settings-reset")?.click();
    expect(w.window.el.querySelector(".pset-undo-banner")?.textContent).toContain("Moved Space");
    w.window.el.querySelector<HTMLButtonElement>(".pset-undo-btn")?.click();
    expect(actionBtn().textContent).toBe("Space");
    w.dispose();
  });

  test("key rebinding steals duplicate keys with Undo, warns on Ctrl+W, and rejects Meta", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const w = createPlayerSettingsWindow(layer, {
      save: () => {},
      ignoreAdd: () => {},
      ignoreRemove: () => {},
    });
    w.open(defaultPlayerPrefs(), [], true);

    // Click primary bind button on Pick up / Use (`action`) and press Space (currently Attack).
    const actionBtn = w.window.el.querySelector<HTMLButtonElement>(
      '.pset-key-btn[data-bind="action"][data-slot="0"]',
    );
    actionBtn?.click();
    expect(w.isCapturing()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    expect(w.isCapturing()).toBe(false);
    expect(w.window.el.querySelector<HTMLSelectElement>('[aria-label="Control set"]')?.value).toBe(
      "custom",
    );
    expect(
      w.window.el.querySelector<HTMLButtonElement>(
        '.pset-key-btn[data-bind="attack"][data-slot="0"]',
      )?.textContent,
    ).toBe("Unset");
    expect(w.window.el.querySelector(".pset-undo-banner")?.textContent).toContain("Moved Space");

    // Undo restores both Attack and Pick up / Use.
    w.window.el.querySelector<HTMLButtonElement>(".pset-undo-btn")?.click();
    expect(
      w.window.el.querySelector<HTMLButtonElement>(
        '.pset-key-btn[data-bind="attack"][data-slot="0"]',
      )?.textContent,
    ).toBe("Space");
    expect(
      w.window.el.querySelector<HTMLButtonElement>(
        '.pset-key-btn[data-bind="action"][data-slot="0"]',
      )?.textContent,
    ).toBe("E");

    // Binding Ctrl alongside W shows soft warning.
    w.window.el
      .querySelector<HTMLButtonElement>('.pset-key-btn[data-bind="action"][data-slot="0"]')
      ?.click();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", code: "ControlLeft", bubbles: true }),
    );
    expect(w.window.el.querySelector(".pset-warning")?.textContent).toContain("Ctrl+W");

    // Meta is rejected.
    w.window.el
      .querySelector<HTMLButtonElement>('.pset-key-btn[data-bind="attack"][data-slot="0"]')
      ?.click();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Meta", code: "MetaLeft", bubbles: true }),
    );
    expect(w.window.el.querySelector(".settings-status")?.textContent).toContain("reserved");
    w.dispose();
  });

  test("Social & privacy locks pre-login and manages ignore list live when logged in", () => {
    const layer = createWindowLayer();
    document.body.append(layer.el);
    const added: string[] = [];
    const removed: string[] = [];
    const w = createPlayerSettingsWindow(layer, {
      save: () => {},
      ignoreAdd: (n) => added.push(n),
      ignoreRemove: (n) => removed.push(n),
    });
    w.open(defaultPlayerPrefs(), [], false);
    w.window.el.querySelector<HTMLButtonElement>('.settings-link[data-page="social"]')?.click();
    expect(w.window.el.querySelector(".pset-warning")?.textContent).toContain("Log in");
    expect(w.window.el.querySelector<HTMLButtonElement>(".settings-save")?.disabled).toBe(true);

    // Log in: Ignore list add & remove work live.
    w.sync(defaultPlayerPrefs(), ["Spammer"], true);
    expect(w.window.el.querySelector(".pset-ignore-list")?.textContent).toContain("Spammer");
    const inp = w.window.el.querySelector<HTMLInputElement>('[aria-label="Player name to ignore"]');
    if (inp) {
      inp.value = "Troll";
    }
    w.window.el
      .querySelector<HTMLButtonElement>('[data-action="player-settings-ignore-add"]')
      ?.click();
    expect(added).toEqual(["Troll"]);
    w.window.el
      .querySelector<HTMLButtonElement>('[data-action="player-settings-ignore-remove"]')
      ?.click();
    expect(removed).toEqual(["Spammer"]);
    w.dispose();
  });
});

describe("custom bindings, panel/window hotkeys and tooltips", () => {
  test("custom non-modifier turn key and rebound attack/move work in input layer", () => {
    const custom = rebindKey(
      rebindKey(presetBindings("modern"), "turn", 0, "KeyQ").next,
      "attack",
      0,
      "KeyJ",
    ).next;
    const s = createInputState("custom", custom);
    const log: string[] = [];
    const sink = {
      move: (h: string | null, t: boolean) => log.push(`move:${h}:${t}`),
      step: (d: string, t: boolean) => log.push(`step:${d}:${t}`),
      attack: (h: boolean) => log.push(`atk:${h}`),
      action: () => log.push("act"),
    };
    keyDown(s, sink, { key: "q", code: "KeyQ" });
    keyDown(s, sink, { key: "w", code: "KeyW" });
    keyDown(s, sink, { key: "j", code: "KeyJ" });
    keyUp(s, sink, { key: "j", code: "KeyJ" });
    keyUp(s, sink, { key: "q", code: "KeyQ" });
    expect(log).toEqual([
      "move:null:true",
      "step:U:true",
      "move:U:true",
      "atk:true",
      "atk:false",
      "move:U:false",
    ]);
    expect(matchOneShotAction(s, { key: "i", code: "KeyI" })).toBe("tabInventory");
  });

  test("primary + secondary holds do not cancel each other, Custom Turn matches exact key, and Custom rebinds beat Enter/slash fallbacks", () => {
    let custom = rebindKey(presetBindings("modern"), "moveUp", 1, "ArrowUp").next;
    custom = rebindKey(custom, "attack", 0, "ShiftLeft").next;
    custom = rebindKey(custom, "attack", 1, "KeyJ").next;
    custom = rebindKey(custom, "turn", 0, "ShiftRight").next;
    custom = rebindKey(custom, "turn", 1, null).next;
    custom = rebindKey(custom, "action", 0, "Enter").next;
    custom = rebindKey(custom, "tabStats", 0, "Digit7").next;

    const s = createInputState("custom", custom);
    const log: string[] = [];
    const sink = {
      move: (h: string | null, t: boolean) => log.push(`move:${h}:${t}`),
      step: (d: string, t: boolean) => log.push(`step:${d}:${t}`),
      attack: (h: boolean) => log.push(`atk:${h}`),
      action: () => log.push("act"),
    };

    // Hold both Move up keys (W + ArrowUp); releasing W keeps walking up until ArrowUp releases.
    keyDown(s, sink, { key: "w", code: "KeyW" });
    keyDown(s, sink, { key: "ArrowUp", code: "ArrowUp" });
    keyUp(s, sink, { key: "w", code: "KeyW" });
    expect(s.keys.U).toBe(true);
    keyUp(s, sink, { key: "ArrowUp", code: "ArrowUp" });
    expect(s.keys.U).toBeUndefined();

    // Hold both Attack keys (ShiftLeft + KeyJ); releasing ShiftLeft keeps attacking.
    // Holding ShiftLeft (Attack) does NOT turn in place because Turn is bound only to ShiftRight.
    log.length = 0;
    keyDown(s, sink, { key: "Shift", code: "ShiftLeft", shiftKey: true });
    keyDown(s, sink, { key: "w", code: "KeyW", shiftKey: true });
    expect(log).toEqual(["atk:true", "step:U:false", "move:U:false"]);
    keyDown(s, sink, { key: "j", code: "KeyJ", shiftKey: true });
    keyUp(s, sink, { key: "Shift", code: "ShiftLeft", shiftKey: false });
    expect(s.attackKey).toBe(true);
    keyUp(s, sink, { key: "j", code: "KeyJ" });
    expect(s.attackKey).toBe(false);
    keyUp(s, sink, { key: "w", code: "KeyW" });

    // Unchanged setLayout does not release held keys.
    keyDown(s, sink, { key: "w", code: "KeyW" });
    log.length = 0;
    setLayout(s, sink, "custom", custom);
    expect(log).toEqual([]);
    expect(s.keys.U).toBe(true);

    // Custom Enter bound to Action while NumpadEnter remains Chat: main Enter does NOT open Chat.
    expect(matchOneShotAction(s, { key: "Enter", code: "Enter" })).toBeNull();
    expect(matchOneShotAction(s, { key: "Enter", code: "NumpadEnter" })).toBe("chat");
    // Layout `/` on Digit7 does not hijack Digit7 bound to Stats tab in Custom mode.
    expect(matchOneShotAction(s, { key: "/", code: "Digit7", shiftKey: true })).toBe("tabStats");
  });

  test("first login imports legacy/pre-login prefs when account has stored=false, and server wins when stored=true", () => {
    localStorage.setItem("sso.controls", "classic");
    localStorage.setItem("sso.sfx", "0");
    const { root, sent, receive } = startInGame();
    // Uninitialized account (`stored: false`) imports migrated legacy prefs via prefsSave.
    receive({
      t: "prefs",
      prefs: defaultPlayerPrefs(),
      ignores: [],
      stored: false,
    });
    const savedMsg = sent.find((m) => m.t === "prefsSave");
    expect(savedMsg?.t === "prefsSave" && savedMsg.prefs.controlSet).toBe("classic");
    expect(savedMsg?.t === "prefsSave" && savedMsg.prefs.sfxEnabled).toBe(false);

    // Confirming the import clears pending sync; a subsequent stored=true account loads its own prefs.
    if (savedMsg?.t === "prefsSave") {
      receive({
        t: "prefsResult",
        ok: true,
        text: "Settings saved.",
        requestId: savedMsg.requestId,
        prefs: { ...defaultPlayerPrefs(), controlSet: "classic", sfxEnabled: false },
      });
    }
    expect(localStorage.getItem("sso.prefsPending")).toBeNull();
    receive({
      t: "prefs",
      prefs: { ...defaultPlayerPrefs(), controlSet: "modern", sfxEnabled: true },
      ignores: [],
      stored: true,
    });
    expect(JSON.parse(localStorage.getItem("sso.prefs") ?? "{}").controlSet).toBe("modern");
    expect(root.querySelector(".game")).not.toBeNull();
  });

  test("confirm dialog is not hijacked by gameplay shortcuts and menu shortcuts update after rebind", () => {
    const { root, receive } = startInGame();
    menuClick(root, "Options", "Settings…");
    const win = root.querySelector<HTMLElement>(".window-player-settings")!;
    win.querySelector<HTMLButtonElement>('.settings-link[data-page="display"]')?.click();
    const dmg = win.querySelector<HTMLInputElement>('[aria-label="Show damage numbers"]')!;
    dmg.checked = false;
    dmg.dispatchEvent(new Event("change", { bubbles: true }));
    win.querySelector<HTMLButtonElement>('.settings-link[data-page="sound"]')?.click();
    expect(win.querySelector(".settings-confirm")?.hasAttribute("hidden")).toBe(false);

    // Pressing Enter while confirm dialog is open must NOT focus the main chat input.
    const chatInput = root.querySelector<HTMLInputElement>(".chat-input")!;
    const stay = win.querySelector<HTMLButtonElement>(".settings-stay")!;
    stay.focus();
    stay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
    );
    expect(document.activeElement).not.toBe(chatInput);
    // Tab moves focus to Discard changes instead of being swallowed by Modern controls.
    stay.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(win.querySelector(".settings-discard"));
    win.querySelector<HTMLButtonElement>(".settings-discard")?.click();
    win.querySelector<HTMLButtonElement>(".window-close")?.click();

    // Rebinding Friend's List to G updates the Game menu shortcut label.
    const rebound = rebindKey(presetBindings("modern"), "windowFriends", 0, "KeyG").next;
    receive({
      t: "prefs",
      prefs: { ...defaultPlayerPrefs(), controlSet: "custom", keyBindings: rebound },
      ignores: [],
      stored: true,
    });
    const drop = openMenu(root, "Game");
    const friendItem = [...(drop?.querySelectorAll<HTMLElement>(".menu-item") ?? [])].find(
      (e) => e.textContent === "Open Friend's List",
    );
    expect(friendItem?.dataset.shortcut).toBe("G");
  });

  test("Modern hotkeys switch tabs, toggle Friends/Who, and tab tooltips show subtle key hints", () => {
    const { root, sent, receive } = startInGame();
    // Press I → Inventory tab; B → Spellbook tab; F → Friends window; O → Who's Online request.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", bubbles: true }));
    expect(root.querySelector(".page-inventory")?.hasAttribute("hidden")).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }));
    expect(root.querySelector(".page-spellbook")?.hasAttribute("hidden")).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true }));
    expect(root.querySelector(".window-friends")?.hasAttribute("hidden")).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true }));
    expect(root.querySelector(".window-friends")?.hasAttribute("hidden")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", code: "KeyO", bubbles: true }));
    expect(sent).toContainEqual({ t: "whoOpen" });

    // Hovering the Inventory tab shows "Inventory" with subtle `.hover-tip-key` "I".
    const invBtn = root.querySelector<HTMLElement>('[aria-label="Inventory"]');
    invBtn?.dispatchEvent(
      new PointerEvent("pointerenter", { pointerType: "mouse", clientX: 640, clientY: 30 }),
    );
    const tip = root.querySelector<HTMLElement>(".hover-tip");
    expect(tip?.hidden).toBe(false);
    expect(tip?.querySelector(".hover-tip-key")?.textContent).toBe("I");

    // Switching to Classic clears tab & menu hotkeys.
    receive({
      t: "prefs",
      prefs: { ...defaultPlayerPrefs(), controlSet: "classic" },
      ignores: [],
    });
    invBtn?.dispatchEvent(
      new PointerEvent("pointermove", { pointerType: "mouse", clientX: 641, clientY: 30 }),
    );
    expect(tip?.querySelector(".hover-tip-key")).toBeNull();
    expect(tip?.textContent).toBe("Inventory");
  });
});

describe("Display, Sound, Chat and Accessibility preferences", () => {
  test("bars apply colour-blind palette and low health warning at <= 25% HP", () => {
    const lowEvents: boolean[] = [];
    const bars = createBars(fakeAssets, (low) => lowEvents.push(low));
    // Both HP and SP fill images keep the `.art` class (image-rendering: pixelated).
    const fillImgs = [...bars.el.querySelectorAll(".bar-fill-img")];
    expect(fillImgs).toHaveLength(2);
    expect(fillImgs.every((img) => img.classList.contains("art"))).toBe(true);

    bars.setOptions({ colorblind: true, lowHealthWarning: true });
    expect(bars.el.classList.contains("bars-colorblind")).toBe(true);

    bars.setVitals({ level: 1, hp: 50, hpMax: 100, sp: 10, spMax: 10, exp: 0, expNeeded: 30 });
    expect(bars.lowHealth).toBe(false);
    bars.setVitals({ level: 1, hp: 25, hpMax: 100, sp: 10, spMax: 10, exp: 0, expNeeded: 30 });
    expect(bars.lowHealth).toBe(true);
    // Boarding a full-hull vehicle clears low health even when character HP is <= 25%.
    bars.setVitals({
      level: 1,
      hp: 25,
      hpMax: 100,
      sp: 10,
      spMax: 10,
      exp: 0,
      expNeeded: 30,
      hull: { hp: 100, max: 100 },
    });
    expect(bars.lowHealth).toBe(false);
    // Low vehicle hull triggers warning; death (hp 0) clears it.
    bars.setVitals({
      level: 1,
      hp: 100,
      hpMax: 100,
      sp: 10,
      spMax: 10,
      exp: 0,
      expNeeded: 30,
      hull: { hp: 20, max: 100 },
    });
    expect(bars.lowHealth).toBe(true);
    bars.setVitals({ level: 1, hp: 0, hpMax: 100, sp: 10, spMax: 10, exp: 0, expNeeded: 30 });
    expect(bars.lowHealth).toBe(false);
    // Toggle off also clears active low health.
    bars.setVitals({ level: 1, hp: 10, hpMax: 100, sp: 10, spMax: 10, exp: 0, expNeeded: 30 });
    expect(bars.lowHealth).toBe(true);
    bars.setOptions({ colorblind: true, lowHealthWarning: false });
    expect(bars.lowHealth).toBe(false);
    expect(lowEvents).toEqual([true, false, true, false, true, false]);
  });

  test("playfield skips drawing floating damage text when showDamageNumbers is false", () => {
    const drawn: string[] = [];
    const fakeCtx = {
      imageSmoothingEnabled: false,
      fillStyle: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fillRect() {},
      drawImage() {},
      fillText(t: string) {
        drawn.push(t);
      },
      clearRect() {},
    };
    const spy = spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => fakeCtx) as never,
    );
    try {
      const pf = createPlayfield(fakeAssets);
      const model = createModel();
      if (SNAPSHOT.t === "snapshot") {
        model.map = SNAPSHOT.map;
      }
      model.floaties.push({ text: "-12", color: 1, px: 100, py: 100, anim: 30 });

      pf.showDamageNumbers = false;
      pf.draw(model);
      expect(drawn).toEqual([]);

      pf.showDamageNumbers = true;
      pf.draw(model);
      expect(drawn).toContain("-12");
    } finally {
      spy.mockRestore();
    }
  });

  test("chat applies text size and retroactive timestamps without altering /logchat text", () => {
    const chat = createChatLog(() => new Date(2026, 10, 21, 9, 5, 0));
    chat.add("Hello world", 0);
    expect(chat.el.querySelector(".chat-line")?.textContent).toBe("Hello world");

    chat.setTimestamps(true);
    expect(chat.el.querySelector(".chat-line")?.textContent).toBe("[09:05] Hello world");
    expect(chat.text()).toBe("Hello world\n");

    chat.setTimestamps(false);
    expect(chat.el.querySelector(".chat-line")?.textContent).toBe("Hello world");

    chat.setTextSize("large");
    expect(chat.el.classList.contains("chat-size-large")).toBe(true);
    chat.setTextSize("small");
    expect(chat.el.classList.contains("chat-size-small")).toBe(true);
  });

  test("audio applies master + category volumes, background tab mute, and notification chimes", async () => {
    // Shared samples emitted by spells route to Spells, while combat keeps Combat.
    expect(soundCategory(SOUND.spellKill)).toBe("spells");
    expect(soundCategory(SOUND.monsterKill)).toBe("combat");
    const meteor = spellSounds("Meteor");
    expect(meteor.length).toBeGreaterThan(0);
    expect(meteor.every((s) => soundCategory(s) === "spells")).toBe(true);

    let hidden = false;
    let muteEvents = 0;
    const playedGains: number[] = [];
    const oscNotes: number[] = [];
    let stoppedChimes = 0;
    const ctx = {
      state: "running" as AudioContextState,
      currentTime: 0,
      destination: {},
      resume: () => Promise.resolve(),
      decodeAudioData: (b: ArrayBuffer) => Promise.resolve({ bytes: b.byteLength }),
      createBufferSource: () => ({
        buffer: null,
        onended: null,
        connect(g: { gain: { value: number } }) {
          playedGains.push(g.gain.value);
        },
        start() {},
        stop() {},
      }),
      createGain: () => ({
        gain: {
          value: 1,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      }),
      createOscillator: () => ({
        type: "sine",
        onended: null,
        frequency: {
          setValueAtTime(f: number) {
            oscNotes.push(f);
          },
        },
        connect() {},
        start() {},
        stop(when?: number) {
          if (when === undefined) {
            stoppedChimes++;
          }
        },
      }),
    };
    const audio = createAudio(
      {
        ...fakeAssets,
        index: {
          ...fakeAssets.index,
          sounds: {
            hitsound: "sounds/hitsound.wav",
            clicksound2: "sounds/clicksound2.wav",
            fx: "sounds/fx.wav",
          },
        },
      },
      true,
      () => ctx as unknown as AudioCtx,
      async () => new ArrayBuffer(4),
      () => hidden,
      () => {
        muteEvents++;
      },
    );
    audio.unlock();
    await new Promise((r) => setTimeout(r, 0));

    audio.setSettings({ masterVolume: 50, combatVolume: 50, spellsVolume: 0, worldVolume: 100 });
    audio.play(SOUND.monsterHit); // combat: 0.5 * 0.5 = 0.25
    audio.play(SOUND.click); // world: 0.5 * 1.0 = 0.5
    audio.play(SOUND.spellKill); // spells: 0.5 * 0 = 0
    expect(playedGains[0]).toBeCloseTo(0.25);
    expect(playedGains[1]).toBeCloseTo(0.5);
    expect(playedGains[2]).toBe(0);

    // Chime synthesizes tones and stops immediately when muted by background hide.
    audio.playChime("im");
    expect(oscNotes.length).toBe(2);

    audio.setSettings({ backgroundAudio: false });
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stoppedChimes).toBe(2);
    expect(muteEvents).toBe(1);
    expect(audio.canPlay()).toBe(false);
    audio.play(SOUND.click);
    audio.playChime("friendLogon");
    expect(playedGains).toHaveLength(3);
    expect(oscNotes).toHaveLength(2);

    // After dispose, visibilitychange no longer triggers onMute.
    audio.dispose();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(muteEvents).toBe(1);
  });

  test("floating window positions clear on close when memory is off and IM slots use distinct keys", () => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
    const saved = new Map<string, { x: number; y: number }>();
    saved.set("friends", { x: 950, y: 750 }); // would overflow 1000x800
    saved.set("imwin-1", { x: 40, y: 40 });
    saved.set("imwin-2", { x: 300, y: 120 });
    let remember = true;
    const layer = createWindowLayer({
      shouldRemember: () => remember,
      load: (name) => saved.get(name) ?? null,
      save: (name, pos) => saved.set(name, pos),
    });
    const w = layer.create({
      title: "Friends",
      name: "friends",
      width: 120,
      height: 240,
      body: document.createElement("div"),
    });
    w.open();
    // Clamped inside viewport: x <= 1000 - 120 = 880, y <= 800 - 260 = 540.
    expect(Number.parseFloat(w.el.style.left)).toBeLessThanOrEqual(880);
    expect(Number.parseFloat(w.el.style.top)).toBeLessThanOrEqual(540);

    // Distinct IM slots load separate saved positions instead of stacking on one key.
    const ims = createImWindows(fakeAssets, layer, { send: () => {}, me: () => "Me" });
    ims.receive("Ann", "hi");
    ims.receive("Bob", "hey");
    const imEls = [...layer.el.querySelectorAll<HTMLElement>(".window-imwin")];
    expect(imEls.map((e) => Number.parseFloat(e.style.left))).toEqual([40, 300]);

    // Turning memory off clears position on close so dragging never sticks across close/reopen.
    remember = false;
    w.close();
    w.open();
    // Centred again when Remember is off: (1000 - 120) / 2 = 440.
    expect(Number.parseFloat(w.el.style.left)).toBe(440);
  });

  test("app applies larger hover tips, sends minimal prefsSave with requestId, and updates low-health class", () => {
    const { root, sent, receive } = startInGame();
    menuClick(root, "Options", "Settings…");
    const win = root.querySelector<HTMLElement>(".window-player-settings");
    win?.querySelector<HTMLButtonElement>('.settings-link[data-page="accessibility"]')?.click();
    const large = win?.querySelector<HTMLInputElement>('[aria-label="Larger hover tips"]');
    if (large) {
      large.checked = true;
      large.dispatchEvent(new Event("change", { bubbles: true }));
    }
    win?.querySelector<HTMLButtonElement>(".settings-save")?.click();
    expect(sent).toContainEqual({
      t: "prefsSave",
      requestId: 1,
      prefs: { largerHoverTips: true },
    });
    expect(root.querySelector(".hover-tip")?.classList.contains("hover-tip-large")).toBe(true);

    // Low health warning highlights the game root at <= 25% HP and clears on death (hp 0).
    receive({
      t: "vitals",
      vitals: { level: 1, hp: 5, hpMax: 20, sp: 10, spMax: 20, exp: 0, expNeeded: 30 },
    });
    expect(root.querySelector(".game")?.classList.contains("pf-low-hp")).toBe(true);
    receive({
      t: "vitals",
      vitals: { level: 1, hp: 0, hpMax: 20, sp: 10, spMax: 20, exp: 0, expNeeded: 30 },
    });
    expect(root.querySelector(".game")?.classList.contains("pf-low-hp")).toBe(false);
  });
});
