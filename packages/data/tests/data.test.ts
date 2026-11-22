import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { listAdded } from "../build/assets-lib/added.ts";
import { createRgba, encodePng } from "../build/assets-lib/png.ts";
import { SOUNDS } from "../build/assets-lib/select.ts";
import {
  findStaleModules,
  findStalePack,
  GENERATED_DIR,
  renderClassicPack,
  renderDataModules,
  renderRects,
} from "../build/data.ts";
import npcsData from "../test-fixtures/npc-expectations.json";

const CONTENT_DIR = resolve(import.meta.dir, "../content");

import { churchMapDataSchema } from "../schema/church-map.ts";
import { classesDataSchema } from "../schema/classes.ts";
import { itemRulesDataSchema } from "../schema/item-rules.ts";
import { itemSchema } from "../schema/items.ts";
import { monsterSchema, monstersDataSchema } from "../schema/monsters.ts";
import { seedMapDataSchema } from "../schema/seed-map.ts";
import { spellsDataSchema } from "../schema/spells.ts";
import { tileSchema, tilesDataSchema } from "../schema/tiles.ts";
import { classicData } from "../src/classic.ts";
import { churchMapData, seedMapData } from "../src/index.ts";

const {
  attPower: attPowerData,
  casino: casinoData,
  classes: classesData,
  gather: gatherData,
  help: helpData,
  itemRules: itemRulesData,
  items: itemsData,
  monsters: monstersData,
  spells: spellsData,
  tiles: tilesData,
} = classicData;

type Obj = Record<string, unknown>;

