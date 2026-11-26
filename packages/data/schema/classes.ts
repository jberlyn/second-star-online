/**
 * Schema for `packages/data/content/classes.json`: the classes, the skills (each keyed by its
 * `skill`, which characters are saved with), the start classes, the character-creation record and
 * the skills each weapon trains on a kill.
 *
 */
import { z } from "zod";

import { checkProgression, progressionSchema, skillProgressionSchema } from "./progression.ts";

/** The largest class code a start class may offer (the creation message's bound). */
export const MAX_START_CLASS_CODE = 10_000;

/**
 * A skill. `skill` is its permanent key: characters store each skill's value under it, so the
 * list may grow, shrink or be reordered without moving anyone's training (a removed skill's values
 * stay saved and come back if it returns). `display` is the name players see on the Skills page
 * and in "You have advanced in the art of …!" (the key when absent); `hidden` keeps it off the
 * Skills page (1.6 never showed Meditation, Terrain Navigating or Item Identification). The Skills
 * page lists the shown skills in this order.
 */
export const skillSchema = z.strictObject({
  // `__proto__` cannot be a key of the plain objects skills are saved and sent in.
  skill: z
    .string()
    .min(1)
    .refine((k) => k !== "__proto__", "a skill cannot be called __proto__"),
  display: z.string().min(1).optional(),
  hidden: z.literal(true).optional(),
  /** How the skill rises (`progression.ts`); absent: the `chance` model with the world defaults. */
  progression: skillProgressionSchema.optional(),
});

/**
 * A class offered on the creation screen, in the order the screen lists them. `code` is the class
 * row it creates; `label` is the name the screen shows (the class's name when absent); `skills`
 * are the starting values by skill key, every other skill starting at `NEW_SKILL_VALUE` (1).
 */
export const startClassSchema = z.strictObject({
  /** At most `MAX_START_CLASS_CODE`, the most the creation message carries. */
  code: z.number().int().min(1).max(MAX_START_CLASS_CODE),
  label: z.string().min(1).optional(),
  /** Each 0 to 100, as a skill can be (0: it never rises, as in 1.6). */
  skills: z.record(z.string(), z.number().int().min(0).max(100)),
  /**
   * The class's starting kit (issue #15): bag lines added after the world's starting bag
   * (`bindings.json` `start.bag`), in order, as far as the bag's 15 lines go. Left out: none.
   */
  kit: z
    .array(
      z.strictObject({
        item: z.string().min(1),
        qty: z.number().int().min(1).max(1_000_000),
      }),
    )
    .max(15)
    .optional(),
});

const ruleSchema = z.strictObject({ rule: z.string() });

/** The most heads a world's paperdoll art may number (`Head<n>`). */
export const MAX_HEAD = 999;

/**
 * A sex the creation screen offers, in its order (issue #37 stage 7): `code` is what characters
 * are saved with, `label` what the screen, the Bio and the player hub show, and `heads` the heads
 * it may wear, in the order the screen's arrows step through them (the first is shown when the sex
 * is picked). Each head is drawn from the paperdoll art `Head<n>`.
 */
export const sexSchema = z.strictObject({
  code: z.number().int().min(1).max(1000),
  label: z.string().trim().min(1).max(20),
  heads: z
    .array(z.number().int().min(1).max(MAX_HEAD))
    .min(1)
    .max(64)
    .refine((h) => new Set(h).size === h.length, "a head is listed twice"),
});

export const creationSchema = z.strictObject({
  /**
   * The sexes, in screen order. Classic: Male 1 and Female 2 with 1.6's heads (the screen's art
   * names them; any other list is written over it).
   */
  sexes: z
    .array(sexSchema)
    .min(1)
    .max(20)
    .refine((s) => new Set(s.map((x) => x.code)).size === s.length, "a sex code is listed twice"),
  statBudget: ruleSchema,
  startingVitals: z.strictObject({ written: z.string(), notes: z.string() }),
  startingMap: z.strictObject({ value: z.string(), notes: z.string() }),
  otherFields: z.strictObject({
    gold: z.number().int(),
    faction: z.string(),
    profile: z.string(),
    hunger: z.number().int(),
    breakCount: z.number().int(),
  }),
  nameRules: ruleSchema,
});

/**
 * Which skills the equipped weapon trains on a kill or a hit, in source order (the last matching row
 * wins). A kill rolls the row's skills in its list order. How each skill rises is its progression.
 */
export const skillGainSchema = z.object({
  weaponSkills: z.array(
    z.strictObject({
      weapon: z.string(),
      match: z.enum(["exact", "contains"]),
      skills: z.array(z.string()).min(1),
    }),
  ),
});

/**
 * One of the 26 class codes and its name: read by
 * the set-class tool, and, for the 16 classes the original's class-change script
 * handles, its promotion rule: the classes it can be
 * entered from, the requirement (`stat < min` refuses), the SPmax floor and the skills it grants
 * (each raised to a roll of 1-10 if below it). A class's stat points are its `statBonus`.
 */
