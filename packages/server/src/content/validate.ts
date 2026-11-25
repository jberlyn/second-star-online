/**
 * The checks a merged store passes before it is published: every dataset against its schema,
 * then the key and name rules, then cross-references. Cross-references are compared with the
 * published store, so only a reference the change breaks (or adds broken) is reported: the
 * Classic pack has references 1.6 never resolved ("scroll" in the quests), and those stay as they
 * were. Pure.
 */
import { DATASET_SCHEMAS, FORMULA_MAX, formulaRange } from "@secondstaronline/data/schema";
import {
  ARROW_COLOURS,
  aliasCycles,
  behaviourName,
  behaviourTest,
  buildContentStore,
  type ContentData,
  compileDefinitions,
  DATASET_IDS,
  type DatasetId,
  definesBehaviours,
  isEngineFixture,
  lastMatch,
  lingoContains,
  lingoEq,
  npcLootItemOk,
  npcShopItemOk,
  resolveMonster,
  ruleMatches,
} from "@secondstaronline/shared";

import { type RowRef, rowLabel } from "./rows.ts";

/** One problem, with where it is (`items/items/Ale`, or a dataset and a schema path). */
export interface ContentProblem {
  where: string;
  message: string;
}

/** Each dataset against its schema. */
export function schemaProblems(data: ContentData): ContentProblem[] {
  const out: ContentProblem[] = [];
  for (const id of DATASET_IDS) {
    const parsed = DATASET_SCHEMAS[id].safeParse(data[id]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 20)) {
        const path = issue.path.map(String);
        // A definition is named by its key, not its place in the list, so the refusal names the
        // item or monster and the field (`monsters/definitions/Slime/skillCap`).
        if (path[0] === "definitions" && /^\d+$/.test(path[1] ?? "")) {
          const entry = (data[id] as { definitions?: { name?: unknown }[] }).definitions?.[
            Number(path[1])
          ];
          if (typeof entry?.name === "string") {
            path[1] = entry.name;
          }
        }
        out.push({ where: [id, ...path].join("/"), message: issue.message });
      }
    }
  }
  return out;
}

/**
 * The forms a stored name uses to carry state, which a new key may not use: a `#` (a container's
 * id, `Bag#12`), a leading count (`15 Gold`) and a `+N` ending (an upgrade).
 */
export function badKeyForm(key: string): string | null {
  if (key.trim() !== key || key === "") {
    return "a key may not be empty or start or end with a space";
  }
  if (key.includes("#")) {
    return "a key may not contain #";
  }
  if (/^\d+\s/.test(key)) {
    return "a key may not start with a number and a space";
  }
  if (/\+\d+$/.test(key)) {
    return "a key may not end with +N";
  }
  return null;
}

interface Named {
  name: string;
  display?: string;
}

/**
 * The name rules for one list: display names are unique ignoring case, and a display name may
 * not be another entry's key. New keys (not in `packKeys`) may not use the stateful forms.
 */
export function nameProblems(
  label: string,
  rows: readonly Named[],
  packKeys: ReadonlySet<string>,
): ContentProblem[] {
  const out: ContentProblem[] = [];
  const keys = new Map<string, string>();
  for (const r of rows) {
    keys.set(r.name.toLowerCase(), r.name);
    if (!packKeys.has(r.name.toLowerCase())) {
      const bad = badKeyForm(r.name);
      if (bad) {
        out.push({ where: `${label}/${r.name}`, message: bad });
      }
    }
  }
  const shown = new Map<string, string>();
  for (const r of rows) {
    const display = (r.display ?? r.name).toLowerCase();
    const other = shown.get(display);
    if (other !== undefined) {
      out.push({
        where: `${label}/${r.name}`,
        message: `its name "${r.display ?? r.name}" is already used by ${other}`,
      });
    }
    shown.set(display, r.name);
    const keyOwner = keys.get(display);
    if (r.display && keyOwner !== undefined && keyOwner.toLowerCase() !== r.name.toLowerCase()) {
      out.push({
        where: `${label}/${r.name}`,
        message: `its name "${r.display}" is the key of ${keyOwner}`,
      });
    }
  }
  return out;
}

/**
 * Whether `name` is one of the item data's map fixtures (`items.fixtures`), or a door's other form
 * (`Open Wooden Door` for `Wooden Door`, and back).
 */
export function isFixtureName(data: Pick<ContentData, "items">, name: string): boolean {
  const forms = [name, `Open ${name}`, name.replace(/^open\s+/i, "")];
  return data.items.fixtures.some((f) => forms.some((n) => lingoEq(f, n)));
}

/** The key rules over a merged store. */
export function keyProblems(
  data: ContentData,
  packKeys: {
    items: ReadonlySet<string>;
    monsters: ReadonlySet<string>;
    npcFiles: ReadonlySet<string>;
  },
): ContentProblem[] {
  return [
    ...nameProblems("items/items", data.items.items, packKeys.items),
    // The engine builds and reads its fixtures' names itself (shared fixtures.ts): an item named
    // like one would be taken for it.
    ...data.items.items
      .filter((i) => !packKeys.items.has(i.name.toLowerCase()) && isEngineFixture(i.name))
      .map((i) => ({
        where: `items/items/${i.name}`,
        message:
          "a key may not be an engine fixture's name (Exit, Exit2, Sign 1-3, Street Lamp, or an owner's Door, Mailbox, Board, Vault or vehicle)",
      })),
    // A map fixture (a door, a chest, a platform) is read by the same name tables as an item: a new
    // item named like one, or like a door's other form, would change the fixtures on every map.
    ...data.items.items
      .filter((i) => !packKeys.items.has(i.name.toLowerCase()) && isFixtureName(data, i.name))
      .map((i) => ({
        where: `items/items/${i.name}`,
        message: `a key may not be a map fixture's name: ${i.name} is one (or a door's other form)`,
      })),
    ...nameProblems("monsters/monsters", data.monsters.monsters, packKeys.monsters),
    ...newMonsterKeyProblems(data, packKeys.monsters),
    ...data.npcFiles.files
      .filter((f) => !packKeys.npcFiles.has(f.name.toLowerCase()))
      .flatMap((f) => {
        const bad = badKeyForm(f.name);
        return bad ? [{ where: `npcFiles/files/${f.name}`, message: bad }] : [];
      }),
  ];
}

