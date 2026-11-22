/**
 * Admin commands typed in chat, and staff chat (`-text`).
 *
 * 1.6 parsed these in the client (`ChatSend`) and checked the sender's role there; most server
 * subjects checked nothing. SSO parses the same lines on the server, checks the account role's
 * permissions (`can` in shared/rules/admin/permissions.ts) and keeps
 * 1.6's texts: the echo the admin saw ("*** Warping Bob..."), the refusals, the replies. What 1.6
 * never told the admin (an offline name, a missing jail) gets an SSO line after the echo.
 *
 * I/O goes through `AdminDeps` (the database, kicks, saves), wired in game.ts.
 */
import {
  ADMIN_TEXT,
  type AddressSeen,
  type AdminCmd,
  AUDITLOG_TEXT,
  type AuditTrailRow,
  auditlogLine,
  BANLIST_PAGE,
  banListLine,
  banNotice,
  CHAT_COLOR,
  CHATLOG_TEXT,
  type ChatChannel,
  type ChatLogRow,
  can,
  canonicalIp,
  chatlogLine,
  cheatFileLines,
  endMs,
  expiryOf,
  findClass,
  formatStaffChat,
  formatUtc,
  historyLine,
  type IpBanRecord,
  inventoryLines,
  ipKey,
  isActive,
  isJailMap,
  isStaff,
  JAIL,
  keyLabel,
  lingoEq,
  lingoWord,
  MODERATION_TEXT,
  type ModerationEntry,
  type ModerationLogRow,
  type ModerationRecord,
  mayChange,
  mayTarget,
  type NamedRecord,
  outranks,
  PERMISSIONS,
  pardoningLine,
  parseAuditlogArgs,
  parseChatlogArgs,
  parseModerationArgs,
  parseWarpLine,
  type Role,
  type ServerMsg,
  TEXT,
  taggedName,
  WARPSCRIPT_OFF,
  warpscriptMatches,
} from "@secondstaronline/shared";

import type { CasinoDeps } from "../casino/index.ts";
import { hears } from "../chat/ignore.ts";
import { pardon } from "../social/murder.ts";
import { releaseFromJail, warp } from "../world/tick.ts";
import type { Outgoing, Player, World, WorldMap } from "../world/world.ts";
import { closeEditor, mayEdit } from "./worldedit.ts";

/** A character and its account (persistence/admin.ts `findCharacterAccount`). */
export interface CharacterAccount {
  characterId: string;
  accountId: string;
  name: string;
  role: Role;
  classCode: number;
}

/**
 * The moderation rows (persistence/moderation.ts). Readers return lapsed rows too; the commands
 * check `isActive`.
 */
export interface ModerationStore {
  accountBan(accountId: string): ModerationRecord | null;
  jail(characterId: string): ModerationRecord | null;
  mute(accountId: string): ModerationRecord | null;
  ipBan(key: string): IpBanRecord | null;
  ipBansFrom(accountId: string): IpBanRecord[];
  /** Logs one action and applies it. */
  record(e: ModerationEntry): void;
  /** The addresses an account has played from, the latest first. */
  addresses(accountId: string): AddressSeen[];
  charactersAt(key: string): { name: string; lastSeen: string }[];
  activeBans(now: string): NamedRecord[];
  activeJails(now: string): NamedRecord[];
  activeMutes(now: string): NamedRecord[];
  activeIpBans(now: string): (IpBanRecord & { sourceName: string | null })[];
  history(accountId: string, limit: number): ModerationLogRow[];
}

