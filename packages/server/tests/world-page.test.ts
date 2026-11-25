/**
 * Issue #33, stage 0: the Control Panel's World page on the server. Its view lists every grid map
 * with its spawns and placed items; a map opens as the World Editor holds it, with its revision and
 * saved versions; a save is checked and applied as the World Editor's SAVE is, live and versioned,
 * and refused over a newer save; a saved version comes back as a save; and every intent is the
 * content permission's.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ContentMapsView, ServerMsg } from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { insertMapVersion } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

const NOW = "2026-11-25T00:00:00.000Z";

describe("the World page (issue #33)", () => {
  let db: Db;
  const sent: { to: string; msg: ServerMsg }[] = [];
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
  });

  async function start() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
    });
    const make = async (name: string, role?: "administrator") => {
      await game.create({
        t: "create",
        name,
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      });
      const l = await game.login(name, "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, NOW);
      }
      game.enter(l.characterId, false, "10.0.0.1");
      return l;
    };
    return { game, make };
  }
  const answer = (seq: number) => {
    const m = sent.find((o) => o.msg.t === "contentMaps" && o.msg.seq === seq)?.msg;
    if (m?.t !== "contentMaps") {
      throw new Error(`no answer ${seq}`);
    }
    return m as { view: ContentMapsView; result?: { ok: boolean; text: string } };
  };

  test("only the content permission uses the page", async () => {
    const { game, make } = await start();
    const bob = await make("Bob");
    game.intent(bob.characterId, { t: "contentMaps", seq: 1, mx: 1000, my: 992 });
    expect(sent.some((o) => o.to === bob.characterId && o.msg.t === "contentMaps")).toBe(false);
    expect(recentCheats(db, 1)[0]).toMatchObject({ name: "Bob", reason: "Attempted Admin Access" });
  });

  test("a map opens with its revision; a save applies live and is versioned; a stale one is refused; a version comes back", async () => {
    const { game, make } = await start();
    const al = await make("Al", "administrator");
    game.intent(al.characterId, { t: "controlPanelOpen" });
    game.intent(al.characterId, { t: "contentMaps", seq: 1, mx: 1000, my: 992, list: true });
    const v = answer(1).view;
    expect(v.maps?.some((m) => m.name === "x1000y992")).toBe(true);
    const open = v.map;
    if (!open) {
      throw new Error("map");
    }
    expect(open.exists).toBe(true);
    expect(open.revision).toMatch(/^[0-9a-f]{16}$/);
    const before = open.map.header;
    game.intent(al.characterId, {
      t: "contentMapSave",
      seq: 2,
      map: { ...open.map, header: "Renamed by the World page" },
      expect: open.revision,
    });
    const saved = answer(2);
    expect(saved.result).toEqual({ ok: true, text: expect.any(String) });
    expect(saved.view.map?.map.header).toBe("Renamed by the World page");
    expect(saved.view.map?.versions).toHaveLength(1);
    expect(recentAudit(db, 1)[0]?.command).toBe("editSave");
    // The same revision again is stale.
    game.intent(al.characterId, {
      t: "contentMapSave",
      seq: 3,
      map: { ...open.map, header: "Stale" },
      expect: open.revision,
    });
    expect(answer(3).result?.ok).toBe(false);
    // The version saved over comes back, as a save of its own.
    const version = saved.view.map?.versions[0]?.id as string;
    game.intent(al.characterId, {
      t: "contentMapRestore",
      seq: 4,
      mx: 1000,
      my: 992,
      version,
      expect: saved.view.map?.revision ?? null,
    });
    const restored = answer(4);
    expect(restored.result?.ok).toBe(true);
    expect(restored.view.map?.map.header).toBe(before);
    expect(restored.view.map?.versions).toHaveLength(2);
  });

  test("a new map is made at a free position, naming no revision", async () => {
    const { game, make } = await start();
    const al = await make("Al", "administrator");
    game.intent(al.characterId, { t: "controlPanelOpen" });
    game.intent(al.characterId, { t: "contentMaps", seq: 1, mx: 1500, my: 1500 });
    const open = answer(1).view.map;
    expect(open).toMatchObject({ exists: false, revision: null, versions: [] });
    game.intent(al.characterId, {
      t: "contentMapSave",
      seq: 2,
      map: { ...(open?.map as NonNullable<typeof open>["map"]), header: "Fresh" },
      expect: null,
    });
    expect(answer(2).result?.ok).toBe(true);
    // A save's answer carries the map, not the whole world's list (the page updates its entry).
    expect(answer(2).view.maps).toBeNull();
    game.intent(al.characterId, { t: "contentMaps", seq: 3, list: true });
    expect(answer(3).view.maps?.some((m) => m.name === "x1500y1500" && m.title === "Fresh")).toBe(
      true,
    );
  });

  test("a save of the same content still moves the revision on, so a save from before it is refused", async () => {
    const { game, make } = await start();
    const al = await make("Al", "administrator");
    game.intent(al.characterId, { t: "controlPanelOpen" });
    game.intent(al.characterId, { t: "contentMaps", seq: 1, mx: 1000, my: 992 });
    const open = answer(1).view.map as NonNullable<ContentMapsView["map"]>;
    // Two admins open the same revision; one saves it unchanged.
    game.intent(al.characterId, {
      t: "contentMapSave",
      seq: 2,
      map: open.map,
      expect: open.revision,
    });
    expect(answer(2).result?.ok).toBe(true);
    expect(answer(2).view.map?.revision).not.toBe(open.revision);
    game.intent(al.characterId, {
      t: "contentMapSave",
      seq: 3,
      map: { ...open.map, header: "From the stale copy" },
      expect: open.revision,
    });
    expect(answer(3).result?.ok).toBe(false);
  });

  test("a version comes back whole: every placed item, /roster slots with no tile, and 1.6's faction letters", async () => {
    const { game, make } = await start();
    const al = await make("Al", "administrator");
    game.intent(al.characterId, { t: "controlPanelOpen" });
    game.intent(al.characterId, { t: "contentMaps", seq: 1, mx: 1000, my: 992 });
    const open = answer(1).view.map as NonNullable<ContentMapsView["map"]>;
    const id = db
      .query<{ id: string }, []>("SELECT id FROM maps WHERE mx = 1000 AND my = 992 AND slot = 0")
      .get()?.id as string;
    // A version as an older server kept it: 21 placed items (/drop places past the editor's 20),
    // a roster slot set by /roster (no tile) and the faction as 1.6's letter.
    insertMapVersion(
      db,
      {
        mapId: id,
        savedBy: al.accountId,
        data: {
          title: "Old",
          layers: open.map.layers,
          flags: { ...open.map.flags, fctSpwn: "W" },
          exit1: null,
          exit2: null,
          signs: ["", "", ""],
          fog: open.map.fog,
          roster: [
            { species: "Slime", home: null },
            { species: null, home: null },
            { species: null, home: null },
            { species: null, home: null },
          ],
          items: Array.from({ length: 21 }, (_, i) => ({ name: "Apple", x: (i % 17) + 1, y: 5 })),
        },
      },
      NOW,
    );
    game.intent(al.characterId, { t: "contentMaps", seq: 2, mx: 1000, my: 992 });
    const now = answer(2).view.map as NonNullable<ContentMapsView["map"]>;
    const version = now.versions[0];
    expect(version?.blocked).toBeUndefined();
    game.intent(al.characterId, {
      t: "contentMapRestore",
      seq: 3,
      mx: 1000,
      my: 992,
      version: version?.id as string,
      expect: now.revision,
    });
    const back = answer(3);
    expect(back.result?.ok).toBe(true);
    const m = back.view.map?.map as NonNullable<ContentMapsView["map"]>["map"];
    expect(m.items).toHaveLength(21);
    expect(m.mobs[0]).toEqual({ name: "Slime", x: 1, y: 1, anywhere: true });
    expect(m.flags.fctSpwn).toBe("warrior");
  });

  test("a version the content no longer allows is listed as blocked, with why", async () => {
    const { game, make } = await start();
    const al = await make("Al", "administrator");
    game.intent(al.characterId, { t: "controlPanelOpen" });
    game.intent(al.characterId, { t: "contentMaps", seq: 1, mx: 1000, my: 992 });
    const open = answer(1).view.map as NonNullable<ContentMapsView["map"]>;
    const id = db
      .query<{ id: string }, []>("SELECT id FROM maps WHERE mx = 1000 AND my = 992 AND slot = 0")
      .get()?.id as string;
    const layers = structuredClone(open.map.layers);
    layers[0][0] = layers[0][0]?.replace(/^\S+/, "QQ9") ?? "";
    insertMapVersion(
      db,
      {
        mapId: id,
        savedBy: al.accountId,
        data: { title: "Gone tile", layers, flags: open.map.flags, roster: [], items: [] },
      },
      NOW,
    );
    game.intent(al.characterId, { t: "contentMaps", seq: 2, mx: 1000, my: 992 });
    expect(answer(2).view.map?.versions[0]?.blocked).toMatch(/palette/);
  });

  test("a restore names its own map's version, is refused when stale, and needs the permission", async () => {
    const { game, make } = await start();
    const al = await make("Al", "administrator");
    const bob = await make("Bob");
    game.intent(al.characterId, { t: "controlPanelOpen" });
    game.intent(al.characterId, { t: "contentMaps", seq: 1, mx: 1000, my: 992 });
    const a = answer(1).view.map as NonNullable<ContentMapsView["map"]>;
    game.intent(al.characterId, {
      t: "contentMapSave",
      seq: 2,
      map: { ...a.map, header: "A, saved" },
      expect: a.revision,
    });
    const saved = answer(2).view.map as NonNullable<ContentMapsView["map"]>;
    const version = saved.versions[0]?.id as string;
    // Another map's position with this map's version: not there.
    game.intent(al.characterId, { t: "contentMaps", seq: 3, mx: 0, my: 0 });
    const other = answer(3).view.map as NonNullable<ContentMapsView["map"]>;
    expect(other.exists).toBe(true);
    game.intent(al.characterId, {
      t: "contentMapRestore",
      seq: 4,
      mx: 0,
      my: 0,
      version,
      expect: other.revision,
    });
    expect(answer(4).result?.ok).toBe(false);
    // A restore from a revision since saved over is refused.
    game.intent(al.characterId, {
      t: "contentMapRestore",
      seq: 5,
      mx: 1000,
      my: 992,
      version,
      expect: a.revision,
    });
    expect(answer(5).result?.ok).toBe(false);
    expect(answer(5).view.map?.map.header).toBe("A, saved");
    // Without the content permission nothing is saved or restored, and it is logged.
    const before = sent.length;
    game.intent(bob.characterId, {
      t: "contentMapSave",
      seq: 6,
      map: { ...a.map, header: "Bob's" },
      expect: saved.revision,
    });
    game.intent(bob.characterId, {
      t: "contentMapRestore",
      seq: 7,
      mx: 1000,
      my: 992,
      version,
      expect: saved.revision,
    });
    expect(
      sent.slice(before).some((o) => o.to === bob.characterId && o.msg.t === "contentMaps"),
    ).toBe(false);
    expect(recentCheats(db, 2).every((c) => c.name === "Bob")).toBe(true);
    game.intent(al.characterId, { t: "contentMaps", seq: 8, mx: 1000, my: 992 });
    expect(answer(8).view.map?.map.header).toBe("A, saved");
  });

  test("a save the check refuses changes nothing; the list leaves out house interiors", async () => {
    const { game, make } = await start();
    const al = await make("Al", "administrator");
    game.intent(al.characterId, { t: "controlPanelOpen" });
    game.intent(al.characterId, { t: "contentMaps", seq: 1, mx: 1000, my: 992, list: true });
    const a = answer(1).view.map as NonNullable<ContentMapsView["map"]>;
    const layers = structuredClone(a.map.layers);
    layers[0][0] = layers[0][0]?.replace(/^\S+/, "QQ9") ?? "";
    game.intent(al.characterId, {
      t: "contentMapSave",
      seq: 2,
      map: { ...a.map, layers, header: "Bad" },
      expect: a.revision,
    });
    expect(answer(2).result?.ok).toBe(false);
    expect(answer(2).view.map?.revision).toBe(a.revision);
    expect(answer(2).view.map?.map.header).toBe(a.map.header);
    const slots = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM maps WHERE slot = 0")
      .get()?.n;
    expect(answer(1).view.maps).toHaveLength(slots ?? -1);
  });
});
