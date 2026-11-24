/**
 * The Control Panel's Balance page on the server (issue #19): the rows of the `balance` dataset
 * it edits, grouped as the page shows them, each with its fields and their limits, and the view
 * built from the content store's layers. Pure apart from what it is handed.
 *
 * The page edits ordinary content rows: its changes go into the shared draft and are published,
 * undone and noticed like any other row (the Content page's JSON editor edits the same rows).
 */
import { BALANCE_LIMITS } from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  BALANCE_VEHICLE_ORDER,
  type BalanceFieldView,
  type BalanceGroupView,
  type BalanceRowView,
  type ContentData,
} from "@secondstaronline/shared";

import { type RowRef, rowHash, rowValue, sameRow } from "./rows.ts";

/** A row the page edits: where it is, what it is called and the values it shows. */
export interface BalanceRowDef {
  part: string;
  key: string | null;
  label: string;
  fields: BalanceFieldView[];
}

export interface BalanceGroupDef {
  id: string;
  title: string;
  help: string;
  rows: BalanceRowDef[];
}

const field = (
  path: string[],
  label: string,
  unit: BalanceFieldView["unit"],
  limits: { min: number; max: number },
  help?: string,
): BalanceFieldView => ({
  path,
  label,
  unit,
  min: limits.min,
  max: limits.max,
  ...(help ? { help } : {}),
});

/** The page's groups, in order. Each later stage of issue #19 adds its group here. */
export const BALANCE_GROUPS: readonly BalanceGroupDef[] = [
  {
    id: "vehicles",
    title: "Vehicles",
    help: "Hulls, hull wear and repair, and the Battleship's cannon (SSO additions: 1.6 had no hulls and never fired its cannon).",
    rows: [
      ...BALANCE_VEHICLE_ORDER.map((vehicle) => ({
        part: "hulls",
        key: vehicle,
        label: `${vehicle} hull`,
        fields: [
          field(
            ["hull"],
            "Full hull",
            "count",
            BALANCE_LIMITS.hull,
            "Hits on a rider wear the hull, never the rider. At 0 the vehicle is lost and the rider dies.",
          ),
        ],
      })),
      {
        part: "vehicles",
        key: null,
        label: "Hull wear and repair",
        fields: [
          field(
            ["hullHit"],
            "Hull taken by one hit",
            "count",
            BALANCE_LIMITS.hullHit,
            "What one arrow or harmful spell takes off a rider's hull, whatever the attacker's level.",
          ),
          field(
            ["repairPerMinute"],
            "Hull mended each minute parked",
            "count",
            BALANCE_LIMITS.repairPerMinute,
            "A parked vehicle regains this for each whole minute, up to its full hull.",
          ),
        ],
      },
      {
        part: "cannon",
        key: null,
        label: "Battleship cannon",
        fields: [
          field(["damage", "flat"], "Damage", "count", BALANCE_LIMITS.flat),
          field(
            ["damage", "randomN"],
            "plus random(n)",
            "random",
            BALANCE_LIMITS.randomN,
            "A cannonball takes the damage plus a roll of 1 to n (0 rolls nothing) off a player's HP, a hull or a monster.",
          ),
          field(["reloadFrames"], "Reload", "frames", { min: 1, max: BALANCE_LIMITS.frames.max }),
        ],
      },
    ],
  },
];

/** The rows the page edits. */
export function balanceRowDefs(): BalanceRowDef[] {
  return BALANCE_GROUPS.flatMap((g) => g.rows);
}

/** The page's row named by a part and key (key case ignored), or undefined. */
export function balanceRowDef(part: string, key: string | null): BalanceRowDef | undefined {
  const ref: RowRef = { dataset: "balance", part, key };
  return balanceRowDefs().find((r) => sameRow({ dataset: "balance", ...r }, ref));
}

/** The engine's default for a row. */
export function engineValue(def: BalanceRowDef): unknown {
  const v = rowValue({ balance: BALANCE_DEFAULTS } as unknown as Partial<ContentData>, {
    dataset: "balance",
    part: def.part,
    key: def.key,
  });
  return structuredClone(v);
}

/** What the view is built from: the content store's layers for the balance rows. */
export interface BalanceLayers {
  pack: ContentData;
  published: ContentData;
  draft: ContentData;
  /** The operator rows that are published (`set` or removal markers). */
  operatorRows: readonly (RowRef & { op: "set" | "remove" })[];
  /** The draft's changes. */
  draftRows: readonly (RowRef & { op: "set" | "remove" | "revert" })[];
  notices: readonly (RowRef & { packName: string; packVersion: string; now: unknown })[];
  /** Draft changes outside the balance dataset. */
  otherDraft: number;
}

/**
 * A row as the page last showed it: its draft value, the draft's change and whether it is
 * published with an operator change. A save whose `expect` differs is refused.
 */
export function balanceFingerprint(def: BalanceRowDef, l: BalanceLayers): string {
  const ref: RowRef = { dataset: "balance", part: def.part, key: def.key };
  return rowHash({
    draft: rowValue(l.draft, ref) ?? null,
    pending: l.draftRows.find((d) => sameRow(d, ref))?.op ?? null,
    edited: l.operatorRows.some((r) => sameRow(r, ref)),
  });
}

/** The Balance page's view. */
export function balanceView(l: BalanceLayers): { groups: BalanceGroupView[]; otherDraft: number } {
  const groups = BALANCE_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    help: g.help,
    rows: g.rows.map((def): BalanceRowView => {
      const ref: RowRef = { dataset: "balance", part: def.part, key: def.key };
      const engine = engineValue(def);
      const notice = l.notices.find((n) => sameRow(n, ref));
      return {
        part: def.part,
        key: def.key,
        label: def.label,
        fields: def.fields,
        engine,
        pack: rowValue(l.pack, ref) ?? null,
        published: rowValue(l.published, ref) ?? engine,
        draft: rowValue(l.draft, ref) ?? engine,
        edited: l.operatorRows.some((r) => sameRow(r, ref)),
        pending: l.draftRows.find((d) => sameRow(d, ref))?.op ?? null,
        fingerprint: balanceFingerprint(def, l),
        notice: notice
          ? { packName: notice.packName, packVersion: notice.packVersion, now: notice.now }
          : null,
      };
    }),
  }));
  return { groups, otherDraft: l.otherDraft };
}
