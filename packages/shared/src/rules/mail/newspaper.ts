/**
 * The newspaper. Pure rules over the content store's `social.newspaper`.
 */
import { type ContentStore, onContent } from "../../content/store.ts";
import { lingoContains, lingoEq, lingoWord } from "../core/lingo.ts";

let N: ContentStore["social"]["newspaper"];

/** Every newspaper text, verbatim. */
const newsTextOf = () =>
  ({
    view: N.view.text,
    notInFront: N.notInFront.text,
    saved: N.saved.text,
    noStand: N.noStand.text,
  }) as const;
export let NEWS_TEXT: ReturnType<typeof newsTextOf>;

/** The editor's cast text before a reply fills it (item 3). */
export let NEWS_DEFAULTS: typeof N.defaults;
/** The Kit's needed layer-1 tile. */
export let STAND_TILE: typeof N.standTile.text;

/** The author of a stand, the part of the name before `'`; "Alice's Newspaper" → "Alice". */
export function newspaperAuthor(name: string): string {
  return name.split("'")[0] ?? "";
}

/** An item named "Newspaper Kit" becomes `<owner>'s Newspaper`. */
export function standName(owner: string): string {
  return `${owner}${N.suffix.text}`;
}

/** A newspaper stand: a name holding the stand suffix (`'s Newspaper`). */
export function isNewspaperStand(name: string): boolean {
  return lingoContains(name, N.suffix.text);
}

/** The Kit's tile test: the tile at column x and row y of layer 1 is `K2`. */
export function kitTileOk(layer1: readonly string[], x: number, y: number): boolean {
  const line = layer1[y - 1] ?? "";
  return lingoEq(lingoWord(line, x), STAND_TILE);
}

onContent((c) => {
  N = c.social.newspaper;
  NEWS_DEFAULTS = N.defaults;
  STAND_TILE = N.standTile.text;
  NEWS_TEXT = newsTextOf();
});
