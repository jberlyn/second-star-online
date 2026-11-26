/** Plain words for the `social` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

/** The words of one of the game's messages kept in a `{ text }` box. */
const said = (label: string, help?: string): { label: string; help?: string } =>
  help ? { label, help } : { label };

const PERKS: Record<string, string> = {
  spellPower: "Extra spell power",
  melee: "Extra melee attack power",
  defence: "Less damage taken",
  skillCap: "Combat skill cap",
  mageCap: "Mage skill cap",
  regeneration: "Faster HP and SP regeneration",
  pvpParry: "Better parry against players",
  pvpBlock: "Better block against players",
  monsterDodge: "Better parry and block against monsters",
};

export const socialWords: WordBook = {
  // Notes on how the game uses a part, kept with the data: nothing in play reads them, so they
  // are kept as they are and not shown.
  "*.rule": { hidden: true },
  // Most of the game's messages: `{NAME}` and the like stand for the names they are built from.
  "*.text": { label: "Message", long: true },

  // ---- Factions (one row is one faction) ----
  "factions.key": {
    label: "Faction ID",
    help: "The faction's permanent name, which characters and maps save. Letters, digits, - and _, starting with a letter.",
  },
  "factions.name": { label: "Faction name", help: "The name players see." },
  "factions.leader": {
    label: "Leader",
    help: "The NPC players join with and hand heads to.",
    names: "npc",
  },
  "factions.head": {
    label: "Head item",
    help: "The item a member drops when killed on a PvP map, which rival leaders take.",
    names: "item",
  },
  "factions.member": {
    label: "Faction guard",
    help: "The monster a map's faction spawn puts there.",
    names: "monster",
  },
  "factions.startPower": {
    label: "Starting power",
    help: "The faction's power on a new server, before any is won or lost.",
  },
  "factions.bio": { label: "Bio line", help: "The faction line shown on a member's Bio." },
  "factions.perks": {
    label: "What members get",
    help: "Each perk's value by tier: the first number is tier 0, the next tier 1, and so on. A tier past the end uses the last number.",
    noun: "perk",
  },
  "factions.perks.[].kind": { label: "Perk", choices: PERKS },
  "factions.perks.[].values": { label: "Value by tier", noun: "tier" },
  "factions.joinHpMaxAbove": {
    label: "Max HP needed to join",
    help: "A player must have more max HP than this to join.",
  },
  "factions.joinCount": {
    label: "Loyalty time on joining",
    help: "How long a new member has before they must bring a rival's head, in 1/20ths of a second.",
  },
  "factions.rejoinAdds": {
    label: "Loyalty time per head",
    help: "Added to a member's loyalty time each time they bring a rival's head, in 1/20ths of a second.",
  },
  "factions.texts": { label: "What the leader says" },
  "factions.texts.join": { label: "Welcome", help: "When a player joins." },
  "factions.texts.weak": { label: "Too weak to join", help: "When a player's max HP is too low." },
  "factions.texts.rejoin": { label: "Thanks a member", help: "When a member brings another head." },
  "factions.texts.other": {
    label: "Invites an outsider",
    help: "When a member of another faction brings a head.",
  },
  "factions.texts.announce": {
    label: "Announcement",
    help: "Told to everyone when a member makes the faction stronger. {NAME} is the player.",
  },
  "factions.texts.announceOther": {
    label: "Announcement (new member)",
    help: "Told to everyone when an outsider makes the faction stronger. {NAME} is the player.",
  },
  "factions.exileHpMaxBelow": {
    label: "Exiled below max HP",
    help: "A member who dies and drops below this much max HP is thrown out.",
  },
  "factions.exileText": { label: "Exile message", long: true },
  "factions.loyalty": {
    label: "Loyalty warnings",
    help: "Messages as a member's loyalty time runs out; the last can throw them out.",
    noun: "warning",
  },
  "factions.loyalty.[].count": {
    label: "When time left reaches",
    help: "In 1/20ths of a second.",
  },
  "factions.loyalty.[].text": { label: "Message", long: true },
  "factions.loyalty.[].kick": { label: "Throws the member out" },

  // ---- Faction rules (shared by every faction) ----
  "factionRules.tiers": {
    label: "Tiers from power",
    help: "A stronger faction gives its members a higher tier, and so better perks.",
  },
  "factionRules.tiers.top": { label: "Top tier", help: "The tier at the highest power." },
  "factionRules.tiers.below": {
    label: "Lower tiers",
    help: "Each row whose power the faction is under sets the tier; the last such row wins.",
    noun: "tier",
  },
  "factionRules.tiers.below.[].below": { label: "Power under" },
  "factionRules.tiers.below.[].tier": { label: "Tier" },
  "factionRules.perkDefaults": {
    label: "Perks for everyone else",
    help: "The value of each perk for players outside a faction that gives it. Left out means 0.",
    noun: "perk",
    choices: PERKS,
  },
  "factionRules.perkDefaults.{}": { label: "Value" },
  "factionRules.editorBoxes": {
    label: "World Editor spawn boxes",
    help: "The factions the World Editor's three faction spawn boxes place, in box order.",
    noun: "faction",
    names: "faction",
  },
  "factionRules.loyaltyPerFrame": { label: "Loyalty countdown", more: true },
  "factionRules.headDrop": { label: "Dropping heads", more: true },
  "factionRules.exile": { label: "Exile", more: true },
  "factionRules.loginJoin": { label: "Faction chat at login", more: true },
  "factionRules.turnIn": { label: "Handing in a head" },
  "factionRules.turnIn.ownHead": {
    label: "Own member's head",
    help: "When a leader is given a head of their own faction. {NPC} is the leader.",
    long: true,
  },
  "factionRules.turnIn.rivalHead": {
    label: "Rival's head",
    help: "When a leader is given a rival's head. {NPC} is the leader.",
    long: true,
  },
  "factionRules.turnIn.missingPowers": {
    label: "Power when none is saved",
    help: "Kept from 1.6; the game uses each faction's starting power instead.",
    more: true,
  },
  "factionRules.sayFaction": {
    label: "Asking about the faction",
    help: "What a leader says when asked how strong the faction is. {NPC} is the leader.",
  },
  "factionRules.sayFaction.fine": { label: "In the middle", long: true },
  "factionRules.sayFaction.weak": { label: "Weakest", long: true },
  "factionRules.sayFaction.absolute": { label: "Strongest", long: true },

  // ---- Murder ----
  "murder.wanted": { label: "Wanted for murder", help: "Told to a killer. {NAME} is the victim." },
  "murder.pardoned": {
    label: "Pardoned",
    help: "Told to a pardoned murderer. {NAME} is the admin.",
  },
  "murder.pardoning": {
    label: "Pardoning",
    help: "Told to the admin who pardons. {NAME} is the murderer.",
  },
  "murder.flagRule": { label: "Who becomes a murderer", more: true },
  "murder.*.sender": { hidden: true },

  // ---- Quest replies ----
  "questReplies.give": { label: "Giving an item to an NPC" },
  "questReplies.give.thanks": {
    label: "Thanks",
    help: "When the NPC wanted the item. {NPC} is the NPC.",
    long: true,
  },
  "questReplies.give.sorry": {
    label: "Not wanted",
    help: "When the NPC does not want the item. {NPC} is the NPC.",
    long: true,
  },
  "questReplies.give.lines": {
    label: "Quest lines read",
    help: "How many quest lines the game looks through.",
    more: true,
  },
  "questReplies.oraku": {
    label: "Orb quest",
    help: "One NPC who takes a special item for a special reward. Turn it off to have none.",
  },
  "questReplies.oraku.npc": { label: "NPC", names: "npc" },
  "questReplies.oraku.item": { label: "Item they want", names: "item" },
  "questReplies.oraku.reward": { label: "Reward", names: "item" },
  "questReplies.oraku.text": {
    label: "What they say",
    help: "{NPC} is the NPC.",
    long: true,
  },
  "questReplies.say": { label: "Asking what an NPC wants" },
  "questReplies.say.bring": {
    label: "Wants something",
    help: "{NPC} is the NPC and {ITEM} the item.",
    long: true,
  },
  "questReplies.say.nothing": { label: "Wants nothing", help: "{NPC} is the NPC.", long: true },

  // ---- Assassin's Game ----
  "assassin.commands": { label: "Starting and ending", more: true },
  "assassin.start": { label: "Game start announcements" },
  "assassin.start.normal": { label: "Normal game", noun: "line" },
  "assassin.start.lightning": {
    label: "Lightning game",
    help: "One hit kills and there are no death penalties.",
    noun: "line",
  },
  "assassin.score": { label: "Points" },
  "assassin.score.text": {
    label: "Points message",
    help: "Told to everyone on a kill. {NAME} is the killer and {POINTS} the points.",
    long: true,
  },
  "assassin.score.lightningPoints": {
    label: "Points per Lightning kill",
    help: "In a Lightning game every kill is worth this.",
  },
  "assassin.score.tableSize": { label: "Players on the score table" },
  "assassin.rating": {
    label: "Combat rating",
    help: "Max HP plus these skills; it sets how many points a kill is worth.",
  },
  "assassin.rating.skills": { label: "Skills counted", noun: "skill", names: "skill" },
  "assassin.compare": {
    label: "Points per kill",
    help: "Bands from lowest rating up: the first band the rating is under sets the points.",
  },
  "assassin.compare.stronger": {
    label: "Killing a weaker player",
    help: "Picked by the victim's rating.",
    noun: "band",
  },
  "assassin.compare.weaker": {
    label: "Killing a stronger player",
    help: "Picked by the killer's rating.",
    noun: "band",
  },
  "assassin.compare.stronger.[].below": { label: "Rating under" },
  "assassin.compare.stronger.[].points": { label: "Points" },
  "assassin.compare.weaker.[].below": { label: "Rating under" },
  "assassin.compare.weaker.[].points": { label: "Points" },
  "assassin.end": {
    label: "Game end announcements",
    help: "Four lines, in order: the end, the winner, second and third, and a farewell. {W1}, {W2}, {W3} are the winners and {POINTS} the winner's points.",
  },
  "assassin.end.lines": { label: "Lines", noun: "line" },
  "assassin.prizes": { label: "Prizes", more: true },
  "assassin.prizes.archived": { hidden: true },
  "assassin.prizes.awarded": { label: "Places that win a prize" },
  "assassin.statue": { label: "Assassin Statue", help: "The statue that shows the top assassins." },
  "assassin.statue.item": { label: "Statue item", names: "item" },
  "assassin.statue.text": { label: "Looking at it", long: true },
  "assassin.statue.pause": {
    label: "Wait after looking",
    help: "How long before the player can use another item.",
  },
  "assassin.statue.allTimeHeader": { label: "All-time heading" },
  "assassin.statue.currentHeader": { label: "Current game heading" },
  "assassin.statue.entry": {
    label: "Each entry",
    help: "{N} is the place, {NAME} the player and {POINTS} their points.",
  },
  "assassin.statue.separator": { label: "Between entries", more: true },
  "assassin.statue.perLine": { label: "Entries per line", more: true },

  // ---- High Score Statue ----
  "highScores.item": { label: "Statue item" },
  "highScores.item.text": {
    label: "Item name",
    help: "The item that shows the high scores.",
    names: "item",
    long: false,
  },
  "highScores.text": { label: "Looking at it", long: true },
  "highScores.pause": {
    label: "Wait after looking",
    help: "How long before the player can use another item.",
  },
  "highScores.header": { label: "Heading" },
  "highScores.entry": {
    label: "Each entry",
    help: "{N} is the place, {NAME} the player and {POINTS} their score.",
  },
  "highScores.perLine": { label: "Entries per line", more: true },
  "highScores.separator": { label: "Between entries", more: true },
  "highScores.tableSize": { label: "Players on the table" },
  "highScores.oneSaveIn": { hidden: true },

  // ---- Guilds ----
  "guilds.texts": {
    label: "Messages",
    help: "{NAME} is a player, {GUILD} the guild and {LEADER} its leader.",
  },
  "guilds.texts.notInFront": said("Not standing at the guild center"),
  "guilds.texts.taken": said("Name already taken"),
  "guilds.texts.created": said("Guild created"),
  "guilds.texts.hail": said("Greeting a guildmate"),
  "guilds.texts.kicked": said("Kicked out"),
  "guilds.texts.disbanded": said("Guild disbanded"),
  "guilds.texts.sending": said("Sending an invitation"),
  "guilds.texts.notLeader": said("Not a guild leader"),
  "guilds.texts.alreadyIn": said("Already in a guild"),
  "guilds.texts.invited": said("Invitation received"),
  "guilds.texts.accepted": said("Invitation accepted"),
  "guilds.texts.rejected": said("Invitation rejected"),
  "guilds.texts.declined": said("Invitation declined (to the leader)"),
  "guilds.texts.joined": said("Member joined"),
  "guilds.texts.quitting": said("Quitting"),
  "guilds.texts.quit": said("Member quit"),
  "guilds.texts.exiled": said("Member exiled"),
  "guilds.texts.abdicating": said("Handing over leadership"),
  "guilds.texts.promoted": said("New leader", "{TARGET} is the new leader."),
  "guilds.texts.notMember": said("Not a member of this guild"),
  "guilds.texts.noGuild": said("Not in any guild"),
  "guilds.texts.chat": said("Guild chat line", "{TEXT} is what was said."),
  "guilds.sanitiser": {
    label: "Cleaning up guild names",
    help: "Characters taken out of a new guild's name.",
  },
  "guilds.sanitiser.strip": { label: "Characters removed", noun: "character" },
  "guilds.sanitiser.scan": {
    label: "Name length checked",
    help: "How many characters of the name are cleaned.",
    more: true,
  },
  "guilds.defaultName": {
    label: "Suggested guild name",
    help: "Filled in when a player opens the guild center to make a guild.",
  },
  "guilds.alignments": { label: "Alignments", more: true },
  "guilds.listMax": { label: "Most guilds listed", help: "How many guilds the guild list shows." },
  "guilds.memberLines": {
    label: "Member list lines",
    help: "The first and last lines of a guild's file that hold its members.",
    more: true,
  },

  // ---- Chat ----
  "chat.texts": { label: "Messages", help: "{NAME} is a player and {TEXT} what they wrote." },
  "chat.texts.imEcho": said("Your own instant message"),
  "chat.texts.imLine": said("A line in an IM window"),
  "chat.texts.imTitle": said("IM window title"),
  "chat.texts.imSendTitle": said("Send IM window title"),
  "chat.texts.awayTitle": said("Away message window title"),
  "chat.texts.awayOn": said("Away message turned on"),
  "chat.texts.awayOff": said("Away message turned off"),
  "chat.texts.awayLog": said("A line in the away log"),
  "chat.texts.roomWindowTitle": said("Chat room window title"),
  "chat.texts.roomLine": said("A line in a chat room"),
  "chat.texts.noGuild": said("Guild chat without a guild"),
  "chat.texts.ignoreAdded": said("Added to ignore list", "{TEXT} is the name."),
  "chat.texts.ignoreRemoved": said("Removed from ignore list", "{TEXT} is the name."),
  "chat.texts.ignoreListHeader": said("Ignore list heading"),
  "chat.texts.logging": said("Saving the chat log"),
  "chat.rooms": { label: "Chat rooms", help: "The rooms on the Game menu.", noun: "room" },
  "chat.rooms.[].key": {
    label: "Room",
    choices: {
      general: "General Chat",
      newPlayer: "New Player Chat",
      tradingPost: "Trading Post Chat",
      guild: "Guild Chat",
      admin: "Admin Chat",
    },
  },
  "chat.rooms.[].handler": { label: "Menu command", help: "Kept from 1.6.", more: true },
  "chat.rooms.[].group": { label: "Channel name", help: "Kept from 1.6.", more: true },
  "chat.rooms.[].title": {
    label: "Window title",
    help: "{GUILD} is the player's guild.",
  },
  "chat.rooms.[].entering": {
    label: "Entering message",
    help: "Shown on entering the room. {GUILD} is the player's guild.",
  },
  "chat.windows": { label: "Window sizes", more: true },
  "chat.windows.chatIgnoreLines": {
    label: "1.6's chat ignore list size",
    help: "Kept from 1.6; the whole ignore list is now checked.",
  },
  "chat.windows.imIgnoreLines": {
    label: "1.6's IM ignore list size",
    help: "Kept from 1.6; the whole ignore list is now checked.",
  },
  "chat.windows.unignoreScan": {
    label: "1.6's unignore search",
    help: "Kept from 1.6; every matching name is now removed.",
  },
  "chat.windows.returnScan": { label: "Online names searched for replies" },

  // ---- Buddies ----
  "buddies.texts": { label: "Messages", help: "{NAME} is the friend." },
  "buddies.texts.added": said("Friend added"),
  "buddies.texts.already": said("Already a friend"),
  "buddies.texts.removed": said("Friend removed"),
  "buddies.texts.notOn": said("Not on the list"),
  "buddies.texts.title": said("Friends window title"),
  "buddies.windowLines": {
    label: "Friends window lines",
    help: "How many lines of the Friends window are searched.",
    more: true,
  },
  "buddies.entryNames": {
    label: "Online names checked at login",
    help: "How many online players are checked for friends when a player logs in.",
    more: true,
  },

  // ---- Bios ----
  "bios.texts": { label: "Bio window words" },
  "bios.texts.viewBio": said("Opening a Bio"),
  "bios.texts.loadingProfile": said("Loading a profile"),
  "bios.texts.windowTitle": said("Window title"),
  "bios.texts.leader": said("Guild leader line", "{GUILD} is the guild."),
  "bios.texts.member": said("Guild member line", "{GUILD} is the guild."),
  "bios.texts.murderer": said("Murderer line"),
  "bios.texts.name": said("Name line", "{TEXT} is the name."),
  "bios.texts.class": said("Class line", "{TEXT} is the class."),
  "bios.texts.sex": said("Sex line", "{TEXT} is the sex."),
  "bios.texts.score": said("Score line", "{TEXT} is the score."),
  "bios.texts.tree": said("Disguised as a tree", "Shown instead of the name."),
  "bios.texts.robe": said("Wearing the invisibility robe", "Shown instead of the name."),
  "bios.texts.male": { label: "Male (no longer used)", more: true },
  "bios.texts.female": { label: "Female (no longer used)", more: true },
  "bios.firstTitle": { label: "Title for beginners", help: "Before any title below applies." },
  "bios.titles": {
    label: "Titles",
    help: "A title applies when every skill test holds (and, with classes listed, the character is in one); the last one that applies wins.",
    noun: "title",
  },
  "bios.titles.[].tests": { label: "Skills needed", noun: "skill" },
  "bios.titles.[].classes": {
    label: "Only for classes",
    help: "Class numbers: the title applies only to characters in one of them. Leave off for any class.",
    noun: "class",
    names: "class",
  },
  "bios.classLine": {
    label: "The Class line shows",
    help: "1.6 showed a title worked out from skills, never the class itself.",
    choices: {
      title: "The title (1.6)",
      class: "The character's class",
      both: "Both: class, then title",
    },
  },
  "bios.titles.[].tests.[].over": { label: "Above" },
  "bios.titles.[].title": { label: "Title" },
  "bios.score": { label: "Score" },
  "bios.score.counted": {
    label: "Skills counted",
    help: "A player's score adds these up (HPmax and SPmax count max HP and SP).",
    noun: "skill",
    names: "skill",
  },
  "bios.lastName": { label: "Last name (unused)", help: "Kept from 1.6; never shown.", more: true },
  "bios.disguise": { label: "Disguises" },
  "bios.disguise.treeMember": {
    label: "Tree body",
    help: "A player with this body shows as a tree.",
    more: true,
  },
  "bios.disguise.robeItem": {
    label: "Invisibility robe",
    help: "A player wearing this item hides their name.",
    names: "item",
  },
  "bios.medalStrip": { label: "Medal strip", help: "How the medals are drawn.", more: true },
  "bios.medalStrip.slots": { label: "Medal spaces" },
  "bios.medalStrip.items": { label: "Medals checked" },
  "bios.medalStrip.slotWidth": { label: "Space width (pixels)" },
  "bios.medalStrip.blankMember": { label: "Empty space picture" },
  "bios.medalStrip.stripMember": { label: "Strip picture" },
  "bios.profile": { label: "Profile" },
  "bios.profile.alerts": { label: "Refused characters" },
  "bios.profile.alerts.:": said("Profile has a :"),
  "bios.profile.alerts./": said("Profile has a /"),

  // ---- Medals ----
  "medals.awards": {
    label: "Medals",
    help: "A skill at 90 or more earns its medal: it shows on the Bio and adds its stats.",
    noun: "medal",
  },
  "medals.awards.[].skill": { label: "Skill", names: "skill" },
  "medals.awards.[].id": { label: "Medal number", help: "Its picture on the Bio." },
  "medals.awards.[].text": { label: "Award message", long: true },
  "medals.awards.[].member": { label: "Picture number", more: true },
  "medals.awards.[].stats": {
    label: "Stats added",
    help: "Name each stat: str, sta, dex, int or wis.",
    noun: "stat",
    choices: {
      str: "Strength",
      sta: "Stamina",
      dex: "Dexterity",
      int: "Intelligence",
      wis: "Wisdom",
    },
  },
  "medals.awards.[].stats.{}": { label: "Amount" },

  // ---- Mail ----
  "mail.texts": { label: "Messages", help: "Where a message has {NAME}, it is the sender." },
  "mail.texts.notInFront": said("Not standing at the mailbox"),
  "mail.texts.notYours": said("Someone else's mailbox"),
  "mail.texts.checking": said("Checking mail"),
  "mail.texts.sending": said("Sending mail"),
  "mail.texts.newMail": said("New mail arrived"),
  "mail.texts.reply": said("Reply subject", "{TEXT} is the original subject."),
  "mail.texts.tooMany": said("Too many recipients"),

  // ---- Message boards ----
  "boards.texts": { label: "Messages" },
  "boards.texts.view": said("Reading a board"),
  "boards.texts.notInFront": said("Not standing at the board"),
  "boards.texts.notMember": said("Another guild's board"),
  "boards.texts.empty": said("Posting nothing"),
  "boards.texts.from": said("Post author line", "{NAME} is the author."),
  "boards.rule": { label: "Line between posts", help: "Drawn between one post and the next." },
  "boards.townSquare": {
    label: "Town board name",
    help: "The name of the board everyone can read.",
  },

  // ---- Paintings and photos ----
  "art.texts": { label: "Messages", help: "{NAME} is the item." },
  "art.texts.paintFull": said("Bag full (painting)"),
  "art.texts.paintSaving": said("Saving a painting"),
  "art.texts.photoFull": said("Bag full (photo)"),
  "art.texts.photoSaving": said("Saving a photo"),
  "art.texts.saved": said("Saved"),
  "art.texts.viewPhoto": said("Looking at a photo"),
  "art.texts.viewItem": said("Looking at a painting"),
  "art.texts.author": said("Author line", "{NAME} is the artist."),
  "art.texts.needCamera": said("No camera"),
  "art.texts.noPicture": said("Photos not allowed here"),
  "art.texts.notInFront": said("Not standing in front of it"),
  "art.lens": {
    label: "Camera viewfinder",
    help: "Where on screen a photo can be taken, in pixels.",
    more: true,
  },
  "art.lens.hMin": { label: "Left edge" },
  "art.lens.hMax": { label: "Right edge" },
  "art.lens.vMin": { label: "Top edge" },
  "art.lens.vMax": { label: "Bottom edge" },
  "art.tools": { label: "Paint brushes", help: "The four brush sizes.", noun: "brush", more: true },
  "art.tools.[].blends": {
    label: "Strength of each stroke",
    help: "From 1 (faint) to 255 (solid).",
    noun: "stroke",
  },
  "art.tools.[].rects": { label: "Brush shapes", noun: "shape" },
  "art.shade": {
    label: "Darken and lighten",
    help: "How much the darken and lighten brushes change a spot.",
    more: true,
  },
  "art.shade.centre": { label: "Middle" },
  "art.shade.arm": { label: "Edges" },

  // ---- Newspaper ----
  "newspaper.view": said("Reading the newspaper"),
  "newspaper.notInFront": said("Not standing at the stand"),
  "newspaper.saved": said("Newspaper saved"),
  "newspaper.noStand": said("Can't place a stand here"),
  "newspaper.standTile": {
    label: "Stand tile",
    help: "The map tile that is a newspaper stand.",
    more: true,
  },
  "newspaper.standTile.text": { label: "Tile" },
  "newspaper.suffix": said(
    "After the author's name",
    "Makes the paper's name, such as \"Jo's Newspaper\".",
  ),
  "newspaper.suffix.text": { label: "Text" },
  "newspaper.defaults": {
    label: "Blank newspaper",
    help: "What the newspaper editor shows before anything is written.",
  },
  "newspaper.defaults.title": { label: "Title" },
  "newspaper.defaults.photoName": { label: "Photo caption" },
  "newspaper.defaults.photo3": { label: "Third photo", more: true },
};
