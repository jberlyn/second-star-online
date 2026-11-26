/**
 * Issue #31, stage 2: monster definitions. What the monster tables decide for one monster in one
 * record (`monsters.definitions`), which the store compiles into exact rows that win in every table
 * they cover; the pack's rows that matched the monster stop applying to it. A definition seeded from
 * what a monster plays now and saved unchanged plays identically (RNG draws included) for every
 * Classic monster and NPC name, alone or with every other one defined too, raw spellings included;
 * re-seeding in the compiled world gives the same definition; a defined monster's kill skill cap is
 * by species.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MonsterDefinition } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  buildContentStore,
  type ContentData,
  compileDefinitions,
  content,
  inMonsterList,
  installContent,
  meleeDamageVsMonster,
  meleeKillXp,
  monsterSkillCap,
  NO_EQUIPMENT,
  resolveMonster,
  seedMonsterDefinition,
} from "@secondstaronline/shared";

import { contentIntent } from "../src/content/page.ts";
import { type ContentActor, ContentService, clientCopyOf } from "../src/content/service.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";
import { leansToward } from "../src/systems/monsters/slots.ts";
import { names, plays, recorder, spellings } from "./helpers/monster-plays.ts";

const classic = content();
afterAll(() => installContent(classic));

const CLASSIC = classicData as unknown as ContentData;
const NAMES = names().filter((n) => n !== "");
const ALL = NAMES.flatMap((n) => [n, ...spellings(n)]);

const seed = (name: string, d: ContentData = CLASSIC): MonsterDefinition =>
  seedMonsterDefinition(name, resolveMonster(name, d), d.monsters);

/** Classic with these monster definitions. */
function withDefinitions(defs: readonly MonsterDefinition[], d = CLASSIC): ContentData {
  return { ...d, monsters: { ...d.monsters, definitions: [...defs] } };
}

/** What each name plays under a world. */
function playsAll(d: ContentData, list: readonly string[]): Map<string, unknown> {
  installContent(buildContentStore(d));
  try {
    return new Map(list.map((n) => [n, plays(n)]));
  } finally {
    installContent(classic);
  }
}

const classicPlays = playsAll(CLASSIC, ALL);

function expectSame(got: Map<string, unknown>, list: readonly string[] = ALL) {
  for (const name of list) {
    expect({ name, ...(got.get(name) as object) }).toEqual({
      name,
      ...(classicPlays.get(name) as object),
    });
  }
}

