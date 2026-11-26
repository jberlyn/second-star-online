/**
 * The Recipes tab's preview (issue #45): a recipe's chance of success, the time one craft takes
 * and the XP it gives at a range of skill levels, worked out by the game's own rules (shared
 * `recipeChance` and `recipeFrames`) from the form as it reads now. For the recipe's lowest tool
 * tier; a better tool adds its tier bonus and speed on top.
 */
import { type Recipe, recipeChance, recipeFrames, TICK_HZ } from "@secondstaronline/shared";

/** The levels the preview shows: the recipe's level and each listed odds or time level, and 1 to 99 in steps. */
function levelsOf(r: Recipe): number[] {
  const set = new Set<number>([r.level]);
  for (const p of r.odds ?? []) {
    set.add(p.level);
  }
  for (const t of r.time) {
    set.add(t.level);
  }
  for (const l of [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99]) {
    set.add(l);
  }
  return [...set].filter((l) => l >= r.level && l <= 100).sort((a, b) => a - b);
}

const pct = (p: number) => `${(p * 100).toFixed(p > 0 && p < 0.01 ? 2 : 0)}%`;
const secs = (frames: number) => `${(frames / TICK_HZ).toFixed(frames % TICK_HZ === 0 ? 0 : 1)} s`;

/** The preview's table, or null while the form does not yet hold a recipe. */
export function recipePreview(value: unknown): HTMLElement | null {
  const r = value as Partial<Recipe> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.time) || r.time.length === 0) {
    return null;
  }
  const recipe = r as Recipe;
  if (typeof recipe.level !== "number") {
    return null;
  }
  const box = document.createElement("section");
  box.className = "recipe-preview";
  const h = document.createElement("h4");
  h.className = "balance-row-title";
  h.textContent = "Odds and time by level";
  const help = document.createElement("p");
  help.className = "control-panel-field-help";
  help.textContent =
    "From the form as it reads now, with the lowest tool the recipe takes. The XP is per success; left out, the skill's usual crafting XP.";
  const table = document.createElement("table");
  table.className = "balance-table recipe-preview-table";
  table.setAttribute("aria-label", "Odds and time by level");
  const head = table.createTHead().insertRow();
  for (const t of ["Level", "Success", "One craft", "XP"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = t;
    head.append(th);
  }
  const body = table.createTBody();
  const tier = recipe.tier ?? 1;
  for (const level of levelsOf(recipe)) {
    const tr = body.insertRow();
    const chance = recipeChance(recipe, level, tier);
    const frames = recipeFrames(recipe, level, tier);
    for (const t of [
      String(level),
      pct(chance),
      secs(frames),
      recipe.xp === undefined ? "usual" : String(recipe.xp),
    ]) {
      tr.insertCell().textContent = t;
    }
  }
  box.append(h, help, table);
  return box;
}
