/**
 * Guild rows: `guilds`, `guild_members` and the characters' `guild` field. Callers own
 * transactions.
 */
import type { GuildAlignment } from "@secondstaronline/shared";

import type { GuildRow } from "../systems/world/world.ts";
import type { Db } from "./database.ts";

/** A guild as stored; `members` exclude the leader, in join order. */
export type StoredGuild = GuildRow;

export function loadGuilds(db: Db): StoredGuild[] {
  const rows = db
    .query<
      {
        id: string;
        name: string;
        alignment: GuildAlignment;
        colour: number;
        leader_id: string | null;
        leader_name: string;
        disbanded: number;
        listed_at: number;
        created_at: string;
      },
      []
    >(
      `SELECT id, name, alignment, colour, leader_id, leader_name, disbanded, listed_at, created_at
       FROM guilds ORDER BY listed_at`,
    )
    .all();
  const members = db
    .query<{ guild_id: string; character_id: string; name: string }, []>(
      "SELECT guild_id, character_id, name FROM guild_members ORDER BY guild_id, position",
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    alignment: r.alignment,
    colour: r.colour,
    leaderId: r.leader_id,
    leaderName: r.leader_name,
    members: members
      .filter((m) => m.guild_id === r.id)
      .map((m) => ({ id: m.character_id, name: m.name })),
    disbanded: r.disbanded === 1,
    listedAt: r.listed_at,
    createdAt: r.created_at,
  }));
}

/** Writes a guild and replaces its member lines. */
export function saveGuild(db: Db, g: StoredGuild): void {
  db.query(
    `INSERT INTO guilds (id, name, alignment, colour, leader_id, leader_name, disbanded, listed_at,
       created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, alignment = excluded.alignment,
       colour = excluded.colour, leader_id = excluded.leader_id, leader_name = excluded.leader_name,
       disbanded = excluded.disbanded, listed_at = excluded.listed_at,
       created_at = excluded.created_at`,
  ).run(
    g.id,
    g.name,
    g.alignment,
    g.colour,
    g.leaderId,
    g.leaderName,
    g.disbanded ? 1 : 0,
    g.listedAt,
    g.createdAt,
  );
  db.query("DELETE FROM guild_members WHERE guild_id = ?").run(g.id);
  const add = db.prepare(
    "INSERT INTO guild_members (guild_id, position, character_id, name) VALUES (?, ?, ?, ?)",
  );
  for (const [i, m] of g.members.entries()) {
    add.run(g.id, i + 1, m.id, m.name);
  }
}

/** The character's `Guild` field. */
export function loadCharacterGuild(db: Db, characterId: string): string {
  return (
    db
      .query<{ guild: string }, [string]>("SELECT guild FROM characters WHERE id = ?")
      .get(characterId)?.guild ?? ""
  );
}

export function saveCharacterGuild(db: Db, characterId: string, guild: string): void {
  db.query("UPDATE characters SET guild = ? WHERE id = ?").run(guild, characterId);
}
