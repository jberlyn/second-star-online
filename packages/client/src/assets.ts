/**
 * Loads the generated assets: the index, the atlas sheets and the UI files under /assets/. Staged:
 * the login screens need only UI files; the playfield needs the tile and paperdoll sheets. Until a
 * sheet arrives, nothing is drawn for it.
 */
import type { AssetIndex, AtlasGroup, AtlasSprite } from "@secondstaronline/data";
import { ASSETS_HASH_HEADER } from "@secondstaronline/shared";

export const ASSETS_URL = "/assets/";

export interface Assets {
  /** The index loaded last (replaced by `reload`). */
  index: AssetIndex;
  /** The loaded index's hash, as the server named it (null from a server that names none). */
  hash: string | null;
  /** Decoded sheets per group; undefined until loaded. */
  sheets: Partial<Record<AtlasGroup, HTMLImageElement[]>>;
  loadGroup(group: AtlasGroup): Promise<void>;
  sprite(group: AtlasGroup, name: string): AtlasSprite | undefined;
  /** URL of a UI file, e.g. `ui("internal", 186)`. */
  ui(cast: string, member: number): string;
  /**
   * Fetches the index again (an operator published art, issue #29) and loads the sheets of each
   * group already loaded whose sheets changed, then swaps the index and those sheets in together,
   * so no sprite is ever looked up in a sheet it is not on. Returns the groups that changed.
   */
  reload(): Promise<AtlasGroup[]>;
  /** Runs `fn` after each reload that changed anything (redraws, the sounds). */
  onReload(fn: (changed: AtlasGroup[], previous: AssetIndex) => void | Promise<void>): void;
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
  const pending = new Map<AtlasGroup, Promise<void>>();
  const listeners: ((changed: AtlasGroup[], previous: AssetIndex) => void | Promise<void>)[] = [];
  const sheetsOf = (index: AssetIndex, group: AtlasGroup) =>
    Promise.all(index.atlases[group].sheets.map((f) => loadImage(ASSETS_URL + f)));
  let reloading: Promise<AtlasGroup[]> | null = null;
  const assets: Assets = {
    hash: res.headers.get(ASSETS_HASH_HEADER),
    index: (await res.json()) as AssetIndex,
    sheets: {},
    loadGroup(group) {
      let p = pending.get(group);
      if (!p) {
        // A reload that changes this group's sheets meanwhile loads its own; one that leaves them
        // as they were keeps these.
        const urls = JSON.stringify(assets.index.atlases[group].sheets);
        const load: Promise<void> = sheetsOf(assets.index, group).then(
          (imgs) => {
            if (JSON.stringify(assets.index.atlases[group].sheets) === urls) {
              assets.sheets[group] = imgs;
              return;
            }
            // The sheets changed while these loaded: load the new ones.
            if (pending.get(group) === load) {
              pending.delete(group);
            }
            return assets.loadGroup(group);
          },
          (err: unknown) => {
            // A sheet that failed to load is tried again next time it is asked for.
            if (pending.get(group) === load) {
              pending.delete(group);
            }
            throw err;
          },
        );
        p = load;
        pending.set(group, p);
      }
      return p;
    },
    sprite: (group, name) => assets.index.atlases[group].sprites[name.toLowerCase()],
    ui: (cast, member) => {
      const f = assets.index.ui[`${cast.toLowerCase()}:${member}`];
      return f ? ASSETS_URL + f.file : "";
    },
    reload() {
      // One at a time: a second publish waits for the first reload, then loads its own.
      const run = async (): Promise<AtlasGroup[]> => {
        const r = await fetchImpl(`${ASSETS_URL}index.json`, { cache: "no-cache" });
        if (!r.ok) {
          throw new Error(`the asset index could not be fetched (${r.status})`);
        }
        const next = (await r.json()) as AssetIndex;
        const nextHash = r.headers.get(ASSETS_HASH_HEADER);
        const previous = assets.index;
        const groups = Object.keys(next.atlases) as AtlasGroup[];
        const changed = groups.filter(
          (g) => JSON.stringify(previous.atlases[g]) !== JSON.stringify(next.atlases[g]),
        );
        const soundsChanged = JSON.stringify(previous.sounds) !== JSON.stringify(next.sounds);
        // Groups in use load their new sheets before anything changes; the rest load on demand.
        const loaded = await Promise.all(
          changed
            .filter((g) => pending.has(g))
            .map(async (g) => [g, await sheetsOf(next, g)] as const),
        );
        assets.index = next;
        assets.hash = nextHash;
        for (const g of changed) {
          pending.delete(g);
          delete assets.sheets[g];
        }
        for (const [g, imgs] of loaded) {
          assets.sheets[g] = imgs;
          pending.set(g, Promise.resolve());
        }
        if (changed.length > 0 || soundsChanged) {
          // Listeners that load something (the sounds) finish before the reload does.
          await Promise.all(listeners.map((fn) => fn(changed, previous)));
        }
        return changed;
      };
      const p = (reloading ?? Promise.resolve([] as AtlasGroup[])).catch(() => []).then(run);
      reloading = p;
      return p;
    },
    onReload(fn) {
      listeners.push(fn);
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
