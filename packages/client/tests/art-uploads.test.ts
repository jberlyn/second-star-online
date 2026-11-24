/**
 * The Content page's uploader (issue #29): each file is posted with a ticket the page asks for,
 * and the table shows the hash it was stored under, a preview, or why the server refused it.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { createArtUploader, isSoundFile, uploadUrl } from "../src/ui/art-uploads.ts";

afterEach(() => document.body.replaceChildren());

const HASH = "b".repeat(64);

describe("the art uploader", () => {
  test("posts each file with the ticket and shows where it was stored, or why not", async () => {
    const posted: { url: string; ticket: string | null; size: number }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = init.body as Blob;
      posted.push({
        url,
        ticket: new Headers(init.headers).get("x-upload-ticket"),
        size: body.size,
      });
      return url.endsWith("/image") && body.size === 3
        ? Response.json({ ok: true, file: HASH, ext: "png", width: 8, height: 4 })
        : Response.json(
            { ok: false, error: "the file is not a WAV, MP3 or OGG sound" },
            { status: 422 },
          );
    }) as unknown as typeof fetch;
    let asked = 0;
    const up = createArtUploader({
      ticket: async () => {
        asked += 1;
        return { ticket: "t-1", maxBytes: 10 };
      },
      fetch: fetchImpl,
    });
    document.body.append(up.el);
    const lines = await up.upload([
      new File([new Uint8Array(3)], "sword.png"),
      new File([new Uint8Array(4)], "crack.wav"),
      new File([new Uint8Array(11)], "huge.png"),
    ]);
    expect(asked).toBe(1);
    expect(posted).toEqual([
      { url: "/upload/image", ticket: "t-1", size: 3 },
      { url: "/upload/sound", ticket: "t-1", size: 4 },
    ]);
    expect(lines.map((l) => l.result)).toEqual([
      { ok: true, stored: { file: HASH, ext: "png", width: 8, height: 4 } },
      { ok: false, error: "the file is not a WAV, MP3 or OGG sound" },
      { ok: false, error: "the file is 1 KB; uploads may be at most 1 KB" },
    ]);
    const text = up.el.textContent ?? "";
    expect(text).toContain(HASH);
    expect(text).toContain("(8×4)");
    expect(text).toContain("Refused: the file is not a WAV, MP3 or OGG sound");
    expect(up.el.querySelector<HTMLImageElement>(".art-upload-preview")?.getAttribute("src")).toBe(
      `/assets/uploads/art/${HASH}.png`,
    );
    expect(up.el.querySelector('[data-action="art-upload-files"]')).not.toBeNull();
    expect(up.el.querySelector('[data-action="art-upload-start"]')).not.toBeNull();
  });

  test("a ticket the server never gives refuses every file", async () => {
    const up = createArtUploader({
      ticket: () => Promise.reject(new Error("the server did not answer")),
    });
    const lines = await up.upload([new File([new Uint8Array(1)], "a.png")]);
    expect(lines[0]?.result).toEqual({ ok: false, error: "the server did not answer" });
  });

  test("sounds are told apart by name, and stored files have a preview URL", () => {
    expect(isSoundFile("Crack.OGG")).toBe(true);
    expect(isSoundFile("sword.png")).toBe(false);
    expect(uploadUrl({ file: HASH, ext: "mp3" })).toBe(`/assets/uploads/sounds/${HASH}.mp3`);
  });
});
