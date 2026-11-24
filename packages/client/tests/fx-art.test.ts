/**
 * Spell effects on the Content page (issue #29, stage 5): how files are sorted and matched to
 * runs, where a run's frames are anchored, what the panel says and writes to the draft, and the
 * bulk upload.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  artRowFingerprint,
  type ContentFxArtView,
  type FxChange,
  type FxRunUse,
  type Pixels,
} from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import {
  bulkFxErrors,
  bulkFxFrames,
  createFxArtPicker,
  createSpellEffects,
  framesInOrder,
  fxFiles,
  fxList,
  fxRepaintText,
  fxSource,
  groupFxFiles,
  guideLayout,
  inRange,
  knownRuns,
  matchFx,
  previewAt,
  runAnchor,
  savedFxFrames,
  shownCount,
  showsText,
  sizedAnchor,
} from "../src/ui/fx-art.ts";

afterEach(() => document.body.replaceChildren());

const FILE = "a".repeat(64);
const crush: FxRunUse = {
  member: "Crush",
  effect: "Crush",
  show: "point",
  needs: 4,
  trail: 0,
  trigger: 0,
  users: ["spell Crush"],
  spell: "Crush",
  content: true,
};
const firebolt: FxRunUse = {
  member: "Firebolt",
  effect: "Firebolt",
  show: "point",
  needs: 3,
  trail: 2,
  trigger: 0,
  users: ["spell Firebolt"],
  spell: "Firebolt",
  content: true,
};
const bolt: FxRunUse = {
  member: "BoltL",
  effect: "BoltL",
  show: "projectile",
  needs: 3,
  trail: 0,
  trigger: 0,
  users: ["spell Bolt"],
  spell: "Bolt",
  projectile: { axis: "locH", px: -8 },
  content: true,
};
const fishing: FxRunUse = {
  member: "Fishing",
  effect: "Fishing",
  show: "engine",
  needs: 2,
  trail: 0,
  trigger: 0,
  users: ["fishing"],
  content: false,
};
const view = (over: Partial<ContentFxArtView> = {}): ContentFxArtView => ({
  runs: [crush, firebolt, bolt, fishing],
  spells: [
    { name: "Crush", fx: [{ member: "Crush", effect: "Crush", frames: 4, lastFrame: 4 }] },
    { name: "Firebolt", fx: [{ member: "Firebolt", effect: "Firebolt", frames: 3, lastFrame: 3 }] },
    {
      name: "Bolt",
      fx: [
        { member: "BoltL", effect: "BoltL", frames: 3, lastFrame: null },
        { member: "BoltR", effect: "BoltR", frames: 3, lastFrame: null },
      ],
    },
  ],
  art: [{ name: "Sparkle", frames: [{ file: FILE, regX: 4, regY: 4 }] }],
  packRuns: { crush: { frames: 4, trail: 0 }, firebolt: { frames: 3, trail: 3 } },
  maxSide: 512,
  head: 1,
  ...over,
});

const noArt = {
  index: {
    atlases: { fx: { sheets: [], sprites: {} }, paperdoll: { sheets: [], sprites: {} } },
    ui: {},
  },
  sheets: {},
  sprite: () => undefined,
  ui: () => "",
  loadGroup: async () => {},
} as unknown as Assets;

/** A frame with one dot. */
const frame = (w = 16, h = 16): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  data.set([200, 30, 30, 255], (5 * w + 5) * 4);
  return { width: w, height: h, data };
};
/** A strip of `across` × `rows` 16×16 cells, the first `drawn[row]` of each row with a dot. */
const strip = (across: number, drawn: number[]): Pixels => {
  const w = across * 16;
  const h = drawn.length * 16;
  const data = new Uint8ClampedArray(w * h * 4);
  drawn.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      data.set([200, 30, 30, 255], ((r * 16 + 5) * w + i * 16 + 5) * 4);
    }
  });
  return { width: w, height: h, data };
};
const stored = (n: number) => ({
  ok: true as const,
  stored: { file: String(n % 10).repeat(64), ext: "png" },
});
const tick = () => new Promise((r) => setTimeout(r, 10));

