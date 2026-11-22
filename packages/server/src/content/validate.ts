/**
 * The checks a merged store passes before it is published: every dataset against its schema,
 * then the key and name rules, then cross-references. Cross-references are compared with the
 * published store, so only a reference the change breaks (or adds broken) is reported: the
 * Classic pack has references 1.6 never resolved (the singular crystals in the player-shop list,
 * "scroll" in the quests), and those stay as they were. Pure.
 */
import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import {
  buildContentStore,
  type ContentData,
  DATASET_IDS,
  npcLootItemOk,
  npcShopItemOk,
} from "@secondstaronline/shared";

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
 * The skill rules: a character's saved skills are a list read by each skill's `index`, so the
 * skills are listed in index order, 1 to the number of skills; a skill characters have saved
 * (`saved`) keeps its index, and none goes (its saved values would move onto another skill).
 */
export function skillProblems(
  next: ContentData,
  saved: readonly { skill: string; index: number }[],
): ContentProblem[] {
  const out: ContentProblem[] = [];
  const skills = next.classes.skills;
  for (let i = 1; i <= skills.length; i++) {
    // Listed in index order too: the character editor and sheet show a skill by its position.
    if (skills[i - 1]?.index !== i) {
      out.push({
        where: "classes/skills",
        message: `the skills must be listed in index order, 1 to ${skills.length}, with none missing or repeated (${i} is not ${i === 1 ? "first" : `after ${i - 1}`})`,
      });
      break;
    }
  }
  // The rules find a skill by its name with case and spaces ignored ("Martial Arts" is
  // MartialArts), so two skills may not share that spelling: the later would take the other's slot.
  const spelled = new Map<string, string>();
  for (const s of skills) {
    const other = spelled.get(skillNorm(s.skill));
    if (other !== undefined) {
      out.push({
        where: `classes/skills/${s.skill}`,
        message: `its name reads the same as ${other} (case and spaces are ignored)`,
      });
    }
    spelled.set(skillNorm(s.skill), s.skill);
  }
  for (const before of saved) {
    const now = skills.find((s) => s.skill.toLowerCase() === before.skill.toLowerCase());
    if (!now) {
      out.push({
        where: `classes/skills/${before.skill}`,
        message: "a skill characters have trained cannot be removed",
      });
    } else if (now.index !== before.index) {
      out.push({
        where: `classes/skills/${before.skill}`,
        message: `its index is ${before.index} in every saved character and cannot change`,
      });
    }
  }
  return out;
}

/** One reference from a row to a name another list must hold. */
interface Reference {
  where: string;
  kind: "item" | "monster" | "itemOrFixture" | "skill" | "shopItem" | "lootItem";
  name: string;
}

