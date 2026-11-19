// 距離・方角・点がポリゴンの中にあるか。外部のライブラリを使わず、通信なしで動く。
export type Point = { lat: number; lon: number };
type Ring = number[][];
export type PolygonGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 2点の直線距離（メートル）。 */
export function distanceMeters(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** a から見た b の方位角（度・北が0で時計回り）。 */
export function bearingDegrees(a: Point, b: Point): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const DIRECTIONS = [
  { text: '北', kana: 'キタ' }, { text: '北東', kana: 'ホクトウ' }, { text: '東', kana: 'ヒガシ' }, { text: '南東', kana: 'ナントウ' },
  { text: '南', kana: 'ミナミ' }, { text: '南西', kana: 'ナンセイ' }, { text: '西', kana: 'ニシ' }, { text: '北西', kana: 'ホクセイ' },
] as const;

/** 方位角を8方位に。 */
export function direction8(deg: number): (typeof DIRECTIONS)[number] {
  return DIRECTIONS[Math.round(deg / 45) % 8];
}

function inRing(p: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(p: Point, rings: Ring[]): boolean {
  if (!rings.length || !inRing(p, rings[0])) return false;
  return !rings.slice(1).some(hole => inRing(p, hole));
}

/** 点がポリゴン（穴あき・複数可）の中にあるか。 */
export function contains(geometry: PolygonGeometry, p: Point): boolean {
  return geometry.type === 'Polygon'
    ? inPolygon(p, geometry.coordinates)
    : geometry.coordinates.some(poly => inPolygon(p, poly));
}

/** ポリゴンの外接矩形 [minLon, minLat, maxLon, maxLat]。 */
export function bbox(geometry: PolygonGeometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
