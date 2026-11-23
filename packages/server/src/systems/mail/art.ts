/**
 * Paintings and photos on the server.
 *
 * 1.6's client wrote whatever it liked to the art folder and needed no canvas or film to do it.
 * Here Use Canvas and Use Film only open the screen or the lens; the save spends a Canvas or a Film
 * from the bag, so a cancelled picture or shot costs nothing (1.6 used the film up before the shot
 * and the canvas before a cancel, which then reopened for free). The server never paints; it
 * stores the finished 64×64 PNG the client sends, after a structural check.
 */
import {
  ART_TEXT,
  artBagFull,
  artRef,
  CHAT_COLOR,
  equipped,
  hasBehaviour,
  invAdd,
  invDelSlot,
  type Rng,
  standingInFront,
} from "@secondstaronline/shared";

import type { GroundItem, Outgoing, Player } from "../world/world.ts";
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
 * Use on a Canvas: the paint screen opens, the keys lock and no pause is set. Nothing is consumed:
 * the save spends the Canvas. A cancelled picture (`p.canvas` still set) reopens as it was.
 */
export function useCanvas(p: Player): ArtUse {
  const reopen = p.canvas;
  p.canvas = true;
  p.keyLock = true;
  p.artUi = "paint";
  return { consume: false, out: [{ to: p.id, msg: { t: "paint", reopen } }] };
}

/**
 * Use on a Film: no camera (the `camera` behaviour; Classic: the Camera) in the right hand is
 * refused; else the lens appears. No
 * lock and no pause: 1.6's 425-frame pause waited for the reply to the Film being spent, which SSO
 * defers to the save, so nothing would end it. Nothing is consumed: the photo's save spends the
 * Film.
 */
export function useFilm(p: Player): ArtUse {
  if (!hasBehaviour(equipped(p.char.equip, "RightHand"), "camera")) {
    return { consume: false, out: [chat(p, ART_TEXT.needCamera)] };
  }
  p.film = true;
  return { consume: false, out: [{ to: p.id, msg: { t: "lens" } }] };
}

/**
 * The bag line a save spends: a canvas or a film, by their behaviours (Classic: the Canvas, and
 * any name containing "Film").
 */
const spentSlot = (p: Player, kind: "painting" | "photo"): number =>
  p.char.bag.findIndex((l) => !!l && hasBehaviour(l.item, kind === "painting" ? "canvas" : "film"));

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * The viewer for the item `name`, used from the bag (`via` "bag") or clicked on the ground at `at`
 * (the click clears the pause). A ground click needs you standing still in front of it, facing it
 * (1.6 had no such test). The id is read from the item, never typed (1.6's viewer read any path it
 * was sent); an unknown id opens the viewer with no author and no picture.
 */
export function viewArt(
  p: Player,
  name: string,
  store: ArtStore,
  via: "bag" | "click",
  at?: Pick<GroundItem, "x" | "y">,
): Outgoing[] {
  const ref = artRef(name);
  if (!ref) {
    return [];
  }
  const shown = name.split("#")[0] ?? name;
  if (via === "click") {
    const inFront =
      !!at &&
      standingInFront({
        facing: p.facing,
        stepFrames: p.stepFrames,
        player: { x: p.x, y: p.y },
        item: at,
      });
    if (!inFront) {
      return [chat(p, ART_TEXT.notInFront(ref.kind === "photo" ? "photo" : shown))];
    }
  }
  const line = ref.kind === "photo" ? ART_TEXT.viewPhoto : ART_TEXT.viewItem(shown);
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
 * Saving a painting or photo: needs a used Canvas or Film (1.6 needed none) and one still in the
 * bag; a full bag refuses with both kept; a PNG that fails the check is dropped silently. Otherwise
 * the art is stored under the player's name, one Canvas or Film is taken from the bag, the keys
 * unlock (after a photo too) and the item arrives.
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
  const slot = spentSlot(p, kind);
  if (slot < 0) {
    return [];
  }
  const bytes = new Uint8Array(Buffer.from(png, "base64"));
  if (!isPng64(bytes, deps.artBytesMax)) {
    return [];
  }
  const id = store.add(kind, p.name, bytes);
  invDelSlot(p.char.bag, slot, 1);
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

/** Cancel: hides the screen and unlocks; the picture is kept for the next Canvas. */
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
