/**
 * The live content store's service (issue #27). It builds the store from the installed packs
 * and the operator layer at start-up, keeps the shared draft, publishes it (one transaction, one
 * publish-log entry, then the store is rebuilt and swapped in place), undoes a publish as a
 * whole, and lists the rows a newer pack version changed under an operator's change.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import type {
  ArtFrameId,
  AssetIndex,
  ItemDefinition,
  Monster,
  MonsterDefinition,
  MonsterSpellRule,
  RectsData,
} from "@secondstaronline/data";
import { applyKey, encodePng, GREEN } from "@secondstaronline/data/art";
import {
  type ArtData,
  artDataSchema,
  comparePackVersions,
  DATASET_SCHEMAS,
  NO_BODY_NUMBERS,
  nextOperatorBody,
  skillDependents,
} from "@secondstaronline/data/schema";
import {
  type BodyChange,
  type BodyFrameSet,
  type BodyMonsterRow,
  bodyNumbersOf,
  bodyUses,
  buildContentStore,
  CONTENT_FORMAT,
  type ContentBalanceView,
  type ContentBodyArtView,
  type ContentData,
  type ContentFxArtView,
  type ContentItemsView,
  type ContentItemView,
  type ContentMonstersView,
  type ContentMonsterView,
  type ContentSoundArtView,
  type ContentStore,
  type ContentTileArtView,
  type ContentWornArtView,
  checkNpcFile,
  compileDefinitions,
  content,
  cutTileCell,
  DATASET_IDS,
  type DatasetId,
  DEFINITION_TABLES,
  definesBehaviours,
  editorLines,
  type FxChange,
  type FxSheetLayout,
  type FxSpellRow,
  fxFramesOf,
  fxRuns,
  fxTriggerProblems,
  hasContent,
  type ItemListEntry,
  installContent,
  isEngineFixture,
  isUniqueContainer,
  lingoContains,
  lingoEq,
  type MonsterListEntry,
  nextTileCodes,
  npcFieldOk,
  npcSections,
  orphanedFxUploads,
  ownLayerPossible,
  type PictureChange,
  pictureOf,
  planBody,
  planFx,
  planPicture,
  planSound,
  planTile,
  planWorn,
  removedTileCodes,
  resolveIn,
  resolveMonster,
  resolveNpcItemNames,
  ruleMatches,
  SERVER_ONLY_DATASETS,
  type SoundChange,
  seedDefinition,
  seedMonsterDefinition,
  soundUses,
  TILE_MAPS_SHOWN,
  TILES_PER_SHEET,
  type TileChange,
  type TileRow,
  tileImageProblem,
  tileRefs,
  tileSheetGrid,
  tileShows,
  tileUsersText,
  visibleBounds,
  type WornChange,
  wornLayerOf,
  wornLayers,
} from "@secondstaronline/shared";

import { insertAudit } from "../persistence/admin.ts";
import { memoryArtFiles, packArtFileReader } from "../persistence/art-files.ts";
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
  type ArtKeys,
  ArtLibrary,
  type BuiltArt,
  checkUpload,
  keysOf,
  nullRecord,
  SPRITE_MAX_SIDE,
  sliceBodySheet,
  sliceFxSheet,
  sliceWornSheet,
  soundFormatOf,
  UPLOAD_MAX_BYTES,
  type UploadKind,
  withArtRects,
} from "./art.ts";
import {
  lostArtProblems,
  newBodyGaps,
  newFxGaps,
  newItemArtGaps,
  newSoundProblems,
  newTileGaps,
  tileRefProblems,
  usedArt,
  wornSetProblems,
} from "./art-usage.ts";
import {
  type BalanceLayers,
  balanceFingerprint,
  balanceProblems,
  balanceRowDef,
  balanceView,
  engineValue,
} from "./balance.ts";
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
import { contractProblems } from "./contract.ts";
import { itemChoices, itemFingerprint, itemKind, itemProblems, ruleSources } from "./items-page.ts";
import { monsterChoices, monsterFieldProblems, monsterRuleSources } from "./monsters-page.ts";
import { type LoadedPack, readPackBlob, readPackDir } from "./packs.ts";
import {
  applyRows,
  keyField,
  type LayerRow,
  mergePacks,
  missingDatasets,
  partOf,
  READ_ONLY_DATASETS,
  type RowRef,
  rowHash,
  rowLabel,
  rowsOf,
  rowValue,
  sameRow,
  withOptionalDatasets,
} from "./rows.ts";
import { mergePackArt, packArtLayers } from "./served-assets.ts";
import {
  badKeyForm,
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

/** The paperdoll layer an item in each equip slot is drawn on (boots have no aliases). */
const PAPERDOLL_LAYER_OF_SLOT: Partial<
  Record<string, "weapon" | "shield" | "helm" | "gloves" | "body">
> = { LeftHand: "weapon", RightHand: "shield", Head: "helm", Ring: "gloves", Body: "body" };

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
  /** The folder of the files its art rows name, or null (issue #29, stage 8). */
  filesDir: string | null;
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
  /** What the notice means, when the row is not simply the pack's (an item definition, #30). */
  note?: string;
}

/** Whether a row is an item definition (issue #30). */
/** A new item's name from the Items page: at most 40 characters (an existing key may be 80). */
const ITEM_NEW_NAME_MAX = 40;
/** The species record fields the Monsters page's form writes (issue #31). */
const RECORD_FIELDS = [
  "hp",
  "attack",
  "defense",
  "xpMelee",
  "xpSpell",
  "skillXp",
  "spawnMinute",
  "flags",
] as const;
/** The tables an item's kind on the Items list is read from (`itemKind`). */
const KIND_TABLES = [
  "itemRules equip.slots",
  "attPower attPower.base",
  "itemRules armour.rows",
  "itemRules use.effects",
] as const;
const isDefinitionRow = (r: RowRef): boolean => r.dataset === "items" && r.part === "definitions";
/** A monster definition's row (issue #31). */
const isMonsterDefinitionRow = (r: RowRef): boolean =>
  r.dataset === "monsters" && r.part === "definitions";

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
  /**
   * The contract's point settings that cannot hold a player (`pointProblems`), judged with the
   * content installed when it is called: a publish asks it with the next content installed, as a
   * change to the tiles can make a point unwalkable. The game passes it; without it no point is
   * checked.
   */
  points?: () => ContentProblem[];
  /**
   * The uploaded art's library (issue #29): checks the `art` rows at publish and builds their hit
   * rects into the store. Without it (tests of the store alone) art rows are taken as they are.
   */
  art?: ArtLibrary;
  /** Whether an account may still upload (its role keeps the Content page's permission). */
  mayUpload?: (accountId: string) => boolean;
}

/** "A", "A and B", "A, B and C". */
function listOf(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The packs' collision rects folded in the order the served index draws them (issue #29, stage
 * 8): each pack's own rects (a later sprite of the same name wins), then its art rows' (whose runs
 * and trails are whole, hiding the frames under them after their last), then the next pack's.
 */
function foldRects(
  packs: readonly PackInfo[],
  packRects: readonly (RectsData | undefined)[],
  rows: readonly { id: string; built: BuiltArt }[],
): RectsData {
  let rects: RectsData = { fx: nullRecord(), chars: nullRecord(), items: nullRecord() };
  packs.forEach((p, i) => {
    const own = packRects[i];
    if (own) {
      rects = {
        fx: nullRecord({ ...rects.fx, ...own.fx }),
        chars: nullRecord({ ...rects.chars, ...own.chars }),
        items: nullRecord({ ...rects.items, ...own.items }),
      };
    }
    const built = rows.find((r) => r.id === p.id)?.built;
    if (built) {
      rects = withArtRects({ rects }, built.rects).rects;
    }
  });
  return rects;
}

/** The files an `art` dataset's rows name: pictures as PNGs, sounds in their format. */
function artFilesOf(
  art: Partial<Record<string, readonly unknown[]>>,
): { kind: "art" | "sounds"; hash: string; ext: "png" | "wav" | "mp3" | "ogg" }[] {
  const out: { kind: "art" | "sounds"; hash: string; ext: "png" | "wav" | "mp3" | "ogg" }[] = [];
  for (const [part, rows] of Object.entries(art)) {
    for (const row of rows ?? []) {
      if (part === "sounds") {
        const r = row as { file?: unknown; format?: unknown };
        if (typeof r.file === "string" && typeof r.format === "string") {
          out.push({ kind: "sounds", hash: r.file, ext: r.format as "wav" | "mp3" | "ogg" });
        }
        continue;
      }
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
          v.forEach(walk);
        } else if (v && typeof v === "object") {
          for (const [k, x] of Object.entries(v)) {
            if (k === "file" && typeof x === "string") {
              out.push({ kind: "art", hash: x, ext: "png" });
            } else {
              walk(x);
            }
          }
        }
      };
      walk(row);
    }
  }
  return out;
}

/** How long an upload ticket lasts. */
export const UPLOAD_TICKET_MS = 30 * 60 * 1000;

/** An upload's answer: the stored file's hash, or why it was refused. */
export type UploadAnswer =
  | { ok: true; file: string; ext: string; width?: number; height?: number }
  | { ok: false; error: string };

export class ContentService {
  private readonly db: Db;
  private readonly now: () => string;
  private readonly onPublish: (store: ContentStore, restoring: boolean) => void;
  private readonly log: (line: string) => void;
  private readonly points: () => ContentProblem[];
  private readonly art: ArtLibrary | null;
  private readonly mayUpload: (accountId: string) => boolean;
  /** The sprites and sounds the installed packs' own atlases and art rows supply. */
  private packArt: ArtKeys;
  /**
   * Each installed pack's art rows built into atlases (issue #29, stage 8), in install order: a
   * layer over that pack's built atlases and under the operator's art. Rows that can't be drawn
   * (a file missing or damaged) are skipped and listed in `packRowProblems`.
   */
  private packRows: { id: string; built: BuiltArt }[] = [];
  private packRowProblems: ContentProblem[] = [];
  /** Each pack's own library for its art rows, by pack id. */
  private readonly packRowLibraries = new Map<string, ArtLibrary>();
  /** The readers of the packs' `files/` folders (each answering only its own rows' hashes). */
  private readonly packReaders: ((
    kind: "art" | "sounds",
    hash: string,
    ext: "png" | "wav" | "mp3" | "ogg",
  ) => Uint8Array | string | null)[] = [];
  /** Every file hash the packs' art rows name. */
  private readonly packRowHashSet = new Set<string>();
  /** Where the packs' sounds are served, by lower-case name (issue #29, stage 7). */
  private packSounds: Record<string, string>;
  /** The packs merged in install order, without the operator layer. */
  private packData: ContentData;
  /** `packData` with its own item definitions compiled (for `packRowValue`). */
  private packCompiled: { from: ContentData; data: ContentData } | null = null;
  private packs: PackInfo[];
  /** The pack that supplies each row (the last to define it), by lower-cased row label. */
  private owners: Map<string, PackInfo>;
  private packKeys: { items: Set<string>; monsters: Set<string>; npcFiles: Set<string> };
  private published: ContentData;
  /** Values not yet moved into the operator layer, played over it in memory (`holdMoved`). */
  private held: LayerRow[] = [];
  private copy: ClientCopy;
  /** The last few published stores, so a client that asked just before a publish still gets one. */
  private readonly recent = new Map<string, ClientCopy>();
  private current: ContentStore;

  constructor(opts: ContentServiceOptions) {
    this.db = opts.db;
    this.now = opts.now;
    this.onPublish = opts.onPublish ?? (() => {});
    this.log = opts.log ?? (() => {});
    this.points = opts.points ?? (() => []);
    this.art = opts.art ?? null;
    this.mayUpload = opts.mayUpload ?? (() => true);
    const {
      data: merged,
      packs,
      owners,
      updates,
      rowArt,
      packRects,
    } = this.loadPacks(opts.releasePacks);
    this.buildPackRows(packs, rowArt);
    // What the packs draw, hit and play, folded in the served index's order (each pack's atlases,
    // then its art rows, then the next pack's), so a sprite's hit rect is the one drawn.
    const layers = packArtLayers(packs, this.packRows);
    // (With no art rows the packs' merged rects already are that order.)
    const data =
      this.packRows.length > 0
        ? { ...merged, rects: foldRects(packs, packRects, this.packRows) }
        : merged;
    const drawn = mergePackArt(
      { version: 1, atlases: {}, sounds: {} } as unknown as AssetIndex,
      layers,
    );
    this.owners = owners;
    this.packData = data;
    this.packs = packs;
    this.packKeys = {
      items: new Set(data.items.items.map((i) => i.name.toLowerCase())),
      monsters: new Set(data.monsters.monsters.map((m) => m.name.toLowerCase())),
      npcFiles: new Set(data.npcFiles.files.map((f) => f.name.toLowerCase())),
    };
    this.packArt = keysOf(drawn);
    this.packSounds = nullRecord<string>();
    for (const [name, url] of Object.entries(drawn.sounds)) {
      this.packSounds[name.toLowerCase()] = `/assets/${url}`;
    }
    this.published = this.withArt(applyRows(data, contentRows(this.db).map(toLayer)));
    const validArt = artDataSchema.safeParse(this.published.art).success;
    for (const p of (validArt && this.art?.problems(this.published.art)) || []) {
      // Art that cannot be read draws nothing; every publish names it until it is fixed.
      this.log(`content: ${p.where}: ${p.message}`);
    }
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
    // A world that breaks the contract still starts (an upgrade must not lock an operator out of
    // the Control Panel that fixes it), but no publish passes until it is fixed.
    for (const p of contractProblems(this.published)) {
      this.log(`content: ${p.where}: ${p.message} (the world does not meet the content contract)`);
    }
  }

  /** Reads every installed pack, records release versions, and merges them. */
  /**
   * Builds each pack's art rows into its own atlas layer (issue #29, stage 8), reading files from
   * the pack's `files/` folder (each checked against its name) or the upload store, and lays their
   * hit rects over the packs' own. Returns the packs' data with those rects.
   */
  private buildPackRows(
    packs: readonly PackInfo[],
    rowArt: readonly { pack: PackInfo; art: ArtData }[],
  ): void {
    for (const { pack, art } of rowArt) {
      const files = artFilesOf(art);
      if (files.length === 0) {
        continue;
      }
      const declared = new Set(files.map((f) => f.hash));
      for (const h of declared) {
        this.packRowHashSet.add(h);
      }
      // A pack's rows are read only from its own files (or, with no `files` folder, from the
      // upload store, where an imported pack's files are kept), never from another pack's.
      let library: ArtLibrary;
      if (pack.filesDir) {
        const reader = packArtFileReader(pack.filesDir, pack.name, declared, UPLOAD_MAX_BYTES);
        library = new ArtLibrary(memoryArtFiles());
        library.addReader(reader);
        // An operator row may name a file only a pack carries (it is copied to the upload store
        // when the row is saved; this covers rows saved before).
        this.art?.addReader(reader);
        this.packReaders.push(reader);
      } else {
        library = new ArtLibrary(this.art?.files ?? memoryArtFiles());
      }
      // A row with any frame that can't be drawn is left out whole, so the art under it shows.
      const problems = library.problems(art);
      const bad = new Set(problems.map((p) => p.where));
      const good = Object.fromEntries(
        Object.entries(art).map(([part, rows]) => [
          part,
          (rows as { name?: string; code?: string }[]).filter(
            (r) => !bad.has(`art/${part}/${r.name ?? r.code}`),
          ),
        ]),
      ) as ArtData;
      for (const problem of problems) {
        this.packRowProblems.push({
          where: `pack ${pack.name}: ${problem.where}`,
          message: problem.message,
        });
        this.log(`content: pack ${pack.id}: ${problem.where}: ${problem.message}`);
      }
      this.packRows.push({ id: pack.id, built: library.build(good) });
      // Built once: its decoded pictures need not stay in memory.
      library.forget();
      this.packRowLibraries.set(pack.id, library);
    }
  }

  /** Every file hash the installed packs' art rows name: the upload sweep keeps them. */
  packRowHashes(): ReadonlySet<string> {
    return this.packRowHashSet;
  }

