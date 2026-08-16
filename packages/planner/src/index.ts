export type PlanningReason =
  | "NO_COURIERS"
  | "CAPACITY_EXCEEDED"
  | "MAX_STOPS_EXCEEDED"
  | "COURIER_MAX_STOPS_EXCEEDED"
  | "MAX_ADDITIONAL_DISTANCE_EXCEEDED"
  | "GROUPING_RADIUS_EXCEEDED"
  | "MISSING_ROAD_DISTANCE"
  | "MISSING_GEOGRAPHIC_DISTANCE"
  | "MAX_ROUTE_DURATION_EXCEEDED"
  | "SLA_EXCEEDED"
  | "MAX_DETOUR_EXCEEDED"
  | "FIFO_VIOLATION"
  | "MISSING_TRAVEL_TIME";

export interface DispatchOrder {
  readonly id: string;
  readonly receivedAtMs: number;
  readonly sequenceNumber: number;
  readonly locationId: string;
  readonly loadUnits: number;
  readonly serviceDurationMs: number;
  readonly slaAtMs: number | null;
  /**
   * Identifies an explicit, audited manual exception to automatic FIFO order.
   * The planner never invents an override.
   */
  readonly manualOverrideId: string | null;
  /** Overrides the global detour limit for this order once it is on a route. */
  readonly maxDetourMs: number | null;
}

export interface RouteSnapshot {
  readonly id: string;
  readonly startLocationId: string;
  readonly startsAtMs: number;
  /** Time already committed before leaving startLocationId (for example pickup). */
  readonly baseDurationMs: number;
  readonly stops: readonly DispatchOrder[];
}

export interface CourierSnapshot {
  readonly id: string;
  readonly activeLoad: number;
  readonly idleDurationMs: number;
  readonly shiftLoad: number;
  readonly pickupEtaMs: number;
  readonly capacityUnits: number;
  /** Optional courier-specific stop ceiling, applied with the global ceiling. */
  readonly maxStops?: number;
  readonly route: RouteSnapshot;
}

export interface DispatchSnapshot {
  /** Caller supplies only orders eligible for this planning cycle. */
  readonly orders: readonly DispatchOrder[];
  /** Caller supplies only authenticated, on-shift, available couriers. */
  readonly couriers: readonly CourierSnapshot[];
  /** Directed, integer travel times. Equal locations always cost zero. */
  readonly travelTimeMs: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  /** Optional directed road distances used only as a deterministic cost tie-break. */
  readonly roadDistanceMeters?: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  /** Optional straight-line/geographic matrix used only by grouping-radius policy. */
  readonly geographicDistanceMeters?: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
}

export interface PlannerSettings {
  readonly maxStopsPerRoute: number;
  readonly maxRouteDurationMs: number;
  /** Null disables the global detour limit. Per-order limits still apply. */
  readonly maxDetourMs: number | null;
  /** Optional maximum road-distance delta accepted for route insertion. */
  readonly maxAdditionalDistanceMeters?: number | null;
  /** Optional proximity prefilter for non-anchor insertions only. */
  readonly groupingRadiusMeters?: number | null;
}

export interface CourierRank {
  readonly activeLoad: number;
  readonly idleDurationMs: number;
  readonly shiftLoad: number;
  readonly pickupEtaMs: number;
  readonly courierId: string;
}

export interface PlannedAssignment {
  readonly orderId: string;
  readonly courierId: string;
  readonly routeId: string;
  readonly insertionIndex: number;
  readonly kind: "ANCHOR" | "INSERTION";
  readonly deltaDurationMs: number;
  /** Null when the snapshot did not provide enough road-distance data. */
  readonly deltaDistanceMeters: number | null;
  readonly courierRank: CourierRank;
  readonly manualOverrideIds: readonly string[];
}

