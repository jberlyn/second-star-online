/** Public source hygiene: catch development references and removed annotation plumbing. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface Source {
  path: string;
  text: string;
}
export interface Finding {
  path: string;
  rule: string;
}
const patterns: [string, RegExp][] = [
  ["script citation", /\.ls:\d+/i],
  // PotionMix is a sound name and NoTex occurs inside a colon-delimited map record.
  [
    "handler citation",
    /\b(?:[A-Za-z][A-Za-z_]*:\d+-\d+|(?<![:|])(?!(?:PotionMix)\b)[A-Z][a-z]+[A-Z][A-Za-z_]*:\d+)\b/,
  ],
  ["spec citation", /\b[a-z][a-z-]*\.md\s+§\s*\d/i],
  ["research reference", /\b(?:research record|sound research)\b/i],
  [
    "source fragment",
    /`[^`\r\n]*(?:\brepeat\s+with\b|\bthe\s+itemdelimiter\b|\bdelete\s+word\b|\bgo\(the frame\)|\bsprite\(\d+\)\.(?:locZ|visible)|\bif\s+[^`\r\n]+\s+then\s+exit\b|\b(?:myName|Leader)\s*=|\bfield\s+Guild\b|\bmember\(["']|\binteger\(item\b|\bword\s+\d+\s*=)[^`\r\n]*`/i,
  ],
  ["source substring expression", /`contains\s+"[^"`]+"`/i],
  ["private source path", /(?:^|[^\w])(?:archive|decompiled)\//i],
  ["private research path", /(?:docs\/)?research\//i],
  [
    "historical UI annotation",
    /\b(?:score|member|field|region|movie):(?:main|Checkers|IMsend|IMwin\d+):/i,
  ],
  ["retired annotation", /\bdata-orig\b|dataset\.orig\b/],
  ["removed provenance import", /@secondstaronline\/data\/prov\b|\.prov\.ts\b/],
  [
    "slice or plan ID",
    /\b(?:REL-\d+[a-z]?|slice\s+\d+[a-z]?(?:\.\d+[a-z]?)?|[0-9]+[a-z]\.[0-9]+|sso-[0-9]+[a-z]-)\b/i,
  ],
  [
    "stale uppercase doc reference",
    /\b(?:BUG_LEDGER|DIVERGENCES|PERFORMANCE|SSO_ARCHITECTURE_SPEC|IMPLEMENTATION_PLAN)(?:\.md)?\b/,
  ],
  ["private workflow path", /(?:^|[^\w])(?:agent\/|docs\/workflow\/)/],
];
export function checkSources(files: readonly Source[]): Finding[] {
  return files.flatMap(({ path, text }) =>
    [
      ...patterns,
      ...(path.endsWith(".css")
        ? [["cast citation", /\bInternal #\d+\b/] as [string, RegExp]]
        : []),
    ]
      .filter(([, pattern]) => pattern.test(text))
      .map(([rule]) => ({ path, rule })),
  );
}
export function readSources(root: string): Source[] {
  const out: Source[] = [];
  const skip = new Set(["node_modules", ".tsbuild", "dist", ".git"]);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) {
        continue;
      }
      const full = join(dir, entry);
      const path = relative(root, full).split(sep).join("/");
      if (statSync(full).isDirectory()) {
        if (path !== "packages/data/assets") {
          walk(full);
        }
      } else if (
        /\.(?:ts|tsx|json|jsonl|md|css|sql)$/.test(entry) &&
        path !== "tests/no-citations.ts" &&
        path !== "tests/no-citations.test.ts"
      ) {
        out.push({ path, text: readFileSync(full, "utf8") });
      }
    }
  };
  for (const dir of ["packages", "tests", "docs", "tools", "assets"]) {
    walk(join(root, dir));
  }
  for (const path of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    out.push({ path, text: readFileSync(join(root, path), "utf8") });
  }
  return out;
}
