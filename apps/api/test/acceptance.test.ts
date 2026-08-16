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
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie);
  const cookie = String(setCookie).split(';')[0];
  assert.ok(cookie);
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
  return response.json().data as {
    routes: Array<{ id: string }>;
    stoppedAt?: { orderId: string; reasons: string[] };
    unplannedOrderIds: string[];
  };
}

function activeDeliveryOrderIds(database: Database, routeId: string): string[] {
  const rows = database
    .prepare(
      `SELECT order_id FROM route_stops
       WHERE route_id = ? AND active = 1 AND type = 'DELIVERY'
       ORDER BY sequence ASC`,
    )
    .all(routeId) as unknown as Array<{ order_id: string }>;
  return rows.map(({ order_id }) => order_id);
}

afterEach(async () => {
  while (resources.length > 0) {
    const resource = resources.pop();
    if (!resource) continue;
    await resource.app.close();
    resource.database.close();
  }
});

describe('aceitaÃ§Ã£o operacional Driver Food', () => {
  it('AC-01/05/07: ignora preparo e bloqueado; ao ficar pronto, o pedido antigo retoma seu FIFO imutÃ¡vel', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    const courier = await login(app, 'rafael@bellamassa.demo');
    const originalPriority = database
      .prepare("SELECT received_at, sequence_number FROM orders WHERE id = 'order-101'")
      .get() as { received_at: string; sequence_number: number };

    const first = await plan(app, operator, 'acceptance-fifo-first');
    assert.ok(first.routes[0]);
    const firstIds = activeDeliveryOrderIds(database, first.routes[0].id);
    assert.equal(firstIds[0], 'order-102');
    assert.equal(firstIds.includes('order-101'), false, 'pedido em preparo nÃ£o pode entrar no plano');
    assert.equal(firstIds.includes('order-104'), false, 'pedido bloqueado nÃ£o pode entrar no plano');
    const blocked = database
      .prepare("SELECT status, block_reason, assigned_route_id FROM orders WHERE id = 'order-104'")
      .get() as { status: string; block_reason: string | null; assigned_route_id: string | null };
    assert.equal(blocked.status, 'BLOCKED');
    assert.ok(blocked.block_reason);
    assert.equal(blocked.assigned_route_id, null);

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${first.routes[0].id}/reject`,
      headers: { cookie: courier },
      payload: { reason: 'Teste de retorno do pedido antigo Ã  fila' },
    });
    assert.equal(rejected.statusCode, 200, rejected.body);
    database
      .prepare("UPDATE orders SET status = 'READY', ready = 1, updated_at = ? WHERE id = 'order-101'")
      .run(fixedNow.toISOString());

    const second = await plan(app, operator, 'acceptance-fifo-second');
    assert.ok(second.routes[0]);
    const secondIds = activeDeliveryOrderIds(database, second.routes[0].id);
    assert.equal(secondIds[0], 'order-101', 'o pedido antigo deve recuperar a cabeÃ§a da fila elegÃ­vel');
    const currentPriority = database
      .prepare("SELECT received_at, sequence_number FROM orders WHERE id = 'order-101'")
      .get() as typeof originalPriority;
    assert.deepEqual(currentPriority, originalPriority);
    assert.throws(
      () => database.prepare("UPDATE orders SET received_at = ? WHERE id = 'order-101'").run(fixedNow.toISOString()),
      /received_at is immutable/,
    );
  });

  it('AC-08: offline, pausado, ocupado, fora do turno e heartbeat expirado nÃ£o recebem rota', async () => {
    const cases: Array<{ name: string; update: string; values?: string[] }> = [
      { name: 'offline', update: "UPDATE couriers SET status = 'OFFLINE' WHERE id = 'courier-rafael'" },
      { name: 'pausado', update: "UPDATE couriers SET status = 'PAUSED' WHERE id = 'courier-rafael'" },
      { name: 'ocupado', update: "UPDATE couriers SET status = 'BUSY' WHERE id = 'courier-rafael'" },
      {
        name: 'fora do turno',
        update: "UPDATE couriers SET status = 'AVAILABLE', shift_id = NULL, shift_started_at = NULL WHERE id = 'courier-rafael'",
      },
      {
        name: 'heartbeat expirado',
        update: "UPDATE couriers SET status = 'AVAILABLE', last_heartbeat_at = ? WHERE id = 'courier-rafael'",
        values: [new Date(fixedNow.getTime() - 121_000).toISOString()],
      },
    ];

    {
      const { app } = setup();
      const operator = await login(app, 'operador@bellamassa.demo');
      const result = await plan(app, operator, 'acceptance-ineligible-without-session');
      assert.equal(result.routes.length, 0, 'motoboy sem sessão ativa não deveria receber rota');
    }

    {
      const { app, database } = setup();
      const operator = await login(app, 'operador@bellamassa.demo');
      await login(app, 'rafael@bellamassa.demo');
      database
        .prepare("UPDATE sessions SET expires_at = ? WHERE user_id = 'user-bella-rafael'")
        .run(new Date(fixedNow.getTime() - 1_000).toISOString());
      const result = await plan(app, operator, 'acceptance-ineligible-expired-session');
      assert.equal(result.routes.length, 0, 'motoboy com sessão expirada não deveria receber rota');
    }

    for (const scenario of cases) {
      const { app, database } = setup();
      const operator = await login(app, 'operador@bellamassa.demo');
      await login(app, 'rafael@bellamassa.demo');
      database.prepare(scenario.update).run(...(scenario.values ?? []));
      const result = await plan(app, operator, `acceptance-ineligible-${scenario.name}`);
      assert.equal(result.routes.length, 0, `${scenario.name} nÃ£o deveria receber rota`);
      const order = database.prepare("SELECT status, assigned_route_id FROM orders WHERE id = 'order-102'").get() as {
        status: string;
        assigned_route_id: string | null;
      };
      assert.equal(order.status, 'READY');
      assert.equal(order.assigned_route_id, null);
    }
  });

  it('AC-09: respeita limite de paradas e capacidade de peso/volume na integraÃ§Ã£o', async () => {
    {
      const { app, database } = setup();
      const operator = await login(app, 'operador@bellamassa.demo');
      await login(app, 'rafael@bellamassa.demo');
      database
        .prepare("UPDATE settings SET max_stops_per_route = 1 WHERE tenant_id = 'tenant-bella-massa'")
        .run();
      const result = await plan(app, operator, 'acceptance-max-stops');
      assert.ok(result.routes[0]);
      assert.equal(activeDeliveryOrderIds(database, result.routes[0].id).length, 1);
      assert.ok(result.stoppedAt?.reasons.includes('MAX_STOPS_EXCEEDED'));
      assert.ok(result.unplannedOrderIds.length > 0);
    }

    {
      const { app, database } = setup();
      const operator = await login(app, 'operador@bellamassa.demo');
      await login(app, 'rafael@bellamassa.demo');
      database
        .prepare(
          "UPDATE couriers SET capacity_weight_kg = 0.1, capacity_volume_liters = 0.1 WHERE id = 'courier-rafael'",
        )
        .run();
      const result = await plan(app, operator, 'acceptance-load-capacity');
      assert.equal(result.routes.length, 0);
      assert.equal(result.stoppedAt?.orderId, 'order-102');
      assert.ok(result.stoppedAt?.reasons.includes('CAPACITY_EXCEEDED'));
    }
  });

  it('AC-10: recusa libera pedido e motoboy sem alterar a prioridade original', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    const courier = await login(app, 'rafael@bellamassa.demo');
    const result = await plan(app, operator, 'acceptance-reject');
    const routeId = result.routes[0]?.id;
    assert.ok(routeId);
    const before = database
      .prepare(
        `SELECT id, received_at, sequence_number FROM orders
         WHERE assigned_route_id = ? ORDER BY received_at, sequence_number`,
      )
      .all(routeId) as unknown as Array<{ id: string; received_at: string; sequence_number: number }>;
    assert.ok(before.length > 0);

    const response = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${routeId}/reject`,
      headers: { cookie: courier },
      payload: { reason: 'Pneu furado durante o aceite' },
    });
    assert.equal(response.statusCode, 200, response.body);
    for (const original of before) {
      const current = database
        .prepare('SELECT status, assigned_route_id, received_at, sequence_number FROM orders WHERE id = ?')
        .get(original.id) as {
          status: string;
          assigned_route_id: string | null;
          received_at: string;
          sequence_number: number;
        };
      assert.equal(current.status, 'READY');
      assert.equal(current.assigned_route_id, null);
      assert.equal(current.received_at, original.received_at);
      assert.equal(Number(current.sequence_number), Number(original.sequence_number));
    }
    const courierState = database
      .prepare("SELECT status FROM couriers WHERE id = 'courier-rafael'")
      .get() as { status: string };
    assert.equal(courierState.status, 'AVAILABLE');
  });

  it('AC-11: dois planejamentos simultÃ¢neos nÃ£o duplicam pedido nem motoboy', async () => {
    const { app, database } = setup();
    const firstSession = await login(app, 'operador@bellamassa.demo');
    const secondSession = await login(app, 'operador@bellamassa.demo');
    await login(app, 'rafael@bellamassa.demo');
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/dispatch/plan',
        headers: { cookie: firstSession, 'idempotency-key': 'acceptance-concurrent-a' },
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: '/api/dispatch/plan',
        headers: { cookie: secondSession, 'idempotency-key': 'acceptance-concurrent-b' },
        payload: {},
      }),
    ]);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);

    const duplicatedOrders = database
      .prepare(
        `SELECT order_id, COUNT(*) AS total FROM route_stops
         WHERE active = 1 AND order_id IS NOT NULL
         GROUP BY tenant_id, order_id HAVING COUNT(*) > 1`,
      )
      .all();
    assert.deepEqual(duplicatedOrders, []);
    const duplicatedCouriers = database
      .prepare(
        `SELECT courier_id, COUNT(*) AS total FROM routes
         WHERE status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS')
         GROUP BY tenant_id, courier_id HAVING COUNT(*) > 1`,
      )
      .all();
    assert.deepEqual(duplicatedCouriers, []);
    const activeAssignments = database
      .prepare("SELECT COUNT(*) AS total FROM route_stops WHERE order_id = 'order-102' AND active = 1")
      .get() as { total: number };
    assert.equal(Number(activeAssignments.total), 1);
  });

  it('AC-12: rota aceita permanece estÃ¡vel em novo ciclo de planejamento', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    const courier = await login(app, 'rafael@bellamassa.demo');
    const first = await plan(app, operator, 'acceptance-stability-first');
    const routeId = first.routes[0]?.id;
    assert.ok(routeId);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${routeId}/accept`,
      headers: { cookie: courier },
      payload: {},
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const stopsBefore = database
      .prepare('SELECT id, order_id, sequence, status, active FROM route_stops WHERE route_id = ? ORDER BY sequence')
      .all(routeId);

    await plan(app, operator, 'acceptance-stability-second');
    const route = database.prepare('SELECT status, courier_id FROM routes WHERE id = ?').get(routeId) as {
      status: string;
      courier_id: string;
    };
    assert.equal(route.status, 'ACCEPTED');
    assert.equal(route.courier_id, 'courier-rafael');
    const stopsAfter = database
      .prepare('SELECT id, order_id, sequence, status, active FROM route_stops WHERE route_id = ? ORDER BY sequence')
      .all(routeId);
    assert.deepEqual(stopsAfter, stopsBefore);
  });

  it('AC-13: reatribuiÃ§Ã£o manual audita autor, horÃ¡rio, motivo e antes/depois', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    await login(app, 'rafael@bellamassa.demo');
    const result = await plan(app, operator, 'acceptance-audit-plan');
    const routeId = result.routes[0]?.id;
    assert.ok(routeId);
    database
      .prepare(
        "UPDATE couriers SET status = 'AVAILABLE', last_heartbeat_at = ? WHERE id = 'courier-caio'",
      )
      .run(fixedNow.toISOString());
    const reason = 'RedistribuiÃ§Ã£o manual por pane mecÃ¢nica confirmada';
    const response = await app.inject({
      method: 'POST',
      url: `/api/routes/${routeId}/override`,
      headers: { cookie: operator },
      payload: { courierId: 'courier-caio', reason },
    });
    assert.equal(response.statusCode, 200, response.body);

    const audit = database
      .prepare(
        `SELECT a.actor_user_id, u.name AS actor_name, a.created_at, a.reason,
                a.before_json, a.after_json
         FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
         WHERE a.action = 'ROUTE_OVERRIDDEN' AND a.entity_id = ?`,
      )
      .get(routeId) as {
        actor_user_id: string;
        actor_name: string;
        created_at: string;
        reason: string;
        before_json: string;
        after_json: string;
      };
    assert.equal(audit.actor_user_id, 'user-bella-operator');
    assert.equal(audit.actor_name, 'Lucas Almeida');
    assert.equal(audit.created_at, fixedNow.toISOString());
    assert.equal(audit.reason, reason);
    assert.deepEqual(JSON.parse(audit.before_json), { courierId: 'courier-rafael' });
    assert.deepEqual(JSON.parse(audit.after_json), { courierId: 'courier-caio' });
    assert.throws(
      () => database.prepare("UPDATE audit_logs SET reason = 'alterado'").run(),
      /audit logs are immutable/,
    );
  });

  it('AC-14: sessÃ£o define tenant/filial e ignora tenant_id enviado pelo navegador', async () => {
    const { app, database } = setup();
    const bella = await login(app, 'operador@bellamassa.demo');
    const cantina = await login(app, 'admin@cantinanorte.demo');
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { cookie: bella, 'idempotency-key': 'acceptance-tenant-order' },
      payload: {
        tenantId: 'tenant-cantina-norte',
        branchId: 'branch-cantina-centro',
        customerName: 'Cliente Isolado',
        address: 'Rua Vergueiro, 1000 - SÃ£o Paulo',
        latitude: -23.58,
        longitude: -46.63,
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    const orderId = created.json().data.id as string;
    const persisted = database
      .prepare('SELECT tenant_id, branch_id FROM orders WHERE id = ?')
      .get(orderId) as { tenant_id: string; branch_id: string };
    assert.equal(persisted.tenant_id, 'tenant-bella-massa');
    assert.equal(persisted.branch_id, 'branch-bella-vila-mariana');

    const bellaDashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: bella } });
    const cantinaDashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: cantina } });
    assert.equal(bellaDashboard.statusCode, 200, bellaDashboard.body);
    assert.equal(cantinaDashboard.statusCode, 200, cantinaDashboard.body);
    assert.equal(
      bellaDashboard.json().data.orders.some((order: { id: string }) => order.id === 'other-order-secret'),
      false,
    );
    assert.equal(
      cantinaDashboard.json().data.orders.some((order: { id: string }) => order.id === orderId),
      false,
    );
  });

  it('AC-16: rota nÃ£o conclui com parada pendente/chegada e conclui apÃ³s todas virarem terminais', async () => {
    const { app, database } = setup();
    const operator = await login(app, 'operador@bellamassa.demo');
    const courier = await login(app, 'rafael@bellamassa.demo');
    const planned = await plan(app, operator, 'acceptance-completion-plan');
    const routeId = planned.routes[0]?.id;
    assert.ok(routeId);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${routeId}/accept`,
      headers: { cookie: courier },
      payload: {},
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const stops = database
      .prepare('SELECT id, order_id, type FROM route_stops WHERE route_id = ? AND active = 1 ORDER BY sequence')
      .all(routeId) as unknown as Array<{ id: string; order_id: string | null; type: string }>;
    assert.ok(stops.length >= 2);

    const pickup = stops[0];
    assert.ok(pickup);
    const arrived = await app.inject({
      method: 'POST',
      url: `/api/courier/routes/${routeId}/advance`,
      headers: { cookie: courier },
      payload: { stopId: pickup.id, action: 'ARRIVE' },
    });
    assert.equal(arrived.statusCode, 200, arrived.body);
    let route = database.prepare('SELECT status, completed_at FROM routes WHERE id = ?').get(routeId) as {
      status: string;
      completed_at: string | null;
    };
    assert.equal(route.status, 'IN_PROGRESS');
    assert.equal(route.completed_at, null);

    for (let index = 0; index < stops.length; index += 1) {
      const stop = stops[index];
      assert.ok(stop);
      const isLast = index === stops.length - 1;
      const response = (await app.inject({
        method: 'POST',
        url: `/api/courier/routes/${routeId}/advance`,
        headers: { cookie: courier },
        payload: { stopId: stop.id, action: isLast ? 'FAIL' : 'COMPLETE' },
      })) as { statusCode: number; body: string };
      assert.equal(response.statusCode, 200, response.body);
      route = database.prepare('SELECT status, completed_at FROM routes WHERE id = ?').get(routeId) as typeof route;
      if (!isLast) {
        assert.equal(route.status, 'IN_PROGRESS');
        assert.equal(route.completed_at, null);
      }
    }

    assert.equal(route.status, 'COMPLETED');
    assert.equal(route.completed_at, fixedNow.toISOString());
    const unresolved = database
      .prepare(
        "SELECT COUNT(*) AS total FROM route_stops WHERE route_id = ? AND active = 1 AND status IN ('PENDING', 'ARRIVED')",
      )
      .get(routeId) as { total: number };
    assert.equal(Number(unresolved.total), 0);
    const courierState = database
      .prepare("SELECT status FROM couriers WHERE id = 'courier-rafael'")
      .get() as { status: string };
    assert.equal(courierState.status, 'AVAILABLE');
    const failedOrder = stops.at(-1)?.order_id;
    assert.ok(failedOrder);
    const order = database.prepare('SELECT status FROM orders WHERE id = ?').get(failedOrder) as { status: string };
    assert.equal(order.status, 'BLOCKED');
  });
});
