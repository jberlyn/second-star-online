/**
 * Schema for a content pack's manifest. A pack is a folder holding `manifest.json`, one JSON file
 * per dataset under `data/` (each validated by that dataset's schema) and its art and sounds (the
 * `art` folder). The Classic pack's data is built from `content/` by `bun run data:build` into
 * `packs/classic/` (its source manifest is `content/pack.json`), and its art from `assets/` by
 * `bun run assets:build` into `packs/classic/art/`.
 */
import { z } from "zod";

/** The pack format this engine reads. Bump it when a pack's layout changes incompatibly. */
export const PACK_FORMAT = 1;

/** A pack id: lower-case letters, digits and dashes. */
export const packIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/** A pack version: `major.minor.patch`. */
export const packVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const packManifestSchema = z.strictObject({
  /** The permanent id (`classic`). The pack owns the keys of the rows it defines. */
  id: packIdSchema,
  /** The name operators see. */
  name: z.string().min(1).max(60),
  /** The pack's own version, bumped only when its content changes. */
  version: packVersionSchema,
  /** The pack format (`PACK_FORMAT`). */
  format: z.literal(PACK_FORMAT),
  /** The Second Star Online release the pack was made for (`1.10`), shown to operators. */
  sso: z.string().regex(/^\d+\.\d+$/),
  /** The SHA-256 (first 16 hex) of the pack's data at this version, so a change needs a bump. */
  contentHash: z.string().regex(/^[0-9a-f]{16}$/),
  /**
   * The folder (inside the pack) holding its art and sounds: atlas sheets, sound files and an
   * `index.json` (`PackArtIndex`). The Classic pack's is built by `bun run assets:build` from
   * `assets/`. Absent: the pack brings no art.
   */
  art: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  /**
   * The file (inside the pack) holding its world seed (`world.ts`): the maps and points a new world
   * created with this pack starts from. Absent: the pack seeds no world (the Classic pack's world
   * is still seeded by the migrations that made it, until #43 moves it here).
   */
  world: z
    .string()
    .regex(/^[a-z0-9-]+\.json$/)
    .optional(),
});

export type PackManifest = z.infer<typeof packManifestSchema>;

/** Compares two pack versions numerically: negative when `a` is older. */
export function comparePackVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}
