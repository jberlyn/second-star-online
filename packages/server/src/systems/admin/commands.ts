/**
 * Admin chat commands.
 *
 * 1.6 parsed these in the client (`ChatSend`) and checked the sender's role there; most server
 * subjects checked nothing. SSO parses the same lines on the server, checks the account role
 * against the moderator/immortal table (`ADMIN_ROLES` in shared/rules/admin/admin.ts) and keeps
 * 1.6's texts: the echo the admin saw ("*** Warping Bob..."), the refusals, the replies. What 1.6
 * never told the admin (an offline name, a missing jail) gets an SSO line after the echo.
 *
 * I/O goes through `AdminDeps` (the database, kicks, saves), wired in game.ts.
 */
import {
  ADMIN_TEXT,
  type AddressSeen,
  type AdminCmd,
  BANLIST_PAGE,
  banListLine,
  banNotice,
  CHAT_COLOR,
  canonicalIp,
  cheatFileLines,
  expiryOf,
  findClass,
  formatAdminChat,
  formatUtc,
  historyLine,
  type IpBanRecord,
  inventoryLines,
  ipKey,
  isActive,
  isJailMap,
  JAIL,
  keyLabel,
  lingoEq,
  lingoWord,
  MODERATION_TEXT,
  type ModerationEntry,
  type ModerationLogRow,
  type ModerationRecord,
  mayChange,
  mayRun,
  mayTarget,
  type NamedRecord,
  pardoningLine,
  parseModerationArgs,
  parseWarpLine,
  type Role,
  readsAdminChat,
  type ServerMsg,
  TEXT,
  WARPSCRIPT_OFF,
  warpscriptMatches,
} from "@secondstaronline/shared";

import type { CasinoDeps } from "../casino/index.ts";
import { hears } from "../chat/ignore.ts";
import { pardon } from "../social/murder.ts";
import { releaseFromJail, warp } from "../world/tick.ts";
import type { Outgoing, Player, World, WorldMap } from "../world/world.ts";
import { closeEditor } from "./worldedit.ts";

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
  ipBan(key: string): IpBanRecord | null;
  ipBansFrom(accountId: string): IpBanRecord[];
  /** Logs one action and applies it. */
  record(e: ModerationEntry): void;
  /** The addresses an account has played from, the latest first. */
  addresses(accountId: string): AddressSeen[];
  charactersAt(key: string): { name: string; lastSeen: string }[];
  activeBans(now: string): NamedRecord[];
  activeJails(now: string): NamedRecord[];
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
  setRole(accountId: string, role: Role): void;
  moderation: ModerationStore;
  /** Wall-clock ISO time: when actions start and whether they have ended. */
  now(): string;
  /** The default lengths in minutes (settings `banMinutes`, `ipBanMinutes`, `jailMinutes`). */
  durations(): { banMinutes: number; ipBanMinutes: number; jailMinutes: number };
  setClass(characterId: string, code: number): void;
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
  /** The missing-map fallback. */
  startPoint(): { map: string; x: number; y: number };
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
 * 0). A target in an editor is put back in the game first. A map that does not exist takes the
 * missing-map fallback to the start point.
 */
