/**
 * The Control Panel's Content page on the server: its answers, built from the content service.
 * The game checks the `contentEditor` permission before any of these run.
 */
import {
  type ContentListing,
  type ContentOverview,
  type ContentRowDetail,
  type ContentRowRef,
  type ContentRowStatus,
  type ContentServerMsg,
  DATASET_IDS,
  type DatasetId,
  type InGameMsg,
} from "@secondstaronline/shared";

import {
  KEYED_LISTS,
  keyField,
  READ_ONLY_DATASETS,
  type RowRef,
  rowLabel,
  rowValue,
  sameRow,
} from "./rows.ts";
import type { ContentActor, ContentResult, ContentService } from "./service.ts";

/** A wire ref as the service's ref, or null when it names no dataset. */
export function refOf(r: ContentRowRef): RowRef | null {
  return (DATASET_IDS as readonly string[]).includes(r.dataset)
    ? { dataset: r.dataset as DatasetId, part: r.part, key: r.key }
    : null;
}

export function overviewOf(service: ContentService): ContentOverview {
  const packContent = service.packContent() as unknown as Record<string, Record<string, unknown>>;
  return {
    draft: service.draft().map((d) => ({
      dataset: d.dataset,
      part: d.part,
      key: d.key,
      op: d.op,
      author: d.author,
      updatedAt: d.updatedAt,
    })),
    problems: service.check(),
    history: service.history().map((p) => ({
      id: p.id,
      at: p.at,
      actorName: p.actorName,
      summary: p.summary,
      rows: p.changes.map(rowLabel),
      undoOf: p.undoOf,
      undoneBy: p.undoneBy,
    })),
    packs: service.installedPacks().map(({ artDir: _art, ...p }) => p),
    notices: service.notices().map((n) => ({ ...n })),
    datasets: DATASET_IDS.map((id) => {
      const published = service.publishedContent()[id] as unknown as Record<string, unknown>;
      return {
        id,
        readOnly: READ_ONLY_DATASETS.includes(id),
        parts: Object.keys(packContent[id] ?? {}).map((part) => {
          const keyed = KEYED_LISTS[id]?.[part] !== undefined;
          const value = published[part];
          return { part, keyed, rows: keyed && Array.isArray(value) ? value.length : 1 };
        }),
      };
    }),
    hash: service.store().hash,
  };
}

/** A row's state against the packs and the operator layer. */
function statusOf(service: ContentService, ref: RowRef): ContentRowStatus | null {
  const layer = service.operatorRows().find((r) => sameRow(r, ref));
  const inPack = rowValue(service.packContent(), ref) !== undefined;
  if (!layer) {
    return inPack ? "pack" : null;
  }
  if (layer.op === "remove") {
    return "removed";
  }
  return inPack ? "changed" : "added";
}

export function listingOf(
  service: ContentService,
  ref: { dataset: DatasetId; part: string },
): ContentListing | null {
  const pack = service.packContent()[ref.dataset] as unknown as Record<string, unknown>;
  if (!Object.hasOwn(pack, ref.part)) {
    return null;
  }
  const field = keyField(ref.dataset, ref.part);
  const draft = service.draft();
  const draftOp = (r: RowRef) => draft.find((d) => sameRow(d, r))?.op ?? null;
  if (field === null) {
    const r: RowRef = { dataset: ref.dataset, part: ref.part, key: null };
    return {
      dataset: ref.dataset,
      part: ref.part,
      keyField: null,
      rows: [{ key: null, status: statusOf(service, r) ?? "pack", draft: draftOp(r) }],
    };
  }
  const published =
    (service.publishedContent()[ref.dataset] as unknown as Record<string, unknown[]>)[ref.part] ??
    [];
  const keys = published.map((e) => String((e as Record<string, unknown>)[field]));
  // Removed rows are gone from the published list but still listed, so they can be put back.
  for (const r of service.operatorRows()) {
    if (r.dataset === ref.dataset && r.part === ref.part && r.op === "remove" && r.key !== null) {
      keys.push(r.key);
    }
  }
  // Rows only the draft adds.
  for (const d of draft) {
    if (
      d.dataset === ref.dataset &&
      d.part === ref.part &&
      d.key !== null &&
      !keys.some((k) => k.toLowerCase() === d.key?.toLowerCase())
    ) {
      keys.push(d.key);
    }
  }
  return {
    dataset: ref.dataset,
    part: ref.part,
    keyField: field,
    rows: keys.map((key) => {
      const r: RowRef = { dataset: ref.dataset, part: ref.part, key };
      return { key, status: statusOf(service, r) ?? "added", draft: draftOp(r) };
    }),
  };
}

