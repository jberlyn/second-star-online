/**
 * A house type's placement preview on the House types form (issue #10): the picture shown while a
 * player chooses where to build. A type shows its `Houses` member (the seven Classic buildings)
 * until it is given an upload; the upload is an item picture named `<house> (placement)`, drawn
 * with its anchor on the footprint's top-left corner, and the type's `ghost.picture` names it.
 * Saving puts both in the draft as a whole (the server's `house` picture change).
 */
import {
  type ContentItemArtView,
  ghostPicturePoint,
  ghostRect,
  guessTransparency,
  houseType,
  itemPictureReport,
  type PictureReport,
  type PictureSettings,
  type PictureTransparency,
  type Pixels,
  PLAYFIELD_RECT,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action } from "./action.ts";
import { uploadUrl } from "./art-uploads.ts";
import { formField, panelButton } from "./control-panel-kit.ts";
import { artNamed, type ItemArtOptions, keyed, loadPixels } from "./item-art.ts";

type HouseView = NonNullable<ContentItemArtView["houseTypes"]>[number];

/** Tiles of ground shown round the footprint: above (for a roof), beside and below. */
const MARGIN = { top: 3, side: 1, bottom: 1 } as const;
const TILE = 32;

/** What the panel tells an operator about drawing one. */
export const HOUSE_PREVIEW_RULES =
  "A placement preview is a PNG drawn 32 pixels to a tile, as wide as the building (96 pixels for 3 tiles, 160 for 5). Its bottom-left corner starts on the building's bottom-left, so a taller picture rises above it like a roof; move it with the two numbers. See-through pixels (or pure green, when you choose it) are left out.";

/** The anchor a fresh upload starts with: its bottom-left on the footprint's bottom-left. */
export function freshHouseAnchor(
  height: number,
  footprint: { h: number },
): { regX: number; regY: number } {
  return { regX: 0, regY: height - footprint.h * TILE };
}

/** The problems with a preview upload: an item picture's limits, without the bag's warnings. */
export function housePictureReport(
  raw: Pixels,
  transparency: PictureTransparency,
  maxSide: number,
): PictureReport {
  const r = itemPictureReport(keyed(raw, transparency), transparency, maxSide);
  // A building is bigger than a bag slot: only what would stop it being drawn is said.
  return { ...r, warnings: r.warnings.filter((w) => w.startsWith("No pixel")) };
}

export interface HouseArtPanel {
  readonly el: HTMLElement;
  /** Shows a house type's preview (the view is the draft's, from `contentItemArt`). */
  show(house: string, view: ContentItemArtView): void;
  clear(): void;
  /** A picture set up and not yet saved to the draft. */
  pending(): boolean;
}

interface Working {
  raw: Pixels;
  settings: PictureSettings;
}

