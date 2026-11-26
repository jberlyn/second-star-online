/**
 * The Masterworks tab's preview: the chance a successful craft comes out a masterwork, and each
 * masterwork's own chance, at a range of skill levels, worked out by the game's own rule (shared
 * `oddsAt`) from the form as it reads now.
 */
import { type Masterwork, oddsAt } from "@secondstaronline/shared";

const pct = (p: number) => `${(p * 100).toFixed(p > 0 && p < 0.01 ? 2 : p < 0.1 ? 1 : 0)}%`;

/** The preview's table, or null while the form does not yet hold a masterwork row. */
export function masterworkPreview(value: unknown): HTMLElement | null {
  const m = value as Partial<Masterwork> | null;
  if (!m || typeof m !== "object" || !Array.isArray(m.odds) || m.odds.length === 0) {
    return null;
  }
  const results = (Array.isArray(m.results) ? m.results : []).filter(
    (r) => typeof r?.item === "string" && r.item !== "" && typeof r.weight === "number",
  );
  const total = results.reduce((n, r) => n + r.weight, 0);
  const levels = new Set<number>(m.odds.map((p) => p.level));
  for (const l of [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99]) {
    levels.add(l);
  }
  const box = document.createElement("section");
  box.className = "recipe-preview";
  const h = document.createElement("h4");
  h.className = "balance-row-title";
  h.textContent = "Chance by level";
  const help = document.createElement("p");
  help.className = "control-panel-field-help";
  help.textContent =
    "From the form as it reads now: the chance one successful craft at each level of the crafting skill makes a masterwork, and each masterwork's own chance.";
  const table = document.createElement("table");
  table.className = "balance-table recipe-preview-table";
  table.setAttribute("aria-label", "Masterwork chance by level");
  const head = table.createTHead().insertRow();
  for (const t of [
    "Level",
    "Masterwork",
    ...(results.length > 1 ? results.map((r) => r.item) : []),
  ]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = t;
    head.append(th);
  }
  const body = table.createTBody();
  for (const level of [...levels].filter((l) => l >= 0 && l <= 100).sort((a, b) => a - b)) {
    const tr = body.insertRow();
    const chance = oddsAt(m.odds, level);
    const cells = [String(level), pct(chance)];
    if (results.length > 1 && total > 0) {
      for (const r of results) {
        cells.push(pct((chance * r.weight) / total));
      }
    }
    for (const t of cells) {
      tr.insertCell().textContent = t;
    }
  }
  box.append(h, help, table);
  return box;
}
