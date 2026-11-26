/**
 * Classes as an operator builds them (issue #15), on a real game and content service: the Class
 * window and its Change button, a trainer's list saying what a class with paths needs, a spell only
 * some classes may cast, the publish checks on class references, and removing a class, which moves
 * the characters in it when the change is published.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ClassRow } from "@secondstaronline/data";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { type ContentData, installContent, type ServerMsg } from "@secondstaronline/shared";

import { type ContentActor, ContentService } from "../src/content/service.ts";
import { classProblems } from "../src/content/validate.ts";
import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { Player } from "../src/systems/world/world.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

let db: Db;
let service: ContentService;
let game: Game;
let sent: { to: string; msg: ServerMsg }[];
const wall = Date.UTC(2026, 10, 26, 12, 0, 0);
let t = 0;
let ips = 0;

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
  t = 0;
  let live: Game | null = null;
  service = new ContentService({
    db,
    now: () => new Date(wall + t++).toISOString(),
    releasePacks: RELEASE_PACK_DIRS,
    onPublish: (store, restoring) => {
      installContent(store);
      live?.contentPublished(store.hash, restoring);
    },
    classesInUse: () => live?.classesInUse() ?? new Map(),
  });
  installContent(service.store());
  game = createGame({
    db,
    content: service,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => new Date(wall).toISOString(),
    rng: NEVER_PUSH,
    onFault: (where, err) => {
      throw new Error(`${where}: ${String(err)}`);
    },
  });
  live = game;
});

async function make(name: string, online = true) {
  ips += 1;
  await game.create(
    {
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
    },
    `10.0.4.${ips}`,
  );
  const l = await game.login(name, "pw", "10.0.0.1");
  if (!l.ok) {
    throw new Error(l.text);
  }
  if (online) {
    game.enter(l.characterId, false, "10.0.0.7");
    game.intent(l.characterId, { t: "mapReady" });
  }
  return l;
}

/** An administrator God, online, who drafts and publishes. */
async function admin(): Promise<ContentActor> {
  const god = await make("God", false);
  setRole(db, god.accountId, "administrator", new Date(wall).toISOString());
  return { accountId: god.accountId, name: "God" };
}

/** Publishes class rows changed by `edit` (each changed row drafted, then the draft published). */
function publishClasses(actor: ContentActor, edit: (classes: ClassRow[]) => void): void {
  const before = service.publishedContent().classes.classes;
  const after = structuredClone(before) as ClassRow[];
  edit(after);
  for (const c of after) {
    const was = before.find((b) => b.code === c.code);
    if (JSON.stringify(was) !== JSON.stringify(c)) {
      const r = service.draftSet(
        actor,
        { dataset: "classes", part: "classes", key: String(c.code) },
        "set",
        c,
      );
      expect(r.ok ? "ok" : r.error).toBe("ok");
    }
  }
  const done = service.publish(actor, service.draftRev(), "Classes", game.contentWorld);
  expect(done.ok ? "ok" : done.error).toBe("ok");
}

const row = (cs: ClassRow[], code: number) => cs.find((c) => c.code === code) as ClassRow;
const chats = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const windowOf = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "classWindow" ? [m.msg.view] : [])).at(-1);

