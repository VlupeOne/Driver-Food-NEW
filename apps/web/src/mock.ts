import type {
  AuditEntry,
  CourierHome,
  DashboardData,
  DeliveryRoute,
  NewOrderInput,
  Order,
  RouteSettings,
  Session,
} from "./types";

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const minutesFromNow = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

export const demoSession: Session = {
  user: { id: "usr_demo", name: "Bruno Rocha", email: "bruno@bellamassa.demo", role: "owner" },
  tenant: { id: "tenant_bella", name: "Bella Massa" },
  branch: { id: "branch_centro", name: "Bella Massa • Centro", timezone: "America/Sao_Paulo" },
};

const orders: Order[] = [
  { id: "ord_7849", number: "#7849", sequenceNumber: 1, receivedAt: minutesAgo(27), customerName: "João da Silva", address: "R. Augusta, 123 • Consolação", status: "ready", promisedAt: minutesFromNow(14), amountCents: 6890, itemsCount: 3, lat: -23.555, lng: -46.657 },
  { id: "ord_7850", number: "#7850", sequenceNumber: 2, receivedAt: minutesAgo(25), customerName: "Maria Oliveira", address: "R. das Flores, 999 • São Paulo", status: "blocked", blockReason: "Endereço inválido", promisedAt: minutesFromNow(10), amountCents: 4750, itemsCount: 2 },
  { id: "ord_7851", number: "#7851", sequenceNumber: 3, receivedAt: minutesAgo(22), customerName: "Carlos Ferreira", address: "Av. Brigadeiro Luís Antônio, 456", status: "offered", promisedAt: minutesFromNow(18), amountCents: 9290, itemsCount: 4, lat: -23.565, lng: -46.648 },
  { id: "ord_7852", number: "#7852", sequenceNumber: 4, receivedAt: minutesAgo(20), customerName: "Ana Paula Santos", address: "R. Vergueiro, 880 • Liberdade", status: "ready", promisedAt: minutesFromNow(21), amountCents: 5890, itemsCount: 2, lat: -23.568, lng: -46.639 },
  { id: "ord_7853", number: "#7853", sequenceNumber: 5, receivedAt: minutesAgo(18), customerName: "Rafael Lima", address: "R. Pamplona, 845 • Jardim Paulista", status: "ready", promisedAt: minutesFromNow(25), amountCents: 7340, itemsCount: 3, lat: -23.57, lng: -46.655 },
  { id: "ord_7854", number: "#7854", sequenceNumber: 6, receivedAt: minutesAgo(16), customerName: "Juliana Costa", address: "R. Cubatão, 310 • Vila Mariana", status: "offered", promisedAt: minutesFromNow(29), amountCents: 4250, itemsCount: 1, lat: -23.576, lng: -46.646 },
  { id: "ord_7855", number: "#7855", sequenceNumber: 7, receivedAt: minutesAgo(13), customerName: "Lucas Almeida", address: "R. Peixoto Gomide, 120 • Jardins", status: "ready", promisedAt: minutesFromNow(34), amountCents: 10480, itemsCount: 5, lat: -23.559, lng: -46.661 },
  { id: "ord_7856", number: "#7856", sequenceNumber: 8, receivedAt: minutesAgo(11), customerName: "Beatriz Souza", address: "R. Apeninos, 540 • Paraíso", status: "offered", promisedAt: minutesFromNow(38), amountCents: 6170, itemsCount: 2, lat: -23.575, lng: -46.642 },
  { id: "ord_7857", number: "#7857", sequenceNumber: 9, receivedAt: minutesAgo(8), customerName: "Marcos Vinícius", address: "R. Domingos de Morais, 640", status: "ready", promisedAt: minutesFromNow(42), amountCents: 8630, itemsCount: 3, lat: -23.581, lng: -46.638 },
  { id: "ord_7858", number: "#7858", sequenceNumber: 10, receivedAt: minutesAgo(5), customerName: "Fernanda Rocha", address: "R. Major Maragliano, 155", status: "preparing", promisedAt: minutesFromNow(49), amountCents: 5590, itemsCount: 2, lat: -23.586, lng: -46.643 },
];