export function adminWarp(
  world: World,
  target: Player,
  mapName: string,
  x: number,
  y: number,
  deps: Pick<AdminDeps, "loadMap" | "startPoint" | "casino">,
): Outgoing[] {
  const out = target.editing ? closeEditor(world, target) : [];
  const map = deps.loadMap(mapName);
  if (map) {
    out.push(...warp(world, target, map, x, y, deps.casino));
    return out;
  }
  const sp = deps.startPoint();
  out.push(...warp(world, target, deps.loadMap(sp.map) ?? target.map, sp.x, sp.y, deps.casino));
  return out;
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
  const allowed = mayRun(cmd, p.role);
  const audit = (target: string | null, before?: unknown, after?: unknown) =>
    deps.audit({ actor: p.accountId, command: `/${cmd}`, target, before, after });
  // SSO's own rule: a moderator's /iplookup, /jail, /warp and /warptome refuse an immortal
  // target, as /kick does. 1.6 sent them as messages the target's client obeyed.
  const shieldedFrom = (t: Player) => t.role === "immortal" && p.role !== "immortal";

  switch (cmd) {
    // ---- immortal-only lines that clear the field and say nothing otherwise --------------
    case "save": // every client saved; nothing printed
      if (allowed) {
        deps.saveAll();
        audit(null);
      }
      return [];
    case "refresh": // every client re-read its system settings file
      if (allowed) {
        deps.reloadSettings();
        audit(null);
      }
      return [];
    case "cheatfile": // the cheat log
      return allowed ? tell(p, ...cheatFileLines(deps.cheatLines())) : [];
    case "inventory":
      return allowed ? tell(p, ...inventoryLines(p.char.bag)) : [];
    case "banip": // "Banning <ip>..." echoes what was typed
      return allowed ? banIp(world, p, w2, typed, deps) : [];
    case "unbanip":
      return allowed ? unbanIp(p, w2, typed, deps) : [];

    // ---- moderator or immortal ----------------------------------------------------------
    case "location": // the admin's own map and tile
      return allowed ? tell(p, ADMIN_TEXT.location(p.map.name, p.x, p.y)) : [];
    case "iplookup": {
      // The reply prints "The IP is: …".
      if (!allowed) {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.lookingUpIp(w2));
      if (w2 === "") {
        return out;
      }
      const t = onlineByName(world, w2);
      if (t && shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.immortalTarget)];
      }
      out.push(...tell(p, t ? ADMIN_TEXT.theIpIs(t.ip) : ADMIN_TEXT.notOnline(w2)));
      if (t) {
        audit(t.name);
      }
      return out;
    }
    case "kick": {
      // In 1.6 SMUS's `system.user.delete` needed user level 60; SSO's server kick always works.
      if (!allowed) {
        return tell(p, ADMIN_TEXT.kickDenied);
      }
      if (w2 === "") {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.kicking(w2));
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (t.role === "immortal" && p.role !== "immortal") {
        return [...out, ...tell(p, ADMIN_TEXT.kickImmortal)];
      }
      audit(t.name);
      // The kicked player's chat line, then the alert: `x956`'s "*** You are being kicked." and
      // "You have been kicked from the game." The kick waits for the lines.
      deps.kick(t.id, TEXT.kicked);
      return [...out, ...tell(t, ADMIN_TEXT.beingKicked)];
    }
    case "warp": {
      // The server sent the target a warp message (`name*<line>`), and the target's client warped.
      if (!allowed) {
        return tell(p, ADMIN_TEXT.warpDenied);
      }
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
      if (shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.immortalTarget)];
      }
      const stop = jailWarpRefusal(t, to.map);
      if (stop) {
        return [...out, ...tell(p, stop)];
      }
      audit(t.name, null, to);
      return [...out, ...adminWarp(world, t, to.map, to.x, to.y, deps)];
    }
    case "jail": {
      if (!allowed) {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.jailing(w2));
      return w2 === ""
        ? [...out, ...tell(p, MODERATION_TEXT.jailUsage)]
        : [...out, ...jail(world, p, w2, typed, deps)];
    }
    case "unjail":
      if (!allowed) {
        return [];
      }
      return w2 === "" ? tell(p, MODERATION_TEXT.unjailUsage) : unjail(world, p, w2, typed, deps);
    case "pardon": {
      // An immortal's P2P `PRDN` to word 2 and "Pardoning <name>..."; anyone else's line is
      // swallowed. The target's client cleared its murder flag and said who pardoned it; SSO does
      // it on the server and says when the name is not online.
      if (!allowed) {
        return [];
      }
      const out = tell(p, pardoningLine(w2));
      if (w2 === "") {
        return out;
      }
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
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
      if (!allowed) {
        return tell(p, ADMIN_TEXT.warpToMeDenied);
      }
      if (w2 === "") {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.warping(w2));
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.immortalTarget)];
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
      if (!allowed) {
        return tell(p, ADMIN_TEXT.warpDenied);
      }
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

    // ---- staff commands and immortal-only account tools ------------------------------------
    case "warpscript": {
      if (!allowed) {
        return tell(p, ADMIN_TEXT.warpscriptDenied);
      }
      p.warpscript = lingoEq(w2, "OFF") ? WARPSCRIPT_OFF : w2;
      audit(null, null, p.warpscript);
      return tell(p, ADMIN_TEXT.warpscriptSet(p.warpscript));
    }
    case "ban": {
      // The ban is recorded, and the login refusal follows.
      if (!allowed) {
        return tell(p, ADMIN_TEXT.banDenied);
      }
      if (w2 === "") {
        return tell(p, MODERATION_TEXT.banUsage);
      }
      return [...tell(p, ADMIN_TEXT.banning(w2)), ...ban(world, p, w2, typed, deps)];
    }

    // ---- SSO additions (said as local chat by anyone else, in chat.ts) ---------------------
    case "unban":
      return w2 === "" ? tell(p, MODERATION_TEXT.unbanUsage) : unban(p, w2, typed, deps);
    case "banlist":
      return allowed ? banList(p, w2, deps) : [];
    case "role": {
      const role = lingoWord(typed, 3).toLowerCase();
      if (w2 === "" || !["player", "moderator", "immortal"].includes(role)) {
        return tell(p, ADMIN_TEXT.roleUsage);
      }
      const c = deps.findCharacter(w2);
      if (!c) {
        return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
      }
      if (c.accountId === p.accountId) {
        return tell(p, ADMIN_TEXT.roleSelf);
      }
      deps.setRole(c.accountId, role as Role);
      audit(c.name, c.role, role);
      const out = tell(p, ADMIN_TEXT.roleSet(c.name, role as Role));
      const t = world.players.get(c.characterId);
      if (t) {
        t.role = role as Role;
        if (!mayRun("warpscript", t.role)) {
          t.warpscript = null;
        }
        out.push({ to: t.id, msg: { t: "role", role: t.role } });
        // The editors are an immortal's: a demoted operator goes back to the game.
        if (role !== "immortal" && t.editing) {
          out.push(...closeEditor(world, t));
        }
      }
      return out;
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

/** Who acts, at what rank, and when: every moderation entry's common fields. */
function by(p: Player, deps: AdminDeps) {
  return { actorId: p.accountId, actorName: p.name, actorRank: p.role, createdAt: deps.now() };
}

const auditOf =
  (p: Player, deps: AdminDeps, command: string) =>
  (target: string | null, before?: unknown, after?: unknown) =>
    deps.audit({ actor: p.accountId, command, target, before, after });

/** The stored action if it is still in force. */
const live = <T extends ModerationRecord>(r: T | null, now: string): T | null =>
  isActive(r, now) ? r : null;

/** A permanent sentence never ends: `Infinity`. */
const jailEnd = (expiresAt: string | null) =>
  expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(expiresAt);

/**
 * Why a staff warp may not move `t` to `map`: a prisoner leaves jail only by `/unjail` or the end
 * of the sentence, and a player goes to jail only by `/jail`.
 */
function jailWarpRefusal(t: Player, map: string): string | null {
  if (t.jailUntil !== null) {
    return MODERATION_TEXT.prisoner(t.name);
  }
  if (t.role === "player" && isJailMap(map)) {
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

/** `/unban <name> [reason]`: only the ban's maker or an immortal lifts it. */
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
    t.jailUntil = jailEnd(expiresAt);
    if (!isJailMap(t.map.name)) {
      out.push(...adminWarp(world, t, JAIL.map, JAIL.x, JAIL.y, deps));
    }
  }
  return out;
}

/** `/unjail <name> [reason]`: only the jailer or an immortal ends a sentence early. */
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
        startPoint: deps.startPoint(),
        casino: deps.casino,
      }),
    );
  }
  return out;
}

