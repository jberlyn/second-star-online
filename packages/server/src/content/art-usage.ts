/**
 * What content draws and plays, so a publish that takes away art still in use is refused (issue
 * #29): removing an upload a pack does not also supply would leave an item with no picture, a
 * monster invisible or a spell silent. Art is compared by what it draws: an item picture, a worn
 * layer, a body, an FX run, a tile or a sound; a worn layer, body or run is gone only when none of
 * its frames is left. Pure.
 */
import type { AtlasGroup } from "@secondstaronline/data";
import {
  bodyNumbersOf,
  bodyUsersText,
  bodyUses,
  type ContentData,
  CURRENCY_PILES,
  missingFrames,
  wornByText,
  wornLayerOf,
  wornLayers,
} from "@secondstaronline/shared";

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
    // A worn item draws its slot's layer: its key after the aliases (none for an alias to
    // NOTHING, or an item never worn).
    note(sprites.paperdoll, wornLayerOf(data.itemRules, item.name)?.layer, `item ${item.name}`);
  }
  // The engine's currency piles, drawn for a pile of the currency whatever it is called.
  for (const pile of CURRENCY_PILES) {
    note(sprites.items, pile.name, "the currency's piles");
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
  // Monsters, the generic monster, the Morph bodies, the tree and the riders (issue #29, stage 4).
  for (const use of bodyUses(data).values()) {
    note(sprites.bodies, use.body, use.users[0] ?? "");
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

/**
 * Bodies the change newly names that nothing will draw (issue #29, stage 4): a monster given a
 * body whose upload is taken out before it was ever published, or a number with no art at all.
 * What the published content already named without art (Minimal's generic monster) is left
 * alone, and a body that was drawn and is taken away is `lostArtProblems`'s to report.
 */
export function newBodyGaps(
  next: ContentData,
  published: ContentData,
  packs: ArtKeys,
  before: ArtKeys,
  after: ArtKeys,
): ContentProblem[] {
  const drawn = (k: ArtKeys) => bodyNumbersOf([...packs.sprites.bodies, ...k.sprites.bodies]);
  const had = drawn(before);
  const has = drawn(after);
  const named = bodyUses(published);
  const out: ContentProblem[] = [];
  for (const use of bodyUses(next).values()) {
    if (has.has(use.body) || had.has(use.body) || named.has(use.body)) {
      continue;
    }
    out.push({
      where: "art/bodies",
      message: `body ${use.body} has no picture, so ${bodyUsersText(use)} would draw nothing`,
    });
  }
  return out;
}

/**
 * Uploaded worn layers missing frames their wearers need (issue #29, stage 3): a character would
 * show nothing for that piece of gear on those frames. Only the uploads are checked; a pack's own
 * layers are what the pack shipped. A gap `before` already had (the same layer missing the same
 * frames) is not reported: the change being checked did not make it.
 */
export function wornSetProblems(data: ContentData, before?: ContentData): ContentProblem[] {
  const had = new Set(
    before ? wornGaps(before).flatMap((g) => g.missing.map((f) => `${g.key}:${f}`)) : [],
  );
  // A gap is new when one of its frames was not missing before: fixing part of an old gap leaves
  // what remains of it alone.
  return wornGaps(data)
    .filter((g) => g.missing.some((f) => !had.has(`${g.key}:${f}`)))
    .map((g) => g.problem);
}

function wornGaps(
  data: ContentData,
): { key: string; missing: string[]; problem: ContentProblem }[] {
  const layers = wornLayers(data);
  const out: { key: string; missing: string[]; problem: ContentProblem }[] = [];
  for (const row of data.art.paperdoll) {
    const use = layers.get(row.name.toLowerCase());
    const missing = missingFrames(row, use);
    if (missing.length > 0) {
      const many = use !== undefined && use.engine.length + use.wornBy.length > 1;
      out.push({
        key: row.name.toLowerCase(),
        missing,
        problem: {
          where: `art/paperdoll/${row.name}`,
          message: `${row.name} is missing ${missing.join(", ")}, which ${wornByText(use)} draw${many ? "" : "s"}`,
        },
      });
    }
  }
  return out;
}