/**
 * A new species' key (issue #31) must not be taken for something else the game names: an item (its
 * key or display name), an engine or map fixture, an NPC on an editor's NPC list, or a faction.
 */
function newMonsterKeyProblems(
  data: ContentData,
  packMonsters: ReadonlySet<string>,
): ContentProblem[] {
  const items = new Set(
    data.items.items.flatMap((i) => [i.name, i.display ?? i.name]).map((n) => n.toLowerCase()),
  );
  const npcs = new Set(
    [
      ...data.monsters.editorLists.worldEditor.npcs,
      ...data.monsters.editorLists.npcEditor.npcs,
    ].map((n) => n.toLowerCase()),
  );
  const factions = new Set(data.social.factions.map((f) => f.key.toLowerCase()));
  const out: ContentProblem[] = [];
  for (const m of data.monsters.monsters) {
    const k = m.name.toLowerCase();
    if (packMonsters.has(k)) {
      continue;
    }
    const why = items.has(k)
      ? "an item's name"
      : isEngineFixture(m.name) || isFixtureName(data, m.name)
        ? "a fixture's name (a door, a sign, an exit…)"
        : npcs.has(k)
          ? "an NPC's name (on an editor's NPC list)"
          : factions.has(k)
            ? "a faction's name"
            : null;
    if (why) {
      out.push({
        where: `monsters/monsters/${m.name}`,
        message: `a new monster's key may not be ${why}: ${m.name} is one`,
      });
    }
  }
  return out;
}

/**
 * The monster rules a schema cannot see alone (issue #31, decision 10): a trap holds its victim
 * where it stands, so it must be immobile, and it is one tile on land (no 3×2 footprint, no sea).
 * Checked against what the monster plays (its record and its compiled rules).
 */
export function monsterProblems(data: ContentData): ContentProblem[] {
  const out: ContentProblem[] = [];
  // The monster spells: an NPC file names one by its tag, so two may not share one, and each step
  // of the ladder is a `random(n)` the cast rolls, so it is at least 1.
  const tags = new Set<string>();
  data.monsters.casting.spells.forEach((sp, i) => {
    const at = `monsters/casting/spells/${i}`;
    if (tags.has(sp.tag.toLowerCase())) {
      out.push({ where: `${at}/tag`, message: `two monster spells are tagged ${sp.tag}` });
    }
    tags.add(sp.tag.toLowerCase());
    if (sp.ladder.some((n) => n < 1)) {
      out.push({ where: `${at}/ladder`, message: "each step of the ladder is at least 1" });
    }
  });
  const traps = data.monsters.monsters.filter((m) => m.flags?.trap === true);
  if (traps.length === 0) {
    return out;
  }
  const compiled = compileDefinitions(data);
  for (const m of traps) {
    const at = `monsters/monsters/${m.name}`;
    if (m.flags?.immobile !== true) {
      out.push({ where: `${at}/flags/trap`, message: "a trap must be immobile too" });
    }
    const hits = new Map(resolveMonster(m.name, compiled).map((h) => [h.key, h]));
    const defined = (data.monsters.definitions ?? []).some((d) => lingoEq(d.name, m.name));
    for (const [field, label] of [
      ["sea", "a sea creature"],
      ["footprint", "3×2 wide"],
    ] as const) {
      if ((hits.get(`monsters rules.${field}`)?.deciding.length ?? 0) > 0) {
        out.push({
          where: defined ? `monsters/definitions/${m.name}/${field}` : `${at}/flags/trap`,
          message: `a trap cannot be ${label}`,
        });
      }
    }
  }
  return out;
}

/**
 * The skill rules. Characters save each skill under its key, so skills may be added, removed or
 * reordered (a removed skill's saved values wait for it to return). The rules find a skill by its
 * key with case and spaces ignored ("Martial Arts" is MartialArts), so two skills may not share
 * that spelling (one would hide the other), and a published skill's key keeps its exact spelling.
 */
export function skillProblems(next: ContentData, published?: ContentData): ContentProblem[] {
  const out: ContentProblem[] = [];
  // Characters' rows are saved under the exact key, so a live skill keeps its spelling: a key
  // written another way would leave two rows for one skill.
  const live = new Map((published?.classes.skills ?? []).map((s) => [skillNorm(s.skill), s.skill]));
  for (const s of next.classes.skills) {
    const was = live.get(skillNorm(s.skill));
    if (was !== undefined && was !== s.skill) {
      out.push({
        where: `classes/skills/${s.skill}`,
        message: `a skill's key cannot be spelled another way (it is ${was})`,
      });
    }
  }
  const spelled = new Map<string, string>();
  for (const s of next.classes.skills) {
    if (skillNorm(s.skill) === "") {
      out.push({ where: `classes/skills/${s.skill}`, message: "a skill's key needs a letter" });
      continue;
    }
    const other = spelled.get(skillNorm(s.skill));
    if (other !== undefined) {
      out.push({
        where: `classes/skills/${s.skill}`,
        message: `its name reads the same as ${other} (case and spaces are ignored)`,
      });
    }
    spelled.set(skillNorm(s.skill), s.skill);
  }
  return out;
}

/**
 * The progression rules a schema cannot see alone: a harvest node that `gains` trains a skill that
 * rises from gathering (its own `gather` settings, or the world default for its model, not turned
 * off, and for the `chance` model with a roll).
 */
