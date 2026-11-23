/**
 * The seeded whole-server replay (issue #37's safety net; tests/helpers/replay.ts builds it). The
 * world-state hash of every tick must match `tests/golden/replay.txt`.
 *
 * When it does not, the failure names the first tick that differs and the parts of the state
 * (players, rooms and so on) whose hashes differ at the next checkpoint. To see the change itself,
 * dump the state at that tick before and after the change and diff the two files:
 *
 *   SSO_REPLAY_DUMP=<tick>:/tmp/after.txt bun test tests/replay.test.ts
 *
 * (and the same on the commit before, to /tmp/before.txt). An intended change is recorded with
 * `SSO_UPDATE_GOLDEN=1` (docs/modding.md, "The safety net").
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ServerMsg } from "@secondstaronline/shared";

import { expectGolden, UPDATE_GOLDEN } from "./helpers/golden.ts";
import { REPLAY_CHECKPOINT, REPLAY_TICKS, runReplay } from "./helpers/replay.ts";

const GOLDEN = join(import.meta.dir, "golden", "replay.txt");

/** `SSO_REPLAY_DUMP=<tick>:<file>`: write the flattened state after that tick to the file. */
const DUMP = (() => {
  const v = process.env.SSO_REPLAY_DUMP;
  const m = v ? /^(\d+):(.+)$/.exec(v) : null;
  return m ? { tick: Number(m[1]), file: m[2] as string } : null;
})();

/** Chat lines that show each activity ran, by what the scripted players were told. */
const EXERCISED: [string, RegExp][] = [
  ["walking into a wall", /^You cannot go that way\.$/],
  ["a shove", /shoves you out of the way/],
  ["melee and a level", /^You have become more powerful!$/],
  ["parry skill gain", /^You have advanced in the art of Parry!$/],
  ["a death", /was just killed by/],
  ["chopping, digging or mining skill", /advanced in the art of (Lumberjacking|Shoveling|Mining)/],
  ["fishing skill", /advanced in the art of Fishing/],
  ["fish stop biting", /fish have stopped biting/],
  ["planting", /^You plant the seeds\.$/],
  ["cooking", /^Your Orc Pot Pie is ready!$/],
  ["smithing", /^Your Fire Helm is ready!$/],
  ["mixing", /^Your potion is ready!$/],
  ["buying", /says "Thanks for the business!"/],
  ["eating", /^You eat an apple\.$/],
  ["drinking", /^You drink the Red Potion\.$/],
  ["reading a book", /mysticism is not high enough/],
  ["opening a container", /^You open the Crate to see what's inside/],
  ["taking from a container", /^You take a .* out of the container\.$/],
  ["boarding a boat", /^You board your boat/],
  ["casting short of spell points", /spell points to cast this/],
];

describe("the seeded whole-server replay", () => {
  test(`${REPLAY_TICKS} ticks hash the same as the golden run`, async () => {
    const told = new Map<string, number>();
    const kinds = new Set<string>();
    const r = await runReplay({
      dumpAt: DUMP ? [DUMP.tick] : [],
      send: (_id: string, msg: ServerMsg) => {
        kinds.add(msg.t);
        if (msg.t === "chat") {
          for (const [what, re] of EXERCISED) {
            if (re.test(msg.text)) {
              told.set(what, (told.get(what) ?? 0) + 1);
            }
          }
        }
      },
    });
    if (DUMP) {
      writeFileSync(DUMP.file, `${(r.dumps.get(DUMP.tick) ?? []).join("\n")}\n`);
    }
    // Every activity the replay is meant to cover happened: a script that stops working shows
    // here by name, as well as in the hashes.
    expect(EXERCISED.filter(([what]) => !told.has(what)).map(([what]) => what)).toEqual([]);
    for (const k of ["vault", "shop", "bio"]) {
      expect(kinds.has(k)).toBe(true);
    }
    if (!UPDATE_GOLDEN && existsSync(GOLDEN)) {
      const want = readFileSync(GOLDEN, "utf8").trimEnd().split("\n");
      const diverged = firstDivergence(want, r.lines);
      if (diverged) {
        throw new Error(diverged);
      }
    }
    expectGolden(GOLDEN, r.lines.join("\n"));
  }, 120_000);
});

/** The first tick whose hash differs and the parts that differ at the next checkpoint, or null. */
function firstDivergence(want: string[], got: string[]): string | null {
  const ticks = (lines: string[]) =>
    new Map(lines.filter((l) => /^\d+ /.test(l)).map((l) => l.split(" ") as [string, string]));
  const a = ticks(want);
  const b = ticks(got);
  let first: number | null = null;
  for (let t = 0; t < Math.max(a.size, b.size); t++) {
    if (a.get(String(t)) !== b.get(String(t))) {
      first = t;
      break;
    }
  }
  if (first === null) {
    return null;
  }
  const at = Math.ceil((first + 1) / REPLAY_CHECKPOINT) * REPLAY_CHECKPOINT - 1;
  const parts = (lines: string[]) =>
    new Map(
      (lines.find((l) => l.startsWith(`@${at} `)) ?? "")
        .split(" ")
        .slice(1)
        .map((kv) => kv.split("=") as [string, string]),
    );
  const pa = parts(want);
  const pb = parts(got);
  const changed = [...new Set([...pa.keys(), ...pb.keys()])].filter((k) => pa.get(k) !== pb.get(k));
  return [
    `The replay diverges from tests/golden/replay.txt at tick ${first}.`,
    `Parts that differ at the checkpoint after tick ${at}: ${changed.join(", ") || "(none recorded)"}.`,
    `See what changed: SSO_REPLAY_DUMP=${first}:/tmp/after.txt bun test tests/replay.test.ts, the same on the commit before to /tmp/before.txt, then diff them.`,
    "If the change is intended, rerun with SSO_UPDATE_GOLDEN=1 and add a differences entry when it differs from 1.6.",
  ].join("\n");
}
