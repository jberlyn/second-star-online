/**
 * Operator command: lists every name rule a name matches, so the `contains` pitfalls show before
 * they bite (a player called "Crate" owns a "Crate's Door", which passes every rule for names
 * containing "Crate"). It runs the game's own matching (shared `matchAllTables`) over the
 * Classic pack as `bun run data:build` last built it, so run it after the build.
 *
 * Run: `bun run content:report <name>`.
 */
import { classicData } from "@secondstaronline/data/classic";
import { DATASET_FILES, type SchemaDatasetId } from "@secondstaronline/data/schema";
import {
  type ContentData,
  lingoContains,
  lingoEq,
  matchAllTables,
  NAME_TABLES,
  nameTables,
  type NameRow as Row,
  type TableInfo,
  type Wins,
} from "@secondstaronline/shared";

const {
  items: itemsData,
  monsters: monstersData,
  npcFiles: npcFilesData,
  spells: spellsData,
} = classicData;

/** A shared table key (`itemRules equip.slots`) as the report names it (`item-rules.json equip.slots`). */
const fileKey = (key: string): string => {
  const sp = key.indexOf(" ");
  return `${DATASET_FILES[key.slice(0, sp) as SchemaDatasetId]}.json${key.slice(sp)}`;
};

/**
 * Every name table in the generated content, by `<file> <path>` (array indexes written `[]`).
 * Found by walking the data (shared `nameTables`), so a table added later can't be missed.
 */
export function patternTables(): Map<string, Row[]> {
  const data = Object.fromEntries(Object.entries(classicData)) as Partial<ContentData>;
  return new Map([...nameTables(data)].map(([k, v]) => [fileKey(k), v]));
}

/** What each table decides and how its rows combine (shared `NAME_TABLES`), by file key. */
export const TABLES: Record<string, TableInfo> = Object.fromEntries(
  Object.entries(NAME_TABLES).map(([k, v]) => [fileKey(k), v]),
);

/** One table's matching rows for the report, keyed by file. */
interface Hit {
  key: string;
  info: TableInfo;
  rows: Row[];
  deciding: Set<Row>;
}

/** Which rows of every table match `name`, and which of them decide. */
function matchAll(name: string): Hit[] {
  const data = Object.fromEntries(Object.entries(classicData)) as Partial<ContentData>;
  // A row that tests no name (a skill block for every weapon) is no name rule: left out.
  return matchAllTables(name, data)
    .map((h) => ({
      key: fileKey(h.key),
      info: h.info,
      rows: h.rows.filter((r) => r.match !== "any"),
      deciding: new Set(h.deciding.filter((r) => r.match !== "any")),
    }))
    .filter((h) => h.rows.length > 0);
}

