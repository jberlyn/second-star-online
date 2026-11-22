import { expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(import.meta.dir, "content-seam.ts");

/** Runs the importer in a fresh process (no test preload, so no store is installed). */
function importAll(cwd: string, dirs: string[], dom = false) {
  const r = Bun.spawnSync(["bun", SCRIPT, ...(dom ? ["--dom"] : []), ...dirs], { cwd });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("no shared or server module reads the content store when it loads", () => {
  const r = importAll(ROOT, [join(ROOT, "packages/shared/src"), join(ROOT, "packages/server/src")]);
  expect(r.out).toContain("0 failed");
  expect(r.code).toBe(0);
}, 60_000);

test("no client module reads the content store when it loads", () => {
  const client = join(ROOT, "packages/client");
  const r = importAll(client, [join(client, "src")], true);
  expect(r.out).toContain("0 failed");
  expect(r.code).toBe(0);
}, 60_000);