const routes: DeliveryRoute[] = [
  {
    id: "route_1042",
    code: "DF-1042",
    status: "offered",
    distanceKm: 6.2,
    durationMinutes: 28,
    courierId: "courier_felipe",
    courierName: "Felipe Andrade",
    orders: ["ord_7849", "ord_7852", "ord_7853", "ord_7855"],
    acceptanceExpiresAt: minutesFromNow(1),
    explanation: ["#7849 é o pedido elegível mais antigo", "#7852 acrescenta apenas 3 min", "Felipe está disponível há mais tempo e sem carga ativa"],
    stops: [
      { id: "pickup_1042", sequence: 0, type: "pickup", label: "Retirada: Bella Massa", address: "Rua da Quitanda, 120 • Centro", status: "pending", eta: "10:31" },
      { id: "stop_1", sequence: 1, type: "delivery", orderId: "ord_7849", label: "João da Silva", address: "R. Augusta, 123 • Consolação", status: "pending", eta: "10:35", lat: -23.555, lng: -46.657 },
      { id: "stop_2", sequence: 2, type: "delivery", orderId: "ord_7852", label: "Ana Paula Santos", address: "Av. Brigadeiro Luís Antônio, 456", status: "pending", eta: "10:45", lat: -23.565, lng: -46.648 },
      { id: "stop_3", sequence: 3, type: "delivery", orderId: "ord_7853", label: "Rafael Lima", address: "R. Pamplona, 845 • Jardim Paulista", status: "pending", eta: "10:55", lat: -23.57, lng: -46.655 },
      { id: "stop_4", sequence: 4, type: "delivery", orderId: "ord_7855", label: "Lucas Almeida", address: "R. Peixoto Gomide, 120 • Jardins", status: "pending", eta: "11:05", lat: -23.559, lng: -46.661 },
    ],
  },
  {
    id: "route_1041",
    code: "DF-1041",
    status: "in_progress",
    distanceKm: 4.8,
    durationMinutes: 24,
    courierId: "courier_rafael",
    courierName: "Rafael Souza",
    orders: ["ord_7851", "ord_7854"],
    explanation: ["#7851 foi reservado como âncora FIFO", "Rafael tinha a menor carga ativa"],
    stops: [
      { id: "pickup_1041", sequence: 0, type: "pickup", label: "Retirada: Bella Massa", address: "Rua da Quitanda, 120 • Centro", status: "completed" },
      { id: "stop_1041_1", sequence: 1, type: "delivery", orderId: "ord_7851", label: "Carlos Ferreira", address: "Av. Brigadeiro Luís Antônio, 456", status: "arrived", eta: "10:36" },
      { id: "stop_1041_2", sequence: 2, type: "delivery", orderId: "ord_7854", label: "Juliana Costa", address: "R. Cubatão, 310 • Vila Mariana", status: "pending", eta: "10:49" },
    ],
  },
  {
    id: "route_1040",
    code: "DF-1040",
    status: "accepted",
    distanceKm: 5.4,
    durationMinutes: 26,
    courierId: "courier_thiago",
    courierName: "Thiago Martins",
    orders: ["ord_7856", "ord_7857"],
    explanation: ["#7856 era o próximo pedido FIFO", "A inserção de #7857 preservou SLA e capacidade"],
    stops: [
      { id: "pickup_1040", sequence: 0, type: "pickup", label: "Retirada: Bella Massa", address: "Rua da Quitanda, 120 • Centro", status: "pending", eta: "10:34" },
      { id: "stop_1040_1", sequence: 1, type: "delivery", orderId: "ord_7856", label: "Beatriz Souza", address: "R. Apeninos, 540 • Paraíso", status: "pending", eta: "10:44" },
      { id: "stop_1040_2", sequence: 2, type: "delivery", orderId: "ord_7857", label: "Marcos Vinícius", address: "R. Domingos de Morais, 640", status: "pending", eta: "10:56" },
    ],
  },
];

