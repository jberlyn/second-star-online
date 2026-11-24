/**
 * Where the packs that ship in the release are: built by `bun run data:build` into
 * `packages/data/packs/` and read by the server at start-up, never compiled into the engine.
 * Kept off the package index (the client never reads a pack from disk). A new world is created
 * with one of them (`SSO_CONTENT`): Classic (1.6's content, the default) or Minimal (the blank
 * pack an operator builds their own game from).
 */
export const RELEASE_PACK_DIRS: Readonly<Record<string, string>> = {
  classic: `${import.meta.dir}/../packs/classic`,
  minimal: `${import.meta.dir}/../packs/minimal`,
};
