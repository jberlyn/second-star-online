/** Fresh-install landscape, applied in the original map migration's transaction. */
import { seedMapData } from "@secondstaronline/data";

/** Quote data as SQL literals; map titles may contain apostrophes. */
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Existing databases skip the original migration, so their maps are never replaced. */
export function seedMapSql(): string {
  const assignments = seedMapData.layers.map(
    (layer, i) => `layer${i + 1} = ${literal(JSON.stringify(layer))}`,
  );
  return `UPDATE maps SET title = ${literal(seedMapData.title)}, ${assignments.join(", ")} WHERE mx = 1000 AND my = 992;`;
}
