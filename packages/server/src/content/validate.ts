/**
 * The checks a merged store passes before it is published: every dataset against its schema,
 * then the key and name rules, then cross-references. Cross-references are compared with the
 * published store, so only a reference the change breaks (or adds broken) is reported: the
 * Classic pack has references 1.6 never resolved ("scroll" in the quests), and those stay as they
 * were. Pure.
 */
import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import {
  buildContentStore,
  type ContentData,
  DATASET_IDS,
  type DatasetId,
  isEngineFixture,
  lingoContains,
  lingoEq,
  npcLootItemOk,
  npcShopItemOk,
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
        out.push({ where: [id, ...issue.path.map(String)].join("/"), message: issue.message });
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
    ...nameProblems("monsters/monsters", data.monsters.monsters, packKeys.monsters),
    ...data.npcFiles.files
      .filter((f) => !packKeys.npcFiles.has(f.name.toLowerCase()))
      .flatMap((f) => {
        const bad = badKeyForm(f.name);
        return bad ? [{ where: `npcFiles/files/${f.name}`, message: bad }] : [];
      }),
  ];
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
  station(["smith", "station"], st.smith.station, null);
  craft(["smith", "tool"], st.smith.tool, null);
  craft(["smith", "chunkDefault"], st.smith.chunkDefault, null);
  st.smith.chunks.forEach((c, i) => {
    craft(["smith", "chunks", i, "item"], c.item, ["smith", "chunks", i]);
    craft(["smith", "chunks", i, "chunk"], c.chunk, ["smith", "chunks", i]);
  });
  st.smith.repairs.forEach((r, i) => {
    craft(["smith", "repairs", i, "input"], r.input, ["smith", "repairs", i]);
    craft(["smith", "repairs", i, "output"], r.output, ["smith", "repairs", i]);
  });
  st.smith.masterwork.forEach((m, i) => {
    craft(["smith", "masterwork", i, "item"], m.item, ["smith", "masterwork", i]);
    m.outcomes.forEach((o, j) => {
      craft(["smith", "masterwork", i, "outcomes", j, "result"], o.result, [
        "smith",
        "masterwork",
        i,
      ]);
    });
  });
  station(["cook", "doubles"], st.cook.doubles, null);
  st.cook.stations.forEach((n, i) => {
    station(["cook", "stations", i], n, ["cook", "stations", i]);
  });
  st.cook.recipes.forEach((r, i) => {
    for (const f of ["input", "output", "burned"] as const) {
      craft(["cook", "recipes", i, f], r[f], ["cook", "recipes", i]);
    }
  });
  station(["mix", "station"], st.mix.station, null);
  st.mix.sands.forEach((m, i) => {
    for (const f of ["sand", "potion", "crystal"] as const) {
      craft(["mix", "sands", i, f], m[f], ["mix", "sands", i]);
    }
  });
  station(["build", "station"], st.build.station, null);
  craft(["build", "tool"], st.build.tool, null);
  st.build.bands.forEach((b, i) => {
    b.results.forEach((r, j) => {
      // Each result answers a roll, so it is replaced, never dropped.
      craft(["build", "bands", i, "results", j, "item"], r.item, null);
    });
  });
  st.cauldron.recipes.forEach((r, i) => {
    r.requires.forEach((n, j) => {
      craft(["cauldron", "recipes", i, "requires", j], n, ["cauldron", "recipes", i]);
    });
    craft(["cauldron", "recipes", i, "result"], r.result, ["cauldron", "recipes", i]);
  });
  // What gathering takes and gives. A roll band's fish and the one-of tools are replaced, not
  // dropped.
  const g = data.gather.gathering;
  const gathering = section("gather", "gathering");
  const gather = (path: JsonPath, n: string, drop: JsonPath | null) =>
    add(gathering, path, "item", n, drop);
  g.tools.forEach((t, i) => {
    if (t.match === "contains") {
      add(gathering, ["tools", i, "tool"], "itemPattern", t.tool, null);
    } else {
      gather(["tools", i, "tool"], t.tool, ["tools", i]);
    }
  });
  gather(["logs", "item"], g.logs.item, null);
  // The ore list is a fixed three, read by position.
  g.mining.ore.items.forEach((n, i) => {
    gather(["mining", "ore", "items", i], n, null);
  });
  g.mining.chunks.forEach((c, i) => {
    gather(["mining", "chunks", i, "tool"], c.tool, ["mining", "chunks", i]);
    gather(["mining", "chunks", i, "item"], c.item, ["mining", "chunks", i]);
  });
  // The fishing tool is always matched with "contains" (shared gather.ts `isFishingPole`).
  add(gathering, ["fishing", "tool"], "itemPattern", g.fishing.tool, null);
  g.fishing.bands.forEach((b, i) => {
    gather(["fishing", "bands", i, "fish"], b.fish, null);
  });
  g.farming.seeds.forEach((sd, i) => {
    gather(["farming", "seeds", i, "item"], sd.item, ["farming", "seeds", i]);
  });
  g.farming.produce.forEach((pr, i) => {
    gather(["farming", "produce", i, "item"], pr.item, ["farming", "produce", i]);
  });
  // A treasure is dropped as a ground name, so "300 Gold" is a pile of the currency, not an item.
  g.treasure.items.forEach((n, i) => {
    if (!currencyPile(n)) {
      gather(["treasure", "items", i], n, ["treasure", "items", i]);
    }
  });
  // What mining strikes, faction deaths and the Assassin's default prizes make.
  g.mining.colours.forEach((c, i) => {
    add(gathering, ["mining", "colours", i], "item", `${c} Crystal`, null, false, true);
  });
  for (const f of data.social.factions) {
    add({ dataset: "social", part: "factions", key: String(f.id) }, ["head"], "item", f.head, null);
  }
  const assassinRow = section("social", "assassin");
  for (const prize of data.social.assassin.prizes.archived.split(":")) {
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
  add(replies, ["oraku", "item"], "item", oraku.item, null);
  add(replies, ["oraku", "reward"], "item", oraku.reward, null);
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
  data.gather.gathering.tools.forEach((t, i) => {
    skill(gathering, ["tools", i, "skill"], (t as { skill?: unknown }).skill);
  });
  const gatherGain = section("gather", "skillGain");
  data.gather.skillGain.forEach((r, i) => {
    skill(gatherGain, [i, "skill"], r.skill);
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
  data.social.assassin.rating.skills.forEach((s, i) => {
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
  for (const s of data.spells.spells) {
    const row: RowRef = { dataset: "spells", part: "spells", key: s.name };
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
  const live: ContentData = data.items.items.some((i) => i.retired)
    ? { ...data, items: { ...data.items, items: data.items.items.filter((i) => !i.retired) } }
    : data;
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
      case "itemOrFixture":
        return !items.has(n) && !fixtures.has(n);
      case "itemPattern":
        return !live.items.items.some((i) => lingoContains(i.name, r.name));
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
    .map((r) => ({ where: r.where, message: referenceMessage(r) }));
}

const BINDINGS_WHERE = "bindings/skills";

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
    ...skillProblems(next, published),
    ...referenceProblems(withNpcSaves(next, npcSaves), withNpcSaves(published, npcSaves)),
  ];
}
