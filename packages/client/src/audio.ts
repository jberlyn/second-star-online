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
 * Player Settings layers master and category (combat, spells, world) volumes, a background-tab
 * mute option, and synthesized gentle chimes for incoming IMs and friend logons on top of the
 * eight channels.
 */
import type { Assets } from "./assets.ts";
import { type Sfx, type SoundCategory, soundCategory } from "./sfx.ts";

export const CHANNELS = 8;

export type ChimeKind = "im" | "friendLogon";

export interface AudioSettings {
  enabled: boolean;
  masterVolume: number;
  combatVolume: number;
  spellsVolume: number;
  worldVolume: number;
  backgroundAudio: boolean;
}

export interface Audio {
  play(s: Sfx): void;
  /** Plays a gentle synthesized notification chime (respects sound on/off, master & world volume). */
  playChime(kind: ChimeKind): void;
  /** `sound(ch).volume = v` (0-255): set whether or not sound is on. */
  setVolume(ch: number, v: number): void;
  /** Updates master/category volumes and background-tab behaviour. */
  setSettings(opts: Partial<AudioSettings>): void;
  /** True when sound is enabled and not muted by background-tab settings. */
  canPlay(): boolean;
  /** Called on every user gesture. */
  unlock(): void;
  /** Stops all audio and detaches document listeners on app shutdown. */
  dispose(): void;
  enabled: boolean;
}

/** The parts of `AudioContext` used here (tests pass a fake). */
export type AudioCtx = Pick<
  AudioContext,
  "state" | "resume" | "createBufferSource" | "createGain" | "decodeAudioData" | "destination"
> & {
  currentTime?: number;
  createOscillator?: AudioContext["createOscillator"];
};

const pct = (v: number) => Math.max(0, Math.min(100, v)) / 100;

