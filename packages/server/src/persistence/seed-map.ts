/** Fresh-install landscape, applied in the original map migration's transaction. */
import { jailMapData, seedMapData } from "@secondstaronline/data";

/** Quote data as SQL literals; map titles may contain apostrophes. */
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Existing databases skip the original migration, so their maps are never replaced. */
export function seedMapSql(): string {
  const assignments = seedMapData.layers.map(
    (layer, i) => `layer${i + 1} = ${literal(JSON.stringify(layer))}`,
  );
  return `UPDATE maps SET title = ${literal(seedMapData.title)}, ${assignments.join(", ")} WHERE mx = 1000 AND my = 992;`;
}

/** Add a jail on fresh and existing servers, preserving any operator-authored jail. */
export function jailMapSql(): string {
  const layers = jailMapData.layers.map((layer) => literal(JSON.stringify(layer)));
  return `INSERT INTO maps (id, mx, my, slot, title, layer1, layer2, layer3, layer4,
    can_fight, fct_spwn, is_indoors, can_pvp, created_at, updated_at)
    SELECT '019a87e0-0000-7000-8000-000000000000', 0, 0, 0, ${literal(jailMapData.title)},
    ${layers.join(", ")}, 'O', 'X', 'O', 'O', '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z'
    WHERE NOT EXISTS (SELECT 1 FROM maps WHERE mx = 0 AND my = 0 AND slot = 0);`;
}
