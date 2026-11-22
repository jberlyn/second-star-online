/**
 * Import rules. Biome has no boundary rule, so this scans the
 * import statements of every source file.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface SourceFile {
  /** Repo-relative, forward slashes. */
  path: string;
  text: string;
}

export interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

export interface Violation {
  path: string;
  specifier: string;
  rule: string;
}

const IMPORT_RE =
  /(?:^|[\s;])(import|export)\s+(type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function importsOf(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of code.matchAll(IMPORT_RE)) {
    const specifier = m[3] ?? m[4];
    if (specifier) {
      refs.push({ specifier, typeOnly: Boolean(m[2]) });
    }
  }
  return refs;
}

/** Resolves a relative specifier against the importing file; bare specifiers pass through. */
function target(from: string, specifier: string): string {
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  const parts = from.split("/").slice(0, -1);
  for (const seg of specifier.split("/")) {
    if (seg === "..") {
      parts.pop();
    } else if (seg !== ".") {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

const SOCKET_RE = /\bBun\.serve\s*\(|\bServerWebSocket\b|\bnew\s+WebSocket\s*\(/;

export function checkImports(files: readonly SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    const p = file.path;
    const isTest = /\/(tests|e2e)\//.test(p);
    for (const ref of importsOf(file.text)) {
      const t = target(p, ref.specifier);
      const bad = (rule: string) => out.push({ path: p, specifier: ref.specifier, rule });

      // data imports no code at runtime; its src may type-import its own build-time schemas, and
      // the Classic fixture reads the built pack's JSON.
      if (p.startsWith("packages/data/src/")) {
        const own = t.startsWith("packages/data/src/");
        const schemaType = ref.typeOnly && t.startsWith("packages/data/schema/");
        const packJson = t.startsWith("packages/data/packs/") && t.endsWith(".json");
        if (!own && !schemaType && !packJson) {
          bad(
            "data/src imports nothing (type-only from data/schema, and the packs' JSON, allowed)",
          );
        }
      }
      // shared imports only data's types and zod: content reaches it through the content store.
      if (p.startsWith("packages/shared/src/")) {
        const ok =
          t.startsWith("packages/shared/src/") ||
          (t === "@secondstaronline/data" && ref.typeOnly) ||
          t === "zod";
        if (!ok) {
          bad("shared imports only @secondstaronline/data types and zod");
        }
      }
      // The client bundles no content: it fetches the server's store. From data it takes the types,
      // the asset index and the panel's tab geometry (the package index, which exports no
      // dataset), never a pack, the Classic fixture or the schemas.
      if (p.startsWith("packages/client/src/") && t.startsWith("@secondstaronline/data/")) {
        bad("client imports only the @secondstaronline/data index");
      }
      // The Classic fixture is for tests and tools: the server loads packs from their folders.
      if (
        t === "@secondstaronline/data/classic" &&
        !isTest &&
        !p.startsWith("packages/server/src/cli/") &&
        !p.startsWith("packages/data/")
      ) {
        bad("only tests and command-line tools import the Classic fixture");
      }
      // Test fixtures must never become production dependencies.
      if (
        !isTest &&
        (t.startsWith("@secondstaronline/data/test-fixtures/") ||
          t.startsWith("packages/data/test-fixtures/"))
      ) {
        bad("test fixtures are only imported by tests");
      }
      // client never imports server.
      if (p.startsWith("packages/client/")) {
        if (t.startsWith("@secondstaronline/server") || t.startsWith("packages/server/")) {
          bad("client never imports server");
        }
      }
      // nothing imports the load rig: it depends on the packages, not the reverse.
      if (
        (t === "@secondstaronline/perf" ||
          t.startsWith("@secondstaronline/perf/") ||
          t.startsWith("packages/perf/")) &&
        !p.startsWith("packages/perf/")
      ) {
        bad("nothing imports @secondstaronline/perf");
      }
      // only server/persistence imports bun:sqlite (tests may, to build a Db).
      if (t === "bun:sqlite" && !p.startsWith("packages/server/src/persistence/") && !isTest) {
        bad("only server/src/persistence imports bun:sqlite");
      }
      // systems get gateway and persistence as arguments.
      if (p.startsWith("packages/server/src/systems/")) {
        if (/^packages\/server\/src\/(gateway|persistence)(\/|$)/.test(t)) {
          bad("systems never import gateway/ or persistence/ (they are passed in)");
        }
      }
    }
    // only server/gateway touches sockets.
    if (
      p.startsWith("packages/server/src/") &&
      !p.startsWith("packages/server/src/gateway/") &&
      SOCKET_RE.test(file.text)
    ) {
      out.push({
        path: p,
        specifier: "(socket API)",
        rule: "only server/src/gateway touches sockets",
      });
    }
  }
  return out;
}

/** Every .ts/.tsx file under packages/, skipping node_modules, build output and generated data. */
export function readSources(repoRoot: string): SourceFile[] {
  const files: SourceFile[] = [];
  const skip = new Set(["node_modules", ".tsbuild", "generated", "assets", "dist"]);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) {
        continue;
      }
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(name)) {
        files.push({
          path: relative(repoRoot, full).split(sep).join("/"),
          text: readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(join(repoRoot, "packages"));
  return files;
}
