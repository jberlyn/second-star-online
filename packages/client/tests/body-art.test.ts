/**
 * Monster bodies on the Content page (issue #29, stage 4): how files are sorted and matched to
 * monsters and bodies, where a frame's anchor goes, what the panel says and writes to the draft,
 * and the bulk upload.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { ArtFrameId } from "@secondstaronline/data";
import {
  BODY_FRAMES,
  type BodyChange,
  type ContentBodyArtView,
  type Pixels,
} from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import {
  anchorFor,
  anchorsInRange,
  availableBodies,
  bodyFiles,
  bodyList,
  bodySource,
  bulkBodyChange,
  bulkBodyErrors,
  bulkDestination,
  carriedAnchor,
  clampOffset,
  createBodies,
  createBodyArtPicker,
  extentOf,
  matchBody,
  monsterBodyText,
  ownBody,
  repaintText,
  savedFrames,
  scaleHeight,
  shownBodyFrames,
} from "../src/ui/body-art.ts";

afterEach(() => document.body.replaceChildren());

const FILE = "a".repeat(64);
const allFrames = (regX = 25, regY = 6) =>
  Object.fromEntries(BODY_FRAMES.map((f) => [f, { file: FILE, regX, regY }]));
const view = (over: Partial<ContentBodyArtView> = {}): ContentBodyArtView => ({
  bodies: [
    { body: 30, users: ["monster Orc", "monster Goblin"], monsters: ["Orc", "Goblin"] },
    { body: 1000, users: ["monster Wisp"], monsters: ["Wisp"] },
    { body: 55, users: ["the Boat"], monsters: [] },
  ],
  monsters: [
    { name: "Orc", body: 30 },
    { name: "Goblin", display: "Green Goblin", body: 30 },
    { name: "Wisp", body: 1000 },
  ],
  art: [{ name: "1000", frames: allFrames(), mirrored: true }],
  packBodies: [30, 55],
  next: 1001,
  maxSide: 512,
  head: 1,
  ...over,
});

const noArt = {
  index: {
    atlases: { bodies: { sheets: [], sprites: {} }, paperdoll: { sheets: [], sprites: {} } },
    ui: {},
  },
  sheets: {},
  sprite: () => undefined,
  ui: () => "",
  loadGroup: async () => {},
} as unknown as Assets;

const frame = (w = 46, h = 45): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  data.set([200, 30, 30, 255], (10 * w + 10) * 4);
  return { width: w, height: h, data };
};
/** A sheet with a dot in every one of its 16 cells. */
const sheet = (w: number, h: number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      data.set([200, 30, 30, 255], ((r * (h / 4) + 10) * w + c * (w / 4) + 10) * 4);
    }
  }
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

const frameFiles = (stem: string) =>
  BODY_FRAMES.map((f, i) => new File([new Uint8Array(i + 1)], `${stem}-${f}.png`));

