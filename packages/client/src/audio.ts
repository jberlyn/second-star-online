/**
 * Sound effects on Director's model: eight channels, each playing one sound at a time; a new sound
 * on a busy channel cuts off the old one (`puppetSound`), and each channel has its own volume,
 * 0-255 (`sound(n).volume`).
 *
 * Built on Web Audio. The context is made, suspended, when the page loads, and the 37 sounds
 * are decoded into it at once. Browsers keep audio off until a click or key press, so `unlock`
 * runs on every pointerdown and keydown: the first lets sounds play (the press's own click is
 * heard), later ones resume a context the browser suspended in the background (SSO's own rule:
 * sound waits for your first click or key press). A sound asked for before the first gesture,
 * or before its file is decoded, is skipped, never played late.
 *
 * The switch (the menu checkbox, 1.6's `SFX` default ON) mutes every sound, including
 * those 1.6 left ungated (SSO's own rule: sound off silences everything).
 */
import type { Assets } from "./assets.ts";
import type { Sfx } from "./sfx.ts";

export const CHANNELS = 8;

export interface Audio {
  play(s: Sfx): void;
  /** `sound(ch).volume = v` (0-255): set whether or not sound is on. */
  setVolume(ch: number, v: number): void;
  /** Called on every user gesture. */
  unlock(): void;
  enabled: boolean;
}

/** The parts of `AudioContext` used here (tests pass a fake). */
export type AudioCtx = Pick<
  AudioContext,
  "state" | "resume" | "createBufferSource" | "createGain" | "decodeAudioData" | "destination"
>;

export function createAudio(
  assets: Assets,
  enabled = true,
  makeContext: () => AudioCtx | null = defaultContext,
  load: (url: string) => Promise<ArrayBuffer> = (url) => fetch(url).then((r) => r.arrayBuffer()),
): Audio {
  const ctx: AudioCtx | null = makeContext();
  let unlocked = false;
  const buffers = new Map<string, AudioBuffer>();
  const volume: number[] = Array(CHANNELS + 1).fill(255);
  const gains: (GainNode | undefined)[] = [];
  const playing: (AudioBufferSourceNode | undefined)[] = [];

  const stop = (ch: number) => {
    const src = playing[ch];
    playing[ch] = undefined;
    try {
      src?.stop();
    } catch {
      // Already ended.
    }
  };
  const gain = (c: AudioCtx, ch: number): GainNode => {
    let g = gains[ch];
    if (!g) {
      g = c.createGain();
      g.gain.value = (volume[ch] ?? 255) / 255;
      g.connect(c.destination);
      gains[ch] = g;
    }
    return g;
  };

  if (ctx) {
    for (const [name, file] of Object.entries(assets.index.sounds ?? {})) {
      void load(`/assets/${file}`)
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buf) => buffers.set(name, buf))
        .catch(() => {});
    }
  }

  const audio: Audio = {
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on;
      if (!on) {
        for (let ch = 1; ch <= CHANNELS; ch++) {
          stop(ch);
        }
      }
    },
    unlock() {
      if (!ctx) {
        return;
      }
      unlocked = true;
      if (ctx.state !== "running") {
        void ctx.resume().catch(() => {});
      }
    },
    setVolume(ch, v) {
      volume[ch] = v;
      const g = gains[ch];
      if (g) {
        g.gain.value = v / 255;
      }
    },
    play(s) {
      if (!enabled || !ctx || !unlocked || s.ch < 1 || s.ch > CHANNELS) {
        return;
      }
      const buf = buffers.get(s.name.toLowerCase());
      if (!buf) {
        return;
      }
      stop(s.ch);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (s.volume === undefined) {
        src.connect(gain(ctx, s.ch));
      } else {
        // A volume sent with the sound is that sound's alone; the channel keeps its own.
        const own = ctx.createGain();
        own.gain.value = s.volume / 255;
        own.connect(ctx.destination);
        src.connect(own);
      }
      src.onended = () => {
        if (playing[s.ch] === src) {
          playing[s.ch] = undefined;
        }
      };
      playing[s.ch] = src;
      src.start();
    },
  };
  return audio;
}

/**
 * Plays this frame's sounds in order. A volume a server sound message carries plays that sound
 * alone at it (a bug fixed: 1.6 set the channel's volume, so after the church bell every later
 * sound on channel 5 played at 200 for the rest of the session).
 */
export function playAll(audio: Pick<Audio, "play">, sounds: readonly Sfx[]): void {
  for (const s of sounds) {
    audio.play(s);
  }
}

function defaultContext(): AudioCtx | null {
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}
