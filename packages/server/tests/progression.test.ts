/**
 * Skill progression on the server (#37 stage 6): XP totals saved beside skill values, and the
 * publish check a schema cannot make alone.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  type ContentData,
  SKILL_KEYS,
  skillIndex,
  startingCharacter,
} from "@secondstaronline/shared";

import { progressionProblems } from "../src/content/validate.ts";
import {
  insertCharacter,
  loadSkills,
  loadSkillXp,
  saveSkillValues,
  writeSkills,
} from "../src/persistence/characters.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";

function character() {
  const db = openDatabase();
  migrate(db);
  const map = db.query("SELECT id FROM maps LIMIT 1").get() as { id: string };
  db.run(
    "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'a', 'x', 'now', 'now')",
  );
  const start = startingCharacter({
    name: "Miner",
    sex: 1,
    head: 1,
    classCode: 1,
    str: 1,
    sta: 1,
    int: 1,
    wis: 1,
    dex: 1,
  });
  const id = insertCharacter(db, {
    accountId: "a1",
    start,
    position: { mapId: map.id, x: 5, y: 5, facing: "N" },
    now: "now",
  });
  return { db, id };
}

describe("XP totals", () => {
  test("a new character's skills start with no XP", () => {
    const { db, id } = character();
    expect(loadSkillXp(db, id)).toEqual(SKILL_KEYS.map(() => 0));
  });

  test("XP is saved with its skill; a save without XP keeps what was saved", () => {
    const { db, id } = character();
    const skills = loadSkills(db, id);
    const xp = SKILL_KEYS.map(() => 0);
    skills[skillIndex("Mining")] = 3;
    xp[skillIndex("Mining")] = 255;
    writeSkills(db, id, skills, xp);
    expect(loadSkillXp(db, id)[skillIndex("Mining")]).toBe(255);
    // A value-only write (the character editor's) leaves the XP as it was.
    saveSkillValues(db, id, { Mining: 4 });
    expect(loadSkills(db, id)[skillIndex("Mining")]).toBe(4);
    expect(loadSkillXp(db, id)[skillIndex("Mining")]).toBe(255);
    // An XP-only change is written too.
    xp[skillIndex("Mining")] = 300;
    skills[skillIndex("Mining")] = 4;
    writeSkills(db, id, skills, xp);
    expect(loadSkillXp(db, id)[skillIndex("Mining")]).toBe(300);
  });
});

describe("the publish check", () => {
  const problems = (change: (d: ContentData) => void) => {
    const d = structuredClone(classicData) as ContentData;
    change(d);
    return progressionProblems(d).map((p) => p.message);
  };

  test("Classic's harvest nodes all train a skill that rises from gathering", () => {
    expect(problems(() => {})).toEqual([]);
  });

  test("a node that gains refuses a skill with no gather progression", () => {
    expect(
      problems((d) => {
        const mining = d.classes.skills.find((s) => s.skill === "Mining");
        if (mining) {
          mining.progression = { model: "chance", on: { gather: false } };
        }
      }),
    ).toEqual([
      "gains, but Mining does not rise from gathering (give it a gather progression)",
      "gains, but Mining does not rise from gathering (give it a gather progression)",
      "gains, but Mining does not rise from gathering (give it a gather progression)",
    ]);
  });

  test("an xp skill trains from gathering by the world's default", () => {
    expect(
      problems((d) => {
        d.classes.progression.curves.steady = { counting: "perLevel", formula: 100 };
        d.classes.progression.defaults.xp.gather = { xp: 10 };
        const mining = d.classes.skills.find((s) => s.skill === "Mining");
        if (mining) {
          mining.progression = { model: "xp", curve: "steady" };
        }
      }),
    ).toEqual([]);
  });

  test("a teaching item's formulas are checked as a progression's are", () => {
    expect(
      problems((d) => {
        const book = d.itemRules.use.skillBooks[0];
        if (book) {
          book.xp = [{ op: "set", value: "damage" }];
          book.points = [{ op: "set", value: 0 }];
        }
      }),
    ).toEqual([
      "gives 0 to 0: it must be able to give 1, and at most 1000000000",
      "only a hit's formula reads damage",
    ]);
  });

  test("an xp skill's node needs an amount: the skill's, the default's or its own", () => {
    const world = (d: ContentData) => {
      d.classes.progression.curves.steady = { counting: "perLevel", formula: 100 };
      const mining = d.classes.skills.find((s) => s.skill === "Mining");
      if (mining) {
        mining.progression = { model: "xp", curve: "steady", on: { gather: {} } };
      }
    };
    expect(problems(world)).toHaveLength(3);
    expect(
      problems((d) => {
        world(d);
        for (const n of d.gather.harvest) {
          if (n.skill === "Mining") {
            n.xp = 20;
          }
        }
      }),
    ).toEqual([]);
  });
});
