/**
 * The newspaper reader and editor (400×412).
 * Layouts from `assets/original/sub/Newspaper/layout/frame-1.json` and
 * `sub/newspapergui/frame-1.json`.
 *
 * Both are floating windows with a close box and a blank title (`windowType = 4`,
 * `title = " "`). Nothing closes either but its close box.
 */
import { NEWS_DEFAULTS, NEWS_TEXT } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const NEWS_STAGE = { w: 400, h: 412 } as const;
const R = (l: number, t: number, r: number, b: number): Rect => ({
  x: l,
  y: t,
  w: r - l,
  h: b - t,
});

/** Both sub-movies' text fields at their sprite rects, channels 5-10. */
export const NEWS_FIELDS: readonly Rect[] = [
  R(13, 14, 390, 42),
  R(12, 47, 389, 64),
  R(160, 80, 388, 247),
  R(82, 269, 384, 330),
  R(82, 339, 384, 400),
  R(18, 208, 143, 254),
];
/** The reader's photo sprites (Photo1 stretched to 128×128). */
export const NEWS_PHOTOS: readonly Rect[] = [
  R(16, 78, 144, 206),
  R(12, 268, 76, 332),
  R(12, 338, 76, 402),
];
/** The editor's photo-id fields, channels 12-14. */
export const EDITOR_PHOTO_FIELDS: readonly Rect[] = [
  R(25, 84, 138, 95),
  R(9, 268, 80, 279),
  R(10, 339, 77, 352),
];
export const SAVE_PAPER = R(28, 174, 131, 205);
/** The caps the server enforces on the six texts and the photo ids (the schema's bounds). */
export const NEWS_LIMITS = { texts: [500, 500, 4000, 500, 500, 500], photo: 20 } as const;

const place = <T extends HTMLElement>(el: T, r: Rect, cls = "news-abs"): T => {
  el.classList.add(cls);
  el.style.setProperty("--x", `${r.x}px`);
  el.style.setProperty("--y", `${r.y}px`);
  el.style.setProperty("--w", `${r.w}px`);
  el.style.setProperty("--h", `${r.h}px`);
  return el;
};

export interface NewspaperActions {
  /** SAVE PAPER: saves the newspaper with the nine fields. */
  save(photos: string[], texts: string[]): void;
  /** A chat line for you alone. */
  say(text: string): void;
}

export interface NewspaperUi {
  reader: GameWindow;
  editor: GameWindow;
  /** Reads a paper (its text and photos): fills the reader and opens it. */
  read(texts: readonly string[], photos: readonly (string | null)[]): void;
  /** Opens the editor with the cast defaults, awaiting `newspaperEdit`. */
  openEditor(): void;
  /** Fills all nine fields. */
  fill(photos: readonly string[], texts: readonly string[]): void;
  /** The editor's fields, as SAVE PAPER reads them. */
  values(): { photos: string[]; texts: string[] };
  /** Game entry closes both. */
  reset(): void;
}

/** A text field's CSS class by index: the Courier New styles. */
const fieldClass = (i: number) => `news-f${i + 1}`;

