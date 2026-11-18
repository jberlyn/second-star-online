/**
 * Sim tests for keys, switches, the relock timer, placed containers and quest chests. Scripted
 * `Rng` replays.
 */
import { describe, expect, test } from "bun:test";

import { type DeltaEvent, type ServerMsg, useItem } from "@secondstaronline/shared";

import { saveClockStep, storageIntent } from "../src/systems/economy/containers.ts";
import {
  actionIntent,
  dropIntent,
  type ItemCtx,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { tick } from "../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  type GroundItem,
  leaveRoom,
  type Player,
  type Room,
  type World,
} from "../src/systems/world/world.ts";
import { NO_CASINO, player, rngByN, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));

function scene(queues: Record<number, number[]> = {}, mapName = "x1000y992") {
  const map = testMap(mapName);
  const world: World = createWorld();
  const rng = rngByN(queues);
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000 });
  const join = (id: string, x: number, y: number, facing: Player["facing"] = "N"): Player => {
    const p = player(id, map, x, y);
    p.facing = facing;
    addPlayer(world, p);
    p.loading = 0;
    p.flicker = 0;
    return p;
  };
  const room = (): Room => world.rooms.get(map.name) as Room;
  let n = 0;
  const put = (item: string, x: number, y: number): GroundItem => {
    n += 1;
    const g: GroundItem = { id: `g${n}`, item, x, y, kind: "drop", expiresAt: null };
    map.ground.push(g);
    return g;
  };
  const deps = {
    loadMap: () => map,
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    stepFrames: 16,
    rng,
    now: () => 1_000_000,
  };
  const run = (k = 1): Out => {
    const all: Out = [];
    for (let i = 0; i < k; i++) {
      all.push(...tick(world, deps).out);
    }
    return all;
  };
  const names = () => map.ground.map((g) => g.item);
  return { map, world, rng, ctx, join, room, put, run, names };
}

const give = (p: Player, slot: number, item: string, qty = 1) => {
  p.char.bag[slot - 1] = { item, qty };
};

