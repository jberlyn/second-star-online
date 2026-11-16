import { tmpdir } from "node:os";

// SQLite checks SQLITE_TMPDIR -> TMPDIR -> /var/tmp -> /tmp. Sandboxed runners that leave
// TMPDIR unset and block /var/tmp fail with SQLITE_CANTOPEN unless SQLITE_TMPDIR is set.
process.env.SQLITE_TMPDIR ??= tmpdir();
