export interface RouteCoordinates {
  latitude: number;
  longitude: number;
}

export interface RouteMatrixRequest {
  locations: Readonly<Record<string, RouteCoordinates>>;
  averageSpeedKmh: number;
}

export interface RouteMatrix {
  travelTimeMs: Readonly<Record<string, Readonly<Record<string, number>>>>;
  roadDistanceMeters: Readonly<Record<string, Readonly<Record<string, number>>>>;
  geographicDistanceMeters: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/**
 * Synchronous because the SQLite planning transaction must stay atomic. A future
 * remote adapter should supply a previously fetched/cached matrix through this
 * boundary instead of holding the write transaction open during network I/O.
 */
export interface RouteMatrixProvider {
  readonly id: string;
  readonly kind: 'demo-estimate' | 'road-network';
  getMatrix(request: RouteMatrixRequest): RouteMatrix | null;
}

const EARTH_RADIUS_KM = 6_371;
const DEMO_ROAD_DISTANCE_FACTOR = 1.25;

function haversineKm(left: RouteCoordinates, right: RouteCoordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const latDelta = radians(right.latitude - left.latitude);
  const lngDelta = radians(right.longitude - left.longitude);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Local deterministic estimate for development/demo use; it is not live road data. */
export class DemoRouteMatrixProvider implements RouteMatrixProvider {
  readonly id = 'demo-haversine-urban-factor-1.25';
  readonly kind = 'demo-estimate' as const;

  getMatrix({ locations, averageSpeedKmh }: RouteMatrixRequest): RouteMatrix {
    const speedKmh = Math.max(averageSpeedKmh, 1);
    const travelTimeMs: Record<string, Record<string, number>> = {};
    const roadDistanceMeters: Record<string, Record<string, number>> = {};
    const geographicDistanceMeters: Record<string, Record<string, number>> = {};

    for (const [fromId, from] of Object.entries(locations)) {
      const timeRow: Record<string, number> = {};
      const roadDistanceRow: Record<string, number> = {};
      const geographicDistanceRow: Record<string, number> = {};
      for (const [toId, to] of Object.entries(locations)) {
        const geographicMeters =
          fromId === toId ? 0 : Math.max(0, Math.round(haversineKm(from, to) * 1_000));
        const roadMeters = Math.max(
          geographicMeters,
          Math.round(geographicMeters * DEMO_ROAD_DISTANCE_FACTOR),
        );
        geographicDistanceRow[toId] = geographicMeters;
        roadDistanceRow[toId] = roadMeters;
        timeRow[toId] = Math.max(
          0,
          Math.round((roadMeters / 1_000 / speedKmh) * 60 * 60_000),
        );
      }
      travelTimeMs[fromId] = timeRow;
      roadDistanceMeters[fromId] = roadDistanceRow;
      geographicDistanceMeters[fromId] = geographicDistanceRow;
    }

    return { travelTimeMs, roadDistanceMeters, geographicDistanceMeters };
  }
}
