/**
 * The seeded whole-server replay (issue #37's safety net; tests/helpers/replay.ts builds it). Each
 * tick's world-state hash, and the hash of everything the game sent that tick, must match
 * `tests/golden/replay.txt`.
 *
 * When they do not, the failure names the first tick that differs, whether the state or the
 * messages changed, and the parts of the state (players, rooms and so on) whose hashes differ at the
 * next checkpoint. To see the change itself, dump that tick before and after the change and diff the
 * two files (the dump ends with the messages sent that tick):
 *
 *   SSO_REPLAY_DUMP=<tick>:/tmp/after.txt bun test tests/replay.test.ts
 *
 * (and the same on the commit before, to /tmp/before.txt). An intended change is recorded with
 * `SSO_UPDATE_GOLDEN=1` (docs/modding.md, "The safety net").
 */
import { describe, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ServerMsg } from "@secondstaronline/shared";

import type { Game } from "../src/game.ts";
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
  ["melee and a level", /^You have become more powerful!$/],
  ["parry skill gain", /^You have advanced in the art of Parry!$/],
  ["a death", /was just killed by/],
  // The skill rolls are 1 in 12 a success; the tiles below show each tool worked.
  ["a gathering skill gain", /advanced in the art of (Lumberjacking|Shoveling|Mining|Farming)/],
  ["fishing", /advanced in the art of Fishing/],
  ["fish stop biting", /fish have stopped biting/],
  ["planting", /^You plant the seeds\.$/],
  ["cooking", /^Your Orc Pot Pie is ready!$/],
  ["smithing", /^Your Fire Helm is ready!$/],
  ["building", /^You begin to build/],
  ["mixing", /^Your potion is ready!$/],
  ["buying", /says "Thanks for the business!"/],
  ["eating", /^You eat an apple\.$/],
  ["drinking", /^You drink the Red Potion\.$/],
  ["reading a book", /mysticism is not high enough/],
  ["opening a crate", /^You open the Crate to see what's inside/],
  ["opening a carried cabinet", /^You open the Cabinet to see what's inside/],
  ["taking from a container", /^You take a .* out of the container\.$/],
  ["boarding a boat", /^You board your boat/],
];

/** Facts about the world read during the run, by what they show. */
function watcher() {
  const seen = new Set<string>();
  const onTick = (t: number, game: Game) => {
    const by = (name: string) => [...game.world.players.values()].find((p) => p.name === name);
    const town = game.world.rooms.get("x1000y992")?.map;
    if (town?.ground.some((g) => g.item === "Open Gold Door")) {
      seen.add("a key opening a door");
    }
    const layer2 = town?.layers[1].join(" ") ?? "";
    for (const [what, code] of TILES) {
      if (layer2.split(" ").includes(code)) {
        seen.add(what);
      }
    }
    const fisher = by("Fisher");
    if (fisher && fisher.y !== 4) {
      seen.add("fishing from a second spot");
    }
    const digger = by("Digger");
    if (digger && digger.x !== 7) {
      seen.add("digging a second spot");
    }
    if (by("Trader")?.char.bag.some((l) => l?.item === "Seeds")) {
      seen.add("buying seeds");
    }
    if (t === 330 && by("User")?.char.equip.weapon === "NOTHING") {
      seen.add("unequipping");
    }
    // A cast spends its crystals.
    const crystals = (by("Mage")?.char.bag ?? [])
      .filter((l) => l?.item.endsWith(" Crystal"))
      .reduce((n, l) => n + (l?.qty ?? 0), 0);
    if (crystals > 0 && crystals < 6 * 99) {
      seen.add("casting spells");
    }
    // The Victim fights on the field and respawns at its point in town.
    const victim = by("Victim");
    if (victim?.map.name === "x1001y992") {
      seen.add("the victim on the field");
    } else if (
      seen.has("the victim on the field") &&
      victim?.map.name === "x1000y992" &&
      victim.x === 9 &&
      victim.y === 9
    ) {
      seen.add("respawning at the respawn point");
    }
  };
  return { seen, onTick };
}
/** The tile each tool leaves on layer 2. */
const TILES: [string, string][] = [
  ["chopping a tree", "P3"],
  ["mining a rock", "O8"],
  ["digging a hole", "1K"],
  ["hoeing a field", "SL"],
  ["watering a planted field", "XL"],
];
const WATCHED = [
  ...TILES.map(([what]) => what),
  "a key opening a door",
  "fishing from a second spot",
  "digging a second spot",
  "buying seeds",
  "respawning at the respawn point",
  "casting spells",
  "unequipping",
];

describe("the seeded whole-server replay", () => {
  test(`${REPLAY_TICKS} ticks hash the same as the golden run`, async () => {
    const told = new Set<string>();
    const kinds = new Set<string>();
    const w = watcher();
    const r = await runReplay({
      dumpAt: DUMP ? [DUMP.tick] : [],
      onTick: w.onTick,
      send: (_id: string, msg: ServerMsg) => {
        kinds.add(msg.t === "sound" ? `sound:${msg.name}` : msg.t);
        if (msg.t === "chat") {
          for (const [what, re] of EXERCISED) {
            if (re.test(msg.text)) {
              told.add(what);
            }
          }
        }
      },
    });
    if (DUMP) {
      writeFileSync(DUMP.file, `${(r.dumps.get(DUMP.tick) ?? []).join("\n")}\n`);
    }
    // A script that stops working shows by name, beside the first tick that changed.
    const missing = [
      ...EXERCISED.filter(([what]) => !told.has(what)).map(([what]) => what),
      ...WATCHED.filter((what) => !w.seen.has(what)),
      ...["vault", "shop", "bio", "sound:churchy"].filter((k) => !kinds.has(k)),
    ];
    const problems: string[] = [];
    if (!UPDATE_GOLDEN && existsSync(GOLDEN)) {
      const want = readFileSync(GOLDEN, "utf8").trimEnd().split("\n");
      const diverged = firstDivergence(want, r.lines);
      if (diverged) {
        problems.push(diverged);
      }
    }
    if (missing.length > 0) {
      problems.push(`Activities the replay no longer reaches: ${missing.join(", ")}.`);
    }
    if (problems.length > 0) {
      throw new Error(problems.join("\n\n"));
    }
    expectGolden(GOLDEN, r.lines.join("\n"));
  }, 120_000);
});

/** A tick line: `<tick> <state hash> <sent hash>`. */
const TICK = /^(\d+) (\S+) (\S+)$/;
/** A checkpoint's `part=hash` pairs; a part name may hold spaces. */
const PART = /(\S[^=]*?)=([0-9a-f]{8})(?= |$)/g;

/** The first tick whose hashes differ and the parts that differ at the next checkpoint, or null. */
function firstDivergence(want: string[], got: string[]): string | null {
  const ticks = (lines: string[]) =>
    new Map(
      lines.flatMap((l) => {
        const m = TICK.exec(l);
        return m ? [[Number(m[1]), { state: m[2], sent: m[3] }] as const] : [];
      }),
    );
  const a = ticks(want);
  const b = ticks(got);
  let first: number | null = null;
  for (let t = 0; t < Math.max(a.size, b.size); t++) {
    const x = a.get(t);
    const y = b.get(t);
    if (x?.state !== y?.state || x?.sent !== y?.sent) {
      first = t;
      break;
    }
  }
  if (first === null) {
    const setup = (lines: string[]) => lines.find((l) => l.startsWith("setup "));
    return setup(want) === setup(got)
      ? null
      : "The replay's setup messages differ from tests/golden/replay.txt.";
  }
  const x = a.get(first);
  const y = b.get(first);
  const what = [
    x?.state !== y?.state ? "the world state" : null,
    x?.sent !== y?.sent ? "the messages sent" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const at = Math.ceil((first + 1) / REPLAY_CHECKPOINT) * REPLAY_CHECKPOINT - 1;
  const parts = (lines: string[]) => {
    const line = lines.find((l) => l.startsWith(`@${at} `)) ?? "";
    return new Map(
      [...line.slice(`@${at} `.length).matchAll(PART)].map((m) => [m[1] as string, m[2] as string]),
    );
  };
  const pa = parts(want);
  const pb = parts(got);
  const changed = [...new Set([...pa.keys(), ...pb.keys()])].filter((k) => pa.get(k) !== pb.get(k));
  return [
    `The replay diverges from tests/golden/replay.txt at tick ${first}: ${what} changed.`,
    `Parts of the state that differ at the checkpoint after tick ${at}: ${changed.join(", ") || "(none)"}.`,
    `See what changed: SSO_REPLAY_DUMP=${first}:/tmp/after.txt bun test tests/replay.test.ts, the same on the commit before to /tmp/before.txt, then diff them.`,
    "If the change is intended, rerun with SSO_UPDATE_GOLDEN=1 and add a differences entry when it differs from 1.6.",
  ].join("\n");
}
