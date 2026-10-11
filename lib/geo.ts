/**
 * Map projection for the resort map. At the scale of one state an equirectangular
 * projection is accurate enough, provided longitude is squeezed by cos(latitude):
 * at 41 degrees north a degree of longitude is only three quarters as long as a
 * degree of latitude, and ignoring that would stretch Utah sideways.
 */

export interface Bounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface Projection {
  width: number;
  height: number;
  project: (lat: number, lon: number) => [number, number];
  /** Pixels per kilometer, for a scale bar. */
  pxPerKm: number;
}

const KM_PER_DEGREE = 111.32;

/** Fits `bounds` into a box `width` pixels wide and returns the height that keeps shapes true. */
export function projection(bounds: Bounds, width: number): Projection {
  const squeeze = Math.cos((((bounds.south + bounds.north) / 2) * Math.PI) / 180);
  const spanX = (bounds.east - bounds.west) * squeeze;
  const spanY = bounds.north - bounds.south;
  const scale = width / spanX;
  return {
    width,
    height: spanY * scale,
    project: (lat, lon) => [(lon - bounds.west) * squeeze * scale, (bounds.north - lat) * scale],
    pxPerKm: scale / KM_PER_DEGREE,
  };
}

export function contains(bounds: Bounds, lat: number, lon: number): boolean {
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

/** Great-circle distance in kilometers (the same formula as the dbt macro). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}