describe("keys", () => {
  test("Alice's House Key opens her door for everyone; Bob's does not fit", () => {
    const s = scene();
    const alice = s.join("Alice", 9, 11);
    const bob = s.join("Bob", 8, 11);
    const door = s.put("Alice's Door", 9, 10);
    give(alice, 1, "House Key");
    give(bob, 1, "House Key");
    bob.x = 9;
    bob.y = 11;
    alice.x = 10;
    const refused = useIntent(s.ctx(), s.room(), bob, 1);
    expect(chat(refused, "Bob")).toEqual(["Your key doesn't fit this lock!"]);
    expect(door.item).toBe("Alice's Door");
    bob.x = 8;
    alice.x = 9;
    const out = useIntent(s.ctx(), s.room(), alice, 1);
    expect(door.item).toBe("Alice's Opened Door");
    expect(events(out, "Bob")).toContainEqual({
      e: "gset",
      id: door.id,
      name: "Alice's Opened Door",
    });
    expect(s.world.groundLog).toContainEqual({
      mapId: s.map.id,
      set: { id: door.id, item: "Alice's Opened Door" },
    });
    expect(s.room().doorLock).toBe(200); // the echo
  });

  test("bug fixed: a House Key pauses 100 after each turn and is kept", () => {
    const s = scene();
    const alice = s.join("Alice", 9, 11);
    const door = s.put("Alice's Door", 9, 10);
    give(alice, 1, "House Key");
    useIntent(s.ctx(), s.room(), alice, 1);
    expect(door.item).toBe("Alice's Opened Door");
    expect(alice.itemPause).toBe(100);
    // Inside the pause the key does nothing.
    useIntent(s.ctx(), s.room(), alice, 1);
    expect(door.item).toBe("Alice's Opened Door");
    alice.itemPause = 0;
    useIntent(s.ctx(), s.room(), alice, 1);
    expect(door.item).toBe("Alice's Door");
    expect(alice.char.bag[0]).toEqual({ item: "House Key", qty: 1 });
  });

  test("bug fixed: a Guild Key pauses 100 and is kept", () => {
    const s = scene();
    const alice = s.join("Alice", 9, 11);
    alice.guild = "Knights";
    const door = s.put("The Knights's Door", 9, 10);
    give(alice, 1, "Guild Key");
    useIntent(s.ctx(), s.room(), alice, 1);
    expect(door.item).toBe("The Knights's Opened Door");
    expect(alice.itemPause).toBe(100);
    expect(alice.char.bag[0]).toEqual({ item: "Guild Key", qty: 1 });
  });

  test("bug fixed: a coloured key is spent opening its door, not closing it; it pauses 425", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    const door = s.put("Steel Door", 5, 4);
    give(p, 2, "Steel Key", 2);
    useIntent(s.ctx(), s.room(), p, 2);
    expect(door.item).toBe("Open Steel Door");
    expect(p.char.bag[1]).toEqual({ item: "Steel Key", qty: 1 });
    expect(p.itemPause).toBe(425);
    p.itemPause = 0;
    useIntent(s.ctx(), s.room(), p, 2);
    expect(door.item).toBe("Steel Door");
    expect(p.char.bag[1]).toEqual({ item: "Steel Key", qty: 1 });
    expect(p.itemPause).toBe(425);
  });

  test("bug fixed: no key is on the usable list; Use sends a key to the door rule only", () => {
    // The usable list no longer names the coloured keys...
    for (const key of ["Steel Key", "Wooden Key", "Emerald Key", "Fire Key", "Gold Key"]) {
      const asUsable = useItem(
        key,
        { hp: 10, hpMax: 20, sp: 10, spMax: 20, hunger: 100 },
        rngByN(),
      );
      expect(asUsable).toMatchObject({ consume: false, lines: [`You cannot use the ${key}.`] });
    }
    // ...and Use stops at the key rule: with no door in front nothing is said and nothing spent.
    const s = scene();
    const p = s.join("Alice", 5, 5);
    give(p, 1, "Steel Key");
    expect(chat(useIntent(s.ctx(), s.room(), p, 1), "Alice")).toEqual([]);
    expect(p.char.bag[0]).toEqual({ item: "Steel Key", qty: 1 });
  });

  test("the wrong key, no door, or mid-step: silent and nothing spent", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    const door = s.put("Gold Door", 5, 4);
    give(p, 1, "Steel Key");
    expect(chat(useIntent(s.ctx(), s.room(), p, 1), "Alice")).toEqual([]);
    p.facing = "S";
    expect(chat(useIntent(s.ctx(), s.room(), p, 1), "Alice")).toEqual([]);
    p.facing = "N";
    give(p, 1, "Gold Key");
    p.stepFrames = 3;
    useIntent(s.ctx(), s.room(), p, 1);
    expect(door.item).toBe("Gold Door");
    expect(p.char.bag[0]).toEqual({ item: "Gold Key", qty: 1 });
  });

  test("bug fixed: a key opens only the Steel Door you face", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    s.put("Steel Door", 5, 4);
    s.put("Steel Door", 12, 2);
    s.put("Gold Door", 13, 2);
    give(p, 1, "Steel Key");
    useIntent(s.ctx(), s.room(), p, 1);
    expect(s.names()).toEqual(["Open Steel Door", "Steel Door", "Gold Door"]);
  });

  test("bug fixed: Bob's House Key leaves Jimbob's Door alone", () => {
    const s = scene();
    const bob = s.join("Bob", 5, 5);
    s.put("Jimbob's Door", 7, 4);
    s.put("Bob's Door", 5, 4);
    give(bob, 1, "House Key");
    useIntent(s.ctx(), s.room(), bob, 1);
    expect(s.names()).toEqual(["Jimbob's Door", "Bob's Opened Door"]);
  });

  test("the last door on the faced tile is the one the key tries", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    s.put("Steel Door", 5, 4);
    s.put("Alice's Door", 5, 4);
    give(p, 1, "Steel Key");
    useIntent(s.ctx(), s.room(), p, 1);
    expect(s.names()).toEqual(["Steel Door", "Alice's Door"]);
  });

  test("an opened door no longer blocks the step", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    s.put("Steel Door", 5, 4);
    give(p, 1, "Steel Key");
    p.held = "U";
    s.run(1);
    expect([p.x, p.y]).toEqual([5, 5]);
    p.held = null;
    useIntent(s.ctx(), s.room(), p, 1);
    p.held = "U";
    s.run(1);
    expect(p.y).toBe(4);
  });
});

