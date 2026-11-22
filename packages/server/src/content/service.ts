/**
 * The live content store's service (issue #27). It builds the store from the installed packs
 * and the operator layer at start-up, keeps the shared draft, publishes it (one transaction, one
 * publish-log entry, then the store is rebuilt and swapped in place), undoes a publish as a
 * whole, and lists the rows a newer pack version changed under an operator's change.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { comparePackVersions } from "@secondstaronline/data/schema";
import {
  buildContentStore,
  CONTENT_FORMAT,
  type ContentData,
  type ContentStore,
  DATASET_IDS,
  type DatasetId,
  SERVER_ONLY_DATASETS,
} from "@secondstaronline/shared";

import { insertAudit } from "../persistence/admin.ts";
import {
  clearDraft,
  contentRows,
  type DraftRow,
  deleteContentRow,
  deleteDraftRow,
  draftRows,
  type InstalledPack,
  insertPublish,
  installedPacks,
  type PublishChange,
  type PublishedState,
  publishById,
  recentPublishes,
  type StoredContentRow,
  type StoredPublish,
  setPackVersion,
  upsertContentRow,
  upsertDraftRow,
} from "../persistence/content.ts";
import type { Db } from "../persistence/database.ts";
import { type LoadedPack, readPackBlob, readPackDir } from "./packs.ts";
import {
  applyRows,
  keyField,
  type LayerRow,
  mergePacks,
  missingDatasets,
  READ_ONLY_DATASETS,
  type RowRef,
  rowHash,
  rowLabel,
  rowValue,
  sameRow,
} from "./rows.ts";
import { type ContentProblem, checkStore, schemaProblems } from "./validate.ts";

/** Who made a change. */
export interface ContentActor {
  accountId: string;
  name: string;
}

/** The store as clients receive it: every dataset but the server-only ones. */
export interface ClientCopy {
  hash: string;
  /** The JSON the client fetches. */
  json: string;
  /** The same JSON, gzipped. */
  gzip: Uint8Array<ArrayBuffer>;
}

/** An installed pack as the Content page lists it. */
export interface PackInfo {
  id: string;
  /** The folder of the pack's art and sounds, or null when it brings none. */
  artDir: string | null;
  name: string;
  version: string;
  source: "release" | "imported";
  /** The version recorded before this start, when a release brought a different one. */
  updatedFrom: string | null;
}

/** A row a newer pack version changed after an operator changed or removed it. */
export interface PackNotice extends RowRef {
  packName: string;
  packVersion: string;
  /** The pack row the operator's change was based on (null if the pack had no such row). */
  was: unknown;
  /** The pack row now (null if the pack no longer has it). */
  now: unknown;
  /** The operator's row (null for a removal marker). */
  yours: unknown;
  yoursOp: "set" | "remove";
}

export type ContentResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string; problems?: ContentProblem[] };

const fail = (
  error: string,
  problems?: ContentProblem[],
): { ok: false; error: string; problems?: ContentProblem[] } =>
  problems ? { ok: false, error, problems } : { ok: false, error };

/** The JSON clients receive, and its hash. */
export function clientCopyOf(data: ContentData): ClientCopy {
  const copy: Record<string, unknown> = {};
  for (const id of DATASET_IDS) {
    if (!(SERVER_ONLY_DATASETS as readonly string[]).includes(id)) {
      copy[id] = data[id];
    }
  }
  const body = JSON.stringify(copy);
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const json = `{"format":${CONTENT_FORMAT},"hash":"${hash}","data":${body}}`;
  return { hash, json, gzip: new Uint8Array(gzipSync(json)) };
}

const toLayer = (r: {
  dataset: DatasetId;
  part: string;
  key: string | null;
  op: "set" | "remove";
  data: unknown;
}): LayerRow => ({
  dataset: r.dataset,
  part: r.part,
  key: r.key,
  op: r.op,
  data: r.data,
});

/** A draft row as the layer row it becomes (null for a revert: the operator row goes). */
const draftLayer = (r: DraftRow): LayerRow | null =>
  r.op === "revert"
    ? null
    : { dataset: r.dataset, part: r.part, key: r.key, op: r.op, data: r.data };

export interface ContentServiceOptions {
  db: Db;
  now: () => string;
  /** The folders of the packs that ship in the release, by pack id. */
  releasePacks: Readonly<Record<string, string>>;
  /** Called after each publish or undo swaps the store in (the server tells clients). */
  onPublish?: (store: ContentStore) => void;
  log?: (line: string) => void;
}