export function progressionProblems(data: ContentData): ContentProblem[] {
  const out: ContentProblem[] = [];
  const p = data.classes.progression;
  const rows = new Map(data.classes.skills.map((s) => [skillNorm(s.skill), s]));
  data.gather.harvest.forEach((n, i) => {
    const row = rows.get(skillNorm(n.skill));
    // A node naming no skill is a broken reference, told on its own.
    if (!n.gains || !row) {
      return;
    }
    const prog = row.progression;
    const own = prog?.on?.gather;
    const base = prog?.model === "xp" ? p.defaults.xp.gather : p.defaults.chance.gather;
    const merged = own === false ? undefined : { ...(base || {}), ...(own || {}) };
    // An `xp` skill needs an amount: its own or the default's, or the node's.
    const trains =
      own !== false &&
      (own !== undefined || base) &&
      merged !== undefined &&
      (prog?.model === "xp" ? "xp" in merged || n.xp !== undefined : "roll" in merged);
    if (!trains) {
      out.push({
        where: `gather/harvest/${n.tile}`,
        message: `gains, but ${n.skill} does not rise from gathering (give it a gather progression)`,
      });
    }
  });
  // A teaching item's formulas, as a progression's are checked: known names, and an amount that
  // can reach 1. They read the reader's stats and skills, never damage or a tool.
  const skills = new Set(data.classes.skills.map((s) => skillNorm(s.skill)));
  // The rows a definition's skill book becomes are checked as the table's are.
  const books = [
    ...data.itemRules.use.skillBooks.map((b) => ({
      b,
      at: `itemRules/use/skillBooks/${b.pattern}`,
    })),
    ...(data.items.definitions ?? []).flatMap((d) =>
      d.use?.skillBook
        ? [{ b: d.use.skillBook, at: `items/definitions/${d.name}/use/skillBook` }]
        : [],
    ),
  ];
  books.forEach(({ b, at }) => {
    for (const key of ["points", "xp"] as const) {
      const f = b[key];
      if (f === undefined) {
        continue;
      }
      const { range, problems } = formulaRange(f, {
        skills,
        tables: p.tables,
        damage: false,
        curve: false,
      });
      const where = `${at}/${key}`;
      for (const q of problems) {
        out.push({ where, message: q.message });
      }
      if (problems.length === 0 && (range.hi < 1 || range.hi > FORMULA_MAX)) {
        out.push({
          where,
          message: `gives ${range.lo} to ${range.hi}: it must be able to give 1, and at most ${FORMULA_MAX}`,
        });
      }
    }
  });
  return out;
}

/** A step into a row's JSON: a field name or a list index. */
export type JsonPath = (string | number)[];

/** The kinds of name a reference holds. */
export type ReferenceKind =
  | "item"
  | "monster"
  /** An NPC a quest names: shown where an NPC is used, and flagged for review, never checked. */
  | "npc"
  | "itemOrFixture"
  /**
   * Part of an item's name, matched with "contains" (a tool any "Fishing" item or "Axe" counts as):
   * it resolves while some live item's name contains it. It names no one item, so a removal's
   * cleanup never touches it.
   */
  | "itemPattern"
  /**
   * The item an item definition is for (issue #30): any catalogue item, a retired one too (its
   * copies still play by it). The definition goes with the item when it is removed.
   */
  | "definedItem"
  /**
   * The monster a monster definition is for (issue #31): a species, a name on an editor list, or an
   * NPC file's. The definition goes with the species when it is removed.
   */
  | "definedMonster"
  | "skill"
  | "shopItem"
  | "lootItem";

/** One reference from a row to a name another list must hold. */
export interface Reference {
  /** The row's label (`craft/stations`, `npcFiles/files/Fish`). */
  where: string;
  /** The row that holds it. */
  row: RowRef;
  /**
   * Where the name sits in the row's JSON. For an NPC file line it is `["text", <line index>]`
   * (the line's item field holds the name).
   */
  path: JsonPath;
  kind: ReferenceKind;
  name: string;
  /**
   * What a cleanup removes to drop the reference (issue #28): the path of the list entry that holds
   * it (a recipe, a shop line), `[]` for the whole row (a deed), or null when nothing can go
   * without breaking the row (a station's one tool, a roll table's entry): replace it instead.
   */
  drop: JsonPath | null;
  /** The reference is an NPC file line's item (`SEL|`, `BUY|`, `INV|`). */
  npcLine?: boolean;
  /**
   * The name is built from the row rather than written in it whole (a mining colour makes
   * `<colour> Crystal`; the Assassin's prizes are one colon-separated line): a cleanup neither
   * removes nor replaces it, and the operator edits the row.
   */
  fixed?: boolean;
}

