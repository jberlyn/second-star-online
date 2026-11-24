/**
 * What the content service asks of the game world when content in use is removed (issue #28):
 * where copies of an item or live monsters are (online players and loaded maps from memory, the
 * rest from the database), what to do with them when the removal is published, and the stored
 * references nothing in the content resolves. The game implements it (game.ts `contentWorld`);
 * tests pass a fake.
 */
import type { ServerMsg } from "@secondstaronline/shared";

import type { EntryKind } from "./cleanup.ts";
import type { ContentActor } from "./service.ts";
import type { ContentProblem } from "./validate.ts";

/** A message for one client (systems/world/world.ts `Outgoing`). */
export interface Outgoing {
  to: string;
  msg: ServerMsg;
}

/** A kind of place the world keeps an item or a monster. */
export type UsagePlaceKind =
  | "bag"
  | "worn"
  | "vault"
  | "container"
  | "ground"
  | "quest"
  | "spawn"
  | "live"
  /** Stock on sale in player shops (their shopkeepers). */
  | "shop";

/** One kind of place, with how many copies and who or where holds them. */
export interface UsagePlace {
  place: UsagePlaceKind;
  /** Copies (items), quest lines, roster slots or live monsters. */
  count: number;
  /** Characters (bag, worn, vault), containers or maps holding them, the first few by name. */
  holders: string[];
  /** How many holders there are in all. */
  holderCount: number;
}

/** What happens to the copies players hold of a removed item. */
export type CopiesAction = "retire" | "purge" | "replace";

/** What a removal does to the world on publish. */
export type WorldAction =
  | {
      kind: "item";
      key: string;
      /** The key and archived spellings stored copies may use. */
      spellings: string[];
      copies: CopiesAction;
      /** The item copies become (replace), or null. */
      replacement: string | null;
      /** Gold given back for each purged copy a character held. */
      refundGold: number;
      /** What the NPC Editor's saves naming it get (as the content rows did); absent: remove. */
      content?: "remove" | "replace" | "leave";
      /** The item those saves name instead, for `content: "replace"`. */
      contentReplacement?: string | null;
    }
  | {
      kind: "monster";
      key: string;
      spawns: "remove" | "replace";
      live: "despawn" | "leave";
      /** The monster spawns become (replace), or null. */
      replacement: string | null;
      /** Its NPC Editor save goes with it (as its NPC file row did); absent: delete. */
      npcFile?: "delete" | "keep";
    };

/** An operator's removal of an item, with its cleanup. */
export interface ItemRemoval {
  kind: "item";
  key: string;
  content: "remove" | "replace" | "leave";
  copies: CopiesAction;
  replacement: string | null;
  refundGold: number;
}

/** An operator's removal of a monster or NPC, with its cleanup. */
export interface MonsterRemoval {
  kind: "monster";
  key: string;
  content: "remove" | "replace" | "leave";
  spawns: "remove" | "replace";
  live: "despawn" | "leave";
  /** Its own NPC file: removed with it, or kept unattached. */
  npcFile: "delete" | "keep";
  replacement: string | null;
}

export type Removal = ItemRemoval | MonsterRemoval;

export interface ContentWorld {
  /** Where the world holds an item (any of its spellings) or a monster. */
  usage(kind: EntryKind, spellings: readonly string[]): UsagePlace[];
  /**
   * The maps using each tile code (lower case), loaded maps as they are in memory (issue #29,
   * stage 6). Optional: a world that cannot say leaves tile removals to the content checks.
   */
  tileMaps?(): Map<string, string[]>;
  /** How many different characters hold a copy of the item (bag, gear or vault). */
  holders(spellings: readonly string[]): number;
  /**
   * A publish starts (before its transaction): memory is noted so a rollback can put it back, and
   * what the game tells clients from here, the new store included, is held until `commit` (or
   * dropped by `rollback`).
   */
  begin(): void;
  /**
   * Tells clients `out`: held while a publish is open, at once otherwise. The game sends what a new
   * store changes through it.
   */
  tell(out: readonly Outgoing[]): void;
  /**
   * Applies published removals to the world, inside the publish's transaction: online players and
   * loaded maps in memory (their clients told), the rest in the database. Returns a line for each
   * thing done.
   */
  apply(actions: readonly WorldAction[], actor: ContentActor, publishId: string): string[];
  /** Stored references (bags, the ground, spawns) the published content does not resolve. */
  problems(): ContentProblem[];
  /**
   * Puts back in memory what the open publish changed: it failed, and the database rolled back
   * with it. What it held for clients is dropped.
   */
  rollback(): void;
  /** The publish committed: what it held back for clients goes out. */
  commit(): void;
}
