/**
 * The Director channel model, the switch, the title-screen clicks and the amount
 * dialog's give-or-drop click.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { type MapView, NO_EQUIPMENT, NO_FOG, type PlayerView } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { type AudioCtx, createAudio } from "../src/audio.ts";
import { applySnapshot, createModel, predictAmountPath } from "../src/model.ts";
import { type Sfx, SOUND } from "../src/sfx.ts";
import { creationScreen, loginScreen, titleScreen } from "../src/ui/screens.ts";

const assets = (sounds: Record<string, string>): Assets => ({
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
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

describe("the amount dialog's click follows the dialog script's branch", () => {
  const rows = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
  const map: MapView = {
    name: "x1000y992",
    title: "",
    layers: [rows("G1"), rows("G3"), rows("G3"), rows("5A")],
    signs: ["", "", ""],
    fog: { ...NO_FOG },
  };
  const player = (id: string, x: number, y: number): PlayerView => ({
    id,
    name: id,
    head: 1,
    x,
    y,
    facing: "S",
    step: null,
    equip: { ...NO_EQUIPMENT },
    body: null,
  });
  const scene = (o: { peerAt?: [number, number]; monsterAt?: [number, number] }) => {
    const m = createModel();
    applySnapshot(m, {
      map,
      you: { ...player("me", 5, 5), facing: "E" },
      self: { n: 0, x: 5, y: 5, facing: "E", frames: 0 },
      players: o.peerAt ? [player("B", ...o.peerAt)] : [],
      monsters: o.monsterAt
        ? [
            {
              slot: 1,
              name: "Slime",
              body: 30,
              x: o.monsterAt[0],
              y: o.monsterAt[1],
              facing: "S",
              step: null,
            },
          ]
        : [],
    });
    return m;
  };

  test("drop clicks; short, give and the monster exit are silent", () => {
    expect(predictAmountPath(scene({}), true, true)).toBe("drop");
    expect(predictAmountPath(scene({}), true, false)).toBe("short");
    expect(predictAmountPath(scene({ peerAt: [6, 5] }), true, true)).toBe("give"); // :151-299
    expect(predictAmountPath(scene({ monsterAt: [7, 5] }), true, true)).toBe("monster"); // :300-397
  });

  test("the monster exit is gold's only: crystals facing a monster drop", () => {
    expect(predictAmountPath(scene({ monsterAt: [6, 5] }), false, true)).toBe("drop");
  });

  test("facing a player while mid-step takes the drop path: it clicks, then the drop stops", () => {
    const m = scene({ peerAt: [6, 5] });
    if (m.self) {
      m.self.stepFrames = 8;
    }
    expect(predictAmountPath(m, true, true)).toBe("drop");
  });
});
