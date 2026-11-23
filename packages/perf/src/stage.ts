/**
 * Builds the scratch database for a run, before the server starts and never
 * through the protocol: the login limits off (as `startTestServer`), copies of the seed map on
 * the grid, and every bot's account and character with its role's kit. One password hash is
 * reused for all of them.
 */
import { rmSync } from "node:fs";

import { hashPassword, insertAccount } from "@secondstaronline/server/src/persistence/accounts.ts";
import { insertCharacter } from "@secondstaronline/server/src/persistence/characters.ts";
import { openDatabase } from "@secondstaronline/server/src/persistence/database.ts";
import { saveInventory } from "@secondstaronline/server/src/persistence/inventory.ts";
import { migrate } from "@secondstaronline/server/src/persistence/migrations.ts";
import { saveSettingOverride } from "@secondstaronline/server/src/persistence/settings.ts";
import { saveSpellbook } from "@secondstaronline/server/src/persistence/spells.ts";
import {
  type Bag,
  type Equipment,
  emptyBag,
  NO_EQUIPMENT,
  SKILL_KEYS,
  skillIndex,
  startingCharacter,
} from "@secondstaronline/shared";

import { type BotPlan, isTree } from "./scenarios.ts";

export const PASSWORD = "secret";
const NOW = "2026-11-10T00:00:00.000Z";

export interface StageOptions {
  dbPath: string;
  maps: readonly string[];
  bots: readonly BotPlan[];
  /** Maps where PvP stays on; every other map gets `canPvp` "O" (off). */
  pvpMaps?: readonly string[];
  /** Fill the four monster slots on every map; false empties them. */
  monsters?: boolean;
}

const classOf = (role: BotPlan["role"]): 1 | 2 | 3 => (role === "caster" ? 2 : 1);

