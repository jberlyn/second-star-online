/**
 * Crafting stations and containers in the sim: the four buttons, their timers in the frame
 * script, the BSmith FX, crafts ended by map changes, the Cauldron, the Storage button, the World
 * Editor's Cauldron ids, and the container rows (real SQL on in-memory SQLite).
 */
import { describe, expect, test } from "bun:test";

import { CRAFT_TEXT, type DeltaEvent, type ServerMsg, skillIndex } from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { loadContainers } from "../src/persistence/containers.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { applySave, editorMap } from "../src/systems/admin/worldedit.ts";
import { craftIntent } from "../src/systems/crafting/craft.ts";
import { storageIntent, withdrawContainer } from "../src/systems/economy/containers.ts";
import { actionIntent, dropIntent, type ItemCtx } from "../src/systems/inventory/items.ts";
import { setHeld } from "../src/systems/movement/movement.ts";
import { pushOnMe } from "../src/systems/movement/push.ts";
import {
  enterRoom,
  leaveRoom,
  type Player,
  type Room,
  type WorldMap,
} from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];

const lines = (out: Out, to: string): string[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "chat" ? [o.msg.text] : []));
const sounds = (out: Out, to: string): string[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "sound" ? [`${o.msg.name}:${o.msg.ch}`] : []));
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "delta" ? o.msg.events : []));
const locks = (out: Out, to: string): boolean[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "lock" ? [o.msg.on] : []));

const setSkill = (p: Player, name: string, v: number) => {
  p.char.skills[skillIndex(name)] = v;
};
const skill = (p: Player, name: string) => p.char.skills[skillIndex(name)] ?? 0;

/** A crafter at (5, 6) facing north at (5, 5), with `station` there; a watcher at (8, 8). */
function bench(station: string | null, rng = rngByN()) {
  const map = testMap("x1000y992");
  const s = setup([map], undefined, rng);
  const a = player("a", map, 5, 6);
  const b = player("b", map, 8, 8);
  s.join(a);
  s.join(b);
  const room = s.world.rooms.get(map.name) as Room;
  if (station) {
    map.ground.push({ id: "st", item: station, x: 5, y: 5, kind: "admin", expiresAt: null });
  }
  const ctx = { world: s.world, rng, stepLength: 16 };
  const craft = (slot: number) => craftIntent(room, a, slot, ctx);
  return { ...s, map, room, a, b, craft, ctx };
}

