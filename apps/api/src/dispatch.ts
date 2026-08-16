import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  planDispatch,
  type DispatchOrder,
  type DispatchSnapshot,
  type PlanResult,
} from '@driver-food/planner';
import type { SessionContext } from './auth.js';
import type { Database } from './database.js';
import { inImmediateTransaction } from './database.js';
import { ApiError } from './http.js';
import {
  appendAudit,
  appendEvent,
  getSettingsRow,
  readIdempotent,
  saveIdempotent,
} from './persistence.js';
import { reconcileDispatchRoutes } from './reconciliation.js';
import type { RouteCoordinates, RouteMatrix, RouteMatrixProvider } from './route-matrix.js';
import { listRoutes } from './views.js';

interface PlannerOrderRow {
  id: string;
  received_at: string;
  sequence_number: number;
  latitude: number;
  longitude: number;
  weight_kg: number;
  volume_liters: number;
  promised_at: string | null;
  number: string;
  customer_name: string;
  address: string;
}

interface PlannerCourierRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  capacity_weight_kg: number;
  capacity_volume_liters: number;
  capacity_stops: number;
  deliveries_in_shift: number;
  last_assignment_at: string | null;
  shift_started_at: string;
}

interface BranchRow {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

function mapProviderUnavailable(provider: RouteMatrixProvider): ApiError {
  return new ApiError(
    503,
    'MAP_PROVIDER_UNAVAILABLE',
    'O provedor de mapas está indisponível. Nenhuma rota foi criada; tente novamente.',
    { providerId: provider.id },
  );
}

function resolveRouteMatrix(
  provider: RouteMatrixProvider,
  locations: Readonly<Record<string, RouteCoordinates>>,
  averageSpeedKmh: number,
): RouteMatrix {
  let matrix: RouteMatrix | null;
  try {
    matrix = provider.getMatrix({ locations, averageSpeedKmh });
  } catch {
    throw mapProviderUnavailable(provider);
  }
  if (!matrix || !isCompleteMatrix(matrix, Object.keys(locations))) {
    throw mapProviderUnavailable(provider);
  }
  return matrix;
}

function isCompleteMatrix(matrix: RouteMatrix, locationIds: readonly string[]): boolean {
  const matrices = [
    matrix.travelTimeMs,
    matrix.roadDistanceMeters,
    matrix.geographicDistanceMeters,
  ];
  return matrices.every((candidate) =>
    locationIds.every((fromId) =>
      locationIds.every((toId) => {
        const value = candidate[fromId]?.[toId];
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
      }),
    ),
  );
}
export interface DispatchResponse {
  routes: ReturnType<typeof listRoutes>;
  message: string;
  stoppedAt?: { orderId: string; reasons: readonly string[] };
  unplannedOrderIds: readonly string[];
}

export function executeDispatch(
  database: Database,
  context: SessionContext,
  request: FastifyRequest,
  now: Date,
  routeMatrixProvider: RouteMatrixProvider,
): DispatchResponse {
  const replay = readIdempotent<DispatchResponse>(database, context, request, 'dispatch.plan', request.body);
  if (replay.response) return replay.response;

  return inImmediateTransaction(database, () => {
    const settings = getSettingsRow(database, context);
    reconcileDispatchRoutes(
      database,
      context,
      request,
      now,
      Number(settings.heartbeat_tolerance_seconds),
    );
    const branch = database
      .prepare('SELECT id, name, address, latitude, longitude FROM branches WHERE tenant_id = ? AND id = ?')
      .get(context.tenantId, context.branchId) as unknown as BranchRow | undefined;
    if (!branch) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Filial não encontrada.');

    const orderRows = database
      .prepare(
        `SELECT id, received_at, sequence_number, latitude, longitude, weight_kg,
                volume_liters, promised_at, number, customer_name, address
         FROM orders
         WHERE tenant_id = ? AND branch_id = ? AND status = 'READY'
           AND confirmed = 1 AND ready = 1 AND address_valid = 1 AND area_valid = 1
           AND payment_valid = 1 AND dispatch_allowed = 1 AND block_reason IS NULL
           AND assigned_route_id IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
         ORDER BY received_at ASC, sequence_number ASC`,
      )
      .all(context.tenantId, context.branchId) as unknown as PlannerOrderRow[];

    const heartbeatCutoff = new Date(
      now.getTime() - Number(settings.heartbeat_tolerance_seconds) * 1000,
    ).toISOString();
    const courierRows = database
      .prepare(
        `SELECT c.id, c.name, c.latitude, c.longitude, c.capacity_weight_kg,
                c.capacity_volume_liters, c.capacity_stops, c.deliveries_in_shift,
                c.last_assignment_at, c.shift_started_at
         FROM couriers c
         WHERE c.tenant_id = ? AND c.branch_id = ? AND c.status = 'AVAILABLE'
           AND c.shift_started_at IS NOT NULL AND c.last_heartbeat_at >= ?
           AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM users u
             JOIN sessions s ON s.user_id = u.id
             WHERE u.tenant_id = c.tenant_id AND u.branch_id = c.branch_id
               AND u.courier_id = c.id AND u.active = 1 AND s.expires_at > ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM routes r
             WHERE r.tenant_id = c.tenant_id AND r.courier_id = c.id
               AND r.status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS')
           )
         ORDER BY c.id ASC`,
      )
      .all(context.tenantId, context.branchId, heartbeatCutoff, now.toISOString()) as unknown as PlannerCourierRow[];

    const coordinates: Record<string, RouteCoordinates> = {
      [branch.id]: { latitude: Number(branch.latitude), longitude: Number(branch.longitude) },
    };
    for (const order of orderRows) {
      coordinates[order.id] = { latitude: Number(order.latitude), longitude: Number(order.longitude) };
    }
    const courierLocationIds = new Map<string, string>();
    for (const courier of courierRows) {
      const locationId = `courier:${courier.id}`;
      courierLocationIds.set(courier.id, locationId);
      coordinates[locationId] = {
        latitude: Number(courier.latitude),
        longitude: Number(courier.longitude),
      };
    }

    const normalCapacity = 1_000;
    const plannerOrders: DispatchOrder[] = orderRows.map((order) => ({
      id: order.id,
      receivedAtMs: new Date(order.received_at).getTime(),
      sequenceNumber: Number(order.sequence_number),
      locationId: order.id,
      loadUnits: Math.max(
        1,
        Math.ceil(
          Math.max(
            Number(order.weight_kg) / Number(settings.max_weight_kg),
            Number(order.volume_liters) / Number(settings.max_volume_liters),
          ) * normalCapacity,
        ),
      ),
      serviceDurationMs: Number(settings.stop_service_minutes) * 60_000,
      slaAtMs: order.promised_at ? new Date(order.promised_at).getTime() : null,
      manualOverrideId: null,
      maxDetourMs: null,
    }));

    const routing = resolveRouteMatrix(
      routeMatrixProvider,
      coordinates,
      Number(settings.average_speed_kmh),
    );
    const routeIds = new Map(courierRows.map((courier) => [courier.id, randomUUID()]));
    const snapshot: DispatchSnapshot = {
      orders: plannerOrders,
      couriers: courierRows.map((courier) => {
        const courierLocationId = courierLocationIds.get(courier.id);
        if (!courierLocationId) throw mapProviderUnavailable(routeMatrixProvider);
        const idleSince = courier.last_assignment_at ?? courier.shift_started_at;
        const capacityRatio = Math.min(
          Number(courier.capacity_weight_kg) / Number(settings.max_weight_kg),
          Number(courier.capacity_volume_liters) / Number(settings.max_volume_liters),
        );
        const pickupEtaMs = routing.travelTimeMs[courierLocationId]?.[branch.id];
        if (pickupEtaMs === undefined) throw mapProviderUnavailable(routeMatrixProvider);
        return {
          id: courier.id,
          activeLoad: 0,
          idleDurationMs: Math.max(0, now.getTime() - new Date(idleSince).getTime()),
          shiftLoad: Number(courier.deliveries_in_shift),
          pickupEtaMs,
          capacityUnits: Math.max(1, Math.floor(capacityRatio * normalCapacity)),
          maxStops: Number(courier.capacity_stops),
          route: {
            id: routeIds.get(courier.id) ?? randomUUID(),
            startLocationId: branch.id,
            startsAtMs: now.getTime(),
            baseDurationMs: pickupEtaMs + 5 * 60_000,
            stops: [],
          },
        };
      }),
      travelTimeMs: routing.travelTimeMs,
      roadDistanceMeters: routing.roadDistanceMeters,
      geographicDistanceMeters: routing.geographicDistanceMeters,
    };

    const plan = planDispatch(snapshot, {
      maxStopsPerRoute: Number(settings.max_stops_per_route),
      maxRouteDurationMs: Number(settings.max_route_minutes) * 60_000,
      maxDetourMs: Number(settings.max_extra_minutes) * 60_000,
      maxAdditionalDistanceMeters: Math.round(Number(settings.max_extra_distance_km) * 1_000),
      groupingRadiusMeters: Math.round(Number(settings.grouping_radius_km) * 1_000),
    });

    persistPlan(
      database,
      context,
      request,
      now,
      branch,
      orderRows,
      courierRows,
      routing.travelTimeMs,
      routeMatrixProvider,
      plan,
      Number(settings.acceptance_timeout_seconds),
      settings.version,
    );
    const plannedRouteIds = new Set(plan.assignments.map(({ routeId }) => routeId));
    const routes = listRoutes(database, context).filter((route) => plannedRouteIds.has(route.id));
    const response: DispatchResponse = {
      routes,
      message:
        routes.length === 0
          ? plan.stoppedAt
            ? 'Nenhuma rota foi criada: o primeiro pedido FIFO não encontrou uma opção viável.'
            : 'Não há pedidos elegíveis para planejar.'
          : plan.stoppedAt
            ? `${routes.length} rota(s) criada(s). O ciclo parou no primeiro pedido FIFO inviável.`
            : `${routes.length} rota(s) criada(s) respeitando a fila FIFO.`,
      ...(plan.stoppedAt
        ? { stoppedAt: { orderId: plan.stoppedAt.orderId, reasons: plan.stoppedAt.reasons } }
        : {}),
      unplannedOrderIds: plan.unplannedOrderIds,
    };
    saveIdempotent(database, context, 'dispatch.plan', replay.key, replay.requestHash, response, now);
    return response;
  });
}

function persistPlan(
  database: Database,
  context: SessionContext,
  request: FastifyRequest,
  now: Date,
  branch: BranchRow,
  orders: readonly PlannerOrderRow[],
  couriers: readonly PlannerCourierRow[],
  travelTimeMs: DispatchSnapshot['travelTimeMs'],
  routeMatrixProvider: RouteMatrixProvider,
  plan: PlanResult,
  acceptanceTimeoutSeconds: number,
  settingsVersion: number,
): void {
  const plannerRunId = randomUUID();
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const courierById = new Map(couriers.map((courier) => [courier.id, courier]));
  const routeAssignments = new Map<string, typeof plan.assignments>();
  for (const assignment of plan.assignments) {
    routeAssignments.set(assignment.routeId, [...(routeAssignments.get(assignment.routeId) ?? []), assignment]);
  }
  const count = database.prepare('SELECT COUNT(*) AS total FROM routes WHERE tenant_id = ?').get(context.tenantId) as {
    total: number;
  };
  let routeNumber = Number(count.total) + 1;

  for (const route of plan.routes) {
    const assignments = routeAssignments.get(route.id) ?? [];
    if (assignments.length === 0) continue;
    const courier = courierById.get(route.courierId);
    if (!courier) throw new ApiError(409, 'COURIER_CHANGED', 'O motoboy deixou de estar elegível.');
    const code = `RT-${String(routeNumber++).padStart(4, '0')}`;
    if (route.distanceMeters === null) throw mapProviderUnavailable(routeMatrixProvider);
    const explanations = assignments.map((assignment) => {
      const order = orderById.get(assignment.orderId);
      const reason = assignment.kind === 'ANCHOR' ? 'âncora FIFO' : 'agrupado por menor tempo adicional';
      return `${order?.number ?? assignment.orderId} foi ${reason} na rota de ${courier.name}.`;
    });
    explanations.push(
      routeMatrixProvider.kind === 'demo-estimate'
        ? `Distância viária estimada pelo provider demo ${routeMatrixProvider.id}: ${(route.distanceMeters / 1_000).toFixed(1)} km.`
        : `Distância viária calculada pelo provider ${routeMatrixProvider.id}: ${(route.distanceMeters / 1_000).toFixed(1)} km.`,
    );
    const expiresAt = new Date(now.getTime() + acceptanceTimeoutSeconds * 1_000).toISOString();
    database
      .prepare(
        `INSERT INTO routes (
           id, tenant_id, branch_id, courier_id, code, status, distance_km,
           duration_minutes, explanation_json, acceptance_expires_at,
           planner_run_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'OFFERED', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        route.id, context.tenantId, context.branchId, route.courierId, code,
        route.distanceMeters / 1_000,
        Math.ceil(route.durationMs / 60_000),
        JSON.stringify(explanations), expiresAt, plannerRunId, now.toISOString(), now.toISOString(),
      );
    database
      .prepare(
        `INSERT INTO route_stops (
           id, tenant_id, branch_id, route_id, order_id, sequence, type,
           label, address, latitude, longitude, status, eta, created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, 0, 'PICKUP', ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      )
      .run(
        randomUUID(), context.tenantId, context.branchId, route.id,
        `${branch.name} · retirada`, branch.address, branch.latitude, branch.longitude,
        new Date(now.getTime() + route.baseDurationMs).toISOString(), now.toISOString(), now.toISOString(),
      );

    let elapsed = route.baseDurationMs;
    let previousLocation = branch.id;
    for (let index = 0; index < route.stops.length; index += 1) {
      const stop = route.stops[index];
      if (!stop) continue;
      const order = orderById.get(stop.id);
      if (!order) throw new ApiError(409, 'ORDER_CHANGED', 'Um pedido do plano não está mais disponível.');
      const travelMs = travelTimeMs[previousLocation]?.[stop.locationId];
      if (travelMs === undefined) throw mapProviderUnavailable(routeMatrixProvider);
      elapsed += travelMs + stop.serviceDurationMs;
      const reserve = database
        .prepare(
          `UPDATE orders SET status = 'ASSIGNED', assigned_route_id = ?,
                  version = version + 1, updated_at = ?
           WHERE tenant_id = ? AND branch_id = ? AND id = ?
             AND status = 'READY' AND assigned_route_id IS NULL`,
        )
        .run(route.id, now.toISOString(), context.tenantId, context.branchId, order.id);
      if (Number(reserve.changes) !== 1) {
        throw new ApiError(409, 'ORDER_ALREADY_ASSIGNED', 'Um pedido foi atribuído por outra sessão.');
      }
      database
        .prepare(
          `INSERT INTO route_stops (
             id, tenant_id, branch_id, route_id, order_id, sequence, type,
             label, address, latitude, longitude, status, eta, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'DELIVERY', ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
        )
        .run(
          randomUUID(), context.tenantId, context.branchId, route.id, order.id, index + 1,
          `${order.number} · ${order.customer_name}`, order.address, order.latitude, order.longitude,
          new Date(now.getTime() + elapsed).toISOString(), now.toISOString(), now.toISOString(),
        );
      previousLocation = stop.locationId;
    }
    const courierUpdate = database
      .prepare(
        `UPDATE couriers SET status = 'BUSY', last_assignment_at = ?,
                deliveries_in_shift = deliveries_in_shift + ?, version = version + 1
         WHERE tenant_id = ? AND branch_id = ? AND id = ? AND status = 'AVAILABLE'`,
      )
      .run(now.toISOString(), route.stops.length, context.tenantId, context.branchId, route.courierId);
    if (Number(courierUpdate.changes) !== 1) {
      throw new ApiError(409, 'COURIER_CHANGED', 'O motoboy deixou de estar disponível.');
    }
    appendAudit(database, context, request, 'ROUTE_PLANNED', 'ROUTE', route.id, now, {
      after: { code, courierId: route.courierId, orderIds: route.stops.map(({ id }) => id) },
    });
    const courierUser = database
      .prepare('SELECT id FROM users WHERE tenant_id = ? AND courier_id = ? AND active = 1')
      .get(context.tenantId, route.courierId) as { id: string } | undefined;
    appendEvent(database, context, 'route.offered', route.id, now, { routeId: route.id }, courierUser?.id);
  }

  database
    .prepare(
      `INSERT INTO planner_runs (
         id, tenant_id, branch_id, actor_user_id, settings_version,
         stopped_at_order_id, result_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      plannerRunId, context.tenantId, context.branchId, context.userId, settingsVersion,
      plan.stoppedAt?.orderId ?? null, JSON.stringify(plan), now.toISOString(),
    );
  appendEvent(database, context, 'dispatch.planned', plannerRunId, now, {
    routeCount: new Set(plan.assignments.map(({ routeId }) => routeId)).size,
    stoppedAtOrderId: plan.stoppedAt?.orderId ?? null,
  });
}