let dashboard: DashboardData = {
  generatedAt: new Date(now).toISOString(),
  branch: demoSession.branch,
  summary: { waiting: 10, late: 1, ready: 5, onRoute: 5, doneToday: 34, couriersAvailable: 2, couriersBusy: 2, couriersPaused: 1, couriersOffline: 1 },
  orders,
  routes,
  couriers: [
    { id: "courier_felipe", name: "Felipe Andrade", status: "available", vehicle: "Honda CG 160", plate: "FPC-3H47", batteryPercent: 78, lastHeartbeatAt: minutesAgo(0), location: { lat: -23.552, lng: -46.653 } },
    { id: "courier_rafael", name: "Rafael Souza", status: "busy", vehicle: "Yamaha YBR 150", plate: "GGH-1F23", batteryPercent: 62, lastHeartbeatAt: minutesAgo(1), activeRouteCode: "DF-1041", location: { lat: -23.563, lng: -46.647 } },
    { id: "courier_thiago", name: "Thiago Martins", status: "busy", vehicle: "Honda CG 160", plate: "EZX-8A91", batteryPercent: 55, lastHeartbeatAt: minutesAgo(1), activeRouteCode: "DF-1040", location: { lat: -23.572, lng: -46.642 } },
    { id: "courier_bruno", name: "Bruno Lima", status: "reserved", vehicle: "Honda CG 160", plate: "FFR-2D18", batteryPercent: 90, lastHeartbeatAt: minutesAgo(2) },
    { id: "courier_leonardo", name: "Leonardo Costa", status: "offline", vehicle: "Honda CG 160", plate: "GGA-7B90", batteryPercent: 0, lastHeartbeatAt: minutesAgo(40) },
  ],
  alerts: [
    { id: "alert_invalid", type: "error", title: "Endereço inválido", description: "Pedido #7850 precisa de revisão antes de entrar no planejamento.", count: 1 },
    { id: "alert_accept", type: "info", title: "Aguardando aceite", description: "Rotas oferecidas aos motoboys.", count: 2 },
    { id: "alert_sla", type: "error", title: "SLA em risco", description: "Pedido #7849 está a 14 min do limite.", count: 1 },
    { id: "alert_blocked", type: "warning", title: "Bloqueados", description: "Pendências não travam os demais pedidos FIFO.", count: 1 },
  ],
};

let settings: RouteSettings = {
  maxStopsPerRoute: 4,
  maxWeightKg: 18,
  maxVolumeLiters: 45,
  groupingRadiusKm: 3.5,
  maxExtraDistanceKm: 4,
  maxExtraMinutes: 12,
  maxRouteMinutes: 55,
  maxWaitMinutes: 25,
  pickupSlaMinutes: 15,
  deliverySlaMinutes: 50,
  acceptanceTimeoutSeconds: 60,
  heartbeatToleranceSeconds: 90,
  locationToleranceSeconds: 180,
};

let audit: AuditEntry[] = [
  { id: "audit_1", occurredAt: minutesAgo(4), actorName: "Motor de despacho", action: "Rota sugerida", entity: "Rota DF-1042", newValue: "Felipe Andrade • 4 pedidos", reason: "FIFO e menor acréscimo de tempo", source: "Automação" },
  { id: "audit_2", occurredAt: minutesAgo(12), actorName: "Bruno Rocha", action: "Endereço corrigido", entity: "Pedido #7848", previousValue: "Rua Aurora, s/n", newValue: "Rua Aurora, 351", reason: "Confirmação por telefone", source: "Painel web" },
  { id: "audit_3", occurredAt: minutesAgo(21), actorName: "Rafael Souza", action: "Rota aceita", entity: "Rota DF-1041", previousValue: "offered", newValue: "accepted", source: "PWA motoboy" },
  { id: "audit_4", occurredAt: minutesAgo(34), actorName: "Bruno Rocha", action: "Prioridade alterada", entity: "Pedido #7844", previousValue: "posição 3", newValue: "posição 1", reason: "Cliente com pedido hospitalar urgente", source: "Painel web" },
  { id: "audit_5", occurredAt: minutesAgo(48), actorName: "Integração", action: "Pedido recebido", entity: "Pedido #7849", newValue: "received", source: "API" },
];

