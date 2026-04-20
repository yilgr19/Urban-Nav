import type { LatLng } from "../types/mobility";

const R_EARTH_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Proyección de p sobre el segmento ab; t en [0,1] sobre ab. */
function nearestOnSegment(
  a: LatLng,
  b: LatLng,
  p: LatLng,
): { point: LatLng; t: number; dist: number } {
  const ax = a.longitude;
  const ay = a.latitude;
  const bx = b.longitude;
  const by = b.latitude;
  const px = p.longitude;
  const py = p.latitude;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = {
    latitude: ay + t * aby,
    longitude: ax + t * abx,
  };
  return { point, t, dist: haversineMeters(p, point) };
}

export type PolylineHit = {
  point: LatLng;
  segmentIndex: number;
  /** Distancia acumulada desde el inicio de la polilínea hasta `point` (m). */
  cumDistMeters: number;
  /** Distancia perpendicular (aprox.) desde el punto consultado a la polilínea en ese tramo. */
  distToPolylineMeters: number;
};

/** Punto más cercano sobre la polilínea (vértices conectados en orden). */
export function nearestPointOnPolyline(
  path: LatLng[],
  p: LatLng,
): PolylineHit | null {
  if (path.length < 2) return null;
  let best: PolylineHit | null = null;
  let prefix = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const segLen = haversineMeters(a, b);
    const { point, t, dist } = nearestOnSegment(a, b, p);
    const cum = prefix + t * segLen;
    if (!best || dist < best.distToPolylineMeters) {
      best = {
        point,
        segmentIndex: i,
        cumDistMeters: cum,
        distToPolylineMeters: dist,
      };
    }
    prefix += segLen;
  }
  return best;
}

/** Longitud total de la polilínea (m). */
export function polylineLengthMeters(path: LatLng[]): number {
  if (path.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < path.length - 1; i++) {
    sum += haversineMeters(path[i]!, path[i + 1]!);
  }
  return sum;
}

/**
 * Extrae la sub-polilínea entre dos posiciones sobre el trazado,
 * en el sentido creciente de `cumDistMeters` (de `from` a `to`).
 */
export function slicePolylineByHits(
  path: LatLng[],
  from: PolylineHit,
  to: PolylineHit,
): LatLng[] {
  if (from.cumDistMeters > to.cumDistMeters - 0.5) return [];
  if (from.segmentIndex === to.segmentIndex) {
    return [from.point, to.point];
  }
  const out: LatLng[] = [from.point];
  for (let v = from.segmentIndex + 1; v <= to.segmentIndex; v++) {
    out.push(path[v]!);
  }
  const last = out[out.length - 1]!;
  if (haversineMeters(last, to.point) > 2) {
    out.push(to.point);
  } else {
    out[out.length - 1] = to.point;
  }
  return out;
}
