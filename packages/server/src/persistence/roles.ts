/**
 * Roles: the operator's role definitions (shared `RoleData`), edited in the Server Settings window
 * and with `bun run admin:role`. Accounts name their role by id (accounts.ts). Plain functions
 * taking the `Db` first.
 */
import { type RoleData, type RoleDef, roleFromData, roleToData } from "@secondstaronline/shared";

import type { Db } from "./database.ts";

interface RoleRow {
  id: string;
  name: string;
  rank: number;
  permissions: string;
}

function parsePermissions(text: string): string[] {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Every role, highest rank first, then by id. Permissions the server no longer has are dropped. */
export function loadRoles(db: Db): RoleDef[] {
  return db
    .query<RoleRow, []>("SELECT id, name, rank, permissions FROM roles ORDER BY rank DESC, id")
    .all()
    .map((r) =>
      roleFromData({
        id: r.id,
        name: r.name,
        rank: r.rank,
        permissions: parsePermissions(r.permissions),
      }),
    );
}

/** Adds a role or replaces one with the same id. The caller has checked it (`roleDataError`). */
export function saveRole(db: Db, role: RoleDef, now: string): void {
  const d: RoleData = roleToData(role);
  db.query(
    `INSERT INTO roles (id, name, rank, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, rank = excluded.rank,
       permissions = excluded.permissions, updated_at = excluded.updated_at`,
  ).run(d.id, d.name, d.rank, JSON.stringify(d.permissions), now, now);
}

/** Deletes a role; its accounts are left with no role. */
export function deleteRole(db: Db, id: string, now: string): void {
  db.query("UPDATE accounts SET role = NULL, updated_at = ? WHERE role = ?").run(now, id);
  db.query("DELETE FROM roles WHERE id = ?").run(id);
}

/** How many accounts hold each role, by id. */
export function roleHolders(db: Db): Map<string, number> {
  const rows = db
    .query<{ role: string; n: number }, []>(
      "SELECT role, COUNT(*) AS n FROM accounts WHERE role IS NOT NULL GROUP BY role",
    )
    .all();
  return new Map(rows.map((r) => [r.role, r.n]));
}

/**
 * Every account with a role: its character's name (the account's username when it has no
 * character) and the role's id, by name.
 */
export function staffAccounts(db: Db): { accountId: string; name: string; role: string }[] {
  return db
    .query<{ account_id: string; name: string; role: string }, []>(
      `SELECT a.id AS account_id, COALESCE(MIN(c.name), a.username) AS name, a.role
       FROM accounts a LEFT JOIN characters c ON c.account_id = a.id
       WHERE a.role IS NOT NULL
       GROUP BY a.id
       ORDER BY name COLLATE NOCASE`,
    )
    .all()
    .map((r) => ({ accountId: r.account_id, name: r.name, role: r.role }));
}