/** One audit log row (persistence/admin.ts `insertAudit`). */
export interface AuditEntry {
  /** The acting account's id. */
  actor: string;
  command: string;
  target?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AdminDeps {
  /** A character and its account by name, ignoring case; null when there is none. */
  findCharacter(name: string): CharacterAccount | null;
  moderation: ModerationStore;
  /** Wall-clock ISO time: when actions start and whether they have ended. */
  now(): string;
  /**
   * The default lengths in minutes (settings `banLength`, `ipBanLength`, `jailSentence`,
   * `muteLength`).
   */
  durations(): {
    banMinutes: number;
    ipBanMinutes: number;
    jailMinutes: number;
    muteMinutes: number;
  };
  setClass(characterId: string, code: number): void;
  /** The chat log's newest lines for a name, oldest first (written up to now first). */
  chatLog?(q: { name: string; channel: ChatChannel | null; limit: number }): ChatLogRow[];
  /** `/auditlog`: staff actions by the account or to the name, newest `limit`, oldest first. */
  auditTrail?(q: { accountId: string | null; name: string; limit: number }): AuditTrailRow[];
  /** The cheat log's newest lines, oldest first, as 1.6's cheat-report routine wrote them. */
  cheatLines(): string[];
  audit(e: AuditEntry): void;
  /** Disconnects a player with an alert (after this command's lines are sent). */
  kick(playerId: string, text: string): void;
  /** `/save`: every online character and map written now. */
  saveAll(): void;
  /** Writes one character now (a pardon). */
  savePlayer?(p: Player): void;
  /** `/Refresh`: the settings read again from the database and applied. */
  reloadSettings(): void;
  loadMap(name: string): WorldMap | null;
  loadMapById?(id: string): WorldMap | null;
  /** The operator's fallback point, for a released prisoner whose respawn map is gone. */
  fallbackPoint?(): { map: string; x: number; y: number };
  casino: CasinoDeps;
}

type ChatLine = Extract<ServerMsg, { t: "chat" }>;
const line = (text: string): ChatLine => ({ t: "chat", text, color: CHAT_COLOR.normal });
const tell = (p: Player, ...texts: string[]): Outgoing[] =>
  texts.map((text) => ({ to: p.id, msg: line(text) }));

/**
 * An online player by name, ignoring case, as for SMUS user names.
 */
export function onlineByName(world: World, name: string): Player | null {
  for (const o of world.players.values()) {
    if (lingoEq(o.name, name)) {
      return o;
    }
  }
  return null;
}

/**
 * Moves `target` as the server's warp message did, dead or alive: 1.6's message handler had an
 * exit for a dead player that never ran, since nothing ever set the dead-player flag to 1 (only to
 * 0). A target in an editor is put back in the game first. The caller checks that the map exists
 * (`/warp` refuses a missing one); a missing map here leaves the target where they are.
 */
export function adminWarp(
  world: World,
  target: Player,
  mapName: string,
  x: number,
  y: number,
  deps: Pick<AdminDeps, "loadMap" | "casino">,
): Outgoing[] {
  const map = deps.loadMap(mapName);
  if (!map) {
    return [];
  }
  const out = target.editing ? closeEditor(world, target) : [];
  out.push(...warp(world, target, map, x, y, deps.casino));
  return out;
}

/**
 * Puts `role` in force for an online player at once (a role assigned in the Server Settings window
 * or with `admin:role`, or the definition of their role changed): they get their new permissions,
 * a `/warpscript` they may no longer use is cleared, and they leave an editor or the Control Panel
 * they may no longer use. A room they may no longer be in drops them on the next tick (`roomMembership`).
 */
export function applyRole(world: World, t: Player, role: Role): Outgoing[] {
  t.role = role;
  if (!can(role, "warpscript")) {
    t.warpscript = null;
  }
  const out: Outgoing[] = [{ to: t.id, msg: permissionsMsg(role) }];
  if (t.editing && !mayEdit(role, t.editing)) {
    out.push(...closeEditor(world, t));
  }
  return out;
}

/** The `permissions` message for a role. */
export function permissionsMsg(role: Role): ServerMsg {
  return { t: "permissions", permissions: PERMISSIONS.filter((x) => can(role, x)) };
}

/** What a command line from `p` does. */
export function handleAdmin(
  world: World,
  p: Player,
  cmd: AdminCmd,
  w2: string,
  typed: string,
  deps: AdminDeps,
): Outgoing[] {
  // The chat handler answers a command the typist may not use as an unknown one; this guard
  // keeps any other caller honest.
  if (!can(p.role, cmd)) {
    return [];
  }
  const audit = (target: string | null, before?: unknown, after?: unknown) =>
    deps.audit({ actor: p.accountId, command: `/${cmd}`, target, before, after });
  // SSO's own rule: /iplookup, /warp and /warptome refuse a target who outranks the staff
  // member, as /kick does. 1.6 sent them as messages the target's client obeyed.
  const shieldedFrom = (t: Player) => outranks(t.role, p.role);

  switch (cmd) {
    // ---- 1.6's immortal-only commands (who holds each now: DEFAULT_ROLES in permissions.ts) ---
    case "save": // every client saved; nothing printed
      deps.saveAll();
      audit(null);
      return [];
    case "refresh": // every client re-read its system settings file
      deps.reloadSettings();
      audit(null);
      return [];
    case "cheatfile": {
      // The cheat log. SSO audits each look: its lines name players' addresses.
      const lines = cheatFileLines(deps.cheatLines());
      audit(null, undefined, { entries: lines.length - 1 });
      return tell(p, ...lines);
    }
    case "inventory":
      return tell(p, ...inventoryLines(p.char.bag));
    case "banip": // "Banning <ip>..." echoes what was typed
      return banIp(world, p, w2, typed, deps);
    case "unbanip":
      return unbanIp(p, w2, typed, deps);

    // ---- 1.6's moderator and immortal commands ----------------------------------------------
    case "location": // the admin's own map and tile
      return tell(p, ADMIN_TEXT.location(p.map.name, p.x, p.y));
    case "iplookup": {
      // The reply prints "The IP is: …".
      const out = tell(p, ADMIN_TEXT.lookingUpIp(w2));
      if (w2 === "") {
        return out;
      }
      const t = onlineByName(world, w2);
      if (t && shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.outranked)];
      }
      out.push(...tell(p, t ? ADMIN_TEXT.theIpIs(t.ip) : ADMIN_TEXT.notOnline(w2)));
      if (t) {
        audit(t.name);
      }
      return out;
    }
    case "kick": {
      // In 1.6 SMUS's `system.user.delete` needed user level 60; SSO's server kick always works.
      if (w2 === "") {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.kicking(w2));
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.kickOutranked)];
      }
      audit(t.name);
      // The kicked player's chat line, then the alert: `x956`'s "*** You are being kicked." and
      // "You have been kicked from the game." The kick waits for the lines.
      deps.kick(t.id, TEXT.kicked);
      return [...out, ...tell(t, ADMIN_TEXT.beingKicked)];
    }
    case "warp": {
      // The server sent the target a warp message (`name*<line>`), and the target's client warped.
      if (w2 === "") {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.warping(w2));
      const to = parseWarpLine(typed);
      if (!to) {
        return [...out, ...tell(p, ADMIN_TEXT.warpUsage)];
      }
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (t === p && !can(p.role, "warpSelf")) {
        return [...out, ...tell(p, MODERATION_TEXT.warpSelf)];
      }
      if (shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.outranked)];
      }
      const stop = jailWarpRefusal(t, to.map);
      if (stop) {
        return [...out, ...tell(p, stop)];
      }
      // A bug fixed: 1.6 sent the target to the start point when the map was missing.
      if (!deps.loadMap(to.map)) {
        return [...out, ...tell(p, ADMIN_TEXT.noMap(to.map))];
      }
      audit(t.name, null, to);
      return [...out, ...adminWarp(world, t, to.map, to.x, to.y, deps)];
    }
    case "jail": {
      const out = tell(p, ADMIN_TEXT.jailing(w2));
      return w2 === ""
        ? [...out, ...tell(p, MODERATION_TEXT.jailUsage)]
        : [...out, ...jail(world, p, w2, typed, deps)];
    }
    case "unjail":
      return w2 === "" ? tell(p, MODERATION_TEXT.unjailUsage) : unjail(world, p, w2, typed, deps);
    case "mute":
      return w2 === "" ? tell(p, MODERATION_TEXT.muteUsage) : mute(world, p, w2, typed, deps);
    case "unmute":
      return w2 === "" ? tell(p, MODERATION_TEXT.unmuteUsage) : unmute(world, p, w2, typed, deps);
    case "pardon": {
      // 1.6: an immortal's P2P `PRDN` to word 2 and "Pardoning <name>...". The target's client cleared its murder flag and said who pardoned it; SSO does
      // it on the server and says when the name is not online.
      const out = tell(p, pardoningLine(w2));
      if (w2 === "") {
        return out;
      }
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (t === p && !can(p.role, "pardonSelf")) {
        return [...out, ...tell(p, MODERATION_TEXT.pardonSelf)];
      }
      if (t !== p && !mayTarget(p.role, t.role)) {
        return [...out, ...tell(p, MODERATION_TEXT.staffTarget)];
      }
      const wasWanted = t.char.wanted;
      out.push(...pardon(t, p.name));
      deps.savePlayer?.(t);
      deps.moderation.record({
        ...by(p, deps),
        action: "pardon",
        accountId: t.accountId,
        characterName: t.name,
        reason: parseModerationArgs(typed, { duration: false })?.reason ?? "",
        expiresAt: null,
      });
      audit(t.name, wasWanted, false);
      return out;
    }
    case "warptome": {
      // The target is sent to the admin's own map and tile.
      if (w2 === "") {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.warping(w2));
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.outranked)];
      }
      const stop = jailWarpRefusal(t, p.map.name);
      if (stop) {
        return [...out, ...tell(p, stop)];
      }
      audit(t.name, null, { map: p.map.name, x: p.x, y: p.y });
      return [...out, ...adminWarp(world, t, p.map.name, p.x, p.y, deps)];
    }
    case "warpmeto": {
      // The admin's client sent `WRP`, and the target replied with a warp to its own tile.
      if (w2 === "") {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.warpingYouTo(w2));
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (p.jailUntil !== null) {
        return [...out, ...tell(p, MODERATION_TEXT.prisoner(p.name))];
      }
      audit(t.name, null, { map: t.map.name, x: t.x, y: t.y });
      return [...out, ...adminWarp(world, p, t.map.name, t.x, t.y, deps)];
    }

    // ---- staff commands and account tools ----------------------------------------------------
    case "warpscript": {
      p.warpscript = lingoEq(w2, "OFF") ? WARPSCRIPT_OFF : w2;
      audit(null, null, p.warpscript);
      return tell(p, ADMIN_TEXT.warpscriptSet(p.warpscript));
    }
    case "ban": {
      // The ban is recorded, and the login refusal follows.
      if (w2 === "") {
        return tell(p, MODERATION_TEXT.banUsage);
      }
      return [...tell(p, ADMIN_TEXT.banning(w2)), ...ban(world, p, w2, typed, deps)];
    }

    // ---- SSO additions (an unknown command to anyone without the permission, in chat.ts) --
    case "unban":
      return w2 === "" ? tell(p, MODERATION_TEXT.unbanUsage) : unban(p, w2, typed, deps);
    case "banlist":
      return banList(p, w2, deps);
    case "chatlog": {
      if (!deps.chatLog) {
        return [];
      }
      const args = parseChatlogArgs(typed);
      if (!args) {
        return tell(p, CHATLOG_TEXT.usage);
      }
      const c = deps.findCharacter(args.name);
      // A deleted character's lines are still logged under its name.
      const name = c?.name ?? args.name;
      const rows = deps.chatLog({ name, channel: args.channel, limit: args.limit });
      // Reading someone's chat is itself recorded.
      audit(name, null, { limit: args.limit, channel: args.channel });
      if (rows.length === 0) {
        return tell(p, c ? CHATLOG_TEXT.none(name) : ADMIN_TEXT.noSuchCharacter(name));
      }
      return tell(p, CHATLOG_TEXT.header(name, rows.length), ...rows.map(chatlogLine));
    }
    case "auditlog": {
      if (!deps.auditTrail) {
        return [];
      }
      const args = parseAuditlogArgs(typed);
      if (!args) {
        return tell(p, AUDITLOG_TEXT.usage);
      }
      const c = deps.findCharacter(args.name);
      // A deleted character is still found as a target by its name.
      const name = c?.name ?? args.name;
      const rows = deps.auditTrail({ accountId: c?.accountId ?? null, name, limit: args.limit });
      // Recorded after the read, so it is the next lookup's newest entry, not this one's.
      audit(name, null, { limit: args.limit });
      if (rows.length === 0) {
        return tell(p, c ? AUDITLOG_TEXT.none(name) : ADMIN_TEXT.noSuchCharacter(name));
      }
      return tell(p, AUDITLOG_TEXT.header(name, rows.length), ...rows.map(auditlogLine));
    }
    case "setclass": {
      // The six path-less classes had no way in but the raw file editor.
      const rest = typed.trim().replace(/^\S+\s+\S+\s*/, "");
      if (w2 === "" || rest === "" || lingoWord(typed, 3) === "") {
        return tell(p, ADMIN_TEXT.setClassUsage);
      }
      const c = deps.findCharacter(w2);
      if (!c) {
        return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
      }
      const cls = findClass(rest);
      if (!cls) {
        return tell(p, ADMIN_TEXT.noSuchClass(rest));
      }
      deps.setClass(c.characterId, cls.code);
      audit(c.name, c.classCode, cls.code);
      return tell(p, ADMIN_TEXT.classSet(c.name, cls.name));
    }
  }
}