describe("what the panel reads", () => {
  test("bodies, where their frames come from, and who can be given which", () => {
    expect(bodyList(view()).map((b) => b.body)).toEqual([30, 55, 1000]);
    expect(bodySource(view(), 1000).kind).toBe("upload");
    expect(bodySource(view(), 30).kind).toBe("pack");
    expect(bodySource(view(), 77).kind).toBe("none");
    expect(availableBodies(view())).toEqual([30, 55, 1000]);
    expect(ownBody(view(), "Wisp")).toBe(1000);
    // A pack body, or a shared one, is not a monster's own.
    expect(ownBody(view(), "Orc")).toBeNull();
    expect(monsterBodyText(view(), "Orc")).toBe(
      "It draws body 30, shared with monster Goblin: repainting it repaints them all.",
    );
    expect(monsterBodyText(view(), "Wisp")).toBe("It draws body 1000, which nothing else draws.");
  });

  test("names match a body number, then a monster's key, then the name players see", () => {
    expect(matchBody("55", view())).toEqual({ kind: "body", body: 55 });
    expect(matchBody("77", view())).toMatchObject({ kind: "none" });
    expect(matchBody("orc", view())).toEqual({
      kind: "monster",
      monster: "Orc",
      by: "key",
      replaces: null,
    });
    expect(matchBody("Green Goblin", view())).toMatchObject({ monster: "Goblin", by: "display" });
    expect(matchBody("wisp", view())).toMatchObject({ replaces: 1000 });
    expect(matchBody("Dragon", view())).toEqual({
      kind: "none",
      why: "No monster or body is called Dragon.",
    });
  });

  test("files are one sheet or frames named -f1-e", () => {
    expect(bodyFiles(["Orc.png"])).toEqual({ kind: "sheet", file: "Orc.png" });
    expect(bodyFiles(["Orc-f1-e.png", "Orc-F2-N.png"])).toMatchObject({ kind: "frames" });
    expect(bodyFiles(["Orc-f1-e.png", "Orc.png"])).toMatchObject({ kind: "bad" });
  });

  test("an anchor moves with the offset; saved frames carry it", () => {
    expect(anchorFor(46, 45, { x: 0, y: 0 })).toEqual({ regX: 25, regY: 6 });
    expect(anchorFor(46, 45, { x: 3, y: -2 })).toEqual({ regX: 22, regY: 8 });
    expect(
      savedFrames(new Map([["f1-n" as ArtFrameId, { file: FILE, regX: 25, regY: 6 }]]), {
        x: 3,
        y: -2,
      }),
    ).toEqual({ "f1-n": { file: FILE, regX: 22, regY: 8 } });
  });

  test("north frames flip about the standing frame's line; others are drawn as they are", () => {
    const raw = frame();
    const shown = shownBodyFrames(
      new Map([
        ["f2-n" as ArtFrameId, { raw, regX: 25, regY: 6 }],
        ["f2-s" as ArtFrameId, { raw, regX: 25, regY: 6 }],
      ]),
      true,
      "alpha",
    );
    const n = shown.get("f2-n");
    // The only pixel (x = 10) is the whole figure, so the flip leaves it where it stood: it lands
    // on x = 35, and the anchor moves to 50 (35 - 50 = 10 - 25).
    expect(n?.regX).toBe(50);
    expect(shown.get("f2-s")?.regX).toBe(25);
  });

  test("the preview's extent covers the tile and every frame", () => {
    expect(extentOf([])).toEqual({ left: -16, top: 2, right: 16, bottom: 34 });
    expect(extentOf([{ w: 100, h: 80, regX: 52, regY: 41 }])).toEqual({
      left: -52,
      top: -41,
      right: 48,
      bottom: 39,
    });
  });

  test("a bulk line's change: a body is repainted; a monster gets a new body or replaces its own", () => {
    const set = { frames: allFrames(), mirrored: true, transparency: "alpha" as const };
    expect(bulkBodyChange({ kind: "body", body: 55 }, true, set)).toMatchObject({
      op: "set",
      body: 55,
    });
    const wisp = { kind: "monster" as const, monster: "Wisp", by: "key" as const, replaces: 1000 };
    expect(bulkBodyChange(wisp, true, set)).toMatchObject({ op: "set", body: 1000 });
    expect(bulkBodyChange(wisp, false, set)).toMatchObject({ op: "new", monster: "Wisp" });
  });

  test("a bulk line's frames are checked before Attach", () => {
    const raws = new Map<string, Pixels | null>([["Orc.png", frame(185, 180)]]);
    expect(bulkBodyErrors(["Orc.png"], raws, "alpha")).toContain("divide by 4");
    const some = new Map<string, Pixels | null>([["Orc-f1-e.png", frame()]]);
    expect(bulkBodyErrors(["Orc-f1-e.png"], some, "alpha")).toContain(
      "A body needs all 16 frames; missing f1-n",
    );
    const blank = new Map<string, Pixels | null>([
      ["Orc.png", { width: 184, height: 180, data: new Uint8ClampedArray(184 * 180 * 4) }],
    ]);
    expect(bulkBodyErrors(["Orc.png"], blank, "alpha")).toContain("f1-n shows nothing");
  });
});

