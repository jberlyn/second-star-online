/** Casting and the spellbook. */
import { z } from "zod";

/**
 * A cast at a stage point: the movie `mouseDown` → the cast handler with the spell cursor armed on
 * the spellbook page. `spell` is the selected spell, empty when the list's selection is an empty
 * line; `x`, `y` are the pointer on the 800×600 stage. The server checks everything else.
 */
export const castSchema = z.strictObject({
  t: z.literal("cast"),
  spell: z.string().max(40),
  x: z.number().int().min(-1000).max(2000),
  y: z.number().int().min(-1000).max(2000),
});

export type SpellsServerMsg =
  /** Your spellbook's lines (the spellbook field), sent at login and on change. */
  { t: "spellbook"; spells: string[] };
