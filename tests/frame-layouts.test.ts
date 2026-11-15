/**
 * The resolved frame layouts (assets/original/**\/layout/frame-*.json) draw each bitmap the way
 * Director does (the asset metadata notes, "Sprite size"): an unstretched sprite (score ink byte
 * bit 0x80 clear) at its member's own size with the regpoint on its loc, whatever width and
 * height the score stored. Until 2026-11-06 the asset build used the stored size, which is
 * stale on 146 main-movie sprites, and the spell page's Info and cast buttons were built from
 * those wrong rects. This pins the rule so a regenerated layout cannot bring them back.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS = join(import.meta.dir, "..", "assets", "original");

interface Member {
  castLib: number;
  member: number;
  type: string;
  width?: number;
  height?: number;
  regX?: number;
  regY?: number;
}

interface Sprite {
  channel: number;
  castLib: number;
  member: number;
  type: string | null;
  loc: [number, number];
  stretch?: boolean;
  rect: [number, number, number, number];
}

function movies(): string[] {
  const subs = readdirSync(join(ASSETS, "sub")).map((m) => join("sub", m));
  return ["main", ...subs];
}

function load(movie: string) {
  const dir = join(ASSETS, movie, "layout");
  const members = new Map<string, Member>();
  for (const line of readFileSync(join(dir, "cast-manifest.jsonl"), "utf8").split("\n")) {
    if (line.trim()) {
      const m = JSON.parse(line) as Member;
      members.set(`${m.castLib}:${m.member}`, m);
    }
  }
  const frames = readdirSync(dir)
    .filter((f) => /^frame-\d+\.json$/.test(f))
    .map((f) => ({
      file: `${movie}/${f}`,
      sprites: (JSON.parse(readFileSync(join(dir, f), "utf8")) as { sprites: Sprite[] }).sprites,
    }));
  return { members, frames };
}

describe("frame layouts draw unstretched bitmaps at their member's size", () => {
  for (const movie of movies()) {
    test(movie, () => {
      const { members, frames } = load(movie);
      const wrong: string[] = [];
      let checked = 0;
      for (const { file, sprites } of frames) {
        for (const s of sprites) {
          if (s.type !== "bitmap") {
            continue;
          }
          if (typeof s.stretch !== "boolean") {
            wrong.push(`${file} channel ${s.channel}: no stretch flag`);
            continue;
          }
          const m = members.get(`${s.castLib}:${s.member}`);
          if (s.stretch || !m?.width || !m.height) {
            continue;
          }
          checked++;
          const want = [
            s.loc[0] - (m.regX ?? 0),
            s.loc[1] - (m.regY ?? 0),
            s.loc[0] - (m.regX ?? 0) + m.width,
            s.loc[1] - (m.regY ?? 0) + m.height,
          ];
          if (want.join() !== s.rect.join()) {
            wrong.push(`${file} channel ${s.channel}: rect ${s.rect} should be ${want}`);
          }
        }
      }
      expect(wrong).toEqual([]);
      expect(checked).toBeGreaterThan(0);
    });
  }

  test("frame 67: the Info 'i' and the cast bolt sit side by side, not stretched over each other", () => {
    const { frames } = load("main");
    const f67 = frames.find((f) => f.file === "main/frame-67.json");
    const rect = (ch: number) => f67?.sprites.find((s) => s.channel === ch)?.rect;
    expect(rect(43)).toEqual([614, 300, 628, 317]);
    expect(rect(44)).toEqual([635, 295, 667, 322]);
  });
});