/** Every checked reference in a store. */
export function referencesOf(data: ContentData): Reference[] {
  const out: Reference[] = [];
  const add = (where: string, kind: Reference["kind"], name: string) =>
    out.push({ where, kind, name });
  for (const n of data.items.editorItems) {
    add("items/editorItems", "itemOrFixture", n);
  }
  for (const n of data.items.playerShopWhitelist) {
    add("items/playerShopWhitelist", "item", n);
  }
  const lists = data.monsters.editorLists;
  for (const n of [...lists.worldEditor.monsters, ...lists.worldEditor.npcs]) {
    add("monsters/editorLists", "monster", n);
  }
  for (const n of [...lists.npcEditor.monsters, ...lists.npcEditor.npcs]) {
    add("monsters/editorLists", "monster", n);
  }
  for (const q of data.quests.current) {
    add("quests/current", "item", q.wants);
    add("quests/current", "item", q.reward);
  }
  // A finished quest rolls its next one from the pools, trimmed (shared quests.ts `findNewQuest`).
  for (const w of data.quests.pools.wanted) {
    add("quests/pools", "item", w.item.trim());
  }
  for (const r of data.quests.pools.rewards) {
    add("quests/pools", "item", r.item.trim());
  }
  // What the crafting stations take, use and make.
  const st = data.craft.stations;
  const craft = (n: string) => add("craft/stations", "item", n);
  const station = (n: string) => add("craft/stations", "itemOrFixture", n);
  station(st.smith.station);
  craft(st.smith.tool);
  craft(st.smith.chunkDefault);
  for (const c of st.smith.chunks) {
    craft(c.item);
    craft(c.chunk);
  }
  for (const r of st.smith.repairs) {
    craft(r.input);
    craft(r.output);
  }
  for (const m of st.smith.masterwork) {
    craft(m.item);
    for (const o of m.outcomes) {
      craft(o.result);
    }
  }
  st.cook.stations.forEach(station);
  for (const r of st.cook.recipes) {
    craft(r.input);
    craft(r.output);
    craft(r.burned);
  }
  station(st.mix.station);
  for (const m of st.mix.sands) {
    craft(m.sand);
    craft(m.potion);
    craft(m.crystal);
  }
  station(st.build.station);
  craft(st.build.tool);
  for (const b of st.build.bands) {
    for (const r of b.results) {
      craft(r.item);
    }
  }
  for (const r of st.cauldron.recipes) {
    r.requires.forEach(craft);
    craft(r.result);
  }
  // What gathering takes and gives.
  const g = data.gather.gathering;
  const gather = (n: string) => add("gather/gathering", "item", n);
  for (const t of g.tools) {
    gather(t.tool);
  }
  gather(g.logs.item);
  g.mining.ore.items.forEach(gather);
  for (const c of g.mining.chunks) {
    gather(c.tool);
    gather(c.item);
  }
  gather(g.fishing.tool);
  for (const b of g.fishing.bands) {
    gather(b.fish);
  }
  for (const sd of g.farming.seeds) {
    gather(sd.item);
  }
  for (const pr of g.farming.produce) {
    gather(pr.item);
  }
  g.treasure.items.forEach(gather);
  for (const d of data.houses.deeds) {
    add(`houses/deeds/${d.deed}`, "item", d.deed);
  }
  // Skill names written in other rows: `skillIndex` throws on a name it does not know, so a typo
  // would fail every tick that reads it.
  // NPC files: what a shop sells or buys, and what a monster drops, as the NPC Editor checks them.
  for (const f of data.npcFiles.files) {
    for (const line of f.text.split(/\r\n?|\n/)) {
      const m = /^(SEL|BUY|INV)\|([^:|]*)/.exec(line);
      if (m) {
        add(`npcFiles/files/${f.name}`, m[1] === "INV" ? "lootItem" : "shopItem", m[2] as string);
      }
    }
  }
  // An empty name is a reference too: the rules look it up all the same, and find nothing.
  const skill = (where: string, name: unknown) => {
    if (typeof name === "string") {
      add(where, "skill", name);
    }
  };
  for (const c of data.classes.classes) {
    for (const g of c.promotion?.skillGrants ?? []) {
      skill(`classes/classes/${c.code}`, g);
    }
    const stat = c.promotion?.requirement?.stat;
    // Promotion reads exactly "HPmax" and "SPmax" as stats (shared promotion.ts).
    if (typeof stat === "string" && stat !== "HPmax" && stat !== "SPmax") {
      skill(`classes/classes/${c.code}`, stat);
    }
  }
  for (const w of data.classes.skillGain.weaponSkills) {
    for (const s of w.skills) {
      skill("classes/skillGain", s);
    }
  }
  for (const t of data.gather.gathering.tools) {
    skill("gather/gathering", (t as { skill?: unknown }).skill);
  }
  for (const r of data.gather.skillGain) {
    skill("gather/skillGain", r.skill);
  }
  for (const b of data.itemRules.use.skillBooks) {
    skill("itemRules/use", b.skill);
  }
  for (const p of data.itemRules.ground.platforms) {
    // A platform reads exactly "level" as the level (shared ground.ts `blocksPlayer`).
    if (p.needs !== "level") {
      skill("itemRules/ground", p.needs);
    }
  }
  for (const s of data.social.assassin.rating.skills) {
    skill("social/assassin", s);
  }
  for (const t of data.social.bios.titles) {
    for (const test of (t as { tests?: { skill?: unknown }[] }).tests ?? []) {
      skill("social/bios", test.skill);
    }
  }
  // The Bio score counts exactly "HPmax" and "SPmax" as stats (shared bios.ts `bioScore`).
  for (const s of data.social.bios.score.counted) {
    if (s !== "HPmax" && s !== "SPmax") {
      skill("social/bios", s);
    }
  }
  for (const m of data.social.medals.awards) {
    skill("social/medals", (m as { skill?: unknown }).skill);
  }
  for (const b of data.attPower.attPower.skillBlocks) {
    for (const t of b.tiers) {
      for (const w of t.when ?? []) {
        // Read exactly as `tierApplies` reads it, so every name a swing would look up is checked.
        const name = /^(\w+) [<>] \d+$/.exec(w)?.[1];
        // A tier reads exactly "level" as the level (shared attpower.ts `tierApplies`).
        if (name && name !== "level") {
          skill("attPower/attPower", name);
        }
      }
    }
  }
  for (const s of data.spells.spells) {
    skill(`spells/spells/${s.name}`, s.summon?.skilled?.skill);
    if (s.summon) {
      add(`spells/spells/${s.name}`, "monster", s.summon.monster);
      if (s.summon.skilled) {
        add(`spells/spells/${s.name}`, "monster", s.summon.skilled.monster);
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
  const items = new Set(data.items.items.map((i) => i.name.toLowerCase()));
  const fixtures = new Set(data.items.fixtures.map((f) => f.toLowerCase()));
  const monsters = new Set(data.monsters.monsters.map((m) => m.name.toLowerCase()));
  const skills = new Set(data.classes.skills.map((s) => skillNorm(s.skill)));
  const store = buildContentStore(data);
  return referencesOf(data).filter((r) => {
    const n = r.name.toLowerCase();
    switch (r.kind) {
      case "item":
        return !items.has(n);
      case "itemOrFixture":
        return !items.has(n) && !fixtures.has(n);
      case "monster":
        return !monsters.has(n);
      case "skill":
        return !skills.has(skillNorm(r.name));
      case "shopItem":
        return !npcShopItemOk(r.name, store);
      case "lootItem":
        return !npcLootItemOk(r.name, store);
    }
    return false;
  });
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
      return left <= 0;
    })
    .map((r) => ({
      where: r.where,
      message: `names ${r.kind === "monster" ? "a monster" : r.kind === "skill" ? "a skill" : "an item"} that does not exist: ${r.name || "(nothing)"}`,
    }));
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
  publishedSkills: readonly { skill: string; index: number }[] = published.classes.skills,
): ContentProblem[] {
  const schema = schemaProblems(next);
  if (schema.length > 0) {
    return schema;
  }
  return [
    ...keyProblems(next, packKeys),
    ...skillProblems(next, publishedSkills),
    ...referenceProblems(withNpcSaves(next, npcSaves), withNpcSaves(published, npcSaves)),
  ];
}
