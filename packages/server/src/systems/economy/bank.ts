/**
 * The bank.
 *
 * `/balance`, `/deposit <n>` and `/withdraw <n>` in chat. The account is the speaker's own: 1.6
 * kept each balance in a text file named after the player and the client named the file, so a
 * player could withdraw from anyone's account; SSO keys it by character.
 */
import { lingoEq, lingoWord } from "@secondstaronline/shared";

export const BANK_TEXT = {
  /** No living banker (`BNK|`) on the map. */
  cannot: "You cannot bank here!",
  /** The reply to a balance request. */
  balance: (n: number) => `You have ${n} gold in the bank.`,
  /** A deposit. */
  deposited: (n: number, total: number) =>
    `You deposit ${n} gold. You now have ${total} gold in the bank.`,
  /** A withdrawal (1.6 answered it with the deposit's line). */
  withdrew: (n: number, total: number) =>
    `You withdraw ${n} gold. You now have ${total} gold in the bank.`,
  /** A deposit beyond your gold (1.6 said nothing). */
  shortGold: "You don't have that much gold to deposit.",
  /** A withdrawal beyond your balance (1.6 said nothing). */
  shortBank: "You don't have that much gold in the bank.",
  /** No amount, or one that is not a whole number (1.6 said nothing). */
  usage: (cmd: "deposit" | "withdraw") => `Type /${cmd} and an amount, such as /${cmd} 300.`,
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
  /** The line to show. */
  text: string;
  gold: number;
  /** The balance after, or null when no account was made. */
  bank: number | null;
}

/**
 * The server's handlers: a balance request makes a "0" account; a deposit beyond your gold, a
 * withdraw beyond your balance and a missing amount change nothing and say why (1.6 was silent);
 * a deposit and a withdrawal each say what they did. 0 is allowed.
 */
export function runBank(cmd: BankCommand, gold: number, bank: number | null): BankResult {
  const have = bank ?? 0;
  if (cmd.kind === "balance") {
    return { text: BANK_TEXT.balance(have), gold, bank: have };
  }
  if (cmd.n === null) {
    return { text: BANK_TEXT.usage(cmd.kind), gold, bank };
  }
  if (cmd.kind === "deposit") {
    if (gold - cmd.n < 0) {
      return { text: BANK_TEXT.shortGold, gold, bank };
    }
    const total = have + cmd.n;
    return { text: BANK_TEXT.deposited(cmd.n, total), gold: gold - cmd.n, bank: total };
  }
  if (have - cmd.n < 0) {
    return { text: BANK_TEXT.shortBank, gold, bank };
  }
  const total = have - cmd.n;
  return { text: BANK_TEXT.withdrew(cmd.n, total), gold: gold + cmd.n, bank: total };
}
