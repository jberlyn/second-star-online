/** Roles and permissions: the built-in roles grant exactly what the fixed roles did. */
import { describe, expect, test } from "bun:test";

import {
  BUILTIN_ROLES,
  can,
  EXEMPTIONS,
  isStaff,
  PERMISSIONS,
  TOOL_PERMISSIONS,
} from "../../src/index.ts";

describe("the built-in roles", () => {
  test("an immortal holds every permission and a player none", () => {
    for (const p of PERMISSIONS) {
      expect(can("immortal", p)).toBe(true);
      expect(can("player", p)).toBe(false);
    }
  });

  test("a moderator has no tools or gameplay exemptions except the login-limit bypass", () => {
    expect(TOOL_PERMISSIONS.filter((p) => can("moderator", p))).toEqual([]);
    expect(EXEMPTIONS.filter((p) => can("moderator", p))).toEqual(["bypassLoginLimits"]);
  });

  test("staff are the roles above a player", () => {
    expect(isStaff("player")).toBe(false);
    expect(isStaff("moderator")).toBe(true);
    expect(isStaff("immortal")).toBe(true);
  });

  test("every permission is named once", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const r of Object.values(BUILTIN_ROLES)) {
      for (const p of r.permissions) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });
});
