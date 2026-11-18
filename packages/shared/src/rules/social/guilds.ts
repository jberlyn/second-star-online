/**
 * Guilds. Pure rules over the generated `socialData.guilds`.
 *
 * 1.6 kept a guild as the file `DAT\GUILDS\<guild>.txt`: the header `<align>-<colour>-*<leader>*`
 * then one member per line in join order. SSO keeps rows but renders the file text so the client's
 * readers behave as they did. 1.6's loader also deleted the first character of any line not
 * starting with a letter; SSO reads every line as it is (a bug fixed).
 */
import { socialData } from "@secondstaronline/data";

import { lingoContains, lingoEq, lingoWord } from "../core/lingo.ts";

const G = socialData.guilds;

/** `G`ood, `N`eutral or `E`vil. */
export type GuildAlignment = "G" | "N" | "E";

/** A guild as the server holds it: the leader is not among the members (header only). */
export interface GuildRecord {
  name: string;
  alignment: GuildAlignment;
  /** Always 0: the colour list never reached the screen. */
  colour: number;
  leader: string;
  /** Members in join order, the leader excluded. */
  members: string[];
}

/** What the Guild Center opens on. */
export type GuildScreen =
  | { mode: "create" }
  | {
      mode: "member" | "leader";
      name: string;
      /** null: no alignment test matched, so 322-324 keep what they showed. */
      alignment: GuildAlignment | null;
      leader: string;
      members: string[];
    };

/** The guild name field's text before anything is typed. */
export const GUILD_DEFAULT_NAME = G.defaultName;

/** `GLDLST` → the guild list lists up to this many names. */
export const GUILD_LIST_MAX = G.listMax;

/** The sanitiser scans characters 1-100, as the original did; longer is a forged intent. */
export const GUILD_NAME_MAX = G.sanitiser.scan;

/**
 * SSO also removes these: `;` (1.6 cut it elsewhere), `` ` `` breaks the guild save, `'` breaks the
 * hall door's owner.
 */
const SSO_STRIP = [";", "`", "'"];

const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{([A-Z]+)\}/g, (_m, k: string) => v[k] ?? "");

const tx = (k: keyof typeof G.texts) => G.texts[k].text;

/** Every guild text, verbatim (the generated social data's `guilds.texts`). */
export const GUILD_TEXT = {
  notInFront: tx("notInFront"),
  taken: tx("taken"),
  created: tx("created"),
  hail: (name: string) => fill(tx("hail"), { NAME: name }),
  kicked: (guild: string) => fill(tx("kicked"), { GUILD: guild }),
  disbanded: (guild: string) => fill(tx("disbanded"), { GUILD: guild }),
  sending: (name: string) => fill(tx("sending"), { NAME: name }),
  notLeader: tx("notLeader"),
  alreadyIn: (name: string) => fill(tx("alreadyIn"), { NAME: name }),
  invited: (leader: string, guild: string) => fill(tx("invited"), { LEADER: leader, GUILD: guild }),
  accepted: tx("accepted"),
  rejected: tx("rejected"),
  declined: (name: string) => fill(tx("declined"), { NAME: name }),
  joined: (name: string, guild: string) => fill(tx("joined"), { NAME: name, GUILD: guild }),
  quitting: (guild: string) => fill(tx("quitting"), { GUILD: guild }),
  quit: (name: string, guild: string) => fill(tx("quit"), { NAME: name, GUILD: guild }),
  exiled: (name: string, guild: string) => fill(tx("exiled"), { NAME: name, GUILD: guild }),
  abdicating: (target: string) => fill(tx("abdicating"), { NAME: target }),
  promoted: (name: string, target: string, guild: string) =>
    fill(tx("promoted"), { NAME: name, TARGET: target, GUILD: guild }),
  notMember: tx("notMember"),
  noGuild: tx("noGuild"),
  /** `<name> tells the <guild> "<text>"`. */
  chat: (name: string, guild: string, text: string) =>
    fill(tx("chat"), { NAME: name, GUILD: guild, TEXT: text }),
} as const;

/**
 * One forward pass deleting `ch` from characters 1-`scan`: after a deletion the
 * loop moves on, skipping the character that slid into the deleted place, so of two adjacent
 * ones one survives ("a//b" → "a/b").
 */
function deletePass(s: string, ch: string, scan: number): string {
  let out = s;
  for (let x = 1; x <= scan; x++) {
    if (out.charAt(x - 1) === ch) {
      out = out.slice(0, x - 1) + out.slice(x);
    }
  }
  return out;
}