/** Every checked reference in a store. */
export function referencesOf(data: ContentData): Reference[] {
  const out: Reference[] = [];
  /** A ground name that is a pile of this content's currency, `300 Gold`. */
  const currency = data.bindings.currency.item;
  const currencyPile = (name: string) => {
    const t = name.trim();
    return currency !== undefined && /^\d+ /.test(t) && lingoEq(t.replace(/^\d+ /, ""), currency);
  };
  const section = (dataset: DatasetId, part: string): RowRef => ({ dataset, part, key: null });
  const add = (
    row: RowRef,
    path: JsonPath,
    kind: ReferenceKind,
    name: string,
    drop: JsonPath | null,
    npcLine = false,
    fixed = false,
  ) =>
    out.push({
      where: rowLabel(row),
      row,
      path,
      kind,
      name,
      drop,
      ...(npcLine ? { npcLine: true } : {}),
      ...(fixed ? { fixed: true } : {}),
    });
  const editorItems = section("items", "editorItems");
  data.items.editorItems.forEach((n, i) => {
    add(editorItems, [i], "itemOrFixture", n, [i]);
  });
  const whitelist = section("items", "playerShopWhitelist");
  data.items.playerShopWhitelist.forEach((n, i) => {
    add(whitelist, [i], "item", n, [i]);
  });
  const lists = data.monsters.editorLists;
  const editorLists = section("monsters", "editorLists");
  for (const editor of ["worldEditor", "npcEditor"] as const) {
    for (const list of ["monsters", "npcs"] as const) {
      lists[editor][list].forEach((n, i) => {
        add(editorLists, [editor, list, i], "monster", n, [editor, list, i]);
      });
    }
  }
  // The quests a new world starts with: a line that names a removed item goes (the world pads the
  // list to 40), but its NPC is for the operator to look at.
  const current = section("quests", "current");
  data.quests.current.forEach((q, i) => {
    add(current, [i, "wants"], "item", q.wants, [i]);
    add(current, [i, "reward"], "item", q.reward, [i]);
    if (q.npc.trim() !== "") {
      add(current, [i, "npc"], "npc", q.npc.trim(), null);
    }
  });
  // A finished quest rolls its next one from the pools, trimmed (shared quests.ts `findNewQuest`).
  // Each entry answers one roll, so an entry is replaced, never dropped.
  const pools = section("quests", "pools");
  data.quests.pools.wanted.forEach((w, i) => {
    add(pools, ["wanted", i, "item"], "item", w.item.trim(), null);
  });
  data.quests.pools.rewards.forEach((r, i) => {
    add(pools, ["rewards", i, "item"], "item", r.item.trim(), null);
  });
  data.quests.pools.npcs.forEach((p, i) => {
    if (p.npc) {
      add(pools, ["npcs", i, "npc"], "npc", p.npc, null);
    }
  });
  // What the crafting stations take, use and make. A recipe that takes or makes the item goes as a
  // whole; a station's own fixture and its one tool can only be replaced.
  const st = data.craft.stations;
  const stations = section("craft", "stations");
  const craft = (path: JsonPath, n: string, drop: JsonPath | null) =>
    add(stations, path, "item", n, drop);
  const station = (path: JsonPath, n: string, drop: JsonPath | null) =>
    add(stations, path, "itemOrFixture", n, drop);
  const smith = st.smith;
  if (smith) {
    station(["smith", "station"], smith.station, null);
    craft(["smith", "tool"], smith.tool, null);
    craft(["smith", "chunkDefault"], smith.chunkDefault, null);
    smith.chunks.forEach((c, i) => {
      craft(["smith", "chunks", i, "item"], c.item, ["smith", "chunks", i]);
      craft(["smith", "chunks", i, "chunk"], c.chunk, ["smith", "chunks", i]);
    });
    smith.repairs.forEach((r, i) => {
      craft(["smith", "repairs", i, "input"], r.input, ["smith", "repairs", i]);
      craft(["smith", "repairs", i, "output"], r.output, ["smith", "repairs", i]);
    });
    smith.masterwork.forEach((m, i) => {
      craft(["smith", "masterwork", i, "item"], m.item, ["smith", "masterwork", i]);
      m.outcomes.forEach((o, j) => {
        craft(["smith", "masterwork", i, "outcomes", j, "result"], o.result, [
          "smith",
          "masterwork",
          i,
        ]);
      });
    });
  }
  const cook = st.cook;
  if (cook) {
    station(["cook", "doubles"], cook.doubles, null);
    cook.stations.forEach((n, i) => {
      station(["cook", "stations", i], n, ["cook", "stations", i]);
    });
    cook.recipes.forEach((r, i) => {
      for (const f of ["input", "output", "burned"] as const) {
        craft(["cook", "recipes", i, f], r[f], ["cook", "recipes", i]);
      }
    });
  }
  const mix = st.mix;
  if (mix) {
    station(["mix", "station"], mix.station, null);
    mix.sands.forEach((m, i) => {
      for (const f of ["sand", "potion", "crystal"] as const) {
        craft(["mix", "sands", i, f], m[f], ["mix", "sands", i]);
      }
    });
  }
  const build = st.build;
  if (build) {
    station(["build", "station"], build.station, null);
    craft(["build", "tool"], build.tool, null);
    build.bands.forEach((b, i) => {
      b.results.forEach((r, j) => {
        // Each result answers a roll, so it is replaced, never dropped.
        craft(["build", "bands", i, "results", j, "item"], r.item, null);
      });
    });
  }
  const cauldron = st.cauldron;
  if (cauldron) {
    cauldron.recipes.forEach((r, i) => {
      r.requires.forEach((n, j) => {
        craft(["cauldron", "recipes", i, "requires", j], n, ["cauldron", "recipes", i]);
      });
      craft(["cauldron", "recipes", i, "result"], r.result, ["cauldron", "recipes", i]);
    });
  }
  // What gathering takes and gives. A roll band's fish and the one-of tools are replaced, not
  // dropped.
  const g = data.gather.gathering;
  const gathering = section("gather", "gathering");
  const gather = (path: JsonPath, n: string, drop: JsonPath | null) =>
    add(gathering, path, "item", n, drop);
  // The ore list is a fixed three, read by position.
  g.mining?.ore.items.forEach((n, i) => {
    gather(["mining", "ore", "items", i], n, null);
  });
  // A harvest node's tools (dropped from its list, or the node goes with its only one) and what its
  // yield tables drop (replaced, never dropped: a table holds one item).
  const harvest = section("gather", "harvest");
  data.gather.harvest.forEach((n, i) => {
    (n.tools ?? []).forEach((t, j) => {
      add(harvest, [i, "tools", j], "item", t, (n.tools ?? []).length > 1 ? [i, "tools", j] : [i]);
    });
  });
  const yields = section("gather", "yields");
  for (const [name, t] of Object.entries(data.gather.yields)) {
    if (t.kind === "chance") {
      add(yields, [name, "item"], "item", t.item, null);
    }
  }
  // A requirement row matched exactly names one item and goes with it; a "contains" row is a
  // pattern.
  const requiresRows = section("itemRules", "requires");
  data.itemRules.requires.forEach((r, i) => {
    if (r.match === "contains") {
      add(requiresRows, [i, "pattern"], "itemPattern", r.pattern, null);
    } else {
      add(requiresRows, [i, "pattern"], "item", r.pattern, [i]);
    }
  });
  // A tool row matched exactly names one item and goes with it; a "contains" row is a pattern.
  const tools = section("itemRules", "tools");
  data.itemRules.tools.forEach((t, i) => {
    if (t.match === "contains") {
      add(tools, [i, "pattern"], "itemPattern", t.pattern, null);
    } else {
      add(tools, [i, "pattern"], "item", t.pattern, [i]);
    }
  });
  g.fishing?.bands.forEach((b, i) => {
    gather(["fishing", "bands", i, "fish"], b.fish, null);
  });
  g.farming?.seeds.forEach((sd, i) => {
    gather(["farming", "seeds", i, "item"], sd.item, ["farming", "seeds", i]);
  });
  g.farming?.produce.forEach((pr, i) => {
    gather(["farming", "produce", i, "item"], pr.item, ["farming", "produce", i]);
  });
  // A treasure is dropped as a ground name, so "300 Gold" is a pile of the currency, not an item.
  g.treasure?.items.forEach((n, i) => {
    if (!currencyPile(n)) {
      gather(["treasure", "items", i], n, ["treasure", "items", i]);
    }
  });
  // What mining strikes, faction deaths and the Assassin's default prizes make.
  g.mining?.colours.forEach((c, i) => {
    add(gathering, ["mining", "colours", i], "item", `${c} Crystal`, null, false, true);
  });
  for (const f of data.social.factions) {
    const row: RowRef = { dataset: "social", part: "factions", key: f.key };
    add(row, ["head"], "item", f.head, null);
    add(row, ["member"], "monster", f.member, null);
    // A head is handed to the leader as the monster standing there, so it must be a species.
    add(row, ["leader"], "monster", f.leader, null);
  }
  const assassinRow = section("social", "assassin");
  for (const prize of data.social.assassin?.prizes.archived.split(":") ?? []) {
    // "500 Gold" is a pile of this content's currency (as the treasure rows are).
    if (prize.trim() !== "" && !currencyPile(prize)) {
      add(assassinRow, ["prizes", "archived"], "item", prize.trim(), null, false, true);
    }
  }
  // What the quest chests refill with after a save, and Oraku's orb and reward.
  const questChest = section("houses", "questChest");
  data.houses.questChest.chests.forEach((c, i) => {
    c.source.forEach((n, j) => {
      add(questChest, ["chests", i, "source", j], "item", n, ["chests", i, "source", j]);
    });
  });
  const replies = section("social", "questReplies");
  const oraku = data.social.questReplies.oraku;
  if (oraku) {
    add(replies, ["oraku", "item"], "item", oraku.item, null);
    add(replies, ["oraku", "reward"], "item", oraku.reward, null);
  }
  // An item definition is the item's: its row goes with it, and its skills must exist.
  for (const d of data.items.definitions ?? []) {
    const row: RowRef = { dataset: "items", part: "definitions", key: d.name };
    add(row, ["name"], "definedItem", d.name, []);
    d.trains?.forEach((s, j) => {
      add(row, ["trains", j], "skill", s, null);
    });
    // What it needs, its skill platform and its skill book name skills ("level" is the level).
    d.requires?.forEach((r, j) => {
      if (r.needs !== "level") {
        add(row, ["requires", j, "needs"], "skill", r.needs, null);
      }
    });
    (d.ground?.platforms ?? []).forEach((pl, i) => {
      if (pl.needs !== "level") {
        add(row, ["ground", "platforms", i, "needs"], "skill", pl.needs, null);
      }
    });
    if (d.use?.skillBook) {
      add(row, ["use", "skillBook", "skill"], "skill", d.use.skillBook.skill, null);
    }
    // What it breaks into is an item: removing that item takes the broken form off.
    if (d.damaged !== undefined) {
      add(row, ["damaged"], "item", d.damaged, ["damaged"]);
    }
    d.attack?.blocks?.forEach((b, i) => {
      b.tiers.forEach((t, j) => {
        (t.when ?? []).forEach((w, k) => {
          const name = /^(\w+) [<>] \d+$/.exec(w)?.[1];
          if (name && name !== "level") {
            add(row, ["attack", "blocks", i, "tiers", j, "when", k], "skill", name, null);
          }
        });
      });
    });
  }
  // A monster definition is the monster's: its row goes with it, and its weapon families must
  // match some item (issue #31).
  for (const d of data.monsters.definitions ?? []) {
    const row: RowRef = { dataset: "monsters", part: "definitions", key: d.name };
    add(row, ["name"], "definedMonster", d.name, []);
    d.affinities?.forEach((a, j) => {
      add(row, ["affinities", j, "weapon"], "itemPattern", a.weapon, ["affinities", j]);
    });
  }
  // A deed is an item: its row goes with it.
  for (const d of data.houses.deeds) {
    add({ dataset: "houses", part: "deeds", key: d.deed }, ["deed"], "item", d.deed, []);
  }
  // NPC files: what a shop sells or buys, and what a monster drops, as the NPC Editor checks them.
  for (const f of data.npcFiles.files) {
    const row: RowRef = { dataset: "npcFiles", part: "files", key: f.name };
    f.text.split(/\r\n?|\n/).forEach((line, i) => {
      const m = /^(SEL|BUY|INV)\|([^:|]*)/.exec(line);
      if (m) {
        add(
          row,
          ["text", i],
          m[1] === "INV" ? "lootItem" : "shopItem",
          m[2] as string,
          ["text", i],
          true,
        );
      }
    });
  }
  // Skill names written in other rows: `skillIndex` throws on a name it does not know, and a
  // binding to no skill turns its mechanic off, so a typo would fail every tick that reads it or
  // quietly switch a mechanic off. An empty name is a reference too: the rules look it up
  // all the same, and find nothing. Skills are never cleaned up, so these carry no drop.
  const skill = (row: RowRef, path: JsonPath, name: unknown) => {
    if (typeof name === "string") {
      add(row, path, "skill", name, null);
    }
  };
  for (const c of data.classes.classes) {
    const row: RowRef = { dataset: "classes", part: "classes", key: String(c.code) };
    (c.promotion?.skillGrants ?? []).forEach((gr, i) => {
      skill(row, ["promotion", "skillGrants", i], gr);
    });
    const stat = c.promotion?.requirement?.stat;
    // Promotion reads exactly "HPmax" and "SPmax" as stats (shared promotion.ts).
    if (typeof stat === "string" && stat !== "HPmax" && stat !== "SPmax") {
      skill(row, ["promotion", "requirement", "stat"], stat);
    }
  }
  for (const sc of data.classes.startClasses) {
    const row: RowRef = { dataset: "classes", part: "startClasses", key: String(sc.code) };
    for (const name of Object.keys(sc.skills)) {
      skill(row, ["skills", name], name);
    }
  }
  // A binding may be left out (its mechanic is off), but one that names a skill must name a real
  // one.
  const skillBindings = section("bindings", "skills");
  for (const [b, name] of Object.entries(data.bindings.skills)) {
    skill(skillBindings, [b], name);
  }
  // The currency cannot simply go (the contract needs one): it is replaced. A start bag line and the
  // cannon ammo can (a smaller bag; a cannon that cannot fire).
  const b = data.bindings;
  if (b.currency.item !== undefined) {
    add(section("bindings", "currency"), ["item"], "item", b.currency.item, null);
  }
  b.start.bag.forEach((l, i) => {
    add(section("bindings", "start"), ["bag", i, "item"], "item", l.item, ["bag", i]);
  });
  if (b.cannon.ammo !== undefined) {
    add(section("bindings", "cannon"), ["ammo"], "item", b.cannon.ammo, ["ammo"]);
  }
  const skillGain = section("classes", "skillGain");
  data.classes.skillGain.weaponSkills.forEach((w, i) => {
    w.skills.forEach((s, j) => {
      skill(skillGain, ["weaponSkills", i, "skills", j], s);
    });
  });
  const farming = data.gather.gathering.farming;
  if (farming) {
    skill(gathering, ["farming", "wateringSkill"], farming.wateringSkill);
  }
  // A requirement reads exactly "level" as the level (shared requirements.ts `requirementMet`).
  const needs = (row: RowRef, path: JsonPath, r: { needs?: unknown } | undefined) => {
    if (r && r.needs !== "level") {
      skill(row, [...path, "needs"], r.needs);
    }
  };
  data.gather.harvest.forEach((n, i) => {
    skill(harvest, [i, "skill"], (n as { skill?: unknown }).skill);
    needs(harvest, [i, "requires"], n.requires);
  });
  const ladders = section("itemRules", "ladders");
  for (const [name, l] of Object.entries(data.itemRules.ladders)) {
    skill(ladders, [name, "skill"], l.skill);
  }
  const requires = section("itemRules", "requires");
  data.itemRules.requires.forEach((r, i) => {
    needs(requires, [i], r);
  });
  const use = section("itemRules", "use");
  data.itemRules.use.skillBooks.forEach((b, i) => {
    skill(use, ["skillBooks", i, "skill"], b.skill);
  });
  const ground = section("itemRules", "ground");
  data.itemRules.ground.platforms.forEach((p, i) => {
    // A platform reads exactly "level" as the level (shared ground.ts `blocksPlayer`).
    if (p.needs !== "level") {
      skill(ground, ["platforms", i, "needs"], p.needs);
    }
  });
  const assassin = section("social", "assassin");
  data.social.assassin?.rating.skills.forEach((s, i) => {
    skill(assassin, ["rating", "skills", i], s);
  });
  const bios = section("social", "bios");
  data.social.bios.titles.forEach((t, i) => {
    ((t as { tests?: { skill?: unknown }[] }).tests ?? []).forEach((test, j) => {
      skill(bios, ["titles", i, "tests", j, "skill"], test.skill);
    });
  });
  // The Bio score counts exactly "HPmax" and "SPmax" as stats (shared bios.ts `bioScore`).
  data.social.bios.score.counted.forEach((s, i) => {
    if (s !== "HPmax" && s !== "SPmax") {
      skill(bios, ["score", "counted", i], s);
    }
  });
  const medals = section("social", "medals");
  data.social.medals.awards.forEach((m, i) => {
    skill(medals, ["awards", i, "skill"], (m as { skill?: unknown }).skill);
  });
  const attPower = section("attPower", "attPower");
  data.attPower.attPower.skillBlocks.forEach((b, i) => {
    b.tiers.forEach((t, j) => {
      (t.when ?? []).forEach((w, k) => {
        // Read exactly as `tierApplies` reads it, so every name a swing would look up is checked.
        const name = /^(\w+) [<>] \d+$/.exec(w)?.[1];
        // A tier reads exactly "level" as the level (shared attpower.ts `tierApplies`).
        if (name && name !== "level") {
          skill(attPower, ["skillBlocks", i, "tiers", j, "when", k], name);
        }
      });
    });
  });
  // A power row reads its condition exactly as `tierApplies` does: "level" is the level.
  const tierSkills = (row: RowRef, path: JsonPath, when: readonly string[] | null) => {
    (when ?? []).forEach((w, k) => {
      const name = /^(\w+) [<>] \d+$/.exec(w)?.[1];
      if (name && name !== "level") {
        skill(row, [...path, "when", k], name);
      }
    });
  };
  const spellPower = section("spells", "power");
  data.spells.power.base.forEach((t, i) => {
    tierSkills(spellPower, ["base", i], t.when);
  });
  for (const [name, table] of Object.entries(data.spells.power.tables)) {
    table.tiers.forEach((t, i) => {
      tierSkills(spellPower, ["tables", name, "tiers", i], t.when);
    });
  }
  for (const m of data.monsters.monsters) {
    if (m.flags?.grabbable !== undefined) {
      const row: RowRef = { dataset: "monsters", part: "monsters", key: m.name };
      add(row, ["flags", "grabbable"], "item", m.flags.grabbable, null);
    }
  }
  for (const s of data.spells.spells) {
    const row: RowRef = { dataset: "spells", part: "spells", key: s.name };
    skill(row, ["school", "skill"], s.school?.skill);
    (s.creates ?? []).forEach((c, i) => {
      add(row, ["creates", i, "item"], "item", c.item, null);
    });
    skill(row, ["summon", "skilled", "skill"], s.summon?.skilled?.skill);
    if (s.summon) {
      add(row, ["summon", "monster"], "monster", s.summon.monster, null);
      if (s.summon.skilled) {
        add(row, ["summon", "skilled", "monster"], "monster", s.summon.skilled.monster, null);
      }
    }
  }
  return out;
}

