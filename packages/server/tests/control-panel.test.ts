/**
 * The Control Panel on the server (issue #24): opening it takes the admin off the map as the World
 * Editor does, moving between it and the editors never puts them back on the map, Return to Game
 * brings them back, and only a role with a Control Panel permission gets in.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  CONTROL_PANEL_PERMISSIONS,
  canOpenControlPanel,
  MODERATOR,
  PERMISSIONS,
  type Permission,
  type RoleDef,
  type ServerMsg,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { saveRole } from "../src/persistence/roles.ts";
import { applyRole } from "../src/systems/admin/commands.ts";
import { openControlPanel } from "../src/systems/admin/control-panel.ts";
import { openNpcEditor } from "../src/systems/admin/npcedit.ts";
import { closeEditor, openEditor } from "../src/systems/admin/worldedit.ts";
import { offerTrade, openTrade } from "../src/systems/economy/trade.ts";
import { dueGives } from "../src/systems/inventory/items.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

const casino = { graceTicks: 600, addGoldOffline: () => {} };

function scene() {
  const map = testMap("x1000y992");
  const { world, join, run } = setup([map]);
  const p = player("p", map, 5, 5);
  const admin = player("admin", map, 6, 6);
  admin.role = ADMINISTRATOR;
  join(p);
  join(admin);
  return { map, world, p, admin, run };
}

/** A role holding only `permissions`. */
const roleWith = (...permissions: Permission[]): RoleDef => ({
  id: "r",
  name: "R",
  rank: 2,
  permissions: new Set(permissions),
});

describe("who may open the Control Panel", () => {
  test("any Control Panel permission opens it; a player and a moderator cannot", () => {
    expect(CONTROL_PANEL_PERMISSIONS).toContain("settings");
    // The Content page (issue #27).
    expect(CONTROL_PANEL_PERMISSIONS).toContain("contentEditor");
    expect(canOpenControlPanel(null)).toBe(false);
    expect(canOpenControlPanel(MODERATOR)).toBe(false);
    expect(canOpenControlPanel(ADMINISTRATOR)).toBe(true);
    expect(canOpenControlPanel(roleWith("settings"))).toBe(true);
    expect(canOpenControlPanel(roleWith("worldEditor", "drop"))).toBe(false);
  });

  test("the administrator holds the Control Panel's permissions", () => {
    for (const p of [
      "settings",
      "contentEditor",
      "characterView",
      "characterEditor",
      "activityLog",
    ] as const) {
      expect(PERMISSIONS).toContain(p);
      expect(ADMINISTRATOR.permissions.has(p)).toBe(true);
      expect(MODERATOR.permissions.has(p)).toBe(false);
    }
  });
});

