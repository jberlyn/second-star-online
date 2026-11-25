/** Plain words for the `tiles` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

export const tilesWords: WordBook = {
  walkable: {
    label: "Tiles you can walk on",
    help: "Every other tile blocks walkers.",
    noun: "tile",
  },
  "walkable.[].code": { label: "Tile code", help: "The tile's two-letter code." },
  catalogue: { label: "Tiles", noun: "tile" },
  "catalogue.[].code": { label: "Tile code", help: "The code the maps use for this tile." },
  "catalogue.[].name": {
    label: "Name shown on hover",
    help: "What the hover tip calls this tile (a tree, a rock, a crop); leave it off to name nothing.",
  },
  "catalogue.[].member": {
    label: "Original picture number",
    help: "Where 1.6 kept this tile's picture; added tiles have none.",
    more: true,
  },
  "catalogue.[].flags": {
    label: "Special meanings",
    help: "What the game does with this tile.",
    noun: "meaning",
  },
  "catalogue.[].flags.[]": {
    label: "Meaning",
    choices: {
      sea: "Deep sea (sea creatures live here)",
      airshipBlock: "Blocks airships",
      dock: "Airship landing pad",
      arena: "Arena challenge tile",
      grave: "Grave (for Raise Dead)",
    },
  },
  defaults: { label: "Default tiles" },
  "defaults.ground": { label: "Ground", help: "The ground a new, blank map is filled with." },
  "defaults.empty": {
    label: "Empty",
    help: "The empty tile of a blank map's upper layers; also what a demolished house leaves.",
  },
  "defaults.shadow": { label: "Shadow", help: "The shadow layer's tile on a blank map." },
  "defaults.editorTile": {
    label: "World Editor's first tile",
    help: "The tile picked when the World Editor opens.",
  },
};
