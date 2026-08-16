import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { inImmediateTransaction } from './database.js';
import { hashPassword } from './security.js';

export const DEMO_IDS = {
  tenant: 'tenant-bella-massa',
  branch: 'branch-bella-vila-mariana',
  otherTenant: 'tenant-cantina-norte',
  otherBranch: 'branch-cantina-centro',
  admin: 'user-bella-admin',
  operator: 'user-bella-operator',
  courierUser: 'user-bella-rafael',
  courier: 'courier-rafael',
} as const;

const isoOffset = (base: Date, milliseconds: number) =>
  new Date(base.getTime() + milliseconds).toISOString();

export function seedDatabase(database: Database, now = new Date()): boolean {
  const row = database.prepare('SELECT COUNT(*) AS total FROM tenants').get() as {
    total: number;
  };
  if (Number(row.total) > 0) {
    return false;
  }

  const passwordHash = hashPassword('Demo@123');
  const nowIso = now.toISOString();

  inImmediateTransaction(database, () => {
    const tenantInsert = database.prepare(
      'INSERT INTO tenants (id, slug, name, timezone, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    tenantInsert.run(DEMO_IDS.tenant, 'bella-massa', 'Bella Massa Pizzaria', 'America/Sao_Paulo', nowIso);
    tenantInsert.run(DEMO_IDS.otherTenant, 'cantina-norte', 'Cantina Norte', 'America/Sao_Paulo', nowIso);

    const branchInsert = database.prepare(
      `INSERT INTO branches
       (id, tenant_id, name, address, latitude, longitude, timezone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    branchInsert.run(
      DEMO_IDS.branch,
      DEMO_IDS.tenant,
      'Vila Mariana',
      'Rua Domingos de Morais, 1200 - Vila Mariana, São Paulo - SP',
      -23.5892,
      -46.6346,
      'America/Sao_Paulo',
      nowIso,
    );
    branchInsert.run(
      DEMO_IDS.otherBranch,
      DEMO_IDS.otherTenant,
      'Centro',
      'Rua Líbero Badaró, 250 - Centro, São Paulo - SP',
      -23.5489,
      -46.6378,
      'America/Sao_Paulo',
      nowIso,
    );

    const settingsInsert = database.prepare(
      `INSERT INTO settings (
        tenant_id, branch_id, max_stops_per_route, max_weight_kg,
        max_volume_liters, grouping_radius_km, max_extra_distance_km,
        max_extra_minutes, max_route_minutes, max_wait_minutes,
        pickup_sla_minutes, delivery_sla_minutes, acceptance_timeout_seconds,
        heartbeat_tolerance_seconds, location_tolerance_seconds,
        average_speed_kmh, stop_service_minutes, updated_at
      ) VALUES (?, ?, 4, 20, 60, 5, 4, 18, 75, 30, 20, 60, 90, 120, 180, 24, 4, ?)`,
    );
    settingsInsert.run(DEMO_IDS.tenant, DEMO_IDS.branch, nowIso);
    settingsInsert.run(DEMO_IDS.otherTenant, DEMO_IDS.otherBranch, nowIso);

    const counterInsert = database.prepare(
      'INSERT INTO branch_order_counters (tenant_id, branch_id, next_value) VALUES (?, ?, ?)',
    );
    counterInsert.run(DEMO_IDS.tenant, DEMO_IDS.branch, 108);
    counterInsert.run(DEMO_IDS.otherTenant, DEMO_IDS.otherBranch, 2);

    const courierInsert = database.prepare(
      `INSERT INTO couriers (
        id, tenant_id, branch_id, name, status, vehicle, plate,
        capacity_stops, capacity_weight_kg, capacity_volume_liters,
        shift_id, shift_started_at, deliveries_in_shift, last_assignment_at,
        last_heartbeat_at, latitude, longitude, battery_percent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    courierInsert.run(
      DEMO_IDS.courier,
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      'Rafael Santos',
      'AVAILABLE',
      'Honda CG 160',
      'BRA2E19',
      4,
      20,
      60,
      'shift-rafael',
      isoOffset(now, -3 * 60 * 60_000),
      2,
      isoOffset(now, -45 * 60_000),
      isoOffset(now, -20_000),
      -23.5878,
      -46.6321,
      82,
      nowIso,
    );
    courierInsert.run(
      'courier-julia',
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      'Júlia Oliveira',
      'BUSY',
      'Yamaha Factor 150',
      'GHI4J52',
      4,
      20,
      60,
      'shift-julia',
      isoOffset(now, -4 * 60 * 60_000),
      4,
      isoOffset(now, -12 * 60_000),
      isoOffset(now, -25_000),
      -23.5781,
      -46.626,
      64,
      nowIso,
    );
    courierInsert.run(
      'courier-caio',
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      'Caio Lima',
      'PAUSED',
      'Honda Biz 125',
      'DEF8A77',
      3,
      15,
      45,
      'shift-caio',
      isoOffset(now, -2 * 60 * 60_000),
      1,
      isoOffset(now, -60 * 60_000),
      isoOffset(now, -40_000),
      -23.591,
      -46.641,
      51,
      nowIso,
    );
    courierInsert.run(
      'courier-other',
      DEMO_IDS.otherTenant,
      DEMO_IDS.otherBranch,
      'Entregador Confidencial',
      'AVAILABLE',
      'Moto',
      'XYZ1A23',
      4,
      20,
      60,
      'shift-other',
      isoOffset(now, -60 * 60_000),
      0,
      null,
      isoOffset(now, -10_000),
      -23.55,
      -46.64,
      90,
      nowIso,
    );

    const userInsert = database.prepare(
      `INSERT INTO users
       (id, tenant_id, branch_id, courier_id, name, email, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    userInsert.run(
      DEMO_IDS.admin,
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      null,
      'Mariana Costa',
      'admin@bellamassa.demo',
      passwordHash,
      'ADMIN',
      nowIso,
    );
    userInsert.run(
      DEMO_IDS.operator,
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      null,
      'Lucas Almeida',
      'operador@bellamassa.demo',
      passwordHash,
      'OPERATOR',
      nowIso,
    );
    userInsert.run(
      DEMO_IDS.courierUser,
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      DEMO_IDS.courier,
      'Rafael Santos',
      'rafael@bellamassa.demo',
      passwordHash,
      'COURIER',
      nowIso,
    );
    userInsert.run(
      'user-other-admin',
      DEMO_IDS.otherTenant,
      DEMO_IDS.otherBranch,
      null,
      'Administrador Outro Tenant',
      'admin@cantinanorte.demo',
      passwordHash,
      'ADMIN',
      nowIso,
    );

    const orderInsert = database.prepare(
      `INSERT INTO orders (
        id, tenant_id, branch_id, number, source, external_id, source_created_at,
        received_at, sequence_number, customer_name, customer_phone, address,
        latitude, longitude, confirmed, ready, address_valid, area_valid,
        payment_valid, dispatch_allowed, block_reason, status, promised_at,
        amount_cents, items_count, weight_kg, volume_liters, assigned_route_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const addOrder = (values: readonly (string | number | null)[]) => orderInsert.run(...values);
    addOrder([
      'order-101', DEMO_IDS.tenant, DEMO_IDS.branch, '#101', 'MANUAL', 'demo-101', null,
      isoOffset(now, -42 * 60_000), 101, 'Ana Beatriz', '(11) 99999-0101',
      'Rua França Pinto, 420 - Vila Mariana', -23.5918, -46.6382,
      1, 0, 1, 1, 1, 1, null, 'PREPARING', isoOffset(now, 30 * 60_000),
      6890, 2, 1.2, 3.5, null, nowIso, nowIso,
    ]);
    addOrder([
      'order-102', DEMO_IDS.tenant, DEMO_IDS.branch, '#102', 'MANUAL', 'demo-102', null,
      isoOffset(now, -35 * 60_000), 102, 'Bruno Martins', '(11) 99999-0102',
      'Rua Joaquim Távora, 760 - Vila Mariana', -23.586, -46.641,
      1, 1, 1, 1, 1, 1, null, 'READY', isoOffset(now, 35 * 60_000),
      9450, 3, 2.1, 5, null, nowIso, nowIso,
    ]);
    addOrder([
      'order-103', DEMO_IDS.tenant, DEMO_IDS.branch, '#103', 'MANUAL', 'demo-103', null,
      isoOffset(now, -29 * 60_000), 103, 'Carla Mendes', '(11) 99999-0103',
      'Rua Vergueiro, 2100 - Vila Mariana', -23.5852, -46.638,
      1, 1, 1, 1, 1, 1, null, 'READY', isoOffset(now, 42 * 60_000),
      7270, 2, 1.5, 4, null, nowIso, nowIso,
    ]);
    addOrder([
      'order-104', DEMO_IDS.tenant, DEMO_IDS.branch, '#104', 'MANUAL', 'demo-104', null,
      isoOffset(now, -26 * 60_000), 104, 'Diego Rocha', '(11) 99999-0104',
      'Endereço aguardando correção', null, null,
      1, 1, 0, 0, 1, 1, 'Endereço inválido: confirme número e CEP.', 'BLOCKED',
      isoOffset(now, 55 * 60_000), 5380, 1, 1, 2, null, nowIso, nowIso,
    ]);
    addOrder([
      'order-105', DEMO_IDS.tenant, DEMO_IDS.branch, '#105', 'MANUAL', 'demo-105', null,
      isoOffset(now, -18 * 60_000), 105, 'Elisa Nunes', '(11) 99999-0105',
      'Rua Sena Madureira, 510 - Vila Mariana', -23.5945, -46.6374,
      1, 1, 1, 1, 1, 1, null, 'READY', isoOffset(now, 50 * 60_000),
      11200, 4, 2.4, 6, null, nowIso, nowIso,
    ]);
    addOrder([
      'order-106', DEMO_IDS.tenant, DEMO_IDS.branch, '#106', 'MANUAL', 'demo-106', null,
      isoOffset(now, -12 * 60_000), 106, 'Fábio Reis', '(11) 99999-0106',
      'Rua Capitão Macedo, 330 - Vila Mariana', -23.5972, -46.632,
      1, 1, 1, 1, 1, 1, null, 'ASSIGNED', isoOffset(now, 40 * 60_000),
      6100, 2, 1.3, 3, 'route-demo-active', nowIso, nowIso,
    ]);
    addOrder([
      'order-107', DEMO_IDS.tenant, DEMO_IDS.branch, '#107', 'MANUAL', 'demo-107', null,
      isoOffset(now, -2 * 60 * 60_000), 107, 'Gabriela Silva', '(11) 99999-0107',
      'Rua Cubatão, 800 - Vila Mariana', -23.579, -46.647,
      1, 1, 1, 1, 1, 1, null, 'DELIVERED', isoOffset(now, -60 * 60_000),
      8300, 2, 1.1, 3, null, nowIso, nowIso,
    ]);
    addOrder([
      'other-order-secret', DEMO_IDS.otherTenant, DEMO_IDS.otherBranch, '#1', 'MANUAL',
      'other-secret', null, isoOffset(now, -10 * 60_000), 1, 'Cliente de Outro Tenant',
      '(11) 90000-0000', 'Endereço confidencial', -23.55, -46.64,
      1, 1, 1, 1, 1, 1, null, 'READY', isoOffset(now, 45 * 60_000),
      9999, 1, 1, 2, null, nowIso, nowIso,
    ]);

    database.prepare(
      `INSERT INTO routes (
        id, tenant_id, branch_id, courier_id, code, status, distance_km,
        duration_minutes, explanation_json, acceptance_expires_at, accepted_at,
        started_at, current_stop_index, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      'route-demo-active',
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      'courier-julia',
      'RT-2401',
      4.8,
      28,
      JSON.stringify(['Pedido #106 atribuído antes dos pedidos mais novos.', 'Júlia está executando a rota.']),
      isoOffset(now, -10 * 60_000),
      isoOffset(now, -8 * 60_000),
      isoOffset(now, -5 * 60_000),
      nowIso,
      nowIso,
    );

    const stopInsert = database.prepare(
      `INSERT INTO route_stops (
        id, tenant_id, branch_id, route_id, order_id, sequence, type, label,
        address, latitude, longitude, status, eta, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stopInsert.run(
      'stop-demo-pickup', DEMO_IDS.tenant, DEMO_IDS.branch, 'route-demo-active', null, 0,
      'PICKUP', 'Bella Massa · retirada', 'Rua Domingos de Morais, 1200',
      -23.5892, -46.6346, 'COMPLETED', isoOffset(now, -3 * 60_000), nowIso, nowIso,
    );
    stopInsert.run(
      'stop-demo-delivery', DEMO_IDS.tenant, DEMO_IDS.branch, 'route-demo-active', 'order-106', 1,
      'DELIVERY', 'Pedido #106 · Fábio Reis', 'Rua Capitão Macedo, 330 - Vila Mariana',
      -23.5972, -46.632, 'PENDING', isoOffset(now, 12 * 60_000), nowIso, nowIso,
    );

    database.prepare(
      `INSERT INTO audit_logs (
        tenant_id, branch_id, actor_user_id, action, entity_type, entity_id,
        reason, before_json, after_json, request_id, created_at
      ) VALUES (?, ?, ?, 'DEMO_SEEDED', 'SYSTEM', ?, ?, NULL, ?, ?, ?)`,
    ).run(
      DEMO_IDS.tenant,
      DEMO_IDS.branch,
      DEMO_IDS.admin,
      DEMO_IDS.tenant,
      'Carga inicial de demonstração',
      JSON.stringify({ orders: 7, couriers: 3 }),
      randomUUID(),
      nowIso,
    );
  });

  return true;
}
