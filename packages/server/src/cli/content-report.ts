/**
 * Operator command: lists every name rule a name matches, so the `contains` pitfalls show before
 * they bite (a player called "Crate" owns a "Crate's Door", which passes every rule for names
 * containing "Crate"). It runs the game's own matching (`ruleMatches` in shared) over the
 * Classic pack as `bun run data:build` last built it, so run it after the build.
 *
 * Run: `bun run content:report <name>`.
 */
import { classicData } from "@secondstaronline/data/classic";
import { DATASET_FILES, type SchemaDatasetId } from "@secondstaronline/data/schema";
import { lingoContains, lingoEq, type PatternRow, ruleMatches } from "@secondstaronline/shared";

type Obj = Record<string, unknown>;

const {
  items: itemsData,
  monsters: monstersData,
  npcFiles: npcFilesData,
  spells: spellsData,
} = classicData;

/** Which match decides the answer when several rows of a table match. */
export type Wins = "first" | "last" | "any" | "adds" | "order";

export interface TableInfo {
  /** What the table decides, in play terms. */
  decides: string;
  wins: Wins;
  /** A row-level condition the report can't evaluate (the slot a row tests, a trigger…). */
  note?: string;
}

/** One row of a name table: the matching rule, its text and its place in the table. */
interface Row {
  match: string;
  pattern: string;
  index: number;
  /** The record the row belongs to (a spell, a skill block), for per-record tables. */
  subject?: string;
  raw: Obj;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The `{ match, pattern }` of an object, if it is a name test (houses' fixtures name it `item`).
 */
function asTest(o: Obj): { match: string; pattern: string } | null {
  if (isStr(o.match) && isStr(o.pattern)) {
    return { match: o.match, pattern: o.pattern };
  }
  if (isStr(o.match) && isStr(o.item)) {
    return { match: o.match, pattern: o.item };
  }
  if (isStr(o.weaponMatch) && isStr(o.pattern) && o.weaponMatch !== "any") {
    return { match: o.weaponMatch, pattern: o.pattern };
  }
  return null;
}

/** An `any` skill block tests no name: it applies to every weapon. */
const isAnyBlock = (o: Obj): boolean => o.weaponMatch === "any";

const subjectOf = (o: Obj): string | undefined =>
  isStr(o.name)
    ? o.name
    : isStr(o.weaponMatch)
      ? `${o.weaponMatch} "${o.pattern ?? ""}" weapon block`
      : undefined;

/**
 * Every name table in the generated content, by `<file> <path>` (array indexes written `[]`):
 * an array whose elements are all name tests, or a single name test (`equip.murder`, a spell's
 * `book`). Found by walking the data, so a table added later can't be missed.
 */
export function patternTables(): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  const add = (key: string, o: Obj, index: number, subject: string | undefined) => {
    const t = asTest(o);
    if (!t) {
      return;
    }
    const list = out.get(key) ?? [];
    list.push({ ...t, index, subject, raw: o });
    out.set(key, list);
  };
  const walk = (v: unknown, file: string, path: string, subject: string | undefined) => {
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      const rows = objs.filter((o) => asTest(o) !== null || isAnyBlock(o));
      if (v.length > 0 && rows.length === v.length) {
        v.forEach((o, i) => {
          if (!isAnyBlock(o as Obj)) {
            add(`${file} ${path}`, o as Obj, i + 1, subject);
          }
        });
        // Rows can hold tables of their own (a skill block's tiers).
        for (const o of objs) {
          for (const [k, c] of Object.entries(o)) {
            walk(c, file, `${path}[].${k}`, subjectOf(o) ?? subject);
          }
        }
        return;
      }
      for (const o of v) {
        walk(o, file, `${path}[]`, isObj(o) ? (subjectOf(o) ?? subject) : subject);
      }
      return;
    }
    if (isObj(v)) {
      if (asTest(v) !== null) {
        add(`${file} ${path}`, v, 0, subject);
        return;
      }
      for (const [k, c] of Object.entries(v)) {
        walk(c, file, path === "" ? k : `${path}.${k}`, subject);
      }
    }
  };
  for (const [id, data] of Object.entries(classicData)) {
    if (id !== "npcFiles" && id !== "rects" && isObj(data)) {
      walk(data, `${DATASET_FILES[id as SchemaDatasetId]}.json`, "", undefined);
    }
  }
  return out;
}

/**
 * What each table decides and how its rows combine. The `wins` values are from the code that
 * reads each table (the functions are named in the comment on the entry).
 */
