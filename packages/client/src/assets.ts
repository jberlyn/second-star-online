/**
 * Loads the generated assets: the index, the atlas sheets and the UI files under /assets/. Staged:
 * the login screens need only UI files; the playfield needs the tile and paperdoll sheets. Until a
 * sheet arrives, nothing is drawn for it.
 */
import type { AssetIndex, AtlasGroup, AtlasSprite } from "@secondstaronline/data";

export const ASSETS_URL = "/assets/";

export interface Assets {
  index: AssetIndex;
  /** Decoded sheets per group; undefined until loaded. */
  sheets: Partial<Record<AtlasGroup, HTMLImageElement[]>>;
  loadGroup(group: AtlasGroup): Promise<void>;
  sprite(group: AtlasGroup, name: string): AtlasSprite | undefined;
  /** URL of a UI file, e.g. `ui("internal", 186)`. */
  ui(cast: string, member: number): string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

export async function loadAssets(fetchImpl: typeof fetch = fetch): Promise<Assets> {
  const res = await fetchImpl(`${ASSETS_URL}index.json`);
  if (!res.ok) {
    throw new Error("asset index missing: run `bun run assets:build`");
  }
  const index = (await res.json()) as AssetIndex;
  const pending = new Map<AtlasGroup, Promise<void>>();
  const assets: Assets = {
    index,
    sheets: {},
    loadGroup(group) {
      let p = pending.get(group);
      if (!p) {
        p = Promise.all(index.atlases[group].sheets.map((f) => loadImage(ASSETS_URL + f))).then(
          (imgs) => {
            assets.sheets[group] = imgs;
          },
        );
        pending.set(group, p);
      }
      return p;
    },
    sprite: (group, name) => index.atlases[group].sprites[name.toLowerCase()],
    ui: (cast, member) => {
      const f = index.ui[`${cast.toLowerCase()}:${member}`];
      return f ? ASSETS_URL + f.file : "";
    },
  };
  return assets;
}

/**
 * Draws an atlas sprite with its registration point at (x, y), or its top-left corner at
 * (x, y) when `topLeft` is set (paperdoll layers are pasted at their top-left).
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  group: AtlasGroup,
  name: string,
  x: number,
  y: number,
  topLeft = false,
): void {
  const s = assets.sprite(group, name);
  const sheet = s ? assets.sheets[group]?.[s[0]] : undefined;
  if (!s || !sheet) {
    return;
  }
  const [, sx, sy, w, h, rx, ry] = s;
  const dx = topLeft ? x : x - rx;
  const dy = topLeft ? y : y - ry;
  ctx.drawImage(sheet, sx, sy, w, h, dx, dy, w, h);
}
