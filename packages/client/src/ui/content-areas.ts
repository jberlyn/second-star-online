/**
 * Where every part of the content is edited: each Control Panel editor page's tabs, in plain
 * words. Every dataset part has exactly one home, so there is one place to go for each thing:
 *
 * - **Items**: each item (its own page), then the rules every item shares.
 * - **Creatures & NPCs**: each creature with its NPC file (its own page), then the rules every
 *   creature shares.
 * - **Spells**: each spell, what each spell effect deals or heals, and spell power.
 * - **Skills & Classes**: each skill (its own page), the classes and how a character starts.
 * - **Gathering & Crafting**: the gathering spots (their own page) and the crafting stations.
 * - **Houses & Vehicles**, **Quests**, **Community** (factions, guilds, chat, mail, the casino,
 *   help…) and **Game Rules** (the numbers for the whole game, and what the engine uses).
 *
 * `HOMES` maps each part to its page, so a change listed on the Content page opens there.
 */
import { content, hasContent } from "@secondstaronline/shared";

import type { AreaPart, AreaTab, RecordPanelLike } from "./content-area-page.ts";
import { masterworkPreview } from "./masterwork-preview.ts";
import { recipePreview } from "./recipe-preview.ts";

const p = (
  dataset: string,
  part: string,
  title: string,
  help: string,
  more: Partial<AreaPart> = {},
): AreaPart => ({ dataset, part, title, help, ...more });

/** The Items page's tabs after its item list. */
export const ITEM_RULE_TABS: AreaTab[] = [
  {
    kind: "settings",
    label: "Using and wearing",
    help: "What every item shares: how gear is worn and equipped, what using an item does, armour, and what happens when gear breaks.",
    parts: [
      p(
        "itemRules",
        "equip",
        "Wearing and equipping",
        "Where gear goes when worn, the Strength it needs and what players are told.",
      ),
      p(
        "itemRules",
        "use",
        "Using items",
        "What using an item does, and the messages players see.",
      ),
      p("itemRules", "armour", "Armour", "How worn armour protects."),
      p(
        "itemRules",
        "breaks",
        "Breaking gear",
        "When weapons and armour break, and what they become.",
      ),
      p("itemRules", "swing", "Swinging weapons", "How often a weapon can swing."),
      p(
        "itemRules",
        "requires",
        "Requirements by name",
        "Skills or levels needed for every item whose name matches.",
      ),
    ],
  },
  {
    kind: "settings",
    label: "Abilities by name",
    help: "Rules that reach every item whose name matches, as Classic gives its own items their abilities. An item's own page overrides them.",
    parts: [
      p(
        "itemRules",
        "behaviours",
        "Special abilities",
        "What items do (a key opens doors, a crate holds items…), by name.",
      ),
      p("itemRules", "tools", "Tools", "What each tool can gather, by name."),
      p(
        "itemRules",
        "ladders",
        "Weapon skill ladders",
        "How a weapon's skill makes it hit harder.",
      ),
      p("itemRules", "gear", "Gear bonuses", "Bonuses worn gear gives, by name."),
      p("attPower", "attPower", "Attack power", "How hard each weapon hits, by name."),
    ],
  },
  {
    kind: "settings",
    label: "On the ground and in bags",
    help: "How items sit on the ground, are picked up and held in containers, and the right-click menu.",
    parts: [
      p("itemRules", "ground", "On the ground", "How items on the ground behave."),
      p("itemRules", "pickup", "Picking up", "What players are told when they pick things up."),
      p("itemRules", "containers", "Containers", "Crates, chests and other items that hold items."),
      p("itemRules", "menu", "Item menu", "The choices in an item's menu."),
      p("itemRules", "paperdoll", "Worn pictures", "Which worn picture an item uses, by name."),
    ],
  },
  {
    kind: "settings",
    label: "Lists",
    help: "The lists of items the editors and player shops use.",
    parts: [
      p("items", "editorItems", "World Editor items", "The items the World Editor can place."),
      p(
        "items",
        "playerShopWhitelist",
        "Player shops",
        "The items players may sell in their shops.",
      ),
      p(
        "items",
        "fixtures",
        "Map fixtures",
        "Doors, signs, chests and other things drawn on maps.",
        {},
      ),
    ],
  },
];

