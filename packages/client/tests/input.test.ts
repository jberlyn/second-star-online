import { describe, expect, test } from "bun:test";

import type { Dir } from "@secondstaronline/shared";

import {
  ACTION_KEY,
  createInputState,
  type InputSink,
  keyDown,
  keyUp,
  releaseAll,
} from "../src/input.ts";

function recorder() {
  const out: string[] = [];
  const sink: InputSink = {
    move: (held: Dir | null, turn: boolean) => out.push(`move ${held} ${turn}`),
    step: (dir: Dir, turn: boolean) => out.push(`step ${dir} ${turn}`),
    attack: (held: boolean) => out.push(`attack ${held}`),
    action: () => {},
  };
  return { out, sink };
}

describe("keyboard", () => {
  test("a press sends a step and the held state; release sends the new held state", () => {
    const s = createInputState();
    const { out, sink } = recorder();
    keyDown(s, sink, "ArrowRight", false);
    keyUp(s, sink, "ArrowRight");
    expect(out).toEqual(["step R false", "move R false", "move null false"]);
  });

  test("holding Left and Up walks left: L > R > U > D", () => {
    const s = createInputState();
    const { out, sink } = recorder();
    keyDown(s, sink, "ArrowUp", false);
    keyDown(s, sink, "ArrowLeft", false);
    expect(out.at(-1)).toBe("move L false");
    keyUp(s, sink, "ArrowLeft");
    expect(out.at(-1)).toBe("move U false");
  });

  test("key repeat does not send extra steps", () => {
    const s = createInputState();
    const { out, sink } = recorder();
    keyDown(s, sink, "ArrowDown", false);
    keyDown(s, sink, "ArrowDown", false);
    expect(out.filter((o) => o.startsWith("step"))).toHaveLength(1);
  });

  test("Alt + arrow turns in place", () => {
    const s = createInputState();
    const { out, sink } = recorder();
    keyDown(s, sink, "Alt", true);
    keyDown(s, sink, "ArrowLeft", true);
    expect(out).toEqual(["move null true", "step L true", "move L true"]);
  });
});

describe("releaseAll", () => {
  test("releases held arrows, Alt and Tab", () => {
    const s = createInputState();
    const { out, sink } = recorder();
    keyDown(s, sink, "ArrowUp", false);
    keyDown(s, sink, "Alt", true);
    keyDown(s, sink, "Tab", false);
    out.length = 0;
    releaseAll(s, sink);
    expect(out).toEqual(["move null false", "attack false"]);
    expect(s.alt).toBe(false);
    expect(s.keys).toEqual({});
  });

  test("Ctrl sends the action once per press", () => {
    const s = createInputState();
    let actions = 0;
    const sink: InputSink = {
      move: () => {},
      step: () => {},
      attack: () => {},
      action: () => actions++,
    };
    keyDown(s, sink, ACTION_KEY, false);
    keyDown(s, sink, ACTION_KEY, false, true); // key repeat
    expect(actions).toBe(1);
  });
});
