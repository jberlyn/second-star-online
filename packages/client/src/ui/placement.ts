/**
 * House placement mode. A house deed's Use starts it (the server's `placing`); the ghost is sprite
 * 360, the deed's house art member, drawn opaque over everything (`locZ` 3000) at `(32·x + 15, 32·y
 * + 13)` plus its shift from the hovered tile of the playfield (sprite 110's mouse-within script).
 *
 * The ghost follows the mouse, a click on the playfield that no sprite takes builds (its
 * mouse-up), and leaving the playfield or clicking a bag slot cancels.
 * Refusals arrive as chat lines and leave placement on.
 */
import {
  ghostPicturePoint,
  ghostRect,
  houseType,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLAYFIELD_RECT,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";

export interface Ghost {
  house: string;
  /** The deed's bag slot. */
  slot: number;
  /** The hovered tile, or null before one. */
  tile: { x: number; y: number } | null;
  img: HTMLImageElement | null;
}

/** The tile under a playfield pixel (`(mouse − rect.left) div 32 + 1`). */
export function ghostTile(pt: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(MAP_WIDTH, Math.max(1, Math.floor(pt.x / 32) + 1)),
    y: Math.min(MAP_HEIGHT, Math.max(1, Math.floor(pt.y / 32) + 1)),
  };
}

/** Where the ghost's image goes on the playfield canvas (its stage rect less the playfield's). */
export function ghostTopLeft(g: Ghost): { x: number; y: number } | null {
  const t = houseType(g.house);
  if (!t || !g.tile) {
    return null;
  }
  const r = ghostRect(t, g.tile.x, g.tile.y);
  return { x: r.left - PLAYFIELD_RECT.left, y: r.top - PLAYFIELD_RECT.top };
}

/**
 * Draws the ghost: a house type's uploaded picture (`ghost.picture`, issue #10) from the items
 * atlas with its anchor on the footprint's top-left corner, else its `Houses` member.
 */
export function drawGhost(ctx: CanvasRenderingContext2D, g: Ghost | null, assets?: Assets): void {
  const t = g?.tile ? houseType(g.house) : null;
  if (g?.tile && t?.ghost.picture !== undefined) {
    if (assets) {
      const at = ghostPicturePoint(t, g.tile.x, g.tile.y);
      drawSprite(ctx, assets, "items", t.ghost.picture, at.x, at.y);
    }
    return;
  }
  const at = g?.img ? ghostTopLeft(g) : null;
  if (g?.img && at) {
    ctx.drawImage(g.img, at.x, at.y);
  }
}

export type PlaceAction = { kind: "build"; slot: number; x: number; y: number } | null;

/**
 * A playfield click in placement mode: a click that a sprite takes (`hit`) goes to that
 * sprite, as in 1.6; one on bare playfield builds at the tile.
 */
export function placementClick(
  g: Ghost | null,
  hit: boolean,
  pt: { x: number; y: number },
): PlaceAction {
  if (!g) {
    return null;
  }
  return hit ? null : { kind: "build", slot: g.slot, ...ghostTile(pt) };
}