// ---- moderation: bans, jails and IP bans -------------------------------------------------------

/** Who acts, in what role, and when: every moderation entry's common fields. */
function by(p: Player, deps: AdminDeps) {
  return {
    actorId: p.accountId,
    actorName: p.name,
    actorRole: p.role?.name ?? "Player",
    createdAt: deps.now(),
  };
}

const auditOf =
  (p: Player, deps: AdminDeps, command: string) =>
  (target: string | null, before?: unknown, after?: unknown) =>
    deps.audit({ actor: p.accountId, command, target, before, after });

/** The stored action if it is still in force. */
const live = <T extends ModerationRecord>(r: T | null, now: string): T | null =>
  isActive(r, now) ? r : null;

/** A permanent sentence never ends: `Infinity`. */
/**
 * Why a staff warp may not move `t` to `map`: a prisoner leaves jail only by `/unjail` or the end
 * of the sentence, and a player goes to jail only by `/jail`.
 */
function jailWarpRefusal(t: Player, map: string): string | null {
  if (t.jailUntil !== null) {
    return MODERATION_TEXT.prisoner(t.name);
  }
  if (!isStaff(t.role) && isJailMap(map)) {
    return MODERATION_TEXT.useJail;
  }
  return null;
}

/** `/ban <name> [duration] [reason]`: a new ban, or a change to one the actor may change. */
function ban(world: World, p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const args = parseModerationArgs(typed);
  if (!args) {
    return tell(p, MODERATION_TEXT.badDuration);
  }
  const c = deps.findCharacter(w2);
  if (!c) {
    return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
  }
  if (c.accountId === p.accountId) {
    return tell(p, ADMIN_TEXT.banSelf);
  }
  if (!mayTarget(p.role, c.role)) {
    return tell(p, MODERATION_TEXT.staffTarget);
  }
  const base = by(p, deps);
  const was = live(deps.moderation.accountBan(c.accountId), base.createdAt);
  if (was && !mayChange({ id: p.accountId, role: p.role }, was)) {
    return tell(p, MODERATION_TEXT.notYourBan(c.name, was.actorName));
  }
  const expiresAt = expiryOf(args.duration, deps.durations().banMinutes, base.createdAt);
  deps.moderation.record({
    ...base,
    action: "ban",
    accountId: c.accountId,
    characterName: c.name,
    reason: args.reason,
    expiresAt,
  });
  auditOf(p, deps, "/ban")(c.name, was?.expiresAt ?? null, expiresAt ?? "permanent");
  const t = world.players.get(c.characterId);
  if (t) {
    deps.kick(t.id, banNotice(ADMIN_TEXT.banned, expiresAt));
  }
  return tell(
    p,
    was
      ? MODERATION_TEXT.banChanged(c.name, expiresAt, was.expiresAt)
      : MODERATION_TEXT.banned(c.name, expiresAt),
  );
}

