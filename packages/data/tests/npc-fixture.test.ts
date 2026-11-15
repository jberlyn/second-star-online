import { expect, test } from "bun:test";

import { z } from "zod";

import fixture from "../test-fixtures/npc-expectations.json";

const strings = z.array(z.string());
const schema = z.strictObject({
  npcs: z
    .array(
      z.strictObject({
        name: z.string(),
        bio: strings,
        profile: strings,
        chatter: strings,
        sells: z.array(
          z.strictObject({
            item: z.string(),
            line: z.number(),
            price: z.number(),
            stock: z.number(),
          }),
        ),
        buys: z.array(z.strictObject({ item: z.string(), line: z.number(), price: z.number() })),
        gold: z.number().nullable(),
        banker: z.boolean(),
      }),
    )
    .length(120),
  lootTables: z
    .array(
      z.strictObject({
        npc: z.string(),
        lines: z.array(z.strictObject({ item: z.string(), oneIn: z.number() })),
      }),
    )
    .length(35),
  monsterParses: z
    .array(
      z.strictObject({ name: z.string(), flags: strings, spells: strings, npcData: z.boolean() }),
    )
    .length(104),
});

test("NPC expectations have the complete expected shape", () => {
  expect(schema.safeParse(fixture).success).toBe(true);
  const malformed = structuredClone(fixture);
  malformed.lootTables[0]!.lines[0]!.oneIn = "wrong" as unknown as number;
  expect(schema.safeParse(malformed).success).toBe(false);
  expect(schema.safeParse({ ...fixture, unexpected: true }).success).toBe(false);
});
