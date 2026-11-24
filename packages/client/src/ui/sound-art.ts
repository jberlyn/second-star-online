/**
 * Sounds on the Content page (issue #29, stage 7): a Sounds section that lists every sound the
 * content and the engine play, with where it comes from and who plays it; a panel for one (hear
 * it, upload or replace its file, take the upload out); a new sound under a name of your own; and
 * a bulk upload that matches files to sounds by name.
 *
 * What the section writes goes through the `contentSound` intent; publishing the draft makes it
 * live, and players online load the new sounds with the publish. A sound is a WAV, MP3 or OGG
 * file; the browser must be able to play it before it is uploaded.
 */
import type { ArtSound, ArtSoundFormat } from "@secondstaronline/data";
import {
  artRowFingerprint,
  type ContentSoundArtView,
  matchSound,
  type SoundChange,
  type SoundUse,
  soundFormatOfName,
  soundNameProblem,
  soundReplaceText,
  soundStem,
  soundUsersText,
} from "@secondstaronline/shared";

import { action } from "./action.ts";
import { type StoredUpload, uploadUrl } from "./art-uploads.ts";
import { createTable, formField, panelButton } from "./control-panel-kit.ts";

// ---- what the section reads (pure) ------------------------------------------------------------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * A pack sound's URL by name, own entries only: a sound called `constructor` is never
 * Object.prototype's.
 */
export const packSound = (view: ContentSoundArtView, name: string): string | undefined => {
  const k = name.toLowerCase();
  return Object.hasOwn(view.packSounds, k) ? view.packSounds[k] : undefined;
};

/** Who plays a sound, own entries only. */
export const soundUse = (view: ContentSoundArtView, name: string): SoundUse | undefined => {
  const k = name.toLowerCase();
  return Object.hasOwn(view.uses, k) ? view.uses[k] : undefined;
};

/** The draft's upload for a sound, if any. */
export const soundUpload = (view: ContentSoundArtView, name: string): ArtSound | undefined =>
  view.art.find((a) => same(a.name, name));

/** Where a sound will come from once the draft is published. */
export type SoundSource =
  | { kind: "upload"; art: ArtSound }
  | { kind: "pack"; url: string }
  /** The draft takes out a published upload, so the pack's sound comes back on publish. */
  | { kind: "comingBack"; url: string }
  | { kind: "none" };

export function soundSource(view: ContentSoundArtView, name: string): SoundSource {
  const art = soundUpload(view, name);
  if (art) {
    return { kind: "upload", art };
  }
  const k = name.toLowerCase();
  const pack = packSound(view, k);
  if (pack === undefined) {
    return { kind: "none" };
  }
  return view.liveUploads.includes(k)
    ? { kind: "comingBack", url: pack }
    : { kind: "pack", url: pack };
}

/** Where to hear a sound as the draft would publish it, or null with none. */
export function soundUrl(view: ContentSoundArtView, name: string): string | null {
  const src = soundSource(view, name);
  return src.kind === "upload"
    ? uploadUrl({ file: src.art.file, ext: src.art.format })
    : src.kind === "none"
      ? null
      : src.url;
}

/** One sound the section lists. */
export interface SoundEntry {
  name: string;
  use: SoundUse | undefined;
}

/**
 * Every sound: the ones played (as their users spell them), then the uploads and the packs' sounds
 * nothing plays, sorted by name, case ignored. A name is one sound whatever its case.
 */
export function soundEntries(view: ContentSoundArtView): SoundEntry[] {
  const out = new Map<string, SoundEntry>();
  for (const [k, use] of Object.entries(view.uses)) {
    out.set(k, { name: soundUpload(view, use.name)?.name ?? use.name, use });
  }
  for (const a of view.art) {
    const k = a.name.toLowerCase();
    if (!out.has(k)) {
      out.set(k, { name: a.name, use: undefined });
    }
  }
  for (const k of Object.keys(view.packSounds)) {
    if (!out.has(k)) {
      out.set(k, { name: k, use: undefined });
    }
  }
  return [...out.values()].sort((a, b) =>
    a.name.toLowerCase() < b.name.toLowerCase()
      ? -1
      : a.name.toLowerCase() > b.name.toLowerCase()
        ? 1
        : 0,
  );
}