describe("the Class window", () => {
  test("Classic's players never get it (1.6 had none)", async () => {
    const ann = await make("Ann");
    sent.length = 0;
    game.intent(ann.characterId, { t: "classOpen" });
    expect(windowOf(ann.characterId)).toBeUndefined();
    game.intent(ann.characterId, { t: "classPromote", code: 4 });
    expect(sent.filter((m) => m.to === ann.characterId)).toEqual([]);
  });

  test("your class, each way out with its checks and trainers; Change promotes and saves", async () => {
    const actor = await admin();
    publishClasses(actor, (cs) => {
      row(cs, 1).description = "A fighter.";
      row(cs, 1).perks = [{ kind: "melee", value: 1 }];
      row(cs, 4).paths = [
        {
          from: [1],
          where: "both",
          requires: [{ needs: "level", atLeast: 1 }],
          gold: 40,
          grants: { skills: [{ skill: "Thrust", to: 12 }], hpMax: 25 },
          text: "Hit things harder.",
        },
      ];
    });
    const ann = await make("Ann");
    const a = game.world.players.get(ann.characterId) as Player;
    a.char.gold = 30;
    setNpcFile(game.world.npcs, "Amber", ["BIO|A trainer", "TRN|Grunt:100"].join("\r"));
    sent.length = 0;
    game.intent(ann.characterId, { t: "classOpen" });
    const view = windowOf(ann.characterId);
    expect(view?.current).toEqual({
      code: 1,
      name: "Fighter",
      description: "A fighter.",
      icon: null,
      perks: ["+1 melee attack power"],
    });
    // 1.6's promotion to Grunt is listed too, as a trainer's way; the path is the window's.
    expect(view?.ways.filter((w) => w.to.code === 4).map((w) => w.here)).toEqual([false, true]);
    const grunt = view?.ways.find((w) => w.to.code === 4 && w.here);
    expect(grunt).toMatchObject({
      text: "Hit things harder.",
      trainers: ["Amber"],
      here: true,
      ready: false,
      grants: ["Thrust raised to 12", "Full HP raised to 25"],
    });
    expect(grunt?.checks).toEqual([
      { label: "level 1 (you have 1)", met: true },
      { label: "40 gold", met: false },
    ]);
    sent.length = 0;
    game.intent(ann.characterId, { t: "classPromote", code: 4 });
    expect(chats(ann.characterId)).toEqual(["You need 40 gold."]);
    expect(a.char.classCode).toBe(1);
    a.char.gold = 50;
    sent.length = 0;
    game.intent(ann.characterId, { t: "classPromote", code: 4 });
    expect(chats(ann.characterId)).toEqual(["Congratulations, you are now a Grunt!"]);
    expect(a.char.classCode).toBe(4);
    expect(windowOf(ann.characterId)?.current.name).toBe("Grunt");
    expect(
      db
        .query<{ class_code: number; gold: number; hp_max: number }, [string]>(
          "SELECT class_code, gold, hp_max FROM characters WHERE id = ?",
        )
        .get(ann.characterId),
    ).toEqual({ class_code: 4, gold: 10, hp_max: 25 });
    // The activity log has the gold paid and the class change.
    expect(
      db
        .query<{ type: string; gold: number }, []>(
          "SELECT type, gold FROM activity_log WHERE character = 'Ann' AND type IN ('pay', 'class') ORDER BY id",
        )
        .all(),
    ).toEqual(expect.arrayContaining([{ type: "pay", gold: -40 }]));
  });
});

describe("a trainer's list", () => {
  test("a class with paths says what it needs, each marked; 1.6's say nothing more", async () => {
    const actor = await admin();
    publishClasses(actor, (cs) => {
      row(cs, 5).paths = [{ from: [1], requires: [{ needs: "Slash", atLeast: 40 }] }];
    });
    const ann = await make("Ann");
    const a = game.world.players.get(ann.characterId) as Player;
    a.char.gold = 20;
    setNpcFile(
      game.world.npcs,
      "Amber",
      ["BIO|A trainer", "TRN|Grunt:100", "TRN|Swordsman:20"].join("\r"),
    );
    // Amber stands in the map's first roster slot, her Bio open.
    const slot = a.map.slots[0];
    if (slot) {
      slot.species = "Amber";
    }
    a.bio = { npc: "Amber" } as never;
    sent.length = 0;
    game.intent(ann.characterId, { t: "shopList", mode: "train" });
    const shop = sent.find((m) => m.msg.t === "shop")?.msg;
    expect(shop).toEqual({
      t: "shop",
      mode: "train",
      rows: [
        { line: 2, item: "Grunt", price: 100 },
        { line: 3, item: "Swordsman", price: 20, note: "Needs Slash 40 ✗, 20 gold ✓." },
      ],
    });
  });
});

