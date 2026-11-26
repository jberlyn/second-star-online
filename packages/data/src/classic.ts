/**
 * The Classic pack's datasets, read from the built pack (`packs/classic/`, written by
 * `bun run data:build`), keyed as the content store keys them. Kept off the package index: the
 * test fixtures and the command-line tools read it, while the server loads the pack from its
 * folder like any other pack, and the client never bundles it.
 */

import attPower from "../packs/classic/data/attpower.json" with { type: "json" };
import balance from "../packs/classic/data/balance.json" with { type: "json" };
import bindings from "../packs/classic/data/bindings.json" with { type: "json" };
import casino from "../packs/classic/data/casino.json" with { type: "json" };
import classes from "../packs/classic/data/classes.json" with { type: "json" };
import craft from "../packs/classic/data/craft.json" with { type: "json" };
import events from "../packs/classic/data/events.json" with { type: "json" };
import gather from "../packs/classic/data/gather.json" with { type: "json" };
import help from "../packs/classic/data/help.json" with { type: "json" };
import houses from "../packs/classic/data/houses.json" with { type: "json" };
import itemRules from "../packs/classic/data/item-rules.json" with { type: "json" };
import items from "../packs/classic/data/items.json" with { type: "json" };
import monsters from "../packs/classic/data/monsters.json" with { type: "json" };
import npcFiles from "../packs/classic/data/npc-files.json" with { type: "json" };
import quests from "../packs/classic/data/quests.json" with { type: "json" };
import rects from "../packs/classic/data/rects.json" with { type: "json" };
import social from "../packs/classic/data/social.json" with { type: "json" };
import spells from "../packs/classic/data/spells.json" with { type: "json" };
import tiles from "../packs/classic/data/tiles.json" with { type: "json" };
import manifest from "../packs/classic/manifest.json" with { type: "json" };
import type { ArtData } from "../schema/art.ts";
import type { AttPowerData } from "../schema/attpower.ts";
import type { BalanceData } from "../schema/balance.ts";
import type { BindingsData } from "../schema/bindings.ts";
import type { CasinoData } from "../schema/casino.ts";
import type { ClassesData } from "../schema/classes.ts";
import type { CraftData } from "../schema/craft.ts";
import type { EventsData } from "../schema/events.ts";
import type { GatherData } from "../schema/gather.ts";
import type { HelpData } from "../schema/help.ts";
import type { HouseData } from "../schema/houses.ts";
import type { ItemRulesData } from "../schema/item-rules.ts";
import type { ItemsData } from "../schema/items.ts";
import type { MonstersData } from "../schema/monsters.ts";
import type { NpcFilesData } from "../schema/npcfiles.ts";
import type { PackManifest } from "../schema/pack.ts";
import type { QuestData } from "../schema/quests.ts";
import type { RectsData } from "../schema/rects.ts";
import type { SocialData } from "../schema/social.ts";
import type { SpellsData } from "../schema/spells.ts";
import type { TilesData } from "../schema/tiles.ts";

export const classicManifest = manifest as PackManifest;

export const classicData = {
  attPower: attPower as unknown as AttPowerData,
  bindings: bindings as unknown as BindingsData,
  casino: casino as unknown as CasinoData,
  classes: classes as unknown as ClassesData,
  craft: craft as unknown as CraftData,
  gather: gather as unknown as GatherData,
  help: help as unknown as HelpData,
  houses: houses as unknown as HouseData,
  itemRules: itemRules as unknown as ItemRulesData,
  items: items as unknown as ItemsData,
  monsters: monsters as unknown as MonstersData,
  quests: quests as unknown as QuestData,
  social: social as unknown as SocialData,
  spells: spells as unknown as SpellsData,
  tiles: tiles as unknown as TilesData,
  npcFiles: npcFiles as unknown as NpcFilesData,
  rects: rects as unknown as RectsData,
  /** Classic carries no art rows: its art is its built atlases. */
  art: { items: [], paperdoll: [], bodies: [], fx: [], tiles: [], sounds: [] } as ArtData,
  balance: balance as unknown as BalanceData,
  events: events as unknown as EventsData,
};
