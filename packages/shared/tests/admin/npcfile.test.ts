/** NPC files as the 1.6 readers see them, and the NPC editor's rules. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { monsters: monstersData } = classicData;

import npcsData from "@secondstaronline/data/test-fixtures/npc-expectations";

import {
  checkNpcFile,
  editorLines,
  liveNpcText,
  NPC_EDITOR_MONSTERS,
  NPC_EDITOR_NPCS,
  NPC_SPELL_TAGS,
  npcEditorName,
  npcLootItemOk,
  npcShopItemOk,
  parseNpcFile,
  showNpcScript,
} from "../../src/rules/admin/npcfile.ts";

/** `n` filler lines, then `line`, so `line` sits at file line n + 1. */
const at = (n: number, line: string) => [...Array.from({ length: n }, () => "BIO|x"), line];

describe("the readers read the whole file (parseNpcFile)", () => {
  test("bug fixed: INV| counts on any line, past line 80 too", () => {
    expect(parseNpcFile("A", at(79, "INV|5 Gold:1").join("\r")).loot).toEqual([
      { item: "5 Gold", oneIn: 1 },
    ]);
    expect(parseNpcFile("A", at(98, "INV|5 Gold:1").join("\r")).loot).toEqual([
      { item: "5 Gold", oneIn: 1 },
    ]);
  });
  test("bug fixed: RND| counts on any line, past line 20 too", () => {
    expect(parseNpcFile("A", at(19, "RND|hi").join("\r")).chatter).toEqual(["hi"]);
    expect(parseNpcFile("A", at(50, "RND|hi").join("\r")).chatter).toEqual(["hi"]);
  });
  test("BIO| and PRO| among lines 1-100; FLG|, SPL| and BNK| anywhere; an empty file is EMPTY", () => {
    const f = parseNpcFile("A", "PRO|p\rFLG|Still\rSPL|Meteor\rBNK|");
    expect([f.profile, f.flags, f.spells, f.banker, f.empty]).toEqual([
      ["p"],
      ["FLG|Still"],
      ["SPL|Meteor"],
      true,
      false,
    ]);
    expect(parseNpcFile("A", "").empty).toBe(true);
  });
  test("SEL|, BUY| and GLD| keep their file lines (the buy loop's bug and the gold windows read them)", () => {
    const f = parseNpcFile("A", "BIO|x\rSEL|Knife:5:10\rBUY|Knife:2:junk\rGLD|100");
    expect(f.sells).toEqual([{ item: "Knife", price: 5, stock: 10, line: 2 }]);
    expect(f.buys).toEqual([{ item: "Knife", price: 2, line: 3 }]);
    expect([f.gold, f.goldLine]).toEqual([100, 4]);
  });
  test("CRLF and LF end a line too (the one CRLF archive file; a browser's field)", () => {
    expect(parseNpcFile("A", "BIO|a\r\nBIO|b\nBIO|c").bio).toEqual(["a", "b", "c"]);
  });
  test("the 13 SPL| tags the monster casters test", () => {
    expect(NPC_SPELL_TAGS).toHaveLength(13);
    expect(NPC_SPELL_TAGS).toEqual(monstersData.casting.spells.map((s) => s.tag));
  });
});

describe("LOAD's ShowNPCScript", () => {
  test("lossless display: preserves OWN|, all first characters, empty lines, and >100 lines", () => {
    expect(showNpcScript("")).toBe("");
    expect(showNpcScript("OWN|king\r\rbio|lower\r\nSEL|Knife:5:7")).toBe(
      "OWN|king\r\rbio|lower\rSEL|Knife:5:7",
    );
    const long = Array.from({ length: 105 }, (_, i) => `BIO|${i + 1}`).join("\r");
    const shown = showNpcScript(long).split("\r");
    expect(shown).toHaveLength(105);
    expect(shown.at(-1)).toBe("BIO|105");
    expect(checkNpcFile(editorLines(showNpcScript(long))).error).toBe(
      "An NPC file holds at most 100 lines.",
    );
  });

  test("repeated LOAD preserves trailing line endings without adding blank lines", () => {
    for (const text of ["", "OWN|king", "BIO|hello\r\r", "BIO|hello\r\n\r\nOWN|king\n"]) {
      const normalized = text.replace(/\r\n|\r|\n/g, "\r");
      expect(showNpcScript(text)).toBe(normalized);
      expect(showNpcScript(showNpcScript(text))).toBe(normalized);
    }
  });
});

describe("LOAD shows the live ledger (the file was the ledger in 1.6)", () => {
  test("a sale rewrites SEL|<item>:<price>:<stock>; a payment GLD|<n>", () => {
    const f = parseNpcFile("Cril", "SEL|Knife:5:10\rBUY|Knife:2\rGLD|100");
    const ledger = {
      gold: 115,
      lines: [
        { line: 1, kind: "SEL" as const, item: "Knife", price: 5, stock: 7 },
        { line: 2, kind: "BUY" as const, item: "Knife", price: 2, stock: null },
      ],
    };
    expect(liveNpcText(f, ledger)).toBe("SEL|Knife:5:7\rBUY|Knife:2\rGLD|115");
    expect(liveNpcText(f, null)).toBe(f.text);
  });
});

