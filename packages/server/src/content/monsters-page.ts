/**
 * The Control Panel's Monsters page on the server (issue #31, stage 4): the form's groups, where
 * each rule comes from, and refusals named by the form's labels. Pure apart from what it is handed.
 *
 * The page edits ordinary content rows: a monster's species record (`monsters/monsters/<name>`, its
 * stats and flags) and its definition (`monsters/definitions/<name>`, what the name-matched tables
 * decide for it). Both go into the shared draft. Its NPC file's loot, spells and flags save live
 * (stage 3, `systems/admin/npcsections.ts`).
 */
import { MONSTER_HIT_EFFECTS, monsterSpellKindSchema } from "@secondstaronline/data/schema";
import {
  type ContentData,
  type ContentMonstersView,
  type ItemRuleSource,
  SKILL_CAP_TABLE,
  type TableHit,
} from "@secondstaronline/shared";

/** The form's groups and the tables each covers, in order. */
export const MONSTER_GROUPS: readonly { id: string; title: string; tables: string[] }[] = [
  {
    id: "behaviour",
    title: "Behaviour",
    tables: [
      "monsters rules.hostile",
      "monsters rules.officer",
      "monsters rules.sparesInnocent",
      "monsters rules.sea",
      "monsters rules.footprint",
      "monsters rules.clearsBlock",
      "monsters rules.namesSelf",
      "monsters rules.noQuests",
      "monsters casting.neverCasts",
    ],
  },
  {
    id: "combat",
    title: "Fighting",
    tables: ["monsters meleeAffinities", SKILL_CAP_TABLE],
  },
  {
    id: "xp",
    title: "Rewards",
    tables: ["monsters rules.killBroadcasts"],
  },
];

/** What each covered table is, as the page names it. */
export const MONSTER_TABLE_LABELS: Record<string, string> = {
  "monsters rules.hostile": "Always attacks players",
  "monsters rules.officer": "Attacks wanted players",
  "monsters rules.sparesInnocent": "Leaves innocent players alone",
  "monsters rules.sea": "Lives in water",
  "monsters rules.footprint": "Takes up 3×2 tiles",
  "monsters rules.clearsBlock": "Others can walk through it",
  "monsters rules.namesSelf": "Says its name when clicked",
  "monsters rules.noQuests": "Never gives quests",
  "monsters casting.neverCasts": "Never casts spells",
  "monsters meleeAffinities": "Weapon bonuses",
  [SKILL_CAP_TABLE]: "Skill training limit",
  "monsters rules.killBroadcasts": "Announcement when killed",
};

/**
 * Where each covered table's rules come from, for a monster. `defined`: by a definition, the
 * operator's own (`"yours"`) or a pack's (`"pack"`); `edited(table)`: the operator has changed that
 * rule table itself.
 */
export function monsterRuleSources(
  hits: readonly TableHit[],
  defined: "yours" | "pack" | null,
  edited: (table: string) => boolean = () => false,
): ItemRuleSource[] {
  const byKey = new Map(hits.map((h) => [h.key, h]));
  return MONSTER_GROUPS.flatMap((g) =>
    g.tables.map((t) => {
      const deciding = byKey.get(t)?.deciding ?? [];
      const whose = edited(t) ? "your edited table's" : "the pack's";
      const from =
        defined === "yours"
          ? "your definition"
          : defined === "pack"
            ? "the pack's definition"
            : deciding.length === 0
              ? `nothing: ${edited(t) ? "your edited table" : "the pack"} has no row for it`
              : `${whose} ${deciding
                  .map((r) => `${r.match} "${r.pattern}" (row ${r.index})`)
                  .join(", ")}`;
      return { group: g.id, label: MONSTER_TABLE_LABELS[t] ?? t, from };
    }),
  );
}

/** The labels a record's or definition's fields are named by in a refusal. */
const FIELD_LABELS: Record<string, string> = {
  hp: "Hit points",
  attack: "Attack",
  defense: "Defense",
  level: "Level",
  xpMelee: "XP for a melee kill",
  xpSpell: "XP for a spell kill",
  skillXp: "Skill XP per kill",
  spawnMinute: "Only appears between minutes",
  body: "Picture",
  display: "Name players see",
  "flags/immobile": "Never moves",
  "flags/unclickable": "Clicking it does nothing",
  "flags/trap": "A trap",
  "flags/dispellable": "Dispel Illusions destroys it",
  "flags/shieldsInnocent": "An innocent player standing on it can't be hit",
  "flags/grabbable": "Can be picked up as",
  "flags/hurtByHealing": "Healing spells hurt it",
  "flags/healedBy": "Healed by these spells",
  "flags/resists": "Resists these spells",
  sea: "Lives in water",
  footprint: "Takes up 3×2 tiles",
  hostile: "Always attacks players",
  officer: "Attacks wanted players",
  sparesInnocent: "Leaves innocent players alone",
  clearsBlock: "Others can walk through it",
  namesSelf: "Says its name when clicked",
  noQuests: "Never gives quests",
  neverCasts: "Never casts spells",
  killXp: "Fixed kill XP",
  killBroadcast: "Announcement when killed",
  affinities: "Weapon bonus",
  skillCap: "Skill training limit",
  lists: "Editor lists",
};

/** A monster spell's fields, as the Monster spells card names them. */
const SPELL_LABELS: Record<string, string> = {
  tag: "ID",
  name: "spell",
  kind: "where it lands",
  power: "power",
  ladder: "how often it casts",
  aName: '"a" monster',
};

/**
 * A refused change's problems as the page says them: each names the field it is about by the
 * form's label (`Weapon bonus 2`, `Hit points`).
 */
export function monsterFieldProblems(
  name: string,
  problems: readonly { where: string; message: string }[],
): { where: string; message: string }[] {
  return problems.map((p) => {
    // A monster spell's field: "Monster spell 2: ladder".
    const spell = /^monsters\/casting\/spells\/(\d+)(?:\/(.+))?$/.exec(p.where);
    if (spell) {
      const field = SPELL_LABELS[spell[2]?.split("/")[0] ?? ""];
      return {
        where: `Monster spell ${Number(spell[1]) + 1}${field ? `: ${field}` : ""}`,
        message: p.message,
      };
    }
    let path = p.where.replace(/^monsters\/(definitions|monsters)\/?/, "");
    if (
      path.toLowerCase() === name.toLowerCase() ||
      path.toLowerCase().startsWith(`${name.toLowerCase()}/`)
    ) {
      path = path.slice(name.length).replace(/^\//, "");
    } else {
      path = path.replace(/^\d+\/?/, "");
    }
    const parts = path.split("/").filter((x) => x !== "");
    let where = name;
    for (const len of [2, 1]) {
      const label = FIELD_LABELS[parts.slice(0, len).join("/")];
      if (label) {
        const n = parts[len];
        where = n !== undefined && /^\d+$/.test(n) ? `${label} ${Number(n) + 1}` : label;
        break;
      }
    }
    return { where, message: p.message };
  });
}

/** The values the form's picks offer. */
export function monsterChoices(
  data: ContentData,
  fx: readonly string[],
): ContentMonstersView["choices"] {
  return {
    effects: [...MONSTER_HIT_EFFECTS],
    kinds: [...monsterSpellKindSchema.options],
    fx: [...fx].sort(),
    items: data.items.items
      .filter((i) => !i.retired)
      .map((i) => i.name)
      .sort(),
  };
}
