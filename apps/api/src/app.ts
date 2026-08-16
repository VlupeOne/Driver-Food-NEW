import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  authenticateCredentials,
  createSession,
  destroySession,
  expiredSessionCookie,
  presentSession,
  sessionCookie,
  sessionFromRequest,
  type Role,
  type SessionContext,
} from './auth.js';
import { createDatabase, inImmediateTransaction, type Database } from './database.js';
import { executeDispatch } from './dispatch.js';
import {
  ApiError,
  objectBody,
  optionalNumber,
  optionalString,
  parseJson,
  requiredString,
} from './http.js';
import {
  appendAudit,
  appendEvent,
  getSettingsRow,
  presentSettings,
  readIdempotent,
  saveIdempotent,
  type SettingsDto,
} from './persistence.js';
import { seedDatabase } from './seed.js';
import { listCouriers, listOrders, listRoutes } from './views.js';
import { releaseUnstartedRoute } from './reconciliation.js';
import { DemoRouteMatrixProvider, type RouteMatrixProvider } from './route-matrix.js';
import { formatOutboxSse, type OutboxSseEvent } from './sse.js';

export interface AppOptions {
  database?: Database;
  databasePath?: string;
  seed?: boolean;
  now?: () => Date;
  logger?: boolean;
  routeMatrixProvider?: RouteMatrixProvider;
}

const allowedSettings: Readonly<Record<keyof SettingsDto, string>> = {
  maxStopsPerRoute: 'max_stops_per_route',
  maxWeightKg: 'max_weight_kg',
  maxVolumeLiters: 'max_volume_liters',
  groupingRadiusKm: 'grouping_radius_km',
  maxExtraDistanceKm: 'max_extra_distance_km',
  maxExtraMinutes: 'max_extra_minutes',
  maxRouteMinutes: 'max_route_minutes',
  maxWaitMinutes: 'max_wait_minutes',
  pickupSlaMinutes: 'pickup_sla_minutes',
  deliverySlaMinutes: 'delivery_sla_minutes',
  acceptanceTimeoutSeconds: 'acceptance_timeout_seconds',
  heartbeatToleranceSeconds: 'heartbeat_tolerance_seconds',
  locationToleranceSeconds: 'location_tolerance_seconds',
};