  /**
   * Copies files an art row names that only a pack carries into the upload store, so the row
   * keeps working if a later pack version drops them (issue #29, stage 8).
   */
  private adoptPackFiles(part: string, data: unknown): void {
    if (!this.art || data === null || typeof data !== "object") {
      return;
    }
    for (const f of artFilesOf({ [part]: [data] })) {
      if (!this.packRowHashSet.has(f.hash) || this.art.files.read(f.kind, f.hash, f.ext)) {
        continue;
      }
      for (const read of this.packReaders) {
        const bytes = read(f.kind, f.hash, f.ext);
        if (bytes instanceof Uint8Array) {
          this.art.files.put(f.kind, f.ext, bytes);
          break;
        }
      }
    }
  }

  /**
   * The installed packs' art rows as built (issue #29, stage 8), in install order: the served
   * index lays each over its pack's own atlases.
   */
  packRowArt(): readonly { id: string; built: BuiltArt }[] {
    return this.packRows;
  }

  /** A file a pack's art rows name, from its `files/` folder or the upload store (or null). */
  packRowFile(
    kind: "art" | "sounds",
    hash: string,
    ext: "png" | "wav" | "mp3" | "ogg",
  ): Uint8Array | null {
    if (!this.packRowHashSet.has(hash)) {
      return null;
    }
    for (const library of this.packRowLibraries.values()) {
      const got = library.read(kind, hash, ext);
      if (got instanceof Uint8Array) {
        return got;
      }
    }
    return null;
  }

