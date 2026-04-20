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
 * Atribución: los proveedores usan datos OpenStreetMap (obligatorio mencionar © OSM).
 * La app puede resolver vía LocationIQ y/o Nominatim.
 */
export const GEOCODING_DATA_ATTRIBUTION =
  "Búsqueda de lugares: © OpenStreetMap contributors · LocationIQ / Nominatim";
/** @deprecated Usa GEOCODING_DATA_ATTRIBUTION */
export const OPENSTREETMAP_GEOCODING_ATTRIBUTION = GEOCODING_DATA_ATTRIBUTION;

/** Identificación de la app para la política de uso de Nominatim (no genérico). */
const NOMINATIM_USER_AGENT =
  "UrbanNav/0.1 (com.urbannav.cucuta; geocoding; Cúcuta CO)";

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";

/**
 * El servidor público de Nominatim exige ~1 petición por segundo por cliente.
 * Sin esta cola, autocompletar + «Buscar» lanzan varias peticiones seguidas y
 * el servidor responde 429 (demasiadas solicitudes).
 */
const NOMINATIM_MIN_MS_BETWEEN_REQUESTS = 1150;
let nominatimNextSlotAt = 0;
let nominatimRequestChain: Promise<unknown> = Promise.resolve();

/** Hermes/Android no expone `DOMException`; usar Error con nombre AbortError. */
function createAbortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function nominatimFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const signal = init?.signal ?? undefined;
  const run = async (): Promise<Response> => {
    const now = Date.now();
    const wait = Math.max(0, nominatimNextSlotAt - now);
    if (wait > 0) {
      await delay(wait, signal);
    }
    if (signal?.aborted) {
      throw createAbortError();
    }
    try {
      return await fetch(url, { ...init, signal });
    } finally {
      nominatimNextSlotAt = Date.now() + NOMINATIM_MIN_MS_BETWEEN_REQUESTS;
    }
  };

  const task = nominatimRequestChain.then(run, run);
  nominatimRequestChain = task.then(
    () => {},
    () => {},
  );
  return task;
}

type NominatimItem = {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
};

