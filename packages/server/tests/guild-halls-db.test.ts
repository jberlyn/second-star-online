/**
 * Guild halls belong to their guild (issue #16), with real SQL on in-memory SQLite: a hall names its
 * guild by id, any member keeps it standing, a disband takes it and the vault (after a warning, and
 * never with items left in a vault a hall still reaches), and the start matches halls built before
 * to their guild or demolishes those whose guild is gone.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { saveContainer } from "../src/persistence/containers.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadGuilds } from "../src/persistence/guilds.ts";
import { loadHouseList, loadHouses } from "../src/persistence/houses.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { dropFlag } from "../src/systems/housing/houses.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];
let now: string;

const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");
const HALL = "xH11000yH1992";
const VAULT = "The Knights's Guild Vault";

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  prepareScenarioMap(db);
  sent = [];
  now = "2026-11-05T00:00:00.000Z";
  db.run("UPDATE maps SET layer1 = ?", [JSON.stringify(Array.from({ length: 12 }, () => ROW_8R))]);
});

const game = (): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => now,
    rng: rngByN(),
    minute: () => 0,
  });

async function makeChar(g: Game, name: string): Promise<string> {
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
  return l.characterId;
}

const texts = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

const openScreen = (g: Game, id: string) => {
  const p = g.world.players.get(id);
  if (p) {
    p.guildScreen = true;
    p.keyLock = true;
  }
};

/** Al founds the Knights, Bo joins, and Bo builds a Small Guild Hall hovered at (10, 4). */
async function knightsWithHall(g: Game): Promise<{ al: string; bo: string }> {
  const al = await makeChar(g, "Al");
  const bo = await makeChar(g, "Bo");
  g.enter(al, false);
  g.enter(bo, false);
  g.intent(bo, { t: "mapReady" });
  openScreen(g, al);
  g.intent(al, { t: "guildCreate", name: "Knights", alignment: "G" });
  g.intent(al, { t: "chat", text: "/invite Bo" });
  g.intent(bo, { t: "chat", text: "accept" });
  const p = g.world.players.get(bo);
  if (p) {
    p.char.bag[2] = { item: "Small Guild Hall Deed", qty: 1 };
  }
  g.intent(bo, { t: "use", slot: 3 });
  g.intent(bo, { t: "placeHouse", slot: 3, x: 10, y: 4 });
  return { al, bo };
}

const knightsId = () => loadGuilds(db).find((r) => r.name === "Knights")?.id;

describe("a hall is its guild's", () => {
  test("design change: a hall names its guild by id and keeps it over a restart", async () => {
    const g = game();
    await knightsWithHall(g);
    expect(findMapByCoords(db, 1000, 992, 1)?.title).toBe("Hall of the Knights");
    const id = knightsId();
    expect(id).toBeDefined();
    expect(loadHouses(db)).toMatchObject([{ interior: HALL, ownerName: "Bo", guildId: id }]);
    expect(game().world.houses.get(HALL)?.guildId).toBe(id);
  });

  test("design change: its members furnish it by the guild, whatever its header says", async () => {
    const g = game();
    const { al, bo } = await knightsWithHall(g);
    const cy = await makeChar(g, "Cy");
    g.enter(cy, false);
    const hall = g.world.houses.get(HALL);
    const interior = findMapByCoords(db, 1000, 992, 1);
    expect(hall && interior).toBeTruthy();
    for (const id of [al, bo, cy]) {
      const p = g.world.players.get(id);
      if (p && interior) {
        p.map = { ...p.map, name: interior.name, title: "The Round Table" };
      }
    }
    const flag = (id: string) => {
      const p = g.world.players.get(id);
      return p ? dropFlag(g.world, p) : null;
    };
    expect([flag(al), flag(bo), flag(cy)]).toEqual([0, 0, 1]);
  });

  test("design change: any member keeps the hall standing; a builder who left does not", async () => {
    let g = game();
    const { al, bo } = await knightsWithHall(g);
    g.leave(al);
    g.leave(bo);
    // Al logs in a month on: he is a member, so the hall is seen though Bo built it.
    now = "2026-12-10T00:00:00.000Z";
    g = game();
    g.enter(al, false);
    expect(loadHouseList(db)).toMatchObject([{ interior: HALL, month: "2026-12" }]);
    // Bo leaves the guild; two months on only Bo logs in, and the hall is demolished.
    g.enter(bo, false);
    openScreen(g, bo);
    g.intent(bo, { t: "guildAction", act: "leave", viewing: "Knights" });
    g.leave(al);
    g.leave(bo);
    now = "2027-02-10T00:00:00.000Z";
    g = game();
    g.enter(bo, false);
    expect(loadHouses(db)).toEqual([]);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
  });
});

