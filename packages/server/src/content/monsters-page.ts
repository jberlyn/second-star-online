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
    title: "Combat",
    tables: ["monsters meleeAffinities", SKILL_CAP_TABLE],
  },
  {
    id: "xp",
    title: "XP",
    tables: ["monsters rules.killXp", "monsters rules.killBroadcasts"],
  },
];

/** What each covered table is, as the page names it. */
export const MONSTER_TABLE_LABELS: Record<string, string> = {
  "monsters rules.hostile": "Hostile",
  "monsters rules.officer": "Attacks the wanted",
  "monsters rules.sparesInnocent": "Spares the innocent",
  "monsters rules.sea": "Sea creature",
  "monsters rules.footprint": "3×2 wide",
  "monsters rules.clearsBlock": "Clears its block",
  "monsters rules.namesSelf": "Says its name",
  "monsters rules.noQuests": "Gives no quests",
  "monsters casting.neverCasts": "Never casts",
  "monsters meleeAffinities": "Weapon affinities",
  [SKILL_CAP_TABLE]: "Kill skill cap",
  "monsters rules.killXp": "Kill XP",
  "monsters rules.killBroadcasts": "Kill broadcast",
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
  xpMelee: "Melee kill XP",
  xpSpell: "Spell kill XP",
  skillXp: "Skill XP",
  spawnMinute: "Spawns only between minutes",
  body: "Body",
  display: "Display name",
  "flags/immobile": "Immobile",
  "flags/unclickable": "Unclickable",
  "flags/trap": "Trap",
  "flags/dispellable": "Dispellable",
  "flags/shieldsInnocent": "Shields the innocent",
  "flags/grabbable": "Picked up as",
  "flags/hurtByHealing": "Hurt by healing",
  "flags/healedBy": "Healed by",
  "flags/resists": "Resists",
  sea: "Sea creature",
  footprint: "3×2 wide",
  hostile: "Hostile",
  officer: "Attacks the wanted",
  sparesInnocent: "Spares the innocent",
  clearsBlock: "Clears its block",
  namesSelf: "Says its name",
  noQuests: "Gives no quests",
  neverCasts: "Never casts",
  killXp: "Kill XP",
  killBroadcast: "Kill broadcast",
  affinities: "Weapon affinity",
  skillCap: "Kill skill cap",
  lists: "Lists",
};

/** A monster spell's fields, as the Monster spells card names them. */
const SPELL_LABELS: Record<string, string> = {
  tag: "tag",
  name: "effect",
  kind: "aim",
  power: "power",
  ladder: "ladder",
  aName: "a-prefixed caster",
};

/**
 * A refused change's problems as the page says them: each names the field it is about by the
 * form's label (`Weapon affinity 2`, `Hit points`).
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