describe("opening and leaving", () => {
  test("a player gets nothing; an admin leaves the room, stops ticking and gets the Control Panel", () => {
    const { world, p, admin, run } = scene();
    expect(openControlPanel(world, p, casino)).toEqual([]);
    expect(p.editing).toBeNull();
    admin.held = "U";
    admin.attackHeld = true;
    const out = openControlPanel(world, admin, casino);
    expect(out.some((o) => o.to === "p" && o.msg.t === "delta")).toBe(true);
    expect(out).toContainEqual({ to: "admin", msg: { t: "controlPanel" } });
    expect(admin.editing).toBe("controlPanel");
    expect(admin.held).toBeNull();
    expect(admin.attackHeld).toBe(false);
    expect(world.rooms.get("x1000y992")?.players).toEqual([p]);
    admin.char.hunger = 100;
    run(5);
    expect(admin.char.hunger).toBe(100);
    // Opening it again does nothing.
    expect(openControlPanel(world, admin, casino)).toEqual([]);
  });

  test("Return to Game puts the admin back where they stood, with the login i-frames", () => {
    const { world, admin } = scene();
    openControlPanel(world, admin, casino);
    const back = closeEditor(world, admin);
    expect(back).toContainEqual({ to: "admin", msg: { t: "editor", editing: false } });
    expect(back.some((o) => o.to === "admin" && o.msg.t === "snapshot")).toBe(true);
    expect(admin.editing).toBeNull();
    expect(admin.flicker).toBe(40);
    expect([admin.map.name, admin.x, admin.y]).toEqual(["x1000y992", 6, 6]);
  });

  test("moving between the Control Panel and the editors never puts the admin back on the map", () => {
    const { world, map, admin } = scene();
    openControlPanel(world, admin, casino);
    const steps = [
      openEditor(world, admin, () => map, { mx: 1000, my: 992 }, casino),
      openControlPanel(world, admin, casino),
      openNpcEditor(world, admin, casino),
      openControlPanel(world, admin, casino),
    ];
    expect(admin.editing).toBe("controlPanel");
    for (const out of steps) {
      expect(out.some((o) => o.msg.t === "snapshot" || o.msg.t === "delta")).toBe(false);
      expect(world.rooms.get("x1000y992")?.players).not.toContain(admin);
    }
  });

  test("a role that loses its Control Panel permissions is sent back to the game", () => {
    const { world, admin } = scene();
    openControlPanel(world, admin, casino);
    // Still holding a Control Panel permission: stays.
    expect(applyRole(world, admin, roleWith("settings")).some((o) => o.msg.t === "snapshot")).toBe(
      false,
    );
    expect(admin.editing).toBe("controlPanel");
    const out = applyRole(world, admin, MODERATOR);
    expect(out).toContainEqual({ to: "admin", msg: { t: "editor", editing: false } });
    expect(admin.editing).toBeNull();
  });
});

describe("nothing reaches an admin who has left the map", () => {
  test("bug fixed: a trade opened with the admin but not yet sent ends when they leave", () => {
    const { world, p, admin } = scene();
    openTrade(world, p, "admin");
    const out = openControlPanel(world, admin, casino);
    expect(world.trades.size).toBe(0);
    expect(p.trade).toBeNull();
    expect(out).toContainEqual({ to: "p", msg: { t: "trade", trade: null } });
    // The admin never had a trade window, so nothing is said to them about it.
    expect(out.some((o) => o.to === "admin" && o.msg.t === "trade")).toBe(false);
  });

  test("no one can open a trade with an admin in the Control Panel", () => {
    const { world, p, admin } = scene();
    openControlPanel(world, admin, casino);
    expect(openTrade(world, p, "admin")).toEqual([]);
    expect(world.trades.size).toBe(0);
  });

  test("every trade opened with the admin but not yet sent ends, beside their own", () => {
    const { world, map, p, admin } = scene();
    const q = player("q", map, 7, 7);
    const r = player("r", map, 8, 8);
    world.players.set("q", q);
    world.players.set("r", r);
    // The admin is in a trade with r; p and q have each opened one with the admin.
    openTrade(world, admin, "r");
    offerTrade(world, admin, { t: "tradeOffer", gold: 0, items: [] });
    openTrade(world, p, "admin");
    openTrade(world, q, "admin");
    expect(world.trades.size).toBe(3);
    openControlPanel(world, admin, casino);
    expect(world.trades.size).toBe(0);
    expect([admin.trade, p.trade, q.trade, r.trade]).toEqual([null, null, null, null]);
  });

  test("bug fixed: a first offer to someone no longer on the map is refused", () => {
    const { world, p, admin } = scene();
    openTrade(world, p, "admin");
    // As if the admin had left without the trade being ended.
    admin.editing = "controlPanel";
    const out = offerTrade(world, p, { t: "tradeOffer", gold: 0, items: [] });
    expect(out.some((o) => o.to === "admin")).toBe(false);
    expect(admin.trade).toBeNull();
    expect(world.trades.size).toBe(0);
  });

  test("bug fixed: an item given just before the admin left stays on the ground", () => {
    const { world, map, admin } = scene();
    map.ground.push({ id: "g1", item: "Apple", x: 6, y: 6, kind: "drop", expiresAt: null });
    world.gives.push({
      at: world.tickNo,
      giver: "p",
      giverName: "p",
      target: "admin",
      mapId: map.id,
      groundId: "g1",
    });
    openControlPanel(world, admin, casino);
    const out = dueGives({ world, rng: rngByN(), now: 0, shop: () => null });
    expect(out).toEqual([]);
    expect(map.ground.map((g) => g.id)).toEqual(["g1"]);
    expect(world.gives).toEqual([]);
  });
});

