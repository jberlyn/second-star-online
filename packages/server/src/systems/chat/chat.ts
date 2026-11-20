/**
 * Chat.
 *
 * The client sends the raw typed line; the server parses it with the original grammar
 * (shared/rules/chat/chat.ts), stamps the speaker, enforces the cooldowns and the house and jail
 * rules, and delivers to the right audience. Event-driven: a line is handled when it arrives;
 * the cooldown counters count down in the tick.
 *
 * Handled here: local say, `/me`, broadcast, `/help`, `who`, the bank (`/balance`, `/deposit`,
 * `/withdraw`), the operators' `/spawn`, `-` staff chat and the admin commands
 * (systems/admin/commands.ts), `/g`, `/invite`, ACCEPT and REJECT (systems/social/guilds.ts),
 * `/msg` (im.ts), `/ignore`, `/unignore`, `/ignorelist` (ignore.ts) and the ignore filter on say,
 * `/me` and broadcasts; the client saves `/logchat` itself. Every line a player writes to others
 * is logged (log.ts), refused or not; commands and `Password=` are not. Every other command of the original
 * grammar is recognised and dropped.
 */
import {
  asksAboutFaction,
  asksAboutTreasure,
  asksForQuest,
  broadcastRefusal,
  CHAT_COLOR,
  CHAT_TEXT,
  can,
  chatRefusal,
  formatBroadcast,
  formatEmote,
  formatSay,
  heardSqa,
  isJailMap,
  isStaff,
  lingoWord,
  PASSWORD_MAX,
  PASSWORD_TEXT,
  parseChatLine,
  type Rng,
  type ServerMsg,
  sayRefusedInHouse,
  staffChatText,
  taggedName,
  unknownCommandText,
  whoCountLine,
} from "@secondstaronline/shared";

import {
  type AdminDeps,
  handleAdmin,
  staffChat,
  warpscriptOnBroadcast,
} from "../admin/commands.ts";
import { dropText, handleDrop } from "../admin/drop.ts";
import { handleRoster } from "../admin/roster.ts";
import { handleSpawn } from "../admin/spawn.ts";
import { challenge, quitArena } from "../combat/arena.ts";
import { sayTreasure } from "../crafting/gather.ts";
import { bankChat } from "../economy/intents.ts";
import { askForQuest } from "../economy/quests.ts";
import type { ItemCtx } from "../inventory/items.ts";
import { askFactionPower } from "../social/factions.ts";
import { friendsCommand } from "../social/friends.ts";
import { guildAnswer, guildChat, guildInvite } from "../social/guilds.ts";
import { whoNames } from "../social/presence.ts";
import type { Outgoing, Player, World, WorldMap } from "../world/world.ts";
import { hears, ignoreCommand } from "./ignore.ts";
import { msgCommand } from "./im.ts";
import { audienceCounts, logChat } from "./log.ts";
import { broadcastWait, chatWait, silenced } from "./speech.ts";

export interface ChatDeps {
  /** Setting `chatMaxChars`. */
  maxChars: number;
  /** Setting `broadcastCooldown`, in frames (original 1000). */
  broadcastCooldownFrames: number;
  /** Setting `chatCooldown`, in frames. */
  chatCooldownFrames: number;
  /** The lines of a help file by the name `gethelp` sent, or null if there is none. */
  helpLines(topic: string): readonly string[] | null;
  /** Writes a map's roster slots after an operator command. */
  saveSlots?(map: WorldMap): void;
  /** The item context for `/drop`. */
  itemCtx?(): ItemCtx;
  /** The admin commands' database, kicks and saves. */
  admin?: AdminDeps;
  /** The sim's rolls (the rumour NPCs' `random(2)`). */
  rng?: Rng;
  /** A map's header (field 17), "" when it has none or does not exist. */
  mapHeader?(map: string): string;
  /**
   * The player shop command in a said line, run and written: `ran` when the line was one, even one
   * the client dropped silently.
   */
  shop?(p: Player, typed: string): { ran: boolean; out: Outgoing[] };
  /** Writes an account's ignore list. */
  saveIgnores?(accountId: string, list: readonly string[]): void;
  /** Writes an account's buddy list. */
  saveBuddies?(accountId: string, items: readonly string[]): void;
  /**
   * Hashes a new password into the account (`Password=`). The caller replies to the player once the
   * hash is stored, or says it failed; a failure leaves the old password.
   */
  changePassword?(p: Player, password: string): void;
}

type ChatLine = Extract<ServerMsg, { t: "chat" }>;

const line = (text: string, color: number = CHAT_COLOR.normal): ChatLine => ({
  t: "chat",
  text,
  color,
});

