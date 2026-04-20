import Constants from "expo-constants";
import type { LatLng } from "../types/mobility";
import { SAMPLE_DESTINATIONS, SAMPLE_STOPS } from "../data/sampleCucuta";

/** Límite aproximado Cúcuta (sesgo de búsqueda). */
const BOUNDS = {
  south: 7.82,
  north: 7.98,
  west: -72.58,
  east: -72.42,
};

export type GeocodeHit = {
  label: string;
  coordinate: LatLng;
};

/** Resultado de búsqueda: coordenada o texto explicando por qué falló. */
export type ResolveDestinationResult = {
  hit: GeocodeHit | null;
  /** Mensaje para mostrar si `hit` es null (configuración / error de API). */
  diagnostic?: string;
};

/**
 * Atribución requerida al usar datos de búsqueda Nominatim / OpenStreetMap.
 * Mostrar cerca del buscador de direcciones (p. ej. pantalla Planificar).
 */
export const OPENSTREETMAP_GEOCODING_ATTRIBUTION =
  "Lugares por nombre: © OpenStreetMap contributors · Nominatim";

/** Identificación de la app para la política de uso de Nominatim (no genérico). */
const NOMINATIM_USER_AGENT =
  "UrbanNav/0.1 (com.urbannav.cucuta; geocoding; Cúcuta CO)";

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";

type NominatimItem = {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
};

function nominatimQueryParams(
  query: string,
  opts: { viewboxBounded: "0" | "1" | null },
): URLSearchParams {
  const params = new URLSearchParams({
    q: normalizeQueryForCucuta(query),
    format: "json",
    limit: "8",
    addressdetails: "0",
    "accept-language": "es,en",
    countrycodes: "co",
  });
  if (opts.viewboxBounded !== null) {
    params.set(
      "viewbox",
      `${BOUNDS.west},${BOUNDS.north},${BOUNDS.east},${BOUNDS.south}`,
    );
    params.set("bounded", opts.viewboxBounded);
  }
  return params;
}

function pickBestNominatimHit(items: NominatimItem[]): GeocodeHit | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0),
  );
  const top = sorted[0]!;
  const lat = Number.parseFloat(top.lat);
  const lon = Number.parseFloat(top.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    label: top.display_name,
    coordinate: { latitude: lat, longitude: lon },
  };
}

async function fetchNominatim(
  params: URLSearchParams,
): Promise<
  | { kind: "hit"; hit: GeocodeHit }
  | { kind: "empty" }
  | { kind: "rate_limit" }
  | { kind: "http"; status: number }