describe("disbanding takes the halls and the vault", () => {
  test("design change: refused while the vault holds items, warned, then the halls go and the name is free", async () => {
    const g = game();
    const { al, bo } = await knightsWithHall(g);
    g.world.containers.set(VAULT, ["Gold Crown"]);
    g.world.containersDirty.add(VAULT);
    openScreen(g, al);
    g.intent(al, { t: "guildAction", act: "disband", viewing: "Knights" });
    expect(texts(al)).toContain("Empty the Guild Vault before you disband the guild.");
    expect(loadGuilds(db)[0]?.disbanded).toBe(false);

    g.world.containers.delete(VAULT);
    g.world.containersDirty.add(VAULT);
    g.intent(al, { t: "guildAction", act: "disband", viewing: "Knights" });
    expect(texts(al)).toContain(
      "Disbanding the guild demolishes its hall and everything inside. Press Disband again to disband it.",
    );
    expect(loadGuilds(db)[0]?.disbanded).toBe(false);
    expect(loadHouses(db)).toHaveLength(1);

    g.intent(al, { t: "guildAction", act: "disband", viewing: "Knights" });
    expect(loadGuilds(db)[0]?.disbanded).toBe(true);
    expect(loadHouses(db)).toEqual([]);
    expect(loadHouseList(db)).toEqual([]);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    const ground = g.world.rooms.get("x1000y992")?.map.ground.map((x) => x.item) ?? [];
    expect(ground).not.toContain("Exit");

    // Bo founds the name again: a new guild with no hall and an empty vault.
    openScreen(g, bo);
    g.intent(bo, { t: "guildCreate", name: "Knights", alignment: "E" });
    expect(g.world.players.get(bo)?.guild).toBe("Knights");
    expect(loadGuilds(db)).toMatchObject([{ name: "Knights", leaderName: "Bo", disbanded: false }]);
    expect(g.world.containers.get(VAULT)).toBeUndefined();
  });

  test("design change: the warning lapses when the Guild Center closes", async () => {
    const g = game();
    const { al } = await knightsWithHall(g);
    openScreen(g, al);
    g.intent(al, { t: "guildAction", act: "disband", viewing: "Knights" });
    g.intent(al, { t: "guildClose" });
    openScreen(g, al);
    g.intent(al, { t: "guildAction", act: "disband", viewing: "Knights" });
    expect(loadGuilds(db)[0]?.disbanded).toBe(false);
    expect(loadHouses(db)).toHaveLength(1);
  });
});

describe("upgrading halls built before they named their guild", () => {
  test("design change: a hall is matched to its live guild at start, by its vault", async () => {
    const g = game();
    await knightsWithHall(g);
    db.run("UPDATE houses SET guild_id = ''");
    // A retitled hall is still found by its Guild Vault.
    db.run("UPDATE maps SET title = 'The Round Table' WHERE slot = 1");
    game();
    expect(loadHouses(db)).toMatchObject([{ interior: HALL, guildId: knightsId() }]);
  });

  test("design change: a disbanded guild's hall is demolished and its vault emptied at start", async () => {
    const g = game();
    await knightsWithHall(g);
    saveContainer(db, VAULT, ["Gold Crown"]);
    for (const p of [...g.world.players.keys()]) {
      g.leave(p);
    }
    expect(game().world.containers.get(VAULT)).toEqual(["Gold Crown"]);
    db.run("UPDATE houses SET guild_id = ''");
    db.run("UPDATE guilds SET disbanded = 1");
    const g2 = game();
    expect(loadHouses(db)).toEqual([]);
    expect(loadHouseList(db)).toEqual([]);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(g2.world.containers.get(VAULT)).toBeUndefined();
    expect(game().world.containers.get(VAULT)).toBeUndefined();
  });
});
