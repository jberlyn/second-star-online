/**
 * assets/original-sidecars.json: the corrections SSO makes to original art, the same fields an
 * added sidecar carries (schema/original-sidecars.ts). Both builds read it through here.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type OriginalSidecar, originalSidecarsSchema } from "../../schema/original-sidecars.ts";
import { checkMirroredFlags } from "../../src/art/mirror.ts";

export const ORIGINAL_SIDECARS_PATH = "assets/original-sidecars.json";

/** The key of an original member's entry: `<cast>/<member name>` (`Chars/31-F1-N`). */
export const originalSidecarKey = (cast: string, name: string): string => `${cast}/${name}`;

/**
 * Every entry, by key. Throws naming the file when it is missing or has a bad entry: a build
 * without it would silently leave original art uncorrected (the Docker image once did).
 */
export function readOriginalSidecars(repoRoot: string): Map<string, OriginalSidecar> {
  const path = join(repoRoot, ORIGINAL_SIDECARS_PATH);
  if (!existsSync(path)) {
    throw new Error(`${ORIGINAL_SIDECARS_PATH} is missing; the asset and data builds need it`);
  }
  try {
    return new Map(
      Object.entries(originalSidecarsSchema.parse(JSON.parse(readFileSync(path, "utf8")))),
    );
  } catch (e) {
    throw new Error(`${ORIGINAL_SIDECARS_PATH}: ${(e as Error).message}`);
  }
}

/** An original member built into an atlas. */
export interface AtlasMember {
  group: string;
  cast: string;
  name: string;
}

/**
 * Checks original sidecars against the members built into the atlases, as added sidecars are
 * checked: every entry names a built member, and the `mirrored` flags pass `checkMirroredFlags`.
 * Throws naming the entry.
 */
export function checkOriginalSidecars(
  members: readonly AtlasMember[],
  sides: ReadonlyMap<string, OriginalSidecar>,
): void {
  const unused = new Set(sides.keys());
  checkMirroredFlags(
    members.map(({ group, cast, name }) => {
      const key = originalSidecarKey(cast, name);
      unused.delete(key);
      return {
        group,
        name,
        mirrored: sides.get(key)?.mirrored === true,
        file: `${ORIGINAL_SIDECARS_PATH} (${key})`,
      };
    }),
  );
  for (const key of unused) {
    throw new Error(
      `${ORIGINAL_SIDECARS_PATH}: ${key} is not an original member built into an atlas`,
    );
  }
}
