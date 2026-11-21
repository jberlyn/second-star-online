/**
 * The playfield: the only canvas, 544×384 = 17×12 tiles.
 *
 * Draw order, as the original's map render builds it and the score stacks it:
 * 1. layer 1, copied with no transparency (so pure green shows as green): we fill green
 *    first and draw the keyed tiles over it, which looks the same;
 * 2. layer 4, the shadows, at `blendLevel 70` (70/255) with green keyed;
 * 3. layer 2 at full strength, green keyed;
 * 3a. ground items at locZ 12, their animated overlays at +12: under every
 *    character and monster;
 * 4. characters, ordered by vertical position plus 150; on a tie your own sprite (channel 112)
 *    is below the others; monsters at `locV + 140`, the kill puff 5 above its monster, floaties at
 *    `locV + 160`; spell FX at `locV + 200`, Portal and Diminish Hunger at `locV + 150`, each
 *    trail 1 above its FX;
 * 4a. Rays, Dragon Rock and DungeonAlpha at item locZ + 800, above the characters;
 * 5. layer 3 (sprite 108, locZ 902);
 * 5a. the fog (sprite 111, locZ 903), then Chimney at the same depth on a later channel;
 * 6. hit splats at `locV + 1000`, above layer 3.
 * `Exit` and `Exit2` sit at locZ −100, under the map: never drawn.
 *
 * The canvas is the playfield, so it clips FX and arrows as the viewport mask did.
 */