function choose(el: HTMLElement, action: string, files: File[]): void {
  const input = el.querySelector<HTMLInputElement>(`[data-action="${action}"]`);
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input?.dispatchEvent(new Event("change"));
}
const click = (el: HTMLElement, a: string) =>
  el.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)?.click();
const files = (stem: string, n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => new File([new Uint8Array(i + 1)], `${stem}-${i + from}.png`));

describe("what the panel reads", () => {
  test("runs, where their frames come from, and what a name stands for", () => {
    expect(fxList(view()).map((r) => r.member)).toEqual([
      "BoltL",
      "Crush",
      "Firebolt",
      "Fishing",
      "Sparkle",
    ]);
    expect(fxSource(view(), "sparkle").kind).toBe("upload");
    expect(fxSource(view(), "Crush")).toEqual({ kind: "pack", frames: 4, trail: 0 });
    expect(fxSource(view(), "BoltL").kind).toBe("none");
    expect(knownRuns(view())).toContain("Sparkle");
    expect(matchFx("CRUSH", view())).toEqual({ kind: "run", run: "Crush" });
    expect(matchFx("Nothing", view())).toMatchObject({ kind: "none" });
    expect(fxRepaintText(view(), "Crush")).toBe("Repaints Crush for spell Crush.");
    expect(fxRepaintText(view(), "Sparkle")).toBe("Repaints Sparkle, which nothing draws yet.");
    expect(showsText(firebolt)).toBe("shows 3 frames, with a 2-frame trail");
    expect(showsText(bolt)).toBe("cycles frames 1 to 3 as it flies");
  });

  test("files: one strip, or numbered frames with a trail's beside them", () => {
    expect(fxFiles(["Crush.png"])).toEqual({ kind: "sheet", file: "Crush.png" });
    const f = fxFiles(["Firebolt-2.png", "xFirebolt-1.png", "Firebolt-1.png"]);
    expect(f).toEqual({
      kind: "frames",
      stem: "Firebolt",
      frames: [
        { file: "Firebolt-1.png", n: 1 },
        { file: "Firebolt-2.png", n: 2 },
      ],
      trail: [{ file: "xFirebolt-1.png", n: 1 }],
    });
    // A run whose own name starts with x is a run, not a trail, when it is alone.
    expect(fxFiles(["xSmokeoBomb-1.png"])).toMatchObject({ stem: "xSmokeoBomb", trail: [] });
    expect(fxFiles(["Crush-1.png", "Bolt-1.png"])).toMatchObject({ kind: "bad" });
    expect(fxFiles(["Crush-1.png", "crush-1.png"])).toMatchObject({ kind: "bad" });
    expect(groupFxFiles(["Crush-1.png", "xFirebolt-1.png", "Firebolt-1.png", "Bolt.png"])).toEqual([
      { stem: "Crush", files: ["Crush-1.png"] },
      { stem: "Firebolt", files: ["xFirebolt-1.png", "Firebolt-1.png"] },
      { stem: "Bolt", files: ["Bolt.png"] },
    ]);
  });

  test("frame numbers, how many show, and anchors", () => {
    expect(framesInOrder([1, 2, 3])).toBe("");
    expect(framesInOrder([1, 4])).toBe("frames 2, 3 missing");
    expect(shownCount(crush, 8, true)).toBe(8);
    expect(shownCount(crush, 8, false)).toBe(4);
    expect(shownCount(bolt, 8, true)).toBe(3);
    // A frame 4 px wider keeps the run's anchor on its middle.
    expect(sizedAnchor({ regX: 10, regY: 5 }, frame(16, 16), frame(20, 16))).toEqual({
      regX: 12,
      regY: 5,
    });
    expect(savedFxFrames([{ file: FILE, regX: 10, regY: 5 }], { x: 3, y: -2 })).toEqual([
      { file: FILE, regX: 7, regY: 7 },
    ]);
    expect(inRange([{ file: FILE, regX: 2049, regY: 0 }])).toBe(false);
  });

  test("a bulk line's frames are checked before Attach", () => {
    const sheet = new Map<string, Pixels | null>([["Crush.png", strip(4, [4])]]);
    const cut = bulkFxFrames(["Crush.png"], sheet, { needs: 4, trail: 0 });
    expect("error" in cut ? cut.error : cut.frames.length).toBe(4);
    const odd = new Map<string, Pixels | null>([["Crush.png", frame(50, 16)]]);
    expect(bulkFxFrames(["Crush.png"], odd, { needs: 0, trail: 0 })).toMatchObject({
      error: expect.stringContaining("not square"),
    });
    const gap = new Map<string, Pixels | null>([
      ["Crush-1.png", frame()],
      ["Crush-3.png", frame()],
    ]);
    expect(bulkFxFrames(["Crush-1.png", "Crush-3.png"], gap, { needs: 0, trail: 0 })).toMatchObject(
      {
        error: expect.stringContaining("frame 2 missing"),
      },
    );
    const two = { frames: [frame(), frame()], trail: [] };
    expect(bulkFxErrors(two, "alpha", crush, false)).toContain("shows 4 frames but there are 2");
    expect(bulkFxErrors(two, "alpha", crush, true)).toBe("");
    const blank = { frames: [{ width: 4, height: 4, data: new Uint8ClampedArray(64) }], trail: [] };
    expect(bulkFxErrors(blank, "alpha", undefined, false)).toContain("Frame 1 shows nothing");
  });
});

