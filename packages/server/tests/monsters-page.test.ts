/**
 * Issue #31, stage 4: the Monsters page on the server. The list and the open monster's form (its
 * species record, its definition or what it plays now, where each rule comes from), saves of the
 * record and definition together, refusals named by the form's labels, stale saves, new monsters
 * (copying another's record, rules and NPC file), renames, and the monster spells card.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { content, editorLines, installContent, monsterSkillCap } from "@secondstaronline/shared";

import { contentIntent } from "../src/content/page.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { seedNewWorld, worldToCreate } from "../src/content/world-seed.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";

const classic = content();
afterAll(() => installContent(classic));

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

function service(pack: "classic" | "minimal" = "classic") {
  const db = openDatabase();
  // As the server creates a world: the pack chosen first, then the migrations, then its seed.
  const creating = worldToCreate(db, pack, RELEASE_PACK_DIRS);
  runMigrations(db, loadMigrations(MIGRATIONS_DIR));
  if (creating) {
    seedNewWorld(db, creating, RELEASE_PACK_DIRS, "2026-11-25T00:00:00.000Z");
  }
  let t = 0;
  const s = new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 25, 0, 0, t++)).toISOString(),
    releasePacks: RELEASE_PACK_DIRS,
    onPublish: (store) => installContent(store),
  });
  return s;
}

describe("the Monsters page's view", () => {
  test("lists every species with what it plays; the open one's form is what it plays now", () => {
    const s = service();
    const v = s.monstersView("orc");
    expect(v.monsters.length).toBe(content().monsters.monsters.length);
    const orc = v.monsters.find((m) => m.name === "Orc");
    expect(orc).toMatchObject({ state: "pack", pending: false, hostile: true });
    const shark = v.monsters.find((m) => m.name === "Shark");
    expect(shark?.sea).toBe(true);
    expect(v.monster?.name).toBe("Orc");
    expect(v.monster?.defined).toBe(false);
    expect(v.monster?.form.name).toBe("Orc");
    expect(v.monster?.record.hp).toBe(content().monster("Orc")?.hp);
    expect(v.monster?.published).toBe(true);
    expect(v.monster?.sources.some((x) => x.group === "behaviour")).toBe(true);
    expect(v.spells.rows.length).toBe(content().monsters.casting.spells.length);
    expect(v.choices.kinds).toContain("aimFirst");
  });
});

describe("Monsters page changes", () => {
  test("a save writes the record and the definition; published, it plays", () => {
    const s = service();
    try {
      const v = s.monstersView("Slime").monster;
      if (!v) {
        throw new Error("Slime");
      }
      const r = s.draftMonsterChange(ADMIN, {
        name: "Slime",
        op: "set",
        record: { ...v.record, hp: v.record.hp + 5 },
        data: { ...v.form, skillCap: 12 },
        expect: v.fingerprint,
      });
      expect(r.ok ? r.value : r.error).toBe("Slime is in the draft.");
      expect(
        s
          .draft()
          .map((d) => `${d.part}/${d.key}`)
          .sort(),
      ).toEqual(["definitions/Slime", "monsters/Slime"]);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      expect(content().monster("Slime")?.hp).toBe(v.record.hp + 5);
      expect(monsterSkillCap(30, 0, "Slime")).toBe(12);
      // The same fingerprint again is stale.
      const stale = s.draftMonsterChange(ADMIN, {
        name: "Slime",
        op: "set",
        data: v.form,
        expect: v.fingerprint,
      });
      expect(stale.ok ? "" : stale.error).toContain("changed since you opened it");
    } finally {
      installContent(classic);
    }
  });

  test("an unchanged save is refused; a bad value is refused by the form's label", () => {
    const s = service();
    const v = s.monstersView("Slime").monster;
    if (!v) {
      throw new Error("Slime");
    }
    const same = s.draftMonsterChange(ADMIN, {
      name: "Slime",
      op: "set",
      record: v.record,
      data: v.form,
      expect: v.fingerprint,
    });
    expect(same.ok).toBe(false);
    const bad = s.draftMonsterChange(ADMIN, {
      name: "Slime",
      op: "set",
      record: { ...v.record, hp: 0, flags: { trap: true } },
      expect: v.fingerprint,
    });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? [] : (bad.problems ?? []).map((p) => p.where)).toContain("Hit points");
    // Nothing was left in the draft.
    expect(s.draft()).toEqual([]);
  });

  test("a new monster copies another's record, rules and NPC file; renamed, reverted, discarded", () => {
    const s = service();
    const made = s.draftMonsterChange(ADMIN, {
      name: "Orc Chief",
      op: "create",
      copyFrom: "Orc",
    });
    expect(made.ok ? made.value : made.error).toContain("a copy of Orc");
    const d = s.draftContent();
    expect(d.monsters.monsters.find((m) => m.name === "Orc Chief")?.hp).toBe(
      content().monster("Orc")?.hp,
    );
    expect(d.monsters.definitions?.find((x) => x.name === "Orc Chief")?.lists).toEqual(
      s.monstersView("Orc").monster?.form.lists,
    );
    const orcFile = d.npcFiles.files.find((f) => f.name === "Orc")?.text;
    if (orcFile) {
      // As the NPC Editor saves it: its lines, CR-separated.
      expect(d.npcFiles.files.find((f) => f.name === "Orc Chief")?.text).toBe(
        editorLines(orcFile).join("\r"),
      );
    }
    expect(s.check()).toEqual([]);
    const v = s.monstersView("Orc Chief").monster;
    expect(v?.published).toBe(false);
    const ren = s.draftMonsterChange(ADMIN, {
      name: "Orc Chief",
      op: "rename",
      display: "Chieftain",
      expect: v?.fingerprint,
    });
    expect(ren.ok ? ren.value : ren.error).toBe("Orc Chief is called Chieftain in the draft.");
    // A display name another monster has is refused.
    const v2 = s.monstersView("Orc Chief").monster;
    const clash = s.draftMonsterChange(ADMIN, {
      name: "Orc Chief",
      op: "rename",
      display: "Orc",
      expect: v2?.fingerprint,
    });
    expect(clash.ok).toBe(false);
    const gone = s.draftMonsterChange(ADMIN, {
      name: "Orc Chief",
      op: "discard",
      expect: v2?.fingerprint,
    });
    expect(gone.ok).toBe(true);
    // A new monster's key may not be an item's name.
    expect(s.draftMonsterChange(ADMIN, { name: "Long Sword", op: "create" }).ok).toBe(false);
    // A monster of its own goes on the World Editor's list.
    expect(s.draftMonsterChange(ADMIN, { name: "Bog Thing", op: "create" }).ok).toBe(true);
    expect(s.monstersView().monsters.find((m) => m.name === "Bog Thing")?.hostile).toBe(true);
  });

  test("the monster spells card saves every spell as one row, checked", () => {
    const s = service();
    const v = s.monstersView().spells;
    const rows = v.rows.map((r, i) => (i === 0 ? { ...r, power: r.power + 1 } : r));
    expect(s.draftMonsterSpells(ADMIN, rows, v.fingerprint).ok).toBe(true);
    const again = s.monstersView().spells;
    expect(again.pending).toBe(true);
    // A stale save and a duplicate tag are refused.
    expect(s.draftMonsterSpells(ADMIN, rows, v.fingerprint).ok).toBe(false);
    const dup = [...again.rows, { ...(again.rows[0] as (typeof rows)[number]) }];
    const r = s.draftMonsterSpells(ADMIN, dup, again.fingerprint);
    expect(r.ok).toBe(false);
  });

  test("review fixes: malformed flags, problems a change brings elsewhere, a copy's file on discard", () => {
    const s = service();
    const v = s.monstersView("Slime").monster;
    if (!v) {
      throw new Error("Slime");
    }
    // Flags that are not an object are refused by name, not thrown.
    const bad = s.draftMonsterChange(ADMIN, {
      name: "Slime",
      op: "set",
      record: { ...v.record, flags: null },
      expect: v.fingerprint,
    });
    expect(bad.ok ? [] : (bad.problems ?? []).map((p) => p.where)).toContain("Flags");
    // A sea creature (by its definition) made a trap: the problem is at its unchanged definition,
    // and the save is refused all the same.
    const shark = s.monstersView("Shark").monster;
    if (!shark) {
      throw new Error("Shark");
    }
    expect(
      s.draftMonsterChange(ADMIN, {
        name: "Shark",
        op: "set",
        data: { ...shark.form, noQuests: true },
        expect: shark.fingerprint,
      }).ok,
    ).toBe(true);
    const shark2 = s.monstersView("Shark").monster;
    const trap = s.draftMonsterChange(ADMIN, {
      name: "Shark",
      op: "set",
      record: { ...shark2?.record, flags: { trap: true, immobile: true } },
      expect: shark2?.fingerprint,
    });
    expect(trap.ok).toBe(false);
    expect(s.draft().find((d) => d.part === "monsters" && d.key === "Shark")).toBeUndefined();
    // A new monster whose display name another monster already has (by its rename) is refused.
    const orc = s.monstersView("Orc").monster;
    expect(
      s.draftMonsterChange(ADMIN, {
        name: "Orc",
        op: "rename",
        display: "Orc Champion",
        expect: orc?.fingerprint,
      }).ok,
    ).toBe(true);
    const clash = s.draftMonsterChange(ADMIN, {
      name: "Orc Champion",
      op: "create",
      display: "Captain",
    });
    expect(clash.ok).toBe(false);
    // A copy's NPC file goes with it when its draft changes are dropped.
    expect(
      s.draftMonsterChange(ADMIN, { name: "Orc Chief", op: "create", copyFrom: "Orc" }).ok,
    ).toBe(true);
    const chief = s.monstersView("Orc Chief").monster;
    expect(
      s.draftMonsterChange(ADMIN, { name: "Orc Chief", op: "discard", expect: chief?.fingerprint })
        .ok,
    ).toBe(true);
    expect(s.draft().some((d) => d.key === "Orc Chief")).toBe(false);
  });

  test("review fixes: a spell's effect must exist; a spell still cast cannot go; the JSON editor names a revision", () => {
    const s = service();
    const v = s.monstersView().spells;
    const fresh = {
      tag: "Ice Shard",
      name: "No Such Effect",
      kind: "aimFirst" as const,
      power: 5,
      ladder: [90, 145, 200, 300, 500, 700, 1000],
      aName: true,
    };
    const r = s.draftMonsterSpells(ADMIN, [...v.rows, fresh], v.fingerprint);
    expect(r.ok ? "" : r.error).toContain("no spell effect is called No Such Effect");
    // In four directions it needs the effect's L, R, U and D.
    const dir = s.draftMonsterSpells(
      ADMIN,
      [...v.rows, { ...fresh, name: "Fireball", kind: "dirAfterExits" as const }],
      v.fingerprint,
    );
    expect(dir.ok ? dir.value : dir.error).toBe("The monster spells are in the draft.");
    s.draftDiscard({ dataset: "monsters", part: "casting", key: null });
    // Splash is cast by an NPC file: taking it out is refused.
    const caster = content().npcFiles.files.find((f) => /(^|\r)SPL\|/.test(f.text));
    if (caster) {
      const tag = /SPL\|([^\r]*)/.exec(caster.text)?.[1] ?? "";
      const left = v.rows.filter((x) => !tag.toLowerCase().includes(x.tag.toLowerCase()));
      const gone = s.draftMonsterSpells(ADMIN, left, s.monstersView().spells.fingerprint);
      expect(gone.ok ? "" : gone.error).toContain("still cast by");
    }
    // The Content page's JSON editor must name the spells' revision.
    const ref = { dataset: "monsters" as const, part: "casting", key: null };
    const noExpect = contentIntent(s, ADMIN, {
      t: "contentDraft",
      seq: 1,
      ...ref,
      op: "set",
      data: s.draftContent().monsters.casting,
    });
    expect(noExpect).toMatchObject({ ok: false });
  });

  test("a Minimal world: a monster made from nothing saves and publishes", () => {
    const s = service("minimal");
    try {
      const made = s.draftMonsterChange(ADMIN, { name: "Mudling", op: "create" });
      expect(made.ok ? made.value : made.error).toContain("Mudling is in the draft");
      const v = s.monstersView("Mudling").monster;
      if (!v) {
        throw new Error("Mudling");
      }
      expect(v.inPack).toBe(false);
      const set = s.draftMonsterChange(ADMIN, {
        name: "Mudling",
        op: "set",
        record: { ...v.record, hp: 12, attack: 2 },
        expect: v.fingerprint,
      });
      expect(set.ok ? set.value : set.error).toBe("Mudling is in the draft.");
      const p = s.publish(ADMIN, s.draftRev(), "");
      expect(p.ok ? "" : JSON.stringify(p.problems ?? p.error)).toBe("");
      expect(content().monster("Mudling")?.hp).toBe(12);
      expect(content().monsters.editorLists.worldEditor.monsters).toContain("Mudling");
    } finally {
      installContent(classic);
    }
  });

  test("the Content page's JSON editor and the Monsters page each refuse a save over the other's change", () => {
    const s = service();
    const v = s.monstersView("Slime").monster;
    if (!v) {
      throw new Error("Slime");
    }
    const ref = { dataset: "monsters" as const, part: "monsters", key: "Slime" };
    const opened = s.rowRevision(ref) ?? undefined;
    // The Monsters page saves first.
    expect(
      s.draftMonsterChange(ADMIN, {
        name: "Slime",
        op: "set",
        record: { ...v.record, hp: v.record.hp + 1 },
        expect: v.fingerprint,
      }).ok,
    ).toBe(true);
    // The JSON editor, opened before, is refused.
    const json = contentIntent(s, ADMIN, {
      t: "contentDraft",
      seq: 1,
      ...ref,
      op: "set",
      data: { ...v.record, hp: 1 },
      ...(opened ? { expect: opened } : {}),
    });
    expect(json).toMatchObject({ ok: false });
    // And the other way: a JSON save makes the page's stale.
    const now = s.monstersView("Slime").monster;
    const fresh = s.rowRevision(ref) ?? undefined;
    expect(
      contentIntent(s, ADMIN, {
        t: "contentDraft",
        seq: 2,
        ...ref,
        op: "set",
        data: { ...now?.record, hp: 3 },
        ...(fresh ? { expect: fresh } : {}),
      }),
    ).toMatchObject({ ok: true });
    const stale = s.draftMonsterChange(ADMIN, {
      name: "Slime",
      op: "set",
      record: { ...now?.record, hp: 9 },
      expect: now?.fingerprint,
    });
    expect(stale.ok ? "" : stale.error).toContain("changed since you opened it");
  });

  test("the page's intents answer with the view and the result", () => {
    const s = service();
    const a = contentIntent(s, ADMIN, { t: "contentMonsters", seq: 1, name: "Orc" });
    expect(a.t === "contentMonsters" && a.view.monster?.name).toBe("Orc");
    const b = contentIntent(s, ADMIN, {
      t: "contentMonsterSet",
      seq: 2,
      name: "Orc",
      op: "revert",
      expect: a.t === "contentMonsters" ? a.view.monster?.fingerprint : "",
    });
    expect(b).toMatchObject({ t: "contentMonsters", result: { ok: false } });
  });
});
