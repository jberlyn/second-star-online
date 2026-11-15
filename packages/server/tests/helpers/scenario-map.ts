/** Fixed terrain for behavioral scenarios, independent of the production starter world. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { seedMapData } from "@secondstaronline/data";

import type { Db } from "../../src/persistence/database.ts";
import { findMapByCoords } from "../../src/persistence/maps.ts";

const scenario = JSON.parse(
  readFileSync(join(import.meta.dir, "../fixtures/scenario-map.json"), "utf8"),
) as { title: string; layers: string[][] };

/** Preserve worlds edited by a test when its server restarts. */
export function prepareScenarioMap(db: Db): void {
  const current = findMapByCoords(db, 1000, 992);
  if (
    current?.title !== seedMapData.title ||
    JSON.stringify(current.layers) !== JSON.stringify(seedMapData.layers)
  ) {
    return;
  }
  db.run("UPDATE maps SET title = ?, layer1 = ?, layer2 = ?, layer3 = ?, layer4 = ? WHERE id = ?", [
    scenario.title,
    ...scenario.layers.map((layer) => JSON.stringify(layer)),
    current.id,
  ]);
}