describe("a spell only some classes may cast", () => {
  test("refused with the classes' names before anything is spent", async () => {
    const actor = await admin();
    const spells = structuredClone(service.publishedContent().spells.spells);
    const heal = spells.find((s) => s.name === "Minor Heal");
    expect(heal).toBeDefined();
    const r = service.draftSet(
      actor,
      { dataset: "spells", part: "spells", key: "Minor Heal" },
      "set",
      { ...heal, requires: [{ needs: "class", atLeast: 0, classes: [2] }] },
    );
    expect(r.ok ? "ok" : r.error).toBe("ok");
    const done = service.publish(actor, service.draftRev(), "Mages heal", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
    const ann = await make("Ann");
    const a = game.world.players.get(ann.characterId) as Player;
    a.spell.book.push("Minor Heal");
    a.char.vitals.sp = 50;
    sent.length = 0;
    game.intent(ann.characterId, { t: "cast", spell: "Minor Heal", x: 300, y: 200 });
    expect(chats(ann.characterId)).toEqual(["Only a Mage can cast this."]);
    expect(a.char.vitals.sp).toBe(50);
  });
});

describe("the publish checks", () => {
  const classic = (): ContentData => service.publishedContent();

  test("class references by code, a loop in inherits, a class requirement with no classes", () => {
    const d = structuredClone(classic());
    const cs = d.classes.classes as ClassRow[];
    row(cs, 1).inherits = 4;
    row(cs, 4).inherits = 1;
    row(cs, 2).paths = [{ from: [999], grants: { spells: ["Nope"] } }];
    d.social.bios.titles.push({ tests: [], classes: [998], title: "Ghost" });
    d.itemRules.requires.push({
      match: "exact",
      pattern: "Apple",
      on: "use",
      needs: "class",
      atLeast: 0,
    });
    expect(classProblems(d).map((p) => p.message)).toEqual([
      "Fighter inherits from itself, through the classes it inherits from: take one of them out",
      "is taken from class 999, which is not a class: pick from the Classes tab's list",
      "gives a spell that does not exist: Nope",
      "Grunt inherits from itself, through the classes it inherits from: take one of them out",
      "needs a class, but lists no classes: pick at least one",
      "is only for class 998, which is not a class: pick from the Classes tab's list",
    ]);
    expect(classProblems(classic())).toEqual([]);
  });

  test("a path's skills and items are references: a missing one is named", async () => {
    const actor = await admin();
    const grunt = structuredClone(
      service.publishedContent().classes.classes.find((c) => c.code === 4),
    ) as ClassRow;
    grunt.paths = [
      {
        from: [1],
        requires: [{ needs: "Slsh", atLeast: 1 }],
        items: [{ item: "Unobtainium", qty: 1 }],
      },
    ];
    const r = service.draftSet(
      actor,
      { dataset: "classes", part: "classes", key: "4" },
      "set",
      grunt,
    );
    const problems = r.ok
      ? (() => {
          const p = service.publish(actor, service.draftRev(), "Bad", game.contentWorld);
          return p.ok ? [] : (p.problems ?? []);
        })()
      : (r.problems ?? []);
    expect(problems.map((p) => p.message)).toEqual(
      expect.arrayContaining([
        "names a skill that does not exist: Slsh",
        "names an item that does not exist (or is retired): Unobtainium",
      ]),
    );
  });
});

describe("removing a class", () => {
  test("its characters move to the class picked, online and saved, when it is published", async () => {
    const actor = await admin();
    const ann = await make("Ann");
    const bo = await make("Bo", false);
    const a = game.world.players.get(ann.characterId) as Player;
    a.char.classCode = 4;
    db.run("UPDATE characters SET class_code = 4 WHERE id = ?", [bo.characterId]);
    expect(service.classUsage(4, game.contentWorld)).toEqual({
      ok: true,
      value: { name: "Grunt", holders: 2, pending: null },
    });
    // Taken out without its move, the publish is refused: Ann and Bo would have no class.
    expect(
      service.draftSet(actor, { dataset: "classes", part: "classes", key: "4" }, "remove", null).ok,
    ).toBe(true);
    const refused = service.publish(actor, service.draftRev(), "No Grunts", game.contentWorld);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : (refused.problems ?? []).map((p) => p.message)).toContain(
      "2 characters are in Grunt: take it out with Remove on its row, which moves them to another class",
    );
    expect(service.draftClassRemoval(actor, 4, 4, game.contentWorld)).toEqual({
      ok: false,
      error: "Grunt's characters cannot move to Grunt itself.",
    });
    const r = service.draftClassRemoval(actor, 4, 5, game.contentWorld);
    expect(r.ok ? r.value : r.error).toBe(
      "Grunt will be removed when the draft is published; its 2 characters move to Swordsman.",
    );
    expect(service.removals(game.contentWorld)).toEqual([
      {
        kind: "class",
        key: "Grunt",
        lines: ["2 characters move to Swordsman"],
        stillUsed: 0,
        inWorld: 2,
      },
    ]);
    const done = service.publish(actor, service.draftRev(), "No Grunts", game.contentWorld);
    expect(done.ok ? "ok" : done.error).toBe("ok");
    expect(a.char.classCode).toBe(5);
    const stored = (id: string) =>
      db
        .query<{ class_code: number }, [string]>("SELECT class_code FROM characters WHERE id = ?")
        .get(id)?.class_code;
    expect(stored(bo.characterId)).toBe(5);
    expect(service.publishedContent().classes.classes.some((c) => c.code === 4)).toBe(false);
    expect(service.history()[0]?.cleanup).toEqual(["2 characters moved from Grunt to Swordsman"]);
  });
});
