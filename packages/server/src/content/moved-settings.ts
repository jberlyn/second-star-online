/**
 * Server Settings that became balance content (issue #19 stage 4): the Items page's death drops
 * (`deathDrops`, `deathDropKind`, `deathDropGoldCap`, `deathDropMinLevel`) and loot decay
 * (`lootDecay`) are now the `balance` dataset's `drops` row, edited on the Balance page.
 *
 * At start, a server whose operator changed any of them has those values moved into a published
 * operator row, logged as the publish "Moved from Server Settings" (undoable like any publish),
 * and the settings rows are deleted in the same transaction, so the move runs once. A value the
 * old setting would have ignored (not valid JSON, or outside its limits) never played, so it is
 * dropped with the rest, as the settings loader dropped it.
 */

import { z } from "zod";

import { BALANCE_DROP_KIND, BALANCE_DROP_WHO, BALANCE_LIMITS } from "@secondstaronline/data/schema";

import type { Db } from "../persistence/database.ts";
import { rowHash } from "./rows.ts";
import type { ContentActor, ContentService } from "./service.ts";

/** Each moved setting: its old schema (as Server Settings checked it) and its field in `drops`. */
const MOVED = {
  deathDrops: { field: "who", schema: z.enum(BALANCE_DROP_WHO) },
  deathDropKind: { field: "kind", schema: z.enum(BALANCE_DROP_KIND) },
  deathDropGoldCap: {
    field: "goldCap",
    schema: z.number().int().min(BALANCE_LIMITS.goldCap.min).max(BALANCE_LIMITS.goldCap.max),
  },
  deathDropMinLevel: {
    field: "minLevel",
    schema: z.number().int().min(BALANCE_LIMITS.level.min).max(BALANCE_LIMITS.level.max),
  },
  lootDecay: {
    field: "lootDecaySeconds",
    schema: z
      .number()
      .int()
      .min(BALANCE_LIMITS.lootSeconds.min)
      .max(BALANCE_LIMITS.lootSeconds.max),
  },
} as const;

export const MOVED_SETTING_KEYS = Object.keys(MOVED) as (keyof typeof MOVED)[];

/** Who the move is logged as. */
export const MOVE_ACTOR: ContentActor = { accountId: "system", name: "system" };

export const MOVE_SUMMARY = "Moved from Server Settings: death drops and loot decay";

/** The values a settings table holds for the moved settings, by `drops` field (valid ones only). */
export function movedValues(db: Db): { found: boolean; values: Record<string, unknown> } {
  const rows = db
    .query<{ key: string; value: string }, []>(
      `SELECT key, value FROM settings WHERE key IN (${MOVED_SETTING_KEYS.map((k) => `'${k}'`).join(", ")})`,
    )
    .all();
  const values: Record<string, unknown> = {};
  for (const r of rows) {
    const m = MOVED[r.key as keyof typeof MOVED];
    try {
      const parsed = m.schema.safeParse(JSON.parse(r.value));
      if (parsed.success) {
        values[m.field] = parsed.data;
      }
    } catch {
      // Not JSON: the settings loader ignored it, so it never played.
    }
  }
  return { found: rows.length > 0, values };
}

const DROPS = { dataset: "balance", part: "drops", key: null } as const;

/**
 * Moves the operator's death-drop and loot settings into the `balance` dataset's `drops` row, as
 * a logged publish, and deletes the settings rows, all under the write lock (two servers starting
 * together move them once). Nothing happens when none is stored.
 *
 * - The values go over the row as it plays now (the pack's, else the engine's); values that
 *   change nothing there are dropped without a publish.
 * - A `drops` row the operator already has (set on the Balance page after a move that could not
 *   publish) already holds what they want: the old settings are dropped without a publish.
 * - An open draft of the row is rebased onto the moved values; a field both changed keeps the
 *   draft's and is named in the log.
 * - If the move cannot publish, the settings stay, their values play from memory, and the next
 *   start tries again; the log names why.
 *
 * Returns lines for the server log.
 */
export function moveDropSettings(db: Db, content: ContentService): string[] {
  const keys = MOVED_SETTING_KEYS.map((k) => `'${k}'`).join(", ");
  let moving: Record<string, unknown> = {};
  let data: unknown = null;
  const result = content.publishMoved(MOVE_ACTOR, MOVE_SUMMARY, (current, operatorRows) => {
    const { found, values } = movedValues(db);
    if (!found) {
      return null;
    }
    const alongside = () => db.run(`DELETE FROM settings WHERE key IN (${keys})`);
    if (
      Object.keys(values).length === 0 ||
      operatorRows.some((r) => r.dataset === "balance" && r.part === "drops")
    ) {
      return { rows: [], alongside };
    }
    const now = current.balance?.drops ?? {};
    const next = { ...now, ...values };
    // Values equal to what plays (an operator who set a setting back to its default) move
    // nothing: a publish would mark the row changed and stop it following the pack.
    if (rowHash(next) === rowHash(now)) {
      return { rows: [], alongside };
    }
    moving = values;
    data = next;
    return { rows: [{ ref: DROPS, data }], alongside };
  });
  if (!result.ok) {
    content.holdMoved([
      { ref: DROPS, data: data ?? { ...content.store().balance.drops, ...movedValues(db).values } },
    ]);
    const why = (result.problems ?? []).map((p) => `${p.where}: ${p.message}`).join("; ");
    return [
      `content: could not move the death-drop and loot settings to the Balance page (${result.error}${why ? `: ${why}` : ""}); they play as before and the next start tries again`,
    ];
  }
  if (result.value.id === null) {
    return [];
  }
  return [
    `content: moved the death-drop and loot settings to the Balance page (${Object.keys(moving).join(", ")})`,
    ...result.value.conflicts.map(
      (c) =>
        `content: the draft also changes ${c}: the draft keeps its value, so publishing it replaces the moved one`,
    ),
  ];
}
