/**
 * The spell sounds by FX name (issue #37's safety net): every Classic spell's FX members and the
 * non-spell FX the client names in code. Stage 4 keys spells on their effect; Classic must sound
 * the same. A change shows as a diff against `golden/spell-sounds.txt`; record an intended one
 * with `SSO_UPDATE_GOLDEN=1` (docs/modding.md, "The safety net").
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { content } from "@secondstaronline/shared";

import { spellSounds } from "../src/sfx.ts";

const GOLDEN = join(import.meta.dir, "golden", "spell-sounds.txt");

test("every FX name plays the sounds it played before", () => {
  const names = new Set<string>([
    "Cannonball",
    "Fishing",
    "Slot Machine",
    "BSmith",
    "Blue ArrowsL",
  ]);
  for (const s of content().spells.spells) {
    names.add(s.name);
    for (const f of s.fx) {
      names.add(f.member);
      names.add(f.effect);
    }
  }
  const lines = [...names].sort().map((n) => {
    const show = (roll: number) =>
      spellSounds(n, () => roll)
        .map((x) => `${x.name}@${x.ch}`)
        .join(",") || "-";
    const a = show(1);
    const b = show(2);
    return `${n} | ${a === b ? a : `${a} / ${b}`}`;
  });
  const text = `${lines.join("\n")}\n`;
  if (process.env.SSO_UPDATE_GOLDEN === "1") {
    mkdirSync(join(import.meta.dir, "golden"), { recursive: true });
    writeFileSync(GOLDEN, text);
    return;
  }
  expect(existsSync(GOLDEN)).toBe(true);
  expect(text).toBe(readFileSync(GOLDEN, "utf8"));
});