export const TABLES: Record<string, TableInfo> = {
  // strengthRequirement, equipSlotFor, menuAction, useItem, bookDex, invAdd, swingCooldowns,
  // damagedForm
  [`item-rules.json behaviours`]: {
    decides: "what an item does (a key, a bow, a chest, a crate…)",
    wins: "adds",
    note: "each matching row gives its behaviour; rows test the name without its #id or +N, and never an engine fixture's (Bob's Door)",
  },
  [`item-rules.json equip.strength`]: { decides: "the Strength needed to equip", wins: "last" },
  [`item-rules.json equip.slots`]: { decides: "which slot the item goes in", wins: "last" },
  [`item-rules.json menu`]: {
    decides: "the item menu's button in place of Equip",
    wins: "last",
  },
  [`item-rules.json use.books`]: { decides: "the Mysticism a spell book needs", wins: "last" },
  [`item-rules.json use.messages`]: { decides: "the text Use shows for food", wins: "last" },
  [`item-rules.json use.refusals`]: {
    decides: "the line Use shows for an item it refuses",
    wins: "last",
  },
  [`item-rules.json containers.capacity`]: { decides: "lines a container holds", wins: "last" },
  [`item-rules.json swing.cooldowns`]: {
    decides: "swing delays for a worn item",
    wins: "last",
    note: "the row's slot is the worn slot it tests",
  },
  [`item-rules.json breaks.damaged`]: { decides: "what a broken item becomes", wins: "last" },
  // checkEquip, useDeferred, useItem, blocksPlayer, invAdd
  [`item-rules.json equip.twoHanded`]: { decides: "two-handed weapons", wins: "any" },
  [`item-rules.json equip.murder`]: { decides: "items needing the murder flag", wins: "any" },
  [`item-rules.json use.silent`]: { decides: "Use says and does nothing", wins: "any" },
  [`item-rules.json use.usable`]: { decides: "what Use accepts (food and potions)", wins: "any" },
  [`item-rules.json ground.blocks`]: { decides: "ground items that stop a walker", wins: "any" },
  [`item-rules.json ground.platforms`]: {
    decides: "blocks until a skill (or the level) reaches the row's threshold",
    wins: "any",
  },
  [`item-rules.json ground.inUse`]: {
    decides: "ground items whose overlay animates only while a crafting player faces them",
    wins: "any",
  },
  [`item-rules.json ground.tipless`]: {
    decides: "ground items the hover tip never names",
    wins: "any",
  },
  [`item-rules.json containers.uniqueIds`]: {
    decides: "containers that get a #id in a bag",
    wins: "any",
  },
  // runBook, groundDrawOffset, ctrlGate, swingSound
  [`item-rules.json use.skillBooks`]: { decides: "the combat-skill books", wins: "first" },
  [`item-rules.json ground.overlays`]: {
    decides: "the animated overlay on a ground item",
    wins: "first",
  },
  [`item-rules.json ground.layers`]: { decides: "the draw layer of a ground item", wins: "first" },
  [`item-rules.json ground.offsets`]: {
    decides: "the pixel offset from the tile",
    wins: "first",
  },
  [`item-rules.json ground.tipNames`]: {
    decides: "the hover tip's name for a ground item",
    wins: "first",
  },
  [`item-rules.json pickup.ctrlTexts`]: {
    decides: "the one line Ctrl on a fixture says",
    wins: "first",
  },
  [`item-rules.json swing.sounds`]: { decides: "the swing sound by weapon", wins: "first" },
  // useItem, gearBonus, elementalRows
  [`item-rules.json use.effects`]: {
    decides: "what Use does to a food or potion",
    wins: "adds",
  },
  [`item-rules.json gear`]: {
    decides: "power a worn item adds",
    wins: "adds",
    note: "the row's slot is the worn slot it tests",
  },
  [`item-rules.json armour.rows`]: {
    decides: "armour mitigation",
    wins: "adds",
    note: "the row's slot is the worn slot it tests",
  },
  [`item-rules.json armour.spell.rows`]: {
    decides: "spell damage a worn item adds or takes off",
    wins: "adds",
    note: "the row's slot is the worn slot it tests",
  },
  [`item-rules.json armour.elemental`]: {
    decides: "elemental armour effects",
    wins: "adds",
    note: "applies in the row's handler, when the row's trigger item is the wielded weapon, from the row's slot",
  },
  // normaliseLook
  [`item-rules.json paperdoll.aliases`]: {
    decides: "which picture a worn item is drawn with",
    wins: "order",
    note: "each row rewrites its own layer; a later row tests the rewritten name",
  },
  // attackPower, applyTier
  "attpower.json attPower.base": {
    decides: "weapon attack power",
    wins: "last",
    note: "every matching row rolls; the last one's roll stands",
  },
  "attpower.json attPower.exactOverrides": {
    decides: "weapons whose power replaces the base roll",
    wins: "last",
  },
  "attpower.json attPower.skillBlocks": {
    decides: "the skill tiers added to a weapon's power",
    wins: "adds",
    note: "every matching block applies, in file order; a block with no test applies to every weapon",
  },
  "attpower.json attPower.skillBlocks[].tiers[].subWeapon": {
    decides: "a skill tier that applies only to one exact weapon",
    wins: "any",
  },
  // meleeKillXp, smash in combat/melee.ts, the anyMatch callers in monsters/ and economy/
  "monsters.json rules.sea": {
    decides: "species that spawn and move only on sea tiles",
    wins: "any",
  },
  "monsters.json rules.footprint": { decides: "3x2 wide monsters", wins: "any" },
  "monsters.json rules.hostile": {
    decides: "species off the World Editor's monster list that walk toward players",
    wins: "any",
  },
  "monsters.json rules.officer": {
    decides: "attacks wanted players on no-fight maps",
    wins: "any",
  },
  "monsters.json rules.sparesInnocent": {
    decides: "never hits an innocent player",
    wins: "any",
  },
  "monsters.json rules.clearsBlock": {
    decides: "never blocks a player's step",
    wins: "any",
  },
  "monsters.json rules.killXp": { decides: "kill XP override after the ring", wins: "first" },
  "monsters.json rules.killBroadcasts": {
    decides: "server broadcast on a melee kill",
    wins: "first",
  },
  "monsters.json rules.namesSelf": {
    decides: 'a click says "This is <name>." instead of opening the Bio',
    wins: "any",
  },
  "monsters.json rules.noQuests": { decides: "gives no quests", wins: "any" },
  "monsters.json casting.neverCasts": { decides: "never casts monster spells", wins: "any" },
  // runBook, spCost
  "spells.json spells[].book": {
    decides: "which spell a book teaches",
    wins: "last",
    note: "tested over all spells in file order; the last matching spell wins",
  },
  "spells.json spells[].spByBody": {
    decides: "a spell's SP cost for a worn body armour",
    wins: "last",
    note: "last match wins within each spell",
  },
  // clickGate
  "houses.json clickFixtures": {
    decides: "what a click on a fixture does",
    wins: "first",
    note: "reached only after the click gate's own tests; only texts and switches are read",
  },
};

