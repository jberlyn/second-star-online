/**
 * Migration 77's content half: fishing's catch table becomes a catch pool (`fishing.catches`), and
 * what a cast trains is content (`fishing.trains`). The old `bands` (each `{ lt, fish }`: the fish
 * of the last band in order whose `lt` is above the skill) become one pool row for each run of
 * skill values 0 to 100 that caught the same fish, so a world catches exactly what it caught, and
 * every cast trains as before (`{ cast: true, catch: false }`).
 *
 * It rewrites every stored gathering section as migration 76 does (imported packs, the operator's
 * rows and their base, the draft and the publish log). The release packs ship the fields already.
 * Running it again changes nothing. Runs inside the migration's transaction.
 */
import type { Db } from "./database.ts";
import { rewriteStoredGathering } from "./fishing-cast-content.ts";

type Row = Record<string, unknown>;

const isObject = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);

/** The highest skill value. */
const TOP = 100;

/** The pool rows that catch what `bands` caught at every skill value 0 to 100. */
export function bandsToCatches(bands: unknown): Row[] {
  const rows = Array.isArray(bands)
    ? bands.filter(
        (b): b is { lt: number; fish: string } =>
          isObject(b) && typeof b.lt === "number" && typeof b.fish === "string",
      )
    : [];
  const fishAt = (skill: number) => {
    let fish: string | null = null;
    for (const b of rows) {
      if (skill < b.lt) {
        fish = b.fish;
      }
    }
    return fish === "" ? null : fish;
  };
  const out: Row[] = [];
  let run: { fish: string; from: number } | null = null;
  for (let skill = 0; skill <= TOP + 1; skill++) {
    const fish = skill <= TOP ? fishAt(skill) : null;
    if (run && run.fish === fish) {
      continue;
    }
    if (run) {
      out.push({
        fish: run.fish,
        from: run.from,
        ...(skill <= TOP ? { below: skill } : {}),
        weight: 1,
      });
    }
    run = fish === null ? null : { fish, from: skill };
  }
  return out;
}

/** A gathering section with its fishing given the pool and the training, or null when it has them. */
export function withFishingCatches(gathering: unknown): Row | null {
  if (!isObject(gathering) || !isObject(gathering.fishing)) {
    return null;
  }
  const f = gathering.fishing;
  if ("catches" in f && "trains" in f && !("bands" in f)) {
    return null;
  }
  const { bands, ...rest } = f;
  return {
    ...gathering,
    fishing: {
      ...rest,
      ...("trains" in f ? {} : { trains: { cast: true, catch: false } }),
      ...("catches" in f ? {} : { catches: bandsToCatches(bands) }),
    },
  };
}

export function moveFishingCatches(db: Db): void {
  rewriteStoredGathering(db, withFishingCatches);
}