export class ContentService {
  private readonly db: Db;
  private readonly now: () => string;
  private readonly onPublish: (store: ContentStore) => void;
  private readonly log: (line: string) => void;
  /** The packs merged in install order, without the operator layer. */
  private packData: ContentData;
  private packs: PackInfo[];
  private packKeys: { items: Set<string>; monsters: Set<string>; npcFiles: Set<string> };
  private published: ContentData;
  private copy: ClientCopy;
  private current: ContentStore;

  constructor(opts: ContentServiceOptions) {
    this.db = opts.db;
    this.now = opts.now;
    this.onPublish = opts.onPublish ?? (() => {});
    this.log = opts.log ?? (() => {});
    const { data, packs } = this.loadPacks(opts.releasePacks);
    this.packData = data;
    this.packs = packs;
    this.packKeys = {
      items: new Set(data.items.items.map((i) => i.name.toLowerCase())),
      monsters: new Set(data.monsters.monsters.map((m) => m.name.toLowerCase())),
      npcFiles: new Set(data.npcFiles.files.map((f) => f.name.toLowerCase())),
    };
    this.published = applyRows(data, contentRows(this.db).map(toLayer));
    const problems = schemaProblems(this.published);
    if (problems.length > 0) {
      throw new Error(
        `the operator's content changes no longer match the schemas:\n${problems
          .map((p) => `  ${p.where}: ${p.message}`)
          .join("\n")}`,
      );
    }
    this.copy = clientCopyOf(this.published);
    this.current = buildContentStore(this.published, this.copy.hash);
  }

  /** Reads every installed pack, records release versions, and merges them. */
  private loadPacks(releasePacks: Readonly<Record<string, string>>): {
    data: ContentData;
    packs: PackInfo[];
  } {
    const loaded: LoadedPack[] = [];
    const packs: PackInfo[] = [];
    for (const p of installedPacks(this.db)) {
      const pack = this.readInstalled(p, releasePacks);
      const updatedFrom =
        p.version !== null && p.version !== pack.manifest.version ? p.version : null;
      if (p.version !== pack.manifest.version || p.name !== pack.manifest.name) {
        setPackVersion(this.db, p.id, pack.manifest.name, pack.manifest.version);
        // The first start after the migration records the version quietly; a release that brings
        // another version says so.
        if (p.version !== null) {
          this.log(
            `content: ${pack.manifest.name} ${comparePackVersions(pack.manifest.version, p.version) > 0 ? "updated" : "changed"} from v${p.version} to v${pack.manifest.version}`,
          );
        }
      }
      loaded.push(pack);
      packs.push({
        id: p.id,
        artDir: pack.artDir,
        name: pack.manifest.name,
        version: pack.manifest.version,
        source: p.source,
        updatedFrom,
      });
    }
    const merged = mergePacks(loaded.map((l) => l.data));
    const missing = missingDatasets(merged);
    if (missing.length > 0) {
      throw new Error(
        `the installed packs leave out ${missing.join(", ")}: a server needs a pack with every dataset (the Classic pack)`,
      );
    }
    return { data: merged as ContentData, packs };
  }

  private readInstalled(
    p: InstalledPack,
    releasePacks: Readonly<Record<string, string>>,
  ): LoadedPack {
    if (p.source === "imported") {
      if (!p.data) {
        throw new Error(`content pack ${p.id} is imported but its data is missing`);
      }
      return readPackBlob(p.data);
    }
    const dir = releasePacks[p.id];
    if (!dir) {
      throw new Error(`content pack ${p.id} is installed but this release does not ship it`);
    }
    return readPackDir(dir);
  }

  /** The published store. */
  store(): ContentStore {
    return this.current;
  }

  /** The published store as clients receive it. */
  clientCopy(): ClientCopy {
    return this.copy;
  }

  installedPacks(): readonly PackInfo[] {
    return this.packs;
  }

  /** The merged packs without the operator layer. */
  packContent(): ContentData {
    return this.packData;
  }

  /** The published store's datasets. */
  publishedContent(): ContentData {
    return this.published;
  }

  /** The operator layer. */
  operatorRows(): StoredContentRow[] {
    return contentRows(this.db);
  }

  /** The shared draft. */
  draft(): DraftRow[] {
    return draftRows(this.db);
  }

  /** The store the draft would publish. */
  draftContent(draft: readonly DraftRow[] = this.draft()): ContentData {
    let layer = contentRows(this.db);
    for (const d of draft) {
      layer = layer.filter((r) => !sameRow(r, d));
    }
    const rows = [
      ...layer.map(toLayer),
      ...draft.flatMap((d) => {
        const l = draftLayer(d);
        return l ? [l] : [];
      }),
    ];
    return applyRows(this.packData, rows);
  }