describe("the panel", () => {
  function picker(sent: BodyChange[], slice?: () => Promise<never>) {
    const p = createBodyArtPicker({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice:
        slice ??
        (async () => ({
          ok: true,
          cell: { w: 46, h: 45 },
          frames: Object.fromEntries(BODY_FRAMES.map((f) => [f, "b".repeat(64)])),
        })),
      decode: async (src) =>
        typeof src !== "string" && (src as File).name.endsWith("Orc.png")
          ? sheet(184, 180)
          : frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "Body 1001 is in the draft.", body: 1001 };
      },
      saved: () => {},
    });
    document.body.append(p.el);
    return p;
  }
  const click = (el: HTMLElement, a: string) =>
    el.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)?.click();

  test("a shared body's monster gets a new body of its own, or the shared body is repainted", async () => {
    const sent: BodyChange[] = [];
    const p = picker(sent);
    p.show({ kind: "monster", monster: "Orc" }, view());
    expect(p.el.textContent).toContain("shared with monster Goblin");
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    const save = p.el.querySelector<HTMLButtonElement>('[data-action="body-art-save"]');
    expect(save?.textContent).toBe("Save as a new body for Orc");
    expect(p.pending()).toBe(true);
    click(p.el, "body-art-save");
    await tick();
    expect(sent[0]).toMatchObject({ op: "new", monster: "Orc", mirrored: true });
    const s = sent[0] as Extract<BodyChange, { op: "new" }>;
    expect(s.frames["f2-s"]).toEqual({ file: "b".repeat(64), regX: 25, regY: 6 });

    // The same sheet, repainting body 30 for everyone.
    p.show({ kind: "monster", monster: "Orc" }, view());
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    click(p.el, "body-art-repaint");
    await tick();
    expect(sent[1]).toMatchObject({ op: "set", body: 30 });
  });

  test("a monster's own upload is replaced in place; frames go in with the offset", async () => {
    const sent: BodyChange[] = [];
    const p = picker(sent);
    p.show({ kind: "monster", monster: "Wisp" }, view());
    await tick();
    // The saved frames are loaded and nothing is pending.
    expect(p.pending()).toBe(false);
    const right = p.el.querySelector<HTMLInputElement>('[data-action="body-art-right"]');
    if (right) {
      right.value = "4";
      right.dispatchEvent(new Event("change"));
    }
    expect(p.pending()).toBe(true);
    const save = p.el.querySelector<HTMLButtonElement>('[data-action="body-art-save"]');
    expect(save?.textContent).toBe("Save to body 1000");
    click(p.el, "body-art-save");
    await tick();
    // Sent as Wisp's own body, so the server refuses it if another monster has taken it since.
    expect(sent[0]).toMatchObject({ op: "set", body: 1000, owner: "Wisp" });
    expect((sent[0] as Extract<BodyChange, { op: "set" }>).frames["f1-n"]).toEqual({
      file: FILE,
      regX: 21,
      regY: 6,
    });
  });

  test("frames come in one by one; saving waits for all 16", async () => {
    const sent: BodyChange[] = [];
    const p = picker(sent);
    p.show({ kind: "new" }, view());
    expect(p.el.textContent).toContain("next free number (1001 now)");
    choose(p.el, "body-art-files", frameFiles("Thing").slice(0, 3));
    await tick();
    const save = p.el.querySelector<HTMLButtonElement>('[data-action="body-art-save"]');
    expect(save?.disabled).toBe(true);
    expect(p.el.textContent).toContain("f4-n is missing");
    choose(p.el, "body-art-files", frameFiles("Thing").slice(3));
    await tick();
    expect(save?.disabled).toBe(false);
    click(p.el, "body-art-save");
    await tick();
    expect(sent[0]).toMatchObject({ op: "new" });
    expect("monster" in (sent[0] as object)).toBe(false);
    // From now on the panel shows the body it made.
    expect(p.current()).toEqual({ kind: "body", body: 1001 });
  });

  test("a monster can be given another body", async () => {
    const sent: BodyChange[] = [];
    const p = picker(sent);
    p.show({ kind: "monster", monster: "Orc" }, view());
    const sel = p.el.querySelector<HTMLSelectElement>('[data-action="body-art-choose"]');
    expect([...(sel?.options ?? [])].map((o) => o.value)).toEqual(["30", "55", "1000"]);
    if (sel) {
      sel.value = "1000";
    }
    click(p.el, "body-art-use");
    await tick();
    expect(sent).toEqual([{ op: "choose", monster: "Orc", body: 1000 }]);
  });

  test("a sheet that cannot be cut into four by four is refused before it is uploaded", async () => {
    let uploads = 0;
    const p = createBodyArtPicker({
      assets: noArt,
      upload: async () => {
        uploads += 1;
        return stored(1);
      },
      slice: async () => ({ ok: false, error: "no" }),
      decode: async () => frame(185, 180),
      apply: async () => ({ ok: true, text: "" }),
      saved: () => {},
    });
    document.body.append(p.el);
    p.show({ kind: "body", body: 55 }, view());
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "55.png")]);
    await tick();
    expect(uploads).toBe(0);
    expect(p.el.textContent).toContain("divide by 4");
  });
});

