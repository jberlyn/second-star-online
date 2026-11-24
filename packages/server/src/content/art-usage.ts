/**
 * What content draws and plays, so a publish that takes away art still in use is refused (issue
 * #29): removing an upload a pack does not also supply would leave an item with no picture, a
 * monster invisible or a spell silent. Art is compared by what it draws: an item picture, a worn
 * layer, a body, an FX run, a tile or a sound; a worn layer, body or run is gone only when none of
 * its frames is left. Pure.
 */
import type { AtlasGroup } from "@secondstaronline/data";
import type { ContentData } from "@secondstaronline/shared";

import type { ArtKeys } from "./art.ts";
import type { ContentProblem } from "./validate.ts";

/** What a sprite key draws: a worn layer's, body's or FX run's frames all count as one. */
export function artEntity(group: AtlasGroup, key: string): string {
  if (group === "paperdoll" || group === "bodies") {
    return key.replace(/-f[1-4]-[nesw]$/, "");
  }
  if (group === "fx") {
    return key.replace(/-\d+$/, "");
  }
  return key;
}

/** Every picture and sound the content names, by what draws it, with who names it. */
export function usedArt(data: ContentData): {
  sprites: Record<AtlasGroup, Map<string, string>>;
  sounds: Map<string, string>;
} {
  const sprites: Record<AtlasGroup, Map<string, string>> = {
    tiles: new Map(),
    bodies: new Map(),
    paperdoll: new Map(),
    fx: new Map(),
    items: new Map(),
  };
  const sounds = new Map<string, string>();
  const note = (m: Map<string, string>, key: string | number | null | undefined, who: string) => {
    if (key === null || key === undefined || key === "") {
      return;
    }
    const k = String(key).toLowerCase();
    if (!m.has(k)) {
      m.set(k, who);
    }
  };
  for (const item of data.items.items) {
    note(sprites.items, item.sprite ?? item.name, `item ${item.name}`);
    // A worn item draws the layer of its name (`+N` dropped).
    note(sprites.paperdoll, item.name.split("+")[0]?.trimEnd(), `item ${item.name}`);
  }
  for (const row of data.itemRules.paperdoll.aliases) {
    note(sprites.paperdoll, row.becomes, "a paperdoll alias");
  }
  // The engine's own layers: the shadow, the bare body and feet, and each sex's heads.
  for (const layer of ["BIM", "DEFBOD", "Bare Feet"]) {
    note(sprites.paperdoll, layer, "every character");
  }
  for (const sex of data.classes.creation.sexes) {
    for (const head of sex.heads) {
      note(sprites.paperdoll, `Head${head}`, `the ${sex.label} heads`);
    }
  }
  for (const m of data.monsters.monsters) {
    note(sprites.bodies, m.body, `monster ${m.name}`);
  }
  note(sprites.bodies, data.monsters.generic.body, "the generic monster");
  const b = data.bindings.bodies;
  for (const row of b?.morph ?? []) {
    note(sprites.bodies, row.body, "the Morph bodies");
  }
  note(sprites.bodies, b?.tree, "the tree body");
  for (const [vehicle, body] of Object.entries(b?.riders ?? {})) {
    note(sprites.bodies, body as number, `the ${vehicle}`);
  }
  for (const spell of data.spells.spells) {
    for (const run of spell.fx) {
      note(sprites.fx, run.member, `spell ${spell.name}`);
      // Its trail, drawn as `x<member>-<n>` when there is one.
      note(sprites.fx, `x${run.member}`, `spell ${spell.name}`);
      for (const s of run.sounds) {
        note(sounds, s.name, `spell ${spell.name}`);
      }
    }
  }
  for (const tile of data.tiles.catalogue) {
    note(sprites.tiles, tile.code, `tile ${tile.code}`);
  }
  // Sounds elsewhere: gathering's hit and success sounds, swing sounds, the casino's.
  const walk = (v: unknown, who: string): void => {
    if (Array.isArray(v)) {
      for (const x of v) {
        walk(x, who);
      }
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (
        typeof o.name === "string" &&
        (typeof o.ch === "number" || typeof o.channels === "number")
      ) {
        note(sounds, o.name, who);
      }
      if (typeof o.sound === "string") {
        note(sounds, o.sound, who);
      }
      for (const x of Object.values(o)) {
        walk(x, who);
      }
    }
  };
  walk(data.gather, "gathering");
  walk(data.itemRules, "the item rules");
  walk(data.casino, "the casino");
  return { sprites, sounds };
}

const GROUP_NAMES: Record<AtlasGroup, string> = {
  items: "picture",
  paperdoll: "worn layer",
  bodies: "body",
  fx: "effect",
  tiles: "tile",
};

/**
 * The art a change takes away while content still uses it: what the packs and the published art
 * drew, less what the packs and the next art draw, that the next content names.
 */
export function lostArtProblems(
  next: ContentData,
  packs: ArtKeys,
  before: ArtKeys,
  after: ArtKeys,
): ContentProblem[] {
  const used = usedArt(next);
  const out: ContentProblem[] = [];
  for (const group of Object.keys(GROUP_NAMES) as AtlasGroup[]) {
    const drawn = (k: ArtKeys) =>
      new Set([...packs.sprites[group], ...k.sprites[group]].map((s) => artEntity(group, s)));
    const had = drawn(before);
    const has = drawn(after);
    for (const entity of [...had].sort()) {
      const who = used.sprites[group].get(entity);
      if (!has.has(entity) && who) {
        out.push({
          where: `art/${group}`,
          message: `removing the ${GROUP_NAMES[group]} ${entity} leaves ${who} with nothing to draw`,
        });
      }
    }
  }
  const heard = (k: ArtKeys) => new Set([...packs.sounds, ...k.sounds]);
  const had = heard(before);
  const has = heard(after);
  for (const name of [...had].sort()) {
    const who = used.sounds.get(name);
    if (!has.has(name) && who) {
      out.push({
        where: "art/sounds",
        message: `removing the sound ${name} leaves ${who} silent`,
      });
    }
  }
  return out;
}