> {
  const url = `${NOMINATIM_SEARCH}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_USER_AGENT,
    },
  });
  if (res.status === 429) return { kind: "rate_limit" };
  if (!res.ok) return { kind: "http", status: res.status };
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return { kind: "empty" };
  const hit = pickBestNominatimHit(data as NominatimItem[]);
  if (!hit) return { kind: "empty" };
  return { kind: "hit", hit };
}

/**
 * Geocoding gratuito vía OpenStreetMap Nominatim (sin API key).
 * Uso razonable: ~1 petición/s; no abusar en producción masiva (mejor proxy propio).
 */
async function callNominatim(query: string): Promise<
  | { ok: true; hit: GeocodeHit }
  | { ok: false; diagnostic: string }
> {
  const q = query.trim();
  if (!q) {
    return { ok: false, diagnostic: "Escribe un lugar o dirección." };
  }

  const attempts: { viewboxBounded: "0" | "1" | null }[] = [
    { viewboxBounded: "1" },
    { viewboxBounded: "0" },
    { viewboxBounded: null },
  ];

  for (const att of attempts) {
    const result = await fetchNominatim(nominatimQueryParams(q, att));
    if (result.kind === "hit") return { ok: true, hit: result.hit };
    if (result.kind === "rate_limit") {
      return {
        ok: false,
        diagnostic:
          "OpenStreetMap (Nominatim) pidió reducir la velocidad: espera unos segundos entre búsquedas (límite del servicio público gratuito).",
      };
    }
    if (result.kind === "http" && result.status >= 500) {
      return {
        ok: false,
        diagnostic: `Nominatim no está disponible ahora (HTTP ${result.status}). Reintenta más tarde.`,
      };
    }
  }

  return {
    ok: false,
    diagnostic:
      "OpenStreetMap no encontró ese texto en Colombia. Prueba otra redacción, «Estadio …, Cúcuta», o mantén pulsado el mapa. Si tienes clave en app.json, también se intentará Google Geocoding.",
  };
}

function getGeocodingKey(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { googleMapsGeocodingKey?: string }
    | undefined;
  const k = extra?.googleMapsGeocodingKey?.trim();
  if (k && k !== "YOUR_GEOCODING_API_KEY") return k;
  return undefined;
}

function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeQuery(s: string): string {
  return foldAccents(s.toLowerCase().trim()).replace(/\s+/g, " ");
}

/**
 * Busca en paradas y destinos rápidos del proyecto (sin internet / sin Google).
 */
export function findLocalGeocodeHit(query: string): GeocodeHit | null {
  const n = normalizeQuery(query);
  if (!n) return null;

  const candidates: { label: string; coordinate: LatLng }[] = [
    ...SAMPLE_DESTINATIONS.map((d) => ({
      label: d.label,
      coordinate: d.coordinate,
    })),
    ...SAMPLE_STOPS.map((s) => ({
      label: s.name,
      coordinate: s.coordinate,
    })),
  ];

  for (const c of candidates) {
    const labelNorm = normalizeQuery(c.label);
    if (labelNorm === n || labelNorm.includes(n) || n.includes(labelNorm)) {
      return { label: c.label, coordinate: c.coordinate };
    }
  }

  const words = n.split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 0) {
    for (const c of candidates) {
      const labelNorm = normalizeQuery(c.label);
      if (words.every((w) => labelNorm.includes(w))) {
        return { label: c.label, coordinate: c.coordinate };
      }
    }
  }

  return null;
}

function normalizeQueryForCucuta(query: string): string {
  const q = query.trim();
  if (!q) return q;
  const lower = q.toLowerCase();
  if (
    lower.includes("cúcuta") ||
    lower.includes("cucuta") ||
    lower.includes("colombia") ||
    lower.includes("norte de santander")
  ) {
    return q;
  }
  return `${q}, Cúcuta, Norte de Santander, Colombia`;
}

function explainGoogleGeocodeFailure(status: string, errorMessage?: string): string {
  const detail = errorMessage ? ` Detalle: ${errorMessage}` : "";
  switch (status) {
    case "REQUEST_DENIED":
      return (
        "Google devolvió REQUEST_DENIED: la clave no tiene permiso para Geocoding API, está mal copiada, falta facturación en el proyecto, o las restricciones de la clave bloquean esta petición (p. ej. solo Android/iOS sin permitir la API REST)." +
        detail
      );
    case "INVALID_REQUEST":
      return "Petición inválida a Geocoding." + detail;
    case "OVER_QUERY_LIMIT":
    case "OVER_DAILY_LIMIT":
      return "Cuota de Geocoding agotada o demasiadas peticiones." + detail;
    case "ZERO_RESULTS":
      return "Google no encontró resultados para ese texto en la zona.";
    default:
      return `Geocoding respondió: ${status}.${detail}`;
  }
}

type GoogleGeocodeJson = {
  status: string;
  error_message?: string;
  results?: {
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }[];
};

async function callGoogleGeocode(query: string): Promise<
  | { ok: true; hit: GeocodeHit }
  | { ok: false; status: string; error_message?: string }
> {
  const key = getGeocodingKey();
  const q = query.trim();
  if (!key || !q) {
    return { ok: false, status: "MISSING_KEY" };
  }

  const address = normalizeQueryForCucuta(q);
  const params = new URLSearchParams({
    address,
    key,
    region: "co",
    bounds: `${BOUNDS.south},${BOUNDS.west}|${BOUNDS.north},${BOUNDS.east}`,
  });

  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    return {
      ok: false,
      status: "HTTP_ERROR",
      error_message: `Red: ${res.status}`,
    };
  }

  const data = (await res.json()) as GoogleGeocodeJson;
  if (data.status === "OK" && data.results?.[0]) {
    const r = data.results[0];
    return {
      ok: true,
      hit: {
        label: r.formatted_address,
        coordinate: {
          latitude: r.geometry.location.lat,
          longitude: r.geometry.location.lng,
        },
      },
    };
  }

  return {
    ok: false,
    status: data.status,
    error_message: data.error_message,
  };
}

/**
 * 1) Lista local (`sampleCucuta.ts`).
 * 2) OpenStreetMap Nominatim (gratuito, sin clave; atribución en UI).
 * 3) Opcional: Google Geocoding si `app.json` → `extra.googleMapsGeocodingKey` está configurada (respaldo / mayor precisión).
 */
export async function resolveDestinationQuery(
  query: string,
): Promise<ResolveDestinationResult> {
  const local = findLocalGeocodeHit(query);
  if (local) {
    return { hit: local };
  }

  const osm = await callNominatim(query);
  if (osm.ok) {
    return { hit: osm.hit };
  }

  const key = getGeocodingKey();
  if (key) {
    const g = await callGoogleGeocode(query);
    if (g.ok) {
      return { hit: g.hit };
    }
    if (g.status === "MISSING_KEY") {
      return {
        hit: null,
        diagnostic:
          `${osm.diagnostic} Tras Nominatim, Google falló: falta clave en app.json.`,
      };
    }
    return {
      hit: null,
      diagnostic: `${osm.diagnostic} Google: ${explainGoogleGeocodeFailure(g.status, g.error_message)}`,
    };
  }

  return { hit: null, diagnostic: osm.diagnostic };
}

export async function geocodeAddress(query: string): Promise<GeocodeHit | null> {
  const { hit } = await resolveDestinationQuery(query);
  return hit;
}