/** What a table's rows give, for display: every field except the test itself. */
function resultOf(r: Row): string {
  const skip = new Set(["match", "pattern", "item", "weaponMatch"]);
  const parts = Object.entries(r.raw)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const text = parts.length > 0 ? parts.join(" ") : "yes";
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

const rowText = (r: Row): string => {
  const head = `${r.index > 0 ? `#${r.index} ` : ""}${r.match} ${JSON.stringify(r.pattern)}`;
  const subject = r.subject ? ` [${r.subject}]` : "";
  return `${head}${subject} -> ${resultOf(r)}`;
};

const WINS_TEXT: Record<Wins, string> = {
  first: "first match wins",
  last: "last match wins",
  any: "any match counts",
  adds: "every matching row applies",
  order: "rows apply in order, each rewriting its layer",
  rolls: "every matching row rolls; the last roll stands",
};

function hitLines(hits: Hit[], keep?: (r: Row) => boolean): string[] {
  const out: string[] = [];
  for (const h of hits) {
    const rows = keep ? h.rows.filter(keep) : h.rows;
    if (rows.length === 0) {
      continue;
    }
    out.push(`${h.key}: ${h.info.decides} (${WINS_TEXT[h.info.wins]})`);
    if (h.info.note) {
      out.push(`    note: ${h.info.note}`);
    }
    for (const r of rows) {
      out.push(`  ${h.deciding.has(r) ? ">" : " "} ${rowText(r)}`);
    }
  }
  return out;
}

/**
 * The names the game builds from an owner's name (a player or a guild). Each form is a name whose
 * `'s <Thing>` part the rules test with `contains`. Sources: the pictures of owner-named
 * ground fixtures, the door pair and the guild vault (`The <guild>'s Guild Vault`).
 */
const OWNER_FORMS: ((owner: string) => string)[] = [
  (o) => `${o}'s Door`,
  (o) => `${o}'s Opened Door`,
  (o) => `${o}'s Mailbox`,
  (o) => `${o}'s Airship`,
  (o) => `${o}'s Boat`,
  (o) => `${o}'s Battleship`,
  (o) => `${o}'s Board`,
  (o) => `${o}'s House Vault`,
  (o) => `The ${o}'s Guild Vault`,
  (o) => `${o}'s Newspaper`,
];

/**
 * The entries of a list whose text contains `name` (a case-insensitive substring match).
 */
const listHits = (entries: string[], name: string): string[] =>
  entries.filter((e) => lingoContains(e, name));

/**
 * The report for `name`, as lines: the catalogue entries it is, every name rule it passes (the
 * row that decides is marked `>`), the lists whose text contains it, and the same for the
 * owner-named fixtures a player or guild of that name owns.
 */
export function contentReport(name: string): string[] {
  const lines: string[] = [`Content report for "${name}"`, ""];

  lines.push("Catalogue");
  const cat: string[] = [];
  for (const i of itemsData.items) {
    if (lingoEq(i.name, name)) {
      const icon =
        i.icon === undefined
          ? "no icon record"
          : i.icon === null
            ? "no icon"
            : i.icon === "added"
              ? "added icon"
              : "original icon";
      cat.push(`  items.json items: "${i.name}" (${icon})`);
    }
  }
  for (const f of itemsData.fixtures) {
    if (lingoEq(f, name)) {
      cat.push(`  items.json fixtures: "${f}"`);
    }
  }
  for (const m of monstersData.monsters) {
    if (lingoEq(m.name, name)) {
      cat.push(`  monsters.json monsters: "${m.name}" (body ${m.body})`);
    }
  }
  for (const s of spellsData.spells) {
    if (lingoEq(s.name, name)) {
      cat.push(`  spells.json spells: "${s.name}"`);
    }
  }
  lines.push(...(cat.length > 0 ? cat : ["  no exact entry"]), "");

  lines.push("Name rules");
  const hits = matchAll(name);
  const rules = hitLines(hits);
  lines.push(...(rules.length > 0 ? rules : ["  none"]), "");

  lines.push("Lists that contain the name");
  const monsterText = monstersData.monsters.map((m) => m.name);
  const lists: [string, string[]][] = [
    ["monsters.json monsters (inMonsterList)", monsterText],
    [
      "monsters.json editorLists.worldEditor.monsters (inMonsterList; leansToward by whole entry)",
      monstersData.editorLists.worldEditor.monsters,
    ],
    ["monsters.json editorLists.npcEditor.npcs (isNpced)", monstersData.editorLists.npcEditor.npcs],
  ];
  for (const [label, entries] of lists) {
    const found = name === "" ? [] : listHits(entries, name);
    lines.push(`  ${label}: ${found.length > 0 ? "yes" : "no"}`);
    if (found.length > 0) {
      lines.push(`    ${found.map((e) => JSON.stringify(e)).join(", ")}`);
    }
  }
  lines.push("");

  lines.push("NPC seed text containing the name (database edits may differ)");
  const npcHits: string[] = [];
  if (name !== "") {
    for (const file of npcFilesData.files) {
      for (const line of file.text.split(/\r\n|\r|\n/)) {
        if (lingoContains(line, name)) {
          npcHits.push(`  ${file.name}: ${line}`);
        }
      }
    }
  }
  lines.push(...(npcHits.length > 0 ? npcHits : ["  none"]), "");

  lines.push("As an owner (rows that match only because of the name)");
  let any = false;
  for (const form of OWNER_FORMS) {
    const full = form(name);
    const bare = form("");
    const ownerHits = matchAll(full);
    const bareHits = new Set(
      matchAll(bare).flatMap((h) => h.rows.map((r) => `${h.key}#${r.subject ?? ""}#${r.index}`)),
    );
    const keep = (key: string) => (r: Row) => !bareHits.has(`${key}#${r.subject ?? ""}#${r.index}`);
    const block: string[] = [];
    for (const h of ownerHits) {
      const own = hitLines([h], keep(h.key));
      block.push(...own);
    }
    if (block.length > 0) {
      any = true;
      lines.push(`  ${JSON.stringify(full)}`);
      lines.push(...block.map((l) => `    ${l}`));
    }
  }
  if (!any) {
    lines.push("  none");
  }
  lines.push("");

  if (rules.length === 0 && !any && cat.length === 0) {
    lines.push("No rule matched.");
  } else if (rules.length === 0) {
    lines.push("No rule matched the name itself.");
  }
  lines.push(
    "A `contains` row that matches also matches any longer name holding this one (`<name>#12`, `<name>+3`, `Damaged <name>`).",
  );
  return lines;
}

if (import.meta.main) {
  const name = process.argv.slice(2).join(" ");
  if (name.trim() === "") {
    console.error("usage: bun run content:report <name>");
    process.exit(2);
  }
  console.log(contentReport(name).join("\n"));
}
