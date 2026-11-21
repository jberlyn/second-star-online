import { describe, expect, test } from "bun:test";

import type { Dir } from "@secondstaronline/shared";

import {
  createInputState,
  type InputSink,
  type KeyPress,
  keyDown,
  keyUp,
  parseLayout,
  releaseAll,
  setLayout,
} from "../src/input.ts";

function recorder() {
  const out: string[] = [];
  const sink: InputSink = {
    move: (held: Dir | null, turn: boolean) => out.push(`move ${held} ${turn}`),
    step: (dir: Dir, turn: boolean) => out.push(`step ${dir} ${turn}`),
    attack: (held: boolean) => out.push(`attack ${held}`),
    action: () => out.push("action"),
  };
  return { out, sink };
}

const k = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({ key, ...more });
/** A Modern key: the physical position, with what a US layout would type. */
const m = (code: string, more: Partial<KeyPress> = {}): KeyPress => ({
  key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code === "Space" ? " " : code,
  code,
  ...more,
});

describe("classic keyboard", () => {
  test("a press sends a step and the held state; release sends the new held state", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("ArrowRight"));
    keyUp(s, sink, k("ArrowRight"));
    expect(out).toEqual(["step R false", "move R false", "move null false"]);
  });

  test("holding Left and Up walks left: L > R > U > D", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("ArrowUp"));
    keyDown(s, sink, k("ArrowLeft"));
    expect(out.at(-1)).toBe("move L false");
    keyUp(s, sink, k("ArrowLeft"));
    expect(out.at(-1)).toBe("move U false");
  });

  test("key repeat does not send extra steps", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("ArrowDown"));
    keyDown(s, sink, k("ArrowDown"));
    expect(out.filter((o) => o.startsWith("step"))).toHaveLength(1);
  });

  test("Alt + arrow turns in place", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("Alt", { altKey: true }));
    keyDown(s, sink, k("ArrowLeft", { altKey: true }));
    expect(out).toEqual(["move null true", "step L true", "move L true"]);
  });

  test("releasing one Alt keeps turning while the other Alt is held", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("ArrowLeft", { altKey: true }));
    keyUp(s, sink, k("Alt", { altKey: true }));
    expect(out.at(-1)).toBe("move L true");
    keyUp(s, sink, k("Alt"));
    expect(out.at(-1)).toBe("move L false");
  });

  test("object property names are not movement keys", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    expect(keyDown(s, sink, k("constructor"))).toBe(false);
    expect(keyUp(s, sink, k("toString"))).toBe(false);
    expect(out).toEqual([]);
  });

  test("Meta (Cmd) + arrow does not lock movement when keyup is swallowed", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    expect(keyDown(s, sink, k("Meta", { metaKey: true }))).toBe(false);
    expect(keyDown(s, sink, k("ArrowLeft", { metaKey: true }))).toBe(false);
    expect(keyUp(s, sink, k("Meta"))).toBe(false);
    expect(out).toEqual([]);
    expect(s.keys).toEqual({});
  });

  test("pressing Meta releases any already-held direction", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("ArrowRight"));
    expect(keyDown(s, sink, k("Meta", { metaKey: true }))).toBe(false);
    expect(out).toEqual(["step R false", "move R false", "move null false"]);
    expect(s.keys).toEqual({});
  });

  test("Ctrl sends the action once per press", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("Control"));
    keyDown(s, sink, k("Control", { repeat: true }));
    expect(out).toEqual(["action"]);
  });

  test("WASD, Space, E and Shift do nothing and are left to the page", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    for (const code of ["KeyW", "KeyA", "Space", "KeyE", "ShiftLeft"]) {
      expect(keyDown(s, sink, m(code))).toBe(false);
    }
    expect(out).toEqual([]);
  });
});