/** `/unban <name> [reason]`: only the ban's maker or a role with `overrule` lifts it. */
function unban(p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const c = deps.findCharacter(w2);
  if (!c) {
    return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
  }
  const base = by(p, deps);
  const was = live(deps.moderation.accountBan(c.accountId), base.createdAt);
  if (!was) {
    return tell(p, ADMIN_TEXT.notBanned(c.name));
  }
  if (!mayChange({ id: p.accountId, role: p.role }, was)) {
    return tell(p, MODERATION_TEXT.notYourBan(c.name, was.actorName));
  }
  deps.moderation.record({
    ...base,
    action: "unban",
    accountId: c.accountId,
    characterName: c.name,
    reason: parseModerationArgs(typed, { duration: false })?.reason ?? "",
    expiresAt: null,
  });
  auditOf(p, deps, "/unban")(c.name, was.expiresAt ?? "permanent", null);
  return tell(p, ADMIN_TEXT.unbanned(c.name));
}

/**
 * `/jail <name> [duration] [reason]`, online or offline: the sentence is stored and runs in real
 * time. An online prisoner goes to the jail tile now; an offline one at their next login.
 */
function jail(world: World, p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const args = parseModerationArgs(typed);
  if (!args) {
    return tell(p, MODERATION_TEXT.badDuration);
  }
  const c = deps.findCharacter(w2);
  if (!c) {
    return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
  }
  if (c.accountId === p.accountId) {
    return tell(p, MODERATION_TEXT.jailSelf);
  }
  if (!mayTarget(p.role, c.role)) {
    return tell(p, MODERATION_TEXT.staffTarget);
  }
  if (!deps.loadMap(JAIL.map)) {
    return tell(p, ADMIN_TEXT.noJail);
  }
  const base = by(p, deps);
  const was = live(deps.moderation.jail(c.characterId), base.createdAt);
  if (was && !mayChange({ id: p.accountId, role: p.role }, was)) {
    return tell(p, MODERATION_TEXT.notYourJail(c.name, was.actorName));
  }
  const expiresAt = expiryOf(args.duration, deps.durations().jailMinutes, base.createdAt);
  deps.moderation.record({
    ...base,
    action: "jail",
    accountId: c.accountId,
    characterId: c.characterId,
    characterName: c.name,
    reason: args.reason,
    expiresAt,
  });
  auditOf(p, deps, "/jail")(c.name, was?.expiresAt ?? null, expiresAt ?? "permanent");
  const out = tell(
    p,
    was
      ? MODERATION_TEXT.jailChanged(c.name, expiresAt, was.expiresAt)
      : MODERATION_TEXT.jailed(c.name, expiresAt),
  );
  const t = world.players.get(c.characterId);
  if (t) {
    t.jailUntil = endMs(expiresAt);
    if (!isJailMap(t.map.name)) {
      out.push(...adminWarp(world, t, JAIL.map, JAIL.x, JAIL.y, deps));
    }
    out.push(...tell(t, MODERATION_TEXT.youAreJailed(expiresAt)));
  }
  return out;
}

