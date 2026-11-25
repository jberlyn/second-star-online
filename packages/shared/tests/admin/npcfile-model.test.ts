/**
 * Issue #32, stage 0: a whole NPC file as its sections. Every Classic file reads as the game reads
 * it (the parsed NPC file's Bio, profile, chatter, sells, buys, till, trainer lines, loot, spells
 * and flags) and comes back byte for byte; an edit changes only its own section's lines, keeps the
 * lines no section holds (`OWN|`, blank lines, unknown tags) in place, and writes new entries in
 * their tag's form.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import {
  emptyNpcModel,
  type NpcModel,
  npcModel,
  parseNpcFile,
  withNpcModel,
} from "../../src/rules/admin/npcfile.ts";

const FILES = classicData.npcFiles.files;

describe("the NPC file model (issue #32)", () => {
  test("every Classic file reads as the game reads it, and comes back byte for byte", () => {
    for (const f of FILES) {
      const m = npcModel(f.text);
      expect({ name: f.name, mixed: m.mixed }).toEqual({ name: f.name, mixed: [] });
      const p = parseNpcFile(f.name, f.text);
      expect({ name: f.name, got: m.bio }).toEqual({ name: f.name, got: p.bio });
      expect({ name: f.name, got: m.profile }).toEqual({ name: f.name, got: p.profile });
      expect({ name: f.name, got: m.chatter }).toEqual({ name: f.name, got: p.chatter });
      expect(m.sells).toEqual(p.sells.map(({ line: _l, ...s }) => s));
      expect(m.buys).toEqual(p.buys.map(({ line: _l, ...s }) => s));
      expect(m.trains).toEqual(p.trains.map(({ line: _l, ...t }) => t));
      expect(m.loot).toEqual(p.loot);
      expect(m.spells.map((x) => `SPL|${x}`)).toEqual(p.spells);
      expect(m.flags.map((x) => `FLG|${x}`)).toEqual(p.flags);
      expect(m.banker.length > 0).toBe(p.banker);
      if (p.goldLine !== null) {
        expect(m.gold.at(-1)).toBe(p.gold ?? 0);
      }
      // Unchanged, every section given back: the same bytes.
      const { mixed: _m, lines: _ls, ...sections } = m;
      expect(withNpcModel(f.text, sections)).toBe(f.text);
      // Each line is in one section, or kept as it is.
      expect(m.lines.length).toBe(
        f.text === ""
          ? 0
          : f.text.split(/\r\n|\r|\n/).length - (/(\r\n|\r|\n)$/.test(f.text) ? 1 : 0),
      );
    }
  });

  test("an edit changes its section's lines in place and leaves every other line", () => {
    const text =
      "OWN|king\rBIO|Name: Ann\rSEL|Apple:10:5\rBUY|Apple:5\r\rGLD|100\rTRN|Earth Mage:10000";
    const m = npcModel(text);
    expect(m.lines.map((l) => l.kind)).toEqual([
      null,
      "bio",
      "sells",
      "buys",
      null,
      "gold",
      "trains",
    ]);
    const next: Partial<NpcModel> = {
      sells: [
        { item: "Apple", price: 10, stock: 5 },
        { item: "Pie", price: 12, stock: 3 },
      ],
      gold: [250],
      bio: [],
    };
    expect(withNpcModel(text, next)).toBe(
      "OWN|king\rSEL|Apple:10:5\rSEL|Pie:12:3\rBUY|Apple:5\r\rGLD|250\rTRN|Earth Mage:10000",
    );
    // A section the file lacks goes at the end.
    expect(withNpcModel("BIO|x", { chatter: ["Hello"], banker: [""] })).toBe(
      "BIO|x\rRND|Hello\rBNK|",
    );
    expect(withNpcModel("", { ...emptyNpcModel(), bio: ["A"] })).toBe("BIO|A");
  });

  test("a malformed line is written afresh when the form saves its entry (Neon review)", () => {
    // Reads as stock 0; saving the form writes it whole, so the check passes.
    const text = "SEL|Apple:10\rGLD|100a";
    const m = npcModel(text);
    expect(m.sells).toEqual([{ item: "Apple", price: 10, stock: 0 }]);
    expect(withNpcModel(text, { sells: m.sells, gold: m.gold })).toBe("SEL|Apple:10:0\rGLD|0");
    // A section not given is left as it was, malformed or not.
    expect(withNpcModel(text, { bio: [] })).toBe(text);
  });

  test("a blank line before a removed last entry stays", () => {
    // The file's lines: OWN|king, a blank line, BIO|x. Taking the Bio out keeps the blank line.
    const out = withNpcModel("OWN|king\r\rBIO|x", { bio: [] });
    expect(out).toBe("OWN|king\r\r");
    expect(npcModel(out).lines.map((l) => l.text)).toEqual(["OWN|king", ""]);
  });

  test("a tag line holding INV| is read two ways and cannot be written", () => {
    // Read as the game reads it: a drop, and a spell cast.
    const m = npcModel("SPL|Splash INV|Club:2");
    expect(m.mixed).toEqual([1]);
    expect(m.spells).toEqual(["Splash INV|Club:2"]);
    // The loot roll reads the part after the first "|", as parseNpcFile does.
    expect(m.loot).toEqual(parseNpcFile("x", "SPL|Splash INV|Club:2").loot);
    expect(npcModel("BIO|I sell INV|x:1").mixed).toEqual([1]);
    expect(() => withNpcModel("BIO|I sell INV|x:1", { bio: [] })).toThrow();
  });
});
