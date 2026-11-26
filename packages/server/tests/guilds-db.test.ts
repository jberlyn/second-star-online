/**
 * Guild persistence (real SQL on in-memory SQLite): guild rows (migration 20261107_16)
 * from create to disband and a create of the same name again, the characters' `Guild` field
 * written with each change, and the login lines read from the rows.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadCharacterGuild, loadGuilds } from "../src/persistence/guilds.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
});

const game = (): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => "2026-11-07T00:00:00.000Z",
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

/** As if the Guild Center were open (the click is covered by guilds.test.ts). */
const openScreen = (g: Game, id: string) => {
  const p = g.world.players.get(id);
  if (p) {
    p.guildScreen = true;
    p.keyLock = true;
  }
};

describe("guild rows (migration 20261107_16)", () => {
  test("create, join, exile and disband are written with the fields; a restart reads them", async () => {
    const g = game();
    const al = await makeChar(g, "Al");
    const bo = await makeChar(g, "Bo");
    g.enter(al, false);
    g.enter(bo, false);
    openScreen(g, al);
    g.intent(al, { t: "guildCreate", name: "Knights", alignment: "N" });
    expect(loadCharacterGuild(db, al)).toBe("Knights");
    g.intent(al, { t: "chat", text: "/invite Bo" });
    g.intent(bo, { t: "chat", text: "accept" });
    expect(loadCharacterGuild(db, bo)).toBe("Knights");
    const [row] = loadGuilds(db);
    expect(row).toMatchObject({
      name: "Knights",
      alignment: "N",
      colour: 0,
      leaderId: al,
      leaderName: "Al",
      members: [{ id: bo, name: "Bo" }],
      disbanded: false,
    });
    expect(game().world.guilds.get("knights")?.members).toEqual([{ id: bo, name: "Bo" }]);

    // Bo logs off; Al exiles him: his field stays until he logs in.
    g.leave(bo);
    openScreen(g, al);
    g.intent(al, { t: "guildAction", act: "exile", viewing: "Knights", member: "Bo" });
    expect(loadGuilds(db)[0]?.members).toEqual([]);
    expect(loadCharacterGuild(db, bo)).toBe("Knights");
    sent = [];
    g.enter(bo, false);
    expect(texts(bo)).toContain("You have been kicked out of the Knights");
    expect(loadCharacterGuild(db, bo)).toBe("");

    // Disband: the row stays marked, so an offline member is told at login. After a restart the
    // name is free for anyone (issue #16): Bo founds it, as a new row that replaces the old one.
    openScreen(g, al);
    g.intent(al, { t: "guildAction", act: "disband", viewing: "Knights" });
    const [disbanded] = loadGuilds(db);
    expect(disbanded).toMatchObject({ disbanded: true, leaderId: al });
    expect(loadCharacterGuild(db, al)).toBe("");
    const g2 = game();
    g2.enter(al, false);
    g2.enter(bo, false);
    openScreen(g2, bo);
    g2.intent(bo, { t: "guildCreate", name: "knights", alignment: "E" });
    const rows = loadGuilds(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "knights", leaderName: "Bo", disbanded: false });
    expect(rows[0]?.id).not.toBe(disbanded?.id);
  });

  test("a member logging in hails the guild", async () => {
    const g = game();
    const al = await makeChar(g, "Al");
    const bo = await makeChar(g, "Bo");
    g.enter(al, false);
    g.enter(bo, false);
    openScreen(g, al);
    g.intent(al, { t: "guildCreate", name: "Knights", alignment: "G" });
    g.intent(al, { t: "chat", text: "/invite Bo" });
    g.intent(bo, { t: "chat", text: "ACCEPT" });
    g.leave(bo);
    sent = [];
    g.enter(bo, false);
    expect(texts(al)).toContain("Hail your guildmate Bo!");
    expect(texts(bo)).toContain("Hail your guildmate Bo!");
  });
});
