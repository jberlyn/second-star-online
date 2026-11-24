/**
 * The `art` dataset's schema and the body numbers (issue #29): one limit, 1 to 9999, wherever a
 * body is named, with uploads numbered from 1000.
 */
import { describe, expect, test } from "bun:test";

import {
  artDataSchema,
  BODY_MAX,
  bodyNumberSchema,
  DATASET_SCHEMAS,
  EMPTY_ART,
  NO_BODY_NUMBERS,
  nextOperatorBody,
} from "../schema/datasets.ts";
import { classicData } from "../src/classic.ts";

const HASH = "a".repeat(64);

describe("body numbers", () => {
  test("run 1 to 9999 for monsters, bindings and uploads alike", () => {
    expect(bodyNumberSchema.safeParse(1).success).toBe(true);
    expect(bodyNumberSchema.safeParse(BODY_MAX).success).toBe(true);
    expect(bodyNumberSchema.safeParse(0).success).toBe(false);
    expect(bodyNumberSchema.safeParse(10_000).error?.issues[0]?.message).toBe(
      "body numbers go up to 9999",
    );
    const monsters = structuredClone(classicData.monsters);
    (monsters.monsters[0] as { body: number }).body = 10_000;
    expect(DATASET_SCHEMAS.monsters.safeParse(monsters).success).toBe(false);
    const bindings = structuredClone(classicData.bindings);
    if (bindings.bodies) {
      bindings.bodies.tree = 10_000;
    }
    expect(DATASET_SCHEMAS.bindings.safeParse(bindings).success).toBe(false);
    expect(
      artDataSchema.safeParse({ ...EMPTY_ART, bodies: [{ name: "10000", frames: {} }] }).success,
    ).toBe(false);
  });

  test("an upload takes the first free number from 1000, and is told when none is left", () => {
    expect(nextOperatorBody(new Set([1, 55, 988]))).toBe(1000);
    expect(nextOperatorBody(new Set([1000, 1001]))).toBe(1002);
    const all = new Set(Array.from({ length: 9000 }, (_, i) => 1000 + i));
    expect(nextOperatorBody(all)).toBeNull();
    expect(NO_BODY_NUMBERS).toBe("No body numbers left (uploaded bodies use 1000 to 9999).");
  });
});

describe("art rows", () => {
  test("name files by their SHA-256 and frames by f1-f4 and a facing", () => {
    expect(
      artDataSchema.safeParse({
        ...EMPTY_ART,
        items: [{ name: "Frost Sword", file: HASH, regX: 1, regY: 2 }],
        paperdoll: [{ name: "Frost Sword", frames: { "f1-s": { file: HASH } }, mirrored: true }],
        sounds: [{ name: "crack", file: HASH, format: "ogg" }],
      }).success,
    ).toBe(true);
    expect(
      artDataSchema.safeParse({
        ...EMPTY_ART,
        items: [{ name: "x", file: "not-a-hash", regX: 0, regY: 0 }],
      }).success,
    ).toBe(false);
    expect(
      artDataSchema.safeParse({
        ...EMPTY_ART,
        paperdoll: [{ name: "x", frames: { "f5-s": { file: HASH } } }],
      }).success,
    ).toBe(false);
    expect(
      artDataSchema.safeParse({ ...EMPTY_ART, tiles: [{ code: "abc", file: HASH }] }).success,
    ).toBe(false);
  });
});
