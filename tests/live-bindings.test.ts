import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/**
 * `bun run dev` bundles each `export * from` as an object spread, which copies a module's values
 * once, when the barrel loads. A binding a module fills later (a live `let`, set by `onContent`)
 * then stays `undefined` for everything importing through that barrel; the production build keeps
 * it live. A named re-export becomes a getter in both, and wins over the spread only when it comes
 * after it, so every barrel names each live binding its `export *` lines bring in, after them, from
 * the module that declares it or from a barrel that itself names it. This holds along a chain of
 * barrels (`shared/src/index.ts` → `protocol/index.ts` → a module).
 */
const ROOTS = ["packages/shared/src", "packages/client/src", "packages/data/src"];

interface Source {
  lines: string[];
  /** `export * from` targets, with their line. */
  stars: { file: string; line: number }[];
  /** Named re-exports: exported name → the module named and the line. */
  named: Map<string, { file: string; line: number }>;
  /** Live bindings this module declares and exports: exported name. */
  live: Set<string>;
}

/** Splits `a: Map<string, number> = x, b` on its top-level commas. */
function topLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if ("<([{".includes(ch)) {
      depth += 1;
    } else if (">)]}".includes(ch)) {
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** The names in an `export { a, b as c }` list: `[local, exported]` pairs. */
function exportList(list: string): [string, string][] {
  return list
    .split(",")
    .map((p) => p.trim().replace(/^type\s+/, ""))
    .filter((p) => p !== "")
    .map((p) => {
      const [local, exported] = p.split(/\s+as\s+/);
      return [local ?? "", exported ?? local ?? ""];
    });
}

function parse(file: string, read: (f: string) => string): Source {
  const text = read(file);
  const lines = text.split("\n");
  const src: Source = { lines, stars: [], named: new Map(), live: new Set() };
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const at = (spec: string) => resolve(dirname(file), spec);
  for (const m of text.matchAll(/^export \* from "(\.[^"]+)";/gm)) {
    src.stars.push({ file: at(m[1] ?? ""), line: lineOf(m.index ?? 0) });
  }
  for (const m of text.matchAll(/^export (?:type )?\{([^}]*)\} from "(\.[^"]+)";/gm)) {
    for (const [, exported] of exportList(m[1] ?? "")) {
      src.named.set(exported, { file: at(m[2] ?? ""), line: lineOf(m.index ?? 0) });
    }
  }
  // `export let a, b = 1;` (up to the statement's end).
  for (const m of text.matchAll(/^export let ([^;]+?)(?:;|\n\n|$)/gms)) {
    for (const piece of topLevel(m[1] ?? "")) {
      const name = /^\s*(\w+)/.exec(piece)?.[1];
      if (name) {
        src.live.add(name);
      }
    }
  }
  // `let X; … export { X }` (or `export { X as Y }`) with no `from`.
  const locals = new Set<string>();
  for (const m of text.matchAll(/^let ([^;]+?)(?:;|\n\n|$)/gms)) {
    for (const piece of topLevel(m[1] ?? "")) {
      const name = /^\s*(\w+)/.exec(piece)?.[1];
      if (name) {
        locals.add(name);
      }
    }
  }
  for (const m of text.matchAll(/^export \{([^}]*)\};/gm)) {
    for (const [local, exported] of exportList(m[1] ?? "")) {
      if (locals.has(local)) {
        src.live.add(exported);
      }
    }
  }
  return src;
}

/**
 * Every live binding a barrel's `export *` brings in without a named re-export after it that
 * keeps it live, as `<barrel>: <name>` lines, for every barrel among `files`.
 */
