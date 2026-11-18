/**
 * How a player's sprite is built (the original's character renderer). The original paints each
 * frame of a player into a 46×45 scratch member `SP<sprite>-F<n>-<facing>` in the `Chars` cast,
 * copying each layer from the `Characters` (paperdoll) cast at its top-left corner
 * (`copyPixels(src.image, src.rect, src.rect)`), then shows that member with its registration point
 * (25, 6).
 *
 * The render data string is `<headNo>:<Body>:<Head>:<Feet>:<LeftHand>:<RightHand>:<Ring>`. Boots
 * are drawn over the body from the Feet slot (1.6 never drew them; SSO's boot layers are authored
 * art), and with nothing on the feet the authored `Bare Feet` layer covers the shoes every body
 * paints; gloves are worn in the Ring slot. A layer member that does not exist is skipped.
 */
import { itemRulesData } from "@secondstaronline/data";

import type { Equipment } from "../core/fighter.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";
import { ruleMatches } from "../core/patterns.ts";
import type { Facing, WalkFrame } from "../movement/movement.ts";

/** Size and registration point of the composited member (`SP112-F2-S`, Chars #1010). */
export const PAPERDOLL_SIZE = { w: 46, h: 45 } as const;
export const PAPERDOLL_REG = { x: 25, y: 6 } as const;

/** What another client needs to draw a player: the hair number and all six slots. */
export interface Look {
  head: number;
  equip?: Equipment;
}

/** A body frame: the walk frames, or F4, the attack frame. */
export type BodyFrame = WalkFrame | "F4";

/**
 * The attack frame: `F4`, but `F3` when facing south, for the 5 frames of the attack animation
 * (others' sprites the same). The character renderer composes no F4-S.
 */
export function attackFrame(facing: Facing): BodyFrame {
  return facing === "S" ? "F3" : "F4";
}

/** `+N` and one trailing space stripped. */
function strip(name: string): string {
  let n = name.includes("+") ? (name.split("+")[0] ?? "") : name;
  if (n.endsWith(" ")) {
    n = n.slice(0, -1);
  }
  return n;
}

const NOTHING = "NOTHING";

/** Drawn over the body's painted shoes when the Feet slot is empty. */
export const BARE_FEET = "Bare Feet";

/** The layer names after the character renderer's normalisation. */
export function normaliseLook(e: Equipment): {
  weapon: string;
  shield: string;
  gloves: string;
  boots: string;
  helm: string;
  body: string;
  rawBody: string;
} {
  let weapon = strip(e.weapon);
  let helm = strip(e.head);
  let shield = strip(e.offHand);
  let gloves = strip(e.ring);
  let body = strip(e.body);
  // An empty slot (not a name) shows nothing (`gloves = ""`).
  if (gloves === "") {
    gloves = NOTHING;
  }
  // The aliases in the original's order, each rewriting its own layer (`paperdoll.aliases`).
  const layers = { weapon, shield, helm, gloves, body };
  for (const row of itemRulesData.paperdoll.aliases) {
    if (ruleMatches(layers[row.layer], row)) {
      layers[row.layer] = row.becomes;
    }
  }
  ({ weapon, shield, helm, gloves, body } = layers);
  const boots = strip(e.feet) || NOTHING;
  return { weapon, shield, gloves, boots, helm, body, rawBody: e.body };
}

const isNothing = (s: string) => lingoEq(s, NOTHING);

/** A body armour that hides the wearer's name on others' screens (the hide-name flag). */
export function hidesName(e: Equipment): boolean {
  return lingoContains(strip(e.body), "Invis");
}

/** `Characters` member names, bottom to top, for one frame. */
export function paperdollLayers(look: Look, frame: BodyFrame, facing: Facing): string[] {
  const e = look.equip;
  const head = `Head${look.head}`;
  const f = (name: string) => `${name}-${frame}-${facing}`;
  if (!e) {
    return ["BIM", f("DEFBOD"), f(BARE_FEET), f(head)];
  }
  const n = normaliseLook(e);
  const out = ["BIM"];
  const arrows = lingoContains(n.shield, "Arrows");
  // Weapon behind the body: W on every frame, N on the attack frame only.
  if (!isNothing(n.weapon) && (facing === "W" || (facing === "N" && frame === "F4"))) {
    out.push(f(n.weapon));
  }
  if (arrows && (facing === "S" || facing === "W")) {
    out.push(f(n.shield));
  }
  if (isNothing(n.rawBody)) {
    out.push(f("DEFBOD"));
  }
  if (!isNothing(n.body)) {
    out.push(f(n.body));
  }
  out.push(f(isNothing(n.boots) ? BARE_FEET : n.boots));
  if (!isNothing(n.gloves)) {
    out.push(f(n.gloves));
  }
  if (
    facing === "N" &&
    !isNothing(n.shield) &&
    !lingoEq(n.shield, "Arrows") &&
    !lingoEq(n.shield, "Torch")
  ) {
    out.push(f(n.shield));
  }
  const hiding = [
    "Robe of Invisibility",
    "Ninja Outfit",
    "Royal Ninja Uniform",
    "Necromancer's Robe",
  ];
  if (isNothing(n.helm) && !hiding.some((b) => lingoEq(n.body, b))) {
    out.push(f(head));
  }
  const hidingHelm = ["Robe of Invisibility", "Necromancer's Robe"];
  if (!isNothing(n.helm) && !hidingHelm.some((b) => lingoEq(n.body, b))) {
    out.push(f(n.helm));
  }
  if ((facing === "S" || facing === "W") && !isNothing(n.shield) && !lingoEq(n.shield, "Arrows")) {
    out.push(f(n.shield)); // Torch included
  }
  if (arrows && facing === "N") {
    out.push(f(n.shield));
  }
  if (!isNothing(n.weapon) && (facing === "E" || facing === "S")) {
    out.push(f(n.weapon));
  }
  return out;
}
