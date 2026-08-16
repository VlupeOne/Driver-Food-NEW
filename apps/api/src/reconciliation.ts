import type { FastifyRequest } from 'fastify';
import type { SessionContext } from './auth.js';
import type { Database } from './database.js';
import { ApiError } from './http.js';
import { appendAudit, appendEvent } from './persistence.js';

export type RouteReleaseReason =
  | 'OFFER_EXPIRED'
  | 'COURIER_OFFLINE'
  | 'HEARTBEAT_EXPIRED';

interface CandidateRow {
  id: string;
  courier_id: string;
  reason: RouteReleaseReason;
}

export interface ReleasedRoute {
  routeId: string;
  courierId: string;
  orderIds: string[];
  reason: RouteReleaseReason;
}

export function reconcileDispatchRoutes(
  database: Database,
  context: SessionContext,
  request: FastifyRequest,
  now: Date,
  heartbeatToleranceSeconds: number,
): ReleasedRoute[] {
  const heartbeatCutoff = new Date(now.getTime() - heartbeatToleranceSeconds * 1_000).toISOString();
  const candidates = database
    .prepare(
      `SELECT r.id, r.courier_id,
              CASE
                WHEN r.status = 'OFFERED' AND r.acceptance_expires_at <= ? THEN 'OFFER_EXPIRED'
                WHEN c.status = 'OFFLINE' THEN 'COURIER_OFFLINE'
                ELSE 'HEARTBEAT_EXPIRED'
              END AS reason
       FROM routes r
       JOIN couriers c ON c.tenant_id = r.tenant_id AND c.id = r.courier_id
       WHERE r.tenant_id = ? AND r.branch_id = ?
         AND r.status IN ('OFFERED', 'ACCEPTED')
         AND NOT EXISTS (
           SELECT 1 FROM route_stops pickup
           WHERE pickup.tenant_id = r.tenant_id AND pickup.route_id = r.id
             AND pickup.type = 'PICKUP' AND pickup.active = 1
             AND pickup.status = 'COMPLETED'
         )
         AND (
           (r.status = 'OFFERED' AND r.acceptance_expires_at <= ?)
           OR c.status = 'OFFLINE'
           OR c.last_heartbeat_at IS NULL
           OR c.last_heartbeat_at < ?
         )
       ORDER BY r.created_at ASC, r.id ASC`,
    )
    .all(
      now.toISOString(),
      context.tenantId,
      context.branchId,
      now.toISOString(),
      heartbeatCutoff,
    ) as unknown as CandidateRow[];

  return candidates.map((candidate) =>
    releaseUnstartedRoute(database, context, request, candidate.id, candidate.reason, now),
  );
}

export function releaseUnstartedRoute(
  database: Database,
  context: SessionContext,
  request: FastifyRequest,
  routeId: string,
  reason: RouteReleaseReason,
  now: Date,
): ReleasedRoute {
  const route = database
    .prepare(
      `SELECT r.id, r.courier_id, r.status, c.status AS courier_status,
              c.shift_started_at, c.last_heartbeat_at
       FROM routes r
       JOIN couriers c ON c.tenant_id = r.tenant_id AND c.id = r.courier_id
       WHERE r.tenant_id = ? AND r.branch_id = ? AND r.id = ?
         AND r.status IN ('OFFERED', 'ACCEPTED')
         AND NOT EXISTS (
           SELECT 1 FROM route_stops pickup
           WHERE pickup.tenant_id = r.tenant_id AND pickup.route_id = r.id
             AND pickup.type = 'PICKUP' AND pickup.active = 1
             AND pickup.status = 'COMPLETED'
         )`,
    )
    .get(context.tenantId, context.branchId, routeId) as unknown as
    | {
        id: string;
        courier_id: string;
        status: string;
        courier_status: string;
        shift_started_at: string | null;
        last_heartbeat_at: string | null;
      }
    | undefined;
  if (!route) {
    throw new ApiError(409, 'ROUTE_ALREADY_STARTED', 'A rota já começou e não pode ser liberada automaticamente.');
  }

  const orderRows = database
    .prepare(
      `SELECT order_id FROM route_stops
       WHERE tenant_id = ? AND route_id = ? AND active = 1 AND order_id IS NOT NULL
       ORDER BY sequence ASC`,
    )
    .all(context.tenantId, route.id) as unknown as Array<{ order_id: string }>;
  const orderIds = orderRows.map(({ order_id }) => order_id);

  database
    .prepare(
      `UPDATE route_stops SET active = 0, status = 'CANCELLED', updated_at = ?
       WHERE tenant_id = ? AND route_id = ? AND active = 1`,
    )
    .run(now.toISOString(), context.tenantId, route.id);
  database
    .prepare(
      `UPDATE orders SET status = 'READY', assigned_route_id = NULL,
              version = version + 1, updated_at = ?
       WHERE tenant_id = ? AND branch_id = ? AND assigned_route_id = ?`,
    )
    .run(now.toISOString(), context.tenantId, context.branchId, route.id);
  database
    .prepare(
      `UPDATE routes SET status = 'CANCELLED', version = version + 1, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
    )
    .run(now.toISOString(), context.tenantId, route.id);

  if (route.courier_status === 'BUSY') {
    const nextStatus =
      reason === 'COURIER_OFFLINE' || reason === 'HEARTBEAT_EXPIRED' || !route.shift_started_at
        ? 'OFFLINE'
        : 'AVAILABLE';
    database
      .prepare('UPDATE couriers SET status = ?, version = version + 1 WHERE tenant_id = ? AND id = ?')
      .run(nextStatus, context.tenantId, route.courier_id);
  }

  const released: ReleasedRoute = {
    routeId: route.id,
    courierId: route.courier_id,
    orderIds,
    reason,
  };
  appendAudit(database, context, request, 'ROUTE_AUTO_RELEASED', 'ROUTE', route.id, now, {
    reason,
    before: { status: route.status, courierId: route.courier_id, orderIds },
    after: { status: 'CANCELLED', releasedOrderIds: orderIds },
  });
  appendEvent(database, context, 'route.released', route.id, now, released);
  return released;
}
