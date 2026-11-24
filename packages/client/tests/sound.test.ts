/**
 * The Director channel model, the switch, the title-screen clicks and the amount
 * dialog's give-or-drop click.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import { type AudioCtx, createAudio } from "../src/audio.ts";
import { type Sfx, SOUND } from "../src/sfx.ts";
import { createAmountDialog, crystalTitle, GOLD_TITLE } from "../src/ui/amount.ts";
import { creationScreen, loginScreen, titleScreen } from "../src/ui/screens.ts";

const assets = (sounds: Record<string, string>): Assets => ({
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
  hash: null,
  reload: async () => [],
  onReload: () => {},
});

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  gain: FakeGain | null = null;
  started = false;
  stopped = false;
  connect(g: FakeGain) {
    this.gain = g;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
interface FakeGain {
  gain: { value: number };
  connect(): void;
}

function fakeAudio(on = true) {
  const sources: FakeSource[] = [];
  const ctx = {
    state: "suspended" as AudioContextState,
    destination: {},
    resume() {
      ctx.state = "running";
      return Promise.resolve();
    },
    createBufferSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    createGain: (): FakeGain => ({ gain: { value: 1 }, connect() {} }),
    decodeAudioData: (b: ArrayBuffer) => Promise.resolve({ bytes: b.byteLength }),
  };
  const loaded: string[] = [];
  const audio = createAudio(
    assets({ clicksound2: "sounds/clicksound2.wav", hitsound: "sounds/hitsound.wav" }),
    on,
    () => ctx as unknown as AudioCtx,
    async (url) => {
      loaded.push(url);
      return new ArrayBuffer(4);
    },
  );
  return { audio, ctx, sources, loaded };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Director's sound channels", () => {
  test("every sound loads at page load; nothing plays before the first gesture, whose own click is heard", async () => {
    const { audio, ctx, sources, loaded } = fakeAudio();
    await settle();
    expect(loaded.sort()).toEqual([
      "/assets/sounds/clicksound2.wav",
      "/assets/sounds/hitsound.wav",
    ]);
    audio.play(SOUND.click);
    expect(sources).toEqual([]);
    audio.unlock();
    expect(ctx.state).toBe("running");
    audio.play(SOUND.click);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.started).toBe(true);
  });

  test("a new sound on a busy channel cuts off the old one; other channels overlap (puppetSound)", async () => {
    const { audio, sources } = fakeAudio();
    audio.unlock();
    await settle();
    audio.play(SOUND.click); // channel 3
    audio.play(SOUND.monsterHit); // channel 2
    expect(sources.map((s) => s.stopped)).toEqual([false, false]);
    audio.play(SOUND.click);
    expect(sources.map((s) => s.stopped)).toEqual([true, false, false]);
  });

  test("each channel has its own volume, 0-255", async () => {
    const { audio, sources } = fakeAudio();
    audio.unlock();
    await settle();
    audio.setVolume(5, 200);
    audio.play(SOUND.floatieHit);
    audio.play(SOUND.monsterHit);
    expect(sources[0]?.gain?.gain.value).toBeCloseTo(200 / 255);
    expect(sources[1]?.gain?.gain.value).toBe(1);
  });

  test("bug fixed: a sound's own volume plays that sound alone at it; the channel keeps its volume", async () => {
    const { audio, sources } = fakeAudio();
    audio.unlock();
    await settle();
    audio.play({ ...SOUND.floatieHit, volume: 200 });
    audio.play(SOUND.floatieHit);
    expect(sources[0]?.gain?.gain.value).toBeCloseTo(200 / 255);
    expect(sources[1]?.gain?.gain.value).toBe(1);
  });

  test("a sound not yet decoded, or not built, is skipped, never played late", () => {
    const { audio, sources } = fakeAudio();
    audio.unlock();
    audio.play(SOUND.click); // decoding has not finished
    audio.play({ name: "Ghost1", ch: 1 }); // unused in 1.6, not built
    expect(sources).toEqual([]);
  });

  test("divergence: off silences everything, 1.6's ungated sounds too", async () => {
    const { audio, sources } = fakeAudio();
    audio.unlock();
    await settle();
    audio.play(SOUND.click);
    audio.enabled = false; // stops what is playing
    expect(sources[0]?.stopped).toBe(true);
    audio.play(SOUND.floatieHit); // 1.6 does not test the SFX switch here
    audio.play({ name: "swordswing", ch: 3 }); // 1.6 tests the SFX switch here
    expect(sources).toHaveLength(1);
    audio.enabled = true;
    audio.play(SOUND.click);
    expect(sources).toHaveLength(2);
  });
});

describe("title, login and creation clicks", () => {
  const press = (items: { el: HTMLElement }[], label: string) =>
    items
      .map((i) => i.el)
      .find((e) => e.getAttribute("aria-label") === label)
      ?.click();

  test("Load Character on channel 3, New Character on channel 1", () => {
    const sounds: Sfx[] = [];
    const s = titleScreen(assets({}), {
      load() {},
      create() {},
      sound: (x) => sounds.push(x),
    });
    press(s.items, "Load Character");
    press(s.items, "New Character");
    expect(sounds).toEqual([
      { name: "Clicksound2", ch: 3 },
      { name: "Clicksound2", ch: 1 },
    ]);
  });

  test("login OK and Cancel click first", () => {
    const sounds: Sfx[] = [];
    const calls: string[] = [];
    const s = loginScreen(assets({}), {
      ok: () => calls.push("ok"),
      cancel: () => calls.push("cancel"),
      sound: (x) => sounds.push(x),
    });
    press(s.items, "OK");
    press(s.items, "Cancel");
    expect(calls).toEqual(["ok", "cancel"]);
    expect(sounds).toEqual(Array(2).fill(SOUND.click));
  });

  test("creation: Cancel clicks, OK is silent", () => {
    const sounds: Sfx[] = [];
    const s = creationScreen(assets({}), {
      ok() {},
      cancel() {},
      sound: (x) => sounds.push(x),
    });
    press(s.items, "OK");
    expect(sounds).toEqual([]);
    press(s.items, "Cancel");
    expect(sounds).toEqual([SOUND.click]);
  });
});

describe("the amount dialog's OK", () => {
  test("bug fixed: OK clicks on every press, give, drop or refusal alike", () => {
    const sounds: Sfx[] = [];
    const got: number[] = [];
    const d = createAmountDialog(assets({}), () => sounds.push(SOUND.click));
    const ok = d.el.querySelector('[aria-label="OK"]') as HTMLButtonElement;
    const input = d.el.querySelector("input") as HTMLInputElement;
    d.open(GOLD_TITLE, "0", (n) => got.push(n));
    input.value = "50";
    ok.click();
    d.open(crystalTitle("blue", "give"), null, (n) => got.push(n));
    input.value = "-1"; // refused by the client, and still a click
    ok.click();
    expect(got).toEqual([50]);
    expect(sounds).toEqual([SOUND.click, SOUND.click]);
  });
});

describe("sounds an operator publishes (issue #29)", () => {
  test("a reload waits for a replaced sound, and a sound removed while it decodes never plays", async () => {
    const sources: FakeSource[] = [];
    const ctx = {
      state: "running" as AudioContextState,
      destination: {},
      resume: () => Promise.resolve(),
      createBufferSource: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      createGain: (): FakeGain => ({ gain: { value: 1 }, connect() {} }),
      decodeAudioData: (b: ArrayBuffer) => Promise.resolve({ bytes: b.byteLength }),
    };
    let release: () => void = () => {};
    const a = assets({ hitsound: "sounds/hitsound.wav" });
    let listener: (() => void | Promise<void>) | null = null;
    a.onReload = (fn) => {
      listener = fn as () => void | Promise<void>;
    };
    const audio = createAudio(
      a,
      true,
      () => ctx as unknown as AudioCtx,
      (url) =>
        url.includes("hitsound.wav")
          ? new Promise<ArrayBuffer>((r) => {
              release = () => r(new ArrayBuffer(4));
            })
          : Promise.resolve(new ArrayBuffer(8)),
    );
    audio.unlock();
    // The publish removes the sound while its first decode is still on its way.
    a.index.sounds = {};
    await (listener as unknown as () => Promise<void>)();
    release();
    await settle();
    audio.play(SOUND.monsterHit);
    expect(sources).toEqual([]);
    // A publish that brings it back: the reload is done only once it has decoded.
    a.index.sounds = { hitsound: "operator/sounds/new.wav" };
    await (listener as unknown as () => Promise<void>)();
    audio.play(SOUND.monsterHit);
    expect(sources).toHaveLength(1);
  });
});

describe("a replaced sound (issue #29, stage 7)", () => {
  test("never plays its old file once a publish replaces it, even when the new file fails", async () => {
    const sources: FakeSource[] = [];
    const ctx = {
      state: "running" as AudioContextState,
      destination: {},
      resume: () => Promise.resolve(),
      createBufferSource: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      createGain: (): FakeGain => ({ gain: { value: 1 }, connect() {} }),
      decodeAudioData: (b: ArrayBuffer) =>
        b.byteLength === 0
          ? Promise.reject(new Error("bad"))
          : Promise.resolve({ bytes: b.byteLength }),
    };
    const a = assets({ hitsound: "sounds/hitsound.wav" });
    let listener: (() => void | Promise<void>) | null = null;
    a.onReload = (fn) => {
      listener = fn as () => void | Promise<void>;
    };
    const audio = createAudio(
      a,
      true,
      () => ctx as unknown as AudioCtx,
      (url) => Promise.resolve(new ArrayBuffer(url.includes("broken") ? 0 : 8)),
    );
    audio.unlock();
    await settle();
    audio.play(SOUND.monsterHit);
    expect(sources).toHaveLength(1);
    // The publish replaces it with a file this browser cannot decode: silence, not the old file.
    a.index.sounds = { hitsound: "operator/sounds/broken.wav" };
    await (listener as unknown as () => Promise<void>)();
    audio.play(SOUND.monsterHit);
    expect(sources).toHaveLength(1);
  });
});

describe("sounds named like Object.prototype's (issue #29, stage 7 review)", () => {
  test("a removed sound called constructor unloads and never plays again", async () => {
    const sources: FakeSource[] = [];
    const ctx = {
      state: "running" as AudioContextState,
      destination: {},
      resume: () => Promise.resolve(),
      createBufferSource: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      createGain: (): FakeGain => ({ gain: { value: 1 }, connect() {} }),
      decodeAudioData: (b: ArrayBuffer) => Promise.resolve({ bytes: b.byteLength }),
    };
    const a = assets({ constructor: "operator/sounds/c.wav" });
    let listener: (() => void | Promise<void>) | null = null;
    a.onReload = (fn) => {
      listener = fn as () => void | Promise<void>;
    };
    const audio = createAudio(
      a,
      true,
      () => ctx as unknown as AudioCtx,
      () => Promise.resolve(new ArrayBuffer(8)),
    );
    audio.unlock();
    await settle();
    audio.play({ name: "constructor", ch: 1 });
    expect(sources).toHaveLength(1);
    a.index.sounds = {};
    await (listener as unknown as () => Promise<void>)();
    audio.play({ name: "constructor", ch: 1 });
    expect(sources).toHaveLength(1);
  });
});