export function buildApp(options: AppOptions = {}) {
  const ownsDatabase = !options.database;
  const database = options.database ?? createDatabase(options.databasePath);
  const clock = options.now ?? (() => new Date());
  const routeMatrixProvider = options.routeMatrixProvider ?? new DemoRouteMatrixProvider();
  if (options.seed !== false) seedDatabase(database, clock());

  const app = Fastify({ logger: options.logger ?? false, requestIdHeader: 'x-request-id' });
  const sessions = new WeakMap<FastifyRequest, SessionContext>();
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  if (ownsDatabase) {
    app.addHook('onClose', () => database.close());
  }

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Vary', 'Origin');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId: request.id,
        },
      });
    }
    const frameworkStatus = Number((error as { statusCode?: number }).statusCode ?? 500);
    if (frameworkStatus >= 400 && frameworkStatus < 500) {
      return reply.status(frameworkStatus).send({
        error: {
          code: String((error as { code?: string }).code ?? 'BAD_REQUEST'),
          message: error instanceof Error && error.message ? error.message : 'A requisição é inválida.',
          requestId: request.id,
        },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Não foi possível concluir a operação.',
        requestId: request.id,
      },
    });
  });

  const authorize =
    (...roles: Role[]) =>
    async (request: FastifyRequest) => {
      const context = sessionFromRequest(database, request, clock());
      if (!context) throw new ApiError(401, 'UNAUTHENTICATED', 'Faça login para continuar.');
      if (roles.length > 0 && !roles.includes(context.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Seu perfil não pode executar esta ação.');
      }
      sessions.set(request, context);
    };
  const contextOf = (request: FastifyRequest) => {
    const context = sessions.get(request);
    if (!context) throw new ApiError(401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    return context;
  };

  app.get('/api/health', async () => {
    database.prepare('SELECT 1').get();
    return { data: { status: 'ok', timestamp: clock().toISOString(), database: 'sqlite' } };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const now = clock();
    const key = request.ip;
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.resetAt > now.getTime() && attempt.count >= 8) {
      throw new ApiError(429, 'LOGIN_RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.');
    }
    const body = objectBody(request.body);
    const email = requiredString(body, 'email', { max: 200 });
    const password = requiredString(body, 'password', { min: 8, max: 200 });
    const user = authenticateCredentials(database, email, password);
    if (!user) {
      const current = attempt && attempt.resetAt > now.getTime() ? attempt.count : 0;
      loginAttempts.set(key, { count: current + 1, resetAt: now.getTime() + 5 * 60_000 });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    }
    loginAttempts.delete(key);
    const session = createSession(database, user, now);
    reply.header('Set-Cookie', sessionCookie(session.token));
    return { data: presentSession(session.context) };
  });

  app.delete('/api/auth/session', { preHandler: authorize() }, async (request, reply) => {
    destroySession(database, request);
    reply.header('Set-Cookie', expiredSessionCookie());
    return { data: { ok: true } };
  });

  app.get('/api/session', { preHandler: authorize() }, async (request) => ({
    data: presentSession(contextOf(request)),
  }));

  app.get('/api/dashboard', { preHandler: authorize('ADMIN', 'OPERATOR', 'KITCHEN') }, async (request) => {
    const context = contextOf(request);
    const now = clock();
    const orders = listOrders(database, context);
    const routes = listRoutes(database, context);
    const couriers = listCouriers(database, context);
    const settings = getSettingsRow(database, context);
    const waitCutoff = new Date(
      now.getTime() - Number(settings.max_wait_minutes) * 60_000,
    ).toISOString();
    const overdueReadyRow = database
      .prepare(
        `SELECT COUNT(*) AS total
         FROM orders
         WHERE tenant_id = ? AND branch_id = ? AND status = 'READY'
           AND confirmed = 1 AND ready = 1 AND address_valid = 1 AND area_valid = 1
           AND payment_valid = 1 AND dispatch_allowed = 1 AND block_reason IS NULL
           AND assigned_route_id IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND received_at <= ?`,
      )
      .get(context.tenantId, context.branchId, waitCutoff) as { total: number };
    const overdueReady = Number(overdueReadyRow.total);
    const activeStatuses = new Set(['planned', 'on_route']);
    const alerts: Array<{ id: string; type: string; title: string; description: string; count?: number }> = [];
    const blocked = orders.filter(({ status }) => status === 'blocked').length;
    const late = orders.filter(
      (order) =>
        order.promisedAt &&
        new Date(order.promisedAt).getTime() < now.getTime() &&
        !['delivered', 'cancelled'].includes(order.status),
    ).length;
    if (blocked) alerts.push({ id: 'blocked', type: 'warning', title: 'Pedidos bloqueados', description: 'Revise as pendências antes do despacho.', count: blocked });
    if (late) alerts.push({ id: 'late', type: 'error', title: 'SLA ultrapassado', description: 'Há pedidos que exigem atenção imediata.', count: late });
    if (overdueReady) {
      alerts.push({
        id: 'ready-wait-limit',
        type: 'error',
        title: 'Pedido pronto acima do limite',
        description: `Há pedidos prontos e elegíveis aguardando despacho há mais de ${Number(settings.max_wait_minutes)} minutos.`,
        count: overdueReady,
      });
    }
    return {
      data: {
        generatedAt: now.toISOString(),
        branch: { id: context.branchId, name: context.branchName, timezone: context.timezone },
        summary: {
          waiting: orders.filter(({ status }) => ['received', 'preparing', 'blocked'].includes(status)).length,
          late,
          ready: orders.filter(({ status }) => status === 'ready').length,
          onRoute: orders.filter(({ status }) => activeStatuses.has(status)).length,
          doneToday: orders.filter(({ status }) => status === 'delivered').length,
          couriersAvailable: couriers.filter(({ status }) => status === 'available').length,
          couriersBusy: couriers.filter(({ status }) => status === 'busy').length,
          couriersPaused: couriers.filter(({ status }) => status === 'paused').length,
          couriersOffline: couriers.filter(({ status }) => status === 'offline').length,
        },
        orders,
        routes,
        couriers,
        alerts,
      },
    };
  });

  app.post('/api/orders', { preHandler: authorize('ADMIN', 'OPERATOR', 'KITCHEN') }, async (request) => {
    const context = contextOf(request);
    const now = clock();
    const body = objectBody(request.body);
    const replay = readIdempotent<ReturnType<typeof listOrders>[number]>(database, context, request, 'orders.create', body);
    if (replay.response) return { data: replay.response };
    const response = inImmediateTransaction(database, () => {
      const customerName = requiredString(body, 'customerName', { max: 200 });
      let address: string;
      if (typeof body.address === 'string') {
        address = requiredString(body, 'address', { max: 500 });
      } else {
        const addressBody = objectBody(body.address);
        const street = requiredString(addressBody, 'street', { max: 220 });
        const number = requiredString(addressBody, 'number', { max: 30 });
        const neighborhood = requiredString(addressBody, 'neighborhood', { max: 120 });
        const complement = optionalString(addressBody, 'complement');
        const postalCode = optionalString(addressBody, 'postalCode');
        address = [`${street}, ${number}`, complement, neighborhood, postalCode].filter(Boolean).join(' - ');
      }
      const lat = optionalNumber(body, 'lat') ?? optionalNumber(body, 'latitude');
      const lng = optionalNumber(body, 'lng') ?? optionalNumber(body, 'longitude');
      const ready = body.ready === undefined ? true : body.ready === true;
      const confirmed = body.confirmed === undefined ? true : body.confirmed === true;
      const explicitBlock = optionalString(body, 'blockReason');
      const blockReason = explicitBlock ?? (lat === undefined || lng === undefined ? 'Endereço sem coordenadas confiáveis.' : undefined);
      const status = blockReason ? 'BLOCKED' : ready ? 'READY' : confirmed ? 'PREPARING' : 'RECEIVED';
      const counter = database
        .prepare('SELECT next_value FROM branch_order_counters WHERE tenant_id = ? AND branch_id = ?')
        .get(context.tenantId, context.branchId) as { next_value: number } | undefined;
      if (!counter) throw new ApiError(409, 'ORDER_COUNTER_MISSING', 'Contador da filial não configurado.');
      const sequence = Number(counter.next_value);
      database
        .prepare('UPDATE branch_order_counters SET next_value = next_value + 1 WHERE tenant_id = ? AND branch_id = ?')
        .run(context.tenantId, context.branchId);
      const id = randomUUID();
      database
        .prepare(
          `INSERT INTO orders (
             id, tenant_id, branch_id, number, source, external_id, source_created_at,
             received_at, sequence_number, customer_name, customer_phone, address,
             latitude, longitude, confirmed, ready, address_valid, area_valid,
             payment_valid, dispatch_allowed, block_reason, status, promised_at,
             amount_cents, items_count, weight_kg, volume_liters, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, context.tenantId, context.branchId, `#${sequence}`,
          optionalString(body, 'source') ?? 'MANUAL', optionalString(body, 'externalId') ?? null,
          optionalString(body, 'sourceCreatedAt') ?? null, now.toISOString(), sequence,
          customerName, optionalString(body, 'customerPhone') ?? optionalString(body, 'phone') ?? null, address, lat ?? null, lng ?? null,
          confirmed ? 1 : 0, ready ? 1 : 0, blockReason ? 0 : 1,
          body.paymentValid === false ? 0 : 1, body.dispatchAllowed === false ? 0 : 1,
          blockReason ?? null, status, optionalString(body, 'promisedAt') ?? null,
          Math.max(0, Math.round(optionalNumber(body, 'amountCents') ?? 0)),
          Math.max(1, Math.round(optionalNumber(body, 'itemsCount') ?? (Array.isArray(body.items) ? body.items.length : 1))),
          Math.max(0.1, optionalNumber(body, 'weightKg') ?? 1),
          Math.max(0.1, optionalNumber(body, 'volumeLiters') ?? 3),
          now.toISOString(), now.toISOString(),
        );
      appendAudit(database, context, request, 'ORDER_CREATED', 'ORDER', id, now, { after: { status, sequence } });
      appendEvent(database, context, 'order.created', id, now, { orderId: id });
      const order = listOrders(database, context).find((item) => item.id === id);
      if (!order) throw new Error('Pedido criado não foi encontrado.');
      const value = order;
      saveIdempotent(database, context, 'orders.create', replay.key, replay.requestHash, value, now);
      return value;
    });
    return { data: response };
  });

  app.post('/api/dispatch/plan', { preHandler: authorize('ADMIN', 'OPERATOR') }, async (request) => ({
    data: executeDispatch(database, contextOf(request), request, clock(), routeMatrixProvider),
  }));

  app.get('/api/settings', { preHandler: authorize('ADMIN', 'OPERATOR') }, async (request) => ({
    data: presentSettings(getSettingsRow(database, contextOf(request))),
  }));

  app.put('/api/settings', { preHandler: authorize('ADMIN') }, async (request) => {
    const context = contextOf(request);
    const body = objectBody(request.body);
    const now = clock();
    const result = inImmediateTransaction(database, () => {
      const before = presentSettings(getSettingsRow(database, context));
      const next: SettingsDto = { ...before };
      for (const key of Object.keys(allowedSettings) as Array<keyof SettingsDto>) {
        if (body[key] === undefined) continue;
        const value = Number(body[key]);
        if (!Number.isFinite(value) || value <= 0) {
          throw new ApiError(422, 'VALIDATION_ERROR', `O campo ${key} deve ser maior que zero.`, { field: key });
        }
        next[key] = value;
      }
      const columns = Object.entries(allowedSettings).map(([key, column]) => `${column} = ?`);
      const values = Object.keys(allowedSettings).map((key) => next[key as keyof SettingsDto]);
      database
        .prepare(`UPDATE settings SET ${columns.join(', ')}, version = version + 1, updated_at = ? WHERE tenant_id = ? AND branch_id = ?`)
        .run(...values, now.toISOString(), context.tenantId, context.branchId);
      const after = presentSettings(getSettingsRow(database, context));
      appendAudit(database, context, request, 'SETTINGS_UPDATED', 'SETTINGS', context.branchId, now, { before, after });
      appendEvent(database, context, 'settings.updated', context.branchId, now, { branchId: context.branchId });
      return after;
    });
    return { data: result };
  });

  app.post<{ Params: { id: string } }>(
    '/api/routes/:id/override',
    { preHandler: authorize('ADMIN', 'OPERATOR') },
    async (request) => {
      const context = contextOf(request);
      const body = objectBody(request.body);
      const courierId = requiredString(body, 'courierId');
      const reason = requiredString(body, 'reason', { min: 8, max: 500 });
      const now = clock();
      const auditId = inImmediateTransaction(database, () => {
        const route = database
          .prepare('SELECT id, courier_id, status FROM routes WHERE tenant_id = ? AND branch_id = ? AND id = ?')
          .get(context.tenantId, context.branchId, request.params.id) as
          | { id: string; courier_id: string; status: string }
          | undefined;
        if (!route) throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.');
        const courier = database
          .prepare("SELECT id, status FROM couriers WHERE tenant_id = ? AND branch_id = ? AND id = ? AND shift_started_at IS NOT NULL")
          .get(context.tenantId, context.branchId, courierId) as { id: string; status: string } | undefined;
        if (!courier || !['AVAILABLE', 'BUSY'].includes(courier.status)) {
          throw new ApiError(409, 'COURIER_UNAVAILABLE', 'O motoboy escolhido não está disponível.');
        }
        database.prepare("UPDATE couriers SET status = 'AVAILABLE', version = version + 1 WHERE tenant_id = ? AND id = ?").run(context.tenantId, route.courier_id);
        database.prepare("UPDATE couriers SET status = 'BUSY', last_assignment_at = ?, version = version + 1 WHERE tenant_id = ? AND id = ?").run(now.toISOString(), context.tenantId, courierId);
        database.prepare('UPDATE routes SET courier_id = ?, version = version + 1, updated_at = ? WHERE tenant_id = ? AND id = ?').run(courierId, now.toISOString(), context.tenantId, route.id);
        const id = appendAudit(database, context, request, 'ROUTE_OVERRIDDEN', 'ROUTE', route.id, now, {
          reason,
          before: { courierId: route.courier_id },
          after: { courierId },
        });
        appendEvent(database, context, 'route.overridden', route.id, now, { routeId: route.id });
        return id;
      });
      const route = listRoutes(database, context, { routeId: request.params.id })[0];
      if (!route) throw new Error('Rota reatribuída não foi encontrada.');
      return {
        data: {
          route,
          auditEntry: {
            id: String(auditId),
            occurredAt: now.toISOString(),
            actorName: context.userName,
            action: 'ROUTE_OVERRIDDEN',
            entity: `ROUTE ${route.id}`,
            newValue: `Motoboy ${courierId}`,
            reason,
            source: 'Painel',
          },
        },
      };
    },
  );

  app.get('/api/audit', { preHandler: authorize('ADMIN', 'OPERATOR') }, async (request) => {
    const context = contextOf(request);
    const query = request.query as { limit?: string };
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50)));
    const rows = database
      .prepare(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.reason,
                a.before_json, a.after_json, a.request_id, a.created_at,
                u.name AS actor_name
         FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
         WHERE a.tenant_id = ? AND a.branch_id = ? ORDER BY a.id DESC LIMIT ?`,
      )
      .all(context.tenantId, context.branchId, limit) as Array<Record<string, unknown>>;
    return {
      data: rows.map((row) => {
        const before = parseJson(row.before_json, null);
        const after = parseJson(row.after_json, null);
        return {
          id: String(row.id),
          occurredAt: String(row.created_at),
          actorName: String(row.actor_name),
          action: String(row.action),
          entity: `${String(row.entity_type)} ${String(row.entity_id)}`,
          ...(before === null ? {} : { previousValue: JSON.stringify(before) }),
          ...(after === null ? {} : { newValue: JSON.stringify(after) }),
          ...(row.reason ? { reason: String(row.reason) } : {}),
          source: 'Sistema',
        };
      }),
    };
  });

  app.get('/api/courier/home', { preHandler: authorize('COURIER') }, async (request) => {
    const context = contextOf(request);
    if (!context.courierId) throw new ApiError(403, 'COURIER_PROFILE_MISSING', 'Perfil de motoboy não configurado.');
    const courier = listCouriers(database, context).find(({ id }) => id === context.courierId);
    if (!courier) throw new ApiError(404, 'COURIER_NOT_FOUND', 'Motoboy não encontrado.');
    const routes = listRoutes(database, context, { courierId: context.courierId, activeOnly: true });
    const shiftRow = database
      .prepare('SELECT shift_id, shift_started_at FROM couriers WHERE tenant_id = ? AND id = ?')
      .get(context.tenantId, context.courierId) as { shift_id: string | null; shift_started_at: string | null };
    return {
      data: {
        courier,
        shift: shiftRow.shift_id && shiftRow.shift_started_at
          ? { id: shiftRow.shift_id, startedAt: shiftRow.shift_started_at, status: 'open' }
          : null,
        currentRoute: routes.find(({ status }) => ['accepted', 'in_progress'].includes(status)) ?? null,
        offeredRoute: routes.find(({ status }) => status === 'offered') ?? null,
        outboxPending: 0,
      },
    };
  });

  app.post('/api/courier/heartbeat', { preHandler: authorize('COURIER') }, async (request) => {
    const context = contextOf(request);
    if (!context.courierId) throw new ApiError(403, 'COURIER_PROFILE_MISSING', 'Perfil de motoboy não configurado.');
    const courierId = context.courierId;
    const body = objectBody(request.body ?? {});
    const lat = optionalNumber(body, 'lat') ?? optionalNumber(body, 'latitude');
    const lng = optionalNumber(body, 'lng') ?? optionalNumber(body, 'longitude');
    const battery = optionalNumber(body, 'batteryPercent');
    const availabilityInput = optionalString(body, 'status') ?? optionalString(body, 'availability');
    const requestedAvailability = availabilityInput?.toUpperCase();
    const availability = requestedAvailability === 'UNAVAILABLE' ? 'PAUSED' : requestedAvailability;
    if (availability && !['AVAILABLE', 'BUSY', 'PAUSED', 'OFFLINE'].includes(availability)) {
      throw new ApiError(422, 'INVALID_COURIER_STATUS', 'Status de disponibilidade inválido.');
    }
    const now = clock();
    return inImmediateTransaction(database, () => {
      if (availability === 'OFFLINE') {
        const activeRoute = database
          .prepare(
            `SELECT id FROM routes
             WHERE tenant_id = ? AND branch_id = ? AND courier_id = ?
               AND status IN ('ACCEPTED', 'IN_PROGRESS')
             LIMIT 1`,
          )
          .get(context.tenantId, context.branchId, context.courierId) as { id: string } | undefined;
        if (activeRoute) {
          throw new ApiError(
            409,
            'ACTIVE_ROUTE_PREVENTS_SHIFT_END',
            'Conclua a rota aceita ou em andamento antes de encerrar o turno.',
          );
        }
        const offeredRoutes = database
          .prepare(
            `SELECT id FROM routes
             WHERE tenant_id = ? AND branch_id = ? AND courier_id = ? AND status = 'OFFERED'`,
          )
          .all(context.tenantId, context.branchId, context.courierId) as unknown as Array<{ id: string }>;
        for (const offeredRoute of offeredRoutes) {
          releaseUnstartedRoute(
            database,
            context,
            request,
            offeredRoute.id,
            'COURIER_OFFLINE',
            now,
          );
        }
      }

      const nextShiftId = randomUUID();
      const update = database
        .prepare(
          `UPDATE couriers SET last_heartbeat_at = ?, latitude = COALESCE(?, latitude),
                  longitude = COALESCE(?, longitude), battery_percent = COALESCE(?, battery_percent),
                  status = CASE
                    WHEN ? = 'OFFLINE' THEN 'OFFLINE'
                    WHEN ? = 'BUSY' THEN status
                    WHEN status = 'BUSY' THEN status
                    ELSE COALESCE(?, status)
                  END,
                  shift_id = CASE
                    WHEN ? = 'OFFLINE' THEN NULL
                    WHEN ? = 'AVAILABLE' AND shift_started_at IS NULL THEN ?
                    ELSE shift_id
                  END,
                  shift_started_at = CASE
                    WHEN ? = 'OFFLINE' THEN NULL
                    WHEN ? = 'AVAILABLE' AND shift_started_at IS NULL THEN ?
                    ELSE shift_started_at
                  END,
                  version = version + 1
           WHERE tenant_id = ? AND branch_id = ? AND id = ?`,
        )
        .run(
          now.toISOString(), lat ?? null, lng ?? null, battery ?? null,
          availability ?? null, availability ?? null, availability ?? null,
          availability ?? null, availability ?? null, nextShiftId,
          availability ?? null, availability ?? null, now.toISOString(),
          context.tenantId, context.branchId, context.courierId,
        );
      if (Number(update.changes) !== 1) {
        throw new ApiError(404, 'COURIER_NOT_FOUND', 'Motoboy não encontrado.');
      }
      appendEvent(database, context, 'courier.heartbeat', courierId, now, {
        courierId,
        status: availability?.toLowerCase() ?? null,
      });
      const courier = listCouriers(database, context).find(({ id }) => id === courierId);
      return { data: { accepted: true, courier } };
    });
  });

  app.post<{ Params: { id: string } }>(
    '/api/courier/routes/:id/accept',
    { preHandler: authorize('COURIER') },
    async (request) => courierRouteAction(database, contextOf(request), request, clock(), 'accept'),
  );
  app.post<{ Params: { id: string } }>(
    '/api/courier/routes/:id/reject',
    { preHandler: authorize('COURIER') },
    async (request) => courierRouteAction(database, contextOf(request), request, clock(), 'reject'),
  );
  app.post<{ Params: { id: string } }>(
    '/api/courier/routes/:id/advance',
    { preHandler: authorize('COURIER') },
    async (request) => courierRouteAction(database, contextOf(request), request, clock(), 'advance'),
  );

  app.get('/api/events', { preHandler: authorize() }, async (request, reply) => {
    const context = contextOf(request);
    const headerId = Array.isArray(request.headers['last-event-id'])
      ? request.headers['last-event-id'][0]
      : request.headers['last-event-id'];
    let cursor = Math.max(0, Number(headerId ?? (request.query as { after?: string }).after ?? 0));
    reply.hijack();
    const raw = reply.raw;
    raw.statusCode = 200;
    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.write(`event: connected\ndata: ${JSON.stringify({ now: clock().toISOString() })}\n\n`);
    const flush = () => {
      const audienceClause = context.role === 'COURIER' ? 'AND (audience_user_id IS NULL OR audience_user_id = ?)' : '';
      const params = context.role === 'COURIER'
        ? [context.tenantId, context.branchId, cursor, context.userId]
        : [context.tenantId, context.branchId, cursor];
      const rows = database
        .prepare(
          `SELECT id, type, entity_id, payload_json, created_at FROM outbox_events
           WHERE tenant_id = ? AND branch_id = ? AND id > ? ${audienceClause}
           ORDER BY id ASC LIMIT 100`,
        )
        .all(...params) as unknown as OutboxSseEvent[];
      for (const event of rows) {
        cursor = Number(event.id);
        raw.write(formatOutboxSse(event));
      }
    };
    flush();
    const interval = setInterval(() => {
      try { flush(); raw.write(': heartbeat\n\n'); } catch { clearInterval(interval); }
    }, 15_000);
    request.raw.on('close', () => clearInterval(interval));
    return reply;
  });

  return app;
}

type CourierRouteActionResponse = {
  route: ReturnType<typeof listRoutes>[number] | null;
  courier: ReturnType<typeof listCouriers>[number] | null;
};

function courierRouteAction(
  database: Database,
  context: SessionContext,
  request: FastifyRequest<{ Params: { id: string } }>,
  now: Date,
  action: 'accept' | 'reject' | 'advance',
) {
  if (!context.courierId) throw new ApiError(403, 'COURIER_PROFILE_MISSING', 'Perfil de motoboy não configurado.');
  const courierId = context.courierId;
  const body = objectBody(request.body ?? {});
  const idempotencyInput = { routeId: request.params.id, action, body };
  const replay = readIdempotent<CourierRouteActionResponse>(
    database,
    context,
    request,
    'courier.route.action',
    idempotencyInput,
  );
  if (replay.response) return { data: replay.response };

  const response = inImmediateTransaction(database, () => {
    const route = database
      .prepare('SELECT id, status, acceptance_expires_at FROM routes WHERE tenant_id = ? AND branch_id = ? AND id = ? AND courier_id = ?')
      .get(context.tenantId, context.branchId, request.params.id, courierId) as
      | { id: string; status: string; acceptance_expires_at: string | null }
      | undefined;
    if (!route) throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada para este motoboy.');

    if (action === 'accept') {
      if (route.status !== 'OFFERED') {
        throw new ApiError(409, 'INVALID_ROUTE_STATE', 'A rota não está aguardando aceite.');
      }
      if (route.acceptance_expires_at && new Date(route.acceptance_expires_at).getTime() < now.getTime()) {
        throw new ApiError(409, 'ROUTE_OFFER_EXPIRED', 'O prazo para aceitar esta rota expirou.');
      }
      database
        .prepare("UPDATE routes SET status = 'ACCEPTED', accepted_at = ?, version = version + 1, updated_at = ? WHERE tenant_id = ? AND id = ?")
        .run(now.toISOString(), now.toISOString(), context.tenantId, route.id);
      appendAudit(database, context, request, 'ROUTE_ACCEPTED', 'ROUTE', route.id, now);
      appendEvent(database, context, 'route.accepted', route.id, now, { routeId: route.id });
    } else if (action === 'reject') {
      if (route.status !== 'OFFERED') {
        throw new ApiError(409, 'INVALID_ROUTE_STATE', 'Somente uma oferta pendente pode ser recusada.');
      }
      const reason = requiredString(body, 'reason', { min: 3, max: 500 });
      database
        .prepare("UPDATE routes SET status = 'REJECTED', version = version + 1, updated_at = ? WHERE tenant_id = ? AND id = ?")
        .run(now.toISOString(), context.tenantId, route.id);
      database
        .prepare("UPDATE route_stops SET active = 0, status = 'CANCELLED', updated_at = ? WHERE tenant_id = ? AND route_id = ?")
        .run(now.toISOString(), context.tenantId, route.id);
      database
        .prepare("UPDATE orders SET status = 'READY', assigned_route_id = NULL, version = version + 1, updated_at = ? WHERE tenant_id = ? AND assigned_route_id = ?")
        .run(now.toISOString(), context.tenantId, route.id);
      database
        .prepare("UPDATE couriers SET status = 'AVAILABLE', version = version + 1 WHERE tenant_id = ? AND id = ?")
        .run(context.tenantId, courierId);
      appendAudit(database, context, request, 'ROUTE_REJECTED', 'ROUTE', route.id, now, { reason });
      appendEvent(database, context, 'route.rejected', route.id, now, { routeId: route.id });
    } else {
      if (!['ACCEPTED', 'IN_PROGRESS'].includes(route.status)) {
        throw new ApiError(409, 'INVALID_ROUTE_STATE', 'Aceite a rota antes de avançar.');
      }
      const requestedStopId = optionalString(body, 'stopId');
      const stop = database
        .prepare(
          `SELECT id, order_id, type, status FROM route_stops
           WHERE tenant_id = ? AND route_id = ? AND active = 1
             AND (? IS NULL OR id = ?) AND status IN ('PENDING', 'ARRIVED')
           ORDER BY sequence ASC LIMIT 1`,
        )
        .get(context.tenantId, route.id, requestedStopId ?? null, requestedStopId ?? null) as
        | { id: string; order_id: string | null; type: string; status: string }
        | undefined;
      if (!stop) throw new ApiError(409, 'NO_PENDING_STOP', 'Não há parada pendente para avançar.');
      const command = (optionalString(body, 'action') ?? 'COMPLETE').toUpperCase();
      const failed = ['FAIL', 'FAILED'].includes(command);
      const arrived = command === 'ARRIVE';
      const nextStopStatus = failed ? 'FAILED' : arrived ? 'ARRIVED' : 'COMPLETED';
      database
        .prepare('UPDATE route_stops SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
        .run(nextStopStatus, now.toISOString(), context.tenantId, stop.id);
      if (stop.type === 'PICKUP' && !arrived && !failed) {
        database
          .prepare("UPDATE orders SET status = 'IN_DELIVERY', version = version + 1, updated_at = ? WHERE tenant_id = ? AND assigned_route_id = ?")
          .run(now.toISOString(), context.tenantId, route.id);
      } else if (stop.order_id && !arrived) {
        database
          .prepare("UPDATE orders SET status = ?, version = version + 1, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(failed ? 'BLOCKED' : 'DELIVERED', now.toISOString(), context.tenantId, stop.order_id);
      }
      const pending = database
        .prepare("SELECT COUNT(*) AS total FROM route_stops WHERE tenant_id = ? AND route_id = ? AND active = 1 AND status IN ('PENDING', 'ARRIVED')")
        .get(context.tenantId, route.id) as { total: number };
      const completed = Number(pending.total) === 0;
      database
        .prepare("UPDATE routes SET status = ?, started_at = COALESCE(started_at, ?), completed_at = ?, current_stop_index = current_stop_index + 1, version = version + 1, updated_at = ? WHERE tenant_id = ? AND id = ?")
        .run(
          completed ? 'COMPLETED' : 'IN_PROGRESS',
          now.toISOString(),
          completed ? now.toISOString() : null,
          now.toISOString(),
          context.tenantId,
          route.id,
        );
      if (completed) {
        database
          .prepare("UPDATE couriers SET status = 'AVAILABLE', version = version + 1 WHERE tenant_id = ? AND id = ?")
          .run(context.tenantId, courierId);
      }
      appendAudit(database, context, request, 'ROUTE_ADVANCED', 'ROUTE', route.id, now, {
        after: { stopId: stop.id, action: command, completed },
      });
      appendEvent(database, context, 'route.advanced', route.id, now, {
        routeId: route.id,
        stopId: stop.id,
      });
    }

    const value: CourierRouteActionResponse = {
      route: listRoutes(database, context, { routeId: request.params.id })[0] ?? null,
      courier: listCouriers(database, context).find(({ id }) => id === courierId) ?? null,
    };
    saveIdempotent(
      database,
      context,
      'courier.route.action',
      replay.key,
      replay.requestHash,
      value,
      now,
    );
    return value;
  });

  return { data: response };
}