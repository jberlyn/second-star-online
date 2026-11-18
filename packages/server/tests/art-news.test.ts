/**
 * Sim tests: paintings, photos and newspapers on the server.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ServerMsg } from "@secondstaronline/shared";

import {
  actionIntent,
  dropIntent,
  type ItemCtx,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import {
  type ArtDeps,
  type ArtStore,
  artSaveIntent,
  paintUiIntent,
  viewCloseIntent,
} from "../src/systems/mail/art.ts";
import {
  type NewspaperFields,
  type NewspaperStore,
  newspaperLoadIntent,
  newspaperSaveIntent,
} from "../src/systems/mail/newspapers.ts";
import { isPng64 } from "../src/systems/mail/upload-check.ts";
import {
  addPlayer,
  createWorld,
  type GroundItem,
  type Player,
  type Room,
  sessionCombatState,
  type World,
} from "../src/systems/world/world.ts";
import { b64, makePng } from "./helpers/png.ts";
import { player, rngByN, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const of = (msgs: Out, to: string, t: ServerMsg["t"]) =>
  msgs.filter((m) => m.to === to && m.msg.t === t).map((m) => m.msg);

const PNG = makePng();
const PNG_B64 = b64(PNG);

function scene(layer1?: (x: number, y: number) => string) {
  const map = testMap("x1000y992", [], layer1);
  const world: World = createWorld();
  const arts = new Map<number, { author: string; png: Uint8Array }>();
  let next = 100;
  const art: ArtStore = {
    load: (id) => arts.get(id) ?? null,
    add: (_kind, author, png) => {
      arts.set(++next, { author, png });
      return next;
    },
  };
  const papers = new Map<string, NewspaperFields>();
  const newspapers: NewspaperStore = {
    load: (a) => papers.get(a.toLowerCase()) ?? null,
    save: (a, f) => void papers.set(a.toLowerCase(), f),
  };
  const rng = rngByN();
  const deps: ArtDeps = { artBytesMax: 16_384, rng };
  const join = (
    name: string,
    x = 5,
    y = 6,
    facing: Player["facing"] = "N",
    role: Player["role"] = "player",
  ) => {
    const p = player(name, map, x, y);
    p.facing = facing;
    p.role = role;
    addPlayer(world, p);
    p.loading = 0;
    return p;
  };
  const room = (): Room => world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000, art, newspapers });
  const put = (id: string, item: string, x: number, y: number): GroundItem => {
    const g: GroundItem = { id, item, x, y, kind: "drop", expiresAt: null };
    map.ground.push(g);
    return g;
  };
  const give = (p: Player, item: string, slot = 0) => {
    p.char.bag[slot] = { item, qty: 1 };
  };
  return { world, art, arts, newspapers, papers, deps, join, room, ctx, put, give, map };
}

describe("Canvas", () => {
  test("Use consumes the Canvas, holds it and opens the paint screen under the lock", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Canvas");
    const out = useIntent(s.ctx(), s.room(), a, 1);
    expect(of(out, "Alice", "paint")).toEqual([{ t: "paint", reopen: false }]);
    expect(a.char.bag[0]).toBeNull();
    expect(a.canvas).toBe(true);
    expect(a.keyLock).toBe(true);
    expect(a.artUi).toBe("paint");
    expect(a.itemPause).toBe(0);
  });
  test("kept bug: a cancelled canvas reopens without using another", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Canvas");
    useIntent(s.ctx(), s.room(), a, 1);
    paintUiIntent(a);
    expect(a.keyLock).toBe(false);
    expect(a.canvas).toBe(true);
    s.give(a, "Canvas", 1);
    const out = useIntent(s.ctx(), s.room(), a, 2);
    expect(of(out, "Alice", "paint")).toEqual([{ t: "paint", reopen: true }]);
    expect(a.char.bag[1]?.item).toBe("Canvas"); // not consumed
  });
  test("a save stores the art, spends the canvas, unlocks and adds Painting#<id>", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Canvas");
    useIntent(s.ctx(), s.room(), a, 1);
    const out = artSaveIntent(a, "painting", PNG_B64, s.art, s.deps);
    expect(of(out, "Alice", "artSaved")).toEqual([{ t: "artSaved", kind: "painting" }]);
    expect(a.canvas).toBe(false);
    expect(a.keyLock).toBe(false);
    expect(a.artUi).toBeNull();
    expect(a.char.bag.some((l) => l?.item === "Painting#101")).toBe(true);
    expect(s.arts.get(101)?.author).toBe("Alice");
  });
  test("divergence: a second save and a save with no canvas are ignored", () => {
    const s = scene();
    const a = s.join("Alice");
    expect(artSaveIntent(a, "painting", PNG_B64, s.art, s.deps)).toEqual([]);
    s.give(a, "Canvas");
    useIntent(s.ctx(), s.room(), a, 1);
    artSaveIntent(a, "painting", PNG_B64, s.art, s.deps);
    expect(artSaveIntent(a, "painting", PNG_B64, s.art, s.deps)).toEqual([]);
    expect(s.arts.size).toBe(1);
  });
  test("divergence: a full bag is refused with the line and the canvas kept", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Canvas");
    useIntent(s.ctx(), s.room(), a, 1);
    for (let i = 0; i < 15; i++) {
      s.give(a, `Thing${i}`, i);
    }
    const out = artSaveIntent(a, "painting", PNG_B64, s.art, s.deps);
    expect(chat(out, "Alice")).toEqual([
      "You are carrying too much to add a painting to your inventory.",
    ]);
    expect(a.canvas).toBe(true);
    expect(s.arts.size).toBe(0);
  });
  test("a bad or oversize PNG is dropped silently, the canvas kept", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Canvas");
    useIntent(s.ctx(), s.room(), a, 1);
    for (const bad of [
      "",
      "not a png",
      b64(makePng(32, 32)),
      b64(makePng(64, 64, { depth: 16 })),
      b64(makePng(64, 64, { interlace: 1 })),
      b64(PNG.subarray(0, PNG.length - 4)),
    ]) {
      expect(artSaveIntent(a, "painting", bad, s.art, s.deps)).toEqual([]);
    }
    expect(artSaveIntent(a, "painting", PNG_B64, s.art, { ...s.deps, artBytesMax: 100 })).toEqual(
      [],
    );
    expect(a.canvas).toBe(true);
    expect(s.arts.size).toBe(0);
  });
  test("RGBA PNGs pass the check; a corrupt CRC does not", () => {
    expect(isPng64(makePng(64, 64, { colour: 6 }), 16_384)).toBe(true);
    const bad = makePng();
    bad[40] = (bad[40] as number) ^ 0xff;
    expect(isPng64(bad, 16_384)).toBe(false);
  });
});

describe("Film and the camera", () => {
  test("no camera in the right hand: the line, the film kept", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Film");
    const out = useIntent(s.ctx(), s.room(), a, 1);
    expect(chat(out, "Alice")).toEqual(["You must equip a camera to take a picture!"]);
    expect(a.char.bag[0]?.item).toBe("Film");
    expect(a.film).toBe(false);
  });
  test("with a Camera ('camera' passes): the film is consumed, the lens appears, pause 425", () => {
    const s = scene();
    const a = s.join("Alice");
    a.char.equip.offHand = "camera";
    s.give(a, "Film");
    const out = useIntent(s.ctx(), s.room(), a, 1);
    expect(of(out, "Alice", "lens")).toEqual([{ t: "lens" }]);
    expect(a.char.bag[0]).toBeNull();
    expect(a.film).toBe(true);
    expect(a.keyLock).toBe(false);
    expect(a.itemPause).toBe(425);
  });
  test("a photo save adds Photo#<id> and OKPaint unlocks the keys too", () => {
    const s = scene();
    const a = s.join("Alice");
    a.char.equip.offHand = "Camera";
    s.give(a, "Film");
    useIntent(s.ctx(), s.room(), a, 1);
    a.keyLock = true;
    const out = artSaveIntent(a, "photo", PNG_B64, s.art, s.deps);
    expect(of(out, "Alice", "artSaved")).toEqual([{ t: "artSaved", kind: "photo" }]);
    expect(a.char.bag.some((l) => l?.item === "Photo#101")).toBe(true);
    expect(a.film).toBe(false);
    expect(a.keyLock).toBe(false);
    expect(artSaveIntent(a, "photo", PNG_B64, s.art, s.deps)).toEqual([]);
  });
  test("a second Film while one is held is still consumed, and the held film stays one", () => {
    const s = scene();
    const a = s.join("Alice");
    a.char.equip.offHand = "Camera";
    s.give(a, "Film");
    s.give(a, "Film", 1);
    useIntent(s.ctx(), s.room(), a, 1);
    a.itemPause = 0;
    useIntent(s.ctx(), s.room(), a, 2);
    expect(a.char.bag[1]).toBeNull();
    expect(artSaveIntent(a, "photo", PNG_B64, s.art, s.deps)).toHaveLength(1);
    expect(artSaveIntent(a, "photo", PNG_B64, s.art, s.deps)).toEqual([]);
  });
  test("a canvas credit does not pay for a photo, nor the reverse", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Canvas");
    useIntent(s.ctx(), s.room(), a, 1);
    expect(artSaveIntent(a, "photo", PNG_B64, s.art, s.deps)).toEqual([]);
  });
});

describe("viewing", () => {
  test("from the bag: the line names item 1, the keys lock, the art and author come back", () => {
    const s = scene();
    const a = s.join("Alice");
    s.arts.set(7, { author: "Bob", png: PNG });
    s.give(a, "Painting#7");
    const out = useIntent(s.ctx(), s.room(), a, 1);
    expect(chat(out, "Alice")).toEqual(["You view the Painting, please wait..."]);
    expect(of(out, "Alice", "art")).toEqual([{ t: "art", author: "Bob", png: PNG_B64 }]);
    expect(a.keyLock).toBe(true);
    expect(a.artUi).toBe("view");
    viewCloseIntent(a);
    expect(a.keyLock).toBe(false);
  });
  test("a photo's line is fixed", () => {
    const s = scene();
    const a = s.join("Alice");
    s.arts.set(7, { author: "Bob", png: PNG });
    s.give(a, "Photo#7");
    const out = useIntent(s.ctx(), s.room(), a, 1);
    expect(chat(out, "Alice")).toEqual(["You view the photo, please wait..."]);
  });
  test("kept bug: a ground click views from any distance and clears the pause", () => {
    const s = scene();
    const a = s.join("Alice", 1, 1);
    s.arts.set(7, { author: "Bob", png: PNG });
    s.put("g", "Painting#7", 15, 10);
    a.itemPause = 30;
    // Any pause blocks the click first; the click then clears it.
    expect(pickupIntent(s.ctx(), s.room(), a, "g")).toEqual([]);
    a.itemPause = 0;
    const out = pickupIntent(s.ctx(), s.room(), a, "g");
    expect(of(out, "Alice", "art")).toHaveLength(1);
    expect(a.itemPause).toBe(0);
    expect(a.keyLock).toBe(true);
  });
  test("divergence: an unknown id opens the viewer with no author and no picture", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Painting#4946464");
    const out = useIntent(s.ctx(), s.room(), a, 1);
    expect(of(out, "Alice", "art")).toEqual([{ t: "art", author: "", png: null }]);
  });
  test("paintUi and viewClose are ignored when that screen is not up", () => {
    const s = scene();
    const a = s.join("Alice");
    a.keyLock = true;
    paintUiIntent(a);
    viewCloseIntent(a);
    expect(a.keyLock).toBe(true);
  });
});

describe("newspapers", () => {
  const paper = (author = "King"): NewspaperFields => ({
    photos: ["101", "Photo Number", "999"],
    texts: ["T1", "T2", "T3", "T4", "T5", "T6"],
  });
  test("a click reads: the line, pause 20, the fields, null for a missing or non-numeric photo", () => {
    const s = scene();
    const b = s.join("Bob", 1, 1);
    s.papers.set("king", paper());
    s.arts.set(101, { author: "Alice", png: PNG });
    s.put("n", "King's Newspaper", 15, 10);
    const out = pickupIntent(s.ctx(), s.room(), b, "n");
    expect(chat(out, "Bob")).toEqual(["You view the newspaper"]);
    expect(of(out, "Bob", "newspaper")).toEqual([
      {
        t: "newspaper",
        texts: ["T1", "T2", "T3", "T4", "T5", "T6"],
        photos: [PNG_B64, null, null],
      },
    ]);
    expect(b.itemPause).toBe(20);
    expect(b.keyLock).toBe(false);
  });
  test("Ctrl reads the faced stand the same way", () => {
    const s = scene();
    const b = s.join("Bob");
    s.papers.set("king", paper());
    s.put("n", "King's Newspaper", 5, 5);
    const out = actionIntent(s.ctx(), s.room(), b);
    expect(of(out, "Bob", "newspaper")).toHaveLength(1);
    expect(b.itemPause).toBe(20);
  });
  test("bug fixed: Ctrl reads 'Doorman's Newspaper' as a click does", () => {
    const s = scene();
    const b = s.join("Bob");
    s.put("n", "Doorman's Newspaper", 5, 5);
    expect(of(actionIntent(s.ctx(), s.room(), b), "Bob", "newspaper")).toHaveLength(1);
    b.itemPause = 0;
    b.keyLock = false;
    const out = pickupIntent(s.ctx(), s.room(), b, "n");
    expect(of(out, "Bob", "newspaper")).toHaveLength(1);
  });
  test("kept bug: a player's stand stays blank", () => {
    const s = scene();
    const b = s.join("Bob");
    s.put("n", "Alice's Newspaper", 5, 5);
    const out = pickupIntent(s.ctx(), s.room(), b, "n");
    expect(of(out, "Bob", "newspaper")).toEqual([
      { t: "newspaper", texts: ["", "", "", "", "", ""], photos: [null, null, null] },
    ]);
  });
  test("only an immortal loads and saves", () => {
    const s = scene();
    const p = s.join("Alice");
    expect(newspaperSaveIntent(p, paper(), s.newspapers)).toEqual([]);
    expect(s.papers.size).toBe(0);
    expect(newspaperLoadIntent(p, s.newspapers)).toEqual([]);
  });
  test("an immortal saves to their own paper, loads it, and a reader sees it", () => {
    const s = scene();
    const k = s.join("King", 5, 6, "N", "immortal");
    const blank = newspaperLoadIntent(k, s.newspapers);
    expect(blank[0]?.msg).toEqual({
      t: "newspaperEdit",
      photos: ["", "", ""],
      texts: ["", "", "", "", "", ""],
    });
    expect(newspaperSaveIntent(k, paper(), s.newspapers)).toEqual([]);
    expect(newspaperLoadIntent(k, s.newspapers)[0]?.msg).toMatchObject({
      t: "newspaperEdit",
      texts: ["T1", "T2", "T3", "T4", "T5", "T6"],
    });
    const b = s.join("Bob", 1, 1);
    s.put("n", "King's Newspaper", 15, 10);
    expect(of(pickupIntent(s.ctx(), s.room(), b, "n"), "Bob", "newspaper")).toHaveLength(1);
  });
});

describe("the Newspaper Kit", () => {
  const k2 = (x: number, y: number) => (x === 5 && y === 5 ? "K2" : "G1");
  test("on a K2 tile the stand is '<name>'s Newspaper' and the Kit is consumed", () => {
    const s = scene(k2);
    const a = s.join("Alice");
    s.give(a, "Newspaper Kit");
    dropIntent(s.ctx(), s.room(), a, 1);
    expect(s.map.ground.map((g) => g.item)).toEqual(["Alice's Newspaper"]);
    expect(a.char.bag[0]).toBeNull();
  });
  test("divergence: not K2: 'You can't put a newspaper stand here!' and the Kit is kept", () => {
    const s = scene();
    const a = s.join("Alice");
    s.give(a, "Newspaper Kit");
    const out = dropIntent(s.ctx(), s.room(), a, 1);
    expect(chat(out, "Alice")).toEqual(["You can't put a newspaper stand here!"]);
    expect(s.map.ground).toEqual([]);
    expect(a.char.bag[0]?.item).toBe("Newspaper Kit");
  });
  test("C53's order: crowded, then off screen, then blocked, then the K2 test", () => {
    const s = scene(k2);
    const a = s.join("Alice");
    s.give(a, "Newspaper Kit");
    s.put("x", "Crate", 5, 5);
    expect(chat(dropIntent(s.ctx(), s.room(), a, 1), "Alice")).toEqual([
      "You begin to drop this but realize the floor is too crowded.",
    ]);
    s.map.ground.length = 0;
    const edge = s.join("Edgar", 5, 1);
    s.give(edge, "Newspaper Kit");
    expect(dropIntent(s.ctx(), s.room(), edge, 1)).toEqual([]);
    expect(edge.char.bag[0]?.item).toBe("Newspaper Kit");
  });
  test("the stand can't be taken: a click and Ctrl read it", () => {
    const s = scene(k2);
    const a = s.join("Alice");
    s.give(a, "Newspaper Kit");
    dropIntent(s.ctx(), s.room(), a, 1);
    a.itemPause = 0;
    const out = actionIntent(s.ctx(), s.room(), a);
    expect(of(out, "Alice", "newspaper")).toHaveLength(1);
    expect(a.char.bag.every((l) => l === null)).toBe(true);
  });
});

describe("game entry", () => {
  test("credits and the art screen state start cleared", () => {
    const st = sessionCombatState();
    expect(st.canvas).toBe(false);
    expect(st.film).toBe(false);
    expect(st.artUi).toBeNull();
  });
});

describe("music", () => {
  test("bug fixed: an Ocarina plays its tune to everyone on the map, says so, and is kept", () => {
    const s = scene();
    const a = s.join("Alice");
    const b = s.join("Bob", 6, 6);
    s.give(a, "Ocarina");
    const out = useIntent(s.ctx(), s.room(), a, 1);
    expect(of(out, a.id, "chat")).toEqual([
      { t: "chat", text: "You play a tune on your Ocarina.", color: 0 },
    ]);
    for (const id of [a.id, b.id]) {
      expect(of(out, id, "sound")).toEqual([{ t: "sound", name: "ocarina", ch: 5 }]);
    }
    expect(of(out, b.id, "chat")).toEqual([]);
    expect(a.char.bag[0]).toEqual({ item: "Ocarina", qty: 1 });
  });
  test("the Ocarina's tune is an authored sound the asset build packs", () => {
    const dir = join(import.meta.dir, "../../../assets/added/sounds");
    expect(existsSync(join(dir, "ocarina.wav"))).toBe(true);
    expect(existsSync(join(dir, "ocarina.json"))).toBe(true);
  });
});