/** The Creatures & NPCs page's tabs after its creature list. */
export const CREATURE_RULE_TABS: AreaTab[] = [
  {
    kind: "settings",
    label: "Rules for every creature",
    help: "What every creature shares: how they fight and behave, the stand-in for a name with no creature, and the editors' lists.",
    parts: [
      p("monsters", "rules", "Behaviour", "Rules that reach every creature whose name matches."),
      p(
        "monsters",
        "meleeAffinities",
        "Weapon bonuses",
        "Weapons that hit some creatures harder or softer.",
      ),
      p(
        "monsters",
        "skillCaps",
        "Skill training limits",
        "How far killing creatures trains a weapon's skills.",
      ),
      p(
        "monsters",
        "generic",
        "Stand-in creature",
        "The body and defense of a name no creature has (a player shop's shopkeeper).",
      ),
      p(
        "monsters",
        "editorLists",
        "Editor lists",
        "The creatures and NPCs the World Editor and NPC Editor offer.",
      ),
    ],
  },
];

/** The Spells page. `effect` is the cast-effect picture panel each spell shows. */
export const SPELL_TABS = (amounts: AreaTab, effect?: () => RecordPanelLike | null): AreaTab[] => [
  {
    kind: "records",
    label: "Spells",
    help: "Each spell players can learn and cast: its cost, its picture and sound, and what it does.",
    part: p("spells", "spells", "Spells", "", {
      noun: "spell",
      ...(effect ? { panel: effect } : {}),
    }),
  },
  amounts,
  {
    kind: "settings",
    label: "Spell power",
    help: "How strong a cast is: the power every spell starts from and each spell's power table.",
    parts: [p("spells", "power", "Spell power", "The power a cast has, by the caster's skill.")],
  },
];

/** A class's name by its number, as players see it ("4 · Knight"). */
function className(code: string): string {
  if (!hasContent()) {
    return code;
  }
  const k = content().classes.classes.find((c) => String(c.code) === code);
  return k?.name ? `${k.name} (${code})` : code;
}

/** The Skills & Classes page's tabs after its skill list. */
export const CLASS_TABS: AreaTab[] = [
  {
    kind: "records",
    label: "Classes",
    help: "The classes characters belong to and are promoted to.",
    part: p("classes", "classes", "Classes", "", { noun: "class", labelOf: className }),
  },
  {
    kind: "records",
    label: "Starting classes",
    help: "The classes a new character can pick.",
    part: p("classes", "startClasses", "Starting classes", "", {
      noun: "starting class",
      labelOf: className,
    }),
  },
  {
    kind: "settings",
    label: "New characters",
    help: "How a new character is made and what it starts with.",
    parts: [
      p(
        "classes",
        "creation",
        "Making a character",
        "The choices and limits when making a character.",
      ),
      p("bindings", "start", "Starting out", "A new character's HP, SP and first bag."),
      p("classes", "progression", "Levels and XP", "How characters level up."),
      p("classes", "skillGain", "Weapon training", "Which skills each weapon trains."),
    ],
  },
  {
    kind: "settings",
    label: "Skills the game uses",
    help: "Which skill each of the game's mechanics reads (parrying, fishing, the crafts…). A mechanic with no skill is off.",
    parts: [p("bindings", "skills", "Skills the game uses", "")],
  },
];

/** The Gathering & Crafting page's tabs after the gathering spots. */
export const CRAFT_TABS: AreaTab[] = [
  {
    kind: "records",
    label: "Recipes",
    help: "Each recipe made through the crafting window: what it takes and makes, the skill it needs and trains, and its odds and time.",
    part: p("craft", "recipes", "Recipes", "", { noun: "recipe", preview: recipePreview }),
  },
  {
    kind: "records",
    label: "Recipe stations",
    help: "Where recipes are made: the station players stand at (or the bag item that opens it), and the tools it takes.",
    part: p("craft", "recipeStations", "Recipe stations", "", { noun: "recipe station" }),
  },
  {
    kind: "records",
    label: "Masterworks",
    help: "The better items any craft can make: when a craft makes the item, the chance by the crafting skill it comes out as one of its masterworks instead.",
    part: p("craft", "masterworks", "Masterworks", "", {
      noun: "masterwork",
      preview: masterworkPreview,
    }),
  },
  {
    kind: "settings",
    label: "Classic crafting",
    help: "The four Classic stations (smithing repairs, cooking, alchemy and carpentry) and the Cauldron, each with its own fixed rules.",
    parts: [
      p(
        "craft",
        "stations",
        "Crafting stations",
        "Smithing, cooking, alchemy, carpentry and the rest.",
      ),
    ],
  },
];

