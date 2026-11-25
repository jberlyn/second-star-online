/** Plain words for the `houses` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

const TILE_FLAGS = {
  sea: "Sea",
  airshipBlock: "Blocks airships",
  dock: "Airship dock",
  arena: "Arena",
  grave: "Grave",
};

/** A set of tiles named by flag and/or by tile code. */
const tileSet = (prefix: string): WordBook => ({
  [`${prefix}.flags`]: {
    label: "Tiles with these marks",
    noun: "mark",
    choices: TILE_FLAGS,
  },
  [`${prefix}.flags.[]`]: { label: "Mark", choices: TILE_FLAGS },
  [`${prefix}.codes`]: {
    label: "Tiles with these codes",
    help: "Tile codes, such as 8R (as the map editor shows them).",
    noun: "tile code",
  },
  [`${prefix}.codes.[]`]: { label: "Tile code" },
});

export const housesWords: WordBook = {
  // ---- deeds (one row per deed item) ----
  "deeds.deed": { label: "Deed item", help: "The item players use to build.", names: "item" },
  "deeds.use": {
    label: "What it builds",
    help: "What happens when a player uses the deed.",
    choices: {
      nothing: "Nothing (shows a message)",
      vehicle: "A vehicle",
      airship: "The Airship (old spelling)",
      boat: "The Boat (old spelling)",
      battleship: "The Battleship (old spelling)",
      place: "A building",
    },
  },
  "deeds.vehicle": {
    label: "Vehicle",
    help: "The vehicle this deed builds.",
    names: "vehicle",
  },
  "deeds.house": {
    label: "Building",
    help: "The building this deed places.",
    names: "house",
  },
  "deeds.text": {
    label: "Message when used",
    help: "What players are told when the deed builds nothing. The deed is kept.",
    long: true,
  },

  // ---- vehicles (one row per vehicle) ----
  "vehicles.name": {
    label: "Name",
    help: "Its permanent name, used for the parked vehicle and what players ride.",
  },
  "vehicles.display": { label: "Name players see", help: "Leave off to use its name." },
  "vehicles.picture": {
    label: "Picture when parked",
    help: "The item picture a parked one shows.",
  },
  "vehicles.rider": {
    label: "Rider's body",
    help: "The body (picture number) a player riding it shows. No two vehicles share one.",
  },
  "vehicles.hull": {
    label: "Hull strength",
    help: "Hits wear the hull, never the rider. At 0 the vehicle is lost.",
  },
  "vehicles.moves": { label: "Where it can go" },
  "vehicles.moves.over": {
    label: "It crosses",
    shapes: ["Any tile", "Only these tiles"],
  },
  ...tileSet("vehicles.moves.over"),
  "vehicles.moves.except": {
    label: "Except these tiles",
    help: "Tiles it can never cross.",
  },
  ...tileSet("vehicles.moves.except"),
  "vehicles.boards": {
    label: "How it is boarded",
    help: "A ship is boarded from the shore and sails at walking pace; a flyer is boarded from a pad and flies twice as fast over everything.",
    choices: { shore: "From the shore (sails)", pad: "From a landing pad (flies)" },
  },
  "vehicles.lands": {
    label: "Landing pads",
    help: "The tiles a flying vehicle is built on and left on.",
  },
  ...tileSet("vehicles.lands"),
  "vehicles.cannon": {
    label: "Has a cannon",
    help: "The rider can fire cannonballs.",
  },
  "vehicles.bobs": {
    label: "Bobs on the water when parked",
    help: "A parked ship rocks on the waves instead of showing its picture.",
  },

  // ---- building types (one row per building) ----
  "types.house": { label: "Building name" },
  "types.deed": { label: "Deed item", help: "The deed that places this building.", names: "item" },
  "types.guild": {
    label: "Guild hall",
    help: "Only guild members can build it, and the guild shares it.",
  },
  "types.ghost": {
    label: "Placement preview picture",
    help: "The see-through picture shown while choosing where to build.",
    more: true,
  },
  "types.ghost.member": { label: "Picture number" },
  "types.ghost.width": { label: "Width (pixels)" },
  "types.ghost.height": { label: "Height (pixels)" },
  "types.ghost.regX": { label: "Picture centre across (pixels)" },
  "types.ghost.regY": { label: "Picture centre down (pixels)" },
  "types.ghost.shiftX": { label: "Shift across (pixels)" },
  "types.ghost.shiftY": { label: "Shift down (pixels)" },
  "types.anchor": {
    label: "Placement offset",
    help: "Tiles from the pointed-at tile to the building's top-left corner.",
    more: true,
  },
  "types.anchor.dx": { label: "Tiles across" },
  "types.anchor.dy": { label: "Tiles down" },
  "types.footprint": { label: "Size on the map", help: "In tiles." },
  "types.footprint.w": { label: "Width (tiles)", shapes: ["3 tiles", "5 tiles"] },
  "types.footprint.h": { label: "Height (tiles)" },
  "types.tiles": {
    label: "Outside tiles",
    help: "The tiles laid on the map when it is built.",
    noun: "tile",
    more: true,
  },
  "types.tiles.[].0": { label: "Tile code" },
  "types.tiles.[].1": { label: "Tiles across" },
  "types.tiles.[].2": { label: "Tiles down" },
  "types.mailbox": { label: "Has a mailbox" },
  "types.lamp": { label: "Has a street lamp" },
  "types.header": {
    label: "Kind of building",
    help: "Picks the name its inside map is given.",
    choices: { house: "House", farm: "Farm", guild: "Guild hall", shop: "Shop" },
  },
  "types.interiorItems": {
    label: "Items placed inside",
    help: "What a new building has inside it.",
    noun: "item",
  },
  "types.interiorItems.[].item": { label: "Item", names: "item" },
  "types.interiorItems.[].x": { label: "Across (1–17)" },
  "types.interiorItems.[].y": { label: "Down (1–12)" },
  "types.template": {
    label: "Inside map",
    help: "The map a new building's inside is copied from.",
    more: true,
  },
  "types.template.layers": { label: "Map layers", hidden: true },
  "types.template.flags": { label: "Inside map rules" },
  "types.template.flags.canFight": {
    label: "Fighting allowed",
    choices: { O: "Yes", X: "No" },
  },
  "types.template.flags.fctSpwn": {
    label: "Faction inside",
    help: "The faction whose members appear inside. Leave empty for none.",
    names: "faction",
  },
  "types.template.flags.isIndoors": {
    label: "Indoors",
    choices: { O: "Yes", X: "No" },
  },
  "types.template.flags.canPvp": {
    label: "Player fights allowed",
    choices: { O: "Yes", X: "No" },
  },
  "types.template.field18": { label: "Extra map setting", hidden: true },

  // ---- placement preview position ----
  "ghost.baseX": {
    label: "Preview shift across (pixels)",
    help: "Moves every building's placement preview.",
  },
  "ghost.baseY": { label: "Preview shift down (pixels)" },

  // ---- where buildings may go ----
  "placement.edge": {
    label: "Map edge",
    help: "Buildings must stand inside these tiles.",
  },
  "placement.edge.minX": { label: "Leftmost tile" },
  "placement.edge.minY": { label: "Topmost tile" },
  "placement.edge.maxX": { label: "Rightmost tile" },
  "placement.edge.maxY": { label: "Lowest tile" },
  "placement.edge.text": { label: "Message when too near the edge", long: true },
  "placement.terrain": { label: "Ground" },
  "placement.terrain.layer1Codes": {
    label: "Ground tiles you can build on",
    help: "Every tile under the building must be one of these.",
    noun: "tile code",
  },
  "placement.terrain.layer1Codes.[]": { label: "Tile code" },
  "placement.terrain.text": { label: "Message when the ground is wrong", long: true },
  "placement.obstacles": { label: "Message when something is in the way", long: true },
  "placement.slots": { label: "Message when the map is full", long: true },
  "placement.guild": { label: "Message when not in a guild", long: true },

  // ---- what building places ----
  "build.exit": { label: "Door position", help: "From the building's top-left tile." },
  "build.mailbox": { label: "Mailbox position", help: "From the building's top-left tile." },
  "build.lamp": { label: "Street lamp position", help: "From the building's top-left tile." },
  "build.*.dx": { label: "Tiles across" },
  "build.*.dy": { label: "Tiles down" },
  "build.headers": {
    label: "Inside map names",
    help: "<name> is the builder, <guild> the builder's guild.",
  },
  "build.headers.house": { label: "A house" },
  "build.headers.farm": { label: "A farm" },
  "build.headers.guild": { label: "A guild hall" },
  "build.headers.shop": { label: "A shop" },
  "build.arrival": { label: "Where you arrive inside" },
  "build.arrival.x": { label: "Across" },
  "build.arrival.y": { label: "Down" },

  // ---- furniture ----
  "furnitureDrop.items": {
    label: "Furniture",
    help: "Items that can only be put down inside your own building.",
    noun: "item",
    names: "item",
  },
  "furnitureDrop.items.[]": { label: "Item", names: "item" },
  "furnitureDrop.text": { label: "Message when it isn't your building", long: true },

  // ---- clickable fixtures ----
  clickFixtures: { label: "Clickable fixtures", noun: "fixture" },
  "clickFixtures.[].item": {
    label: "Item",
    help: "The item on the ground that answers a click.",
    names: "item",
  },
  "clickFixtures.[].match": {
    label: "How the name is matched",
    choices: { exact: "Exactly this name", contains: "Any name containing it" },
  },
  "clickFixtures.[].text": { label: "Message when clicked", long: true },
  "clickFixtures.[].action": {
    label: "What it does",
    help: "A switch's action. Leave off for a plain message.",
    more: true,
  },

  // ---- resting indoors ----
  "restRegen.odds": {
    label: "Chance per step: 1 in",
    help: "How often a player inside a building gets 1 HP and 1 SP back.",
  },
  "restRegen.maxY": {
    label: "Only above row",
    help: "Players lower down than this row don't rest.",
  },

  // ---- abandoned buildings ----
  "decay.clockFrames": {
    label: "Check every (frames)",
    help: "How often abandoned buildings are looked for. 20 frames is a second.",
    more: true,
  },
  "decay.staleAfterMonths": {
    label: "Removed after (months)",
    help: "A building goes once its owner hasn't played for this many calendar months.",
  },

  // ---- keys ----
  "keys.houseKey": { label: "House key item", names: "item" },
  "keys.guildKey": { label: "Guild key item", names: "item" },
  "keys.doesntFit": { label: "Message when the key doesn't fit", long: true },
  "keys.coloured": {
    label: "Keyed doors",
    help: "Keys that open a matching door.",
    noun: "key",
  },
  "keys.coloured.[].key": { label: "Key", names: "item" },
  "keys.coloured.[].closed": { label: "Closed door", names: "item" },
  "keys.coloured.[].open": { label: "Open door", names: "item" },
  "keys.colouredPause": {
    label: "Pause after using a door key (frames)",
    help: "20 frames is a second.",
    more: true,
  },
  "keys.housePause": {
    label: "Pause after using a house key (frames)",
    help: "20 frames is a second.",
    more: true,
  },
  "keys.keysTxt": {
    label: "Key rules",
    help: "A key followed by :Inf is never used up.",
    noun: "rule",
    more: true,
  },
  "keys.keysTxt.[]": { label: "Rule" },

  // ---- switches ----
  "switches.on": { label: "On switch item", names: "item" },
  "switches.off": { label: "Off switch item", names: "item" },
  "switches.pause": {
    label: "Pause after a flip (frames)",
    help: "20 frames is a second.",
    more: true,
  },
  "switches.text": { label: "Message when not in front of it", long: true },

  // ---- doors closing again ----
  "relock.change": {
    label: "Doors close after (frames)",
    help: "Time from the last door opened. 20 frames is a second.",
  },
  "relock.closes": {
    label: "Doors that close again",
    noun: "door",
  },
  "relock.closes.[].0": { label: "Open", names: "item" },
  "relock.closes.[].1": { label: "Closed", names: "item" },

  // ---- containers ----
  "containers.clickPause": {
    label: "Pause after opening (frames)",
    help: "20 frames is a second.",
    more: true,
  },
  "containers.drop": {
    label: "Old container list",
    help: "No longer used: an item's behaviour now says if it's a container.",
    noun: "container",
    more: true,
  },
  "containers.drop.[].name": { label: "Name" },

  // ---- quest chests ----
  "questChest.odds": {
    label: "Chance a save refills one: 1 in",
    help: "Checked each time a player is saved.",
  },
  "questChest.saveBlock": {
    label: "Frames between saves",
    help: "20 frames is a second.",
    more: true,
  },
  "questChest.saveRoll": {
    label: "Chance of a save each frame after: 1 in",
    more: true,
  },
  "questChest.chests": {
    label: "Quest chests",
    help: "Each is equally likely to be picked; numbers go 1, 2, 3… in order.",
    noun: "chest",
  },
  "questChest.chests.[].roll": { label: "Number" },
  "questChest.chests.[].chest": { label: "Chest", names: "item" },
  "questChest.chests.[].source": {
    label: "Items it can get",
    help: "One is picked at random. Empty: never refilled.",
    noun: "item",
    names: "item",
  },
  "questChest.chests.[].source.[]": { label: "Item", names: "item" },
};