/** Removes the first word and any space before it, as the chat parser does. */
function deleteWord1(s: string): string {
  const m = /^\s*\S+/.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/**
 * The create button's sanitiser and SSO's additions: 1.6's eight passes, then every `;`,
 * `` ` `` and `'`, then `the` stripped twice, a space, `the` again, a space. Trailing spaces stay.
 */
export function sanitiseGuildName(typed: string): string {
  let s = typed;
  for (const ch of G.sanitiser.strip) {
    s = deletePass(s, ch, G.sanitiser.scan);
  }
  for (const ch of SSO_STRIP) {
    s = s.split(ch).join("");
  }
  const dropThe = () => {
    if (lingoEq(lingoWord(s, 1), "the")) {
      s = deleteWord1(s);
    }
  };
  const dropSpace = () => {
    if (s.startsWith(" ")) {
      s = s.slice(1);
    }
  };
  dropThe();
  dropThe();
  dropSpace();
  dropThe();
  dropSpace();
  return s;
}

/** The file 1.6 would hold: header, then members. */
export function guildFileLines(g: GuildRecord): string[] {
  return [`${g.alignment}-${g.colour}-*${g.leader}*`, ...g.members];
}

/** `!DISBAND!`: what `291` writes over the file. */
export const GUILD_DISBANDED = "!DISBAND!";

/**
 * The guild loader's pass over lines 1-100: empty lines are dropped and every other line is kept as
 * it is. 1.6 also deleted the first character of a line not starting with a letter (a bug fixed).
 */
export function loadGuildLines(lines: readonly string[]): string[] {
  return lines.slice(0, 100).filter((line) => line !== "");
}

/**
 * The outcome (`loadGuildOutcome`) for `me` given the file text (null: no file, "" or VOID). `kept`
 * → you are in it (`*<me>*` among the starred lines, the header's leader included); `kicked` → "You
 * have been kicked out of the <guild>"; `disbanded` → "The <guild> has been disband!"; `cleared` →
 * the field emptied silently.
 */
export function loadGuildOutcome(
  file: readonly string[] | null,
  me: string,
): "kept" | "kicked" | "disbanded" | "cleared" {
  if (file === null || file.length === 0 || file.every((l) => l === "")) {
    return "cleared";
  }
  if (file.length === 1 && file[0] === GUILD_DISBANDED) {
    return "disbanded";
  }
  const starred = loadGuildLines(file).map((l) => `*${l}*`);
  return starred.some((l) => lingoContains(l, `*${me}*`)) ? "kept" : "kicked";
}

/** The nth part of `s` split on `d`; missing parts are empty. */
const item = (s: string, d: string, n: number) => s.split(d)[n - 1] ?? "";

/**
 * The screen's fields from a file (for your own guild, after the loader's pass; for a viewed one,
 * raw): the leader is the second part of line 1 split on `*`; alignment checks for G,
 * N, E in that order in the first part split on `-`, the last match winning; members are lines
 * 2-100, empty ones dropped. A missing file gives no alignment, no leader, no members; `!DISBAND!`
 * contains "N", so it reads Neutral.
 */
export function guildScreenFields(file: readonly string[] | null): {
  alignment: GuildAlignment | null;
  leader: string;
  members: string[];
} {
  const header = file?.[0] ?? "";
  const a = item(header, "-", 1);
  let alignment: GuildAlignment | null = null;
  for (const k of ["G", "N", "E"] as const) {
    if (lingoContains(a, k)) {
      alignment = k;
    }
  }
  const members = (file ?? []).slice(1, G.memberLines[1]).filter((l) => l !== "");
  return { alignment, leader: item(header, "*", 2), members };
}

/** The Guild Center opens in leader mode when the player is the guild leader. */
export function guildScreenFor(me: string, guild: GuildRecord | null): GuildScreen {
  if (!guild) {
    return { mode: "create" };
  }
  const f = guildScreenFields(loadGuildLines(guildFileLines(guild)));
  return {
    mode: lingoEq(f.leader, me) ? "leader" : "member",
    name: guild.name,
    alignment: f.alignment,
    leader: f.leader,
    members: f.members,
  };
}

/** Leave: every line 2-90 equal to you, deleted top-down (one of two adjacent stays). */
function deleteMember(members: readonly string[], name: string): string[] {
  const lines = ["", ...members];
  for (let x = 2; x <= 90; x++) {
    if (x - 1 < lines.length && lingoEq(lines[x - 1] ?? "", name)) {
      lines.splice(x - 1, 1);
    }
  }
  return lines.slice(1);
}

export function leaveGuild(g: GuildRecord, me: string): GuildRecord {
  return { ...g, members: deleteMember(g.members, me) };
}

/** Exile (292): the selected member's line goes; the rest stay in order. */
export function exileMember(g: GuildRecord, target: string): GuildRecord {
  const i = g.members.findIndex((m) => lingoEq(m, target));
  return i < 0 ? g : { ...g, members: g.members.filter((_m, j) => j !== i) };
}

/**
 * Abdicate: the target's line goes, the header keeps items 1-2 (alignment and
 * colour) with `*<target>*` as leader, and the old leader is appended as the last member.
 */
export function abdicateGuild(g: GuildRecord, target: string): GuildRecord {
  const members = deleteMember(g.members, target);
  return { ...g, leader: target, members: [...members, g.leader] };
}

/** True when `name` is the guild's leader or one of its members (case-insensitive comparison). */
export function inGuild(g: GuildRecord, name: string): boolean {
  return lingoEq(g.leader, name) || g.members.some((m) => lingoEq(m, name));
}
