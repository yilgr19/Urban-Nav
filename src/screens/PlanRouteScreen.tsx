import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Keyboard,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import * as Location from "expo-location";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  SAMPLE_ROUTES,
  SAMPLE_DESTINATIONS,
} from "../data/sampleCucuta";
import {
  GEOCODING_DATA_ATTRIBUTION,
  resolveDestinationQuery,
  suggestDestinationHits,
  type GeocodeHit,
} from "../services/geocoding";
import { planFullTrip } from "../services/tripPlanner";
import type { FullTripPlan, LatLng } from "../types/mobility";
import { haversineMeters } from "../utils/geo";
import { colors } from "../theme/colors";

const CUCUTA_REGION: Region = {
  latitude: 7.8945,
  longitude: -72.5039,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

/** Mayor que antes: menos ráfagas a Nominatim (límite ~1 petición/s del servicio público). */
const SUGGEST_DEBOUNCE_MS = 700;

/** Texto más corto para el campo al elegir una sugerencia (nombre + barrio/ciudad). */
function compactSuggestionLabel(full: string): string {
  const parts = full.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return full;
  return `${parts[0]}, ${parts[1]}`;
}

function formatOriginAddress(
  p: Location.LocationGeocodedAddress,
): string | null {
  const streetLine = [p.street, p.streetNumber].filter(Boolean).join(" ").trim();
  const locality = [p.district, p.subregion, p.city, p.region]
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(", ");
  const name = p.name?.trim();
  const chunks: string[] = [];
  if (name && name !== streetLine) chunks.push(name);
  if (streetLine) chunks.push(streetLine);
  if (locality) chunks.push(locality);
  const s = chunks.filter(Boolean).join(" · ");
  return s.length > 0 ? s : null;
}

export function PlanRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const hasBusRoutes = SAMPLE_ROUTES.length > 0;

  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locLoading, setLocLoading] = useState(true);
  const [locDenied, setLocDenied] = useState(false);

  /** Punto de salida para la ruta (GPS inicial o georeferencia en «De»). */
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [originQuery, setOriginQuery] = useState("");

  const [destQuery, setDestQuery] = useState("");
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [destinationLabel, setDestinationLabel] = useState<string | null>(null);

  /** Qué campo está activo para sugerencias / Buscar con teclado. */
  const [activeField, setActiveField] = useState<"origin" | "destination">(
    "destination",
  );
  const [geoLoadingField, setGeoLoadingField] = useState<
    null | "origin" | "destination"
  >(null);
  const [geoHint, setGeoHint] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeHit[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  /** Evita reabrir sugerencias justo después de elegir una fila (el texto del input cambia). */
  const skipNextSuggestEffectRef = useRef(false);

  /** Origen y destino resueltos: interfaz más baja para dejar ver el mapa. */
  const routeInputsCompact = Boolean(origin && destination);

  const loadUser = useCallback(async () => {
    setLocLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocDenied(true);
      setUserLocation(null);
      setOrigin(null);
      setOriginQuery("");
      setLocLoading(false);
      return;
    }
    setLocDenied(false);
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = loc.coords.latitude;
    const lng = loc.coords.longitude;
    const point = { latitude: lat, longitude: lng };
    setUserLocation(point);
    setOrigin(point);

    let desc = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
      const places = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      const formatted = places[0] ? formatOriginAddress(places[0]) : null;
      if (formatted) desc = formatted;
    } catch {
      /* coords suficientes */
    }
    setOriginQuery(desc);
    setLocLoading(false);
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const plannerResult = useMemo(() => {
    if (!origin || !destination) return null;
    return planFullTrip(origin, destination, SAMPLE_ROUTES);
  }, [origin, destination]);

  const plan: FullTripPlan | null =
    plannerResult?.ok === true ? plannerResult.plan : null;
  const plannerError =
    plannerResult?.ok === false ? plannerResult.reason : null;

  const mapProvider = useMemo(() => {
    if (Platform.OS === "android" || Platform.OS === "ios") {
      return PROVIDER_GOOGLE;
    }
    return undefined;
  }, []);

  const fitToTrip = useCallback(
    (p: FullTripPlan | null, u: LatLng | null, d: LatLng | null) => {
      const coords: LatLng[] = [];
      if (u) coords.push(u);
      if (d) coords.push(d);
      if (p) {
        coords.push(p.boardingPoint, p.alightingPoint);
        p.bus.coordinates.forEach((c) => coords.push(c));
      }
      if (coords.length === 0) return;
      requestAnimationFrame(() => {
        mapRef.current?.fitToCoordinates(
          coords.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
          {
            edgePadding: { top: 120, right: 50, bottom: 200, left: 50 },
            animated: true,
          },
        );
      });
    },
    [],
  );

  useEffect(() => {
    if (plan && origin && destination) {
      fitToTrip(plan, origin, destination);
    }
  }, [plan, origin, destination, fitToTrip]);

  useEffect(() => {
    if (skipNextSuggestEffectRef.current) {
      skipNextSuggestEffectRef.current = false;
      return;
    }

    const q =
      activeField === "origin"
        ? originQuery.trim()
        : destQuery.trim();
    if (q.length < 2) {
      suggestAbortRef.current?.abort();
      suggestAbortRef.current = null;
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    if (suggestDebounceRef.current) {
      clearTimeout(suggestDebounceRef.current);
    }

    suggestDebounceRef.current = setTimeout(() => {
      suggestDebounceRef.current = null;
      suggestAbortRef.current?.abort();
      const ac = new AbortController();
      suggestAbortRef.current = ac;
      setSuggestLoading(true);
      void (async () => {
        try {
          const hits = await suggestDestinationHits(q, ac.signal);
          if (!ac.signal.aborted) {
            setSuggestions(hits);
          }
        } catch (e: unknown) {
          if (e instanceof Error && e.name === "AbortError") return;
        } finally {
          if (!ac.signal.aborted) {
            setSuggestLoading(false);
          }
        }
      })();
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }
    };
  }, [activeField, originQuery, destQuery]);

  useEffect(() => {
    return () => {
      suggestAbortRef.current?.abort();
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
      }
    };
  }, []);

  const onSelectSuggestion = useCallback((hit: GeocodeHit) => {
    Keyboard.dismiss();
    skipNextSuggestEffectRef.current = true;
    suggestAbortRef.current?.abort();
    if (suggestDebounceRef.current) {
      clearTimeout(suggestDebounceRef.current);
      suggestDebounceRef.current = null;
    }
    setSuggestLoading(false);
    const short = compactSuggestionLabel(hit.label);
    if (activeField === "origin") {
      setOriginQuery(short);
      setOrigin(hit.coordinate);
    } else {
      setDestQuery(short);
      setDestination(hit.coordinate);
      setDestinationLabel(hit.label);
    }
    setSuggestions([]);
    setGeoHint(null);
  }, [activeField]);

  const runGeocode = useCallback(
    async (field: "origin" | "destination") => {
      Keyboard.dismiss();
      setSuggestions([]);
      setGeoHint(null);
      const q =
        field === "origin" ? originQuery.trim() : destQuery.trim();
      if (!q) return;
      setGeoLoadingField(field);
      const { hit, diagnostic } = await resolveDestinationQuery(q);
      setGeoLoadingField(null);
      if (hit) {
        if (field === "origin") {
          setOrigin(hit.coordinate);
          setOriginQuery(compactSuggestionLabel(hit.label));
        } else {
          setDestination(hit.coordinate);
          setDestQuery(compactSuggestionLabel(hit.label));
          setDestinationLabel(hit.label);
        }
        return;
      }
      setGeoHint(
        diagnostic ??
          "Sin resultados. Prueba otra redacción o elige en el mapa (pulsación larga en destino).",
      );
    },
    [originQuery, destQuery],
  );

  const onPickPoi = (label: string, c: LatLng) => {
    setActiveField("destination");
    setDestQuery(compactSuggestionLabel(label));
    setDestination(c);
    setDestinationLabel(label);
    setGeoHint(null);
    setSuggestions([]);
  };

  const onMapLongPress = (e: { nativeEvent: { coordinate: LatLng } }) => {
    const c = e.nativeEvent.coordinate;
    setActiveField("destination");
    setDestQuery("Ubicación en mapa");
    setDestination(c);
    setDestinationLabel("Ubicación en mapa");
    setGeoHint(null);
    setSuggestions([]);
  };

  const clearDestination = () => {
    setDestination(null);
    setDestinationLabel(null);
    setDestQuery("");
    setGeoHint(null);
    setSuggestions([]);
  };

  const clearOriginField = () => {
    setGeoHint(null);
    setSuggestions([]);
    if (userLocation) {
      setOrigin(userLocation);
      const lat = userLocation.latitude;
      const lng = userLocation.longitude;
      let line = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setOriginQuery(line);
      void Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      })
        .then((places) => {
          const formatted = places[0] ? formatOriginAddress(places[0]) : null;
          if (formatted) setOriginQuery(formatted);
        })
        .catch(() => {});
    } else {
      setOrigin(null);
      setOriginQuery("");
    }
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={mapProvider}
        initialRegion={CUCUTA_REGION}
        showsUserLocation={!locDenied}
        showsMyLocationButton
        onLongPress={onMapLongPress}
      >
        {SAMPLE_ROUTES.map((route) => {
          const selected = plan?.route.id === route.id;
          return (
            <Polyline
              key={route.id}
              coordinates={route.path}
              strokeColor={
                selected ? route.color ?? colors.routeLine : "#90a4ae"
              }
              strokeWidth={selected ? 5 : 3}
            />
          );
        })}

        {plan && (
          <>
            <Polyline
              coordinates={plan.walkToBoard.coordinates}
              strokeColor={colors.walkLeg}
              strokeWidth={4}
              lineDashPattern={[10, 8]}
            />
            <Polyline
              coordinates={plan.bus.coordinates}
              strokeColor={plan.route.color ?? colors.routeLine}
              strokeWidth={7}
            />
            <Polyline
              coordinates={plan.walkFromAlight.coordinates}
              strokeColor={colors.walkLeg}
              strokeWidth={4}
              lineDashPattern={[10, 8]}
            />
            <Marker
              coordinate={plan.boardingPoint}
              title="Abordaje"
              description="Punto más cercano de la ruta hacia ti"
              pinColor={colors.boarding}
            />
            <Marker
              coordinate={plan.alightingPoint}
              title="Bajada"
              description="Punto más cercano de la ruta al destino"
              pinColor={colors.alighting}
            />
          </>
        )}

        {origin ? (
          <Marker
            coordinate={origin}
            title="De — salida"
            description={originQuery || undefined}
            pinColor="#2e7d32"
          />
        ) : null}

        {destination && (
          <Marker
            coordinate={destination}
            title="A — destino"
            description={destinationLabel ?? undefined}
            pinColor={colors.primary}
          />
        )}
      </MapView>

      <View
        style={[
          styles.searchBar,
          styles.routeSheet,
          routeInputsCompact && styles.routeSheetCompact,
          {
            paddingTop: Math.max(
              insets.top,
              routeInputsCompact ? 8 : 12,
            ) + (routeInputsCompact ? 2 : 4),
          },
        ]}
      >
        <View style={styles.routeHeader}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.routeBackBtn, pressed && styles.pressed]}
            hitSlop={12}
          >
            <Text
              style={[
                styles.routeBackText,
                routeInputsCompact && styles.routeBackTextCompact,
              ]}
            >
              Volver
            </Text>
          </Pressable>
        </View>

        <Text
          style={[styles.routeTitle, routeInputsCompact && styles.routeTitleCompact]}
        >
          Planificar ruta
        </Text>
        {!routeInputsCompact ? (
          <Text style={styles.routeSubtitle}>
            Indica origen y destino para calcular el trayecto
          </Text>
        ) : null}

        <View
          style={[styles.fieldBlock, routeInputsCompact && styles.fieldBlockCompact]}
        >
          <Text
            style={[
              styles.fieldOverline,
              routeInputsCompact && styles.fieldOverlineCompact,
            ]}
          >
            Desde
          </Text>
          <View style={styles.fieldRow}>
            <View
              style={[styles.accentFrom, routeInputsCompact && styles.accentCompact]}
            />
            <View style={styles.fieldMain}>
              <View
                style={[
                  styles.inputShell,
                  routeInputsCompact && styles.inputShellCompact,
                ]}
              >
                <TextInput
                  style={[
                    styles.inputModern,
                    routeInputsCompact && styles.inputModernCompact,
                  ]}
                  placeholder={
                    locDenied
                      ? "Dirección o lugar de salida"
                      : "Tu ubicación o busca dirección de salida"
                  }
                  placeholderTextColor="#94a3b8"
                  value={originQuery}
                  onChangeText={setOriginQuery}
                  onFocus={() => setActiveField("origin")}
                  onSubmitEditing={() => void runGeocode("origin")}
                  returnKeyType="search"
                  editable={!locLoading}
                />
                {geoLoadingField === "origin" ? (
                  <ActivityIndicator
                    color={colors.primary}
                    style={styles.inputTrailing}
                    size="small"
                  />
                ) : null}
              </View>
              {!routeInputsCompact ? (
                <View style={styles.fieldMetaRow}>
                  {locLoading ? (
                    <View style={styles.inlineMutedRow}>
                      <ActivityIndicator color={colors.primary} size="small" />
                      <Text style={styles.metaText}>Obteniendo ubicación…</Text>
                    </View>
                  ) : locDenied ? (
                    <Text style={styles.metaWarn}>
                      Sin acceso al GPS: escribe el origen o concede permiso en
                      ajustes.
                    </Text>
                  ) : (
                    <View style={styles.linkRow}>
                      <Pressable
                        onPress={() => void loadUser()}
                        disabled={locLoading || locDenied}
                        style={({ pressed }) => pressed && styles.pressed}
                      >
                        <Text
                          style={[
                            styles.textLink,
                            (locLoading || locDenied) && styles.textLinkDisabled,
                          ]}
                        >
                          Usar mi ubicación actual
                        </Text>
                      </Pressable>
                      {originQuery.length > 0 ? (
                        <Pressable
                          onPress={clearOriginField}
                          style={({ pressed }) => pressed && styles.pressed}
                        >
                          <Text style={styles.textLinkMuted}>Restablecer</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.fieldMetaCompactRow}>
                  {locLoading ? (
                    <View style={styles.inlineMutedRow}>
                      <ActivityIndicator color={colors.primary} size="small" />
                      <Text style={styles.metaTextSmall}>Ubicación…</Text>
                    </View>
                  ) : locDenied ? (
                    <Text style={styles.metaWarnSmall}>
                      Sin GPS: introduce el origen o activa permisos.
                    </Text>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => void loadUser()}
                        disabled={locLoading || locDenied}
                        style={({ pressed }) => pressed && styles.pressed}
                      >
                        <Text
                          style={[
                            styles.textLinkSmall,
                            (locLoading || locDenied) && styles.textLinkDisabled,
                          ]}
                        >
                          Reubicar
                        </Text>
                      </Pressable>
                      {originQuery.length > 0 ? (
                        <Pressable
                          onPress={clearOriginField}
                          style={({ pressed }) => pressed && styles.pressed}
                        >
                          <Text style={styles.textLinkMutedSmall}>Restablecer</Text>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        <View
          style={[styles.fieldBlock, routeInputsCompact && styles.fieldBlockCompact]}
        >
          <Text
            style={[
              styles.fieldOverline,
              routeInputsCompact && styles.fieldOverlineCompact,
            ]}
          >
            Hasta
          </Text>
          <View style={styles.fieldRow}>
            <View
              style={[styles.accentTo, routeInputsCompact && styles.accentCompact]}
            />
            <View style={styles.fieldMain}>
              <View
                style={[
                  styles.inputShell,
                  routeInputsCompact && styles.inputShellCompact,
                ]}
              >
                <TextInput
                  style={[
                    styles.inputModern,
                    routeInputsCompact && styles.inputModernCompact,
                  ]}
                  placeholder="Destino: dirección, barrio o lugar"
                  placeholderTextColor="#94a3b8"
                  value={destQuery}
                  onChangeText={setDestQuery}
                  onFocus={() => setActiveField("destination")}
                  onSubmitEditing={() => void runGeocode("destination")}
                  returnKeyType="search"
                />
                {geoLoadingField === "destination" ? (
                  <ActivityIndicator
                    color={colors.primary}
                    style={styles.inputTrailing}
                    size="small"
                  />
                ) : null}
              </View>
              <View
                style={[
                  styles.destActionsRow,
                  routeInputsCompact && styles.destActionsRowCompact,
                ]}
              >
                {destQuery.length > 0 ? (
                  <Pressable
                    onPress={clearDestination}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <Text
                      style={[
                        styles.textLinkMuted,
                        routeInputsCompact && styles.textLinkMutedSmall,
                      ]}
                    >
                      Vaciar
                    </Text>
                  </Pressable>
                ) : (
                  <View />
                )}
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryPill,
                    routeInputsCompact && styles.primaryPillCompact,
                    pressed && styles.pressed,
                    geoLoadingField !== null && styles.primaryPillDisabled,
                  ]}
                  onPress={() => void runGeocode("destination")}
                  disabled={geoLoadingField !== null}
                >
                  {geoLoadingField === "destination" ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.primaryPillText,
                        routeInputsCompact && styles.primaryPillTextCompact,
                      ]}
                    >
                      {routeInputsCompact ? "Buscar" : "Buscar destino"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        {(activeField === "origin" ? originQuery : destQuery).trim().length >=
          2 &&
        (suggestLoading || suggestions.length > 0) ? (
          <ScrollView
            style={[
              styles.suggestPanel,
              routeInputsCompact && styles.suggestPanelCompact,
            ]}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={suggestions.length > 4}
          >
            {suggestLoading && suggestions.length === 0 ? (
              <View style={styles.suggestLoadingRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={styles.suggestLoadingLabel}>Buscando…</Text>
              </View>
            ) : null}
            {suggestions.map((hit, index) => (
              <Pressable
                key={`${hit.label}-${hit.coordinate.latitude}-${hit.coordinate.longitude}-${index}`}
                style={({ pressed }) => [
                  styles.suggestRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectSuggestion(hit)}
              >
                <View style={styles.suggestTextCol}>
                  <Text style={styles.suggestTitle} numberOfLines={2}>
                    {hit.label.split(",")[0]?.trim() ?? hit.label}
                  </Text>
                  {hit.label.includes(",") ? (
                    <Text style={styles.suggestSub} numberOfLines={2}>
                      {hit.label.split(",").slice(1).join(",").trim()}
                    </Text>
                  ) : null}
                </View>
                {origin ? (
                  <Text style={styles.suggestDist}>
                    {(haversineMeters(origin, hit.coordinate) / 1000).toFixed(1)}{" "}
                    km
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {geoHint ? (
          <Text
            style={[styles.hintRoute, routeInputsCompact && styles.hintRouteCompact]}
          >
            {geoHint}
          </Text>
        ) : null}
        {!routeInputsCompact ? (
          <Text style={styles.attrRoute}>{GEOCODING_DATA_ATTRIBUTION}</Text>
        ) : (
          <Text style={styles.attrRouteCompact}>{GEOCODING_DATA_ATTRIBUTION}</Text>
        )}
      </View>

      <View
        style={[
          styles.panel,
          !hasBusRoutes && styles.panelNoQuickDest,
          { paddingBottom: Math.max(insets.bottom, 14) },
        ]}
      >
        {hasBusRoutes ? (
          <>
            <Text style={styles.panelLabel}>Destinos rápidos (lista local)</Text>
            {SAMPLE_DESTINATIONS.length === 0 ? (
              <Text style={styles.muted}>
                Aún no hay lugares en la lista: edita{" "}
                <Text style={{ fontWeight: "600" }}>SAMPLE_DESTINATIONS</Text> en{" "}
                <Text style={{ fontWeight: "600" }}>sampleCucuta.ts</Text>.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                {SAMPLE_DESTINATIONS.map((p) => (
                  <Pressable
                    key={p.label}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed && styles.pressed,
                      destinationLabel === p.label && styles.chipOn,
                    ]}
                    onPress={() => onPickPoi(p.label, p.coordinate)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        destinationLabel === p.label && styles.chipTextOn,
                      ]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </>
        ) : null}

        {destination && (
          <Pressable onPress={clearDestination} style={styles.clearDest}>
            <Text style={styles.clearDestText}>Quitar destino</Text>
          </Pressable>
        )}

        {!origin || !destination ? (
          <Text style={styles.muted}>
            Completa{" "}
            <Text style={{ fontWeight: "600" }}>De</Text> (ubicación o
            búsqueda) y <Text style={{ fontWeight: "600" }}>A</Text>{" "}
            (destino), o pulsa largo en el mapa para fijar solo el destino.
          </Text>
        ) : plannerError ? (
          <Text style={styles.warn}>
            {plannerError === "No hay rutas cargadas."
              ? "Aún no hay rutas en SAMPLE_ROUTES_GEOJSON. Define primero los lugares (SAMPLE_DESTINATIONS); luego importa las polilíneas desde QGIS / PostGIS."
              : plannerError}
          </Text>
        ) : plan ? (
          <ScrollView style={styles.planScroll} nestedScrollEnabled>
            <Text style={styles.planHead}>Mejor opción (datos estáticos)</Text>
            <Text style={styles.planLine}>
              Línea <Text style={styles.strong}>{plan.route.code}</Text> —{" "}
              {plan.route.name}
            </Text>
            <Text style={styles.planDetail}>
              Abordaje: punto sobre la ruta a{" "}
              <Text style={styles.strong}>
                {Math.round(plan.walkToBoard.distanceMeters)} m
              </Text>{" "}
              caminando (~{Math.round(plan.walkToBoard.durationMinutes)} min).
            </Text>
            <Text style={styles.planDetail}>
              Bajada: punto sobre la ruta; luego{" "}
              <Text style={styles.strong}>
                {Math.round(plan.walkFromAlight.distanceMeters)} m
              </Text>{" "}
              al destino (~{Math.round(plan.walkFromAlight.durationMinutes)}{" "}
              min).
            </Text>
            <Text style={styles.planDetail}>
              En bus (~{Math.round(plan.bus.distanceMeters)} m de trazado):{" "}
              <Text style={styles.strong}>
                ~{Math.round(plan.bus.durationMinutes)} min
              </Text>{" "}
              (proporcional al recorrido completo de la línea).
            </Text>
            <Text style={styles.planDetail}>
              Espera aproximada (sin GPS del vehículo):{" "}
              <Text style={styles.strong}>
                ~{Math.round(plan.estimatedWaitMinutes)} min
              </Text>{" "}
              (frecuencia cada {plan.route.headwayMinutes} min → promedio la
              mitad del intervalo).
            </Text>
            <Text style={styles.total}>
              Tiempo total estimado: ~{Math.round(plan.totalTripMinutes)} min
            </Text>
            <Text style={styles.disclaimer}>
              El mapa muestra: caminata (línea gris punteada) → tramo en buseta
              (color de línea) → caminata final. Los tiempos no usan posición en
              vivo de unidades.
            </Text>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  map: { ...StyleSheet.absoluteFillObject },
  searchBar: {
    position: "absolute",
    left: 14,
    right: 14,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingBottom: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.09,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  routeSheet: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
  },
  routeSheetCompact: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderRadius: 16,
  },
  routeHeader: {
    marginBottom: 4,
  },
  routeBackBtn: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  routeBackText: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.primary,
    letterSpacing: 0.2,
  },
  routeBackTextCompact: { fontSize: 13 },
  routeTitle: {
    fontSize: 22,
    fontWeight: "600",
    color: "#0f172a",
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  routeTitleCompact: {
    fontSize: 17,
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  routeSubtitle: {
    fontSize: 14,
    fontWeight: "400",
    color: "#64748b",
    lineHeight: 20,
    marginBottom: 20,
  },
  fieldBlock: { marginBottom: 18 },
  fieldBlockCompact: { marginBottom: 8 },
  fieldOverline: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748b",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  fieldOverlineCompact: { marginBottom: 4, fontSize: 10, letterSpacing: 1 },
  fieldRow: { flexDirection: "row", alignItems: "stretch" },
  accentFrom: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginRight: 12,
  },
  accentTo: {
    width: 3,
    borderRadius: 2,
    backgroundColor: "#94a3b8",
    marginRight: 12,
  },
  accentCompact: { marginRight: 8 },
  fieldMain: { flex: 1, minWidth: 0 },
  inputShell: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  inputShellCompact: { borderRadius: 10 },
  inputModern: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 12,
    paddingRight: 40,
    fontSize: 16,
    fontWeight: "400",
    color: "#0f172a",
    minHeight: 48,
  },
  inputModernCompact: {
    minHeight: 38,
    fontSize: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    paddingHorizontal: 12,
  },
  inputTrailing: { position: "absolute", right: 12 },
  fieldMetaRow: { marginTop: 8, minHeight: 22 },
  fieldMetaCompactRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  inlineMutedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: { fontSize: 13, color: "#64748b" },
  metaTextSmall: { fontSize: 11, color: "#64748b" },
  metaWarn: {
    fontSize: 12,
    color: "#b45309",
    lineHeight: 17,
  },
  metaWarnSmall: {
    fontSize: 11,
    color: "#b45309",
    lineHeight: 15,
    flex: 1,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  textLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  textLinkMuted: {
    fontSize: 13,
    fontWeight: "500",
    color: "#94a3b8",
  },
  textLinkSmall: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.primary,
  },
  textLinkMutedSmall: {
    fontSize: 12,
    fontWeight: "500",
    color: "#94a3b8",
  },
  textLinkDisabled: {
    color: "#cbd5e1",
  },
  destActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  destActionsRowCompact: { marginTop: 6 },
  primaryPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    minWidth: 132,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryPillCompact: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 104,
  },
  primaryPillDisabled: { opacity: 0.55 },
  primaryPillText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  primaryPillTextCompact: { fontSize: 13 },
  suggestPanel: {
    maxHeight: 192,
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  suggestPanelCompact: { maxHeight: 120 },
  suggestLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  suggestLoadingLabel: { fontSize: 14, color: "#64748b" },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
    gap: 10,
  },
  suggestTextCol: { flex: 1, minWidth: 0 },
  suggestTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0f172a",
    letterSpacing: -0.2,
  },
  suggestSub: {
    marginTop: 3,
    fontSize: 12,
    color: "#64748b",
    lineHeight: 16,
  },
  suggestDist: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.primary,
    marginLeft: 4,
  },
  hintRoute: {
    marginTop: 10,
    fontSize: 13,
    color: "#c2410c",
    lineHeight: 18,
  },
  hintRouteCompact: { marginTop: 6, fontSize: 12, lineHeight: 16 },
  attrRoute: {
    marginTop: 10,
    fontSize: 10,
    color: "#94a3b8",
    lineHeight: 14,
  },
  attrRouteCompact: {
    marginTop: 4,
    fontSize: 9,
    lineHeight: 12,
    color: "#94a3b8",
  },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "46%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  panelNoQuickDest: {
    maxHeight: "36%",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  muted: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  warn: {
    fontSize: 13,
    color: "#b71c1c",
    lineHeight: 19,
    marginBottom: 8,
  },
  panelLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 8,
  },
  chipsRow: { gap: 8, paddingBottom: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { fontSize: 12, color: colors.text },
  chipTextOn: { color: "#fff", fontWeight: "600" },
  clearDest: { alignSelf: "flex-start", marginBottom: 8 },
  clearDestText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  planScroll: { maxHeight: 220 },
  planHead: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 8,
  },
  planLine: { fontSize: 14, color: colors.text, marginBottom: 6 },
  planDetail: { fontSize: 13, color: colors.textMuted, marginBottom: 6, lineHeight: 19 },
  strong: { fontWeight: "700", color: colors.text },
  total: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary,
  },
  disclaimer: {
    marginTop: 10,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
  },
  pressed: { opacity: 0.88 },
});
