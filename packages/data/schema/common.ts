/**
 * Shared Zod pieces for the game-data build.
 *
 * Build-time only: the generated modules in `src/generated/` import these schemas'
 * inferred types with `import type`, which is erased, so `src/` imports nothing at runtime.
 *
 * Every object is strict: a new field in content fails `data:build` until its schema
 * says what the field is.
 */
import { z } from "zod";

/** Lingo string matching mode recorded on a rule. */
export const matchSchema = z.enum(["exact", "contains", "word"]);

/**
 * How an item rule tests a name: case-insensitive comparison (`exact`) or `contains`, both ignoring
 * case. The item rule tables use only these two.
 */
export const ruleMatchSchema = z.enum(["exact", "contains"]);

/** The test every item rule row starts with. */
export const patternRow = { match: ruleMatchSchema, pattern: z.string().min(1) };

/** What a tool can do (issue #37 stage 5): each is an engine kind of gathering. */
export const toolCanSchema = z.enum(["Chop", "Mine", "Dig", "Fish", "Farm", "Water"]);

/**
 * A requirement: a skill (by key) or, written exactly `level`, the level must reach `atLeast`. `text`
 * replaces the engine's refusal line.
 */
export const requirementSchema = z.strictObject({
  needs: z.string().min(1),
  atLeast: z.number().int().min(0).max(1_000_000),
  text: z.string().min(1).optional(),
});