describe("the Bodies section", () => {
  test("lists every body and attaches sheets and frames to the monsters and bodies they name", async () => {
    const sent: BodyChange[] = [];
    const list = createBodies({
      assets: noArt,
      upload: async (f) => stored(f.size),
      slice: async () => ({
        ok: true,
        cell: { w: 64, h: 64 },
        frames: Object.fromEntries(BODY_FRAMES.map((f) => [f, "d".repeat(64)])),
      }),
      decode: async (src) =>
        typeof src !== "string" && /^(Orc|wisp)\.png$/.test((src as File).name)
          ? sheet(256, 256)
          : frame(),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "ok" };
      },
      saved: () => {},
    });
    document.body.append(list.el);
    list.setView(view());
    const rows = [...list.el.querySelectorAll<HTMLElement>('[data-action="bodies-open"]')];
    expect(rows.map((r) => r.dataset.key)).toEqual(["30", "55", "1000"]);
    choose(list.el, "bodies-files", [
      new File([new Uint8Array(1)], "Orc.png"),
      new File([new Uint8Array(1)], "wisp.png"),
      ...frameFiles("55"),
      new File([new Uint8Array(3)], "Dragon.png"),
    ]);
    await tick();
    expect(list.el.textContent).toContain("No monster or body is called Dragon.");
    list.el.querySelector<HTMLButtonElement>('[data-action="bodies-attach"]')?.click();
    await tick();
    await tick();
    expect(
      sent.map((c) => `${c.op}:${"monster" in c ? c.monster : ""}:${"body" in c ? c.body : ""}`),
    ).toEqual(["new:Orc:", "set::1000", "set::55"]);
    // A 64×64 sheet's frames stand at their size's anchor.
    expect((sent[0] as Extract<BodyChange, { op: "new" }>).frames["f2-s"]).toEqual({
      file: "d".repeat(64),
      regX: 34,
      regY: 25,
    });
  });
});