  /** The draft's pre-publish checks: schemas, then key rules and cross-references. */
  check(draft: readonly DraftRow[] = this.draft()): ContentProblem[] {
    return checkStore(this.draftContent(draft), this.published, this.packKeys);
  }

  /** Checks that a ref names a row an operator may change. */
  private refError(ref: RowRef, op: DraftRow["op"]): string | null {
    if (!(DATASET_IDS as readonly string[]).includes(ref.dataset)) {
      return `there is no dataset ${ref.dataset}`;
    }
    if (READ_ONLY_DATASETS.includes(ref.dataset)) {
      return `${ref.dataset} is built from the art and cannot be changed here`;
    }
    const ds = this.packData[ref.dataset] as unknown as Record<string, unknown>;
    if (!(ref.part in ds)) {
      return `${ref.dataset} has no field ${ref.part}`;
    }
    const field = keyField(ref.dataset, ref.part);
    if (field === null && ref.key !== null) {
      return `${ref.dataset}/${ref.part} is one row, not a keyed list`;
    }
    if (field !== null && (ref.key === null || ref.key === "")) {
      return `${ref.dataset}/${ref.part} needs the key of the row`;
    }
    if (field === null && op === "remove") {
      return `${ref.dataset}/${ref.part} cannot be removed, only changed`;
    }
    return null;
  }

