/**
 * The recipes each character has learned (migrations/20261126_79_character_recipes.sql, issue
 * #45). Plain functions over the database; names are stored as the server keeps them (lower case).
 */
import type { Db } from "./database.ts";

export function loadRecipes(db: Db, characterId: string): string[] {
  return db
    .query<{ recipe: string }, [string]>(
      "SELECT recipe FROM character_recipes WHERE character_id = ? ORDER BY recipe",
    )
    .all(characterId)
    .map((r) => r.recipe);
}

/** Replaces the character's learned recipes with `recipes`. */
export function saveRecipes(db: Db, characterId: string, recipes: readonly string[]): void {
  db.prepare("DELETE FROM character_recipes WHERE character_id = ?").run(characterId);
  const ins = db.prepare("INSERT INTO character_recipes (character_id, recipe) VALUES (?, ?)");
  for (const r of recipes) {
    ins.run(characterId, r);
  }
}
