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
  for (const s of data.spells.spells) {
    if (s.summon) {
      add(`spells/spells/${s.name}`, "monster", s.summon.monster);
      if (s.summon.skilled) {
        add(`spells/spells/${s.name}`, "monster", s.summon.skilled.monster);
      }
    }
  }
  return out;
}

const refKey = (r: Reference) => `${r.where}\u0000${r.kind}\u0000${r.name.toLowerCase()}`;

/** The references that do not resolve in a store. */
export function brokenReferences(data: ContentData): Reference[] {
  const items = new Set(data.items.items.map((i) => i.name.toLowerCase()));
  const fixtures = new Set(data.items.fixtures.map((f) => f.toLowerCase()));
  const monsters = new Set(data.monsters.monsters.map((m) => m.name.toLowerCase()));
  const skills = new Set(data.classes.skills.map((s) => s.skill.toLowerCase()));
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
        return !skills.has(n);
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
  return [...keyProblems(next, packKeys), ...referenceProblems(next, published)];
}
