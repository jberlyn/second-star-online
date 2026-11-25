/**
 * The player hub's houses (issue #36): the hub lists a character's houses; an admin previews and
 * then revokes (a demolition that cannot be undone) or transfers one (door, shops and, with the
 * owner's last house, the House Vault follow the new owner). Both are logged in `character_edits`
 * and the audit log, and the activity log keeps the item count where reconciliation expects it.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  type CharacterHub,
  EDIT_TEXT,
  HOUSE_ADMIN_TEXT,
  type HousePreview,
  type ServerMsg,
  SHOP_TEXT,
  turnKey,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { characterEdits } from "../src/persistence/character-edits.ts";
import { loadContainers } from "../src/persistence/containers.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadGround } from "../src/persistence/ground.ts";
import { loadHouseList, loadHouses } from "../src/persistence/houses.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadNpcFiles } from "../src/persistence/npcfiles.ts";
import { loadPlayerShops } from "../src/persistence/playershops.ts";
import { bjBid, bjSit } from "../src/systems/casino/blackjack.ts";
import { mayUseContainer } from "../src/systems/economy/containers.ts";
import { demolish, dropFlag } from "../src/systems/housing/houses.ts";
import { mailOpen } from "../src/systems/mail/mail.ts";
import type { Player } from "../src/systems/world/world.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let now: string;
let sent: { to: string; msg: ServerMsg }[];
const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");
const HOUSE1 = "xH11000yH1992";
const HOUSE2 = "xH21000yH2992";

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  prepareScenarioMap(db);
  db.run("UPDATE maps SET layer1 = ?", [JSON.stringify(Array.from({ length: 12 }, () => ROW_8R))]);
  db.run(
    `INSERT INTO roles (id, name, rank, permissions, created_at, updated_at)
     VALUES ('viewer', 'Viewer', 1, '["characterView"]', '2026-11-01', '2026-11-01')`,
  );
  now = "2026-11-05T09:00:00.000Z";
  sent = [];
});

/** A game; with `faults`, a server fault is recorded there instead of failing the test. */
const game = (faults?: string[]): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => now,
    rng: rngByN(),
    minute: () => 0,
    onFault: (where, err) => {
      if (!faults) {
        throw new Error(`${where}: ${String(err)}`);
      }
      faults.push(`${where}: ${String(err)}`);
    },
  });

