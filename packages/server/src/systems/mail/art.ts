/**
 * Paintings and photos on the server.
 *
 * 1.6's client wrote whatever it liked to the art folder and needed no canvas or film to do it.
 * Here the server credits: Use Canvas consumes it and holds a *canvas*, Use Film consumes it and
 * holds a *film*; a save spends the matching one. The server never paints; it stores the finished
 * 64×64 PNG the client sends, after a structural check.
 */
import {
  ART_TEXT,
  artBagFull,
  artRef,
  CHAT_COLOR,
  equipped,
  invAdd,
  lingoEq,
  type Rng,
} from "@secondstaronline/shared";

import type { Outgoing, Player } from "../world/world.ts";
import { isPng64 } from "./upload-check.ts";

/** What the art handlers read and write; wired to `persistence/art.ts` in `game.ts`. */
export interface ArtStore {
  load(id: number): { author: string; png: Uint8Array } | null;
  /** Stores an image under a fresh id and returns it. */
  add(kind: "painting" | "photo", author: string, png: Uint8Array): number;
}

export interface ArtDeps {
  /** Setting `artBytesMax`. */
  artBytesMax: number;
  rng: Rng;
}

/** The item-action pause after Use Film's shared tail. */
const FILM_PAUSE = 425;

const chat = (to: Player, text: string): Outgoing => ({
  to: to.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/** The bag's item names as the bag test reads them. */
export const bagNames = (p: Player): string[] => p.char.bag.map((l) => l?.item ?? "");

export interface ArtUse {
  /** One unit of the used item is consumed. */
  consume: boolean;
  out: Outgoing[];
}

/**
 * Use on a Canvas. A held canvas (a cancelled screen) reopens for free; otherwise the Canvas is
 * consumed and held. Both lock the keys and set no pause.
 */
export function useCanvas(p: Player): ArtUse {
  const reopen = p.canvas;
  p.canvas = true;
  p.keyLock = true;
  p.artUi = "paint";
  return { consume: !reopen, out: [{ to: p.id, msg: { t: "paint", reopen } }] };
}

/**
 * Use on a Film: no camera in the right hand (exact name) is refused; else the film is consumed and
 * held (a second Film while one is held is still consumed), the lens appears and Use's tail sets
 * the 425-frame pause. No lock.
 */
export function useFilm(p: Player): ArtUse {
  if (!lingoEq(equipped(p.char.equip, "RightHand"), "Camera")) {
    return { consume: false, out: [chat(p, ART_TEXT.needCamera)] };
  }
  p.film = true;
  p.itemPause = FILM_PAUSE;
  return { consume: true, out: [{ to: p.id, msg: { t: "lens" } }] };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * The viewer for the item `name`, used from the bag (`via` "bag") or clicked on the ground (the
 * click clears the pause). The id is read from the item, never typed (1.6's viewer read any path it
 * was sent); an unknown id opens the viewer with no author and no picture.
 */
export function viewArt(
  p: Player,
  name: string,
  store: ArtStore,
  via: "bag" | "click",
): Outgoing[] {
  const ref = artRef(name);
  if (!ref) {
    return [];
  }
  const line =
    ref.kind === "photo" ? ART_TEXT.viewPhoto : ART_TEXT.viewItem(name.split("#")[0] ?? name);
  p.keyLock = true;
  p.artUi = "view";
  if (via === "click") {
    p.itemPause = 0;
  }
  const id = /^\d{1,9}$/.test(ref.id) ? Number(ref.id) : 0;
  const row = id > 0 ? store.load(id) : null;
  return [
    chat(p, line),
    {
      to: p.id,
      msg: { t: "art", author: row?.author ?? "", png: row ? b64(row.png) : null },
    },
  ];
}

/**
 * Saving a painting or photo: needs the matching credit (1.6 needed none); a full bag refuses with
 * the credit kept; a PNG that fails the check is dropped silently. Otherwise the art is stored
 * under the player's name, the credit is spent, the keys unlock (after a photo too) and the item
 * arrives.
 */
export function artSaveIntent(
  p: Player,
  kind: "painting" | "photo",
  png: string,
  store: ArtStore,
  deps: ArtDeps,
): Outgoing[] {
  if (kind === "painting" ? !p.canvas : !p.film) {
    return [];
  }
  if (artBagFull(bagNames(p))) {
    return [chat(p, kind === "painting" ? ART_TEXT.paintFull : ART_TEXT.photoFull)];
  }
  const bytes = new Uint8Array(Buffer.from(png, "base64"));
  if (!isPng64(bytes, deps.artBytesMax)) {
    return [];
  }
  const id = store.add(kind, p.name, bytes);
  if (kind === "painting") {
    p.canvas = false;
  } else {
    p.film = false;
  }
  p.keyLock = false;
  p.artUi = null;
  invAdd(p.char, `${kind === "painting" ? "Painting" : "Photo"}#${id}`, 1, deps.rng);
  p.invDirty = true;
  return [{ to: p.id, msg: { t: "artSaved", kind } }];
}

/** Cancel: hides the screen and unlocks; the canvas stays held. */
export function paintUiIntent(p: Player): void {
  if (p.artUi !== "paint") {
    return;
  }
  p.keyLock = false;
  p.artUi = null;
}

/** The viewer's close, any mouseUp. */
export function viewCloseIntent(p: Player): void {
  if (p.artUi !== "view") {
    return;
  }
  p.keyLock = false;
  p.artUi = null;
}
