import type { FastifyRequest } from 'fastify';
import type { SessionContext } from './auth.js';
import type { Database } from './database.js';
import { ApiError } from './http.js';
import { hashRequest } from './security.js';

export interface SettingsDto {
  maxStopsPerRoute: number;
  maxWeightKg: number;
  maxVolumeLiters: number;
  groupingRadiusKm: number;
  maxExtraDistanceKm: number;
  maxExtraMinutes: number;
  maxRouteMinutes: number;
  maxWaitMinutes: number;
  pickupSlaMinutes: number;
  deliverySlaMinutes: number;
  acceptanceTimeoutSeconds: number;
  heartbeatToleranceSeconds: number;
  locationToleranceSeconds: number;
}

interface SettingsRow {
  max_stops_per_route: number;
  max_weight_kg: number;
  max_volume_liters: number;
  grouping_radius_km: number;
  max_extra_distance_km: number;
  max_extra_minutes: number;
  max_route_minutes: number;
  max_wait_minutes: number;
  pickup_sla_minutes: number;
  delivery_sla_minutes: number;
  acceptance_timeout_seconds: number;
  heartbeat_tolerance_seconds: number;
  location_tolerance_seconds: number;
  average_speed_kmh: number;
  stop_service_minutes: number;
  version: number;
}

export function getSettingsRow(database: Database, context: SessionContext): SettingsRow {
  const row = database
    .prepare('SELECT * FROM settings WHERE tenant_id = ? AND branch_id = ?')
    .get(context.tenantId, context.branchId) as unknown as SettingsRow | undefined;
  if (!row) throw new ApiError(404, 'SETTINGS_NOT_FOUND', 'Configurações da filial não encontradas.');
  return row;
}

export function presentSettings(row: SettingsRow): SettingsDto {
  return {
    maxStopsPerRoute: Number(row.max_stops_per_route),
    maxWeightKg: Number(row.max_weight_kg),
    maxVolumeLiters: Number(row.max_volume_liters),
    groupingRadiusKm: Number(row.grouping_radius_km),
    maxExtraDistanceKm: Number(row.max_extra_distance_km),
    maxExtraMinutes: Number(row.max_extra_minutes),
    maxRouteMinutes: Number(row.max_route_minutes),
    maxWaitMinutes: Number(row.max_wait_minutes),
    pickupSlaMinutes: Number(row.pickup_sla_minutes),
    deliverySlaMinutes: Number(row.delivery_sla_minutes),
    acceptanceTimeoutSeconds: Number(row.acceptance_timeout_seconds),
    heartbeatToleranceSeconds: Number(row.heartbeat_tolerance_seconds),
    locationToleranceSeconds: Number(row.location_tolerance_seconds),
  };
}

export function appendAudit(
  database: Database,
  context: SessionContext,
  request: FastifyRequest,
  action: string,
  entityType: string,
  entityId: string,
  now: Date,
  options: { reason?: string; before?: unknown; after?: unknown } = {},
): number {
  const result = database
    .prepare(
      `INSERT INTO audit_logs (
         tenant_id, branch_id, actor_user_id, action, entity_type, entity_id,
         reason, before_json, after_json, request_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      context.tenantId,
      context.branchId,
      context.userId,
      action,
      entityType,
      entityId,
      options.reason ?? null,
      options.before === undefined ? null : JSON.stringify(options.before),
      options.after === undefined ? null : JSON.stringify(options.after),
      request.id,
      now.toISOString(),
    );
  return Number(result.lastInsertRowid);
}

export function appendEvent(
  database: Database,
  context: Pick<SessionContext, 'tenantId' | 'branchId'>,
  type: string,
  entityId: string,
  now: Date,
  payload: unknown = {},
  audienceUserId?: string,
): number {
  const result = database
    .prepare(
      `INSERT INTO outbox_events (
         tenant_id, branch_id, audience_user_id, type, entity_id, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      context.tenantId,
      context.branchId,
      audienceUserId ?? null,
      type,
      entityId,
      JSON.stringify(payload),
      now.toISOString(),
    );
  return Number(result.lastInsertRowid);
}

export function readIdempotent<T>(
  database: Database,
  context: SessionContext,
  request: FastifyRequest,
  scope: string,
  body: unknown,
): { key?: string; requestHash: string; response?: T } {
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  const requestHash = hashRequest(body);
  if (!key) return { requestHash };
  if (key.length > 200) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key é muito longa.');
  const row = database
    .prepare(
      `SELECT request_hash, response_json FROM idempotency_keys
       WHERE tenant_id = ? AND actor_user_id = ? AND scope = ? AND key = ?`,
    )
    .get(context.tenantId, context.userId, scope, key) as unknown as
    | { request_hash: string; response_json: string }
    | undefined;
  if (!row) return { key, requestHash };
  if (row.request_hash !== requestHash) {
    throw new ApiError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'A mesma Idempotency-Key já foi usada com outro conteúdo.',
    );
  }
  return { key, requestHash, response: JSON.parse(row.response_json) as T };
}

export function saveIdempotent(
  database: Database,
  context: SessionContext,
  scope: string,
  key: string | undefined,
  requestHash: string,
  response: unknown,
  now: Date,
): void {
  if (!key) return;
  database
    .prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, actor_user_id, scope, key, request_hash, response_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      context.tenantId,
      context.userId,
      scope,
      key,
      requestHash,
      JSON.stringify(response),
      now.toISOString(),
    );
}
