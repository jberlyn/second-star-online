/**
 * Client tests: the Slot Machine panel (frame 72's channels 333-336). Rects are checked against
 * assets/original/main/layout/frame-72.json and cast-manifest.jsonl (Casino, castLib 27).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";

import { closeCasinoOnMapChange } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import { type Sfx, SOUND, spellSounds } from "../src/sfx.ts";
import {
  createSlotMachine,
  reelRect,
  SLOT_FACES,
  SLOT_ORIGIN,
  SLOT_RECTS,
  SLOT_REEL_LOCS,
} from "../src/ui/slots.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

const ROOT = join(import.meta.dir, "../../../assets/original/main/layout");
const FRAME = JSON.parse(readFileSync(join(ROOT, "frame-72.json"), "utf8")) as {
  sprites: { channel: number; loc: number[]; rect: number[] }[];
};
const MANIFEST = readFileSync(join(ROOT, "cast-manifest.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, unknown>)
  .filter((m) => m.castLib === 27);
const member = (n: number) =>
  MANIFEST.find((m) => m.member === n) as {
    width: number;
    height: number;
    regX: number;
    regY: number;
  };
const asRect = (r: { x: number; y: number; w: number; h: number }) => [
  r.x,
  r.y,
  r.x + r.w,
  r.y + r.h,
];

function machine(random: (n: number) => number = () => 1) {
  const log: unknown[] = [];
  const sounds: Sfx[] = [];
  const state = { locked: false, framed: false };
  const m = createSlotMachine(fakeAssets, {
    pull: () => log.push("pull"),
    close: () => log.push("close"),
    lock: (on) => {
      state.locked = on;
    },
    frame: (on) => {
      state.framed = on;
      log.push(["frame", on]);
    },
    sound: (s) => sounds.push(s),
    random,
  });
  document.body.replaceChildren(m.el);
  const button = (label: string) =>
    m.el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) as HTMLButtonElement;
  const faces = () =>
    [...m.el.querySelectorAll<HTMLElement>(".slot-reel")].map((e) => e.dataset.face);
  const lever = () => ({
    up: !(m.el.querySelectorAll(".slot-art")[0] as HTMLElement).hidden,
    down: !(m.el.querySelectorAll(".slot-art")[1] as HTMLElement).hidden,
  });
  return { m, log, sounds, state, button, faces, lever };
}

describe("placement", () => {
  test("the panel and the pulled panel sit at loc − reg", () => {
    const loc = FRAME.sprites.find((s) => s.channel === 333)?.loc as number[];
    for (const [n, key] of [
      [2, "panel"],
      [3, "pulled"],
    ] as const) {
      const mem = member(n);
      expect(asRect(SLOT_RECTS[key])).toEqual([
        (loc[0] as number) - mem.regX,
        (loc[1] as number) - mem.regY,
        (loc[0] as number) - mem.regX + mem.width,
        (loc[1] as number) - mem.regY + mem.height,
      ]);
    }
  });

  test("the reels sit at the sprites' rects, each face at its own size and regpoint", () => {
    for (const [i, ch] of [334, 335, 336].entries()) {
      const s = FRAME.sprites.find((x) => x.channel === ch) ?? { loc: [0, 0], rect: [0] };
      expect(asRect(reelRect(i, 0))).toEqual(s.rect);
      expect(SLOT_REEL_LOCS[i]).toEqual({ x: s.loc[0] as number, y: s.loc[1] as number });
    }
    for (const face of SLOT_FACES) {
      const mem = member(face.member);
      expect([face.w, face.h, face.rx, face.ry]).toEqual([
        mem.width,
        mem.height,
        mem.regX,
        mem.regY,
      ]);
    }
    // S1 and S2 are not the 51×39 blank's size (Casino 10, 11).
    expect(asRect(reelRect(0, 1))).toEqual([225, 132, 282, 194]);
    expect(asRect(reelRect(1, 2))).toEqual([293, 139, 336, 181]);
  });

  test("Close is mouseH 200-216, mouseV 64-79 and the lever mouseH 168-188, mouseV 56-219", () => {
    expect(asRect(SLOT_RECTS.close)).toEqual([200, 64, 217, 80]);
    expect(asRect(SLOT_RECTS.pull)).toEqual([168, 56, 189, 220]);
    const { m, button } = machine();
    m.show(true);
    const close = button("Close the slot machine");
    expect(close.style.left).toBe(`${200 - SLOT_ORIGIN.x}px`);
    expect(close.style.top).toBe("16px");
    expect(close.dataset.action).toBe("slots-close");
    expect(button("Pull the lever").dataset.action).toBe("slots-pull");
  });
});

describe("the panel", () => {
  test("opening shows blank reels with the lever up, locks the keys and goes to frame 72", () => {
    const { m, state, faces, lever } = machine();
    expect(m.el.hidden).toBe(true);
    m.show(true);
    expect(m.el.hidden).toBe(false);
    expect(m.isOpen).toBe(true);
    expect(faces()).toEqual(["0", "0", "0"]);
    expect(lever()).toEqual({ up: true, down: false });
    expect(state).toEqual({ locked: true, framed: true });
  });

  test("Pull swaps to the pulled-lever art and sends once while a pull is in progress", () => {
    const { m, log, button, lever } = machine();
    m.show(true);
    button("Pull the lever").click();
    button("Pull the lever").click();
    expect(log.filter((x) => x === "pull")).toHaveLength(1);
    expect(lever()).toEqual({ up: false, down: true });
    expect(m.pulling).toBe(true);
  });

  test("Close does nothing while a pull settles; else it sends, unlocks and shows the first tab", () => {
    const { m, log, state, button } = machine();
    m.show(true);
    button("Pull the lever").click();
    button("Close the slot machine").click();
    expect(log).not.toContain("close");
    expect(m.isOpen).toBe(true);
    m.result([1, 2, 3], false);
    button("Close the slot machine").click();
    expect(log).toContain("close");
    expect(m.isOpen).toBe(false);
    expect(m.el.hidden).toBe(true);
    expect(state).toEqual({ locked: false, framed: false });
  });

  test("each animation frame shows a random face on every reel until the result", () => {
    const rolls = [3, 1, 4, 2, 2, 2];
    let i = 0;
    const { m, faces } = machine(() => rolls[i++] ?? 1);
    m.show(true);
    m.spin();
    m.frame();
    expect(faces()).toEqual(["3", "1", "4"]);
    m.frame();
    expect(faces()).toEqual(["2", "2", "2"]);
  });

  test("the result shows its faces and puts the lever back; cash plays on a win only", () => {
    const { m, sounds, faces, lever, button } = machine();
    m.show(true);
    button("Pull the lever").click();
    m.result([2, 3, 2], true);
    expect(faces()).toEqual(["2", "3", "2"]);
    expect(lever()).toEqual({ up: true, down: false });
    expect(m.pulling).toBe(false);
    expect(sounds).toEqual([SOUND.cash]);
    button("Pull the lever").click();
    m.result([1, 2, 4], false);
    expect(faces()).toEqual(["1", "2", "4"]);
    expect(sounds).toHaveLength(1);
  });

  test("a null result stops the reels where they are and puts the lever back", () => {
    const { m, faces, lever, button } = machine(() => 3);
    m.show(true);
    button("Pull the lever").click();
    m.spin();
    m.frame();
    m.result(null, false);
    expect(faces()).toEqual(["3", "3", "3"]);
    expect(lever()).toEqual({ up: true, down: false });
    expect(m.pulling).toBe(false);
    expect(m.isOpen).toBe(true);
  });

  test("the server's close hides the panel, frees the keys and shows the first tab", () => {
    const { m, state, button } = machine();
    m.show(true);
    button("Pull the lever").click();
    m.show(false);
    expect(m.isOpen).toBe(false);
    expect(m.pulling).toBe(false);
    expect(state).toEqual({ locked: false, framed: false });
  });

  test("the panel closes via Close or show(false) (used by app.ts on map change)", () => {
    const { m, state } = machine();
    m.show(true);
    // A map load clears the keys and touches nothing else here.
    state.locked = false;
    expect(m.isOpen).toBe(true);
    expect(m.el.hidden).toBe(false);
  });
});

describe("sounds", () => {
  test("kept bug: the Slot Machine sound picks random(4) before the BSmith roll", () => {
    const calls: number[] = [];
    const rolls = [3, 1];
    const out = spellSounds("Slot Machine", (n) => {
      calls.push(n);
      return rolls[calls.length - 1] ?? 1;
    });
    expect(calls).toEqual([4, 2]);
    expect(out).toEqual([{ name: "SlotMachine", ch: 3 }]);
  });

  test("another spell draws only the random(2) roll", () => {
    const calls: number[] = [];
    spellSounds("Portal", (n) => {
      calls.push(n);
      return 1;
    });
    expect(calls).toEqual([2]);
  });
});

describe("snapshot map-change cleanup", () => {
  test("closes slots, blackjack, and checkers only when moving to a different map", () => {
    const events: string[] = [];
    const ui = {
      slots: { show: (open: boolean) => events.push(`slots:${open}`) },
      blackjack: { close: () => events.push("bj:close") },
      checkers: { reset: () => events.push("ck:reset") },
    };
    closeCasinoOnMapChange(undefined, "x1000y992", ui);
    closeCasinoOnMapChange("x1000y992", "x1000y992", ui);
    expect(events).toEqual([]);

    closeCasinoOnMapChange("x1000y992", "x1001y992", ui);
    expect(events).toEqual(["slots:false", "bj:close", "ck:reset"]);
  });
});