/** The sounds a filter shows: by name or user, case ignored ("" shows every sound). */
export function filterSounds(view: ContentSoundArtView, query: string): SoundEntry[] {
  const q = query.trim().toLowerCase();
  const all = soundEntries(view);
  if (q === "") {
    return all;
  }
  return all.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      (e.use?.users ?? []).some((u) => u.toLowerCase().includes(q)),
  );
}

/** The names a bulk file may match: every sound listed. */
export const knownSounds = (view: ContentSoundArtView): string[] =>
  soundEntries(view).map((e) => e.name);

/** Whether taking a sound's upload out would leave its users silent (no pack sound behind it). */
export function removeSilences(view: ContentSoundArtView, name: string): boolean {
  const k = name.toLowerCase();
  return packSound(view, k) === undefined && (soundUse(view, k)?.users.length ?? 0) > 0;
}

/** What the section says about sounds. */
export const SOUND_RULES =
  "A sound is a WAV, MP3 or OGG file of at most 5 MB, played by the name content gives it (case ignored). Uploading a sound under a pack sound's name replaces it for everyone who plays it; taking the upload out brings the pack's back. Older Safari cannot play OGG, so WAV or MP3 reach every player. A sound already playing when a publish lands finishes; the next one is the new file.";

/** A file checked in the browser before it is uploaded: its format, its size, that it plays. */
export async function checkSoundFile(
  file: File,
  maxBytes: number,
  playable: (file: File) => Promise<boolean | null>,
): Promise<{ ok: true; format: ArtSoundFormat } | { ok: false; error: string }> {
  const format = soundFormatOfName(file.name);
  if (!format) {
    return { ok: false, error: `${file.name} is not a .wav, .mp3 or .ogg file.` };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `${file.name} is ${(file.size / 1048576).toFixed(1)} MB; a sound may be at most ${Math.floor(maxBytes / 1048576)} MB.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: `${file.name} is empty.` };
  }
  // null: this browser cannot tell (no audio), so the server's check of its bytes decides.
  if ((await playable(file)) === false) {
    return {
      ok: false,
      error: `This browser cannot play ${file.name}${format === "ogg" ? " (older Safari cannot play OGG; WAV or MP3 play everywhere)" : ""}.`,
    };
  }
  return { ok: true, format };
}

/** Whether the browser can decode a sound file; null when it has no audio to tell with. */
async function defaultPlayable(file: File): Promise<boolean | null> {
  const Ctor =
    globalThis.OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctor) {
    return null;
  }
  try {
    const ctx = new Ctor(1, 1, 44100);
    await ctx.decodeAudioData(await file.arrayBuffer());
    return true;
  } catch {
    return false;
  }
}

/** One file a bulk upload found, and the sound it is for. */
export interface SoundBulkLine {
  label: string;
  /** The sound it writes: an existing sound's name as listed, or a new name (editable). */
  name: string;
  /** Whether `name` is a sound already listed (so attaching replaces it). */
  replaces: boolean;
  file: string;
  format: ArtSoundFormat;
  include: boolean;
  /** The replaced sound's upload as the line saw it, for the stale-save check. */
  expect: string | null;
  done: string;
  error: string;
}

/** The line a stored file makes: named like a listed sound, it replaces it (ticked); else new. */
export function bulkLineFor(
  fileName: string,
  stored: { file: string; format: ArtSoundFormat },
  view: ContentSoundArtView,
): SoundBulkLine {
  const m = matchSound(soundStem(fileName), knownSounds(view));
  return {
    label: fileName,
    name: m.name,
    replaces: m.kind === "sound",
    file: stored.file,
    format: stored.format,
    include: true,
    expect: artRowFingerprint(soundUpload(view, m.name)),
    done: "",
    error: "",
  };
}

/** Re-reads what a line's (edited) name stands for against the view. */
/**
 * Re-reads what a line's (edited) name stands for against the view: whether it replaces a listed
 * sound and that sound's upload. `canonical` (the name is settled) also spells it as listed.
 */
export function rematchLine(
  line: SoundBulkLine,
  view: ContentSoundArtView,
  canonical = true,
): void {
  const m = matchSound(line.name.trim(), knownSounds(view));
  line.replaces = m.kind === "sound";
  if (m.kind === "sound" && canonical) {
    line.name = m.name;
  }
  line.expect = artRowFingerprint(soundUpload(view, m.kind === "sound" ? m.name : line.name));
}

/** Why a line cannot be attached as it is, or "" when it can. */
export function bulkLineError(line: SoundBulkLine, lines: readonly SoundBulkLine[]): string {
  if (!line.include || line.done) {
    return "";
  }
  const bad = soundNameProblem(line.name);
  if (bad) {
    return bad;
  }
  // Lines clash by where they write: two files for the same sound.
  const clash = lines.some(
    (o) => o !== line && o.include && !o.done && same(o.name.trim(), line.name.trim()),
  );
  return clash ? `Another line is also for ${line.name.trim()}: untick one.` : "";
}

/** The changes a bulk attach sends, worked out when Attach is pressed. */
export function bulkChanges(lines: readonly SoundBulkLine[]): {
  change: SoundChange;
  line: SoundBulkLine;
}[] {
  return lines
    .filter((l) => l.include && !l.done && bulkLineError(l, lines) === "")
    .map((l) => ({
      change: {
        op: "set",
        name: l.name.trim(),
        file: l.file,
        format: l.format,
        expect: l.expect,
      },
      line: l,
    }));
}

// ---- the section ------------------------------------------------------------------------------

export interface SoundsOptions {
  /**
   * Uploads one sound file; the stored file, or why it was refused. `still` is asked before the
   * ticket and again before posting: false (the panel or batch moved on) uploads nothing.
   */
  upload(
    file: File,
    still?: () => boolean,
  ): Promise<{ ok: true; stored: StoredUpload } | { ok: false; error: string }>;
  /** Puts one sound change in the draft (the server makes it as a whole). */
  apply(change: SoundChange): Promise<{
    ok: boolean;
    text: string;
    sound?: string;
    problems?: { where: string; message: string }[];
  }>;
  /** Whether the browser can play a file (tests pass their own); null when it cannot tell. */
  playable?(file: File): Promise<boolean | null>;
  /** Plays a sound file's URL (tests pass their own); a later call stops an earlier one. */
  play?(url: string): void;
  /** Stops what `play` started (tests pass their own with `play`). */
  stop?(): void;
  /** The draft changed: the page refreshes. */
  saved(): void;
}

export interface Sounds {
  readonly el: HTMLElement;
  setView(view: ContentSoundArtView): void;
  /** Work set up but not saved: a file in the panel or a new sound, or files waiting to attach. */
  pending(): boolean;
  /** Drops that work, and stops a bulk attach before its next write. */
  discard(): void;
  reset(): void;
  /** Opens a sound's panel (tests and links). */
  open(name: string): void;
  /** Stops a preview playing (the page was left). */
  stop(): void;
}

/** How many sounds the list shows before "Show more". */
export const SOUNDS_SHOWN = 100;

const formatOf = (ext: string): ArtSoundFormat | null =>
  ext === "wav" || ext === "mp3" || ext === "ogg" ? ext : null;

export function createSounds(opts: SoundsOptions): Sounds {
  const playable = opts.playable ?? defaultPlayable;
  let player: HTMLAudioElement | null = null;
  const play =
    opts.play ??
    ((url: string) => {
      player?.pause();
      player = new Audio(url);
      void player.play().catch(() => {});
    });
  /** Stops the preview and lets its file go. */
  const stopPreview = () => {
    if (opts.stop) {
      opts.stop();
      return;
    }
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.load();
      player = null;
    }
  };
  const el = document.createElement("div");
  el.className = "item-pictures sounds";
  let view: ContentSoundArtView | null = null;

  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = SOUND_RULES;

  // ---- the list -------------------------------------------------------------------------------

  const filter = action(document.createElement("input"), "sounds-filter");
  filter.type = "search";
  filter.placeholder = "Name or who plays it";
  let shown = SOUNDS_SHOWN;
  filter.addEventListener("input", () => {
    shown = SOUNDS_SHOWN;
    drawList();
  });
  const listTable = createTable<SoundEntry>({
    label: "Sounds",
    empty: "No sounds.",
    key: (e) => e.name.toLowerCase(),
    columns: [
      {
        label: "Sound",
        cell: (e) => {
          const b = action(document.createElement("button"), "sounds-open");
          b.type = "button";
          b.className = "link-button";
          b.dataset.sound = e.name;
          b.textContent = e.name;
          b.addEventListener("click", () => showSound(e.name));
          return b;
        },
      },
      {
        label: "From",
        cell: (e) => {
          if (!view) {
            return "";
          }
          const src = soundSource(view, e.name);
          return src.kind === "upload"
            ? `Upload (${src.art.format.toUpperCase()})`
            : src.kind === "pack"
              ? "Pack"
              : src.kind === "comingBack"
                ? "Pack (upload taken out)"
                : "Missing";
        },
      },
      { label: "Played by", cell: (e) => soundUsersText(e.use) },
      {
        label: "Hear",
        cell: (e) => {
          const url = view ? soundUrl(view, e.name) : null;
          if (!url) {
            return "";
          }
          const b = action(document.createElement("button"), "sounds-play");
          b.type = "button";
          b.textContent = "Play";
          b.setAttribute("aria-label", `Play ${e.name}`);
          b.addEventListener("click", () => play(url));
          return b;
        },
      },
    ],
  });
  const more = panelButton("sounds-more", "Show more", () => {
    shown += SOUNDS_SHOWN;
    drawList();
  });
  const listStatus = document.createElement("p");
  listStatus.className = "item-art-status";
  listStatus.setAttribute("role", "status");
  function drawList(): void {
    if (!view) {
      listTable.setRows([]);
      more.hidden = true;
      return;
    }
    const all = filterSounds(view, filter.value);
    listTable.setRows(all.slice(0, shown));
    more.hidden = all.length <= shown;
  }

  // ---- the panel ------------------------------------------------------------------------------

  const panel = document.createElement("div");
  panel.className = "item-art sound-art";
  panel.hidden = true;
  const title = document.createElement("h4");
  title.className = "item-art-title";
  const source = document.createElement("p");
  source.className = "item-art-rules";
  const used = document.createElement("p");
  used.className = "item-art-rules";
  const playNow = panelButton("sound-art-play", "Play it", () => {
    const url = view && name ? soundUrl(view, name) : null;
    if (url) {
      play(url);
    }
  });
  const playPack = panelButton("sound-art-play-pack", "Play the pack's", () => {
    const url = view && name ? packSound(view, name) : undefined;
    if (url) {
      play(url);
    }
  });
  const playButtons = document.createElement("div");
  playButtons.className = "content-buttons";
  playButtons.append(playNow, playPack);

  const soundFile = action(document.createElement("input"), "sound-art-file");
  soundFile.type = "file";
  soundFile.accept = ".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg";
  soundFile.setAttribute("aria-label", "A new file for the sound");
  const playPicked = panelButton("sound-art-play-picked", "Play the new file", () => {
    if (picked) {
      play(uploadUrl({ file: picked.file, ext: picked.format }));
    }
  });
  const replace = document.createElement("p");
  replace.className = "item-art-rules";
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");
  const save = panelButton("sound-art-save", "Save the file", () => void doSave(), "primary");
  const remove = panelButton("sound-art-remove", "Take the upload out", () => void doRemove());
  const close = panelButton("sound-art-close", "Close", () => clearPanel());
  const fileButtons = document.createElement("div");
  fileButtons.className = "content-buttons";
  fileButtons.append(playPicked, save, remove, close);
  panel.append(
    title,
    source,
    used,
    playButtons,
    formField("New file (WAV, MP3 or OGG)", soundFile),
    replace,
    fileButtons,
    status,
  );

  /** The sound the panel shows and its upload as it was shown (`expect`). */
  let name: string | null = null;
  let expect: string | null = null;
  /** A file chosen in the panel, not yet saved, and one still being checked or uploaded. */
  let picked: { file: string; format: ArtSoundFormat } | null = null;
  let picking = false;
  let generation = 0;
  let busy = false;

  function updateButtons(): void {
    const has = name !== null && view !== null;
    const held = busy || picking;
    save.disabled = held || !has || picked === null;
    playPicked.hidden = picked === null;
    const up = has && view && name ? soundUpload(view, name) : undefined;
    remove.hidden = !up;
    const silences = has && view && name ? removeSilences(view, name) : false;
    remove.disabled = held || silences;
    remove.title = silences
      ? "No pack has this sound: taking the upload out would leave its players silent"
      : "";
    playNow.disabled = !(has && view && name && soundUrl(view, name));
    playPack.hidden = !(
      has &&
      view &&
      name &&
      packSound(view, name) !== undefined &&
      soundSource(view, name).kind === "upload"
    );
    soundFile.disabled = busy || !has;
  }

  /** What the panel says about the sound: its title, where it comes from, who plays it. */
  function fillInfo(): void {
    if (!view || !name) {
      return;
    }
    // A name listed nowhere (a new sound, or an unused upload just taken out) is a new sound.
    if (!soundEntries(view).some((e) => same(e.name, name as string))) {
      title.textContent = `New sound ${name}`;
      source.textContent = "Nothing supplies it yet: choose its file, then save it.";
      used.textContent = "Nothing plays it yet: name it in a content row to use it.";
      replace.textContent = "";
      return;
    }
    const src = soundSource(view, name);
    title.textContent = `Sound ${name}`;
    source.textContent =
      src.kind === "upload"
        ? `It is an upload (${src.art.format.toUpperCase()}).${packSound(view, name) ? " A pack has its own: taking the upload out brings that back." : ""}`
        : src.kind === "pack"
          ? "It is the pack's. Uploading a file replaces it; taking the upload out brings it back."
          : src.kind === "comingBack"
            ? "The draft takes its upload out: the pack's comes back when the draft is published."
            : "Nothing supplies it, so it is silent: upload a file.";
    const use = soundUse(view, name);
    used.textContent = `Played by ${soundUsersText(use)}.`;
    replace.textContent = soundReplaceText(name, use);
  }

  function fillFile(): void {
    if (!view || !name) {
      return;
    }
    expect = artRowFingerprint(soundUpload(view, name));
  }

  function showSound(n: string): void {
    generation += 1;
    name = view ? (soundEntries(view).find((e) => same(e.name, n))?.name ?? n) : n;
    picked = null;
    picking = false;
    soundFile.value = "";
    status.textContent = "";
    panel.hidden = false;
    fillInfo();
    fillFile();
    updateButtons();
  }

  function clearPanel(): void {
    generation += 1;
    name = null;
    expect = null;
    picked = null;
    picking = false;
    soundFile.value = "";
    status.textContent = "";
    panel.hidden = true;
  }

  /** Checks a chosen file in the browser, then uploads it; the stored file, or why not. */
  async function readAndUpload(
    f: File,
    still: () => boolean,
  ): Promise<{ ok: true; file: string; format: ArtSoundFormat } | { ok: false; error: string }> {
    const checked = await checkSoundFile(f, view?.maxBytes ?? 5 * 1048576, playable);
    if (!checked.ok) {
      return checked;
    }
    // Discarded or replaced while the browser decoded it: nothing is uploaded.
    if (!still()) {
      return { ok: false, error: "" };
    }
    const stored = await opts.upload(f, still);
    if (!stored.ok) {
      return { ok: false, error: `${f.name} refused: ${stored.error}` };
    }
    const format = formatOf(stored.stored.ext);
    if (!format) {
      return { ok: false, error: `${f.name} was not stored as a sound.` };
    }
    return { ok: true, file: stored.stored.file, format };
  }

  soundFile.addEventListener("change", () => {
    const f = soundFile.files?.[0];
    if (!f) {
      return;
    }
    const mine = ++generation;
    // From the choice until it is uploaded, the file counts as unsaved work.
    picking = true;
    picked = null;
    updateButtons();
    status.textContent = "Checking…";
    void (async () => {
      try {
        const r = await readAndUpload(f, () => mine === generation);
        if (mine !== generation) {
          return;
        }
        if (!r.ok) {
          status.textContent = r.error;
          soundFile.value = "";
          return;
        }
        picked = { file: r.file, format: r.format };
        status.textContent = `${f.name} is ready: save the file to put it in the draft.`;
      } finally {
        if (mine === generation) {
          picking = false;
          updateButtons();
        }
      }
    })();
  });

  /** Sends a change from the panel; a reply for a sound the panel no longer shows changes nothing. */
  async function send(change: SoundChange, after: () => void): Promise<void> {
    if (busy) {
      return;
    }
    const mine = generation;
    busy = true;
    updateButtons();
    status.textContent = "Saving…";
    try {
      const r = await opts.apply(change);
      if (mine !== generation) {
        if (r.ok) {
          opts.saved();
        }
        return;
      }
      status.textContent = [
        r.text,
        ...(r.problems ?? []).map((p) => `${p.where}: ${p.message}`),
      ].join(" ");
      if (r.ok) {
        after();
        opts.saved();
      }
    } finally {
      busy = false;
      updateButtons();
    }
  }

  async function doSave(): Promise<void> {
    if (!name || !picked) {
      return;
    }
    const p = picked;
    await send({ op: "set", name, file: p.file, format: p.format, expect }, () => {
      picked = null;
      soundFile.value = "";
    });
  }

  async function doRemove(): Promise<void> {
    if (!name) {
      return;
    }
    await send({ op: "remove", name, expect }, () => {});
  }

  // ---- a new sound ----------------------------------------------------------------------------

  const newName = action(document.createElement("input"), "sounds-new-name");
  newName.type = "text";
  newName.maxLength = 80;
  newName.placeholder = "The name content plays it by";
  const newOpen = panelButton("sounds-new-open", "Open it", () => {
    const n = newName.value.trim();
    const bad = soundNameProblem(n);
    if (bad) {
      newStatus.textContent = bad;
      return;
    }
    newName.value = "";
    newOpen.disabled = true;
    newStatus.textContent = "";
    showSound(n);
    status.textContent =
      view && soundEntries(view).some((e) => same(e.name, n))
        ? "That sound is already listed: here it is."
        : "A new sound: choose its file, then save it.";
  });
  newOpen.disabled = true;
  newName.addEventListener("input", () => {
    newOpen.disabled = view === null || newName.value.trim() === "";
    newStatus.textContent = "";
  });
  const newStatus = document.createElement("p");
  newStatus.className = "item-art-status";
  newStatus.setAttribute("role", "status");
  const newRow = document.createElement("div");
  newRow.className = "content-buttons";
  newRow.append(newOpen);

  // ---- adding many sounds ---------------------------------------------------------------------

  let lines: SoundBulkLine[] = [];
  let reading = 0;
  let attaching = false;
  /** Bumped by Clear and Discard: a batch still running for a cleared list stops. */
  let batch = 0;
  const bulkStatus = document.createElement("p");
  bulkStatus.className = "item-art-status";
  bulkStatus.setAttribute("role", "status");
  const files = action(document.createElement("input"), "sounds-files");
  files.type = "file";
  files.multiple = true;
  files.accept = ".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg";
  files.setAttribute("aria-label", "Sound files to add");
  files.addEventListener("change", () => {
    const list = [...(files.files ?? [])];
    files.value = "";
    void addFiles(list);
  });

  /** Each bulk line's "Makes" cell, to update in place. */
  const makes = new WeakMap<SoundBulkLine, HTMLElement>();
  const table = createTable<SoundBulkLine>({
    label: "Sounds to add",
    empty: "No sound files chosen.",
    key: (l) => `${l.label}:${lines.indexOf(l)}`,
    columns: [
      { label: "File", cell: (l) => l.label },
      {
        label: "Add",
        cell: (l) => {
          const input = action(document.createElement("input"), "sounds-include");
          input.type = "checkbox";
          input.checked = l.include;
          input.disabled = attaching || l.done !== "";
          input.setAttribute("aria-label", `Attach ${l.label}`);
          input.addEventListener("change", () => {
            l.include = input.checked;
            redraw();
          });
          return input;
        },
      },
      {
        label: "Sound",
        cell: (l) => {
          const input = action(document.createElement("input"), "sounds-line-name");
          input.type = "text";
          input.maxLength = 80;
          input.value = l.name;
          input.disabled = attaching || l.done !== "";
          input.setAttribute("aria-label", `The sound ${l.label} is for`);
          // Matched as it is typed: the line's "Makes", every clash and Attach follow at once,
          // without rebuilding the table under the cursor.
          input.addEventListener("input", () => {
            l.name = input.value;
            if (view) {
              rematchLine(l, view, false);
            }
            refreshLines();
          });
          // Matched again when the name is settled, so the table is not rebuilt while typing.
          input.addEventListener("change", () => {
            if (view) {
              rematchLine(l, view);
            }
            redraw();
          });
          return input;
        },
      },
      {
        label: "Makes",
        cell: (l) => {
          const span = document.createElement("span");
          span.textContent = makesText(l);
          makes.set(l, span);
          return span;
        },
      },
      {
        label: "Hear",
        cell: (l) => {
          const b = action(document.createElement("button"), "sounds-line-play");
          b.type = "button";
          b.textContent = "Play";
          b.setAttribute("aria-label", `Play ${l.label}`);
          b.addEventListener("click", () => play(uploadUrl({ file: l.file, ext: l.format })));
          return b;
        },
      },
    ],
  });

  const attach = panelButton("sounds-attach", "Add the sounds", () => void attachAll(), "primary");
  const clear = panelButton("sounds-clear", "Clear", () => {
    batch += 1;
    lines = [];
    reading = 0;
    bulkStatus.textContent = "";
    redraw();
  });
  const bulkButtons = document.createElement("div");
  bulkButtons.className = "content-buttons";
  bulkButtons.append(attach, clear);

  /** What a bulk line will do, or why it cannot. */
  function makesText(l: SoundBulkLine): string {
    if (l.done) {
      return l.done;
    }
    const err = bulkLineError(l, lines);
    if (err) {
      return err;
    }
    if (l.error) {
      return l.error;
    }
    return l.replaces && view ? soundReplaceText(l.name, soundUse(view, l.name)) : "A new sound.";
  }

  /** Each line's "Makes" and Attach, updated in place (typing in a line keeps its field). */
  function refreshLines(): void {
    for (const l of lines) {
      const span = makes.get(l);
      if (span) {
        span.textContent = makesText(l);
      }
    }
    updateAttach();
  }

  function updateAttach(): void {
    const open = lines.filter((l) => l.include && !l.done);
    attach.disabled =
      attaching ||
      reading > 0 ||
      open.length === 0 ||
      open.some((l) => bulkLineError(l, lines) !== "");
  }

  function redraw(): void {
    table.setRows(lines);
    updateAttach();
    clear.disabled = attaching;
    // One pick at a time: a second pick while files are read would hide the first's refusals.
    files.disabled = attaching || view === null || reading > 0;
    newOpen.disabled = view === null || newName.value.trim() === "";
  }

  async function addFiles(chosen: File[]): Promise<void> {
    if (!view) {
      bulkStatus.textContent = "The sounds are still loading: choose the files again in a moment.";
      return;
    }
    const mine = batch;
    // What each file is for, and the upload it replaces, are read from the sounds as they are
    // when the files are chosen: a refresh while they upload never changes what a line saw.
    const seen = view;
    reading += chosen.length;
    let left = chosen.length;
    redraw();
    const refused: string[] = [];
    try {
      for (const f of chosen) {
        let r: Awaited<ReturnType<typeof readAndUpload>>;
        try {
          r = await readAndUpload(f, () => mine === batch);
        } catch (e) {
          // An upload that failed outright is a refusal like any other, never a stuck count.
          r = { ok: false, error: `${f.name}: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (mine !== batch) {
          return;
        }
        left -= 1;
        reading -= 1;
        if (r.ok) {
          lines.push(bulkLineFor(f.name, r, seen));
        } else if (r.error) {
          refused.push(r.error);
        }
        redraw();
      }
    } finally {
      // Whatever happened, the files this pick counted are counted no more.
      if (mine === batch) {
        reading -= left;
        bulkStatus.textContent = refused.join(" ");
        redraw();
      }
    }
  }

  async function attachAll(): Promise<void> {
    if (!view || attaching) {
      return;
    }
    const mine = ++batch;
    // Where each line writes and the upload it replaces are fixed now: the changes are built from
    // the lines as they are when Attach is pressed.
    const plan = bulkChanges(lines);
    attaching = true;
    redraw();
    let added = 0;
    try {
      for (const p of plan) {
        // A Clear or Discard while an earlier change was saving stops here, before this write.
        if (mine !== batch) {
          return;
        }
        const r = await opts.apply(p.change);
        if (mine !== batch) {
          return;
        }
        if (r.ok) {
          p.line.done = `${r.sound ?? p.change.name} is in the draft.`;
          p.line.error = "";
          added += 1;
        } else {
          // Kept, ticked, to try again with Add the sounds.
          p.line.error = `Not saved: ${r.text}`;
        }
        redraw();
      }
    } finally {
      attaching = false;
      // A batch cut short by Clear or a reset still gives the controls back.
      redraw();
    }
    const left = lines.filter((l) => l.include && !l.done).length;
    bulkStatus.textContent = `${
      added === 0
        ? "Nothing was saved."
        : `${added} ${added === 1 ? "sound is" : "sounds are"} in the draft.`
    }${left > 0 ? ` ${left} not saved: see why in the list, then Add the sounds again.` : ""}`;
    if (added > 0) {
      opts.saved();
    }
  }

  const fresh = document.createElement("div");
  fresh.className = "sounds-new";
  const freshTitle = document.createElement("h4");
  freshTitle.textContent = "A new sound";
  fresh.append(freshTitle, formField("Name", newName), newRow, newStatus);

  const bulk = document.createElement("div");
  bulk.className = "sounds-bulk";
  const bulkTitle = document.createElement("h4");
  bulkTitle.textContent = "Add sounds";
  const bulkRules = document.createElement("p");
  bulkRules.className = "item-art-rules";
  bulkRules.textContent =
    "A file named like a listed sound (fireballs.wav) replaces it; any other name makes a new sound under that name, which you can change before adding.";
  bulk.append(
    bulkTitle,
    bulkRules,
    formField("Sound files (WAV, MP3 or OGG)", files),
    table.el,
    bulkButtons,
    bulkStatus,
  );

  el.append(
    rules,
    formField("Find a sound", filter),
    listTable.el,
    more,
    listStatus,
    panel,
    fresh,
    bulk,
  );
  redraw();
  updateButtons();

  return {
    el,
    setView(v) {
      view = v;
      drawList();
      if (name !== null) {
        // What the panel says always catches up (a sound listed nowhere shows as a new one); the
        // upload it saw catches up unless a file is set up in it.
        fillInfo();
        if (!busy && picked === null && !picking) {
          fillFile();
        }
        updateButtons();
      }
      // Bulk lines keep the sound and the upload they saw when their file was read: one another
      // admin has changed since is refused at Attach, never replaced unseen.
      redraw();
    },
    pending: () =>
      picked !== null ||
      picking ||
      lines.some((l) => l.include && !l.done) ||
      attaching ||
      reading > 0,
    discard() {
      batch += 1;
      lines = [];
      reading = 0;
      bulkStatus.textContent = "";
      clearPanel();
      redraw();
    },
    reset() {
      batch += 1;
      view = null;
      lines = [];
      reading = 0;
      stopPreview();
      clearPanel();
      drawList();
      redraw();
    },
    open: (n) => showSound(n),
    stop: stopPreview,
  };
}