export function createAudio(
  assets: Assets,
  enabled = true,
  makeContext: () => AudioCtx | null = defaultContext,
  load: (url: string) => Promise<ArrayBuffer> = (url) =>
    fetch(url).then((r) => {
      if (!r.ok) {
        throw new Error(`${url}: ${r.status}`);
      }
      return r.arrayBuffer();
    }),
  isHidden: () => boolean = () => typeof document !== "undefined" && document.hidden === true,
  onMute?: () => void,
): Audio {
  const ctx: AudioCtx | null = makeContext();
  let unlocked = false;
  let masterVol = 1;
  let backgroundAudio = true;
  const catVol: Record<SoundCategory, number> = { combat: 1, spells: 1, world: 1 };
  const buffers = new Map<string, AudioBuffer>();
  const volume: number[] = Array(CHANNELS + 1).fill(255);
  const playing: (
    | { src: AudioBufferSourceNode; gain: GainNode; base: number; cat: SoundCategory; own: boolean }
    | undefined
  )[] = [];
  const activeChimes = new Set<OscillatorNode>();
  let chimeBus: GainNode | null = null;

  const stop = (ch: number) => {
    const cur = playing[ch];
    playing[ch] = undefined;
    try {
      cur?.src.stop();
    } catch {
      // Already ended.
    }
  };

  const stopChimes = () => {
    for (const osc of activeChimes) {
      try {
        osc.stop();
      } catch {
        // Already ended.
      }
    }
    activeChimes.clear();
  };

  const stopAll = () => {
    for (let ch = 1; ch <= CHANNELS; ch++) {
      stop(ch);
    }
    stopChimes();
  };

  const effectiveGain = (base: number, cat: SoundCategory) =>
    (base / 255) * catVol[cat] * masterVol;

  const refreshPlayingGains = () => {
    for (let ch = 1; ch <= CHANNELS; ch++) {
      const cur = playing[ch];
      if (cur) {
        cur.gain.gain.value = effectiveGain(cur.own ? cur.base : (volume[ch] ?? 255), cur.cat);
      }
    }
    if (chimeBus) {
      chimeBus.gain.value = catVol.world * masterVol;
    }
  };

  /** The file each sound was loaded from, so a reload fetches only the sounds that changed. */
  const loadedFrom = new Map<string, string>();
  const loadSounds = (sounds: Record<string, string>): Promise<void> => {
    if (!ctx) {
      return Promise.resolve();
    }
    // A removed sound goes, a decode still on its way included (it checks `loadedFrom`).
    for (const name of [...loadedFrom.keys()]) {
      if (!Object.hasOwn(sounds, name)) {
        buffers.delete(name);
        loadedFrom.delete(name);
      }
    }
    const loads: Promise<void>[] = [];
    for (const [name, file] of Object.entries(sounds)) {
      if (loadedFrom.get(name) === file) {
        continue;
      }
      // A replaced sound is silent until its new file has decoded, never its old file: an
      // operator who replaced it (issue #29) is not to hear the old one after the publish.
      buffers.delete(name);
      loadedFrom.set(name, file);
      loads.push(
        load(`/assets/${file}`)
          .then((bytes) => ctx.decodeAudioData(bytes))
          .then((buf) => {
            // A later reload may have moved the sound on meanwhile.
            if (loadedFrom.get(name) === file) {
              buffers.set(name, buf);
            }
          })
          .catch(() => {
            // Tried again at the next reload.
            if (loadedFrom.get(name) === file) {
              loadedFrom.delete(name);
            }
          }),
      );
    }
    return Promise.all(loads).then(() => {});
  };
  void loadSounds(assets.index.sounds ?? {});
  // An operator's publish (issue #29) can add, replace or remove sounds: the reload waits for them,
  // so the first sound after a publish is already the new one.
  assets.onReload?.(() => loadSounds(assets.index.sounds ?? {}));

  const mutedByBackground = () => !backgroundAudio && isHidden();

  const onVisibilityChange = () => {
    if (mutedByBackground()) {
      stopAll();
      onMute?.();
    }
  };
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  const audio: Audio = {
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on;
      if (!on) {
        stopAll();
        onMute?.();
      }
    },
    canPlay() {
      return enabled && !mutedByBackground();
    },
    setSettings(opts) {
      if (opts.enabled !== undefined) {
        audio.enabled = opts.enabled;
      }
      if (opts.masterVolume !== undefined) {
        masterVol = pct(opts.masterVolume);
      }
      if (opts.combatVolume !== undefined) {
        catVol.combat = pct(opts.combatVolume);
      }
      if (opts.spellsVolume !== undefined) {
        catVol.spells = pct(opts.spellsVolume);
      }
      if (opts.worldVolume !== undefined) {
        catVol.world = pct(opts.worldVolume);
      }
      if (opts.backgroundAudio !== undefined) {
        backgroundAudio = opts.backgroundAudio;
        if (mutedByBackground()) {
          stopAll();
          onMute?.();
        }
      }
      refreshPlayingGains();
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
    dispose() {
      stopAll();
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    },
    setVolume(ch, v) {
      volume[ch] = v;
      const cur = playing[ch];
      if (cur && !cur.own) {
        cur.gain.gain.value = effectiveGain(v, cur.cat);
      }
    },
    play(s) {
      if (!enabled || !ctx || !unlocked || mutedByBackground() || s.ch < 1 || s.ch > CHANNELS) {
        return;
      }
      const buf = buffers.get(s.name.toLowerCase());
      if (!buf) {
        return;
      }
      const cat = soundCategory(s);
      const base = s.volume === undefined ? (volume[s.ch] ?? 255) : s.volume;
      const level = effectiveGain(base, cat);
      stop(s.ch);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(ctx.destination);
      src.connect(g);
      src.onended = () => {
        if (playing[s.ch]?.src === src) {
          playing[s.ch] = undefined;
        }
      };
      playing[s.ch] = { src, gain: g, base, cat, own: s.volume !== undefined };
      src.start();
    },
    playChime(kind) {
      if (!enabled || !ctx || !unlocked || mutedByBackground() || !ctx.createOscillator) {
        return;
      }
      const busLevel = catVol.world * masterVol;
      if (busLevel <= 0) {
        return;
      }
      if (!chimeBus) {
        chimeBus = ctx.createGain();
        chimeBus.gain.value = busLevel;
        chimeBus.connect(ctx.destination);
      } else {
        chimeBus.gain.value = busLevel;
      }
      const peak = kind === "im" ? 0.22 : 0.16;
      const now = ctx.currentTime ?? 0;
      const notes = kind === "im" ? [659.25, 880] : [523.25, 659.25, 783.99];
      const step = kind === "im" ? 0.08 : 0.075;
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator?.();
        if (!osc || !chimeBus) {
          return;
        }
        const g = ctx.createGain();
        const t0 = now + i * step;
        const dur = 0.16;
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(chimeBus);
        activeChimes.add(osc);
        osc.onended = () => {
          activeChimes.delete(osc);
        };
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      });
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
