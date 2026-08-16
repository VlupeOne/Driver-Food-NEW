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
  return app;
}

async function login(app: FastifyInstance, email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'Demo@123' },
  });
  assert.equal(response.statusCode, 200, response.body);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie, 'login deve enviar o cookie da sessão');
  return { response, cookie: String(setCookie).split(';')[0] };
}

function assertLowercase(value: unknown, field: string) {
  assert.equal(typeof value, 'string', `${field} deve ser texto`);
  assert.equal(value, String(value).toLowerCase(), `${field} deve usar o contrato lowercase`);
}

afterEach(async () => {
  while (resources.length > 0) {
    const resource = resources.pop();
    if (!resource) continue;
    await resource.app.close();
    resource.database.close();
  }
});

describe('contratos reais consumidos pelo frontend', () => {
  it('POST /api/auth/login retorna a Session diretamente em data', async () => {
    const app = setup();
    const { response } = await login(app, 'operador@bellamassa.demo');
    const payload = response.json();
    assert.ok(payload.data.user, 'esperado data.user');
    assert.ok(payload.data.tenant, 'esperado data.tenant');
    assert.ok(payload.data.branch, 'esperado data.branch');
    assert.equal(payload.data.session, undefined, 'não deve existir envelope data.session');
  });

  it('POST /api/orders aceita NewOrderInput e retorna Order diretamente em data', async () => {
    const app = setup();
    const { cookie } = await login(app, 'operador@bellamassa.demo');
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { cookie, 'idempotency-key': 'contract-order-1' },
      payload: {
        customerName: 'Cliente Contrato',
        phone: '(11) 99999-0000',
        address: {
          street: 'Rua Vergueiro',
          number: '1000',
          complement: 'Apto 12',
          neighborhood: 'Vila Mariana',
          postalCode: '04102-000',
        },
        items: [
          { name: 'Pizza margherita', quantity: 1 },
          { name: 'Refrigerante', quantity: 2 },
        ],
        paymentMethod: 'pix',
        notes: 'Sem cebola',
      },
    });
    assert.ok([200, 201].includes(response.statusCode), response.body);
    const payload = response.json();
    assert.equal(typeof payload.data.number, 'string', 'esperado data.number diretamente');
    assert.equal(payload.data.status, 'blocked');
    assert.equal(payload.data.order, undefined, 'não deve existir envelope data.order');
  });

  it('GET /api/dashboard usa status lowercase em todo o payload', async () => {
    const app = setup();
    const { cookie } = await login(app, 'operador@bellamassa.demo');
    const response = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data;
    for (const order of data.orders) assertLowercase(order.status, 'orders[].status');
    for (const courier of data.couriers) assertLowercase(courier.status, 'couriers[].status');
    for (const route of data.routes) {
      assertLowercase(route.status, 'routes[].status');
      for (const stop of route.stops) {
        assertLowercase(stop.type, 'routes[].stops[].type');
        assertLowercase(stop.status, 'routes[].stops[].status');
      }
    }
  });

  it('GET /api/audit retorna AuditEntry[] diretamente em data', async () => {
    const app = setup();
    const { cookie } = await login(app, 'admin@bellamassa.demo');
    const response = await app.inject({ method: 'GET', url: '/api/audit', headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(Array.isArray(response.json().data), 'esperado que data seja um array');
  });

  it('contrato do motoboy usa lowercase e aceita heartbeat available', async () => {
    const app = setup();
    const { cookie } = await login(app, 'rafael@bellamassa.demo');
    const homeResponse = await app.inject({ method: 'GET', url: '/api/courier/home', headers: { cookie } });
    assert.equal(homeResponse.statusCode, 200, homeResponse.body);
    const home = homeResponse.json().data;
    assertLowercase(home.courier.status, 'courier.status');
    if (home.shift) assertLowercase(home.shift.status, 'shift.status');
    for (const route of [home.currentRoute, home.offeredRoute].filter(Boolean)) {
      assertLowercase(route.status, 'courier route.status');
      for (const stop of route.stops) {
        assertLowercase(stop.type, 'courier route.stops[].type');
        assertLowercase(stop.status, 'courier route.stops[].status');
      }
    }

    const heartbeat = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie },
      payload: { status: 'available', latitude: -23.58, longitude: -46.63 },
    });
    assert.equal(heartbeat.statusCode, 200, heartbeat.body);
  });
});