const clone = <T,>(value: T): T => structuredClone(value);

export const mockApi = {
  session: () => clone(demoSession),
  dashboard: () => clone(dashboard),
  settings: () => clone(settings),
  audit: () => clone(audit),
  createOrder(input: NewOrderInput) {
    const next = dashboard.orders.length + 7849;
    const order: Order = {
      id: `ord_${next}`,
      number: `#${next}`,
      sequenceNumber: dashboard.orders.length + 1,
      receivedAt: new Date().toISOString(),
      customerName: input.customerName,
      address: `${input.address.street}, ${input.address.number} • ${input.address.neighborhood}`,
      status: "received",
      itemsCount: input.items.reduce((sum, item) => sum + item.quantity, 0),
    };
    dashboard = { ...dashboard, orders: [...dashboard.orders, order], summary: { ...dashboard.summary, waiting: dashboard.summary.waiting + 1 } };
    return clone(order);
  },
  planRoutes() {
    dashboard = { ...dashboard, generatedAt: new Date().toISOString() };
    return { routes: clone(dashboard.routes), message: "Planejamento concluído preservando a prioridade FIFO." };
  },
  updateSettings(next: RouteSettings) {
    settings = clone(next);
    return clone(settings);
  },
  overrideRoute(routeId: string, courierId: string, reason: string) {
    const courier = dashboard.couriers.find((item) => item.id === courierId);
    const route = dashboard.routes.find((item) => item.id === routeId);
    if (!route || !courier) throw new Error("Rota ou entregador não encontrado.");
    route.courierId = courier.id;
    route.courierName = courier.name;
    const auditEntry: AuditEntry = {
      id: `audit_${Date.now()}`,
      occurredAt: new Date().toISOString(),
      actorName: demoSession.user.name,
      action: "Rota reatribuída manualmente",
      entity: `Rota ${route.code}`,
      newValue: courier.name,
      reason,
      source: "Painel web",
    };
    audit = [auditEntry, ...audit];
    return { route: clone(route), auditEntry: clone(auditEntry) };
  },
  courierHome(): CourierHome {
    const courier = dashboard.couriers.find((item) => item.id === "courier_rafael")!;
    const currentRoute = dashboard.routes.find((item) => item.id === "route_1041")!;
    const offeredRoute: DeliveryRoute = {
      id: "route_1043",
      code: "DF-1043",
      status: "offered",
      distanceKm: 4.8,
      durationMinutes: 23,
      courierId: courier.id,
      courierName: courier.name,
      orders: ["ord_7859", "ord_7860"],
      acceptanceExpiresAt: minutesFromNow(1),
      explanation: ["Você está disponível e tem a menor carga ativa"],
      stops: [
        { id: "pickup_1043", sequence: 0, type: "pickup", label: "Retirada: Bella Massa", address: "Rua da Quitanda, 120 • Centro", status: "pending" },
        { id: "stop_1043_1", sequence: 1, type: "delivery", label: "Marina", address: "Rua do Carmo, 44 • Centro", status: "pending" },
        { id: "stop_1043_2", sequence: 2, type: "delivery", label: "Paulo", address: "Rua da Glória, 182 • Liberdade", status: "pending" },
      ],
    };
    return { courier: clone(courier), shift: { id: "shift_demo", startedAt: minutesAgo(84), status: "open" }, currentRoute: clone(currentRoute), offeredRoute, outboxPending: 0 };
  },
  courierAction(routeId: string, action: string) {
    const home = this.courierHome();
    const route = routeId === home.offeredRoute?.id ? home.offeredRoute : home.currentRoute;
    if (route && action === "accept") route.status = "accepted";
    if (route && action === "reject") route.status = "refused";
    if (route && action === "advance") {
      const next = route.stops.find((stop) => stop.status !== "completed");
      if (next) next.status = next.status === "pending" ? "arrived" : "completed";
      route.status = route.stops.every((stop) => stop.status === "completed") ? "completed" : "in_progress";
    }
    return { route: clone(route), courier: clone(home.courier) };
  },
};
