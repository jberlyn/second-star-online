/**
 * House blueprints and the house list: 1.6's blueprint file per owner and map, and its
 * `houselist.txt`, as rows. Callers own the transaction.
 */
import type { HouseListEntry } from "@secondstaronline/shared";

import type { HouseRecord } from "../systems/world/world.ts";
import type { Db } from "./database.ts";

type Placed = { item: string; x: number; y: number };

const placed = (text: string): Placed | null => (text === "" ? null : (JSON.parse(text) as Placed));

/** Every blueprint, with its owner's name. */
export function loadHouses(db: Db): HouseRecord[] {
  return db
    .query<
      {
        owner_id: string;
        name: string;
        map_name: string;
        item1: string;
        item2: string;
        tiles: string;
        interior: string;
      },
      []
    >(
      `SELECT h.owner_id, c.name, h.map_name, h.item1, h.item2, h.tiles, h.interior
       FROM houses h JOIN characters c ON c.id = h.owner_id ORDER BY h.updated_at`,
    )
    .all()
    .map((r) => ({
      ownerId: r.owner_id,
      ownerName: r.name,
      map: r.map_name,
      item1: placed(r.item1),
      item2: placed(r.item2) as Placed,
      tiles: JSON.parse(r.tiles) as HouseRecord["tiles"],
      interior: r.interior,
    }));
}

export function loadHouseList(db: Db): HouseListEntry[] {
  return db
    .query<{ owner_id: string; owner_name: string; map_name: string; month: string }, []>(
      "SELECT owner_id, owner_name, map_name, month FROM house_list ORDER BY position",
    )
    .all()
    .map((r) => ({
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      map: r.map_name,
      month: r.month,
    }));
}

/** Rewrites both tables (`file(...).write`). */
export function saveHouses(
  db: Db,
  houses: Iterable<HouseRecord>,
  list: readonly HouseListEntry[],
  now: string,
): void {
  db.query("DELETE FROM houses").run();
  const ins = db.prepare(
    "INSERT INTO houses (owner_id, map_name, item1, item2, tiles, interior, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const h of houses) {
    ins.run(
      h.ownerId,
      h.map,
      h.item1 ? JSON.stringify(h.item1) : "",
      JSON.stringify(h.item2),
      JSON.stringify(h.tiles),
      h.interior,
      now,
    );
  }
  db.query("DELETE FROM house_list").run();
  const row = db.prepare(
    "INSERT INTO house_list (position, owner_id, owner_name, map_name, month) VALUES (?, ?, ?, ?, ?)",
  );
  list.forEach((e, i) => {
    row.run(i + 1, e.ownerId, e.ownerName, e.map, e.month);
  });
}
