/**
 * Issue #31, stage 3: a monster's NPC file sections. The shared parse and serialise read a file's
 * drop lines, monster spells and flags as the game does, and write them back keeping every other
 * line and every line ending; every Classic file comes back byte for byte. The server's save takes
 * the NPC Editor's path (live, a version kept, the shop started again), refuses a file changed since
 * the page opened it, and is the Content page's permission's.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import { npcFieldOk, npcSections, rollLoot, withNpcSections } from "@secondstaronline/shared";

import { npcFileRevision, npcFileView, saveNpcSections } from "../src/systems/admin/npcsections.ts";
import { npcFileNamed, setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { World } from "../src/systems/world/world.ts";
import { rngByN, setup, testMap } from "./helpers/sim.ts";

const ledgerOf = (world: World) => (npc: string) => world.shops.get(npc) ?? null;

describe("NPC file sections (shared parse and serialise)", () => {
  test("every Classic NPC file reads as the game reads it and comes back byte for byte", () => {
    let mixed = 0;
    for (const f of classicData.npcFiles.files) {
      const s = npcSections(f.text);
      if (s.mixed.length > 0) {
        mixed++;
        expect(() => withNpcSections(f.text, s)).toThrow();
        continue;
      }
      expect(withNpcSections(f.text, s)).toBe(f.text);
      // Re-read with \n and \r\n endings too.
      for (const nl of ["\n", "\r\n"]) {
        const t = f.text.replace(/\r\n|\r|\n/g, nl);
        expect(withNpcSections(t, npcSections(t))).toBe(t);
      }
    }
    // No Classic file mixes sections.
    expect(mixed).toBe(0);
  });

  test("the sections are the lines the loot roll, the casting and the flags read", () => {
    const world = setup([]).world;
    for (const f of classicData.npcFiles.files) {
      const parsed = npcFileNamed(world.npcs, f.name);
      const s = npcSections(f.text);
      expect(s.loot).toEqual(parsed?.loot ?? []);
      expect(s.spells.map((x) => `SPL|${x}`)).toEqual(parsed?.spells ?? []);
      expect(s.flags.map((x) => `FLG|${x}`)).toEqual(parsed?.flags ?? []);
    }
  });

  test("an edit changes only its own lines, in place, and adds new ones after the section", () => {
    const text = "BIO|A troll.\rINV|Club:3\rRND|Grr\rINV|15 Gold:2\rSPL|Fireball\rFLG|Passive";
    const s = npcSections(text);
    expect(s).toEqual({
      loot: [
        { item: "Club", oneIn: 3 },
        { item: "15 Gold", oneIn: 2 },
      ],
      spells: ["Fireball"],
      flags: ["Passive"],
      mixed: [],
    });
    expect(
      withNpcSections(text, {
        loot: [
          { item: "15 Gold", oneIn: 2 },
          { item: "Axe", oneIn: 9 },
        ],
        spells: [],
        flags: ["Passive", "Still"],
      }),
    ).toBe("BIO|A troll.\rINV|15 Gold:2\rRND|Grr\rINV|Axe:9\rFLG|Passive\rFLG|Still");
    // A file with none of a section gets it at the end, in the file's own line ending.
    expect(
      withNpcSections("BIO|x\n", { loot: [{ item: "Axe", oneIn: 2 }], spells: [], flags: [] }),
    ).toBe("BIO|x\nINV|Axe:2\n");
    expect(withNpcSections("", { loot: [], spells: ["Heal"], flags: ["Still"] })).toBe(
      "SPL|Heal\rFLG|Still",
    );
  });

  test("an unchanged entry keeps its line's text exactly, odd spacing included", () => {
    const text = "INV| Club :03\rBIO|x";
    const s = npcSections(text);
    expect(withNpcSections(text, s)).toBe(text);
    expect(withNpcSections(text, { ...s, flags: ["Still"] })).toBe(`${text}\rFLG|Still`);
  });

  test("a line read as two sections is reported and cannot be written", () => {
    const text = "SPL|Heal INV|Club:2";
    expect(npcSections(text).mixed).toEqual([1]);
    expect(() => withNpcSections(text, npcSections(text))).toThrow();
    // A Bio (or any other tag's) line holding "INV|" is read by its reader and as loot.
    expect(npcSections("BIO|x INV|Club:2\rINV|Axe:3").mixed).toEqual([1]);
    // An untagged line holding "INV|" is only loot.
    expect(npcSections("xINV|Club:2").mixed).toEqual([]);
  });

  test("a field is one printable line without the characters that split a line or a file", () => {
    for (const bad of ["a\rb", "a\nb", "a|b", "a:b", "a`b", "a*b", "a^b", "a\u0007b"]) {
      expect(npcFieldOk(bad)).toBe(false);
    }
    expect(npcFieldOk("Passive")).toBe(true);
    expect(npcFieldOk(" Club ")).toBe(true);
  });
});

describe("saving NPC file sections on the server", () => {
  function scene() {
    const map = testMap("x1000y992");
    return setup([map]).world;
  }
  const classicFile = classicData.npcFiles.files.find((f) => npcSections(f.text).loot.length > 0);
  if (!classicFile) {
    throw new Error("Classic has a file with loot");
  }
  const name = classicFile.name;

  test("the view is the file's sections with its revision; a monster without a file has none", () => {
    const world = scene();
    const v = npcFileView(world, name.toUpperCase());
    expect(v?.name).toBe(name);
    expect(v?.exists).toBe(true);
    expect(v?.revision).toBe(npcFileRevision(npcFileNamed(world.npcs, name)?.text ?? ""));
    expect(v?.loot).toEqual(npcSections(classicFile.text).loot);
    expect(v?.spellTags.length).toBeGreaterThan(0);
    const bare = classicData.monsters.monsters.find((m) => !npcFileNamed(world.npcs, m.name));
    if (bare) {
      const b = npcFileView(world, bare.name);
      expect(b).toMatchObject({ name: bare.name, exists: false, revision: null, loot: [] });
    }
    expect(npcFileView(world, "Nobody At All")).toBeNull();
  });

  test("a save applies at once: the next loot roll reads the new lines; other lines stay", () => {
    const world = scene();
    const v = npcFileView(world, name);
    const r = saveNpcSections(
      world,
      name,
      v?.revision ?? null,
      { loot: [{ item: "long sword", oneIn: 1 }], spells: v?.spells ?? [], flags: v?.flags ?? [] },
      ledgerOf(world),
    );
    expect(r.ok).toBe(true);
    expect(r.save?.previous).toBe(npcFileNamed(world.npcs, name) ? r.save?.previous : "");
    const f = npcFileNamed(world.npcs, name);
    // The item takes the content's spelling.
    expect(f?.loot).toEqual([{ item: "Long Sword", oneIn: 1 }]);
    expect(rollLoot(f?.loot ?? null, rngByN())).toBe("Long Sword");
    // Every line that is not a drop line is as it was.
    const others = (t: string) => t.split("\r").filter((l) => !l.toUpperCase().includes("INV|"));
    expect(others(f?.text ?? "")).toEqual(
      others(classicFile.text.replace(/\r\n|\n/g, "\r")).filter(
        (l, i, a) => l !== "" || i < a.length - 1,
      ),
    );
  });

  test("a save over a file changed since it was opened is refused", () => {
    const world = scene();
    const v = npcFileView(world, name);
    // The NPC Editor saves the file meanwhile.
    setNpcFile(world.npcs, name, "BIO|Changed.");
    const r = saveNpcSections(
      world,
      name,
      v?.revision ?? null,
      { loot: [], spells: [], flags: [] },
      ledgerOf(world),
    );
    expect(r.ok).toBe(false);
    expect(r.save).toBeNull();
    expect(r.text).toContain("changed since you opened it");
    expect(npcFileNamed(world.npcs, name)?.text).toBe("BIO|Changed.");
  });

  test("a player shop's file is never content; a field with a line break is refused", () => {
    const world = scene();
    setNpcFile(world.npcs, "Cuche", "SEL|Apple:5:1");
    world.playerShops.set("cuche", {} as never);
    expect(npcFileView(world, "Cuche")).toBeNull();
    expect(
      saveNpcSections(
        world,
        "Cuche",
        npcFileRevision("SEL|Apple:5:1"),
        { loot: [], spells: [], flags: [] },
        ledgerOf(world),
      ).ok,
    ).toBe(false);
    const v = npcFileView(world, name);
    const r = saveNpcSections(
      world,
      name,
      v?.revision ?? null,
      { loot: v?.loot ?? [], spells: v?.spells ?? [], flags: ["Passive\rBIO|Injected"] },
      ledgerOf(world),
    );
    expect(r.ok).toBe(false);
    expect(npcFileNamed(world.npcs, name)?.text).not.toContain("Injected");
  });

  test("an unchanged save writes nothing", () => {
    const world = scene();
    const v = npcFileView(world, name);
    const r = saveNpcSections(
      world,
      name,
      v?.revision ?? null,
      { loot: v?.loot ?? [], spells: v?.spells ?? [], flags: v?.flags ?? [] },
      ledgerOf(world),
    );
    expect(r).toMatchObject({ ok: true, save: null });
  });

  test("a monster with no file gets one; an unknown spell, a bad flag or a bad item is refused", () => {
    const world = scene();
    const bare = classicData.monsters.monsters.find((m) => !npcFileNamed(world.npcs, m.name));
    if (!bare) {
      return;
    }
    const tag = classicData.monsters.casting.spells[0]?.tag as string;
    const bad = [
      { loot: [], spells: ["No Such Spell"], flags: [] },
      { loot: [], spells: [], flags: ["A|B"] },
      { loot: [{ item: "Club:9", oneIn: 2 }], spells: [], flags: [] },
      { loot: [{ item: "No Such Item", oneIn: 2 }], spells: [], flags: [] },
    ];
    for (const next of bad) {
      expect(saveNpcSections(world, bare.name, null, next, ledgerOf(world)).ok).toBe(false);
    }
    expect(npcFileNamed(world.npcs, bare.name)).toBeNull();
    // A stale `expect` for a file that does not exist is refused too.
    expect(
      saveNpcSections(
        world,
        bare.name,
        "0".repeat(16),
        { loot: [], spells: [tag], flags: [] },
        ledgerOf(world),
      ).ok,
    ).toBe(false);
    const r = saveNpcSections(
      world,
      bare.name,
      null,
      { loot: [], spells: [tag], flags: ["Passive"] },
      ledgerOf(world),
    );
    expect(r.ok).toBe(true);
    expect(r.save).toMatchObject({ npc: bare.name, previous: "" });
    expect(npcFileNamed(world.npcs, bare.name)?.text).toBe(`SPL|${tag}\rFLG|Passive`);
    expect(saveNpcSections(world, "Nobody At All", null, bad[0] as never, ledgerOf(world)).ok).toBe(
      false,
    );
  });

  test("a shopkeeper's save starts its shop again from the file, live stock written in", () => {
    const world = scene();
    const shop = classicData.npcFiles.files.find((f) => /(^|\r|\n)SEL\|/.test(f.text));
    if (!shop) {
      throw new Error("Classic has a shopkeeper");
    }
    const f = npcFileNamed(world.npcs, shop.name);
    const sel = f?.sells[0];
    if (!f || !sel) {
      throw new Error("a sell line");
    }
    world.shops.set(f.name, {
      npc: f.name,
      gold: f.gold,
      goldLine: f.goldLine,
      dirty: true,
      lines: [{ kind: "SEL", line: sel.line, item: sel.item, stock: sel.stock + 7 }],
    } as never);
    const v = npcFileView(world, f.name);
    const r = saveNpcSections(
      world,
      f.name,
      v?.revision ?? null,
      {
        loot: [...(v?.loot ?? []), { item: "Long Sword", oneIn: 5 }],
        spells: v?.spells ?? [],
        flags: v?.flags ?? [],
      },
      ledgerOf(world),
    );
    expect(r.text).toStartWith("Saved");
    expect(world.shops.has(f.name)).toBe(false);
    expect(npcFileNamed(world.npcs, f.name)?.sells[0]?.stock).toBe(sel.stock + 7);
  });
});
