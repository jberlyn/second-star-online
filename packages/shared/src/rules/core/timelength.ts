/**
 * Lengths of time as operators write and read them: "30s", "5 min", "1h 30m", "1d12h", "2 weeks".
 * The Settings window's duration fields and the server's time-valued environment variables use it.
 * Pure; whole seconds in and out.
 */

const UNITS = [
  { s: 86_400, short: "d", words: ["d", "day", "days"] },
  { s: 3600, short: "h", words: ["h", "hr", "hrs", "hour", "hours"] },
  { s: 60, short: "m", words: ["m", "min", "mins", "minute", "minutes"] },
  { s: 1, short: "s", words: ["s", "sec", "secs", "second", "seconds"] },
] as const;
const WEEK = { s: 604_800, words: ["w", "wk", "wks", "week", "weeks"] } as const;
const UNIT_SECONDS = new Map<string, number>(
  [...UNITS, WEEK].flatMap((u) => u.words.map((w) => [w, u.s] as const)),
);
const DURATION_PART = /(\d+(?:\.\d+)?)\s*([a-z]+)/y;

/** Whole seconds as the Settings window shows them: "30s", "5m", "1d 12h", "0". */
export function formatTimeLength(seconds: number): string {
  let left = Math.max(0, Math.round(seconds));
  const parts: string[] = [];
  for (const u of UNITS) {
    const n = Math.floor(left / u.s);
    if (n > 0) {
      parts.push(`${n}${u.short}`);
      left -= n * u.s;
    }
  }
  return parts.length > 0 ? parts.join(" ") : "0";
}

/**
 * Reads a length of time as operators write it (the Settings window, `SSO_*` variables): numbers with units (s, m, h, d, w or their words, like "5 min" or
 * "2 hours"), several in a row ("1h 30m"), rounded to whole seconds. "0" alone, or the row's word
 * for 0 ("off", "permanent", "forever"), is 0. Null when it is not a time.
 */
export function parseTimeLength(text: string, zero?: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === "0" || (zero !== undefined && t === zero.toLowerCase())) {
    return 0;
  }
  let at = 0;
  let total = 0;
  let parts = 0;
  while (at < t.length) {
    while (t[at] === " " || t[at] === ",") {
      at++;
    }
    if (at >= t.length) {
      break;
    }
    DURATION_PART.lastIndex = at;
    const m = DURATION_PART.exec(t);
    const unit = m ? UNIT_SECONDS.get(m[2] ?? "") : undefined;
    if (!m || unit === undefined) {
      return null;
    }
    total += Number(m[1]) * unit;
    parts++;
    at = DURATION_PART.lastIndex;
  }
  return parts > 0 ? Math.round(total) : null;
}
