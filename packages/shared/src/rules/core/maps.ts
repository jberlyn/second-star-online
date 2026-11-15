/**
 * Map names.
 *
 * A map's name is its grid position: `x<MX>y<MY>`. Walking off an edge moves MX or MY by one. The
 * original splits the map name on "y", strips the leading letter and takes `integer` of each part;
 * negative coordinates exist (`x0y-1` in the archive).
 *
 * House maps (`xH1…yH1…`) are not grid maps and parse as null here: they have no neighbours.
 * `parseHouseMapName` reads them.
 */

export interface MapCoords {
  mx: number;
  my: number;
}

const MAP_NAME_RE = /^x(-?\d+)y(-?\d+)$/i;

export function parseMapName(name: string): MapCoords | null {
  const m = MAP_NAME_RE.exec(name);
  if (!m?.[1] || !m[2]) {
    return null;
  }
  return { mx: Number.parseInt(m[1], 10), my: Number.parseInt(m[2], 10) };
}

export function mapName(mx: number, my: number): string {
  return `x${mx}y${my}`;
}

/** The grid neighbour across an edge, or null for a non-grid map. */
export function neighbourMapName(name: string, dmx: number, dmy: number): string | null {
  const c = parseMapName(name);
  return c ? mapName(c.mx + dmx, c.my + dmy) : null;
}

/**
 * A house interior: the map behind an outdoor map's Exit (slot 1) or Exit2 (slot 2), named
 * `xH<slot><mx>yH<slot><my>` after the outdoor map. Its exit field holds `H<slot><mx>` and
 * `H<slot><my>`.
 */
export interface HouseMapCoords extends MapCoords {
  slot: 1 | 2;
}

const HOUSE_NAME_RE = /^xH([12])(-?\d+)yH([12])(-?\d+)$/i;

export function houseMapName(mx: number, my: number, slot: 1 | 2): string {
  return `xH${slot}${mx}yH${slot}${my}`;
}

export function parseHouseMapName(name: string): HouseMapCoords | null {
  const m = HOUSE_NAME_RE.exec(name);
  if (!m?.[1] || !m[2] || m[3] !== m[1] || !m[4]) {
    return null;
  }
  return {
    mx: Number.parseInt(m[2], 10),
    my: Number.parseInt(m[4], 10),
    slot: m[1] === "1" ? 1 : 2,
  };
}

/** A map row's name: the grid name, or the house interior's for slot 1 or 2. */
export function anyMapName(mx: number, my: number, slot: 0 | 1 | 2): string {
  return slot === 0 ? mapName(mx, my) : houseMapName(mx, my, slot);
}