/** The online character of an account, if any. */
const onlineAccount = (world: World, accountId: string): Player | undefined =>
  [...world.players.values()].find((o) => o.accountId === accountId);

/**
 * `/mute <name> [duration] [reason]`, online or offline: the account can't chat, IM (except to
 * staff), post or mail until it ends. It runs in real time, as a sentence does.
 */
function mute(world: World, p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const args = parseModerationArgs(typed);
  if (!args) {
    return tell(p, MODERATION_TEXT.badDuration);
  }
  const c = deps.findCharacter(w2);
  if (!c) {
    return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
  }
  if (c.accountId === p.accountId) {
    return tell(p, MODERATION_TEXT.muteSelf);
  }
  if (!mayTarget(p.role, c.role)) {
    return tell(p, MODERATION_TEXT.staffTarget);
  }
  const base = by(p, deps);
  const was = live(deps.moderation.mute(c.accountId), base.createdAt);
  if (was && !mayChange({ id: p.accountId, role: p.role }, was)) {
    return tell(p, MODERATION_TEXT.notYourMute(c.name, was.actorName));
  }
  const expiresAt = expiryOf(args.duration, deps.durations().muteMinutes, base.createdAt);
  deps.moderation.record({
    ...base,
    action: "mute",
    accountId: c.accountId,
    characterName: c.name,
    reason: args.reason,
    expiresAt,
  });
  auditOf(p, deps, "/mute")(c.name, was?.expiresAt ?? null, expiresAt ?? "permanent");
  const out = tell(
    p,
    was
      ? MODERATION_TEXT.muteChanged(c.name, expiresAt, was.expiresAt)
      : MODERATION_TEXT.muted(c.name, expiresAt),
  );
  const t = onlineAccount(world, c.accountId);
  if (t) {
    t.muteUntil = endMs(expiresAt);
    out.push(...tell(t, MODERATION_TEXT.youAreMuted(expiresAt)));
  }
  return out;
}