/** Handles one typed line from `p`. */
export function handleChat(world: World, p: Player, raw: string, deps: ChatDeps): Outgoing[] {
  const typed = raw.slice(0, deps.maxChars);
  const parsed = parseChatLine(typed);
  if (!parsed) {
    return [];
  }
  let cmd = parsed;
  if (cmd.kind === "staffChat") {
    // A muted staff member is silenced here too (staff chat is not a way round a mute).
    const hush = isStaff(p.role) ? silenced(p, "staff") : null;
    if (hush) {
      logChat(world, p, "staff", staffChatText(cmd.typed), hush.outcome);
      return [{ to: p.id, msg: line(hush.text) }];
    }
    const outcome = isStaff(p.role) ? "delivered" : "denied";
    logChat(world, p, "staff", staffChatText(cmd.typed), outcome);
    return staffChat(world, p, cmd.typed);
  }
  // A command the typist may not use gets the same reply as one that does not exist (1.6 swallowed
  // its own staff commands and said the others aloud, giving them away).
  const unknown = (): Outgoing[] => [
    {
      to: p.id,
      msg: { ...line(unknownCommandText(lingoWord(typed, 1))), restore: typed },
    },
  ];
  if (cmd.kind === "unknown") {
    return unknown();
  }
  if (cmd.kind === "admin") {
    if (!can(p.role, cmd.cmd)) {
      return unknown();
    }
    return deps.admin ? handleAdmin(world, p, cmd.cmd, cmd.w2, cmd.line, deps.admin) : [];
  }
  if (
    (cmd.kind === "drop" || cmd.kind === "spawn" || cmd.kind === "roster") &&
    !can(p.role, cmd.kind)
  ) {
    return unknown();
  }
  if (cmd.kind === "drop") {
    const room = world.rooms.get(p.map.name);
    if (!room || !deps.itemCtx) {
      return [];
    }
    const before = world.groundLog.length;
    const out = handleDrop(deps.itemCtx(), room, p, cmd.item);
    // Every admin action is audited: the pile as it landed.
    for (const e of world.groundLog.slice(before)) {
      if (e.add) {
        deps.admin?.audit({
          actor: p.accountId,
          command: "/drop",
          target: p.map.name,
          after: { item: dropText(e.add), x: e.add.x, y: e.add.y },
        });
      }
    }
    return out;
  }
  if (cmd.kind === "bank") {
    return bankChat(world.npcs, p, cmd.text);
  }
  if (cmd.kind === "spawn") {
    if (can(p.role, "spawn") && deps.itemCtx) {
      const r = handleSpawn(world, p, cmd.args, deps.itemCtx().rng);
      if (r.changed) {
        deps.saveSlots?.(r.changed);
        deps.admin?.audit({
          actor: p.accountId,
          command: "/spawn",
          target: r.changed.name,
          after: cmd.args,
        });
      }
      return r.out;
    }
    return [];
  }
  if (cmd.kind === "guildAnswer") {
    // With no invitation pending the line falls through to local chat.
    const r = guildAnswer(world, p, cmd.accept);
    if (r) {
      return r;
    }
    cmd = { kind: "say", text: cmd.say };
  }
  if (cmd.kind === "roster") {
    if (can(p.role, "roster")) {
      const r = handleRoster(world, p, cmd.args);
      if (r.changed) {
        deps.saveSlots?.(r.changed);
        deps.admin?.audit({
          actor: p.accountId,
          command: "/roster",
          target: r.changed.name,
          after: cmd.args,
        });
      }
      return r.out;
    }
    return [];
  }
  switch (cmd.kind) {
    case "unbuilt":
      return [];
    case "arenaChallenge":
      // Nothing is said aloud and no cooldown is charged (1.6 left before the ordinary say
      // routine).
      return deps.rng ? challenge(world, p, deps.rng) : [];
    case "arenaQuit":
      return deps.rng ? quitArena(world, p, deps.rng) : [];
    case "password": {
      // Nothing is said aloud or relayed, and the typed line is not echoed (1.6 put the new
      // password into the chat; SSO never shows it).
      // A line longer than the chat cap is refused rather than cut: a cut line would store a
      // shorter password than the one typed.
      if (cmd.password === "" || cmd.password.length > PASSWORD_MAX || raw.length > deps.maxChars) {
        return [{ to: p.id, msg: line(PASSWORD_TEXT.refused) }];
      }
      deps.changePassword?.(p, cmd.password);
      return [];
    }
    case "guildChat":
      return guildChat(world, p, cmd.text, typed, deps.chatCooldownFrames);
    case "guildInvite":
      return guildInvite(world, p, cmd.name);
    case "help":
      return helpReply(p, cmd.topic, deps);
    case "who":
      return whoReply(world, p);
    case "msg":
      return msgCommand(world, p, cmd.text, typed, deps);
    case "ignore":
    case "unignore":
    case "ignoreList":
      return ignoreCommand(world, p, cmd, (id, list) => deps.saveIgnores?.(id, list));
    case "friends":
      // The field is cleared whatever word 2 is.
      return friendsCommand(world, p, cmd.friends, (id, items) => deps.saveBuddies?.(id, items));
    case "say":
    case "emote": {
      // The house rule applies to plain talk, `/me` and shop commands alike: a shop is run from
      // where you can talk to its keeper.
      const houseRefused = sayRefusedInHouse(p.map.name, p.y);
      // A shop command is handled before the line is said and is never said aloud, so it costs no
      // chat cooldown (1.6 said it to the room first, and ran it even where talk was refused).
      if (cmd.kind === "say" && deps.shop && !houseRefused) {
        const s = deps.shop(p, typed);
        if (s.ran) {
          return s.out;
        }
      }
      const channel = cmd.kind;
      const hush = silenced(p, channel);
      if (hush) {
        logChat(world, p, channel, cmd.text, hush.outcome, p.map.name);
        return [{ to: p.id, msg: line(hush.text) }];
      }
      const refused = chatRefusal(chatWait(p));
      if (refused) {
        logChat(world, p, channel, cmd.text, "cooldown", p.map.name);
        return [{ to: p.id, msg: { ...line(refused), restore: typed } }];
      }
      // A plain line asking for a quest, about treasure or about faction power also asks the NPCs
      // on screen, in that order and even when the house rule stops the line itself; `/me` never
      // does.
      const rumours = (): Outgoing[] => {
        if (cmd.kind !== "say") {
          return [];
        }
        return [
          ...(asksForQuest(typed) ? askForQuest(world, p) : []),
          ...(deps.rng && deps.mapHeader && asksAboutTreasure(typed)
            ? sayTreasure(world, p, deps.rng, deps.mapHeader)
            : []),
          ...(asksAboutFaction(typed) ? askFactionPower(world, p) : []),
        ];
      };
      if (houseRefused) {
        // A refused line still costs the cooldown: it is logged and can rouse the NPCs, so
        // without one it could be sent as fast as the connection allows.
        p.chatIn = deps.chatCooldownFrames;
        logChat(world, p, channel, cmd.text, "house", p.map.name);
        return [{ to: p.id, msg: line(CHAT_TEXT.houseRefused) }, ...rumours()];
      }
      p.chatIn = deps.chatCooldownFrames;
      // The role tag (setting `roleTags`) goes before the name; the ignore lists still go by name.
      const shown = taggedName(p.name, p.role, world.roleTags);
      const text = cmd.kind === "say" ? formatSay(shown, cmd.text) : formatEmote(shown, cmd.text);
      const said = toMap(world, p, text);
      const audience = world.rooms.get(p.map.name)?.players ?? [p];
      logChat(world, p, channel, cmd.text, "delivered", p.map.name, {
        ...audienceCounts(p, audience, said, text),
      });
      return [...said, ...rumours()];
    }
    case "broadcast": {
      const hush = silenced(p, "broadcast");
      if (hush) {
        logChat(world, p, "broadcast", cmd.text, hush.outcome);
        return [{ to: p.id, msg: line(hush.text) }];
      }
      const refused = broadcastRefusal(broadcastWait(p));
      if (refused) {
        logChat(world, p, "broadcast", cmd.text, "cooldown");
        // The original exits without clearing the input.
        return [{ to: p.id, msg: { ...line(refused), restore: typed } }];
      }
      // The cooldown starts before the jail check, so a failed shout still costs it.
      p.broadcastIn = deps.broadcastCooldownFrames;
      if (isJailMap(p.map.name)) {
        logChat(world, p, "broadcast", cmd.text, "jail");
        return [{ to: p.id, msg: line(CHAT_TEXT.jailShout) }];
      }
      const text = formatBroadcast(taggedName(p.name, p.role, world.roleTags), cmd.text);
      // Each reader's ignore list drops it by the speaker (word 1).
      const out: Outgoing[] = [...world.players.values()]
        .filter((o) => hears(o, p.name))
        .map((o) => ({ to: o.id, msg: line(text, CHAT_COLOR.broadcast) }));
      logChat(world, p, "broadcast", cmd.text, "delivered", null, {
        ...audienceCounts(p, [...world.players.values()], out, text),
      });
      // Staff `/warpscript` checks the broadcast message content (not the speaker name or wrapper).
      if (deps.admin) {
        out.push(...warpscriptOnBroadcast(world, p, cmd.text, deps.admin));
      }
      return out;
    }
  }
}

