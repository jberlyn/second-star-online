/** The bag, the equipment boxes and the ground: item intents and the inventory message. */
import { z } from "zod";

import type { InventoryView } from "./core.ts";
import { bagSlot } from "./fields.ts";

/** Use, Equip, Drop or Give on a bag slot (the item menu). */
export const useSchema = z.strictObject({ t: z.literal("use"), slot: bagSlot });

export const equipSchema = z.strictObject({ t: z.literal("equip"), slot: bagSlot });

/** How many of a stack Drop or Give moves; absent means 1. 1.6 always moved one. */
const itemAmount = z.number().int().min(1).max(9999).optional();

export const dropSchema = z.strictObject({ t: z.literal("drop"), slot: bagSlot, n: itemAmount });

export const giveSchema = z.strictObject({ t: z.literal("give"), slot: bagSlot, n: itemAmount });

/** Drag a bag slot onto another: the two lines change places (or the line moves to an empty one). */
export const arrangeSchema = z.strictObject({
  t: z.literal("arrange"),
  from: bagSlot,
  to: bagSlot,
});

/** Cook, Mix, Build or Smith on a bag slot; the server takes the button from the item. */
export const craftSchema = z.strictObject({ t: z.literal("craft"), slot: bagSlot });

/**
 * The crafting window's Make (issue #45): `count` crafts of a recipe of the open recipe station,
 * one after another ("Make X"; All is the most the window offers).
 */
export const recipeMakeSchema = z.strictObject({
  t: z.literal("recipeMake"),
  recipe: z.string().min(1).max(80),
  count: z.number().int().min(1).max(10_000),
});

/** The crafting window's Stop: the running Make X ends after nothing more is made. */
export const recipeStopSchema = z.strictObject({ t: z.literal("recipeStop") });

/** The crafting window closed; a running Make X carries on. */
export const recipeCloseSchema = z.strictObject({ t: z.literal("recipeClose") });

/** The item menu's Storage on a carried container (`StorageButton`). */
export const storageSchema = z.strictObject({ t: z.literal("storage"), slot: bagSlot });

/** Click the × beside an equipment box to take the item off (`rem-*`). */
export const unequipSchema = z.strictObject({
  t: z.literal("unequip"),
  slot: z.enum(["Head", "Body", "LeftHand", "RightHand", "Feet", "Ring"]),
});

/** Click or tap a ground item (`ItemClick`). */
export const pickupSchema = z.strictObject({ t: z.literal("pickup"), id: z.uuid() });

/** The Ctrl key (pick up). */
export const actionSchema = z.strictObject({ t: z.literal("action") });

/**
 * The crystal amount dialog's OK: `n` crystals of the stack in `slot`, dropped on the faced tile or
 * given to the player standing there, by the bag button (`mode`) that opened the dialog.
 */
export const crystalsSchema = z.strictObject({
  t: z.literal("crystals"),
  slot: bagSlot,
  n: z.number().int().min(1).max(9999),
  mode: z.enum(["drop", "give"]),
});

/**
 * The gold dialog's OK (Internal #118 →): `n` gold, given to the player on the faced tile, else
 * dropped. 1..9999 as the client checks; the server checks the balance.
 */
export const goldSchema = z.strictObject({
  t: z.literal("gold"),
  n: z.number().int().min(1).max(9999),
});

/** One recipe line of the crafting window (shared `RecipeRow`). */
export interface RecipeRowView {
  name: string;
  category: string;
  output: { item: string; qty: number };
  skill: string;
  level: number;
  xp: number | null;
  materials: { item: string; qty: number; have: number }[];
  keeps: { item: string; qty: number; have: number }[];
  state: "ready" | "missing" | "tool" | "level" | "unlearned";
  /** What stops it being made now, as a Make would be refused; null when ready. */
  why: string | null;
  affordable: number;
  chance: number;
}

/** The crafting window (issue #45): a recipe station's recipes and the running Make X. */
export interface RecipeWindowView {
  station: string;
  rows: RecipeRowView[];
  /** The running Make X: the recipe and how many are still to make, this one included. */
  run: { recipe: string; left: number } | null;
}

export type InventoryServerMsg =
  | { t: "inv"; inv: InventoryView }
  /** Opens or refreshes the crafting window; null closes it. */
  | { t: "recipes"; view: RecipeWindowView | null };