describe("relock", () => {
  test("a Steel Door opened by key shuts 200 frames later, and every client sees it", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    s.join("Bob", 8, 8);
    const door = s.put("Steel Door", 5, 4);
    give(p, 1, "Steel Key", 2);
    expect(s.room().doorLock).toBe(0); // arriving sets no relock
    useIntent(s.ctx(), s.room(), p, 1);
    s.run(199);
    expect(door.item).toBe("Open Steel Door");
    const out = s.run(1);
    expect(door.item).toBe("Steel Door");
    expect(events(out, "Bob")).toContainEqual({ e: "gset", id: door.id, name: "Steel Door" });
    expect(s.room().doorLock).toBe(200); // the close echoes; the next run finds nothing open
  });

  test("bug fixed: arriving on a map leaves a running relock alone", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    const door = s.put("Steel Door", 5, 4);
    give(p, 1, "Steel Key");
    useIntent(s.ctx(), s.room(), p, 1);
    s.run(190);
    s.join("Bob", 8, 8);
    expect(s.room().doorLock).toBe(10);
    s.run(10);
    expect(door.item).toBe("Steel Door");
  });

  test("bug fixed: doors on a map nobody is on still close on time", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    const door = s.put("Steel Door", 5, 4);
    give(p, 1, "Steel Key");
    useIntent(s.ctx(), s.room(), p, 1);
    s.run(50);
    // Alice leaves with 150 frames to go; the map is unloaded.
    leaveRoom(s.world, p);
    expect(s.world.rooms.has(s.map.name)).toBe(false);
    s.run(100);
    // Bob arrives with 50 to go: the doors close then, not 150 frames after he arrived.
    s.join("Bob", 8, 8);
    expect(s.room().doorLock).toBe(50);
    s.run(50);
    expect(door.item).toBe("Steel Door");
    // Arriving long after the relock was due closes them on the first frame.
    const q = s.room().players[0] as Player;
    door.item = "Open Steel Door";
    s.room().doorLock = 5;
    leaveRoom(s.world, q);
    s.run(500);
    s.join("Carl", 8, 8);
    expect(s.room().doorLock).toBe(1);
    s.run(1);
    expect(door.item).toBe("Steel Door");
  });

  test("bug fixed: player and guild doors relock like the others", () => {
    const s = scene();
    const alice = s.join("Alice", 9, 11);
    alice.guild = "Knights";
    const own = s.put("Alice's Door", 9, 10);
    const hall = s.put("The Knights's Opened Door", 3, 3);
    give(alice, 1, "House Key");
    useIntent(s.ctx(), s.room(), alice, 1);
    expect(own.item).toBe("Alice's Opened Door");
    s.run(199);
    expect(own.item).toBe("Alice's Opened Door");
    s.run(1);
    expect(own.item).toBe("Alice's Door");
    expect(hall.item).toBe("The Knights's Door");
  });
});

describe("switches", () => {
  test("clicking an OFF switch in front turns it ON, opens every Switch Door, pauses 100", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    const sw = s.put("OFF Switch", 5, 4);
    s.put("Switch Door", 10, 2);
    s.put("Switch Door", 11, 2);
    const out = pickupIntent(s.ctx(), s.room(), p, sw.id);
    expect(chat(out, "Alice")).toEqual([]);
    expect(s.names()).toEqual(["ON Switch", "Open Switch Door", "Open Switch Door"]);
    expect(p.itemPause).toBe(100);
    expect(s.room().doorLock).toBe(200);
  });

  test("Ctrl on an ON switch turns it OFF and shuts the switch doors", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    s.put("ON Switch", 5, 4);
    s.put("Open Switch Door", 10, 2);
    actionIntent(s.ctx(), s.room(), p);
    expect(s.names()).toEqual(["OFF Switch", "Switch Door"]);
  });

  test("bug fixed: a switch flips only itself", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    const sw = s.put("OFF Switch", 5, 4);
    s.put("OFF Switch", 12, 8);
    pickupIntent(s.ctx(), s.room(), p, sw.id);
    expect(s.names()).toEqual(["ON Switch", "OFF Switch"]);
  });

  test("bug fixed: a refused switch click leaves the relock alone", () => {
    const s = scene();
    const p = s.join("Alice", 2, 2);
    const sw = s.put("ON Switch", 5, 4);
    const door = s.put("Open Steel Door", 9, 9);
    s.room().doorLock = 0;
    const out = pickupIntent(s.ctx(), s.room(), p, sw.id);
    expect(chat(out, "Alice")).toEqual([
      "You see the switch, but you must be standing in front of it to use it.",
    ]);
    expect(sw.item).toBe("ON Switch");
    expect(s.room().doorLock).toBe(0);
    s.run(300);
    expect(door.item).toBe("Open Steel Door");
    expect(sw.item).toBe("ON Switch");
  });
});