describe("monster definitions compile into the tables (#31 stage 2)", () => {
  test("every Classic monster and NPC, defined alone as it plays now, plays identically", () => {
    for (const name of NAMES) {
      const list = [name, ...spellings(name)];
      expectSame(playsAll(withDefinitions([seed(name)]), list), list);
    }
  });

  test("every one defined at once plays identically, RNG draws included, in any order", () => {
    const defs = NAMES.map((n) => seed(n));
    expectSame(playsAll(withDefinitions(defs), ALL));
    expectSame(playsAll(withDefinitions([...defs].reverse()), ALL));
  });

  test("a seed is stable: seeding again in the compiled world gives the same definition", () => {
    const defs = NAMES.map((n) => seed(n));
    const compiled = compileDefinitions(withDefinitions(defs));
    for (const d of defs) {
      expect(seed(d.name, compiled)).toEqual(d);
    }
    // And with a changed definition: its own values come back.
    const own: MonsterDefinition = {
      name: "Slime",
      sea: true,
      killBroadcast: "{} squashed it.",
      affinities: [{ weapon: "Axe", delta: 3, randomN: 2 }],
      skillCap: 12,
      lists: { worldEditorNpcs: true },
    };
    expect(seed("Slime", compileDefinitions(withDefinitions([own])))).toEqual(own);
  });

  test("an empty definition takes the pack's rules away; the rest of the family keeps them", () => {
    installContent(buildContentStore(withDefinitions([{ name: "Overlord" }, { name: "Orc" }])));
    try {
      const o = plays("Overlord");
      expect(o.rules.footprint).toBe(false);
      expect(o.rules.hostile).toBe(false);
      // No Sword of Hope roll on it any more: the damage is attack power less its defense.
      const r = recorder("low");
      expect(meleeDamageVsMonster(40, { name: "Overlord", defense: 0 }, "Sword of Hope", r)).toBe(
        40,
      );
      expect(r.draws).toEqual([]);
      // The default cap, whatever its body.
      expect(plays("Orc").skillCap[0]).toBe(content().monsters.skillCaps.default);
      expect(inMonsterList("Orc")).toBe(lingoListed("Orc"));
      expect(leansToward("Orc")).toBe(false);
    } finally {
      installContent(classic);
    }
    // Slime, not defined, keeps its rows.
    expect(playsAll(withDefinitions([{ name: "Orc" }]), ["Slime"]).get("Slime")).toEqual(
      classicPlays.get("Slime"),
    );
  });

  test("a changed definition plays its own values, the kill skill cap by species", () => {
    const own: MonsterDefinition = {
      ...seed("Slime"),
      sea: true,
      affinities: [{ weapon: "Axe", delta: 3, randomN: 0 }],
      skillCap: 12,
    };
    installContent(buildContentStore(withDefinitions([own])));
    try {
      const p = plays("Slime");
      expect(p.rules.sea).toBe(true);
      expect(monsterSkillCap(30, 0, "Slime")).toBe(12);
      // Another species on the Slime's body keeps the by-body cap.
      expect(monsterSkillCap(30, 0, "Somebody Else")).toBe(30);
      expect(meleeDamageVsMonster(3, { name: "Slime", defense: 0 }, "Axe", recorder("low"))).toBe(
        6,
      );
    } finally {
      installContent(classic);
    }
  });

  test("the lists: on a list it is put on, off one it is left off", () => {
    installContent(
      buildContentStore(
        withDefinitions([
          { name: "Slime" },
          { name: "Cow", lists: { worldEditorMonsters: true, npcEditorNpcs: true } },
        ]),
      ),
    );
    try {
      const lists = content().monsters.editorLists;
      expect(lists.worldEditor.monsters.some((n) => n.toLowerCase() === "slime")).toBe(false);
      expect(lists.worldEditor.monsters.at(-1)).toBe("Cow");
      expect(lists.npcEditor.npcs.at(-1)).toBe("Cow");
      expect(leansToward("Cow")).toBe(true);
    } finally {
      installContent(classic);
    }
  });

  test("the compile never changes the data it is given, and the client compiles the same store", () => {
    const d = withDefinitions([seed("Overlord"), { name: "Slime", skillCap: 3 }]);
    const before = structuredClone(d);
    compileDefinitions(d);
    expect(d).toEqual(before);
    expect(compileDefinitions(CLASSIC)).toBe(CLASSIC);
    const sent = JSON.parse(clientCopyOf(d).json) as { data: ContentData };
    const server = buildContentStore(d);
    const client = buildContentStore({ ...d, ...sent.data } as ContentData);
    expect(client.monsters).toEqual(server.monsters);
  });
});

/** Whether a name is on the World Editor's monster list text (the list `inMonsterList` reads). */
function lingoListed(name: string): boolean {
  return content()
    .monsters.editorLists.worldEditor.monsters.join("\r")
    .toLowerCase()
    .includes(name.toLowerCase());
}

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const OTHER: ContentActor = { accountId: "acc-other", name: "Other" };
const defRef = (key: string) => ({ dataset: "monsters" as const, part: "definitions", key });

function service(packs: Record<string, string> = RELEASE_PACK_DIRS, db = openDatabase()) {
  if (packs === RELEASE_PACK_DIRS) {
    runMigrations(db, loadMigrations(MIGRATIONS_DIR));
  }
  let t = 0;
  const s = new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 25, 0, 0, t++)).toISOString(),
    releasePacks: packs,
    onPublish: (store) => installContent(store),
  });
  return { db, s };
}

