/**
 * Equip and use. The client-side gates of the original run on the server here, in the original
 * order with case-insensitive substring or exact matching; the ordered tables' quirks are kept.
 */
import { type EquipSlot, itemRulesData } from "@secondstaronline/data";

import type { Equipment } from "../core/fighter.ts";
import { lingoContains, lingoEq, type Rng } from "../core/lingo.ts";
import { anyMatch, lastMatch, ruleMatches } from "../core/patterns.ts";
import { EQUIP_FIELD } from "./inventory.ts";

const R = itemRulesData;

/** The strength requirement: 0 unless a rule matches, last match wins. */
export function strengthRequirement(name: string): number {
  return lastMatch(R.equip.strength, name)?.strength ?? 0;
}

/** The equip type: "No" unless a rule matches, last match wins. */
export function equipSlotFor(name: string): EquipSlot | "No" {
  return lastMatch(R.equip.slots, name)?.slot ?? "No";
}

/** The button the item menu shows in place of Equip (last wins). */
export type MenuAction = "Equip" | "Cook" | "Mix" | "Build" | "Smith" | "Storage";

export function menuAction(name: string): MenuAction {
  return lastMatch(R.menu, name)?.action ?? "Equip";
}

// The data's choices are exactly the buttons (a mismatch is a type error).
R.menu satisfies readonly { action: Exclude<MenuAction, "Equip"> }[];

export const EQUIP_TEXT = {
  weak: "You are not strong enough to equip this!",
  twoHandedHeld:
    "You are currently equipped with a 2-handed weapon, you must remove it first in order to equip this.",
  shieldHeld: "This is a 2-handed weapon, you cannot have a shield equipped to wield this.",
  /** No full stop: 1.6 left it off. */
  cannot: (name: string) => `You cannot equip the ${name}`,
  vile: "You are not vile enough to equip this!",
  /** The server's refusal for an occupied slot. */
  occupied: "You have to remove the current item you're wearing to equip this!",
  /** `flinv`. */
  full: "You are carrying too much to unequip this!",
  /** remEQ when the slot no longer holds it. */
  already: "You've already unequipped this!.",
} as const;

export type EquipCheck = { ok: true; slot: EquipSlot } | { ok: false; text: string };

/** The client's equip gates in order, then the server's occupied-slot refusal. */
export function checkEquip(
  name: string,
  who: { str: number; wanted: boolean; equip: Equipment },
): EquipCheck {
  if (who.str < strengthRequirement(name)) {
    return { ok: false, text: EQUIP_TEXT.weak };
  }
  const slot = equipSlotFor(name);
  const twoHanded = R.equip.twoHanded.some((r) => ruleMatches(name, r));
  if (slot === "RightHand" && R.equip.twoHanded.some((r) => ruleMatches(who.equip.weapon, r))) {
    return { ok: false, text: EQUIP_TEXT.twoHandedHeld };
  }
  if (twoHanded && !lingoEq(who.equip.offHand, "NOTHING")) {
    return { ok: false, text: EQUIP_TEXT.shieldHeld };
  }
  if (slot === "No") {
    return { ok: false, text: EQUIP_TEXT.cannot(name) };
  }
  if (!who.wanted && ruleMatches(name, R.equip.murder)) {
    return { ok: false, text: EQUIP_TEXT.vile };
  }
  if (!lingoEq(who.equip[EQUIP_FIELD[slot]], "NOTHING")) {
    return { ok: false, text: EQUIP_TEXT.occupied };
  }
  return { ok: true, slot };
}

// ---- use ---------------------------------------------------------------------------------

export const USE_TEXT = {
  cannot: (name: string) => `You cannot use the ${name}.`,
  stuffed: "You're stuffed!",
  argon: "The power of argon flows through your body.",
  argonEnds: "You no longer feel the power of Argon helping you in battle.",
  piano: "You can't use this.",
} as const;

/**
 * Items whose use does nothing and says nothing. Books are read by the spell-learning system. The
 * Ocarina stays for good: its use calls the empty music reset and nothing else, and the composer is
 * unreachable, so no music plays in 1.6 (kept bug). The names are `use.silent` in
 * content/item-rules.json. "Map" stays in it: no item has "Map" in its name, so the Use text
 * ("You open up the map and read it...") can never show and nothing is built for it.
 */
export function useDeferred(name: string): boolean {
  return anyMatch(R.use.silent, name);
}

export interface UseOutcome {
  /** One unit is consumed (the item removal). */
  consume: boolean;
  /** Chat lines, in order. */
  lines: string[];
  hp: number;
  sp: number;
  hunger: number;
  /** Purple Potion: the attack bonus flag set, the attack counter up 400. */
  argon: boolean;
}

/**
 * The use handler from the whitelist on, for one item. `v` is HP/SP/Hunger and their caps; the
 * result is the new values. Every `random` of the effect rows is drawn in source order, and only
 * while Hunger < 35000.
 */
export function useItem(
  name: string,
  v: { hp: number; hpMax: number; sp: number; spMax: number; hunger: number },
  rng: Rng,
): UseOutcome {
  const out: UseOutcome = {
    consume: false,
    lines: [],
    hp: v.hp,
    sp: v.sp,
    hunger: v.hunger,
    argon: false,
  };
  if (!R.use.usable.some((r) => ruleMatches(name, r))) {
    out.lines.push(USE_TEXT.cannot(name.includes("#") ? name.slice(0, name.indexOf("#")) : name));
    return out;
  }
  const effects = R.use.effects.filter((r) => ruleMatches(name, r));
  // HP and SP rows, then the hunger rows; both behind the guard.
  if (out.hunger < 35000) {
    for (const r of effects.filter((e) => e.stat !== "Hunger")) {
      const add = r.flat + (r.randomN ? rng.random(r.randomN) : 0);
      if (r.stat === "HP") {
        out.hp += add;
      } else {
        out.sp += add;
      }
    }
  }
  if (out.hunger < 35000) {
    for (const r of effects.filter((e) => e.stat === "Hunger")) {
      out.hunger += r.flat + (r.randomN ? rng.random(r.randomN) : 0);
    }
  }
  out.hp = Math.min(out.hp, v.hpMax);
  out.sp = Math.min(out.sp, v.spMax);
  // The eat/drink line, last match wins; a potion's is "You drink the <name>."
  const msg = lastMatch(
    R.use.messages.filter((m) => !lingoContains(m.pattern, "Book")),
    name,
  );
  let text = msg ? msg.text.replace('" & SelInventory & "', name) : null;
  if (lingoEq(name, "Purple Potion")) {
    // Outside the hunger guard; the Argon line is printed twice, as 1.6 did (kept bug).
    out.argon = true;
    out.lines.push(USE_TEXT.argon);
    text = USE_TEXT.argon;
  }
  if (text !== null) {
    out.lines.push(text);
    if (out.hunger > 34999) {
      out.lines.push(USE_TEXT.stuffed);
    }
  }
  out.consume = true;
  return out;
}