  /**
   * Puts a change in the shared draft: `set` a row's JSON (an added row's key is the key
   * field's value, and an existing row's key field may not change), `remove` a keyed row, or
   * `revert` a row to its pack version. The row's dataset must still match its schema.
   */
  draftSet(actor: ContentActor, ref: RowRef, op: DraftRow["op"], data: unknown): ContentResult {
    const refError = this.refError(ref, op);
    if (refError) {
      return fail(refError);
    }
    const field = keyField(ref.dataset, ref.part);
    let key = ref.key;
    if (op === "set" && field !== null) {
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return fail("a row is a JSON object");
      }
      const k = (data as Record<string, unknown>)[field];
      if (typeof k !== "string" && typeof k !== "number") {
        return fail(`the row needs its key field "${field}"`);
      }
      const existing = rowValue(this.draftContent(), ref) as Record<string, unknown> | undefined;
      if (existing && String(existing[field]) !== String(k)) {
        return fail(
          `the key "${String(existing[field])}" never changes: to rename it, set "display" instead`,
        );
      }
      key = existing ? String(existing[field]) : String(k);
      if (ref.key !== null && key.toLowerCase() !== ref.key.toLowerCase()) {
        return fail(`the row's "${field}" must be ${ref.key}`);
      }
    }
    if (op === "revert" && !contentRows(this.db).some((r) => sameRow(r, ref))) {
      return fail(`${rowLabel(ref)} has no change to revert`);
    }
    if (op === "remove" && rowValue(this.draftContent(), ref) === undefined) {
      return fail(`${rowLabel(ref)} does not exist`);
    }
    const row: DraftRow = {
      dataset: ref.dataset,
      part: ref.part,
      key,
      op,
      data: op === "set" ? data : null,
      authorAccountId: actor.accountId,
      author: actor.name,
      updatedAt: this.now(),
    };
    const draft = [...this.draft().filter((d) => !sameRow(d, row)), row];
    const next = this.draftContent(draft);
    const problems = schemaProblems(next).filter((p) => p.where.startsWith(`${ref.dataset}/`));
    if (problems.length > 0) {
      return fail(`${rowLabel(row)} does not match its schema`, problems);
    }
    upsertDraftRow(this.db, row);
    return { ok: true, value: undefined };
  }

  /** Drops a change from the draft. */
  draftDiscard(ref: RowRef): ContentResult {
    if (!this.draft().some((d) => sameRow(d, ref))) {
      return fail(`${rowLabel(ref)} is not in the draft`);
    }
    deleteDraftRow(this.db, ref.dataset, ref.part, ref.key);
    return { ok: true, value: undefined };
  }

  /** The operator row as a publish records it. */
  private stateOf(r: StoredContentRow | undefined): PublishedState | null {
    return r ? { op: r.op, data: r.data, baseHash: r.baseHash, baseData: r.baseData } : null;
  }

  /** Writes one operator-layer state (null drops the row). */
  private writeState(
    ref: RowRef,
    state: PublishedState | null,
    actor: ContentActor,
    now: string,
  ): void {
    if (state === null) {
      deleteContentRow(this.db, ref.dataset, ref.part, ref.key);
    } else {
      upsertContentRow(this.db, {
        dataset: ref.dataset,
        part: ref.part,
        key: ref.key,
        op: state.op,
        data: state.data,
        baseHash: state.baseHash,
        baseData: state.baseData,
        updatedBy: actor.name,
        updatedAt: now,
      });
    }
  }

  /** Rebuilds the published store from the database and swaps it in. */
  private rebuild(): void {
    this.published = applyRows(this.packData, contentRows(this.db).map(toLayer));
    this.copy = clientCopyOf(this.published);
    this.current = buildContentStore(this.published, this.copy.hash);
    this.onPublish(this.current);
  }

  /**
   * Publishes the draft. `seen` is the draft as the admin last saw it (each row's ref and
   * time); when another admin changed it since, the publish is refused, so nobody publishes
   * over someone else's work. Every check must pass.
   */
  publish(
    actor: ContentActor,
    seen: readonly (RowRef & { updatedAt: string })[],
    summary: string,
  ): ContentResult<StoredPublish> {
    const draft = this.draft();
    if (draft.length === 0) {
      return fail("the draft is empty");
    }
    const changed =
      draft.length !== seen.length ||
      draft.some((d) => !seen.some((s) => sameRow(s, d) && s.updatedAt === d.updatedAt));
    if (changed) {
      return fail("the draft changed since you last looked: check it again before publishing");
    }
    const problems = this.check(draft);
    if (problems.length > 0) {
      return fail("the draft does not pass its checks", problems);
    }
    const now = this.now();
    const layer = contentRows(this.db);
    const changes: PublishChange[] = draft.map((d) => {
      const before = this.stateOf(layer.find((r) => sameRow(r, d)));
      const base = rowValue(this.packData, d);
      const after: PublishedState | null =
        d.op === "revert"
          ? null
          : {
              op: d.op,
              data: d.op === "set" ? d.data : null,
              baseHash: base === undefined ? null : rowHash(base),
              baseData: base === undefined ? null : base,
            };
      return { dataset: d.dataset, part: d.part, key: d.key, before, after };
    });
    const nextCopy = clientCopyOf(this.draftContent(draft));
    let id = "";
    this.db.transaction(() => {
      for (const c of changes) {
        this.writeState(c, c.after, actor, now);
      }
      clearDraft(this.db);
      id = insertPublish(
        this.db,
        {
          actorAccountId: actor.accountId,
          actorName: actor.name,
          summary: summary.trim() || `${changes.length} change${changes.length === 1 ? "" : "s"}`,
          changes,
          hash: nextCopy.hash,
          undoOf: null,
        },
        now,
      );
      insertAudit(
        this.db,
        {
          actor: actor.accountId,
          command: "content publish",
          target: id,
          after: changes.map(rowLabel),
        },
        now,
      );
    })();
    this.rebuild();
    return { ok: true, value: publishById(this.db, id) as StoredPublish };
  }

  /**
   * Undoes a publish as a whole, as a publish of its own. Refused, naming the rows, when any row
   * it touched has changed since (as #26's undo is), or when it was already undone.
   */
  undo(actor: ContentActor, publishId: string): ContentResult<StoredPublish> {
    const p = publishById(this.db, publishId);
    if (!p) {
      return fail("there is no such publish");
    }
    if (p.undoneBy) {
      return fail("that publish was already undone");
    }
    const layer = contentRows(this.db);
    const same = (a: PublishedState | null, b: PublishedState | null) =>
      a === null || b === null ? a === b : a.op === b.op && rowHash(a.data) === rowHash(b.data);
    const conflicts = p.changes.filter(
      (c) => !same(this.stateOf(layer.find((r) => sameRow(r, c))), c.after),
    );
    if (conflicts.length > 0) {
      return fail(
        `changed since that publish, so it cannot be undone: ${conflicts.map(rowLabel).join(", ")}`,
      );
    }
    const changes: PublishChange[] = p.changes.map((c) => ({
      dataset: c.dataset,
      part: c.part,
      key: c.key,
      before: c.after,
      after: c.before,
    }));
    const rows = applyRows(this.packData, [
      ...layer.filter((r) => !p.changes.some((c) => sameRow(c, r))).map(toLayer),
      ...changes.flatMap((c) =>
        c.after
          ? [{ dataset: c.dataset, part: c.part, key: c.key, op: c.after.op, data: c.after.data }]
          : [],
      ),
    ]);
    const problems = schemaProblems(rows);
    if (problems.length > 0) {
      return fail("undoing it would leave content that does not match the schemas", problems);
    }
    const now = this.now();
    let id = "";
    this.db.transaction(() => {
      for (const c of changes) {
        this.writeState(c, c.after, actor, now);
      }
      id = insertPublish(
        this.db,
        {
          actorAccountId: actor.accountId,
          actorName: actor.name,
          summary: `Undo: ${p.summary}`,
          changes,
          hash: clientCopyOf(rows).hash,
          undoOf: p.id,
        },
        now,
      );
      insertAudit(this.db, { actor: actor.accountId, command: "content undo", target: p.id }, now);
    })();
    this.rebuild();
    return { ok: true, value: publishById(this.db, id) as StoredPublish };
  }

  /** The newest publishes, newest first. */
  history(limit = 50): StoredPublish[] {
    return recentPublishes(this.db, limit);
  }

  /**
   * The operator rows whose pack row changed since the change was made: "Classic v1.3 changed an
   * item you've customised". A pack version bump that leaves a row as it was shows nothing for
   * it, because rows compare by hash.
   */
  notices(): PackNotice[] {
    // The newest installed pack is the one whose rows win; with only Classic installed, Classic.
    const owner = this.packs.at(-1) ?? { name: "", version: "" };
    const out: PackNotice[] = [];
    for (const r of contentRows(this.db)) {
      const now = rowValue(this.packData, r);
      const nowHash = now === undefined ? null : rowHash(now);
      if (nowHash === r.baseHash) {
        continue;
      }
      out.push({
        dataset: r.dataset,
        part: r.part,
        key: r.key,
        packName: owner.name,
        packVersion: owner.version,
        was: r.baseData,
        now: now ?? null,
        yours: r.op === "set" ? r.data : null,
        yoursOp: r.op,
      });
    }
    return out;
  }

  /** Takes the pack's new version of a row: the operator's change goes (as a publish, so it can be undone). */
  acceptNotice(actor: ContentActor, ref: RowRef): ContentResult<StoredPublish> {
    const notice = this.notices().find((n) => sameRow(n, ref));
    if (!notice) {
      return fail(`${rowLabel(ref)} has no pack change waiting`);
    }
    const layer = contentRows(this.db);
    const row = layer.find((r) => sameRow(r, ref));
    const changes: PublishChange[] = [
      {
        dataset: ref.dataset,
        part: ref.part,
        key: row?.key ?? ref.key,
        before: this.stateOf(row),
        after: null,
      },
    ];
    const next = applyRows(this.packData, layer.filter((r) => !sameRow(r, ref)).map(toLayer));
    const problems = schemaProblems(next);
    if (problems.length > 0) {
      return fail(
        "taking the pack's version would leave content that does not match the schemas",
        problems,
      );
    }
    const now = this.now();
    let id = "";
    this.db.transaction(() => {
      deleteContentRow(this.db, ref.dataset, ref.part, ref.key);
      id = insertPublish(
        this.db,
        {
          actorAccountId: actor.accountId,
          actorName: actor.name,
          summary: `Took ${notice.packName} v${notice.packVersion}'s ${rowLabel(ref)}`,
          changes,
          hash: clientCopyOf(next).hash,
          undoOf: null,
        },
        now,
      );
      insertAudit(
        this.db,
        { actor: actor.accountId, command: "content accept", target: rowLabel(ref) },
        now,
      );
    })();
    this.rebuild();
    return { ok: true, value: publishById(this.db, id) as StoredPublish };
  }

  /** Keeps the operator's row and stops the notice: its base becomes the pack row as it is now. */
  dismissNotice(actor: ContentActor, ref: RowRef): ContentResult {
    const notice = this.notices().find((n) => sameRow(n, ref));
    const row = contentRows(this.db).find((r) => sameRow(r, ref));
    if (!notice || !row) {
      return fail(`${rowLabel(ref)} has no pack change waiting`);
    }
    const now = this.now();
    const base = notice.now === null ? null : notice.now;
    this.db.transaction(() => {
      upsertContentRow(this.db, {
        ...row,
        baseHash: base === null ? null : rowHash(base),
        baseData: base,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt,
      });
      insertAudit(
        this.db,
        { actor: actor.accountId, command: "content dismiss", target: rowLabel(ref) },
        now,
      );
    })();
    return { ok: true, value: undefined };
  }
}