/** `/unmute <name> [reason]`: only the staff member who muted them, or a role with `overrule`. */
function unmute(world: World, p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const c = deps.findCharacter(w2);
  if (!c) {
    return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
  }
  const base = by(p, deps);
  const was = live(deps.moderation.mute(c.accountId), base.createdAt);
  if (!was) {
    return tell(p, MODERATION_TEXT.notMuted(c.name));
  }
  if (!mayChange({ id: p.accountId, role: p.role }, was)) {
    return tell(p, MODERATION_TEXT.notYourMute(c.name, was.actorName));
  }
  deps.moderation.record({
    ...base,
    action: "unmute",
    accountId: c.accountId,
    characterName: c.name,
    reason: parseModerationArgs(typed, { duration: false })?.reason ?? "",
    expiresAt: null,
  });
  auditOf(p, deps, "/unmute")(c.name, was.expiresAt ?? "permanent", null);
  const out = tell(p, MODERATION_TEXT.unmuted(c.name));
  const t = onlineAccount(world, c.accountId);
  if (t) {
    t.muteUntil = null;
    out.push(...tell(t, MODERATION_TEXT.youAreUnmuted));
  }
  return out;
}

/** `/unjail <name> [reason]`: only the jailer or a role with `overrule` ends a sentence early. */
function unjail(world: World, p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const c = deps.findCharacter(w2);
  if (!c) {
    return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
  }
  const base = by(p, deps);
  const was = live(deps.moderation.jail(c.characterId), base.createdAt);
  if (!was) {
    return tell(p, MODERATION_TEXT.notJailed(c.name));
  }
  if (!mayChange({ id: p.accountId, role: p.role }, was)) {
    return tell(p, MODERATION_TEXT.notYourJail(c.name, was.actorName));
  }
  deps.moderation.record({
    ...base,
    action: "unjail",
    accountId: c.accountId,
    characterId: c.characterId,
    characterName: c.name,
    reason: parseModerationArgs(typed, { duration: false })?.reason ?? "",
    expiresAt: null,
  });
  auditOf(p, deps, "/unjail")(c.name, was.expiresAt ?? "permanent", null);
  const out = tell(p, MODERATION_TEXT.unjailed(c.name));
  const t = world.players.get(c.characterId);
  if (t) {
    out.push(
      ...releaseFromJail(world, t, {
        loadMap: deps.loadMap,
        loadMapById: deps.loadMapById,
        fallbackPoint: deps.fallbackPoint?.(),
        casino: deps.casino,
      }),
    );
  }
  return out;
}

/**
 * `/banip <name|address> [latest|all] [duration] [reason]`: a character's latest address (or every
 * one it has used), else a typed address. An IPv6 address bans its /64. Sessions from a banned
 * address are disconnected at once, except roles that bypass IP bans.
 */
