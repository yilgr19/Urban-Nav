import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { MapScreen } from "../screens/MapScreen";
import { PlanRouteScreen } from "../screens/PlanRouteScreen";

export type RootStackParamList = {
  Home: undefined;
  Map: undefined;
  PlanRoute: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: "#0d47a1" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: "Urban Nav — Cúcuta" }}
      />
      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={{ title: "Mapa y rutas" }}
      />
      <Stack.Screen
        name="PlanRoute"
        component={PlanRouteScreen}
        options={{ title: "Planificar viaje", headerShown: false }}
      />
    </Stack.Navigator>
  );
}
