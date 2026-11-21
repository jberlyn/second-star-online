import { describe, expect, test } from "bun:test";

import {
  CLASSIC_BINDINGS,
  defaultPlayerPrefs,
  effectiveBindings,
  formatKeyCode,
  hasCtrlShortcutWarning,
  isValidBindCode,
  MODERN_BINDINGS,
  mergePlayerPrefs,
  playerPrefsPatchSchema,
  presetBindings,
  primaryKeyLabel,
  rebindKey,
} from "../../src/index.ts";

describe("player preferences rules", () => {
  test("defaults use Modern controls and expected per-option defaults", () => {
    const d = defaultPlayerPrefs();
    expect(d.controlSet).toBe("modern");
    expect(d.gameSize).toBe("fit");
    expect(d.rememberWindowPositions).toBe(true);
    expect(d.showDamageNumbers).toBe(true);
    expect(d.sfxEnabled).toBe(true);
    expect([d.masterVolume, d.combatVolume, d.spellsVolume, d.worldVolume]).toEqual([
      100, 100, 100, 100,
    ]);
    expect(d.imChime).toBe(true);
    expect(d.friendLogonSound).toBe(true);
    expect(d.backgroundAudio).toBe(true);
    expect(d.chatTextSize).toBe("classic");
    expect(d.chatTimestamps).toBe(false);
    expect(d.showNpcChatter).toBe(true);
    expect(d.presenceChatLines).toBe("off");
    expect(d.imFrom).toBe("everyone");
    expect(d.tradeFrom).toBe("everyone");
    expect(d.guildInvitesFrom).toBe("everyone");
    expect(d.colorblindBars).toBe(false);
    expect(d.largerHoverTips).toBe(false);
  });

  test("rebindKey steals duplicate bindings, reports displaced action, and rejects reserved keys", () => {
    const start = presetBindings("modern");
    // Move Space from attack onto action primary.
    const r = rebindKey(start, "action", 0, "Space");
    expect(r.rejected).toBe(false);
    expect(r.next.action).toEqual(["Space", null]);
    expect(r.next.attack).toEqual([null, null]);
    expect(r.displaced).toEqual({ action: "attack", slot: 0, code: "Space" });

    // Reserved keys (Escape, Meta) are rejected without changing anything.
    for (const bad of ["Escape", "MetaLeft", "MetaRight"]) {
      expect(isValidBindCode(bad)).toBe(false);
      const rej = rebindKey(r.next, "attack", 0, bad);
      expect(rej.rejected).toBe(true);
      expect(rej.next.attack).toEqual([null, null]);
    }

    // Null unbinds cleanly.
    const cleared = rebindKey(r.next, "action", 0, null);
    expect(cleared.next.action).toEqual([null, null]);
    expect(cleared.displaced).toBeNull();
  });

  test("hasCtrlShortcutWarning flags Ctrl paired with W, T or N", () => {
    expect(hasCtrlShortcutWarning(MODERN_BINDINGS)).toBe(false);
    expect(hasCtrlShortcutWarning(CLASSIC_BINDINGS)).toBe(false);
    const withCtrl = rebindKey(MODERN_BINDINGS, "action", 0, "ControlLeft").next;
    expect(hasCtrlShortcutWarning(withCtrl)).toBe(true);
  });

  test("effectiveBindings follows Modern/Classic presets and preserves Custom", () => {
    const prefs = defaultPlayerPrefs();
    prefs.keyBindings = rebindKey(MODERN_BINDINGS, "attack", 0, "KeyF").next;
    prefs.controlSet = "classic";
    expect(effectiveBindings(prefs)).toEqual(presetBindings("classic"));
    expect(primaryKeyLabel(effectiveBindings(prefs), "windowFriends")).toBe("");
    prefs.controlSet = "modern";
    expect(primaryKeyLabel(effectiveBindings(prefs), "windowFriends")).toBe("F");
    expect(primaryKeyLabel(effectiveBindings(prefs), "windowWho")).toBe("O");
    prefs.controlSet = "custom";
    expect(effectiveBindings(prefs).attack[0]).toBe("KeyF");
  });

  test("formatKeyCode produces concise readable labels", () => {
    expect(formatKeyCode("KeyW")).toBe("W");
    expect(formatKeyCode("Digit5")).toBe("5");
    expect(formatKeyCode("ArrowUp")).toBe("Up");
    expect(formatKeyCode("ShiftLeft")).toBe("L Shift");
    expect(formatKeyCode("Slash")).toBe("/");
    expect(formatKeyCode(null)).toBe("");
  });

  test("mergePlayerPrefs clamps volumes, strips reserved/duplicate keys, and fills missing fields", () => {
    const merged = mergePlayerPrefs({
      controlSet: "custom",
      masterVolume: 250,
      combatVolume: -10,
      chatTextSize: "large",
      keyBindings: {
        ...presetBindings("modern"),
        attack: ["Escape", "KeyW"], // Escape reserved, KeyW already used by moveUp
      },
    });
    expect(merged.masterVolume).toBe(100);
    expect(merged.combatVolume).toBe(0);
    expect(merged.chatTextSize).toBe("large");
    expect(merged.keyBindings.moveUp).toEqual(["KeyW", null]);
    expect(merged.keyBindings.attack).toEqual([null, null]);
    expect(merged.showDamageNumbers).toBe(true);
  });

  test("playerPrefsPatchSchema validates strictly and rejects unknown keys or out-of-range volumes", () => {
    expect(
      playerPrefsPatchSchema.safeParse({ masterVolume: 80, chatTimestamps: true }).success,
    ).toBe(true);
    expect(playerPrefsPatchSchema.safeParse({ masterVolume: 101 }).success).toBe(false);
    expect(playerPrefsPatchSchema.safeParse({ unknownField: 1 }).success).toBe(false);
    expect(
      playerPrefsPatchSchema.safeParse({
        keyBindings: { ...presetBindings("modern"), attack: ["MetaLeft", null] },
      }).success,
    ).toBe(false);
  });

  test("unknown legacy preference keys (such as removed lowHealthWarning) are dropped on load and rejected on save", () => {
    const merged = mergePlayerPrefs({ lowHealthWarning: false, showDamageNumbers: false });
    expect(merged).not.toHaveProperty("lowHealthWarning");
    expect(merged.showDamageNumbers).toBe(false);
    expect(playerPrefsPatchSchema.safeParse({ lowHealthWarning: true }).success).toBe(false);
  });
});