/** A skill name as `skillIndex` compares it: case and spaces ignored. */
const skillNorm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const refKey = (r: Reference) => `${r.where}\u0000${r.kind}\u0000${r.name.toLowerCase()}`;

/** The references that do not resolve in a store. */
export function brokenReferences(data: ContentData): Reference[] {
  return referencesOf(data).filter(unresolved(data));
}

/**
 * The test of whether a reference resolves in a store. A retired item does not count: its copies
 * stay, but no content may make, sell, buy or use it (issue #28).
 */
export function unresolved(data: ContentData): (r: Reference) => boolean {
  // The definitions compiled once (kept for this data object), then the retired items left out: a
  // fresh object here would compile every definition again.
  const compiled = compileDefinitions(data);
  const live: ContentData = data.items.items.some((i) => i.retired)
    ? {
        ...compiled,
        items: {
          ...compiled.items,
          items: compiled.items.items.filter((i) => !i.retired),
          definitions: [],
        },
      }
    : compiled;
  const items = new Set(live.items.items.map((i) => i.name.toLowerCase()));
  const fixtures = new Set(data.items.fixtures.map((f) => f.toLowerCase()));
  const monsters = new Set(data.monsters.monsters.map((m) => m.name.toLowerCase()));
  const skills = new Set(data.classes.skills.map((s) => skillNorm(s.skill)));
  const store = buildContentStore(live);
  return (r) => {
    const n = r.name.toLowerCase();
    switch (r.kind) {
      case "item":
        return !items.has(n);
      case "definedItem":
        return !data.items.items.some((i) => i.name.toLowerCase() === n);
      case "definedMonster":
        return !(
          monsters.has(n) ||
          Object.values(data.monsters.editorLists).some((e) =>
            [...e.monsters, ...e.npcs].some((x) => x.toLowerCase() === n),
          ) ||
          data.npcFiles.files.some((f) => f.name.toLowerCase() === n)
        );
      case "itemOrFixture":
        return !items.has(n) && !fixtures.has(n);
      case "itemPattern":
        // An empty pattern is contained in every name: it names no item, it matches them all.
        return r.name.trim() === "" || !live.items.items.some((i) => lingoContains(i.name, r.name));
      case "monster":
        return !monsters.has(n);
      case "skill":
        return !skills.has(skillNorm(r.name));
      case "shopItem":
        return !npcShopItemOk(r.name, store);
      case "lootItem":
        return !npcLootItemOk(r.name, store);
      case "npc":
        // 1.6's quest lines name NPCs by their spoken name, which need not be a monster ("Girl").
        return false;
    }
    return false;
  };
}

