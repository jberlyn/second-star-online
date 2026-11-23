/**
 * The live content store's service (issue #27). It builds the store from the installed packs
 * and the operator layer at start-up, keeps the shared draft, publishes it (one transaction, one
 * publish-log entry, then the store is rebuilt and swapped in place), undoes a publish as a
 * whole, and lists the rows a newer pack version changed under an operator's change.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { comparePackVersions, DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import {
  buildContentStore,
  CONTENT_FORMAT,
  type ContentData,
  type ContentStore,
  checkNpcFile,
  content,
  DATASET_IDS,
  type DatasetId,
  editorLines,
  hasContent,
  installContent,
  isUniqueContainer,
  resolveNpcItemNames,
  SERVER_ONLY_DATASETS,
} from "@secondstaronline/shared";

import { insertAudit } from "../persistence/admin.ts";
import {
  clearDraft,
  clearDraftActions,
  contentRows,
  type DraftRow,
  deleteContentRow,
  deleteDraftAction,
  deleteDraftRow,
  draftActions,
  draftRows,
  type InstalledPack,
  insertPublish,
  installedPacks,
  type PublishChange,
  type PublishedState,
  publishById,
  publishesAfter,
  recentPublishes,
  type StoredContentRow,
  type StoredPublish,
  setPackVersion,
  setPublishCleanup,
  upsertContentRow,
  upsertDraftAction,
  upsertDraftRow,
} from "../persistence/content.ts";
import type { Db } from "../persistence/database.ts";
import {
  deleteNpcFile,
  insertNpcFileVersion,
  loadNpcFiles,
  saveNpcFile,
} from "../persistence/npcfiles.ts";
import { loadPlayerShops } from "../persistence/playershops.ts";
import {
  type CleanupRow,
  cleanUses,
  type EntryKind,
  npcTextCleaned,
  spellingsOf,
  type UseView,
  usesOf,
  useView,
} from "./cleanup.ts";
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
  rowsOf,
  rowValue,
  sameRow,
} from "./rows.ts";
import {
  bindingProblems,
  brokenReferences,
  type ContentProblem,
  checkStore,
  keyProblems,
  referenceMessage,
  schemaProblems,
  skillProblems,
  withNpcSaves,
} from "./validate.ts";
import type { ContentWorld, Removal, UsagePlace, WorldAction } from "./world.ts";

/** A release pack whose recorded version or name changes once the start succeeds. */
interface PackVersionUpdate {
  id: string;
  name: string;
  version: string;
  /** The version recorded before, or null on the first start after the migration. */
  was: string | null;
}

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

/** Where an item or a monster is used, for its removal (issue #28). */
export interface ContentUsage {
  kind: EntryKind;
  key: string;
  /** The name players see. */
  name: string;
  /** The item is retired: its copies stay, but no more can be made. */
  retired: boolean;
  /** References in content (with the draft laid in). */
  uses: UseView[];
  /** Where the world holds it (empty without a world). */
  world: UsagePlace[];
  /** How many different characters hold a copy (an item; 0 without a world). */
  characters: number;
  /** A monster with an NPC file of its own. */
  npcFile: boolean;
  /** Its removal waiting in the draft, if any. */
  pending: WorldAction | null;
}

/** A removal waiting in the draft, as the pre-publish check describes it. */
export interface RemovalSummary {
  kind: EntryKind;
  key: string;
  /** What the publish will do, a line each. */
  lines: string[];
  /** Places it is still used that the publish leaves as they are (content references, retired copies). */
  stillUsed: number;
}

/** The references nothing resolves, in content and in the world. */
export interface ContentProblems {
  content: ContentProblem[];
  world: ContentProblem[];
}

/** The row an item or a monster is. */
export const entryRef = (kind: EntryKind, key: string): RowRef =>
  kind === "item"
    ? { dataset: "items", part: "items", key }
    : { dataset: "monsters", part: "monsters", key };

const npcFileRef = (key: string): RowRef => ({ dataset: "npcFiles", part: "files", key });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "14 copies held by 9 characters", "3 roster slots on 3 maps". */
function placeText(p: UsagePlace): string {
  switch (p.place) {
    case "bag":
      return `${plural(p.count, "copy", "copies")} in the bags of ${plural(p.holderCount, "character")}`;
    case "worn":
      return `${plural(p.count, "copy", "copies")} worn by ${plural(p.holderCount, "character")}`;
    case "vault":
      return `${plural(p.count, "copy", "copies")} in the vaults of ${plural(p.holderCount, "character")}`;
    case "container":
      return `${plural(p.count, "copy", "copies")} in ${plural(p.holderCount, "container")}`;
    case "ground":
      return `${plural(p.count, "copy", "copies")} on the ground on ${plural(p.holderCount, "map")}`;
    case "quest":
      return `${plural(p.count, "quest line")}`;
    case "spawn":
      return `${plural(p.count, "roster slot")} on ${plural(p.holderCount, "map")}`;
    case "live":
      return `${plural(p.count, "live one", "live ones")} on ${plural(p.holderCount, "map")}`;
    case "shop":
      return `${plural(p.count, "copy", "copies")} on sale in ${plural(p.holderCount, "player shop")}`;
  }
}

/** How many places a usage report names (each kind of place counted by its holders). */
export const placeCount = (places: readonly UsagePlace[]): number =>
  places.reduce((n, p) => n + (p.count > 0 ? Math.max(1, p.holderCount) : 0), 0);

