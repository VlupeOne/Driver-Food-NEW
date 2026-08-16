export type AppView =
  | "login"
  | "operacao"
  | "pedidos"
  | "rotas"
  | "entregadores"
  | "auditoria"
  | "configuracoes"
  | "entregador";

export type OrderStatus =
  | "received"
  | "confirmed"
  | "preparing"
  | "ready"
  | "planned"
  | "offered"
  | "accepted"
  | "picked_up"
  | "on_route"
  | "delivered"
  | "blocked"
  | "cancelled"
  | "delivery_failed";

export type CourierStatus = "offline" | "available" | "reserved" | "busy" | "paused" | "unavailable";
export type RouteStatus = "draft" | "offered" | "accepted" | "in_progress" | "completed" | "refused" | "cancelled" | "exception";

export interface Session {
  user: { id: string; name: string; email: string; role: string };
  tenant: { id: string; name: string };
  branch: { id: string; name: string; timezone: string };
}

export interface Order {
  id: string;
  number: string;
  sequenceNumber: number;
  receivedAt: string;
  customerName: string;
  address: string;
  status: OrderStatus;
  blockReason?: string;
  promisedAt?: string;
  amountCents?: number;
  itemsCount?: number;
  lat?: number;
  lng?: number;
}

export interface RouteStop {
  id: string;
  sequence: number;
  type: "pickup" | "delivery";
  orderId?: string;
  label: string;
  address: string;
  status: "pending" | "arrived" | "completed" | "failed";
  eta?: string;
  lat?: number;
  lng?: number;
}

export interface DeliveryRoute {
  id: string;
  code: string;
  status: RouteStatus;
  distanceKm: number;
  durationMinutes: number;
  courierId?: string;
  courierName?: string;
  orders: string[];
  stops: RouteStop[];
  explanation: string[];
  acceptanceExpiresAt?: string;
}

export interface Courier {
  id: string;
  name: string;
  status: CourierStatus;
  vehicle: string;
  plate: string;
  batteryPercent?: number;
  lastHeartbeatAt?: string;
  activeRouteCode?: string;
  shiftStartedAt?: string;
  deliveriesInShift?: number;
  location?: { lat: number; lng: number };
}

export interface DashboardSummary {
  waiting: number;
  late: number;
  ready: number;
  onRoute: number;
  doneToday: number;
  couriersAvailable: number;
  couriersBusy: number;
  couriersPaused: number;
  couriersOffline: number;
}

export interface OperationalAlert {
  id: string;
  type: "error" | "warning" | "info";
  title: string;
  description: string;
  count?: number;
}

export interface DashboardData {
  generatedAt: string;
  branch: Session["branch"];
  summary: DashboardSummary;
  orders: Order[];
  routes: DeliveryRoute[];
  couriers: Courier[];
  alerts: OperationalAlert[];
}

export interface RouteSettings {
  maxStopsPerRoute: number;
  maxWeightKg: number;
  maxVolumeLiters: number;
  groupingRadiusKm: number;
  maxExtraDistanceKm: number;
  maxExtraMinutes: number;
  maxRouteMinutes: number;
  maxWaitMinutes: number;
  pickupSlaMinutes: number;
  deliverySlaMinutes: number;
  acceptanceTimeoutSeconds: number;
  heartbeatToleranceSeconds: number;
  locationToleranceSeconds: number;
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actorName: string;
  action: string;
  entity: string;
  previousValue?: string;
  newValue?: string;
  reason?: string;
  source: string;
}

export interface CourierHome {
  courier: Courier;
  shift: { id: string; startedAt: string; status: "open" | "closed" } | null;
  currentRoute: DeliveryRoute | null;
  offeredRoute: DeliveryRoute | null;
  outboxPending?: number;
}

export interface NewOrderInput {
  customerName: string;
  phone: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    postalCode?: string;
  };
  items: Array<{ name: string; quantity: number }>;
  paymentMethod: string;
  notes?: string;
}
