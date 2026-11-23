/**
 * Schema for `packages/data/content/classes.json`: the classes, the skills (each keyed by its
 * `skill`, which characters are saved with), the start classes, the character-creation record and
 * the skills each weapon trains on a kill.
 *
 */
import { z } from "zod";

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
  skill: z.string().min(1),
  display: z.string().min(1).optional(),
  hidden: z.literal(true).optional(),
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
  /** Each 1 to 100, as a skill can be (the character editor's limits). */
  skills: z.record(z.string(), z.number().int().min(1).max(100)),
});

const ruleSchema = z.strictObject({ rule: z.string() });

export const creationSchema = z.strictObject({
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
    startClasses: z.array(startClassSchema).min(1),
    creation: creationSchema,
    skillGain: z.strictObject({ weaponSkills: skillGainSchema.shape.weaponSkills }),
  })
  .superRefine((data, ctx) => {
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
export type Skill = z.infer<typeof skillSchema>;
export type StartClass = z.infer<typeof startClassSchema>;
export type Creation = z.infer<typeof creationSchema>;
export type WeaponSkills = z.infer<typeof skillGainSchema>["weaponSkills"];
export type ClassesData = z.infer<typeof classesDataSchema>;
