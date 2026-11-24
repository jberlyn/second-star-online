/**
 * Pins the art every pack ships (issue #29, stage 0): each sprite's key, size, anchor and pixels,
 * and each sound's bytes, for the engine, the Classic pack and the Minimal pack. Moving the
 * packer, keyer and mirror where the server can run them must not change one pixel of Classic.
 * After a deliberate art change, run `bun packages/data/tests/art-fingerprint.ts --update`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ART_GOLDEN, type ArtPrints, fingerprintBuild } from "./art-fingerprint.ts";

/** What changed between two fingerprints, one line per sprite or sound. */
function changes(want: ArtPrints, got: ArtPrints): string[] {
  const out: string[] = [];
  for (const k of Object.keys(want)) {
    if (!(k in got)) {
      out.push(`missing ${k}`);
    } else if (got[k] !== want[k]) {
      out.push(`changed ${k}`);
    }
  }
  for (const k of Object.keys(got)) {
    if (!(k in want)) {
      out.push(`new ${k}`);
    }
  }
  return out;
}

describe("shipped art (pinned)", () => {
  test("the engine's, Classic's and Minimal's art build exactly as pinned", () => {
    const golden = JSON.parse(readFileSync(ART_GOLDEN, "utf8")) as Record<string, ArtPrints>;
    const built = fingerprintBuild();
    for (const pack of ["engine", "classic", "minimal"] as const) {
      expect({ pack, changes: changes(golden[pack] ?? {}, built[pack]) }).toEqual({
        pack,
        changes: [],
      });
    }
  }, 60_000);
});
