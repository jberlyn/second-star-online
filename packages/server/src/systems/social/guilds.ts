/**
 * Guilds on the server.
 *
 * 1.6 ran guilds on the leader's client, which uploaded the whole file. SSO keeps rows and checks
 * leadership and membership on every action, but pushes the same lines in the same order: a guild's
 * `@<guild>` channel is the online players whose `Guild` field names it, and every change re-runs
 * 1.6's reload test (`*<me>*` among the lines) for each of them.
 */
import {
  abdicateGuild,
  CHAT_COLOR,
  chatRefusal,
  exileMember,
  FACING_DELTA,
  GUILD_DISBANDED,
  GUILD_LIST_MAX,
  GUILD_TEXT,
  type GuildAlignment,
  type GuildRecord,
  guildFileLines,
  guildScreenFields,
  guildScreenFor,
  leaveGuild,
  lingoEq,
  loadGuildOutcome,
  sanitiseGuildName,
} from "@secondstaronline/shared";

import { hears } from "../chat/ignore.ts";
import type { GroundItem, GuildRow, Outgoing, Player, World } from "../world/world.ts";

export interface GuildDeps {
  /** A new row id. */
  newId(): string;
  /** ISO time for `created_at`. */
  now(): string;
}

const chat = (to: Player, text: string): Outgoing => ({
  to: to.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/**
 * The live guild named `name` (case-insensitive comparison: file names ignore case), or undefined.
 */
export function guildNamed(world: World, name: string): GuildRow | undefined {
  const g = world.guilds.get(name.toLowerCase());
  return g && !g.disbanded ? g : undefined;
}

/** `p`'s guild, when its `Guild` field names a live one. */
export function guildOf(world: World, p: Player): GuildRow | undefined {
  return p.guild === "" ? undefined : guildNamed(world, p.guild);
}

export function record(g: GuildRow): GuildRecord {
  return {
    name: g.name,
    alignment: g.alignment,
    colour: g.colour,
    leader: g.leaderName,
    members: g.members.map((m) => m.name),
  };
}

/** The file 1.6 would read: none, `!DISBAND!`, or header and members. */
function fileOf(g: GuildRow | undefined): string[] | null {
  if (!g) {
    return null;
  }
  return g.disbanded ? [GUILD_DISBANDED] : guildFileLines(record(g));
}

/** The `@<guild>` channel: everyone online whose field names it. */
function channel(world: World, g: GuildRow): Player[] {
  return [...world.players.values()].filter((o) => o.guild !== "" && lingoEq(o.guild, g.name));
}

/**
 * A Guildcast to `@<guild>`: in colour 0. A player's `/g` line is filtered by each reader's ignore
 * list; the guild system's own lines are not.
 */
function guildcast(world: World, g: GuildRow, text: string, speaker?: string): Outgoing[] {
  return channel(world, g)
    .filter((o) => speaker === undefined || hears(o, speaker))
    .map((o) => chat(o, text));
}

function setField(world: World, p: Player, guild: string): void {
  p.guild = guild;
  world.guildFields.set(p.id, guild);
}

/** Rebuilds the member rows from a list of names, keeping each name's id (first unused match). */
function withNames(g: GuildRow, names: readonly string[], extra: { id: string; name: string }[]) {
  const pool = [...g.members, ...extra];
  const members: GuildRow["members"] = [];
  for (const n of names) {
    const i = pool.findIndex((m) => lingoEq(m.name, n));
    if (i >= 0) {
      members.push(pool[i] as { id: string; name: string });
      pool.splice(i, 1);
    }
  }
  return members;
}

/**
 * 1.6's guild reload, pushed to `@<guild>`: each listener re-reads the new file; one no longer in
 * it gets "You have been kicked out of the <guild>" and leaves; `!DISBAND!` gives "The <guild> has
 * been disband!" to all.
 */
function pushLoadGuild2(world: World, g: GuildRow, listeners: readonly Player[]): Outgoing[] {
  const out: Outgoing[] = [];
  const file = fileOf(g);
  for (const o of listeners) {
    const r = loadGuildOutcome(file, o.name);
    if (r === "kicked") {
      out.push(chat(o, GUILD_TEXT.kicked(o.guild)));
      setField(world, o, "");
    } else if (r === "disbanded") {
      out.push(chat(o, GUILD_TEXT.disbanded(o.guild)));
      setField(world, o, "");
    }
  }
  return out;
}

const dirty = (world: World, g: GuildRow) => world.guildsDirty.add(g);

/** The guild names in `GuildList.txt`'s order, up to 200. */
export function guildList(world: World): string[] {
  return [...world.guilds.values()]
    .filter((g) => !g.disbanded)
    .sort((a, b) => a.listedAt - b.listedAt)
    .map((g) => g.name)
    .filter((n) => n !== "")
    .slice(0, GUILD_LIST_MAX);
}

/**
 * Clicking the Guild Center: you must stand on the tile in front of it, facing it, not mid-step;
 * then the guild list is fetched, 1.6's client-side input lock is set and the screen opens.
 */
export function guildCenterClick(world: World, p: Player, center: GroundItem): Outgoing[] {
  const [dx, dy] = FACING_DELTA[p.facing];
  if (p.stepFrames > 0 || p.x + dx !== center.x || p.y + dy !== center.y) {
    return [chat(p, GUILD_TEXT.notInFront)];
  }
  p.keyLock = true;
  p.guildScreen = true;
  const g = guildOf(world, p);
  return [
    { to: p.id, msg: { t: "guild", screen: guildScreenFor(p.name, g ? record(g) : null) } },
    { to: p.id, msg: { t: "guildList", names: guildList(world) } },
  ];
}

/** CANCEL or OK: the input lock is off again, the screen gone. */
export function guildClose(p: Player): void {
  if (p.guildScreen) {
    p.guildScreen = false;
    p.keyLock = false;
  }
}

/** Closes the screen as Leave, Disband and 1.6's "Guild Created" do (back to the previous frame). */
function closeScreen(p: Player): Outgoing {
  p.guildScreen = false;
  p.keyLock = false;
  return { to: p.id, msg: { t: "guild", screen: null } };
}

/**
 * Create's OK: the keys unlock at once; the name is sanitised; an empty one or a live guild of that
 * name gets the alert; otherwise "Guild created!", the screen closes, and you join the guild with
 * the Hail.
 */
export function guildCreate(
  world: World,
  p: Player,
  typed: string,
  alignment: GuildAlignment,
  deps: GuildDeps,
): Outgoing[] {
  if (!p.guildScreen || p.guild !== "") {
    return [];
  }
  p.keyLock = false;
  const name = sanitiseGuildName(typed);
  const old = world.guilds.get(name.toLowerCase());
  if (name === "" || (old && !old.disbanded)) {
    return [{ to: p.id, msg: { t: "alert", text: GUILD_TEXT.taken } }];
  }
  // A loop, not `Math.max(...)`: a spread of every guild row ever made would pass the engine's
  // argument limit once enough names were created and disbanded.
  let last = 0;
  for (const g of world.guilds.values()) {
    last = Math.max(last, g.listedAt);
  }
  const listedAt = last + 1;
  const g: GuildRow = {
    id: old?.id ?? deps.newId(),
    name,
    alignment,
    colour: 0,
    leaderId: p.id,
    leaderName: p.name,
    members: [],
    disbanded: false,
    listedAt,
    createdAt: deps.now(),
  };
  if (old && old.name.toLowerCase() !== name.toLowerCase()) {
    world.guilds.delete(old.name.toLowerCase());
  }
  world.guilds.set(name.toLowerCase(), g);
  dirty(world, g);
  const out: Outgoing[] = [chat(p, GUILD_TEXT.created), closeScreen(p)];
  setField(world, p, name);
  out.push(...guildcast(world, g, GUILD_TEXT.hail(p.name)));
  return out;
}

/** The list's OK: the raw file, no first-character strip. */
export function guildView(world: World, p: Player, name: string): Outgoing[] {
  if (!p.guildScreen || !guildOf(world, p)) {
    return [];
  }
  const f = guildScreenFields(fileOf(world.guilds.get(name.toLowerCase())));
  return [{ to: p.id, msg: { t: "guildView", name, ...f } }];
}

/**
 * Leave, Disband, Exile, Abdicate. Each first compares the guild on screen with yours ("You're not
 * a member of this guild!"); then the server checks the role and the target as they stand now,
 * doing nothing when they fail.
 */
export function guildAction(
  world: World,
  p: Player,
  act: "leave" | "disband" | "exile" | "abdicate",
  viewing: string,
  member: string | undefined,
): Outgoing[] {
  if (!p.guildScreen) {
    return [];
  }
  if (!lingoEq(viewing, p.guild)) {
    return [chat(p, GUILD_TEXT.notMember)];
  }
  const g = guildOf(world, p);
  if (!g) {
    return [];
  }
  const leader = g.leaderId === p.id;
  const name = g.name;
  switch (act) {
    case "leave": {
      // A leader has no Leave button: abdicate or disband first.
      if (leader || !g.members.some((m) => m.id === p.id)) {
        return [];
      }
      g.members = withNames(g, leaveGuild(record(g), p.name).members, []);
      dirty(world, g);
      const out: Outgoing[] = [chat(p, GUILD_TEXT.quitting(name))];
      setField(world, p, "");
      // Sent after `LeaveGroup`, so you do not hear it.
      out.push(...guildcast(world, g, GUILD_TEXT.quit(p.name, name)));
      out.push(...pushLoadGuild2(world, g, channel(world, g)));
      out.push(closeScreen(p));
      return out;
    }
    case "disband": {
      if (!leader) {
        return [];
      }
      const listeners = channel(world, g);
      g.disbanded = true;
      g.members = [];
      dirty(world, g);
      const out = pushLoadGuild2(world, g, listeners);
      out.push(closeScreen(p));
      return out;
    }
    case "exile": {
      const target = g.members.find((m) => lingoEq(m.name, member ?? ""));
      if (!leader || !target) {
        return [];
      }
      g.members = withNames(g, exileMember(record(g), target.name).members, []);
      dirty(world, g);
      const listeners = channel(world, g);
      // The exiled member is still in `@<guild>` when the Guildcast arrives.
      const out = guildcast(world, g, GUILD_TEXT.exiled(target.name, name));
      out.push(...pushLoadGuild2(world, g, listeners));
      return out;
    }
    case "abdicate": {
      const target = g.members.find((m) => lingoEq(m.name, member ?? ""));
      if (!leader || !target) {
        return [];
      }
      const next = abdicateGuild(record(g), target.name);
      g.members = withNames(g, next.members, [{ id: p.id, name: p.name }]);
      g.leaderId = target.id;
      g.leaderName = target.name;
      dirty(world, g);
      // It names the guild, not the new leader; the screen stays as it was.
      const out: Outgoing[] = [chat(p, GUILD_TEXT.abdicating(name))];
      out.push(...guildcast(world, g, GUILD_TEXT.promoted(p.name, target.name, name)));
      out.push(...pushLoadGuild2(world, g, channel(world, g)));
      return out;
    }
  }
}

/**
 * `/invite <name>`: the leader gets "Sending…" even when nobody of that name is online; someone
 * in a guild (you included) answers with a refusal.
 */
export function guildInvite(world: World, p: Player, name: string): Outgoing[] {
  const g = guildOf(world, p);
  if (!g || g.leaderId !== p.id) {
    return [chat(p, GUILD_TEXT.notLeader)];
  }
  const out: Outgoing[] = [chat(p, GUILD_TEXT.sending(name))];
  const target = [...world.players.values()].find((o) => lingoEq(o.name, name));
  if (!target) {
    return out;
  }
  if (target.guild !== "") {
    out.push(chat(p, GUILD_TEXT.alreadyIn(target.name)));
    return out;
  }
  target.guildInvite = { guildId: g.id, inviterId: p.id };
  out.push(chat(target, GUILD_TEXT.invited(p.name, g.name)));
  return out;
}

/**
 * ACCEPT / REJECT: null with no invitation pending (the line is said). The line prints either way;
 * an acceptance joins only while the inviter is online and still leads that guild, and you are
 * still guildless.
 */
export function guildAnswer(world: World, p: Player, accept: boolean): Outgoing[] | null {
  const inv = p.guildInvite;
  if (!inv) {
    return null;
  }
  p.guildInvite = null;
  const out: Outgoing[] = [chat(p, accept ? GUILD_TEXT.accepted : GUILD_TEXT.rejected)];
  const inviter = world.players.get(inv.inviterId);
  if (!inviter) {
    return out;
  }
  if (!accept) {
    out.push(chat(inviter, GUILD_TEXT.declined(p.name)));
    return out;
  }
  const g = [...world.guilds.values()].find((x) => x.id === inv.guildId && !x.disbanded);
  if (!g || g.leaderId !== inviter.id || p.guild !== "") {
    return out;
  }
  // Adding the member: the Guildcast goes before the joiner is in the channel.
  g.members = [...g.members, { id: p.id, name: p.name }];
  dirty(world, g);
  out.push(...guildcast(world, g, GUILD_TEXT.joined(p.name, g.name)));
  // The joiner then loads the guild: the field, then the Hail.
  setField(world, p, g.name);
  out.push(...guildcast(world, g, GUILD_TEXT.hail(p.name)));
  return out;
}

/**
 * `/g text`: "You don't belong to a guild!" without one; otherwise the line to the channel, the
 * sender included, filtered by each reader's ignore list. It shares the chat cooldown.
 */
export function guildChat(
  world: World,
  p: Player,
  text: string,
  typed: string,
  cooldownFrames: number,
): Outgoing[] {
  const g = guildOf(world, p);
  if (!g) {
    return [chat(p, GUILD_TEXT.noGuild)];
  }
  const refused = chatRefusal(p.chatIn);
  if (refused) {
    return [
      { to: p.id, msg: { t: "chat", text: refused, color: CHAT_COLOR.normal, restore: typed } },
    ];
  }
  p.chatIn = cooldownFrames;
  return guildcast(world, g, GUILD_TEXT.chat(p.name, p.guild, text), p.name);
}

/**
 * At login: `field` is the character's saved `Guild`. Still in it → the channel and "Hail your
 * guildmate <me>!"; exiled (or a new guild of that name) → "You have been kicked out of the
 * <guild>"; disbanded → "The <guild> has been disband!"; no such guild → cleared silently. A
 * resumed session is not a login: it rejoins without the Hail.
 */
export function guildLogin(world: World, p: Player, field: string, resumed = false): Outgoing[] {
  p.guild = "";
  if (field === "") {
    return [];
  }
  const g = world.guilds.get(field.toLowerCase());
  switch (loadGuildOutcome(fileOf(g), p.name)) {
    case "kept": {
      p.guild = field;
      return g && !resumed ? guildcast(world, g, GUILD_TEXT.hail(p.name)) : [];
    }
    case "kicked":
      world.guildFields.set(p.id, "");
      return [chat(p, GUILD_TEXT.kicked(field))];
    case "disbanded":
      world.guildFields.set(p.id, "");
      return [chat(p, GUILD_TEXT.disbanded(field))];
    case "cleared":
      world.guildFields.set(p.id, "");
      return [];
  }
}