describe("the panel", () => {
  function picker(
    sent: FxChange[],
    over: { apply?: (c: FxChange) => Promise<{ ok: boolean; text: string; run?: string }> } = {},
  ) {
    const slices: [number, number, number][] = [];
    const p = createFxArtPicker({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice: async (_s, layout) => {
        slices.push([layout.across, layout.runRows, layout.trailRows]);
        return {
          ok: true,
          cell: { w: 16, h: 16 },
          frames: Array.from({ length: layout.across * layout.runRows }, () => "b".repeat(64)),
          trail: layout.trailRows > 0 ? ["c".repeat(64)] : [],
        };
      },
      decode: async (src) =>
        typeof src !== "string" && (src as File).name === "Crush.png" ? strip(4, [4]) : frame(),
      apply:
        over.apply ??
        (async (c) => {
          sent.push(c);
          return { ok: true, text: "In the draft.", run: c.run };
        }),
      saved: () => {},
    });
    document.body.append(p.el);
    return { p, slices };
  }

  test("frames come in; saving waits for as many as the run shows, then can fit its spell", async () => {
    const sent: FxChange[] = [];
    const { p } = picker(sent);
    p.show({ kind: "spell", spell: "Crush" }, view());
    expect(p.el.textContent).toContain("Crush shows 4 frames. Drawn by spell Crush.");
    // With fit off, two frames are too few.
    choose(p.el, "fx-art-files", files("Crush", 2));
    await tick();
    const fit = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-fit"]',
    ) as HTMLInputElement;
    expect(fit.checked).toBe(true);
    const save = p.el.querySelector<HTMLButtonElement>('[data-action="fx-art-save"]');
    expect(save?.disabled).toBe(false);
    fit.click();
    expect(save?.disabled).toBe(true);
    expect(p.el.textContent).toContain("Crush shows 4 frames but there are 2");
    fit.click();
    expect(p.el.textContent).toContain("Spell Crush plays all 2 frames (it shows 4 now)");
    // Everyone a repaint changes is named.
    expect(p.el.textContent).toContain("Repaints Crush for spell Crush.");
    click(p.el, "fx-art-save");
    await tick();
    expect(sent[0]).toMatchObject({
      op: "set",
      run: "Crush",
      fit: true,
      seen: ["spell Crush"],
      trail: null,
    });
    expect((sent[0] as Extract<FxChange, { op: "set" }>).frames).toHaveLength(2);
  });

  test("a gap in the numbering changes nothing; frames without frame 1 replace only themselves", async () => {
    const sent: FxChange[] = [];
    const { p } = picker(sent);
    p.show({ kind: "run", run: "Fishing" }, view());
    choose(p.el, "fx-art-files", [
      new File([new Uint8Array(1)], "Fishing-1.png"),
      new File([new Uint8Array(2)], "Fishing-3.png"),
    ]);
    await tick();
    expect(p.el.textContent).toContain("frame 2 missing");
    expect(p.pending()).toBe(false);
    choose(p.el, "fx-art-files", files("Fishing", 2));
    await tick();
    choose(p.el, "fx-art-files", files("Fishing", 1, 2));
    await tick();
    click(p.el, "fx-art-save");
    await tick();
    // The engine run has no spell: nothing to fit.
    expect(sent[0]).toMatchObject({ op: "set", run: "Fishing", seen: ["fishing"] });
    expect("fit" in (sent[0] as object)).toBe(false);
    expect((sent[0] as Extract<FxChange, { op: "set" }>).frames.map((f) => f.file)).toEqual([
      "1".repeat(64),
      "1".repeat(64),
    ]);
  });

  test("a strip is cut by the server in the guessed layout, and can be cut again", async () => {
    const sent: FxChange[] = [];
    const { p, slices } = picker(sent);
    p.show({ kind: "spell", spell: "Crush" }, view());
    choose(p.el, "fx-art-files", [new File([new Uint8Array(1)], "Crush.png")]);
    await tick();
    expect(slices).toEqual([[4, 1, 0]]);
    expect(p.el.textContent).toContain("cut into 4 frames");
    const across = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-across"]',
    ) as HTMLInputElement;
    across.value = "2";
    click(p.el, "fx-art-recut");
    await tick();
    expect(slices[1]).toEqual([2, 1, 0]);
  });

  test("a save answered after the panel moved on changes nothing shown now", async () => {
    let release: (v: { ok: boolean; text: string }) => void = () => {};
    const sent: FxChange[] = [];
    const { p } = picker(sent, {
      apply: (c) => {
        sent.push(c);
        return new Promise((r) => {
          release = r;
        });
      },
    });
    p.show({ kind: "spell", spell: "Crush" }, view());
    choose(p.el, "fx-art-files", files("Crush", 4));
    await tick();
    click(p.el, "fx-art-save");
    p.show({ kind: "new" }, view());
    const name = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-name"]',
    ) as HTMLInputElement;
    name.value = "Sparkle";
    name.dispatchEvent(new Event("input"));
    choose(p.el, "fx-art-files", files("Sparkle", 2));
    await tick();
    expect(p.pending()).toBe(true);
    release({ ok: true, text: "In the draft." });
    await tick();
    expect(p.pending()).toBe(true);
    expect(p.current()).toEqual({ kind: "new" });
  });

  test("a new run needs a name first, and is shown under it once saved", async () => {
    const sent: FxChange[] = [];
    const { p } = picker(sent);
    p.show({ kind: "new" }, view());
    const input = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-files"]',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const name = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-name"]',
    ) as HTMLInputElement;
    name.value = "Glow";
    name.dispatchEvent(new Event("input"));
    expect(input.disabled).toBe(false);
    choose(p.el, "fx-art-files", files("Glow", 3));
    await tick();
    click(p.el, "fx-art-save");
    await tick();
    expect(sent[0]).toMatchObject({ op: "set", run: "Glow", seen: [] });
    expect(p.current()).toEqual({ kind: "run", run: "Glow" });
  });

  test("offsets are clamped; an upload can be taken out", async () => {
    const sent: FxChange[] = [];
    const { p } = picker(sent);
    p.show({ kind: "run", run: "Sparkle" }, view());
    await tick();
    const right = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-right"]',
    ) as HTMLInputElement;
    right.value = "5000";
    right.dispatchEvent(new Event("change"));
    expect(right.value).toBe("1024");
    click(p.el, "fx-art-cancel");
    await tick();
    click(p.el, "fx-art-remove");
    await tick();
    expect(sent.at(-1)).toEqual({
      op: "remove",
      run: "Sparkle",
      expect: artRowFingerprint(view().art[0]),
    });
  });

  test("a spell with several runs offers a choice of run", () => {
    const { p } = picker([]);
    p.show({ kind: "spell", spell: "Bolt" }, view());
    const sel = p.el.querySelector<HTMLSelectElement>(
      '[data-action="fx-art-run"]',
    ) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["BoltL", "BoltR"]);
    sel.value = "BoltR";
    sel.dispatchEvent(new Event("change"));
    expect(p.current()).toEqual({ kind: "spell", spell: "Bolt", run: "BoltR" });
  });
});

