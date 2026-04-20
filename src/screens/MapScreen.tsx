import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import {
  SAMPLE_ROUTES,
  SAMPLE_STOPS,
  SAMPLE_DESTINATIONS,
} from "../data/sampleCucuta";
import { colors } from "../theme/colors";

/** Centro aproximado de Cúcuta para vista inicial */
const CUCUTA_REGION = {
  latitude: 7.8945,
  longitude: -72.5039,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

export function MapScreen() {
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(true);

  const loadLocation = useCallback(async () => {
    setLoadingLocation(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setPermissionDenied(true);
      setLoadingLocation(false);
      return;
    }
    setPermissionDenied(false);
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    setUserLocation({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
    setLoadingLocation(false);
  }, []);

  useEffect(() => {
    void loadLocation();
  }, [loadLocation]);

  const mapProvider = useMemo(() => {
    if (Platform.OS === "android" || Platform.OS === "ios") {
      return PROVIDER_GOOGLE;
    }
    return undefined;
  }, []);

  return (
    <View style={styles.wrap}>
      {loadingLocation && (
        <View style={styles.banner}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.bannerText}>Obteniendo ubicación…</Text>
        </View>
      )}
      {permissionDenied && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.bannerText}>
            Sin permiso de ubicación se muestra el mapa centrado en Cúcuta.
            Puedes activarlo en ajustes del dispositivo.
          </Text>
        </View>
      )}
      {SAMPLE_ROUTES.length === 0 && (
        <View style={[styles.banner, { backgroundColor: "#e3f2fd" }]}>
          <Text style={styles.bannerText}>
            Sin rutas en el mapa: carga polilíneas en SAMPLE_ROUTES_GEOJSON
            (sampleCucuta.ts). Los lugares de SAMPLE_DESTINATIONS aparecen como
            marcadores violeta.
          </Text>
        </View>
      )}
      <MapView
        style={styles.map}
        provider={mapProvider}
        initialRegion={CUCUTA_REGION}
        showsUserLocation={!permissionDenied}
        showsMyLocationButton
      >
        {userLocation && (
          <Marker
            coordinate={userLocation}
            title="Tu ubicación"
            pinColor={colors.primary}
          />
        )}
        {SAMPLE_ROUTES.map((route) => (
          <Polyline
            key={route.id}
            coordinates={route.path}
            strokeColor={route.color ?? colors.routeLine}
            strokeWidth={4}
          />
        ))}
        {SAMPLE_STOPS.map((stop) => (
          <Marker
            key={stop.id}
            coordinate={stop.coordinate}
            title={stop.name}
            description={`Rutas: ${stop.routeIds.join(", ")}`}
            pinColor={colors.busStop}
          />
        ))}
        {SAMPLE_DESTINATIONS.map((poi) => (
          <Marker
            key={`poi-${poi.label}`}
            coordinate={poi.coordinate}
            title={poi.label}
            description="Lugar (lista local)"
            pinColor="#7b1fa2"
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  map: { flex: 1 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bannerWarn: { backgroundColor: "#fff8e1" },
  bannerText: { flex: 1, fontSize: 13, color: colors.text },
});