/**
 * A `sqa` line to everyone on the speaker's map, the speaker included (an assumption: the archive
 * does not say, and SMUS echoes to the sender), but those whose ignore list holds the speaker.
 */
function toMap(world: World, p: Player, text: string): Outgoing[] {
  const room = world.rooms.get(p.map.name);
  const members = room ? room.players : [p];
  return members
    .filter((o) => hears(o, p.name))
    .map((o) => ({ to: o.id, msg: line(heardSqa(text, o.map.name, o.y)) }));
}

/** The `who` reply, from the main input or a room's. */
export function whoReply(world: World, p: Player): Outgoing[] {
  const names = whoNames(world);
  return [
    { to: p.id, msg: line(whoCountLine(names.length)) },
    { to: p.id, msg: { t: "who", names } },
  ];
}

/**
 * The help text: the file, as one `sqa` message, or the fallback. A muffled receiver gets one
 * muffled line for the whole file.
 */
export function helpReply(p: Player, topic: string, deps: ChatDeps): Outgoing[] {
  const lines = deps.helpLines(topic) ?? [CHAT_TEXT.noHelp];
  const heard = heardSqa(lines.join("\n"), p.map.name, p.y);
  const shown = heard === CHAT_TEXT.muffled ? [heard] : lines;
  return shown.map((text) => ({ to: p.id, msg: line(text) }));
}
