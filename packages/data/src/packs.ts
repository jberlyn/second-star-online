/**
 * Where the packs that ship in the release are: built by `bun run data:build` into
 * `packages/data/packs/` and read by the server at start-up, never compiled into the engine.
 * Kept off the package index (the client never reads a pack from disk).
 */
export const RELEASE_PACK_DIRS: Readonly<Record<string, string>> = {
  classic: `${import.meta.dir}/../packs/classic`,
};
