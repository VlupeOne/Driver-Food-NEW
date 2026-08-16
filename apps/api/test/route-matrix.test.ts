import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDatabase, type Database } from '../src/database.js';
import type { RouteMatrixProvider } from '../src/route-matrix.js';

const fixedNow = new Date('2026-08-16T13:00:00.000Z');
const resources: Array<{ app: FastifyInstance; database: Database }> = [];

function setup(routeMatrixProvider?: RouteMatrixProvider) {
  const database = createDatabase(':memory:');
  const app = buildApp({
    database,
    now: () => fixedNow,
    ...(routeMatrixProvider ? { routeMatrixProvider } : {}),
  });
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

async function authenticatedPlan(
  app: FastifyInstance,
  idempotencyKey: string,
) {
  const operatorCookie = await login(app, 'operador@bellamassa.demo');
  await login(app, 'rafael@bellamassa.demo');
  return app.inject({
    method: 'POST',
    url: '/api/dispatch/plan',
    headers: { cookie: operatorCookie, 'idempotency-key': idempotencyKey },
  });
}

function queueSnapshot(database: Database) {
  return JSON.parse(
    JSON.stringify(
      database
        .prepare(
          `SELECT id, status, assigned_route_id, received_at, sequence_number
           FROM orders ORDER BY tenant_id, branch_id, received_at, sequence_number`,
        )
        .all(),
    ),
  ) as unknown;
}

afterEach(async () => {
  while (resources.length > 0) {
    const resource = resources.pop();
    if (!resource) continue;
    await resource.app.close();
    resource.database.close();
  }
});

describe('RouteMatrixProvider', () => {
  it('retorna 503 e reverte toda a transação quando o provider falha ou fica indisponível', async () => {
    const providers: RouteMatrixProvider[] = [
      {
        id: 'test-null-provider',
        kind: 'road-network',
        getMatrix: () => null,
      },
      {
        id: 'test-throwing-provider',
        kind: 'road-network',
        getMatrix: () => {
          throw new Error('provider offline');
        },
      },
    ];

    for (const provider of providers) {
      const { app, database } = setup(provider);
      const operatorCookie = await login(app, 'operador@bellamassa.demo');
      await login(app, 'rafael@bellamassa.demo');
      const ordersBefore = queueSnapshot(database);
      const routesBefore = Number(
        (database.prepare('SELECT COUNT(*) AS total FROM routes').get() as { total: number }).total,
      );
      const plannerRunsBefore = Number(
        (database.prepare('SELECT COUNT(*) AS total FROM planner_runs').get() as { total: number }).total,
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/dispatch/plan',
        headers: {
          cookie: operatorCookie,
          'idempotency-key': `provider-failure-${provider.id}`,
        },
      });

      assert.equal(response.statusCode, 503, response.body);
      assert.equal(response.json().error.code, 'MAP_PROVIDER_UNAVAILABLE');
      assert.deepEqual(queueSnapshot(database), ordersBefore);
      assert.equal(
        Number((database.prepare('SELECT COUNT(*) AS total FROM routes').get() as { total: number }).total),
        routesBefore,
      );
      assert.equal(
        Number(
          (database.prepare('SELECT COUNT(*) AS total FROM planner_runs').get() as { total: number }).total,
        ),
        plannerRunsBefore,
      );
    }
  });

  it('aplica o limite individual de paradas do motoboy', async () => {
    const { app, database } = setup();
    database.prepare("UPDATE couriers SET capacity_stops = 1 WHERE id = 'courier-rafael'").run();
    const response = await authenticatedPlan(app, 'courier-max-stops');
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data;
    assert.equal(data.routes[0]?.orders.length, 1);
    assert.ok(data.stoppedAt?.reasons.includes('COURIER_MAX_STOPS_EXCEEDED'));
  });

  it('aplica max_extra_distance_km como distância viária adicional', async () => {
    const { app, database } = setup();
    database
      .prepare("UPDATE settings SET max_extra_distance_km = 0.001 WHERE tenant_id = 'tenant-bella-massa'")
      .run();
    const response = await authenticatedPlan(app, 'max-additional-distance');
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data;
    assert.equal(data.routes.length, 0);
    assert.ok(data.stoppedAt?.reasons.includes('MAX_ADDITIONAL_DISTANCE_EXCEEDED'));
  });

  it('aplica grouping_radius_km com a matriz geográfica separada', async () => {
    const { app, database } = setup();
    database
      .prepare(
        `UPDATE settings
         SET grouping_radius_km = 0.001, max_extra_distance_km = 100
         WHERE tenant_id = 'tenant-bella-massa'`,
      )
      .run();
    const response = await authenticatedPlan(app, 'grouping-radius');
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json().data;
    assert.equal(data.routes[0]?.orders.length, 1);
    assert.ok(data.stoppedAt?.reasons.includes('GROUPING_RADIUS_EXCEEDED'));
  });
});
