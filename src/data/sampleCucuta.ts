import type { BusRoute, BusStop, LatLng, RouteGeoJSONFeature } from "../types/mobility";

/** Convierte Feature GeoJSON (LineString lon/lat) a `BusRoute.path` (lat/lng). */
export function lineStringToPath(geometry: {
  type: "LineString";
  coordinates: [number, number][];
}): LatLng[] {
  return geometry.coordinates.map(([lon, lat]) => ({
    latitude: lat,
    longitude: lon,
  }));
}

/**
 * Rutas de buseta (GeoJSON). Añade aquí Features cuando tengas el trazado en QGIS / PostGIS.
 * Cada Feature: LineString en EPSG:4326, properties: id, code, name, headwayMinutes, fullLineDurationMinutes, color.
 */
export const SAMPLE_ROUTES_GEOJSON: RouteGeoJSONFeature[] = [];

function featureToBusRoute(f: RouteGeoJSONFeature): BusRoute {
  const p = f.properties ?? {};
  const id = p.id ?? "unknown";
  return {
    id,
    code: p.code ?? id,
    name: p.name ?? id,
    path: lineStringToPath(f.geometry),
    color: p.color,
    headwayMinutes: p.headwayMinutes ?? 12,
    fullLineDurationMinutes: p.fullLineDurationMinutes ?? 30,
  };
}

/** Rutas para el planificador (derivadas de `SAMPLE_ROUTES_GEOJSON`). */
export const SAMPLE_ROUTES: BusRoute[] =
  SAMPLE_ROUTES_GEOJSON.map(featureToBusRoute);

/**
 * Paradas con `routeIds` que apuntan a `id` de rutas en SAMPLE_ROUTES_GEOJSON.
 * Rellena cuando existan rutas.
 */
export const SAMPLE_STOPS: BusStop[] = [];

/**
 * Lugares / destinos en Cúcuta (búsqueda local y chips “Destinos rápidos”).
 * Añade entradas: { label: "Nombre", coordinate: { latitude, longitude } }
 */
export const SAMPLE_DESTINATIONS: { label: string; coordinate: LatLng }[] = [];
