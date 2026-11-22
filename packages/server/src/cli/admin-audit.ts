/**
 * Operator command line: prints the newest rows of the audit log, which records every admin
 * command, world and NPC editor save, setting change and role change. Newspaper saves are not
 * recorded. In the game, `/auditlog` shows the same rows to a role that holds it.
 *
 * Run: `bun run admin:audit [n]` (default 50; SSO_DB as for the server).
 */
import "../content-classic.ts";

import { recentAudit } from "../persistence/admin.ts";
import { openDatabase } from "../persistence/database.ts";
import { migrate } from "../persistence/migrations.ts";

export function auditReport(dbPath: string, limit: number): string[] {
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    return recentAudit(db, limit).map((r) =>
      [
        r.createdAt,
        r.actor,
        r.command,
        r.target ?? "-",
        r.before ?? "-",
        "->",
        r.after ?? "-",
      ].join(" "),
    );
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const n = Number(process.argv[2] ?? 50);
  if (!Number.isInteger(n) || n < 1) {
    console.error("usage: bun run admin:audit [n]");
    process.exit(2);
  }
  for (const line of auditReport(process.env.SSO_DB ?? "sso.sqlite", n)) {
    console.log(line);
  }
}
