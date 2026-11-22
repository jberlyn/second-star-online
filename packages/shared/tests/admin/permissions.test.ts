/** Roles and permissions: the default roles, the role checks and the chat tag. */
import { describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  can,
  DEFAULT_ROLES,
  EXEMPTIONS,
  hasEveryPermission,
  isStaff,
  LOCKOUT_TEXT,
  MODERATOR,
  PERMISSION_GROUPS,
  PERMISSIONS,
  permissionInfo,
  type RoleData,
  roleDataError,
  roleFromData,
  rolesError,
  roleToData,
  TOOL_PERMISSIONS,
  taggedName,
} from "../../src/index.ts";

describe("the default roles", () => {
  test("an administrator holds every permission and an account with no role none", () => {
    for (const p of PERMISSIONS) {
      expect(can(ADMINISTRATOR, p)).toBe(true);
      expect(can(null, p)).toBe(false);
    }
    expect(hasEveryPermission(ADMINISTRATOR)).toBe(true);
  });

  test("a moderator has no tools or gameplay exemptions except the login-limit bypass", () => {
    expect(TOOL_PERMISSIONS.filter((p) => can(MODERATOR, p))).toEqual([]);
    expect(EXEMPTIONS.filter((p) => can(MODERATOR, p))).toEqual(["bypassLoginLimits"]);
  });

  test("any role is staff; no role is a player", () => {
    expect(isStaff(null)).toBe(false);
    expect(isStaff(MODERATOR)).toBe(true);
    expect(isStaff(ADMINISTRATOR)).toBe(true);
    // A role with no permissions at all is still staff (staff chat, IMs from prisoners).
    expect(isStaff(roleFromData({ id: "helper", name: "Helper", rank: 1, permissions: [] }))).toBe(
      true,
    );
  });

  test("every permission is named once, grouped and labelled", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    const groups = new Set<string>(PERMISSION_GROUPS.map((g) => g.id));
    for (const p of PERMISSIONS) {
      const info = permissionInfo(p);
      expect(groups.has(info.group)).toBe(true);
      expect(info.label).not.toBe("");
    }
    for (const r of DEFAULT_ROLES) {
      for (const p of r.permissions) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });

  test("the migrations seed the default roles", async () => {
    const migration = (name: string) =>
      Bun.file(new URL(`../../../server/migrations/${name}`, import.meta.url)).text();
    const roles = await migration("20261120_42_roles.sql");
    const admin = roleToData(ADMINISTRATOR);
    // The Control Panel's permissions came later, given to every role that held all the others.
    const controlPanel = ["contentEditor", "characterEditor", "activityLog"];
    const seeded = admin.permissions.filter((p) => !controlPanel.includes(p));
    expect(roles).toContain(
      `('${admin.id}', '${admin.name}', ${admin.rank},\n    '${JSON.stringify(seeded)}'`,
    );
    const later = await migration("20261121_49_control_panel_permissions.sql");
    expect(later).toContain(`json_each('${JSON.stringify(seeded)}')`);
    for (const p of controlPanel) {
      expect(later).toContain(`'${p}'`);
    }
    // The moderator seed lost /pardon, /iplookup, /save and /Refresh in a later migration.
    const mod = roleToData(MODERATOR);
    expect(roles).toContain(`('${mod.id}', '${mod.name}', ${mod.rank},`);
    expect(await migration("20261121_45_moderator_defaults.sql")).toContain(
      `SET permissions = '${JSON.stringify(mod.permissions)}'`,
    );
    expect(DEFAULT_ROLES).toEqual([MODERATOR, ADMINISTRATOR]);
  });
});

describe("role definitions", () => {
  const ok: RoleData = { id: "helper", name: "Helper", rank: 1, permissions: ["kick"] };

  test("a well-formed role passes and round-trips", () => {
    expect(roleDataError(ok)).toBeNull();
    expect(roleToData(roleFromData(ok))).toEqual(ok);
  });

  test("ids, names, ranks and permissions are checked", () => {
    expect(roleDataError({ ...ok, id: "" })).not.toBeNull();
    expect(roleDataError({ ...ok, id: "Helper" })).not.toBeNull();
    expect(roleDataError({ ...ok, id: "a".repeat(21) })).not.toBeNull();
    expect(roleDataError({ ...ok, id: "none" })).toBe("A role cannot be called none.");
    expect(roleDataError({ ...ok, id: "player" })).not.toBeNull();
    expect(roleDataError({ ...ok, name: "" })).not.toBeNull();
    expect(roleDataError({ ...ok, name: " Helper" })).not.toBeNull();
    expect(roleDataError({ ...ok, name: "[Help]" })).not.toBeNull();
    expect(roleDataError({ ...ok, rank: 0 })).not.toBeNull();
    expect(roleDataError({ ...ok, rank: 1.5 })).not.toBeNull();
    expect(roleDataError({ ...ok, permissions: ["fly"] })).toBe(
      "There is no permission called fly.",
    );
  });

  test("a stored permission the server no longer has is dropped", () => {
    expect([...roleFromData({ ...ok, permissions: ["kick", "role"] }).permissions]).toEqual([
      "kick",
    ]);
  });

  test("some role must keep every permission", () => {
    expect(rolesError([MODERATOR, ADMINISTRATOR])).toBeNull();
    expect(rolesError([MODERATOR])).toBe(LOCKOUT_TEXT);
    expect(rolesError([])).toBe(LOCKOUT_TEXT);
  });
});

describe("role tags in chat", () => {
  test("the tag is the role's name, only when the setting is on and the speaker has a role", () => {
    expect(taggedName("Berlyn", ADMINISTRATOR, true)).toBe("[Admin] Berlyn");
    expect(taggedName("Berlyn", ADMINISTRATOR, false)).toBe("Berlyn");
    expect(taggedName("Bob", null, true)).toBe("Bob");
  });
});
