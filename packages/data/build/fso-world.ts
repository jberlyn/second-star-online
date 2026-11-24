/**
 * The Classic pack's world seed from 1.6's distribution (issue #43): the maps 1.6 shipped in
 * `FSOServer/DAT/Maps`, with the monster rosters in `DAT/Mobs` and the ground items in `DAT/Items`.
 *
 * `.fso/` is a git-ignored reference copy, so the conversion is a maintenance step, not part of every
 * build: `bun run data:import-fso` reads it and writes `packages/data/content/world.json`, which is
 * committed, and `data:build` renders that into the Classic pack like any other content file. A test
 * re-runs the conversion when `.fso/` is present and checks the committed file still matches.
 *
 * The 1.6 formats, as its server scripts read them (`item n of` with `#` as the delimiter):
 *
 * - A map file has 57 `#` items. Each layer is 12 rows of 17 space-separated tile codes; rows 1-9
 *   of layers 1-4 are items 1-9, 19-27, 28-36 and 37-45, and rows 10-12 are items 46-48, 49-51,
 *   52-54 and 55-57 (`Boss.ls` and `building.ls` edit layer 2 rows 1-9 as items 19-27 and rows
 *   10-12 as 49-51). Item 12 is the flags, `canFight:fctSpwn:isIndoors:<unused>:canPvp:` then the
 *   fog `tex:blend:r:g:b`; item 13 is Exit and 18 is Exit2 (`MX:MY:LX:LY:`, a house exit written
 *   `H<slot><mx>:H<slot><my>:`); items 14-16 are the signs and 17 the header.
 * - A Mobs file is the four roster entries, `name:hp:x:y` split by `|` (the editor's placed
 *   monsters: species, HP, home tile), then `+`, then the four live monsters in the same form. The
 *   client's map load takes the part before `+` as the roster the spawner reads slots 1-4 from,
 *   and its monster save writes the roster, `+`, then the live ones.
 * - An Items file is `|`-separated `<name>:<h>-<v>` entries, `<h>-<v>` the item's stage pixel, a
 *   tile's anchor being (`32·x + 14`, `32·y − 3`).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorldMap, WorldSeed } from "../schema/world.ts";
import { worldSeedSchema } from "../schema/world.ts";

/** Where `bun run data:import-fso` writes the converted seed. */
export const CLASSIC_WORLD_SOURCE = join(import.meta.dir, "..", "content", "world.json");

/** The reference copy's data folder. */
export const FSO_DAT = join(import.meta.dir, "..", "..", "..", ".fso", "FSOServer", "DAT");

/** The 1-based items of each layer's rows 1-9 and rows 10-12. */
const LAYER_ITEMS: readonly [number, number][] = [
  [1, 46],
  [19, 49],
  [28, 52],
  [37, 55],
];

type Exit = NonNullable<WorldMap["exit1"]>;

/** 1.6's faction spawn letters (map field 12 item 2) as Classic's faction keys. */
const FSO_FACTIONS: Readonly<Record<string, string>> = { W: "warrior", M: "mage", A: "adventurer" };