/**
 * The references broken in `next` beyond those already broken in `published`. Counted, not just
 * matched: a second broken reference in a row that already had one like it is still reported.
 */
export function referenceProblems(next: ContentData, published: ContentData): ContentProblem[] {
  const before = new Map<string, number>();
  for (const r of brokenReferences(published)) {
    before.set(refKey(r), (before.get(refKey(r)) ?? 0) + 1);
  }
  return brokenReferences(next)
    .filter((r) => {
      const left = before.get(refKey(r)) ?? 0;
      before.set(refKey(r), left - 1);
      // A binding to no skill quietly turns a mechanic off, so it is named every time, not only
      // when this publish makes it.
      return left <= 0 || r.where === BINDINGS_WHERE;
    })
    .map((r) => ({ where: referenceWhere(r), message: referenceMessage(r) }));
}

/**
 * Where a broken reference is: its row, and for an item definition the field too
 * (`items/definitions/Sword/requires/0/needs`), so the Items page names the field it is in.
 */
function referenceWhere(r: Reference): string {
  return (r.row.dataset === "items" || r.row.dataset === "monsters") &&
    (r.row.part === "definitions" || (r.row.dataset === "monsters" && r.row.part === "monsters")) &&
    r.path.length > 0
    ? `${r.where}/${r.path.join("/")}`
    : r.where;
}

