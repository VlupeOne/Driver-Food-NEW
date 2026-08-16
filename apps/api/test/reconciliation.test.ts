import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDatabase, type Database } from '../src/database.js';
import { DEMO_IDS } from '../src/seed.js';

const fixedNow = new Date('2026-08-16T13:00:00.000Z');
const resources: Array<{ app: FastifyInstance; database: Database }> = [];

function setup() {
  const database = createDatabase(':memory:');
  const app = buildApp({ database, now: () => fixedNow });
  resources.push({ app, database });
  return { app, database };
}

async function login(app: FastifyInstance, email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'Demo@123' },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  if (!cookie) throw new Error('Cookie de sessão não foi retornado.');
  return cookie;
}

async function plan(app: FastifyInstance, cookie: string, key: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/dispatch/plan',
    headers: { cookie, 'idempotency-key': key },
    payload: {},
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data;
}

afterEach(async () => {
  while (resources.length > 0) {
    const resource = resources.pop();
    if (!resource) continue;
    await resource.app.close();
    resource.database.close();
  }
});

describe('reconciliação de ofertas e rotas', () => {
  it('expira oferta antes do próximo plano e preserva a prioridade original', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    await login(app, 'rafael@bellamassa.demo');
    database
      .prepare('UPDATE settings SET acceptance_timeout_seconds = 37 WHERE tenant_id = ? AND branch_id = ?')
      .run(DEMO_IDS.tenant, DEMO_IDS.branch);
    const first = await plan(app, operator, 'expire-first');
    const expiredRouteId = first.routes[0]?.id as string | undefined;
    if (!expiredRouteId) throw new Error('A primeira rota planejada não foi retornada.');
    const routeMetrics = database
      .prepare('SELECT distance_km, explanation_json FROM routes WHERE id = ?')
      .get(expiredRouteId) as { distance_km: number; explanation_json: string };
    assert.ok(Number(routeMetrics.distance_km) > 0);
    assert.match(routeMetrics.explanation_json, /provider demo/);
    const offer = database
      .prepare('SELECT acceptance_expires_at FROM routes WHERE id = ?')
      .get(expiredRouteId) as { acceptance_expires_at: string };
    assert.equal(
      offer.acceptance_expires_at,
      new Date(fixedNow.getTime() + 37_000).toISOString(),
    );
    const assigned = database
      .prepare('SELECT id, received_at, sequence_number FROM orders WHERE assigned_route_id = ? ORDER BY sequence_number')
      .all(expiredRouteId) as unknown as Array<{ id: string; received_at: string; sequence_number: number }>;
    assert.ok(assigned.length > 0);
    database
      .prepare("UPDATE routes SET acceptance_expires_at = ? WHERE id = ? AND status = 'OFFERED'")
      .run(new Date(fixedNow.getTime() - 1_000).toISOString(), expiredRouteId);

    await plan(app, operator, 'expire-second');
    const expired = database.prepare('SELECT status FROM routes WHERE id = ?').get(expiredRouteId) as { status: string };
    assert.equal(expired.status, 'CANCELLED');
    const activeOldStops = database
      .prepare('SELECT COUNT(*) AS total FROM route_stops WHERE route_id = ? AND active = 1')
      .get(expiredRouteId) as { total: number };
    assert.equal(Number(activeOldStops.total), 0);
    for (const original of assigned) {
      const current = database
        .prepare('SELECT received_at, sequence_number, assigned_route_id FROM orders WHERE id = ?')
        .get(original.id) as { received_at: string; sequence_number: number; assigned_route_id: string | null };
      assert.equal(current.received_at, original.received_at);
      assert.equal(Number(current.sequence_number), Number(original.sequence_number));
      assert.notEqual(current.assigned_route_id, expiredRouteId);
    }
    const audit = database
      .prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'ROUTE_AUTO_RELEASED' AND entity_id = ?")
      .get(expiredRouteId) as { total: number };
    assert.equal(Number(audit.total), 1);
  });

  it('recusa devolve pedidos em READY sem alterar FIFO', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    const courier = await login(app, 'rafael@bellamassa.demo');
    const planned = await plan(app, operator, 'reject-first');
    const routeId = planned.routes[0]?.id as string | undefined;
    if (!routeId) throw new Error('A rota para recusa não foi retornada.');
    const before = database
      .prepare('SELECT id, received_at, sequence_number FROM orders WHERE assigned_route_id = ? ORDER BY sequence_number')
      .all(routeId) as unknown as Array<{ id: string; received_at: string; sequence_number: number }>;
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${routeId}/reject`,
      headers: { cookie: courier },
      payload: { reason: 'Problema mecânico confirmado' },
    });
    assert.equal(rejected.statusCode, 200, rejected.body);
    for (const original of before) {
      const current = database
        .prepare('SELECT status, received_at, sequence_number, assigned_route_id FROM orders WHERE id = ?')
        .get(original.id) as { status: string; received_at: string; sequence_number: number; assigned_route_id: string | null };
      assert.equal(current.status, 'READY');
      assert.equal(current.assigned_route_id, null);
      assert.equal(current.received_at, original.received_at);
      assert.equal(Number(current.sequence_number), Number(original.sequence_number));
    }
  });

  it('nunca reconcilia rota iniciada mesmo com motoboy offline e heartbeat vencido', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    database
      .prepare("UPDATE couriers SET status = 'OFFLINE', last_heartbeat_at = ? WHERE id = 'courier-julia'")
      .run(new Date(fixedNow.getTime() - 60 * 60_000).toISOString());
    await plan(app, operator, 'started-stable');
    const route = database.prepare("SELECT status FROM routes WHERE id = 'route-demo-active'").get() as { status: string };
    const order = database.prepare("SELECT status, assigned_route_id FROM orders WHERE id = 'order-106'").get() as {
      status: string;
      assigned_route_id: string | null;
    };
    assert.equal(route.status, 'IN_PROGRESS');
    assert.equal(order.status, 'ASSIGNED');
    assert.equal(order.assigned_route_id, 'route-demo-active');
  });

  it('offline libera oferta, mas é bloqueado para rota aceita', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    const courier = await login(app, 'rafael@bellamassa.demo');
    const first = await plan(app, operator, 'offline-offer');
    const offeredRouteId = first.routes[0]?.id as string | undefined;
    if (!offeredRouteId) throw new Error('A oferta esperada não foi retornada.');
    const offline = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie: courier },
      payload: { status: 'offline' },
    });
    assert.equal(offline.statusCode, 200, offline.body);
    const released = database.prepare('SELECT status FROM routes WHERE id = ?').get(offeredRouteId) as { status: string };
    assert.equal(released.status, 'CANCELLED');
    const courierRow = database
      .prepare("SELECT status, shift_id, shift_started_at FROM couriers WHERE id = 'courier-rafael'")
      .get() as { status: string; shift_id: string | null; shift_started_at: string | null };
    assert.equal(courierRow.status, 'OFFLINE');
    assert.equal(courierRow.shift_id, null);
    assert.equal(courierRow.shift_started_at, null);

    await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie: courier },
      payload: { status: 'available' },
    });
    const second = await plan(app, operator, 'offline-active');
    const acceptedRouteId = second.routes[0]?.id as string | undefined;
    if (!acceptedRouteId) throw new Error('A rota para aceite não foi retornada.');
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${acceptedRouteId}/accept`,
      headers: { cookie: courier },
      payload: {},
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie: courier },
      payload: { status: 'offline' },
    });
    assert.equal(denied.statusCode, 409, denied.body);
    assert.equal(denied.json().error.code, 'ACTIVE_ROUTE_PREVENTS_SHIFT_END');
    const stable = database.prepare('SELECT status FROM routes WHERE id = ?').get(acceptedRouteId) as { status: string };
    assert.equal(stable.status, 'ACCEPTED');
  });
});
