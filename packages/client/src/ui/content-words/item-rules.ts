/** Plain words for the `itemRules` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

/** The worn slots in 1.6's own naming (armour and breaks rows). */
const SLOT_VARS = {
  RingE: "Ring",
  HeadE: "Head",
  BodyE: "Body",
  RightHandE: "Weapon hand",
  LeftHandE: "Off hand",
  FeetE: "Feet",
};

/** The worn slots (gear and swing rows). */
const WORN = {
  head: "Head",
  body: "Body",
  weapon: "Weapon hand",
  offHand: "Off hand",
  feet: "Feet",
  ring: "Ring",
};

/** A skill-book formula: a number, or steps applied in order. */
const formula = (label: string, help: string) => ({
  label,
  help,
  shapes: ["A fixed number", "Worked out step by step"],
  noun: "step",
});

export const itemRulesWords: WordBook = {
  // Every rule row names items by name.
  "*.match": {
    label: "How the name is matched",
    choices: { exact: "Exactly this name", contains: "Any item whose name contains it" },
  },
  "*.pattern": { label: "Item", help: "The item's name, or the part of a name.", names: "item" },
  "*.slot": { label: "Slot", choices: { ...SLOT_VARS, ...WORN } },

  // What an item is (keys, books, chests, doors…).
  behaviours: {
    label: "Item behaviours",
    help: "Special things an item does; an item gets every behaviour a matching row gives it.",
    noun: "behaviour",
  },
  "behaviours.[].behaviour": {
    label: "Behaviour",
    choices: {
      key: "Key: opens the doors its name unlocks",
      book: "Book: reading teaches its spell or skill",
      bow: "Bow: shoots arrows from the off hand",
      crossbow: "Crossbow: a bow that also trains Martial Arts",
      hidesName: "Worn as armour, hides the wearer's name",
      chest: "Chest: opens on a click, never carried",
      map: "Drawn on the ground as a map",
      cabinet: "Cabinet: a container that needs 19 Strength to lift",
      windCabinet: "Drawn as the Wind Cabinet",
      crate: "Crate: a container that needs 15 Strength to lift",
      cauldron: "Cauldron: brews recipes as items go in",
      slotMachine: "Slot machine",
      blackjackTable: "Blackjack table",
      checkersTable: "Checkers table",
      highScoreStatue: "Shows the high scores",
      assassinStatue: "Shows the assassins' ranking",
      camera: "Camera: takes photos with film",
      film: "Film: used up by a photo",
      canvas: "Canvas: used up by a painting",
      newspaperKit: "Newspaper kit: dropped on a stand, becomes a newspaper",
      swingFireballs: "Every swing also throws a fireball",
      sword: "A sword (for the Firesword spell)",
      argonsFist: "Using it also casts Argon's Fist",
      releasesMonster: "Dropped, it becomes the monster of the same name",
      hidesHead: "Worn as armour, hides the hair",
      hidesHelm: "Worn as armour, hides the helmet",
      quiver: "Quiver: drawn on the wearer's back",
      hiddenFacingNorth: "Held in the off hand, not drawn facing north",
      door: "Door",
      switchDoor: "Door that switches open and close",
      clock: "Clock: shows the server's time",
      messageBoard: "Town message board",
      universalMail: "Mailbox anyone can use",
      guildCenter: "Guild center",
      personalVault: "Personal vault",
      noClick: "Clicking it does nothing",
      noCtrl: "Ctrl on it does nothing",
    },
  },

  // Tools and swing speed.
  tools: {
    label: "Tools",
    help: "What a tool can gather, and how fast it swings.",
    noun: "tool",
  },
  "tools.[].can": {
    label: "Can gather",
    choices: {
      Chop: "Chop trees",
      Mine: "Mine rock",
      Dig: "Dig",
      Fish: "Fish",
      Farm: "Farm",
      Water: "Water crops",
    },
  },
  "tools.[].tier": {
    label: "Tool tier",
    help: "Better tools have a higher tier (1 when left off).",
  },
  "tools.[].ladder": {
    label: "Swing speed",
    help: "The swing speed table (below) this tool uses.",
  },
  "tools.[].counter": {
    label: "Shared hit count",
    help: "Tools with the same name here share one count of hits.",
    more: true,
  },
  ladders: {
    label: "Swing speeds",
    help: "How fast a tool swings as a skill rises, by name.",
    noun: "swing speed",
  },
  "ladders.{}.skill": {
    label: "Skill",
    help: "The skill that speeds the swing; leave off for a fixed speed.",
    names: "skill",
  },
  "ladders.{}.steps": {
    label: "Steps",
    help: "The first step the skill is still below sets the delay.",
    noun: "step",
  },
  "ladders.{}.steps.[].below": {
    label: "While the skill is below",
    help: "Leave off for any skill.",
  },
  "ladders.{}.steps.[].delay": { label: "Delay between swings", help: "In 1/20ths of a second." },
  "ladders.{}.gearSpeedUp": {
    label: "Worn gear speeds it up",
    help: "Gear such as the Ring of Quickness takes time off this delay.",
  },

  // Requirements.
  requires: {
    label: "Requirements",
    help: "What a player needs before they can equip or use an item.",
    noun: "requirement",
  },
  "requires.[].on": { label: "Needed to", choices: { equip: "Equip it", use: "Use it" } },
  "requires.[].needs": {
    label: "Skill needed",
    help: 'A skill, or "level" for the character level.',
    names: "skill",
  },
  "requires.[].atLeast": { label: "At least" },
  "requires.[].text": { label: "Refusal message", help: "Said instead of the usual refusal." },

  // Equipping.
  "equip.strength": {
    label: "Strength to equip",
    help: "The Strength a player needs to equip an item; the last matching row counts.",
    noun: "row",
  },
  "equip.strength.[].strength": { label: "Strength needed" },
  "equip.slots": {
    label: "Where it is worn",
    help: "The slot an item is equipped in; the last matching row counts, else it can't be equipped.",
    noun: "row",
  },
  "equip.slots.[].slot": {
    label: "Slot",
    shapes: ["A slot", "Can't be equipped"],
    choices: {
      Head: "Head",
      Body: "Body",
      LeftHand: "Off hand",
      RightHand: "Weapon hand",
      Feet: "Feet",
      Ring: "Ring",
    },
  },
  "equip.twoHanded": { label: "Two-handed weapons", noun: "weapon" },
  "equip.classes": {
    label: "Only some classes",
    help: "Gear only characters of the listed classes may equip; the last matching row counts, and a +1 counts as its item. Leave off for every class.",
    noun: "row",
    more: true,
  },
  "equip.classes.[].classes": {
    label: "Classes (by code)",
    help: "The class codes, as the Classes tab lists them.",
    noun: "class",
    names: "class",
  },
  "equip.classes.[].classes.[]": { names: "class" },
  "equip.murder": {
    label: "Murderers only",
    help: "Items only a player marked as a murderer may equip.",
    more: true,
  },

  // Using.
  "use.silent": {
    label: "Use does nothing",
    help: "Using these says nothing and does nothing.",
    noun: "item",
    more: true,
  },
  "use.whenFull": {
    label: "Usable when full",
    help: "Items a stuffed player can still use (a healing potion, say), whatever the Game Rules page says a full stomach refuses.",
    noun: "item",
    more: true,
  },
  "use.books": {
    label: "Spell book Mysticism",
    help: "The Mysticism needed to read a spell book (1 when no row matches).",
    noun: "book",
  },
  "use.books.[].mysticism": { label: "Mysticism needed" },
  "use.skillBooks": {
    label: "Skill books",
    help: "Items that teach a skill when read; they are used up.",
    noun: "skill book",
  },
  "use.skillBooks.[].match": { hidden: true },
  "use.skillBooks.[].skill": { label: "Skill taught", names: "skill" },
  "use.skillBooks.[].points": formula("Skill points given", "How much the skill rises."),
  "use.skillBooks.[].xp": formula("XP given", "For a skill trained by XP."),
  "use.skillBooks.[].upTo": {
    label: "Never past",
    help: "The skill never rises past this by reading.",
  },
  "use.*.when": {
    label: "Only when",
    help: 'Conditions like "Mining > 20"; all must hold.',
    noun: "condition",
  },
  "use.*.op": {
    label: "What it does",
    choices: { set: "Sets it to", add: "Adds", subtract: "Takes off", multiply: "Multiplies by" },
  },
  "use.*.value": {
    label: "Amount",
    help: 'A number, a roll like "1 + random(5)", or a stat or skill name.',
    shapes: ["A number", "A roll", "A stat or skill"],
  },
  "use.usable": {
    label: "Usable items",
    help: 'Items that can be used; anything else says "You cannot use the …".',
    noun: "item",
  },
  "use.effects": {
    label: "Eating and drinking",
    help: "What using an item does to HP, SP or hunger.",
    noun: "effect",
  },
  "use.effects.[].stat": { label: "Changes", choices: { HP: "HP", SP: "SP", Hunger: "Hunger" } },
  "use.effects.[].flat": { label: "By a fixed amount" },
  "use.effects.[].randomN": { label: "Plus a roll of 1 to", help: "Leave off for no roll." },
  "use.messages": {
    label: "Use messages",
    help: "What a player is told when they eat, drink or read an item; the last matching row counts.",
    noun: "message",
  },
  "use.messages.[].text": { label: "Message", long: true },
  "use.messages.[].read": {
    label: "Is a book's reading text",
    help: "Ticked: shown when the book is read, not when something is eaten.",
    more: true,
  },
  "use.refusals": {
    label: "Can't-use messages",
    help: 'Said instead of "You cannot use the …".',
    noun: "message",
  },
  "use.refusals.[].text": { label: "Message", long: true },

  // Armour.
  "armour.rows": {
    label: "Armour",
    help: "How much worn armour changes the damage a hit does (below 0 takes damage off).",
    noun: "armour row",
  },
  "armour.rows.[].hitMe": {
    label: "Against players",
    help: "Change to a hit from another player.",
  },
  "armour.rows.[].hitMe2": {
    label: "Against monsters",
    help: "Change to a hit from a monster; leave off for none.",
  },
  "armour.elemental": {
    label: "Elemental armour",
    help: "Armour that guards against one weapon or one monster.",
    noun: "row",
  },
  "armour.elemental.[].handler": {
    label: "Guards against",
    choices: { HitMe: "A player's weapon", HitMe2: "A monster" },
  },
  "armour.elemental.[].trigger": {
    label: "Weapon or monster",
    help: 'The weapon\'s name, or the monster as "a Yeti".',
  },
  "armour.elemental.[].delta": { label: "Change to the damage" },
  "armour.spell": { label: "Spell defence" },
  "armour.spell.rows": {
    label: "Spell armour",
    help: "How much worn armour changes the damage a spell does to a player.",
    noun: "row",
  },
  "armour.spell.rows.[].delta": { label: "Change to the damage" },
  "armour.spell.magicShield": {
    label: "Magic Shield",
    help: "The change to spell damage while Magic Shield lasts.",
  },

  // Breaking.
  "breaks.armour": { label: "Armour breaking" },
  "breaks.weapon": { label: "Weapon breaking" },
  "breaks.*.excludedMonsters": {
    label: "Monsters that never break it",
    noun: "monster",
    names: "monster",
    more: true,
  },
  "breaks.armour.excludedMonsters.[]": { label: "Monster", names: "monster" },
  "breaks.weapon.excludedMonsters.[]": { label: "Monster", names: "monster" },
  "breaks.*.items": { label: "Items that can break", noun: "item" },
  "breaks.*.item": { label: "Item", names: "item" },
  "breaks.damaged": {
    label: "Damaged versions",
    help: "What an item becomes when it breaks; the last matching row counts.",
    noun: "row",
  },
  "breaks.damaged.[].damaged": { label: "Becomes", names: "item" },

  // Item menu button.
  menu: {
    label: "Item menu button",
    help: "The button shown in place of Equip; the last matching row counts.",
    noun: "row",
  },
  "menu.[].action": {
    label: "Button",
    choices: { Cook: "Cook", Mix: "Mix", Build: "Build", Smith: "Smith", Storage: "Storage" },
  },

  // Character picture.
  "paperdoll.aliases": {
    label: "Drawn as",
    help: "Draws an item on the character with another item's picture.",
    noun: "row",
  },
  "paperdoll.aliases.[].layer": {
    label: "Picture",
    choices: {
      weapon: "Weapon",
      shield: "Shield",
      helm: "Helmet",
      gloves: "Gloves",
      body: "Body armour",
    },
  },
  "paperdoll.aliases.[].becomes": { label: "Drawn as", help: "The picture's name.", names: "item" },

  // Items on the ground.
  "ground.blocks": {
    label: "Blocks walkers",
    help: "Items on the ground that players and monsters can't walk through.",
    noun: "item",
  },
  "ground.platforms": {
    label: "Skill platforms",
    help: "Items on the ground that block a player until a skill is high enough.",
    noun: "platform",
  },
  "ground.platforms.[].needs": {
    label: "Skill needed",
    help: 'A skill, or "level" for the character level.',
    names: "skill",
  },
  "ground.platforms.[].atLeast": { label: "At least" },
  "ground.overlays": {
    label: "Animations",
    help: "The animation drawn over an item on the ground; the first matching row counts.",
    noun: "row",
    more: true,
  },
  "ground.overlays.[].overlay": { label: "Animation code" },
  "ground.inUse": {
    label: "Animate only in use",
    help: "Crafting stations that animate only while someone crafts at them.",
    noun: "item",
    more: true,
  },
  "ground.layers": {
    label: "Drawing layer",
    help: "Where an item on the ground is drawn; the first matching row counts.",
    noun: "row",
    more: true,
  },
  "ground.layers.[].layer": {
    label: "Drawn",
    choices: {
      hidden: "Not drawn",
      overChars: "Over characters",
      overLayer3: "Over the top map layer",
    },
  },
  "ground.offsets": {
    label: "Picture nudge",
    help: "Moves an item's picture off the centre of its tile; the first matching row counts.",
    noun: "row",
    more: true,
  },
  "ground.offsets.[].dx": { label: "Pixels right" },
  "ground.offsets.[].dy": { label: "Pixels down" },
  "ground.tipless": {
    label: "No hover name",
    help: "Items on the ground the hover tip never names (map links, markers).",
    noun: "item",
  },
  "ground.tipNames": {
    label: "Hover names",
    help: "What the hover tip calls an item on the ground; the first matching row counts.",
    noun: "row",
  },
  "ground.tipNames.[].name": {
    label: "Shown as",
    help: "Replaces the whole name, or just the matched part.",
  },

  // Ctrl on fixtures.
  "pickup.ctrlTexts": {
    label: "Ctrl messages",
    help: "What Ctrl on a fixture says; the first matching row counts.",
    noun: "message",
  },
  "pickup.ctrlTexts.[].text": { label: "Message" },
  "pickup.ctrlTexts.[].unpause": {
    label: "Lets the player move again",
    more: true,
  },

  // Containers.
  "containers.capacity": {
    label: "Container sizes",
    help: "How many lines a container holds; the last matching row counts.",
    noun: "row",
  },
  "containers.capacity.[].capacity": { label: "Lines it holds" },
  "containers.defaultCapacity": {
    label: "Default container size",
    help: "Lines a container holds when no row matches.",
  },
  "containers.uniqueIds": {
    label: "Numbered containers",
    help: "Containers that get their own number when added to a bag, so each keeps its own contents.",
    noun: "container",
  },
  "containers.uniqueIds.[].match": { hidden: true },

  // Gear power.
  gear: {
    label: "Gear bonuses",
    help: "Power a worn item adds; every matching row adds.",
    noun: "bonus",
  },
  "gear.[].power": {
    label: "Adds to",
    choices: {
      spell: "Spell power",
      blackArts: "Black Arts power",
      martialArts: "Martial Arts power",
      attack: "Attack damage",
      killXp: "XP from kills",
    },
  },
  "gear.[].add": { label: "How much" },

  // Swing.
  "swing.cooldowns": {
    label: "Swing delays",
    help: "How long a worn item makes a player wait after a swing; the last matching row counts.",
    noun: "row",
  },
  "swing.cooldowns.[].atDelay": { label: "Wait to attack again", help: "In 1/20ths of a second." },
  "swing.cooldowns.[].actionDelay": {
    label: "Wait to do anything else",
    help: "In 1/20ths of a second.",
  },
  "swing.sounds": {
    label: "Swing sounds",
    help: "The sound a weapon makes when swung; the first matching row counts.",
    noun: "row",
  },
  "swing.sounds.[].sound": {
    label: "Sound",
    help: "Leave off for a silent swing.",
    names: "sound",
  },
};