describe("review fixes (Sol)", () => {
  const deferred = <T>() => {
    let resolve: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  const options = (over: Partial<Parameters<typeof createBodyArtPicker>[0]> = {}) => ({
    assets: noArt,
    upload: async (f: File) => stored(f.size),
    slice: async () => ({
      ok: true as const,
      cell: { w: 46, h: 45 },
      frames: Object.fromEntries(BODY_FRAMES.map((f) => [f, "b".repeat(64)])),
    }),
    decode: async (src: string | Blob) =>
      typeof src !== "string" &&
      /\.png$/.test((src as File).name) &&
      !/-f\d-/.test((src as File).name)
        ? sheet(184, 180)
        : frame(),
    apply: async () => ({ ok: true, text: "ok" }),
    saved: () => {},
    ...over,
  });

  test("a save's answer changes nothing in a panel that has moved on to another body", async () => {
    const answer = deferred<{ ok: boolean; text: string }>();
    const p = createBodyArtPicker(options({ apply: () => answer.promise }));
    document.body.append(p.el);
    p.show({ kind: "monster", monster: "Orc" }, view());
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    p.el.querySelector<HTMLButtonElement>('[data-action="body-art-save"]')?.click();
    // Another body is opened, and frames set up in it, before the answer comes.
    p.show({ kind: "body", body: 55 }, view());
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "55.png")]);
    await tick();
    answer.resolve({ ok: true, text: "Body 1001 is in the draft." });
    await tick();
    expect(p.current()).toEqual({ kind: "body", body: 55 });
    expect(p.pending()).toBe(true);
    expect(p.el.textContent).not.toContain("Body 1001 is in the draft.");
  });

  test("replacing one frame of a reopened upload keeps that frame's saved shift", async () => {
    expect(carriedAnchor({ raw: frame(46, 45), regX: 20, regY: 8 }, 60, 50)).toEqual({
      regX: 27,
      regY: 13,
    });
    expect(carriedAnchor(undefined, 60, 50)).toEqual({ regX: 32, regY: 11 });
    const sent: BodyChange[] = [];
    const p = createBodyArtPicker(
      options({
        decode: async (src) =>
          typeof src !== "string" && (src as File).name === "Wisp-f2-s.png"
            ? frame(60, 50)
            : frame(),
        apply: async (c) => {
          sent.push(c);
          return { ok: true, text: "ok" };
        },
      }),
    );
    document.body.append(p.el);
    // Wisp's saved frames stand 5 px right and 2 px up of their default anchors.
    p.show(
      { kind: "monster", monster: "Wisp" },
      view({ art: [{ name: "1000", frames: allFrames(20, 8), mirrored: true }] }),
    );
    await tick();
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "Wisp-f2-s.png")]);
    await tick();
    p.el.querySelector<HTMLButtonElement>('[data-action="body-art-save"]')?.click();
    await tick();
    const frames = (sent[0] as Extract<BodyChange, { op: "set" }>).frames;
    expect(frames["f2-s"]).toMatchObject({ regX: 27, regY: 13 });
    expect(frames["f1-n"]).toMatchObject({ regX: 20, regY: 8 });
  });

  test("the chooser's preview draws only the body chosen last", async () => {
    const slow = deferred<Pixels | null>();
    const draws: string[] = [];
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return {
        clearRect: () => {},
        drawImage: () => draws.push(this.className),
        fillRect: () => {},
        strokeRect: () => {},
        putImageData: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof real;
    try {
      const p = createBodyArtPicker(
        options({
          decode: (src) => (typeof src === "string" ? slow.promise : Promise.resolve(frame())),
        }),
      );
      document.body.append(p.el);
      p.show({ kind: "monster", monster: "Orc" }, view());
      const sel = p.el.querySelector<HTMLSelectElement>('[data-action="body-art-choose"]');
      if (sel) {
        sel.value = "1000";
        sel.dispatchEvent(new Event("change"));
        sel.value = "55";
        sel.dispatchEvent(new Event("change"));
      }
      await tick();
      draws.length = 0;
      // Body 1000's picture arrives late: 55 is chosen now, so it draws nothing.
      slow.resolve(frame());
      await tick();
      expect(draws.filter((d) => d.includes("body-art-thumb"))).toEqual([]);
    } finally {
      HTMLCanvasElement.prototype.getContext = real;
    }
  });

  test("a repaint names everyone it changes, before either repaint", async () => {
    const many = view({
      bodies: [
        {
          body: 30,
          users: [
            "monster Orc",
            "monster Goblin",
            "monster Imp",
            "monster Ogre",
            "the Morph bodies",
          ],
          monsters: ["Orc", "Goblin", "Imp", "Ogre"],
        },
      ],
    });
    expect(repaintText(many, 30)).toBe(
      "Repaints body 30 for monster Orc, monster Goblin, monster Imp, monster Ogre and the Morph bodies.",
    );
    const p = createBodyArtPicker(options());
    document.body.append(p.el);
    p.show({ kind: "monster", monster: "Orc" }, many);
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    const note = p.el.querySelector<HTMLElement>(".body-art-repaints");
    expect(note?.hidden).toBe(false);
    expect(note?.textContent).toContain("monster Ogre and the Morph bodies");
  });

  test("the attack preview says it is a morphed player's, not a monster's", () => {
    const p = createBodyArtPicker(options());
    document.body.append(p.el);
    p.show({ kind: "body", body: 55 }, view());
    const mode = p.el.querySelector<HTMLSelectElement>('[data-action="body-art-mode"]');
    expect(mode?.options[1]?.textContent).toBe("Attacking (players morphed into it)");
    expect(p.el.textContent).toContain("Monsters only walk");
  });

  test("bulk lines clash by where they write: a monster's own body and its number", async () => {
    expect(
      bulkDestination({ kind: "monster", monster: "Wisp", by: "key", replaces: 1000 }, true),
    ).toBe("body:1000");
    expect(
      bulkDestination({ kind: "monster", monster: "Wisp", by: "key", replaces: 1000 }, false),
    ).toBe("monster:wisp");
    const list = createBodies(options());
    document.body.append(list.el);
    list.setView(view());
    choose(list.el, "bodies-files", [
      new File([new Uint8Array(1)], "wisp.png"),
      new File([new Uint8Array(1)], "1000.png"),
    ]);
    await tick();
    expect(list.el.textContent).toContain("Another line is for the same body or monster");
    expect(
      list.el.querySelector<HTMLButtonElement>('[data-action="bodies-attach"]')?.disabled,
    ).toBe(true);
    // Unticking Wisp's Replace makes it a new body: no clash.
    const box = list.el.querySelector<HTMLInputElement>('[data-action="bodies-replace"]');
    if (box) {
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    }
    expect(
      list.el.querySelector<HTMLButtonElement>('[data-action="bodies-attach"]')?.disabled,
    ).toBe(false);
  });

  test("bulk attach writes what was shown at Attach, and nothing once the list is cleared", async () => {
    const up = deferred<ReturnType<typeof stored>>();
    const sent: BodyChange[] = [];
    let uploads = 0;
    const make = () =>
      createBodies(
        options({
          upload: async () => {
            uploads += 1;
            return up.promise;
          },
          apply: async (c) => {
            sent.push(c);
            return { ok: true, text: "ok" };
          },
        }),
      );
    const list = make();
    document.body.append(list.el);
    list.setView(view());
    choose(list.el, "bodies-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    list.el.querySelector<HTMLButtonElement>('[data-action="bodies-attach"]')?.click();
    await tick();
    expect(uploads).toBe(1);
    // The draft changes mid-upload: Orc now has an upload of its own.
    list.setView(
      view({
        monsters: [{ name: "Orc", body: 1000 }],
        bodies: [{ body: 1000, users: ["monster Orc"], monsters: ["Orc"] }],
      }),
    );
    up.resolve(stored(1));
    await tick();
    await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ op: "new", monster: "Orc" });

    // A list cleared while its files upload writes nothing.
    const later = deferred<ReturnType<typeof stored>>();
    sent.length = 0;
    const list2 = createBodies(
      options({
        upload: () => later.promise,
        apply: async (c) => {
          sent.push(c);
          return { ok: true, text: "ok" };
        },
      }),
    );
    document.body.append(list2.el);
    list2.setView(view());
    choose(list2.el, "bodies-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    list2.el.querySelector<HTMLButtonElement>('[data-action="bodies-attach"]')?.click();
    await tick();
    list2.reset();
    later.resolve(stored(1));
    await tick();
    await tick();
    expect(sent).toEqual([]);
  });
});

