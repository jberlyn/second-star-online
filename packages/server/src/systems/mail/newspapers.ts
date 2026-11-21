/**
 * Newspapers on the server.
 *
 * One newspaper per character, written to the writer's own name (1.6's save took any name, and
 * only an immortal's client could open the editor, so a player's stand stayed blank). Reading is
 * by the stand clicked or faced, from the tile in front of it: the server reads the author from the
 * item's name, never from a typed name.
 */
import {
  ACTION_PAUSE,
  CHAT_COLOR,
  NEWS_TEXT,
  newspaperAuthor,
  standingInFront,
} from "@secondstaronline/shared";

import type { GroundItem, Outgoing, Player } from "../world/world.ts";
import type { ArtStore } from "./art.ts";

/** The nine fields: photo ids 1-3, then the six text fields. */
export interface NewspaperFields {
  photos: string[];
  texts: string[];
}

export interface NewspaperStore {
  load(author: string): NewspaperFields | null;
  save(author: string, f: NewspaperFields): void;
}

/** The click's and Ctrl's item-action pause for a newspaper. */
const READ_PAUSE = ACTION_PAUSE;

const blank = (n: number) => Array.from({ length: n }, () => "");

const chat = (to: Player, text: string): Outgoing => ({
  to: to.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/**
 * Reads the stand: the item-action pause; away from the tile in front of it, facing it, "You see the
 * newspaper, but…" (1.6 read from any distance); else "You view the newspaper", then the author's
 * file (blank with none) and each photo id's PNG when it is all digits and stored (any other slot
 * stays hidden). No lock.
 */
export function readNewspaper(
  p: Player,
  stand: Pick<GroundItem, "item" | "x" | "y">,
  news: NewspaperStore,
  art: ArtStore,
): Outgoing[] {
  p.itemPause = READ_PAUSE;
  const inFront = standingInFront({
    facing: p.facing,
    stepFrames: p.stepFrames,
    player: { x: p.x, y: p.y },
    item: { x: stand.x, y: stand.y },
  });
  if (!inFront) {
    return [chat(p, NEWS_TEXT.notInFront)];
  }
  const f = news.load(newspaperAuthor(stand.item));
  const photos = (f?.photos ?? blank(3)).map((id) => {
    if (!/^\d{1,9}$/.test(id)) {
      return null;
    }
    const row = art.load(Number(id));
    return row ? Buffer.from(row.png).toString("base64") : null;
  });
  return [
    chat(p, NEWS_TEXT.view),
    { to: p.id, msg: { t: "newspaper", texts: f?.texts ?? blank(6), photos } },
  ];
}

/** The newspaper editor's load: the player's own paper, blank with none. */
export function newspaperLoadIntent(p: Player, news: NewspaperStore): Outgoing[] {
  const f = news.load(p.name);
  return [
    {
      to: p.id,
      msg: { t: "newspaperEdit", photos: f?.photos ?? blank(3), texts: f?.texts ?? blank(6) },
    },
  ];
}

/**
 * SAVE PAPER: any player; no reply. Written to the sender's own paper, which their stand
 * (`<name>'s Newspaper`) shows.
 */
export function newspaperSaveIntent(
  p: Player,
  f: NewspaperFields,
  news: NewspaperStore,
): Outgoing[] {
  news.save(p.name, f);
  return [];
}
