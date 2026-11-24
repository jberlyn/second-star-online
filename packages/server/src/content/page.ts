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

import { SPRITE_MAX_SIDE, UPLOAD_MAX_BYTES } from "./art.ts";
import {
  datasetParts,
  KEYED_LISTS,
  keyField,
  partOf,
  READ_ONLY_DATASETS,
  type RowRef,
  rowLabel,
  rowValue,
  sameRow,
} from "./rows.ts";
import type { ContentActor, ContentResult, ContentService } from "./service.ts";
import type { ContentWorld, Removal } from "./world.ts";

/** A wire ref as the service's ref, or null when it names no dataset. */
export function refOf(r: ContentRowRef): RowRef | null {
  return (DATASET_IDS as readonly string[]).includes(r.dataset)
    ? { dataset: r.dataset as DatasetId, part: r.part, key: r.key }
    : null;
}

export function overviewOf(service: ContentService, world?: ContentWorld): ContentOverview {
  return {
    draft: service.draft().map((d) => ({
      dataset: d.dataset,
      part: d.part,
      key: d.key,
      op: d.op,
      author: d.author,
      updatedAt: d.updatedAt,
    })),
    problems: [...service.check(), ...service.draftMapProblems(world)],
    history: service.history().map((p) => ({
      id: p.id,
      at: p.at,
      actorName: p.actorName,
      summary: p.summary,
      rows: p.changes.map(rowLabel),
      undoOf: p.undoOf,
      undoneBy: p.undoneBy,
      cleanup: p.cleanup,
    })),
    packs: service.installedPacks().map(({ artDir: _art, ...p }) => p),
    notices: service.notices().map((n) => ({ ...n })),
    datasets: DATASET_IDS.map((id) => {
      const published = service.publishedContent()[id] as unknown as Record<string, unknown>;
      return {
        id,
        readOnly: READ_ONLY_DATASETS.includes(id),
        // Every field the schema has, an optional section the world leaves out included (0 rows).
        parts: datasetParts(id).map(({ part }) => {
          const keyed = KEYED_LISTS[id]?.[part] !== undefined;
          const value = published[part];
          return {
            part,
            keyed,
            rows: keyed && Array.isArray(value) ? value.length : value === undefined ? 0 : 1,
          };
        }),
      };
    }),
    hash: service.store().hash,
    draftRev: service.draftRev(),
    removals: service.removals(world),
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
  if (!partOf(ref.dataset, ref.part)) {
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
  if (!partOf(ref.dataset, ref.part)) {
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
    // The world keeps its own quest lines once it has started (a finished quest rolls the next
    // from the pools), so these only seed a new world.
    ...(ref.dataset === "quests" && ref.part === "current"
      ? {
          note: "These are the quests a new world starts with. A world that has started keeps its own (each finished quest rolls the next from quests/pools), so a change here only reaches a new database.",
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
      | "contentNotice"
      | "contentUsage"
      | "contentRemove"
      | "contentProblems"
      | "contentUploadTicket"
      | "contentItemArt"
      | "contentPicture"
      | "contentWornArt"
      | "contentWornSheet"
      | "contentWorn"
      | "contentBodyArt"
      | "contentBodySheet"
      | "contentBody"
      | "contentFxArt"
      | "contentFxSheet"
      | "contentFx"
      | "contentTileArt"
      | "contentTileSheet"
      | "contentTile";
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
  "contentUsage",
  "contentRemove",
  "contentProblems",
  "contentUploadTicket",
  "contentItemArt",
  "contentPicture",
  "contentWornArt",
  "contentWornSheet",
  "contentWorn",
  "contentBodyArt",
  "contentBodySheet",
  "contentBody",
  "contentFxArt",
  "contentFxSheet",
  "contentFx",
  "contentTileArt",
  "contentTileSheet",
  "contentTile",
] as const;

/** A removal intent as the service's removal, with the defaults (retire, clear, despawn, delete). */
export function removalOf(msg: Extract<InGameMsg, { t: "contentRemove" }>): Removal {
  const replacement = msg.replacement?.trim() || null;
  return msg.kind === "item"
    ? {
        kind: "item",
        key: msg.key,
        content: msg.content,
        copies: msg.copies ?? "retire",
        replacement,
        refundGold: msg.refundGold ?? 0,
      }
    : {
        kind: "monster",
        key: msg.key,
        content: msg.content,
        spawns: msg.spawns ?? "remove",
        live: msg.live ?? "despawn",
        npcFile: msg.npcRow ?? "delete",
        replacement,
      };
}

/** Answers one Content page intent. */
export function contentIntent(
  service: ContentService,
  actor: ContentActor,
  msg: ContentIntent,
  world?: ContentWorld,
): ContentServerMsg {
  switch (msg.t) {
    case "contentOverview":
      return { t: "contentOverview", seq: msg.seq, overview: overviewOf(service, world) };
    case "contentUsage": {
      const r = service.usage(msg.kind, msg.key, world);
      return r.ok
        ? {
            t: "contentUsage",
            seq: msg.seq,
            usage: { ...r.value, pending: r.value.pending !== null },
          }
        : { t: "contentUsage", seq: msg.seq, usage: null, error: r.error };
    }
    case "contentRemove": {
      const r = service.draftRemoval(actor, removalOf(msg), world);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value }
        : result(msg.seq, r, "");
    }
    case "contentUploadTicket":
      return {
        t: "contentUploadTicket",
        seq: msg.seq,
        ticket: service.uploadTicket(actor),
        maxBytes: UPLOAD_MAX_BYTES,
      };
    case "contentItemArt": {
      const d = service.draftContent();
      return {
        t: "contentItemArt",
        seq: msg.seq,
        view: {
          items: d.items.items,
          art: d.art.items,
          currency: d.bindings.currency.item ?? null,
          maxSide: SPRITE_MAX_SIDE,
          packPictures: service.packPictures(),
        },
      };
    }
    case "contentPicture": {
      const r = service.draftPicture(actor, msg.change);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value }
        : result(msg.seq, r, "");
    }
    case "contentWornArt":
      return { t: "contentWornArt", seq: msg.seq, view: service.wornArtView() };
    case "contentWornSheet": {
      const r = service.wornSheet(msg.sheet);
      return r.ok
        ? { t: "contentWornSheet", seq: msg.seq, frames: r.frames }
        : { t: "contentWornSheet", seq: msg.seq, frames: null, error: r.error };
    }
    case "contentWorn": {
      const r = service.draftWorn(actor, msg.change);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value }
        : result(msg.seq, r, "");
    }
    case "contentBodyArt":
      return { t: "contentBodyArt", seq: msg.seq, view: service.bodyArtView() };
    case "contentBodySheet": {
      const r = service.bodySheet(msg.sheet);
      return r.ok
        ? { t: "contentBodySheet", seq: msg.seq, frames: r.frames, cell: r.cell }
        : { t: "contentBodySheet", seq: msg.seq, frames: null, error: r.error };
    }
    case "contentBody": {
      const r = service.draftBody(actor, msg.change);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value.text, body: r.value.body }
        : result(msg.seq, r, "");
    }
    case "contentFxArt":
      return { t: "contentFxArt", seq: msg.seq, view: service.fxArtView() };
    case "contentFxSheet": {
      const r = service.fxSheet(msg.sheet, {
        across: msg.across,
        runRows: msg.runRows,
        trailRows: msg.trailRows,
      });
      return r.ok
        ? { t: "contentFxSheet", seq: msg.seq, frames: r.frames, trail: r.trail, cell: r.cell }
        : { t: "contentFxSheet", seq: msg.seq, frames: null, error: r.error };
    }
    case "contentFx": {
      const r = service.draftFx(actor, msg.change);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value.text, run: r.value.run }
        : result(msg.seq, r, "");
    }
    case "contentTileArt":
      return { t: "contentTileArt", seq: msg.seq, view: service.tileArtView(world) };
    case "contentTileSheet": {
      const r = service.tileSheet(msg.sheet, msg.transparency, world);
      return r.ok
        ? { t: "contentTileSheet", seq: msg.seq, cells: r.cells, grid: r.grid }
        : { t: "contentTileSheet", seq: msg.seq, cells: null, error: r.error };
    }
    case "contentTile": {
      const r = service.draftTile(actor, msg.change, world);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value.text, codes: r.value.codes }
        : result(msg.seq, r, "");
    }
    case "contentProblems": {
      const p = service.problems(world);
      return { t: "contentProblems", seq: msg.seq, content: p.content, world: p.world };
    }
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
      return result(
        msg.seq,
        service.publish(actor, msg.draftRev, msg.summary, world),
        "Published: it is live for everyone.",
      );
    }
    case "contentUndo":
      return result(
        msg.seq,
        service.undo(actor, msg.id, world),
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
        ? result(
            msg.seq,
            service.acceptNotice(actor, ref, world),
            "Done: the pack's version is live.",
          )
        : result(msg.seq, service.dismissNotice(actor, ref), "Kept your version.");
    }
  }
}