describe("review fixes (Neon)", () => {
  const opts = (over: Partial<Parameters<typeof createBodyArtPicker>[0]> = {}) => ({
    assets: noArt,
    upload: async (f: File) => stored(f.size),
    slice: async () => ({
      ok: true as const,
      cell: { w: 46, h: 45 },
      frames: Object.fromEntries(BODY_FRAMES.map((f) => [f, "b".repeat(64)])),
    }),
    decode: async (src: string | Blob) =>
      typeof src !== "string" && !/-f\d-/.test((src as File).name) ? sheet(184, 180) : frame(),
    apply: async () => ({ ok: true, text: "ok" }),
    saved: () => {},
    ...over,
  });
  /** Canvas contexts that record which canvases are drawn on. */
  function recordDraws(): { draws: string[]; restore: () => void } {
    const draws: string[] = [];
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return {
        clearRect: () => {},
        drawImage: () => draws.push(this.className),
        fillRect: () => draws.push(this.className),
        strokeRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        putImageData: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof real;
    return {
      draws,
      restore: () => {
        HTMLCanvasElement.prototype.getContext = real;
      },
    };
  }

  test("an offset is clamped, and a save waits while any anchor is out of range", async () => {
    expect(clampOffset(2500)).toBe(1024);
    expect(clampOffset(-3000.4)).toBe(-1024);
    expect(anchorsInRange({ "f1-n": { file: FILE, regX: 2049, regY: 0 } })).toBe(false);
    const sent: BodyChange[] = [];
    const p = createBodyArtPicker(
      opts({
        apply: async (c) => {
          sent.push(c);
          return { ok: true, text: "ok" };
        },
      }),
    );
    document.body.append(p.el);
    p.show({ kind: "new" }, view());
    choose(p.el, "body-art-files", [new File([new Uint8Array(1)], "Thing.png")]);
    await tick();
    const right = p.el.querySelector<HTMLInputElement>('[data-action="body-art-right"]');
    if (right) {
      right.value = "2500";
      right.dispatchEvent(new Event("change"));
    }
    expect(right?.value).toBe("1024");
    p.el.querySelector<HTMLButtonElement>('[data-action="body-art-save"]')?.click();
    await tick();
    const set = sent[0] as Extract<BodyChange, { op: "new" }>;
    expect(anchorsInRange(set.frames)).toBe(true);
  });

  test("a draw still waiting for its atlases draws nothing once the panel is cleared", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const rec = recordDraws();
    try {
      const assets = { ...noArt, loadGroup: () => gate } as unknown as Assets;
      const p = createBodyArtPicker(opts({ assets }));
      document.body.append(p.el);
      p.show({ kind: "body", body: 55 }, view());
      await tick();
      p.clear();
      rec.draws.length = 0;
      release();
      await tick();
      expect(
        rec.draws.filter((d) => d.includes("body-art-grid") || d.includes("body-art-motion")),
      ).toEqual([]);
    } finally {
      rec.restore();
    }
  });

  test("the chooser draws nothing after a clear, nor a live upload the draft takes out", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const rec = recordDraws();
    try {
      // The live atlas draws body 30 from an upload (an operator sheet) the draft has taken out.
      const sprite = [0, 0, 0, 10, 10, 5, 5];
      const assets = {
        ...noArt,
        index: {
          atlases: {
            bodies: { sheets: ["operator/bodies-1.png"], sprites: {} },
            paperdoll: { sheets: [], sprites: {} },
          },
          ui: {},
        },
        sheets: { bodies: [document.createElement("canvas")] },
        sprite: (g: string, n: string) =>
          g === "bodies" && n.startsWith("30-") ? sprite : undefined,
        loadGroup: () => gate,
      } as unknown as Assets;
      const p = createBodyArtPicker(opts({ assets }));
      document.body.append(p.el);
      p.show({ kind: "monster", monster: "Orc" }, view());
      rec.draws.length = 0;
      release();
      await tick();
      expect(rec.draws.filter((d) => d.includes("body-art-thumb"))).toEqual([]);
    } finally {
      rec.restore();
    }
  });

  test("a bulk batch cut short by a reset gives the controls back", async () => {
    let finish: (v: ReturnType<typeof stored>) => void = () => {};
    const list = createBodies(
      opts({
        upload: () =>
          new Promise((r) => {
            finish = r;
          }),
      }),
    );
    document.body.append(list.el);
    list.setView(view());
    choose(list.el, "bodies-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    list.el.querySelector<HTMLButtonElement>('[data-action="bodies-attach"]')?.click();
    await tick();
    expect(list.el.querySelector<HTMLInputElement>('[data-action="bodies-files"]')?.disabled).toBe(
      true,
    );
    list.reset();
    finish(stored(1));
    await tick();
    await tick();
    expect(list.el.querySelector<HTMLInputElement>('[data-action="bodies-files"]')?.disabled).toBe(
      false,
    );
  });

  test("the scale preview is tall enough for the player's feet however high the body goes", () => {
    // A body dragged up: its frames end well above the player's feet.
    expect(scaleHeight({ top: -60, bottom: 10 })).toBe(60 + 39);
    expect(scaleHeight({ top: 2, bottom: 34 })).toBe(6 + 39);
    expect(scaleHeight({ top: -10, bottom: 80 })).toBe(10 + 80);
  });
});

describe("review fixes (Sol, stage 5)", () => {
  test("Sol 7: chosen files count as unsaved work; Discard stops a batch before it writes", async () => {
    const sent: BodyChange[] = [];
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const list = createBodies({
      assets: noArt,
      upload: async (f) => {
        await gate;
        return stored(f.size);
      },
      slice: async () => ({
        ok: true,
        cell: { w: 64, h: 64 },
        frames: Object.fromEntries(BODY_FRAMES.map((f) => [f, "d".repeat(64)])),
      }),
      decode: async () => sheet(256, 256),
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "ok" };
      },
      saved: () => {},
    });
    document.body.append(list.el);
    list.setView(view());
    choose(list.el, "bodies-files", [new File([new Uint8Array(1)], "Orc.png")]);
    await tick();
    expect(list.pending()).toBe(true);
    const attach = list.el.querySelector<HTMLButtonElement>('[data-action="bodies-attach"]');
    expect(attach?.disabled).toBe(false);
    attach?.click();
    await tick();
    list.discard();
    expect(list.pending()).toBe(false);
    open();
    await tick();
    await tick();
    expect(sent).toEqual([]);
  });
});
