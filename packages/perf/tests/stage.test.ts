import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "@secondstaronline/server/src/persistence/database.ts";
import { findMapByCoords } from "@secondstaronline/server/src/persistence/maps.ts";

import { TOWN } from "../src/scenarios.ts";
import { stage } from "../src/stage.ts";

test("staging keeps the benchmark arena independent of the playable lake and forest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sso-stage-"));
  try {
    const path = join(dir, "world.sqlite");
    await stage({ dbPath: path, maps: [TOWN, "x1001y992"], bots: [] });
    const db = openDatabase(path);
    try {
      const home = findMapByCoords(db, 1000, 992)!;
      const next = findMapByCoords(db, 1001, 992)!;
      expect(new Set(home.layers[0].join(" ").split(" "))).toEqual(new Set(["G1"]));
      expect(home.layers[1][1]!.split(" ")[1]).toBe("S3");
      expect(home.layers[1][3]!.split(" ")[5]).toBe("G3");
      expect(next.layers).toEqual(home.layers);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