/** Writes a fresh database at `dbPath` (any old one is removed). */
export async function stage(options: StageOptions): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${options.dbPath}${suffix}`, { force: true });
  }
  const db = openDatabase(options.dbPath);
  migrate(db);
  // `socketsPerIp` is `SSO_SOCKETS_PER_IP` now (set where the server starts); the stored key is
  // kept for images from before that, which still read it.
  for (const key of ["loginFailsPerIp", "loginFailsPerAccount", "createsPerIp", "socketsPerIp"]) {
    saveSettingOverride(db, key, 0, NOW);
  }
  const hash = await hashPassword(PASSWORD);

  db.transaction(() => {
    // Benchmark geometry is fixed independently of the playable starter landscape, so
    // scenario positions and historical capacity measurements still describe the same arena.
    const ground = Array.from({ length: 12 }, () => Array(17).fill("G1").join(" "));
    const objects = Array.from({ length: 12 }, (_, y) =>
      Array.from({ length: 17 }, (_, x) => (isTree(x, y) ? "S3" : "G3")).join(" "),
    );
    db.run("UPDATE maps SET layer1 = ?, layer2 = ? WHERE mx = 1000 AND my = 992", [
      JSON.stringify(ground),
      JSON.stringify(objects),
    ]);
    // Maps: copies of the seed map (with its monster roster) at each grid name.
    for (const name of options.maps) {
      const m = /^x(\d+)y(\d+)$/.exec(name);
      if (!m || name === "x1000y992") {
        continue;
      }
      const id = Bun.randomUUIDv7();
      db.run(
        `INSERT INTO maps (id, mx, my, slot, title, layer1, layer2, layer3, layer4, created_at, updated_at,
           can_fight, fct_spwn, is_indoors, can_pvp, exit1, exit2, sign1, sign2, sign3, fog_tex, fog_blend, fog_r, fog_g, fog_b)
         SELECT ?, ?, ?, slot, title, layer1, layer2, layer3, layer4, created_at, updated_at,
           can_fight, fct_spwn, is_indoors, can_pvp, exit1, exit2, sign1, sign2, sign3, fog_tex, fog_blend, fog_r, fog_g, fog_b
         FROM maps WHERE mx = 1000 AND my = 992`,
        [id, Number(m[1]), Number(m[2])],
      );
      db.run(
        `INSERT INTO map_slots (map_id, slot, species, live_name, hp, x, y, facing, updated_at, home_x, home_y)
         SELECT ?, slot, species, live_name, hp, x, y, facing, updated_at, home_x, home_y
         FROM map_slots WHERE map_id = (SELECT id FROM maps WHERE mx = 1000 AND my = 992)`,
        [id],
      );
    }

    // The seed map's roster is one Slime. Fill the other three slots (the most 1.6 had on a map)
    // with the same species, so a hunting party has something to fight.
    db.run(
      options.monsters
        ? "UPDATE map_slots SET species = 'Slime' WHERE slot IN (2, 3, 4) AND species IS NULL"
        : "UPDATE map_slots SET species = NULL, live_name = NULL, hp = 0",
    );

    // The seed map ships with PvP on. A crowd of walkers is not a brawl: a Fireball that kills a
    // player is announced to everyone online, and that storm would swamp what is being measured.
    for (const name of options.maps) {
      const [mx, my] = mapXY(name);
      db.run("UPDATE maps SET can_pvp = ? WHERE mx = ? AND my = ?", [
        options.pvpMaps?.includes(name) ? "X" : "O",
        mx,
        my,
      ]);
    }

    for (const bot of options.bots) {
      const account = insertAccount(db, { username: bot.name, passwordHash: hash, now: NOW });
      const mapId = (
        db.query("SELECT id FROM maps WHERE mx = ? AND my = ?").get(...mapXY(bot.map)) as {
          id: string;
        }
      ).id;
      const start = startingCharacter({
        name: bot.name,
        sex: 1,
        head: 1,
        classCode: classOf(bot.role),
        str: 11,
        sta: 11,
        int: 11,
        wis: 11,
        dex: 11,
      });
      const id = insertCharacter(db, {
        accountId: account.id,
        start,
        position: { mapId, x: bot.x, y: bot.y, facing: "S" },
        now: NOW,
      });
      kit(db, id, bot);
    }
  })();
  // Statements prepared by the persistence functions stay open until collected, and an open
  // handle would lock the file against the server's `PRAGMA journal_mode = WAL`.
  Bun.gc(true);
  db.close();
}

function mapXY(name: string): [number, number] {
  const m = /^x(\d+)y(\d+)$/.exec(name);
  return [Number(m?.[1]), Number(m?.[2])];
}

/** Each role's equipment, spells, skills and goods. */
function kit(db: ReturnType<typeof openDatabase>, id: string, bot: BotPlan): void {
  const equip: Equipment = { ...NO_EQUIPMENT };
  const bag: Bag = emptyBag();
  let gold = 0;
  switch (bot.role) {
    case "fighter":
    case "pvp":
      equip.weapon = "Knife";
      db.run("UPDATE characters SET hp = 300, hp_max = 300 WHERE id = ?", [id]);
      break;
    case "caster":
      db.run(
        "UPDATE characters SET dex = 20, sp = 200, sp_max = 200, hp = 300, hp_max = 300 WHERE id = ?",
        [id],
      );
      saveSpellbook(db, id, [bot.spell ?? "Fireball"]);
      bag[0] = { item: "Red Crystal", qty: 5000 };
      break;
    case "gatherer":
      equip.weapon = "Axe";
      db.run(
        "INSERT OR REPLACE INTO character_skills (character_id, skill, value) VALUES (?, ?, 5)",
        [id, SKILL_KEYS[skillIndex("Lumberjacking")] ?? "Lumberjacking"],
      );
      break;
    case "trader":
      gold = 100;
      bag[0] = { item: "Apple", qty: 3 };
      break;
    case "walker":
      break;
  }
  if (gold > 0 || bag.some((l) => l) || equip.weapon !== NO_EQUIPMENT.weapon) {
    saveInventory(db, id, { gold, bag, equip }, NOW);
  }
}
