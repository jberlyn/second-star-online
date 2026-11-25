/**
 * What changed between two versions of a content row, in plain words: one line per value that
 * differs ("SP cost: 40 → 41", "Drops: added Gold Ring"), named as the row's form names it
 * (content-words.ts). The Content page shows it for a pack update to a row you changed.
 */
import { contentWords } from "./content-words.ts";
import { entryTitle, humanize } from "./schema-form.ts";

/** One value that differs. */
export interface Change {
  /** Where it is: "Crystals › How many". Empty for the row as a whole. */
  where: string;
  /** The line: "40 → 41", "added Gold Ring", "removed". */
  what: string;
}

/** A value as one short phrase. */
export function phrase(v: unknown): string {
  if (v === null || v === undefined) {
    return "none";
  }
  if (v === true) {
    return "yes";
  }
  if (v === false) {
    return "no";
  }
  if (typeof v === "string") {
    return v === "" ? "(empty)" : `“${v.length > 60 ? `${v.slice(0, 57)}…` : v}”`;
  }
  if (typeof v === "number") {
    return String(v);
  }
  if (Array.isArray(v)) {
    return v.length === 0 ? "an empty list" : `a list of ${v.length}`;
  }
  return "a group of settings";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every value that differs between `a` and `b`, at most `limit` of them. */
export function plainChanges(
  dataset: string,
  part: string,
  a: unknown,
  b: unknown,
  limit = 40,
): Change[] {
  const words = contentWords(dataset, part);
  const out: Change[] = [];
  const name = (path: string[], labels: string[]) => {
    const key = path.at(-1) ?? "";
    return [...labels, words.field(path).label ?? humanize(key)];
  };
  const walk = (x: unknown, y: unknown, path: string[], labels: string[]) => {
    if (out.length >= limit || same(x, y)) {
      return;
    }
    const where = labels.join(" › ");
    const isObj = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
    if (isObj(x) && isObj(y)) {
      const xo = x as Record<string, unknown>;
      const yo = y as Record<string, unknown>;
      for (const k of new Set([...Object.keys(xo), ...Object.keys(yo)])) {
        walk(xo[k], yo[k], [...path, k], name([...path, k], labels));
      }
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      const titles = (arr: unknown[]) => arr.map((e, i) => entryTitle(e, i));
      const xt = titles(x);
      const yt = titles(y);
      // Entries told apart by their names: added, removed, and each kept one compared.
      if (new Set(xt).size === xt.length && new Set(yt).size === yt.length) {
        for (const [i, t] of yt.entries()) {
          if (!xt.includes(t)) {
            out.push({ where, what: `added ${t}` });
          } else {
            walk(x[xt.indexOf(t)], y[i], [...path, "[]"], [...labels, t]);
          }
        }
        for (const t of xt) {
          if (!yt.includes(t)) {
            out.push({ where, what: `removed ${t}` });
          }
        }
        if (
          out.length < limit &&
          xt.join("\n") !== yt.join("\n") &&
          same([...xt].sort(), [...yt].sort())
        ) {
          out.push({ where, what: "put in another order" });
        }
        return;
      }
      out.push({ where, what: `${phrase(x)} → ${phrase(y)}` });
      return;
    }
    if (x === undefined) {
      out.push({ where, what: `set to ${phrase(y)}` });
    } else if (y === undefined) {
      out.push({ where, what: "taken out" });
    } else {
      out.push({ where, what: `${phrase(x)} → ${phrase(y)}` });
    }
  };
  walk(a, b, [], []);
  return out;
}