const BINDINGS_WHERE = "bindings/skills";

/** The behaviours that make a carried item a container (`isStorageContainer`). */
const STORAGE_BEHAVIOURS: readonly string[] = ["cabinet", "windCabinet", "crate", "cauldron"];

/** The skill bindings that name no skill: their mechanics are off until they are fixed. */
export function bindingProblems(data: ContentData): ContentProblem[] {
  return brokenReferences(data)
    .filter((r) => r.where === BINDINGS_WHERE)
    .map((r) => ({ where: r.where, message: referenceMessage(r) }));
}

/** What a broken reference is told as on the Content page. */
export function referenceMessage(r: Reference): string {
  const name = r.name || "(nothing)";
  switch (r.kind) {
    case "monster":
      return `names a monster that does not exist: ${name}`;
    case "skill":
      return `names a skill that does not exist: ${name}`;
    case "npc":
      return `names an NPC that does not exist: ${name}`;
    case "itemPattern":
      return `matches no item (or only retired ones): ${name}`;
    case "definedItem":
      return `is the definition of an item that does not exist: ${name}`;
    case "definedMonster":
      return `is the definition of a monster that does not exist (no species, editor list entry or NPC file): ${name}`;
    default:
      return `names an item that does not exist (or is retired): ${name}`;
  }
}

/** An NPC Editor save: it plays instead of the NPC's content row (the game lays it on top). */
export interface NpcSave {
  npc: string;
  text: string;
}

/**
 * The store with the NPC Editor's saves laid over its NPC files, as the game lays them: the
 * files that play, so a reference only a save makes (a shop selling an added item) is checked.
 */
export function withNpcSaves(data: ContentData, saves: readonly NpcSave[]): ContentData {
  if (saves.length === 0) {
    return data;
  }
  const files = [...data.npcFiles.files];
  for (const s of saves) {
    const at = files.findIndex((f) => f.name.toLowerCase() === s.npc.toLowerCase());
    if (at >= 0) {
      files[at] = { ...(files[at] as (typeof files)[number]), text: s.text };
    } else {
      files.push({ name: s.npc, text: s.text });
    }
  }
  return { ...data, npcFiles: { ...data.npcFiles, files } };
}

/** Every pre-publish check, in order: schemas first, then (if they pass) keys and references. */
/**
 * What an item definition may not say (issue #30), beyond its schema and references: an engine
 * fixture (a door, a sign) has none, a masterwork-style `+N` item takes its behaviours from its
 * base item, and each worn slot has one swing cooldown.
 */
