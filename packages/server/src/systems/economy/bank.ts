/**
 * The bank.
 *
 * `/balance`, `/deposit <n>` and `/withdraw <n>` in chat. The account is the speaker's own: 1.6
 * kept each balance in a text file named after the player and the client named the file, so a
 * player could withdraw from anyone's account; SSO keys it by character.
 */
import { lingoEq, lingoWord } from "@secondstaronline/shared";

export const BANK_TEXT = {
  /** No `BNK|` in the map's four NPC slots. */
  cannot: "You cannot bank here!",
  /** The reply to a balance request. */
  balance: (n: number) => `You have ${n} gold in the bank.`,
  /** The reply to both a deposit and a withdraw. */
  now: (n: number) => `You now have ${n} gold in the bank.`,
} as const;

export type BankCommand =
  | { kind: "balance" }
  | { kind: "deposit"; n: number | null }
  | { kind: "withdraw"; n: number | null };

/**
 * The command a chat line is, by the first word (comparison ignores case, so `/BALANCE` works), or
 * null. The amount is the rest after one leading space is removed; `integer` of anything that is
 * not a whole number is read as no amount (an assumption: the archive does not say), and a negative
 * one too, since the client exits on `< 0`.
 */
export function parseBank(text: string): BankCommand | null {
  const w = lingoWord(text, 1);
  const kind = lingoEq(w, "/balance")
    ? "balance"
    : lingoEq(w, "/deposit")
      ? "deposit"
      : lingoEq(w, "/withdraw")
        ? "withdraw"
        : null;
  if (kind === null) {
    return null;
  }
  if (kind === "balance") {
    return { kind };
  }
  const start = text.indexOf(w) + w.length;
  let rest = text.slice(start);
  if (rest.startsWith(" ")) {
    rest = rest.slice(1);
  }
  const n = /^\d+$/.test(rest) ? Number(rest) : null;
  return { kind, n: n !== null && Number.isSafeInteger(n) ? n : null };
}

export interface BankResult {
  /** The line to show, or null for a silent failure. */
  text: string | null;
  gold: number;
  /** The balance after, or null when no account was made. */
  bank: number | null;
}

/**
 * The server's handlers: a balance request makes a "0" account; a deposit beyond your gold and a
 * withdraw beyond your balance do nothing and say nothing (1.6 did the same); 0 is allowed and
 * replies with the balance.
 */
export function runBank(cmd: BankCommand, gold: number, bank: number | null): BankResult {
  const have = bank ?? 0;
  if (cmd.kind === "balance") {
    return { text: BANK_TEXT.balance(have), gold, bank: have };
  }
  if (cmd.n === null) {
    return { text: null, gold, bank };
  }
  if (cmd.kind === "deposit") {
    if (gold - cmd.n < 0) {
      return { text: null, gold, bank };
    }
    return { text: BANK_TEXT.now(have + cmd.n), gold: gold - cmd.n, bank: have + cmd.n };
  }
  if (have - cmd.n < 0) {
    return { text: null, gold, bank };
  }
  return { text: BANK_TEXT.now(have - cmd.n), gold: gold + cmd.n, bank: have - cmd.n };
}
