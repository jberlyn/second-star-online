/** The attack key. */
import { z } from "zod";

import { seq } from "./fields.ts";

/**
 * The attack key's hold state, sent on every change: the server polls it each tick as
 * the Tab key. Never damage, power or a target.
 */
export const attackSchema = z.strictObject({ t: z.literal("attack"), seq, held: z.boolean() });
