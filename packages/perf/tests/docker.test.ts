import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { assertDockerSupported, assertScratchDataDir, DEFAULT_PERF_IMAGE } from "../src/docker.ts";
import { parseArgs } from "../src/main.ts";

describe("docker perf flags and staging path guard", () => {
  test("leaves host mode unchanged when neither --docker nor --image is passed", () => {
    const args = parseArgs(["town", "--profile", "lan", "--seconds", "15"]);
    expect(args.what).toBe("town");
    expect(args.profile).toBe("lan");
    expect(args.seconds).toBe(15);
    expect(args.docker).toBeUndefined();
    expect(args.image).toBeUndefined();
  });

  test("parses --docker and --image flags", () => {
    const a = parseArgs(["town", "--docker"]);
    expect(a.docker).toBe(true);
    expect(a.image).toBeUndefined();

    const b = parseArgs(["town", "--image", "custom/sso:test"]);
    expect(b.docker).toBe(true);
    expect(b.image).toBe("custom/sso:test");
    expect(DEFAULT_PERF_IMAGE).toBe("second-star-online:local");
  });

  test("rejects --image without a value", () => {
    expect(() => parseArgs(["town", "--image"])).toThrow(/--image requires/);
    expect(() => parseArgs(["town", "--image", "--docker"])).toThrow(/--image requires/);
  });

  test("accepts only subdirectories inside perf-results and rejects production paths", () => {
    const perfRoot = "/repo/perf-results";
    expect(assertScratchDataDir(join(perfRoot, "run-1/town-home"), perfRoot)).toBe(
      "/repo/perf-results/run-1/town-home",
    );
    expect(() => assertScratchDataDir(perfRoot, perfRoot)).toThrow(/must be inside/);
    expect(() => assertScratchDataDir("/data", perfRoot)).toThrow(/must be inside/);
    expect(() => assertScratchDataDir("/repo/perf-results-other/x", perfRoot)).toThrow(
      /must be inside/,
    );
  });

  test("rejects --docker and --image for unsupported soak and browser commands", () => {
    expect(() => assertDockerSupported("soak", true, undefined)).toThrow(/not supported/);
    expect(() => assertDockerSupported("browser", true, "custom/sso:test")).toThrow(
      /not supported/,
    );
    expect(() => assertDockerSupported("soak", undefined, undefined)).not.toThrow();
    expect(() => assertDockerSupported("town", true, "second-star-online:local")).not.toThrow();
  });
});
