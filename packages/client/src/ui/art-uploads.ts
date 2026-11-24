/**
 * Uploading art and sounds (issue #29): files are posted to the server one at a time with a ticket
 * the Content page asks for, checked there and stored by the hash of their bytes. A stored file
 * goes live only when an `art` row in the draft names it and the draft is published. Each kind
 * of art gets its own picker, template and preview as later stages add them; this list is the
 * plain uploader under them all.
 */
import { UPLOAD_PATH, UPLOAD_TICKET_HEADER } from "@secondstaronline/shared";

import { action } from "./action.ts";
import { createTable, panelButton } from "./control-panel-kit.ts";

/** A stored upload, as the server answers it. */
export interface StoredUpload {
  file: string;
  ext: string;
  width?: number;
  height?: number;
}

/** One file's upload and how it went. */
export interface UploadLine {
  name: string;
  bytes: number;
  kind: "image" | "sound";
  result: { ok: true; stored: StoredUpload } | { ok: false; error: string } | null;
}

export interface ArtUploaderOptions {
  /** Asks the server for a ticket (the Content page sends the intent and waits for its answer). */
  ticket(): Promise<{ ticket: string; maxBytes: number }>;
  fetch?: typeof fetch;
}

export interface ArtUploader {
  readonly el: HTMLElement;
  /** Uploads files one after another; resolves with each one's line. */
  upload(files: readonly File[]): Promise<UploadLine[]>;
}

/** Whether a file is a sound (by its name; the server checks its bytes). */
export const isSoundFile = (name: string) => /\.(wav|mp3|ogg)$/i.test(name);

/** Where a stored upload can be looked at. */
export const uploadUrl = (u: StoredUpload) =>
  `/assets/uploads/${u.ext === "png" ? "art" : "sounds"}/${u.file}.${u.ext}`;

const kb = (n: number) =>
  n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** Posts one file with a ticket; the server's answer, or why it failed. */
export async function postUpload(
  file: Blob,
  kind: "image" | "sound",
  ticket: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadLine["result"]> {
  try {
    const res = await fetchImpl(`${UPLOAD_PATH}${kind}`, {
      method: "POST",
      headers: { [UPLOAD_TICKET_HEADER]: ticket },
      body: file,
    });
    const body = (await res.json().catch(() => null)) as
      | ({ ok: true } & StoredUpload)
      | { ok: false; error: string }
      | null;
    if (!body) {
      return { ok: false, error: `the server answered ${res.status}` };
    }
    return body.ok
      ? {
          ok: true,
          stored: { file: body.file, ext: body.ext, width: body.width, height: body.height },
        }
      : { ok: false, error: body.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function createArtUploader(opts: ArtUploaderOptions): ArtUploader {
  const fetchImpl = opts.fetch ?? fetch;
  const el = document.createElement("div");
  el.className = "art-uploader";
  const input = action(document.createElement("input"), "art-upload-files");
  input.type = "file";
  input.multiple = true;
  input.accept = ".png,.wav,.mp3,.ogg,image/png,audio/wav,audio/mpeg,audio/ogg";
  input.setAttribute("aria-label", "Art and sound files to upload");
  const lines: UploadLine[] = [];
  const table = createTable<UploadLine>({
    label: "Uploaded files",
    empty: "Nothing uploaded yet.",
    key: (l) => `${l.name}:${lines.indexOf(l)}`,
    columns: [
      { label: "File", cell: (l) => l.name },
      { label: "Size", cell: (l) => kb(l.bytes) },
      {
        label: "Stored as",
        cell: (l) => {
          if (!l.result) {
            return "Uploading…";
          }
          if (!l.result.ok) {
            const s = document.createElement("span");
            s.className = "art-upload-error";
            s.textContent = `Refused: ${l.result.error}`;
            return s;
          }
          const code = document.createElement("code");
          code.className = "art-upload-hash";
          code.textContent = l.result.stored.file;
          const size =
            l.result.stored.width !== undefined
              ? ` (${l.result.stored.width}×${l.result.stored.height})`
              : "";
          const wrap = document.createElement("span");
          wrap.append(code, size);
          return wrap;
        },
      },
      {
        label: "Preview",
        cell: (l) => {
          if (!l.result?.ok) {
            return "";
          }
          if (l.kind === "image") {
            const img = document.createElement("img");
            img.className = "art-upload-preview";
            img.alt = l.name;
            img.src = uploadUrl(l.result.stored);
            return img;
          }
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "none";
          audio.src = uploadUrl(l.result.stored);
          return audio;
        },
      },
    ],
  });
  const uploader: ArtUploader = {
    el,
    async upload(files) {
      if (files.length === 0) {
        return [];
      }
      const added = files.map(
        (f): UploadLine => ({
          name: f.name,
          bytes: f.size,
          kind: isSoundFile(f.name) ? "sound" : "image",
          result: null,
        }),
      );
      lines.unshift(...added);
      table.setRows(lines);
      let t: { ticket: string; maxBytes: number };
      try {
        t = await opts.ticket();
      } catch (e) {
        for (const l of added) {
          l.result = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        table.setRows(lines);
        return added;
      }
      for (const [i, f] of files.entries()) {
        const line = added[i] as UploadLine;
        line.result =
          f.size > t.maxBytes
            ? {
                ok: false,
                error: `the file is ${kb(f.size)}; uploads may be at most ${kb(t.maxBytes)}`,
              }
            : await postUpload(f, line.kind, t.ticket, fetchImpl);
        table.setRows(lines);
      }
      return added;
    },
  };
  const go = panelButton("art-upload-start", "Upload", () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    void uploader.upload(files);
  });
  const row = document.createElement("div");
  row.className = "content-buttons";
  row.append(input, go);
  el.append(row, table.el);
  return uploader;
}