describe("the Control Panel through the game (real SQLite)", () => {
  let db: Db;
  const sent: { to: string; msg: ServerMsg }[] = [];
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
  });
  const game = (): Game =>
    createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => "2026-11-21T00:00:00.000Z",
      rng: rngByN(),
      minute: () => 0,
    });
  const enter = async (g: Game, role: string | null) => {
    await g.create({
      t: "create",
      name: "Al",
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
    const l = await g.login("Al", "pw");
    if (!l.ok) {
      throw new Error(l.text);
    }
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(l.characterId);
    setRole(db, acc?.account_id ?? "", role, "2026-11-21T00:00:00.000Z");
    g.enter(l.characterId, false);
    g.intent(l.characterId, { t: "mapReady" });
    sent.length = 0;
    return l.characterId;
  };
  const got = (t: string) => sent.filter((m) => m.msg.t === t);

  test("a player's controlPanelOpen is refused and written to the cheat log", async () => {
    const g = game();
    const id = await enter(g, null);
    g.intent(id, { t: "controlPanelOpen" });
    expect(got("controlPanel")).toEqual([]);
    expect(recentCheats(db, 5).map((c) => c.reason)).toContain("Attempted Admin Access");
  });

  test("a moderator is refused too; the administrator gets in and the settings page loads", async () => {
    const g = game();
    const id = await enter(g, "moderator");
    g.intent(id, { t: "controlPanelOpen" });
    expect(got("controlPanel")).toEqual([]);
    g.leave(id);
    db.run("UPDATE accounts SET role = 'administrator'");
    const g2 = game();
    g2.enter(id, false);
    g2.intent(id, { t: "mapReady" });
    sent.length = 0;
    g2.intent(id, { t: "controlPanelOpen" });
    expect(got("controlPanel")).toHaveLength(1);
    g2.intent(id, { t: "settingsOpen" });
    expect(got("settings")).toHaveLength(1);
  });

  test("an edit that takes Server Settings from your own role does not send you the lists", async () => {
    const g = game();
    const id = await enter(g, null);
    g.leave(id);
    const all = [...PERMISSIONS];
    saveRole(
      db,
      { id: "steward", name: "Steward", rank: 3, permissions: new Set(all) },
      "2026-11-21T00:00:00.000Z",
    );
    db.run("UPDATE accounts SET role = 'steward'");
    const g2 = game();
    g2.enter(id, false);
    g2.intent(id, { t: "mapReady" });
    sent.length = 0;
    // The administrator role still holds everything, so the lockout check lets this through.
    const without = all.filter((x) => x !== "settings");
    g2.intent(id, {
      t: "roleSave",
      role: { id: "steward", name: "Steward", rank: 3, permissions: without },
      create: false,
    });
    expect(got("roleResult")).toEqual([
      { to: id, msg: { t: "roleResult", ok: true, text: expect.any(String) } },
    ]);
    expect(got("settings")).toEqual([]);
  });

  test("in the Control Panel only its own and the floating windows' intents count; editClose returns", async () => {
    const g = game();
    const id = await enter(g, "administrator");
    g.intent(id, { t: "controlPanelOpen" });
    sent.length = 0;
    // Gameplay is ignored off the map.
    g.intent(id, { t: "chat", text: "hello" });
    g.intent(id, { t: "attack", seq: 1, held: true });
    expect(sent).toEqual([]);
    // Who's Online works over the Control Panel.
    g.intent(id, { t: "whoOpen" });
    expect(got("who").length).toBeGreaterThan(0);
    g.intent(id, { t: "editClose" });
    expect(got("editor")).toContainEqual({ to: id, msg: { t: "editor", editing: false } });
    expect(got("snapshot")).toHaveLength(1);
  });
});