describe("data build v0", () => {
  test("is deterministic and the committed modules are current", () => {
    const first = renderDataModules();
    const second = renderDataModules();
    expect([...second]).toEqual([...first]);
    for (const [name, text] of first) {
      expect(readFileSync(join(GENERATED_DIR, name), "utf8")).toBe(text);
    }
    expect(findStaleModules(first)).toEqual([]);
  });

  test("data:check reports stale, missing and extra modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-data-check-"));
    try {
      const modules = new Map([
        ["a.ts", "export const a = 1;\n"],
        ["b.ts", "export const b = 2;\n"],
        ["c.ts", "export const c = 3;\n"],
      ]);
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
      writeFileSync(join(dir, "b.ts"), "export const b = 99;\n");
      writeFileSync(join(dir, "old.ts"), "export const old = 0;\n");
      expect(findStaleModules(modules, dir)).toEqual([
        "extra: old.ts",
        "missing: c.ts",
        "stale: b.ts",
      ]);
      expect(findStaleModules(new Map([["a.ts", "export const a = 1;\n"]]), dir)).toEqual([
        "extra: b.ts",
        "extra: old.ts",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("emits tiles and items (their 1.6 rows are checked in content-baseline.test.ts)", () => {
    expect(tilesData.catalogue.length).toBeGreaterThan(0);
    expect(tilesData.walkable.length).toBeGreaterThan(0);
    expect(itemsData.items.length).toBeGreaterThan(0);
  });

  test("schemas are strict: an unknown field fails the build", () => {
    const tile = { ...tilesData.catalogue[0], weight: 1 };
    expect(tileSchema.safeParse(tile).success).toBe(false);
  });
});

describe("the Classic pack (packages/data/packs/classic/)", () => {
  test("is current, and its version records the hash of its content", () => {
    const pack = renderClassicPack();
    expect(findStalePack(pack.files)).toEqual([]);
    expect(pack.sourceStale).toBe(false);
    expect(JSON.parse(pack.files.get("manifest.json") ?? "{}")).toMatchObject({
      id: "classic",
      name: "Classic",
      format: 1,
    });
  });

  test("a pack folder that differs is reported", () => {
    const files = new Map(renderClassicPack().files);
    files.set("data/items.json", "{}");
    files.set("data/new.json", "{}");
    expect(findStalePack(files)).toEqual(["missing: data/new.json", "stale: data/items.json"]);
  });
});

describe("content files (packages/data/content/)", () => {
  test("the build reads content/: a changed value reaches the Classic pack and bumps its version", () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-content-build-"));
    try {
      cpSync(CONTENT_DIR, dir, { recursive: true });
      const file = join(dir, "monsters.json");
      const monsters = JSON.parse(readFileSync(file, "utf8"));
      const slime = monsters.monsters.find((m: { name: string }) => m.name === "Slime");
      slime.hp = 9999;
      writeFileSync(file, JSON.stringify(monsters));
      const pack = renderClassicPack(dir);
      expect(pack.files.get("data/monsters.json") ?? "").toContain('"hp": 9999');
      // The content changed since the version content/pack.json records, so it needs a new one.
      expect(pack.sourceStale).toBe(true);
      const now = renderClassicPack();
      expect(now.sourceStale).toBe(false);
      expect(pack.manifest.version).not.toBe(now.manifest.version);
      expect(pack.manifest.contentHash).not.toBe(now.manifest.contentHash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("seed and church maps require four 17×12 layers and catalogue tile codes", () => {
    expect(seedMapDataSchema.safeParse(seedMapData).success).toBe(true);
    expect(churchMapDataSchema.safeParse(churchMapData).success).toBe(true);
    const short = structuredClone(seedMapData);
    short.layers[0][0] = "G1";
    expect(seedMapDataSchema.safeParse(short).success).toBe(false);
    expect(seedMapDataSchema.safeParse({ ...seedMapData, unexpected: true }).success).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "sso-seed-map-"));
    try {
      cpSync(CONTENT_DIR, dir, { recursive: true });
      const unknown = structuredClone(seedMapData);
      unknown.layers[0][0] = unknown.layers[0][0]!.replace("N1", "UNKNOWN");
      writeFileSync(join(dir, "seed-map.json"), JSON.stringify(unknown));
      expect(() => renderDataModules(dir)).toThrow(/unknown tile UNKNOWN/);
      writeFileSync(join(dir, "seed-map.json"), JSON.stringify(seedMapData));
      const unknownChurch = structuredClone(churchMapData);
      unknownChurch.layers[0][0] = unknownChurch.layers[0][0]!.replace("E2", "UNKNOWN");
      writeFileSync(join(dir, "church-map.json"), JSON.stringify(unknownChurch));
      expect(() => renderDataModules(dir)).toThrow(/unknown tile UNKNOWN/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unknown field in a content file fails the build", () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-content-strict-"));
    try {
      cpSync(CONTENT_DIR, dir, { recursive: true });
      const file = join(dir, "spells.json");
      const spells = JSON.parse(readFileSync(file, "utf8"));
      spells.spells[0].weight = 1;
      writeFileSync(file, JSON.stringify(spells));
      expect(() => renderClassicPack(dir)).toThrow(/does not match its schema/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a skill added to classes.json can have fewer starting values (padded with 1), and classes refuse more starting values than skills", () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-content-skills-"));
    try {
      cpSync(CONTENT_DIR, dir, { recursive: true });
      const file = join(dir, "classes.json");
      const classes = JSON.parse(readFileSync(file, "utf8"));
      classes.skills.push({ index: classes.skills.length + 1, skill: "Tinkering" });
      writeFileSync(file, JSON.stringify(classes));
      expect(renderClassicPack(dir).files.get("data/classes.json")).toContain("Tinkering");
      classes.creation.startingSkills["1"].values.push(1, 1);
      writeFileSync(file, JSON.stringify(classes));
      expect(() => renderClassicPack(dir)).toThrow(/more starting values/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("help topics", () => {
  // The archive's Help folder was compared line for line (blank lines included) when the originals
  // left the build; these checksums of each topic's lines pin that result.
  const archiveChecksums: Record<string, string> = {
    "Help.txt": "a8a6d9f918a0cb82",
    "airships.txt": "78ae27f23b8c5b96",
    "banking.txt": "aa8b691912cc20fa",
    "basic commands.txt": "a55f3e6151748e1e",
    "casting spells.txt": "74da27abf0142935",
    "communitcating.txt": "b50ffdfc5ee1c573",
    "factions.txt": "293225f00a770b59",
    "guilds.txt": "d9971edd29a871b6",
    "hunger.txt": "76ffb2ce876a81ad",
    "installation.txt": "873013c4aa6aa0d6",
    "keyboard commands.txt": "5cbbecf23e09adee",
    "menu.txt": "b4aee8285d8648a3",
    "movement.txt": "1164a1d1e179cedd",
    "running shops.txt": "610d93fccb7e2b2f",
    "topics.txt": "b4b22eb294d06d4b",
    "using items.txt": "6bb1aa45150e5f87",
    "using skills.txt": "67b4f4125f20712a",
  };

  test("each of the 17 topics is its archive file line for line, blank lines included", () => {
    for (const [file, expected] of Object.entries(archiveChecksums)) {
      const t = helpData.topics.find((x) => x.file === file);
      expect(t, file).toBeDefined();
      const sum = new Bun.CryptoHasher("sha256").update((t?.lines ?? []).join("\n")).digest("hex");
      expect(`${file} ${sum.slice(0, 16)}`).toBe(`${file} ${expected}`);
    }
  });

  test("all 17 files are reachable by their full topic name, one word or two", () => {
    expect(helpData.topics).toHaveLength(17);
    expect(helpData.topics.every((t) => t.reachable)).toBe(true);
    expect(helpData.topics.find((t) => t.topic === "basic commands")?.reachable).toBe(true);
    expect(helpData.topics.find((t) => t.topic === "casting spells")?.reachable).toBe(true);
  });
});

describe("monsters, attack power and class skill gain data", () => {
  test("the mlists species have no `x` placeholder lines", () => {
    expect(monstersData.monsters.some((m) => m.name === "x")).toBe(false);
  });
  test("Slime: body 30, HP 14, Defense 2, attack 1, XP 14, hostile, moves", () => {
    expect(monstersData.monsters.find((m) => m.name === "Slime")).toMatchObject({
      body: 30,
      hp: 14,
      defense: 2,
      attack: 1,
      xpMelee: 14,
    });
    expect(monstersData.editorLists.worldEditor.monsters).toContain("Slime");
  });
  test("promotion rules: the 1.6 promotable classes have one", () => {
    expect(classesData.classes.filter((c) => c.promotion !== null).length).toBeGreaterThanOrEqual(
      16,
    );
    expect(classesData.classes.find((c) => c.name === "Paladin")?.promotion?.statChanges).toEqual([
      { stat: "SPmax", atLeast: 1 },
    ]);
  });
  test("AttPower rows, the melee affinities and the kill skill-gain table are emitted", () => {
    expect(attPowerData.attPower.base[0]).toMatchObject({ pattern: "Knife", flat: 2, randomN: 3 });
    expect(monstersData.meleeAffinities.length).toBeGreaterThan(0);
    expect(classesData.skillGain.weaponSkills[0]).toEqual({
      weapon: "NOTHING",
      match: "exact",
      skills: ["Punch", "Martial Arts"],
    });
  });
});

describe("item rules and loot tables", () => {
  test("the rule tables keep their source order", async () => {
    const itemRulesData = classicData.itemRules;
    // The 1.6 rows (157 slot rules, 19 STR rules, 35 usable rules, 64 effect rows, 40 armour
    // rows, 36 elemental rows, 33 damaged forms) are checked in content-baseline.test.ts.
    expect(itemRulesData.equip.slots[0]).toEqual({
      match: "contains",
      pattern: "Pharaoh Sword",
      slot: "LeftHand",
    });
  });
  test("loot tables are keyed by NPC file (monsters.json lootTables)", () => {
    expect(npcsData.lootTables.find((t) => t.npc === "Slime")?.lines[0]).toEqual({
      item: "2 Gold",
      oneIn: 1,
    });
  });
});

describe("item rule tables", () => {
  test("item rules accept only exact and contains rows", () => {
    const ok = structuredClone(itemRulesData);
    expect(itemRulesDataSchema.safeParse(ok).success).toBe(true);
    const bad = structuredClone(itemRulesData);
    (bad.menu[0] as { match: string }).match = "word";
    expect(itemRulesDataSchema.safeParse(bad).success).toBe(false);
  });

  test("every platform names a skill in classes.json or level", () => {
    const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
    const skills = new Set(classesData.skills.map((s) => norm(s.skill)));
    for (const p of itemRulesData.ground.platforms) {
      expect(
        p.needs === "level" || skills.has(norm(p.needs)),
        `${p.pattern} needs ${p.needs}`,
      ).toBe(true);
    }
  });

  test("the item record holds only what the game reads", () => {
    const item = itemsData.items[0];
    expect(itemSchema.safeParse(item).success).toBe(true);
    expect(itemSchema.safeParse({ ...item, price: 5 }).success).toBe(false);
  });
});

describe("monsters, NPCs and tiles", () => {
  test("monster rules accept only exact and contains rows", () => {
    const ok = structuredClone(monstersData);
    expect(monstersDataSchema.safeParse(ok).success).toBe(true);
    const bad = structuredClone(monstersData);
    (bad.rules.footprint[0] as { match: string }).match = "word";
    expect(monstersDataSchema.safeParse(bad).success).toBe(false);
  });

  test("each World Editor list and its NPC Editor list hold the same names", () => {
    const normSet = (xs: readonly string[]) => new Set(xs.map((x) => x.toLowerCase()));
    expect(normSet(monstersData.editorLists.worldEditor.monsters)).toEqual(
      normSet(monstersData.editorLists.npcEditor.monsters),
    );
    expect(normSet(monstersData.editorLists.worldEditor.npcs)).toEqual(
      normSet(monstersData.editorLists.npcEditor.npcs),
    );
  });

  test("every editor list name is a species in monsters.json", () => {
    const species = new Set(monstersData.monsters.map((m) => m.name.toLowerCase()));
    for (const list of [
      monstersData.editorLists.worldEditor.monsters,
      monstersData.editorLists.worldEditor.npcs,
      monstersData.editorLists.npcEditor.monsters,
      monstersData.editorLists.npcEditor.npcs,
    ]) {
      for (const name of list) {
        expect(species.has(name.toLowerCase()), name).toBe(true);
      }
    }
  });

  test("every default names a catalogue tile", () => {
    const ok = structuredClone(tilesData);
    expect(tilesDataSchema.safeParse(ok).success).toBe(true);
    const bad = structuredClone(tilesData);
    bad.defaults.empty = "ZZ";
    expect(tilesDataSchema.safeParse(bad).success).toBe(false);
  });

  test("an added tile (no member) has a 2-character code no other row has, in any case", () => {
    const seen = new Set<string>();
    for (const t of tilesData.catalogue) {
      if (t.member === undefined) {
        expect(t.code).toHaveLength(2);
        const low = t.code.toLowerCase();
        expect(seen.has(low), t.code).toBe(false);
        seen.add(low);
      }
    }
    const existingLower = new Set(
      tilesData.catalogue.filter((t) => t.member !== undefined).map((t) => t.code.toLowerCase()),
    );
    for (const t of tilesData.catalogue) {
      if (t.member === undefined) {
        expect(existingLower.has(t.code.toLowerCase()), t.code).toBe(false);
      }
    }
  });

  test("every added tile has art", () => {
    const repoRoot = resolve(import.meta.dir, "../../..");
    for (const t of tilesData.catalogue) {
      if (t.member === undefined) {
        expect(existsSync(join(repoRoot, `assets/added/tiles/${t.code}.png`)), t.code).toBe(true);
        expect(existsSync(join(repoRoot, `assets/added/tiles/${t.code}.json`)), t.code).toBe(true);
      }
    }
  });

  test("the tile row and the monster record hold only what the game reads", () => {
    const tile = tilesData.catalogue[0];
    expect(tileSchema.safeParse(tile).success).toBe(true);
    expect(tileSchema.safeParse({ ...tile, usedInMaps: 1 }).success).toBe(false);
    const mon = monstersData.monsters[0];
    expect(monsterSchema.safeParse(mon).success).toBe(true);
    expect(monsterSchema.safeParse({ ...mon, hostile: true }).success).toBe(false);
  });

  test("the spell table refuses a duplicate FX member, an effect that is not an original effect, and a run effect not in that effect's runs", () => {
    const dup = structuredClone(spellsData);
    const s0 = dup.spells[0]!;
    const s1 = dup.spells[1]!;
    s1.fx[0]!.member = s0.fx[0]!.member;
    expect(spellsDataSchema.safeParse(dup).success).toBe(false);

    const badEffect = structuredClone(spellsData);
    badEffect.spells.push({
      ...structuredClone(badEffect.spells[0]!),
      name: "Ice Shard",
      id: 89,
      effect: "NoSuchSpell",
      fx: [],
    });
    expect(spellsDataSchema.safeParse(badEffect).success).toBe(false);

    const badRunEffect = structuredClone(spellsData);
    const fb = badRunEffect.spells.find((s) => s.name === "Firebolt")!;
    badRunEffect.spells.push({
      ...structuredClone(fb),
      name: "Ice Shard",
      id: 89,
      effect: "Firebolt",
      fx: [{ ...structuredClone(fb.fx[0]!), member: "Ice Shard", effect: "FireballL" }],
    });
    expect(spellsDataSchema.safeParse(badRunEffect).success).toBe(false);
  });

  test("every sound named in content is built", () => {
    const repoRoot = resolve(import.meta.dir, "../../..");
    const valid = new Set<string>(SOUNDS.map((s) => s.toLowerCase()));
    for (const s of listAdded(join(repoRoot, "assets", "added")).sounds) {
      valid.add(s.name.toLowerCase());
    }
    const named: [string, string][] = [];
    for (const s of spellsData.spells) {
      for (const f of s.fx) {
        for (const snd of f.sounds) {
          named.push([`spells ${s.name}/${f.member}`, snd.name]);
        }
      }
    }
    for (const [i, t] of gatherData.gathering.tools.entries()) {
      for (const k of ["successSound", "hitSound"] as const) {
        if (t[k]) {
          named.push([`gather tools[${i}].${k}`, t[k].name]);
        }
      }
    }
    for (const [i, r] of itemRulesData.swing.sounds.entries()) {
      if (r.sound !== null) {
        named.push([`item-rules swing.sounds[${i}]`, r.sound]);
      }
    }
    named.push(["casino slots.sound", casinoData.slots.sound.name]);
    named.push(["casino slots.cash", casinoData.slots.cash.name]);
    expect(named.length).toBeGreaterThan(30);
    for (const [where, name] of named) {
      expect(valid.has(name.toLowerCase()), `${where}: ${name}`).toBe(true);
    }
  });

  test("every added item icon has art", () => {
    const repoRoot = resolve(import.meta.dir, "../../..");
    for (const i of itemsData.items) {
      if (i.icon === "added") {
        expect(existsSync(join(repoRoot, `assets/added/items/${i.name}.png`)), i.name).toBe(true);
        expect(existsSync(join(repoRoot, `assets/added/items/${i.name}.json`)), i.name).toBe(true);
      }
    }
  });

  test("the items schema accepts an added icon and refuses any other string", () => {
    const row = { name: "Frost Bow", icon: "added" };
    expect(itemSchema.safeParse(row).success).toBe(true);
    expect(itemSchema.safeParse({ ...row, icon: "other" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...row, icon: null }).success).toBe(true);
  });

  test("swing.sounds takes any sound name", () => {
    const rules = structuredClone(itemRulesData);
    rules.swing.sounds.push({ match: "contains", pattern: "Frost", sound: "swordhit1" });
    expect(itemRulesDataSchema.safeParse(rules).success).toBe(true);
    rules.swing.sounds[rules.swing.sounds.length - 1]!.sound = "";
    expect(itemRulesDataSchema.safeParse(rules).success).toBe(false);
  });

  describe("renderRects with added art", () => {
    const side = (group: string, regX: number, regY: number) =>
      JSON.stringify({ group, regX, regY, key: "green", prov: "authored", note: "test" });
    const mk = (files: [string, string, number, number, number, number][]) => {
      const dir = mkdtempSync(join(tmpdir(), "sso-rects-"));
      for (const [group, name, w, h, rx, ry] of files) {
        mkdirSync(join(dir, group), { recursive: true });
        writeFileSync(join(dir, group, `${name}.png`), encodePng(createRgba(w, h)));
        writeFileSync(join(dir, group, `${name}.json`), side(group, rx, ry));
      }
      return dir;
    };

    test("renderRects takes added fx, bodies and items art from the image", () => {
      const empty = mk([]);
      const dir = mk([
        ["fx", "Test Bolt-1", 10, 20, 5, 18],
        ["bodies", "9999-F1-S", 30, 40, 15, 38],
        ["items", "Test Gem", 12, 14, 6, 7],
        ["tiles", "T0", 32, 32, 16, 16],
      ]);
      const base = renderRects(undefined, empty) as { fx: Obj; chars: Obj; items: Obj };
      const rects = renderRects(undefined, dir) as { fx: Obj; chars: Obj; items: Obj };
      expect(rects.fx["test bolt-1"]).toEqual([10, 20, 5, 18]);
      expect(rects.chars["9999-f1-s"]).toEqual([30, 40, 15, 38]);
      expect(rects.items["test gem"]).toEqual([12, 14, 6, 7]);
      expect(JSON.stringify(rects).includes("t0")).toBe(false);
      // Every manifest entry is unchanged.
      for (const t of ["fx", "chars", "items"] as const) {
        expect(Object.keys(rects[t]).length).toBe(Object.keys(base[t]).length + 1);
        for (const [k, v] of Object.entries(base[t])) {
          expect(rects[t][k]).toEqual(v);
        }
      }
      rmSync(empty, { recursive: true });
      rmSync(dir, { recursive: true });
    });

    test("renderRects refuses added art named like an original", () => {
      const dir = mk([["fx", "Firebolt-1", 10, 20, 5, 18]]);
      expect(() => renderRects(undefined, dir)).toThrow(/collides with an original FX member/);
      rmSync(dir, { recursive: true });
    });
  });

  test("every summoned species is a monster", () => {
    const monsters = new Set(monstersData.monsters.map((m) => m.name.toLowerCase()));
    for (const s of spellsData.spells) {
      if (s.summon) {
        expect(monsters.has(s.summon.monster.toLowerCase()), s.summon.monster).toBe(true);
        if (s.summon.skilled) {
          expect(
            monsters.has(s.summon.skilled.monster.toLowerCase()),
            s.summon.skilled.monster,
          ).toBe(true);
        }
      }
    }
  });

  test("every skilled.skill is a skill", () => {
    const skills = new Set(classesData.skills.map((k) => k.skill.toLowerCase()));
    for (const s of spellsData.spells) {
      if (s.summon?.skilled) {
        expect(skills.has(s.summon.skilled.skill.toLowerCase()), s.summon.skilled.skill).toBe(true);
      }
    }
  });

  test("every crystal colour is one of the six", () => {
    const colours = new Set(["Blue", "Red", "Green", "Yellow", "Purple", "White"]);
    for (const s of spellsData.spells) {
      if (s.crystals) {
        expect(colours.has(s.crystals.colour), `${s.name}: ${s.crystals.colour}`).toBe(true);
      }
    }
  });

  test("the spell rows are in 1.6's book order: Smoke Bomb first, Bolt before Firebolt", () => {
    const names = spellsData.spells.map((s) => s.name);
    expect(names[0]).toBe("Smoke Bomb");
    expect(names.indexOf("Bolt")).toBeLessThan(names.indexOf("Firebolt"));
    expect(names.slice(-2)).toEqual(["Radar", "Haste"]);
  });

  test("classes refuse more starting values than skills", () => {
    const bad = structuredClone(classesData);
    bad.creation.startingSkills["1"].values.push(1);
    expect(classesDataSchema.safeParse(bad).success).toBe(false);
  });

  test("spells refuse a new spell whose effect is its own unimplemented name", () => {
    const bad = structuredClone(spellsData);
    const firebolt = bad.spells.find((s) => s.name === "Firebolt");
    expect(firebolt).toBeDefined();
    if (!firebolt) {
      return;
    }
    bad.spells.push({
      ...structuredClone(firebolt),
      id: null,
      name: "Ice Shard",
      effect: "Ice Shard",
      fx: firebolt.fx.map((f, i) => ({ ...f, member: `IceShard${i}`, effect: `IceShard${i}` })),
    });
    expect(spellsDataSchema.safeParse(bad).success).toBe(false);
  });
});
