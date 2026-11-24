/**
 * The Sounds section (issue #29, stage 7): where a sound comes from and who plays it, files checked
 * before they are uploaded, the panel's saves with the upload it saw, bulk files matched by name,
 * clashes, and Discard stopping a bulk attach before its next write. Also pins the engine's sound
 * list against the code that plays sounds by name.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  artRowFingerprint,
  type ContentSoundArtView,
  CRAFT_SOUND,
  ENGINE_SOUNDS,
  type SoundChange,
} from "@secondstaronline/shared";

import { SOUND, spellSounds } from "../src/sfx.ts";
import {
  bulkChanges,
  bulkLineError,
  bulkLineFor,
  checkSoundFile,
  createSounds,
  filterSounds,
  removeSilences,
  soundEntries,
  soundSource,
  soundUrl,
} from "../src/ui/sound-art.ts";

afterEach(() => document.body.replaceChildren());

const FILE = "a".repeat(64);
const view = (over: Partial<ContentSoundArtView> = {}): ContentSoundArtView => ({
  uses: {
    crush: { name: "crush", users: ["spell Crush"] },
    fx: { name: "fx", users: ["spell Meteor", "the engine (a monster killed)"] },
    boom: { name: "Boom", users: ["spell Zap"] },
  },
  art: [{ name: "Boom", file: FILE, format: "wav" }],
  packSounds: {
    crush: "/assets/packs/classic/sounds/crush.wav?v=1",
    fx: "/assets/packs/classic/sounds/fx.wav?v=1",
    bad: "/assets/packs/classic/sounds/bad.wav?v=1",
  },
  liveUploads: [],
  maxBytes: 5 * 1024 * 1024,
  ...over,
});

const tick = () => new Promise((r) => setTimeout(r, 10));
function choose(el: HTMLElement, action: string, files: File[]): void {
  const input = el.querySelector<HTMLInputElement>(`[data-action="${action}"]`);
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input?.dispatchEvent(new Event("change"));
}
const click = (el: HTMLElement, a: string) =>
  el.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)?.click();
const $ = <T extends HTMLElement>(el: HTMLElement, a: string) =>
  el.querySelector<T>(`[data-action="${a}"]`) as T;
const wav = (name: string, bytes = 16) => new File([new Uint8Array(bytes)], name);

describe("what the section reads", () => {
  test("a sound comes from its upload, the pack's, the pack's coming back, or nothing", () => {
    expect(soundSource(view(), "boom")).toEqual({
      kind: "upload",
      art: { name: "Boom", file: FILE, format: "wav" },
    });
    expect(soundSource(view(), "Crush")).toEqual({
      kind: "pack",
      url: "/assets/packs/classic/sounds/crush.wav?v=1",
    });
    expect(soundSource(view({ liveUploads: ["fx"] }), "fx").kind).toBe("comingBack");
    expect(soundSource(view(), "nothing")).toEqual({ kind: "none" });
    expect(soundUrl(view(), "boom")).toBe(`/assets/uploads/sounds/${FILE}.wav`);
    expect(soundUrl(view(), "nothing")).toBeNull();
  });

  test("the list has every sound played, uploaded or in a pack, once each, filtered by name or user", () => {
    expect(soundEntries(view()).map((e) => e.name)).toEqual(["bad", "Boom", "crush", "fx"]);
    expect(filterSounds(view(), "engine").map((e) => e.name)).toEqual(["fx"]);
    expect(filterSounds(view(), "BOO").map((e) => e.name)).toEqual(["Boom"]);
  });

  test("taking out an upload with no pack sound behind it would leave its players silent", () => {
    expect(removeSilences(view(), "boom")).toBe(true);
    expect(removeSilences(view({ art: [{ name: "fx", file: FILE, format: "wav" }] }), "fx")).toBe(
      false,
    );
  });

  test("a file is checked in the browser: its format, its size, and that it plays", async () => {
    const yes = async () => true;
    expect(await checkSoundFile(wav("a.wav"), 100, yes)).toEqual({ ok: true, format: "wav" });
    expect((await checkSoundFile(wav("a.flac"), 100, yes)).ok).toBe(false);
    expect(await checkSoundFile(wav("a.mp3", 200), 100, yes)).toMatchObject({ ok: false });
    expect(await checkSoundFile(wav("a.wav", 0), 100, yes)).toEqual({
      ok: false,
      error: "a.wav is empty.",
    });
    const ogg = await checkSoundFile(wav("a.ogg"), 100, async () => false);
    expect(ogg.ok ? "" : ogg.error).toContain("older Safari cannot play OGG");
    // A browser with no audio cannot tell: the server's check of the bytes decides.
    expect((await checkSoundFile(wav("a.wav"), 100, async () => null)).ok).toBe(true);
  });

  test("a bulk file named like a sound replaces it with the upload it saw; others are new", () => {
    const boom = bulkLineFor("BOOM.wav", { file: "b".repeat(64), format: "wav" }, view());
    expect(boom).toMatchObject({
      name: "Boom",
      replaces: true,
      expect: artRowFingerprint(view().art[0]),
    });
    const fresh = bulkLineFor("zing.mp3", { file: "c".repeat(64), format: "mp3" }, view());
    expect(fresh).toMatchObject({ name: "zing", replaces: false, expect: null });
    // Two lines for one sound clash, by where they write.
    const twin = bulkLineFor("boom.mp3", { file: "d".repeat(64), format: "mp3" }, view());
    expect(bulkLineError(boom, [boom, twin, fresh])).toBe(
      "Another line is also for Boom: untick one.",
    );
    expect(bulkChanges([boom, twin, fresh]).map((c) => c.change)).toEqual([
      { op: "set", name: "zing", file: "c".repeat(64), format: "mp3", expect: null },
    ]);
    fresh.name = "a/b";
    expect(bulkLineError(fresh, [fresh])).toContain("slashes");
  });
});

describe("the section", () => {
  function section(
    sent: SoundChange[],
    opts: {
      gate?: Promise<void>;
      upload?: Promise<void>;
      playable?: (f: File) => Promise<boolean | null>;
      apply?: (c: SoundChange) => Promise<{ ok: boolean; text: string; sound?: string }>;
    } = {},
  ) {
    const uploads: string[] = [];
    const played: string[] = [];
    let saved = 0;
    const s = createSounds({
      upload: async (f) => {
        uploads.push(f.name);
        await opts.upload;
        return { ok: true, stored: { file: "e".repeat(64), ext: f.name.split(".").pop() ?? "" } };
      },
      playable: opts.playable ?? (async () => true),
      play: (url) => played.push(url),
      apply:
        opts.apply ??
        (async (c) => {
          sent.push(c);
          await opts.gate;
          return { ok: true, text: "In the draft.", sound: c.name };
        }),
      saved: () => {
        saved += 1;
      },
    });
    document.body.append(s.el);
    return { s, uploads, played, saved: () => saved };
  }

  test("controls wait for the view", () => {
    const { s } = section([]);
    expect($<HTMLInputElement>(s.el, "sounds-files").disabled).toBe(true);
    s.setView(view());
    expect($<HTMLInputElement>(s.el, "sounds-files").disabled).toBe(false);
  });

  test("the panel plays the sound, and saves a new file with the upload it saw", async () => {
    const sent: SoundChange[] = [];
    const { s, played, saved } = section(sent);
    s.setView(view());
    s.open("BOOM");
    click(s.el, "sound-art-play");
    expect(played).toEqual([`/assets/uploads/sounds/${FILE}.wav`]);
    choose(s.el, "sound-art-file", [wav("new.mp3")]);
    expect(s.pending()).toBe(true);
    await tick();
    click(s.el, "sound-art-save");
    await tick();
    expect(sent).toEqual([
      {
        op: "set",
        name: "Boom",
        file: "e".repeat(64),
        format: "mp3",
        expect: artRowFingerprint(view().art[0]),
      },
    ]);
    expect(saved()).toBe(1);
    expect(s.pending()).toBe(false);
  });

  test("a file the browser cannot play is never uploaded", async () => {
    const { s, uploads } = section([], { playable: async () => false });
    s.setView(view());
    s.open("crush");
    choose(s.el, "sound-art-file", [wav("x.ogg")]);
    await tick();
    expect(uploads).toEqual([]);
    expect($<HTMLButtonElement>(s.el, "sound-art-save").disabled).toBe(true);
    expect(s.el.textContent).toContain("cannot play x.ogg");
  });

  test("a file still uploading is unsaved work, nothing is sent meanwhile, and a refresh keeps it", async () => {
    let release: () => void = () => {};
    const sent: SoundChange[] = [];
    const { s } = section(sent, { upload: new Promise<void>((r) => (release = r)) });
    s.setView(view());
    s.open("fx");
    choose(s.el, "sound-art-file", [wav("fx.wav")]);
    await tick();
    expect(s.pending()).toBe(true);
    expect($<HTMLButtonElement>(s.el, "sound-art-save").disabled).toBe(true);
    s.setView(view());
    release();
    await tick();
    expect($<HTMLButtonElement>(s.el, "sound-art-save").disabled).toBe(false);
  });

  test("an upload no pack backs cannot be taken out; one a pack backs can", () => {
    const { s } = section([]);
    s.setView(view({ art: [...view().art, { name: "fx", file: FILE, format: "wav" }] }));
    s.open("boom");
    expect($<HTMLButtonElement>(s.el, "sound-art-remove").disabled).toBe(true);
    s.open("fx");
    expect($<HTMLButtonElement>(s.el, "sound-art-remove").disabled).toBe(false);
    expect(s.el.textContent).toContain(
      "Replaces fx for spell Meteor, the engine (a monster killed).",
    );
  });

  test("a new sound opens under its name, and saves as a new row", async () => {
    const sent: SoundChange[] = [];
    const { s } = section(sent);
    s.setView(view());
    const name = $<HTMLInputElement>(s.el, "sounds-new-name");
    name.value = "zing";
    name.dispatchEvent(new Event("input"));
    click(s.el, "sounds-new-open");
    expect(s.el.textContent).toContain("New sound zing");
    choose(s.el, "sound-art-file", [wav("whatever.wav")]);
    await tick();
    click(s.el, "sound-art-save");
    await tick();
    expect(sent[0]).toMatchObject({ op: "set", name: "zing", expect: null });
  });

  test("bulk files attach by name; Discard stops a batch before its next write", async () => {
    let release: () => void = () => {};
    const sent: SoundChange[] = [];
    const { s } = section(sent, { gate: new Promise<void>((r) => (release = r)) });
    s.setView(view());
    choose(s.el, "sounds-files", [wav("one.wav"), wav("two.wav")]);
    await tick();
    expect(s.pending()).toBe(true);
    click(s.el, "sounds-attach");
    await tick();
    expect(sent).toHaveLength(1);
    s.discard();
    release();
    await tick();
    // The second line was never written.
    expect(sent).toHaveLength(1);
    expect(s.pending()).toBe(false);
  });

  test("bulk lines keep the upload they saw: a refresh does not make a stale line current", async () => {
    const sent: SoundChange[] = [];
    const { s } = section(sent);
    s.setView(view());
    choose(s.el, "sounds-files", [wav("boom.wav")]);
    await tick();
    // Another admin replaced Boom meanwhile.
    s.setView(view({ art: [{ name: "Boom", file: "f".repeat(64), format: "wav" }] }));
    click(s.el, "sounds-attach");
    await tick();
    expect(sent[0]).toMatchObject({ expect: artRowFingerprint(view().art[0]) });
  });

  test("a failed attach keeps its line, ticked, to try again", async () => {
    const { s } = section([], {
      apply: async () => ({ ok: false, text: "Boom's upload changed since you opened it." }),
    });
    s.setView(view());
    choose(s.el, "sounds-files", [wav("boom.wav")]);
    await tick();
    click(s.el, "sounds-attach");
    await tick();
    expect(s.el.textContent).toContain("Not saved: Boom's upload changed");
    expect(s.pending()).toBe(true);
  });
});

describe("the engine's sounds", () => {
  test("every sound the code plays by name is in ENGINE_SOUNDS (pinned against the code)", () => {
    const listed = new Set(ENGINE_SOUNDS.map((s) => s.name.toLowerCase()));
    // The game frame's clicks are engine art, not pack sounds.
    const frame = new Set(["clicksound", "clicksound2"]);
    const named = new Set<string>();
    for (const s of Object.values(SOUND)) {
      named.add(s.name.toLowerCase());
    }
    for (const run of ["Cannonball", "Fishing", "Slot Machine", "BSmith"]) {
      for (let roll = 1; roll <= 2; roll++) {
        for (const s of spellSounds(run, () => roll)) {
          named.add(s.name.toLowerCase());
        }
      }
    }
    for (const s of Object.values(CRAFT_SOUND)) {
      if (s) {
        named.add(s.toLowerCase());
      }
    }
    // The server's own `sound` messages with a literal name, in every source file.
    const root = join(import.meta.dir, "../../server/src");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : e.name.endsWith(".ts")
            ? [join(dir, e.name)]
            : [],
      );
    for (const f of walk(root)) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/t: "sound", name: "([^"]+)"/g)) {
        named.add((m[1] as string).toLowerCase());
      }
    }
    // A swing the item rules give no sound plays the engine's default.
    const melee = readFileSync(join(root, "systems/combat/melee.ts"), "utf8");
    expect(named.has("heal2") && named.has("churchy")).toBe(true);
    const swing = /return row \? row\.sound : "([^"]+)"/.exec(melee);
    expect(swing?.[1]).toBe("swordswing");
    named.add(swing?.[1] as string);
    expect([...named].filter((n) => !frame.has(n) && !listed.has(n)).sort()).toEqual([]);
    expect([...listed].filter((n) => !named.has(n)).sort()).toEqual([]);
  });
});

describe("review fixes (stage 7)", () => {
  test("a sound called constructor or toString is never Object.prototype's", () => {
    const v = view();
    expect(soundSource(v, "constructor")).toEqual({ kind: "none" });
    expect(soundUrl(v, "toString")).toBeNull();
    expect(removeSilences(v, "constructor")).toBe(false);
    expect(soundEntries(v).map((e) => e.name)).not.toContain("constructor");
  });

  test("a bulk line keeps the target and upload it saw when its file was chosen", async () => {
    let release: () => void = () => {};
    const sent: SoundChange[] = [];
    const s = createSounds({
      upload: async () => {
        await new Promise<void>((r) => (release = r));
        return { ok: true, stored: { file: "e".repeat(64), ext: "wav" } };
      },
      playable: async () => true,
      play: () => {},
      apply: async (c) => {
        sent.push(c);
        return { ok: true, text: "In." };
      },
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    choose(s.el, "sounds-files", [wav("boom.wav")]);
    await tick();
    // Another admin replaced Boom while the file uploaded: the line still holds what it saw.
    s.setView(view({ art: [{ name: "Boom", file: "f".repeat(64), format: "wav" }] }));
    release();
    await tick();
    click(s.el, "sounds-attach");
    await tick();
    expect(sent[0]).toMatchObject({ name: "Boom", expect: artRowFingerprint(view().art[0]) });
  });

  test("Discard while a file decodes uploads nothing, in the panel and in bulk", async () => {
    let decoded: (v: boolean) => void = () => {};
    const uploads: string[] = [];
    const s = createSounds({
      upload: async (f, still) => {
        if (still && !still()) {
          return { ok: false, error: "" };
        }
        uploads.push(f.name);
        return { ok: true, stored: { file: "e".repeat(64), ext: "wav" } };
      },
      playable: () => new Promise<boolean>((r) => (decoded = r)),
      play: () => {},
      apply: async () => ({ ok: true, text: "In." }),
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    s.open("crush");
    choose(s.el, "sound-art-file", [wav("panel.wav")]);
    await tick();
    s.discard();
    decoded(true);
    await tick();
    choose(s.el, "sounds-files", [wav("bulk.wav")]);
    await tick();
    s.discard();
    decoded(true);
    await tick();
    expect(uploads).toEqual([]);
    expect(s.pending()).toBe(false);
  });

  test("leaving the page stops a preview", () => {
    const calls: string[] = [];
    const s = createSounds({
      upload: async () => ({ ok: false, error: "no" }),
      play: (u) => calls.push(`play ${u}`),
      stop: () => calls.push("stop"),
      apply: async () => ({ ok: true, text: "In." }),
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    s.open("crush");
    click(s.el, "sound-art-play");
    s.stop();
    expect(calls).toEqual(["play /assets/packs/classic/sounds/crush.wav?v=1", "stop"]);
  });
});

describe("review fixes, second review (stage 7)", () => {
  function sectionWith(apply: (c: SoundChange) => Promise<{ ok: boolean; text: string }>) {
    const s = createSounds({
      upload: async () => ({ ok: true, stored: { file: "e".repeat(64), ext: "wav" } }),
      playable: async () => true,
      play: () => {},
      apply,
      saved: () => {},
    });
    document.body.append(s.el);
    return s;
  }

  test("taking out an upload nothing plays turns the open panel into a new sound, ready to upload again", async () => {
    const sent: SoundChange[] = [];
    const s = sectionWith(async (c) => {
      sent.push(c);
      return { ok: true, text: "Out." };
    });
    const zing = { name: "zing", file: FILE, format: "wav" as const };
    s.setView(view({ art: [...view().art, zing] }));
    s.open("zing");
    expect(s.el.textContent).toContain("It is an upload");
    click(s.el, "sound-art-remove");
    await tick();
    // The refresh after the save lists it nowhere.
    s.setView(view());
    expect(s.el.querySelector(".sound-art h4")?.textContent).toBe("New sound zing");
    choose(s.el, "sound-art-file", [wav("zing.wav")]);
    await tick();
    click(s.el, "sound-art-save");
    await tick();
    expect(sent.at(-1)).toMatchObject({ op: "set", name: "zing", expect: null });
  });

  test("a bulk line's name is matched as it is typed, in place, and Attach follows", async () => {
    const s = sectionWith(async () => ({ ok: true, text: "In." }));
    s.setView(view());
    choose(s.el, "sounds-files", [wav("one.wav"), wav("two.wav")]);
    await tick();
    const inputs = [...s.el.querySelectorAll<HTMLInputElement>('[data-action="sounds-line-name"]')];
    const second = inputs[1] as HTMLInputElement;
    second.focus();
    second.value = "one";
    second.dispatchEvent(new Event("input"));
    // The clash shows at once, Attach waits, and the field typed in is the same element.
    expect($<HTMLButtonElement>(s.el, "sounds-attach").disabled).toBe(true);
    expect(s.el.textContent).toContain("Another line is also for one");
    expect(s.el.querySelectorAll('[data-action="sounds-line-name"]')[1]).toBe(second);
    second.value = "boom";
    second.dispatchEvent(new Event("input"));
    expect($<HTMLButtonElement>(s.el, "sounds-attach").disabled).toBe(false);
    expect(s.el.textContent).toContain("Replaces boom for spell Zap.");
  });

  test("a file that fails to upload outright is a refusal, never a stuck count", async () => {
    const s = createSounds({
      upload: async () => {
        throw new Error("network down");
      },
      playable: async () => true,
      play: () => {},
      apply: async () => ({ ok: true, text: "In." }),
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    choose(s.el, "sounds-files", [wav("a.wav"), wav("b.wav")]);
    await tick();
    expect(s.pending()).toBe(false);
    expect(s.el.textContent).toContain("a.wav: network down");
    expect(s.el.textContent).toContain("b.wav: network down");
    expect($<HTMLInputElement>(s.el, "sounds-files").disabled).toBe(false);
  });

  test("another pick waits while files are read", async () => {
    let release: () => void = () => {};
    const s = createSounds({
      upload: async () => {
        await new Promise<void>((r) => (release = r));
        return { ok: true, stored: { file: "e".repeat(64), ext: "wav" } };
      },
      playable: async () => true,
      play: () => {},
      apply: async () => ({ ok: true, text: "In." }),
      saved: () => {},
    });
    document.body.append(s.el);
    s.setView(view());
    choose(s.el, "sounds-files", [wav("a.wav")]);
    await tick();
    expect($<HTMLInputElement>(s.el, "sounds-files").disabled).toBe(true);
    release();
    await tick();
    expect($<HTMLInputElement>(s.el, "sounds-files").disabled).toBe(false);
  });

  test("Open it is off again once its name has gone into the panel", () => {
    const s = sectionWith(async () => ({ ok: true, text: "In." }));
    s.setView(view());
    const name = $<HTMLInputElement>(s.el, "sounds-new-name");
    name.value = "zap";
    name.dispatchEvent(new Event("input"));
    click(s.el, "sounds-new-open");
    expect(name.value).toBe("");
    expect($<HTMLButtonElement>(s.el, "sounds-new-open").disabled).toBe(true);
  });
});
