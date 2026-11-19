/**
 * Operator command line: prints the chat log, the lines players wrote to each other (say, `/me`,
 * broadcasts, IMs and away replies, guild chat, rooms, staff chat, away texts and bios), with what
 * became of each. In game, staff use `/chatlog`.
 *
 * Run: `bun run admin:chatlog [name] [--channel <channel>] [--since <time>] [--until <time>] [-n <count>]`
 * (default 50 lines; times are ISO dates or date-times, UTC; SSO_DB as for the server). With a
 * name: the lines that character sent and the IMs sent to them.
 */
import { CHAT_CHANNELS, type ChatChannel, chatlogLine } from "@secondstaronline/shared";

import { chatLogLines } from "../persistence/chatlog.ts";
import { openDatabase } from "../persistence/database.ts";
import { migrate } from "../persistence/migrations.ts";

export interface ChatlogOptions {
  name?: string;
  channel: ChatChannel | null;
  since: string | null;
  until: string | null;
  limit: number;
}

export const CHATLOG_USAGE =
  "usage: bun run admin:chatlog [name] [--channel <channel>] [--since <time>] [--until <time>] [-n <count>]";

/** The options from the command line, or an error to print. */
export function parseChatlogCli(argv: readonly string[]): ChatlogOptions | string {
  const o: ChatlogOptions = { channel: null, since: null, until: null, limit: 50 };
  const time = (v: string | undefined) => {
    const ms = v === undefined ? Number.NaN : Date.parse(v);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = argv[i + 1];
    if (a === "--channel") {
      const c = CHAT_CHANNELS.find((k) => k.toLowerCase() === v?.toLowerCase());
      if (!c) {
        return `unknown channel; one of: ${CHAT_CHANNELS.join(", ")}`;
      }
      o.channel = c;
      i++;
    } else if (a === "--since" || a === "--until") {
      const t = time(v);
      if (!t) {
        return `${a} needs a date or date-time, for example 2026-11-18 or 2026-11-18T09:00Z`;
      }
      o[a === "--since" ? "since" : "until"] = t;
      i++;
    } else if (a === "-n") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        return CHATLOG_USAGE;
      }
      o.limit = n;
      i++;
    } else if (!a.startsWith("-") && o.name === undefined) {
      o.name = a;
    } else {
      return CHATLOG_USAGE;
    }
  }
  return o;
}

export function chatlogReport(dbPath: string, o: ChatlogOptions): string[] {
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    return chatLogLines(db, o).map(chatlogLine);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const o = parseChatlogCli(process.argv.slice(2));
  if (typeof o === "string") {
    console.error(o);
    process.exit(2);
  }
  for (const line of chatlogReport(process.env.SSO_DB ?? "sso.sqlite", o)) {
    console.log(line);
  }
}
