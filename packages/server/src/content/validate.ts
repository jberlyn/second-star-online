/**
 * The checks a merged store passes before it is published: every dataset against its schema,
 * then the key and name rules, then cross-references. Cross-references are compared with the
 * published store, so only a reference the change breaks (or adds broken) is reported: the
 * Classic pack has references 1.6 never resolved (the singular crystals in the player-shop list,
 * "scroll" in the quests), and those stay as they were. Pure.
 */
import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import { type ContentData, DATASET_IDS } from "@secondstaronline/shared";

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
 * indices are exactly 1 to the number of skills, a published skill keeps its index, and no
 * published skill goes (its saved values would move onto another skill).
 */
export function skillProblems(next: ContentData, published: ContentData): ContentProblem[] {
  const out: ContentProblem[] = [];
  const skills = next.classes.skills;
  const indices = new Set(skills.map((s) => s.index));
  for (let i = 1; i <= skills.length; i++) {
    if (!indices.has(i)) {
      out.push({
        where: "classes/skills",
        message: `the skill indices must run from 1 to ${skills.length} with none missing or repeated (${i} is missing)`,
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
  for (const before of published.classes.skills) {
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
  kind: "item" | "monster" | "itemOrFixture" | "skill";
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
  for (const d of data.houses.deeds) {
    add(`houses/deeds/${d.deed}`, "item", d.deed);
  }
  // Skill names written in other rows: `skillIndex` throws on a name it does not know, so a typo
  // would fail every tick that reads it.
  const skill = (where: string, name: unknown) => {
    if (typeof name === "string" && name !== "") {
      add(where, "skill", name);
    }
  };
  for (const c of data.classes.classes) {
    for (const g of c.promotion?.skillGrants ?? []) {
      skill(`classes/classes/${c.code}`, g);
    }
    const stat = c.promotion?.requirement?.stat;
    if (typeof stat === "string" && !STAT_WORDS.has(stat.toLowerCase())) {
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
    if (!STAT_WORDS.has(p.needs.toLowerCase())) {
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
  for (const m of data.social.medals.awards) {
    skill("social/medals", (m as { skill?: unknown }).skill);
  }
  for (const b of data.attPower.attPower.skillBlocks) {
    for (const t of b.tiers) {
      for (const w of t.when ?? []) {
        const name = /^\s*([A-Za-z][A-Za-z ]*?)\s*[<>=]/.exec(w)?.[1];
        if (name && !STAT_WORDS.has(name.toLowerCase())) {
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

/** The words a skill field may hold that name a stat, not a skill. */
const STAT_WORDS = new Set(["level", "hpmax", "spmax", "hp", "sp", "exp"]);

/** A skill name as `skillIndex` compares it: case and spaces ignored. */
const skillNorm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const refKey = (r: Reference) => `${r.where}\u0000${r.kind}\u0000${r.name.toLowerCase()}`;

/** The references that do not resolve in a store. */
export function brokenReferences(data: ContentData): Reference[] {
  const items = new Set(data.items.items.map((i) => i.name.toLowerCase()));
  const fixtures = new Set(data.items.fixtures.map((f) => f.toLowerCase()));
  const monsters = new Set(data.monsters.monsters.map((m) => m.name.toLowerCase()));
  const skills = new Set(data.classes.skills.map((s) => skillNorm(s.skill)));
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
    }
    return false;
  });
}

/** The references broken in `next` that were not already broken in `published`. */
export function referenceProblems(next: ContentData, published: ContentData): ContentProblem[] {
  const before = new Set(brokenReferences(published).map(refKey));
  return brokenReferences(next)
    .filter((r) => !before.has(refKey(r)))
    .map((r) => ({
      where: r.where,
      message: `names ${r.kind === "monster" ? "a monster" : r.kind === "skill" ? "a skill" : "an item"} that does not exist: ${r.name}`,
    }));
}

/** Every pre-publish check, in order: schemas first, then (if they pass) keys and references. */
export function checkStore(
  next: ContentData,
  published: ContentData,
  packKeys: Parameters<typeof keyProblems>[1],
): ContentProblem[] {
  const schema = schemaProblems(next);
  if (schema.length > 0) {
    return schema;
  }
  return [
    ...keyProblems(next, packKeys),
    ...skillProblems(next, published),
    ...referenceProblems(next, published),
  ];
}
