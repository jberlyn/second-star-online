/** Schema for the editable item catalogue. */
import { z } from "zod";

const strings = z.array(z.string());

/**
 * One catalogue entry. The game reads the name, the archived spellings (`variants`) and whether
 * there is an icon. What 1.6's scripts decide about an item (equip slot, power, price, loot,
 * item code) is not on the record: it is in item-rules.json, attpower.json and the other rule
 * tables, which match items by name,.
 */
export const itemSchema = z.strictObject({
  /**
   * The item's permanent key: the name it was created with (the 1.6 name for Classic). Stored
   * data, map files, NPC files and rule tables refer to it, so it never changes.
   */
  name: z.string().min(1),
  /** The name players see, when an operator has renamed the item; the key otherwise. */
  display: z.string().min(1).max(40).optional(),
  /** The Inventory and paperdoll art to draw, when it differs from the key. */
  sprite: z.string().min(1).optional(),
  /** Other spellings of the name seen in the archive. */
  variants: strings.optional(),
  /**
   * The picture: an original Inventory cast member, `"added"` for art in
   * `assets/added/items/<name>.png` (a data test checks the file and its sidecar exist), or
   * `null` for an item with none. Nothing reads more than `icon !== null`: an item with a
   * picture is one `/drop` accepts and a book can be read.
   */
  icon: z
    .union([
      z.strictObject({ member: z.number().int(), castLib: z.number().int(), asset: z.string() }),
      z.literal("added"),
    ])
    .nullable(),
});

/** The part of items.json that `data:build` emits. */
export const itemsDataSchema = z.strictObject({
  items: z.array(itemSchema),
  /**
   * Inventory cast members that are ground fixtures or world objects, not bag items (the
   * Vault, chests, signs, doors…; the excluded cast members). 1.6's `/drop` accepted
   * any member of the Inventory cast by name,
   * so operators place these with `/drop` until the world editor.
   */
  fixtures: strings,
  /**
   * The items a player shop's `set` accepts, in the client's order (comparison ignores case).
   * 204 lines, Trout twice; the singular crystals match no bag item.
   */
  playerShopWhitelist: strings,
  /**
   * The World Editor's ITEM list after "Delete" (field `ITEM`), in
   * order. The editor places these by name.
   */
  editorItems: strings,
});

export type Item = z.infer<typeof itemSchema>;
export type ItemsData = z.infer<typeof itemsDataSchema>;