export interface PlannedRoute {
  readonly id: string;
  readonly courierId: string;
  readonly startLocationId: string;
  readonly startsAtMs: number;
  readonly baseDurationMs: number;
  readonly durationMs: number;
  /** Null when roadDistanceMeters was not provided or was incomplete. */
  readonly distanceMeters: number | null;
  readonly stops: readonly DispatchOrder[];
}

export interface CourierRejection {
  readonly courierId: string;
  readonly reasons: readonly PlanningReason[];
}

export interface StoppedAt {
  readonly orderId: string;
  readonly receivedAtMs: number;
  readonly sequenceNumber: number;
  readonly reasons: readonly PlanningReason[];
  readonly rejections: readonly CourierRejection[];
}

export interface PlanResult {
  /** Always follows the immutable (receivedAtMs, sequenceNumber) FIFO key. */
  readonly orderedOrderIds: readonly string[];
  readonly assignments: readonly PlannedAssignment[];
  readonly routes: readonly PlannedRoute[];
  /** First FIFO head that could not be placed, or null when all were placed. */
  readonly stoppedAt: StoppedAt | null;
  /** stoppedAt and its untouched FIFO tail, in FIFO order. */
  readonly unplannedOrderIds: readonly string[];
}

interface MutableRoute {
  id: string;
  startLocationId: string;
  startsAtMs: number;
  baseDurationMs: number;
  stops: DispatchOrder[];
}

interface MutableCourier {
  id: string;
  activeLoad: number;
  idleDurationMs: number;
  shiftLoad: number;
  pickupEtaMs: number;
  capacityUnits: number;
  maxStops: number | null;
  route: MutableRoute;
}

interface RouteMetrics {
  durationMs: number;
  distanceMeters: number | null;
  completionByOrderId: ReadonlyMap<string, number>;
}

interface Evaluation {
  route: MutableRoute;
  insertionIndex: number;
  deltaDurationMs: number;
  deltaDistanceMeters: number | null;
  manualOverrideIds: readonly string[];
}

interface CourierEvaluation {
  courier: MutableCourier;
  candidate: Evaluation | null;
  reasons: readonly PlanningReason[];
}

const REASON_ORDER: readonly PlanningReason[] = [
  "NO_COURIERS",
  "MISSING_TRAVEL_TIME",
  "MISSING_ROAD_DISTANCE",
  "MISSING_GEOGRAPHIC_DISTANCE",
  "FIFO_VIOLATION",
  "GROUPING_RADIUS_EXCEEDED",
  "CAPACITY_EXCEEDED",
  "MAX_STOPS_EXCEEDED",
  "COURIER_MAX_STOPS_EXCEEDED",
  "MAX_ADDITIONAL_DISTANCE_EXCEEDED",
  "MAX_ROUTE_DURATION_EXCEEDED",
  "SLA_EXCEEDED",
  "MAX_DETOUR_EXCEEDED",
];

export class PlannerInputError extends Error {
  override readonly name = "PlannerInputError";
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFifo(left: DispatchOrder, right: DispatchOrder): number {
  return (
    compareNumber(left.receivedAtMs, right.receivedAtMs) ||
    compareNumber(left.sequenceNumber, right.sequenceNumber)
  );
}

function rankOf(courier: MutableCourier): CourierRank {
  return {
    activeLoad: courier.activeLoad,
    idleDurationMs: courier.idleDurationMs,
    shiftLoad: courier.shiftLoad,
    pickupEtaMs: courier.pickupEtaMs,
    courierId: courier.id,
  };
}

function compareRank(left: CourierRank, right: CourierRank): number {
  return (
    compareNumber(left.activeLoad, right.activeLoad) ||
    compareNumber(right.idleDurationMs, left.idleDurationMs) ||
    compareNumber(left.shiftLoad, right.shiftLoad) ||
    compareNumber(left.pickupEtaMs, right.pickupEtaMs) ||
    compareString(left.courierId, right.courierId)
  );
}

function validateNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PlannerInputError(`${field} must be a non-negative safe integer`);
  }
}

