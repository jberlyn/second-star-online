/**
 * Newspapers on the server.
 *
 * One newspaper per immortal author (1.6's save had no check, so anyone could write one). Reading
 * is by the stand clicked or faced: the server reads the author from the item's name, never from a
 * typed name.
 */
import { CHAT_COLOR, NEWS_TEXT, newspaperAuthor } from "@secondstaronline/shared";

import type { Outgoing, Player } from "../world/world.ts";
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
const READ_PAUSE = 20;

const blank = (n: number) => Array.from({ length: n }, () => "");

/**
 * Reads the stand `name`: "You view the newspaper", the 20-frame pause, then the author's file
 * (blank with none) and each photo id's PNG when it is all digits and stored (any other slot stays
 * hidden). No lock, no distance test.
 */
export function readNewspaper(
  p: Player,
  name: string,
  news: NewspaperStore,
  art: ArtStore,
): Outgoing[] {
  p.itemPause = READ_PAUSE;
  const f = news.load(newspaperAuthor(name));
  const photos = (f?.photos ?? blank(3)).map((id) => {
    if (!/^\d{1,9}$/.test(id)) {
      return null;
    }
    const row = art.load(Number(id));
    return row ? Buffer.from(row.png).toString("base64") : null;
  });
  return [
    { to: p.id, msg: { t: "chat", text: NEWS_TEXT.view, color: CHAT_COLOR.normal } },
    { to: p.id, msg: { t: "newspaper", texts: f?.texts ?? blank(6), photos } },
  ];
}

/** The newspaper editor's load: immortal only; blank with no paper. */
export function newspaperLoadIntent(p: Player, news: NewspaperStore): Outgoing[] {
  if (p.role !== "immortal") {
    return [];
  }
  const f = news.load(p.name);
  return [
    {
      to: p.id,
      msg: { t: "newspaperEdit", photos: f?.photos ?? blank(3), texts: f?.texts ?? blank(6) },
    },
  ];
}

/** SAVE PAPER: immortal only; no reply. Written to the sender's own paper. */
export function newspaperSaveIntent(
  p: Player,
  f: NewspaperFields,
  news: NewspaperStore,
): Outgoing[] {
  if (p.role !== "immortal") {
    return [];
  }
  news.save(p.name, f);
  return [];
}
