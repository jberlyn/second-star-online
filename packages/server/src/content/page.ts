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
import { draftGatheringChange, gatheringView } from "./gathering-page.ts";
import {
  datasetParts,
  KEYED_LISTS,
  keyField,
  partOf,
  READ_ONLY_DATASETS,
  type RowRef,
  rowLabel,
  rowName,
  rowSchema,
  rowValue,
  sameRow,
} from "./rows.ts";
import type { ContentActor, ContentResult, ContentService } from "./service.ts";
import { draftSkillChange, draftSkillRemoval, skillsView, skillUsage } from "./skills-page.ts";
import type { ContentWorld, Removal } from "./world.ts";

/** A wire ref as the service's ref, or null when it names no dataset. */
export function refOf(r: ContentRowRef): RowRef | null {
  return (DATASET_IDS as readonly string[]).includes(r.dataset)
    ? { dataset: r.dataset as DatasetId, part: r.part, key: r.key }
    : null;
}

/** A row's revision, where a change to it must name one (a balance row). */
function revisionOf(service: ContentService, ref: RowRef): { revision?: string } {
  const revision = service.rowRevision(ref);
  return revision === null ? {} : { revision };
}

/**
 * Why a change to `ref` is refused because it does not name the row as it is now, or null. Only
 * balance rows carry a revision; a change that names none, or another, is refused.
 */