function validateInput(
  snapshot: DispatchSnapshot,
  settings: PlannerSettings,
): void {
  validateNonNegativeInteger(settings.maxStopsPerRoute, "maxStopsPerRoute");
  validateNonNegativeInteger(
    settings.maxRouteDurationMs,
    "maxRouteDurationMs",
  );
  if (settings.maxDetourMs !== null) {
    validateNonNegativeInteger(settings.maxDetourMs, "maxDetourMs");
  }
  if (settings.maxAdditionalDistanceMeters != null) {
    validateNonNegativeInteger(
      settings.maxAdditionalDistanceMeters,
      "maxAdditionalDistanceMeters",
    );
  }
  if (settings.groupingRadiusMeters != null) {
    validateNonNegativeInteger(
      settings.groupingRadiusMeters,
      "groupingRadiusMeters",
    );
  }

  const orderIds = new Set<string>();
  const fifoKeys = new Set<string>();
  for (const order of snapshot.orders) {
    if (orderIds.has(order.id)) {
      throw new PlannerInputError(`duplicate pending order id: ${order.id}`);
    }
    orderIds.add(order.id);
    const fifoKey = `${order.receivedAtMs}:${order.sequenceNumber}`;
    if (fifoKeys.has(fifoKey)) {
      throw new PlannerInputError(`duplicate FIFO key: ${fifoKey}`);
    }
    fifoKeys.add(fifoKey);
    validateOrder(order, `orders[${order.id}]`);
  }

  const courierIds = new Set<string>();
  const routeIds = new Set<string>();
  for (const courier of snapshot.couriers) {
    if (courierIds.has(courier.id)) {
      throw new PlannerInputError(`duplicate courier id: ${courier.id}`);
    }
    if (routeIds.has(courier.route.id)) {
      throw new PlannerInputError(`duplicate route id: ${courier.route.id}`);
    }
    courierIds.add(courier.id);
    routeIds.add(courier.route.id);
    validateNonNegativeInteger(courier.activeLoad, `${courier.id}.activeLoad`);
    validateNonNegativeInteger(
      courier.idleDurationMs,
      `${courier.id}.idleDurationMs`,
    );
    validateNonNegativeInteger(courier.shiftLoad, `${courier.id}.shiftLoad`);
    validateNonNegativeInteger(courier.pickupEtaMs, `${courier.id}.pickupEtaMs`);
    validateNonNegativeInteger(
      courier.capacityUnits,
      `${courier.id}.capacityUnits`,
    );
    if (courier.maxStops !== undefined) {
      validateNonNegativeInteger(courier.maxStops, `${courier.id}.maxStops`);
    }
    validateNonNegativeInteger(
      courier.route.startsAtMs,
      `${courier.route.id}.startsAtMs`,
    );
    validateNonNegativeInteger(
      courier.route.baseDurationMs,
      `${courier.route.id}.baseDurationMs`,
    );
    const routeOrderIds = new Set<string>();
    for (const stop of courier.route.stops) {
      if (routeOrderIds.has(stop.id)) {
        throw new PlannerInputError(
          `duplicate order ${stop.id} in route ${courier.route.id}`,
        );
      }
      routeOrderIds.add(stop.id);
      validateOrder(stop, `routes[${courier.route.id}].stops[${stop.id}]`);
    }
  }
}

function validateOrder(order: DispatchOrder, field: string): void {
  validateNonNegativeInteger(order.receivedAtMs, `${field}.receivedAtMs`);
  validateNonNegativeInteger(order.sequenceNumber, `${field}.sequenceNumber`);
  validateNonNegativeInteger(order.loadUnits, `${field}.loadUnits`);
  validateNonNegativeInteger(
    order.serviceDurationMs,
    `${field}.serviceDurationMs`,
  );
  if (order.slaAtMs !== null) {
    validateNonNegativeInteger(order.slaAtMs, `${field}.slaAtMs`);
  }
  if (order.maxDetourMs !== null) {
    validateNonNegativeInteger(order.maxDetourMs, `${field}.maxDetourMs`);
  }
}

