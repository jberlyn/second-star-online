/**
 * Imports every module of the given source folders with no content store installed, and prints
 * each one that throws. A module that reads `content()` (or a value rebuilt from it) when it
 * loads would keep a copy no publish reaches, and crashes a server that has not loaded its packs
 * yet. Entry points and command-line tools are left out: they install the store first.
 *
 * Run: `bun tests/content-seam.ts <dir>...` (with `--dom` to load a happy-dom window first).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("--dom")) {
  // Resolved from the working folder: only the client package depends on happy-dom.
  const { GlobalRegistrator } = await import(
    Bun.resolveSync("@happy-dom/global-registrator", process.cwd())
  );
  GlobalRegistrator.register();
}
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      files.push(full);
    }
  }
};
for (const dir of args.filter((a) => !a.startsWith("--"))) {
  walk(dir);
}
let failed = 0;
for (const f of files) {
  if (/(^|\/)(main|content-classic)\.ts$|\/cli\//.test(f)) {
    continue;
  }
  try {
    await import(f);
  } catch (e) {
    failed++;
    console.log(`${f}: ${String(e).split("\n")[0]}`);
  }
}
console.log(`imported ${files.length} modules, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
