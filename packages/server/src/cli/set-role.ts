/**
 * Operator command line: gives an account a role, so an operator can make the first immortal before
 * any in-game tool exists. Roles come from the account row, never from a name. Takes effect at the
 * account's next login; in game an immortal uses `/role`, which applies at once. Written to the
 * audit log.
 *
 * Run: `bun run admin:role <name> <player|moderator|immortal>` (SSO_DB as for the server).
 */
import { findAccountByUsername, ROLES, type Role, setRole } from "../persistence/accounts.ts";
import { insertAudit } from "../persistence/admin.ts";
import { openDatabase } from "../persistence/database.ts";
import { migrate } from "../persistence/migrations.ts";

export function runSetRole(dbPath: string, name: string, role: string): string {
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new Error(`role must be one of ${ROLES.join(", ")}`);
  }
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    const account = findAccountByUsername(db, name);
    if (!account) {
      throw new Error(`no account called ${name}`);
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      setRole(db, account.id, role as Role, now);
      insertAudit(
        db,
        {
          actor: "cli",
          command: "admin:role",
          target: account.username,
          before: account.role,
          after: role,
        },
        now,
      );
    })();
    return `${account.username} is now ${role}.`;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const [name, role] = process.argv.slice(2);
  if (!name || !role) {
    console.error("usage: bun run admin:role <name> <player|moderator|immortal>");
    process.exit(2);
  }
  try {
    console.log(runSetRole(process.env.SSO_DB ?? "sso.sqlite", name, role));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