export function createHouseArtPanel(opts: ItemArtOptions): HouseArtPanel {
  const a: Assets = opts.assets;
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("section");
  el.className = "item-art house-art";
  el.setAttribute("aria-label", "Placement preview");
  el.hidden = true;
  const title = document.createElement("h4");
  title.className = "item-art-title";
  title.textContent = "Placement preview";
  const state = document.createElement("p");
  state.className = "item-art-state";
  const canvas = action(document.createElement("canvas"), "house-art-preview");
  canvas.className = "house-art-preview";
  canvas.setAttribute("role", "img");
  const notes = document.createElement("ul");
  notes.className = "item-art-messages";
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");

  const file = action(document.createElement("input"), "house-art-file");
  file.type = "file";
  file.accept = ".png,image/png";
  file.setAttribute("aria-label", "A PNG for the placement preview");
  const seeThrough = action(document.createElement("select"), "house-art-transparency");
  for (const [v, label] of [
    ["alpha", "Its own see-through pixels"],
    ["green", "Pure green is see-through"],
  ] as const) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    seeThrough.append(o);
  }
  const left = action(document.createElement("input"), "house-art-left");
  left.type = "number";
  const up = action(document.createElement("input"), "house-art-up");
  up.type = "number";
  const controls = document.createElement("div");
  controls.className = "item-art-controls";
  controls.append(
    formField("See-through", seeThrough),
    formField("Starts left of the building (pixels)", left),
    formField("Starts above the building (pixels)", up),
  );

  const saveBtn = panelButton("house-art-save", "Save to the draft", () => {
    if (working) {
      void commit(working.settings);
    }
  });
  const cancelBtn = panelButton("house-art-cancel", "Cancel", () => {
    if (house && view) {
      show(house, view);
    }
  });
  const removeBtn = panelButton(
    "house-art-remove",
    "Use the built-in picture",
    () => void commit(null),
    "danger",
  );
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, cancelBtn, removeBtn);
  const uploadRow = document.createElement("div");
  uploadRow.className = "content-buttons";
  uploadRow.append(file);
  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = HOUSE_PREVIEW_RULES;
  el.append(title, state, canvas, controls, notes, buttons, status, uploadRow, rules);

  let house: string | null = null;
  let view: ContentItemArtView | null = null;
  let type: HouseView | null = null;
  let working: Working | null = null;
  /** The saved upload, shown unchanged: nothing to save. */
  let pristine = false;
  let busy = false;
  let generation = 0;
  /** What is drawn when nothing is being set up: a picture the game has, or a member. */
  let shown: { kind: "atlas"; name: string } | { kind: "member"; img: HTMLImageElement } | null =
    null;

  const report = () =>
    working && view
      ? housePictureReport(working.raw, working.settings.transparency, view.maxSide)
      : null;

  function redraw(): void {
    const t = type;
    if (!t) {
      return;
    }
    const w = (t.footprint.w + 2 * MARGIN.side) * TILE;
    const h = (t.footprint.h + MARGIN.top + MARGIN.bottom) * TILE;
    canvas.width = w;
    canvas.height = h;
    // Shown twice its size, as the item previews are enlarged.
    canvas.style.width = `${w * 2}px`;
    canvas.setAttribute(
      "aria-label",
      `The placement preview over the building's ${t.footprint.w}×${t.footprint.h} tiles`,
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    // Grass, if the tiles are loaded, else a plain ground.
    ctx.fillStyle = "#3b6b2a";
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += TILE) {
      for (let x = 0; x < w; x += TILE) {
        drawSprite(ctx, a, "tiles", "g1", x, y, true);
      }
    }
    const cx = MARGIN.side * TILE;
    const cy = MARGIN.top * TILE;
    if (working) {
      const k = keyed(working.raw, working.settings.transparency);
      const c = document.createElement("canvas");
      c.width = k.width;
      c.height = k.height;
      c.getContext("2d")?.putImageData(
        new ImageData(new Uint8ClampedArray(k.data), k.width, k.height),
        0,
        0,
      );
      ctx.drawImage(c, cx - working.settings.regX, cy - working.settings.regY);
    } else if (shown?.kind === "atlas") {
      drawSprite(ctx, a, "items", shown.name, cx, cy);
    } else if (shown?.kind === "member") {
      // Where the built-in ghost sits from the footprint's corner, as placement draws it.
      const published = houseType(t.house);
      let dx = 0;
      let dy = 0;
      if (published) {
        const r = ghostRect(published, 5, 5);
        const p = ghostPicturePoint(published, 5, 5);
        dx = r.left - PLAYFIELD_RECT.left - p.x;
        dy = r.top - PLAYFIELD_RECT.top - p.y;
      }
      ctx.drawImage(shown.img, cx + dx, cy + dy);
    }
    // The footprint's outline.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(cx + 0.5, cy + 0.5, t.footprint.w * TILE - 1, t.footprint.h * TILE - 1);
  }

  function updateControls(): void {
    const r = report();
    controls.hidden = working === null;
    const pending = working !== null && !pristine;
    saveBtn.hidden = !pending;
    saveBtn.disabled = !r || r.errors.length > 0;
    cancelBtn.hidden = !pending;
    removeBtn.hidden = pending || type?.picture === undefined;
    notes.replaceChildren(
      ...[...(r?.errors ?? []), ...(r?.warnings ?? [])].map((m) => {
        const li = document.createElement("li");
        li.textContent = m;
        return li;
      }),
    );
    if (working) {
      seeThrough.value = working.settings.transparency;
      left.value = String(working.settings.regX);
      up.value = String(working.settings.regY);
    }
  }

  function setWorking(w: Working | null, saved: boolean): void {
    working = w;
    pristine = saved;
    redraw();
    updateControls();
  }

  const edit = (change: Partial<PictureSettings>) => {
    if (!working) {
      return;
    }
    working = { ...working, settings: { ...working.settings, ...change } };
    pristine = false;
    redraw();
    updateControls();
  };
  seeThrough.addEventListener("change", () =>
    edit({ transparency: seeThrough.value === "green" ? "green" : "alpha" }),
  );
  const whole = (input: HTMLInputElement) => {
    const n = Number(input.value);
    return Number.isFinite(n) ? Math.max(-2048, Math.min(2048, Math.round(n))) : 0;
  };
  left.addEventListener("change", () => edit({ regX: whole(left) }));
  up.addEventListener("change", () => edit({ regY: whole(up) }));

  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    const t = type;
    if (!f || !t) {
      return;
    }
    const mine = ++generation;
    status.textContent = "Uploading…";
    void (async () => {
      const [stored, raw] = await Promise.all([opts.upload(f), decode(f)]);
      if (mine !== generation) {
        return;
      }
      if (!stored.ok || !raw) {
        status.textContent = stored.ok
          ? "The browser could not read that picture."
          : `Refused: ${stored.error}`;
        return;
      }
      status.textContent = "";
      state.textContent = "Your new picture, not saved yet: save it to the draft to use it.";
      setWorking(
        {
          raw,
          settings: {
            file: stored.stored.file,
            transparency: guessTransparency(raw),
            ...freshHouseAnchor(raw.height, t.footprint),
          },
        },
        false,
      );
    })();
  });

  async function commit(art: PictureSettings | null): Promise<void> {
    if (busy || !house) {
      return;
    }
    busy = true;
    status.textContent = "Saving…";
    try {
      const r = await opts.apply({ op: "house", house, art });
      status.textContent = r.text;
      if (r.ok) {
        opts.saved();
      }
    } finally {
      busy = false;
    }
  }

  function show(h: string, v: ContentItemArtView): void {
    const mine = ++generation;
    if (house === null || house.toLowerCase() !== h.toLowerCase()) {
      status.textContent = "";
    }
    house = h;
    view = v;
    type = v.houseTypes?.find((t) => t.house.toLowerCase() === h.toLowerCase()) ?? null;
    if (!type) {
      // A house type not saved yet: its preview is set once it is.
      el.hidden = true;
      return;
    }
    el.hidden = false;
    shown = null;
    working = null;
    const t = type;
    const upload = t.picture === undefined ? undefined : artNamed(v, t.picture);
    if (t.picture !== undefined && upload) {
      state.textContent = "It shows your uploaded picture.";
      void decode(uploadUrl({ file: upload.file, ext: "png" })).then((raw) => {
        // Only if nothing else was shown or chosen meanwhile.
        if (mine !== generation) {
          return;
        }
        if (!raw) {
          status.textContent = "Its uploaded picture could not be read for the preview.";
          return;
        }
        setWorking(
          {
            raw,
            settings: {
              file: upload.file,
              regX: upload.regX,
              regY: upload.regY,
              transparency: upload.transparency ?? "alpha",
            },
          },
          true,
        );
      });
    } else if (t.picture !== undefined) {
      const has = v.packPictures.includes(t.picture.toLowerCase());
      state.textContent = has
        ? `It shows the picture ${t.picture}. Upload one to give it its own.`
        : `It names the picture ${t.picture}, which the game does not have: upload one.`;
      shown = has ? { kind: "atlas", name: t.picture } : null;
    } else {
      const src = a.ui("houses", t.member);
      state.textContent = src
        ? `It shows the game's built-in house picture ${t.member}. Upload one to give it its own.`
        : "It has no picture: upload one, or players see nothing while placing it.";
      if (src) {
        const img = new Image();
        img.onload = () => {
          if (mine === generation && working === null) {
            shown = { kind: "member", img };
            redraw();
          }
        };
        img.src = src;
      }
    }
    redraw();
    updateControls();
  }

  return {
    el,
    show,
    pending: () => !el.hidden && working !== null && !pristine,
    clear() {
      generation += 1;
      house = null;
      view = null;
      type = null;
      working = null;
      shown = null;
      el.hidden = true;
    },
  };
}