export const promotionSchema = z.strictObject({
  from: z.array(z.string().min(1)).min(1),
  requirement: z.strictObject({ stat: z.string().min(1), min: z.number().int() }),
  /** Raises SPmax to at least `atLeast` (Paladin). Stat points are the class's `statBonus`. */
  statChanges: z.array(z.strictObject({ stat: z.literal("SPmax"), atLeast: z.number().int() })),
  skillGrants: z.array(z.string().min(1)),
});

/**
 * Stat points a class adds to the allocated stats while a character is in it. Calculated, never
 * stored, so a class can be rebalanced at any time.
 */
export const statBonusSchema = z.strictObject({
  str: z.number().int().optional(),
  sta: z.number().int().optional(),
  dex: z.number().int().optional(),
  int: z.number().int().optional(),
  wis: z.number().int().optional(),
});

/**
 * What a class adds to its holders' play (issue #15), beside its `statBonus`. Each kind but the
 * last two is added to the faction perk of the same name (`social.json` `factionRules`): the two
 * stack. `hpPerLevel` and `spPerLevel` replace the Balance page's HP and SP gained each level.
 */
export const CLASS_PERKS = [
  "spellPower",
  "melee",
  "defence",
  "regeneration",
  "pvpParry",
  "pvpBlock",
  "monsterDodge",
  "hpPerLevel",
  "spPerLevel",
] as const;
export type ClassPerkKind = (typeof CLASS_PERKS)[number];

export const classPerkSchema = z.strictObject({
  kind: z.enum(CLASS_PERKS),
  value: z.number().int().min(-10_000).max(10_000),
});

/**
 * How skills train in a class (issue #15): `cap` is the highest value a skill rises to while in it
 * (a faction the character belongs to can only lower it), `percent` how fast it trains (100 is
 * normal, 200 twice as fast, 0 never). `skills` set a skill's own, over the class-wide values.
 */
export const classTrainingSchema = z.strictObject({
  cap: z.number().int().min(0).max(100).optional(),
  percent: z.number().int().min(0).max(1000).optional(),
  skills: z
    .array(
      z.strictObject({
        skill: z.string().min(1),
        cap: z.number().int().min(0).max(100).optional(),
        percent: z.number().int().min(0).max(1000).optional(),
      }),
    )
    .max(500)
    .optional(),
});

/** What a path checks: a skill (by key), `level`, `HPmax` or `SPmax` at `atLeast` or more. */
export const pathRequirementSchema = z.strictObject({
  needs: z.string().min(1),
  atLeast: z.number().int().min(0).max(1_000_000),
});

/**
 * A way into a class (issue #15): from one of the `from` classes (by code), when every requirement
 * holds, for `gold` and `items` (each taken unless `keep`: then only held), giving `grants`.
 * `where`: at a trainer (an NPC whose file has `TRN|<class>:<price>`, the line's price charged too),
 * from the player's Class window (`anywhere`), or both. Absent: at a trainer.
 */
export const classPathSchema = z.strictObject({
  from: z.array(z.number().int().min(1)).min(1).max(100),
  where: z.enum(["trainer", "anywhere", "both"]).optional(),
  requires: z.array(pathRequirementSchema).max(20).optional(),
  gold: z.number().int().min(0).max(2_000_000_000).optional(),
  items: z
    .array(
      z.strictObject({
        item: z.string().min(1),
        qty: z.number().int().min(1).max(1_000_000),
        keep: z.literal(true).optional(),
      }),
    )
    .max(20)
    .optional(),
  grants: z
    .strictObject({
      /** Each skill raised to at least `to`; a higher skill keeps its value. */
      skills: z
        .array(z.strictObject({ skill: z.string().min(1), to: z.number().int().min(0).max(100) }))
        .max(50)
        .optional(),
      items: z
        .array(z.strictObject({ item: z.string().min(1), qty: z.number().int().min(1).max(1000) }))
        .max(20)
        .optional(),
      /** Spells added to the spellbook, by name. */
      spells: z.array(z.string().min(1)).max(50).optional(),
      /** Full HP and SP raised to at least these. */
      hpMax: z.number().int().min(1).max(1_000_000).optional(),
      spMax: z.number().int().min(0).max(1_000_000).optional(),
    })
    .optional(),
  /** What the Class window says about this path. */
  text: z.string().max(500).optional(),
});

