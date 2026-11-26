/**
 * The plain words of the content forms (schema-form.ts): each field's label and help line, the
 * labels of its choices, the names it is offered as you type, and the fields folded under "More
 * options". Each dataset has its own dictionary (content-words/), keyed by a field's path in its
 * row: `"spells.sp"` is the SP field of a spell (part `spells`), `"spells.spByBody.[].pattern"` a
 * pattern in one of its body rows. A field a dictionary does not name falls back to the words for
 * its key shared by every dataset (`COMMON`), then to its key in plain words.
 */
import { content, hasContent } from "@secondstaronline/shared";

import { DATASET_WORDS } from "./content-words/index.ts";
import type { FieldWords, FormWords } from "./schema-form.ts";

/** One dataset's words: by `part.path`, with `[]` for a list's entries and `{}` for named values. */
export type WordBook = Record<string, FieldWords>;

/** Words for keys every dataset uses the same way. */
export const COMMON: WordBook = {
  match: {
    label: "How the name is matched",
    choices: {
      exact: "Exactly this name",
      contains: "Any name containing it",
      word: "As a whole word",
    },
  },
  pattern: { label: "Name", help: "The name (or the part of a name) this applies to." },
  flat: { label: "Fixed amount" },
  randomN: { label: "Plus a roll of 1 to", help: "0 for no roll." },
  power: { label: "Plus the caster's power ×" },
  name: { label: "Name" },
  display: { label: "Name players see" },
  label: { label: "Label" },
  text: { label: "Text", long: true },
  texts: { label: "Texts", noun: "text" },
  message: { label: "Message", long: true },
  messages: { label: "Messages", noun: "message" },
  lines: { label: "Lines", noun: "line" },
  info: { label: "Description", long: true },
  description: { label: "Description", long: true },
  item: { label: "Item", names: "item" },
  items: { label: "Items", noun: "item", names: "item" },
  monster: { label: "Monster", names: "monster" },
  monsters: { label: "Monsters", noun: "monster", names: "monster" },
  skill: { label: "Skill", names: "skill" },
  skills: { label: "Skills", noun: "skill", names: "skill" },
  spell: { label: "Spell", names: "spell" },
  school: { label: "Skill it trains", names: "skill" },
  class: { label: "Class", names: "class" },
  faction: { label: "Faction", names: "faction" },
  sound: { label: "Sound", names: "sound" },
  map: { label: "Map", names: "map" },
  chance: { label: "Chance" },
  oneIn: { label: "Chance: 1 in" },
  count: { label: "How many" },
  amount: { label: "Amount" },
  price: { label: "Price (gold)" },
  cost: { label: "Cost (gold)" },
  gold: { label: "Gold" },
  min: { label: "At least" },
  max: { label: "At most" },
  above: { label: "Above" },
  below: { label: "Below" },
  atLeast: { label: "At least" },
  frames: { label: "Frames", help: "1/20ths of a second." },
  seconds: { label: "Seconds" },
  minutes: { label: "Minutes" },
  x: { label: "x" },
  y: { label: "y" },
  mx: { label: "Map x" },
  my: { label: "Map y" },
  body: { label: "Body (picture number)" },
  enabled: { label: "Turned on" },
  requires: { label: "Requirements", noun: "requirement" },
  atLeastLevel: { label: "Level needed" },
  weight: { label: "Weight", help: "How likely it is to be picked, against the others." },
  colour: { label: "Colour" },
  hp: { label: "HP" },
  sp: { label: "SP" },
  xp: { label: "XP" },
  level: { label: "Level" },
};

/** The names offered as you type, by kind. */
function namesOf(kind: string): readonly string[] {
  if (!hasContent()) {
    return [];
  }
  const c = content();
  switch (kind) {
    case "item":
      return c.items.items.map((i) => i.name);
    case "monster":
      return c.monsters.monsters.map((m) => m.name);
    case "skill":
      return c.classes.skills.map((s) => s.skill);
    case "spell":
      return c.spells.spells.map((s) => s.name);
    case "class":
      return c.classes.classes.map((k) => String(k.code));
    case "faction":
      return c.social.factions.map((f) => f.key);
    case "house":
      return c.houses.types.map((h) => h.house);
    case "vehicle":
      return (c.houses.vehicles ?? []).map((v) => v.name);
    case "recipeStation":
      return (c.craft.recipeStations ?? []).map((s) => s.name);
    case "npc":
      return [
        ...new Set([
          ...c.monsters.monsters.map((m) => m.name),
          ...c.monsters.editorLists.npcEditor.npcs,
        ]),
      ];
    default:
      return [];
  }
}

/** The words of one part's forms. */
export function contentWords(dataset: string, part: string): FormWords {
  const book = DATASET_WORDS[dataset] ?? {};
  return {
    field(path) {
      const keys = path.filter((k) => k !== "[]" && k !== "{}" && !/^\d+$/.test(k));
      const last = keys.at(-1) ?? "";
      const full = [part, ...path].join(".");
      // The path itself, then the same field anywhere in the part, then anywhere in the dataset,
      // then the shared words.
      return book[full] ?? book[`${part}.*.${last}`] ?? book[`*.${last}`] ?? COMMON[last] ?? {};
    },
    names: namesOf,
  };
}