describe("the editor's checks", () => {
  const check = (...lines: string[]) => checkNpcFile(lines);
  test("every SEL|/BUY| item and INV| name the archive uses is accepted (the whole files: server tests)", () => {
    for (const n of npcsData.npcs) {
      for (const s of [...n.sells, ...n.buys]) {
        expect([n.name, s.item, npcShopItemOk(s.item)]).toEqual([n.name, s.item, true]);
      }
    }
    for (const t of npcsData.lootTables) {
      for (const l of t.lines) {
        expect([t.npc, l.item, npcLootItemOk(l.item)]).toEqual([t.npc, l.item, true]);
      }
    }
  });
  test("refused: backtick, * and ^", () => {
    expect(check("BIO|a`b").error).toBe("Line 1: the characters ` * ^ cannot be used.");
    expect(check("BIO|x", "PRO|*").error).toMatch(/^Line 2:/);
    expect(check("RND|^").error).not.toBeNull();
  });
  test("refused: unknown or lower-case tags, a second |, more than 100 lines, long lines", () => {
    expect(check("WN|king").error).toMatch(/^Line 1: unknown tag "WN\|"/);
    expect(check("sel|Knife:5:10").error).toMatch(/unknown tag/);
    expect(check("BIO|a|b").error).toBe('Line 1: only one "|" per line.');
    expect(check(...Array.from({ length: 101 }, () => "BIO|x")).error).toBe(
      "An NPC file holds at most 100 lines.",
    );
    expect(check(`BIO|${"x".repeat(252)}`).error).toMatch(/at most 255/);
  });
  test("refused: unknown items, bad numbers, two GLD| lines", () => {
    expect(check("SEL|Fire:5:10").error).toBe('Line 1: "Fire" is not an item.');
    expect(check("SEL|Knife:5").error).toBe("Line 1: SEL|<item>:<price>:<stock>.");
    expect(check("SEL|Knife:-5:10").error).toMatch(/whole numbers from 0/);
    expect(check("INV|Knife:0").error).toMatch(/from 1/);
    expect(check("INV|Gold Bars:1").error).toBe('Line 1: "Gold Bars" is not an item.');
    expect(check("GLD|1", "GLD|2").error).toBe("Line 2: an NPC has one GLD| line.");
  });
  test("accepted: archived spellings, N Gold, N crystals, fixtures, BUY's ignored third field", () => {
    expect(check("SEL|apple:2:10", "BUY|knife:1:x", "INV|10 gold:3").error).toBeNull();
    expect(
      check("INV|5 Blue Crystals:1", "INV|Chain boots:40", "BNK|", "OWN|king").error,
    ).toBeNull();
  });
  test("bug fixed: a till filled without a GLD| line shows as one in the live file", () => {
    const f = parseNpcFile("Fire God", "BIO|Name: Fire God\rSEL|Fireball Book:100:98");
    const ledger = {
      gold: 100,
      lines: [{ line: 2, kind: "SEL" as const, item: "Fireball Book", price: 100, stock: 97 }],
    };
    expect(liveNpcText(f, ledger).split("\r")).toEqual([
      "BIO|Name: Fire God",
      "SEL|Fireball Book:100:97",
      "GLD|100",
    ]);
    expect(liveNpcText(f, { ...ledger, gold: 0 }).split("\r")).toHaveLength(2);
  });
  test("warned: inert tags only; no line is outside a reader's window", () => {
    expect(check(...at(16, "SEL|Knife:5:10")).warnings).toEqual([]);
    expect(check(...at(16, "SEL|Blue Crystals:5:10")).warnings).toEqual([]);
    expect(check(...at(80, "SEL|Blue Crystals:5:10")).warnings).toEqual([]);
    // GLD| counts wherever it is.
    expect(check(...at(60, "GLD|5")).warnings).toEqual([]);
    expect(check(...at(80, "GLD|5")).warnings).toEqual([]);
    // Nor do INV| and RND|.
    expect(check(...at(80, "INV|5 Gold:1")).warnings).toEqual([]);
    expect(check(...at(20, "RND|hi")).warnings).toEqual([]);
    expect(check("FLG|Aggressive", "SPL|Teleport", "TRN|Ninja:5").warnings).toEqual([
      "Line 1: only FLG|Still and FLG|Passive do anything.",
      'Line 2: no monster casts "Teleport".',
      'Line 3: no class "Ninja" can be trained: 1.6 has no rule for it.',
    ]);
    // A class with a branch (any case) is fine.
    expect(check("TRN|Fire Mage:10000", "TRN|grunt:100").warnings).toEqual([]);
    // The format errors stay.
    expect(check("TRN|Grunt").error).toBe("Line 1: TRN|<class>:<price>.");
    expect(check("TRN|Grunt:x").error).toBe("Line 1: the price is a whole number from 0.");
  });
  test("trains: TRN| lines with their file lines", () => {
    const f = parseNpcFile(
      "Trainer",
      ["BIO|hi", "TRN|Fire Mage:10000", "x", "TRN|Bard:", "TRN|Ninja"].join("\r"),
    );
    expect(f.trains).toEqual([
      { cls: "Fire Mage", price: 10000, line: 2 },
      { cls: "Bard", price: 0, line: 4 },
      { cls: "Ninja", price: 0, line: 5 },
    ]);
  });
  test("a save's text: the field's last RETURN ends no line", () => {
    expect(editorLines("BIO|a\nBIO|b\n")).toEqual(["BIO|a", "BIO|b"]);
    expect(editorLines("")).toEqual([]);
  });
});

describe("the editor's lists (T/285084_MONed, T/207780_NPCed)", () => {
  test("36 monsters and 56 NPCs; names match ignoring case", () => {
    expect([NPC_EDITOR_MONSTERS.length, NPC_EDITOR_NPCS.length]).toEqual([36, 56]);
    expect(NPC_EDITOR_MONSTERS).toEqual(monstersData.editorLists.npcEditor.monsters);
    expect(NPC_EDITOR_NPCS).toEqual(monstersData.editorLists.npcEditor.npcs);
    expect(npcEditorName("cril")).toBe("Cril");
    expect(npcEditorName("Cuche")).toBeNull(); // a player shop's file: not on the lists
    expect(npcEditorName("")).toBeNull();
  });
});