export function rowDetailOf(service: ContentService, ref: RowRef): ContentRowDetail | null {
  const pack = service.packContent()[ref.dataset] as unknown as Record<string, unknown>;
  if (!Object.hasOwn(pack, ref.part)) {
    return null;
  }
  const field = keyField(ref.dataset, ref.part);
  if ((field === null) !== (ref.key === null)) {
    return null;
  }
  const d = service.draft().find((x) => sameRow(x, ref));
  const packValue = rowValue(service.packContent(), ref);
  const published = rowValue(service.publishedContent(), ref);
  if (packValue === undefined && published === undefined && !d) {
    const layer = service.operatorRows().find((r) => sameRow(r, ref));
    if (!layer) {
      return null;
    }
  }
  return {
    dataset: ref.dataset,
    part: ref.part,
    key: ref.key,
    keyField: field,
    readOnly: READ_ONLY_DATASETS.includes(ref.dataset),
    status: statusOf(service, ref),
    pack: packValue ?? null,
    published: published ?? null,
    draft: d ? { op: d.op, data: d.data, author: d.author } : null,
    ...(ref.dataset === "npcFiles" && ref.key && service.npcEditorSaves().has(ref.key.toLowerCase())
      ? {
          note: "This NPC has a save from the NPC Editor, which is what plays: change it there, or this row has no effect.",
        }
      : {}),
  };
}

const result = (seq: number, r: ContentResult<unknown>, okText: string): ContentServerMsg =>
  r.ok
    ? { t: "contentResult", seq, ok: true, text: okText }
    : {
        t: "contentResult",
        seq,
        ok: false,
        text: r.error,
        ...(r.problems ? { problems: r.problems } : {}),
      };

type ContentIntent = Extract<
  InGameMsg,
  {
    t:
      | "contentOverview"
      | "contentList"
      | "contentRow"
      | "contentDraft"
      | "contentDiscard"
      | "contentPublish"
      | "contentUndo"
      | "contentNotice";
  }
>;

/** The intents this page answers. */
export const CONTENT_INTENTS = [
  "contentOverview",
  "contentList",
  "contentRow",
  "contentDraft",
  "contentDiscard",
  "contentPublish",
  "contentUndo",
  "contentNotice",
] as const;

/** Answers one Content page intent. */
export function contentIntent(
  service: ContentService,
  actor: ContentActor,
  msg: ContentIntent,
): ContentServerMsg {
  switch (msg.t) {
    case "contentOverview":
      return { t: "contentOverview", seq: msg.seq, overview: overviewOf(service) };
    case "contentList": {
      const ref = refOf({ dataset: msg.dataset, part: msg.part, key: null });
      const listing = ref ? listingOf(service, ref) : null;
      return listing
        ? { t: "contentList", seq: msg.seq, listing }
        : {
            t: "contentList",
            seq: msg.seq,
            listing: null,
            error: `There is no ${msg.dataset}/${msg.part}.`,
          };
    }
    case "contentRow": {
      const ref = refOf(msg);
      const row = ref ? rowDetailOf(service, ref) : null;
      return row
        ? { t: "contentRow", seq: msg.seq, row }
        : { t: "contentRow", seq: msg.seq, row: null, error: "There is no such row." };
    }
    case "contentDraft": {
      const ref = refOf(msg);
      if (!ref) {
        return {
          t: "contentResult",
          seq: msg.seq,
          ok: false,
          text: `There is no dataset ${msg.dataset}.`,
        };
      }
      return result(
        msg.seq,
        service.draftSet(actor, ref, msg.op, msg.data ?? null),
        `${rowLabel(ref)} is in the draft.`,
      );
    }
    case "contentDiscard": {
      const ref = refOf(msg);
      if (!ref) {
        return {
          t: "contentResult",
          seq: msg.seq,
          ok: false,
          text: `There is no dataset ${msg.dataset}.`,
        };
      }
      return result(msg.seq, service.draftDiscard(ref), `${rowLabel(ref)} is out of the draft.`);
    }
    case "contentPublish": {
      const seen: (RowRef & { updatedAt: string })[] = [];
      for (const s of msg.seen) {
        const ref = refOf(s);
        if (ref) {
          seen.push({ ...ref, updatedAt: s.updatedAt });
        }
      }
      return result(
        msg.seq,
        service.publish(actor, seen, msg.summary),
        "Published: it is live for everyone.",
      );
    }
    case "contentUndo":
      return result(
        msg.seq,
        service.undo(actor, msg.id),
        "Undone: the rows are back as they were.",
      );
    case "contentNotice": {
      const ref = refOf(msg);
      if (!ref) {
        return {
          t: "contentResult",
          seq: msg.seq,
          ok: false,
          text: `There is no dataset ${msg.dataset}.`,
        };
      }
      return msg.accept
        ? result(msg.seq, service.acceptNotice(actor, ref), "Done: the pack's version is live.")
        : result(msg.seq, service.dismissNotice(actor, ref), "Kept your version.");
    }
  }
}
