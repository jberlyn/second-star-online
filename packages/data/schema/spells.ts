/**
 * Schema for `packages/data/content/spells.json`: one record per spell holding its data
 * (SP cost with optional body-armour overrides, crystals, harmful flag, save id, book match,
 * Info text, optional summoned species, and FX runs with frames, projectile step, cast sounds
 * and `effect`).
 *
 * Spell effects stay code in `packages/shared/src/rules/spells/` and `packages/server/src/systems/spells/`,
 * keyed by `effect` (the 1.6 spell name on the spell, and the 1.6 FX run member on each FX run).
 * What a spell's numbers come from is content: its `school` (the skill a cast trains), its `power`
 * table (in `power.tables`, after the `power.base` rows every spell takes), and what Create Food
 * makes (`creates`).
 */
import { z } from "zod";

import { tierFields } from "./attpower.ts";
import { patternRow } from "./common.ts";

const int = z.number().int();

export const spellSoundSchema = z.strictObject({
  name: z.string().min(1),
  ch: int.min(1).max(8),
});

/** One FX member run: `<member>-1` … `<member>-<lastFrame>` of cast FX (the original's FX scripts). */
export const spellFxSchema = z.strictObject({
  /** The member base, `<base>-<n>` ("FireballL", "Minor Heal"). */
  member: z.string().min(1),
  /** The 1.6 FX run member this run behaves as ("FireballL" for a new directional spell). */
  effect: z.string().min(1),
  /** Members that exist in cast FX for this run (0 for the dead spells); at most 99, an art row's. */
  frames: int.nonnegative().max(99),
  /**
   * The frame at which the original's FX script hides the sprite, or null for a looping
   * projectile. At most 99, the most frames an uploaded run may have (Classic's longest is 60).
   */
  lastFrame: int.positive().max(99).nullable(),
  /** Projectiles move every frame along one axis. */
  projectile: z.strictObject({ axis: z.enum(["locH", "locV"]), px: int }).nullable(),
  /** Cast sounds played in order when this FX run is received. */
  sounds: z.array(spellSoundSchema),
});

export const spellSpByBodySchema = z.strictObject({
  ...patternRow,
  sp: int.nonnegative(),
});

export const spellSummonSchema = z.strictObject({
  monster: z.string().min(1),
  skilled: z
    .strictObject({
      skill: z.string().min(1),
      above: int,
      monster: z.string().min(1),
    })
    .nullable(),
});

/** One spell-power row: attack power's tier rows without the weapon test. */
export const spellPowerTierSchema = z.strictObject(tierFields);

/** A named spell-power table: its rows in order, then a worn item's bonus of one gear power. */
export const spellPowerTableSchema = z.strictObject({
  tiers: z.array(spellPowerTierSchema),
  /** The `item-rules.json` `gear` power whose bonus is added after the rows. Absent = none. */
  gear: z.enum(["blackArts", "martialArts"]).optional(),
});

/** The skill a cast of this spell trains, the line it prints, and the skill's cap. */
export const spellSchoolSchema = z.strictObject({
  /** A skill key (classes.json `skills`). */
  skill: z.string().min(1),
  /** The skill rises only below this. Absent = the caster's Mage skill cap (faction perks). */
  cap: int.positive().max(100).optional(),
});

/** One item Create Food can make, and the article its line puts before it ("an Apple"). */
export const spellCreatesSchema = z.strictObject({
  item: z.string().min(1),
  article: z.string().min(1).optional(),
});

export const spellSchema = z.strictObject({
  name: z.string().min(1),
  /** 1.6's `savespells` encode id, or null (Identify had none). SSO saves spellbooks by name. */
  id: int.nullable(),
  /** The 1.6 spell whose effect code this row runs. */
  effect: z.string().min(1),
  /** SP cost from the cost cascade; null when the cascade sets none. */
  sp: int.nonnegative().nullable(),
  /** Body-armour SP overrides, checked in order (last match wins). Absent = none. */
  spByBody: z.array(spellSpByBodySchema).optional(),
  /** Crystal colour and count required to cast, or null for none. */
  crystals: z.strictObject({ colour: z.string().min(1), count: int.positive() }).nullable(),
  /** In the harmful set. */
  harmful: z.boolean(),
  /** Book-item match rule (last match in file order wins), or null. */
  book: z.strictObject(patternRow).nullable(),
  /** Spellbook Info text, or null for none. */
  info: z.string().nullable(),
  /** Summoned species. Absent = not a summon spell. */
  summon: spellSummonSchema.optional(),
  /** The school a cast trains after Magery. Absent = Magery only. */
  school: spellSchoolSchema.optional(),
  /** The `power.tables` entry added after the base power. Absent = the base power alone. */
  power: z.string().min(1).optional(),
  /**
   * How many seconds the body this spell gives lasts (the Morph, Nature Shift and Smoke Bomb
   * effects), 1 to 3600. Absent = 65, 1.6's 1,300 frames.
   */
  lasts: int.min(1).max(3600).optional(),
  /** Create Food's choices, one taken at random. Read only by the Create Food effect. */
  creates: z.array(spellCreatesSchema).min(1).optional(),
  fx: z.array(spellFxSchema),
});