function banIp(world: World, p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const out = tell(p, ADMIN_TEXT.banningIp(w2));
  if (w2 === "") {
    return [...out, ...tell(p, MODERATION_TEXT.banIpUsage)];
  }
  const c = deps.findCharacter(w2);
  const ip = c ? null : canonicalIp(w2);
  if (!c && !ip) {
    return [...out, ...tell(p, MODERATION_TEXT.noSuchTarget(w2))];
  }
  if (!c && /^(latest|all)$/i.test(lingoWord(typed, 3))) {
    return [...out, ...tell(p, MODERATION_TEXT.banIpUsage)];
  }
  const args = parseModerationArgs(typed, { scope: c !== null });
  if (!args) {
    return [...out, ...tell(p, MODERATION_TEXT.badDuration)];
  }
  let targets: { key: string; address: string }[];
  if (c) {
    if (c.accountId === p.accountId) {
      return [...out, ...tell(p, ADMIN_TEXT.banSelf)];
    }
    if (can(c.role, "bypassIpBan")) {
      return [...out, ...tell(p, MODERATION_TEXT.ipBypassed)];
    }
    const seen = deps.moderation.addresses(c.accountId);
    if (seen.length === 0) {
      return [...out, ...tell(p, MODERATION_TEXT.noAddresses(c.name))];
    }
    const byKey = new Map<string, AddressSeen>();
    for (const a of args.scope === "all" ? seen : seen.slice(0, 1)) {
      if (!byKey.has(a.key)) {
        byKey.set(a.key, a);
      }
    }
    targets = [...byKey.values()].map((a) => ({ key: a.key, address: a.address }));
  } else {
    targets = [ip as { key: string; address: string }];
  }
  const base = by(p, deps);
  const expiresAt = expiryOf(args.duration, deps.durations().ipBanMinutes, base.createdAt);
  for (const t of targets) {
    deps.moderation.record({
      ...base,
      action: "ipban",
      accountId: c?.accountId ?? null,
      characterName: c?.name ?? null,
      sourceAccountId: c?.accountId ?? null,
      ipKey: t.key,
      address: t.address,
      reason: args.reason,
      expiresAt,
    });
  }
  const keys = new Set(targets.map((t) => t.key));
  auditOf(p, deps, "/banip")(c?.name ?? targets[0]?.address ?? w2, null, {
    addresses: targets.map((t) => t.address),
    expiresAt,
  });
  for (const o of world.players.values()) {
    if (!can(o.role, "bypassIpBan") && keys.has(ipKey(o.ip))) {
      deps.kick(o.id, banNotice(ADMIN_TEXT.ipBanned, expiresAt));
    }
  }
  return [
    ...out,
    ...tell(
      p,
      c
        ? MODERATION_TEXT.ipBannedFor(targets.length, c.name, expiresAt)
        : MODERATION_TEXT.ipBanned(keyLabel(targets[0]?.key ?? w2), expiresAt),
    ),
  ];
}

/** `/unbanip <name|address> [reason]`: every IP ban made from a character's addresses, or one. */
function unbanIp(p: Player, w2: string, typed: string, deps: AdminDeps): Outgoing[] {
  const out = tell(p, ADMIN_TEXT.unbanningIp(w2));
  if (w2 === "") {
    return [...out, ...tell(p, MODERATION_TEXT.unbanIpUsage)];
  }
  const base = by(p, deps);
  const reason = parseModerationArgs(typed, { duration: false })?.reason ?? "";
  const lift = (b: IpBanRecord, accountId: string | null, name: string | null) =>
    deps.moderation.record({
      ...base,
      action: "unipban",
      accountId,
      characterName: name,
      ipKey: b.key,
      address: b.address,
      reason,
      expiresAt: null,
    });
  const c = deps.findCharacter(w2);
  if (c) {
    const bans = deps.moderation.ipBansFrom(c.accountId).filter((b) => isActive(b, base.createdAt));
    if (bans.length === 0) {
      return [...out, ...tell(p, MODERATION_TEXT.noIpBans(c.name))];
    }
    for (const b of bans) {
      lift(b, c.accountId, c.name);
    }
    auditOf(p, deps, "/unbanip")(
      c.name,
      bans.map((b) => b.address),
      null,
    );
    return [...out, ...tell(p, MODERATION_TEXT.ipUnbannedFor(bans.length, c.name))];
  }
  const ip = canonicalIp(w2);
  if (!ip) {
    return [...out, ...tell(p, MODERATION_TEXT.noSuchTarget(w2))];
  }
  const b = live(deps.moderation.ipBan(ip.key), base.createdAt);
  if (!b) {
    return [...out, ...tell(p, MODERATION_TEXT.ipNotBanned(keyLabel(ip.key)))];
  }
  lift(b, b.sourceAccountId, null);
  auditOf(p, deps, "/unbanip")(b.address, b.expiresAt ?? "permanent", null);
  return [...out, ...tell(p, MODERATION_TEXT.ipUnbanned(keyLabel(ip.key)))];
}

/**
 * `/banlist [page]`: the bans, jails, mutes and (for roles with `/banip`) IP bans in force.
 * `/banlist <name>`: that character's standing, history and (with `/banip`) addresses.
 * `/banlist <address>` (with `/banip`):
 * the address's ban and who has played from it.
 */