import {
  attackFrame,
  type BodyFrame,
  cannonFireFrame,
  clockFace,
  type Equipment,
  fxEffect,
  groundDrawOffset,
  groundLayer,
  groundMember,
  groundOverlay,
  groundPicture,
  groundPictureTopLeft,
  isShip,
  MAP_HEIGHT,
  MAP_WIDTH,
  type MapView,
  PALETTE_RGB,
  PAPERDOLL_REG,
  PAPERDOLL_SIZE,
  PLAYFIELD_RECT,
  paperdollLayers,
  showsClockFace,
  trailFrames,
  VEHICLE_BODY,
  vehicleOfBody,
  vehicleOfItem,
  walkFrame,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "./assets.ts";
import { drawFog, fogLayer } from "./fog.ts";
import {
  animObjFrame,
  lenOf,
  MONSTER_STEP_FRAMES,
  type Model,
  monsterPixel,
  walkerPixel,
} from "./model.ts";
import { drawGhost } from "./ui/placement.ts";

/** The floatie fields FX Txt1-7: Arial 12 bold (text-styles.jsonl). */
export const FLOATIE_FONT = "bold 12px Arial, Helvetica, sans-serif";

export const PLAYFIELD_W = MAP_WIDTH * 32;
export const PLAYFIELD_H = MAP_HEIGHT * 32;
/** Layer-4 shadows are blended at 70 of 255. */
export const SHADOW_ALPHA = 70 / 255;

export interface Playfield {
  canvas: HTMLCanvasElement;
  /** Re-renders the static layers for a new map; resolves when its sheets are drawn. */
  setMap(map: MapView): Promise<void>;
  draw(model: Model): void;
  /**
   * What a click at playfield pixel (x, y) lands on: a monster (channels 180-183, the highest slot
   * on top), else a player (112-157), else the newest ground item on the tile. 1.6 put ground items
   * before players, so a click on a player standing on an item took the item.
   */
  pick(model: Model, x: number, y: number): Pick | null;
  /**
   * Everything under the point, in the click's order: a monster or a player alone, or else the
   * ground items on the tile, newest first. The first is `pick`'s answer, and the one Ctrl takes
   * from the faced tile. The hover tip lists them.
   */
  pickAll(model: Model, x: number, y: number): Pick[];
}

export type Pick =
  | { kind: "monster"; slot: number; name: string }
  | { kind: "ground"; id: string }
  | { kind: "player"; id: string; name: string };

/**
 * The frame a body shows. A Boat or Battleship rides a slow swell, F1 to F4, each held
 * `SHIP_SWELL_TICKS` on the client's own counter, standing or sailing. A standing Airship rider
 * cycles F2, F3, F1 a tick (its propeller); everyone else, and an Airship mid-step, shows the walk
 * frame for their step length (an 8-frame step shows F1, F2, F3, F2).
 */
const RIDER_FRAMES = ["F2", "F3", "F1"] as const;
const SWELL_FRAMES = ["F1", "F2", "F3", "F4"] as const;
/** Ticks a ship holds each swell frame: 8 is 0.4 s, a full swell 1.6 s. */
export const SHIP_SWELL_TICKS = 8;
/** The swell frame on a tick, shared by riders and moored ships so boarding keeps the phase. */
export function swellFrame(tick: number): BodyFrame {
  return SWELL_FRAMES[Math.floor(tick / SHIP_SWELL_TICKS) % 4] ?? "F1";
}
/**
 * A parked Boat or Battleship bobs at its mooring: it draws as its rider's frame on the swell,
 * facing the way it was left (east, the docked picture on the same pixels, when unknown;
 * `packages/data/build/art/ships.ts`).
 */
export function mooredShipMember(
  name: string,
  facing: "N" | "S" | "E" | "W" | undefined,
  tick: number,
): string | null {
  const vehicle = vehicleOfItem(name);
  return isShip(vehicle) ? `${VEHICLE_BODY[vehicle]}-${swellFrame(tick)}-${facing ?? "E"}` : null;
}
export function bodyFrame(model: Model, body: number | null, frames: number): BodyFrame {
  const vehicle = vehicleOfBody(body);
  if (isShip(vehicle)) {
    return swellFrame(model.tick);
  }
  if (vehicle !== null && frames <= 0) {
    return RIDER_FRAMES[model.tick % 3] ?? "F2";
  }
  return walkFrame(frames, lenOf(body));
}

/** A Battleship rider's firing frame, `56-fire<n>-<dir>`. */
type FireFrame = `fire${1 | 2 | 3}`;

/**
 * The frame a character shows: a Battleship rider's firing frames while its shot's animation runs,
 * the attack frame while anyone else swings or casts, otherwise its body frame.
 */
export function shownFrame(
  model: Model,
  body: number | null,
  facing: "N" | "S" | "E" | "W",
  atkAnim: number,
  spellAnim: number,
  frames: number,
): BodyFrame | FireFrame {
  if (vehicleOfBody(body) === "Battleship") {
    return spellAnim > 0 ? `fire${cannonFireFrame(spellAnim)}` : bodyFrame(model, body, frames);
  }
  return atkAnim > 0 || spellAnim > 0 ? attackFrame(facing) : bodyFrame(model, body, frames);
}

function tileCode(rows: readonly string[], x: number, y: number): string {
  return (rows[y - 1] ?? "").trim().split(/\s+/)[x - 1] ?? "";
}

function layerCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = PLAYFIELD_W;
  c.height = PLAYFIELD_H;
  return c;
}

function drawLayer(ctx: CanvasRenderingContext2D, assets: Assets, rows: readonly string[]) {
  for (let y = 1; y <= MAP_HEIGHT; y++) {
    for (let x = 1; x <= MAP_WIDTH; x++) {
      const code = tileCode(rows, x, y);
      if (code) {
        drawSprite(ctx, assets, "tiles", code, (x - 1) * 32, (y - 1) * 32, true);
      }
    }
  }
}