/**
 * The Houses & Vehicles page. `removeVehicle` opens a vehicle's removal, which asks what happens to
 * its riders, the parked ones and its deeds.
 */
export const HOUSE_TABS = (
  vehicleNumbers: AreaTab,
  removeVehicle?: (name: string) => void,
): AreaTab[] => [
  {
    kind: "records",
    label: "House types",
    help: "Each kind of house players can build: its size and tiles.",
    part: p("houses", "types", "House types", "", { noun: "house type" }),
  },
  {
    kind: "records",
    label: "Deeds",
    help: "The deeds players use to build a house or a vehicle.",
    part: p("houses", "deeds", "Deeds", "", { noun: "deed" }),
  },
  {
    kind: "records",
    label: "Vehicles",
    help: "Each vehicle: its tiles, boarding, picture, rider and cannon.",
    part: p("houses", "vehicles", "Vehicles", "", {
      noun: "vehicle",
      ...(removeVehicle
        ? { removeVia: { label: "Remove this vehicle…", run: removeVehicle } }
        : {}),
    }),
  },
  vehicleNumbers,
  {
    kind: "settings",
    label: "Building",
    help: "Placing and building houses, and what happens to their furniture.",
    parts: [
      p("houses", "placement", "Placing a house", "Where a house may go."),
      p("houses", "build", "Building", "How a house is built."),
      p("houses", "ghost", "Placement preview", "The outline shown while placing."),
      p("houses", "furnitureDrop", "Furniture", "What happens to furniture."),
      p("houses", "decay", "Decay", "How houses decay when not kept up."),
    ],
  },
  {
    kind: "settings",
    label: "Doors, keys and chests",
    help: "Doors, keys, switches, containers and what players can click in a house.",
    parts: [
      p("houses", "keys", "Keys", "How house keys work."),
      p("houses", "switches", "Switches", "Switches that open and close doors."),
      p("houses", "relock", "Relocking", "When doors lock again."),
      p("houses", "containers", "Containers", "Chests and other containers in houses."),
      p("houses", "clickFixtures", "Things to click", "What clicking a fixture does."),
      p("houses", "restRegen", "Resting", "How resting in a house heals."),
    ],
  },
];

/** The Quests page. */
export const QUEST_TABS: AreaTab[] = [
  {
    kind: "settings",
    label: "Quests",
    help: "The quests NPCs give: the ones a new world starts with and the pools the next quest is picked from.",
    parts: [
      p(
        "quests",
        "pools",
        "Quest pools",
        "When a quest is finished, the next one is picked from these.",
      ),
      p(
        "quests",
        "current",
        "A new world's quests",
        "The quests a brand-new world starts with. A world that has started keeps its own.",
      ),
      p("houses", "questChest", "Quest chest", "The chest quests fill."),
      p("social", "questReplies", "Quest replies", "What NPCs say about quests."),
    ],
  },
];

/** The Community page. */
export const COMMUNITY_TABS: AreaTab[] = [
  {
    kind: "records",
    label: "Factions",
    help: "The factions players can join, with their leaders, heads and perks.",
    part: p("social", "factions", "Factions", "", { noun: "faction" }),
  },
  {
    kind: "settings",
    label: "Faction rules",
    help: "What every faction shares, and the player-killing rules.",
    parts: [
      p(
        "social",
        "factionRules",
        "Faction rules",
        "Tiers, perks and the World Editor's spawn boxes.",
      ),
      p("social", "murder", "Player killing", "What happens when players kill each other."),
      p("social", "assassin", "The Assassin's Game", "The bounty game."),
      p("social", "medals", "Medals", "The medals players earn."),
      p("social", "highScores", "High scores", "The high score tables."),
    ],
  },
  {
    kind: "settings",
    label: "Guilds and friends",
    help: "Guilds, buddies and players' Bios.",
    parts: [
      p("social", "guilds", "Guilds", "Making and running guilds."),
      p("social", "buddies", "Buddies", "The buddy list."),
      p("social", "bios", "Bios", "Players' Bio windows."),
    ],
  },
  {
    kind: "settings",
    label: "Chat, mail and news",
    help: "Chat rooms, mail, the message boards, the art tools and the newspaper.",
    parts: [
      p("social", "chat", "Chat", "Chat rooms and their rules."),
      p("social", "mail", "Mail", "Sending mail."),
      p("social", "boards", "Message boards", "The boards players post on."),
      p("social", "art", "Art tools", "Painting and the art players make."),
      p("social", "newspaper", "Newspaper", "The newspaper."),
    ],
  },
  {
    kind: "settings",
    label: "Casino",
    help: "The Slot Machine, Blackjack and Checkers.",
    parts: [
      p("casino", "slots", "Slot Machine", "Its payouts and sounds."),
      p("casino", "blackjack", "Blackjack", "The card game's rules."),
      p("casino", "checkers", "Checkers", "The board game's rules."),
    ],
  },
  {
    kind: "records",
    label: "Help topics",
    help: "The topics /help shows. The Help topic is also the greeting a character gets on logging in.",
    part: p("help", "topics", "Help topics", "", { noun: "help topic" }),
  },
];

