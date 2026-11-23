/**
 * The Classic pack holds no item a player can be given, or asked for, that they could never see or
 * get (issue #39): every item content hands out or asks for has a picture and is not retired, and an
 * item with no picture is one the engine draws another way (gold, the carried containers) or a
 * retired item whose copies players may still hold.
 */
import { describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  bagPicture,
  buildContentStore,
  type ContentData,
  crystalPile,
  installContent,
  isGoldName,
  lingoEq,
} from "@secondstaronline/shared";

import { readPackDir } from "../src/content/packs.ts";
import { type Reference, referencesOf } from "../src/content/validate.ts";

const data = readPackDir(RELEASE_PACK_DIRS.classic as string).data as ContentData;
installContent(buildContentStore(data));

/** Where a reference hands an item to a player (a source) or asks one for it. */
const HANDS_OUT =
  /build\/bands\/\d+\/results|cauldron\/recipes\/\d+\/result|cook\/recipes\/\d+\/(burned|output)|mix\/sands\/\d+\/potion|smith\/chunkDefault|smith\/chunks\/\d+\/chunk|outcomes\/\d+\/result|repairs\/\d+\/output|farming\/(produce|seeds)|fishing\/bands|logs\/item|mining\/(chunks\/\d+\/item|colours|ore)|treasure\/items|chests\/\d+\/source|\/reward|rewards\/\d+\/item|wanted\/\d+\/item|\/wants|prizes|head|oraku/;

function npcTag(r: Reference): string | null {
  const file = data.npcFiles.files.find((f) => r.where.endsWith(`/${f.name}`));
  const line = file?.text.split("\r")[r.path[1] as number] ?? "";
  return /^(SEL|BUY|INV)\|/.exec(line)?.[1] ?? null;
}

function handsOut(r: Reference): boolean {
  if (r.npcLine) {
    return npcTag(r) !== "BUY";
  }
  return HANDS_OUT.test(r.path.join("/")) || HANDS_OUT.test(r.where);
}

/** The catalogue entry a content name means (its key, display name or an archived spelling). */
function entryOf(name: string) {
  const n = (crystalPile(name)?.item ?? name).trim();
  return data.items.items.find(
    (i) =>
      lingoEq(i.name, n) ||
      (i.display !== undefined && lingoEq(i.display, n)) ||
      (i.variants ?? []).some((v) => lingoEq(v, n)),
  );
}

/** Drawn without an icon of its own: gold, and the carried containers' bag pictures. */
const drawnByEngine = (name: string) => isGoldName(`1 ${name}`) || bagPicture(name) !== name;

describe("the Classic pack", () => {
  test("bug fixed: everything content hands out or asks for has a picture and can still be made", () => {
    const bad: string[] = [];
    for (const r of referencesOf(data)) {
      if (!["item", "shopItem", "lootItem"].includes(r.kind) || !handsOut(r)) {
        continue;
      }
      if (/^\d+ gold$/i.test(r.name.trim())) {
        continue;
      }
      const e = entryOf(r.name);
      if (!e || e.retired || (e.icon === null && !drawnByEngine(e.name))) {
        bad.push(`${r.where}: ${r.name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("bug fixed: an item with no picture is drawn by the engine or retired", () => {
    const artless = data.items.items
      .filter((i) => i.icon === null && !drawnByEngine(i.name))
      .map((i) => `${i.name}${i.retired ? " (retired)" : ""}`);
    expect(artless).toEqual([
      "Damaged Armor (retired)",
      "Green Laser Sword (retired)",
      "Hammer (retired)",
      "Laser Sword (retired)",
      "Magic Shield (retired)",
      "Scimitar (retired)",
    ]);
  });

  test("bug fixed: the crystals are the six singular items, with their art and the old plurals", () => {
    const crystals = data.items.items.filter((i) => / crystals?$/i.test(i.name));
    expect(crystals.map((i) => i.name)).toEqual([
      "Blue Crystal",
      "Green Crystal",
      "Purple Crystal",
      "Red Crystal",
      "White Crystal",
      "Yellow Crystal",
    ]);
    for (const c of crystals) {
      expect(c.icon).not.toBeNull();
      expect(c.sprite).toBe(`${c.name}s`);
      expect(c.variants).toContain(`${c.name}s`);
    }
  });
});
