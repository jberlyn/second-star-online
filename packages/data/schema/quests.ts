import { z } from "zod";

/**
 * The quest lines and replacement-quest pools in `packages/data/content/quests.json`: the archive's `Quests.txt` seeds the `quests` table; a roll with no NPC (29) is null.
 *
 */
export const questDataSchema = z.strictObject({
  current: z.array(z.strictObject({ npc: z.string(), wants: z.string(), reward: z.string() })),
  pools: z.strictObject({
    npcs: z.array(z.strictObject({ roll: z.number().int(), npc: z.string().nullable() })),
    wanted: z.array(z.strictObject({ roll: z.number().int(), item: z.string() })),
    rewards: z.array(z.strictObject({ roll: z.number().int(), item: z.string() })),
  }),
});

export type QuestData = z.infer<typeof questDataSchema>;