export function createNewspaper(a: Assets, layer: WindowLayer, act: NewspaperActions): NewspaperUi {
  // ---- the reader ---------------------------------------------------------------------------
  const rStage = document.createElement("div");
  rStage.className = "news-stage news-reader";
  const rBack = place(artImg(a.ui("Newspaper", 1)), R(0, 0, 400, 412));
  rBack.classList.add("news-art");
  const rPhotos = NEWS_PHOTOS.map((r, i) => {
    const img = place(artImg(a.ui("Newspaper", 2 + i)), r);
    img.classList.add("news-photo", `news-photo${i + 1}`);
    img.hidden = true;
    return img;
  });
  const rTexts = NEWS_FIELDS.map((r, i) => {
    const f = place(document.createElement("div"), r);
    f.classList.add("news-field", fieldClass(i));
    if (i === 2) {
      f.classList.add("news-scroll");
      f.tabIndex = 0;
    }
    return f;
  });
  rStage.append(rBack, ...rPhotos, ...rTexts);
  const reader = layer.create({
    title: " ",
    name: "newspaper",
    movie: "Newspaper",
    width: NEWS_STAGE.w,
    height: NEWS_STAGE.h,
    body: rStage,
  });

  // ---- the editor ---------------------------------------------------------------------------
  const eStage = document.createElement("div");
  eStage.className = "news-stage news-editor";
  const eBack = place(artImg(a.ui("newspapergui", 1)), R(0, 0, 400, 412));
  eBack.classList.add("news-art");
  const eTexts = NEWS_FIELDS.map((r, i) => {
    const single = i < 2;
    const f = place(
      action(
        single ? document.createElement("input") : document.createElement("textarea"),
        "newspaper-text",
      ),
      r,
    );
    f.classList.add("news-field", "news-edit", fieldClass(i));
    f.spellcheck = false;
    f.setAttribute("aria-label", `Newspaper text ${i + 1}`);
    const max = NEWS_LIMITS.texts[i] as number;
    if (f instanceof HTMLInputElement) {
      f.type = "text";
      f.maxLength = max;
    } else {
      f.maxLength = max;
      if (i === 2) {
        f.classList.add("news-scroll");
      } else {
        // A `limit` box: typing stops when the box is full.
        let fit = "";
        f.addEventListener("input", () => {
          if (f.scrollHeight > f.clientHeight && f.clientHeight > 0) {
            f.value = fit;
          }
          fit = f.value;
        });
      }
    }
    return f;
  });
  const ePhotos = EDITOR_PHOTO_FIELDS.map((r, i) => {
    const f = place(action(document.createElement("input"), "newspaper-photo"), r);
    f.type = "text";
    f.maxLength = NEWS_LIMITS.photo;
    f.classList.add("news-field", "news-edit", "news-photo-name");
    f.spellcheck = false;
    f.setAttribute("aria-label", `Photo ${i + 1} number`);
    return f;
  });
  const savePaper = place(action(document.createElement("button"), "newspaper-save"), SAVE_PAPER);
  savePaper.type = "button";
  savePaper.classList.add("news-save");
  savePaper.setAttribute("aria-label", "Save paper");
  const saveArt = artImg(a.ui("newspapergui", 14), "Save paper");
  saveArt.classList.add("news-save-art");
  savePaper.append(saveArt);
  eStage.append(eBack, ...eTexts, ...ePhotos, savePaper);
  const editor = layer.create({
    title: " ",
    name: "newspaper-editor",
    movie: "newspapergui",
    width: NEWS_STAGE.w,
    height: NEWS_STAGE.h,
    body: eStage,
  });

  const values = () => ({
    photos: ePhotos.map((f) => f.value),
    texts: eTexts.map((f) => f.value),
  });
  // The nine fields straight to the server, and "Newspaper saved!" always; the window stays.
  savePaper.addEventListener("click", () => {
    const v = values();
    act.save(v.photos, v.texts);
    act.say(NEWS_TEXT.saved);
  });

  const setEditor = (photos: readonly string[], texts: readonly string[]) => {
    ePhotos.forEach((f, i) => {
      f.value = photos[i] ?? "";
    });
    eTexts.forEach((f, i) => {
      f.value = texts[i] ?? "";
    });
  };

  return {
    reader,
    editor,
    read(texts, photos) {
      // Items 4-9 only; a re-read refills the same window.
      rTexts.forEach((f, i) => {
        f.textContent = texts[i] ?? "";
      });
      rPhotos.forEach((img, i) => {
        const png = photos[i];
        if (png) {
          img.src = `data:image/png;base64,${png}`;
          img.hidden = false;
        } else {
          img.hidden = true;
        }
      });
      reader.open();
    },
    openEditor() {
      // The cast text before the reply lands.
      setEditor(
        [NEWS_DEFAULTS.photoName, NEWS_DEFAULTS.photoName, NEWS_DEFAULTS.photo3],
        Array.from({ length: 6 }, () => NEWS_DEFAULTS.title),
      );
      editor.open();
    },
    fill: setEditor,
    values,
    reset() {
      reader.close();
      editor.close();
    },
  };
}
