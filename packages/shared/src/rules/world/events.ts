/**
 * World events (issue #3): the world's counters, offerings and counter perks (`events.json`). Pure
 * rules: the server keeps the counters' values (`world.counters`), saves them and hands them in.
 *
 * - A counter is a named whole number the world shares, kept between its `min` and `max`.
 * - An offering runs when a player drops its `item` while facing its `onto`, placed by the world:
 *   its class test, then its checks in order (the first failing one refuses), then its changes.
 * - A counter perk adds `value` per whole `every` the counter is past `from` to the spell power,
 *   melee or defence of characters in its classes.
 */
import type { CounterPerkKind, Offering, WorldCounter } from "@secondstaronline/data";

import { content } from "../../content/store.ts";
import { withoutId } from "../core/fixtures.ts";
import { lingoEq } from "../core/lingo.ts";
import { classChain } from "../progression/classes.ts";

/** The world's counter values, by the counter's name as content spells it. */
export type Counters = Readonly<Record<string, number>>;

/** The counter content names `name` (case ignored), or undefined. */
export function counterRow(name: string): WorldCounter | undefined {
  return content().events.counters.find((c) => lingoEq(c.name, name));
}

/** `n` kept inside the counter's bounds. */
function clamp(c: WorldCounter, n: number): number {
  return Math.min(c.max, Math.max(c.min, n));
}

/** A counter's value: the saved one when there is one (case ignored), else its start. */
export function counterValue(counters: Counters, name: string): number {
  const row = counterRow(name);
  for (const [k, v] of Object.entries(counters)) {
    if (lingoEq(k, name)) {
      return row ? clamp(row, v) : v;
    }
  }
  return row?.start ?? 0;
}

/**
 * Every counter content defines, at its saved value (kept inside its bounds) or its start when it
 * has none. Saved values of counters content no longer defines are dropped from the result.
 */
export function reconcileCounters(saved: Counters): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of content().events.counters) {
    const key = Object.keys(saved).find((k) => lingoEq(k, c.name));
    out[c.name] = key === undefined ? c.start : clamp(c, saved[key] as number);
  }
  return out;
}

/** The counters with `add` made to `name`, kept inside its bounds (an unknown counter is left). */
export function addToCounter(
  counters: Counters,
  name: string,
  add: number,
): Record<string, number> {
  const row = counterRow(name);
  if (!row) {
    return { ...counters };
  }
  return { ...counters, [row.name]: clamp(row, counterValue(counters, name) + add) };
}

/** The name an offering tests a bag item by: no `#id`, no `+N`, no surrounding spaces. */
function offeredName(item: string): string {
  return withoutId(item)
    .replace(/\s*\+\d+$/, "")
    .trim();
}

/** The first offering for dropping `item` onto the placed `onto` (case ignored), or undefined. */
export function findOffering(item: string, onto: string): Offering | undefined {
  const given = offeredName(item);
  const target = withoutId(onto).trim();
  return content().events.offerings.find((o) => lingoEq(o.item, given) && lingoEq(o.onto, target));
}

/** Fills an offering text's `{player}`, `{item}` and `{onto}`. */
export function offeringText(text: string, who: { player: string; item: string; onto: string }) {
  return text
    .replaceAll("{player}", who.player)
    .replaceAll("{item}", who.item)
    .replaceAll("{onto}", who.onto);
}

/** Whether a character of class `classCode` is in one of `classes` (or a class inheriting one). */
export function inClasses(classCode: number | undefined, classes: readonly number[] | undefined) {
  if (!classes) {
    return true;
  }
  return classChain(classCode).some((c) => classes.includes(c.code));
}

/** What an offering does. */
export type OfferingOutcome =
  /** Refused: the player hears `text`; nothing changes and the item stays. */
  | { kind: "refused"; text: string }
  /** Made: the counters become `counters`; `keepsItem` says whether the item stays. */
  | {
      kind: "made";
      counters: Record<string, number>;
      keepsItem: boolean;
      message: string | null;
      announce: { text: string; classes: readonly number[] | null }[];
    };

/** The engine's refusal for a player outside an offering's classes, when it sets none. */
export const CLASS_REFUSAL = "Nothing happens.";

