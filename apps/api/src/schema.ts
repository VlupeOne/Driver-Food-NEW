export const schemaSql = String.raw`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS couriers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'BUSY', 'PAUSED', 'OFFLINE')),
  vehicle TEXT NOT NULL,
  plate TEXT,
  capacity_stops INTEGER NOT NULL DEFAULT 4 CHECK (capacity_stops > 0),
  capacity_weight_kg REAL NOT NULL DEFAULT 20 CHECK (capacity_weight_kg > 0),
  capacity_volume_liters REAL NOT NULL DEFAULT 60 CHECK (capacity_volume_liters > 0),
  shift_id TEXT,
  shift_started_at TEXT,
  deliveries_in_shift INTEGER NOT NULL DEFAULT 0,
  last_assignment_at TEXT,
  last_heartbeat_at TEXT,
  latitude REAL,
  longitude REAL,
  battery_percent INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL,
  courier_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'KITCHEN', 'COURIER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, courier_id) REFERENCES couriers(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash, expires_at);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  max_stops_per_route INTEGER NOT NULL DEFAULT 4,
  max_weight_kg REAL NOT NULL DEFAULT 20,
  max_volume_liters REAL NOT NULL DEFAULT 60,
  grouping_radius_km REAL NOT NULL DEFAULT 5,
  max_extra_distance_km REAL NOT NULL DEFAULT 4,
  max_extra_minutes INTEGER NOT NULL DEFAULT 18,
  max_route_minutes INTEGER NOT NULL DEFAULT 75,
  max_wait_minutes INTEGER NOT NULL DEFAULT 30,
  pickup_sla_minutes INTEGER NOT NULL DEFAULT 20,
  delivery_sla_minutes INTEGER NOT NULL DEFAULT 60,
  acceptance_timeout_seconds INTEGER NOT NULL DEFAULT 90,
  heartbeat_tolerance_seconds INTEGER NOT NULL DEFAULT 120,
  location_tolerance_seconds INTEGER NOT NULL DEFAULT 180,
  average_speed_kmh REAL NOT NULL DEFAULT 24,
  stop_service_minutes INTEGER NOT NULL DEFAULT 4,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS branch_order_counters (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  next_value INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, branch_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  number TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  external_id TEXT,
  source_created_at TEXT,
  received_at TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  confirmed INTEGER NOT NULL DEFAULT 1 CHECK (confirmed IN (0, 1)),
  ready INTEGER NOT NULL DEFAULT 1 CHECK (ready IN (0, 1)),
  address_valid INTEGER NOT NULL DEFAULT 1 CHECK (address_valid IN (0, 1)),
  area_valid INTEGER NOT NULL DEFAULT 1 CHECK (area_valid IN (0, 1)),
  payment_valid INTEGER NOT NULL DEFAULT 1 CHECK (payment_valid IN (0, 1)),
  dispatch_allowed INTEGER NOT NULL DEFAULT 1 CHECK (dispatch_allowed IN (0, 1)),
  block_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'PREPARING', 'READY', 'ASSIGNED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED', 'BLOCKED')),
  promised_at TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 1,
  weight_kg REAL NOT NULL DEFAULT 1,
  volume_liters REAL NOT NULL DEFAULT 3,
  assigned_route_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, branch_id, sequence_number),
  UNIQUE (tenant_id, source, external_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS orders_queue_idx
  ON orders(tenant_id, branch_id, status, received_at, sequence_number);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  courier_id TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED')),
  distance_km REAL NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  explanation_json TEXT NOT NULL DEFAULT '[]',
  acceptance_expires_at TEXT,
  accepted_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  current_stop_index INTEGER NOT NULL DEFAULT 0,
  planner_run_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, courier_id) REFERENCES couriers(tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS routes_one_active_per_courier
  ON routes(tenant_id, courier_id)
  WHERE status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS');

CREATE TABLE IF NOT EXISTS route_stops (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  order_id TEXT,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PICKUP', 'DELIVERY')),
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ARRIVED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  eta TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, route_id, sequence),
  FOREIGN KEY (tenant_id, route_id) REFERENCES routes(tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS route_stops_one_active_assignment
  ON route_stops(tenant_id, order_id)
  WHERE order_id IS NOT NULL AND active = 1;

CREATE TABLE IF NOT EXISTS planner_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  settings_version INTEGER NOT NULL,
  stopped_at_order_id TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_tenant_idx ON audit_logs(tenant_id, branch_id, id DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  audience_user_id TEXT,
  type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS outbox_tenant_idx ON outbox_events(tenant_id, branch_id, id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, actor_user_id, scope, key)
);

CREATE TRIGGER IF NOT EXISTS orders_received_at_immutable
BEFORE UPDATE OF received_at ON orders
WHEN NEW.received_at <> OLD.received_at
BEGIN
  SELECT RAISE(ABORT, 'received_at is immutable');
END;

CREATE TRIGGER IF NOT EXISTS orders_sequence_immutable
BEFORE UPDATE OF sequence_number ON orders
WHEN NEW.sequence_number <> OLD.sequence_number
BEGIN
  SELECT RAISE(ABORT, 'sequence_number is immutable');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are immutable');
END;
`;
