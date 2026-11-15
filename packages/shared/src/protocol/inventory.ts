/** The bag, the equipment boxes and the ground: item intents and the inventory message. */
import { z } from "zod";

import type { InventoryView } from "./core.ts";
import { bagSlot } from "./fields.ts";

/** Use, Equip, Drop or Give on a bag slot (the item menu). */
export const useSchema = z.strictObject({ t: z.literal("use"), slot: bagSlot });

export const equipSchema = z.strictObject({ t: z.literal("equip"), slot: bagSlot });

export const dropSchema = z.strictObject({ t: z.literal("drop"), slot: bagSlot });

export const giveSchema = z.strictObject({ t: z.literal("give"), slot: bagSlot });

/** Cook, Mix, Build or Smith on a bag slot; the server takes the button from the item. */
export const craftSchema = z.strictObject({ t: z.literal("craft"), slot: bagSlot });

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
 * The crystal amount dialog's OK: `n` crystals of the stack in `slot`, given to the player on the
 * faced tile, else dropped.
 */
export const crystalsSchema = z.strictObject({
  t: z.literal("crystals"),
  slot: bagSlot,
  n: z.number().int().min(1).max(9999),
});

/**
 * The gold dialog's OK (Internal #118 →): `n` gold, given to the player on the faced tile, else
 * dropped. 1..9999 as the client checks; the server checks the balance.
 */
export const goldSchema = z.strictObject({
  t: z.literal("gold"),
  n: z.number().int().min(1).max(9999),
});

export type InventoryServerMsg = { t: "inv"; inv: InventoryView };
