/** Pins for schema bounds in docs/differences-from-fso.md that no other test covered. */
import { describe, expect, test } from "bun:test";

import { inGameSchema } from "../src/protocol/messages.ts";

const ok = (m: unknown) => inGameSchema.safeParse(m).success;

describe("Mail, board and newspaper size caps", () => {
  test("SSO: a newspaper save holds photo ids of 20 characters, a 4,000-character body and 500 for each other field", () => {
    const paper = (photos: string[], texts: string[]) => ({ t: "newspaperSave", photos, texts });
    const texts = (body: number, other: number) =>
      [other, other, body, other, other, other].map((n) => "x".repeat(n));
    const photos = (n: number) => ["1".repeat(n), "", ""];
    expect(ok(paper(photos(20), texts(4000, 500)))).toBe(true);
    expect(ok(paper(photos(21), texts(4000, 500)))).toBe(false);
    expect(ok(paper(photos(20), texts(4001, 500)))).toBe(false);
    for (const i of [0, 1, 3, 4, 5]) {
      const t = texts(4000, 500);
      t[i] = "x".repeat(501);
      expect(ok(paper(photos(20), t))).toBe(false);
    }
    // Exactly three photos and six fields.
    expect(ok(paper(["", ""], texts(1, 1)))).toBe(false);
    expect(ok(paper(photos(1), texts(1, 1).slice(0, 5)))).toBe(false);
  });
});
