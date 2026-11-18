/**
 * The newspaper. Pure rules over the generated `socialData.newspaper`.
 */
import { socialData } from "@secondstaronline/data";

import { lingoEq, lingoWord } from "../core/lingo.ts";

const N = socialData.newspaper;

/** Every newspaper text, verbatim. */
export const NEWS_TEXT = {
  view: N.view.text,
  notInFront: N.notInFront.text,
  saved: N.saved.text,
  noStand: N.noStand.text,
} as const;

/** The editor's cast text before a reply fills it (item 3). */
export const NEWS_DEFAULTS = N.defaults;
/** The Kit's needed layer-1 tile. */
export const STAND_TILE = N.standTile.text;

/** The author of a stand, the part of the name before `'`; "Alice's Newspaper" → "Alice". */
export function newspaperAuthor(name: string): string {
  return name.split("'")[0] ?? "";
}

/** An item named "Newspaper Kit" becomes `<owner>'s Newspaper`. */
export function standName(owner: string): string {
  return `${owner}${N.suffix.text}`;
}

/** The Kit's tile test: the tile at column x and row y of layer 1 is `K2`. */
export function kitTileOk(layer1: readonly string[], x: number, y: number): boolean {
  const line = layer1[y - 1] ?? "";
  return lingoEq(lingoWord(line, x), STAND_TILE);
}
