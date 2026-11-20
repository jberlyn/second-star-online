import { expect, test } from "bun:test";

import { artSaveSchema } from "@secondstaronline/shared";

import { SETTINGS } from "../src/settings.ts";

test("the largest artBytesMax fits the upload message, so the setting always takes effect", () => {
  const max = SETTINGS.artBytesMax.form;
  expect(max.kind).toBe("int");
  const bytes = (max as { max: number }).max;
  const base64 = "A".repeat(Math.ceil(bytes / 3) * 4);
  expect(artSaveSchema.safeParse({ t: "artSave", kind: "painting", png: base64 }).success).toBe(
    true,
  );
  expect(SETTINGS.artBytesMax.schema.safeParse(bytes + 1).success).toBe(false);
});