describe("the Spell effects section", () => {
  function section(sent: FxChange[], gate?: Promise<void>) {
    const s = createSpellEffects({
      assets: noArt,
      upload: async (f) => {
        await gate;
        return stored(f.size);
      },
      slice: async (_s, layout) => ({
        ok: true,
        cell: { w: 16, h: 16 },
        frames: Array.from({ length: layout.across * layout.runRows }, () => "b".repeat(64)),
        trail: [],
      }),
      decode: async (src) =>
        typeof src !== "string" && (src as File).name === "Crush.png" ? strip(4, [4]) : frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "In the draft." };
      },
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    return s;
  }

  test("files are matched to runs, checked, and attached", async () => {
    const sent: FxChange[] = [];
    const s = section(sent);
    choose(s.el, "fx-files", [new File([new Uint8Array(1)], "Crush.png"), ...files("Fishing", 2)]);
    await tick();
    expect(s.el.textContent).toContain("Every file matches a run.");
    click(s.el, "fx-attach");
    await tick();
    await tick();
    expect(sent.map((c) => (c as { run: string }).run).sort()).toEqual(["Crush", "Fishing"]);
    expect(sent.find((c) => (c as { run: string }).run === "Crush")).toMatchObject({
      fit: true,
      seen: ["spell Crush"],
    });
  });

  test("two lines for one run clash; a reset mid-upload writes nothing and gives the controls back", async () => {
    const sent: FxChange[] = [];
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const s = section(sent, gate);
    choose(s.el, "fx-files", [new File([new Uint8Array(1)], "Crush.png")]);
    choose(s.el, "fx-files", files("crush", 4));
    await tick();
    expect(s.el.textContent).toContain("Another line is for the same run");
    click(s.el, "fx-clear");
    choose(s.el, "fx-files", files("Fishing", 2));
    await tick();
    click(s.el, "fx-attach");
    await tick();
    s.reset();
    s.setView(view());
    open();
    await tick();
    await tick();
    expect(sent).toEqual([]);
    const input = s.el.querySelector<HTMLInputElement>(
      '[data-action="fx-files"]',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  test("Discard drops frames set up in the section's panel", async () => {
    const s = section([]);
    (s.el.querySelector('[data-action="fx-open"][data-key="sparkle"]') as HTMLElement).click();
    await tick();
    const right = s.el.querySelector<HTMLInputElement>(
      '[data-action="fx-right"]',
    ) as HTMLInputElement;
    right.value = "2";
    right.dispatchEvent(new Event("change"));
    expect(s.pending()).toBe(true);
    s.discard();
    expect(s.pending()).toBe(false);
  });
});

describe("review fixes (Sol, stage 5)", () => {
  function picker(sent: FxChange[]) {
    const p = createFxArtPicker({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "In the draft." };
      },
      saved: () => {},
    });
    document.body.append(p.el);
    return p;
  }

  test("Sol 3: a save names the upload the panel saw (null when there was none)", async () => {
    const sent: FxChange[] = [];
    const p = picker(sent);
    p.show({ kind: "spell", spell: "Crush" }, view());
    choose(p.el, "fx-art-files", files("Crush", 4));
    await tick();
    click(p.el, "fx-art-save");
    await tick();
    expect(sent[0]).toMatchObject({ op: "set", expect: null });
  });

  test("Sol 4: a trail frame chosen on its own goes to the run's trail", async () => {
    expect(fxFiles(["xFirebolt-2.png"], "Firebolt")).toEqual({
      kind: "frames",
      stem: "Firebolt",
      frames: [],
      trail: [{ file: "xFirebolt-2.png", n: 2 }],
    });
    // Neon 3: the run only picks out its trail: other names are its frames (a hand-matched line).
    expect(fxFiles(["ring-1.png", "ring-2.png"], "Firebolt")).toMatchObject({
      kind: "frames",
      frames: [{ n: 1 }, { n: 2 }],
      trail: [],
    });
    expect(fxFiles(["ring-1.png", "orb-2.png"], "Firebolt")).toMatchObject({ kind: "bad" });
    expect(matchFx("xFirebolt", view())).toEqual({ kind: "run", run: "Firebolt" });
    const sent: FxChange[] = [];
    const p = picker(sent);
    p.show({ kind: "spell", spell: "Firebolt" }, view());
    choose(p.el, "fx-art-files", [...files("Firebolt", 3), ...files("xFirebolt", 2)]);
    await tick();
    // Only xFirebolt-2 again: the trail's frame 2 is replaced, the run's frames are not.
    choose(p.el, "fx-art-files", [new File([new Uint8Array(7)], "xFirebolt-2.png")]);
    await tick();
    click(p.el, "fx-art-save");
    await tick();
    const c = sent[0] as Extract<FxChange, { op: "set" }>;
    expect([c.frames.length, c.trail?.length]).toEqual([3, 2]);
    expect(c.frames.map((f) => f.file)).toEqual(["1", "2", "3"].map((n) => n.repeat(64)));
    expect(c.trail?.map((f) => f.file)).toEqual(["1".repeat(64), "7".repeat(64)]);
  });

  test("Sol 7: chosen files count as unsaved work, and Discard stops a batch before it writes", async () => {
    const sent: FxChange[] = [];
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const s = createSpellEffects({
      assets: noArt,
      upload: async (f) => {
        await gate;
        return stored(f.size);
      },
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "ok" };
      },
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    choose(s.el, "fx-files", files("Fishing", 2));
    await tick();
    expect(s.pending()).toBe(true);
    click(s.el, "fx-attach");
    await tick();
    expect(s.pending()).toBe(true);
    s.discard();
    expect(s.pending()).toBe(false);
    open();
    await tick();
    await tick();
    expect(sent).toEqual([]);
  });

  test("Sol 8: the default anchor is measured after green is keyed out", () => {
    // A 16×16 picture on pure green with one red dot at (2, 3).
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data.set([0, 255, 0, 255], i);
    }
    data.set([200, 30, 30, 255], (3 * 16 + 2) * 4);
    const pic = { width: 16, height: 16, data };
    expect(runAnchor(pic, { x: 0, y: 0 }, "green")).toEqual({ regX: 2, regY: 3 });
    expect(runAnchor(pic, { x: 0, y: 0 }, "alpha")).toEqual({ regX: 8, regY: 8 });
  });

  test("Sol 10 / Neon 1: the guide strip wraps to fit the 2048 px upload limit", () => {
    expect(guideLayout(8)).toEqual({ cell: 96, across: 8, runRows: 1, trailRows: 0 });
    // Crush's 30 frames wrap onto a second row of 21 cells; Whirlwind's 60 onto three.
    expect(guideLayout(30)).toEqual({ cell: 96, across: 21, runRows: 2, trailRows: 0 });
    const whirl = guideLayout(60);
    expect(whirl.across * whirl.cell).toBeLessThanOrEqual(2048);
    expect(whirl.runRows).toBe(3);
    // Firebolt: 16 frames and a 16-frame trail, a row each.
    expect(guideLayout(16, 16)).toEqual({ cell: 96, across: 16, runRows: 1, trailRows: 1 });
  });

  test("Sol 11: plays restart from frame 1 on whole ticks; projectiles move their own way", () => {
    // Five frames: 1, 3, 5 are seen, then a rest, then 1 again (never 2 or 4).
    const seen = Array.from({ length: 20 }, (_, step) => previewAt(step, 5, null).index);
    expect(seen.filter((i) => i !== null).every((i) => (i as number) % 2 === 0)).toBe(true);
    expect(seen.slice(0, 3)).toEqual([0, 2, 4]);
    expect(seen.indexOf(0, 1)).toBeGreaterThan(3);
    // A leftward projectile moves left.
    expect(previewAt(2, 3, -8)).toEqual({ index: 1, moved: -32 });
    expect(previewAt(2, 3, 8).moved).toBe(32);
  });
});

