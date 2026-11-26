/**
 * Issue #31, stage 0: the monster resolver (shared `resolveMonster`) says what a monster plays now
 * from the monster tables: the rules, never-casts, the melee affinities' monster side, and the kill
 * skill cap by the species' body. Its round trip: for every Classic monster and NPC name, a world
 * whose monster tables hold only the rows the resolver found for it, each rewritten to name it
 * exactly (`exactRowsFor`), must play it exactly as Classic does, random draws included. That is
 * the premise of the monster editor's definitions (#31 stage 2).
 */
import { afterAll, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  content,
  exactRowsFor,
  installContent,
  isMonsterTable,
  nameTables,
  resolveMonster,
  SKILL_CAP_TABLE,
} from "@secondstaronline/shared";

import { names, plays, spellings } from "./helpers/monster-plays.ts";

const classic = content();
afterAll(() => installContent(classic));

type Obj = Record<string, unknown>;

/** Classic with every monster table holding only the resolver's exact rows for `name`. */
function worldFor(name: string): ContentData {
  const classicD = classicData as unknown as Partial<ContentData>;
  const rows = exactRowsFor(name, resolveMonster(name, classicD));
  const d = structuredClone(classicData) as unknown as Record<string, Obj>;
  const keys = [...nameTables(classicD).keys()].filter(isMonsterTable);
  for (const key of [...keys, SKILL_CAP_TABLE]) {
    const path = key.split(" ")[1] as string;
    const parts = path.split(".");
    let o = d.monsters as Obj;
    for (const part of parts.slice(0, -1)) {
      o = o[part] as Obj;
    }
    o[parts.at(-1) as string] = rows.get(key) ?? [];
  }
  for (const key of rows.keys()) {
    expect([...keys, SKILL_CAP_TABLE]).toContain(key);
  }
  return d as unknown as ContentData;
}

describe("the monster resolver (#31 stage 0)", () => {
  test("finds the rows a monster plays, and which decide", () => {
    const overlord = resolveMonster("Overlord");
    const keys = overlord.map((h) => h.key);
    expect(keys).toContain("monsters rules.footprint");
    expect(keys).toContain("monsters rules.killBroadcasts");
    const aff = overlord.find((h) => h.key === "monsters meleeAffinities");
    expect(aff?.info.wins).toBe("adds");
    // Sword of Hope's random row is one of the Overlord's.
    expect(aff?.deciding.some((r) => r.raw.weapon === "Hope" && r.raw.randomN !== 0)).toBe(true);
    const cap = resolveMonster("Slime").find((h) => h.key === SKILL_CAP_TABLE);
    expect(cap?.deciding.map((r) => r.raw.skillCap)).toEqual([30]);
    // A name no row knows has no answer.
    expect(resolveMonster("Nobody Knows This One")).toEqual([]);
  });

  test("a contains row is a row of every name it contains", () => {
    const rows = resolveMonster("Warrior Faction Member").find(
      (h) => h.key === "monsters rules.namesSelf",
    );
    expect(rows?.rows.map((r) => `${r.match} ${r.pattern}`)).toEqual(["contains Faction"]);
  });

  test("which rows decide: first for broadcasts, last for the cap, every affinity adds, except skips", () => {
    const d = structuredClone(classicData) as unknown as ContentData;
    const r = d.monsters.rules;
    r.killBroadcasts = [
      { match: "exact", pattern: "Orc Chief", text: "A {}" },
      { match: "contains", pattern: "Chief", text: "B {}" },
    ];
    d.monsters.monsters = [
      ...d.monsters.monsters,
      {
        ...(d.monsters.monsters[0] as (typeof d.monsters.monsters)[number]),
        name: "Orc Chief",
        body: 77,
      },
    ];
    d.monsters.skillCaps.byBody = [
      { body: "77", skillCap: 11 },
      { body: "77", skillCap: 12 },
    ];
    const aff = d.monsters.meleeAffinities[0] as (typeof d.monsters.meleeAffinities)[number];
    d.monsters.meleeAffinities = [
      { ...aff, weapon: "Sword", monster: "Orc", monsterMatch: "contains", delta: 2, randomN: 0 },
      {
        ...aff,
        weapon: "Sword",
        monster: "Orc Chief",
        monsterMatch: "exact",
        delta: 3,
        randomN: 4,
      },
    ];
    r.hostile = [
      { match: "contains", pattern: "Orc", except: ["Orc Chief"] } as (typeof r.hostile)[number],
    ];
    const hits = resolveMonster("Orc Chief", d);
    const deciding = (key: string): unknown[] | undefined =>
      hits.find((h) => h.key === key)?.deciding.map((x) => x.raw);
    expect(deciding("monsters rules.killBroadcasts")).toEqual([r.killBroadcasts[0]] as unknown[]);
    expect(deciding(SKILL_CAP_TABLE)).toEqual([d.monsters.skillCaps.byBody[1]] as unknown[]);
    expect(deciding("monsters meleeAffinities")).toEqual(d.monsters.meleeAffinities as unknown[]);
    expect(deciding("monsters rules.hostile")).toBeUndefined();
  });

  test("a name no species has takes body 0's skill cap, as a kill of it rolls", () => {
    const d = structuredClone(classicData) as unknown as ContentData;
    d.monsters.skillCaps.byBody = [...d.monsters.skillCaps.byBody, { body: "0", skillCap: 9 }];
    const hits = resolveMonster("Nobody Knows This One", d);
    expect(
      hits.find((h) => h.key === SKILL_CAP_TABLE)?.deciding.map((r) => r.raw.skillCap),
    ).toEqual([9]);
    // And the round trip keeps it: the exact-row world plays the cap of 9, not the default.
    installContent(buildContentStore(d));
    const want = JSON.stringify(plays("Nobody Knows This One"));
    const rows = exactRowsFor("Nobody Knows This One", hits);
    const w = structuredClone(d) as unknown as ContentData;
    w.monsters.skillCaps.byBody = (rows.get(SKILL_CAP_TABLE) ??
      []) as typeof w.monsters.skillCaps.byBody;
    installContent(buildContentStore(w));
    expect(JSON.stringify(plays("Nobody Knows This One"))).toBe(want);
    installContent(classic);
  });

  test("round trip: each name's exact rows alone play it as Classic does", () => {
    // Every name, and the raw spellings a live name can come in.
    const all = [
      ...names(),
      ...names()
        .filter((n) => n !== "")
        .flatMap(spellings),
    ];
    const want = new Map(all.map((n) => [n, JSON.stringify(plays(n))]));
    const failed: string[] = [];
    const unstable: string[] = [];
    for (const name of all) {
      const w = worldFor(name);
      installContent(buildContentStore(w));
      if (JSON.stringify(plays(name)) !== want.get(name)) {
        failed.push(name);
      }
      // Resolving again inside that world finds the same rows: a definition seeded there is the
      // one it was made from.
      const again = exactRowsFor(name, resolveMonster(name, w as unknown as Partial<ContentData>));
      const first = exactRowsFor(
        name,
        resolveMonster(name, classicData as unknown as Partial<ContentData>),
      );
      if (JSON.stringify([...again]) !== JSON.stringify([...first])) {
        unstable.push(name);
      }
    }
    installContent(classic);
    expect(failed).toEqual([]);
    expect(unstable).toEqual([]);
    expect(all.length).toBeGreaterThan(100);
  }, 120_000);
});