/** The 36 original spell effects that have code in shared/server/client. */
export const IMPLEMENTED_SPELL_EFFECTS = new Set([
  "smoke bomb",
  "minor heal",
  "morph",
  "stone skin",
  "crush",
  "whirlwind",
  "meteor",
  "identify",
  "portal",
  "fireball",
  "summon creature",
  "holy shield",
  "wind wave",
  "bolt",
  "firebolt",
  "poison dart",
  "weaken",
  "bless",
  "firesword",
  "major heal",
  "replenish",
  "splash",
  "nature shift",
  "holy weapon",
  "illusionary spikes",
  "argon's fist",
  "inxition",
  "magic shield",
  "create food",
  "dispel illusions",
  "hold",
  "raise dead",
  "web",
  "diminish hunger",
  "radar",
  "haste",
]);

export const spellsDataSchema = z
  .strictObject({
    spells: z.array(spellSchema),
    /**
     * Spell power: every cast starts from 1, takes the `base` rows, the caster's faction perk and
     * worn spell gear (engine), then its own table's rows.
     */
    power: z.strictObject({
      base: z.array(spellPowerTierSchema),
      tables: z.record(z.string().min(1), spellPowerTableSchema),
    }),
  })
  .superRefine((data, ctx) => {
    data.spells.forEach((s, i) => {
      if (s.power !== undefined && !Object.hasOwn(data.power.tables, s.power)) {
        ctx.addIssue({
          code: "custom",
          path: ["spells", i, "power"],
          message: `power table ${JSON.stringify(s.power)} is not in power.tables`,
        });
      }
    });
    const names = new Set<string>();
    const ids = new Set<number>();
    const members = new Set<string>();
    const originals = new Map<string, (typeof data.spells)[number]>();

    data.spells.forEach((s, i) => {
      const nameKey = s.name.toLowerCase();
      if (names.has(nameKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["spells", i, "name"],
          message: `duplicate spell name ${JSON.stringify(s.name)}`,
        });
      }
      names.add(nameKey);

      if (s.id !== null) {
        if (ids.has(s.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["spells", i, "id"],
            message: `duplicate spell id ${s.id}`,
          });
        }
        ids.add(s.id);
      }

      if (IMPLEMENTED_SPELL_EFFECTS.has(nameKey) && s.effect.toLowerCase() === nameKey) {
        originals.set(nameKey, s);
      }

      s.fx.forEach((f, j) => {
        const memKey = f.member.toLowerCase();
        if (members.has(memKey)) {
          ctx.addIssue({
            code: "custom",
            path: ["spells", i, "fx", j, "member"],
            message: `duplicate FX member ${JSON.stringify(f.member)}`,
          });
        }
        members.add(memKey);
      });
    });

    data.spells.forEach((s, i) => {
      const effKey = s.effect.toLowerCase();
      if (!IMPLEMENTED_SPELL_EFFECTS.has(effKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["spells", i, "effect"],
          message: `effect ${JSON.stringify(s.effect)} is not one of the implemented spell effects`,
        });
        return;
      }
      const orig = originals.get(effKey);
      if (!orig) {
        ctx.addIssue({
          code: "custom",
          path: ["spells", i, "effect"],
          message: `effect ${JSON.stringify(s.effect)} does not name an original spell`,
        });
        return;
      }
      const isOriginal = orig === s;
      const origMembers = new Set(orig.fx.map((f) => f.member.toLowerCase()));
      s.fx.forEach((f, j) => {
        if (isOriginal) {
          if (f.effect.toLowerCase() !== f.member.toLowerCase()) {
            ctx.addIssue({
              code: "custom",
              path: ["spells", i, "fx", j, "effect"],
              message: `original spell run ${JSON.stringify(f.member)} must have effect equal to its member`,
            });
          }
        } else if (!origMembers.has(f.effect.toLowerCase())) {
          ctx.addIssue({
            code: "custom",
            path: ["spells", i, "fx", j, "effect"],
            message: `run effect ${JSON.stringify(f.effect)} is not a run of ${JSON.stringify(orig.name)}`,
          });
        }
      });
    });
  });

export type Spell = z.infer<typeof spellSchema>;
export type SpellFx = z.infer<typeof spellFxSchema>;
export type SpellSound = z.infer<typeof spellSoundSchema>;
export type SpellSpByBody = z.infer<typeof spellSpByBodySchema>;
export type SpellSummon = z.infer<typeof spellSummonSchema>;
export type SpellSchool = z.infer<typeof spellSchoolSchema>;
export type SpellCreates = z.infer<typeof spellCreatesSchema>;
export type SpellPowerTier = z.infer<typeof spellPowerTierSchema>;
export type SpellPowerTable = z.infer<typeof spellPowerTableSchema>;
export type SpellsData = z.infer<typeof spellsDataSchema>;