async function makeChar(g: Game, name: string, role?: string): Promise<{ id: string; p: Player }> {
  await g.create({
    t: "create",
    name,
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
  const l = await g.login(name, "pw");
  if (!l.ok) {
    throw new Error(l.text);
  }
  if (role) {
    setRole(db, l.accountId, role, now);
  }
  return { id: l.characterId, p: enter(g, l.characterId) };
}

function enter(g: Game, id: string): Player {
  g.enter(id, false);
  g.intent(id, { t: "mapReady" });
  const p = g.world.players.get(id);
  if (!p) {
    throw new Error("not in");
  }
  p.loading = 0;
  return p;
}

const ready = (p: Player) => {
  p.itemPause = 0;
  p.stepFrames = 0;
  p.chatIn = 0;
};

/** `p` builds a house from `deed`, hovered at (x, y) on x1000y992. */
function build(g: Game, p: Player, x: number, y: number, deed = "Small House Deed"): void {
  p.char.bag[2] = { item: deed, qty: 1 };
  ready(p);
  g.intent(p.id, { t: "use", slot: 3 });
  g.intent(p.id, { t: "placeHouse", slot: 3, x, y });
}

/** `p` walks through the door at (x, y): by default the house hovered at (10, 4). */
function walkIn(g: Game, p: Player, x = 10, y = 5): void {
  p.x = x;
  p.y = y;
  p.vehicle = null;
  g.tick();
  g.intent(p.id, { t: "mapReady" });
  p.loading = 0;
  ready(p);
}

const reply = <T extends ServerMsg["t"]>(id: string, t: T) =>
  sent.findLast((s) => s.to === id && s.msg.t === t)?.msg as
    | Extract<ServerMsg, { t: T }>
    | undefined;

const texts = (id: string) =>
  sent.flatMap((m) => (m.to === id && m.msg.t === "chat" ? [m.msg.text] : []));

function hubOf(g: Game, id: string, name: string): CharacterHub {
  g.intent(id, { t: "characterOpen", seq: 1, name });
  const h = reply(id, "characterHub")?.hub;
  if (!h) {
    throw new Error("no hub");
  }
  return h;
}

function preview(
  g: Game,
  id: string,
  name: string,
  interior: string,
  to = "",
): { preview: HousePreview | null; error?: string } {
  g.intent(id, {
    t: "characterHousePreview",
    seq: 2,
    name,
    interior,
    action: to === "" ? "revoke" : "transfer",
    to,
  });
  const r = reply(id, "characterHousePreview");
  if (!r) {
    throw new Error("no preview");
  }
  return r.error === undefined ? { preview: r.preview } : { preview: r.preview, error: r.error };
}

function revoke(g: Game, id: string, name: string, interior: string, expect?: string) {
  const token = expect ?? preview(g, id, name, interior).preview?.expect ?? "";
  sent = [];
  g.intent(id, {
    t: "characterHouseRevoke",
    seq: 3,
    name,
    interior,
    expect: token,
    reason: "griefing",
  });
  return reply(id, "characterResult");
}

function transfer(g: Game, id: string, name: string, interior: string, to: string) {
  const token = preview(g, id, name, interior, to).preview?.expect ?? "";
  sent = [];
  g.intent(id, {
    t: "characterHouseTransfer",
    seq: 4,
    name,
    interior,
    to,
    expect: token,
    reason: "sold in game",
  });
  return reply(id, "characterResult");
}

/** Runs a reconciliation as `id`: its flagged lines. */
function reconcile(g: Game, id: string) {
  sent = [];
  g.intent(id, { t: "reconcileRun", seq: 9 });
  const r = sent.find((s) => s.msg.t === "reconcile")?.msg;
  const run = r?.t === "reconcile" ? r.runs[0] : undefined;
  if (!run) {
    throw new Error("no run");
  }
  return run.rows;
}

const groundNames = (interior: string) => {
  const c = /^xH(\d)(-?\d+)yH\d(-?\d+)$/.exec(interior);
  const m = c ? findMapByCoords(db, Number(c[2]), Number(c[3]), Number(c[1]) as 1 | 2) : null;
  return m ? loadGround(db, m.id, now).map((x) => x.item) : null;
};

describe("the hub's houses", () => {
  test("the hub lists each house: its map, door, interior, type, shops and the vault's count", async () => {
    const g = game();
    const vic = await makeChar(g, "Vic", "viewer");
    const bob = await makeChar(g, "Bob");
    build(g, bob.p, 10, 4, "Small Shop Deed");
    build(g, bob.p, 14, 7);
    g.world.containers.set("Bob's House Vault", ["Apple", "Knife"]);
    walkIn(g, bob.p);
    const npc = [...g.world.playerShops.values()][0]?.npc ?? "";
    sent = [];
    g.intent(bob.id, { t: "chat", text: `${npc} set Fish=5,2` });
    const hub = hubOf(g, vic.id, "Bob");
    expect(hub.houses).toEqual([
      {
        interior: HOUSE1,
        map: "x1000y992",
        x: 10,
        y: 5,
        type: "Small Shop",
        shops: [{ npc, lines: 1, stock: 0, till: 0 }],
        vaultItems: 2,
      },
      {
        interior: HOUSE2,
        map: "x1000y992",
        x: 14,
        y: 8,
        type: "Small House",
        shops: [],
        vaultItems: 2,
      },
    ]);
  });

  test("a viewer may preview but not revoke or transfer: the change is refused and cheat-logged", async () => {
    const g = game();
    const vic = await makeChar(g, "Vic", "viewer");
    const bob = await makeChar(g, "Bob");
    await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    const pv = preview(g, vic.id, "Bob", HOUSE1);
    expect(pv.preview?.vaultFate).toBe("destroyed");
    sent = [];
    g.intent(vic.id, {
      t: "characterHouseRevoke",
      seq: 3,
      name: "Bob",
      interior: HOUSE1,
      expect: pv.preview?.expect ?? "",
      reason: "x",
    });
    g.intent(vic.id, {
      t: "characterHouseTransfer",
      seq: 4,
      name: "Bob",
      interior: HOUSE1,
      to: "Ann",
      expect: "",
      reason: "x",
    });
    expect(sent).toEqual([]);
    expect(g.world.houses.get(HOUSE1)?.ownerName).toBe("Bob");
    expect(recentCheats(db, 5).map((c) => c.reason)).toEqual([
      "Attempted Admin Access",
      "Attempted Admin Access",
    ]);
  });
});

describe("revoking a house", () => {
  test("the preview lists what goes; the revoke demolishes it, moves anyone inside out and logs it for good", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    g.world.containers.set("Bob's House Vault", ["Apple", "Apple", "Knife"]);
    g.world.containersDirty.add("Bob's House Vault");
    walkIn(g, ann.p);
    expect(ann.p.map.name).toBe(HOUSE1);
    // Bob puts a Chair on the floor.
    walkIn(g, bob.p);
    bob.p.char.bag[4] = { item: "Chair", qty: 1 };
    bob.p.x = 10;
    bob.p.y = 8;
    bob.p.facing = "N";
    ready(bob.p);
    g.intent(bob.id, { t: "drop", slot: 5 });
    expect(bob.p.map.ground.some((x) => x.item === "Chair")).toBe(true);
    g.tick();
    expect(reconcile(g, god.id)).toEqual([]);

    const pv = preview(g, god.id, "Bob", HOUSE1).preview;
    expect(pv).toMatchObject({
      action: "revoke",
      owner: "Bob",
      vault: { name: "Bob's House Vault", items: ["Apple", "Apple", "Knife"] },
      vaultFate: "destroyed",
      shops: [],
      floor: [{ item: "Chair", qty: 1 }],
      inside: ["Bob", "Ann"],
    });
    // No reason: nothing happens.
    sent = [];
    g.intent(god.id, {
      t: "characterHouseRevoke",
      seq: 3,
      name: "Bob",
      interior: HOUSE1,
      expect: pv?.expect ?? "",
      reason: "  ",
    });
    expect(reply(god.id, "characterResult")).toMatchObject({
      ok: false,
      text: EDIT_TEXT.needReason,
    });

    expect(revoke(g, god.id, "Bob", HOUSE1)).toMatchObject({
      ok: true,
      text: HOUSE_ADMIN_TEXT.revoked("Bob", "x1000y992"),
    });
    // Both are out at the door, the house and its interior are gone, and so is the vault.
    expect([ann.p.map.name, ann.p.x, ann.p.y]).toEqual(["x1000y992", 10, 6]);
    expect([bob.p.map.name, bob.p.x, bob.p.y]).toEqual(["x1000y992", 10, 6]);
    expect(g.world.houses.size).toBe(0);
    expect(loadHouses(db)).toEqual([]);
    expect(loadHouseList(db)).toEqual([]);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(loadContainers(db).get("Bob's House Vault")).toBeUndefined();
    expect(texts(bob.id)).toContain(HOUSE_ADMIN_TEXT.toOwnerRevoked("x1000y992"));
    // The owner's edit log keeps it, irreversible; undo refuses it.
    const [row] = characterEdits(db, bob.id, 5);
    expect(row).toMatchObject({
      kind: "houseRevoke",
      irreversible: true,
      reason: "griefing",
      actorName: "God",
      changes: [],
    });
    expect(row?.summary).toContain("House Vault destroyed: 2 Apple, Knife.");
    expect(row?.summary).toContain("Floor destroyed: Chair.");
    sent = [];
    g.intent(god.id, {
      t: "characterUndo",
      seq: 5,
      name: "Bob",
      id: row?.id ?? "",
      reason: "oops",
    });
    expect(reply(god.id, "characterResult")).toMatchObject({
      ok: false,
      text: EDIT_TEXT.noUndoHouse,
    });
    expect(recentAudit(db, 5).find((a) => a.command === "houseRevoke")).toMatchObject({
      target: "Bob",
    });
    // What it destroyed is logged as `demolish` world events: the count still matches.
    const destroyed = db
      .query<{ item: string; qty: number }, []>(
        "SELECT item, qty FROM activity_log WHERE type = 'demolish' ORDER BY seq",
      )
      .all();
    expect(destroyed).toEqual(
      expect.arrayContaining([
        { item: "Apple", qty: -2 },
        { item: "Knife", qty: -1 },
        { item: "Chair", qty: -1 },
      ]),
    );
    g.tick();
    expect(reconcile(g, god.id)).toEqual([]);
  });

  test("SSO: the owner's House Vault goes only with their last house", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    build(g, bob.p, 10, 4);
    build(g, bob.p, 14, 7);
    g.world.containers.set("Bob's House Vault", ["Apple"]);
    const pv = preview(g, god.id, "Bob", HOUSE2).preview;
    expect(pv?.vaultFate).toBe("kept");
    expect(revoke(g, god.id, "Bob", HOUSE2)?.ok).toBe(true);
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple"]);
    expect(characterEdits(db, bob.id, 1)[0]?.summary).toContain("House Vault kept");
    expect(revoke(g, god.id, "Bob", HOUSE1)?.ok).toBe(true);
    expect(g.world.containers.has("Bob's House Vault")).toBe(false);
  });

  test("SSO: demolishing one of two houses keeps the owner's House Vault; the last one empties it", async () => {
    const g = game();
    const bob = await makeChar(g, "Bob");
    build(g, bob.p, 10, 4);
    build(g, bob.p, 14, 7);
    g.world.containers.set("Bob's House Vault", ["Apple"]);
    demolish(g.world, HOUSE1, (n) => (n === "x1000y992" ? bob.p.map : null));
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple"]);
    demolish(g.world, HOUSE2, (n) => (n === "x1000y992" ? bob.p.map : null));
    expect(g.world.containers.has("Bob's House Vault")).toBe(false);
  });

  test("a revoke over a stale preview, or of a house they do not own, is refused", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    build(g, bob.p, 10, 4);
    const old = preview(g, god.id, "Bob", HOUSE1).preview?.expect ?? "";
    g.world.containers.set("Bob's House Vault", ["Apple"]);
    expect(revoke(g, god.id, "Bob", HOUSE1, old)).toMatchObject({
      ok: false,
      text: HOUSE_ADMIN_TEXT.changed,
    });
    expect(g.world.houses.has(HOUSE1)).toBe(true);
    expect(revoke(g, god.id, "God", HOUSE1, old)).toMatchObject({
      ok: false,
      text: HOUSE_ADMIN_TEXT.noHouse("God"),
    });
  });
});