describe("placed containers", () => {
  test("Alice opens her House Vault; Bob gets the refusal", () => {
    const s = scene();
    const alice = s.join("Alice", 5, 9);
    const vault = s.put("Alice's House Vault", 5, 8);
    const out = pickupIntent(s.ctx(), s.room(), alice, vault.id);
    expect(chat(out, "Alice")).toEqual(["You open Alice's House Vault to see what's inside..."]);
    expect(alice.container?.name).toBe("Alice's House Vault");
    s.world.players.delete("Alice");
    s.room().players = s.room().players.filter((x) => x !== alice);
    const bob = s.join("Bob", 5, 9);
    const no = pickupIntent(s.ctx(), s.room(), bob, vault.id);
    expect(chat(no, "Bob")).toEqual(["You can't open a vault that's not yours!"]);
    expect(bob.container).toBeNull();
  });

  test("Bob's Drop into Alice's vault is refused before the drop line; nothing is taken", () => {
    const s = scene();
    const bob = s.join("Bob", 5, 9);
    s.put("Alice's House Vault", 5, 8);
    give(bob, 1, "Apple");
    const out = dropIntent(s.ctx(), s.room(), bob, 1);
    expect(chat(out, "Bob")).toEqual(["You can't open a vault that's not yours!"]);
    expect(bob.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
    expect(s.world.containers.get("Alice's House Vault")).toBeUndefined();
  });

  test("Alice deposits into her House Vault", () => {
    const s = scene();
    const alice = s.join("Alice", 5, 9);
    s.put("Alice's House Vault", 5, 8);
    give(alice, 1, "Apple", 2);
    const out = dropIntent(s.ctx(), s.room(), alice, 1);
    expect(chat(out, "Alice")).toEqual(["You drop a Apple into the container."]);
    expect(s.world.containers.get("Alice's House Vault")).toEqual(["Apple"]);
  });

  test("a guild vault refuses anyone outside the guild, and opens for a member", () => {
    const s = scene();
    const p = s.join("Alice", 5, 9);
    const gv = s.put("The Knights's Guild Vault", 5, 8);
    expect(chat(pickupIntent(s.ctx(), s.room(), p, gv.id), "Alice")).toEqual([
      "You can't open a vault that's not yours!",
    ]);
    p.itemPause = 0;
    p.guild = "Knights";
    expect(chat(pickupIntent(s.ctx(), s.room(), p, gv.id), "Alice")).toEqual([
      "You open the The Knights's Guild Vault to see what's inside...",
    ]);
  });

  test("a click not in front gives the line and pauses 40", () => {
    const s = scene();
    const p = s.join("Alice", 2, 2);
    const chest = s.put("Gold Chest", 5, 4);
    const out = pickupIntent(s.ctx(), s.room(), p, chest.id);
    expect(chat(out, "Alice")).toEqual([
      "You see the Gold Chest, but you must be standing in front of it to use it.",
    ]);
    expect(p.itemPause).toBe(40);
  });

  test("a click opens a chest in front and ends the pause", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    const chest = s.put("Gold Chest", 5, 4);
    s.world.containers.set("Gold Chest", ["Hammer"]);
    const out = pickupIntent(s.ctx(), s.room(), p, chest.id);
    expect(chat(out, "Alice")).toEqual(["You open the Gold Chest to see what's inside..."]);
    expect(out).toContainEqual({ to: "Alice", msg: { t: "vault", items: ["Hammer"], open: true } });
    expect(p.itemPause).toBe(0);
  });

  test("bug fixed: a click opens a Crate on the floor; Ctrl picks it up with its id and contents", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    p.char.stats.str = 14;
    const crate = s.put("Crate#77", 5, 4);
    give(p, 1, "Apple");
    dropIntent(s.ctx(), s.room(), p, 1);
    expect(s.world.containers.get("Crate#77")).toEqual(["Apple"]);
    const click = pickupIntent(s.ctx(), s.room(), p, crate.id);
    expect(chat(click, "Alice")).toEqual(["You open the Crate to see what's inside..."]);
    p.keyLock = false;
    p.container = null;
    p.itemPause = 0;
    // Strength 15 is needed to carry it.
    expect(chat(actionIntent(s.ctx(), s.room(), p), "Alice")).toEqual([
      "You're not strong enough to pick this up!",
    ]);
    p.itemPause = 0;
    p.char.stats.str = 15;
    actionIntent(s.ctx(), s.room(), p);
    expect(s.map.ground).toEqual([]);
    expect(p.char.bag.some((l) => l?.item === "Crate#77")).toBe(true);
    expect(s.world.containers.get("Crate#77")).toEqual(["Apple"]);
  });

  test("bug fixed: Drop routes: the six chests by name take items, the Wind Chest too; a bare Crate is crowded", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    for (const [chest, ok] of [
      ["Dark Chest", true],
      ["Water Chest", true],
      ["Wind Chest", true],
      ["Crate", false],
    ] as const) {
      s.map.ground = [];
      s.put(chest, 5, 4);
      give(p, 1, "Apple");
      const out = dropIntent(s.ctx(), s.room(), p, 1);
      expect(chat(out, "Alice")).toEqual([
        ok
          ? "You drop a Apple into the container."
          : "You begin to drop this but realize the floor is too crowded.",
      ]);
    }
    expect(s.world.containers.get("Dark Chest")).toEqual(["Apple"]);
    expect(s.world.containers.get("Wind Chest")).toEqual(["Apple"]);
  });

  test("capacity: a placed Crate holds 3", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    s.put("Crate#5", 5, 4);
    s.world.containers.set("Crate#5", ["A", "B", "C"]);
    give(p, 1, "Apple");
    const out = dropIntent(s.ctx(), s.room(), p, 1);
    expect(chat(out, "Alice")).toEqual(["This is too full to store anything else!"]);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
  });

  test("bug fixed: a take keeps the keys locked, so you cannot walk off with the window open", async () => {
    const { withdrawContainer } = await import("../src/systems/economy/containers.ts");
    const s = scene();
    const p = s.join("Alice", 5, 9);
    const v = s.put("Alice's House Vault", 5, 8);
    s.world.containers.set("Alice's House Vault", ["Apple", "Pie"]);
    pickupIntent(s.ctx(), s.room(), p, v.id);
    withdrawContainer(s.world, p, 1, s.rng);
    expect(p.keyLock).toBe(true);
    withdrawContainer(s.world, p, 1, s.rng);
    expect(s.world.containers.get("Alice's House Vault")).toEqual([]);
    expect(p.keyLock).toBe(true);
    expect(p.container?.name).toBe("Alice's House Vault");
  });

  test("Storage on a chest stays silent: a chest can never be carried", () => {
    const s = scene();
    const p = s.join("Alice", 5, 5);
    give(p, 1, "Gold Chest");
    expect(storageIntent(s.world, p, 1)).toEqual([]);
  });
});