/** The Game Rules page's tabs after its numbers. */
export const GAME_RULE_TABS: AreaTab[] = [
  {
    kind: "settings",
    label: "Currency and bodies",
    help: "The item that is money, the cannon's ammunition and the bodies spells put on players.",
    parts: [
      p("bindings", "currency", "Currency", "The item players carry as money."),
      p("bindings", "cannon", "Cannon", "What a cannon shot spends."),
      p(
        "bindings",
        "bodies",
        "Bodies",
        "The bodies Morph, Nature Shift and Smoke Bomb put on a player.",
      ),
    ],
  },
  {
    kind: "settings",
    label: "Tiles",
    help: "Which tiles can be walked on and the tile rules every map shares. Each tile's picture and flags are on the Pictures & Sounds page.",
    parts: [
      p("tiles", "walkable", "Walkable tiles", "The tiles players can walk on."),
      p("tiles", "defaults", "Tile rules", "What tiles do unless a tile says otherwise."),
    ],
  },
];

/** The Control Panel pages that edit content. */
export type ContentHome =
  | "items"
  | "monsters"
  | "spells"
  | "skills"
  | "gathering"
  | "houses"
  | "quests"
  | "community"
  | "balance"
  | "pictures";

/** Each page's title, as the sidebar says it. */
export const HOME_TITLES: Record<ContentHome, string> = {
  items: "Items",
  monsters: "Creatures & NPCs",
  spells: "Spells",
  skills: "Skills & Classes",
  gathering: "Gathering & Crafting",
  houses: "Houses & Vehicles",
  quests: "Quests",
  community: "Community",
  balance: "Game Rules",
  pictures: "Pictures & Sounds",
};

/** Each page's tabs as data, to find a part's home. */
const NO_PANEL: AreaTab = {
  kind: "custom",
  label: "",
  help: "",
  el: undefined as unknown as HTMLElement,
};
const AREA_TABS: [ContentHome, AreaTab[]][] = [
  ["items", ITEM_RULE_TABS],
  ["monsters", CREATURE_RULE_TABS],
  ["spells", SPELL_TABS(NO_PANEL)],
  ["skills", CLASS_TABS],
  ["gathering", CRAFT_TABS],
  ["houses", HOUSE_TABS(NO_PANEL)],
  ["quests", QUEST_TABS],
  ["community", COMMUNITY_TABS],
  ["balance", GAME_RULE_TABS],
];

/**
 * The page a row is edited on, or null for one no page edits (the collision rects, built from the
 * art). Every other part has a home.
 */
export function homeOf(dataset: string, part: string): ContentHome | null {
  if (dataset === "items" && (part === "items" || part === "definitions")) {
    return "items";
  }
  // An NPC file is the Talk & Shops tab of Creatures & NPCs.
  if (
    (dataset === "monsters" &&
      (part === "monsters" || part === "definitions" || part === "casting")) ||
    dataset === "npcFiles"
  ) {
    return "monsters";
  }
  if (dataset === "classes" && (part === "skills" || part === "skillOrder")) {
    return "skills";
  }
  if (dataset === "gather") {
    return "gathering";
  }
  if (dataset === "balance") {
    return part === "spellEffects" ||
      part === "spellHits" ||
      part === "buffs" ||
      part === "castPower"
      ? "spells"
      : part === "vehicles" || part === "cannon"
        ? "houses"
        : "balance";
  }
  if (dataset === "art" || (dataset === "tiles" && part === "catalogue")) {
    return "pictures";
  }
  for (const [home, tabs] of AREA_TABS) {
    for (const t of tabs) {
      if (t.kind === "records" && t.part.dataset === dataset && t.part.part === part) {
        return home;
      }
      if (t.kind === "settings" && t.parts.some((x) => x.dataset === dataset && x.part === part)) {
        return home;
      }
    }
  }
  return null;
}