export const classSchema = z.strictObject({
  code: z.number().int().min(1),
  name: z.string().min(1),
  /** What the player's Class window says about the class (issue #15). */
  description: z.string().max(2000).optional(),
  /** An item picture shown beside the class in the Class window. */
  icon: z.string().min(1).optional(),
  /**
   * The class (by code) whose `statBonus`, perks and training this one starts from: its own
   * replace them kind by kind (a stat, a perk kind, a skill's cap or speed). Followed up the chain.
   */
  inherits: z.number().int().min(1).optional(),
  statBonus: statBonusSchema.optional(),
  perks: z.array(classPerkSchema).max(50).optional(),
  training: classTrainingSchema.optional(),
  /** 1.6's promotion into this class (the Classic pack's rows). Absent or null: none. */
  promotion: promotionSchema.nullable().optional(),
  /** The ways into this class (issue #15), besides `promotion`. */
  paths: z.array(classPathSchema).max(50).optional(),
});

/** The part of classes.json that `data:build` emits. */
export const classesDataSchema = z
  .strictObject({
    classes: z.array(classSchema).min(1),
    skills: z.array(skillSchema).min(1),
    startClasses: z.array(startClassSchema).min(1),
    creation: creationSchema,
    skillGain: z.strictObject({ weaponSkills: skillGainSchema.shape.weaponSkills }),
    progression: progressionSchema,
    /**
     * The Skills page's order (issue #38): these skills first, in this order, then every other
     * shown skill in list order. Left out, the page lists the skills in list order. Only the page's
     * order: characters keep each skill's value under its key whatever the order.
     */
    skillOrder: z.array(z.string().min(1)).max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    for (const issue of checkProgression(data.progression, data.skills)) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
    const names = new Set(data.skills.map((s) => s.skill));
    const ordered = new Set<string>();
    (data.skillOrder ?? []).forEach((skill, i) => {
      if (!names.has(skill)) {
        ctx.addIssue({
          code: "custom",
          path: ["skillOrder", i],
          message: `${skill} is not in skills`,
        });
      } else if (ordered.has(skill)) {
        ctx.addIssue({
          code: "custom",
          path: ["skillOrder", i],
          message: `${skill} is listed twice`,
        });
      }
      ordered.add(skill);
    });
    const classCodes = new Set(data.classes.map((c) => c.code));
    data.classes.forEach((c, i) => {
      if (c.inherits !== undefined && !classCodes.has(c.inherits)) {
        ctx.addIssue({
          code: "custom",
          path: ["classes", i, "inherits"],
          message: `class ${c.inherits} is not in classes`,
        });
      }
      (c.training?.skills ?? []).forEach((row, j) => {
        if (!names.has(row.skill)) {
          ctx.addIssue({
            code: "custom",
            path: ["classes", i, "training", "skills", j, "skill"],
            message: `${row.skill} is not in skills`,
          });
        }
      });
      (c.paths ?? []).forEach((path, j) => {
        path.from.forEach((code, k) => {
          if (!classCodes.has(code)) {
            ctx.addIssue({
              code: "custom",
              path: ["classes", i, "paths", j, "from", k],
              message: `class ${code} is not in classes`,
            });
          }
        });
        (path.grants?.skills ?? []).forEach((g, k) => {
          if (!names.has(g.skill)) {
            ctx.addIssue({
              code: "custom",
              path: ["classes", i, "paths", j, "grants", "skills", k, "skill"],
              message: `${g.skill} is not in skills`,
            });
          }
        });
      });
      c.promotion?.skillGrants.forEach((skill, j) => {
        if (!names.has(skill)) {
          ctx.addIssue({
            code: "custom",
            path: ["classes", i, "promotion", "skillGrants", j],
            message: `${skill} is not in skills`,
          });
        }
      });
    });
    const codes = new Set(data.classes.map((c) => c.code));
    const offered = new Set<number>();
    data.startClasses.forEach((sc, i) => {
      if (offered.has(sc.code)) {
        ctx.addIssue({
          code: "custom",
          path: ["startClasses", i, "code"],
          message: `class ${sc.code} is offered twice`,
        });
      }
      offered.add(sc.code);
      if (!codes.has(sc.code)) {
        ctx.addIssue({
          code: "custom",
          path: ["startClasses", i, "code"],
          message: `class ${sc.code} is not in classes`,
        });
      }
      for (const skill of Object.keys(sc.skills)) {
        if (!names.has(skill)) {
          ctx.addIssue({
            code: "custom",
            path: ["startClasses", i, "skills", skill],
            message: `${skill} is not in skills`,
          });
        }
      }
    });
  });

export type Promotion = z.infer<typeof promotionSchema>;
export type ClassRow = z.infer<typeof classSchema>;
export type ClassPath = z.infer<typeof classPathSchema>;
export type ClassPerk = z.infer<typeof classPerkSchema>;
export type ClassTraining = z.infer<typeof classTrainingSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type StartClass = z.infer<typeof startClassSchema>;
export type SexRow = z.infer<typeof sexSchema>;
export type Creation = z.infer<typeof creationSchema>;
export type WeaponSkills = z.infer<typeof skillGainSchema>["weaponSkills"];
export type ClassesData = z.infer<typeof classesDataSchema>;