describe("quest chests", () => {
  test("bug fixed: after 400 frames a 1-in-350 save rolls 1 in 4000; the refill is added to the chest", () => {
    const s = scene({ 350: [1], 4000: [1], 6: [1], 3: [3] });
    const p = s.join("Alice", 5, 5);
    s.world.containers.set("Gold Chest", ["Old Sword", "Apple"]);
    for (let i = 0; i < 399; i++) {
      saveClockStep(s.world, p, s.rng);
    }
    expect(s.rng.calls).toEqual([]);
    saveClockStep(s.world, p, s.rng); // block now 0: no roll this frame
    saveClockStep(s.world, p, s.rng);
    expect(s.rng.calls).toEqual([350, 4000, 6, 3]);
    expect(s.world.containers.get("Gold Chest")).toEqual(["Old Sword", "Apple", "Fire Staff"]);
    expect(p.saveBlock).toBe(400);
  });

  test("bug fixed: a full quest chest keeps what it holds", () => {
    const s = scene({ 350: [1], 4000: [1], 6: [1], 3: [3] });
    const p = s.join("Alice", 5, 5);
    p.saveBlock = 0;
    const full = Array.from({ length: 15 }, (_, i) => `Item${i}`);
    s.world.containers.set("Gold Chest", full);
    saveClockStep(s.world, p, s.rng);
    expect(s.world.containers.get("Gold Chest")).toEqual(full);
  });

  test("no save, or a chest with no source: nothing changes", () => {
    const s = scene({ 350: [2, 1], 4000: [1], 6: [4] });
    const p = s.join("Alice", 5, 5);
    p.saveBlock = 0;
    saveClockStep(s.world, p, s.rng);
    expect(p.saveBlock).toBe(0);
    saveClockStep(s.world, p, s.rng);
    expect(s.world.containers.size).toBe(0);
  });
});