describe("smithing", () => {
  test("starts with the line, the lock and Swordhit3; done on the 500th frame", () => {
    const k = bench("Anvil");
    k.a.char.equip.weapon = "Blacksmith Hammer";
    k.a.char.bag[0] = { item: "Damaged Sword, Long", qty: 1 };
    k.a.char.bag[1] = { item: "Chunk of Iron", qty: 1 };
    const out = k.craft(1);
    expect(lines(out, "a")).toEqual(["You begin to smith the Damaged Sword, Long..."]);
    expect(locks(out, "a")).toEqual([true]);
    expect(sounds(out, "a")).toEqual(["Swordhit3:3"]);
    expect(k.a.keyLock).toBe(true);
    expect(lines(k.run(499), "a")).toEqual([]);
    const done = k.run(1);
    expect(lines(done, "a")).toEqual(["Your Long Sword is ready!"]);
    expect(locks(done, "a")).toEqual([false]);
    expect(k.a.keyLock).toBe(false);
    expect(k.a.char.bag[0]).toEqual({ item: "Long Sword", qty: 1 });
    expect(k.a.char.bag[1]).toBeNull();
  });

  test("the BSmith FX at the faced tile, 1 in 30 per frame, seen by everyone", () => {
    const rng = rngByN({ 30: [1] });
    const k = bench("Anvil", rng);
    k.a.char.equip.weapon = "Blacksmith Hammer";
    k.a.char.bag[0] = { item: "Damaged Sword, Long", qty: 1 };
    k.a.char.bag[1] = { item: "Chunk of Iron", qty: 1 };
    k.craft(1);
    const out = k.run(2); // queued on the first frame, placed on the next
    for (const who of ["a", "b"]) {
      const fx = events(out, who).find((e) => e.e === "fx" && e.name === "BSmith");
      // Sprite 112 is at (5·32 + 14, 6·32 − 3); the anvil is 32 px north.
      expect(fx).toMatchObject({ h: 174, v: 157 });
    }
  });

  test("bug fixed: a full bag says so, with no skill roll and no 'is ready!'; the inputs stay", () => {
    const k = bench("Anvil", rngByN({ 9: [1] }));
    setSkill(k.a, "Blacksmithing", 1);
    k.a.char.equip.weapon = "Blacksmith Hammer";
    for (let i = 0; i < 14; i++) {
      k.a.char.bag[i] = { item: `Apple${i}`, qty: 1 };
    }
    k.a.char.bag[0] = { item: "Damaged Sword, Long", qty: 2 };
    k.a.char.bag[1] = { item: "Chunk of Iron", qty: 2 };
    k.craft(1);
    k.a.char.bag[14] = { item: "Pie", qty: 1 }; // full by completion
    const out = k.run(500);
    expect(lines(out, "a")).toEqual(["Your inventory is too crowded!"]);
    expect(locks(out, "a")).toEqual([false]);
    expect(skill(k.a, "Blacksmithing")).toBe(1);
    expect(k.a.char.bag[0]).toEqual({ item: "Damaged Sword, Long", qty: 2 });
    expect(k.a.char.bag[1]).toEqual({ item: "Chunk of Iron", qty: 2 });
  });

  test("the skill line follows 'is ready!'; a skill of 0 can rise", () => {
    const k = bench("Anvil", rngByN({ 9: [1] }));
    setSkill(k.a, "Blacksmithing", 0);
    k.a.char.equip.weapon = "Blacksmith Hammer";
    k.a.char.bag[0] = { item: "Damaged Sword, Long", qty: 1 };
    k.a.char.bag[1] = { item: "Chunk of Iron", qty: 1 };
    k.craft(1);
    expect(lines(k.run(500), "a")).toEqual([
      "Your Long Sword is ready!",
      "You have advanced in the art of Blacksmithing!",
    ]);
    expect(skill(k.a, "Blacksmithing")).toBe(1);
  });

  test("divergence: a chunk dropped mid-craft repairs nothing and says nothing", () => {
    const k = bench("Anvil");
    k.a.char.equip.weapon = "Blacksmith Hammer";
    k.a.char.bag[0] = { item: "Damaged Sword, Long", qty: 3 };
    k.a.char.bag[1] = { item: "Chunk of Iron", qty: 1 };
    k.craft(1);
    k.a.char.bag[1] = null;
    expect(lines(k.run(500), "a")).toEqual([]);
    expect(k.a.char.bag[0]).toEqual({ item: "Damaged Sword, Long", qty: 3 });
    expect(k.a.keyLock).toBe(false);
  });

  test("mid-step there is no anvil in front", () => {
    const k = bench("Anvil");
    k.a.char.equip.weapon = "Blacksmith Hammer";
    k.a.char.bag[0] = { item: "Damaged Sword, Long", qty: 1 };
    k.a.stepFrames = 4;
    expect(lines(k.craft(1), "a")).toEqual([CRAFT_TEXT.noAnvil]);
  });
});

