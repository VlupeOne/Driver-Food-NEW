import { useMemo } from "react";
import type { DashboardData, DeliveryRoute, Order } from "../types";
import { MapCanvas } from "../components/MapCanvas";
import { Button, PanelState, StatusTag } from "../components/ui";
import { Icon } from "../components/Icon";

const orderLabels: Record<Order["status"], string> = {
  received: "Recebido",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  planned: "Planejado",
  offered: "Aguardando aceite",
  accepted: "Aceito",
  picked_up: "Retirado",
  on_route: "Em entrega",
  delivered: "Entregue",
  blocked: "Bloqueado",
  cancelled: "Cancelado",
  delivery_failed: "Falha",
};

export function OperationView({
  data,
  selectedRouteId,
  onSelectRoute,
  onPlan,
  planning,
  onNewOrder,
  onAdjust,
  loading,
  error,
  onRetry,
}: {
  data: DashboardData | null;
  selectedRouteId?: string;
  onSelectRoute: (id: string) => void;
  onPlan: () => void;
  planning: boolean;
  onNewOrder: () => void;
  onAdjust: (route: DeliveryRoute) => void;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const selectedRoute = useMemo(
    () => data?.routes.find((route) => route.id === selectedRouteId) ?? data?.routes[0],
    [data, selectedRouteId],
  );

  if (loading && !data) return <PanelState kind="loading" />;
  if (error && !data) return <PanelState kind="error" title="A operação não carregou" description={error} action={<Button onClick={onRetry} icon="refresh">Tentar novamente</Button>} />;
  if (!data) return <PanelState kind="empty" title="Nenhum dado operacional" description="Os pedidos aparecerão aqui assim que forem recebidos." />;
  const blockedOrder = data.orders.find((order) => order.status === "blocked");

  return (
    <div className="operation-view">
      <div className="operation-toolbar-mobile">
        <Button icon="spark" loading={planning} onClick={onPlan}>Planejar rotas</Button>
        <Button icon="plus" variant="secondary" onClick={onNewOrder}>Novo pedido</Button>
      </div>

      <div className="kpi-rail" aria-label="Resumo da operação">
        <Kpi label="Aguardando" value={data.summary.waiting} tone="neutral" />
        <Kpi label="Prontos" value={data.summary.ready} tone="success" />
        <Kpi label="Em rota" value={data.summary.onRoute} tone="info" />
        <Kpi label="Atrasados" value={data.summary.late} tone="danger" />
        <Kpi label="Concluídos hoje" value={data.summary.doneToday} tone="neutral" />
        <div className="kpi-rail__couriers"><span className="live-dot live-dot--live" />{data.summary.couriersAvailable} motoboys disponíveis</div>
      </div>

      <div className="operation-grid">
        <section className="queue-pane">
          <header className="pane-header">
            <div><h2>Fila de pedidos</h2><span>Prioridade oficial FIFO</span></div>
            <button className="icon-button" disabled aria-label="Filtro da fila indisponível no MVP" title="Filtro em evolução"><Icon name="sliders" /></button>
          </header>
          <div className="queue-columns"><span># FIFO</span><span>Recebido</span><span>Pedido / cliente</span><span>Status</span></div>
          <div className="queue-list">
            {data.orders.map((order, index) => (
              <button className={`queue-row ${order.status === "blocked" ? "queue-row--blocked" : ""}`} key={order.id} disabled>
                <span className="queue-row__sequence">{String(index + 1).padStart(3, "0")}</span>
                <span className="queue-row__time">{formatTime(order.receivedAt)}<small>{ageLabel(order.receivedAt)}</small></span>
                <span className="queue-row__order"><strong>{order.number}</strong><span>{order.customerName}</span>{order.blockReason && <small>{order.blockReason}</small>}</span>
                <span className="queue-row__status"><StatusTag status={order.status}>{orderLabels[order.status]}</StatusTag><i aria-hidden="true" /></span>
              </button>
            ))}
          </div>
          <footer className="queue-footer"><span>{data.orders.length} pedidos na fila</span><span>Prioridade: FIFO <Icon name="help" /></span></footer>
        </section>

        <section className="routes-pane">
          <header className="pane-header">
            <div><h2>Rotas sugeridas</h2><span>{data.routes.length} rotas neste ciclo</span></div>
            <Button variant="secondary" icon="sliders" disabled={!selectedRoute} onClick={() => selectedRoute && onAdjust(selectedRoute)}>Ajustes</Button>
          </header>
          <div className="map-wrap">
            <MapCanvas routes={data.routes} couriers={data.couriers} selectedRouteId={selectedRoute?.id} onSelectRoute={onSelectRoute} />
            {blockedOrder && (
              <div className="map-alert">
                <Icon name="alert" />
                <div><strong>Endereço inválido</strong><span>{blockedOrder.number} • {blockedOrder.customerName}</span><small>{blockedOrder.address}</small></div>

              </div>
            )}
          </div>
          {selectedRoute && <RouteDetail route={selectedRoute} onAdjust={() => onAdjust(selectedRoute)} />}
        </section>

        <section className="courier-pane">
          <header className="pane-header">
            <div><h2>Motoboys</h2><span>Presença agora</span></div>
            <button className="icon-button" disabled aria-label="Filtro de motoboys indisponível no MVP" title="Filtro em evolução"><Icon name="sliders" /></button>
          </header>
          <div className="courier-list">
            {data.couriers.map((courier, index) => (
              <button className="courier-row" key={courier.id} disabled>
                <span className={`courier-row__state courier-row__state--${courier.status}`}>{courierStatus(courier.status)}</span>
                <strong>{courier.name}</strong>
                <span>{courier.plate} <i /> {courier.vehicle.replace("Honda ", "").replace("Yamaha ", "")}</span>
                <span className="courier-row__meta"><span><Icon name="battery" />{courier.batteryPercent ?? 0}%</span>{courier.activeRouteCode && <span>{courier.activeRouteCode}</span>}</span>
                <span className={`courier-radar courier-radar--${index % 4}`}><i /></span>
                <Icon name="chevron-right" className="courier-row__arrow" />
              </button>
            ))}
          </div>
          <button className="pane-link" disabled>Ver todos os entregadores ({data.couriers.length})<Icon name="chevron-right" /></button>
        </section>
      </div>

      <div className="alerts-rail">
        {data.alerts.map((alert) => (
          <button key={alert.id} className={`alerts-rail__item alerts-rail__item--${alert.type}`} disabled>
            <Icon name={alert.type === "info" ? "clock" : "alert"} />
            <strong>{alert.title}</strong>
            {alert.count !== undefined && <span>{alert.count}</span>}
          </button>
        ))}
        <button className="alerts-rail__all" disabled>Ver todas as exceções<Icon name="chevron-right" /></button>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "info" | "danger" }) {
  return <div className={`kpi-rail__item kpi-rail__item--${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function RouteDetail({ route, onAdjust }: { route: DeliveryRoute; onAdjust: () => void }) {
  return (
    <div className="route-detail">
      <div className="route-detail__stops">
        <header><strong>{route.code}</strong><span>{route.orders.length} paradas</span><span>{route.distanceKm.toFixed(1).replace(".", ",")} km</span><span>{route.durationMinutes} min</span><StatusTag status={route.status}>Selecionada</StatusTag></header>
        <ol>
          {route.stops.filter((stop) => stop.type === "delivery").slice(0, 4).map((stop, index) => (
            <li key={stop.id}><span>{index + 1}</span><strong>{stop.orderId ? `#${stop.orderId.replace(/^ord_/, "").replace(/^order-/, "")}` : "Entrega"}</strong><span>{stop.label}</span><small>{stop.address}</small><time dateTime={stop.eta}>{stop.eta ? formatTime(stop.eta) : "—"}</time></li>
          ))}
        </ol>

      </div>
      <aside className="route-detail__courier">
        <span className="courier-row__state courier-row__state--available">Motoboy</span>
        <strong>{route.courierName ?? "Não atribuído"}</strong>
        <dl><div><dt>Rota</dt><dd>{route.code}</dd></div><div><dt>Carga atual</dt><dd>{route.orders.length} pedidos</dd></div></dl>
        <Button variant="secondary" onClick={onAdjust}>Reatribuir pedidos</Button>

      </aside>
    </div>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function ageLabel(value: string) {
  const age = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  return `${age} min`;
}

function courierStatus(status: string) {
  return ({ available: "Disponível", busy: "Em rota", reserved: "Aguardando aceite", paused: "Em pausa", offline: "Offline", unavailable: "Indisponível" } as Record<string, string>)[status] ?? status;
}
