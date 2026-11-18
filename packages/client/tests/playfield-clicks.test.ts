import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { NO_EQUIPMENT } from "@secondstaronline/shared";

import { hoverName } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import { createModel, type Model, type Peer, type Self, walkerPixel } from "../src/model.ts";
import { createPlayfield, type Pick } from "../src/playfield.ts";
import { type Ghost, ghostTile, ghostTopLeft, placementClick } from "../src/ui/placement.ts";

// Every sprite is 64×64 with its registration point in the middle.
const assets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => [0, 0, 0, 64, 64, 32, 32] as never,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
};

function world(): { model: Model; at: Record<string, { x: number; y: number }> } {
  const model = createModel();
  model.monsters.set(3, {
    slot: 3,
    name: "Slime",
    body: 66,
    x: 2,
    y: 2,
    facing: "S",
    frames: 0,
    fromX: 2,
    fromY: 2,
  });
  model.ground.set("g1", { id: "g1", name: "Apple", x: 6, y: 6 });
  const peer = (id: string, name: string, x: number, body = "NOTHING"): Peer => ({
    id,
    name,
    head: 1,
    x,
    y: 3,
    facing: "S",
    frames: 0,
    fromX: x,
    fromY: 3,
    atkAnim: 0,
    equip: { ...NO_EQUIPMENT, body },
    body: null,
    spellAnim: 0,
  });
  model.peers.set("ann", peer("ann", "Ann", 9));
  model.peers.set("ghost", peer("ghost", "Ghost", 13, "Robe of Invisibility"));
  model.self = { id: "me", name: "Me", head: 1, x: 15, y: 10, facing: "S", stepFrames: 0 } as Self;
  const px = (x: number, y: number) => {
    const p = walkerPixel(x, y, "S", 0);
    return { x: p.px, y: p.py + 10 }; // inside the 46×45 character (reg 25, 6)
  };
  return {
    model,
    at: {
      monster: px(2, 2),
      ground: { x: 5 * 32 + 16, y: 5 * 32 + 16 },
      player: px(9, 3),
      ghost: px(13, 3),
      self: px(15, 10),
    },
  };
}

const pick = (where: "monster" | "ground" | "player" | "ghost" | "self"): Pick | null => {
  const { model, at } = world();
  const p = at[where] as { x: number; y: number };
  return createPlayfield(assets).pick(model, p.x, p.y);
};

describe("playfield clicks", () => {
  test("monster: the monster click script on channels 180-183", () => {
    expect(pick("monster")).toEqual({ kind: "monster", slot: 3, name: "Slime" });
  });
  test("ground: the item-click script on channels 158-177", () => {
    expect(pick("ground")).toEqual({ kind: "ground", id: "g1" });
  });
  test("player: the player-click script on channels 115-157", () => {
    expect(pick("player")).toMatchObject({ kind: "player", id: "ann" });
  });
  test("self: the click on channel 112 opens the same menu with your name", () => {
    expect(pick("self")).toMatchObject({ kind: "player", id: "me" });
  });

  test("hover: monsters, players and yourself show a name; ground items none", () => {
    const { model } = world();
    const name = (where: "monster" | "ground" | "player" | "ghost" | "self") => {
      const hit = pick(where);
      return hit ? hoverName(model, hit) : undefined;
    };
    expect(name("monster")).toBe("Slime");
    expect(name("player")).toBe("Ann");
    expect(name("self")).toBe("Me");
    expect(name("ground")).toBeNull();
  });
  test('hover: a player in an "Invis" body shows ???', () => {
    const { model } = world();
    const hit = pick("ghost");
    expect(hit).toMatchObject({ kind: "player", id: "ghost" });
    expect(hit && hoverName(model, hit)).toBe("???");
  });

  test("house: a click no sprite takes builds at the hovered tile; a sprite's click goes to it", () => {
    const g: Ghost = { house: "Small House", slot: 3, tile: null, img: null };
    expect(placementClick(g, false, { x: 9 * 32 + 5, y: 3 * 32 + 30 })).toEqual({
      kind: "build",
      slot: 3,
      x: 10,
      y: 4,
    });
    expect(placementClick(g, true, { x: 10, y: 10 })).toBeNull();
    expect(placementClick(null, false, { x: 10, y: 10 })).toBeNull();
  });
  test("house: the hovered tile is the one under the pointer, clamped to the map", () => {
    expect(ghostTile({ x: 600, y: 500 })).toEqual({ x: 17, y: 12 });
  });
  test("house: the ghost's top-left on the playfield canvas is its stage rect less (30, 31)", () => {
    expect(
      ghostTopLeft({ house: "Small House", slot: 1, tile: { x: 5, y: 5 }, img: null }),
    ).toEqual({
      x: 97,
      y: 94,
    });
    // Bug fixed: the Small Farm's ghost sits one row up, level with every other house.
    expect(ghostTopLeft({ house: "Small Farm", slot: 1, tile: { x: 5, y: 5 }, img: null })).toEqual(
      {
        x: 97,
        y: 94,
      },
    );
  });
});