describe("crafts in the frame script", () => {
  test("bug fixed: a map change ends the craft, says so, and loses nothing", () => {
    const k = bench("Alchemy Lab");
    setSkill(k.a, "Alchemy", 1);
    k.a.char.equip.offHand = "Red Sand";
    k.a.char.bag[0] = { item: "Potion Bottle", qty: 1 };
    k.a.char.bag[1] = { item: "Red Crystals", qty: 1 };
    k.craft(1);
    k.run(50);
    leaveRoom(k.world, k.a);
    k.a.map = testMap("x1001y992");
    const out = enterRoom(k.world, k.a);
    expect(lines(out, "a")).toEqual([CRAFT_TEXT.interrupted]);
    k.a.loading = 0;
    expect(k.a.keyLock).toBe(false);
    expect(k.a.craft.timers).toEqual({});
    expect(lines(k.run(200), "a")).toEqual([]);
    expect(k.a.char.bag[0]).toEqual({ item: "Potion Bottle", qty: 1 });
    expect(k.a.char.bag[1]).toEqual({ item: "Red Crystals", qty: 1 });
  });

  test("a map change with no craft running says nothing", () => {
    const k = bench(null);
    leaveRoom(k.world, k.a);
    expect(lines(enterRoom(k.world, k.a), "a")).toEqual([]);
  });

  test("two crafts ending on one frame resolve Smith before Cook", () => {
    const k = bench("Anvil");
    k.map.ground.push({ id: "s2", item: "Stove", x: 5, y: 5, kind: "admin", expiresAt: null });
    setSkill(k.a, "Cooking", 1);
    k.a.char.equip.weapon = "Blacksmith Hammer";
    k.a.char.bag[0] = { item: "Damaged Sword, Long", qty: 1 };
    k.a.char.bag[1] = { item: "Chunk of Iron", qty: 1 };
    k.a.char.bag[2] = { item: "Trout", qty: 1 };
    k.craft(1);
    k.run(300);
    k.a.keyLock = false; // as a finished craft would
    k.craft(3);
    expect(lines(k.run(200), "a")).toEqual([
      "Your Long Sword is ready!",
      "Your Trout Fillet is ready!",
    ]);
  });

  test("bug fixed: a crafter can be shoved, which ends the craft and frees the keys", () => {
    const k = bench(null);
    setSkill(k.a, "Carpentry", 1);
    k.a.char.bag[0] = { item: "Logs", qty: 1 };
    k.a.char.equip.offHand = "Saw";
    k.craft(1);
    expect(k.a.keyLock).toBe(true);
    const told: string[] = [];
    const sent: Out = [];
    pushOnMe(k.room, k.a, "U", k.b, {
      rng: rngByN({ 25: [1] }),
      emit: () => {},
      tell: (_to, text) => told.push(text),
      crossings: [],
      send: (o) => sent.push(o),
    });
    expect(k.a.stepFrames).toBeGreaterThan(0);
    expect(k.a.craft.timers).toEqual({});
    expect(k.a.keyLock).toBe(false);
    expect(told.at(-1)).toBe(CRAFT_TEXT.interrupted);
    expect(locks(sent, "a")).toEqual([false]);
    expect(k.a.char.bag[0]).toEqual({ item: "Logs", qty: 1 }); // nothing was taken
    expect(lines(k.run(200), "a")).toEqual([]);
  });

  test("a crafter cannot walk or turn away: the craft's key lock holds them in place", () => {
    const k = bench("Stove");
    setSkill(k.a, "Cooking", 1);
    k.a.char.bag[0] = { item: "Trout", qty: 1 };
    k.craft(1);
    setHeld(k.a, "D", false);
    k.run(20);
    setHeld(k.a, null, false);
    expect([k.a.x, k.a.y, k.a.facing]).toEqual([5, 6, "N"]);
    expect(lines(k.run(200), "a")).toEqual(["Your Trout Fillet is ready!"]);
  });

  test("a window's key lock still stops a shove", () => {
    const k = bench(null);
    k.a.keyLock = true; // a vault or a shop holds the keys
    pushOnMe(k.room, k.a, "U", k.b, {
      rng: rngByN({ 25: [1] }),
      emit: () => {},
      tell: () => {},
      crossings: [],
    });
    expect(k.a.stepFrames).toBe(0);
  });

  test("bug fixed: a Catfish Sandwich cannot stand in for sand; the keys stay free", () => {
    const k = bench("Alchemy Lab");
    k.a.char.equip.offHand = "Catfish Sandwich";
    k.a.char.bag[0] = { item: "Potion Bottle", qty: 1 };
    expect(lines(k.craft(1), "a")).toEqual([CRAFT_TEXT.noSand]);
    expect(k.a.char.bag[0]).toEqual({ item: "Potion Bottle", qty: 1 });
    expect(k.a.keyLock).toBe(false);
  });

  test("alchemy: the bottle and crystal are taken at completion; the sand stays in hand", () => {
    const k = bench("Alchemy Lab", rngByN({ 15: [1] }));
    setSkill(k.a, "Alchemy", 1);
    k.a.char.equip.offHand = "Red Sand";
    k.a.char.bag[0] = { item: "Potion Bottle", qty: 2 };
    k.a.char.bag[1] = { item: "Red Crystals", qty: 1 };
    k.craft(1);
    expect(k.a.char.bag[0]).toEqual({ item: "Potion Bottle", qty: 2 });
    expect(lines(k.run(200), "a")).toEqual([
      "Your potion is ready!",
      "You have advanced in the art of Alchemy!",
    ]);
    expect(k.a.char.bag[0]).toEqual({ item: "Potion Bottle", qty: 1 });
    expect(k.a.char.bag[1]).toEqual({ item: "Red Potion", qty: 1 });
    expect(k.a.char.equip.offHand).toBe("Red Sand");
  });

  test("divergence: a craft ends at logout; a new session starts with none", () => {
    const k = bench(null);
    setSkill(k.a, "Carpentry", 1);
    k.a.char.bag[0] = { item: "Logs", qty: 1 };
    k.a.char.equip.offHand = "Saw";
    k.craft(1);
    const again = player("a", k.map, 5, 6);
    expect(again.craft.timers).toEqual({});
  });

  test("bug fixed: carpentry needs Carpentry 1", () => {
    const k = bench(null);
    setSkill(k.a, "Carpentry", 0);
    k.a.char.bag[0] = { item: "Logs", qty: 1 };
    k.a.char.equip.offHand = "Saw";
    expect(lines(k.craft(1), "a")).toEqual([CRAFT_TEXT.unskilledBuild]);
    expect(k.a.keyLock).toBe(false);
  });

  test("carpentry: Logs taken at completion, 'You built a Crate!', the result minted an id", () => {
    const k = bench(null, rngByN({ 4: [1] }));
    setSkill(k.a, "Carpentry", 40);
    k.a.char.bag[0] = { item: "Logs", qty: 1 };
    k.a.char.equip.offHand = "Saw";
    const out = k.craft(1);
    expect(lines(out, "a")).toEqual(["You begin to build something..."]);
    expect(sounds(out, "a")).toEqual(["sawbbb:3"]);
    expect(k.a.char.bag[0]).toEqual({ item: "Logs", qty: 1 });
    expect(lines(k.run(160), "a")).toEqual(["You built a Crate!"]); // 160 frames at > 30
    expect(k.a.char.bag[0]?.item).toMatch(/^Crate#\d+$/);
  });
});

/** A Cauldron at (5, 5) in front of the crafter. */
function cauldron(name = "Cauldron#7") {
  const k = bench(name);
  const ictx: ItemCtx = { world: k.world, rng: rngByN(), now: 0 };
  const drop = (slot: number) => dropIntent(ictx, k.room, k.a, slot);
  return { ...k, ictx, drop };
}

describe("the Cauldron", () => {
  test("kept bug: the cauldron fizzles on every deposit that completes nothing", () => {
    const c = cauldron();
    c.a.char.bag[0] = { item: "Chunk of Star", qty: 2 };
    c.a.char.bag[1] = { item: "Pie", qty: 1 };
    expect(lines(c.drop(1), "a")).toEqual([
      "You drop a Chunk of Star into the container.",
      CRAFT_TEXT.fizzle,
    ]);
    expect(lines(c.drop(2), "a")).toEqual([
      "You drop a Pie into the container.",
      CRAFT_TEXT.fizzle,
    ]);
    expect(c.world.containers.get("Cauldron#7")).toEqual(["Chunk of Star", "Pie"]);
    expect(c.a.char.bag[0]).toEqual({ item: "Chunk of Star", qty: 1 });
  });

  test("bug fixed: a hit says so to the depositor only and keeps the other contents", () => {
    const c = cauldron();
    c.world.containers.set("Cauldron#7", ["Pie", "Chunk of Star"]);
    c.a.char.bag[0] = { item: "Silver Crown", qty: 1 };
    const out = c.drop(1);
    expect(lines(out, "a")).toEqual([
      "You drop a Silver Crown into the container.",
      CRAFT_TEXT.puff,
    ]);
    expect(lines(out, "b")).toEqual([]);
    expect(c.world.containers.get("Cauldron#7")).toEqual(["Pie", "Gold Crown"]);
  });

  test("bug fixed: a brew refreshes the list of anyone with the Cauldron open", () => {
    const c = cauldron();
    c.world.containers.set("Cauldron#7", ["Pie", "Chunk of Star"]);
    c.b.container = { name: "Cauldron#7", shown: ["Pie", "Chunk of Star"] };
    c.a.char.bag[0] = { item: "Silver Crown", qty: 1 };
    const out = c.drop(1);
    const vault = out.find((o) => o.to === "b" && o.msg.t === "vault");
    expect(vault?.msg).toEqual({ t: "vault", items: ["Pie", "Gold Crown"], open: false });
    // A withdraw now takes the line it shows.
    withdrawContainer(c.world, c.b, 2, c.ictx.rng);
    expect(c.b.char.bag[0]).toEqual({ item: "Gold Crown", qty: 1 });
  });

  test("bug fixed: the Magic Shield Book recipes brew, and 'Axe' means an Axe", () => {
    const c = cauldron();
    c.world.containers.set("Cauldron#7", ["Small Shield"]);
    c.a.char.bag[0] = { item: "Magic Shield Book", qty: 1 };
    expect(lines(c.drop(1), "a")).toContain(CRAFT_TEXT.puff);
    expect(c.world.containers.get("Cauldron#7")).toEqual(["Magic Shield"]);
    c.world.containers.set("Cauldron#7", ["Gold Axe"]);
    c.a.char.bag[1] = { item: "Chunk of Star", qty: 1 };
    expect(lines(c.drop(2), "a")).toContain(CRAFT_TEXT.fizzle);
  });

  test("containers are refused; a full one says so after the drop line", () => {
    const c = cauldron();
    c.a.char.bag[0] = { item: "Crate#3", qty: 1 };
    expect(lines(c.drop(1), "a")).toEqual(["You cannot store a container!"]);
    c.world.containers.set("Cauldron#7", Array(15).fill("Pie"));
    c.a.char.bag[1] = { item: "Apple", qty: 1 };
    expect(lines(c.drop(2), "a")).toEqual([
      "You drop a Apple into the container.",
      "This is too full to store anything else!",
    ]);
    expect(c.a.char.bag[1]).toEqual({ item: "Apple", qty: 1 });
  });

  test("a plain 'Cauldron' takes nothing; Ctrl opens the shared one", () => {
    const c = cauldron("Cauldron");
    c.a.char.bag[0] = { item: "Pie", qty: 1 };
    expect(lines(c.drop(1), "a")).toEqual([
      "You begin to drop this but realize the floor is too crowded.",
    ]);
    const out = actionIntent(c.ictx, c.room, c.a);
    expect(lines(out, "a")).toEqual(["You open the Cauldron to see what's inside..."]);
    expect(c.a.container?.name).toBe("Cauldron");
  });

  test("a take re-checks the guild: a member expelled with the vault open takes nothing", () => {
    const c = cauldron();
    const name = "The Xs's Guild Vault";
    c.world.containers.set(name, ["Gold Crown"]);
    c.a.guild = "Xs";
    c.a.container = { name, shown: ["Gold Crown"] };
    c.a.guild = ""; // expelled while the window was open
    const w = withdrawContainer(c.world, c.a, 1, c.ictx.rng);
    expect(w.map((o) => o.msg)).toEqual([{ t: "vault", items: [], open: false }]);
    expect(c.a.container).toBeNull();
    expect(c.a.char.bag.every((l) => l === null)).toBe(true);
    expect(c.world.containers.get(name)).toEqual(["Gold Crown"]);
  });

  test("a carried crate is the carrier's: once it leaves the bag its window takes nothing", () => {
    const c = cauldron();
    c.world.containers.set("Crate#5", ["Gold Crown", "Pie"]);
    c.a.char.bag[0] = { item: "Crate#5", qty: 1 };
    storageIntent(c.world, c.a, 1);
    // While held, a take works.
    withdrawContainer(c.world, c.a, 1, c.ictx.rng);
    expect(c.a.char.bag[1]).toEqual({ item: "Gold Crown", qty: 1 });
    // Given away (or traded, sold, dropped): the open window takes nothing more and closes.
    c.a.char.bag[0] = null;
    const w = withdrawContainer(c.world, c.a, 1, c.ictx.rng);
    expect(w.map((o) => o.msg)).toEqual([{ t: "vault", items: [], open: false }]);
    expect(c.a.container).toBeNull();
    expect(c.world.containers.get("Crate#5")).toEqual(["Pie"]);
    // A placed container opened by facing it keeps 1.6's remote withdraw.
    c.world.containers.set("Crate#6", ["Pie"]);
    c.a.container = { name: "Crate#6", shown: ["Pie"] };
    withdrawContainer(c.world, c.a, 1, c.ictx.rng);
    expect(c.world.containers.get("Crate#6")).toEqual([]);
  });

  test("kept bug: two players holding the same container name share its storage", () => {
    const c = cauldron();
    c.world.containers.set("Crate#4242", ["Gold Crown", "Pie"]);
    c.a.char.bag[0] = { item: "Crate#4242", qty: 2 };
    storageIntent(c.world, c.a, 1);
    withdrawContainer(c.world, c.a, 1, c.ictx.rng);
    expect(c.a.char.bag[1]).toEqual({ item: "Gold Crown", qty: 1 });
    // The second crate from the same bought line, now in another player's bag.
    c.b.char.bag[0] = { item: "Crate#4242", qty: 1 };
    storageIntent(c.world, c.b, 1);
    withdrawContainer(c.world, c.b, 1, c.ictx.rng);
    expect(c.b.char.bag[1]).toEqual({ item: "Pie", qty: 1 });
    expect(c.world.containers.get("Crate#4242")).toEqual([]);
  });

  test("Ctrl opens it; a withdraw takes the line by name", () => {
    const c = cauldron();
    c.world.containers.set("Cauldron#7", ["Pie", "Chunk of Star"]);
    const open = actionIntent(c.ictx, c.room, c.a);
    expect(lines(open, "a")).toEqual(["You open the Cauldron to see what's inside..."]);
    expect(open.find((o) => o.msg.t === "vault")?.msg).toEqual({
      t: "vault",
      items: ["Pie", "Chunk of Star"],
      open: true,
    });
    expect(c.a.keyLock).toBe(true);
    expect(c.a.itemPause).toBe(0); // closing the vault clears Ctrl's pause
    // The contents change behind the window (not by a deposit): a stale line gives nothing.
    c.world.containers.set("Cauldron#7", ["Gold Crown"]);
    const w = withdrawContainer(c.world, c.a, 1, c.ictx.rng);
    expect(w[0]?.msg).toEqual({ t: "vault", items: ["Chunk of Star"], open: false });
    expect(c.a.keyLock).toBe(false);
    expect(c.a.char.bag.every((l) => l === null)).toBe(true);
    // A line that is there comes out, one unit.
    c.a.container = { name: "Cauldron#7", shown: ["Gold Crown"] };
    withdrawContainer(c.world, c.a, 1, c.ictx.rng);
    expect(c.a.char.bag[0]).toEqual({ item: "Gold Crown", qty: 1 });
    expect(c.world.containers.get("Cauldron#7")).toEqual([]);
  });

  test("kept bug: Storage on a Crate or Cauldron prints nothing; a Cabinet says so", () => {
    const c = cauldron();
    c.a.char.bag[0] = { item: "Crate#5", qty: 1 };
    c.a.char.bag[1] = { item: "Cabinet#6", qty: 1 };
    const crate = storageIntent(c.world, c.a, 1);
    expect(lines(crate, "a")).toEqual([]);
    expect(crate[0]?.msg).toEqual({ t: "vault", items: [], open: true });
    expect(c.a.container?.name).toBe("Crate#5");
    c.a.keyLock = false;
    expect(lines(storageIntent(c.world, c.a, 2), "a")).toEqual([
      "You open the cabinet to see what's inside...",
    ]);
    c.a.keyLock = false;
    c.a.char.bag[2] = { item: "Pie", qty: 1 };
    expect(storageIntent(c.world, c.a, 3)).toEqual([]); // no Storage button for a Pie
  });
});

describe("the World Editor's Cauldron ids", () => {
  test("an exact Cauldron gets an id on save; one with an id keeps it", () => {
    const k = bench(null);
    const m = editorMap(() => k.map as WorldMap, 1000, 992).map;
    m.items = [
      { name: "Cauldron", x: 2, y: 2 },
      { name: "Cauldron#123", x: 3, y: 2 },
    ];
    let n = 0;
    const r = applySave(k.world, k.map, m, () => `id${n++}`, 5000);
    expect(r.added.map((g) => g.item)).toEqual(["Cauldron#5000", "Cauldron#123"]);
  });
});

describe("persistence", () => {
  test("a deposit writes the bag and the container together; both survive a restart", async () => {
    const db = openDatabase();
    migrate(db);
    const sent: Out = [];
    const g = createGame({
      db,
      send: (to: string, msg: ServerMsg) => sent.push({ to, msg }),
      isoNow: () => "2026-11-06T00:00:00.000Z",
      rng: rngByN(),
      minute: () => 0,
    });
    await g.create({
      t: "create",
      name: "Alice",
      password: "pw",
      sex: 1,
      head: 1,
      classCode: 1,
      str: 11,
      sta: 11,
      int: 11,
      wis: 11,
      dex: 11,
    });
    const l = await g.login("Alice", "pw");
    if (!l.ok) {
      throw new Error(l.text);
    }
    g.enter(l.characterId, false);
    g.intent(l.characterId, { t: "mapReady" });
    const p = g.world.players.get(l.characterId) as Player;
    const [dx, dy] =
      p.facing === "N" ? [0, -1] : p.facing === "S" ? [0, 1] : p.facing === "E" ? [1, 0] : [-1, 0];
    p.map.ground.push({
      id: "c",
      item: "Cauldron#9",
      x: p.x + dx,
      y: p.y + dy,
      kind: "admin",
      expiresAt: null,
    });
    p.char.bag[0] = { item: "Parry Book", qty: 1 };
    p.char.bag[1] = { item: "Ruby Ring", qty: 1 };
    g.intent(l.characterId, { t: "drop", slot: 1 });
    g.intent(l.characterId, { t: "drop", slot: 2 });
    expect(loadContainers(db).get("Cauldron#9")).toEqual(["Ring of Quickness"]);
    expect(loadInventory(db, l.characterId)?.bag.slice(0, 2)).toEqual([null, null]);
    const g2 = createGame({
      db,
      send: () => {},
      isoNow: () => "2026-11-06T00:00:00.000Z",
      rng: rngByN(),
      minute: () => 0,
    });
    expect(g2.world.containers.get("Cauldron#9")).toEqual(["Ring of Quickness"]);
  });
});