/** The lines a removal's world action will do on publish. */
export function actionLines(a: WorldAction, places: readonly UsagePlace[]): string[] {
  const out: string[] = [];
  /** The verb for a place's count: "1 copy stays", "3 copies stay". */
  const v = (p: UsagePlace, one: string, many: string) => (p.count === 1 ? one : many);
  const of = (kinds: readonly UsagePlace["place"][]) =>
    places.filter((p) => kinds.includes(p.place) && p.count > 0);
  if (a.kind === "item") {
    const copies = of(["bag", "worn", "vault", "container", "ground", "shop"]);
    const quests = of(["quest"]);
    for (const p of copies) {
      out.push(
        a.copies === "retire"
          ? `${placeText(p)} ${v(p, "stays", "stay")} (retired: no more can be made)`
          : a.copies === "purge"
            ? `${placeText(p)} ${v(p, "is", "are")} deleted${a.refundGold > 0 && ["bag", "worn", "vault"].includes(p.place) ? ` (${a.refundGold} gold back for each)` : ""}`
            : `${placeText(p)} ${v(p, "becomes", "become")} ${a.replacement}`,
      );
    }
    for (const p of quests) {
      out.push(
        a.copies === "replace"
          ? `${placeText(p)} ${v(p, "names", "name")} ${a.replacement} instead`
          : `${placeText(p)} ${v(p, "is", "are")} rolled again from the quest pools`,
      );
    }
    if (copies.length === 0 && a.copies === "retire") {
      out.push("Nobody holds a copy, so it is removed rather than retired");
    }
  } else {
    for (const p of of(["spawn"])) {
      out.push(
        a.spawns === "remove"
          ? `${placeText(p)} ${v(p, "is", "are")} cleared`
          : `${placeText(p)} ${v(p, "spawns", "spawn")} ${a.replacement} instead`,
      );
    }
    for (const p of of(["live"])) {
      out.push(
        a.live === "despawn"
          ? `${placeText(p)} ${v(p, "despawns", "despawn")}`
          : `${placeText(p)} ${v(p, "stays until it dies", "stay until they die")}`,
      );
    }
  }
  return out;
}

/** How many published stores stay fetchable by hash after a newer one goes live. */
export const RECENT_COPIES = 8;

/** Thrown to roll back a trial write (`candidate`). */
const ROLLBACK = Symbol("rollback");

export type ContentResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string; problems?: ContentProblem[] };

const fail = (
  error: string,
  problems?: ContentProblem[],
): { ok: false; error: string; problems?: ContentProblem[] } =>
  problems ? { ok: false, error, problems } : { ok: false, error };

/**
 * Quest rows with each `wants` and `reward` written as an item's display name rewritten to the
 * item's key. Text that names an item's key, or nothing at all, is left as it is.
 */
export function resolveQuestItems(
  rows: unknown[],
  items: readonly { name: string; display?: string }[],
): unknown[] {
  const byKey = new Set(items.map((i) => i.name.toLowerCase()));
  const byDisplay = new Map<string, string>();
  for (const i of items) {
    if (i.display && !byDisplay.has(i.display.toLowerCase())) {
      byDisplay.set(i.display.toLowerCase(), i.name);
    }
  }
  const key = (v: unknown) =>
    typeof v === "string" && !byKey.has(v.toLowerCase())
      ? (byDisplay.get(v.toLowerCase()) ?? v)
      : v;
  return rows.map((r) =>
    r !== null && typeof r === "object" && !Array.isArray(r)
      ? {
          ...r,
          ...("wants" in r ? { wants: key((r as Record<string, unknown>).wants) } : {}),
          ...("reward" in r ? { reward: key((r as Record<string, unknown>).reward) } : {}),
        }
      : r,
  );
}

/**
 * The quest pools with each wanted and reward item written as an item's display name rewritten to
 * the item's key, as `resolveQuestItems` does for the quest lines.
 */
export function resolvePoolItems(
  pools: unknown,
  items: readonly { name: string; display?: string }[],
): unknown {
  if (pools === null || typeof pools !== "object" || Array.isArray(pools)) {
    return pools;
  }
  const p = pools as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.map((e) =>
          e !== null && typeof e === "object" && "item" in e
            ? {
                ...e,
                item: (
                  resolveQuestItems([{ wants: (e as { item: unknown }).item }], items)[0] as {
                    wants: unknown;
                  }
                ).wants,
              }
            : e,
        )
      : v;
  return {
    ...p,
    ...("wanted" in p ? { wanted: list(p.wanted) } : {}),
    ...("rewards" in p ? { rewards: list(p.rewards) } : {}),
  };
}

/** The JSON clients receive, and its hash. */
export function clientCopyOf(data: ContentData): ClientCopy {
  const copy: Record<string, unknown> = {};
  for (const id of DATASET_IDS) {
    if (!(SERVER_ONLY_DATASETS as readonly string[]).includes(id)) {
      copy[id] = data[id];
    }
  }
  const body = JSON.stringify(copy);
  // The format is part of the identity: a deploy that changes only the format names a new file,
  // so no client reads a cached file in the old format.
  const hash = createHash("sha256").update(`${CONTENT_FORMAT}\n${body}`).digest("hex").slice(0, 16);
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
  /** `restoring`: the store that was live goes back after a failed publish. */
  onPublish?: (store: ContentStore, restoring: boolean) => void;
  log?: (line: string) => void;
}

export class ContentService {
  private readonly db: Db;
  private readonly now: () => string;
  private readonly onPublish: (store: ContentStore, restoring: boolean) => void;
  private readonly log: (line: string) => void;
  /** The packs merged in install order, without the operator layer. */
  private packData: ContentData;
  private packs: PackInfo[];
  /** The pack that supplies each row (the last to define it), by lower-cased row label. */
  private owners: Map<string, PackInfo>;
  private packKeys: { items: Set<string>; monsters: Set<string>; npcFiles: Set<string> };
  private published: ContentData;
  private copy: ClientCopy;
  /** The last few published stores, so a client that asked just before a publish still gets one. */
  private readonly recent = new Map<string, ClientCopy>();
  private current: ContentStore;