export function createPlayfield(assets: Assets): Playfield {
  const canvas = layerCanvas();
  canvas.className = "playfield";
  canvas.setAttribute("aria-label", "Playfield");
  const ctx = canvas.getContext("2d");
  const base = layerCanvas();
  const top = layerCanvas();
  let fog: { layer: HTMLCanvasElement | null; blend: number } = { layer: null, blend: 0 };

  const drawCharacter = (
    c: CanvasRenderingContext2D,
    head: number,
    equip: Equipment | undefined,
    frame: BodyFrame,
    facing: "N" | "S" | "E" | "W",
    px: number,
    py: number,
  ) => {
    // The composite's registration point (25, 6) sits on the anchor; each layer is pasted
    // at the composite's top-left. A missing layer member is skipped.
    const left = px - PAPERDOLL_REG.x;
    const topY = py - PAPERDOLL_REG.y;
    for (const layer of paperdollLayers({ head, equip }, frame, facing)) {
      drawSprite(c, assets, "paperdoll", layer, left, topY, true);
    }
  };

  /** One cell of `setMap`'s drawing, in the same order (RenderMap). */
  const redrawCell = (map: MapView, x: number, y: number) => {
    const b = base.getContext("2d");
    const t = top.getContext("2d");
    if (!b || !t || x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
      return;
    }
    const px = (x - 1) * 32;
    const py = (y - 1) * 32;
    const cell = (c: CanvasRenderingContext2D, rows: readonly string[]) => {
      const code = tileCode(rows, x, y);
      if (code) {
        drawSprite(c, assets, "tiles", code, px, py, true);
      }
    };
    b.save();
    b.beginPath();
    b.rect(px, py, 32, 32);
    b.clip();
    b.globalAlpha = 1;
    b.fillStyle = "rgb(0,255,0)";
    b.fillRect(px, py, 32, 32);
    cell(b, map.layers[0]);
    b.globalAlpha = SHADOW_ALPHA;
    cell(b, map.layers[3]);
    b.globalAlpha = 1;
    cell(b, map.layers[1]);
    b.restore();
    t.save();
    t.beginPath();
    t.rect(px, py, 32, 32);
    t.clip();
    t.clearRect(px, py, 32, 32);
    cell(t, map.layers[2]);
    t.restore();
  };

  const playfield: Playfield = {
    canvas,
    async setMap(map) {
      await Promise.all([
        assets.loadGroup("tiles"),
        assets.loadGroup("paperdoll"),
        assets.loadGroup("bodies"),
        assets.loadGroup("fx"),
        assets.loadGroup("items"),
      ]);
      const b = base.getContext("2d");
      const t = top.getContext("2d");
      if (!b || !t) {
        return;
      }
      b.imageSmoothingEnabled = false;
      b.globalAlpha = 1;
      b.fillStyle = "rgb(0,255,0)";
      b.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
      drawLayer(b, assets, map.layers[0]);
      b.globalAlpha = SHADOW_ALPHA;
      drawLayer(b, assets, map.layers[3]);
      b.globalAlpha = 1;
      drawLayer(b, assets, map.layers[1]);
      t.clearRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
      drawLayer(t, assets, map.layers[2]);
      fog = { layer: await fogLayer(assets, map.fog), blend: map.fog.blend };
    },
    draw(model) {
      if (!ctx) {
        return;
      }
      // A changed tile redraws its cell of the static layers.
      for (const c of model.tileChanges.splice(0)) {
        if (model.map) {
          redrawCell(model.map, c.x, c.y);
        }
      }
      // The 27-frame death lock: the canvas keeps the black frame's picture.
      if (model.deathStage === "frozen") {
        return;
      }
      const black = model.deathStage === "black";
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
      if (!model.map) {
        return;
      }
      if (black) {
        // The death frame clears the map layers and the ground items; the rest draws as usual.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
      } else {
        ctx.drawImage(base, 0, 0);
      }
      // Ground items, oldest first (sprites 158-177 take the first free channel).
      const drawGround = (layer: ReturnType<typeof groundLayer>) => {
        if (black) {
          return;
        }
        for (const g of model.ground.values()) {
          if (groundLayer(g.name) !== layer) {
            continue;
          }
          const at = walkerPixel(g.x, g.y, "S", 0);
          const off = groundDrawOffset(g.name);
          const px = at.px + off.dx;
          const py = at.py + off.dy;
          const pic = groundPicture(g.name);
          const moored = mooredShipMember(g.name, g.facing, model.tick);
          if (moored) {
            drawSprite(ctx, assets, "bodies", moored, px, py);
          } else if (pic !== g.name) {
            // A custom picture is pasted into a 32×32 scratch member (reg 16, -2) at (1, 1),
            // ignoring the picture's own regpoint.
            const tl = groundPictureTopLeft(px, py);
            drawSprite(ctx, assets, "items", pic, tl.x, tl.y, true);
          } else if (model.minute !== null && showsClockFace(g.name)) {
            // A placed Clock shows the face for the server minute; before the first minute arrives
            // it keeps its own picture.
            drawSprite(ctx, assets, "items", clockFace(model.minute), px, py);
          } else {
            drawSprite(ctx, assets, "items", groundMember(g.name), px, py);
          }
          const overlay = groundOverlay(g.name);
          if (overlay) {
            // Frames 1-4 over a 13-frame cycle held 3, 3, 3, 4.
            const n = animObjFrame(model.tick);
            drawSprite(ctx, assets, "items", `${overlay}-${n}`, px, py);
          }
        }
      };
      drawGround("items");
      const sprites: { z: number; order: number; draw: () => void }[] = [];
      // Airship riders draw above the map's top layer (locZ over sprite 108).
      const riders: (() => void)[] = [];
      let order = 0;
      /**
       * A character: the paperdoll, or after a body change the `Chars` body member
       * `<body>-<frame>-<dir>`; the cast frame is the attack frame.
       */
      const character = (
        head: number,
        equip: Equipment | undefined,
        body: number | null,
        frame: BodyFrame | FireFrame,
        facing: "N" | "S" | "E" | "W",
        px: number,
        py: number,
      ) =>
        body === null
          ? drawCharacter(ctx, head, equip, frame as BodyFrame, facing, px, py)
          : drawSprite(ctx, assets, "bodies", `${body}-${frame}-${facing}`, px, py);
      const self = model.self;
      if (self) {
        const len = lenOf(self.body);
        const { px, py } = walkerPixel(self.x, self.y, self.facing, self.stepFrames, len);
        const frame = shownFrame(
          model,
          self.body,
          self.facing,
          self.timers.atkAnim,
          self.spellAnim,
          self.stepFrames,
        );
        const draw = () =>
          character(self.head, model.inv?.equip, self.body, frame, self.facing, px, py);
        if (vehicleOfBody(self.body)) {
          riders.push(draw);
        } else {
          sprites.push({ z: py, order: order++, draw });
        }
      }
      for (const p of model.peers.values()) {
        // Body 100 (Smoke Bomb) hides the sprite from everyone else.
        if (p.body === 100) {
          continue;
        }
        // A step always starts one tile behind the destination, toward its facing.
        const { px, py } = walkerPixel(p.x, p.y, p.facing, p.frames, lenOf(p.body));
        const frame = shownFrame(model, p.body, p.facing, p.atkAnim, p.spellAnim, p.frames);
        const draw = () => character(p.head, p.equip, p.body, frame, p.facing, px, py);
        if (vehicleOfBody(p.body)) {
          riders.push(draw);
        } else {
          sprites.push({ z: py, order: order++, draw });
        }
      }
      for (const fx of model.fx) {
        // A FX above the stage's top never steps and stays.
        const px = fx.h - PLAYFIELD_RECT.left;
        const py = fx.v - PLAYFIELD_RECT.top;
        const name = fxEffect(fx.name).toLowerCase();
        const z = name === "portal" || name === "diminish hunger" ? py : py + 50;
        sprites.push({
          z,
          order: order++,
          draw: () => drawSprite(ctx, assets, "fx", `${fx.name}-${fx.frame}`, px, py),
        });
        const trail = trailFrames(fx.name);
        if (trail !== undefined && fx.frame <= trail) {
          sprites.push({
            z: z + 1,
            order: order++,
            draw: () => drawSprite(ctx, assets, "fx", `x${fx.name}-${fx.frame}`, px, py),
          });
        }
      }
      for (const m of model.monsters.values()) {
        const { px, py } = monsterPixel(m);
        // The walk frames as the player's; F2 standing.
        const member = `${m.body}-${walkFrame(m.frames, MONSTER_STEP_FRAMES)}-${m.facing}`;
        sprites.push({
          z: py - 10,
          order: order++,
          draw: () => drawSprite(ctx, assets, "bodies", member, px, py),
        });
      }
      for (const e of model.effects) {
        if (e.kind === "kill") {
          sprites.push({
            z: e.py - 5,
            order: order++,
            draw: () => drawSprite(ctx, assets, "fx", `kill${e.age + 1}`, e.px, e.py),
          });
        }
      }
      for (const f of model.floaties) {
        sprites.push({
          z: f.py + 10,
          order: order++,
          draw: () => {
            ctx.font = FLOATIE_FONT;
            ctx.textBaseline = "top";
            ctx.fillStyle = PALETTE_RGB[f.color] ?? "#FFFFFF";
            ctx.fillText(f.text, f.px, f.py);
          },
        });
      }
      sprites.sort((a, b) => a.z - b.z || a.order - b.order);
      for (const s of sprites) {
        s.draw();
      }
      drawGround("overChars");
      if (!black) {
        ctx.drawImage(top, 0, 0);
      }
      drawFog(ctx, fog.layer, fog.blend);
      drawGround("overLayer3");
      for (const draw of riders) {
        draw();
      }
      for (const e of model.effects) {
        if (e.kind === "splat") {
          drawSprite(ctx, assets, "fx", `S${e.age + 1}h`, e.px, e.py);
        }
      }
      // The placement ghost, sprite 360 at locZ 3000.
      drawGhost(ctx, model.ghost);
      if (black) {
        // The picture stays until the respawn map is drawn.
        model.deathStage = "frozen";
      }
    },
    pick(model, x, y) {
      return playfield.pickAll(model, x, y)[0] ?? null;
    },
    pickAll(model, x, y) {
      const inRect = (group: "bodies" | "items", name: string, px: number, py: number) => {
        const s = assets.sprite(group, name);
        if (!s) {
          return false;
        }
        const [, , , w, h, rx, ry] = s;
        return x >= px - rx && x < px - rx + w && y >= py - ry && y < py - ry + h;
      };
      const monsters = [...model.monsters.values()].sort((a, b) => b.slot - a.slot);
      for (const m of monsters) {
        const { px, py } = monsterPixel(m);
        const member = `${m.body}-${walkFrame(m.frames, MONSTER_STEP_FRAMES)}-${m.facing}`;
        if (inRect("bodies", member, px, py)) {
          return [{ kind: "monster", slot: m.slot, name: m.name }];
        }
      }
      // A character is the 46×45 composite at its registration point (PAPERDOLL_SIZE).
      const onChar = (px: number, py: number) =>
        x >= px - PAPERDOLL_REG.x &&
        x < px - PAPERDOLL_REG.x + PAPERDOLL_SIZE.w &&
        y >= py - PAPERDOLL_REG.y &&
        y < py - PAPERDOLL_REG.y + PAPERDOLL_SIZE.h;
      // A changed body is clicked by its `Chars` member's rect; an invisible sprite (body 100)
      // takes no click.
      const onWalker = (
        body: number | null,
        frames: number,
        facing: "N" | "S" | "E" | "W",
        px: number,
        py: number,
      ) =>
        body === null
          ? onChar(px, py)
          : inRect("bodies", `${body}-${bodyFrame(model, body, frames)}-${facing}`, px, py);
      for (const p of [...model.peers.values()].reverse()) {
        if (p.body === 100) {
          continue;
        }
        const { px, py } = walkerPixel(p.x, p.y, p.facing, p.frames, lenOf(p.body));
        if (onWalker(p.body, p.frames, p.facing, px, py)) {
          return [{ kind: "player", id: p.id, name: p.name }];
        }
      }
      const me = model.self;
      if (me) {
        const { px, py } = walkerPixel(me.x, me.y, me.facing, me.stepFrames, lenOf(me.body));
        if (onWalker(me.body, me.stepFrames, me.facing, px, py)) {
          return [{ kind: "player", id: me.id, name: me.name }];
        }
      }
      const tx = Math.floor(x / 32) + 1;
      const ty = Math.floor(y / 32) + 1;
      // An exit lies under the map, where no click reaches it.
      return [...model.ground.values()]
        .filter((g) => g.x === tx && g.y === ty && groundLayer(g.name) !== "hidden")
        .reverse()
        .map((g) => ({ kind: "ground", id: g.id }));
    },
  };
  return playfield;
}