/**
 * `/banip <name|address> [latest|all] [duration] [reason]`: a character's latest address (or every
 * one it has used), else a typed address. An IPv6 address bans its /64. Sessions from a banned
 * address are disconnected at once, except immortals', whom IP bans never stop.
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
    if (c.role === "immortal") {
      return [...out, ...tell(p, MODERATION_TEXT.ipImmortal)];
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
    if (o.role !== "immortal" && keys.has(ipKey(o.ip))) {
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
 * `/banlist [page]`: the bans, jails and (for immortals) IP bans in force. `/banlist <name>`: that
 * character's standing, history and (for immortals) addresses. `/banlist <address>` (immortals):
 * the address's ban and who has played from it.
 */
function banList(p: Player, w2: string, deps: AdminDeps): Outgoing[] {
  const now = deps.now();
  const immortal = p.role === "immortal";
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
    ];
    if (immortal) {
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
    const lines = [
      ...(b ? [`* ${banListLine(`${c.name}: banned`, b)}`] : []),
      ...(j ? [`* ${banListLine(`${c.name}: jailed`, j)}`] : []),
    ];
    if (lines.length === 0) {
      lines.push(MODERATION_TEXT.notModerated(c.name));
    }
    // A moderator sees that an IP ban was made, not on which address.
    lines.push(
      ...m
        .history(c.accountId, BANLIST_PAGE)
        .map((r) => historyLine(immortal ? r : { ...r, address: null })),
    );
    if (immortal) {
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
  if (!immortal) {
    return tell(p, MODERATION_TEXT.addressesImmortal);
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
 * `-text`: both staff roles (immortals and moderators) post to the dedicated admin channel
 * (`CHAT_COLOR.admin`), with no house sender restriction, no muffling, and no ignore filtering.
 * Non-staff receive an explicit denial and their input clears.
 */
export function adminChat(world: World, p: Player, typed: string): Outgoing[] {
  if (!readsAdminChat(p.role)) {
    return tell(p, ADMIN_TEXT.adminChatDenied);
  }
  const text = formatAdminChat(p.name, typed);
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    if (readsAdminChat(o.role)) {
      out.push({ to: o.id, msg: { t: "chat", text, color: CHAT_COLOR.admin } });
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
  deps: Pick<AdminDeps, "loadMap" | "startPoint" | "casino">,
): Outgoing[] {
  for (const staff of world.players.values()) {
    // The check follows the ignore test: a staff member ignoring the speaker never reads the
    // broadcast, so never warps them.
    if (!mayRun("warpscript", staff.role) || staff.editing || !hears(staff, speaker.name)) {
      continue;
    }
    if (speaker.role === "immortal" && staff.role !== "immortal") {
      continue;
    }
    // A player goes to jail only by /jail.
    if (speaker.role === "player" && isJailMap(staff.map.name)) {
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
