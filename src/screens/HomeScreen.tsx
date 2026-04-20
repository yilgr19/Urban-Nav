import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors } from "../theme/colors";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>Movilidad urbana en Cúcuta</Text>
      <Text style={styles.subtitle}>
        Geolocalización, rutas en GeoJSON, búsqueda de destino, mejor línea,
        puntos de abordaje y bajada sobre el trazado, recorrido completo
        (caminar–bus–caminar) y tiempos con frecuencia y duración de línea, sin
        GPS en vivo de las busetas.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={() => navigation.navigate("Map")}
      >
        <Text style={styles.primaryBtnText}>Abrir mapa</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        onPress={() => navigation.navigate("PlanRoute")}
      >
        <Text style={styles.secondaryBtnText}>Planificar ruta</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Datos en el proyecto</Text>
        <Text style={styles.cardLine}>
          1. Lugares:{" "}
          <Text style={styles.mono}>SAMPLE_DESTINATIONS</Text> en{" "}
          <Text style={styles.mono}>sampleCucuta.ts</Text>.
        </Text>
        <Text style={styles.cardLine}>
          2. Rutas (GeoJSON):{" "}
          <Text style={styles.mono}>SAMPLE_ROUTES_GEOJSON</Text>; paradas:{" "}
          <Text style={styles.mono}>SAMPLE_STOPS</Text>.
        </Text>
        <Text style={styles.cardLine}>
          • API NestJS + PostGIS cuando conectes el backend.
        </Text>
        <Text style={styles.cardLine}>
          • <Text style={styles.mono}>extra.googleMapsGeocodingKey</Text> en{" "}
          <Text style={styles.mono}>app.json</Text> para direcciones con Google.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: {
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted,
    marginBottom: 28,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    marginBottom: 28,
  },
  pressed: { opacity: 0.85 },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  secondaryBtnText: { color: colors.primary, fontSize: 17, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 10,
  },
  cardLine: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted,
    marginBottom: 6,
  },
  mono: { fontFamily: "monospace", fontSize: 13, color: colors.primary },
});