function nominatimQueryParams(
  query: string,
  opts: { viewboxBounded: "0" | "1" | null; limit?: number },
): URLSearchParams {
  const lim = Math.min(50, Math.max(1, opts.limit ?? 10));
  const params = new URLSearchParams({
    q: normalizeQueryForCucuta(query),
    format: "json",
    limit: String(lim),
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

/**
 * Convierte la respuesta de Nominatim manteniendo el orden original.
 * La API ya ordena por relevancia al texto buscado; si reordenáramos solo por
 * `importance`, los barrios y ciudades ganan y los POIs pequeños (restaurantes,
 * tiendas, etc.) quedarían fuera de los primeros resultados.
 */
function nominatimItemsToHits(items: NominatimItem[], max: number): GeocodeHit[] {
  if (items.length === 0 || max <= 0) return [];
  const out: GeocodeHit[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const lat = Number.parseFloat(item.lat);
    const lon = Number.parseFloat(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: item.display_name,
      coordinate: { latitude: lat, longitude: lon },
    });
    if (out.length >= max) break;
  }
  return out;
}

function pickBestNominatimHit(items: NominatimItem[]): GeocodeHit | null {
  return nominatimItemsToHits(items, 1)[0] ?? null;
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
  const res = await nominatimFetch(url, {
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
      "Último intento (Nominatim, servicio público): sin resultados en Colombia. Si ya usaste LocationIQ/Google arriba, el texto puede ser demasiado ambiguo o no estar en el mapa.",
  };
}

/**
 * Sugerencias locales (destinos y paradas en `sampleCucuta`) mientras escribes.
 */
export function collectLocalGeocodeSuggestions(
  query: string,
  max = 6,
): GeocodeHit[] {
  const n = normalizeQuery(query);
  if (!n) return [];

  type Scored = { hit: GeocodeHit; score: number };
  const scored: Scored[] = [];

  for (const c of localGeocodeCandidates()) {
    const labelNorm = normalizeQuery(c.label);
    const score = scoreLocalMatch(n, labelNorm);
    if (score >= MIN_LOCAL_SUGGEST_SCORE) {
      scored.push({ hit: c, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const out: GeocodeHit[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    const key = `${s.hit.label}|${s.hit.coordinate.latitude.toFixed(5)},${s.hit.coordinate.longitude.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.hit);
    if (out.length >= max) break;
  }
  return out;
}

async function fetchNominatimSuggestionBatch(
  query: string,
  opts: { viewboxBounded: "0" | "1" | null },
  signal?: AbortSignal,
): Promise<NominatimItem[]> {
  const q = query.trim();
  if (!q.length) return [];

  const url = `${NOMINATIM_SEARCH}?${nominatimQueryParams(q, { ...opts, limit: 20 }).toString()}`;
  const res = await nominatimFetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_USER_AGENT,
    },
  });
  if (res.status === 429 || !res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as NominatimItem[];
}

/**
 * Varias coincidencias para autocompletar mientras escribes (LocationIQ si hay token → si no Nominatim).
 * Respeta debounce en la UI; Nominatim sigue limitado a ~1 petición/s.
 */
export async function suggestDestinationHits(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const local = collectLocalGeocodeSuggestions(q, 6);

  if (getLocationIqKey()) {
    const liqRaw = await fetchLocationIqSuggestionBatch(q, signal);
    if (liqRaw && liqRaw.length > 0) {
      const remote = nominatimItemsToHits(liqRaw as NominatimItem[], 14);
      return mergeLocalAndRemoteHits(local, remote, 14);
    }
  }

  const attempts: { viewboxBounded: "0" | "1" | null }[] = [
    { viewboxBounded: "0" },
    { viewboxBounded: null },
  ];

  let remoteItems: NominatimItem[] = [];
  for (const att of attempts) {
    remoteItems = await fetchNominatimSuggestionBatch(q, att, signal);
    if (remoteItems.length > 0) break;
  }

  const remote = nominatimItemsToHits(remoteItems, 14);
  return mergeLocalAndRemoteHits(local, remote, 14);
}

function getGeocodingKey(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { googleMapsGeocodingKey?: string }
    | undefined;
  const k = extra?.googleMapsGeocodingKey?.trim();
  if (k && k !== "YOUR_GEOCODING_API_KEY") return k;
  return undefined;
}

/** https://locationiq.com — plan gratuito con token; datos OSM, menos bloqueos que Nominatim público. */
function getLocationIqKey(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { locationIqAccessToken?: string }
    | undefined;
  const k = extra?.locationIqAccessToken?.trim();
  if (k && k !== "YOUR_LOCATIONIQ_ACCESS_TOKEN") return k;
  return undefined;
}

type LocationIqPlace = {
  lat: string;
  lon: string;
  display_name: string;
};

function mergeLocalAndRemoteHits(
  local: GeocodeHit[],
  remote: GeocodeHit[],
  cap: number,
): GeocodeHit[] {
  const merged: GeocodeHit[] = [...local];
  const seen = new Set(
    local.map(
      (h) =>
        `${h.coordinate.latitude.toFixed(4)},${h.coordinate.longitude.toFixed(4)}`,
    ),
  );
  for (const h of remote) {
    const k = `${h.coordinate.latitude.toFixed(4)},${h.coordinate.longitude.toFixed(4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(h);
    if (merged.length >= cap) break;
  }
  return merged;
}

async function fetchLocationIqSuggestionBatch(
  query: string,
  signal?: AbortSignal,
): Promise<LocationIqPlace[] | null> {
  const token = getLocationIqKey();
  const q = query.trim();
  if (!token || !q.length) return null;

  for (const restrictViewbox of [true, false] as const) {
    const params = buildLocationIqSearchParams(q, token, {
      restrictViewbox,
    });
    params.set("limit", "15");
    const u = `https://us1.locationiq.com/v1/search?${params.toString()}`;
    const res = await fetch(u, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (Array.isArray(data) && data.length > 0) {
      return data as LocationIqPlace[];
    }
  }
  return null;
}

function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeQuery(s: string): string {
  return foldAccents(s.toLowerCase().trim()).replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const v0 = new Array<number>(b.length + 1);
  const v1 = new Array<number>(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j]!;
  }
  return v0[b.length]!;
}

function maxEditsForLength(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

function wordMatchesFuzzy(qWord: string, labelWord: string): boolean {
  if (!qWord.length || !labelWord.length) return false;
  if (qWord === labelWord) return true;
  if (labelWord.startsWith(qWord)) return true;
  if (qWord.length >= 3 && labelWord.includes(qWord)) return true;
  if (qWord.length >= 3 && qWord.startsWith(labelWord)) return true;
  const dist = levenshtein(qWord, labelWord);
  const mx = Math.max(qWord.length, labelWord.length);
  return dist <= maxEditsForLength(mx);
}

function labelTokens(labelNorm: string): string[] {
  return labelNorm.split(/\s+/).filter(Boolean);
}

/** Cada palabra del usuario encaja con alguna palabra del nombre (parcial u ortografía cercana). */
function tokensMatchFuzzy(queryNorm: string, labelNorm: string): boolean {
  const rawTok = queryNorm.split(/\s+/).filter((w) => w.length > 0);
  if (rawTok.length === 0) return false;
  const tokens = rawTok.filter((w) => w.length >= 2);
  const toCheck = tokens.length > 0 ? tokens : rawTok;
  const lWords = labelTokens(labelNorm);
  if (lWords.length === 0) return false;
  return toCheck.every((tw) => lWords.some((lw) => wordMatchesFuzzy(tw, lw)));
}

/**
 * Puntuación para ordenar coincidencias locales (mayor = mejor).
 * Tolera: mayúsculas/acentos, fragmentos del nombre y errores de escritura leves.
 */
function scoreLocalMatch(queryNorm: string, labelNorm: string): number {
  if (!queryNorm.length) return 0;
  if (labelNorm === queryNorm) return 100;
  if (labelNorm.startsWith(queryNorm)) return 90;
  if (queryNorm.startsWith(labelNorm) && labelNorm.length >= 3) return 86;
  if (labelNorm.includes(queryNorm)) return 72;
  if (queryNorm.includes(labelNorm) && labelNorm.length >= 3) return 62;

  if (tokensMatchFuzzy(queryNorm, labelNorm)) {
    const strict = queryNorm
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .every((tw) =>
        labelTokens(labelNorm).some(
          (lw) => lw.includes(tw) || tw.includes(lw) || wordMatchesFuzzy(tw, lw),
        ),
      );
    return strict ? 58 : 50;
  }

  const dist = levenshtein(queryNorm, labelNorm);
  const maxL = Math.max(queryNorm.length, labelNorm.length);
  if (maxL < 4) return 0;
  const sim = 1 - dist / maxL;
  if (sim >= 0.78) return Math.round(42 + 22 * sim);
  if (sim >= 0.68) return Math.round(36 + 20 * sim);
  return 0;
}

const MIN_LOCAL_SUGGEST_SCORE = 36;
const MIN_LOCAL_RESOLVE_SCORE = 44;

function localGeocodeCandidates(): GeocodeHit[] {
  return [
    ...SAMPLE_DESTINATIONS.map((d) => ({
      label: d.label,
      coordinate: d.coordinate,
    })),
    ...SAMPLE_STOPS.map((s) => ({
      label: s.name,
      coordinate: s.coordinate,
    })),
  ];
}

/**
 * Busca en paradas y destinos rápidos del proyecto (sin internet / sin Google).
 */
export function findLocalGeocodeHit(query: string): GeocodeHit | null {
  const n = normalizeQuery(query);
  if (!n) return null;

  let best: GeocodeHit | null = null;
  let bestScore = 0;

  for (const c of localGeocodeCandidates()) {
    const labelNorm = normalizeQuery(c.label);
    const s = scoreLocalMatch(n, labelNorm);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  if (best && bestScore >= MIN_LOCAL_RESOLVE_SCORE) {
    return best;
  }
  return null;
}

function normalizeQueryForCucuta(query: string): string {
  const raw = query.trim().replace(/\s+/g, " ");
  if (!raw) return raw;
  const folded = foldAccents(raw);
  const lower = folded.toLowerCase();
  if (
    lower.includes("cucuta") ||
    lower.includes("colombia") ||
    lower.includes("norte de santander")
  ) {
    return folded;
  }
  return `${folded}, Cucuta, Norte de Santander, Colombia`;
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

function buildLocationIqSearchParams(
  query: string,
  token: string,
  opts: { restrictViewbox: boolean },
): URLSearchParams {
  const params = new URLSearchParams({
    key: token,
    q: normalizeQueryForCucuta(query),
    format: "json",
    limit: "8",
    addressdetails: "0",
    countrycodes: "co",
    "accept-language": "es",
  });
  if (opts.restrictViewbox) {
    params.set(
      "viewbox",
      `${BOUNDS.west},${BOUNDS.north},${BOUNDS.east},${BOUNDS.south}`,
    );
    params.set("bounded", "0");
  }
  return params;
}

async function callLocationIqGeocode(
  query: string,
): Promise<
  | { ok: true; hit: GeocodeHit }
  | { ok: false; diagnostic: string }
> {
  const token = getLocationIqKey();
  const q = query.trim();
  if (!token || !q) {
    return { ok: false, diagnostic: "" };
  }

  const tryUrl = (restrictViewbox: boolean) =>
    `https://us1.locationiq.com/v1/search?${buildLocationIqSearchParams(q, token, { restrictViewbox }).toString()}`;

  const attempts: boolean[] = [true, false];

  for (const restrictViewbox of attempts) {
    const res = await fetch(tryUrl(restrictViewbox));
    if (res.status === 429) {
      return {
        ok: false,
        diagnostic:
          "LocationIQ: demasiadas peticiones; espera unos segundos o revisa tu cuota en locationiq.com.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        diagnostic: `LocationIQ: error HTTP ${res.status}. Comprueba extra.locationIqAccessToken en app.json.`,
      };
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) {
      continue;
    }
    const item = data[0] as LocationIqPlace;
    const lat = Number.parseFloat(item.lat);
    const lon = Number.parseFloat(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, diagnostic: "LocationIQ: respuesta inválida." };
    }
    return {
      ok: true,
      hit: {
        label: item.display_name,
        coordinate: { latitude: lat, longitude: lon },
      },
    };
  }

  return {
    ok: false,
    diagnostic:
      "LocationIQ no encontró ese texto (ni acotando a Cúcuta ni en todo Colombia). Revisa ortografía, quita abreviaturas raras o prueba «Meoz», «Hospital Meoz» o la calle sola; también puedes mantener pulsado el mapa.",
  };
}

/**
 * 1) Lista local (`sampleCucuta.ts`).
 * 2) Google Geocoding si `extra.googleMapsGeocodingKey` está configurada.
 * 3) LocationIQ si `extra.locationIqAccessToken` (plan gratuito en locationiq.com).
 * 4) Nominatim público (sin clave; límites estrictos; atribución OSM en UI).
 */
export async function resolveDestinationQuery(
  query: string,
): Promise<ResolveDestinationResult> {
  const local = findLocalGeocodeHit(query);
  if (local) {
    return { hit: local };
  }

  const diagnostics: string[] = [];

  const gKey = getGeocodingKey();
  if (gKey) {
    const g = await callGoogleGeocode(query);
    if (g.ok) {
      return { hit: g.hit };
    }
    if (g.status !== "MISSING_KEY") {
      diagnostics.push(explainGoogleGeocodeFailure(g.status, g.error_message));
    }
  }

  if (getLocationIqKey()) {
    const liq = await callLocationIqGeocode(query);
    if (liq.ok) {
      return { hit: liq.hit };
    }
    if (liq.diagnostic.trim()) {
      diagnostics.push(liq.diagnostic);
    }
  }

  const osm = await callNominatim(query);
  if (osm.ok) {
    return { hit: osm.hit };
  }

  const liqYaExplicó =
    getLocationIqKey() &&
    diagnostics.some((d) => d.includes("LocationIQ")) &&
    !osm.diagnostic.includes("reducir la velocidad") &&
    !osm.diagnostic.includes("no está disponible");
  if (!liqYaExplicó) {
    diagnostics.push(osm.diagnostic);
  }

  const text = diagnostics.filter((s) => s.length > 0).join(" ");
  return {
    hit: null,
    diagnostic:
      text ||
      "No se encontró el lugar. Prueba otra redacción, añade un token LocationIQ en app.json, o mantén pulsado el mapa.",
  };
}

export async function geocodeAddress(query: string): Promise<GeocodeHit | null> {
  const { hit } = await resolveDestinationQuery(query);
  return hit;
}
