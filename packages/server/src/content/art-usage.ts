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
  compileDefinitions,
  fxFramesOf,
  fxRuns,
  fxUsersText,
  missingFrames,
  newSoundGaps,
  removedTileCodes,
  soundUsersText,
  soundUses,
  type TileRow,
  tileRefs,
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
export function usedArt(raw: ContentData): {
  sprites: Record<AtlasGroup, Map<string, string>>;
  sounds: Map<string, string>;
} {
  // A defined item's slot is its definition's (issue #30), so read the compiled tables.
  const data = compileDefinitions(raw);
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
  // A parked vehicle's picture (issue #44).
  for (const v of data.houses.vehicles ?? []) {
    note(sprites.items, v.picture, `the ${v.name}`);
  }
  // A house type's uploaded placement preview (issue #10).
  for (const t of data.houses.types) {
    note(sprites.items, t.ghost.picture, `the ${t.house}'s placement preview`);
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
  // Spell runs and their trails, gathering's sprinkle, the casino's, and the engine's own runs
  // while their mechanic is in the content (issue #29, stage 5).
  for (const use of fxRuns(data).values()) {
    if (use.needs === 0) {
      continue;
    }
    note(sprites.fx, use.member, use.users[0] ?? "");
    if (use.trail > 0) {
      // Its trail, drawn as `x<member>-<n>`.
      note(sprites.fx, `x${use.member}`, use.users[0] ?? "");
    }
  }
  for (const tile of data.tiles.catalogue) {
    note(sprites.tiles, tile.code, `tile ${tile.code}`);
  }
  // Spell runs, gathering, swings, the casino, and the sounds the engine plays by name (issue #29,
  // stage 7): every user is listed, so a removal names them all.
  for (const [k, use] of soundUses(data)) {
    sounds.set(k, soundUsersText(use));
  }
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
 * Sounds the change newly makes content play that nothing will supply (issue #29, stage 7): no
 * pack has the sound and no upload will. A gap the published content already had is left alone,
 * and a sound that was supplied and is taken away is `lostArtProblems`'s to report.
 */
export function newSoundProblems(
  next: ContentData,
  published: ContentData,
  packs: ArtKeys,
  before: ArtKeys,
  after: ArtKeys,
): ContentProblem[] {
  // A sound that was supplied and is taken away is `lostArtProblems`'s to report, once.
  const supplied = new Set([...packs.sounds, ...before.sounds, ...after.sounds]);
  return newSoundGaps(next, published, supplied).map((g) => ({
    where: "art/sounds",
    message: `the sound ${g.name} has no file, so ${g.users.join(", ")} would be silent`,
  }));
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

const DIRS = ["n", "e", "s", "w"] as const;

/**
 * Vehicles the change adds or redraws that nothing will draw (issue #44): a parked picture no pack
 * or upload has, or a rider body without its four walking frames in each direction. A cannon's
 * firing frames are optional (an uploaded body holds only walking frames): a rider with none
 * shows its standing frame while it fires. A vehicle the published content already drew as it is
 * now is left alone. `packs` is every pack's art, an incoming pack's included; `after` the
 * uploads (empty with no upload library).
 */
export function newVehicleArtGaps(
  next: ContentData,
  published: ContentData,
  packs: ArtKeys,
  after: ArtKeys,
): ContentProblem[] {
  const has = (group: AtlasGroup, key: string) =>
    packs.sprites[group].has(key) || after.sprites[group].has(key);
  const out: ContentProblem[] = [];
  for (const v of next.houses.vehicles ?? []) {
    const was = (published.houses.vehicles ?? []).find(
      (w) => w.name.toLowerCase() === v.name.toLowerCase(),
    );
    const where = `houses/vehicles/${v.name}`;
    if ((!was || was.picture !== v.picture) && !has("items", v.picture.toLowerCase())) {
      out.push({ where, message: `the parked picture ${v.picture} has no art` });
    }
    if (!was || was.rider !== v.rider) {
      const frames = [1, 2, 3, 4].flatMap((f) => DIRS.map((d) => `f${f}-${d}`));
      const missing = frames.filter((f) => !has("bodies", `${v.rider}-${f}`));
      if (missing.length > 0) {
        out.push({
          where,
          message: `the rider body ${v.rider} is missing ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""} (a rider walks in four directions)`,
        });
      }
    }
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
  const layers = wornLayers(compileDefinitions(data));
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

/**
 * Effect runs drawn short of the frames they show (issue #29, stage 5): an uploaded run with fewer
 * frames (or trail frames) than its spell row or the engine shows, which a pack's frames would
 * otherwise fill, and a run content newly names that nothing draws at all. A gap the published
 * content already had (the same run missing the same frames) is not reported: the change being
 * checked did not make it.
 */
export function newFxGaps(
  next: ContentData,
  published: ContentData,
  packs: ArtKeys,
): ContentProblem[] {
  const had = fxGaps(published, packs);
  return fxGaps(next, packs)
    .filter((g) => {
      const before = had.find((h) => h.key === g.key);
      // A gap is new when part of it was not missing before: fixing part of an old gap leaves
      // what remains of it alone.
      return (
        g.run.some((span) => !covered(span, before?.run ?? [])) ||
        g.trail.some((span) => !covered(span, before?.trail ?? []))
      );
    })
    .map((g) => g.problem);
}

/** A run of frame numbers, first to last. */
type Span = readonly [number, number];

/** Whether every frame of `span` is in one of `spans`. */
function covered(span: Span, spans: readonly Span[]): boolean {
  let from = span[0];
  for (const s of [...spans].sort((a, b) => a[0] - b[0])) {
    if (s[0] <= from && s[1] >= from) {
      from = s[1] + 1;
    }
    if (from > span[1]) {
      return true;
    }
  }
  return from > span[1];
}

/**
 * The frames 1 to `needs` that are not drawn, as spans: an upload of `uploaded` frames (the whole
 * run: a pack's frames never fill in after its last), else the pack's frames `have`. Bounded by the
 * frames there are, whatever `needs` is.
 */
function missingSpans(
  needs: number,
  uploaded: number | null,
  have: ReadonlySet<number> | undefined,
): Span[] {
  if (uploaded !== null) {
    return uploaded < needs ? [[uploaded + 1, needs]] : [];
  }
  const out: Span[] = [];
  const present = [...(have ?? [])].filter((n) => n >= 1 && n <= needs).sort((a, b) => a - b);
  let next = 1;
  for (const n of present) {
    if (n > next) {
      out.push([next, n - 1]);
    }
    next = n + 1;
  }
  if (next <= needs) {
    out.push([next, needs]);
  }
  return out;
}

function fxGaps(
  data: ContentData,
  packs: ArtKeys,
): { key: string; run: Span[]; trail: Span[]; problem: ContentProblem }[] {
  const packFrames = fxFramesOf(packs.sprites.fx);
  const out: { key: string; run: Span[]; trail: Span[]; problem: ContentProblem }[] = [];
  for (const use of fxRuns(data).values()) {
    // Spell runs: a spell's hits come from its frames' boxes, so a frame with no art is a frame
    // that cannot hit. And gathering runs (strikes and fishing's cast), whose name and length
    // content chooses, so a misspelt name or a short upload is told. The engine's own runs (and
    // the names content gives them, such as the slot machine's) are only pictures, and are what
    // the packs shipped.
    if ((use.spell === undefined && !use.gathering) || use.needs === 0) {
      continue;
    }
    const upload = data.art.fx.find((a) => a.name.toLowerCase() === use.member.toLowerCase());
    const key = use.member.toLowerCase();
    // (Frames that are unreadable or blank are the art checks' to report.)
    const run = missingSpans(use.needs, upload ? upload.frames.length : null, packFrames.get(key));
    const trail =
      use.trail > 0 && upload?.trail
        ? missingSpans(use.trail, upload.trail.length, packFrames.get(`x${key}`))
        : [];
    if (run.length === 0 && trail.length === 0) {
      continue;
    }
    out.push({
      key,
      run,
      trail,
      problem: {
        where: upload ? `art/fx/${upload.name}` : "art/fx",
        message: upload
          ? `${upload.name} is missing ${framesText(run, trail)}, which ${fxUsersText(use)} shows`
          : `the effect ${use.member} has no ${framesText(run, trail)}, so ${fxUsersText(use)} would show ${use.spell === undefined ? "" : "(and hit with) "}nothing there`,
      },
    });
  }
  return out;
}

/** Missing frames in words: "frames 3 to 30", "frame 2 and trail frames 1 to 4". */
function framesText(run: readonly Span[], trail: readonly Span[]): string {
  const parts: string[] = [];
  for (const [spans, word] of [
    [run, "frame"],
    [trail, "trail frame"],
  ] as const) {
    if (spans.length === 0) {
      continue;
    }
    const one = spans.length === 1 && spans[0]?.[0] === spans[0]?.[1];
    const text = spans.map(([a, b]) => (a === b ? String(a) : `${a} to ${b}`)).join(", ");
    parts.push(`${word}${one ? "" : "s"} ${text}`);
  }
  return parts.join(" and ");
}

/**
 * Tiles the change adds to the catalogue that nothing draws (issue #29, stage 6): no pack picture
 * and no upload, so a map painted with one would show a hole. A tile the published catalogue
 * already had is left alone (Classic's catalogue names a few codes it never drew).
 */
export function newTileGaps(
  next: ContentData,
  published: ContentData,
  packs: ArtKeys,
  after: ArtKeys,
): ContentProblem[] {
  const had = new Set(published.tiles.catalogue.map((t) => t.code.toLowerCase()));
  const drawn = new Set([...packs.sprites.tiles, ...after.sprites.tiles]);
  const out: ContentProblem[] = [];
  const told = new Set<string>();
  for (const t of next.tiles.catalogue) {
    const k = t.code.toLowerCase();
    if (had.has(k) || drawn.has(k) || told.has(k)) {
      continue;
    }
    told.add(k);
    out.push({ where: "tiles/catalogue", message: `tile ${t.code} has no picture` });
  }
  return out;
}

/**
 * Tiles the change takes out of the catalogue that content rows still name (issue #29, stage 6):
 * a gathering node, farming, a house, the blank map's defaults. Only codes this change removes.
 */
export function tileRefProblems(next: ContentData, published: ContentData): ContentProblem[] {
  const refs = tileRefs(next);
  const out: ContentProblem[] = [];
  for (const code of removedTileCodes(
    published.tiles.catalogue as TileRow[],
    next.tiles.catalogue as TileRow[],
  )) {
    const who = refs.get(code.toLowerCase());
    if (who && who.length > 0) {
      out.push({
        where: "tiles/catalogue",
        message: `tile ${code} is taken out but ${who.join(", ")} still ${who.length === 1 ? "names" : "name"} it`,
      });
    }
  }
  return out;
}

/**
 * An item that can be worn with nothing to draw (issue #30): no inventory picture (it could not be
 * shown in a bag or given with `/drop`) or no worn layer. Read from the compiled tables, so an item
 * worn only through its definition counts. Only a gap the published content did not already have:
 * the draft may hold the item while its art is set up, but a publish refuses it.
 */
export function newItemArtGaps(
  next: ContentData,
  published: ContentData,
  packs: ArtKeys,
  after: ArtKeys,
  before: ArtKeys,
): ContentProblem[] {
  const gaps = (data: ContentData, keys: ArtKeys): Map<string, ContentProblem> => {
    const c = compileDefinitions(data);
    // A worn layer's art is its frames (`<layer>-f1-s` …); a picture is its own key.
    const drawn = (group: AtlasGroup, key: string) => {
      const k = key.toLowerCase();
      return [...packs.sprites[group], ...keys.sprites[group]].some((s) => {
        const l = s.toLowerCase();
        return l === k || (group === "paperdoll" && l.startsWith(`${k}-`));
      });
    };
    const out = new Map<string, ContentProblem>();
    for (const item of c.items.items) {
      if (item.retired) {
        continue;
      }
      const worn = wornLayerOf(c.itemRules, item.name);
      if (worn === null) {
        continue;
      }
      // Nothing at all to draw: no picture in a bag (and so no `/drop`) and nothing worn. A
      // missing worn frame set alone is `wornSetProblems`'s, and an item may go without a picture
      // while its worn layer is set up.
      const icon = drawn("items", item.sprite ?? item.name);
      const layer = worn.layer === null || drawn("paperdoll", worn.layer);
      // A definition's "drawn as" names another item's worn picture: that picture must exist,
      // whatever the bag shows.
      const aliased = (data.items.definitions ?? []).some(
        (d) => d.paperdoll !== undefined && d.name.toLowerCase() === item.name.toLowerCase(),
      );
      if (aliased && worn.layer !== null && !layer) {
        out.set(`${item.name.toLowerCase()}|alias`, {
          where: `items/definitions/${item.name}/paperdoll`,
          message: `${item.name} is drawn as ${worn.layer} when worn, but ${worn.layer} has no worn frames: draw it as an item that has some`,
        });
      }
      if (!icon && !layer) {
        out.set(item.name.toLowerCase(), {
          where: `items/items/${item.name}`,
          message: `${item.name} is worn in the ${worn.slot} slot but has no picture and draws nothing worn: give it a picture before publishing`,
        });
      }
    }
    return out;
  };
  const had = gaps(published, before);
  return [...gaps(next, after)].filter(([k]) => !had.has(k)).map(([, p]) => p);
}
