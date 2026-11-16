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
  type AdminCmd,
  CHAT_COLOR,
  cheatFileLines,
  findClass,
  formatAdminChat,
  inventoryLines,
  JAIL,
  lingoEq,
  lingoWord,
  mayRun,
  pardoningLine,
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
import { warp } from "../world/tick.ts";
import type { Outgoing, Player, World, WorldMap } from "../world/world.ts";
import { closeEditor } from "./worldedit.ts";

/** A character and its account (persistence/admin.ts `findCharacterAccount`). */
export interface CharacterAccount {
  characterId: string;
  accountId: string;
  name: string;
  role: Role;
  classCode: number;
  bannedAt: string | null;
  /** The account that made the current ban, and its role now. */
  bannedBy: string | null;
  bannedByRole: Role | null;
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
  /** Bans (`by` the admin's account id) or, with null, unbans an account. */
  setBan(accountId: string, by: string | null): void;
  addIpBan(ip: string, by: string): void;
  removeIpBan(ip: string): void;
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
    case "banip": // "Banning <ip>..." whatever the server did
      if (!allowed) {
        return [];
      }
      if (w2 !== "") {
        deps.addIpBan(w2, p.accountId);
        audit(w2);
      }
      return tell(p, ADMIN_TEXT.banningIp(w2));
    case "unbanip":
      if (!allowed) {
        return [];
      }
      if (w2 !== "") {
        deps.removeIpBan(w2);
        audit(w2);
      }
      return tell(p, ADMIN_TEXT.unbanningIp(w2));

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
      audit(t.name, null, to);
      return [...out, ...adminWarp(world, t, to.map, to.x, to.y, deps)];
    }
    case "jail": {
      // A P2P warp to `x0y0 4 4` for the target, no empty-name check.
      if (!allowed) {
        return [];
      }
      const out = tell(p, ADMIN_TEXT.jailing(w2));
      if (w2 === "") {
        return out;
      }
      const t = onlineByName(world, w2);
      if (!t) {
        return [...out, ...tell(p, ADMIN_TEXT.notOnline(w2))];
      }
      if (shieldedFrom(t)) {
        return [...out, ...tell(p, ADMIN_TEXT.immortalTarget)];
      }
      if (!deps.loadMap(JAIL.map)) {
        return [...out, ...tell(p, ADMIN_TEXT.noJail)];
      }
      audit(t.name);
      return [...out, ...adminWarp(world, t, JAIL.map, JAIL.x, JAIL.y, deps)];
    }
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
      const wasWanted = t.char.wanted;
      out.push(...pardon(t, p.name));
      deps.savePlayer?.(t);
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
        return [];
      }
      const out = tell(p, ADMIN_TEXT.banning(w2));
      const c = deps.findCharacter(w2);
      if (!c) {
        return [...out, ...tell(p, ADMIN_TEXT.noSuchCharacter(w2))];
      }
      if (c.accountId === p.accountId) {
        return [...out, ...tell(p, ADMIN_TEXT.banSelf)];
      }
      if (c.role === "immortal" && p.role !== "immortal") {
        return [...out, ...tell(p, ADMIN_TEXT.immortalTarget)];
      }
      deps.setBan(c.accountId, p.accountId);
      audit(c.name, c.bannedAt, "banned");
      const t = world.players.get(c.characterId);
      if (t) {
        deps.kick(t.id, ADMIN_TEXT.banned);
      }
      return out;
    }

    // ---- SSO additions (said as local chat by anyone else, in chat.ts) ---------------------
    case "unban": {
      if (w2 === "") {
        return tell(p, "Usage: /unban <name>");
      }
      const c = deps.findCharacter(w2);
      if (!c) {
        return tell(p, ADMIN_TEXT.noSuchCharacter(w2));
      }
      if (!c.bannedAt) {
        return tell(p, ADMIN_TEXT.notBanned(c.name));
      }
      // A moderator may not undo an immortal's ban, whoever its target now is.
      if (p.role !== "immortal" && c.bannedByRole === "immortal") {
        return tell(p, ADMIN_TEXT.immortalBan);
      }
      deps.setBan(c.accountId, null);
      audit(c.name, c.bannedAt, null);
      return tell(p, ADMIN_TEXT.unbanned(c.name));
    }
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
