/**
 * Art and newspaper persistence (real SQL on in-memory SQLite): art and newspaper rows
 * (migration 20261107_20).
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { addArt, loadArt } from "../src/persistence/art.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadNewspaper, saveNewspaper } from "../src/persistence/newspapers.ts";
import { makePng } from "./helpers/png.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
const T = "2026-11-07T00:00:00.000Z";
beforeEach(() => {
  db = openDatabase();
  migrate(db);
});

describe("art rows", () => {
  test("a PNG round-trips byte for byte with its kind and author", () => {
    const png = makePng(64, 64, { noise: 7 });
    const id = addArt(db, "painting", "Alice", png, T, rngByN({ 9999999: [42] }));
    expect(id).toBe(42);
    const row = loadArt(db, 42);
    expect(row?.kind).toBe("painting");
    expect(row?.author).toBe("Alice");
    expect(Buffer.from(row?.png ?? []).equals(Buffer.from(png))).toBe(true);
  });
  test("a taken id is drawn again, never overwritten", () => {
    const rng = rngByN({ 9999999: [5, 5, 6] });
    const a = addArt(db, "painting", "Alice", makePng(), T, rng);
    const b = addArt(db, "photo", "Bob", makePng(), T, rng);
    expect([a, b]).toEqual([5, 6]);
    expect(loadArt(db, 5)?.author).toBe("Alice");
    expect(loadArt(db, 6)?.kind).toBe("photo");
  });
  test("a stuck draw falls back to the lowest free id", () => {
    const stuck = rngByN(); // random(n) is always n
    const ids = [1, 2, 3].map(() => addArt(db, "photo", "Al", makePng(), T, stuck));
    expect(ids).toEqual([9999999, 1, 2]);
  });
  test("a missing id is null and the kind is checked by the table", () => {
    expect(loadArt(db, 99)).toBeNull();
    expect(() =>
      db.run(
        "INSERT INTO art (id, kind, author, png, created_at) VALUES (1, 'x', 'a', x'00', 't')",
      ),
    ).toThrow();
  });
});

describe("newspaper rows", () => {
  const f = (n: string) => ({
    photos: [`${n}1`, `${n}2`, `${n}3`],
    texts: ["a", "b", "c", "d", "e", "f"].map((x) => n + x),
  });
  test("none is null; a save is read back", () => {
    expect(loadNewspaper(db, "King")).toBeNull();
    saveNewspaper(db, "King", f("k"), T);
    expect(loadNewspaper(db, "King")).toEqual(f("k"));
  });
  test("an author's paper upserts and matches ignoring case", () => {
    saveNewspaper(db, "King", f("k"), T);
    saveNewspaper(db, "king", f("z"), T);
    expect(loadNewspaper(db, "KING")).toEqual(f("z"));
    expect(db.query("SELECT COUNT(*) AS n FROM newspapers").get()).toEqual({ n: 1 });
  });
});
