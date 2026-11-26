/**
 * Editors built once per session follow a publish (issue #27): the lists and fields they take from
 * the content store are rebuilt when a new store is installed.
 */
import { afterEach, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import { buildContentStore, type ContentData, installContent } from "@secondstaronline/shared";

import { createCharacterEditor } from "../src/ui/character-editor.ts";

const classic = buildContentStore(classicData as ContentData);
afterEach(() => installContent(classic));

test("the character editor's skills, classes and item suggestions follow a publish", () => {
  const editor = createCharacterEditor({ save: () => true, host: document.body });
  const host = document.createElement("div");
  host.append(editor.el);
  const skillInputs = () => host.querySelectorAll('[data-action^="hub-edit-skill-"]').length;
  const before = skillInputs();
  expect(before).toBe(classicData.classes.skills.length);
  const next = structuredClone(classicData) as ContentData;
  next.classes.skills.push({ skill: "Swimming" });
  next.items.items.push({ name: "Moonblade", icon: null });
  installContent(buildContentStore(next, "p1"));
  expect(skillInputs()).toBe(before + 1);
  expect(host.textContent).toContain("Swimming");
  expect(
    [...host.querySelectorAll("datalist option")].some(
      (o) => (o as HTMLOptionElement).value === "Moonblade",
    ),
  ).toBe(true);
});