describe("transferring a house", () => {
  test("the owner's last house moves whole: door, mailbox, header, vault; the old owner loses it at once", async () => {
    let g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    g.world.containers.set("Bob's House Vault", ["Apple", "Knife"]);
    g.world.containersDirty.add("Bob's House Vault");
    walkIn(g, bob.p);
    g.tick();
    expect(reconcile(g, god.id)).toEqual([]);

    const pv = preview(g, god.id, "Bob", HOUSE1, "Ann").preview;
    expect(pv).toMatchObject({ action: "transfer", to: "Ann", vaultFate: "moved" });
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")).toMatchObject({
      ok: true,
      text: HOUSE_ADMIN_TEXT.transferred("Bob", "x1000y992", "Ann"),
    });
    expect(texts(bob.id)).toContain(HOUSE_ADMIN_TEXT.toOwnerTransferred("x1000y992", "Ann"));
    expect(texts(ann.id)).toContain(HOUSE_ADMIN_TEXT.toNewOwner("x1000y992", "Bob", true));
    // Bob stays where he stands, but the door, vault and header are Ann's now.
    expect(bob.p.map.name).toBe(HOUSE1);
    expect(bob.p.map.ground.map((x) => x.item)).toEqual([
      "Exit",
      "Ann's Door",
      "Ann's House Vault",
    ]);
    expect(bob.p.map.title).toBe("Ann's House");
    expect(mayUseContainer(bob.p, "Ann's House Vault")).toBe(false);
    expect(mayUseContainer(ann.p, "Ann's House Vault")).toBe(true);
    expect(turnKey("House Key", "Ann's Door", "Bob", "").kind).toBe("text");
    expect(turnKey("House Key", "Ann's Door", "Ann", "").kind).toBe("turn");
    expect(g.world.containers.get("Ann's House Vault")).toEqual(["Apple", "Knife"]);
    expect(g.world.containers.has("Bob's House Vault")).toBe(false);
    // Both histories keep it; neither offers undo.
    for (const id of [bob.id, ann.id]) {
      expect(characterEdits(db, id, 1)[0]).toMatchObject({
        kind: "houseTransfer",
        irreversible: false,
        reason: "sold in game",
      });
    }
    expect(characterEdits(db, ann.id, 1)[0]?.summary).toContain(
      "House Vault moved to Ann's: Apple, Knife.",
    );
    expect(recentAudit(db, 5).find((a) => a.command === "houseTransfer")).toMatchObject({
      target: "Bob",
    });
    // The vault's contents are container moves: nothing was made or destroyed.
    const moves = db
      .query<{ type: string; item: string; other: string }, []>(
        "SELECT type, item, other FROM activity_log WHERE type = 'container' ORDER BY seq",
      )
      .all();
    expect(moves).toEqual([
      { type: "container", item: "Apple", other: "Bob's House Vault" },
      { type: "container", item: "Knife", other: "Bob's House Vault" },
    ]);
    g.tick();
    expect(reconcile(g, god.id)).toEqual([]);

    // After a restart it is still Ann's.
    for (const id of [god.id, bob.id, ann.id]) {
      g.leave(id);
    }
    g = game();
    expect(loadHouses(db)).toMatchObject([{ ownerName: "Ann", interior: HOUSE1 }]);
    expect(loadHouseList(db)).toMatchObject([{ ownerId: ann.id, ownerName: "Ann" }]);
    expect(groundNames(HOUSE1)).toEqual(["Exit", "Ann's Door", "Ann's House Vault"]);
    const outdoor = findMapByCoords(db, 1000, 992);
    expect(loadGround(db, outdoor?.id ?? "", now).map((x) => x.item)).toContain("Ann's Mailbox");
    expect(findMapByCoords(db, 1000, 992, 1)).toMatchObject({
      title: "Ann's House",
      signs: ["", "", "Ann"],
    });
    expect(loadContainers(db).get("Ann's House Vault")).toEqual(["Apple", "Knife"]);
    expect(g.world.houses.get(HOUSE1)?.ownerId).toBe(ann.id);
  });

  test("a vault merges into the new owner's, and a merge that would not fit is refused before anything changes", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    g.world.containers.set("Bob's House Vault", ["Apple", "Knife"]);
    g.world.containers.set(
      "Ann's House Vault",
      Array.from({ length: 14 }, () => "Chair"),
    );
    expect(preview(g, god.id, "Bob", HOUSE1, "Ann")).toEqual({
      preview: null,
      error: HOUSE_ADMIN_TEXT.vaultFull("Ann", 16, 15),
    });
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(false);
    expect(g.world.houses.get(HOUSE1)?.ownerName).toBe("Bob");
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple", "Knife"]);
    g.world.containers.set("Ann's House Vault", ["Chair"]);
    // Ann has her vault open: it closes, so it never shows what it no longer holds.
    ann.p.container = { name: "Ann's House Vault", shown: ["Chair"] };
    expect(preview(g, god.id, "Bob", HOUSE1, "Ann").preview?.vaultFate).toBe("merged");
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(true);
    expect(g.world.containers.get("Ann's House Vault")).toEqual(["Chair", "Apple", "Knife"]);
    expect(ann.p.container).toBeNull();
  });

  test("an owner who keeps another house keeps their vault", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    build(g, bob.p, 14, 7);
    g.world.containers.set("Bob's House Vault", ["Apple"]);
    expect(preview(g, god.id, "Bob", HOUSE2, "Ann").preview?.vaultFate).toBe("kept");
    expect(transfer(g, god.id, "Bob", HOUSE2, "Ann")?.ok).toBe(true);
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple"]);
    expect(g.world.containers.has("Ann's House Vault")).toBe(false);
    expect(g.world.houses.get(HOUSE1)?.ownerName).toBe("Bob");
    expect(g.world.houses.get(HOUSE2)?.ownerName).toBe("Ann");
  });

  test("a Small Shop follows the new owner with its stock and till", async () => {
    let g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4, "Small Shop Deed");
    walkIn(g, bob.p);
    const npc = [...g.world.playerShops.values()][0]?.npc ?? "";
    bob.p.y = 9;
    g.intent(bob.id, { t: "chat", text: `${npc} set Fish=5,2` });
    const ledger = g.world.shops.get(npc);
    if (!ledger) {
      throw new Error("no ledger");
    }
    ledger.gold = 40;
    const fish = ledger.lines.find((l) => l.kind === "SEL" && l.item === "Fish");
    if (!fish) {
      throw new Error("no Fish line");
    }
    fish.stock = 3;
    ledger.dirty = true;
    g.tick();
    const pv = preview(g, god.id, "Bob", HOUSE1, "Ann").preview;
    expect(pv?.shops).toEqual([{ npc, stock: [{ item: "Fish", qty: 3 }], till: 40 }]);
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(true);
    expect(g.world.playerShops.get(npc.toLowerCase())?.ownerId).toBe(ann.id);
    expect(loadPlayerShops(db)).toEqual([{ npc, ownerId: ann.id, interior: HOUSE1 }]);
    // Bob is no longer the boss; Ann is, and the till is still there.
    sent = [];
    ready(bob.p);
    const bobGold = bob.p.char.gold;
    g.intent(bob.id, { t: "chat", text: `${npc} register 10` });
    expect(bob.p.char.gold).toBe(bobGold);
    expect(g.world.shops.get(npc)?.gold).toBe(40);
    walkIn(g, ann.p);
    ann.p.y = 9;
    sent = [];
    g.intent(ann.id, { t: "chat", text: `${npc} inventory` });
    expect(texts(ann.id)).toContain(SHOP_TEXT.till(npc, 40));
    const annGold = ann.p.char.gold;
    ready(ann.p);
    g.intent(ann.id, { t: "chat", text: `${npc} register 10` });
    expect(ann.p.char.gold).toBe(annGold + 10);
    expect(g.world.shops.get(npc)?.gold).toBe(30);
    for (const id of [god.id, bob.id, ann.id]) {
      g.leave(id);
    }
    g = game();
    expect(g.world.playerShops.get(npc.toLowerCase())?.ownerId).toBe(ann.id);
    // The file names Ann, and its stock and till survive the restart.
    const file = loadNpcFiles(db).find((f) => f.npc === npc)?.text ?? "";
    expect(file.split("\r")[0]).toBe("OWN|Ann");
    expect(g.world.npcs.get(npc.toLowerCase())?.text.split("\r")[0]).toBe("OWN|Ann");
    const hub = hubOf(g, (await makeChar(g, "Vic", "viewer")).id, "Ann");
    expect(hub.houses[0]?.shops).toMatchObject([{ npc, stock: 3, till: 30 }]);
  });

  test("the new owner must be another character that exists", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    build(g, bob.p, 10, 4);
    expect(preview(g, god.id, "Bob", HOUSE1, "Nobody").error).toBe(
      HOUSE_ADMIN_TEXT.noTarget("Nobody"),
    );
    expect(preview(g, god.id, "Bob", HOUSE1, "bob").error).toBe(HOUSE_ADMIN_TEXT.sameOwner("Bob"));
    expect(transfer(g, god.id, "Bob", HOUSE1, "Nobody")).toMatchObject({ ok: false });
    expect(g.world.houses.get(HOUSE1)?.ownerName).toBe("Bob");
  });

  test("a guild hall goes only to a member of its guild", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    bob.p.guild = "Hawks";
    build(g, bob.p, 10, 4, "Small Guild Hall Deed");
    expect(hubOf(g, god.id, "Bob").houses[0]?.type).toBe("Small Guild Hall");
    expect(preview(g, god.id, "Bob", HOUSE1, "Ann").error).toBe(
      HOUSE_ADMIN_TEXT.notGuild("Ann", "Hawks"),
    );
    ann.p.guild = "Hawks";
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(true);
    // The hall's fixtures answer to the guild, not the owner: they keep their names.
    expect(groundNames(HOUSE1)).toContain("The Hawks's Guild Vault");
  });

  test("transferring one of two houses on a map renames only its own mailbox", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    build(g, bob.p, 14, 7);
    const box1 = g.world.houses.get(HOUSE1)?.item1;
    const box2 = g.world.houses.get(HOUSE2)?.item1;
    // Bob opens the mailbox of his second house.
    const store = { load: () => [], add: () => {}, remove: () => {}, find: () => false } as never;
    bob.p.x = box2?.x ?? 0;
    bob.p.y = (box2?.y ?? 0) + 1;
    bob.p.facing = "N";
    ready(bob.p);
    mailOpen(
      bob.p,
      bob.p.map.ground.find((x) => x.x === box2?.x && x.y === box2?.y) as never,
      false,
      store,
    );
    expect(bob.p.mailUi).toBe(true);

    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(true);
    const at = (b: typeof box1) =>
      bob.p.map.ground.filter((x) => x.x === b?.x && x.y === b?.y).map((x) => x.item);
    expect(at(box1)).toEqual(["Ann's Mailbox"]);
    expect(at(box2)).toEqual(["Bob's Mailbox"]);
    expect(g.world.houses.get(HOUSE1)?.item1?.item).toBe("Ann's Mailbox");
    expect(g.world.houses.get(HOUSE2)?.item1).toEqual(box2);
    // The session at his other house's mailbox is still his.
    expect(bob.p.mailUi).toBe(true);
    // Giving that house away too ends it.
    expect(transfer(g, god.id, "Bob", HOUSE2, "Ann")?.ok).toBe(true);
    expect(at(box2)).toEqual(["Ann's Mailbox"]);
    expect(bob.p.mailUi).toBe(false);
  });

  test("a House Vault window open in the transferred interior closes; one at another house stays", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    build(g, bob.p, 14, 7);
    g.world.containers.set("Bob's House Vault", ["Apple"]);
    walkIn(g, bob.p, 14, 8);
    expect(bob.p.map.name).toBe(HOUSE2);
    bob.p.container = { name: "Bob's House Vault", shown: ["Apple"] };
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(true);
    expect(bob.p.container).toEqual({ name: "Bob's House Vault", shown: ["Apple"] });
    // The vault stays Bob's (he kept a house), but this interior's fixture is Ann's now.
    expect(transfer(g, god.id, "Bob", HOUSE2, "Ann")?.ok).toBe(true);
    expect(bob.p.container).toBeNull();
    expect(sent.some((x) => x.to === bob.id && x.msg.t === "vault" && x.msg.closed === true)).toBe(
      true,
    );
  });

  test("a custom shop title keeps furniture with the owner, and a transfer moves it", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4, "Small Shop Deed");
    walkIn(g, bob.p);
    const npc = [...g.world.playerShops.values()][0]?.npc ?? "";
    bob.p.y = 9;
    // Bob titles his shop after Ann: in 1.6 that handed Ann the furniture.
    g.intent(bob.id, { t: "chat", text: `${npc} title Ann's Market` });
    expect(bob.p.map.title).toBe("Ann's Market");
    walkIn(g, ann.p);
    walkIn(g, god.p);
    const flags = () => [bob.p, ann.p, god.p].map((p) => dropFlag(g.world, p));
    expect(flags()).toEqual([0, 1, 1]);
    // The house goes to God: the right goes with it, and the title stays.
    expect(transfer(g, god.id, "Bob", HOUSE1, "God")?.ok).toBe(true);
    expect(bob.p.map.title).toBe("Ann's Market");
    expect(flags()).toEqual([1, 1, 0]);
  });

  test("a failed write puts the house back as it was and sends nothing", async () => {
    const faults: string[] = [];
    const g = game(faults);
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4, "Small Shop Deed");
    g.world.containers.set("Bob's House Vault", ["Apple"]);
    walkIn(g, bob.p);
    g.tick();
    const npc = [...g.world.playerShops.values()][0]?.npc ?? "";
    const token = preview(g, god.id, "Bob", HOUSE1, "Ann").preview?.expect ?? "";
    db.run(
      "CREATE TRIGGER boom BEFORE INSERT ON character_edits BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    sent = [];
    g.intent(god.id, {
      t: "characterHouseTransfer",
      seq: 4,
      name: "Bob",
      interior: HOUSE1,
      to: "Ann",
      expect: token,
      reason: "sold",
    });
    expect(faults).toHaveLength(1);
    // Nobody heard of it: no rename, no line, no result.
    expect(sent.filter((x) => x.to === bob.id || x.to === ann.id)).toEqual([]);
    expect(sent.some((x) => x.msg.t === "characterResult")).toBe(false);
    // Memory is as it was.
    expect(g.world.houses.get(HOUSE1)).toMatchObject({ ownerId: bob.id, ownerName: "Bob" });
    expect(g.world.houseList[0]).toMatchObject({ ownerId: bob.id, ownerName: "Bob" });
    expect(bob.p.map.ground.map((x) => x.item)).toEqual(["Exit"]);
    expect(bob.p.map.title).toBe("Bob's Shop");
    expect(g.world.playerShops.get(npc.toLowerCase())?.ownerId).toBe(bob.id);
    expect(g.world.npcs.get(npc.toLowerCase())?.text).toContain("OWN|Bob");
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple"]);
    expect(g.world.groundLog).toEqual([]);
    // And so is the database.
    expect(loadHouses(db)).toMatchObject([{ ownerName: "Bob" }]);
    expect(loadPlayerShops(db)[0]?.ownerId).toBe(bob.id);

    // A revoke that fails leaves the house standing; whoever it moved reloads from the database.
    const g2faults = faults.length;
    const keep = enter(g, god.id);
    walkIn(g, ann.p);
    expect(ann.p.map.name).toBe(HOUSE1);
    const rt = preview(g, keep.id, "Bob", HOUSE1).preview?.expect ?? "";
    g.intent(keep.id, {
      t: "characterHouseRevoke",
      seq: 3,
      name: "Bob",
      interior: HOUSE1,
      expect: rt,
      reason: "x",
    });
    expect(faults.length).toBe(g2faults + 1);
    expect(g.world.houses.has(HOUSE1)).toBe(true);
    expect(g.world.interiorsToDelete.size).toBe(0);
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
    expect(g.world.players.has(ann.id)).toBe(false);
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple"]);
    const l2 = findMapByCoords(db, 1000, 992)?.layers[1] ?? [];
    expect(l2[2]?.split(" ").slice(8, 11)).not.toEqual(["G3", "G3", "G3"]);
    expect(bob.p.map.layers[1][2]?.split(" ").slice(8, 11)).toEqual(l2[2]?.split(" ").slice(8, 11));
    // With the fault gone, it works.
    db.run("DROP TRIGGER boom");
    enter(g, god.id);
    expect(revoke(g, god.id, "Bob", HOUSE1)?.ok).toBe(true);
  });

  test("a revoke saves those it moved out, with a blackjack hand's purses, before any restart", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    for (const [x, y] of [
      [10, 4],
      [9, 4],
      [10, 8],
      [8, 8],
      [12, 8],
      [5, 8],
    ] as const) {
      if (!g.world.houses.has(HOUSE1)) {
        build(g, bob.p, x, y, "Large House Deed");
      }
    }
    const door = g.world.houses.get(HOUSE1)?.item2;
    if (!door) {
      throw new Error("not built");
    }
    walkIn(g, bob.p, door.x, door.y);
    walkIn(g, ann.p, door.x, door.y);
    const table = bob.p.map.ground.find((x) => x.item === "Blackjack Table");
    if (!table) {
      throw new Error("no table");
    }
    for (const [p, dx] of [
      [bob.p, -1],
      [ann.p, 1],
    ] as const) {
      p.x = table.x + dx;
      p.y = table.y;
      p.char.gold = 100;
      ready(p);
      bjSit(g.world, p, table);
    }
    const cards = rngByN({ 13: [10, 9, 10, 8] });
    bjBid(g.world, bob.p, "50", cards);
    bjBid(g.world, ann.p, "30", cards);
    g.tick();
    expect(revoke(g, god.id, "Bob", HOUSE1)?.ok).toBe(true);
    const outdoor = findMapByCoords(db, 1000, 992);
    // No tick, no logout: what is saved already matches the live players.
    for (const p of [bob.p, ann.p]) {
      expect(p.map.name).toBe("x1000y992");
      const row = db
        .query<{ map_id: string; x: number; y: number }, [string]>(
          "SELECT map_id, x, y FROM characters WHERE id = ?",
        )
        .get(p.id);
      expect(row).toEqual({ map_id: outdoor?.id ?? "", x: door.x, y: door.y + 1 });
      expect(loadInventory(db, p.id).gold).toBe(p.char.gold);
    }
    // The hand was settled: the stakes changed hands.
    expect(bob.p.char.gold + ann.p.char.gold).toBe(200);
    expect(bob.p.char.gold).not.toBe(100);
  });

  test("a preview of a demolished house never applies to one rebuilt the same in its place", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    build(g, bob.p, 10, 4);
    const old = preview(g, god.id, "Bob", HOUSE1).preview?.expect ?? "";
    // Decay takes it; Bob builds the same house in the same place.
    demolish(g.world, HOUSE1, (n) => (n === "x1000y992" ? bob.p.map : null));
    g.world.houseList = [];
    g.tick();
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    build(g, bob.p, 10, 4);
    expect(g.world.houses.has(HOUSE1)).toBe(true);
    const fresh = preview(g, god.id, "Bob", HOUSE1).preview;
    expect(fresh?.expect).not.toBe(old);
    expect(revoke(g, god.id, "Bob", HOUSE1, old)).toMatchObject({
      ok: false,
      text: HOUSE_ADMIN_TEXT.changed,
    });
    expect(g.world.houses.has(HOUSE1)).toBe(true);
  });

  test("revoking a Small Shop destroys its stock and till as logged, and closes its windows", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4, "Small Shop Deed");
    walkIn(g, bob.p);
    const npc = [...g.world.playerShops.values()][0]?.npc ?? "";
    bob.p.y = 9;
    g.intent(bob.id, { t: "chat", text: `${npc} set Fish=5,2` });
    const ledger = g.world.shops.get(npc);
    const fish = ledger?.lines.find((l) => l.kind === "SEL" && l.item === "Fish");
    if (!ledger || !fish) {
      throw new Error("no shop");
    }
    // The stock and till arrive as play would bring them: setup the baseline takes in.
    fish.stock = 3;
    ledger.gold = 40;
    ledger.dirty = true;
    g.tick();
    expect(reconcile(g, god.id)).toEqual([]);
    // Ann has the shop's window open.
    walkIn(g, ann.p);
    ann.p.shop = { npc, mode: "buy" };
    const pv = preview(g, god.id, "Bob", HOUSE1).preview;
    expect(pv?.shops).toEqual([{ npc, stock: [{ item: "Fish", qty: 3 }], till: 40 }]);
    expect(revoke(g, god.id, "Bob", HOUSE1)?.ok).toBe(true);
    expect(ann.p.shop).toBeNull();
    expect(sent.some((x) => x.to === ann.id && x.msg.t === "npcClosed")).toBe(true);
    expect(g.world.playerShops.size).toBe(0);
    const rows = db
      .query<{ item: string | null; qty: number; gold: number }, []>(
        "SELECT item, qty, gold FROM activity_log WHERE type = 'demolish' ORDER BY seq",
      )
      .all();
    expect(rows).toEqual(
      expect.arrayContaining([
        { item: "Fish", qty: -3, gold: 0 },
        { item: null, qty: 0, gold: -40 },
      ]),
    );
    g.tick();
    expect(reconcile(g, god.id)).toEqual([]);
  });

  test("a revoke clears respawn points inside and moves an admin in the Control Panel over it", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    const interiorId = findMapByCoords(db, 1000, 992, 1)?.id ?? "";
    // Ann's respawn point is inside (she rested there), but she stands outside.
    ann.p.char.respawn = { mapId: interiorId, x: 5, y: 5 };
    // God walks in, then opens the Control Panel there and revokes it.
    walkIn(g, god.p);
    g.intent(god.id, { t: "controlPanelOpen" });
    expect(god.p.editing).toBeTruthy();
    expect(preview(g, god.id, "Bob", HOUSE1).preview?.inside).toEqual(["God"]);
    expect(revoke(g, god.id, "Bob", HOUSE1)?.ok).toBe(true);
    expect(ann.p.char.respawn).toBeNull();
    expect(god.p.editing).toBeTruthy();
    expect([god.p.map.name, god.p.x, god.p.y]).toEqual(["x1000y992", 10, 6]);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    g.tick();
    const row = db
      .query<{ respawn_map_id: string | null }, [string]>(
        "SELECT respawn_map_id FROM characters WHERE id = ?",
      )
      .get(ann.id);
    expect(row?.respawn_map_id).not.toBe(interiorId);
  });

  test("a guild hall goes to a member of its guild who is offline", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    bob.p.guild = "Hawks";
    build(g, bob.p, 10, 4, "Small Guild Hall Deed");
    g.leave(ann.id);
    db.run("UPDATE characters SET guild = 'Hawks' WHERE id = ?", [ann.id]);
    const pv = preview(g, god.id, "Bob", HOUSE1, "Ann").preview;
    expect(pv).toMatchObject({ guild: "Hawks", renames: [] });
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(true);
    expect(g.world.houses.get(HOUSE1)?.ownerId).toBe(ann.id);
  });

  test("a revoke or transfer ends a session at the house's mailbox, on the client too", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    build(g, bob.p, 14, 7);
    const store = { load: () => [], add: () => {}, remove: () => {}, find: () => false } as never;
    const open = (interior: string) => {
      const box = g.world.houses.get(interior)?.item1;
      bob.p.x = box?.x ?? 0;
      bob.p.y = (box?.y ?? 0) + 1;
      bob.p.facing = "N";
      ready(bob.p);
      const fixture = bob.p.map.ground.find((x) => x.x === box?.x && x.y === box?.y);
      mailOpen(bob.p, fixture as never, false, store);
      expect(bob.p.mailUi).toBe(true);
    };
    open(HOUSE1);
    expect(transfer(g, god.id, "Bob", HOUSE1, "Ann")?.ok).toBe(true);
    expect(bob.p.mailUi).toBe(false);
    expect(sent.some((x) => x.to === bob.id && x.msg.t === "mailClosed")).toBe(true);
    open(HOUSE2);
    expect(revoke(g, god.id, "Bob", HOUSE2)?.ok).toBe(true);
    expect(bob.p.mailUi).toBe(false);
    expect(sent.some((x) => x.to === bob.id && x.msg.t === "mailClosed")).toBe(true);
  });

  test("a revoke clears the house's blackjack tables, so a player away mid-hand is not seated again", async () => {
    const g = game();
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    for (const [x, y] of [
      [10, 4],
      [9, 4],
      [10, 8],
      [8, 8],
      [12, 8],
      [5, 8],
    ] as const) {
      if (!g.world.houses.has(HOUSE1)) {
        build(g, bob.p, x, y, "Large House Deed");
      }
    }
    const door = g.world.houses.get(HOUSE1)?.item2;
    if (!door) {
      throw new Error("not built");
    }
    walkIn(g, bob.p, door.x, door.y);
    walkIn(g, ann.p, door.x, door.y);
    const table = bob.p.map.ground.find((x) => x.item === "Blackjack Table");
    if (!table) {
      throw new Error("no table");
    }
    for (const [p, dx] of [
      [bob.p, -1],
      [ann.p, 1],
    ] as const) {
      p.x = table.x + dx;
      p.y = table.y;
      p.char.gold = 100;
      ready(p);
      bjSit(g.world, p, table);
    }
    const cards = rngByN({ 13: [10, 9, 10, 8] });
    bjBid(g.world, bob.p, "50", cards);
    bjBid(g.world, ann.p, "30", cards);
    g.tick();
    // Ann drops mid-hand: her seat waits for her return.
    g.leave(ann.id);
    const seat = [...g.world.casinoTables.values()][0]?.seats[1];
    expect(seat?.awayIn).toBeGreaterThan(0);
    expect(revoke(g, god.id, "Bob", HOUSE1)?.ok).toBe(true);
    expect(
      [...g.world.casinoTables.keys()].filter((k) =>
        k.toLowerCase().startsWith(HOUSE1.toLowerCase()),
      ),
    ).toEqual([]);
    // She comes back within the grace: no table, no locked keys.
    const back = enter(g, ann.id);
    expect(back.casino).toBeNull();
    expect(back.keyLock).toBe(false);
    expect(back.char.gold).toBe(loadInventory(db, ann.id).gold);
  });

  test("a failure after the change, as its activity is written, still puts memory back", async () => {
    const faults: string[] = [];
    const g = game(faults);
    const god = await makeChar(g, "God", "administrator");
    const bob = await makeChar(g, "Bob");
    const ann = await makeChar(g, "Ann");
    build(g, bob.p, 10, 4);
    g.world.containers.set("Bob's House Vault", ["Apple"]);
    g.tick();
    const token = preview(g, god.id, "Bob", HOUSE1, "Ann").preview?.expect ?? "";
    db.run(
      "CREATE TRIGGER boom BEFORE INSERT ON activity_log BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    sent = [];
    g.intent(god.id, {
      t: "characterHouseTransfer",
      seq: 4,
      name: "Bob",
      interior: HOUSE1,
      to: "Ann",
      expect: token,
      reason: "sold",
    });
    db.run("DROP TRIGGER boom");
    expect(faults).toHaveLength(1);
    expect(sent.filter((x) => x.to === bob.id || x.to === ann.id)).toEqual([]);
    expect(g.world.houses.get(HOUSE1)?.ownerName).toBe("Bob");
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple"]);
    expect(g.world.containers.has("Ann's House Vault")).toBe(false);
    expect(loadHouses(db)).toMatchObject([{ ownerName: "Bob" }]);
  });
});
