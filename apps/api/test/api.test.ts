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
  const header = response.headers['set-cookie'];
  assert.ok(header);
  return String(header).split(';')[0];
}

afterEach(async () => {
  while (resources.length > 0) {
    const resource = resources.pop();
    if (!resource) continue;
    await resource.app.close();
    resource.database.close();
  }
});

describe('API Driver Food', () => {
  it('protege endpoints e cria uma sessão segura por cookie', async () => {
    const { app } = setup();
    const denied = await app.inject({ method: 'GET', url: '/api/dashboard' });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().error.code, 'UNAUTHENTICATED');

    const cookie = await login(app, 'operador@bellamassa.demo');
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().data.tenant.name, 'Bella Massa Pizzaria');
    assert.equal(session.json().data.user.role, 'OPERATOR');
  });

  it('isola pedidos por tenant derivado da sessão', async () => {
    const { app } = setup();
    const bellaCookie = await login(app, 'operador@bellamassa.demo');
    const bella = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: bellaCookie } });
    assert.equal(bella.statusCode, 200, bella.body);
    assert.equal(bella.json().data.orders.some((item: { id: string }) => item.id === 'other-order-secret'), false);

    const otherCookie = await login(app, 'admin@cantinanorte.demo');
    const other = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: otherCookie } });
    assert.equal(other.statusCode, 200, other.body);
    assert.deepEqual(other.json().data.orders.map((item: { id: string }) => item.id), ['other-order-secret']);
  });

  it('alerta quando pedido READY elegível excede max_wait_minutes', async () => {
    const { app, database } = setup();
    const cookie = await login(app, 'operador@bellamassa.demo');
    database
      .prepare("UPDATE settings SET max_wait_minutes = 1 WHERE tenant_id = 'tenant-bella-massa'")
      .run();
    const response = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
    const alert = response.json().data.alerts.find(
      (item: { id: string }) => item.id === 'ready-wait-limit',
    );
    assert.ok(alert);
    assert.equal(alert.type, 'error');
    assert.ok(Number(alert.count) > 0);
  });
  it('ignora bloqueados no planejamento sem quebrar a prioridade dos elegíveis', async () => {
    const { app, database } = setup();
    const cookie = await login(app, 'operador@bellamassa.demo');
    await login(app, 'rafael@bellamassa.demo');
    const response = await app.inject({
      method: 'POST',
      url: '/api/dispatch/plan',
      headers: { cookie, 'idempotency-key': 'test-plan-1' },
      payload: {},
    });
    assert.equal(response.statusCode, 200, response.body);
    const assigned = database
      .prepare("SELECT id, status FROM orders WHERE tenant_id = 'tenant-bella-massa' AND assigned_route_id IS NOT NULL ORDER BY received_at")
      .all() as Array<{ id: string; status: string }>;
    assert.equal(assigned.some(({ id }) => id === 'order-102'), true);
    const blocked = database.prepare("SELECT status, assigned_route_id FROM orders WHERE id = 'order-104'").get() as {
      status: string;
      assigned_route_id: string | null;
    };
    assert.equal(blocked.status, 'BLOCKED');
    assert.equal(blocked.assigned_route_id, null);
  });
});
