/**
 * The differences document's summary tables must match its entries, and every entry's Kind must
 * be one the policy lists. Entries are `####` headings, except under Kept on purpose (`###`) and
 * Not in SSO (one bullet each).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOC = readFileSync(join(import.meta.dir, "..", "docs", "differences-from-fso.md"), "utf8");

const KINDS = [
  "Bug fixed",
  "Kept on purpose",
  "Architecture",
  "Exploit closed",
  "Limit lifted",
  "World content",
  "Platform",
  "Other",
];

interface Ledger {
  sections: Map<string, number>;
  subsections: Map<string, number>;
  kinds: string[];
}

function readLedger(): Ledger {
  const sections = new Map<string, number>();
  const subsections = new Map<string, number>();
  const kinds: string[] = [];
  let section = "";
  let subsection = "";
  let fenced = false;
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  for (const line of DOC.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
    }
    if (fenced) {
      continue;
    }
    if (line.startsWith("## ")) {
      section = line.slice(3);
      subsection = "";
    } else if (line.startsWith("### ")) {
      subsection = line.slice(4);
      if (section === "Kept on purpose") {
        bump(sections, section);
      }
    } else if (line.startsWith("#### ")) {
      bump(sections, section);
      bump(subsections, `${section}/${subsection}`);
    } else if (section === "Not in SSO" && /^- \*\*[^*]+\*\* /.test(line)) {
      if (!line.startsWith("- **Pinned by:**")) {
        bump(sections, section);
      }
    }
    const kind = /^- \*\*Kind:\*\* (.+)$/.exec(line);
    if (kind) {
      kinds.push(kind[1] as string);
    }
  }
  return { sections, subsections, kinds };
}

/** The rows of the Markdown table whose header row starts with `header`. */
function tableRows(header: string): string[][] {
  const lines = DOC.split("\n");
  const start = lines.findIndex((l) => l.startsWith(header));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  }
  return rows;
}

const count = (cell: string) => Number(/(\d+)/.exec(cell)?.[1]);
const label = (cell: string) => cell.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/, "$1");

describe("differences from 1.6", () => {
  const ledger = readLedger();

  test("the section table counts every entry", () => {
    const rows = tableRows("| Section | Entries |");
    let total = 0;
    for (const [name, n] of rows) {
      const section = label(name as string);
      if (section === "Total") {
        expect(count(n as string)).toBe(total);
        continue;
      }
      expect({ section, entries: count(n as string) }).toEqual({
        section,
        entries: ledger.sections.get(section) ?? 0,
      });
      total += ledger.sections.get(section) ?? 0;
    }
  });

  test("the system table counts every fixed bug and server-side entry", () => {
    const rows = tableRows("| System | Bugs fixed |");
    for (const [system, fixed, authority] of rows) {
      const name = system as string;
      expect({
        name,
        fixed: count(fixed as string),
        authority: count(authority as string),
      }).toEqual({
        name,
        fixed: ledger.subsections.get(`Fixed bugs/${name}`) ?? 0,
        authority: ledger.subsections.get(`Server authority and exploits/Server-side ${name}`) ?? 0,
      });
    }
  });

  test("every entry's Kind is one the policy lists", () => {
    expect(ledger.kinds.filter((k) => !KINDS.includes(k))).toEqual([]);
  });
});
