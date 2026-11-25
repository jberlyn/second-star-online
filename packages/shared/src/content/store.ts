/**
 * The live content store: every content dataset the rules read, in one object, plus the lookups
 * built from it. Every consumer reaches it through one swappable holder (`content()`), so an
 * operator's publish (or a test's fixture) replaces the whole store in one step and every rule
 * sees the change.
 *
 * Values a module used to copy out of the data when it loaded (text tables, flag sets, indexes)
 * are rebuilt from the new store in `onContent` callbacks, which run in module-load order each
 * time a store is installed. Rebuilt exports are `export let` bindings, which ES modules keep live
 * for every importer, so no caller holds an old copy.
 *
 * Nothing here imports the generated modules: the server builds a store from its installed packs
 * and the operator layer, the client from the copy the server sends, and tests from the Classic
 * fixture (`installClassicContent` in the test helpers).
 */
import type {
  ArtData,
  AttPowerData,
  BalanceData,
  BindingsData,
  CasinoData,
  ClassesData,
  CraftData,
  GatherData,
  HelpData,
  HouseData,
  Item,
  ItemRulesData,
  ItemsData,
  Monster,
  MonstersData,
  NpcFilesData,
  QuestData,
  RectsData,
  SocialData,
  SpellsData,
  TilesData,
} from "@secondstaronline/data";

import { type Balance, fullBalance } from "./balance.ts";

/**
 * Every dataset in a content store. Server-only datasets (NPC file text, collision rects, the
 * uploaded art rows) are
 * left out of the copy sent to clients (`clientContent`), which install them as empty.
 */
export interface ContentData {
  attPower: AttPowerData;
  bindings: BindingsData;
  casino: CasinoData;
  classes: ClassesData;
  craft: CraftData;
  gather: GatherData;
  help: HelpData;
  houses: HouseData;
  itemRules: ItemRulesData;
  items: ItemsData;
  monsters: MonstersData;
  quests: QuestData;
  social: SocialData;
  spells: SpellsData;
  tiles: TilesData;
  npcFiles: NpcFilesData;
  rects: RectsData;
  /** Uploaded art and sounds (issue #29): rows naming files in the server's store. */
  art: ArtData;
  /**
   * The balance numbers (issue #19), as the packs and the operator set them: any part may be left
   * out, and the store fills it from the engine's defaults (`content().balance` is always full).
   */
  balance: BalanceData;
}

export type DatasetId = keyof ContentData;

/**
 * The format of the store file the server sends clients (`/content/<hash>.json`). A client built
 * for another format reloads to get the matching client.
 */
export const CONTENT_FORMAT = 9;

/** The datasets only the server reads. */
export const SERVER_ONLY_DATASETS = [
  "npcFiles",
  "rects",
  "art",
  "balance",
] as const satisfies readonly DatasetId[];

/** Every dataset id, in a fixed order (the order hashes and pack files use). */
export const DATASET_IDS = [
  "attPower",
  "bindings",
  "casino",
  "classes",
  "craft",
  "gather",
  "help",
  "houses",
  "itemRules",
  "items",
  "monsters",
  "quests",
  "social",
  "spells",
  "tiles",
  "npcFiles",
  "rects",
  "art",
  "balance",
] as const satisfies readonly DatasetId[];

/** A built store: the data and its lookups. Treat it as read-only. */
export interface ContentStore extends Omit<ContentData, "balance"> {
  /** The world's balance with every value present: what it sets, else the engine's default. */
  readonly balance: Balance;
  /** Identifies this exact content (the hash of the client copy); "" for a fixture without one. */
  readonly hash: string;
  /** The catalogue item with this key (case ignored), or undefined. */
  item(name: string): Item | undefined;
  /**
   * The item text written by an operator names (an NPC file line, an admin command): its key, or
   * else the display name it was renamed to (case ignored). Resolve it to the key when saving, so
   * a later rename never breaks the text.
   */
  itemNamed(text: string): Item | undefined;
  /** The monster with this name (case ignored), or undefined. */
  monster(name: string): Monster | undefined;
}

/**
 * Compiles item definitions into the rule tables (content/definitions.ts, issue #30). Registered by
 * that module when it loads: it imports rules that import this module, so this module cannot import
 * it.
 */
let compileItems: ((data: ContentData) => ContentData) | null = null;

/** Registers the item-definition compile (content/definitions.ts calls it once, as it loads). */
export function setDefinitionCompiler(fn: (data: ContentData) => ContentData): void {
  compileItems = fn;
}

/**
 * Builds a store's lookups over a set of datasets, with its item definitions compiled into the rule
 * tables. The data is not changed.
 */
export function buildContentStore(raw: ContentData, hash = ""): ContentStore {
  if (
    !compileItems &&
    ((raw.items.definitions?.length ?? 0) > 0 || (raw.monsters.definitions?.length ?? 0) > 0)
  ) {
    throw new Error("item and monster definitions need content/definitions.ts loaded");
  }
  const data = compileItems ? compileItems(raw) : raw;
  const items = new Map<string, Item>();
  for (const i of data.items.items) {
    if (!items.has(i.name.toLowerCase())) {
      items.set(i.name.toLowerCase(), i);
    }
  }
  const displays = new Map<string, Item>();
  for (const i of data.items.items) {
    if (i.display && !displays.has(i.display.toLowerCase())) {
      displays.set(i.display.toLowerCase(), i);
    }
  }
  const monsters = new Map<string, Monster>();
  for (const m of data.monsters.monsters) {
    if (!monsters.has(m.name.toLowerCase())) {
      monsters.set(m.name.toLowerCase(), m);
    }
  }
  return {
    ...data,
    balance: fullBalance(data.balance),
    hash,
    item: (name) => items.get(name.toLowerCase()),
    itemNamed: (text) => items.get(text.toLowerCase()) ?? displays.get(text.toLowerCase()),
    monster: (name) => monsters.get(name.toLowerCase()),
  };
}

let current: ContentStore | null = null;
const listeners: ((store: ContentStore) => void)[] = [];

/** The installed store. Throws when none is installed yet (a module read the data too early). */
export function content(): ContentStore {
  if (!current) {
    throw new Error("no content store installed");
  }
  return current;
}

/** Whether a store is installed. */
export function hasContent(): boolean {
  return current !== null;
}

/**
 * Installs a store, replacing the current one in a single step, then runs every `onContent`
 * callback in registration order (which is module-load order, so a module's dependencies rebuild
 * before it does).
 */
export function installContent(store: ContentStore): void {
  current = store;
  for (const fn of listeners) {
    fn(store);
  }
}

/**
 * Registers a rebuild: `fn` runs now if a store is installed, and again on every install. Use it
 * for every value a module derives from the data, never a module-level read of `content()`.
 */
export function onContent(fn: (store: ContentStore) => void): void {
  listeners.push(fn);
  if (current) {
    fn(current);
  }
}