const testRow = (name: string, r: { match: string; pattern: string }): boolean =>
  ruleMatches(name, r as PatternRow);

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

interface Hit {
  key: string;
  info: TableInfo;
  /** Every matching row, in file order. */
  rows: Row[];
  /** The rows that decide (first / last, or every row for the other rules). */
  deciding: Set<Row>;
}

/** Which rows of every table match `name`, and which of them decide. */
function matchAll(name: string): Hit[] {
  const hits: Hit[] = [];
  for (const [key, all] of patternTables()) {
    const info = TABLES[key];
    if (!info) {
      continue;
    }
    let rows = all.filter((r) => testRow(name, r));
    if (info.wins === "order") {
      // Each row rewrites its own layer; a later row tests the rewritten name.
      const cur = new Map<string, string>();
      rows = all.filter((r) => {
        const layer = String(r.raw.layer ?? "");
        const text = cur.get(layer) ?? name;
        if (testRow(text, r)) {
          cur.set(layer, String(r.raw.becomes ?? text));
          return true;
        }
        return false;
      });
    }
    if (rows.length === 0) {
      continue;
    }
    let deciding: Row[];
    if (info.wins === "first") {
      deciding = [rows[0] as Row];
    } else if (info.wins === "last") {
      // "last" is per record for per-spell tables (spByBody), over the file otherwise.
      const perSubject = key.endsWith("spByBody");
      deciding = perSubject
        ? [...new Set(rows.map((r) => r.subject))].map(
            (s) => rows.filter((r) => r.subject === s).at(-1) as Row,
          )
        : [rows.at(-1) as Row];
    } else {
      deciding = rows;
    }
    hits.push({ key, info, rows, deciding: new Set(deciding) });
  }
  return hits;
}

const WINS_TEXT: Record<Wins, string> = {
  first: "first match wins",
  last: "last match wins",
  any: "any match counts",
  adds: "every matching row applies",
  order: "rows apply in order, each rewriting its layer",
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
        i.icon === null ? "no icon" : i.icon === "added" ? "added icon" : "original icon";
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