/** Runs offering `o` by a character of class `classCode` against the world's `counters`. */
export function makeOffering(
  o: Offering,
  classCode: number | undefined,
  counters: Counters,
): OfferingOutcome {
  if (!inClasses(classCode, o.classes)) {
    return { kind: "refused", text: o.classRefusal ?? CLASS_REFUSAL };
  }
  for (const check of o.checks ?? []) {
    const v = counterValue(counters, check.counter);
    if (
      (check.atLeast !== undefined && v < check.atLeast) ||
      (check.atMost !== undefined && v > check.atMost)
    ) {
      return { kind: "refused", text: check.refusal };
    }
  }
  let next: Record<string, number> = { ...counters };
  for (const change of o.changes ?? []) {
    next = addToCounter(next, change.counter, change.add);
  }
  return {
    kind: "made",
    counters: next,
    keepsItem: o.keepsItem ?? false,
    message: o.message ?? null,
    announce: (o.announce ?? []).map((a) => ({ text: a.text, classes: a.classes ?? null })),
  };
}

/**
 * The counter perks' bonus of `kind` for a character of class `classCode`: each perk whose classes
 * take it in adds `value` × the whole steps of `every` its counter is past `from` (rounded toward
 * `from`), kept between its `least` and `most`.
 */
export function counterPerkBonus(
  classCode: number | undefined,
  kind: CounterPerkKind,
  counters: Counters | undefined,
): number {
  if (!counters) {
    return 0;
  }
  let total = 0;
  for (const p of content().events.perks) {
    if (p.kind !== kind || !inClasses(classCode, p.classes)) {
      continue;
    }
    const steps = Math.trunc((counterValue(counters, p.counter) - p.from) / p.every);
    let bonus = steps * p.value;
    if (p.least !== undefined) {
      bonus = Math.max(p.least, bonus);
    }
    if (p.most !== undefined) {
      bonus = Math.min(p.most, bonus);
    }
    total += bonus;
  }
  return total;
}

/**
 * One drift step: each counter with a `drift` whose `everyMinutes` divides `minute` (the server's
 * minutes running, from 1) moves `by` toward its `toward` (its start when unset), never past it.
 * Returns the counters that moved, or null when none did.
 */
export function driftCounters(counters: Counters, minute: number): Record<string, number> | null {
  let next: Record<string, number> | null = null;
  for (const c of content().events.counters) {
    if (!c.drift || minute <= 0 || minute % c.drift.everyMinutes !== 0) {
      continue;
    }
    const target = c.drift.toward ?? c.start;
    const v = counterValue(counters, c.name);
    if (v === target) {
      continue;
    }
    const moved = v < target ? Math.min(target, v + c.drift.by) : Math.max(target, v - c.drift.by);
    next = { ...(next ?? counters), [c.name]: moved };
  }
  return next;
}

/** The `/counter` command's lines. */
export const COUNTER_TEXT = {
  none: "This world has no counters.",
  list: (counters: readonly { name: string; value: number }[]) =>
    `Counters: ${counters.map((c) => `${c.name} ${c.value}`).join(", ")}`,
  usage: "Usage: /counter, /counter <name> <number> or /counter <name> reset",
  noSuchCounter: (name: string) => `There is no counter called ${name}.`,
  set: (name: string, value: number) => `${name} is now ${value}.`,
} as const;

/** What `/counter <args>` asks for. */
export type CounterCommand =
  | { kind: "list" }
  | { kind: "set"; counter: WorldCounter; value: number }
  | { kind: "error"; text: string };

/**
 * Reads `/counter`'s arguments: none lists every counter; `<name> <number>` sets one (kept inside
 * its bounds); `<name> reset` puts it back to its start. A counter's name may hold spaces.
 */
export function counterCommand(args: string): CounterCommand {
  const words = args.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { kind: "list" };
  }
  if (words.length < 2) {
    return { kind: "error", text: COUNTER_TEXT.usage };
  }
  const last = words.at(-1) as string;
  const name = words.slice(0, -1).join(" ");
  const counter = counterRow(name);
  if (!counter) {
    return { kind: "error", text: COUNTER_TEXT.noSuchCounter(name) };
  }
  if (lingoEq(last, "reset")) {
    return { kind: "set", counter, value: counter.start };
  }
  if (!/^-?\d+$/.test(last)) {
    return { kind: "error", text: COUNTER_TEXT.usage };
  }
  return { kind: "set", counter, value: clamp(counter, Number(last)) };
}
