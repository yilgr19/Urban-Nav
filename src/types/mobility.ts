/** Coordenada WGS84 (PostGIS / GeoJSON compatible). */
export type LatLng = { latitude: number; longitude: number };

/** GeoJSON LineString (coordenadas [lon, lat]). */
export type GeoJSONLineString = {
  type: "LineString";
  coordinates: [number, number][];
};

/** Feature con geometría de corredor (p. ej. desde PostGIS / QGIS). */
export type RouteGeoJSONFeature = {
  type: "Feature";
  geometry: GeoJSONLineString;
  properties?: {
    id?: string;
    code?: string;
    name?: string;
    headwayMinutes?: number;
    fullLineDurationMinutes?: number;
    color?: string;
  };
};

/** Ruta de buseta digitalizada + metadatos para tiempos sin GPS en vivo. */
export type BusRoute = {
  id: string;
  code: string;
  name: string;
  /** Orden de vértices a lo largo del sentido de servicio */
  path: LatLng[];
  color?: string;
  /** Frecuencia: minutos entre unidades (espera ≈ mitad del intervalo). */
  headwayMinutes: number;
  /** Duración punta a punta del trazado digitalizado (minutos). */
  fullLineDurationMinutes: number;
};

export type BusStop = {
  id: string;
  name: string;
  coordinate: LatLng;
  routeIds: string[];
};

export type TripWalkSegment = {
  kind: "walk";
  coordinates: LatLng[];
  distanceMeters: number;
  durationMinutes: number;
};

export type TripBusSegment = {
  kind: "bus";
  routeId: string;
  routeCode: string;
  coordinates: LatLng[];
  distanceMeters: number;
  durationMinutes: number;
};

/** Plan completo: caminata → bus → caminata, con abordaje y bajada proyectados sobre la polilínea. */
export type FullTripPlan = {
  route: BusRoute;
  /** Punto sobre la ruta más cercano al usuario (abordaje). */
  boardingPoint: LatLng;
  /** Punto sobre la ruta más cercano al destino (bajada). */
  alightingPoint: LatLng;
  walkToBoard: TripWalkSegment;
  bus: TripBusSegment;
  walkFromAlight: TripWalkSegment;
  /** Espera promedio estimada (sin arribo en vivo): headway/2. */
  estimatedWaitMinutes: number;
  /** Suma: caminar a bordo + espera + bus + caminar a destino. */
  totalTripMinutes: number;
  /** Distancia recorrida en buseta sobre el trazado (m). */
  busPathMeters: number;
};

export type TripPlannerResult =
  | { ok: true; plan: FullTripPlan }
  | { ok: false; reason: string };