function banList(p: Player, w2: string, deps: AdminDeps): Outgoing[] {
  const now = deps.now();
  // IP bans and addresses are for those who may make IP bans.
  const seesAddresses = can(p.role, "banip");
  const m = deps.moderation;
  const rows = (lines: string[]) => (lines.length > 0 ? lines : [MODERATION_TEXT.listNone]);
  if (w2 === "" || /^\d+$/.test(w2)) {
    const bans = m.activeBans(now);
    const pages = Math.max(1, Math.ceil(bans.length / BANLIST_PAGE));
    const page = Math.min(pages, Math.max(1, Number(w2 || "1")));
    const lines = [
      MODERATION_TEXT.listBans(page, pages),
      ...rows(
        bans
          .slice((page - 1) * BANLIST_PAGE, page * BANLIST_PAGE)
          .map((b) => banListLine(b.name, b)),
      ),
      MODERATION_TEXT.listJails,
      ...rows(
        m
          .activeJails(now)
          .slice(0, BANLIST_PAGE)
          .map((j) => banListLine(j.name, j)),
      ),
      MODERATION_TEXT.listMutes,
      ...rows(
        m
          .activeMutes(now)
          .slice(0, BANLIST_PAGE)
          .map((u) => banListLine(u.name, u)),
      ),
    ];
    if (seesAddresses) {
      lines.push(
        MODERATION_TEXT.listIpBans,
        ...rows(
          m
            .activeIpBans(now)
            .slice(0, BANLIST_PAGE)
            .map((b) =>
              banListLine(keyLabel(b.key), b, b.sourceName ? `, from ${b.sourceName}` : ""),
            ),
        ),
      );
    }
    return tell(p, ...lines);
  }
  const c = deps.findCharacter(w2);
  if (c) {
    const b = live(m.accountBan(c.accountId), now);
    const j = live(m.jail(c.characterId), now);
    const u = live(m.mute(c.accountId), now);
    const lines = [
      ...(b ? [`* ${banListLine(`${c.name}: banned`, b)}`] : []),
      ...(j ? [`* ${banListLine(`${c.name}: jailed`, j)}`] : []),
      ...(u ? [`* ${banListLine(`${c.name}: muted`, u)}`] : []),
    ];
    if (lines.length === 0) {
      lines.push(MODERATION_TEXT.notModerated(c.name));
    }
    // A moderator sees that an IP ban was made, not on which address.
    lines.push(
      ...m
        .history(c.accountId, BANLIST_PAGE)
        .map((r) => historyLine(seesAddresses ? r : { ...r, address: null })),
    );
    if (seesAddresses) {
      lines.push(
        MODERATION_TEXT.historyAddresses,
        ...rows(
          m
            .addresses(c.accountId)
            .slice(0, BANLIST_PAGE)
            .map((a) => `${a.address} (last ${formatUtc(a.lastSeen)})`),
        ),
      );
    }
    return tell(p, ...lines);
  }
  const ip = canonicalIp(w2);
  if (!ip) {
    return tell(p, MODERATION_TEXT.noSuchTarget(w2));
  }
  if (!seesAddresses) {
    return tell(p, MODERATION_TEXT.addressesDenied);
  }
  const b = live(m.ipBan(ip.key), now);
  return tell(
    p,
    b ? `* ${banListLine(keyLabel(ip.key), b)}` : MODERATION_TEXT.ipNotBanned(keyLabel(ip.key)),
    MODERATION_TEXT.addressSeenWith,
    ...rows(
      m
        .charactersAt(ip.key)
        .slice(0, BANLIST_PAGE)
        .map((s) => `${s.name} (last ${formatUtc(s.lastSeen)})`),
    ),
  );
}

/**
 * `-text`: staff (any account with a role) post to staff chat, a dedicated channel
 * (`CHAT_COLOR.staff`), with no house sender restriction, no muffling, and no ignore filtering.
 * Non-staff receive an explicit denial and their input clears.
 */
export function staffChat(world: World, p: Player, typed: string): Outgoing[] {
  if (!isStaff(p.role)) {
    return tell(p, ADMIN_TEXT.staffChatDenied);
  }
  const text = formatStaffChat(taggedName(p.name, p.role, world.roleTags), typed);
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    if (isStaff(o.role)) {
      out.push({ to: o.id, msg: { t: "chat", text, color: CHAT_COLOR.staff } });
    }
  }
  return out;
}

/**
 * `/warpscript` on a broadcast: checks the broadcast message content (never speaker name or
 * protocol wrapper) against online non-editing staff who can run `/warpscript` and are not
 * ignoring the speaker. Deterministic single winner: the first matching staff member in login
 * order warps the speaker and receives `"*** Warping <name>..."`.
 */
export function warpscriptOnBroadcast(
  world: World,
  speaker: Player,
  message: string,
  deps: Pick<AdminDeps, "loadMap" | "casino">,
): Outgoing[] {
  for (const staff of world.players.values()) {
    // The check follows the ignore test: a staff member ignoring the speaker never reads the
    // broadcast, so never warps them.
    if (!can(staff.role, "warpscript") || staff.editing || !hears(staff, speaker.name)) {
      continue;
    }
    if (outranks(speaker.role, staff.role)) {
      continue;
    }
    // A player goes to jail only by /jail.
    if (!isStaff(speaker.role) && isJailMap(staff.map.name)) {
      continue;
    }
    if (!warpscriptMatches(staff.warpscript, message)) {
      continue;
    }
    return [
      ...adminWarp(world, speaker, staff.map.name, staff.x, staff.y, deps),
      ...tell(staff, ADMIN_TEXT.warping(speaker.name)),
    ];
  }
  return [];
}
