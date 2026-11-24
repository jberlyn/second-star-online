/**
 * The creation screen's class radios (issue #37's safety net): each radio sends the class code the
 * server's start classes use. Stage 1 draws the class list from content; Classic must keep this
 * mapping.
 */
import { expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import { buildContentStore, type ContentData, installContent } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { type CreationValues, creationScreen } from "../src/ui/screens.ts";

const assets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
};

/** The screen, every element on it (the class list's rows included), and a press by label. */
function screen() {
  const sent: CreationValues[] = [];
  const s = creationScreen(assets, { ok: (v) => sent.push({ ...v }), cancel() {}, sound() {} });
  const els = s.items.flatMap((i) => [i.el, ...i.el.querySelectorAll<HTMLElement>("*")]);
  const press = (label: string) => els.find((e) => e.getAttribute("aria-label") === label)?.click();
  const list = s.items.find((i) => i.el.classList.contains("cc-class-list"));
  return { s, sent, els, press, list };
}

test("Fighter, Ranger and Mage send class codes 1, 3 and 2, top to bottom", () => {
  const { sent, els, press } = screen();
  const labels = els
    .map((e) => e.getAttribute("aria-label"))
    .filter((l) => l === "Fighter" || l === "Ranger" || l === "Mage");
  expect(labels).toEqual(["Fighter", "Ranger", "Mage"]);
  press("OK");
  for (const label of ["Fighter", "Ranger", "Mage"]) {
    press(label);
    press("OK");
  }
  expect(sent.map((v) => v.classCode)).toEqual([1, 1, 3, 2]);
});

test("Classic's class list sits where 1.6 drew it: radios at (526, 225 + 15n), names at (544, 223)", () => {
  const { list } = screen();
  expect(list && [list.x, list.y, list.w, list.h]).toEqual([524, 223, 110, 48]);
  expect(list?.el.classList.contains("cc-class-scroll")).toBe(false);
  const radios = [...(list?.el.querySelectorAll<HTMLImageElement>("img") ?? [])];
  expect(
    radios.map((r) => [524 + Number.parseInt(r.style.left), 223 + Number.parseInt(r.style.top)]),
  ).toEqual([
    [526, 225],
    [526, 240],
    [526, 255],
  ]);
  const names = list?.el.querySelector<HTMLElement>(".cc-classes");
  expect([names?.style.left, names?.style.top]).toEqual(["20px", "0px"]);
  expect(names?.innerHTML).toBe("Fighter<br>Ranger<br>Mage");
});

test("the classes come from content, and more than three scroll within the same rows", () => {
  const d = structuredClone(classicData) as ContentData;
  d.classes.startClasses = [
    { code: 4, label: "Squire", skills: {} },
    ...d.classes.startClasses,
    { code: 12, skills: {} },
  ];
  installContent(buildContentStore(d));
  try {
    const { sent, press, list, els } = screen();
    expect(list?.el.classList.contains("cc-class-scroll")).toBe(true);
    expect(list?.h).toBe(48);
    expect(list?.el.querySelector(".cc-classes")?.textContent).toBe("SquireFighterRangerMageNinja");
    // The first class offered is chosen at the start; a label defaults to the class's name.
    press("OK");
    press("Ninja");
    press("OK");
    expect(sent.map((v) => v.classCode)).toEqual([4, 12]);
    expect(els.some((e) => e.dataset.action === "creation-class-squire")).toBe(true);
  } finally {
    installContent(buildContentStore(classicData));
  }
});

test("Classic's sexes are the backdrop's own MALE and FEMALE beside 1.6's two radios", () => {
  const { s, sent, press, els } = screen();
  expect(s.items.some((i) => i.el.classList.contains("cc-sex-list"))).toBe(false);
  const radios = s.items.filter(
    (i) => i.el instanceof HTMLImageElement && i.x === 426 && (i.y === 153 || i.y === 168),
  );
  expect(radios).toHaveLength(2);
  expect(els.some((e) => e.dataset.action === "creation-male")).toBe(true);
  expect(els.some((e) => e.dataset.action === "creation-female")).toBe(true);
  press("OK");
  press("Female");
  press("Next head");
  press("OK");
  press("Male");
  press("OK");
  expect(sent.map((v) => [v.sex, v.head])).toEqual([
    [1, 1],
    [2, 7],
    [1, 1],
  ]);
});

test("other sexes come from content, written over the backdrop's words, scrolling past two", () => {
  const d = structuredClone(classicData) as ContentData;
  d.classes.creation.sexes = [
    { code: 3, label: "Elf", heads: [9, 4] },
    { code: 1, label: "Human", heads: [1] },
    { code: 5, label: "Orc", heads: [6] },
  ];
  installContent(buildContentStore(d));
  try {
    const { s, sent, press } = screen();
    const list = s.items.find((i) => i.el.classList.contains("cc-sex-list"));
    expect(list && [list.x, list.y, list.w, list.h]).toEqual([424, 151, 98, 32]);
    expect(list?.el.classList.contains("cc-sex-scroll")).toBe(true);
    expect([...(list?.el.querySelectorAll(".cc-sex") ?? [])].map((e) => e.textContent)).toEqual([
      "Elf",
      "Human",
      "Orc",
    ]);
    // The first sex and its first head are chosen at the start.
    press("OK");
    press("Orc");
    press("OK");
    press("Elf");
    press("Next head");
    press("OK");
    expect(sent.map((v) => [v.sex, v.head])).toEqual([
      [3, 9],
      [5, 6],
      [3, 4],
    ]);
  } finally {
    installContent(buildContentStore(classicData));
  }
});
