import type { SessionContext } from './auth.js';
import type { Database } from './database.js';
import { parseJson } from './http.js';

interface OrderRow {
  id: string;
  number: string;
  sequence_number: number;
  received_at: string;
  customer_name: string;
  address: string;
  status: string;
  block_reason: string | null;
  promised_at: string | null;
  amount_cents: number;
  items_count: number;
  latitude: number | null;
  longitude: number | null;
}

interface CourierRow {
  id: string;
  name: string;
  status: string;
  vehicle: string;
  plate: string | null;
  battery_percent: number | null;
  last_heartbeat_at: string | null;
  latitude: number | null;
  longitude: number | null;
  active_route_code: string | null;
  shift_started_at: string | null;
  deliveries_in_shift: number;
}

interface RouteRow {
  id: string;
  code: string;
  status: string;
  distance_km: number;
  duration_minutes: number;
  courier_id: string;
  courier_name: string;
  explanation_json: string;
  acceptance_expires_at: string | null;
}

interface StopRow {
  id: string;
  route_id: string;
  sequence: number;
  type: string;
  order_id: string | null;
  label: string;
  address: string;
  status: string;
  eta: string | null;
  latitude: number;
  longitude: number;
}

export function presentOrder(row: OrderRow) {
  const statusMap: Record<string, string> = {
    ASSIGNED: 'planned',
    IN_DELIVERY: 'on_route',
  };
  return {
    id: row.id,
    number: row.number,
    sequenceNumber: Number(row.sequence_number),
    receivedAt: row.received_at,
    customerName: row.customer_name,
    address: row.address,
    status: statusMap[row.status] ?? row.status.toLowerCase(),
    ...(row.block_reason ? { blockReason: row.block_reason } : {}),
    ...(row.promised_at ? { promisedAt: row.promised_at } : {}),
    amountCents: Number(row.amount_cents),
    itemsCount: Number(row.items_count),
    ...(row.latitude === null ? {} : { lat: Number(row.latitude) }),
    ...(row.longitude === null ? {} : { lng: Number(row.longitude) }),
  };
}

export function listOrders(database: Database, context: SessionContext) {
  const rows = database
    .prepare(
      `SELECT id, number, sequence_number, received_at, customer_name, address,
              status, block_reason, promised_at, amount_cents, items_count,
              latitude, longitude
       FROM orders
       WHERE tenant_id = ? AND branch_id = ?
       ORDER BY received_at ASC, sequence_number ASC`,
    )
    .all(context.tenantId, context.branchId) as unknown as OrderRow[];
  return rows.map(presentOrder);
}

export function presentCourier(row: CourierRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status.toLowerCase(),
    vehicle: row.vehicle,
    plate: row.plate,
    batteryPercent: row.battery_percent === null ? undefined : Number(row.battery_percent),
    lastHeartbeatAt: row.last_heartbeat_at,
    activeRouteCode: row.active_route_code,
    shiftStartedAt: row.shift_started_at ?? undefined,
    deliveriesInShift: Number(row.deliveries_in_shift),
    ...(row.latitude === null || row.longitude === null
      ? {}
      : { location: { lat: Number(row.latitude), lng: Number(row.longitude) } }),
  };
}

export function listCouriers(database: Database, context: SessionContext) {
  const rows = database
    .prepare(
      `SELECT c.id, c.name, c.status, c.vehicle, c.plate, c.battery_percent,
              c.last_heartbeat_at, c.latitude, c.longitude,
              c.shift_started_at, c.deliveries_in_shift,
              (SELECT r.code FROM routes r
               WHERE r.tenant_id = c.tenant_id AND r.courier_id = c.id
                 AND r.status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS')
               ORDER BY r.created_at DESC LIMIT 1) AS active_route_code
       FROM couriers c
       WHERE c.tenant_id = ? AND c.branch_id = ?
       ORDER BY c.name ASC`,
    )
    .all(context.tenantId, context.branchId) as unknown as CourierRow[];
  return rows.map(presentCourier);
}

export function listRoutes(
  database: Database,
  context: SessionContext,
  options: { courierId?: string; activeOnly?: boolean; routeId?: string } = {},
) {
  const clauses = ['r.tenant_id = ?', 'r.branch_id = ?'];
  const parameters: Array<string | number> = [context.tenantId, context.branchId];
  if (options.courierId) {
    clauses.push('r.courier_id = ?');
    parameters.push(options.courierId);
  }
  if (options.routeId) {
    clauses.push('r.id = ?');
    parameters.push(options.routeId);
  }
  if (options.activeOnly) clauses.push("r.status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS')");

  const routes = database
    .prepare(
      `SELECT r.id, r.code, r.status, r.distance_km, r.duration_minutes,
              r.courier_id, c.name AS courier_name, r.explanation_json,
              r.acceptance_expires_at
       FROM routes r
       JOIN couriers c ON c.tenant_id = r.tenant_id AND c.id = r.courier_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY r.created_at DESC`,
    )
    .all(...parameters) as unknown as RouteRow[];

  const stopQuery = database.prepare(
    `SELECT id, route_id, sequence, type, order_id, label, address, status,
            eta, latitude, longitude
     FROM route_stops
     WHERE tenant_id = ? AND route_id = ? AND active = 1
     ORDER BY sequence ASC`,
  );

  return routes.map((route) => {
    const stopRows = stopQuery.all(context.tenantId, route.id) as unknown as StopRow[];
    const stops = stopRows.map((stop) => ({
      id: stop.id,
      sequence: Number(stop.sequence),
      type: stop.type.toLowerCase(),
      ...(stop.order_id ? { orderId: stop.order_id } : {}),
      label: stop.label,
      address: stop.address,
      status: stop.status.toLowerCase(),
      ...(stop.eta ? { eta: stop.eta } : {}),
      lat: Number(stop.latitude),
      lng: Number(stop.longitude),
    }));
    return {
      id: route.id,
      code: route.code,
      status: route.status === 'REJECTED' ? 'refused' : route.status.toLowerCase(),
      distanceKm: Number(route.distance_km),
      durationMinutes: Number(route.duration_minutes),
      courierId: route.courier_id,
      courierName: route.courier_name,
      orders: stops.flatMap((stop) => ('orderId' in stop && stop.orderId ? [stop.orderId] : [])),
      stops,
      explanation: parseJson<string[]>(route.explanation_json, []),
      ...(route.acceptance_expires_at ? { acceptanceExpiresAt: route.acceptance_expires_at } : {}),
    };
  });
}