export function liveBindingGaps(
  files: readonly string[],
  read: (f: string) => string = (f) => readFileSync(f, "utf8"),
  base = process.cwd(),
): string[] {
  const cache = new Map<string, Source>();
  const get = (f: string) => {
    let s = cache.get(f);
    if (!s) {
      s = parse(f, read);
      cache.set(f, s);
    }
    return s;
  };
  /** The live names a module exports (its own and through its stars), with the declaring file. */
  const liveOf = (f: string, seen = new Set<string>()): Map<string, string> => {
    const out = new Map<string, string>();
    if (seen.has(f)) {
      return out;
    }
    seen.add(f);
    const s = get(f);
    for (const n of s.live) {
      out.set(n, f);
    }
    for (const star of s.stars) {
      for (const [n, decl] of liveOf(star.file, seen)) {
        if (!out.has(n)) {
          out.set(n, decl);
        }
      }
    }
    return out;
  };
  /** Whether `f` exports `name` live by a getter: it declares it, or names it from one that does. */
  const keepsLive = (f: string, name: string, decl: string, seen = new Set<string>()): boolean => {
    if (f === decl) {
      return true;
    }
    if (seen.has(f)) {
      return false;
    }
    seen.add(f);
    const n = get(f).named.get(name);
    return n !== undefined && keepsLive(n.file, name, decl, seen);
  };
  const gaps: string[] = [];
  for (const f of files) {
    const s = get(f);
    if (s.stars.length === 0) {
      continue;
    }
    for (const star of s.stars) {
      for (const [name, decl] of liveOf(star.file)) {
        const n = s.named.get(name);
        const where = `${relative(base, f)}: ${name}`;
        if (!n) {
          gaps.push(`${where} (not named)`);
        } else if (n.line < star.line) {
          gaps.push(`${where} (named before the export * that brings it in)`);
        } else if (!keepsLive(n.file, name, decl)) {
          gaps.push(`${where} (named from a module that does not keep it live)`);
        }
      }
    }
  }
  return [...new Set(gaps)].sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      return sourceFiles(p);
    }
    return /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") ? [resolve(p)] : [];
  });
}

test("every barrel names each live binding it brings in, so `bun run dev` keeps it live", () => {
  expect(liveBindingGaps(ROOTS.flatMap(sourceFiles))).toEqual([]);
});

describe("the guard itself", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });
  /** Writes `files` into a temp dir and returns the gaps found in it. */
  const gaps = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "sso-live-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return liveBindingGaps(
      Object.keys(files).map((f) => resolve(dir, f)),
      undefined,
      dir,
    );
  };

  test("finds `export let`, `export let a, b` and `let X; export { X }`", () => {
    expect(
      gaps({
        "index.ts": 'export * from "./a.ts";\nexport * from "./b.ts";\n',
        "a.ts": "export let A: Map<string, number>, B = 1;\nexport const C = 1;\n",
        "b.ts": "let D: number;\nlet E = 2;\nexport { D, E as F };\n",
      }),
    ).toEqual([
      "index.ts: A (not named)",
      "index.ts: B (not named)",
      "index.ts: D (not named)",
      "index.ts: F (not named)",
    ]);
  });

  test("a name before its export * is a gap; after it, from the declaring module, is not", () => {
    expect(
      gaps({
        "index.ts": 'export { A } from "./a.ts";\nexport * from "./a.ts";\n',
        "a.ts": "export let A = 1;\n",
      }),
    ).toEqual(["index.ts: A (named before the export * that brings it in)"]);
    expect(
      gaps({
        "index.ts": 'export * from "./a.ts";\nexport { A } from "./a.ts";\n',
        "a.ts": "export let A = 1;\n",
      }),
    ).toEqual([]);
  });

  test("a chain of barrels: each one names it, from a module that keeps it live", () => {
    const files = {
      "index.ts": 'export * from "./p/index.ts";\nexport { A } from "./p/index.ts";\n',
      "p/index.ts": 'export * from "./a.ts";\n',
      "p/a.ts": "export let A = 1;\n",
    };
    // The inner barrel spreads it: naming it from there is no getter.
    expect(gaps(files)).toEqual([
      "index.ts: A (named from a module that does not keep it live)",
      "p/index.ts: A (not named)",
    ]);
    expect(
      gaps({ ...files, "p/index.ts": 'export * from "./a.ts";\nexport { A } from "./a.ts";\n' }),
    ).toEqual([]);
  });
});
