import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDatabase, type Database } from '../src/database.js';

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

async function createOffer(app: FastifyInstance) {
  const operatorCookie = await login(app, 'operador@bellamassa.demo');
  const courierCookie = await login(app, 'rafael@bellamassa.demo');
  const response = await app.inject({
    method: 'POST',
    url: '/api/dispatch/plan',
    headers: { cookie: operatorCookie, 'idempotency-key': crypto.randomUUID() },
  });
  assert.equal(response.statusCode, 200, response.body);
  const routeId = response.json().data.routes[0]?.id as string | undefined;
  if (!routeId) throw new Error('Oferta de rota não foi criada.');
  return { courierCookie, routeId };
}

function actionEffects(database: Database, routeId: string, auditAction: string) {
  const route = database
    .prepare('SELECT status, version, current_stop_index FROM routes WHERE id = ?')
    .get(routeId) as { status: string; version: number; current_stop_index: number };
  const auditCount = Number(
    (
      database
        .prepare('SELECT COUNT(*) AS total FROM audit_logs WHERE entity_id = ? AND action = ?')
        .get(routeId, auditAction) as { total: number }
    ).total,
  );
  return { ...route, auditCount };
}

afterEach(async () => {
  while (resources.length > 0) {
    const resource = resources.pop();
    if (!resource) continue;
    await resource.app.close();
    resource.database.close();
  }
});

describe('idempotência das ações offline do motoboy', () => {
  it('repete accept sem reaplicar efeito e conflita se a chave mudar de conteúdo', async () => {
    const { app, database } = setup();
    const { courierCookie, routeId } = await createOffer(app);
    const key = crypto.randomUUID();
    const request = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/api/courier/routes/${routeId}/accept`,
        headers: { cookie: courierCookie, 'idempotency-key': key },
        payload,
      });

    const first = await request({});
    assert.equal(first.statusCode, 200, first.body);
    const effectsAfterFirst = actionEffects(database, routeId, 'ROUTE_ACCEPTED');
    const replay = await request({});
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json().data, first.json().data);
    assert.deepEqual(actionEffects(database, routeId, 'ROUTE_ACCEPTED'), effectsAfterFirst);
    assert.equal(effectsAfterFirst.auditCount, 1);

    const conflict = await request({ nonce: 'conteúdo diferente' });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('repete reject sem liberar a fila duas vezes e protege o motivo original', async () => {
    const { app, database } = setup();
    const { courierCookie, routeId } = await createOffer(app);
    const key = crypto.randomUUID();
    const request = (reason: string) =>
      app.inject({
        method: 'POST',
        url: `/api/courier/routes/${routeId}/reject`,
        headers: { cookie: courierCookie, 'idempotency-key': key },
        payload: { reason },
      });

    const first = await request('Pneu furado');
    assert.equal(first.statusCode, 200, first.body);
    const queueAfterFirst = database
      .prepare('SELECT id, status, assigned_route_id, version FROM orders ORDER BY id')
      .all();
    const effectsAfterFirst = actionEffects(database, routeId, 'ROUTE_REJECTED');
    const replay = await request('Pneu furado');
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json().data, first.json().data);
    assert.deepEqual(
      database.prepare('SELECT id, status, assigned_route_id, version FROM orders ORDER BY id').all(),
      queueAfterFirst,
    );
    assert.deepEqual(actionEffects(database, routeId, 'ROUTE_REJECTED'), effectsAfterFirst);
    assert.equal(effectsAfterFirst.auditCount, 1);

    const conflict = await request('Outro motivo');
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('repete advance sem avançar a parada novamente', async () => {
    const { app, database } = setup();
    const { courierCookie, routeId } = await createOffer(app);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${routeId}/accept`,
      headers: { cookie: courierCookie, 'idempotency-key': crypto.randomUUID() },
      payload: {},
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const pickup = database
      .prepare("SELECT id FROM route_stops WHERE route_id = ? AND type = 'PICKUP' AND active = 1")
      .get(routeId) as { id: string };
    const key = crypto.randomUUID();
    const request = (action: string) =>
      app.inject({
        method: 'POST',
        url: `/api/courier/routes/${routeId}/advance`,
        headers: { cookie: courierCookie, 'idempotency-key': key },
        payload: { action, stopId: pickup.id },
      });

    const first = await request('ARRIVE');
    assert.equal(first.statusCode, 200, first.body);
    const effectsAfterFirst = actionEffects(database, routeId, 'ROUTE_ADVANCED');
    const replay = await request('ARRIVE');
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json().data, first.json().data);
    assert.deepEqual(actionEffects(database, routeId, 'ROUTE_ADVANCED'), effectsAfterFirst);
    const stop = database.prepare('SELECT status FROM route_stops WHERE id = ?').get(pickup.id) as { status: string };
    assert.equal(stop.status, 'ARRIVED');
    assert.equal(effectsAfterFirst.auditCount, 1);

    const conflict = await request('COMPLETE');
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  });
});
