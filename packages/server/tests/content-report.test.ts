import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { contentReport, patternTables, TABLES } from "../src/cli/content-report.ts";

const text = (name: string) => contentReport(name).join("\n");

describe("content report (lists every name rule a name matches)", () => {
  test("every name table in content has a catalogue entry, and every catalogue entry exists", () => {
    // A table Classic leaves empty (`requires`, `use.whenFull`, `equip.classes`) has no rows to find, but is
    // catalogued all the same.
    const emptyInClassic = [
      "item-rules.json requires",
      "item-rules.json use.whenFull",
      "item-rules.json equip.classes",
    ];
    expect([...patternTables().keys(), ...emptyInClassic].sort()).toEqual(
      Object.keys(TABLES).sort(),
    );
  });

  test("Wind Cabinet: both containers.capacity rows match and the later one decides (last match wins)", () => {
    // content/README.md "Order inside a table"; item-rules citations: containers.capacity.
    const lines = contentReport("Wind Cabinet");
    const at = lines.findIndex((l) => l.startsWith("item-rules.json containers.capacity"));
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toMatch(/^ {4}#\d+ contains "Cabinet"/);
    expect(lines[at + 2]).toMatch(/^ {2}> #\d+ contains "Wind Cabinet"/);
  });

  test("Crate as an owner: Crate's Door passes the Crate rows", () => {
    // A player called Crate owns a "Crate's Door" which matches every rule for names containing
    // "Crate" (1.6's run-time owner names; content/README.md).
    const lines = contentReport("Crate");
    const door = lines.indexOf(`  "Crate's Door"`);
    expect(door).toBeGreaterThan(0);
    const section = lines.slice(door);
    const cap = section.findIndex((l) => l.includes("item-rules.json containers.capacity"));
    expect(cap).toBeGreaterThan(0);
    expect(section[cap + 1]).toContain('contains "Crate"');
    // The bare form owns no Crate row, so the section lists only what the name adds.
    expect(lines.join("\n")).toContain(`"Crate's Mailbox"`);
  });

  test("Long Sword: equip.slots and swing rows report, Moonblade matches none", () => {
    const sword = text("Long Sword");
    expect(sword).toContain("item-rules.json equip.slots");
    expect(sword).toContain('contains "Long Sword" -> slot="LeftHand"');
    const moon = contentReport("Moonblade");
    expect(moon.filter((l) => l !== "").at(-2)).toBe("No rule matched.");
  });

  test("Wolf is inside the World Editor's monster list text", () => {
    // `inMonsterList`: `MonsterList contains MonsterName`, reverse contains.
    expect(text("Wolf")).toContain(
      "editorLists.worldEditor.monsters (inMonsterList; leansToward by whole entry): yes",
    );
    expect(text("Moonblade")).toContain(
      "editorLists.worldEditor.monsters (inMonsterList; leansToward by whole entry): no",
    );
  });

  test("Firebolt Book: the spells book table's last match is Firebolt, not Bolt", () => {
    // content/README.md Spells: book learning walks spells.json in file order, last match wins.
    const lines = contentReport("Firebolt Book");
    const at = lines.findIndex((l) => l.startsWith("spells.json spells[].book"));
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 2]).toContain('contains "Bolt" [Bolt]');
    expect(lines[at + 3]).toMatch(/^ {2}> .*contains "Firebolt" \[Firebolt\]/);
  });

  test("NPC matches come from editable seed text", () => {
    expect(text("Watering Bucket")).toContain("Agavar: SEL|Watering Bucket:50:999940");
    expect(text("Watering Bucket")).toContain("database edits may differ");
  });

  test("a name prints its report from the command line, with no store installed", () => {
    // The masterworks come from the data the report reads (#30 review): no "no content store".
    const run = Bun.spawnSync([
      "bun",
      join(import.meta.dir, "../src/cli/content-report.ts"),
      "Sword of Hope +1",
    ]);
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
    const out = run.stdout.toString();
    expect(out).toContain('Content report for "Sword of Hope +1"');
    expect(out).toContain('exact "Sword of Hope"');
    expect(out).toContain("every matching row rolls; the last roll stands");
  });

  test("an empty name prints the usage", () => {
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli/content-report.ts")]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain("usage: bun run content:report <name>");
  });
});
