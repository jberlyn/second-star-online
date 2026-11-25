/** Plain words for the `monsters` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

/** A row that picks monsters by name. */
const monsterName = {
  label: "Monster name",
  help: "The monster's name, or part of it.",
  names: "monster",
};

export const monstersWords: WordBook = {
  // Editor lists: which names the World Editor and NPC Editor offer.
  editorLists: {
    label: "Editor lists",
    help: "The monster and NPC names the World Editor and NPC Editor offer to place.",
  },
  "editorLists.worldEditor": { label: "World Editor" },
  "editorLists.worldEditor.monsters": {
    label: "Monster list",
    help: "Placed as monsters that walk toward players and attack them.",
    noun: "monster",
    names: "monster",
  },
  "editorLists.worldEditor.npcs": {
    label: "NPC list",
    help: "Placed as NPCs that leave players alone.",
    noun: "NPC",
    names: "npc",
  },
  "editorLists.npcEditor": { label: "NPC Editor" },
  "editorLists.npcEditor.monsters": {
    label: "Monster list",
    noun: "monster",
    names: "monster",
  },
  "editorLists.npcEditor.npcs": {
    label: "NPC list",
    help: "These appear less often than the monster list.",
    noun: "NPC",
    names: "npc",
  },

  // Rules: lists of monster names that behave a certain way.
  rules: {
    label: "Monster behaviour",
    help: "Which monsters behave in special ways, picked by name.",
  },
  "rules.*.pattern": monsterName,
  "rules.sea": {
    label: "Live in water",
    help: "These appear and move only on sea tiles.",
    noun: "monster",
  },
  "rules.footprint": {
    label: "Take up 3×2 tiles",
    help: "Big monsters that fill three tiles across and two down.",
    noun: "monster",
  },
  "rules.hostile": {
    label: "Always attack players",
    help: "These walk toward players even when they are not on the World Editor's monster list.",
    noun: "monster",
  },
  "rules.officer": {
    label: "Attack wanted players",
    help: "Guards that go after players who are wanted for crimes.",
    noun: "monster",
  },
  "rules.sparesInnocent": {
    label: "Leave innocent players alone",
    help: "These never attack a player who is innocent.",
    noun: "monster",
  },
  "rules.clearsBlock": {
    label: "Others can walk through",
    help: "These don't block the tile they stand on once they move.",
    noun: "monster",
  },
  "rules.killXp": {
    label: "Fixed kill XP",
    help: "XP a kill gives, in place of the monster's own XP.",
    noun: "monster",
  },
  "rules.killXp.[].xp": { label: "XP for the kill" },
  "rules.killBroadcasts": {
    label: "Announcement when killed",
    help: "A message everyone sees when one of these is killed.",
    noun: "announcement",
  },
  "rules.killBroadcasts.[].text": {
    label: "Message",
    help: "{} is replaced by the killer's name.",
  },
  "rules.namesSelf": {
    label: "Say their name when clicked",
    noun: "monster",
  },
  "rules.noQuests": {
    label: "Never give quests",
    noun: "monster",
  },

  // Casting: the spells monsters cast.
  casting: {
    label: "Monster spells",
    help: "The spells monsters can cast, and which monsters never cast.",
  },
  "casting.spells": {
    label: "Monster spells",
    help: "A monster casts one of these when its NPC file lists the spell's ID.",
    noun: "monster spell",
  },
  "casting.spells.[].tag": {
    label: "ID",
    help: "The name NPC files use to give a monster this spell.",
  },
  "casting.spells.[].name": {
    label: "Spell",
    help: "The spell picture and effect it sends.",
    names: "spell",
  },
  "casting.spells.[].kind": {
    label: "Where it lands",
    choices: {
      aimFirst: "Lands near the player",
      aimNoExit: "Lands near the player (even from a monster set to never cast)",
      dirAfterExits: "Flies out from the monster in a random direction",
      dirBeforeExits: "Flies out from the monster in a random direction (1.6's other roll order)",
      onPlayer: "Lands on the player",
      buff: "On the monster itself",
    },
  },
  "casting.spells.[].power": {
    label: "Power",
    help: "How strong the spell is when a monster casts it.",
  },
  "casting.spells.[].ladder": {
    label: "How often it casts: 1 in …",
    help: "One number for each player count, 1 to 7 players on the map. Bigger numbers mean less often.",
    noun: "step",
  },
  "casting.spells.[].ladder.[]": { label: "1 in" },
  "casting.spells.[].aName": {
    label: 'Messages call the caster "a" monster',
    help: 'As in "a Orc".',
  },
  "casting.neverCasts": {
    label: "Never cast spells",
    help: "These monsters never cast monster spells.",
    noun: "monster",
  },
  "casting.neverCasts.[].pattern": monsterName,

  // Melee affinities: weapons that do more or less damage to some monsters.
  meleeAffinities: {
    label: "Weapon bonuses",
    help: "Weapons that do more (or less) damage to certain monsters.",
    noun: "weapon bonus",
  },
  "meleeAffinities.[].weapon": {
    label: "Weapon name contains",
    help: 'Every weapon whose name contains this ("Sword").',
  },
  "meleeAffinities.[].weaponMatch": {
    label: "How the weapon is matched",
    choices: { contains: "Any name containing it" },
    more: true,
  },
  "meleeAffinities.[].monster": monsterName,
  "meleeAffinities.[].monsterMatch": {
    label: "How the monster is matched",
    choices: { exact: "Exactly this name", contains: "Any name containing it" },
  },
  "meleeAffinities.[].delta": {
    label: "Damage added",
    help: "Use a minus number to take damage away.",
  },
  "meleeAffinities.[].randomN": {
    label: "Plus a roll of 1 to",
    help: "0 for no roll.",
  },

  // Skill caps: how high a skill can rise from killing a monster.
  skillCaps: {
    label: "Skill training limits",
    help: "How high a player's skill can rise from killing a monster.",
  },
  "skillCaps.default": {
    label: "Normal limit",
    help: "For any monster without a row of its own.",
  },
  "skillCaps.byBody": {
    label: "Limit by monster look",
    help: "Monsters drawn with this body picture stop training at their own limit.",
    noun: "row",
  },
  "skillCaps.byBody.[].body": { label: "Body (picture number)" },
  "skillCaps.byBody.[].skillCap": { label: "Skill limit" },
  "skillCaps.intelligenceTiers": {
    label: "Extra for clever players",
    help: "Each row a player's Intelligence is above raises the limit.",
    noun: "row",
  },
  "skillCaps.intelligenceTiers.[].intelligenceGt": { label: "Intelligence above" },
  "skillCaps.intelligenceTiers.[].add": { label: "Raise the limit by" },

  // Generic: how an unknown monster name is drawn.
  generic: {
    label: "Unknown monsters",
    help: "How a monster with no entry of its own is drawn and fights, such as a player shop's shopkeeper.",
  },
  "generic.body": { label: "Body (picture number)" },
  "generic.hp": { label: "HP" },
  "generic.defense": {
    label: "Defense",
    help: "Taken off the damage of each melee hit on it.",
  },
};
