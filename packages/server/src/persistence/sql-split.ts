/**
 * Splits a migration's SQL into its statements, so each can run on its own and report its own
 * error: bun:sqlite's multi-statement `run` raises only the last statement's runtime error.
 *
 * It follows SQLite's own `sqlite3_complete` state machine, so it splits exactly where SQLite
 * would: a `;` ends a statement unless it is inside a `CREATE [TEMP] TRIGGER` (optionally after
 * `EXPLAIN`), whose body ends only at a `;` then `END` then `;`. Strings, quoted identifiers in any
 * of SQLite's four quotings and comments hide a `;`. A column named `end`, or a `CASE … END`,
 * inside a trigger body does not end it, as in SQLite.
 */

// sqlite3_complete's tokens and states.
const SEMI = 0;
const WS = 1;
const OTHER = 2;
const EXPLAIN = 3;
const CREATE = 4;
const TEMP = 5;
const TRIGGER = 6;
const END = 7;
const START = 1;
/** trans[state][token]: sqlite3_complete's table (states 0 INVALID … 7 END). */
const TRANS: readonly (readonly number[])[] = [
  /* 0 INVALID */ [1, 0, 2, 3, 4, 2, 2, 2],
  /* 1 START   */ [1, 1, 2, 3, 4, 2, 2, 2],
  /* 2 NORMAL  */ [1, 2, 2, 2, 2, 2, 2, 2],
  /* 3 EXPLAIN */ [1, 3, 3, 2, 4, 2, 2, 2],
  /* 4 CREATE  */ [1, 4, 2, 2, 2, 4, 5, 2],
  /* 5 TRIGGER */ [6, 5, 5, 5, 5, 5, 5, 5],
  /* 6 SEMI    */ [6, 6, 5, 5, 5, 5, 5, 7],
  /* 7 END     */ [1, 7, 5, 5, 5, 5, 5, 5],
];

function keyword(w: string): number {
  switch (w.toUpperCase()) {
    case "EXPLAIN":
      return EXPLAIN;
    case "CREATE":
      return CREATE;
    case "TEMP":
    case "TEMPORARY":
      return TEMP;
    case "TRIGGER":
      return TRIGGER;
    case "END":
      return END;
    default:
      return OTHER;
  }
}

/** The statements of `sql`, in order, each without its `;`; blank and comment-only parts dropped. */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  let state = 0;
  let tokens = 0;

  const step = (token: number) => {
    if (token !== WS && token !== SEMI) {
      tokens++;
    }
    state = TRANS[state]?.[token] ?? 2;
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
      step(WS);
    } else if (c === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      // SQLite ends an unterminated block comment at the end of the input.
      i = close === -1 ? sql.length : close + 2;
      step(WS);
    } else if (c === "'" || c === '"' || c === "`") {
      i = quoted(c, true);
      step(OTHER);
    } else if (c === "[") {
      i = quoted("]", false);
      step(OTHER);
    } else if (c === ";") {
      step(SEMI);
      if (state === START) {
        const text = sql.slice(start, i).trim();
        if (tokens > 0 && text !== "") {
          out.push(text);
        }
        tokens = 0;
        start = i + 1;
      }
      i++;
    } else if (/[A-Za-z_\u0080-\uffff]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[\w$\u0080-\uffff]/.test(sql[j] as string)) {
        j++;
      }
      step(keyword(sql.slice(i, j)));
      i = j;
    } else if (/\s/.test(c)) {
      step(WS);
      i++;
    } else {
      // Numbers and other characters are one OTHER token per run of word characters.
      let j = i + 1;
      if (/[\w$]/.test(c)) {
        while (j < sql.length && /[\w$]/.test(sql[j] as string)) {
          j++;
        }
      }
      step(OTHER);
      i = j;
    }
  }
  if (state === 5 || state === 6) {
    throw new Error("unterminated CREATE TRIGGER body in SQL (no ; END)");
  }
  const text = sql.slice(start).trim();
  if (tokens > 0 && text !== "") {
    out.push(text);
  }
  return out;
}
