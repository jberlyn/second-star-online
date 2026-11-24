/**
 * Splits a migration's SQL into its statements, so each can run on its own and report its own
 * error: bun:sqlite's multi-statement `run` raises only the last statement's runtime error.
 *
 * A small tokenizer, not a parser. It knows what can hide a `;` (string literals, quoted
 * identifiers in any of SQLite's four quotings, `--` and block comments) and that a
 * `CREATE TRIGGER` body runs from `BEGIN` to its own `END`, past the `;` of each statement inside
 * it (a `CASE … END` inside the body does not end it).
 */

/** The statements of `sql`, in order, each without its `;`; blank and comment-only parts dropped. */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  // Per statement: its leading keywords (to spot a trigger), whether it has any real token, and
  // the trigger body state.
  let head: string[] = [];
  let tokens = 0;
  let trigger = false;
  let inBody = false;
  let caseDepth = 0;
  let bodyDone = false;

  const finish = (end: number) => {
    const text = sql.slice(start, end).trim();
    if (tokens > 0 && text !== "") {
      out.push(text);
    }
    head = [];
    tokens = 0;
    trigger = false;
    inBody = false;
    caseDepth = 0;
    bodyDone = false;
  };

  const word = (w: string) => {
    tokens++;
    const u = w.toUpperCase();
    if (head.length < 4) {
      head.push(u);
      // CREATE [TEMP|TEMPORARY] TRIGGER
      if (
        u === "TRIGGER" &&
        head[0] === "CREATE" &&
        (head.length === 2 ||
          (head.length === 3 && (head[1] === "TEMP" || head[1] === "TEMPORARY")))
      ) {
        trigger = true;
      }
    }
    if (!trigger || bodyDone) {
      return;
    }
    if (!inBody) {
      if (u === "BEGIN") {
        inBody = true;
      }
      return;
    }
    if (u === "CASE") {
      caseDepth++;
    } else if (u === "END") {
      if (caseDepth > 0) {
        caseDepth--;
      } else {
        bodyDone = true;
      }
    }
  };

  /** Index just past the quoted run opened at `i` by `close`, where a doubled `close` escapes. */
  const quoted = (close: string, doubles: boolean): number => {
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === close) {
        if (doubles && sql[j + 1] === close) {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j++;
    }
    throw new Error(`unterminated ${close} quote in SQL at offset ${i}`);
  };

  while (i < sql.length) {
    const c = sql[i] as string;
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      // SQLite ends an unterminated block comment at the end of the input.
      i = close === -1 ? sql.length : close + 2;
    } else if (c === "'" || c === '"' || c === "`") {
      i = quoted(c, true);
      tokens++;
    } else if (c === "[") {
      i = quoted("]", false);
      tokens++;
    } else if (c === ";") {
      if (!trigger || bodyDone) {
        finish(i);
        start = i + 1;
      }
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[\w$]/.test(sql[j] as string)) {
        j++;
      }
      word(sql.slice(i, j));
      i = j;
    } else {
      if (!/\s/.test(c)) {
        tokens++;
      }
      i++;
    }
  }
  if (trigger && !bodyDone) {
    throw new Error("unterminated CREATE TRIGGER body in SQL (no END)");
  }
  finish(sql.length);
  return out;
}