  private loadPacks(releasePacks: Readonly<Record<string, string>>): {
    data: ContentData;
    packs: PackInfo[];
    owners: Map<string, PackInfo>;
    updates: PackVersionUpdate[];
    rowArt: { pack: PackInfo; art: ArtData }[];
    /** Each pack's own collision rects (aligned with `packs`), for folding in draw order. */
    packRects: (RectsData | undefined)[];
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
        filesDir: pack.filesDir,
        name: pack.manifest.name,
        version: pack.manifest.version,
        source: p.source,
        updatedFrom,
      });
    }
    // A pack's art rows are a layer of that pack's art, not rows of the operator's `art` dataset:
    // the store's `art` is the operator's uploads alone, drawn over every pack (issue #29, stage 8).
    const rowArt: { pack: PackInfo; art: ArtData }[] = [];
    loaded.forEach((l, i) => {
      if (l.data.art) {
        rowArt.push({ pack: packs[i] as PackInfo, art: l.data.art as ArtData });
        l.data = { ...l.data };
        delete l.data.art;
      }
    });
    const merged = withOptionalDatasets(mergePacks(loaded.map((l) => l.data)));
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
    return {
      data: merged as ContentData,
      packs,
      owners,
      updates,
      rowArt,
      packRects: loaded.map((l) => l.data.rects as RectsData | undefined),
    };
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
    return this.withArt(applyRows(this.packData, this.layerWith(draft)));
  }

  /** The store's data with the uploaded art's hit rects over the packs'. */
  private withArt(data: ContentData): ContentData {
    // Rows that do not match the schema are named by the schema checks; only valid ones build.
    return this.art && artDataSchema.safeParse(data.art).success
      ? withArtRects(data, this.art.build(data.art).rects)
      : data;
  }

  /** Open upload tickets: a Content page asks for one, then sends files over HTTP with it. */
  private readonly tickets = new Map<string, { actor: ContentActor; expires: number }>();

  /**
   * A ticket for uploading art and sounds (the Content page's permission was checked when it was
   * asked for). It lasts `UPLOAD_TICKET_MS`, for any number of files.
   */
  uploadTicket(actor: ContentActor, nowMs: number = Date.now()): string {
    for (const [t, v] of this.tickets) {
      if (v.expires <= nowMs) {
        this.tickets.delete(t);
      }
    }
    const ticket = crypto.randomUUID();
    this.tickets.set(ticket, { actor, expires: nowMs + UPLOAD_TICKET_MS });
    return ticket;
  }

  /**
   * Stores an uploaded file once it passes its checks: it is named by its hash and goes live only
   * when a published `art` row names it.
   */
  /** Whether a ticket is live and its holder still has the Content page's permission. */
  uploadTicketOk(ticket: string, nowMs: number = Date.now()): boolean {
    const t = this.tickets.get(ticket);
    if (!t || t.expires <= nowMs) {
      return false;
    }
    if (!this.mayUpload(t.actor.accountId)) {
      this.tickets.delete(ticket);
      return false;
    }
    return true;
  }

  upload(
    ticket: string,
    kind: UploadKind,
    bytes: Uint8Array,
    nowMs: number = Date.now(),
  ): { status: number; body: UploadAnswer } {
    const t = this.tickets.get(ticket);
    if (!t || !this.uploadTicketOk(ticket, nowMs)) {
      return { status: 403, body: { ok: false, error: "the upload ticket is missing or expired" } };
    }
    if (!this.art) {
      return { status: 503, body: { ok: false, error: "this server stores no uploads" } };
    }
    const check = checkUpload(bytes, kind);
    if (!check.ok) {
      return { status: 422, body: { ok: false, error: check.error } };
    }
    const file = this.art.files.put(check.kind === "image" ? "art" : "sounds", check.ext, bytes);
    // A draft may already name this file: check it again.
    this.art.stored(file);
    this.checked = null;
    this.log(
      `content: ${t.actor.name} uploaded ${check.kind} ${file}.${check.ext} (${bytes.length} bytes)`,
    );
    return {
      status: 200,
      body:
        check.kind === "image"
          ? { ok: true, file, ext: check.ext, width: check.width, height: check.height }
          : { ok: true, file, ext: check.ext },
    };
  }

  /** The uploaded art the published store draws (empty without an art library). */
  builtArt(): BuiltArt | null {
    return this.art?.build(this.published.art) ?? null;
  }

  /**
   * The art problems of `next`: rows whose files are missing or misshapen, and art taken away
   * while content still draws or plays it.
   */
  private artProblems(next: ContentData): ContentProblem[] {
    // A spell run that hides before the frame its effect acts on (issue #29, stage 5).
    const triggers = fxTriggerProblems(next, this.published);
    // A tile the draft takes out of the catalogue that content still names (issue #29, stage 6).
    const tileRefs = tileRefProblems(next, this.published);
    if (!this.art) {
      return [...triggers, ...tileRefs];
    }
    const before = keysOf(this.art.build(this.published.art).index);
    const after = keysOf(this.art.build(next.art).index);
    return [
      ...this.art.problems(next.art),
      ...lostArtProblems(next, this.packArt, before, after),
      ...newBodyGaps(next, this.published, this.packArt, before, after),
      ...newFxGaps(next, this.published, this.packArt),
      ...newTileGaps(next, this.published, this.packArt, after),
      // A defined item's swing sound is its definition's (issue #30).
      ...newSoundProblems(
        compileDefinitions(next),
        compileDefinitions(this.published),
        this.packArt,
        before,
        after,
      ),
      ...triggers,
      ...tileRefs,
      ...wornSetProblems(next, this.published),
      ...newItemArtGaps(next, this.published, this.packArt, after, before),
    ];
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
    const part = partOf(ref.dataset, ref.part);
    if (!part) {
      return `${ref.dataset} has no field ${ref.part}`;
    }
    const field = keyField(ref.dataset, ref.part);
    if (field === null && ref.key !== null) {
      return `${ref.dataset}/${ref.part} is one row, not a keyed list`;
    }
    if (field !== null && (ref.key === null || ref.key === "")) {
      return `${ref.dataset}/${ref.part} needs the key of the row`;
    }
    if (field === null && op === "remove" && !part.optional) {
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
    if (op === "set" && ref.dataset === "art") {
      this.adoptPackFiles(ref.part, data);
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
    // A file the NPC Editor or the Monsters page saved plays instead of its content row, so a
    // change to the row would publish and never play (issue #31): it is refused, naming where the
    // file is changed instead.
    if (
      (op === "set" || op === "revert") &&
      ref.dataset === "npcFiles" &&
      ref.part === "files" &&
      ref.key !== null &&
      this.npcSaves().some((f) => f.npc.toLowerCase() === (ref.key as string).toLowerCase())
    ) {
      return fail(
        `${ref.key}'s NPC file has a live save (from the NPC Editor or the Monsters page), which plays instead of this row: change it there.`,
      );
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
    // A skill another skill's progression names (a requirement, a formula) cannot go first.
    if (op === "remove" && ref.dataset === "classes" && ref.part === "skills" && ref.key !== null) {
      const classes = this.draftContent().classes;
      const needs = skillDependents(classes.progression, classes.skills, ref.key);
      if (needs.length > 0) {
        return fail(
          `${ref.key} cannot be removed: ${listOf(needs)} ${needs.length === 1 && needs[0] !== "the world's defaults" ? "depends" : "depend"} on it (a requirement or a formula in the progression names it). Change that progression first.`,
        );
      }
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
      // A species' definition is its record's (issue #31): removing the species from any path
      // removes the definition too (a definition only the draft holds is discarded).
      if (op === "remove" && ref.dataset === "monsters" && ref.part === "monsters" && key) {
        const defRef: RowRef = { dataset: "monsters", part: "definitions", key };
        const pending = this.draft().find((d) => sameRow(d, defRef));
        if (rowValue(this.published, defRef) !== undefined) {
          upsertDraftRow(this.db, { ...row, ...defRef, op: "remove", data: null });
        } else if (pending) {
          deleteDraftRow(this.db, "monsters", "definitions", pending.key as string);
        }
      }
    })();
    return { ok: true, value: undefined };
  }

  /** The item pictures the installed packs draw, in lower case (issue #29). */
  packPictures(): string[] {
    return [...this.packArt.sprites.items].sort();
  }

  /**
   * One picture change from the Content page's picker (issue #29), put in the draft as a whole:
   * the item is read as the draft has it now and only its `sprite` and its upload change, so an
   * edit someone else made to the row meanwhile is kept, and no half of the change is left.
   */
  draftPicture(actor: ContentActor, change: PictureChange): ContentResult<string> {
    const base = this.draftContent();
    const uploads = new Set(base.art.items.map((a) => a.name.toLowerCase()));
    const plan = planPicture(change, base.items.items, base.art.items, (name) => {
      const n = name.toLowerCase();
      return uploads.has(n) || this.packArt.sprites.items.has(n);
    });
    if (!plan.ok) {
      return fail(plan.error);
    }
    const wrote = this.writeDraftRows(actor, plan.rows, ["items", "art"]);
    if (!wrote.ok) {
      return fail("the picture does not match the art rows' schema", wrote.problems);
    }
    const what =
      change.op === "pile"
        ? change.pile
        : `${base.items.items.find((i) => i.name.toLowerCase() === change.item.toLowerCase())?.name ?? change.item}'s picture`;
    return { ok: true, value: `${what} is in the draft.` };
  }

  /**
   * Puts rows a Content page change works out in the draft as a whole (issue #29): taking out a
   * row only the draft adds drops that draft change. Refused, writing nothing, when the rows break
   * the schema of one of `datasets`.
   */
  private writeDraftRows(
    actor: ContentActor,
    rows: readonly { ref: RowRef; op: "set" | "remove"; data: unknown }[],
    datasets: readonly string[],
  ): { ok: true } | { ok: false; problems: ContentProblem[] } {
    const now = this.now();
    const writes: DraftRow[] = [];
    const drops: RowRef[] = [];
    for (const r of rows) {
      // Taking out a row only the draft adds is dropping that draft change, and so is setting a
      // row back to what is published (a tile added and taken out again leaves no override).
      const live = rowValue(this.published, r.ref);
      if (
        (r.op === "remove" && live === undefined) ||
        (r.op === "set" && live !== undefined && rowHash(live) === rowHash(r.data))
      ) {
        drops.push(r.ref);
        continue;
      }
      if (r.op === "set" && r.ref.dataset === "art") {
        this.adoptPackFiles(r.ref.part, r.data);
      }
      writes.push({
        ...r.ref,
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
    const problems = schemaProblems(this.draftContent(draft)).filter((p) =>
      datasets.some((d) => p.where === d || p.where.startsWith(`${d}/`)),
    );
    if (problems.length > 0) {
      return { ok: false, problems };
    }
    this.db.transaction(() => {
      for (const d of drops) {
        deleteDraftRow(this.db, d.dataset, d.part, d.key);
      }
      for (const w of writes) {
        upsertDraftRow(this.db, w);
      }
    })();
    return { ok: true };
  }

  /** The worn frame set panels' view, worked out from the draft's rules (issue #29, stage 3). */
  wornArtView(): ContentWornArtView {
    // With the item definitions compiled: a defined item's slot and behaviours are its own (#30).
    const d = this.compiledDraft(this.draft());
    const items: ContentWornArtView["items"] = [];
    for (const i of d.items.items) {
      const w = wornLayerOf(d.itemRules, i.name);
      if (w) {
        items.push({
          name: i.name,
          ...(i.display !== undefined ? { display: i.display } : {}),
          ...(i.retired ? { retired: true } : {}),
          ...w,
          ownLayerPossible:
            w.ownLayerPossible && ownLayerPossible(d.itemRules, d.items.items, i.name),
        });
      }
    }
    const packLayers = nullRecord<ArtFrameId[]>();
    for (const key of [...this.packArt.sprites.paperdoll].sort()) {
      const m = /^(.*)-(f[1-4]-[nesw])$/.exec(key);
      if (m) {
        const layer = m[1] as string;
        packLayers[layer] = [...(packLayers[layer] ?? []), m[2] as ArtFrameId];
      }
    }
    return {
      items,
      layers: [...wornLayers(d).values()],
      art: d.art.paperdoll,
      packLayers,
      rules: { aliases: d.itemRules.paperdoll.aliases, behaviours: d.itemRules.behaviours },
      head: d.classes.creation.sexes[0]?.heads[0] ?? 1,
    };
  }

  /**
   * One worn layer change from the Content page (issue #29, stage 3), put in the draft as a whole:
   * a layer's frames, taking its upload out, or an item's own layer (its exact aliases out).
   */
  draftWorn(actor: ContentActor, change: WornChange): ContentResult<string> {
    const base = this.draftContent();
    // Whether an item is worn, and its behaviours, are its definition's (issue #30): read from the
    // compiled tables. The plan writes only the paperdoll part, which a compile never changes.
    const compiled = this.compiledDraft(this.draft());
    if (change.op === "ownLayer") {
      // An item whose definition draws it as another item: its definition decides its aliases
      // (the pack table's rows no longer apply to it), so its "drawn as" is what goes.
      const def = (base.items.definitions ?? []).find((x) => lingoEq(x.name, change.item));
      if (def?.paperdoll !== undefined) {
        const { paperdoll: _, ...rest } = def;
        const wrote = this.writeDraftRows(
          actor,
          [
            {
              ref: { dataset: "items", part: "definitions", key: def.name },
              op: "set",
              data: rest,
            },
          ],
          ["items"],
        );
        if (!wrote.ok) {
          return fail("the change does not match the rows' schema", wrote.problems);
        }
        return { ok: true, value: `${def.name} draws a layer of its own in the draft.` };
      }
    }
    const plan = planWorn(
      change,
      {
        ...base.itemRules,
        equip: compiled.itemRules.equip,
        behaviours: compiled.itemRules.behaviours,
      },
      base.items.items,
      base.art.paperdoll,
    );
    if (!plan.ok) {
      return fail(plan.error);
    }
    const wrote = this.writeDraftRows(actor, plan.rows, ["itemRules", "art"]);
    if (!wrote.ok) {
      return fail("the change does not match the rows' schema", wrote.problems);
    }
    if (change.op === "ownLayer") {
      const item = base.items.items.find((i) => i.name.toLowerCase() === change.item.toLowerCase());
      return {
        ok: true,
        value: `${item?.name ?? change.item} draws a layer of its own in the draft.`,
      };
    }
    const row = plan.rows[0];
    const name = row?.ref.key ?? change.layer;
    return {
      ok: true,
      value:
        change.op === "remove"
          ? `${name}'s upload is out of the draft.`
          : `${name}'s worn frames are in the draft.`,
    };
  }

  /**
   * Cuts an uploaded worn sheet into frame files, stored like any upload (issue #29, stage 3).
   * Nothing goes in the draft.
   */
  wornSheet(
    sheet: string,
  ): { ok: true; frames: Partial<Record<ArtFrameId, string>> } | { ok: false; error: string } {
    if (!this.art) {
      return { ok: false, error: "this server stores no uploads" };
    }
    const img = this.art.image(sheet);
    if (typeof img === "string") {
      return { ok: false, error: `the sheet cannot be read: ${img}` };
    }
    const cells = sliceWornSheet(img);
    if (typeof cells === "string") {
      return { ok: false, error: cells };
    }
    const frames: Partial<Record<ArtFrameId, string>> = {};
    for (const [id, cell] of cells) {
      const file = this.art.files.put("art", "png", encodePng(cell));
      this.art.stored(file);
      frames[id] = file;
    }
    this.checked = null;
    return { ok: true, frames };
  }

  /** The body numbers the installed packs draw (issue #29, stage 4). */
  packBodies(): number[] {
    return [...bodyNumbersOf(this.packArt.sprites.bodies)].sort((a, b) => a - b);
  }

  /**
   * The number a new body takes in `data`: the first from 1000 that no pack draws, no upload has
   * and no content names (issue #29, stage 4).
   */
  private nextBody(data: ContentData): number | null {
    const taken = new Set<number>([
      ...bodyNumbersOf(this.packArt.sprites.bodies),
      ...data.art.bodies.map((a) => Number(a.name)),
      ...bodyUses(data).keys(),
      // Smoke Bomb's body is drawn as nothing, so no draw counts it, but its number is taken.
      ...(data.bindings.bodies?.smoke === undefined ? [] : [data.bindings.bodies.smoke]),
    ]);
    return nextOperatorBody(taken);
  }

  /** The body panels' view, from the draft (issue #29, stage 4). */
  bodyArtView(): ContentBodyArtView {
    const d = this.draftContent();
    return {
      bodies: [...bodyUses(d).values()],
      monsters: d.monsters.monsters.map((m) => ({
        name: m.name,
        ...(m.display !== undefined ? { display: m.display } : {}),
        body: m.body,
      })),
      art: d.art.bodies,
      packBodies: this.packBodies(),
      next: this.nextBody(d),
      maxSide: SPRITE_MAX_SIDE,
      head: d.classes.creation.sexes[0]?.heads[0] ?? 1,
    };
  }

  /**
   * One body change from the Content page (issue #29, stage 4), put in the draft as a whole: a
   * new body's number is picked here, against the draft as it is now, in the same change that
   * stores its frames and gives it to its monster, so two admins never take the same number.
   */
  draftBody(
    actor: ContentActor,
    change: BodyChange,
  ): ContentResult<{ text: string; body: number }> {
    const base = this.draftContent();
    const uploads = new Set(base.art.bodies.map((a) => Number(a.name)));
    const packs = bodyNumbersOf(this.packArt.sprites.bodies);
    const plan = planBody(change, {
      monsters: base.monsters.monsters as unknown as BodyMonsterRow[],
      art: base.art.bodies,
      exists: (n) => uploads.has(n) || packs.has(n),
      nextNumber: change.op === "new" ? this.nextBody(base) : null,
      noNumbers: NO_BODY_NUMBERS,
      uses: (n) => bodyUses(base).get(n),
    });
    if (!plan.ok) {
      return fail(plan.error);
    }
    // Every frame is checked here too, before either row is written: a stored PNG, at most
    // 512×512, with something showing once its transparency is applied.
    if (change.op === "set" || change.op === "new") {
      const bad = this.bodyFrameProblem(change.frames, change.transparency);
      if (bad) {
        return fail(bad);
      }
    }
    const wrote = this.writeDraftRows(actor, plan.rows, ["monsters", "art"]);
    if (!wrote.ok) {
      return fail("the change does not match the rows' schema", wrote.problems);
    }
    const monster =
      "monster" in change && change.monster !== undefined
        ? (base.monsters.monsters.find(
            (m) => m.name.toLowerCase() === change.monster?.toLowerCase(),
          )?.name ?? change.monster)
        : null;
    switch (change.op) {
      case "remove":
        return {
          ok: true,
          value: { text: `Body ${plan.body}'s upload is out of the draft.`, body: plan.body },
        };
      case "choose":
        return {
          ok: true,
          value: { text: `${monster} has body ${plan.body} in the draft.`, body: plan.body },
        };
      case "new":
        return {
          ok: true,
          value: {
            text: monster
              ? `Body ${plan.body} is in the draft, as ${monster}'s body.`
              : `Body ${plan.body} is in the draft.`,
            body: plan.body,
          },
        };
      default:
        return {
          ok: true,
          value: { text: `Body ${plan.body}'s frames are in the draft.`, body: plan.body },
        };
    }
  }

  /** What is wrong with a body's frame files, or null when nothing is (issue #29, stage 4). */
  private bodyFrameProblem(
    frames: BodyFrameSet["frames"],
    transparency: "alpha" | "green",
  ): string | null {
    if (!this.art) {
      return "this server stores no uploads";
    }
    for (const [id, f] of Object.entries(frames)) {
      if (!f) {
        continue;
      }
      const img = this.art.image(f.file);
      if (typeof img === "string") {
        return `${id}: ${img}`;
      }
      if (img.width > SPRITE_MAX_SIDE || img.height > SPRITE_MAX_SIDE) {
        return `${id} is ${img.width}×${img.height}; body frames may be at most ${SPRITE_MAX_SIDE}×${SPRITE_MAX_SIDE}`;
      }
      const copy = { width: img.width, height: img.height, data: img.data.slice() };
      if (transparency === "green") {
        applyKey(copy, { kind: "color", rgb: GREEN });
      }
      if (visibleBounds(copy) === null) {
        return `${id} shows nothing: every frame of a body is drawn`;
      }
    }
    return null;
  }

  /**
   * Cuts an uploaded body sheet into its 16 frame files, stored like any upload (issue #29,
   * stage 4). Nothing goes in the draft.
   */
  bodySheet(
    sheet: string,
  ):
    | { ok: true; cell: { w: number; h: number }; frames: Partial<Record<ArtFrameId, string>> }
    | { ok: false; error: string } {
    if (!this.art) {
      return { ok: false, error: "this server stores no uploads" };
    }
    const img = this.art.image(sheet);
    if (typeof img === "string") {
      return { ok: false, error: `the sheet cannot be read: ${img}` };
    }
    const cut = sliceBodySheet(img);
    if (typeof cut === "string") {
      return { ok: false, error: cut };
    }
    const frames: Partial<Record<ArtFrameId, string>> = {};
    for (const [id, cell] of cut.frames) {
      const file = this.art.files.put("art", "png", encodePng(cell));
      this.art.stored(file);
      frames[id] = file;
    }
    this.checked = null;
    return { ok: true, cell: cut.cell, frames };
  }

  /** The runs the installed packs draw, with their frame and trail counts (issue #29, stage 5). */
  private packRuns(): Record<string, { frames: number; trail: number }> {
    const frames = fxFramesOf(this.packArt.sprites.fx);
    const out = nullRecord<{ frames: number; trail: number }>();
    for (const [run, set] of frames) {
      if (/^x/.test(run) && frames.has(run.slice(1))) {
        continue;
      }
      out[run] = { frames: set.size, trail: frames.get(`x${run}`)?.size ?? 0 };
    }
    return out;
  }

  /** The effect panels' view, from the draft (issue #29, stage 5). */
  fxArtView(): ContentFxArtView {
    const d = this.draftContent();
    return {
      runs: [...fxRuns(d).values()],
      spells: d.spells.spells
        .filter((s) => s.fx.length > 0)
        .map((s) => ({
          name: s.name,
          ...((s as { display?: string }).display !== undefined
            ? { display: (s as { display?: string }).display as string }
            : {}),
          fx: s.fx.map((f) => ({
            member: f.member,
            effect: f.effect,
            frames: f.frames,
            lastFrame: f.lastFrame,
          })),
        })),
      art: d.art.fx,
      packRuns: this.packRuns(),
      maxSide: SPRITE_MAX_SIDE,
      head: d.classes.creation.sexes[0]?.heads[0] ?? 1,
    };
  }

  /**
   * One effect run change from the Content page (issue #29, stage 5), put in the draft as a whole:
   * a run's frames and trail and, from its spell, the spell row's length in the same change; or
   * its upload taken out. Every frame is checked before anything is written.
   */
  draftFx(actor: ContentActor, change: FxChange): ContentResult<{ text: string; run: string }> {
    const base = this.draftContent();
    const plan = planFx(change, {
      runs: fxRuns(base),
      spells: base.spells.spells as unknown as FxSpellRow[],
      art: base.art.fx,
      packRuns: new Set(Object.keys(this.packRuns())),
    });
    if (!plan.ok) {
      return fail(plan.error);
    }
    if (change.op === "set") {
      const bad = this.fxFrameProblem(
        [
          ...change.frames.map((f, i) => [`frame ${i + 1}`, f.file] as const),
          ...(change.trail ?? []).map((f, i) => [`trail frame ${i + 1}`, f.file] as const),
        ],
        change.transparency,
      );
      if (bad) {
        return fail(bad);
      }
    }
    const wrote = this.writeDraftRows(actor, plan.rows, ["spells", "art"]);
    if (!wrote.ok) {
      return fail("the change does not match the rows' schema", wrote.problems);
    }
    if (change.op === "remove") {
      return {
        ok: true,
        value: { text: `${plan.run}'s upload is out of the draft.`, run: plan.run },
      };
    }
    const fitted = plan.rows.some((r) => r.ref.dataset === "spells");
    return {
      ok: true,
      value: {
        text: `${plan.run}'s frames are in the draft${fitted ? `, and its spell plays all ${change.frames.length}` : ""}.`,
        run: plan.run,
      },
    };
  }

  /** What is wrong with a run's frame files, or null when nothing is (issue #29, stage 5). */
  private fxFrameProblem(
    frames: readonly (readonly [string, string])[],
    transparency: "alpha" | "green",
  ): string | null {
    if (!this.art) {
      return "this server stores no uploads";
    }
    for (const [label, file] of frames) {
      const img = this.art.image(file);
      if (typeof img === "string") {
        return `${label}: ${img}`;
      }
      if (img.width > SPRITE_MAX_SIDE || img.height > SPRITE_MAX_SIDE) {
        return `${label} is ${img.width}×${img.height}; effect frames may be at most ${SPRITE_MAX_SIDE}×${SPRITE_MAX_SIDE}`;
      }
      const copy = { width: img.width, height: img.height, data: img.data.slice() };
      if (transparency === "green") {
        applyKey(copy, { kind: "color", rgb: GREEN });
      }
      if (visibleBounds(copy) === null) {
        return `${label} shows nothing: every frame of a run is drawn`;
      }
    }
    return null;
  }

  /**
   * Cuts an uploaded effect strip into its run's and trail's frame files, stored like any upload
   * (issue #29, stage 5). Nothing goes in the draft.
   */
  fxSheet(
    sheet: string,
    layout: FxSheetLayout,
  ):
    | { ok: true; cell: { w: number; h: number }; frames: string[]; trail: string[] }
    | { ok: false; error: string } {
    if (!this.art) {
      return { ok: false, error: "this server stores no uploads" };
    }
    const img = this.art.image(sheet);
    if (typeof img === "string") {
      return { ok: false, error: `the sheet cannot be read: ${img}` };
    }
    const cut = sliceFxSheet(img, layout);
    if (typeof cut === "string") {
      return { ok: false, error: cut };
    }
    const store = (cell: (typeof cut.frames)[number]) => {
      const file = (this.art as ArtLibrary).files.put("art", "png", encodePng(cell));
      (this.art as ArtLibrary).stored(file);
      return file;
    };
    const frames = cut.frames.map(store);
    const trail = cut.trail.map(store);
    this.checked = null;
    return { ok: true, cell: cut.cell, frames, trail };
  }

  // ---- tiles (issue #29, stage 6) -------------------------------------------------------------

  /**
   * Every code a new tile may not take, lower case: what the packs, the published store and the
   * draft name (catalogue, walkable list, content rows, uploads), the packs' pictures, and every
   * code on a map, so a tile left on a map after its row went never comes back as another.
   */
  private takenTileCodes(
    d: ContentData,
    maps?: ReadonlyMap<string, readonly string[]>,
  ): Set<string> {
    const out = new Set<string>();
    const add = (c: string) => out.add(c.toLowerCase());
    for (const data of [this.packData, this.published, d]) {
      for (const t of data.tiles.catalogue) {
        add(t.code);
      }
      for (const w of data.tiles.walkable) {
        add(w.code);
      }
      for (const k of tileRefs(data).keys()) {
        add(k);
      }
      for (const a of data.art?.tiles ?? []) {
        add(a.code);
      }
    }
    for (const k of this.packArt.sprites.tiles) {
      add(k);
    }
    for (const k of maps?.keys() ?? []) {
      add(k);
    }
    // Every code a publish ever had, so a code taken out never comes back as another tile (an
    // open panel or a stale link would act on the wrong one).
    for (const k of this.historyTileCodes()) {
      add(k);
    }
    return out;
  }

  /** Every tile code the publish history names (lower case), worked out once per published store. */
  private historyCodes: { codes: Set<string> } | null = null;
  private historyTileCodes(): Set<string> {
    if (this.historyCodes) {
      return this.historyCodes.codes;
    }
    const codes = new Set<string>();
    for (const p of this.history(Number.MAX_SAFE_INTEGER)) {
      for (const c of p.changes) {
        if (c.dataset === "art" && c.part === "tiles" && c.key) {
          codes.add(c.key.toLowerCase());
        }
        if (c.dataset === "tiles" && (c.part === "catalogue" || c.part === "walkable")) {
          for (const state of [c.before, c.after]) {
            const rows = state?.data;
            if (Array.isArray(rows)) {
              for (const r of rows as { code?: unknown }[]) {
                if (typeof r?.code === "string") {
                  codes.add(r.code.toLowerCase());
                }
              }
            }
          }
        }
      }
    }
    this.historyCodes = { codes };
    return codes;
  }

  /** The tile panels' view, from the draft; the maps from `world` when it is known. */
  tileArtView(world?: ContentWorld): ContentTileArtView {
    const d = this.draftContent();
    const maps = world?.tileMaps?.() ?? new Map<string, string[]>();
    const shown: ContentTileArtView["maps"] = {};
    for (const [code, names] of maps) {
      shown[code] = { count: names.length, names: names.slice(0, TILE_MAPS_SHOWN) };
    }
    return {
      catalogue: d.tiles.catalogue as TileRow[],
      walkable: d.tiles.walkable.map((w) => w.code),
      art: d.art.tiles,
      packTiles: [...this.packArt.sprites.tiles].sort(),
      refs: Object.fromEntries(tileRefs(d)),
      maps: shown,
      next: nextTileCodes(this.takenTileCodes(d, maps), 1)?.[0] ?? null,
      ground: d.tiles.defaults.ground,
      liveUploads: this.published.art.tiles.map((a) => a.code.toLowerCase()),
      head: d.classes.creation.sexes[0]?.heads[0] ?? 1,
    };
  }

  /**
   * One tile change from the Content page, put in the draft as a whole: new tiles get their codes
   * here, against the draft and every map as they are now, in the same change that adds their
   * catalogue, walkable and art rows. Every picture is checked before anything is written.
   */
  draftTile(
    actor: ContentActor,
    change: TileChange,
    world?: ContentWorld,
  ): ContentResult<{ text: string; codes: string[] }> {
    const base = this.draftContent();
    // Only a new tile's code and a removal need the maps (every map not loaded is read).
    const maps = change.op === "add" || change.op === "delete" ? world?.tileMaps?.() : undefined;
    if (change.op === "add" || change.op === "set") {
      const files =
        change.op === "add"
          ? change.tiles.map((t, i) => [t.name?.trim() || `tile ${i + 1}`, t.file] as const)
          : [[`tile ${change.code}`, change.file] as const];
      const bad = this.tileFileProblem(files, change.transparency);
      if (bad) {
        return fail(bad);
      }
    }
    const plan = planTile(change, {
      catalogue: base.tiles.catalogue as TileRow[],
      walkable: base.tiles.walkable,
      art: base.art.tiles,
      taken: this.takenTileCodes(base, maps),
      packTiles: this.packArt.sprites.tiles,
      refs: tileRefs(base),
      published: new Set(this.published.tiles.catalogue.map((t) => t.code.toLowerCase())),
      ...(maps ? { maps } : {}),
    });
    if (!plan.ok) {
      return fail(plan.error);
    }
    const wrote = this.writeDraftRows(actor, plan.rows, ["tiles", "art"]);
    if (!wrote.ok) {
      return fail("the change does not match the rows' schema", wrote.problems);
    }
    const one = plan.codes[0] ?? "";
    const text = (() => {
      switch (change.op) {
        case "add":
          return plan.codes.length === 1
            ? `Tile ${one} is in the draft.`
            : `${plan.codes.length} tiles are in the draft (${plan.codes.join(", ")}).`;
        case "set":
          return `Tile ${one}'s picture is in the draft.`;
        case "remove":
          return `Tile ${one}'s upload is out of the draft.`;
        case "edit":
          return `Tile ${one}'s changes are in the draft.`;
        case "delete":
          return `Tile ${one} is out of the catalogue in the draft; its walkable row and upload go when it is published.`;
      }
    })();
    return { ok: true, value: { text, codes: plan.codes } };
  }

  /** What is wrong with tile picture files, or null when nothing is. */
  private tileFileProblem(
    files: readonly (readonly [string, string])[],
    transparency: "alpha" | "green",
  ): string | null {
    if (!this.art) {
      return "this server stores no uploads";
    }
    for (const [label, file] of files) {
      const img = this.art.image(file);
      if (typeof img === "string") {
        return `${label}: ${img}`;
      }
      const bad = tileImageProblem(img, transparency);
      if (bad) {
        return `${label}: ${bad}`;
      }
    }
    return null;
  }

  /**
   * Cuts an uploaded tileset into its 32×32 tiles, stored like any upload; cells that show nothing
   * once `transparency` is applied are left out. Nothing goes in the draft.
   */
  tileSheet(
    sheet: string,
    transparency: "alpha" | "green",
    world?: ContentWorld,
  ):
    | {
        ok: true;
        grid: { cols: number; rows: number };
        cells: { col: number; row: number; file: string }[];
      }
    | { ok: false; error: string } {
    if (!this.art) {
      return { ok: false, error: "this server stores no uploads" };
    }
    const img = this.art.image(sheet);
    if (typeof img === "string") {
      return { ok: false, error: `the tileset cannot be read: ${img}` };
    }
    const grid = tileSheetGrid(img.width, img.height);
    if (typeof grid === "string") {
      return { ok: false, error: grid };
    }
    // The cells that show something are counted before anything is written: a sheet with more
    // than one change can add, or more than there are codes left, is refused whole.
    const showing: { col: number; row: number; cell: ReturnType<typeof cutTileCell> }[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const cell = cutTileCell(img, col, row);
        if (tileShows(cell, transparency)) {
          showing.push({ col, row, cell });
        }
      }
    }
    if (showing.length === 0) {
      return { ok: false, error: "every cell of the tileset shows nothing" };
    }
    if (showing.length > TILES_PER_SHEET) {
      return {
        ok: false,
        error: `the tileset has ${showing.length} tiles; one file may add at most ${TILES_PER_SHEET}: split it`,
      };
    }
    const free = nextTileCodes(
      this.takenTileCodes(this.draftContent(), world?.tileMaps?.()),
      showing.length,
    );
    if (!free) {
      return {
        ok: false,
        error: `the tileset has ${showing.length} tiles, more than there are codes left`,
      };
    }
    const cells: { col: number; row: number; file: string }[] = [];
    if (grid.cols === 1 && grid.rows === 1) {
      // A single tile is the uploaded file itself.
      cells.push({ col: 0, row: 0, file: sheet });
    } else {
      for (const { col, row, cell } of showing) {
        const file = this.art.files.put("art", "png", encodePng(cell));
        this.art.stored(file);
        cells.push({ col, row, file });
      }
    }
    this.checked = null;
    return { ok: true, grid, cells };
  }

  /**
   * Tiles the draft takes out of the catalogue take their walkable rows and uploads with them
   * (issue #29, stage 6). Worked out when the draft is published, so discarding the removal leaves
   * every row as it was.
   */
  private settleTileOrphans(draft: readonly DraftRow[]): DraftRow[] {
    const next = this.draftContent(draft);
    const low = (c: string) => c.toLowerCase();
    // Only tiles the draft takes out of the published catalogue: rows staged for a tile the
    // catalogue does not list yet are the operator's to keep. (A tile added and taken out before
    // its first publish loses its rows when it is taken out: `planTile`.)
    const removed = new Set(
      removedTileCodes(
        this.published.tiles.catalogue as TileRow[],
        next.tiles.catalogue as TileRow[],
      ).map(low),
    );
    if (removed.size === 0) {
      return [...draft];
    }
    const walkable = next.tiles.walkable.filter((w) => !removed.has(low(w.code)));
    const art = next.art.tiles.filter((a) => removed.has(low(a.code)));
    if (walkable.length === next.tiles.walkable.length && art.length === 0) {
      return [...draft];
    }
    const by = draft.find((d) => d.dataset === "tiles" && d.part === "catalogue") ?? draft[0];
    if (!by) {
      return [...draft];
    }
    const stamp = {
      authorAccountId: by.authorAccountId,
      author: by.author,
      updatedAt: by.updatedAt,
    };
    let out = [...draft];
    const walkRef: RowRef = { dataset: "tiles", part: "walkable", key: null };
    if (walkable.length !== next.tiles.walkable.length) {
      out = out.filter((x) => !sameRow(x, walkRef));
      if (JSON.stringify(rowValue(this.published, walkRef)) !== JSON.stringify(walkable)) {
        out.push({ ...walkRef, op: "set", data: walkable, ...stamp });
      }
    }
    for (const a of art) {
      const ref: RowRef = { dataset: "art", part: "tiles", key: a.code };
      out = out.filter((x) => !sameRow(x, ref));
      if (rowValue(this.published, ref) !== undefined) {
        out.push({ ...ref, op: "remove", data: null, ...stamp });
      }
    }
    return out;
  }

  /**
   * The draft's tiles taken out that a map uses now, for the Content page's checks: maps change
   * without the draft changing, so this is worked out on each ask, not kept with `check`.
   */
  draftMapProblems(world?: ContentWorld): ContentProblem[] {
    return this.draft().length === 0 ? [] : this.tileMapProblems(this.draftContent(), world);
  }

  /** Tiles the draft takes out of the catalogue that a map still uses (issue #29, stage 6). */
  private tileMapProblems(next: ContentData, world?: ContentWorld): ContentProblem[] {
    const maps = world?.tileMaps?.();
    if (!maps) {
      return [];
    }
    const out: ContentProblem[] = [];
    for (const code of removedTileCodes(
      this.published.tiles.catalogue as TileRow[],
      next.tiles.catalogue as TileRow[],
    )) {
      if ((maps.get(code.toLowerCase()) ?? []).length > 0) {
        out.push({
          where: "tiles/catalogue",
          message: `tile ${code} is taken out but is still on ${tileUsersText(code, new Map(), maps)}`,
        });
      }
    }
    return out;
  }

  // ---- sounds (issue #29, stage 7) ------------------------------------------------------------

  /** The balance rows' layers, for the Balance page (issue #19). */
  private balanceLayers(): BalanceLayers {
    const draft = this.draft();
    return {
      pack: this.packData,
      published: this.published,
      draft: this.draftContent(draft),
      operatorRows: contentRows(this.db).filter((r) => r.dataset === "balance"),
      draftRows: draft.filter((d) => d.dataset === "balance"),
      notices: this.notices().filter((n) => n.dataset === "balance"),
      otherDraft: draft.filter((d) => d.dataset !== "balance").length,
    };
  }

  /**
   * A balance row's revision (the Balance page's fingerprint), or null for a row that is not a
   * balance row. Every change to a balance row names it, from the Balance page or the Content
   * page's JSON editor, so neither writes over a change it has not seen (issue #19).
   */
  balanceRevision(ref: RowRef): string | null {
    if (ref.dataset !== "balance") {
      return null;
    }
    const def = balanceRowDef(ref.part, ref.key);
    return def ? balanceFingerprint(def, this.balanceLayers()) : null;
  }

  /** The Balance page's view (issue #19). */
  balanceView(): ContentBalanceView {
    return balanceView(this.balanceLayers());
  }

  /**
   * One Balance page change (issue #19): `set` a balance row, `revert` it to the packs' value
   * (the engine's default when no pack sets it) or `discard` the draft's change to it. Refused
   * when the row changed since the page showed it (`expect`), for a row the page does not edit,
   * and for a value outside its limits (the dataset's schema, as for every draft change).
   */
  draftBalance(
    actor: ContentActor,
    change: {
      part: string;
      key: string | null;
      op: "set" | "revert" | "discard";
      data: unknown;
      expect: string;
    },
  ): ContentResult<string> {
    const def = balanceRowDef(change.part, change.key);
    if (!def) {
      return fail(
        `the Balance page has no row ${change.part}${change.key ? `/${change.key}` : ""}`,
      );
    }
    const l = this.balanceLayers();
    if (balanceFingerprint(def, l) !== change.expect) {
      return fail(`${def.label} changed since you opened it: look at it again before saving.`);
    }
    const ref: RowRef = { dataset: "balance", part: def.part, key: def.key };
    const inDraft = l.draftRows.some((d) => sameRow(d, ref));
    const edited = l.operatorRows.some((r) => sameRow(r, ref));
    if (change.op === "discard") {
      if (!inDraft) {
        return fail(`${def.label} has no change in the draft.`);
      }
      const r = this.draftDiscard(ref);
      return r.ok ? { ok: true, value: `${def.label}: the draft's change is gone.` } : r;
    }
    if (change.op === "revert") {
      const back =
        rowValue(this.packData, ref) === undefined ? "the engine's default" : "the pack's value";
      if (edited) {
        const r = this.draftSet(actor, ref, "revert", null);
        return r.ok ? { ok: true, value: `${def.label} goes back to ${back} when published.` } : r;
      }
      if (inDraft) {
        const r = this.draftDiscard(ref);
        return r.ok ? { ok: true, value: `${def.label} is back to ${back}.` } : r;
      }
      return fail(`${def.label} is already ${back}.`);
    }
    // Set back to what plays now: no change to stage, so a change in the draft is dropped (one
    // staged would publish as an operator row, which a pack update would then notice).
    const playing = rowValue(this.published, ref) ?? engineValue(def);
    if (rowHash(playing) === rowHash(change.data)) {
      if (!inDraft) {
        return fail(`${def.label} already plays that value.`);
      }
      const r = this.draftDiscard(ref);
      return r.ok ? { ok: true, value: `${def.label} is back to what plays now.` } : r;
    }
    const r = this.draftSet(actor, ref, "set", change.data);
    if (r.ok) {
      return { ok: true, value: `${def.label} is in the draft.` };
    }
    // A refusal names the page's fields, not the dataset's paths and keys.
    return r.problems ? fail(`${def.label} was not saved.`, balanceProblems(def, r.problems)) : r;
  }

  // ---- the Items page (issue #30, stage 3) ----------------------------------------------------

  /** The draft's data with its item definitions compiled, and each item's kind, by draft. */
  private itemsCache: {
    key: string;
    compiled: ContentData;
    kinds: Map<string, ItemListEntry["kind"]> | null;
  } | null = null;

  private compiledDraft(draft: readonly DraftRow[]): ContentData {
    const key = `${this.draftRev(draft)}\u0000${this.current.hash}`;
    if (this.itemsCache?.key !== key) {
      this.itemsCache = {
        key,
        compiled: compileDefinitions(this.draftContent(draft)),
        kinds: null,
      };
    }
    return this.itemsCache.compiled;
  }

  /** Each draft item's kind, from its definition or what it plays (in lower case). */
  private itemKinds(draft: readonly DraftRow[]): Map<string, ItemListEntry["kind"]> {
    const compiled = this.compiledDraft(draft);
    const cache = this.itemsCache as NonNullable<typeof this.itemsCache>;
    if (!cache.kinds) {
      const own = new Map(
        (compiled.items.definitions ?? []).map((d) => [d.name.toLowerCase(), d] as const),
      );
      cache.kinds = new Map(
        compiled.items.items.map((i) => {
          // A kind reads the slot, the attack roll, the armour and the use effects only.
          const def =
            own.get(i.name.toLowerCase()) ??
            seedDefinition(i.name, resolveIn(i.name, compiled, KIND_TABLES));
          return [i.name.toLowerCase(), itemKind(def)] as const;
        }),
      );
    }
    return cache.kinds;
  }

  /** The item an Items page change names, as the draft spells it, or undefined. */
  private draftItem(d: ContentData, name: string) {
    const k = name.toLowerCase();
    return d.items.items.find((i) => i.name.toLowerCase() === k);
  }

  /** An item as the Items page shows it, for `expect` (see `itemFingerprint`). */
  private itemFingerprintOf(name: string, draft: readonly DraftRow[] = this.draft()): string {
    const d = this.draftContent(draft);
    const defRef: RowRef = { dataset: "items", part: "definitions", key: name };
    const catRef: RowRef = { dataset: "items", part: "items", key: name };
    const definition = rowValue(d, defRef);
    return itemFingerprint({
      plays:
        definition === undefined
          ? seedDefinition(
              name,
              resolveIn(name, this.compiledDraft(draft)),
              this.compiledDraft(draft).items,
            )
          : null,
      definition: definition ?? null,
      catalogue: rowValue(d, catRef) ?? null,
      pending: [
        draft.find((r) => sameRow(r, defRef))?.op ?? null,
        draft.find((r) => sameRow(r, catRef))?.op ?? null,
      ],
      edited: contentRows(this.db).some((r) => sameRow(r, defRef)),
    });
  }

  /**
   * A monster as the Monsters page (and the Content page's JSON editor) last showed it (issue #31):
   * what it plays now when it has no definition, its definition and species record, and what the
   * draft holds for them. A change naming another is refused.
   */
  private monsterFingerprintOf(name: string, draft: readonly DraftRow[] = this.draft()): string {
    const d = this.draftContent(draft);
    const defRef: RowRef = { dataset: "monsters", part: "definitions", key: name };
    const recRef: RowRef = { dataset: "monsters", part: "monsters", key: name };
    const definition = rowValue(d, defRef);
    const compiled = this.compiledDraft(draft);
    return rowHash({
      plays:
        definition === undefined
          ? seedMonsterDefinition(name, resolveMonster(name, compiled), compiled.monsters)
          : null,
      definition: definition ?? null,
      record: rowValue(d, recRef) ?? null,
      pending: [
        draft.find((r) => sameRow(r, defRef))?.op ?? null,
        draft.find((r) => sameRow(r, recRef))?.op ?? null,
      ],
      edited: contentRows(this.db).some((r) => sameRow(r, defRef)),
    });
  }

  /**
   * A row's revision, where a change to it must name one: a balance row (the Balance page's
   * fingerprint, issue #19) or an item definition (the Items page's, issue #30), so neither page
   * nor the Content page's JSON editor writes over a change it has not seen. An item's catalogue
   * row carries the same revision, so a stale JSON save cannot undo an Items page rename. Null for
   * other rows, and for a definition no layer has yet (there is nothing to write over).
   */
  rowRevision(ref: RowRef): string | null {
    if (ref.dataset === "balance") {
      return this.balanceRevision(ref);
    }
    if (
      ref.dataset === "items" &&
      (ref.part === "definitions" || ref.part === "items") &&
      ref.key !== null
    ) {
      const draft = this.draft();
      const d = this.draftContent(draft);
      const known =
        rowValue(d, ref) !== undefined ||
        draft.some((r) => sameRow(r, ref)) ||
        contentRows(this.db).some((r) => sameRow(r, ref));
      if (!known) {
        return null;
      }
      // The Items page fingerprints an item by its catalogue key.
      const item = this.draftItem(d, ref.key);
      return this.itemFingerprintOf(item?.name ?? ref.key, draft);
    }
    // The monster spells: the Monsters page's card and the Content page's JSON editor (issue #31).
    if (ref.dataset === "monsters" && ref.part === "casting") {
      return this.monsterSpellsFingerprint(this.draft());
    }
    if (
      ref.dataset === "monsters" &&
      (ref.part === "definitions" || ref.part === "monsters") &&
      ref.key !== null
    ) {
      // A monster's definition and its species record share one revision (issue #31): what the
      // monster plays now, its definition and record, and what the draft holds for them.
      const draft = this.draft();
      const d = this.draftContent(draft);
      const known =
        rowValue(d, ref) !== undefined ||
        draft.some((r) => sameRow(r, ref)) ||
        contentRows(this.db).some((r) => sameRow(r, ref));
      if (!known) {
        return null;
      }
      const name =
        (ref.part === "monsters"
          ? d.monsters.monsters.find((m) => lingoEq(m.name, ref.key as string))?.name
          : (d.monsters.definitions ?? []).find((m) => lingoEq(m.name, ref.key as string))?.name) ??
        ref.key;
      return this.monsterFingerprintOf(name, draft);
    }
    return null;
  }

  // ---- the Monsters page (issue #31, stage 4) ----

  /** The monster's species record in `d`, by any case. */
  private draftMonster(d: ContentData, name: string): Monster | undefined {
    return d.monsters.monsters.find((m) => lingoEq(m.name, name));
  }

  /** The Monsters page's view: the list, the monster spells and with `name` that monster's form. */
  monstersView(name?: string): ContentMonstersView {
    const draft = this.draft();
    const d = this.draftContent(draft);
    const compiled = this.compiledDraft(draft);
    const packMonsters = new Set(this.packData.monsters.monsters.map((m) => m.name.toLowerCase()));
    const own = new Set((d.monsters.definitions ?? []).map((x) => x.name.toLowerCase()));
    const operator = new Set(
      contentRows(this.db)
        .filter(
          (r) => r.dataset === "monsters" && (r.part === "monsters" || r.part === "definitions"),
        )
        .map((r) => (r.key ?? "").toLowerCase()),
    );
    const monsterRows = draft.filter(
      (r) => r.dataset === "monsters" && (r.part === "monsters" || r.part === "definitions"),
    );
    const pending = new Set(monsterRows.map((r) => (r.key ?? "").toLowerCase()));
    const files = new Map(
      withNpcSaves(d, this.npcSaves()).npcFiles.files.map((f) => [
        f.name.toLowerCase(),
        npcSections(f.text),
      ]),
    );
    const lists = compiled.monsters.editorLists;
    // As the cast routine reads it: an SPL| line naming a monster spell's tag, and a never-caster
    // still casts the one kind it does not stop (aimNoExit).
    const castsAny = (spells: readonly string[], never: boolean) =>
      d.monsters.casting.spells.some(
        (sp) =>
          spells.some((l) => lingoContains(`SPL|${l}`, `SPL|${sp.tag}`)) &&
          (!never || sp.kind === "aimNoExit"),
      );
    const onList = (names: readonly string[], n: string) => names.some((x) => lingoEq(x, n));
    const monsters = d.monsters.monsters
      .map((m): MonsterListEntry => {
        const k = m.name.toLowerCase();
        const hits = new Map(resolveMonster(m.name, compiled).map((h) => [h.key, h]));
        const plays = (t: string) => (hits.get(t)?.deciding.length ?? 0) > 0;
        const file = files.get(k);
        return {
          name: m.name,
          display: m.display ?? m.name,
          state: !packMonsters.has(k) ? "yours" : own.has(k) || operator.has(k) ? "edited" : "pack",
          pending: pending.has(k),
          hostile: onList(lists.worldEditor.monsters, m.name) || plays("monsters rules.hostile"),
          sea: plays("monsters rules.sea"),
          casts: castsAny(file?.spells ?? [], plays("monsters casting.neverCasts")),
          loot: (file?.loot.length ?? 0) > 0,
          npc: onList(lists.worldEditor.npcs, m.name) || onList(lists.npcEditor.npcs, m.name),
        };
      })
      .sort((a, b) => a.display.localeCompare(b.display));
    const castRef: RowRef = { dataset: "monsters", part: "casting", key: null };
    const monster = name === undefined ? undefined : this.draftMonster(d, name);
    return {
      monsters,
      monster: monster ? this.monsterView(monster.name, draft) : null,
      spells: {
        rows: structuredClone(d.monsters.casting.spells),
        fingerprint: this.monsterSpellsFingerprint(draft),
        pending: draft.some((r) => sameRow(r, castRef)),
      },
      choices: monsterChoices(d, [
        ...new Set([
          ...d.spells.spells.map((x) => x.name),
          ...d.monsters.casting.spells.map((x) => x.name),
        ]),
      ]),
      otherDraft: draft.length - monsterRows.length,
      monsterDraft: monsterRows.length,
    };
  }

  /** The monster spells as the page last showed them. */
  private monsterSpellsFingerprint(draft: readonly DraftRow[]): string {
    const castRef: RowRef = { dataset: "monsters", part: "casting", key: null };
    return rowHash({
      casting: this.draftContent(draft).monsters.casting,
      pending: draft.find((r) => sameRow(r, castRef))?.op ?? null,
    });
  }

  /** One monster's form on the Monsters page. */
  private monsterView(name: string, draft: readonly DraftRow[]): ContentMonsterView {
    const d = this.draftContent(draft);
    const compiled = this.compiledDraft(draft);
    const record = this.draftMonster(d, name) as Monster;
    const defRef: RowRef = { dataset: "monsters", part: "definitions", key: record.name };
    const recRef: RowRef = { dataset: "monsters", part: "monsters", key: record.name };
    const own = rowValue(d, defRef) as MonsterDefinition | undefined;
    const hits = resolveMonster(record.name, compiled);
    const packRecord = this.packData.monsters.monsters.find((m) => lingoEq(m.name, record.name));
    const inPack = this.isPackMonster(record.name);
    const notice = this.notices().find((n) => sameRow(n, defRef));
    const edited = contentRows(this.db).some((r) => sameRow(r, defRef));
    return {
      name: record.name,
      display: record.display ?? "",
      inPack: packRecord !== undefined,
      record: structuredClone(record),
      form: structuredClone(own ?? seedMonsterDefinition(record.name, hits, compiled.monsters)),
      defined: own !== undefined,
      pack: inPack
        ? {
            record: packRecord ? structuredClone(packRecord) : null,
            form: structuredClone(this.packRowValue(defRef)) as MonsterDefinition,
          }
        : null,
      sources: monsterRuleSources(
        hits,
        own === undefined
          ? null
          : edited ||
              draft.some((r) => sameRow(r, defRef)) ||
              rowValue(this.packData, defRef) === undefined
            ? "yours"
            : "pack",
        (t) => {
          const [dataset, path] = t.split(" ") as [string, string];
          const part = path.split(".")[0] ?? "";
          const touches = (r: RowRef) => r.dataset === dataset && r.part === part;
          return contentRows(this.db).some(touches) || draft.some(touches);
        },
      ),
      edited,
      pending: {
        definition: draft.find((r) => sameRow(r, defRef))?.op ?? null,
        record: draft.find((r) => sameRow(r, recRef))?.op ?? null,
      },
      fingerprint: this.monsterFingerprintOf(record.name, draft),
      notice: notice
        ? {
            packName: notice.packName,
            packVersion: notice.packVersion,
            note:
              notice.note ??
              `${notice.packName} v${notice.packVersion} changed this monster's definition: answer it on the Content page.`,
          }
        : null,
      published: this.draftMonster(this.published, record.name) !== undefined,
    };
  }

  /**
   * Writes rows into the draft as one change, then runs the checks over the monster's rows: when
   * they refuse it, every row goes back to what the draft held. `name` names the monster in
   * refusals.
   */
  private draftMonsterRows(
    actor: ContentActor,
    name: string,
    label: string,
    rows: { ref: RowRef; op: DraftRow["op"] | "discard"; data: unknown }[],
  ): ContentResult<string> {
    const before = this.draft();
    const had = new Set(this.check().map((p) => `${p.where}\u0000${p.message}`));
    const restore = () => {
      for (const r of rows) {
        const was = before.find((d) => sameRow(d, r.ref));
        if (was) {
          upsertDraftRow(this.db, was);
        } else {
          deleteDraftRow(this.db, r.ref.dataset, r.ref.part, r.ref.key);
        }
      }
    };
    for (const r of rows) {
      const got =
        r.op === "discard" ? this.draftDiscard(r.ref) : this.draftSet(actor, r.ref, r.op, r.data);
      if (!got.ok) {
        restore();
        return got.problems
          ? fail(`${label} was not saved.`, monsterFieldProblems(name, got.problems))
          : got;
      }
    }
    // Every problem the change brings, wherever it is reported (a trap's flag refused at the
    // monster's unchanged definition, a name clash reported at the other monster).
    const id = (p: { where: string; message: string }) => `${p.where}\u0000${p.message}`;
    const problems = this.check().filter((p) => !had.has(id(p)));
    if (problems.length > 0) {
      restore();
      return fail(`${label} was not saved.`, monsterFieldProblems(name, problems));
    }
    return { ok: true, value: "" };
  }

  /**
   * One Monsters page change (issue #31, stage 4): `set` the monster's record and definition,
   * `revert` its definition, `discard` the draft's changes to it, `rename` it or `create` a new
   * one. Refused when the monster changed since the page showed it (`expect`).
   */
  draftMonsterChange(
    actor: ContentActor,
    change: {
      name: string;
      op: "set" | "revert" | "discard" | "rename" | "create";
      record?: unknown;
      data?: unknown;
      display?: string;
      copyFrom?: string;
      expect?: string;
    },
  ): ContentResult<string> {
    const draft = this.draft();
    const d = this.draftContent(draft);
    if (change.op === "create") {
      return this.createMonster(actor, change, draft);
    }
    const m = this.draftMonster(d, change.name);
    if (!m) {
      return fail(`there is no monster ${change.name}`);
    }
    const name = m.name;
    const label = m.display ?? name;
    if (this.monsterFingerprintOf(name, draft) !== change.expect) {
      return fail(`${label} changed since you opened it: look at it again before saving.`);
    }
    const defRef: RowRef = { dataset: "monsters", part: "definitions", key: name };
    const recRef: RowRef = { dataset: "monsters", part: "monsters", key: name };
    const defDraft = draft.find((r) => sameRow(r, defRef));
    const recDraft = draft.find((r) => sameRow(r, recRef));
    const edited = contentRows(this.db).some((r) => sameRow(r, defRef));
    switch (change.op) {
      case "discard": {
        if (!defDraft && !recDraft) {
          return fail(`${label} has no change in the draft.`);
        }
        // A monster only the draft has takes the NPC file its copy made with it.
        const fileRef = npcFileRef(name);
        const fileDraft =
          recDraft && this.draftMonster(this.published, name) === undefined
            ? draft.find((r) => sameRow(r, fileRef))
            : undefined;
        for (const ref of [
          defDraft ? defRef : null,
          recDraft ? recRef : null,
          fileDraft ? fileRef : null,
        ]) {
          if (ref) {
            const r = this.draftDiscard(ref);
            if (!r.ok) {
              return r;
            }
          }
        }
        return { ok: true, value: `${label}: the draft's changes are gone.` };
      }
      case "revert": {
        const rules = this.isPackMonster(name) ? "the pack's rules" : "no rules of its own";
        if (edited) {
          const op = rowValue(this.packData, defRef) === undefined ? "remove" : "revert";
          const r = this.draftSet(actor, defRef, op, null);
          return r.ok ? { ok: true, value: `${label} plays ${rules} again when published.` } : r;
        }
        if (defDraft) {
          const r = this.draftDiscard(defRef);
          return r.ok ? { ok: true, value: `${label} plays ${rules} again.` } : r;
        }
        return fail(`${label} already plays ${rules}.`);
      }
      case "rename": {
        const display = (change.display ?? "").trim();
        const row: Record<string, unknown> = { ...m };
        if (display === "" || display === name) {
          delete row.display;
        } else {
          row.display = display;
        }
        if (rowHash(row) === rowHash(m)) {
          return fail(`${label} already has that name.`);
        }
        const clash = d.monsters.monsters.find(
          (o) =>
            !lingoEq(o.name, name) &&
            display !== "" &&
            (lingoEq(o.name, display) || lingoEq(o.display ?? "", display)),
        );
        if (clash) {
          return fail(`${clash.name} is already called ${display}: pick another name.`);
        }
        const r = this.draftMonsterRows(actor, name, label, [
          { ref: recRef, op: "set", data: row },
        ]);
        if (!r.ok) {
          return r;
        }
        return {
          ok: true,
          value:
            display === "" || display === name
              ? `${name} goes back to its own name in the draft.`
              : `${name} is called ${display} in the draft.`,
        };
      }
      case "set": {
        const rows: { ref: RowRef; op: DraftRow["op"] | "discard"; data: unknown }[] = [];
        // The record: the form's stats and flags over the draft's row; its name, display name and
        // body stay as the draft has them (the body is the body panel's).
        if (change.record !== undefined) {
          const rec = change.record;
          if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
            return fail("a species record is a JSON object");
          }
          const next: Record<string, unknown> = { ...m };
          for (const k of RECORD_FIELDS) {
            const v = (rec as Record<string, unknown>)[k];
            if (v === undefined) {
              delete next[k];
            } else {
              next[k] = v;
            }
          }
          const flags = next.flags;
          if (
            flags !== undefined &&
            (flags === null || typeof flags !== "object" || Array.isArray(flags))
          ) {
            return fail(`${label} was not saved.`, [
              { where: "Flags", message: "the flags are a JSON object" },
            ]);
          }
          if (flags !== undefined && Object.keys(flags as object).length === 0) {
            delete next.flags;
          }
          if (rowHash(next) !== rowHash(m)) {
            // Back to the published row: the draft's change goes rather than staying as a no-op.
            const published = this.draftMonster(this.published, name);
            rows.push(
              recDraft && published && rowHash(published) === rowHash(next)
                ? { ref: recRef, op: "discard", data: null }
                : { ref: recRef, op: "set", data: next },
            );
          }
        }
        if (change.data !== undefined) {
          const data = change.data;
          if (data === null || typeof data !== "object" || Array.isArray(data)) {
            return fail("a definition is a JSON object");
          }
          if (
            String((data as { name?: unknown }).name ?? "").toLowerCase() !== name.toLowerCase()
          ) {
            return fail(`the definition's name must be ${name}`);
          }
          const def = { ...(data as Record<string, unknown>), name };
          const own = rowValue(d, defRef);
          const compiled = this.compiledDraft(draft);
          const playing =
            own ?? seedMonsterDefinition(name, resolveMonster(name, compiled), compiled.monsters);
          if (rowHash(playing) !== rowHash(def)) {
            const published = rowValue(this.published, defRef);
            const pub = compileDefinitions(this.published);
            const plays =
              published ?? seedMonsterDefinition(name, resolveMonster(name, pub), pub.monsters);
            rows.push(
              defDraft && rowHash(plays) === rowHash(def)
                ? { ref: defRef, op: "discard", data: null }
                : { ref: defRef, op: "set", data: def },
            );
          }
        }
        if (rows.length === 0) {
          return fail(`${label} already plays that: nothing to save.`);
        }
        const r = this.draftMonsterRows(actor, name, label, rows);
        return r.ok ? { ok: true, value: `${label} is in the draft.` } : r;
      }
    }
  }

  /** A new monster from the Monsters page, copying another's record, rules and NPC file. */
  private createMonster(
    actor: ContentActor,
    change: { name: string; display?: string; copyFrom?: string },
    draft: readonly DraftRow[],
  ): ContentResult<string> {
    const d = this.draftContent(draft);
    const name = change.name.trim();
    if (name.length > ITEM_NEW_NAME_MAX) {
      return fail(`A new monster's name is at most ${ITEM_NEW_NAME_MAX} characters.`);
    }
    if (this.draftMonster(d, name)) {
      return fail(`there is already a monster called ${name}`);
    }
    const form = badKeyForm(name);
    if (form) {
      return fail(`${name} was not made: ${form}.`);
    }
    const from = change.copyFrom === undefined ? undefined : this.draftMonster(d, change.copyFrom);
    if (change.copyFrom !== undefined && !from) {
      return fail(`there is no monster ${change.copyFrom} to copy`);
    }
    const display = (change.display ?? "").trim();
    const generic = d.monsters.generic;
    const { display: _d, ...base } = from ?? {
      name,
      body: generic.body,
      bodyInMainChars: true,
      hp: generic.hp,
      attack: 1,
      defense: generic.defense,
      xpMelee: 1,
      xpSpell: 1,
      spawnMinute: null,
    };
    const record = {
      ...base,
      name,
      ...(display !== "" && display !== name ? { display } : {}),
    };
    const compiled = this.compiledDraft(draft);
    const def: MonsterDefinition = from
      ? {
          ...structuredClone(
            (rowValue(d, { dataset: "monsters", part: "definitions", key: from.name }) as
              | MonsterDefinition
              | undefined) ??
              seedMonsterDefinition(
                from.name,
                resolveMonster(from.name, compiled),
                compiled.monsters,
              ),
          ),
          name,
        }
      : // A monster of its own is on the World Editor's monster list, so it can be placed and
        // walks toward players.
        { name, lists: { worldEditorMonsters: true } };
    const rows: { ref: RowRef; op: DraftRow["op"]; data: unknown }[] = [
      { ref: { dataset: "monsters", part: "monsters", key: name }, op: "set", data: record },
      { ref: { dataset: "monsters", part: "definitions", key: name }, op: "set", data: def },
    ];
    // Its copy of the NPC file (its drops, spells and flags), as the game reads it now.
    const file = from
      ? withNpcSaves(d, this.npcSaves()).npcFiles.files.find((f) => lingoEq(f.name, from.name))
      : undefined;
    if (file) {
      rows.push({ ref: npcFileRef(name), op: "set", data: { name, text: file.text } });
    }
    const r = this.draftMonsterRows(actor, name, name, rows);
    if (!r.ok) {
      return r;
    }
    return {
      ok: true,
      value: from
        ? `${name} is in the draft, a copy of ${from.display ?? from.name}${file ? " with its NPC file" : ""}: change what you like, then publish.`
        : `${name} is in the draft: give it stats and a body, then publish.`,
    };
  }

  /** The Monster spells card's save: every monster spell, in the draft as one row. */
  draftMonsterSpells(actor: ContentActor, spells: unknown, expect: string): ContentResult<string> {
    const draft = this.draft();
    if (this.monsterSpellsFingerprint(draft) !== expect) {
      return fail("The monster spells changed since you opened them: look at them again.");
    }
    const d = this.draftContent(draft);
    const casting = d.monsters.casting;
    if (rowHash(casting.spells) === rowHash(spells)) {
      return fail("The monster spells already hold that: nothing to save.");
    }
    if (!Array.isArray(spells)) {
      return fail("The monster spells are a list.");
    }
    // A spell new or changed in what it draws must draw a spell effect that exists: a directional
    // one its four (L, R, U, D), any other its own. One left as it was is not refused (Classic's
    // Wind Wave names effects no spell has, as 1.6's did).
    const fx = new Set(
      d.spells.spells.flatMap((x) => [
        x.name.toLowerCase(),
        ...x.fx.flatMap((f) => [f.member.toLowerCase(), f.effect.toLowerCase()]),
      ]),
    );
    for (const [i, raw] of (spells as unknown[]).entries()) {
      const tag = (raw as { tag?: unknown } | null)?.tag;
      if (
        typeof tag === "string" &&
        (tag.trim() === "" || tag !== tag.trim() || !npcFieldOk(tag))
      ) {
        return fail(
          `Monster spell ${i + 1}: a tag is one line with no spaces round it, and none of | : \` * ^ (an NPC file's SPL| line names it).`,
        );
      }
    }
    const before = new Map(casting.spells.map((x) => [x.tag.toLowerCase(), x]));
    for (const [i, raw] of (spells as unknown[]).entries()) {
      const sp = raw as Partial<MonsterSpellRule> | null;
      if (!sp || typeof sp.name !== "string" || typeof sp.kind !== "string") {
        continue;
      }
      const was = typeof sp.tag === "string" ? before.get(sp.tag.toLowerCase()) : undefined;
      if (was && was.name === sp.name && was.kind === sp.kind) {
        continue;
      }
      const dir = sp.kind === "dirAfterExits" || sp.kind === "dirBeforeExits";
      const need = dir ? ["L", "R", "U", "D"].map((x) => `${sp.name}${x}`) : [sp.name];
      const missing = need.filter((n) => !fx.has(String(n).toLowerCase()));
      if (missing.length > 0) {
        return fail(
          `${sp.tag || `Monster spell ${i + 1}`}: no spell effect is called ${listOf(missing)}${dir ? " (an aim in four directions draws the effect with L, R, U and D after its name)" : ""}.`,
        );
      }
    }
    // A spell an NPC file still casts (its SPL| lines, live saves included) cannot go.
    const tags = new Set(
      (spells as Partial<MonsterSpellRule>[]).map((x) => String(x?.tag ?? "").toLowerCase()),
    );
    const files = withNpcSaves(d, this.npcSaves()).npcFiles.files;
    for (const gone of casting.spells.filter((x) => !tags.has(x.tag.toLowerCase()))) {
      const users = files
        .filter((f) =>
          npcSections(f.text).spells.some((l) => lingoContains(`SPL|${l}`, `SPL|${gone.tag}`)),
        )
        .map((f) => f.name);
      if (users.length > 0) {
        return fail(
          `${gone.tag} is still cast by ${listOf(users.slice(0, 5))}${users.length > 5 ? ` and ${users.length - 5} more` : ""}: take it out of their spells first.`,
        );
      }
    }
    const ref: RowRef = { dataset: "monsters", part: "casting", key: null };
    const r = this.draftMonsterRows(actor, "Monster spells", "The monster spells", [
      { ref, op: "set", data: { ...casting, spells } },
    ]);
    return r.ok ? { ok: true, value: "The monster spells are in the draft." } : r;
  }

  /** The Items page's view: the list, and with `name` that item's form. */
  itemsView(name?: string): ContentItemsView {
    const draft = this.draft();
    const d = this.draftContent(draft);
    const kinds = this.itemKinds(draft);
    const packItems = new Set(this.packData.items.items.map((i) => i.name.toLowerCase()));
    const own = new Set((d.items.definitions ?? []).map((x) => x.name.toLowerCase()));
    const operator = new Set(
      contentRows(this.db)
        .filter((r) => r.dataset === "items" && (r.part === "items" || r.part === "definitions"))
        .map((r) => (r.key ?? "").toLowerCase()),
    );
    const itemRows = draft.filter(
      (r) => r.dataset === "items" && (r.part === "items" || r.part === "definitions"),
    );
    const pending = new Set(itemRows.map((r) => (r.key ?? "").toLowerCase()));
    const items = d.items.items
      .map((i): ItemListEntry => {
        const k = i.name.toLowerCase();
        return {
          name: i.name,
          display: i.display ?? i.name,
          kind: kinds.get(k) ?? "other",
          state: !packItems.has(k) ? "yours" : own.has(k) || operator.has(k) ? "edited" : "pack",
          retired: i.retired === true,
          pending: pending.has(k),
        };
      })
      .sort((a, b) => a.display.localeCompare(b.display));
    const item = name === undefined ? undefined : this.draftItem(d, name);
    return {
      items,
      item: item ? this.itemView(item.name, draft) : null,
      otherDraft: draft.length - itemRows.length,
      itemDraft: itemRows.length,
    };
  }

  /** One item's form on the Items page (issue #30). */
  private itemView(name: string, draft: readonly DraftRow[]): ContentItemView {
    const d = this.draftContent(draft);
    const compiled = this.compiledDraft(draft);
    const item = this.draftItem(d, name) as NonNullable<ReturnType<typeof this.draftItem>>;
    const defRef: RowRef = { dataset: "items", part: "definitions", key: item.name };
    const catRef: RowRef = { dataset: "items", part: "items", key: item.name };
    const own = rowValue(d, defRef) as ItemDefinition | undefined;
    const hits = resolveIn(item.name, compiled);
    const inPack = this.packData.items.items.some(
      (i) => i.name.toLowerCase() === item.name.toLowerCase(),
    );
    const notice = this.notices().find((n) => sameRow(n, defRef));
    return {
      name: item.name,
      display: item.display ?? "",
      retired: item.retired === true,
      inPack,
      form: structuredClone(own ?? seedDefinition(item.name, hits, compiled.items)),
      defined: own !== undefined,
      pack: inPack ? (structuredClone(this.packRowValue(defRef)) as ItemDefinition) : null,
      sources: ruleSources(
        hits,
        own === undefined
          ? null
          : contentRows(this.db).some((r) => sameRow(r, defRef)) ||
              draft.some((r) => sameRow(r, defRef)) ||
              rowValue(this.packData, defRef) === undefined
            ? "yours"
            : "pack",
        (t) => {
          const [dataset, path] = t.split(" ") as [string, string];
          const part = path.split(".")[0] ?? "";
          const touches = (r: RowRef) => r.dataset === dataset && r.part === part;
          return contentRows(this.db).some(touches) || draft.some(touches);
        },
      ),
      edited: contentRows(this.db).some((r) => sameRow(r, defRef)),
      pending: {
        definition: draft.find((r) => sameRow(r, defRef))?.op ?? null,
        catalogue: draft.find((r) => sameRow(r, catRef))?.op ?? null,
      },
      fingerprint: this.itemFingerprintOf(item.name, draft),
      notice: notice
        ? {
            packName: notice.packName,
            packVersion: notice.packVersion,
            note:
              notice.note ??
              `${notice.packName} v${notice.packVersion} changed this item's definition: answer it on the Content page.`,
          }
        : null,
      choices: itemChoices(d),
    };
  }

  /**
   * One Items page change (issue #30): `set` the item's definition, `revert` it (the item follows
   * the pack's rules again), `discard` the draft's changes to the item, `rename` it (its display
   * name) or `create` a new item, copying another's rules and picture. Refused when the item
   * changed since the page showed it (`expect`), and for a definition its checks refuse, named by
   * the form's labels.
   */
  draftItemChange(
    actor: ContentActor,
    change: {
      name: string;
      op: "set" | "revert" | "discard" | "rename" | "create";
      data?: unknown;
      display?: string;
      copyFrom?: string;
      expect?: string;
    },
  ): ContentResult<string> {
    const draft = this.draft();
    const d = this.draftContent(draft);
    if (change.op === "create") {
      return this.createItem(actor, change, draft);
    }
    const item = this.draftItem(d, change.name);
    if (!item) {
      return fail(`there is no item ${change.name}`);
    }
    const name = item.name;
    const label = item.display ?? name;
    if (this.itemFingerprintOf(name, draft) !== change.expect) {
      return fail(`${label} changed since you opened it: look at it again before saving.`);
    }
    const defRef: RowRef = { dataset: "items", part: "definitions", key: name };
    const catRef: RowRef = { dataset: "items", part: "items", key: name };
    const defDraft = draft.find((r) => sameRow(r, defRef));
    const catDraft = draft.find((r) => sameRow(r, catRef));
    const edited = contentRows(this.db).some((r) => sameRow(r, defRef));
    switch (change.op) {
      case "discard": {
        if (!defDraft && !catDraft) {
          return fail(`${label} has no change in the draft.`);
        }
        for (const ref of [defDraft ? defRef : null, catDraft ? catRef : null]) {
          if (ref) {
            const r = this.draftDiscard(ref);
            if (!r.ok) {
              return r;
            }
          }
        }
        return { ok: true, value: `${label}: the draft's changes are gone.` };
      }
      case "revert": {
        const rules = this.packData.items.items.some(
          (i) => i.name.toLowerCase() === name.toLowerCase(),
        )
          ? "the pack's rules"
          : "no rules of its own";
        if (edited) {
          const op = rowValue(this.packData, defRef) === undefined ? "remove" : "revert";
          const r = this.draftSet(actor, defRef, op, null);
          return r.ok ? { ok: true, value: `${label} plays ${rules} again when published.` } : r;
        }
        if (defDraft) {
          const r = this.draftDiscard(defRef);
          return r.ok ? { ok: true, value: `${label} plays ${rules} again.` } : r;
        }
        return fail(`${label} already plays ${rules}.`);
      }
      case "rename": {
        const display = (change.display ?? "").trim();
        const row: Record<string, unknown> = { ...item };
        if (display === "" || display === name) {
          delete row.display;
        } else {
          row.display = display;
        }
        if (rowHash(row) === rowHash(item)) {
          return fail(`${label} already has that name.`);
        }
        const clash = this.newKeyProblems(d, [{ ...catRef, op: "set", data: row }]);
        if (clash.length > 0) {
          return fail(`${label} was not renamed.`, itemProblems(name, clash));
        }
        const r = this.draftSet(actor, catRef, "set", row);
        if (!r.ok) {
          return r.problems ? fail(`${label} was not renamed.`, itemProblems(name, r.problems)) : r;
        }
        return {
          ok: true,
          value:
            display === "" || display === name
              ? `${name} goes back to its own name in the draft.`
              : `${name} is called ${display} in the draft.`,
        };
      }
      case "set": {
        const data = change.data;
        if (data === null || typeof data !== "object" || Array.isArray(data)) {
          return fail("a definition is a JSON object");
        }
        if (String((data as { name?: unknown }).name ?? "").toLowerCase() !== name.toLowerCase()) {
          return fail(`the definition's name must be ${name}`);
        }
        const def = { ...(data as Record<string, unknown>), name };
        const own = rowValue(d, defRef);
        const compiled = this.compiledDraft(draft);
        const playing = own ?? seedDefinition(name, resolveIn(name, compiled), compiled.items);
        if (rowHash(playing) === rowHash(def)) {
          return fail(
            own === undefined
              ? `${label} already plays that: nothing to save.`
              : `${label}'s definition in the draft already holds that.`,
          );
        }
        // Back to what plays now: the draft's change goes (one staged would publish a definition
        // that plays exactly as the item does).
        const published = rowValue(this.published, defRef);
        const pub = compileDefinitions(this.published);
        const plays = published ?? seedDefinition(name, resolveIn(name, pub), pub.items);
        if (defDraft && rowHash(plays) === rowHash(def)) {
          const r = this.draftDiscard(defRef);
          return r.ok ? { ok: true, value: `${label} is back to what plays now.` } : r;
        }
        const r = this.draftSet(actor, defRef, "set", def);
        if (!r.ok) {
          return r.problems ? fail(`${label} was not saved.`, itemProblems(name, r.problems)) : r;
        }
        // The definition's own checks (its skills, a fixture, a masterwork's behaviours): a
        // refused definition is not left in the draft.
        const prefix = `items/definitions/${name.toLowerCase()}`;
        const problems = this.check().filter((p) => {
          const w = p.where.toLowerCase();
          return w === prefix || w.startsWith(`${prefix}/`);
        });
        if (problems.length > 0) {
          if (defDraft) {
            upsertDraftRow(this.db, defDraft);
          } else {
            deleteDraftRow(this.db, "items", "definitions", name);
          }
          return fail(`${label} was not saved.`, itemProblems(name, problems, def));
        }
        return { ok: true, value: `${label} is in the draft.` };
      }
    }
  }

  /** A new item from the Items page, copying another's rules and picture when given. */
  private createItem(
    actor: ContentActor,
    change: { name: string; display?: string; copyFrom?: string },
    draft: readonly DraftRow[],
  ): ContentResult<string> {
    const d = this.draftContent(draft);
    const name = change.name.trim();
    if (name.length > ITEM_NEW_NAME_MAX) {
      return fail(`A new item's name is at most ${ITEM_NEW_NAME_MAX} characters.`);
    }
    if (this.draftItem(d, name)) {
      return fail(`there is already an item called ${name}`);
    }
    if (
      isEngineFixture(name) ||
      name.includes("#") ||
      /\+\s*\d+$/.test(name) ||
      !definesBehaviours(name)
    ) {
      return fail(
        `${name} is a name the game gives its own things (a door, a sign, a +N masterwork, a #id): pick another`,
      );
    }
    const from = change.copyFrom === undefined ? undefined : this.draftItem(d, change.copyFrom);
    if (change.copyFrom !== undefined && !from) {
      return fail(`there is no item ${change.copyFrom} to copy`);
    }
    const display = (change.display ?? "").trim();
    const row = {
      name,
      ...(display !== "" && display !== name ? { display } : {}),
      ...(from ? { sprite: pictureOf(from) } : {}),
    };
    const catRef: RowRef = { dataset: "items", part: "items", key: name };
    // The same key checks as a catalogue row saved on the Content page: a key's form ("5 Swords"),
    // and no key or display name that another item's key or display name already is.
    const form = badKeyForm(name);
    if (form) {
      return fail(`${name} was not made: ${form}.`);
    }
    const clash = this.newKeyProblems(d, [{ ...catRef, op: "set", data: row }]);
    if (clash.length > 0) {
      return fail(`${name} was not made.`, itemProblems(name, clash));
    }
    const made = this.draftSet(actor, catRef, "set", row);
    if (!made.ok) {
      return made.problems
        ? fail(`${name} was not made.`, itemProblems(name, made.problems))
        : made;
    }
    if (!from) {
      return {
        ok: true,
        value: `${name} is in the draft, with no rules yet: give it some and save.`,
      };
    }
    const compiled = this.compiledDraft(this.draft());
    const own = rowValue(d, { dataset: "items", part: "definitions", key: from.name }) as
      | ItemDefinition
      | undefined;
    const copy = structuredClone(
      own ?? seedDefinition(from.name, resolveIn(from.name, compiled), compiled.items),
    );
    // The copy is drawn when worn as the item it was copied from, unless it already says how.
    const layer = copy.slot === undefined ? undefined : PAPERDOLL_LAYER_OF_SLOT[copy.slot];
    if (layer && !(copy.paperdoll ?? []).some((a) => a.layer === layer)) {
      copy.paperdoll = [...(copy.paperdoll ?? []), { layer, becomes: from.name }];
    }
    // A skill tier that named the item it was copied from names the copy.
    for (const b of copy.attack?.blocks ?? []) {
      for (const t of b.tiers) {
        if (t.subWeapon && t.subWeapon.pattern.toLowerCase() === from.name.toLowerCase()) {
          t.subWeapon = { ...t.subWeapon, pattern: name };
        }
      }
    }
    const notes: string[] = [];
    // A spell book teaches the spell whose book it is: a copy teaches none until a spell's book is
    // set to it, so it is no spell book until then.
    if (
      copy.use?.mysticism !== undefined &&
      !compiled.spells.spells.some((sp) => sp.book && ruleMatches(name, sp.book))
    ) {
      delete copy.use.mysticism;
      if (Object.keys(copy.use).length === 0) {
        delete copy.use;
      }
      notes.push(
        `It teaches no spell: set a spell's book to ${name} (dataset spells) to make it a spell book.`,
      );
    }
    // A gathering node that names its tools works only with those: a copied tool is not one yet.
    for (const node of compiled.gather.harvest) {
      if (
        (copy.tools ?? []).some((t) => t.can === node.can) &&
        node.tools?.some((t) => lingoEq(t, from.name)) &&
        !node.tools.some((t) => lingoEq(t, name))
      ) {
        notes.push(
          `Only ${node.tools.join(", ")} can ${node.can.toLowerCase()} the ${node.tile} tile: add ${name} to that node's tools (dataset gather, harvest) for it to work there.`,
        );
      }
    }
    const defRef: RowRef = { dataset: "items", part: "definitions", key: name };
    const r = this.draftSet(actor, defRef, "set", { ...copy, name });
    if (!r.ok) {
      this.draftDiscard(catRef);
      return r.problems ? fail(`${name} was not made.`, itemProblems(name, r.problems)) : r;
    }
    return {
      ok: true,
      value: [
        `${name} is in the draft, playing as ${from.display ?? from.name} does: change what you like and publish it from the Content page.`,
        ...notes,
      ].join(" "),
    };
  }

  /** The sound panels' view, from the draft. */
  soundArtView(): ContentSoundArtView {
    const d = this.draftContent();
    return {
      // A defined item's swing sound is its definition's (issue #30).
      uses: Object.fromEntries(soundUses(this.compiledDraft(this.draft()))),
      art: d.art.sounds,
      packSounds: { ...this.packSounds },
      liveUploads: this.published.art.sounds.map((a) => a.name.toLowerCase()),
      maxBytes: UPLOAD_MAX_BYTES,
    };
  }

  /**
   * One sound change from the Content page, put in the draft as a whole: a sound's file, or its
   * upload taken out. A file is checked before anything is written: it is stored, it is the
   * format it says by its opening bytes, and it is within the upload limit.
   */
  draftSound(
    actor: ContentActor,
    change: SoundChange,
  ): ContentResult<{ text: string; sound: string }> {
    if (change.op === "set") {
      if (!this.art) {
        return fail("this server stores no uploads");
      }
      // The upload store, or a pack that carries the file (it is copied to the store on save).
      const read = this.art.read("sounds", change.file, change.format);
      const bytes = read instanceof Uint8Array ? read : null;
      if (!bytes) {
        return fail(
          `the sound file is not stored as ${change.format.toUpperCase()}: upload it again`,
        );
      }
      if (bytes.length > UPLOAD_MAX_BYTES) {
        return fail(`the sound file is over ${UPLOAD_MAX_BYTES / 1048576} MB`);
      }
      if (soundFormatOf(bytes) !== change.format) {
        return fail(`the file is not a ${change.format.toUpperCase()} sound`);
      }
    }
    const plan = planSound(change, this.draftContent().art.sounds);
    if (!plan.ok) {
      return fail(plan.error);
    }
    const wrote = this.writeDraftRows(actor, plan.rows, ["art"]);
    if (!wrote.ok) {
      return fail("the change does not match the rows' schema", wrote.problems);
    }
    return {
      ok: true,
      value: {
        text:
          change.op === "remove"
            ? `${plan.name}'s upload is out of the draft.`
            : `${plan.name} is in the draft.`,
        sound: plan.name,
      },
    };
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
   * While it is installed, the contract's points are judged by its tiles.
   */
  private installProblems(next: ContentData): ContentProblem[] {
    const before = hasContent() ? content() : null;
    try {
      installContent(buildContentStore(next));
      return this.points();
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

  /**
   * Every check a write must pass: the publish checks and the content contract, then a trial
   * install (which judges the contract's points with the next content's tiles).
   */
  /**
   * The datasets an item definitions compile reads, by their JSON: data built afresh from the same
   * rows (the checked draft, then the rebuilt store after a publish) shares the objects, so the
   * compile (shared definitions.ts, cached by those objects) runs once, not once per build.
   */
  private readonly compileInputs = new Map<string, unknown>();
  private shareCompileInputs(data: ContentData): void {
    const d = data as unknown as Record<string, unknown>;
    const items = (data.items.definitions?.length ?? 0) > 0;
    const monsters = (data.monsters.definitions?.length ?? 0) > 0;
    const ids = [
      ...(items ? (["items", "itemRules", "attPower", "classes", "craft"] as const) : []),
      ...(monsters ? (["monsters"] as const) : []),
    ];
    for (const id of ids) {
      const key = `${id}\u0000${rowHash(d[id])}`;
      const known = this.compileInputs.get(key);
      if (known !== undefined) {
        d[id] = known;
      } else {
        if (this.compileInputs.size >= 40) {
          this.compileInputs.clear();
        }
        this.compileInputs.set(key, d[id]);
      }
    }
  }

  private fullProblems(next: ContentData, actions: readonly WorldAction[] = []): ContentProblem[] {
    this.shareCompileInputs(next);
    const problems = [
      ...checkStore(
        next,
        this.published,
        this.packKeys,
        this.npcSavesAfter(actions).flatMap((f) =>
          f.text === null ? [] : [{ npc: f.npc, text: f.text }],
        ),
      ),
      ...(schemaProblems(next).length > 0 ? [] : this.artProblems(next)),
    ];
    // Content that does not match its schemas is named by them alone. Otherwise the contract is
    // named first, beside any broken references: a world with no currency also breaks every
    // `300 Gold` that named the old one.
    const contract = schemaProblems(next).length > 0 ? [] : contractProblems(next);
    if (problems.length > 0 || contract.length > 0) {
      return [...contract, ...problems];
    }
    return this.installProblems(next);
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
        next = this.withArt(applyRows(this.packData, contentRows(this.db).map(toLayer)));
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
    // The uploaded art is server-only, so the store's hash may not change with it: check afresh.
    this.checked = null;
    this.historyCodes = null;
    const rows = contentRows(this.db).map(toLayer);
    const held = this.held.filter((h) => !rows.some((r) => sameRow(r, h)));
    this.published = this.withArt(applyRows(this.packData, [...rows, ...held]));
    this.shareCompileInputs(this.published);
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
    // So do the live NPC file saves the publish's cleanup would change or delete (issue #31): one
    // saved since (the Monsters page, the NPC Editor) changes the revision, so a publish never acts
    // on a file newer than the one its author reviewed.
    // And the live saves of the NPC files the draft changes as rows.
    const rows = new Set(
      draft
        .filter((d) => d.dataset === "npcFiles" && d.part === "files" && d.key !== null)
        .map((d) => (d.key as string).toLowerCase()),
    );
    for (const f of this.npcSaves()) {
      if (rows.has(f.npc.toLowerCase())) {
        h.update(`npcrow\u0000${f.npc.toLowerCase()}\u0000${rowHash(f.text)}\n`);
      }
    }
    for (const f of this.npcSavesAfter(this.liveActions(draft))) {
      if (f.text !== f.was) {
        h.update(`npc\u0000${f.npc.toLowerCase()}\u0000${rowHash(f.was)}\n`);
      }
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
    const draft = this.settleTileOrphans(
      this.settleFxOrphans(world ? this.settleRetirements(asDrafted, actions, world) : asDrafted),
    );
    const nextData = this.draftContent(draft);
    const problems = [
      ...this.fullProblems(nextData, actions),
      ...this.actionProblems(nextData, draft),
      ...this.tileMapProblems(nextData, world),
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
    if (draft.length === 0) {
      return fail("the draft changes nothing once settled: discard it");
    }
    const now = this.now();
    const layer = contentRows(this.db);
    const changes: PublishChange[] = draft
      .map((d): PublishChange => {
        const before = this.stateOf(layer.find((r) => sameRow(r, d)));
        // What a pack update is noticed against: the pack's row, or for an item definition no pack
        // has, what the packs' rules play for the item (issue #30).
        const base = this.packRowValue(d);
        // Reverting drops the operator row; so does removing a row no pack has (an added one), which
        // leaves nothing behind to mark.
        const after: PublishedState | null =
          d.op === "revert" || (d.op === "remove" && rowValue(this.packData, d) === undefined)
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
    const removed: DraftRow[] = [];
    const settled = draft.map((d): DraftRow => {
      const a = actions.find(
        (x) => x.kind === "item" && x.copies === "retire" && sameRow(entryRef("item", x.key), d),
      );
      if (a?.kind !== "item" || d.op !== "set") {
        return d;
      }
      const held = world.usage("item", a.spellings).some((p) => p.count > 0 && p.place !== "quest");
      const wasRetired =
        (rowValue(this.published, d) as { retired?: unknown } | undefined)?.retired === true;
      if (held || wasRetired) {
        return d;
      }
      const row: DraftRow = { ...d, op: "remove", data: null };
      removed.push(row);
      return row;
    });
    if (removed.length === 0) {
      return settled;
    }
    // A retirement that became a removal takes the item's own upload with it, as a removal does,
    // unless something else still draws that picture (issue #29).
    let out = settled;
    const next = this.draftContent(out);
    const used = usedArt(next).sprites;
    for (const d of removed) {
      const key = String(d.key).toLowerCase();
      // Its definition goes with it (issue #30): a draft change to it is dropped, and a published
      // one removed.
      const defRef: RowRef = { dataset: "items", part: "definitions", key: String(d.key) };
      out = out.filter((x) => !sameRow(x, defRef));
      if (rowValue(this.published, defRef) !== undefined) {
        out.push({ ...d, ...defRef, op: "remove", data: null });
      }
      // Its own picture and its own worn layer (issue #29), both named by its key.
      for (const part of ["items", "paperdoll"] as const) {
        const art = next.art[part].find((r) => r.name.toLowerCase() === key);
        if (!art || used[part].has(art.name.toLowerCase())) {
          continue;
        }
        const ref: RowRef = { dataset: "art", part, key: art.name };
        out = out.filter((x) => !sameRow(x, ref));
        if (rowValue(this.published, ref) !== undefined) {
          out.push({ ...d, ...ref, op: "remove", data: null });
        }
      }
    }
    return out;
  }

  /**
   * A spell the draft removes takes the uploads of the runs only it drew with it (issue #29, stage
   * 5). Worked out when the draft is published, not when the removal is drafted, so discarding the
   * removal leaves every upload as it was.
   */
  private settleFxOrphans(draft: readonly DraftRow[]): DraftRow[] {
    const removed = draft.filter(
      (d) => d.op === "remove" && d.dataset === "spells" && d.part === "spells" && d.key !== null,
    );
    if (removed.length === 0) {
      return [...draft];
    }
    const before = this.draftContent(draft.filter((d) => !removed.includes(d)));
    const next = this.draftContent(draft);
    const runs = fxRuns(next);
    let out = [...draft];
    for (const d of removed) {
      const spell = (before.spells.spells as unknown as FxSpellRow[]).find(
        (x) => x.name.toLowerCase() === String(d.key).toLowerCase(),
      );
      if (!spell) {
        continue;
      }
      for (const run of orphanedFxUploads(spell, next.art.fx, runs)) {
        const ref: RowRef = { dataset: "art", part: "fx", key: run };
        out = out.filter((x) => !sameRow(x, ref));
        if (rowValue(this.published, ref) !== undefined) {
          out.push({ ...d, ...ref, op: "remove", data: null });
        }
      }
    }
    return out;
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
   * Publishes rows straight into the operator layer, outside the shared draft: values moved here
   * from elsewhere (the death-drop and loot settings, issue #19 stage 4), logged as a publish of
   * its own under `summary`, listed and undone like any other.
   *
   * It all runs under the database's write lock: `plan` reads what to move (and from the operator
   * layer as committed) inside it, and its `alongside` (removing what the values moved from) runs
   * in the same transaction, so two servers starting together move the values once; the one that
   * finds nothing left still picks up the other's publish. The move is judged only on problems it
   * adds, so a gap the published content already had elsewhere does not hold it back.
   *
   * An open draft of a moved row is rebased onto the moved values: a field the draft left as it
   * was takes the moved value, and a field both changed keeps the draft's and is named in
   * `conflicts`. A draft row left equal to the moved row is dropped.
   */
  publishMoved(
    actor: ContentActor,
    summary: string,
    plan: (
      current: ContentData,
      operatorRows: readonly RowRef[],
    ) => { rows: readonly { ref: RowRef; data: unknown }[]; alongside: () => void } | null,
  ): ContentResult<{ id: string | null; conflicts: string[] }> {
    let out: ContentResult<{ id: string | null; conflicts: string[] }> = {
      ok: true,
      value: { id: null, conflicts: [] },
    };
    this.db
      .transaction(() => {
        const layer = contentRows(this.db);
        const current = this.withArt(applyRows(this.packData, layer.map(toLayer)));
        const p = plan(current, layer);
        if (!p) {
          return;
        }
        if (p.rows.length === 0) {
          p.alongside();
          return;
        }
        const changes: PublishChange[] = p.rows.map(({ ref, data }) => {
          const base = rowValue(this.packData, ref);
          return {
            dataset: ref.dataset,
            part: ref.part,
            key: ref.key,
            before: this.stateOf(layer.find((r) => sameRow(r, ref))),
            after: {
              op: "set",
              data,
              baseHash: base === undefined ? null : rowHash(base),
              baseData: base === undefined ? null : base,
            },
          };
        });
        const now = this.now();
        const next = this.candidate(() => {
          for (const c of changes) {
            this.writeState(c, c.after, actor, now);
          }
        });
        const key = (pr: ContentProblem) => JSON.stringify(pr);
        const had = new Set(this.fullProblems(current).map(key));
        const problems = this.fullProblems(next).filter((pr) => !had.has(key(pr)));
        if (problems.length > 0) {
          out = fail("the moved values do not pass their checks", problems);
          return;
        }
        for (const c of changes) {
          this.writeState(c, c.after, actor, now);
        }
        p.alongside();
        const conflicts = this.rebaseDraft(p.rows, current);
        const id = insertPublish(
          this.db,
          {
            actorAccountId: actor.accountId,
            actorName: actor.name,
            summary,
            changes,
            hash: clientCopyOf(next).hash,
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
        out = { ok: true, value: { id, conflicts } };
      })
      .immediate();
    // Always: another server may have published the move meanwhile.
    this.rebuild();
    return out;
  }

  /**
   * Rebases each open draft of a moved row onto its moved value (see `publishMoved`). Returns
   * the fields both changed, as `row: field`.
   */
  private rebaseDraft(
    rows: readonly { ref: RowRef; data: unknown }[],
    current: ContentData,
  ): string[] {
    const conflicts: string[] = [];
    const same = (a: unknown, b: unknown) => rowHash(a ?? null) === rowHash(b ?? null);
    for (const { ref, data } of rows) {
      const d = draftRows(this.db).find((r) => sameRow(r, ref));
      const was = rowValue(current, ref);
      if (
        !d ||
        d.op !== "set" ||
        [d.data, was, data].some((v) => v === null || typeof v !== "object" || Array.isArray(v))
      ) {
        continue;
      }
      const draft = d.data as Record<string, unknown>;
      const before = was as Record<string, unknown>;
      const moved = data as Record<string, unknown>;
      const rebased: Record<string, unknown> = { ...draft };
      for (const f of new Set([...Object.keys(before), ...Object.keys(moved)])) {
        if (same(moved[f], before[f])) {
          continue;
        }
        if (same(draft[f], before[f])) {
          if (moved[f] === undefined) {
            delete rebased[f];
          } else {
            rebased[f] = moved[f];
          }
        } else if (!same(draft[f], moved[f])) {
          conflicts.push(`${rowLabel(ref)}: ${f}`);
        }
      }
      if (same(rebased, moved)) {
        deleteDraftRow(this.db, ref.dataset, ref.part, ref.key);
      } else if (!same(rebased, draft)) {
        upsertDraftRow(this.db, { ...d, data: rebased });
      }
    }
    return conflicts;
  }

  /**
   * Plays `rows` over the operator layer in memory only, where the layer has no row of its own:
   * values that could not be moved here yet (see `moveDropSettings`), kept in play until a later
   * start moves them.
   */
  holdMoved(rows: readonly { ref: RowRef; data: unknown }[]): void {
    this.held = rows.map(({ ref, data }) => ({ ...ref, op: "set" as const, data }));
    this.rebuild();
  }

  /**
   * Undoes a publish as a whole, as a publish of its own. Refused, naming the rows, when any row
   * it touched has changed since (as #26's undo is), or when it was already undone.
   */
  undo(actor: ContentActor, publishId: string, world?: ContentWorld): ContentResult<StoredPublish> {
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
    // Every publish check, not just the schemas: a later publish may refer to what this one added,
    // and a map may by now use a tile it added.
    const problems = [...this.fullProblems(rows), ...this.tileMapProblems(rows, world)];
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
      // An item that goes takes its definition with it (issue #30); a retired one keeps it, so the
      // copies players hold keep their rules.
      if (own[0]?.op === "remove") {
        const defRef: RowRef = { dataset: "items", part: "definitions", key };
        if (rowValue(base, defRef) !== undefined) {
          own.push({ ref: defRef, op: "remove", data: null });
        }
      }
      // An item that goes takes its own upload with it, unless something else still draws that
      // picture (an item that borrows it as its `sprite`, an engine pile): issue #29.
      if (own[0]?.op === "remove") {
        // Its own upload, named by its key: a picture it borrowed through `sprite` is another's.
        // Its own worn layer goes the same way (issue #29, stage 3), unless another item (or an
        // alias) still draws it.
        const after = applyRows(
          base,
          [...cleaned.rows, ...own].map((r) => ({ ...r.ref, op: r.op, data: r.data })),
        );
        const used = usedArt(after).sprites;
        for (const part of ["items", "paperdoll"] as const) {
          const art = base.art[part].find((a) => a.name.toLowerCase() === key.toLowerCase());
          if (art && !used[part].has(art.name.toLowerCase())) {
            own.push({ ref: { dataset: "art", part, key: art.name }, op: "remove", data: null });
          }
        }
      }
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
      // A monster that goes takes its definition with it (issue #31).
      const defRef: RowRef = { dataset: "monsters", part: "definitions", key };
      if (rowValue(base, defRef) !== undefined) {
        own.push({ ref: defRef, op: "remove", data: null });
      }
      if (ownFile.length > 0 && rowValue(base, npcFileRef(key)) !== undefined) {
        own.push({ ref: npcFileRef(key), op: "remove", data: null });
      }
      // A monster that goes takes its uploaded body with it, unless something else still draws
      // that body (another monster, a Morph row, a rider, or a spawn's replacement): issue #29.
      const body = base.monsters.monsters.find(
        (m) => m.name.toLowerCase() === key.toLowerCase(),
      )?.body;
      const art = base.art.bodies.find((a) => a.name === String(body));
      if (art) {
        const after = applyRows(
          base,
          [...cleaned.rows, ...own].map((r) => ({ ...r.ref, op: r.op, data: r.data })),
        );
        if (!usedArt(after).sprites.bodies.has(art.name)) {
          own.push({
            ref: { dataset: "art", part: "bodies", key: art.name },
            op: "remove",
            data: null,
          });
        }
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
      content: [
        ...brokenReferences(withNpcSaves(this.published, this.npcSaves())).map((r) => ({
          where: r.where,
          message: referenceMessage(r),
        })),
        // A pack's art row that can't be drawn: it draws nothing (issue #29, stage 8).
        ...this.packRowProblems,
      ],
      world: world ? world.problems() : [],
    };
  }

  /** The newest publishes, newest first. */
  history(limit = 50): StoredPublish[] {
    return recentPublishes(this.db, limit);
  }

  /** The key problems `rows` would add to `base` (a clash with another item's key or name). */
  private newKeyProblems(base: ContentData, rows: LayerRow[]): ContentProblem[] {
    const id = (p: ContentProblem) => `${p.where}\u0000${p.message}`;
    const had = new Set(keyProblems(base, this.packKeys).map(id));
    return keyProblems(applyRows(base, rows), this.packKeys).filter((p) => !had.has(id(p)));
  }

  /** Whether an installed pack's catalogue has the item. */
  /** Whether a pack has this monster: a species, an editor list entry or an NPC file. */
  private isPackMonster(name: string): boolean {
    const k = name.toLowerCase();
    const m = this.packData.monsters;
    return (
      m.monsters.some((x) => x.name.toLowerCase() === k) ||
      Object.values(m.editorLists).some((e) =>
        [...e.monsters, ...e.npcs].some((x) => x.toLowerCase() === k),
      ) ||
      this.packData.npcFiles.files.some((f) => f.name.toLowerCase() === k)
    );
  }

  /** The pack the monster tables come from (issue #31), as `definitionTablesOwner` for items. */
  private monsterTablesOwner(): { name: string; version: string } {
    const owners = new Map<string, { name: string; version: string }>();
    for (const part of ["rules", "casting", "meleeAffinities", "skillCaps", "editorLists"]) {
      const o = this.owners.get(rowLabel({ dataset: "monsters", part, key: null }).toLowerCase());
      if (o) {
        owners.set(`${o.name}\u0000${o.version}`, o);
      }
    }
    const list = [...owners.values()];
    if (list.length === 1) {
      return list[0] as { name: string; version: string };
    }
    if (list.length === 0 && this.packs.length === 1) {
      return this.packs[0] as { name: string; version: string };
    }
    return { name: "the installed packs", version: "" };
  }

  private isPackItem(name: string): boolean {
    const k = name.toLowerCase();
    return this.packData.items.items.some((i) => i.name.toLowerCase() === k);
  }

  /**
   * The pack the rule tables an item definition covers come from (issue #30): the one pack that
   * supplies them all, or "the installed packs" (no version) when several do.
   */
  private definitionTablesOwner(): { name: string; version: string } {
    const owners = new Map<string, { name: string; version: string }>();
    for (const key of DEFINITION_TABLES) {
      const [dataset, path] = key.split(" ") as [string, string];
      const part = path.split(".")[0] ?? "";
      for (const label of [rowLabel({ dataset: dataset as DatasetId, part, key: null })]) {
        const o = this.owners.get(label.toLowerCase());
        if (o) {
          owners.set(`${o.name}\u0000${o.version}`, o);
        }
      }
    }
    const list = [...owners.values()];
    if (list.length === 1) {
      return list[0] as { name: string; version: string };
    }
    if (list.length === 0 && this.packs.length === 1) {
      return this.packs[0] as { name: string; version: string };
    }
    return { name: "the installed packs", version: "" };
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
      const now = this.packRowValue(r);
      const nowHash = now === undefined ? null : rowHash(now);
      if (nowHash === r.baseHash) {
        continue;
      }
      const monster = isMonsterDefinitionRow(r);
      const defined = (isDefinitionRow(r) || monster) && rowValue(this.packData, r) === undefined;
      if (
        defined &&
        r.baseHash === null &&
        (r.key === null || !(monster ? this.isPackMonster(r.key) : this.isPackItem(r.key)))
      ) {
        // The operator's own item or monster: its definition followed no pack when it was made, and
        // follows none now. One that had a pack base (a pack item or monster the pack has since
        // dropped) still gets its notice.
        continue;
      }
      // A definition no pack supplies is compared against the rules the item (or monster) plays
      // from the packs' tables: name the pack those tables come from, or the installed packs when
      // several do.
      const from = defined
        ? monster
          ? this.monsterTablesOwner()
          : this.definitionTablesOwner()
        : owner;
      const thing = monster ? "monster" : "item";
      const who = from.version === "" ? from.name : `${from.name} v${from.version}`;
      out.push({
        dataset: r.dataset,
        part: r.part,
        key: r.key,
        packName: from.name,
        packVersion: from.version,
        was: r.baseData,
        now: now ?? null,
        yours: r.op === "set" ? r.data : null,
        yoursOp: r.op,
        ...(defined
          ? {
              note:
                r.op === "set"
                  ? `${who} changed its rules for ${r.key}. Your definition still plays: a defined ${thing} no longer follows the packs' rule changes. "Was" and "now" are what the packs' rules play for it; taking the packs' version drops your definition, so the ${thing} plays their rules again.`
                  : `${who} changed its rules for ${r.key}. You removed your definition, so the ${thing} already plays the packs' rules, "now" included; taking the packs' version or keeping yours both leave it so.`,
            }
          : {}),
      });
    }
    return out;
  }

  /**
   * The pack's value of a row, which a pack notice compares against. For an item definition no pack
   * has (issue #30): what the packs' rule tables play for the item, as a definition, so a pack
   * update that changes those rules is noticed under the definition that overrides them.
   */
  /**
   * Fills in the definitions migration 69 listed (saved before a definition held an item's whole
   * rule set, issue #30): each group they never had (tools, needs, menu, breaking, worn pictures,
   * ground, container, the list toggles) takes what the item played then, the uncompiled tables
   * of the layer it was saved in, so it plays on unchanged. A published row's pack base is worked
   * out again, so it raises no pack notice for groups it never chose. Once: the list is emptied.
   */
  backfillDefinitions(): string[] {
    const listed = this.db
      .query<{ source: string; row_key: string }, []>(
        "SELECT source, row_key FROM content_definition_backfill",
      )
      .all();
    if (listed.length === 0) {
      return [];
    }
    const lines: string[] = [];
    const published = this.published;
    const drafted = this.draftContent();
    this.db.transaction(() => {
      const layer = contentRows(this.db);
      const draft = draftRows(this.db);
      for (const l of listed) {
        if (l.source === "layer") {
          const r = layer.find(
            (x) => x.dataset === "items" && x.part === "definitions" && x.key === l.row_key,
          );
          if (r?.op === "set" && r.data) {
            const data = backfilled(r.data as ItemDefinition, published);
            const base = this.packRowValue(r);
            upsertContentRow(this.db, {
              ...r,
              data,
              baseHash: base === undefined ? null : rowHash(base),
              baseData: base === undefined ? null : base,
            });
            lines.push(`content: ${l.row_key}'s definition takes the rules it played (#30)`);
          }
        } else {
          const d = draft.find(
            (x) => x.dataset === "items" && x.part === "definitions" && x.key === l.row_key,
          );
          if (d?.op === "set" && d.data) {
            upsertDraftRow(this.db, { ...d, data: backfilled(d.data as ItemDefinition, drafted) });
          }
        }
      }
      this.db.query("DELETE FROM content_definition_backfill").run();
    })();
    this.rebuild();
    return lines;
  }

  private packRowValue(ref: RowRef): unknown {
    const v = rowValue(this.packData, ref);
    if (v === undefined && isMonsterDefinitionRow(ref) && ref.key !== null) {
      // A monster definition no pack has (issue #31): what the packs' monster tables play for it,
      // as a definition; none for the operator's own monster.
      if (!this.isPackMonster(ref.key)) {
        return undefined;
      }
      if (this.packCompiled?.from !== this.packData) {
        this.packCompiled = { from: this.packData, data: compileDefinitions(this.packData) };
      }
      const d = this.packCompiled.data;
      return seedMonsterDefinition(ref.key, resolveMonster(ref.key, d), d.monsters);
    }
    if (v !== undefined || !isDefinitionRow(ref) || ref.key === null) {
      return v;
    }
    // An item no pack has (the operator's own) has no pack rules to follow: no pack value, so no
    // notice, and taking "the pack's version" can never drop its definition.
    if (!this.isPackItem(ref.key)) {
      return undefined;
    }
    if (this.packCompiled?.from !== this.packData) {
      this.packCompiled = { from: this.packData, data: compileDefinitions(this.packData) };
    }
    return seedDefinition(
      ref.key,
      resolveIn(ref.key, this.packCompiled.data),
      this.packCompiled.data.items,
    );
  }

  /** Takes the pack's new version of a row: the operator's change goes (as a publish, so it can be undone). */
  acceptNotice(
    actor: ContentActor,
    ref: RowRef,
    world?: ContentWorld,
  ): ContentResult<StoredPublish> {
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
    // A pack's catalogue may lack a tile the operator added and a map now uses.
    const problems = [...this.fullProblems(next), ...this.tileMapProblems(next, world)];
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

/** The groups a definition saved before #30 stage 4 never had. */
const STAGE4_KEYS = [
  "tools",
  "requires",
  "menu",
  "damaged",
  "breaks",
  "paperdoll",
  "ground",
  "container",
  "inEditorList",
  "inPlayerShops",
] as const;

/**
 * An old definition with the groups it never had filled in from what the item plays in `data`'s
 * own (uncompiled) tables: what it played before those groups were a definition's.
 */
function backfilled(def: ItemDefinition, data: ContentData): ItemDefinition {
  const seed = seedDefinition(def.name, resolveIn(def.name, data), data.items);
  const out: ItemDefinition = { ...def };
  const o = out as Record<string, unknown>;
  const sd = seed as Record<string, unknown>;
  for (const k of STAGE4_KEYS) {
    if (o[k] === undefined && sd[k] !== undefined) {
      o[k] = sd[k];
    }
  }
  const use = { ...(def.use ?? {}) };
  if (use.mysticism === undefined && seed.use?.mysticism !== undefined) {
    use.mysticism = seed.use.mysticism;
  }
  if (use.skillBook === undefined && seed.use?.skillBook !== undefined) {
    use.skillBook = seed.use.skillBook;
  }
  if (Object.keys(use).length > 0) {
    out.use = use;
  }
  return out;
}
