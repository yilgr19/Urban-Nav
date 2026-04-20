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
  OPENSTREETMAP_GEOCODING_ATTRIBUTION,
  resolveDestinationQuery,
} from "../services/geocoding";
import { planFullTrip } from "../services/tripPlanner";
import type { FullTripPlan, LatLng } from "../types/mobility";
import { colors } from "../theme/colors";

const CUCUTA_REGION: Region = {
  latitude: 7.8945,
  longitude: -72.5039,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

export function PlanRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locLoading, setLocLoading] = useState(true);
  const [locDenied, setLocDenied] = useState(false);

  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [destinationLabel, setDestinationLabel] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoHint, setGeoHint] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    setLocLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocDenied(true);
      setUserLocation(null);
      setLocLoading(false);
      return;
    }
    setLocDenied(false);
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    setUserLocation({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
    setLocLoading(false);
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const plannerResult = useMemo(() => {
    if (!userLocation || !destination) return null;
    return planFullTrip(userLocation, destination, SAMPLE_ROUTES);
  }, [userLocation, destination]);

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
    if (plan && userLocation && destination) {
      fitToTrip(plan, userLocation, destination);
    }
  }, [plan, userLocation, destination, fitToTrip]);

  const onSearch = async () => {
    Keyboard.dismiss();
    setGeoHint(null);
    const q = query.trim();
    if (!q) return;
    setGeoLoading(true);
    const { hit, diagnostic } = await resolveDestinationQuery(q);
    setGeoLoading(false);
    if (hit) {
      setDestination(hit.coordinate);
      setDestinationLabel(hit.label);
      return;
    }
    setGeoHint(
      diagnostic ??
        "No coincide con la lista local ni con OpenStreetMap/Google. Añade el lugar en SAMPLE_DESTINATIONS o mantén pulsado el mapa.",
    );
  };

  const onPickPoi = (label: string, c: LatLng) => {
    setDestination(c);
    setDestinationLabel(label);
    setGeoHint(null);
  };

  const onMapLongPress = (e: { nativeEvent: { coordinate: LatLng } }) => {
    const c = e.nativeEvent.coordinate;
    setDestination(c);
    setDestinationLabel("Ubicación en mapa");
    setGeoHint(null);
  };

  const clearDestination = () => {
    setDestination(null);
    setDestinationLabel(null);
    setGeoHint(null);
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

        {destination && (
          <Marker
            coordinate={destination}
            title="Destino"
            description={destinationLabel ?? undefined}
            pinColor={colors.primary}
          />
        )}
      </MapView>

      <View
        style={[
          styles.searchBar,
          { paddingTop: Math.max(insets.top, 10) + 6 },
        ]}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Text style={styles.backLinkText}>‹ Volver</Text>
        </Pressable>
        <Text style={styles.searchTitle}>¿A dónde vas?</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            placeholder="Dirección o lugar en Cúcuta"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void onSearch()}
            returnKeyType="search"
          />
          <Pressable
            style={({ pressed }) => [
              styles.searchBtn,
              pressed && styles.pressed,
            ]}
            onPress={() => void onSearch()}
            disabled={geoLoading}
          >
            {geoLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.searchBtnText}>Buscar</Text>
            )}
          </Pressable>
        </View>
        {geoHint && <Text style={styles.hint}>{geoHint}</Text>}
        <Text style={styles.osmAttr}>{OPENSTREETMAP_GEOCODING_ATTRIBUTION}</Text>
      </View>

      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        {locLoading && (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Obteniendo tu ubicación…</Text>
          </View>
        )}
        {locDenied && (
          <Text style={styles.warn}>
            Activa la ubicación para calcular abordaje, bajada y tiempos desde
            donde estás.
          </Text>
        )}

        <Text style={styles.panelLabel}>Destinos rápidos (lista local)</Text>
        {SAMPLE_DESTINATIONS.length === 0 ? (
          <Text style={styles.muted}>
            Aún no hay lugares: edita{" "}
            <Text style={{ fontWeight: "600" }}>SAMPLE_DESTINATIONS</Text> en{" "}
            <Text style={{ fontWeight: "600" }}>sampleCucuta.ts</Text>, o usa
            búsqueda por nombre (OpenStreetMap) / mantén pulsado el mapa.
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

        {destination && (
          <Pressable onPress={clearDestination} style={styles.clearDest}>
            <Text style={styles.clearDestText}>Quitar destino</Text>
          </Pressable>
        )}

        {!userLocation || !destination ? (
          <Text style={styles.muted}>
            Busca un destino o mantén pulsado el mapa. Con tu ubicación y el
            destino, elegimos la ruta que menos caminata suma y el sentido
            correcto del trazado.
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
    left: 12,
    right: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  backLink: { alignSelf: "flex-start", marginBottom: 6 },
  backLinkText: { fontSize: 15, color: colors.primary, fontWeight: "600" },
  searchTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 8,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  searchBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 88,
    alignItems: "center",
  },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.warning,
    lineHeight: 17,
  },
  osmAttr: {
    marginTop: 6,
    fontSize: 10,
    color: colors.textMuted,
    lineHeight: 14,
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