  constructor(opts: ContentServiceOptions) {
    this.db = opts.db;
    this.now = opts.now;
    this.onPublish = opts.onPublish ?? (() => {});
    this.log = opts.log ?? (() => {});
    const { data, packs, owners, updates } = this.loadPacks(opts.releasePacks);
    this.owners = owners;
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
    // Two skills spelled alike would hide one another from the rules.
    const skills = skillProblems(this.published);
    if (skills.length > 0) {
      throw new Error(
        `the installed packs and the operator's changes have skills the rules cannot tell apart:\n${skills
          .map((p) => `  ${p.where}: ${p.message}`)
          .join("\n")}`,
      );
    }
    this.copy = clientCopyOf(this.published);
    this.remember(this.copy);
    this.current = buildContentStore(this.published, this.copy.hash);
    // Only a start that got this far records the pack versions, so a start that fails still says
    // "updated from" the next time.
    this.db.transaction(() => {
      for (const u of updates) {
        setPackVersion(this.db, u.id, u.name, u.version);
      }
    })();
    for (const u of updates) {
      // The first start after the migration records the version quietly; a release that brings
      // another version says so.
      if (u.was !== null) {
        this.log(
          `content: ${u.name} ${comparePackVersions(u.version, u.was) > 0 ? "updated" : "changed"} from v${u.was} to v${u.version}`,
        );
      }
    }
    // A newer pack can clash with the operator's changes (an item key equal to a display name).
    // Say so at start: every publish names the problem until it is fixed.
    for (const p of keyProblems(this.published, this.packKeys)) {
      this.log(`content: ${p.where}: ${p.message}`);
    }
    // So does a skill binding to no skill: its mechanic is off, and every publish names it.
    for (const p of bindingProblems(this.published)) {
      this.log(`content: ${p.where}: ${p.message} (that mechanic is off)`);
    }
  }

