/**
 * Schema for `packages/data/content/classes.json`: the skill names, the Skills
 * page rows and the character-creation record (shorter starting-value lists take
 * `NEW_SKILL_VALUE`).
 *
 */
import { z } from "zod";

export const skillSchema = z.strictObject({
  index: z.number().int().min(1),
  skill: z.string().min(1),
});

/**
 * One row of the Skills page (frame 65): the display name from field MyStats (DBAdmin #15)
 * and the 1-based skill index whose value the skills page writes on that line of
 * MyStatAmounts. 35 rows, in 1.6's fixed order;
 * Meditation, Terrain Navigating and Item Identification are not shown.
 */
export const skillPanelRowSchema = z.strictObject({
  name: z.string().min(1),
  index: z.number().int().min(1),
});

const startingSkillsSchema = z.strictObject({
  values: z.array(z.number().int()).min(1),
  valuesWritten: z.number().int(),
  nonDefault: z.record(z.string(), z.number().int()),
});

const ruleSchema = z.strictObject({ rule: z.string() });

export const creationSchema = z.strictObject({
  statBudget: ruleSchema,
  // The three start classes (protocol/core.ts, creation.ts).
  classes: z.strictObject({ "1": z.string(), "2": z.string(), "3": z.string() }),
  startingSkills: z.strictObject({
    "1": startingSkillsSchema,
    "2": startingSkillsSchema,
    "3": startingSkillsSchema,
  }),
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
  skillsWritten: z.string(),
});

/**
 * Kill skill gain: which skills the equipped weapon
 * trains, in source order (the last matching row wins). The per-skill chances and caps are
 * code, ported in shared/rules/progression/skillgain.ts.
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

export const classSchema = z.strictObject({
  code: z.number().int().min(1),
  name: z.string().min(1),
  statBonus: statBonusSchema.optional(),
  promotion: promotionSchema.nullable(),
});

/** The part of classes.json that `data:build` emits. */
export const classesDataSchema = z
  .strictObject({
    classes: z.array(classSchema).min(1),
    skills: z.array(skillSchema).min(1),
    skillPanel: z.array(skillPanelRowSchema).min(1),
    creation: creationSchema,
    skillGain: z.strictObject({ weaponSkills: skillGainSchema.shape.weaponSkills }),
  })
  .superRefine((data, ctx) => {
    // No fixed number of skills: the Skills page rows and the starting values follow `skills`.
    const count = data.skills.length;
    data.skillPanel.forEach((row, i) => {
      if (row.index > count) {
        ctx.addIssue({
          code: "custom",
          path: ["skillPanel", i, "index"],
          message: `skill ${row.index} is not in skills (${count})`,
        });
      }
    });
    const names = new Set(data.skills.map((s) => s.skill));
    data.classes.forEach((c, i) => {
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
    for (const cls of ["1", "2", "3"] as const) {
      const values = data.creation.startingSkills[cls].values;
      if (values.length > count) {
        ctx.addIssue({
          code: "custom",
          path: ["creation", "startingSkills", cls, "values"],
          message: `more starting values (${values.length}) than skills (${count})`,
        });
      }
    }
  });

export type Promotion = z.infer<typeof promotionSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Creation = z.infer<typeof creationSchema>;
export type WeaponSkills = z.infer<typeof skillGainSchema>["weaponSkills"];
export type ClassesData = z.infer<typeof classesDataSchema>;