/** An exit field, or null when it is empty or not whole numbers. */
export function parseFsoExit(field: string): Exit | null {
  const parts = field.split(":");
  const [mxs = "", mys = "", xs = "", ys = ""] = parts;
  if ([mxs, mys, xs, ys].every((p) => p.trim() === "")) {
    return null;
  }
  const hx = /^H([12])(-?\d+)$/i.exec(mxs.trim());
  const hy = /^H([12])(-?\d+)$/i.exec(mys.trim());
  const int = (s: string) => (/^-?\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  const x = int(xs);
  const y = int(ys);
  if (x === null || y === null) {
    return null;
  }
  if (hx && hy && hx[1] === hy[1]) {
    return { mx: Number(hx[2]), my: Number(hy[2]), x, y, house: hx[1] === "1" ? 1 : 2 };
  }
  const mx = int(mxs);
  const my = int(mys);
  return mx === null || my === null ? null : { mx, my, x, y };
}

/** A 1.6 map file's text, as a world seed map named `map`. Throws on a file of the wrong shape. */
export function parseFsoMap(map: string, text: string): WorldMap {
  const items = text.split("#");
  const item = (n: number) => items[n - 1] ?? "";
  if (items.length < 57) {
    throw new Error(`${map}: a map file has 57 items, this one ${items.length}`);
  }
  const layers = LAYER_ITEMS.map(([top, bottom]) => {
    const rows: string[] = [];
    for (let i = 0; i < 9; i++) {
      rows.push(item(top + i));
    }
    for (let i = 0; i < 3; i++) {
      rows.push(item(bottom + i));
    }
    return rows.map((r) => r.trim());
  }) as WorldMap["layers"];
  const flags = item(12).split(":");
  const onOff = (v: string | undefined) => (v === "O" ? "O" : "X");
  // 1.6's faction spawn letter, as Classic's faction keys (migration 63 maps saved maps the same
  // way); X, O or nothing is no swap.
  const fctSpwn = FSO_FACTIONS[(flags[1] ?? "").trim().toUpperCase()];
  const num = (v: string | undefined, d: number) =>
    v !== undefined && /^-?\d+$/.test(v) ? Number(v) : d;
  const fog = {
    tex: flags[5] || "NoTex",
    blend: num(flags[6], 0),
    r: num(flags[7], 255),
    g: num(flags[8], 255),
    b: num(flags[9], 255),
  };
  const out: WorldMap = {
    map,
    title: item(17),
    layers,
    flags: {
      canFight: onOff(flags[0]),
      isIndoors: onOff(flags[2]),
      canPvp: onOff(flags[4]),
      ...(fctSpwn ? { fctSpwn } : {}),
    },
    exit1: parseFsoExit(item(13)),
    exit2: parseFsoExit(item(18)),
    signs: [item(14), item(15), item(16)],
  };
  if (fog.tex !== "NoTex" || fog.blend !== 0 || fog.r !== 255 || fog.g !== 255 || fog.b !== 255) {
    out.fog = fog;
  }
  return out;
}

/**
 * The roster of a Mobs file, the part before `+`: up to four `{ species, x, y }` by slot, empty
 * slots left out. The live monsters after `+` are play state, not content.
 */
export function parseFsoMobs(text: string): WorldMap["roster"] {
  const roster = text.split("+")[0] ?? "";
  const slots = roster.split("|").slice(0, 4);
  const out: NonNullable<WorldMap["roster"]> = [];
  slots.forEach((entry, i) => {
    const [name = "", , xs = "", ys = ""] = entry.split(":");
    if (name.trim() === "") {
      return;
    }
    out.push({ slot: i + 1, species: name.trim(), x: Number(xs), y: Number(ys) });
  });
  return out;
}

/** An Items file's entries as tiles. Throws on a position that is not on a tile's anchor. */
export function parseFsoItems(map: string, text: string): NonNullable<WorldMap["items"]> {
  const out: NonNullable<WorldMap["items"]> = [];
  for (const entry of text.split("|")) {
    if (entry.trim() === "") {
      continue;
    }
    const m = /^(.*):(-?\d+)-(-?\d+)$/.exec(entry.trim());
    if (!m) {
      throw new Error(`${map}: the item entry "${entry}" is not <name>:<h>-<v>`);
    }
    const h = Number(m[2]);
    const v = Number(m[3]);
    if ((h - 14) % 32 !== 0 || (v + 3) % 32 !== 0) {
      throw new Error(`${map}: ${m[1]} at ${h}-${v} is not on a tile`);
    }
    out.push({ item: (m[1] as string).trim(), x: (h - 14) / 32, y: (v + 3) / 32 });
  }
  return out;
}

/**
 * The Classic world seed from a 1.6 `DAT` folder. The points are Classic's: the start where 1.6
 * created characters (x1000y992 6-4), the fallback at x1000y992 5-5 (an SSO difference: 1.6's death
 * respawn was x0y102 5-5, the tutorial area), the jail at x0y0 4-4 and the bell at x999y999, a map
 * 1.6 never shipped.
 */
export function importFsoWorld(
  dat: string,
  itemKeys: readonly string[] = classicItemKeys(),
): WorldSeed {
  // 1.6 matched item names ignoring case ("apple"); the seed spells each as its item's key.
  const keyOf = new Map(itemKeys.map((k) => [k.toLowerCase(), k]));
  const mapsDir = join(dat, "Maps");
  const names = readdirSync(mapsDir)
    .filter((f) => /^x-?\d+y-?\d+\.txt$/i.test(f))
    .map((f) => f.slice(0, -4))
    .sort((a, b) => {
      const [ax = 0, ay = 0] = (/^x(-?\d+)y(-?\d+)$/.exec(a) ?? []).slice(1).map(Number);
      const [bx = 0, by = 0] = (/^x(-?\d+)y(-?\d+)$/.exec(b) ?? []).slice(1).map(Number);
      return ax - bx || ay - by;
    });
  const read = (file: string) => readFileSync(file, "latin1");
  const maps = names.map((name) => {
    const m = parseFsoMap(name, read(join(mapsDir, `${name}.txt`)));
    const mobs = join(dat, "Mobs", `${name}.txt`);
    if (existsSync(mobs)) {
      const roster = parseFsoMobs(read(mobs));
      if (roster && roster.length > 0) {
        m.roster = roster;
      }
    }
    const items = join(dat, "Items", `${name}i.txt`);
    if (existsSync(items)) {
      const placed = parseFsoItems(name, read(items)).map((p) => ({
        ...p,
        item: keyOf.get(p.item.toLowerCase()) ?? p.item,
      }));
      if (placed.length > 0) {
        m.items = placed;
      }
    }
    return m;
  });
  return worldSeedSchema.parse({
    maps,
    startPoint: { map: "x1000y992", x: 6, y: 4 },
    fallbackPoint: { map: "x1000y992", x: 5, y: 5 },
    jailPoint: { map: "x0y0", x: 4, y: 4 },
    bellMap: "x999y999",
  });
}

/** The Classic items' keys, from `content/items.json`. */
export function classicItemKeys(): string[] {
  const items = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "content", "items.json"), "utf8"),
  ) as { items: { name: string }[] };
  return items.items.map((i) => i.name);
}

/** The seed as `content/world.json` holds it. */
export function renderWorldSource(world: WorldSeed): string {
  return `${JSON.stringify(world, null, 2)}\n`;
}

if (import.meta.main) {
  if (!existsSync(FSO_DAT)) {
    console.error(`data:import-fso: no 1.6 reference copy at ${FSO_DAT}`);
    process.exit(1);
  }
  const world = importFsoWorld(FSO_DAT);
  writeFileSync(CLASSIC_WORLD_SOURCE, renderWorldSource(world));
  console.log(
    `data:import-fso: wrote ${world.maps.length} maps to content/world.json; run bun run data:build`,
  );
}
