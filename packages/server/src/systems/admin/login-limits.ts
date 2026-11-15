/**
 * Login and account-creation limits. 1.6 had none: any client could guess passwords and create
 * accounts without end. Pure state passed in; the counts live in memory, so a restart clears them.
 * A count of 0 in the setting turns that limit off.
 */

/** Failed logins are counted over 5 minutes. */
export const LOGIN_WINDOW_MS = 5 * 60_000;
/** Creations are counted over an hour. */
export const CREATE_WINDOW_MS = 60 * 60_000;

/**
 * The key an address is limited by: IPv4 as is, IPv6 expanded and cut to its first four groups
 * (a /64, so one subscriber's whole block counts as one address).
 */
export function ipKey(ip: string): string {
  const bare = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!bare.includes(":")) {
    return bare;
  }
  const noZone = bare.split("%")[0] ?? bare;
  const [head, tail] = noZone.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? h
      : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g || "0", 16).toString(16))
    .join(":");
}

export interface LoginLimits {
  /** Failure times per address key. */
  ipFails: Map<string, number[]>;
  /** Failure times per `accountId|address key`. */
  pairFails: Map<string, number[]>;
  /** Creation times per address key. */
  creates: Map<string, number[]>;
  /** When the maps were last swept of expired entries. */
  sweptAt: number;
}

export function newLoginLimits(): LoginLimits {
  return { ipFails: new Map(), pairFails: new Map(), creates: new Map(), sweptAt: 0 };
}

/**
 * Drops every expired entry, at most once a login window (an address that never came back would
 * otherwise keep its entry for good, and many addresses would grow the maps without end).
 */
function sweep(l: LoginLimits, now: number): void {
  if (now - l.sweptAt < LOGIN_WINDOW_MS) {
    return;
  }
  l.sweptAt = now;
  for (const key of [...l.ipFails.keys()]) {
    recent(l.ipFails, key, now, LOGIN_WINDOW_MS);
  }
  for (const key of [...l.pairFails.keys()]) {
    recent(l.pairFails, key, now, LOGIN_WINDOW_MS);
  }
  for (const key of [...l.creates.keys()]) {
    recent(l.creates, key, now, CREATE_WINDOW_MS);
  }
}

/** Takes back one entry made at `at` (a counted attempt that succeeded). */
function unnote(m: Map<string, number[]>, key: string, at: number): void {
  const times = m.get(key);
  const i = times ? times.indexOf(at) : -1;
  if (!times || i < 0) {
    return;
  }
  times.splice(i, 1);
  if (times.length === 0) {
    m.delete(key);
  }
}

function recent(m: Map<string, number[]>, key: string, now: number, windowMs: number): number[] {
  const times = (m.get(key) ?? []).filter((t) => now - t < windowMs);
  if (times.length === 0) {
    m.delete(key);
  } else {
    m.set(key, times);
  }
  return times;
}

function add(m: Map<string, number[]>, key: string, now: number, windowMs: number): void {
  const times = recent(m, key, now, windowMs);
  times.push(now);
  m.set(key, times);
}

const pair = (accountId: string, ip: string) => `${accountId}|${ipKey(ip)}`;

/** May this address try a login at all? `limit` 0 = off. */
export function allowLoginFromIp(l: LoginLimits, ip: string, now: number, limit: number): boolean {
  return limit === 0 || recent(l.ipFails, ipKey(ip), now, LOGIN_WINDOW_MS).length < limit;
}

/** May this address try this account? `limit` 0 = off. */
export function allowLoginToAccount(
  l: LoginLimits,
  accountId: string,
  ip: string,
  now: number,
  limit: number,
): boolean {
  return (
    limit === 0 || recent(l.pairFails, pair(accountId, ip), now, LOGIN_WINDOW_MS).length < limit
  );
}

/** A login for a name that does not exist: one failure for the address. */
export function noteUnknownName(l: LoginLimits, ip: string, now: number): void {
  sweep(l, now);
  add(l.ipFails, ipKey(ip), now, LOGIN_WINDOW_MS);
}

/**
 * A password about to be checked counts as a failure for the address and for the pair at once,
 * before the hash (counted after it, logins sent together on several sockets would all pass the
 * check while the first was still hashing).
 */
export function notePasswordTry(l: LoginLimits, accountId: string, ip: string, now: number): void {
  sweep(l, now);
  add(l.ipFails, ipKey(ip), now, LOGIN_WINDOW_MS);
  add(l.pairFails, pair(accountId, ip), now, LOGIN_WINDOW_MS);
}

/**
 * A good password: the try made at `at` is taken back from the address, and the pair's count is
 * cleared (earlier failures from the address stay).
 */
export function noteLoginSuccess(l: LoginLimits, accountId: string, ip: string, at: number): void {
  unnote(l.ipFails, ipKey(ip), at);
  l.pairFails.delete(pair(accountId, ip));
}

export function allowCreate(l: LoginLimits, ip: string, now: number, limit: number): boolean {
  return limit === 0 || recent(l.creates, ipKey(ip), now, CREATE_WINDOW_MS).length < limit;
}

/** A creation about to hash its password counts at once (as `notePasswordTry`). */
export function noteCreate(l: LoginLimits, ip: string, now: number): void {
  sweep(l, now);
  add(l.creates, ipKey(ip), now, CREATE_WINDOW_MS);
}

/** A counted creation that failed after all (the name was taken meanwhile) is taken back. */
export function unnoteCreate(l: LoginLimits, ip: string, at: number): void {
  unnote(l.creates, ipKey(ip), at);
}
