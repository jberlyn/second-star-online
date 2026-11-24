/** Sounds (issue #29, stage 7): who plays each sound, names, bulk matching, draft rows and gaps. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import {
  artRowFingerprint,
  contentSoundSchema,
  ENGINE_SOUNDS,
  matchSound,
  newSoundGaps,
  planSound,
  type SoundContent,
  soundFormatOfName,
  soundNameProblem,
  soundReplaceText,
  soundStem,
  soundUses,
} from "../../src/index.ts";

const empty: SoundContent = { spells: { spells: [] }, gather: {}, itemRules: {}, casino: {} };

describe("who plays each sound", () => {
  test("Classic's spells, gathering, swings and casino, and the engine's own, every user listed", () => {
    const uses = soundUses(classicData);
    expect(uses.get("crush")?.users).toContain("spell Crush");
    expect(uses.get("stone skin")?.users).toContain("spell Stone Skin");
    expect(uses.get("treechop")?.users).toContain("gathering");
    expect(uses.get("lasersword")?.users).toContain("the item rules");
    expect(uses.get("fx")?.users).toEqual(
      expect.arrayContaining(["the engine (a monster killed)"]),
    );
    // A name is one sound whatever its case.
    expect(uses.has("slotmachine")).toBe(true);
    expect(uses.has("SlotMachine")).toBe(false);
  });

  test("a world that names no sounds still lists the engine's", () => {
    const uses = soundUses(empty);
    expect([...uses.keys()].sort()).toEqual(ENGINE_SOUNDS.map((s) => s.name.toLowerCase()).sort());
  });

  test("a replacement names who it changes", () => {
    expect(soundReplaceText("fx", { name: "fx", users: ["spell Crush", "gathering"] })).toBe(
      "Replaces fx for spell Crush, gathering.",
    );
    expect(soundReplaceText("new", undefined)).toBe("Replaces new, which nothing plays yet.");
  });
});

describe("names and files", () => {
  test("a name has no slashes or control characters and is at most 80 characters", () => {
    expect(soundNameProblem("stone skin")).toBeNull();
    expect(soundNameProblem("  ")).toBe("A sound needs a name.");
    expect(soundNameProblem("a/b")).toContain("slashes");
    expect(soundNameProblem("a\u0007b")).toContain("control characters");
    expect(soundNameProblem("x".repeat(81))).toContain("at most 80");
    // The game frame's clicks are the engine's alone.
    expect(soundNameProblem("clicksound2")).toContain("game frame's own click");
  });

  test("a file's stem and format come from its name", () => {
    expect(soundStem("C:\\sfx\\Fireballs.WAV")).toBe("Fireballs");
    expect(soundFormatOfName("a.Mp3")).toBe("mp3");
    expect(soundFormatOfName("a.flac")).toBeNull();
  });

  test("a bulk file matches a listed sound by name, case ignored, or is a new sound", () => {
    expect(matchSound("FIREBALLS", ["fireballs", "crush"])).toEqual({
      kind: "sound",
      name: "fireballs",
    });
    expect(matchSound("boom", ["fireballs"])).toEqual({ kind: "new", name: "boom" });
  });
});

describe("sound changes", () => {
  const F = "a".repeat(64);
  const G = "b".repeat(64);

  test("a new sound is a new row; a replacement keeps the upload's spelling", () => {
    expect(
      planSound({ op: "set", name: " Boom ", file: F, format: "wav", expect: null }, []),
    ).toEqual({
      ok: true,
      name: "Boom",
      rows: [
        {
          ref: { dataset: "art", part: "sounds", key: "Boom" },
          op: "set",
          data: { name: "Boom", file: F, format: "wav" },
        },
      ],
    });
    const art = [{ name: "Boom", file: F, format: "wav" as const }];
    const r = planSound(
      { op: "set", name: "boom", file: G, format: "mp3", expect: artRowFingerprint(art[0]) },
      art,
    );
    expect(r).toMatchObject({ ok: true, name: "Boom" });
    expect(r.ok && r.rows[0]?.data).toEqual({ name: "Boom", file: G, format: "mp3" });
  });

  test("a stale panel is refused, a replacement and a removal alike", () => {
    const art = [{ name: "Boom", file: F, format: "wav" as const }];
    expect(
      planSound({ op: "set", name: "boom", file: G, format: "wav", expect: null }, art),
    ).toEqual({
      ok: false,
      error: "Boom's upload changed since you opened it: open it again to hear the new one.",
    });
    expect(planSound({ op: "remove", name: "boom", expect: "00000000" }, art).ok).toBe(false);
    expect(
      planSound({ op: "remove", name: "boom", expect: artRowFingerprint(art[0]) }, art),
    ).toEqual({
      ok: true,
      name: "Boom",
      rows: [{ ref: { dataset: "art", part: "sounds", key: "Boom" }, op: "remove", data: null }],
    });
    expect(planSound({ op: "remove", name: "other", expect: null }, art)).toEqual({
      ok: false,
      error: "other has no upload to take out.",
    });
  });

  test("the intent's schema takes a set or a remove and nothing else", () => {
    const ok = contentSoundSchema.safeParse({
      t: "contentSound",
      seq: 1,
      change: { op: "set", name: "boom", file: F, format: "ogg", expect: null },
    });
    expect(ok.success).toBe(true);
    const bad = contentSoundSchema.safeParse({
      t: "contentSound",
      seq: 1,
      change: { op: "set", name: "boom", file: F, format: "flac" },
    });
    expect(bad.success).toBe(false);
    // The upload the panel saw is never left out: a change without it skips no check.
    const blind = contentSoundSchema.safeParse({
      t: "contentSound",
      seq: 1,
      change: { op: "remove", name: "boom" },
    });
    expect(blind.success).toBe(false);
    const long = contentSoundSchema.safeParse({
      t: "contentSound",
      seq: 1,
      change: { op: "remove", name: "x".repeat(81), expect: null },
    });
    expect(long.success).toBe(false);
  });
});

describe("sounds nothing supplies", () => {
  const playing = (name: string): SoundContent => ({
    ...empty,
    spells: { spells: [{ name: "Zap", fx: [{ sounds: [{ name }] }] }] },
  });

  test("a sound the change newly plays with no file is a gap; one supplied or already played is not", () => {
    expect(newSoundGaps(playing("boom"), empty, new Set())).toEqual([
      { name: "boom", users: ["spell Zap"] },
    ]);
    expect(newSoundGaps(playing("boom"), empty, new Set(["boom"]))).toEqual([]);
    // The published content played it already without a file: not this change's gap.
    expect(newSoundGaps(playing("boom"), playing("BOOM"), new Set())).toEqual([]);
    // The engine's own are always played, so a world without them is never told.
    expect(newSoundGaps(empty, empty, new Set())).toEqual([]);
    // A spell newly set to play a sound only the engine played (with no file) is a new gap.
    expect(newSoundGaps(playing("cash"), empty, new Set())).toEqual([
      { name: "cash", users: ["spell Zap"] },
    ]);
  });
});