export function definitionProblems(data: ContentData): ContentProblem[] {
  const out: ContentProblem[] = [];
  for (const [layer, names] of aliasCycles(data.items.definitions ?? [])) {
    out.push({
      where: `items/definitions/${names[0]}`,
      message: `the ${layer} layer's "drawn as" goes round in a loop: ${[...names, names[0]].join(" → ")}`,
    });
  }
  for (const d of data.items.definitions ?? []) {
    const where = `items/definitions/${d.name}`;
    if (isEngineFixture(d.name)) {
      out.push({ where, message: `${d.name} is an engine fixture: it has no definition` });
    }
    if (!definesBehaviours(d.name)) {
      for (const [field, what] of [
        ["behaviours", "behaviours"],
        ["requires", "needs"],
        ["paperdoll", "worn pictures"],
      ] as const) {
        if (d[field] !== undefined) {
          out.push({
            where,
            message: `${d.name} takes its ${what} from ${behaviourName(d.name)}: give it none`,
          });
        }
      }
    }
    // A bow shoots arrows held in the off hand: two-handed, it never could.
    if (d.behaviours?.includes("bow")) {
      if (d.twoHanded) {
        out.push({
          where,
          message: `${d.name} is a bow, which shoots arrows held in the off hand: it cannot take both hands`,
        });
      }
      const compiled = compileDefinitions(data);
      const arrows = ARROW_COLOURS.some((c) =>
        data.items.items.some(
          (i) =>
            !i.retired &&
            lingoEq(i.name, `${c} Arrows`) &&
            lastMatch(compiled.itemRules.equip.slots, i.name)?.slot === "RightHand",
        ),
      );
      if (!arrows) {
        out.push({
          where,
          message: `${d.name} is a bow, but no arrows (${ARROW_COLOURS[0]} Arrows …) can be held in the off hand to shoot`,
        });
      }
    }
    // Smith repairs at the anvil: an item no repair recipe takes would only lose its Equip button.
    // (Not when the pack's own rules already give it Smith, as Classic's Damaged Armor has.)
    if (
      d.menu === "Smith" &&
      !(data.craft.stations.smith?.repairs ?? []).some((r) => lingoEq(r.input, d.name)) &&
      lastMatch(data.itemRules.menu, d.name)?.action !== "Smith"
    ) {
      out.push({
        where,
        message: `${d.name}'s menu button is Smith, but no repair recipe takes it: add one, or give it another button`,
      });
    }
    // A book is read by Use: one that is no book (by its behaviours) is never read, and a spell
    // book teaches the spell whose book it is. (Not when the pack's own rules already say so.)
    const packTeaches =
      lastMatch(data.itemRules.use.books, d.name) !== undefined ||
      data.itemRules.use.skillBooks.some((b) => ruleMatches(d.name, b));
    if ((d.use?.skillBook !== undefined || d.use?.mysticism !== undefined) && !packTeaches) {
      const compiled = compileDefinitions(data);
      if (!behaviourTest(compiled.itemRules.behaviours)(d.name, "book")) {
        out.push({
          where: `${where}/use`,
          message: `${d.name} teaches when read, but it is no book: give it the book behaviour`,
        });
      }
      if (
        d.use?.mysticism !== undefined &&
        !compiled.spells.spells.some((sp) => sp.book && ruleMatches(d.name, sp.book))
      ) {
        out.push({
          where: `${where}/use/mysticism`,
          message: `${d.name} needs Mysticism to read, but no spell's book is ${d.name}: set a spell's book to it, or give it no Mysticism`,
        });
      }
    }
    // A carried container's storage is kept under its copy's own `#id`: without one every copy
    // would open the same storage.
    if (d.menu === "Storage" && d.container?.uniqueId !== true) {
      out.push({
        where,
        message: `${d.name} opens as Storage, so each copy needs its own #id: tick "gets a #id"`,
      });
    }
    // Only a container behaviour makes the game treat the item as a container (one may not be
    // put inside another, nor in the vault); Storage without one would let containers nest.
    if (d.menu === "Storage" && !(d.behaviours ?? []).some((b) => STORAGE_BEHAVIOURS.includes(b))) {
      out.push({
        where: `${where}/behaviours`,
        message: `${d.name} opens as Storage, so it needs a container behaviour: ${STORAGE_BEHAVIOURS.join(", ")}`,
      });
    }
    // Two-handed takes the off hand too: only a weapon held in the weapon hand can be.
    if (d.twoHanded && d.slot !== "LeftHand") {
      out.push({
        where,
        message: `${d.name} is two-handed but ${d.slot === undefined ? "has no equip slot" : `goes in the ${d.slot} slot`}: only a LeftHand weapon can be two-handed`,
      });
    }
    (d.tools ?? []).forEach((t, i) => {
      if (t.can === undefined && t.tier !== undefined) {
        out.push({
          where: `${where}/tools/${i}`,
          message: "a tier is for a use: give it a use, or no tier",
        });
      }
      if (t.can === undefined && t.ladder === undefined) {
        out.push({
          where: `${where}/tools/${i}`,
          message: "a tool use does nothing: give it a use or a ladder",
        });
      }
      if (t.ladder !== undefined && !Object.hasOwn(data.itemRules.ladders, t.ladder)) {
        out.push({
          where: `${where}/tools/${i}`,
          message: `names a swing ladder that does not exist: ${t.ladder}`,
        });
      }
    });
    // A layer draws one picture: two aliases for one layer would leave the first unseen.
    const layers = (d.paperdoll ?? []).map((a) => a.layer);
    const twiceLayer = layers.find((l, i) => layers.indexOf(l) !== i);
    if (twiceLayer) {
      out.push({
        where: `${where}/paperdoll`,
        message: `two pictures for the ${twiceLayer} layer: give it one`,
      });
    }
    const slots = (d.cooldowns ?? []).map((c) => c.slot);
    const twice = slots.find((s, i) => slots.indexOf(s) !== i);
    if (twice) {
      out.push({
        where: `${where}/cooldowns`,
        message: `two swing cooldowns for the ${twice} slot: give it one`,
      });
    }
  }
  return out;
}

export function checkStore(
  next: ContentData,
  published: ContentData,
  packKeys: Parameters<typeof keyProblems>[1],
  npcSaves: readonly NpcSave[] = [],
): ContentProblem[] {
  const schema = schemaProblems(next);
  if (schema.length > 0) {
    return schema;
  }
  return [
    ...keyProblems(next, packKeys),
    ...definitionProblems(next),
    ...monsterProblems(next),
    ...skillProblems(next, published),
    ...progressionProblems(next),
    ...referenceProblems(withNpcSaves(next, npcSaves), withNpcSaves(published, npcSaves)),
  ];
}