describe("monster definitions on a running server (#31 stage 2)", () => {
  test("drafted, published and undone through the content store, live; no notice", () => {
    const { s } = service();
    try {
      const slime = { ...seed("Slime"), skillCap: 12 };
      expect(s.draftSet(ADMIN, defRef("Slime"), "set", slime).ok).toBe(true);
      const p = s.publish(ADMIN, s.draftRev(), "Tougher slime");
      expect(p.ok).toBe(true);
      expect(monsterSkillCap(30, 0, "Slime")).toBe(12);
      expect(s.notices()).toEqual([]);
      expect(s.undo(ADMIN, p.ok ? p.value.id : "").ok).toBe(true);
      expect(monsterSkillCap(30, 0, "Slime")).toBe(30);
    } finally {
      installContent(classic);
    }
  });

  test("refused, with the field named: a bad value, a name no monster has, a weapon no item has", () => {
    const { s } = service();
    const problems = (key: string, data: unknown): string[] => {
      const r = s.draftSet(ADMIN, defRef(key), "set", data);
      if (!r.ok) {
        s.draftDiscard(defRef(key));
        return (r.problems ?? [{ where: "", message: r.error }]).map(
          (x) => `${x.where}: ${x.message}`,
        );
      }
      const p = s.publish(ADMIN, s.draftRev(), "");
      s.draftDiscard(defRef(key));
      return p.ok ? [] : (p.problems ?? [{ where: "", message: p.error }]).map((x) => x.where);
    };
    try {
      expect(problems("Slime", { name: "Slime", skillCap: -1 }).join()).toContain(
        "monsters/definitions/Slime/skillCap",
      );
      expect(problems("Slime", { name: "Slime", colour: "red" })).not.toEqual([]);
      expect(problems("Nobody Here", { name: "Nobody Here", sea: true }).join()).toContain(
        "monsters/definitions/Nobody Here",
      );
      expect(
        problems("Slime", {
          name: "Slime",
          affinities: [{ weapon: "Zzyzx", delta: 1, randomN: 0 }],
        }).join(),
      ).toContain("monsters/definitions/Slime/affinities/0/weapon");
      // The same definitions, valid, publish: a species, and an NPC with no species record.
      expect(problems("Slime", seed("Slime"))).toEqual([]);
      const npc = classicData.npcFiles.files.find(
        (f) => !classicData.monsters.monsters.some((m) => m.name === f.name),
      )?.name as string;
      expect(problems(npc, seed(npc))).toEqual([]);
    } finally {
      installContent(classic);
    }
  });

  test("a species' bounds, a trap's rules and a new key's name are checked (decision 10)", () => {
    const { s } = service();
    try {
      const slime = s.publishedContent().monsters.monsters.find((m) => m.name === "Slime");
      const rec = (key: string) => ({ dataset: "monsters" as const, part: "monsters", key });
      const refused = (key: string, data: unknown): string[] => {
        const r = s.draftSet(ADMIN, rec(key), "set", data);
        if (r.ok) {
          const p = s.check().map((x) => `${x.where}: ${x.message}`);
          s.draftDiscard(rec(key));
          return p;
        }
        return (r.problems ?? [{ where: "", message: r.error }]).map(
          (x) => `${x.where}: ${x.message}`,
        );
      };
      expect(refused("Bad Slime", { ...slime, name: "Bad Slime", hp: 0 }).join()).toContain(
        "monsters/monsters",
      );
      expect(refused("Bad Slime", { ...slime, name: "Bad Slime", attack: -1 }).join()).toContain(
        "attack",
      );
      expect(refused("Long Sword", { ...slime, name: "Long Sword" }).join()).toContain(
        "an item's name",
      );
      expect(
        refused("Sticky Slime", { ...slime, name: "Sticky Slime", flags: { trap: true } }).join(),
      ).toContain("a trap must be immobile too");
      // A trap defined as a sea creature is refused at its definition's field.
      const web = s.publishedContent().monsters.monsters.find((m) => m.name === "Web");
      expect(s.draftSet(ADMIN, rec("Sea Web"), "set", { ...web, name: "Sea Web" }).ok).toBe(true);
      expect(s.check()).toEqual([]);
      expect(
        s.draftSet(ADMIN, defRef("Sea Web"), "set", { ...seed("Web"), name: "Sea Web", sea: true })
          .ok,
      ).toBe(true);
      expect(s.check().map((x) => `${x.where}: ${x.message}`)).toContain(
        "monsters/definitions/Sea Web/sea: a trap cannot be a sea creature",
      );
    } finally {
      installContent(classic);
    }
  });

  test("an empty weapon family, which every weapon contains, is refused", () => {
    const { s } = service();
    const r = s.draftSet(ADMIN, defRef("Slime"), "set", {
      ...seed("Slime"),
      affinities: [{ weapon: " ", delta: 50, randomN: 0 }],
    });
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : (r.problems ?? []).map((p) => p.where)).toContain(
      "monsters/definitions/Slime/affinities/0/weapon",
    );
  });

  test("an item that is the last one an affinity's weapon family matches lists the affinity as a use", () => {
    const { s } = service();
    try {
      const items = s.publishedContent().items.items;
      const only = items.find(
        (i) =>
          items.filter((j) => j.name.toLowerCase().includes(i.name.toLowerCase())).length === 1,
      )?.name as string;
      expect(
        s.draftSet(ADMIN, defRef("Slime"), "set", {
          ...seed("Slime"),
          affinities: [{ weapon: only, delta: 2, randomN: 0 }],
        }).ok,
      ).toBe(true);
      const u = s.usage("item", only);
      expect(u.ok && u.value.uses.some((x) => x.where.startsWith("monsters/definitions"))).toBe(
        true,
      );
    } finally {
      installContent(classic);
    }
  });

  test("every Classic monster's and NPC's seed passes the checks", () => {
    const { s } = service();
    const m = classicData.monsters;
    const real = new Set(
      [
        ...m.monsters.map((x) => x.name),
        ...Object.values(m.editorLists).flatMap((e) => [...e.monsters, ...e.npcs]),
        ...classicData.npcFiles.files.map((f) => f.name),
      ].map((n) => n.toLowerCase()),
    );
    try {
      for (const n of NAMES.filter((x) => real.has(x.toLowerCase()))) {
        expect(s.draftSet(ADMIN, defRef(n), "set", seed(n)).ok).toBe(true);
      }
      const p = s.publish(ADMIN, s.draftRev(), "all");
      expect(p.ok ? "" : JSON.stringify(p.problems ?? p.error)).toBe("");
    } finally {
      installContent(classic);
    }
  });

  test("removing the species takes its definition with it", () => {
    const { s } = service();
    try {
      // A species nothing else names, so its removal leaves nothing behind.
      const name = classicData.monsters.monsters
        .map((m) => m.name)
        .find((n) => {
          const u = s.usage("monster", n);
          return u.ok && u.value.uses.length === 0;
        }) as string;
      expect(name).toBeDefined();
      expect(s.draftSet(ADMIN, defRef(name), "set", seed(name)).ok).toBe(true);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      const used = s.usage("monster", name);
      expect(
        used.ok && used.value.uses.some((u) => u.where.startsWith("monsters/definitions")),
      ).toBe(false);
      const r = s.draftRemoval(ADMIN, {
        kind: "monster",
        key: name,
        content: "remove",
        spawns: "remove",
        live: "despawn",
        replacement: null,
        npcFile: "keep",
      });
      expect(r.ok ? "" : r.error).toBe("");
      expect(
        s
          .draft()
          .some((d) => d.dataset === "monsters" && d.part === "definitions" && d.op === "remove"),
      ).toBe(true);
      const p = s.publish(ADMIN, s.draftRev(), "");
      expect(p.ok ? "" : JSON.stringify(p.problems ?? p.error)).toBe("");
      expect(s.publishedContent().monsters.definitions ?? []).toEqual([]);
    } finally {
      installContent(classic);
    }
  });

  test("a pack that drops a monster the operator defined still gives the definition's notice", () => {
    const db = openDatabase();
    runMigrations(db, loadMigrations(MIGRATIONS_DIR));
    const dir = mkdtempSync(join(tmpdir(), "sso-monster-dropped-pack-"));
    try {
      const s1 = service(RELEASE_PACK_DIRS, db).s;
      const name = classicData.monsters.monsters
        .map((m) => m.name)
        .find((n) => {
          const u = s1.usage("monster", n);
          return u.ok && u.value.uses.length === 0;
        }) as string;
      expect(s1.draftSet(ADMIN, defRef(name), "set", { ...seed(name), skillCap: 27 }).ok).toBe(
        true,
      );
      expect(s1.publish(ADMIN, s1.draftRev(), "").ok).toBe(true);
      expect(s1.notices()).toEqual([]);
      // The next Classic has no such monster at all.
      cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
      const file = join(dir, "data", "monsters.json");
      const m = JSON.parse(readFileSync(file, "utf8"));
      const other = (n: string) => n.toLowerCase() !== name.toLowerCase();
      m.monsters = m.monsters.filter((x: { name: string }) => other(x.name));
      for (const e of Object.values(m.editorLists) as Record<string, string[]>[]) {
        for (const k of Object.keys(e)) {
          e[k] = (e[k] as string[]).filter(other);
        }
      }
      writeFileSync(file, JSON.stringify(m));
      const nf = join(dir, "data", "npc-files.json");
      try {
        const f = JSON.parse(readFileSync(nf, "utf8"));
        f.files = f.files.filter((x: { name: string }) => other(x.name));
        writeFileSync(nf, JSON.stringify(f));
      } catch {
        // No NPC file dataset under that name.
      }
      const man = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...man, version: "9.9.9" }));
      const s2 = service({ ...RELEASE_PACK_DIRS, classic: dir }, db).s;
      expect(s2.notices().map((n) => [n.dataset, n.part, n.key?.toLowerCase()])).toContainEqual([
        "monsters",
        "definitions",
        name.toLowerCase(),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      installContent(classic);
    }
  });

  test("removing the species from the Content page's row editor takes its definition too", () => {
    const { s } = service();
    try {
      const name = classicData.monsters.monsters
        .map((m) => m.name)
        .find((n) => {
          const u = s.usage("monster", n);
          return u.ok && u.value.uses.length === 0;
        }) as string;
      const rec = { dataset: "monsters" as const, part: "monsters", key: name };
      // Published: the removal removes it.
      expect(s.draftSet(ADMIN, defRef(name), "set", seed(name)).ok).toBe(true);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      expect(s.draftSet(ADMIN, rec, "remove", null).ok).toBe(true);
      expect(s.draft().find((d) => d.part === "definitions")?.op).toBe("remove");
      expect(s.draftDiscard(rec).ok).toBe(true);
      expect(s.draftDiscard(defRef(name)).ok).toBe(true);
      // Only in the draft: it is discarded.
      expect(s.draftSet(ADMIN, defRef(name), "set", { ...seed(name), skillCap: 23 }).ok).toBe(true);
      expect(s.draftSet(ADMIN, rec, "remove", null).ok).toBe(true);
      expect(s.draft().filter((d) => d.part === "definitions")).toEqual([
        expect.objectContaining({ op: "remove" }),
      ]);
    } finally {
      installContent(classic);
    }
  });

  test("a save over a change it has not seen is refused, on the definition and the species row", () => {
    const { s } = service();
    try {
      const ref = defRef("Slime");
      const rowOf = (r: { dataset: string; part: string; key: string }) =>
        (
          contentIntent(s, ADMIN, { t: "contentRow", seq: 1, ...r } as Parameters<
            typeof contentIntent
          >[2]) as {
            row: { revision?: string } | null;
          }
        ).row?.revision;
      // No definition yet: none to name.
      expect(rowOf(ref)).toBeUndefined();
      const put = (actor: ContentActor, data: unknown, expectRev?: string) =>
        contentIntent(s, actor, {
          t: "contentDraft",
          seq: 2,
          ...ref,
          op: "set",
          data,
          ...(expectRev === undefined ? {} : { expect: expectRev }),
        }) as { ok: boolean; text: string };
      expect(put(ADMIN, seed("Slime")).ok).toBe(true);
      const opened = rowOf(ref);
      expect(typeof opened).toBe("string");
      // Another editor saves first: the first's revision is stale, and naming none is refused too.
      expect(put(OTHER, { ...seed("Slime"), skillCap: 23 }, opened).ok).toBe(true);
      const stale = put(ADMIN, { ...seed("Slime"), skillCap: 24 }, opened);
      expect(stale.ok).toBe(false);
      expect(stale.text).toContain("changed since you opened it");
      expect(put(ADMIN, { ...seed("Slime"), skillCap: 24 }).text).toContain(
        "changed since you opened it",
      );
      // The species record shares the revision: editing the record makes the definition stale.
      const species = { dataset: "monsters", part: "monsters", key: "Slime" };
      const rec = rowOf(species);
      expect(rec).toBe(rowOf(ref));
      const record = s.publishedContent().monsters.monsters.find((m) => m.name === "Slime");
      expect(
        (
          contentIntent(s, OTHER, {
            t: "contentDraft",
            seq: 3,
            ...species,
            op: "set",
            data: { ...record, hp: 99 },
            expect: rec,
          }) as { ok: boolean }
        ).ok,
      ).toBe(true);
      expect(put(ADMIN, { ...seed("Slime"), skillCap: 25 }, rec).ok).toBe(false);
      // A raw table edit under a monster with no definition changes its revision too.
      const cowRec = rowOf({ dataset: "monsters", part: "monsters", key: "Cow" });
      const rules = s.publishedContent().monsters.rules;
      expect(
        s.draftSet(ADMIN, { dataset: "monsters", part: "rules", key: null }, "set", {
          ...rules,
          sea: [...rules.sea, { match: "exact", pattern: "Cow" }],
        }).ok,
      ).toBe(true);
      expect(rowOf({ dataset: "monsters", part: "monsters", key: "Cow" })).not.toBe(cowRec);
    } finally {
      installContent(classic);
    }
  });

  test("a pack update under a defined monster: a notice that explains; none for the operator's own", () => {
    const db = openDatabase();
    runMigrations(db, loadMigrations(MIGRATIONS_DIR));
    const dir = mkdtempSync(join(tmpdir(), "sso-monster-definition-pack-"));
    try {
      const s1 = service(RELEASE_PACK_DIRS, db).s;
      expect(
        s1.draftSet(ADMIN, defRef("Slime"), "set", { ...seed("Slime"), skillCap: 29 }).ok,
      ).toBe(true);
      expect(s1.draftSet(ADMIN, defRef("Cow"), "set", seed("Cow")).ok).toBe(true);
      // The operator's own monster: a species no pack has.
      const record = s1.publishedContent().monsters.monsters.find((m) => m.name === "Slime");
      expect(
        s1.draftSet(ADMIN, { dataset: "monsters", part: "monsters", key: "Zebra Slime" }, "set", {
          ...record,
          name: "Zebra Slime",
        }).ok,
      ).toBe(true);
      expect(
        s1.draftSet(ADMIN, defRef("Zebra Slime"), "set", { ...seed("Slime"), name: "Zebra Slime" })
          .ok,
      ).toBe(true);
      const p = s1.publish(ADMIN, s1.draftRev(), "");
      expect(p.ok ? "" : JSON.stringify(p.problems ?? p.error)).toBe("");
      expect(s1.notices()).toEqual([]);
      // The next Classic makes every slime a sea creature.
      cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
      const file = join(dir, "data", "monsters.json");
      const m = JSON.parse(readFileSync(file, "utf8"));
      m.rules.sea.push({ match: "contains", pattern: "Slime" });
      writeFileSync(file, JSON.stringify(m));
      const man = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...man, version: "9.9.9" }));
      const s2 = service({ ...RELEASE_PACK_DIRS, classic: dir }, db).s;
      const notices = s2.notices();
      // Only the Slime's: the Cow's rules did not change, and Zebra Slime follows no pack.
      expect(notices.map((n) => [n.dataset, n.part, n.key, n.packName, n.packVersion])).toEqual([
        ["monsters", "definitions", "Slime", "Classic", "9.9.9"],
      ]);
      expect(notices[0]?.note).toContain("Classic v9.9.9 changed its rules for Slime");
      expect(notices[0]?.note).toContain("defined monster no longer follows");
      expect((notices[0]?.now as MonsterDefinition | undefined)?.sea).toBe(true);
      // Taking the pack's version drops the definition: the pack's rules play again.
      expect(s2.acceptNotice(ADMIN, defRef("Slime")).ok).toBe(true);
      expect(content().monsters.definitions?.some((d) => d.name === "Slime")).toBe(false);
      expect(s2.notices()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      installContent(classic);
    }
  });
});
