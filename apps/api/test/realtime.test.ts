import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDatabase, type Database } from '../src/database.js';
import { formatOutboxSse } from '../src/sse.js';

const fixedNow = new Date('2026-08-16T13:00:00.000Z');
const resources: Array<{ app: FastifyInstance; database: Database }> = [];

function setup() {
  const database = createDatabase(':memory:');
  const app = buildApp({ database, now: () => fixedNow });
  resources.push({ app, database });
  return { app, database };
}

async function courierCookie(app: FastifyInstance) {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'rafael@bellamassa.demo', password: 'Demo@123' },
  });
  assert.equal(login.statusCode, 200, login.body);
  return String(login.headers['set-cookie']).split(';')[0];
}

afterEach(async () => {
  while (resources.length > 0) {
    const resource = resources.pop();
    if (!resource) continue;
    await resource.app.close();
    resource.database.close();
  }
});

describe('realtime e presença do motoboy', () => {
  it('serializa outbox como evento SSE padrão que dispara EventSource.onmessage', () => {
    const serialized = formatOutboxSse({
      id: 42,
      type: 'order.created',
      entity_id: 'order-42',
      payload_json: JSON.stringify({ orderId: 'order-42' }),
      created_at: fixedNow.toISOString(),
    });
    assert.match(serialized, /^id: 42\ndata: /);
    assert.doesNotMatch(serialized, /\nevent:/);
    const dataLine = serialized.split('\n').find((line) => line.startsWith('data: '));
    assert.ok(dataLine);
    assert.deepEqual(JSON.parse(dataLine.slice('data: '.length)), {
      orderId: 'order-42',
      type: 'order.created',
      entityId: 'order-42',
      createdAt: fixedNow.toISOString(),
    });
  });

  it('abre e fecha turno, normaliza unavailable e preserva a carga no heartbeat busy', async () => {
    const { app, database } = setup();
    const cookie = await courierCookie(app);
    database
      .prepare(
        `UPDATE couriers SET status = 'OFFLINE', shift_id = NULL, shift_started_at = NULL,
                deliveries_in_shift = 7 WHERE id = 'courier-rafael'`,
      )
      .run();

    const available = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie },
      payload: { status: 'available' },
    });
    assert.equal(available.statusCode, 200, available.body);
    let row = database.prepare(
      "SELECT status, shift_id, shift_started_at, deliveries_in_shift FROM couriers WHERE id = 'courier-rafael'",
    ).get() as { status: string; shift_id: string | null; shift_started_at: string | null; deliveries_in_shift: number };
    assert.equal(row.status, 'AVAILABLE');
    assert.ok(row.shift_id);
    assert.equal(row.shift_started_at, fixedNow.toISOString());

    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie },
      payload: { status: 'unavailable' },
    });
    assert.equal(unavailable.statusCode, 200, unavailable.body);
    row = database.prepare(
      "SELECT status, shift_id, shift_started_at, deliveries_in_shift FROM couriers WHERE id = 'courier-rafael'",
    ).get() as typeof row;
    assert.equal(row.status, 'PAUSED');

    database.prepare("UPDATE couriers SET status = 'AVAILABLE' WHERE id = 'courier-rafael'").run();
    const busyCannotPromote = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie },
      payload: { status: 'busy' },
    });
    assert.equal(busyCannotPromote.statusCode, 200, busyCannotPromote.body);
    row = database.prepare(
      "SELECT status, shift_id, shift_started_at, deliveries_in_shift FROM couriers WHERE id = 'courier-rafael'",
    ).get() as typeof row;
    assert.equal(row.status, 'AVAILABLE');
    assert.equal(Number(row.deliveries_in_shift), 7);

    database.prepare("UPDATE couriers SET status = 'BUSY' WHERE id = 'courier-rafael'").run();
    const busy = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie },
      payload: { status: 'busy' },
    });
    assert.equal(busy.statusCode, 200, busy.body);
    row = database.prepare(
      "SELECT status, shift_id, shift_started_at, deliveries_in_shift FROM couriers WHERE id = 'courier-rafael'",
    ).get() as typeof row;
    assert.equal(row.status, 'BUSY');
    assert.equal(Number(row.deliveries_in_shift), 7);

    const offline = await app.inject({
      method: 'POST',
      url: '/api/courier/heartbeat',
      headers: { cookie },
      payload: { status: 'offline' },
    });
    assert.equal(offline.statusCode, 200, offline.body);
    row = database.prepare(
      "SELECT status, shift_id, shift_started_at, deliveries_in_shift FROM couriers WHERE id = 'courier-rafael'",
    ).get() as typeof row;
    assert.equal(row.status, 'OFFLINE');
    assert.equal(row.shift_id, null);
    assert.equal(row.shift_started_at, null);
    assert.equal(Number(row.deliveries_in_shift), 7);
  });
});