function staleRow(service: ContentService, ref: RowRef, expect: string | undefined): string | null {
  const revision = service.rowRevision(ref);
  if (revision === null && expect !== undefined) {
    // It had a revision when it was opened, and the row has gone since (a discarded definition).
    return `${rowName(ref)} is gone since you opened it: open it again before saving.`;
  }
  if (revision === null || revision === expect) {
    return null;
  }
  // An item's catalogue row (and a monster's species record, issue #31) is checked when the editor
  // names the revision it opened (the Content page always does); a change naming none (a script, a
  // test) is not refused.
  // So are a skill and the gathering sections (issue #38), and every row the editor pages' forms
  // fingerprint only for themselves.
  if (
    (service.plainRevision(ref) ||
      (ref.dataset === "items" && ref.part === "items") ||
      (ref.dataset === "monsters" && ref.part === "monsters") ||
      (ref.dataset === "classes" && ref.part === "skills") ||
      ref.dataset === "gather") &&
    expect === undefined
  ) {
    return null;
  }
  return `${rowName(ref)} changed since you opened it: open it again before saving.`;
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
      ...revisionOf(service, d),
      ...(d.op === "set" && d.key !== null && rowValue(service.publishedContent(), d) === undefined
        ? { added: true as const }
        : {}),
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
      loggedOut: p.loggedOut,
    })),
    packs: service
      .installedPacks()
      .map(({ artDir: _art, filesDir: _files, removals: _removals, ...p }) => p),
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
      schema: rowSchema(ref.dataset, ref.part),
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
    schema: rowSchema(ref.dataset, ref.part),
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
  const optional = field === null && partOf(ref.dataset, ref.part)?.optional === true;
  if (packValue === undefined && published === undefined && !d) {
    const layer = service.operatorRows().find((r) => sameRow(r, ref));
    // An optional section the world leaves out (a casino game) still opens, to be added.
    if (!layer && !optional) {
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
    schema: rowSchema(ref.dataset, ref.part),
    ...(optional ? { optional: true } : {}),
    ...revisionOf(service, ref),
    ...(ref.dataset === "npcFiles" && ref.key && service.npcEditorSaves().has(ref.key.toLowerCase())
      ? {
          note: "This NPC has a live save (from the Talk & Shops tab or the Creatures tab), which is what plays: change it there, or this row has no effect.",
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
      | "contentPacks"
      | "contentPackApply"
      | "contentPackRemove"
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
      | "contentClassUsage"
      | "contentClassRemove"
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
      | "contentTile"
      | "contentSoundArt"
      | "contentSound"
      | "contentBalance"
      | "contentBalanceSet"
      | "contentItems"
      | "contentItemSet"
      | "contentNpcFile"
      | "contentNpcFileSet"
      | "contentMonsters"
      | "contentMonsterSet"
      | "contentMonsterSpells"
      | "contentSkills"
      | "contentSkillSet"
      | "contentSkillUsage"
      | "contentSkillRemove"
      | "contentGathering"
      | "contentGatheringSet";
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
  // A class's removal (issue #15).
  "contentClassUsage",
  "contentClassRemove",
  "contentProblems",
  "contentUploadTicket",
  // The Packs page (issue #34).
  "contentPacks",
  "contentPackApply",
  "contentPackRemove",
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
  "contentSoundArt",
  "contentSound",
  "contentBalance",
  "contentBalanceSet",
  "contentItems",
  "contentItemSet",
  "contentMonsters",
  "contentMonsterSet",
  "contentMonsterSpells",
  // The Skills and Gathering pages (issue #38).
  "contentSkills",
  "contentSkillSet",
  "contentSkillUsage",
  "contentSkillRemove",
  "contentGathering",
  "contentGatheringSet",
  // A monster's NPC file sections (issue #31): the game answers these, since they save live.
  "contentNpcFile",
  "contentNpcFileSet",
] as const;

/**
 * A removal intent as the service's removal, with the defaults (retire, clear, despawn, delete,
 * land).
 */
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
    : msg.kind === "monster"
      ? {
          kind: "monster",
          key: msg.key,
          content: msg.content,
          spawns: msg.spawns ?? "remove",
          live: msg.live ?? "despawn",
          npcFile: msg.npcRow ?? "delete",
          replacement,
        }
      : {
          kind: "vehicle",
          key: msg.key,
          content: msg.content,
          riders: msg.riders ?? "land",
          replacement,
        };
}

/**
 * Answers one Content page intent. `loggedOut` is how many players the game logged out for a
 * publish that asked for it (issue #40).
 */
export function contentIntent(
  service: ContentService,
  actor: ContentActor,
  msg: Exclude<ContentIntent, { t: "contentNpcFile" | "contentNpcFileSet" }>,
  world?: ContentWorld,
  loggedOut?: number,
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
    case "contentClassUsage": {
      const r = service.classUsage(msg.code, world);
      return r.ok
        ? { t: "contentClassUsage", seq: msg.seq, usage: r.value }
        : { t: "contentClassUsage", seq: msg.seq, usage: null, error: r.error };
    }
    case "contentClassRemove": {
      const r = service.draftClassRemoval(actor, msg.code, msg.moveTo, world);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value }
        : result(msg.seq, r, "");
    }
    case "contentPacks":
      return { t: "contentPacks", seq: msg.seq, view: service.packsView() };
    case "contentPackApply": {
      if (msg.mode === "cancel") {
        service.cancelImport(actor, msg.importId);
        return { t: "contentPacks", seq: msg.seq, view: service.packsView() };
      }
      const r = service.applyImport(actor, msg.importId, msg.mode);
      return {
        t: "contentPacks",
        seq: msg.seq,
        view: service.packsView(),
        result: r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error },
      };
    }
    case "contentPackRemove": {
      const r = service.removeImportedPack(actor, msg.id);
      return {
        t: "contentPacks",
        seq: msg.seq,
        view: service.packsView(),
        result: r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error },
      };
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
          houseTypes: d.houses.types.map((t) => ({
            house: t.house,
            footprint: t.footprint,
            member: t.ghost.member,
            ...(t.ghost.picture !== undefined ? { picture: t.ghost.picture } : {}),
          })),
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
    case "contentSoundArt":
      return { t: "contentSoundArt", seq: msg.seq, view: service.soundArtView() };
    case "contentBalance":
      return { t: "contentBalance", seq: msg.seq, view: service.balanceView() };
    case "contentBalanceSet": {
      const r = service.draftBalance(actor, {
        part: msg.part,
        key: msg.key,
        op: msg.op,
        data: msg.data ?? null,
        expect: msg.expect,
      });
      return {
        t: "contentBalance",
        seq: msg.seq,
        view: service.balanceView(),
        result: r.ok
          ? { ok: true, text: r.value }
          : { ok: false, text: r.error, ...(r.problems ? { problems: r.problems } : {}) },
      };
    }
    case "contentItems":
      return { t: "contentItems", seq: msg.seq, view: service.itemsView(msg.name) };
    case "contentItemSet": {
      const r = service.draftItemChange(actor, {
        name: msg.name,
        op: msg.op,
        ...(msg.data !== undefined ? { data: msg.data } : {}),
        ...(msg.display !== undefined ? { display: msg.display } : {}),
        ...(msg.copyFrom !== undefined ? { copyFrom: msg.copyFrom } : {}),
        ...(msg.expect !== undefined ? { expect: msg.expect } : {}),
      });
      // The answer shows the item changed (a new one by the name it was made with).
      return {
        t: "contentItems",
        seq: msg.seq,
        view: service.itemsView(msg.name),
        result: r.ok
          ? { ok: true, text: r.value }
          : { ok: false, text: r.error, ...(r.problems ? { problems: r.problems } : {}) },
      };
    }
    case "contentMonsters":
      return { t: "contentMonsters", seq: msg.seq, view: service.monstersView(msg.name) };
    case "contentMonsterSet": {
      const r = service.draftMonsterChange(actor, {
        name: msg.name,
        op: msg.op,
        ...(msg.record !== undefined ? { record: msg.record } : {}),
        ...(msg.data !== undefined ? { data: msg.data } : {}),
        ...(msg.display !== undefined ? { display: msg.display } : {}),
        ...(msg.copyFrom !== undefined ? { copyFrom: msg.copyFrom } : {}),
        ...(msg.expect !== undefined ? { expect: msg.expect } : {}),
      });
      return {
        t: "contentMonsters",
        seq: msg.seq,
        view: service.monstersView(msg.name),
        result: r.ok
          ? { ok: true, text: r.value }
          : { ok: false, text: r.error, ...(r.problems ? { problems: r.problems } : {}) },
      };
    }
    case "contentMonsterSpells": {
      const r = service.draftMonsterSpells(actor, msg.spells, msg.expect);
      return {
        t: "contentMonsters",
        seq: msg.seq,
        view: service.monstersView(),
        result: r.ok
          ? { ok: true, text: r.value }
          : { ok: false, text: r.error, ...(r.problems ? { problems: r.problems } : {}) },
      };
    }
    case "contentSkills":
      return { t: "contentSkills", seq: msg.seq, view: skillsView(service, msg.key) };
    case "contentSkillSet": {
      const r = draftSkillChange(service, actor, {
        key: msg.key,
        op: msg.op,
        ...(msg.data !== undefined ? { data: msg.data } : {}),
        ...(msg.expect !== undefined ? { expect: msg.expect } : {}),
      });
      return {
        t: "contentSkills",
        seq: msg.seq,
        view: skillsView(service, msg.key),
        result: r.ok
          ? { ok: true, text: r.value }
          : { ok: false, text: r.error, ...(r.problems ? { problems: r.problems } : {}) },
      };
    }
    case "contentSkillUsage": {
      const r = skillUsage(service, msg.key, world);
      return r.ok
        ? { t: "contentSkillUsage", seq: msg.seq, usage: r.value }
        : { t: "contentSkillUsage", seq: msg.seq, usage: null, error: r.error };
    }
    case "contentSkillRemove": {
      const r = draftSkillRemoval(service, actor, {
        key: msg.key,
        refs: msg.refs,
        ...(msg.expect !== undefined ? { expect: msg.expect } : {}),
      });
      return {
        t: "contentSkills",
        seq: msg.seq,
        view: skillsView(service, r.ok ? undefined : msg.key),
        result: r.ok
          ? { ok: true, text: r.value }
          : { ok: false, text: r.error, ...(r.problems ? { problems: r.problems } : {}) },
      };
    }
    case "contentGathering":
      return { t: "contentGathering", seq: msg.seq, view: gatheringView(service) };
    case "contentGatheringSet": {
      const r = draftGatheringChange(service, actor, {
        op: msg.op,
        ...(msg.index !== undefined ? { index: msg.index } : {}),
        ...(msg.data !== undefined ? { data: msg.data } : {}),
        ...(msg.expect !== undefined ? { expect: msg.expect } : {}),
      });
      return {
        t: "contentGathering",
        seq: msg.seq,
        view: gatheringView(service),
        result: r.ok
          ? { ok: true, text: r.value }
          : { ok: false, text: r.error, ...(r.problems ? { problems: r.problems } : {}) },
      };
    }
    case "contentSound": {
      const r = service.draftSound(actor, msg.change);
      return r.ok
        ? { t: "contentResult", seq: msg.seq, ok: true, text: r.value.text, sound: r.value.sound }
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
      const stale = staleRow(service, ref, msg.expect);
      if (stale) {
        return { t: "contentResult", seq: msg.seq, ok: false, text: stale };
      }
      return result(
        msg.seq,
        service.draftSet(actor, ref, msg.op, msg.data ?? null),
        `${rowName(ref)} is in the draft.`,
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
      const stale = staleRow(service, ref, msg.expect);
      if (stale) {
        return { t: "contentResult", seq: msg.seq, ok: false, text: stale };
      }
      return result(msg.seq, service.draftDiscardRow(ref), `${rowName(ref)} is out of the draft.`);
    }
    case "contentPublish": {
      return result(
        msg.seq,
        service.publish(actor, msg.draftRev, msg.summary, world, loggedOut),
        loggedOut === undefined
          ? "Published: it is live for everyone."
          : `Published: it is live for everyone. ${loggedOut === 1 ? "1 player was" : `${loggedOut} players were`} logged out for it.`,
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
