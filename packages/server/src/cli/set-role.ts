/**
 * Operator command line: gives an account a role, or takes it away, so an operator can make the
 * first administrator before anyone can open the Server Settings window, or get back in after
 * locking themselves out. Roles come from the account row, never from a name. Takes effect at the
 * account's next login (the Staff page applies at once). Written to the audit log.
 *
 * Run: `bun run admin:role <name> <role id|none>`, or `bun run admin:role --list` for the roles
 * and who holds them (SSO_DB as for the server).
 */
import "../content-classic.ts";

import { roleToData } from "@secondstaronline/shared";

import { findAccountByUsername, setRole } from "../persistence/accounts.ts";
import { findCharacterAccount, insertAudit } from "../persistence/admin.ts";
import { openDatabase } from "../persistence/database.ts";
import { migrate } from "../persistence/migrations.ts";
import { loadRoles, staffAccounts } from "../persistence/roles.ts";

const USAGE = "usage: bun run admin:role <name> <role id|none>  or  bun run admin:role --list";

export function runSetRole(dbPath: string, name: string, roleWord: string): string {
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    const roles = loadRoles(db);
    const roleId = roleWord === "none" ? null : roleWord;
    const role = roleId === null ? null : roles.find((r) => r.id === roleId);
    if (role === undefined) {
      throw new Error(`role must be none or one of ${roles.map((r) => r.id).join(", ")}`);
    }
    // The account's username, or the name of its character.
    const byName = findAccountByUsername(db, name);
    const byCharacter = byName ? null : findCharacterAccount(db, name);
    const accountId = byName?.id ?? byCharacter?.accountId;
    const label = byName?.username ?? byCharacter?.name ?? name;
    const before = byName?.role ?? byCharacter?.roleId ?? null;
    if (!accountId) {
      throw new Error(`no account called ${name}`);
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      setRole(db, accountId, roleId, now);
      insertAudit(
        db,
        { actor: "cli", command: "admin:role", target: label, before, after: roleId },
        now,
      );
    })();
    return role === null
      ? `${label} has no role now.`
      : `${label} is now ${role.name} (${role.id}).`;
  } finally {
    db.close();
  }
}

/** The roles, highest rank first, each with its rank, permissions and holders. */
export function listRoles(dbPath: string): string {
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    const staff = staffAccounts(db);
    return loadRoles(db)
      .map((r) => {
        const d = roleToData(r);
        const who = staff.filter((a) => a.role === r.id).map((a) => a.name);
        return [
          `${r.id} "${r.name}" rank ${r.rank}`,
          `  permissions: ${d.permissions.join(", ") || "none"}`,
          `  held by: ${who.join(", ") || "nobody"}`,
        ].join("\n");
      })
      .join("\n");
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dbPath = process.env.SSO_DB ?? "sso.sqlite";
  try {
    if (args[0] === "--list") {
      console.log(listRoles(dbPath));
    } else if (args.length === 2 && args[0] && args[1]) {
      console.log(runSetRole(dbPath, args[0], args[1]));
    } else {
      console.error(USAGE);
      process.exit(2);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
