/** Plain words for the `items` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

export const itemsWords: WordBook = {
  fixtures: {
    label: "Map fixtures",
    help: "Things placed on the map that are not bag items: the vault, chests, signs, doors.",
    noun: "fixture",
  },
  "fixtures.[]": { label: "Fixture" },
  editorItems: {
    label: "World page item list",
    help: "The items the World page offers to place on a map, in this order.",
    noun: "item",
    names: "item",
  },
  "editorItems.[]": { label: "Item", names: "item" },
  playerShopWhitelist: {
    label: "Items player shops accept",
    help: "Only these items can be put up for sale in a player's shop.",
    noun: "item",
    names: "item",
  },
  "playerShopWhitelist.[]": { label: "Item", names: "item" },
};