function travelTime(
  matrix: DispatchSnapshot["travelTimeMs"],
  from: string,
  to: string,
): number | null {
  if (from === to) return 0;
  const value = matrix[from]?.[to];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function matrixDistance(
  matrix: DispatchSnapshot["roadDistanceMeters"],
  from: string,
  to: string,
): number | null {
  if (matrix === undefined) return null;
  if (from === to) return 0;
  const value = matrix[from]?.[to];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function measureRoute(
  route: MutableRoute,
  travelMatrix: DispatchSnapshot["travelTimeMs"],
  distanceMatrix: DispatchSnapshot["roadDistanceMeters"],
): RouteMetrics | null {
  let durationMs = route.baseDurationMs;
  let distanceMeters: number | null = distanceMatrix === undefined ? null : 0;
  let previousLocation = route.startLocationId;
  const completionByOrderId = new Map<string, number>();

  for (const stop of route.stops) {
    const travelMs = travelTime(travelMatrix, previousLocation, stop.locationId);
    if (travelMs === null) return null;
    durationMs += travelMs + stop.serviceDurationMs;
    if (!Number.isSafeInteger(durationMs)) return null;
    if (distanceMeters !== null) {
      const segmentMeters = matrixDistance(
        distanceMatrix,
        previousLocation,
        stop.locationId,
      );
      distanceMeters =
        segmentMeters === null ? null : distanceMeters + segmentMeters;
    }
    completionByOrderId.set(stop.id, route.startsAtMs + durationMs);
    previousLocation = stop.locationId;
  }

  return { durationMs, distanceMeters, completionByOrderId };
}

function preservesAutomaticFifo(
  stops: readonly DispatchOrder[],
  order: DispatchOrder,
  insertionIndex: number,
): boolean {
  for (let index = 0; index < stops.length; index += 1) {
    const existing = stops[index];
    if (existing === undefined) continue;
    if (order.manualOverrideId !== null || existing.manualOverrideId !== null) {
      continue;
    }
    if (index < insertionIndex && compareFifo(existing, order) > 0) return false;
    if (index >= insertionIndex && compareFifo(order, existing) > 0) return false;
  }
  return true;
}

function groupingRejection(
  route: MutableRoute,
  order: DispatchOrder,
  snapshot: DispatchSnapshot,
  settings: PlannerSettings,
  mode: PlannedAssignment["kind"],
): PlanningReason | null {
  const radiusMeters = settings.groupingRadiusMeters ?? null;
  if (mode === "ANCHOR" || radiusMeters === null) return null;
  if (route.stops.length === 0) return "GROUPING_RADIUS_EXCEEDED";

  const matrix = snapshot.geographicDistanceMeters;
  if (matrix === undefined) return "MISSING_GEOGRAPHIC_DISTANCE";

  let hasMissingPair = false;
  for (const existing of route.stops) {
    const distanceMeters = matrixDistance(
      matrix,
      existing.locationId,
      order.locationId,
    );
    if (distanceMeters === null) {
      hasMissingPair = true;
      continue;
    }
    if (distanceMeters <= radiusMeters) return null;
  }

  return hasMissingPair
    ? "MISSING_GEOGRAPHIC_DISTANCE"
    : "GROUPING_RADIUS_EXCEEDED";
}

function sortedReasons(reasons: Iterable<PlanningReason>): PlanningReason[] {
  const unique = new Set(reasons);
  return REASON_ORDER.filter((reason) => unique.has(reason));
}

function evaluatePosition(
  courier: MutableCourier,
  order: DispatchOrder,
  insertionIndex: number,
  snapshot: DispatchSnapshot,
  settings: PlannerSettings,
  baseline: RouteMetrics | null,
  mode: PlannedAssignment["kind"],
): { candidate: Evaluation | null; reasons: readonly PlanningReason[] } {
  const reasons = new Set<PlanningReason>();
  const route = courier.route;

  const groupingReason = groupingRejection(route, order, snapshot, settings, mode);
  if (groupingReason !== null) reasons.add(groupingReason);

  if (!preservesAutomaticFifo(route.stops, order, insertionIndex)) {
    reasons.add("FIFO_VIOLATION");
  }

  const projectedStops = route.stops.slice();
  projectedStops.splice(insertionIndex, 0, order);
  const projectedRoute: MutableRoute = { ...route, stops: projectedStops };

  const totalLoad = projectedStops.reduce(
    (sum, stop) => sum + stop.loadUnits,
    0,
  );
  if (totalLoad > courier.capacityUnits) reasons.add("CAPACITY_EXCEEDED");
  if (projectedStops.length > settings.maxStopsPerRoute) {
    reasons.add("MAX_STOPS_EXCEEDED");
  }
  if (
    courier.maxStops !== null &&
    projectedStops.length > courier.maxStops
  ) {
    reasons.add("COURIER_MAX_STOPS_EXCEEDED");
  }

  const projected = measureRoute(
    projectedRoute,
    snapshot.travelTimeMs,
    snapshot.roadDistanceMeters,
  );
  if (baseline === null || projected === null) {
    reasons.add("MISSING_TRAVEL_TIME");
  } else {
    const maxAdditionalDistanceMeters =
      settings.maxAdditionalDistanceMeters ?? null;
    if (maxAdditionalDistanceMeters !== null) {
      if (baseline.distanceMeters === null || projected.distanceMeters === null) {
        reasons.add("MISSING_ROAD_DISTANCE");
      } else if (
        projected.distanceMeters - baseline.distanceMeters >
        maxAdditionalDistanceMeters
      ) {
        reasons.add("MAX_ADDITIONAL_DISTANCE_EXCEEDED");
      }
    }

    if (projected.durationMs > settings.maxRouteDurationMs) {
      reasons.add("MAX_ROUTE_DURATION_EXCEEDED");
    }

    for (const stop of projectedStops) {
      const completion = projected.completionByOrderId.get(stop.id);
      if (
        completion !== undefined &&
        stop.slaAtMs !== null &&
        completion > stop.slaAtMs
      ) {
        reasons.add("SLA_EXCEEDED");
      }
    }

    for (const existing of route.stops) {
      const before = baseline.completionByOrderId.get(existing.id);
      const after = projected.completionByOrderId.get(existing.id);
      const detourLimit = existing.maxDetourMs ?? settings.maxDetourMs;
      if (
        before !== undefined &&
        after !== undefined &&
        detourLimit !== null &&
        after - before > detourLimit
      ) {
        reasons.add("MAX_DETOUR_EXCEEDED");
      }
    }
  }

  if (reasons.size > 0 || baseline === null || projected === null) {
    return { candidate: null, reasons: sortedReasons(reasons) };
  }

  const deltaDurationMs = projected.durationMs - baseline.durationMs;
  if (deltaDurationMs < 0) {
    throw new PlannerInputError("insertion produced a negative duration delta");
  }

  const deltaDistanceMeters =
    baseline.distanceMeters === null || projected.distanceMeters === null
      ? null
      : projected.distanceMeters - baseline.distanceMeters;
  if (deltaDistanceMeters !== null && deltaDistanceMeters < 0) {
    throw new PlannerInputError(
      "insertion produced a negative road-distance delta",
    );
  }

  const manualOverrideIds = [
    order.manualOverrideId,
    ...route.stops.map((stop) => stop.manualOverrideId),
  ].filter((id): id is string => id !== null);

  return {
    candidate: {
      route: projectedRoute,
      insertionIndex,
      deltaDurationMs,
      deltaDistanceMeters,
      manualOverrideIds: [...new Set(manualOverrideIds)].sort(compareString),
    },
    reasons: [],
  };
}

function compareOptionalDistance(
  left: number | null,
  right: number | null,
): number {
  if (left !== null && right !== null) return compareNumber(left, right);
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

function compareEvaluation(left: Evaluation, right: Evaluation): number {
  return (
    compareNumber(left.deltaDurationMs, right.deltaDurationMs) ||
    compareOptionalDistance(
      left.deltaDistanceMeters,
      right.deltaDistanceMeters,
    ) ||
    compareString(left.route.id, right.route.id) ||
    compareNumber(left.insertionIndex, right.insertionIndex)
  );
}

function evaluateCourier(
  courier: MutableCourier,
  order: DispatchOrder,
  snapshot: DispatchSnapshot,
  settings: PlannerSettings,
  mode: PlannedAssignment["kind"],
): CourierEvaluation {
  const baseline = measureRoute(
    courier.route,
    snapshot.travelTimeMs,
    snapshot.roadDistanceMeters,
  );
  let best: Evaluation | null = null;
  const reasons = new Set<PlanningReason>();

  for (
    let insertionIndex = 0;
    insertionIndex <= courier.route.stops.length;
    insertionIndex += 1
  ) {
    const result = evaluatePosition(
      courier,
      order,
      insertionIndex,
      snapshot,
      settings,
      baseline,
      mode,
    );
    for (const reason of result.reasons) reasons.add(reason);
    if (
      result.candidate !== null &&
      (best === null || compareEvaluation(result.candidate, best) < 0)
    ) {
      best = result.candidate;
    }
  }

  return {
    courier,
    candidate: best,
    reasons: best === null ? sortedReasons(reasons) : [],
  };
}

function compareAnchor(
  left: CourierEvaluation,
  right: CourierEvaluation,
): number {
  if (left.candidate === null || right.candidate === null) return 0;
  return (
    compareNumber(
      left.candidate.deltaDurationMs,
      right.candidate.deltaDurationMs,
    ) ||
    compareOptionalDistance(
      left.candidate.deltaDistanceMeters,
      right.candidate.deltaDistanceMeters,
    ) ||
    compareRank(rankOf(left.courier), rankOf(right.courier)) ||
    compareString(left.candidate.route.id, right.candidate.route.id) ||
    compareNumber(
      left.candidate.insertionIndex,
      right.candidate.insertionIndex,
    )
  );
}

function compareInsertion(
  left: CourierEvaluation,
  right: CourierEvaluation,
): number {
  if (left.candidate === null || right.candidate === null) return 0;
  return (
    compareNumber(
      left.candidate.deltaDurationMs,
      right.candidate.deltaDurationMs,
    ) ||
    compareOptionalDistance(
      left.candidate.deltaDistanceMeters,
      right.candidate.deltaDistanceMeters,
    ) ||
    compareRank(rankOf(left.courier), rankOf(right.courier)) ||
    compareString(left.candidate.route.id, right.candidate.route.id) ||
    compareNumber(
      left.candidate.insertionIndex,
      right.candidate.insertionIndex,
    )
  );
}

/**
 * Pure, deterministic dispatch planning. Eligibility, clocks, persistence,
 * locks and routing-provider I/O belong to the caller.
 */
export function planDispatch(
  snapshot: DispatchSnapshot,
  settings: PlannerSettings,
): PlanResult {
  validateInput(snapshot, settings);

  const orderedOrders = snapshot.orders.slice().sort(compareFifo);
  const couriers: MutableCourier[] = snapshot.couriers
    .map((courier) => ({
      id: courier.id,
      activeLoad: courier.activeLoad,
      idleDurationMs: courier.idleDurationMs,
      shiftLoad: courier.shiftLoad,
      pickupEtaMs: courier.pickupEtaMs,
      capacityUnits: courier.capacityUnits,
      maxStops: courier.maxStops ?? null,
      route: {
        id: courier.route.id,
        startLocationId: courier.route.startLocationId,
        startsAtMs: courier.route.startsAtMs,
        baseDurationMs: courier.route.baseDurationMs,
        stops: courier.route.stops.slice(),
      },
    }))
    .sort((left, right) => compareString(left.id, right.id));

  const anchored = new Set<string>();
  const assignments: PlannedAssignment[] = [];
  let stoppedAt: StoppedAt | null = null;
  let stoppedIndex = orderedOrders.length;

  for (let orderIndex = 0; orderIndex < orderedOrders.length; orderIndex += 1) {
    const order = orderedOrders[orderIndex];
    if (order === undefined) continue;

    if (couriers.length === 0) {
      stoppedAt = {
        orderId: order.id,
        receivedAtMs: order.receivedAtMs,
        sequenceNumber: order.sequenceNumber,
        reasons: ["NO_COURIERS"],
        rejections: [],
      };
      stoppedIndex = orderIndex;
      break;
    }

    const evaluations = couriers.map((courier) =>
      evaluateCourier(
        courier,
        order,
        snapshot,
        settings,
        anchored.has(courier.id) ? "INSERTION" : "ANCHOR",
      ),
    );
    const feasible = evaluations.filter(
      (evaluation): evaluation is CourierEvaluation & { candidate: Evaluation } =>
        evaluation.candidate !== null,
    );
    const anchorOptions = feasible.filter(
      (evaluation) => !anchored.has(evaluation.courier.id),
    );

    let selected: (CourierEvaluation & { candidate: Evaluation }) | undefined;
    let kind: PlannedAssignment["kind"];

    if (anchorOptions.length > 0) {
      selected = anchorOptions.sort(compareAnchor)[0];
      kind = "ANCHOR";
    } else if (feasible.length > 0) {
      selected = feasible.sort(compareInsertion)[0];
      kind = "INSERTION";
    } else {
      const rejections = evaluations
        .map((evaluation) => ({
          courierId: evaluation.courier.id,
          reasons: evaluation.reasons,
        }))
        .sort((left, right) => compareString(left.courierId, right.courierId));
      stoppedAt = {
        orderId: order.id,
        receivedAtMs: order.receivedAtMs,
        sequenceNumber: order.sequenceNumber,
        reasons: sortedReasons(rejections.flatMap(({ reasons }) => reasons)),
        rejections,
      };
      stoppedIndex = orderIndex;
      break;
    }

    if (selected === undefined) {
      throw new PlannerInputError("planner failed to choose a feasible candidate");
    }

    const rank = rankOf(selected.courier);
    const insertionIndex = selected.candidate.insertionIndex;
    selected.courier.route = selected.candidate.route;
    selected.courier.activeLoad += 1;
    selected.courier.shiftLoad += 1;
    selected.courier.idleDurationMs = 0;
    if (kind === "ANCHOR") anchored.add(selected.courier.id);

    assignments.push({
      orderId: order.id,
      courierId: selected.courier.id,
      routeId: selected.candidate.route.id,
      insertionIndex,
      kind,
      deltaDurationMs: selected.candidate.deltaDurationMs,
      deltaDistanceMeters: selected.candidate.deltaDistanceMeters,
      courierRank: rank,
      manualOverrideIds: selected.candidate.manualOverrideIds,
    });
  }

  const routes: PlannedRoute[] = couriers.map((courier) => {
    const metrics = measureRoute(
      courier.route,
      snapshot.travelTimeMs,
      snapshot.roadDistanceMeters,
    );
    if (metrics === null) {
      throw new PlannerInputError(
        `route ${courier.route.id} has missing travel-time data`,
      );
    }
    return {
      id: courier.route.id,
      courierId: courier.id,
      startLocationId: courier.route.startLocationId,
      startsAtMs: courier.route.startsAtMs,
      baseDurationMs: courier.route.baseDurationMs,
      durationMs: metrics.durationMs,
      distanceMeters: metrics.distanceMeters,
      stops: courier.route.stops.slice(),
    };
  });

  return {
    orderedOrderIds: orderedOrders.map(({ id }) => id),
    assignments,
    routes,
    stoppedAt,
    unplannedOrderIds: orderedOrders.slice(stoppedIndex).map(({ id }) => id),
  };
}