describe("modern keyboard", () => {
  test("W A S D walk, with the same L > R > U > D priority", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    keyDown(s, sink, m("KeyW"));
    expect(out).toEqual(["step U false", "move U false"]);
    keyDown(s, sink, m("KeyA"));
    expect(out.at(-1)).toBe("move L false");
    keyDown(s, sink, m("KeyD"));
    expect(out.at(-1)).toBe("step L false"); // Left still wins over Right
    keyUp(s, sink, m("KeyA"));
    expect(out.at(-1)).toBe("move R false");
    keyUp(s, sink, m("KeyD"));
    keyDown(s, sink, m("KeyS"));
    expect(out.at(-1)).toBe("step U false"); // Up over Down: still walking up
  });

  test("keys are read by position, so AZERTY's Z, Q, S, D walk", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    // AZERTY's Z sits where QWERTY's W is: the event says key "z", code "KeyW".
    keyDown(s, sink, { key: "z", code: "KeyW" });
    expect(out).toEqual(["step U false", "move U false"]);
    keyUp(s, sink, { key: "z", code: "KeyW" });
    // And AZERTY's W (code KeyZ) is not a movement key.
    expect(keyDown(s, sink, { key: "w", code: "KeyZ" })).toBe(false);
  });

  test("Shift + W A S D turns in place", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    keyDown(s, sink, m("ShiftLeft", { key: "Shift", shiftKey: true }));
    keyDown(s, sink, m("KeyA", { key: "A", shiftKey: true }));
    expect(out).toEqual(["move null true", "step L true", "move L true"]);
    keyUp(s, sink, m("ShiftLeft", { key: "Shift" }));
    expect(out.at(-1)).toBe("move L false");
  });

  test("Space is one attack hold state", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    expect(keyDown(s, sink, m("Space"))).toBe(true);
    keyDown(s, sink, m("Space", { repeat: true }));
    expect(keyUp(s, sink, m("Space"))).toBe(true);
    expect(out).toEqual(["attack true", "attack false"]);
  });

  test("auto-repeat does not reengage controls after they are released", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    const held = [m("KeyW"), m("Space"), m("ShiftLeft")];
    for (const key of held) {
      keyDown(s, sink, key);
    }
    releaseAll(s, sink);
    out.length = 0;
    for (const key of held) {
      expect(keyDown(s, sink, { ...key, repeat: true })).toBe(true);
    }
    expect(out).toEqual([]);
  });

  test("E sends the action once per press", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    expect(keyDown(s, sink, m("KeyE"))).toBe(true);
    keyDown(s, sink, m("KeyE", { repeat: true }));
    expect(out).toEqual(["action"]);
  });

  test("the classic keys do nothing; Tab and Alt are kept from the browser", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    expect(keyDown(s, sink, { key: "ArrowLeft", code: "ArrowLeft" })).toBe(false);
    expect(keyDown(s, sink, { key: "Control", code: "ControlLeft" })).toBe(false);
    // Swallowed: Tab would move focus to a button, Alt would open the menu bar.
    expect(keyDown(s, sink, { key: "Tab", code: "Tab" })).toBe(true);
    expect(keyDown(s, sink, { key: "Alt", code: "AltLeft", altKey: true })).toBe(true);
    expect(keyUp(s, sink, { key: "Alt", code: "AltLeft" })).toBe(true);
    expect(out).toEqual([]);
  });

  test("Meta releases held keys here too", () => {
    const s = createInputState("modern");
    const { out, sink } = recorder();
    keyDown(s, sink, m("KeyD"));
    expect(keyDown(s, sink, { key: "Meta", code: "MetaLeft", metaKey: true })).toBe(false);
    expect(out.at(-1)).toBe("move null false");
  });
});

describe("layouts", () => {
  test("nothing saved, or an unknown value, is Modern", () => {
    expect(parseLayout(null)).toBe("modern");
    expect(parseLayout("dvorak")).toBe("modern");
    expect(parseLayout("classic")).toBe("classic");
    expect(parseLayout("modern")).toBe("modern");
  });

  test("switching layout releases what the old one held", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("ArrowUp"));
    keyDown(s, sink, k("Tab"));
    out.length = 0;
    setLayout(s, sink, "modern");
    expect(out).toEqual(["move null false", "attack false"]);
    // An arrow's keyup after the switch changes nothing.
    keyUp(s, sink, { key: "ArrowUp", code: "ArrowUp" });
    expect(out).toHaveLength(2);
  });
});

describe("releaseAll", () => {
  test("releases held arrows, Alt and Tab", () => {
    const s = createInputState("classic");
    const { out, sink } = recorder();
    keyDown(s, sink, k("ArrowUp"));
    keyDown(s, sink, k("Alt", { altKey: true }));
    keyDown(s, sink, k("Tab"));
    out.length = 0;
    releaseAll(s, sink);
    expect(out).toEqual(["move null false", "attack false"]);
    expect(s.turnKey).toBe(false);
    expect(s.keys).toEqual({});
  });
});