  /** Reads every installed pack, records release versions, and merges them. */
  private loadPacks(releasePacks: Readonly<Record<string, string>>): {
    data: ContentData;
    packs: PackInfo[];
    owners: Map<string, PackInfo>;
    updates: PackVersionUpdate[];
  } {
    const loaded: LoadedPack[] = [];
    const packs: PackInfo[] = [];
    const updates: PackVersionUpdate[] = [];
    for (const p of installedPacks(this.db)) {
      const pack = this.readInstalled(p, releasePacks);
      const updatedFrom =
        p.version !== null && p.version !== pack.manifest.version ? p.version : null;
      if (p.version !== pack.manifest.version || p.name !== pack.manifest.name) {
        updates.push({
          id: p.id,
          name: pack.manifest.name,
          version: pack.manifest.version,
          was: p.version,
        });
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
    const owners = new Map<string, PackInfo>();
    loaded.forEach((l, i) => {
      for (const r of rowsOf(l.data)) {
        owners.set(rowLabel(r).toLowerCase(), packs[i] as PackInfo);
      }
    });
    const missing = missingDatasets(merged);
    if (missing.length > 0) {
      throw new Error(
        `the installed packs leave out ${missing.join(", ")}: a server needs a pack with every dataset (the Classic pack)`,
      );
    }
    return { data: merged as ContentData, packs, owners, updates };
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

  /** A recent published store by hash (the current one, or one of the few before it). */
  clientCopyFor(hash: string): ClientCopy | undefined {
    return this.recent.get(hash);
  }

  private remember(copy: ClientCopy): void {
    this.recent.delete(copy.hash);
    this.recent.set(copy.hash, copy);
    while (this.recent.size > RECENT_COPIES) {
      this.recent.delete(this.recent.keys().next().value as string);
    }
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

  /** The NPCs with an NPC Editor save, which is laid over their content row (the save plays). */
  npcEditorSaves(): Set<string> {
    return new Set(loadNpcFiles(this.db).map((f) => f.npc.toLowerCase()));
  }

  /** The shared draft. */
  draft(): DraftRow[] {
    return draftRows(this.db);
  }

  /**
   * The store the draft would publish, built exactly as the publish will store it: a draft change
   * to an existing operator row takes that row's place (as `upsertContentRow` keeps its `seq`), and
   * new rows follow in draft order.
   */
  draftContent(draft: readonly DraftRow[] = this.draft()): ContentData {
    return applyRows(this.packData, this.layerWith(draft));
  }

  /** The operator layer with draft changes laid in, in the order the database will hold it. */
  private layerWith(draft: readonly DraftRow[]): LayerRow[] {
    const rows: LayerRow[] = [];
    for (const r of contentRows(this.db)) {
      const d = draft.find((x) => sameRow(x, r));
      if (!d) {
        rows.push(toLayer(r));
      } else {
        const l = draftLayer(d);
        if (l) {
          rows.push(l);
        }
      }
    }
    for (const d of draft) {
      const l = draftLayer(d);
      if (l && !contentRows(this.db).some((r) => sameRow(r, d))) {
        rows.push(l);
      }
    }
    return rows;
  }

  /**
   * The draft's pre-publish checks: schemas, then key rules and cross-references. The answer is
   * kept until the draft, the published store or the NPC Editor's saves change, so the Content
   * page can ask for it on every refresh without running the trial install each time.
   */
  check(draft: readonly DraftRow[] = this.draft()): ContentProblem[] {
    if (draft.length === 0) {
      return [];
    }
    const key = `${this.draftRev(draft)}\u0000${this.current.hash}\u0000${rowHash(this.npcSaves())}`;
    if (this.checked?.key !== key) {
      const next = this.draftContent(draft);
      this.checked = {
        key,
        problems: [
          ...this.fullProblems(next, this.liveActions(draft)),
          ...this.actionProblems(next, draft),
        ],
      };
    }
    return this.checked.problems;
  }

  /** The last `check` answer and what it was for. */
  private checked: { key: string; problems: ContentProblem[] } | null = null;

  /**
   * The NPC Editor's saves, which play instead of their NPC's content row. Player shops' files are
   * in the same table but are world data (a player's stock and prices), handled with the copies
   * players hold, not checked as content.
   */
  private npcSaves() {
    const shops = new Set(loadPlayerShops(this.db).map((s) => s.npc.toLowerCase()));
    return loadNpcFiles(this.db).filter((f) => !shops.has(f.npc.toLowerCase()));
  }

  /**
   * The NPC Editor's saves as the waiting cleanups will leave them: shop and drop lines naming a
   * removed item go or name its replacement (as the content's NPC file rows did), and a removed
   * NPC's save goes with it. A save the cleanup deletes has `text: null`.
   */
  private npcSavesAfter(
    actions: readonly WorldAction[],
  ): { npc: string; text: string | null; was: string }[] {
    return this.npcSaves().map((f) => {
      let text: string | null = f.text;
      for (const a of actions) {
        if (text === null) {
          break;
        }
        if (a.kind === "monster") {
          if ((a.npcFile ?? "delete") === "delete" && f.npc.toLowerCase() === a.key.toLowerCase()) {
            text = null;
          }
          continue;
        }
        const mode = a.content ?? "remove";
        if (mode === "leave") {
          continue;
        }
        text = npcTextCleaned(text, a.spellings, mode, a.contentReplacement ?? "") ?? text;
      }
      return { npc: f.npc, text, was: f.text };
    });
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
    if (!Object.hasOwn(ds, ref.part)) {
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
      // A pack row the operator removed is not in the store, but its key is still the pack's: put
      // back, it is spelled exactly as before (stored names and the pack's text use it).
      const existing = (rowValue(this.draftContent(), ref) ?? rowValue(this.packData, ref)) as
        | Record<string, unknown>
        | undefined;
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
    // Text an operator writes may name an item by its display name; it is stored as the key
    // (decision 3), so a later rename never breaks it.
    if (op === "set" && ref.dataset === "quests" && ref.part === "current" && Array.isArray(data)) {
      data = resolveQuestItems(data, this.draftContent().items.items);
    }
    if (op === "set" && ref.dataset === "quests" && ref.part === "pools") {
      data = resolvePoolItems(data, this.draftContent().items.items);
    }
    // An NPC file gets the NPC Editor's handling: display names become keys, then its checks.
    if (op === "set" && ref.dataset === "npcFiles" && ref.part === "files") {
      const row = data as { name?: unknown; text?: unknown } | null;
      if (row && typeof row.text === "string") {
        // Against the draft's items: an item added or renamed in the same draft counts.
        const draftStore = buildContentStore(this.draftContent());
        const lines = resolveNpcItemNames(editorLines(row.text), draftStore);
        const check = checkNpcFile(lines, draftStore);
        if (check.error) {
          return fail(`${rowLabel(ref)}: ${check.error}`);
        }
        data = { ...row, text: lines.join("\r") };
      }
    }
    if (op === "revert" && !contentRows(this.db).some((r) => sameRow(r, ref))) {
      return fail(`${rowLabel(ref)} has no change to revert`);
    }
    if (op === "remove" && rowValue(this.published, ref) === undefined) {
      return fail(
        this.draft().some((d) => sameRow(d, ref) && d.op === "set")
          ? `${rowLabel(ref)} is only in the draft: discard the change instead`
          : `${rowLabel(ref)} does not exist`,
      );
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
    const problems = schemaProblems(next).filter(
      (p) => p.where === ref.dataset || p.where.startsWith(`${ref.dataset}/`),
    );
    if (problems.length > 0) {
      return fail(`${rowLabel(row)} does not match its schema`, problems);
    }
    this.db.transaction(() => {
      upsertDraftRow(this.db, row);
      // A row put back or changed is no longer a removal: its world cleanup goes. A retired item
      // stays retired by its own row, so its cleanup stays.
      // A retired row keeps only a retirement's cleanup: a purge or replace waiting for it goes,
      // since the item now stays.
      const retired = (data as { retired?: unknown } | null)?.retired === true;
      const waiting = draftActions(this.db).find((a) => sameRow(entryRef(a.kind, a.key), row));
      const keepsRetire =
        retired &&
        (waiting?.action as WorldAction | undefined)?.kind === "item" &&
        (waiting?.action as { copies?: string } | undefined)?.copies === "retire";
      if (op !== "remove" && !keepsRetire) {
        this.dropAction(row);
      }
    })();
    return { ok: true, value: undefined };
  }

  /** Drops a change from the draft. */
  draftDiscard(ref: RowRef): ContentResult {
    if (!this.draft().some((d) => sameRow(d, ref))) {
      return fail(`${rowLabel(ref)} is not in the draft`);
    }
    this.db.transaction(() => {
      deleteDraftRow(this.db, ref.dataset, ref.part, ref.key);
      this.dropAction(ref);
    })();
    return { ok: true, value: undefined };
  }

  /** Drops the world cleanup of the item or monster a row is, if it has one waiting. */
  private dropAction(ref: RowRef): void {
    if (ref.key === null) {
      return;
    }
    if (ref.dataset === "items" && ref.part === "items") {
      deleteDraftAction(this.db, "item", ref.key);
    } else if (ref.dataset === "monsters" && ref.part === "monsters") {
      deleteDraftAction(this.db, "monster", ref.key);
    }
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

  /**
   * Installs `next` for a moment and puts the store that was installed back: every module rebuilds
   * from it, so a row the schemas accept but a rule cannot read (a missing text key, say) is
   * refused before it is written, instead of failing the publish halfway or every start after.
   */
  private installProblems(next: ContentData): ContentProblem[] {
    const before = hasContent() ? content() : null;
    try {
      installContent(buildContentStore(next));
      return [];
    } catch (e) {
      return [
        {
          where: "content",
          message: `a rule cannot read it: ${e instanceof Error ? e.message : String(e)}`,
        },
      ];
    } finally {
      if (before) {
        installContent(before);
      }
    }
  }

  /** Every check a write must pass: the publish checks, then a trial install. */
  private fullProblems(next: ContentData, actions: readonly WorldAction[] = []): ContentProblem[] {
    const problems = checkStore(
      next,
      this.published,
      this.packKeys,
      this.npcSavesAfter(actions).flatMap((f) =>
        f.text === null ? [] : [{ npc: f.npc, text: f.text }],
      ),
    );
    return problems.length > 0 ? problems : this.installProblems(next);
  }

  /**
   * The store a write would leave, read back from the database exactly as it would be stored (row
   * order included), with the write rolled back.
   */
  private candidate(write: () => void): ContentData {
    let next: ContentData | null = null;
    try {
      this.db.transaction(() => {
        write();
        next = applyRows(this.packData, contentRows(this.db).map(toLayer));
        throw ROLLBACK;
      })();
    } catch (e) {
      if (e !== ROLLBACK) {
        throw e;
      }
    }
    return next as unknown as ContentData;
  }

  /** Rebuilds the published store from the database and swaps it in. */
  private rebuild(restoring = false): void {
    this.published = applyRows(this.packData, contentRows(this.db).map(toLayer));
    this.copy = clientCopyOf(this.published);
    this.remember(this.copy);
    this.current = buildContentStore(this.published, this.copy.hash);
    this.onPublish(this.current, restoring);
  }

  /**
   * The draft's revision: a hash of every change in it (row, change, author, time and JSON). Any
   * save or discard gives a new one, even two saves in the same millisecond.
   */
  draftRev(draft: readonly DraftRow[] = this.draft()): string {
    const h = createHash("sha256");
    for (const d of draft) {
      h.update(
        `${rowLabel(d)}\u0000${d.op}\u0000${d.authorAccountId}\u0000${d.updatedAt}\u0000${rowHash(d.data)}\n`,
      );
    }
    // The world cleanups waiting with it are part of the draft too.
    for (const a of draftActions(this.db)) {
      h.update(`${a.kind}\u0000${a.key}\u0000${a.updatedAt}\u0000${rowHash(a.action)}\n`);
    }
    return h.digest("hex").slice(0, 16);
  }

  /**
   * Publishes the draft. `draftRev` is the revision of the draft as the admin last saw it; when
   * another admin changed it since, the publish is refused, so nobody publishes over someone
   * else's work. Every check must pass.
   */
  publish(
    actor: ContentActor,
    draftRev: string,
    summary: string,
    world?: ContentWorld,
  ): ContentResult<StoredPublish> {
    const asDrafted = this.draft();
    if (asDrafted.length === 0) {
      return fail("the draft is empty");
    }
    if (this.draftRev(asDrafted) !== draftRev) {
      return fail("the draft changed since you last looked: check it again before publishing");
    }
    const actions = this.liveActions(asDrafted);
    const draft = world ? this.settleRetirements(asDrafted, actions, world) : asDrafted;
    const nextData = this.draftContent(draft);
    const problems = [
      ...this.fullProblems(nextData, actions),
      ...this.actionProblems(nextData, draft),
      // An already-retired item removed outright: copies that turned up since would be stranded.
      ...actions.flatMap((a) => {
        const d = draft.find((x) => sameRow(x, entryRef(a.kind, a.key)));
        const wasRetired =
          (rowValue(this.published, entryRef(a.kind, a.key)) as { retired?: unknown } | undefined)
            ?.retired === true;
        const left =
          a.kind === "item" && a.copies === "retire" && d?.op === "remove" && wasRetired
            ? this.copiesLeft(a.key, world)
            : 0;
        return left > 0
          ? [
              {
                where: rowLabel(entryRef(a.kind, a.key)),
                message: `it is retired and ${left} ${left === 1 ? "copy is" : "copies are"} still in the world: purge or replace them to remove it`,
              },
            ]
          : [];
      }),
    ];
    if (problems.length > 0) {
      return fail("the draft does not pass its checks", problems);
    }
    const now = this.now();
    const layer = contentRows(this.db);
    const changes: PublishChange[] = draft
      .map((d): PublishChange => {
        const before = this.stateOf(layer.find((r) => sameRow(r, d)));
        const base = rowValue(this.packData, d);
        // Reverting drops the operator row; so does removing a row no pack has (an added one), which
        // leaves nothing behind to mark.
        const after: PublishedState | null =
          d.op === "revert" || (d.op === "remove" && base === undefined)
            ? null
            : {
                op: d.op,
                data: d.op === "set" ? d.data : null,
                baseHash: base === undefined ? null : rowHash(base),
                baseData: base === undefined ? null : base,
              };
        return { dataset: d.dataset, part: d.part, key: d.key, before, after };
      })
      // A revert of a row whose operator change has gone since (an undo) changes nothing.
      .filter((c) => c.before !== null || c.after !== null);
    const nextCopy = clientCopyOf(nextData);
    let id = "";
    // Memory is noted and clients are told nothing until the publish commits.
    world?.begin();
    // One transaction: the content rows, the publish log, the new store and the world's cleanup
    // (which runs once the new store is live, so what it rolls, a quest line, comes from the
    // published content). A crash or a throw part-way leaves none of it written.
    try {
      this.db.transaction(() => {
        this.writePublish(changes, actor, now, summary, nextCopy.hash, (got) => {
          id = got;
        });
        // The NPC Editor's saves get the content's cleanup, before the game lays them again; each
        // keeps the text it had as a version, as an NPC Editor save does.
        for (const f of this.npcSavesAfter(actions)) {
          if (f.text !== f.was) {
            insertNpcFileVersion(this.db, { npc: f.npc, text: f.was }, actor.accountId, now);
          }
          if (f.text === null) {
            deleteNpcFile(this.db, f.npc);
          } else if (f.text !== f.was) {
            saveNpcFile(this.db, { npc: f.npc, text: f.text }, actor.accountId, now);
          }
        }
        this.rebuild();
        if (actions.length > 0 && world) {
          const lines = world.apply(actions, actor, id);
          setPublishCleanup(this.db, id, { actions, lines });
        }
      })();
    } catch (e) {
      // Rolled back: the store that was live goes back, then the world's memory as it was before
      // the publish; what either would have told clients is dropped.
      this.rebuild(true);
      world?.rollback();
      throw e;
    }
    // Committed: what the publish held back for clients goes out.
    world?.commit();
    return { ok: true, value: publishById(this.db, id) as StoredPublish };
  }

  /**
   * A retirement is settled when it is published, not when it was drafted: an item somebody holds
   * by then is retired (its row kept, marked retired), and one nobody holds is removed outright.
   */
  private settleRetirements(
    draft: readonly DraftRow[],
    actions: readonly WorldAction[],
    world: ContentWorld,
  ): DraftRow[] {
    return draft.map((d) => {
      const a = actions.find(
        (x) => x.kind === "item" && x.copies === "retire" && sameRow(entryRef("item", x.key), d),
      );
      if (a?.kind !== "item" || d.op !== "set") {
        return d;
      }
      const held = world.usage("item", a.spellings).some((p) => p.count > 0 && p.place !== "quest");
      const wasRetired =
        (rowValue(this.published, d) as { retired?: unknown } | undefined)?.retired === true;
      return held || wasRetired ? d : { ...d, op: "remove", data: null };
    });
  }

  /** Writes a publish's rows, empties the draft, and logs it (inside the caller's transaction). */
  private writePublish(
    changes: readonly PublishChange[],
    actor: ContentActor,
    now: string,
    summary: string,
    hash: string,
    setId: (id: string) => void,
  ): void {
    {
      for (const c of changes) {
        this.writeState(c, c.after, actor, now);
      }
      clearDraft(this.db);
      clearDraftActions(this.db);
      const id = insertPublish(
        this.db,
        {
          actorAccountId: actor.accountId,
          actorName: actor.name,
          summary: summary.trim() || `${changes.length} change${changes.length === 1 ? "" : "s"}`,
          changes,
          hash,
          undoOf: null,
        },
        now,
      );
      setId(id);
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
    }
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
      return fail(
        publishById(this.db, p.undoneBy)?.undoneBy
          ? "that publish was undone and then redone: to undo it again, undo the redo"
          : "that publish was already undone",
      );
    }
    const layer = contentRows(this.db);
    const same = (a: PublishedState | null, b: PublishedState | null) =>
      a === null || b === null ? a === b : a.op === b.op && rowHash(a.data) === rowHash(b.data);
    // A later publish that touched one of its rows counts as a change even if it put the row
    // back as it was. A later change and its undo cancel out: a chain of later publishes each
    // undoing the one before (a change, its undo, a redo, ...) cancels when it has an even
    // number of steps; with an odd number the last step is live, so all of them count.
    const later = publishesAfter(this.db, p.id);
    const byId = new Map(later.map((l) => [l.id, l]));
    const cancelled = new Set<string>();
    for (const l of later) {
      if (l.undoOf && byId.has(l.undoOf)) {
        continue; // not the first step of its chain among the later publishes
      }
      const chain = [l];
      for (let at = l; at.undoneBy && byId.has(at.undoneBy); ) {
        at = byId.get(at.undoneBy) as StoredPublish;
        chain.push(at);
      }
      if (chain.length % 2 === 0) {
        for (const c of chain) {
          cancelled.add(c.id);
        }
      }
    }
    const touchedLater = later.filter((l) => !cancelled.has(l.id)).flatMap((l) => l.changes);
    const conflicts = p.changes.filter(
      (c) =>
        !same(this.stateOf(layer.find((r) => sameRow(r, c))), c.after) ||
        touchedLater.some((t) => sameRow(t, c)),
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
    const now = this.now();
    const rows = this.candidate(() => {
      for (const c of changes) {
        this.writeState(c, c.after, actor, now);
      }
    });
    // Every publish check, not just the schemas: a later publish may refer to what this one added.
    const problems = this.fullProblems(rows);
    if (problems.length > 0) {
      return fail("undoing it would leave content that does not pass its checks", problems);
    }
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

  /** The item or monster a row is, as it is published or drafted (null if neither has it). */
  private entryOf(
    kind: EntryKind,
    key: string,
    data: ContentData = this.draftContent(),
  ): { name: string; display?: string; retired?: true } | null {
    const ref = entryRef(kind, key);
    return (rowValue(data, ref) ?? rowValue(this.published, ref) ?? null) as {
      name: string;
      display?: string;
      retired?: true;
    } | null;
  }

  /** Every spelling an entry has had, in the published store and the draft. */
  private spellings(kind: EntryKind, key: string): string[] {
    const all = [
      ...spellingsOf(this.published, kind, key),
      ...spellingsOf(this.draftContent(), kind, key),
    ];
    return all.filter((s, i) => all.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i);
  }

  /** Where an item or a monster is used: in content (the draft laid in) and in the world. */
  usage(kind: EntryKind, key: string, world?: ContentWorld): ContentResult<ContentUsage> {
    const entry = this.entryOf(kind, key);
    if (!entry) {
      return fail(`There is no ${kind} ${key}.`);
    }
    const data = this.draftContent();
    const spellings = this.spellings(kind, entry.name);
    const saves = this.npcSaves();
    const savedNpcs = new Set(saves.map((f) => f.npc.toLowerCase()));
    const pending = draftActions(this.db).find(
      (a) => a.kind === kind && a.key.toLowerCase() === entry.name.toLowerCase(),
    );
    return {
      ok: true,
      value: {
        kind,
        key: entry.name,
        name: entry.display ?? entry.name,
        retired: entry.retired === true,
        // The NPC Editor's saves play instead of their rows, so their lines are listed too.
        uses: usesOf(withNpcSaves(data, saves), kind, entry.name, spellings).map((u) => {
          const v = useView(u);
          return u.row.dataset === "npcFiles" && savedNpcs.has(String(u.row.key).toLowerCase())
            ? { ...v, where: `${v.where} (NPC Editor save)` }
            : v;
        }),
        world: world ? world.usage(kind, spellings) : [],
        characters: world && kind === "item" ? world.holders(spellings) : 0,
        npcFile:
          kind === "monster" &&
          (rowValue(data, npcFileRef(entry.name)) !== undefined ||
            savedNpcs.has(entry.name.toLowerCase())),
        pending: (pending?.action as WorldAction | undefined) ?? null,
      },
    };
  }

  /**
   * Puts an item's or monster's removal in the draft with its cleanup (issue #28): the content rows
   * the cleanup changes become draft rows, and what happens to the world waits with the draft
   * until it is published. An item players hold is retired (kept, with no more made) unless the
   * operator purges or replaces the copies.
   */
  draftRemoval(actor: ContentActor, removal: Removal, world?: ContentWorld): ContentResult<string> {
    const ref = entryRef(removal.kind, removal.key);
    const published = rowValue(this.published, ref) as
      | { name: string; display?: string; retired?: true }
      | undefined;
    if (!published) {
      return fail(
        this.draft().some((d) => sameRow(d, ref) && d.op === "set")
          ? `${rowLabel(ref)} is only in the draft: discard the change instead`
          : `There is no ${removal.kind} ${removal.key}.`,
      );
    }
    const key = published.name;
    // An item already retired is removed outright once nobody holds a copy; while copies remain,
    // they are purged or replaced to remove it.
    const alreadyRetired = removal.kind === "item" && published.retired === true;
    if (alreadyRetired && removal.kind === "item" && removal.copies === "retire") {
      const left = this.copiesLeft(key, world);
      if (left > 0) {
        return fail(
          `${key} is already retired, and ${left} ${left === 1 ? "copy is" : "copies are"} still in the world: purge or replace them to remove it.`,
        );
      }
    }
    const base = this.draftContent();
    const replacement = removal.replacement?.trim() || null;
    const baseStore = buildContentStore(base);
    /** The item or monster text names: its key, or the name players see. */
    const named = (text: string) =>
      (removal.kind === "item"
        ? baseStore.itemNamed(text)
        : (baseStore.monster(text) ??
          base.monsters.monsters.find((m) => m.display?.toLowerCase() === text.toLowerCase()))) as
        | { name: string; retired?: true }
        | undefined;
    const wantsReplacement =
      removal.content === "replace" ||
      (removal.kind === "item" ? removal.copies === "replace" : removal.spawns === "replace");
    if (wantsReplacement) {
      if (!replacement) {
        return fail(`Name the ${removal.kind} to replace ${key} with.`);
      }
      const other = named(replacement);
      if (!other) {
        return fail(`There is no ${removal.kind} ${replacement}.`);
      }
      if (other.name.toLowerCase() === key.toLowerCase()) {
        return fail(`${key} cannot be replaced with itself.`);
      }
      if (other.retired) {
        return fail(`${other.name} is retired: no more can be made.`);
      }
      // A container's storage goes to its replacement by its `#id`, so a container is replaced
      // with another container, or the things stored in copies of it could not be reached.
      // and an ordinary item is not replaced with one: each copy would need storage of its own.
      if (removal.kind === "item" && removal.copies === "replace") {
        if (isUniqueContainer(key) && !isUniqueContainer(other.name)) {
          return fail(
            `${key} stores things: replace its copies with another storage item, so what they hold goes with them.`,
          );
        }
        if (!isUniqueContainer(key) && isUniqueContainer(other.name)) {
          return fail(
            `${other.name} is a storage item, which each copy would need its own storage for: replace ${key} with something else.`,
          );
        }
      }
    }
    const replaceWith =
      wantsReplacement && replacement ? (named(replacement)?.name ?? replacement) : null;
    if (removal.kind === "item" && !(removal.refundGold >= 0 && removal.refundGold <= 1_000_000)) {
      return fail("The refund is a whole number of gold from 0 to 1,000,000.");
    }
    const spellings = this.spellings(removal.kind, key);
    const ownFile =
      removal.kind === "monster" && removal.npcFile === "delete" ? [npcFileRef(key)] : [];
    const cleaned = cleanUses(
      base,
      usesOf(base, removal.kind, key, spellings),
      removal.content,
      replaceWith ?? "",
      ownFile,
      // A removal that would break its row (a list that must keep an entry) is left to replace.
      (r, value) => {
        const next = applyRows(base, [{ ...r, op: "set", data: value }]);
        return DATASET_SCHEMAS[r.dataset].safeParse(next[r.dataset]).success;
      },
    );
    const own: CleanupRow[] = [];
    let action: WorldAction;
    if (removal.kind === "item") {
      // A retirement goes into the draft as the retired row; whether anybody still holds a copy is
      // settled when it is published (`settleRetirements`).
      const current = (rowValue(base, ref) ?? published) as Record<string, unknown>;
      own.push(
        removal.copies === "retire" && !alreadyRetired
          ? { ref, op: "set", data: { ...current, retired: true } }
          : { ref, op: "remove", data: null },
      );
      action = {
        kind: "item",
        key,
        spellings,
        copies: removal.copies,
        replacement: removal.copies === "replace" ? replaceWith : null,
        refundGold: removal.copies === "purge" ? Math.floor(removal.refundGold) : 0,
        content: removal.content,
        contentReplacement: removal.content === "replace" ? replaceWith : null,
      };
    } else {
      own.push({ ref, op: "remove", data: null });
      if (ownFile.length > 0 && rowValue(base, npcFileRef(key)) !== undefined) {
        own.push({ ref: npcFileRef(key), op: "remove", data: null });
      }
      action = {
        kind: "monster",
        key,
        spawns: removal.spawns,
        live: removal.live,
        replacement: removal.spawns === "replace" ? replaceWith : null,
        npcFile: removal.npcFile,
      };
    }
    const now = this.now();
    const writes: DraftRow[] = [];
    const drops: RowRef[] = [];
    for (const r of [...cleaned.rows, ...own]) {
      const rowKey =
        r.ref.key === null
          ? null
          : String(
              (
                (rowValue(base, r.ref) ?? rowValue(this.published, r.ref)) as
                  | Record<string, unknown>
                  | undefined
              )?.[keyField(r.ref.dataset, r.ref.part) ?? ""] ?? r.ref.key,
            );
      // Removing a row only the draft adds is dropping that draft change.
      if (r.op === "remove" && rowValue(this.published, r.ref) === undefined) {
        drops.push(r.ref);
        continue;
      }
      writes.push({
        dataset: r.ref.dataset,
        part: r.ref.part,
        key: rowKey,
        op: r.op,
        data: r.op === "set" ? r.data : null,
        authorAccountId: actor.accountId,
        author: actor.name,
        updatedAt: now,
      });
    }
    const draft = [
      ...this.draft().filter(
        (d) => !writes.some((w) => sameRow(w, d)) && !drops.some((x) => sameRow(x, d)),
      ),
      ...writes,
    ];
    const next = this.draftContent(draft);
    const touched = new Set(writes.map((w) => w.dataset));
    const problems = schemaProblems(next).filter((p) =>
      [...touched].some((d) => p.where === d || p.where.startsWith(`${d}/`)),
    );
    if (problems.length > 0) {
      return fail(`the cleanup of ${key} would break its rows' schemas`, problems);
    }
    this.db.transaction(() => {
      for (const d of drops) {
        deleteDraftRow(this.db, d.dataset, d.part, d.key);
      }
      for (const w of writes) {
        upsertDraftRow(this.db, w);
      }
      upsertDraftAction(this.db, {
        kind: removal.kind,
        key,
        action,
        authorAccountId: actor.accountId,
        author: actor.name,
        updatedAt: now,
      });
    })();
    const left = cleaned.left.length;
    const changed = cleaned.rows.length;
    const verb =
      own[0]?.op === "set"
        ? `${key} will be retired (or removed, if nobody holds a copy by then)`
        : `${key} will be removed`;
    return {
      ok: true,
      value: `${verb} when the draft is published${changed > 0 ? `; ${plural(changed, "other row")} changed with it` : ""}${left > 0 ? `; ${plural(left, "reference")} left for you to fix` : ""}.`,
    };
  }

  /** How many copies of an item the world holds anywhere (bags, gear, vaults, containers, the ground, shops). */
  private copiesLeft(key: string, world?: ContentWorld): number {
    return world
      ? world
          .usage("item", this.spellings("item", key))
          .filter((p) => p.place !== "quest")
          .reduce((n, p) => n + p.count, 0)
      : 0;
  }

  /**
   * The world cleanups the draft will run: each waiting action whose entry the draft still removes
   * (or, for a retired item, retires).
   */
  liveActions(draft: readonly DraftRow[] = this.draft()): WorldAction[] {
    return draftActions(this.db)
      .filter((a) => {
        const d = draft.find((x) => sameRow(x, entryRef(a.kind, a.key)));
        return (
          d !== undefined &&
          (d.op === "remove" ||
            (a.kind === "item" &&
              (a.action as { copies?: string }).copies === "retire" &&
              d.op === "set" &&
              (d.data as { retired?: unknown })?.retired === true))
        );
      })
      .map((a) => a.action as WorldAction);
  }

  /** Problems with the waiting cleanups: a replacement the draft no longer has. */
  private actionProblems(next: ContentData, draft: readonly DraftRow[]): ContentProblem[] {
    const store = buildContentStore(next);
    const out: ContentProblem[] = [];
    for (const a of this.liveActions(draft)) {
      if (!a.replacement) {
        continue;
      }
      const other = (
        a.kind === "item" ? store.item(a.replacement) : store.monster(a.replacement)
      ) as { retired?: true } | undefined;
      if (!other || other.retired) {
        out.push({
          where: rowLabel(entryRef(a.kind, a.key)),
          message: `its copies or spawns become ${a.replacement}, which ${other ? "is retired" : "the draft no longer has"}`,
        });
      }
    }
    return out;
  }

  /**
   * The removals the draft holds and what publishing them will do: "this draft removes 2 items
   * still used in 5 places". Built from the world's usage, so it is asked for on demand.
   */
  removals(world?: ContentWorld): RemovalSummary[] {
    const draft = this.draft();
    const next = this.draftContent(draft);
    const actions = this.liveActions(draft);
    const savesAfter = this.npcSavesAfter(actions).flatMap((f) =>
      f.text === null ? [] : [{ npc: f.npc, text: f.text }],
    );
    const out: RemovalSummary[] = [];
    for (const d of draft) {
      const kind: EntryKind | null =
        d.dataset === "items" && d.part === "items"
          ? "item"
          : d.dataset === "monsters" && d.part === "monsters"
            ? "monster"
            : null;
      if (kind === null || d.key === null) {
        continue;
      }
      const retiring =
        kind === "item" &&
        d.op === "set" &&
        (d.data as { retired?: unknown })?.retired === true &&
        (rowValue(this.published, d) as { retired?: unknown } | undefined)?.retired !== true;
      if (d.op !== "remove" && !retiring) {
        continue;
      }
      const spellings = this.spellings(kind, d.key);
      const places = world ? world.usage(kind, spellings) : [];
      const action = actions.find(
        (a) => a.kind === kind && a.key.toLowerCase() === d.key?.toLowerCase(),
      );
      // NPC Editor saves as the waiting cleanups will leave them, as the publish checks them.
      const left = usesOf(withNpcSaves(next, savesAfter), kind, d.key, spellings);
      const lines = action
        ? actionLines(action, places)
        : places.map(
            (p) =>
              `${placeText(p)} ${p.count === 1 ? "is" : "are"} left as ${p.count === 1 ? "it is" : "they are"}`,
          );
      if (left.length > 0) {
        lines.push(`${plural(left.length, "reference")} in content still name it`);
      }
      // Places the publish leaves using it: everything, with no cleanup waiting; retired copies;
      // live monsters left until they die.
      const stays = !action
        ? placeCount(places)
        : action.kind === "item" && action.copies === "retire"
          ? placeCount(places.filter((p) => p.place !== "quest"))
          : action.kind === "monster" && action.live === "leave"
            ? placeCount(places.filter((p) => p.place === "live"))
            : 0;
      out.push({ kind, key: d.key, lines, stillUsed: left.length + stays });
    }
    return out;
  }

  /** The references nothing resolves: in the published content, and in the world. */
  problems(world?: ContentWorld): ContentProblems {
    return {
      content: brokenReferences(withNpcSaves(this.published, this.npcSaves())).map((r) => ({
        where: r.where,
        message: referenceMessage(r),
      })),
      world: world ? world.problems() : [],
    };
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
    const out: PackNotice[] = [];
    for (const r of contentRows(this.db)) {
      // The pack that supplies the row now (a row no pack has any more: the newest pack).
      const owner = this.owners.get(rowLabel(r).toLowerCase()) ??
        this.packs.at(-1) ?? { name: "", version: "" };
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
    const next = this.candidate(() => deleteContentRow(this.db, ref.dataset, ref.part, ref.key));
    const problems = this.fullProblems(next);
    if (problems.length > 0) {
      return fail(
        "taking the pack's version would leave content that does not pass its checks",
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