describe("review fixes (Neon, stage 5)", () => {
  const meteor: FxRunUse = {
    ...crush,
    member: "Meteor",
    effect: "Meteor",
    spell: "Meteor",
    users: ["spell Meteor"],
    needs: 22,
    trigger: 19,
  };
  const nview = (over: Partial<ContentFxArtView> = {}) =>
    view({
      runs: [crush, firebolt, bolt, fishing, meteor],
      spells: [
        ...view().spells,
        { name: "Meteor", fx: [{ member: "Meteor", effect: "Meteor", frames: 22, lastFrame: 22 }] },
      ],
      packRuns: { ...view().packRuns, meteor: { frames: 22, trail: 0 } },
      ...over,
    });
  function picker(
    sent: FxChange[],
    over: {
      decode?: (src: string | Blob) => Promise<Pixels | null>;
      slice?: () => Promise<never>;
    } = {},
  ) {
    const p = createFxArtPicker({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice:
        over.slice ??
        (async (_s, layout) => ({
          ok: true,
          cell: { w: 16, h: 16 },
          frames: Array.from({ length: layout.across * layout.runRows }, () => "b".repeat(64)),
          trail: [],
        })),
      decode:
        over.decode ??
        (async (src) =>
          typeof src !== "string" && (src as File).name === "Meteor.png"
            ? strip(22, [22])
            : frame()),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "In the draft." };
      },
      saved: () => {},
    });
    document.body.append(p.el);
    return p;
  }
  const save = (p: { el: HTMLElement }) =>
    p.el.querySelector<HTMLButtonElement>('[data-action="fx-art-save"]') as HTMLButtonElement;

  test("Neon 2: the panel will not fit a spell's run below the frame its effect acts on", async () => {
    const sent: FxChange[] = [];
    const p = picker(sent);
    p.show({ kind: "spell", spell: "Meteor" }, nview());
    choose(p.el, "fx-art-files", files("Meteor", 6));
    await tick();
    expect(p.el.textContent).toContain("acts on frame 19 of its effect");
    expect(save(p).disabled).toBe(true);
    // Unticked, six frames are too few for the 22 it shows: refused too, for that reason.
    const fit = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-fit"]',
    ) as HTMLInputElement;
    fit.click();
    expect(p.el.textContent).toContain("Meteor shows 22 frames but there are 6");
    expect(
      bulkFxErrors({ frames: Array(6).fill(frame()), trail: [] }, "alpha", meteor, true),
    ).toContain("acts on frame 19");
  });

  test("Neon 3: frames hand-matched to a run in the bulk list attach", async () => {
    const sent: FxChange[] = [];
    const s = createSpellEffects({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "ok" };
      },
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    choose(s.el, "fx-files", files("ring", 2));
    await tick();
    const input = s.el.querySelector<HTMLInputElement>(
      '[data-action="fx-for"]',
    ) as HTMLInputElement;
    input.value = "Fishing";
    input.dispatchEvent(new Event("change"));
    expect(s.el.textContent).toContain("Ready.");
    click(s.el, "fx-attach");
    await tick();
    await tick();
    expect(sent[0]).toMatchObject({ op: "set", run: "Fishing" });
  });

  test("Neon 4: naming a new run after its frames are in updates the fit box and notes", async () => {
    const sent: FxChange[] = [];
    const p = picker(sent);
    p.show({ kind: "new" }, view());
    const name = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-name"]',
    ) as HTMLInputElement;
    name.value = "Glow";
    name.dispatchEvent(new Event("input"));
    choose(p.el, "fx-art-files", files("Glow", 2));
    await tick();
    const fitLabel = () =>
      (p.el.querySelector('[data-action="fx-art-fit"]') as HTMLElement).closest(
        "label",
      ) as HTMLElement;
    expect(fitLabel().hidden).toBe(true);
    name.value = "Crush";
    name.dispatchEvent(new Event("input"));
    expect(fitLabel().hidden).toBe(false);
    click(p.el, "fx-art-save");
    await tick();
    expect(sent[0]).toMatchObject({ run: "Crush", fit: true });
    // And back to a name no spell uses: no fit is sent.
    p.show({ kind: "new" }, view());
    name.value = "Crush";
    name.dispatchEvent(new Event("input"));
    choose(p.el, "fx-art-files", files("Crush", 2));
    await tick();
    name.value = "Glow";
    name.dispatchEvent(new Event("input"));
    click(p.el, "fx-art-save");
    await tick();
    expect("fit" in (sent[1] as object)).toBe(false);
  });

  test("Neon 5: a run replaced from frame 1 starts afresh; a trail needs the run's frames first", async () => {
    const sent: FxChange[] = [];
    const p = picker(sent);
    p.show({ kind: "run", run: "Sparkle" }, view());
    await tick();
    const right = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-right"]',
    ) as HTMLInputElement;
    right.value = "9";
    right.dispatchEvent(new Event("change"));
    choose(p.el, "fx-art-files", files("Sparkle", 2));
    await tick();
    expect(right.value).toBe("0");
    click(p.el, "fx-art-save");
    await tick();
    // The 16×16 frame's dot at (5, 5) sits on the tile's middle, not the old upload's anchor.
    expect((sent[0] as Extract<FxChange, { op: "set" }>).frames[0]).toMatchObject({
      regX: 5,
      regY: 5 - 18,
    });
    p.show({ kind: "run", run: "Fishing" }, view());
    choose(p.el, "fx-art-files", files("xFishing", 1));
    await tick();
    expect(p.el.textContent).toContain("Upload the run's own frames first");
    expect(p.pending()).toBe(false);
  });

  test("Neon 6: the panel remembers the run it showed after it is cleared", () => {
    const p = picker([]);
    p.show({ kind: "spell", spell: "Bolt", run: "BoltR" }, view());
    p.clear();
    expect(p.current()).toBeNull();
    expect(p.remembered()).toEqual({ kind: "spell", spell: "Bolt", run: "BoltR" });
  });

  test("Neon 7: a pack run's frames can be stepped through; an unreadable frame keeps its place", async () => {
    const sent: FxChange[] = [];
    const files3 = ["a", "b", "c"].map((c) => c.repeat(64));
    const p = picker(sent, {
      // The saved upload's second frame cannot be read.
      decode: async (src) =>
        typeof src === "string" && src.includes(files3[1] as string) ? null : frame(),
    });
    p.show({ kind: "spell", spell: "Meteor" }, nview());
    await tick();
    const frameSel = p.el.querySelector<HTMLInputElement>(
      '[data-action="fx-art-frame"]',
    ) as HTMLInputElement;
    expect(frameSel.max).toBe("22");
    const art = [{ name: "Sparkle", frames: files3.map((file) => ({ file, regX: 4, regY: 4 })) }];
    p.show({ kind: "run", run: "Sparkle" }, view({ art }));
    await tick();
    expect(p.el.textContent).toContain("Frame 2 could not be read for the preview");
    // Frame 3 replaced: frame 2 stays where it was.
    choose(p.el, "fx-art-files", [new File([new Uint8Array(5)], "Sparkle-3.png")]);
    await tick();
    click(p.el, "fx-art-save");
    await tick();
    expect((sent[0] as Extract<FxChange, { op: "set" }>).frames.map((f) => f.file)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
      "5".repeat(64),
    ]);
  });

  test("Neon 8: cutting again waits for a cut in progress; frame files hide the strip's layout", async () => {
    let release: () => void = () => {};
    const p = picker([], {
      slice: () =>
        new Promise((r) => {
          release = () =>
            r({ ok: true, cell: { w: 16, h: 16 }, frames: ["b".repeat(64)], trail: [] } as never);
        }),
    });
    p.show({ kind: "spell", spell: "Meteor" }, nview());
    choose(p.el, "fx-art-files", [new File([new Uint8Array(1)], "Meteor.png")]);
    await tick();
    const recut = p.el.querySelector<HTMLButtonElement>(
      '[data-action="fx-art-recut"]',
    ) as HTMLButtonElement;
    expect(recut.disabled).toBe(true);
    release();
    await tick();
    expect(recut.disabled).toBe(false);
    const row = recut.parentElement as HTMLElement;
    expect(row.hidden).toBe(false);
    choose(p.el, "fx-art-files", files("Meteor", 22));
    await tick();
    expect(row.hidden).toBe(true);
  });
});
