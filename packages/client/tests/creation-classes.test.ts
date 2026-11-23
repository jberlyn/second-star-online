/**
 * The creation screen's class radios (issue #37's safety net): each radio sends the class code the
 * server's start classes use. Stage 1 draws the class list from content; Classic must keep this
 * mapping.
 */
import { expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import { type CreationValues, creationScreen } from "../src/ui/screens.ts";

const assets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
};

test("Fighter, Ranger and Mage send class codes 1, 3 and 2, top to bottom", () => {
  const sent: CreationValues[] = [];
  const s = creationScreen(assets, { ok: (v) => sent.push({ ...v }), cancel() {}, sound() {} });
  const press = (label: string) =>
    s.items
      .map((i) => i.el)
      .find((e) => e.getAttribute("aria-label") === label)
      ?.click();
  const labels = s.items
    .map((i) => i.el.getAttribute("aria-label"))
    .filter((l) => l === "Fighter" || l === "Ranger" || l === "Mage");
  expect(labels).toEqual(["Fighter", "Ranger", "Mage"]);
  press("OK");
  for (const label of ["Fighter", "Ranger", "Mage"]) {
    press(label);
    press("OK");
  }
  expect(sent.map((v) => v.classCode)).toEqual([1, 1, 3, 2]);
});
