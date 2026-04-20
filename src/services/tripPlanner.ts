import type {
  BusRoute,
  FullTripPlan,
  LatLng,
  TripPlannerResult,
} from "../types/mobility";
import {
  haversineMeters,
  nearestPointOnPolyline,
  polylineLengthMeters,
  slicePolylineByHits,
} from "../utils/geo";

const WALK_SPEED_M_S = 1.25; // ~4,5 km/h

function walkDurationMinutes(distanceMeters: number): number {
  if (distanceMeters <= 0) return 0;
  return distanceMeters / WALK_SPEED_M_S / 60;
}

/**
 * Elige la ruta que minimiza caminata (usuario→ruta + ruta→destino),
 * con abordaje antes que bajada según el sentido digitalizado.
 */
export function planFullTrip(
  user: LatLng,
  destination: LatLng,
  routes: BusRoute[],
): TripPlannerResult {
  if (!routes.length) {
    return { ok: false, reason: "No hay rutas cargadas." };
  }

  let best: {
    route: BusRoute;
    score: number;
    board: NonNullable<ReturnType<typeof nearestPointOnPolyline>>;
    alight: NonNullable<ReturnType<typeof nearestPointOnPolyline>>;
    walkU: number;
    walkD: number;
    busLen: number;
  } | null = null;

  for (const route of routes) {
    const path = route.path;
    if (path.length < 2) continue;

    const nu = nearestPointOnPolyline(path, user);
    const nd = nearestPointOnPolyline(path, destination);
    if (!nu || !nd) continue;

    if (nu.cumDistMeters > nd.cumDistMeters - 1) {
      continue;
    }

    const walkU = haversineMeters(user, nu.point);
    const walkD = haversineMeters(nd.point, destination);
    const busLen = nd.cumDistMeters - nu.cumDistMeters;
    const score = walkU + walkD;

    if (!best || score < best.score) {
      best = { route, score, board: nu, alight: nd, walkU, walkD, busLen };
    }
  }

  if (!best) {
    return {
      ok: false,
      reason:
        "Ninguna ruta encaja en el sentido del mapa hacia tu destino. Prueba otro destino o revisa el trazado.",
    };
  }

  const { route, board, alight, walkU, walkD, busLen } = best;
  const path = route.path;
  const totalLen = polylineLengthMeters(path);
  const busCoords = slicePolylineByHits(path, board, alight);

  const busFraction =
    totalLen > 0 ? Math.min(1, Math.max(0, busLen / totalLen)) : 0;
  const busMinutes = busFraction * route.fullLineDurationMinutes;

  const walkToBoard: FullTripPlan["walkToBoard"] = {
    kind: "walk",
    coordinates: [user, board.point],
    distanceMeters: walkU,
    durationMinutes: walkDurationMinutes(walkU),
  };

  const walkFromAlight: FullTripPlan["walkFromAlight"] = {
    kind: "walk",
    coordinates: [alight.point, destination],
    distanceMeters: walkD,
    durationMinutes: walkDurationMinutes(walkD),
  };

  const busSeg: FullTripPlan["bus"] = {
    kind: "bus",
    routeId: route.id,
    routeCode: route.code,
    coordinates: busCoords.length >= 2 ? busCoords : [board.point, alight.point],
    distanceMeters: busLen,
    durationMinutes: Math.max(1, busMinutes),
  };

  const estimatedWaitMinutes = Math.max(0, route.headwayMinutes / 2);
  const totalTripMinutes =
    walkToBoard.durationMinutes +
    estimatedWaitMinutes +
    busSeg.durationMinutes +
    walkFromAlight.durationMinutes;

  const plan: FullTripPlan = {
    route,
    boardingPoint: board.point,
    alightingPoint: alight.point,
    walkToBoard,
    bus: busSeg,
    walkFromAlight,
    estimatedWaitMinutes,
    totalTripMinutes,
    busPathMeters: busLen,
  };

  return { ok: true, plan };
}
