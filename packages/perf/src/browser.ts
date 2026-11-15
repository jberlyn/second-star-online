/**
 * `bun run perf browser`: the browser's frame time on a crowded
 * screen. Starts `town` (40 walkers on one map) plus one staged character, then runs
 * `browser/frames.cjs` inside the pinned Playwright MCP Docker image, which logs in as that
 * character, throttles the CPU 4x through CDP (the usual stand-in for a low-end laptop) and
 * records `requestAnimationFrame` intervals. No new package: the image ships Playwright.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { runScenario } from "./main.ts";
import { town } from "./scenarios.ts";

/** The image the by-hand browser checks already use (tools/browser/playwright-mcp.sh). */
export const IMAGE = "mcr.microsoft.com/playwright/mcp:v0.0.83";
const VIEWER = "Viewerabc";

export async function runBrowser(dir: string, seed: number): Promise<void> {
  const scenario = town();
  scenario.rampSeconds = 30;
  const outDir = join(dir, "browser");
  let output = "";
  await runScenario({
    scenario,
    profile: "home",
    seed,
    dir: outDir,
    extra: [{ name: VIEWER, role: "walker", map: scenario.maps[0] ?? "x1000y992", x: 8, y: 5 }],
    during: async ({ serverPort }) => {
      const script = resolve(import.meta.dir, "..", "browser");
      const proc = Bun.spawn(
        [
          "docker",
          "run",
          "--rm",
          "--network=host",
          "-v",
          `${script}:/perf:ro`,
          "-v",
          `${outDir}:/out`,
          "-e",
          "NODE_PATH=/app/node_modules",
          "--entrypoint",
          "node",
          IMAGE,
          "/perf/frames.cjs",
          `http://127.0.0.1:${serverPort}/`,
          VIEWER,
          "secret",
          "30",
          "4",
        ],
        { stdout: "pipe", stderr: "inherit" },
      );
      output = await new Response(proc.stdout).text();
      await proc.exited;
    },
  });
  writeFileSync(join(dir, "browser.json"), output);
  console.log(output);
}
